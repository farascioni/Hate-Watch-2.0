// Bills at Rams, Monday Night Football (October 12 2026, ESPN 401872994, Bills 37-34 in overtime), through a real
// GameTracker with the plays and wording of the recording, for the two fixes the game's post game recording report
// (F1, F2) found:
//  F1  a score that levels the game says so: the Rams' touchdown at 34-33 with 5 seconds left, 34-34 once ESPN added the
//      extra point 24 seconds later, left the Bills' trackers with "Rams scored 6 on the Bills" and no word of the tie.
//      Now "Rams tied the game, 34-34." is a line on that alert (no push), whether the touchdown or its kick levels it.
//  F2  a sack in a failed two-point try ("… TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. M.Stafford is sacked. ATTEMPT FAILS.")
//      isn't a down (the box score counts no sack): "Matthew Stafford got sacked on the two-point try".
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES (?, 'nfl', ?, ?, ?, ?, ?, 'x', 500, 500, 0)`);
for (const [id, name, short, abbr, location] of [['2', 'Buffalo Bills', 'Bills', 'BUF', 'Buffalo'], ['14', 'Los Angeles Rams', 'Rams', 'LAR', 'Los Angeles']]) team.run(`team:nfl:${id}`, id, name, short, abbr, location);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, position, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'nfl', ?, ?, ?, 'QB', 'x', 1, 1, 'headshot', 0)`);
player.run('player:nfl:12483', '12483', 'Matthew Stafford', 'team:nfl:14');
player.run('player:nfl:3918298', '3918298', 'Josh Allen', 'team:nfl:2');
player.run('player:nfl:4573699', '4573699', 'Jackson Hawes', 'team:nfl:2');
player.run('player:nfl:4033748', '4033748', 'Connor McGovern', 'team:nfl:2');
loadCatalog();
const pushes: string[] = [], pushedTo: string[] = []; // titles; and "token|title", for what one device was sent
setPushSender((m) => { pushes.push(...m.map((x: any) => x.title)); pushedTo.push(...m.map((x: any) => `${x.to}|${x.title}`)); });
const deviceWith = (id: string, prefs: object, ...follows: string[]) => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', `tok-${id}`, JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  for (const f of follows) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(id, f);
};
const device = (id: string, ...follows: string[]) => deviceWith(id, {}, ...follows);

const ref = (kind: string, id: string) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/${kind}/${id}` });
const HOME = '14', AWAY = '2'; // the Rams at home, the Bills away
let n = 0;
/** One ESPN core play: its running score is what the tracker counts. */
const play = (id: string, type: string, text: string, o: { away: number; home: number; team: string; scoring?: boolean; who?: [string, string][]; ago?: number }) => ({
  id, type: { text: type }, text, team: ref('teams', o.team), start: { team: ref('teams', o.team) }, end: { team: ref('teams', o.team) },
  participants: (o.who ?? []).map(([athlete, role]) => ({ athlete: ref('athletes', athlete), type: role })), awayScore: o.away, homeScore: o.home,
  period: { number: 4 }, clock: { value: 5 + n++, displayValue: '0:05' }, scoringPlay: !!o.scoring, wallclock: new Date(Date.now() - (o.ago ?? 0)).toISOString(),
});
/** A game's feeds: the plays and the header's score, both changed by the test between polls. */
function game(gameId: string) {
  const g = { core: [] as any[], away: 0, home: 0 };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.summary('nfl', gameId))) return {
      header: { competitions: [{ status: { period: 4, displayClock: '0:05', type: { state: 'in', completed: false, detail: '0:05 - 4th' } },
        competitors: [{ homeAway: 'home', id: HOME, score: String(g.home) }, { homeAway: 'away', id: AWAY, score: String(g.away) }] }] }, drives: { previous: [], current: null } };
    if (url.startsWith(urls.corePlays('nfl', gameId))) return { items: g.core };
    throw new Error(`unexpected fetch ${url}`);
  };
  return g;
}
const rows = (deviceId: string, type: string) => (db.prepare(`SELECT e.title, e.body, f.extra, f.pushed FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.type = ? ORDER BY f.rowid`).all(deviceId, type) as any[])
  .map((r) => ({ title: r.title, body: r.body, lines: r.extra ? JSON.parse(r.extra) : [], pushed: !!r.pushed }));

test('F1: the Rams\' touchdown that the extra point makes 34-34 gets "Rams tied the game, 34-34." as a line on the Bills\' alert, without a push or a second alert', async () => {
  device('bills-td', 'team:nfl:2');
  const g = game('401872994'), history = play('4018729944300', 'Passing Touchdown', 'M.Stafford pass short middle to D.Adams for 5 yards, TOUCHDOWN.', { away: 34, home: 27, team: HOME, scoring: true, ago: 10 * 60_000 });
  g.core = [history]; g.away = 34; g.home = 27;
  const tracker = new GameTracker('nfl', '401872994', HOME, AWAY);
  await tracker.poll();
  const touchdown = (text: string, home: number) => play('4018729944392', 'Rushing Touchdown', text, { away: 34, home, team: HOME, scoring: true });
  g.core = [history, touchdown('(No Huddle, Shotgun) K.Williams up the middle for 1 yard, TOUCHDOWN.', 33)]; g.home = 33;
  await tracker.poll();
  const sent = pushes.length;
  assert.deepEqual(rows('bills-td', 'team.opponent_scored').map((r) => [r.title, r.body, r.lines]),
    [['Rams scored 6 on the Bills', '(No Huddle, Shotgun) K.Williams up the middle for 1 yard, TOUCHDOWN. — BUF 34, LAR 33', []]], 'at 34-33 nothing says tied');
  // 24 seconds later ESPN adds the kick to the same play: 34-34.
  g.core = [history, touchdown('(No Huddle, Shotgun) K.Williams up the middle for 1 yard, TOUCHDOWN. H.Mevis extra point is GOOD, Center-J.Cardona, Holder-E.Evans.', 34)]; g.home = 34;
  await tracker.poll();
  const after = rows('bills-td', 'team.opponent_scored');
  assert.equal(after.length, 1, 'one alert, not two');
  assert.deepEqual(after[0].lines, ['Rams tied the game, 34-34.']);
  assert.equal(after[0].pushed, false);
  assert.equal(pushes.length, sent, 'the line is never a push');
  await tracker.poll(); // a re-read adds nothing
  assert.deepEqual(rows('bills-td', 'team.opponent_scored')[0].lines, ['Rams tied the game, 34-34.']);
  tracker.stop();
});

test('F1: a touchdown whose kick doesn\'t level the score gets no tying line, and the Rams\' own trackers are told nothing', async () => {
  device('bills-lead', 'team:nfl:2');
  device('rams-lead', 'team:nfl:14');
  const g = game('401872995'), history = play('4018729950100', 'Rushing Touchdown', 'J.Cook up the middle for 5 yards, TOUCHDOWN.', { away: 20, home: 7, team: AWAY, scoring: true, ago: 10 * 60_000 });
  g.core = [history]; g.away = 20; g.home = 7;
  const tracker = new GameTracker('nfl', '401872995', HOME, AWAY);
  await tracker.poll();
  const td = (text: string, home: number) => play('4018729950200', 'Passing Touchdown', text, { away: 20, home, team: HOME, scoring: true });
  g.core = [history, td('M.Stafford pass short left to P.Nacua for 12 yards, TOUCHDOWN.', 13)]; g.home = 13;
  await tracker.poll();
  g.core = [history, td('M.Stafford pass short left to P.Nacua for 12 yards, TOUCHDOWN. H.Mevis extra point is GOOD.', 14)]; g.home = 14;
  await tracker.poll();
  assert.deepEqual(rows('bills-lead', 'team.opponent_scored').map((r) => r.lines), [[]], '20-14 is not level');
  assert.deepEqual(rows('rams-lead', 'team.opponent_scored'), [], 'the Rams\' trackers have no alert for the Rams\' own touchdown');
  tracker.stop();
});

test('F1: a touchdown that ties on its own and is converted for the lead (19-19, then 20-19) is not said to tie', async () => {
  device('bills-six', 'team:nfl:2');
  const g = game('401872999'), history = play('4018729990100', 'Rushing Touchdown', 'J.Cook up the middle for 5 yards, TOUCHDOWN. T.Bass extra point is GOOD.', { away: 19, home: 13, team: AWAY, scoring: true, ago: 10 * 60_000 });
  g.core = [history]; g.away = 19; g.home = 13;
  const tracker = new GameTracker('nfl', '401872999', HOME, AWAY);
  await tracker.poll();
  const td = (text: string, home: number) => play('4018729990200', 'Passing Touchdown', text, { away: 19, home, team: HOME, scoring: true });
  g.core = [history, td('M.Stafford pass short middle to D.Adams for 8 yards, TOUCHDOWN.', 19)]; g.home = 19; // level on the touchdown alone
  await tracker.poll();
  g.core = [history, td('M.Stafford pass short middle to D.Adams for 8 yards, TOUCHDOWN. H.Mevis extra point is GOOD.', 20)]; g.home = 20; // the kick: a lead
  await tracker.poll();
  const r = rows('bills-six', 'team.opponent_scored');
  assert.equal(r.length, 1);
  assert.equal(r[0].body, 'M.Stafford pass short middle to D.Adams for 8 yards, TOUCHDOWN. H.Mevis extra point is GOOD. — BUF 19, LAR 20', 'the row takes the play as ESPN has it now, the kick and the score');
  assert.deepEqual(r[0].lines, [], 'level for 24 seconds, then a lead: no tying line left to go stale');
  tracker.stop();
});

test('F1: a field goal that levels the game on its first read says so on the alert, once', async () => {
  device('bills-fg', 'team:nfl:2');
  const g = game('401872996'), history = play('4018729960100', 'Rushing Touchdown', 'J.Cook up the middle for 5 yards, TOUCHDOWN. T.Bass extra point is GOOD.', { away: 34, home: 31, team: AWAY, scoring: true, ago: 10 * 60_000 });
  g.core = [history]; g.away = 34; g.home = 31;
  const tracker = new GameTracker('nfl', '401872996', HOME, AWAY);
  await tracker.poll();
  g.core = [history, play('4018729960200', 'Field Goal Good', 'H.Mevis 33 yard field goal is GOOD, Center-J.Cardona, Holder-E.Evans.', { away: 34, home: 34, team: HOME, scoring: true })]; g.home = 34;
  await tracker.poll();
  const r = rows('bills-fg', 'team.opponent_scored');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Rams scored 3 on the Bills');
  assert.deepEqual(r[0].lines, ['Rams tied the game, 34-34.']);
  tracker.stop();
});

test('F1: a device with the Bills and Allen gets the tie once, as a line on Allen\'s interception, not as two wordings', async () => {
  device('bills-allen', 'team:nfl:2', 'player:nfl:3918298');
  const g = game('401872997'), history = play('4018729970100', 'Rushing Touchdown', 'J.Cook up the middle for 5 yards, TOUCHDOWN. T.Bass extra point is GOOD.', { away: 34, home: 27, team: AWAY, scoring: true, ago: 10 * 60_000 });
  g.core = [history]; g.away = 34; g.home = 27;
  const tracker = new GameTracker('nfl', '401872997', HOME, AWAY);
  await tracker.poll();
  // A pick-six and its kick in one version: 34-34 on the first read.
  g.core = [history, play('4018729970200', 'Interception Return Touchdown', '(Shotgun) J.Allen pass deep right intended for K.Coleman INTERCEPTED by J.Watson at LA 40. J.Watson for 60 yards, TOUCHDOWN. H.Mevis extra point is GOOD.', { away: 34, home: 34, team: AWAY, scoring: true, who: [['3918298', 'passer']] })]; g.home = 34;
  await tracker.poll();
  const r = rows('bills-allen', 'nfl.qb.interception');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Josh Allen threw an interception — returned for a TD 🙃');
  assert.equal(r[0].lines.filter((l: string) => /tied the game/.test(l)).length, 1, JSON.stringify(r[0].lines));
  assert.ok(r[0].lines.includes('Rams tied the game, 34-34.'), JSON.stringify(r[0].lines));
  tracker.stop();
});

test('F1: a pick-six that ties on its own and waits for its kick is "scored 6" in the fold, not "tied" (the kick usually makes it a lead)', async () => {
  device('bills-pick', 'team:nfl:2', 'player:nfl:3918298');
  const g = game('401872990'), history = play('4018729900100', 'Rushing Touchdown', 'J.Cook up the middle for 5 yards, TOUCHDOWN. T.Bass extra point is GOOD.', { away: 34, home: 28, team: AWAY, scoring: true, ago: 10 * 60_000 });
  g.core = [history]; g.away = 34; g.home = 28;
  const tracker = new GameTracker('nfl', '401872990', HOME, AWAY);
  await tracker.poll();
  g.core = [history, play('4018729900200', 'Interception Return Touchdown', '(Shotgun) J.Allen pass deep right intended for K.Coleman INTERCEPTED by J.Watson at LA 40. J.Watson for 60 yards, TOUCHDOWN.', { away: 34, home: 34, team: AWAY, scoring: true, who: [['3918298', 'passer']] })]; g.home = 34;
  await tracker.poll();
  const r = rows('bills-pick', 'nfl.qb.interception');
  assert.equal(r.length, 1);
  assert.ok(r[0].lines.includes('Rams scored 6.'), JSON.stringify(r[0].lines));
  assert.equal(r[0].lines.some((l: string) => /tied/.test(l)), false, JSON.stringify(r[0].lines));
  tracker.stop();
});

test('F2: a sack in a failed two-point try is "got sacked on the two-point try", with the try as its body; a sack on a down is as before', async () => {
  device('stafford', 'player:nfl:12483');
  const g = game('401872998'), history = play('4018729980100', 'Rushing Touchdown', 'J.Cook up the middle for 5 yards, TOUCHDOWN. T.Bass extra point is GOOD.', { away: 19, home: 14, team: AWAY, scoring: true, ago: 10 * 60_000 });
  g.core = [history]; g.away = 19; g.home = 14;
  const tracker = new GameTracker('nfl', '401872998', HOME, AWAY);
  await tracker.poll();
  const td = (text: string) => play('4018729983307', 'Passing Touchdown', text, { away: 19, home: 20, team: HOME, scoring: true, who: [['12483', 'passer']] });
  g.core = [history, td('M.Stafford pass short left to P.Nacua for 2 yards, TOUCHDOWN.')]; g.home = 20;
  await tracker.poll();
  assert.deepEqual(rows('stafford', 'nfl.qb.sacked'), [], 'a touchdown pass alone is no sack');
  // 36 seconds later ESPN adds the try to the touchdown.
  g.core = [history, td('M.Stafford pass short left to P.Nacua for 2 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. M.Stafford is sacked. ATTEMPT FAILS.')];
  await tracker.poll();
  const sacks = rows('stafford', 'nfl.qb.sacked');
  assert.equal(sacks.length, 1);
  assert.equal(sacks[0].title, 'Matthew Stafford got sacked on the two-point try');
  assert.equal(sacks[0].body, "The Rams' two-point try failed: M.Stafford is sacked. ATTEMPT FAILS. — BUF 19, LAR 20");
  assert.equal(sacks[0].pushed, false, 'feed only by default, like any sack');
  // A sack on a down (the Q2 one) keeps its title and its play's own text.
  g.core = [history, td('M.Stafford pass short left to P.Nacua for 2 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. M.Stafford is sacked. ATTEMPT FAILS.'),
    play('4018729983400', 'Sack', 'M.Stafford sacked at LA 41 for -6 yards (D.Carter).', { away: 19, home: 20, team: HOME, who: [['12483', 'passer']] })];
  await tracker.poll();
  const all = rows('stafford', 'nfl.qb.sacked');
  assert.deepEqual(all.map((r) => r.title), ['Matthew Stafford got sacked on the two-point try', 'Matthew Stafford got sacked']);
  assert.equal(all[1].body, 'M.Stafford sacked at LA 41 for -6 yards (D.Carter). — BUF 19, LAR 20');
  tracker.stop();
});

test('F2: a sack on the down before a try ("sacked" ahead of "TWO-POINT CONVERSION ATTEMPT") still counts as a sack', async () => {
  const { PLAYER_DETECTORS } = await import('../src/detectors.ts');
  const p = { id: '9', type: 'Sack', text: 'M.Stafford sacked at LA 41 for -6 yards (D.Carter). TWO-POINT CONVERSION ATTEMPT. M.Stafford pass incomplete. ATTEMPT FAILS.', participants: [{ id: '12483', role: 'passer' }], away: 0, home: 0 } as any;
  const es = PLAYER_DETECTORS.nfl({ league: 'nfl', gameId: 'x', homeId: HOME, awayId: AWAY } as any, p).filter((e: any) => e.type === 'nfl.qb.sacked');
  assert.deepEqual(es.map((e: any) => e.title), ['Matthew Stafford got sacked']);
});

// ─── F4: a team's flags, for the team's trackers (the same "Commits a penalty" setting, always feed only) ─────────────────────
/** A push's title less the emoji its type puts in front. */
const bare = (t: string) => t.replace(/^\p{Extended_Pictographic}️?\s*/u, '');
const flagGame = (gameId: string) => {
  const g = game(gameId), history = play(`${gameId}0100`, 'Rushing Touchdown', 'J.Cook up the middle for 5 yards, TOUCHDOWN. T.Bass extra point is GOOD.', { away: 14, home: 13, team: AWAY, scoring: true, ago: 10 * 60_000 });
  g.core = [history]; g.away = 14; g.home = 13;
  return { g, history, tracker: new GameTracker('nfl', gameId, HOME, AWAY) };
};

test('F4: a flag on the team that names no player ("PENALTY on BUF, Illegal Shift") is "Bills were flagged: Illegal Shift" for a Bills tracker, feed only', async () => {
  device('bills-flag', 'team:nfl:2');
  const { g, history, tracker } = flagGame('401872940');
  await tracker.poll();
  const sent = pushes.length;
  g.core = [history, play('4018729400200', 'Penalty', '(Shotgun) PENALTY on BUF, Illegal Shift, 5 yards, enforced at BUF 21 - No Play.', { away: 14, home: 13, team: AWAY })];
  await tracker.poll();
  const r = rows('bills-flag', 'nfl.penalty');
  assert.deepEqual(r.map((x) => [x.title, x.lines, x.pushed]), [['Bills were flagged: Illegal Shift', [], false]]);
  assert.equal(r[0].body, '(Shotgun) PENALTY on BUF, Illegal Shift, 5 yards, enforced at BUF 21 - No Play. — BUF 14, LAR 13');
  assert.equal(pushes.length, sent, 'never a push');
  tracker.stop();
});

test('F4: a flag that names a player is the team\'s too, and a device with the team and the player has one alert, not two', async () => {
  device('bills-only', 'team:nfl:2');
  device('bills-and-hawes', 'team:nfl:2', 'player:nfl:4573699');
  device('hawes-only', 'player:nfl:4573699');
  const { g, history, tracker } = flagGame('401872941');
  await tracker.poll();
  g.core = [history, play('4018729410200', 'Penalty', '(Shotgun) PENALTY on BUF-J.Hawes, False Start, 5 yards, enforced at LA 19 - No Play.', { away: 14, home: 13, team: AWAY, who: [['4573699', 'penalized']] })];
  await tracker.poll();
  assert.deepEqual(rows('bills-only', 'nfl.penalty').map((x) => [x.title, x.lines]), [['Bills were flagged: False Start', []]], 'the team tracker gets the team\'s flag');
  assert.deepEqual(rows('hawes-only', 'nfl.penalty').map((x) => [x.title, x.lines]), [['Jackson Hawes was flagged', []]], 'the player\'s tracker gets the player\'s, as before');
  const both = rows('bills-and-hawes', 'nfl.penalty');
  assert.deepEqual(both.map((x) => [x.title, x.lines]), [['Jackson Hawes was flagged', []]], 'one alert, the player\'s, and no extra line from the team\'s');
  tracker.stop();
});

test('F4: a flag posted for the team and named a poll later (Dolphins, Patterson: ESPN added him 96 seconds on) is one row for a device with both, the player as its line; pushed for the player it keeps its own row', async () => {
  device('bills-late-both', 'team:nfl:2', 'player:nfl:4573699');
  deviceWith('hawes-late-pushed', { pushTypes: { 'nfl.penalty': true } }, 'team:nfl:2', 'player:nfl:4573699');
  const { g, history, tracker } = flagGame('401872947');
  await tracker.poll();
  const flag = (text: string, who: [string, string][]) => play('4018729470200', 'Penalty', text, { away: 14, home: 13, team: AWAY, who });
  g.core = [history, flag('(Shotgun) PENALTY on BUF, False Start, 5 yards, enforced at LA 19 - No Play.', [])];
  await tracker.poll();
  g.core = [history, flag('(Shotgun) PENALTY on BUF-J.Hawes, False Start, 5 yards, enforced at LA 19 - No Play.', [['4573699', 'penalized']])];
  await tracker.poll();
  assert.deepEqual(rows('bills-late-both', 'nfl.penalty').map((x) => [x.title, x.lines]), [['Bills were flagged: False Start', ['Jackson Hawes was flagged.']]], 'one row, the player a line on it');
  assert.deepEqual(rows('hawes-late-pushed', 'nfl.penalty').map((x) => [x.title, x.pushed]), [['Bills were flagged: False Start', false], ['Jackson Hawes was flagged', true]], 'his flag still pushes');
  tracker.stop();
});

test('F4: Dolphins at Bengals\' kickoff as ESPN posted it (the team flag, the same twice with another distance, then Patterson named): one row for a device with both', async () => {
  device('bills-kick', 'team:nfl:2', 'player:nfl:4573699');
  const { g, history, tracker } = flagGame('401872948');
  await tracker.poll();
  const kick = (text: string, who: [string, string][]) => play('4018729480200', 'Kickoff', text, { away: 14, home: 13, team: AWAY, who });
  const steps: [string, [string, string][]][] = [
    ['(Onside Kick formation) J.Hawes kicks onside 12 yards from BUF 35 to BUF 47, out of bounds.\nPENALTY on BUF, Kickoff Out of Bounds, placed at 50.', [['4573699', 'other']]],
    ['(Onside Kick formation) J.Hawes kicks onside 15 yards from BUF 35 to 50, out of bounds.PENALTY on BUF, Kickoff Out of Bounds, placed at 50.', [['4573699', 'other']]],
    ['(Onside Kick formation) J.Hawes kicks onside 15 yards from BUF 35 to 50, out of bounds.PENALTY on BUF-J.Hawes, Kickoff Out of Bounds, placed at 50.', [['4573699', 'penalized']]],
    ['J.Hawes kicks onside 15 yards from BUF 35 to 50, out of bounds.PENALTY on BUF-J.Hawes, Kickoff Out of Bounds, placed at 50.', [['4573699', 'penalized']]],
  ];
  for (const [text, who] of steps) { g.core = [history, kick(text, who)]; await tracker.poll(); }
  assert.deepEqual(rows('bills-kick', 'nfl.penalty').map((x) => [x.title, x.lines]), [['Bills were flagged: Kickoff Out of Bounds', ['Jackson Hawes was flagged.']]]);
  tracker.stop();
});

test('F4: installs from before keep flags pushed for players, and a team\'s flags still never push (pushTypes["nfl.penalty"] is the whole type)', async () => {
  deviceWith('old-team', { pushTypes: { 'nfl.penalty': true } }, 'team:nfl:2');
  deviceWith('old-player', { pushTypes: { 'nfl.penalty': true } }, 'player:nfl:4573699');
  const { g, history, tracker } = flagGame('401872942');
  await tracker.poll();
  const before = pushedTo.length;
  g.core = [history, play('4018729420200', 'Penalty', '(Shotgun) PENALTY on BUF-J.Hawes, False Start, 5 yards, enforced at LA 19 - No Play.', { away: 14, home: 13, team: AWAY, who: [['4573699', 'penalized']] })];
  await tracker.poll();
  const now = pushedTo.slice(before).filter((p) => p.startsWith('tok-old-')).map((p) => p.split('|')[1]); // these two devices' pushes
  assert.deepEqual(rows('old-team', 'nfl.penalty').map((x) => [x.title, x.pushed]), [['Bills were flagged: False Start', false]]);
  assert.deepEqual(rows('old-player', 'nfl.penalty').map((x) => [x.title, x.pushed]), [['Jackson Hawes was flagged', true]], 'the player\'s flag is still pushed for them');
  assert.deepEqual(now.map(bare), ['Jackson Hawes was flagged'], 'one push in all: the player\'s');
  tracker.stop();
});

test('F4: a flag on the team that was scored on, on the play it was scored on, is a line at most: the pushed "took the lead" stays the alert', async () => {
  deviceWith('bills-pushed', { pushTypes: { 'nfl.penalty': true, 'team.fell_behind': true } }, 'team:nfl:2');
  const { g, history, tracker } = flagGame('401872943');
  await tracker.poll();
  const before = pushes.length;
  g.core = [history, play('4018729430200', 'Passing Touchdown', 'M.Stafford pass short left to P.Nacua for 6 yards, TOUCHDOWN. Penalty on BUF-D.Hamlin, Defensive Holding, declined.', { away: 14, home: 19, team: HOME, scoring: true })]; g.home = 19;
  await tracker.poll();
  const behind = rows('bills-pushed', 'team.fell_behind');
  assert.deepEqual(behind.map((x) => [x.title, x.pushed]), [['Rams scored 6 to take the lead over the Bills', true]], 'the alert, pushed');
  assert.deepEqual(rows('bills-pushed', 'nfl.penalty'), [], 'the declined flag is not a second alert (it would have silenced the push)');
  assert.deepEqual(pushes.slice(before).map(bare), ['Rams scored 6 to take the lead over the Bills']);
  tracker.stop();
});

test('F4: a flag moved to another player stays the team\'s flag (no line for the team tracker), and the first player\'s line names the player, not the team', async () => {
  device('bills-moved', 'team:nfl:2');
  device('mcgovern-moved', 'player:nfl:4033748');
  const { g, history, tracker } = flagGame('401872944');
  await tracker.poll();
  const flag = (text: string, who: string) => play('4018729440200', 'Penalty', text, { away: 14, home: 13, team: AWAY, who: [[who, 'penalized']] });
  g.core = [history, flag('(Shotgun) PENALTY on BUF-C.McGovern, False Start, 5 yards, enforced at LA 19 - No Play.', '4033748')];
  await tracker.poll();
  g.core = [history, flag('(Shotgun) PENALTY on BUF-J.Hawes, False Start, 5 yards, enforced at LA 19 - No Play.', '4573699')];
  await tracker.poll();
  assert.deepEqual(rows('bills-moved', 'nfl.penalty').map((x) => [x.title, x.lines]), [['Bills were flagged: False Start', []]], 'still a Bills flag');
  assert.deepEqual(rows('mcgovern-moved', 'nfl.penalty').map((x) => [x.title, x.lines]), [['Connor McGovern was flagged', ['ESPN has since charged this flag to Jackson Hawes.']]]);
  tracker.stop();
});

test('F4: a flag ESPN takes off gets "ESPN has since taken the flag off." on the team\'s alert', async () => {
  device('bills-off', 'team:nfl:2');
  const { g, history, tracker } = flagGame('401872945');
  await tracker.poll();
  g.core = [history, play('4018729450200', 'Penalty', '(Shotgun) PENALTY on BUF, Illegal Shift, 5 yards, enforced at BUF 21 - No Play.', { away: 14, home: 13, team: AWAY })];
  await tracker.poll();
  g.core = [history, play('4018729450200', 'Pass Reception', '(Shotgun) J.Allen pass short right to K.Coleman to BUF 30 for 9 yards (Q.Lake).', { away: 14, home: 13, team: AWAY })];
  await tracker.poll();
  assert.deepEqual(rows('bills-off', 'nfl.penalty').map((x) => [x.title, x.lines]), [['Bills were flagged: Illegal Shift', ['ESPN has since taken the flag off.']]]);
  tracker.stop();
});

test('F4: two flags on one team on one play are one alert; a declined flag says so; offsetting flags flag each team', async () => {
  device('bills-two', 'team:nfl:2');
  device('rams-offsetting', 'team:nfl:14');
  const { g, history, tracker } = flagGame('401872946');
  await tracker.poll();
  g.core = [history, play('4018729460200', 'Penalty', '(Shotgun) PENALTY on BUF-T.Grable, Offensive Holding, 10 yards, enforced at LA 48 - No Play.PENALTY on BUF-C.Bishop, Unnecessary Roughness, 15 yards, enforced at LA 48. Penalty on LA-Q.Lake, Defensive Offside, declined.', { away: 14, home: 13, team: AWAY })];
  await tracker.poll();
  assert.deepEqual(rows('bills-two', 'nfl.penalty').map((x) => x.title), ['Bills were flagged: Offensive Holding, Unnecessary Roughness']);
  assert.deepEqual(rows('rams-offsetting', 'nfl.penalty').map((x) => x.title), ['Rams were flagged: Defensive Offside (declined)']);
  tracker.stop();
});
