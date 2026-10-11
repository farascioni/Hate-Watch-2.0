// White Sox at Guardians, ALDS Game 5 (October 10 2026, Guardians 2-0, the White Sox eliminated), the plays ESPN posted
// (test/fixtures: trimmed from a recording of the live feed) through a live game tracker, for what that night's alert
// review changed: the bases loaded against a team is an alert of its own; a half-inning's end is judged from its plays as
// they stand, so the order and state ESPN's feed is read in doesn't lose it; an error by "C. Montgomery" finds Colson;
// at the final the losing pitcher's loss, the last half-inning and the loss's facts are lines on the loss, and a
// player's "their team lost" says ELIMINATED; "no quality start" needs 2+ earned runs when he's pulled early; a lost
// ABS challenge survives a stale read; a slow scoreboard still eliminates; the recap's low point; a failed read is logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.HW_DB = ':memory:';
process.env.HW_ABS_SETTLE_MS = '100';
process.env.HW_HALF_END_WAIT_MS = '60000';
process.env.HW_DECISION_RETRY_MS = '1';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender, feedItem } = await import('../src/fanout.ts');
const { boxPitchers, eliminationOf, pitcherEvents, summaryEvent } = await import('../src/detectors.ts');
const { liveDeps, GameTracker } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');
const { hateWatchTally, RECIPIENTS } = await import('../src/hate-watches.ts');
const { recapFor } = await import('../src/recap.ts');

const fx = JSON.parse(readFileSync(new URL('./fixtures/alds-game5-401907994.json', import.meta.url), 'utf8'));
const GAME = '401907994', CLE = '5', CHW = '4';
const WILLIAMS = '4345076', BURKE = '4867679', MURAKAMI = '4872595', COLSON = '4872685', BRADEN = '4950345', BAZZANA = '5007707', PETERS = '5085893';

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run(`team:mlb:${CLE}`, CLE, 'Cleveland Guardians', 'Guardians', 'CLE');
team.run(`team:mlb:${CHW}`, CHW, 'Chicago White Sox', 'White Sox', 'CHW');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
const pitchers = new Set(fx.pitchers.map((p: any) => p.id));
for (const p of fx.roster) player.run(`player:mlb:${p.id}`, p.id, p.name, pitchers.has(p.id) ? 'P' : 'OF', `team:mlb:${p.teamId}`);
player.run(`player:mlb:${BRADEN}`, BRADEN, 'Braden Montgomery', 'RF', `team:mlb:${CHW}`); // on the White Sox roster, not in the game: why ESPN writes "C. Montgomery"
loadCatalog();

const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)');
const fan = (id: string, keys: string[], prefs: object = {}) => {
  device.run(id, 's', 'ios', `tok-${id}`, JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  keys.forEach((k, i) => follow.run(id, k, i));
};
fan('guardians', [`team:mlb:${CLE}`]);
fan('guardians-and-williams', [`team:mlb:${CLE}`, `player:mlb:${WILLIAMS}`], { types: { 'mlb.pitcher.walk': true } });
fan('white-sox', [`team:mlb:${CHW}`]);
fan('burke', [`player:mlb:${BURKE}`]);
fan('murakami', [`player:mlb:${MURAKAMI}`]);
fan('colson', [`player:mlb:${COLSON}`]);
fan('bazzana', [`player:mlb:${BAZZANA}`]);
fan('peters', [`player:mlb:${PETERS}`]);
const pushes: { to: string; title: string; body: string }[] = [];
setPushSender((m) => pushes.push(...m));
const pushed = (dev: string) => pushes.filter((p) => p.to === `tok-${dev}`);
const feed = (dev: string) => (db.prepare(`SELECT e.*, f.extra, f.pushed, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(dev) as any[])
  .map((r) => ({ ...feedItem(r), pushed: !!r.pushed }));
const got = (dev: string) => feed(dev).map((i) => `${i.title} | ${i.body}`);
const logs: string[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };

// The game as ESPN served it: core plays (`S.core`, as each read has them) and a summary with the series and the box.
const pitching = (final: boolean) => ({ boxscore: { players: [CHW, CLE].map((teamId) => ({ team: { id: teamId }, statistics: [{ type: 'pitching', labels: fx.pitchingLabels,
  athletes: fx.pitchers.filter((p: any) => p.teamId === teamId).map((p: any) => ({ athlete: { id: p.id }, starter: p.starter, active: p.active, stats: p.stats, notes: final ? p.notes : [] })) }] })) } });
const S = { core: [] as any[], failCore: false, decisions: false };
liveDeps.getJson = async (url: string) => {
  if (url.startsWith(urls.corePlays('mlb', GAME).split('?')[0])) { if (S.failCore) throw new Error('TimeoutError: The operation was aborted due to timeout'); return { items: S.core }; }
  if (url.startsWith(urls.summary('mlb', GAME))) {
    return { header: { id: GAME, season: { year: 2026, type: 3 }, gameNote: fx.gameNote, competitions: [{ status: { type: { state: 'in' } },
      competitors: [{ id: CLE, homeAway: 'home', score: '2' }, { id: CHW, homeAway: 'away', score: '0' }], series: [fx.series] }] }, plays: [], ...pitching(S.decisions) };
  }
  throw new Error(`unexpected fetch ${url}`);
};
const plays = (half: string) => fx.plays.filter((p: any) => p.id.slice(9, 11) === half);
const endOf = (half: string) => fx.endInnings.find((p: any) => p.id.slice(9, 11) === half);
const tracker = new GameTracker('mlb', GAME, CLE, CHW);
const poll = async (core: any[]) => { S.core = core.map((p) => ({ ...p, wallclock: new Date().toISOString() })); await tracker.poll(); };
// Bottom 2nd (03), Top 6th (10), Bottom 7th (13), Bottom 8th (15), Top 9th (16), each with its "End of the inning" play.
const through = (...halves: string[]) => halves.flatMap((h) => [...plays(h), ...(endOf(h) ? [endOf(h)] : [])]);

test('first read: the game is on, nothing to say yet', async () => {
  await poll([]);
  assert.deepEqual(got('guardians'), []);
});

test("an at-bat's result ESPN posts before its batter is on it waits for him; then the half-inning ends in order (Bottom 2nd)", async () => {
  const b2 = plays('03'), bazzana = b2.find((p: any) => p.id.endsWith('03990057'));
  const early = { ...bazzana, participants: bazzana.participants.filter((x: any) => x.type !== 'batter') };
  await poll([...b2.map((p: any) => (p === bazzana ? early : p)), endOf('03')]);
  assert.deepEqual(got('bazzana'), [], 'no batter on it yet: not judged');
  assert.deepEqual(got('guardians'), [], 'nor the half-inning: its third out is missing its batter');
  assert.ok(logs.some((l) => /result 4019079940303990057 posted without its batter: waiting/.test(l)));
  await poll(through('03'));
  assert.deepEqual(got('bazzana'), ['Travis Bazzana struck out swinging | Bazzana struck out swinging. — CHW 0, CLE 0']);
  assert.deepEqual(got('guardians'), ['Guardians went down in order | Bottom 2nd: Adell fouled out to first. Lowe grounded out to second. Bazzana struck out swinging. — CHW 0, CLE 0']);
});

test('the bases loaded against the Guardians: an alert of its own, pushed; tracking the pitcher too, his walk is a line on it (Top 6th)', async () => {
  const before = pushed('guardians').length;
  await poll([...through('03'), ...plays('10').filter((p: any) => p.id.slice(11, 13) < '06')]);
  const loaded = 'White Sox loaded the bases against the Guardians | Top 6th, 2 outs: Vargas walked, Teel to second, C. Montgomery to third. — CHW 0, CLE 2';
  assert.equal(got('guardians').at(-1), loaded, 'Vargas walked with two out');
  assert.equal(pushed('guardians').length, before + 1, 'pushed');
  assert.deepEqual(got('guardians-and-williams').slice(-1), ['White Sox loaded the bases against the Guardians | Gavin Williams issued a walk. Top 6th, 2 outs: Vargas walked, Teel to second, C. Montgomery to third. — CHW 0, CLE 2'],
    'one alert for the play, his walk a line on it');
  assert.ok(!got('guardians').some((x) => /scoring position|Bases loaded now/i.test(x)), 'no "runners in scoring position" (off by default), no silent line');
});

test('a starter pulled after 5.2 scoreless innings: no "no quality start"; Sean Burke, 2 earned in 5, still gets it', () => {
  const events = pitcherEvents({ league: 'mlb', gameId: 'QS', homeId: CLE, awayId: CHW, goalies: new Map() }, boxPitchers(pitching(false)), { final: false, score: { home: 2, away: 0 }, at: 0 }, new Set());
  assert.deepEqual(events.filter((e) => e.type === 'mlb.pitcher.no_quality_start').map((e) => e.title), ['No quality start for Sean Burke: pulled after 5 innings']);
});

test('an error by "C. Montgomery" (Braden is a White Sox too): Colson committed it (Bottom 7th)', async () => {
  await poll(through('03', '10', '13'));
  assert.deepEqual(got('colson').filter((x) => /error/.test(x)), ['Colson Montgomery committed an error | Bazzana safe at first on fielding error by shortstop C. Montgomery. — CHW 0, CLE 2']);
});

test('the bottom of the 8th: its "End of the inning" in a read ahead of its third out, then a stale read without it; still one "left the bases loaded"', async () => {
  const b8 = plays('15'), adell = b8.filter((p: any) => p.id.slice(11, 13) === '06'); // Adell's at-bat, the third out
  const n = got('guardians').length;
  await poll([...through('03', '10', '13'), ...b8.filter((p: any) => !adell.includes(p)), endOf('15')]);
  assert.equal(got('guardians').length, n, 'the end of the inning has come, its third out has not: wait');
  await poll(through('03', '10', '13')); // a stale copy, from before all of it
  assert.equal(got('guardians').length, n);
  await poll(through('03', '10', '13', '15'));
  assert.deepEqual(got('guardians').slice(n), ['Guardians left the bases loaded 🤦 | Bottom 8th: Adell grounded out to third. — CHW 0, CLE 2']);
  assert.ok(logs.some((l) => /Bottom8 over: mlb\.team\.stranded_risp \(as the plays stand: 4019079941506990057 pas=6 reached=true; as first seen: 4019079941505990057 pas=5/.test(l)),
    "the log says the plays as first seen would have judged it on DeLauter's out");
});

test("a lost ABS challenge isn't dropped as taken back when a stale read is missing its pitch (Peters, Top 9th)", async () => {
  const t9 = plays('16'), upTo = (id: string) => t9.filter((p: any) => p.id <= id);
  const lost = () => got('peters').filter((x) => /ABS challenge/.test(x));
  await poll([...through('03', '10', '13', '15'), ...upTo('4019079941603040092')]); // Peters' strike 2, challenged: "Strike Looking - Confirmed"
  await new Promise((r) => setTimeout(r, 150));
  const past = [...through('03', '10', '13', '15'), ...upTo('4019079941603050037')]; // the game has moved past it
  await poll(past.filter((p: any) => p.id !== '4019079941603040092')); // ...in a read that's missing it
  assert.deepEqual(lost(), [], 'missing from one read: not taken back yet, and not sent yet');
  await poll(past);
  assert.deepEqual(lost(), ['Tristan Peters lost an ABS challenge | Top 9th: challenged strike 2 looking, and the call stands — CHW 0, CLE 2']);
});

test('the final: the loss, its facts, the last half-inning and the losing pitcher, one alert each, ELIMINATED for players too', async () => {
  await poll(through('03', '10', '13', '15', '16'));
  S.decisions = true;
  const ev = { id: GAME, season: { year: 2026, type: 3 }, status: { type: { state: 'post', completed: true, detail: 'Final' } },
    competitions: [{ competitors: [{ id: CLE, homeAway: 'home', score: '2' }, { id: CHW, homeAway: 'away', score: '0' }], notes: [{ type: 'event', headline: 'ALDS - Game 5' }],
      series: { type: 'playoff', completed: true, totalCompetitions: 5, competitors: [{ id: CLE, wins: 3 }, { id: CHW, wins: 2 }] } }] };
  const before = { burke: pushed('burke').length, sox: pushed('white-sox').length };
  tracker.finish({ home: 2, away: 0 }, ev); // as the scoreboard's read does
  tracker.stop();
  await new Promise((r) => setTimeout(r, 50)); // the pitching decisions
  assert.equal(got('white-sox').at(-1), 'Successful Hate Watch! White Sox are ELIMINATED ⚰️ | Shut out. Struck out in order in the 9th. Lost the ALDS 3-2 to the Guardians. Final Score: 2 to 0');
  assert.ok(!got('white-sox').some((x) => x.startsWith('White Sox struck out in order')), 'the last half-inning is a line on it, not an alert beside it');
  assert.equal(pushed('white-sox').length - before.sox, 1);
  assert.equal(got('burke').at(-1), 'Successful Hate Watch! Sean Burke and the White Sox are ELIMINATED ⚰️ | Shut out. Struck out in order in the 9th. Sean Burke took the loss: 5.0 IP, 4 H, 2 ER, now 1-1. Lost the ALDS 3-2 to the Guardians. Final Score: 2 to 0');
  assert.equal(pushed('burke').length - before.burke, 1, '"took the loss" is a line, not a second push');
  assert.equal(got('murakami').at(-1), 'Successful Hate Watch! Munetaka Murakami and the White Sox are ELIMINATED ⚰️ | Shut out. Struck out in order in the 9th. Lost the ALDS 3-2 to the Guardians. Final Score: 2 to 0');
  for (const dev of ['white-sox', 'burke', 'murakami', 'colson', 'bazzana', 'peters']) assert.equal(hateWatchTally(dev).total, dev === 'bazzana' ? 0 : 1, dev);
  const losers = ['white-sox', 'burke', 'murakami', 'colson', 'peters'];
  for (const dev of losers) assert.equal(feed(dev).at(-1)!.alsoGot, losers.length - 1, `${dev}: everyone who got one of its alerts, the line copies not counted`);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM feed f JOIN events e ON e.id = f.event_id WHERE e.target_key LIKE 'player:%' AND e.type IN ('team.shut_out', 'mlb.team.down_in_order')`).get() as { n: number }).n, 0,
    "the facts' copies for player trackers are lines only, never a feed row");
});

test('with the scoreboard slow, the summary says it was the end of their season', () => {
  const summary = { header: { id: GAME, season: { year: 2026, type: 3 }, gameNote: fx.gameNote, competitions: [{ status: { type: { state: 'post', completed: true } },
    competitors: [{ id: CLE, homeAway: 'home', score: '2' }, { id: CHW, homeAway: 'away', score: '0' }], series: [{ type: 'season', competitors: [] }, fx.series] }] } };
  assert.deepEqual(eliminationOf('mlb', summaryEvent(summary)), { loserId: CHW, winnerId: CLE, sweep: false, line: 'Lost the ALDS 3-2 to the Guardians' });
});

test("the week's low point: an elimination over a bigger loss, and for a player's tracker too", () => {
  const monday = new Date(); // the Monday after, 9 am in New York (13:00 UTC with daylight time, 14:00 without: either is past 9)
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  monday.setUTCHours(14, 0, 0, 0);
  // The White Sox's other loss that week, by 10 runs.
  db.prepare(`INSERT INTO events (id, type, league, game_id, target_key, title, body, occurred_at, detected_at, meta) VALUES ('X:final:team.lost:4', 'team.lost', 'mlb', 'X', 'team:mlb:4', 'Successful Hate Watch! White Sox got BLOWN OUT by the Guardians', 'Final Score: 10 to 0', ?, ?, '{"margin":10}')`).run(Date.now(), Date.now());
  db.prepare(`INSERT INTO feed (device_id, event_id, occurred_at, pushed) VALUES ('white-sox', 'X:final:team.lost:4', ?, 1)`).run(Date.now());
  assert.match(recapFor('white-sox', monday.getTime())!.body, /Low point: White Sox are ELIMINATED ⚰️\.$/);
  assert.match(recapFor('murakami', monday.getTime())!.body, /Low point: Munetaka Murakami and the White Sox are ELIMINATED ⚰️\.$/);
});

test('a read that fails is logged, with its feed, even when the other one answers', async () => {
  const t = new GameTracker('mlb', GAME, CLE, CHW);
  S.failCore = true;
  await t.poll();
  S.failCore = false;
  console.log = realLog;
  assert.ok(logs.some((l) => /\[mlb 401907994\] plays read failed after \d+ ms: Error: TimeoutError/.test(l)), 'the plays feed failed, the summary answered');
});
