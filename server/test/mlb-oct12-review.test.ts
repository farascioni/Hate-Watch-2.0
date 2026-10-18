// The October 12 2026 MLB post game recording reports (NLCS Game 2, Dodgers at Brewers, and ALCS Game 1, Guardians at Rays): the
// plays ESPN posted in the half-innings they found problems in (test/fixtures/mlb-oct12-review.json: real, trimmed from the
// recordings, except where a scenario there says synthetic), read by a live game tracker as each read had them, for what the
// reports' approved findings changed. Each test names its finding.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.HW_DB = ':memory:';
process.env.HW_HALF_END_WAIT_MS = '300'; // a half-inning's end, a strike three's result: how long they wait
process.env.HW_ABS_SETTLE_MS = '300'; // a challenged strikeout, a lost challenge
process.env.HW_RULING_WAIT_MS = '300'; // "Official Scorer Ruling Pending"
process.env.HW_CHALLENGE_SETTLE_MS = '300'; // a challenge sentence added to a posted result: how long it must hold
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { liveDeps, GameTracker } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const fx = JSON.parse(readFileSync(new URL('./fixtures/mlb-oct12-review.json', import.meta.url), 'utf8'));
const BREWERS = '8', DODGERS = '19', GUARDIANS = '5', RAYS = '30';
const idOf = (n: string): string => fx.roster.find((p: any) => p.name === n).id;

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const t of fx.teams) team.run(`team:mlb:${t.id}`, t.id, t.name, t.short, t.abbrev);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const p of fx.roster) player.run(`player:mlb:${p.id}`, p.id, p.name, p.position, `team:mlb:${p.teamId}`);
loadCatalog();

// One device that tracks every team and player of both games with every alert type on and pushed.
const allOn = { ...DEFAULT_PREFS, types: Object.fromEntries(EVENT_TYPES.map((t: any) => [t.id, true])), pushTypes: Object.fromEntries(EVENT_TYPES.map((t: any) => [t.id, true])) };
db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('all', 's', 'ios', 'tok-all', JSON.stringify(allOn));
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)');
[...fx.teams.map((t: any) => `team:mlb:${t.id}`), ...fx.roster.map((p: any) => `player:mlb:${p.id}`)].forEach((k, i) => follow.run('all', k, i));
setPushSender(() => {});
const logs: string[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
after(() => { console.log = realLog; });

/** The alerts stored for a game: type, target, title and body; the lines folded onto the device's copy. */
const alerts = (game: string) => (db.prepare(`SELECT e.type, e.target_key AS target, e.title, e.body, e.id, f.extra FROM events e LEFT JOIN feed f ON f.event_id = e.id AND f.device_id = 'all' WHERE e.game_id = ? AND e.id NOT LIKE '%:changed:%' ORDER BY e.rowid`).all(game) as any[])
  .map((r) => ({ ...r, lines: r.extra ? (JSON.parse(r.extra) as string[]) : [] }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── A game as ESPN served it: the scenario's reads, one after another ───
let n = 0;
/** A scenario's tracker: `read(i)` is a poll of its i-th read of the plays. Play ids carry the scenario's own game id (so scenarios of one game don't collide). */
function scenario(key: string, home: string, away: string) {
  const sc = fx.scenarios[key];
  const game = String(900000000 + ++n);
  const S = { core: [] as any[] };
  // The earlier innings' scoring plays come first with old times (history: they only give the half the score it starts from).
  const expand = (i: number) => [...sc.before.map((k: number) => [k, true]), ...sc.reads[i].map((k: number) => [k, false])].map(([k, old]: [number, boolean]) => {
    const p = fx.pool[k];
    return { id: p.id.length >= 19 ? game + p.id.slice(9) : p.id, text: p.text, awayScore: p.a, homeScore: p.h, scoringPlay: p.s, scoreValue: p.v, outs: p.o, wallclock: new Date(Date.now() - (old ? 3_600_000 : 0)).toISOString(),
      type: { id: p.ty[0], text: p.ty[1], type: p.ty[2] }, period: { type: p.pd[0], number: p.pd[1] }, ...(p.tm ? { team: { $ref: `http://x/teams/${p.tm}?lang=en` } } : {}),
      participants: p.pt.map(([id, type]: [string, string]) => ({ athlete: { $ref: `http://x/athletes/${id}?lang=en` }, type })) };
  });
  const tracker = new GameTracker('mlb', game, home, away, { sawPre: false });
  return {
    game, tracker, sc,
    /** Poll once with the i-th read of the plays. */
    async read(i: number) {
      S.core = expand(i);
      liveDeps.getJson = async (url: string) => {
        if (url.startsWith(urls.corePlays('mlb', game).split('?')[0])) return { items: S.core };
        if (url.startsWith(urls.summary('mlb', game))) return { header: { id: game, season: { year: 2026, type: 3 }, competitions: [{ status: { type: { state: 'in' } }, competitors: [{ id: home, homeAway: 'home', score: '0' }, { id: away, homeAway: 'away', score: '0' }] }] }, plays: [], boxscore: { players: [] } };
        throw new Error(`unexpected fetch ${url}`);
      };
      await tracker.poll();
    },
  };
}

// ─── NLCS Game 2 F2: a pickoff error is not a pickoff ───
test('NLCS G2 F2: "pickoff error by pitcher Henderson, Betts picked off second" is not a runner out', async () => {
  const s = scenario('pickoff-error', BREWERS, DODGERS);
  await s.read(0);
  const got = alerts(s.game);
  assert.equal(got.filter((a) => a.type === 'mlb.runner.caught_stealing').length, 0, 'Betts was safe: no "got picked off second"');
  assert.ok(got.some((a) => a.type === 'mlb.team.stranded_risp' && a.title === 'Dodgers stranded a runner on second'), 'the inning still ends with Betts on second');
});

// ─── NLCS Game 2 F4: ESPN's doubled runner play makes one pitcher alert ───
test('NLCS G2 F4: the Pick Off and the Play Result of one pickoff error make one run alert and one error alert for the pitcher', async () => {
  const s = scenario('pickoff-error', BREWERS, DODGERS);
  await s.read(0);
  const got = alerts(s.game);
  const henderson = idOf('Logan Henderson');
  assert.equal(got.filter((a) => a.type === 'mlb.pitcher.runs_allowed' && a.target === `player:mlb:${henderson}`).length, 1, '"gave up 1 run" once');
  assert.equal(got.filter((a) => a.type === 'mlb.fielder.error' && a.target === `player:mlb:${henderson}`).length, 1, '"committed an error" once');
});

test('NLCS G2 F4: Stewart\'s pickoff error in the 6th is one alert, not two', async () => {
  const s = scenario('error-moved', BREWERS, DODGERS);
  await s.read(0);
  const stewart = idOf('Brock Stewart');
  assert.equal(alerts(s.game).filter((a) => a.type === 'mlb.fielder.error' && a.target === `player:mlb:${stewart}`).length, 1);
});

// ─── NLCS Game 2 F1: a strikeout on a challenged last pitch waits for the review ───
test('NLCS G2 F1: "Betts struck out looking" on a challenged pitch ESPN turns into a walk is never sent', async () => {
  const s = scenario('challenged-strikeout', BREWERS, DODGERS);
  const betts = idOf('Mookie Betts'), henderson = idOf('Logan Henderson');
  await s.read(0); // pitch 5 reads "Strike Looking - Confirmed", the result "struck out looking … challenged: … upheld"
  assert.equal(alerts(s.game).filter((a) => a.type.startsWith('mlb.batter.')).length, 0, 'held for the review: nothing yet');
  await sleep(150);
  await s.read(0);
  assert.equal(alerts(s.game).filter((a) => a.type.startsWith('mlb.batter.')).length, 0, 'still held inside the wait');
  await s.read(1); // ESPN overturned the pitch (ball 3, then ball 4): the same result reads "Betts walked."
  const got = alerts(s.game);
  assert.equal(got.filter((a) => a.target === `player:mlb:${betts}` && /struck out/.test(a.title)).length, 0, 'no strikeout for a walk');
  assert.ok(got.some((a) => a.type === 'mlb.pitcher.walk' && a.target === `player:mlb:${henderson}`), 'the walk is judged as it settled');
  assert.equal((s.tracker as any).ctx.ks?.[betts] ?? 0, 0, 'and it is not in Betts\' strikeout count (a later hat trick cannot use it)');
});

test('NLCS G2 F1: a challenged strikeout that stands is sent when the wait is over', async () => {
  const s = scenario('challenged-strikeout', BREWERS, DODGERS);
  const betts = idOf('Mookie Betts');
  await s.read(0);
  assert.equal(alerts(s.game).filter((a) => /struck out/.test(a.title)).length, 0);
  await sleep(500); // 1.5 times HW_ABS_SETTLE_MS (300): the result carries the challenge sentence
  await s.read(0);
  assert.deepEqual(alerts(s.game).filter((a) => /struck out/.test(a.title)).map((a) => [a.target, a.title]), [[`player:mlb:${betts}`, 'Mookie Betts struck out looking 👀']]);
});

// ─── NLCS Game 2 F7: "Official Scorer Ruling Pending" ───
test('NLCS G2 F7: a result the official scorer has not ruled on is judged when the ruling comes', async () => {
  const s = scenario('ruling-pending', BREWERS, DODGERS);
  await s.read(0);
  assert.equal(alerts(s.game).filter((a) => a.type === 'mlb.team.opponent_risp').length, 0, 'waiting for the ruling');
  await s.read(1);
  const risp = alerts(s.game).filter((a) => a.type === 'mlb.team.opponent_risp');
  assert.equal(risp.length, 1);
  assert.match(risp[0].body, /Top 3rd: Betts singled to left, Edman to second\./, 'the ruled text, not the placeholder');
});

test('NLCS G2 F7: with no ruling after the wait the alert goes out without the placeholder', async () => {
  const s = scenario('ruling-pending', BREWERS, DODGERS);
  await s.read(0);
  await sleep(350); // HW_RULING_WAIT_MS
  await s.read(0);
  const risp = alerts(s.game).filter((a) => a.type === 'mlb.team.opponent_risp');
  assert.equal(risp.length, 1);
  assert.doesNotMatch(risp[0].body, /Official Scorer/);
  assert.match(risp[0].body, /Top 3rd: Edman to second\./);
});

// ─── NLCS Game 2 F5: a home run's distance ESPN changes ───
test('NLCS G2 F5: a homer posted at 388 feet and rewritten to 436 gets the new distance as a line, not a second alert', async () => {
  const s = scenario('homer-distance', BREWERS, DODGERS);
  await s.read(0);
  const before = alerts(s.game).filter((a) => /388-foot/.test(a.title) || /388 feet/.test(a.body));
  assert.ok(before.some((a) => a.type === 'mlb.pitcher.home_run_allowed'), 'the pitcher\'s alert says 388');
  assert.ok(before.some((a) => a.type === 'team.opponent_scored'), 'and so does the team\'s');
  const homer = () => alerts(s.game).filter((a) => /Contreras homered/.test(a.body));
  const count = homer().length;
  await s.read(1);
  assert.equal(homer().length, count, 'nothing new is sent for the homer');
  assert.ok(alerts(s.game).some((a) => a.lines.includes('ESPN corrected the distance: 436 feet.')), 'the device\'s copy has the new distance as a line');
});

// ─── NLCS Game 2 F6: an error ESPN moves to another fielder ───
test('NLCS G2 F6: an error moved from the pitcher to the first baseman: a line on the first alert, an alert for the new fielder', async () => {
  const s = scenario('error-moved', BREWERS, DODGERS);
  const stewart = idOf('Brock Stewart'), freeman = idOf('Freddie Freeman');
  await s.read(0);
  const fielders = () => alerts(s.game).filter((a) => a.type === 'mlb.fielder.error' && a.target.startsWith('player:'));
  assert.equal(fielders().length, 1);
  const teamErrors = () => alerts(s.game).filter((a) => a.type === 'mlb.fielder.error' && a.target.startsWith('team:'));
  assert.equal(teamErrors().length, 1, 'the fielding team gets its own error alert (what a favorite of the other side is sent)');
  await s.read(1);
  const errors = fielders();
  assert.equal(errors.length, 2);
  const second = errors.find((a) => a.target === `player:mlb:${freeman}`)!;
  assert.ok(errors.some((a) => a.target === `player:mlb:${stewart}`));
  assert.ok(alerts(s.game).some((a) => a.lines.includes('ESPN moved this error to Freddie Freeman.')), 'a line on the alert that named Stewart');
  assert.equal(second.title, 'Freddie Freeman committed an error');
  assert.match(second.body, /pickoff error by first baseman Freeman/);
  await s.read(1);
  assert.equal(fielders().length, 2, 'a re-poll sends nothing');
});

// ─── NLCS Game 2 F3, with ALCS Game 1 F6: a challenge sentence ESPN adds to a posted result ───
test('NLCS G2 F3: a lost replay challenge ESPN writes into a posted result goes out once the sentence has held and the game has moved on', async () => {
  const s = scenario('challenge-added', BREWERS, DODGERS);
  const lost = () => alerts(s.game).filter((a) => a.type === 'mlb.challenge_lost' && a.target === `team:mlb:${BREWERS}` && /replay challenge/.test(a.title));
  await s.read(0);
  await s.read(1); // "Milwaukee Brewers challenged: call on the field was upheld." has been added
  assert.equal(lost().length, 0, 'not yet believed');
  await sleep(350); // HW_CHALLENGE_SETTLE_MS
  await s.read(1);
  assert.equal(lost().length, 0, 'held, but the game has not moved on to the next at-bat');
  await s.read(2); // Hernandez is up
  assert.equal(lost().length, 1);
  assert.equal(lost()[0].title, 'Brewers lost a replay challenge');
  assert.match(lost()[0].body, /Freeman hit sacrifice fly to left, Edman scored\. Milwaukee Brewers challenged: call on the field was upheld\./);
  await s.read(2);
  assert.equal(lost().length, 1, 'once');
});

test('NLCS G2 F3: a held sentence is believed alone after three times the wait, when the next at-bat is slow', async () => {
  const s = scenario('challenge-added', BREWERS, DODGERS);
  await s.read(0);
  await s.read(1);
  await sleep(950); // 3 x HW_CHALLENGE_SETTLE_MS
  await s.read(1);
  assert.equal(alerts(s.game).filter((a) => a.type === 'mlb.challenge_lost' && a.target === `team:mlb:${BREWERS}` && /replay challenge/.test(a.title)).length, 1);
});

// ─── ALCS Game 1: Ramírez's play in the top of the 9th, a third out a replay review overturned ───
// Reads: 0 the third out with an End Inning play; 1 "challenged … upheld" added; 2 that sentence gone; 3 back; 4 a run, outs back to 2,
// the End Inning play taken out; 5 Lowe's fly-out ends the inning (no End Inning play yet); 6 the End Inning play back under its old id.
const stranded = (game: string) => alerts(game).filter((a) => a.type === 'mlb.team.stranded_risp' && a.target === `team:mlb:${GUARDIANS}`);

test('ALCS G1 F2: a result that becomes a scoring play after it was posted makes the pitcher\'s run alert too', async () => {
  const s = scenario('overturned-third-out', RAYS, GUARDIANS);
  const sulser = idOf('Cole Sulser');
  for (const i of [0, 1, 2, 3]) await s.read(i);
  const runs = () => alerts(s.game).filter((a) => a.type === 'mlb.pitcher.runs_allowed' && a.target === `player:mlb:${sulser}`);
  assert.equal(runs().length, 0, 'an out so far');
  await s.read(4);
  assert.deepEqual(runs().map((a) => a.title), ['Cole Sulser gave up 1 run'], 'the review gave the run back');
  await s.read(4);
  assert.equal(runs().length, 1, 'once');
  assert.equal(alerts(s.game).filter((a) => a.type === 'team.opponent_scored' && /Ramírez's RBI single/.test(a.title)).length, 1, 'the team\'s came from the score, as before');
});

test('ALCS G1 F6: ESPN\'s "upheld" on a challenge the Guardians won is never a lost challenge, however long it shows', async () => {
  const s = scenario('overturned-third-out', RAYS, GUARDIANS);
  await s.read(0);
  await s.read(1); // "upheld"
  await sleep(150);
  await s.read(2); // gone: the wait starts over
  await sleep(150);
  await s.read(3); // "upheld" again
  await sleep(150);
  await s.read(4); // "overturned": the Guardians won it
  await sleep(1000); // longer than three times the wait
  await s.read(4);
  assert.equal(alerts(s.game).filter((a) => a.type === 'mlb.challenge_lost').length, 0, 'no lost challenge for anyone');
});

test('ALCS G1 F1: a third out a review overturned: the early "stranded" alert gets a line, and the real end of the inning is judged', async () => {
  const s = scenario('overturned-third-out', RAYS, GUARDIANS);
  await s.read(0);
  assert.equal(stranded(s.game).length, 1, 'judged on the third out as ESPN had it');
  assert.equal(stranded(s.game)[0].title, 'Guardians stranded a runner on second');
  assert.deepEqual(stranded(s.game)[0].lines, []);
  await s.read(4); // the run, outs back to 2, the End Inning play taken out
  assert.deepEqual(stranded(s.game)[0].lines, [], 'one read without it could be a stale copy');
  await s.read(4);
  assert.deepEqual(stranded(s.game)[0].lines, ['A replay review overturned the third out; the inning went on.']);
  await s.read(5); // Lowe flies out: the third out again, and no End Inning play yet
  assert.equal(stranded(s.game).length, 1);
  await s.read(6); // the End Inning play is back under its old id
  assert.equal(stranded(s.game).length, 2, 'the real end is judged');
  assert.equal(stranded(s.game)[1].body.split(' — ')[0], 'Top 9th: Lowe flied out to left.');
  assert.equal(stranded(s.game)[1].title, 'Guardians stranded a runner on second');
  await s.read(6);
  assert.equal(stranded(s.game).length, 2, 'once');
});

// ─── ALCS Game 1 F4: a strikeout ESPN never posts a result for ───
test('ALCS G1 F4: a third strike that ended the 8th, with no result from ESPN, is made into the strikeout after the wait', async () => {
  const s = scenario('strike-three-no-result', RAYS, GUARDIANS);
  const bailey = idOf('Patrick Bailey');
  const ks = () => alerts(s.game).filter((a) => a.type === 'mlb.batter.strikeout' && a.target === `player:mlb:${bailey}`);
  await s.read(0); // the overturned strike three and the End Inning play: no result
  assert.equal(ks().length, 0, 'not yet');
  await sleep(350); // HW_HALF_END_WAIT_MS
  await s.read(0);
  assert.deepEqual(ks().map((a) => [a.title, a.body.split(' — ')[0]]), [['Patrick Bailey struck out looking 👀', 'Bailey struck out looking.']]);
  assert.equal((s.tracker as any).ctx.ks?.[bailey], 1, 'and it counts');
  assert.ok((s.tracker as any).plays.some((p: any) => p.text === 'Bailey struck out looking.' && p.id.endsWith('990057')), 'it is one of the plays the final and the half-inning read');
  await s.read(0);
  await s.read(1);
  assert.equal(ks().length, 1, 'once');
});

// ─── ALCS Game 1 F3: runs are the pitcher's whose runner scores ───
const runAlerts = (game: string) => alerts(game).filter((a) => a.type === 'mlb.pitcher.runs_allowed').map((a) => a.title);

test('ALCS G1 F3: Lowe\'s single scores Ramírez and DeLauter, who reached against Wells: "Tyler Wells gave up 2 runs", nothing for Seymour', async () => {
  const s = scenario('inherited-top8', RAYS, GUARDIANS);
  await s.read(0);
  assert.deepEqual(runAlerts(s.game), ['Tyler Wells gave up 2 runs']);
});

test('ALCS G1 F3: in the 9th the runs of Sulser\'s runners are Sulser\'s, the one Kelly gave up none', async () => {
  const s = scenario('inherited-top9', RAYS, GUARDIANS);
  await s.read(0);
  assert.deepEqual(runAlerts(s.game), ['Cole Sulser gave up 1 run', 'Cole Sulser gave up 2 runs'], 'Martínez\'s run, then Ramírez\'s and DeLauter\'s on Adell\'s double: 3 in all, as the box score has');
});

test('ALCS G1 F1: a 1-2-3 inning whose third out is overturned: the early "went down in order" gets the line, and the real end tells it no second time', async () => {
  const s = scenario('dio-overturned', RAYS, GUARDIANS);
  const dio = () => alerts(s.game).filter((a) => a.type === 'mlb.team.down_in_order');
  await s.read(0);
  assert.equal(dio().length, 1, 'three up, three down as ESPN had it');
  const lines = () => alerts(s.game).flatMap((a) => a.lines);
  assert.ok(lines().includes('Guardians went down in order.'), 'it is a line on the last out\'s alert for this device');
  await s.read(1);
  assert.ok(!lines().some((l) => /took back the third out/.test(l)), 'one read without the End Inning play could be a stale copy');
  await s.read(1); // the End Inning play is gone and a runner is on
  assert.ok(lines().includes('ESPN took back the third out; the inning went on.'), 'no play of the half mentions a review');
  await s.read(2); // the real third out, the End Inning play back
  assert.equal(dio().length, 1, 'not 1-2-3 any more: no second alert');
});

// ─── ALCS Game 1 F3: whose runner, with a pinch runner ───
test('ALCS G1 F3: a pinch runner scores the run of the pitcher his teammate reached against', async () => {
  const { PLAYER_DETECTORS, observePlay } = await import('../src/detectors.ts');
  const g: any = { league: 'mlb', gameId: 'PINCH', homeId: RAYS, awayId: GUARDIANS, goalies: new Map() };
  const wells = idOf('Tyler Wells'), seymour = idOf('Ian Seymour'), ramirez = idOf('Jose Ramirez'), adell = idOf('Jo Adell'), delauter = idOf('Chase DeLauter');
  const play = (o: any) => ({ id: 'x', type: '', typeSlug: 'play-result', text: '', participants: [], scoring: false, scoreValue: 0, home: 0, away: 0, at: Date.now(), shooting: false, teamId: GUARDIANS, period: { type: 'Top', number: 8 }, ...o });
  const who = (pitcher: string, batter: string, ...on: [string, string][]) => [{ id: pitcher, role: 'pitcher' }, { id: batter, role: 'batter' }, ...on.map(([role, id]) => ({ id, role }))];
  const run = (p: any) => { const es = PLAYER_DETECTORS.mlb(g, p); observePlay(g, p); return es; };
  run(play({ id: '1', text: 'Ramírez singled to left.', participants: who(wells, ramirez, ['onFirst', ramirez]) })); // reached against Wells
  run(play({ id: '2', typeSlug: 'ball', text: 'Pitch 1 : Ball 1', participants: who(seymour, delauter, ['onFirst', ramirez]) }));
  run(play({ id: '3', typeSlug: 'ball', text: 'Pitch 2 : Ball 2', participants: who(seymour, delauter, ['onFirst', adell]) })); // Adell runs for Ramírez, against Seymour
  const es = run(play({ id: '4', text: 'DeLauter doubled to left, Adell scored.', scoring: true, scoreValue: 1, home: 0, away: 1, participants: who(seymour, delauter, ['onSecond', delauter]) }));
  assert.deepEqual(es.filter((e) => e.type === 'mlb.pitcher.runs_allowed').map((e) => e.title), ['Tyler Wells gave up 1 run'], 'the run is Wells\'s, not Seymour\'s');
});

test('ALCS G1 F1: a stale read that drops the End Inning play and the last result with it is not a taken-back third out', async () => {
  const sc = fx.scenarios['overturned-third-out'];
  fx.scenarios['stale-copy'] = { ...sc, reads: [sc.reads[0], sc.reads[0].slice(0, -3), sc.reads[0]] }; // the Ramírez result, End Batter/Pitcher and End Inning play missing
  const s = scenario('stale-copy', RAYS, GUARDIANS);
  await s.read(0);
  await s.read(1);
  await s.read(1);
  await s.read(1);
  await s.read(2);
  assert.equal(stranded(s.game).length, 1, 'still the one alert');
  assert.deepEqual(stranded(s.game)[0].lines, [], 'and no line saying the out was taken back');
  assert.ok(!alerts(s.game).some((a) => a.lines.some((l: string) => /took back|overturned the third out/.test(l))));
});

// ─── ALCS Game 1 F3: a homer with an inherited runner ───
test('ALCS G1 F3: DeLauter\'s 2-run homer off Seymour with Ramírez on, who reached against Wells: the homer is Seymour\'s, Ramírez\'s run is Wells\'s', async () => {
  const { PLAYER_DETECTORS, observePlay } = await import('../src/detectors.ts');
  const g: any = { league: 'mlb', gameId: 'HOMER', homeId: RAYS, awayId: GUARDIANS, goalies: new Map() };
  const wells = idOf('Tyler Wells'), seymour = idOf('Ian Seymour'), ramirez = idOf('Jose Ramirez'), delauter = idOf('Chase DeLauter');
  const play = (o: any) => ({ id: 'x', type: '', typeSlug: 'play-result', text: '', participants: [], scoring: false, scoreValue: 0, home: 0, away: 0, at: Date.now(), shooting: false, teamId: GUARDIANS, period: { type: 'Top', number: 8 }, ...o });
  const who = (pitcher: string, batter: string, ...on: [string, string][]) => [{ id: pitcher, role: 'pitcher' }, { id: batter, role: 'batter' }, ...on.map(([role, id]) => ({ id, role }))];
  const run = (p: any) => { const es = PLAYER_DETECTORS.mlb(g, p); observePlay(g, p); return es; };
  run(play({ id: '1', text: 'Ramírez singled to left.', participants: who(wells, ramirez, ['onFirst', ramirez]) }));
  run(play({ id: '2', typeSlug: 'ball', text: 'Pitch 1 : Ball 1', participants: who(seymour, delauter, ['onFirst', ramirez]) }));
  const es = run(play({ id: '3', text: 'DeLauter homered to left (400 feet).', scoring: true, scoreValue: 2, home: 0, away: 2, participants: who(seymour, delauter) }));
  assert.deepEqual(es.filter((e) => e.type === 'mlb.pitcher.home_run_allowed').map((e) => [e.targetKey, e.title]), [[`player:mlb:${seymour}`, 'Ian Seymour gave up a 400-foot 2-run homer']]);
  assert.deepEqual(es.filter((e) => e.type === 'mlb.pitcher.runs_allowed').map((e) => [e.targetKey, e.title]), [[`player:mlb:${wells}`, 'Tyler Wells gave up 1 run']]);
});

// ─── A result that is settling holds the plays after it ───
test('NLCS G2 F1/F7: a result waiting for its ruling holds the plays after it in the same read, and they follow it in order', async () => {
  const sc = fx.scenarios['pickoff-error'];
  const betts = sc.reads[0].find((k: number) => fx.pool[k].text.startsWith('Betts singled to left, Edman to second.'));
  const pending = { ...fx.pool[betts], text: 'Official Scorer Ruling Pending. Edman to second.' };
  fx.pool.push(pending);
  fx.scenarios['blocked'] = { ...sc, reads: [sc.reads[0].map((k: number) => (k === betts ? fx.pool.length - 1 : k))] };
  const s = scenario('blocked', BREWERS, DODGERS);
  await s.read(0); // Freeman's fly-out, the pickoff error and the rest follow Betts' single in this read
  const early = alerts(s.game).map((a) => a.title);
  assert.ok(!early.some((t) => /runners on first and second|Freddie Freeman flied out|stranded/.test(t)), 'nothing from the single or after it is judged yet');
  await sleep(350);
  await s.read(0);
  const types = alerts(s.game).map((a) => `${a.type}:${a.title}`);
  const single = types.findIndex((t) => t.startsWith('mlb.team.opponent_risp:Dodgers have runners on first and second'));
  const flyOut = types.findIndex((t) => t.startsWith('mlb.batter.popout:Freddie Freeman flied out'));
  assert.ok(single >= 0 && flyOut > single, 'Betts\' single first, then Freeman\'s out');
  // At the final nothing waits
  assert.equal((s.tracker as any).settling({ id: 'z', text: 'Official Scorer Ruling Pending.', typeSlug: 'play-result', participants: [] }, Date.now(), true), false);
  assert.equal((s.tracker as any).settling({ id: 'y', text: 'Official Scorer Ruling Pending.', typeSlug: 'play-result', participants: [] }, Date.now(), false), true);
});
