// Dodgers at Brewers, NLCS Game 1 (October 11 2026, Brewers 2-1, the series 1-0), the plays ESPN posted (test/fixtures:
// trimmed from a recording of the live feed) through a live game tracker, for what that night's post game recording
// report changed: a final the scoreboard reports before the last out has been read waits for it (production's ESPN reads
// timed out for 80 seconds around Betts's fly-out, so the Dodgers' 9th was never judged and the out followed the loss);
// a lost ABS challenge waits 30 seconds, not 60; a tying run's line says it tied the game; a postseason game's start says
// its round and game, and a series game that ends nothing says where the series stands for the loser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.HW_DB = ':memory:';
process.env.HW_HALF_END_WAIT_MS = '300'; // how long a final waits for a read that catches up
process.env.HW_DECISION_RETRY_MS = '1';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { playsBehindFinal, roundLabel, seriesStanding, eliminationOf, summaryEvent, teamScoreEvents, fromCorePlay, gameLostEvent } = await import('../src/detectors.ts');
const { liveDeps, GameTracker, ABS_SETTLE_MS } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');
const { miseryRows } = await import('../src/misery.ts');

const fx = JSON.parse(readFileSync(new URL('./fixtures/nlcs-game1-401908030.json', import.meta.url), 'utf8'));
const MIL = '8', LAD = '19';
const SKUBAL = '42409', OHTANI = '39832', BETTS = '33039';

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run(`team:mlb:${MIL}`, MIL, 'Milwaukee Brewers', 'Brewers', 'MIL');
team.run(`team:mlb:${LAD}`, LAD, 'Los Angeles Dodgers', 'Dodgers', 'LAD');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const p of fx.roster) player.run(`player:mlb:${p.id}`, p.id, p.name, p.position, `team:mlb:${p.teamId}`);
loadCatalog();

const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)');
const fan = (id: string, keys: string[], prefs: object = {}) => {
  device.run(id, 's', 'ios', `tok-${id}`, JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  keys.forEach((k, i) => follow.run(id, k, i));
};
fan('dodgers', [`team:mlb:${LAD}`]);
fan('dodgers-loss-off', [`team:mlb:${LAD}`], { types: { 'team.lost': false } });
fan('ohtani', [`player:mlb:${OHTANI}`]);
fan('skubal-and-dodgers', [`player:mlb:${SKUBAL}`, `team:mlb:${LAD}`]);
fan('betts-outs', [`player:mlb:${BETTS}`], { types: { 'mlb.batter.popout': true } });
fan('brewers', [`team:mlb:${MIL}`]);
setPushSender(() => {});
const logs: string[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
after(() => { console.log = realLog; });

/** What a device has for a game, in order: type, title, body, the lines folded onto it. */
const feed = (dev: string, game: string) => (db.prepare(`SELECT e.type, e.title, e.body, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.id LIKE ? ORDER BY f.rowid`).all(dev, `${game}:%`) as any[])
  .map((r) => ({ type: r.type, title: r.title, body: r.body, lines: r.extra ? (JSON.parse(r.extra) as string[]) : [] }));

// The game as ESPN served it: the core plays as each read has them, a summary with the round, the series and the status.
const S = { game: 'NL0', core: [] as any[], state: 'in', season: 3 };
liveDeps.getJson = async (url: string) => {
  if (url.startsWith(urls.corePlays('mlb', S.game).split('?')[0])) return { items: S.core };
  if (url.startsWith(urls.summary('mlb', S.game))) {
    return { header: { id: S.game, season: { year: 2026, type: S.season }, gameNote: S.season === 3 ? fx.gameNote : undefined, competitions: [{ status: { type: { state: S.state } },
      competitors: [{ id: MIL, homeAway: 'home', score: '2' }, { id: LAD, homeAway: 'away', score: '1' }], series: fx.summarySeries }] }, plays: [], boxscore: { players: [] } };
  }
  throw new Error(`unexpected fetch ${url}`);
};
const fresh = (plays: any[]) => plays.map((p) => ({ ...p, wallclock: new Date().toISOString() }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The scoreboard's final as it read at 11:12 pm: the Brewers 2-1, the series wins not counting the game yet. */
const scoreboardFinal = (id: string, over: Partial<{ round: string; wins: Record<string, number>; done: boolean; total: number; home: number; away: number }> = {}): any => ({
  id, season: { year: 2026, type: 3 }, status: { type: { state: 'post', completed: true } },
  competitions: [{ notes: [{ type: 'event', headline: over.round ?? fx.gameNote }],
    series: over.wins ? { type: 'playoff', completed: over.done ?? false, totalCompetitions: over.total ?? 7, competitors: Object.entries(over.wins).map(([cid, wins]) => ({ id: cid, wins })) } : fx.series,
    competitors: [{ id: MIL, homeAway: 'home', score: String(over.home ?? 2) }, { id: LAD, homeAway: 'away', score: String(over.away ?? 1) }] }],
});

// ─── The Dodgers' last half-inning: Betts's fly-out is the third out ───
const gameSoFar = [fx.scoring[0], ...fx.bottom4, fx.scoring[1], ...fx.top9]; // the three runs' plays carry the score: Dodgers 1, Brewers 2
const flyOut = gameSoFar.findIndex((p: any) => p.id.endsWith('5030022'));
/** The plays as a read before the out had them: the at-bat's pitches still carried two out. */
const beforeTheOut = () => gameSoFar.slice(0, flyOut).map((p: any) => (p.id.includes('16050') && p.outs === 3 ? { ...p, outs: 2 } : p));

test('a final waits for the last out when the plays are behind it, and the out goes out before the loss', async () => {
  S.game = 'NL1';
  const tracker = new GameTracker('mlb', 'NL1', MIL, LAD);
  S.core = fresh(beforeTheOut());
  await tracker.poll();
  assert.notEqual(playsBehindFinal(tracker['plays'], tracker['score'], { home: 2, away: 1 }), null, 'the plays end on a walk with two out in the top of the 9th: no walk-off');
  tracker.finishFromScoreboard({ home: 2, away: 1 }, scoreboardFinal('NL1'));
  assert.equal(tracker.finished, false, 'held, not finished on a stale list');
  assert.equal(feed('dodgers', 'NL1').some((i) => i.type === 'team.lost'), false, 'no loss yet');
  assert.ok(logs.some((l) => /\[mlb NL1\] final held for a read that catches up/.test(l)), 'the hold is logged');
  tracker.finishFromScoreboard({ home: 2, away: 1 }, scoreboardFinal('NL1')); // the scoreboard's next scan, still inside the wait
  assert.equal(tracker.finished, false);

  S.core = fresh(gameSoFar); // the read with the third out
  await tracker.poll();
  assert.equal(tracker.finished, true, 'released by the read that caught up');
  assert.ok(logs.some((l) => /\[mlb NL1\] final released after \d+s: the plays caught up/.test(l)));

  assert.deepEqual(feed('betts-outs', 'NL1').map((i) => i.title), ['Mookie Betts flied out', 'Successful Hate Watch! Mookie Betts and the Dodgers lost to the Brewers'], 'the last out is an alert, and it comes before the loss');
  const loss = feed('dodgers', 'NL1').find((i) => i.type === 'team.lost')!;
  assert.deepEqual(loss.lines, ['Stranded runners on first and second in the 9th.'], 'the 9th is a line on the loss');
  assert.deepEqual(feed('ohtani', 'NL1').find((i) => i.type === 'player.team_lost')!.lines, ['Stranded runners on first and second in the 9th.'], 'and on a player tracker\'s');
  assert.equal(feed('dodgers-loss-off', 'NL1').some((i) => i.title === 'Dodgers stranded runners on first and second'), true, 'with the loss off it is an alert of its own');
  const order = (db.prepare(`SELECT e.type FROM events e WHERE e.id LIKE 'NL1:%' ORDER BY e.rowid`).all() as any[]).map((r) => r.type);
  assert.ok(order.indexOf('mlb.batter.popout') < order.indexOf('team.lost'), 'the out was stored before the loss');
});

test('a final that never catches up is finished as the plays stand once the wait is over', async () => {
  S.game = 'NL2';
  const tracker = new GameTracker('mlb', 'NL2', MIL, LAD);
  S.core = fresh(beforeTheOut());
  await tracker.poll();
  tracker.finishFromScoreboard({ home: 2, away: 1 }, scoreboardFinal('NL2'));
  assert.equal(tracker.finished, false);
  await sleep(350);
  tracker.finishFromScoreboard({ home: 2, away: 1 }, scoreboardFinal('NL2'));
  assert.equal(tracker.finished, true);
  assert.ok(logs.some((l) => /\[mlb NL2\] final released after 0\.3s without catching up/.test(l)));
  assert.deepEqual(feed('dodgers', 'NL2').find((i) => i.type === 'team.lost')!.lines, [], 'no 9th-inning line: the out was never read');
});

test('a tracker that never started (the scoreboard\'s backstop for a final nobody tracked) finishes at once', () => {
  const tracker = new GameTracker('mlb', 'NL3', MIL, LAD);
  tracker.finishFromScoreboard({ home: 2, away: 1 }, scoreboardFinal('NL3'));
  assert.equal(tracker.finished, true);
  assert.equal(feed('dodgers', 'NL3').find((i) => i.type === 'team.lost')!.title, 'Successful Hate Watch! Dodgers lost to the Brewers');
});

test('which lists are behind a final: a walk-off is not', () => {
  const last = (half: 'Top' | 'Bottom', outs: number, home: number, away: number): any[] => [{ id: '4019080301604990057', typeSlug: 'play-result', type: 'Play Result', text: '', participants: [],
    scoring: false, scoreValue: 0, home, away, at: 0, outs, period: { type: half, number: 9 }, periodNum: 9 }];
  assert.equal(playsBehindFinal([], { home: 0, away: 0 }, { home: 2, away: 1 }), null, 'no plays: a tracker that never read any');
  assert.match(playsBehindFinal(last('Top', 2, 2, 1), { home: 2, away: 1 }, { home: 2, away: 1 })!, /Top9 with 2 out/, 'the home team won, so the top half had its three outs');
  assert.equal(playsBehindFinal(last('Top', 3, 2, 1), { home: 2, away: 1 }, { home: 2, away: 1 }), null, 'the home team won after the top half: over');
  assert.match(playsBehindFinal(last('Top', 3, 1, 2), { home: 1, away: 2 }, { home: 1, away: 2 })!, /home team's half unread/, 'the visitors won: the bottom half comes after the top');
  assert.equal(playsBehindFinal(last('Bottom', 1, 3, 2), { home: 3, away: 2 }, { home: 3, away: 2 }), null, 'a walk-off: the bottom half, the home team winning, short of three outs');
  assert.match(playsBehindFinal(last('Bottom', 2, 1, 2), { home: 1, away: 2 }, { home: 1, away: 2 })!, /no walk-off/, 'the visitors won: the bottom half has its three outs');
  assert.equal(playsBehindFinal(last('Bottom', 3, 1, 2), { home: 1, away: 2 }, { home: 1, away: 2 }), null);
  assert.match(playsBehindFinal(last('Bottom', 1, 2, 2), { home: 2, away: 2 }, { home: 3, away: 2 })!, /plays' score is 2-2/, 'the walk-off run isn\'t read yet');
});

test('a lost ABS challenge waits 30 seconds by default', () => {
  assert.equal(ABS_SETTLE_MS, 30_000);
});

test('a tying run\'s line says it tied the game; a go-ahead one took the lead; any other just scored', async () => {
  const homer = fromCorePlay(fx.bottom4.find((p: any) => p.id.endsWith('1990057')));
  const ctx = { league: 'mlb' as const, gameId: 'NL4', homeId: MIL, awayId: LAD, goalies: new Map() };
  const folds = (prev: { home: number; away: number }, p = homer) => teamScoreEvents(ctx, prev, p, { home: 0, away: 0 }).map((e: any) => `${e.type} | ${e.title} | ${e.fold}`);
  assert.deepEqual(folds({ home: 0, away: 1 }), [`team.opponent_scored | Brewers tied the Dodgers on Turang's 384-foot solo homer | Brewers tied the game.`]);
  const lead = folds({ home: 1, away: 1 }, { ...homer, home: 2 });
  assert.deepEqual(lead.map((s) => s.split(' | ')[0]), ['team.fell_behind', 'team.opponent_scored'], 'the lead: both alerts');
  assert.ok(lead.some((s) => s.endsWith('| Brewers took the lead.')));
  assert.ok(folds({ home: 3, away: 1 }, { ...homer, home: 4 }).every((s) => s.endsWith('| Brewers scored 1 run.')), 'already ahead: the plain line');
  const soccer = { ...ctx, league: 'epl' as const };
  assert.ok(teamScoreEvents(soccer, { home: 0, away: 1 }, { ...homer, home: 1, away: 1, text: 'Goal' }, { home: 0, away: 0 }).some((e: any) => /equalized\.$/.test(e.fold ?? '')), 'soccer says equalized');

  // Through the tracker: a device tracking the pitcher and the team gets one alert with the line; the team alone gets its own.
  S.game = 'NL4';
  const tracker = new GameTracker('mlb', 'NL4', MIL, LAD);
  S.core = fresh(fx.bottom4);
  await tracker.poll();
  const skubal = feed('skubal-and-dodgers', 'NL4').find((i) => i.type === 'mlb.pitcher.home_run_allowed')!;
  assert.equal(skubal.title, 'Tarik Skubal gave up a 384-foot solo homer');
  assert.deepEqual(skubal.lines, ['Brewers tied the game.']);
  assert.equal(feed('dodgers', 'NL4').find((i) => i.type === 'team.opponent_scored')!.title, 'Brewers tied the Dodgers on Turang\'s 384-foot solo homer');
});

test('a postseason game\'s start says its round and game; a regular-season one does not', async () => {
  assert.equal(roundLabel('NLCS - Game 1'), 'NLCS Game 1');
  assert.equal(roundLabel('ALWC - Game 2'), 'AL Wild Card Series Game 2');
  assert.equal(roundLabel('East 1st Round - Game 4'), 'East 1st Round Game 4');
  assert.equal(roundLabel('Super Bowl LX'), 'Super Bowl LX');
  assert.equal(roundLabel('Rose Bowl Game presented by Prudential, the Granddaddy of Them All'), undefined, 'too long for a line');
  assert.equal(roundLabel(undefined), undefined);

  S.game = 'NL5'; S.season = 3; S.state = 'pre'; S.core = [];
  const tracker = new GameTracker('mlb', 'NL5', MIL, LAD, { sawPre: true, venue: fx.venue, tv: fx.broadcasts[0].names[0] });
  await tracker.poll(); // before first pitch
  S.state = 'in';
  await tracker.poll(); // the flip
  assert.deepEqual(feed('dodgers', 'NL5').map((i) => `${i.title} | ${i.body}`), ['Hate Watch Starting: Dodgers vs Brewers | NLCS Game 1 · First pitch at American Family Field · Fox']);
  assert.equal(feed('brewers', 'NL5')[0].title, 'Hate Watch Starting: Brewers vs Dodgers');

  S.game = 'NL6'; S.season = 2; S.state = 'pre';
  const regular = new GameTracker('mlb', 'NL6', MIL, LAD, { sawPre: true, venue: fx.venue, tv: 'Fox' });
  await regular.poll();
  S.state = 'in';
  await regular.poll();
  assert.equal(feed('dodgers', 'NL6')[0].body, 'First pitch at American Family Field · Fox', 'no round in the regular season');
  S.season = 3;
});

test('a series game that ends nothing says where the series stands for its loser, from the scoreboard or the summary', () => {
  // The scoreboard at the final: both sides at 0 wins, this the first game: the winner gets it.
  assert.deepEqual(seriesStanding(scoreboardFinal('x')), { loserId: LAD, line: 'Down 0-1 in the NLCS.' });
  // The summary two minutes later has it counted.
  const fromSummary = summaryEvent({ header: { id: 'x', season: { year: 2026, type: 3 }, gameNote: fx.gameNote, competitions: [{ status: { type: { completed: true } },
    competitors: [{ id: MIL, homeAway: 'home', score: '2' }, { id: LAD, homeAway: 'away', score: '1' }], series: fx.summarySeries }] } });
  assert.deepEqual(seriesStanding(fromSummary), { loserId: LAD, line: 'Down 0-1 in the NLCS.' });
  assert.equal(eliminationOf('mlb', scoreboardFinal('x')), null);
  // Level, and still ahead: ALDS Game 4 (wins 2-1 going in) lost by the side with 2; Game 3 (wins 2-0) lost by the side with 2; a wild card game.
  assert.deepEqual(seriesStanding(scoreboardFinal('y', { round: 'ALDS - Game 4', wins: { [MIL]: 1, [LAD]: 2 }, total: 5, home: 5, away: 3 })), { loserId: LAD, line: 'Series tied 2-2.' });
  assert.deepEqual(seriesStanding(scoreboardFinal('z', { round: 'ALDS - Game 3', wins: { [MIL]: 0, [LAD]: 2 }, total: 5, home: 5, away: 3 })), { loserId: LAD, line: 'Still up 2-1 in the ALDS.' });
  assert.deepEqual(seriesStanding(scoreboardFinal('w', { round: 'NLWC - Game 2', wins: { [MIL]: 1, [LAD]: 0 }, total: 3, home: 2, away: 5 })), { loserId: MIL, line: 'Series tied 1-1.' });
  // The game that ends the series is eliminationOf's; anything but a playoff series has no line.
  assert.equal(seriesStanding(scoreboardFinal('v', { round: 'ALDS - Game 3', wins: { [MIL]: 0, [LAD]: 2 }, total: 5, home: 2, away: 5 })), null, 'it was the clincher');
  assert.equal(seriesStanding({ ...scoreboardFinal('u'), season: { year: 2026, type: 2 } }), null);
  assert.equal(seriesStanding({ ...scoreboardFinal('t'), competitions: [{ ...scoreboardFinal('t').competitions[0], series: undefined }] }), null);

  // The loss says it, and so does "their team lost"; an elimination keeps its own line.
  const g = { league: 'mlb' as const, gameId: 'NL7', homeId: MIL, awayId: LAD };
  assert.equal(gameLostEvent(g, { home: 2, away: 1 }, 0, null, seriesStanding(scoreboardFinal('x')))!.body, 'Down 0-1 in the NLCS. Final Score: 2 to 1');
  assert.equal(gameLostEvent(g, { home: 2, away: 1 }, 0)!.body, 'Final Score: 2 to 1', 'no series, no line');
  assert.equal(gameLostEvent(g, { home: 1, away: 2 }, 0, null, seriesStanding(scoreboardFinal('x')))!.body, 'Final Score: 2 to 1', 'the winner has no line');

  // Through the tracker, from the scoreboard's read and from the fallback's summary.
  new GameTracker('mlb', 'NL8', MIL, LAD).finishFromScoreboard({ home: 2, away: 1 }, scoreboardFinal('NL8'));
  assert.equal(feed('dodgers', 'NL8').find((i) => i.type === 'team.lost')!.body, 'Down 0-1 in the NLCS. Final Score: 2 to 1');
  assert.equal(feed('ohtani', 'NL8').find((i) => i.type === 'player.team_lost')!.body, 'Down 0-1 in the NLCS. Final Score: 2 to 1', 'a player tracker\'s too');
  assert.equal(feed('brewers', 'NL8').length, 0, 'the winner hears nothing');
  new GameTracker('mlb', 'NL9', MIL, LAD).finish({ home: 2, away: 1 }, fromSummary);
  assert.equal(feed('dodgers', 'NL9').find((i) => i.type === 'team.lost')!.body, 'Down 0-1 in the NLCS. Final Score: 2 to 1');
  // The clincher keeps its elimination.
  new GameTracker('mlb', 'NL10', MIL, LAD).finish({ home: 2, away: 5 }, scoreboardFinal('NL10', { round: 'ALDS - Game 3', wins: { [MIL]: 0, [LAD]: 3 }, total: 5, home: 2, away: 5, done: true }));
  assert.equal(feed('brewers', 'NL10').find((i) => i.type === 'team.lost')!.body, 'Swept 3-0 by the Dodgers in the ALDS. Final Score: 5 to 2');
});

test('Recent misery has the real game\'s losses as the tracker words them, one row each, for the team and its players', () => {
  // The finals above went through a real tracker and publish(): the Dodgers' loss is a row, with the series line, once.
  const lad = miseryRows(`team:mlb:${LAD}`, Date.now() + 60_000).filter((r) => /^NL(8|9|10)?:/.test(r.id) || r.id.startsWith('NL'));
  const nl8 = lad.find((r) => r.id === `NL8:final:team.lost:${LAD}`)!;
  assert.equal(nl8.title, 'Dodgers lost to the Brewers', 'no "Successful Hate Watch!": that is for whoever tracks the team');
  assert.equal(nl8.body, 'Down 0-1 in the NLCS. Final Score: 2 to 1');
  assert.equal(nl8.source, 'tracker');
  assert.equal(lad.filter((r) => r.id === nl8.id).length, 1, 'one row, however many devices got it');
  // Ohtani's page: the Dodgers' loss, not a "their team lost" row of his own.
  const ohtani = miseryRows(`player:mlb:${OHTANI}`, Date.now() + 60_000);
  assert.ok(ohtani.some((r) => r.id === nl8.id));
  assert.ok(!ohtani.some((r) => r.target_key.startsWith('player:')), 'nothing stored per player');
  // The winner has no loss.
  assert.ok(!miseryRows(`team:mlb:${MIL}`, Date.now() + 60_000).some((r) => r.id.startsWith('NL8:')));
});

test("a preseason game's loss through a real tracker is marked, so its Recent misery row is never rated; the regular season's is not", () => {
  const sb = (id: string, type: number) => ({ ...scoreboardFinal(id), season: { year: 2026, type } });
  new GameTracker('mlb', 'NL11', MIL, LAD).finishFromScoreboard({ home: 2, away: 1 }, sb('NL11', 1));
  new GameTracker('mlb', 'NL12', MIL, LAD).finishFromScoreboard({ home: 2, away: 1 }, sb('NL12', 2));
  const meta = (id: string) => JSON.parse(miseryRows(`team:mlb:${LAD}`, Date.now() + 60_000).find((r) => r.id === `${id}:final:team.lost:${LAD}`)!.meta!);
  assert.equal(meta('NL11').preseason, true, 'recorded, and marked');
  assert.equal(meta('NL12').preseason, undefined);
  assert.equal(meta('NL12').margin, 1);
});
