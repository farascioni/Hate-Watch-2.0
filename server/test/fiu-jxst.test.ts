// FIU at Jax State (October 13 2026, ESPN 401871053, Jax State 27-24), through a real GameTracker with the plays and wording of
// the recording, for the three findings of the game's post game recording report:
//  F1  a college team's flag is a weak alert (`afterOthers`, `noPush`, as the NFL's team flag): a declined flag on the tying
//      touchdown and on the go-ahead field goal had taken the places of "FIU scored 7 on Jax State" and "Jax State scored 3 to
//      take the lead over FIU", and a flag on a punt had taken the place of the three-and-out.
//  F2  ESPN corrects a play's words after its alert went out (both sacks first read "loss of 0 yards"): the alert's row takes
//      the play as ESPN has it now, with no push and no second row.
//  F3  a touchdown first read at 6 points gets its extra point as an edit to the same play: the row takes the kick and the score.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES (?, 'cfb', ?, ?, ?, ?, ?, 'x', 500, 500, 0)`);
for (const [id, name, short, abbr, location] of [['55', 'Jacksonville State Gamecocks', 'Jax State', 'JXST', 'Jacksonville State'], ['2229', 'Florida International Panthers', 'FIU', 'FIU', 'Florida International']])
  team.run(`team:cfb:${id}`, id, name, short, abbr, location);
loadCatalog();
const pushes: string[] = [];
setPushSender((m) => { pushes.push(...m.map((x: any) => x.title)); });
const device = (id: string, ...follows: string[]) => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', `tok-${id}`, JSON.stringify(DEFAULT_PREFS));
  for (const f of follows) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(id, f);
};
const rows = (deviceId: string) => (db.prepare(`SELECT e.type, e.title, e.body, f.extra, f.pushed FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(deviceId) as any[])
  .map((r) => ({ type: r.type as string, title: r.title as string, body: r.body as string, lines: (r.extra ? JSON.parse(r.extra) : []) as string[], pushed: !!r.pushed }));

const HOME = '55', AWAY = '2229'; // Jax State at home, FIU away
const OLD = new Date(Date.now() - 10 * 60_000).toISOString();
let n = 0;
/** One drive play (a summary's drives): the team with the ball under `start`, the running score. */
const play = (id: string, type: string, text: string, teamId: string, away: number, home: number, x: Record<string, unknown> = {}) =>
  ({ id, type: { text: type }, text, start: { team: { id: teamId } }, end: { team: { id: teamId } }, awayScore: away, homeScore: home, period: { number: 4 }, clock: { displayValue: `${10 - n++}:00` },
    scoringPlay: false, wallclock: new Date().toISOString(), ...x });
const game = (gameId: string) => {
  const g = { drives: { previous: [] as any[], current: null as any } };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.summary('cfb', gameId))) return { header: { competitions: [{ status: { type: { state: 'in', completed: false } }, competitors: [] }] }, drives: g.drives };
    throw new Error(`unexpected fetch ${url}`);
  };
  return g;
};
/** The game at 10-17 with Jax State ahead (a field goal from before the tracker attached), the tracker's baseline read. */
async function attach(gameId: string, ...devices: string[][]) {
  for (const [id, ...follows] of devices) device(id, ...follows);
  const g = game(gameId), history = play(`${gameId}h`, 'Field Goal Good', '(13:39) #37 G.Rippa field goal attempt from 47 yards GOOD', HOME, 10, 17, { scoringPlay: true, wallclock: OLD });
  g.drives.current = { id: `${gameId}d0`, plays: [history] };
  const tracker = new GameTracker('cfb', gameId, HOME, AWAY);
  await tracker.poll();
  return { g, tracker, history };
}

test('F1: a declined flag on the tying touchdown is not the touchdown\'s alert: Jax State\'s device gets "FIU scored 7 on Jax State", and the flag is dropped, never a push', async () => {
  const { g, tracker, history } = await attach('G1', ['jx1', 'team:cfb:55']);
  const td = play('G1t', 'Passing Touchdown', '(01:44) Shotgun #17 J.Kohl pass complete deep left to #2 M.Anderson caught at Jax ST00, for 30 yards to the Jax ST00 TOUCHDOWN, clock 01:41, 1ST DOWN #48 R.Czeremcha kick attempt good PENALTY Jax ST Offside declined',
    AWAY, 17, 17, { scoringPlay: true });
  g.drives.current = { id: 'G1d1', plays: [history, td] };
  await tracker.poll();
  const r = rows('jx1');
  assert.deepEqual(r.map((x) => x.title), ['FIU scored 7 on Jax State'], 'the score is the alert; the flag took its place before');
  assert.ok(r[0].lines.includes('FIU tied the game, 17-17.'));
  assert.ok(!pushes.some((t) => /flagged/.test(t)), 'a college flag never pushes');
  tracker.stop();
});

test('F1: a flag on the go-ahead field goal is not its alert either: FIU\'s device gets "Jax State scored 3 to take the lead over FIU"', async () => {
  const { g, tracker, history } = await attach('G2', ['fiu2', 'team:cfb:2229']);
  const tied = play('G2a', 'Rushing Touchdown', '(01:11) D.Lyons rush right for 8 yards gain to the Jax ST00 TOUCHDOWN, clock 01:06 #48 R.Czeremcha kick attempt good', AWAY, 24, 24, { scoringPlay: true });
  const fg = play('G2b', 'Field Goal Good', '(00:46) #37 G.Rippa field goal attempt from 26 yards GOOD (H: #1 C.Nix, LS: #45 D.Musgrove), clock 00:44 PENALTY FIU Running Into The Kicker declined', HOME, 24, 27, { scoringPlay: true });
  g.drives.current = { id: 'G2d1', plays: [history, tied] };
  await tracker.poll();
  g.drives.current = { id: 'G2d1', plays: [history, tied, fg] };
  await tracker.poll();
  const titles = rows('fiu2').map((x) => x.title);
  assert.ok(titles.includes('Jax State scored 3 to take the lead over FIU'), titles.join(' | '));
  assert.ok(!titles.includes('FIU was flagged: Running Into The Kicker (declined)'), 'the flag is dropped: the score holds the play\'s moment');
  tracker.stop();
});

test('F1: a flag on a punt is its own feed row beside "went three-and-out", and the flag alone is a feed row with no push', async () => {
  const { g, tracker, history } = await attach('G3', ['jx3', 'team:cfb:55']);
  const snap = (id: string, type: string, text: string, extra: Record<string, unknown> = {}) => play(id, type, text, HOME, 10, 17, extra);
  const plays = [history, snap('G3a', 'Rush', '(06:00) rush for 1 yard'), snap('G3b', 'Pass Incompletion', '(05:30) pass incomplete'), snap('G3c', 'Sack', '(05:00) #12 C.Creel sacked for loss of 7 yards to the Jax ST20 (#12 R.Moss Jr.)'),
    snap('G3d', 'Punt', '(04:47) #87 C.Donaghy punt 44 yards to the FIU36, out of bounds at FIU36 PENALTY Jax ST Holding (#30 L.Gilbert) 10 yards from Jax ST20 to Jax ST10. NO PLAY')];
  g.drives.current = { id: 'G3d1', plays };
  await tracker.poll();
  assert.ok(rows('jx3').some((x) => x.title === 'Jax State was flagged: Holding' && !x.pushed), 'the flag on its own: a feed row, no push');
  g.drives.previous = [{ id: 'G3d1', team: { id: HOME, abbreviation: 'JXST' }, result: 'PUNT', displayResult: 'Punt', description: '3 plays, -14 yards, 2:19', offensivePlays: 3, yards: -14, plays }];
  g.drives.current = null;
  await tracker.poll();
  const r = rows('jx3');
  const flag = r.find((x) => x.title === 'Jax State was flagged: Holding'), out = r.find((x) => x.title === 'Jax State went three-and-out');
  assert.ok(flag && out, r.map((x) => x.title).join(' | '));
  assert.ok(!flag!.lines.some((l) => /Three-and-out/.test(l)), 'the drive\'s result is not a line on the flag');
  tracker.stop();
});

test('F2: a sack ESPN first read as "loss of 0 yards" takes the corrected words on its row, with no push, no second row and one log line', async () => {
  const { g, tracker, history } = await attach('G4', ['jx4', 'team:cfb:55']);
  const sack = (text: string) => play('G4s', 'Sack', text, HOME, 10, 17);
  g.drives.current = { id: 'G4d1', plays: [history, sack('(05:29) No Huddle-Shotgun #12 C.Creel sacked for loss of 0 yards to the Jax ST27 (#12 R.Moss Jr.)')] };
  await tracker.poll();
  const sent = pushes.length;
  assert.equal(rows('jx4').find((x) => x.type === 'cfb.team.sacked')!.body, '(05:29) No Huddle-Shotgun #12 C.Creel sacked for loss of 0 yards to the Jax ST27 (#12 R.Moss Jr.) — FIU 10, JXST 17');
  g.drives.current = { id: 'G4d1', plays: [history, sack('(05:29) No Huddle-Shotgun #12 C.Creel sacked for loss of 7 yards to the Jax ST20 (#12 R.Moss Jr.)')] };
  await tracker.poll();
  const r = rows('jx4').filter((x) => x.type === 'cfb.team.sacked');
  assert.equal(r.length, 1, 'one row');
  assert.equal(r[0].body, '(05:29) No Huddle-Shotgun #12 C.Creel sacked for loss of 7 yards to the Jax ST20 (#12 R.Moss Jr.) — FIU 10, JXST 17');
  assert.equal(pushes.length, sent, 'no push for a correction');
  await tracker.poll(); // a re-read changes nothing more
  assert.equal(rows('jx4').filter((x) => x.type === 'cfb.team.sacked')[0].body, r[0].body);
  tracker.stop();
});

test('F3: a touchdown first read at 6 points takes its extra point and the level score on the row; the tying line still comes', async () => {
  const { g, tracker, history } = await attach('G5', ['jx5', 'team:cfb:55']);
  const td = (text: string, away: number) => play('G5t', 'Passing Touchdown', text, AWAY, away, 17, { scoringPlay: true });
  g.drives.current = { id: 'G5d1', plays: [history, td('(04:54) J.Kohl pass complete deep right to #2 M.Anderson for 50 yards to the Jax ST00 TOUCHDOWN, clock 04:43, 1ST DOWN', 16)] };
  await tracker.poll();
  assert.deepEqual(rows('jx5').map((x) => [x.title, x.body]), [['FIU scored 6 on Jax State', '(04:54) J.Kohl pass complete deep right to #2 M.Anderson for 50 yards to the Jax ST00 TOUCHDOWN, clock 04:43, 1ST DOWN — FIU 16, JXST 17']]);
  const sent = pushes.length;
  g.drives.current = { id: 'G5d1', plays: [history, td('(04:54) J.Kohl pass complete deep right to #2 M.Anderson for 50 yards to the Jax ST00 TOUCHDOWN, clock 04:43, 1ST DOWN #48 R.Czeremcha kick attempt good', 17)] };
  await tracker.poll();
  const r = rows('jx5');
  assert.equal(r.length, 1, 'one row');
  assert.equal(r[0].body, '(04:54) J.Kohl pass complete deep right to #2 M.Anderson for 50 yards to the Jax ST00 TOUCHDOWN, clock 04:43, 1ST DOWN #48 R.Czeremcha kick attempt good — FIU 17, JXST 17', 'the kick and the score');
  assert.deepEqual(r[0].lines, ['FIU tied the game, 17-17.']);
  assert.equal(pushes.length, sent);
  tracker.stop();
});

test('F2/F3: a play ESPN turns into another kind keeps its old alert\'s words and its "wiped out" line: only alerts the play still has are reworded', async () => {
  const { g, tracker, history } = await attach('G6', ['jx6', 'team:cfb:55']);
  g.drives.current = { id: 'G6d1', plays: [history, play('G6i', 'Pass Interception Return', '(11:09) #12 C.Creel pass intercepted by #6 P.Zachman at FIU43', HOME, 10, 17)] };
  await tracker.poll();
  const was = rows('jx6').find((x) => x.type === 'cfb.team.interception')!;
  g.drives.current = { id: 'G6d1', plays: [history, play('G6i', 'Penalty', '(11:09) #12 C.Creel pass incomplete PENALTY FIU Roughing The Passer (#95 T.Tucker) 15 yards from JXST16 to JXST31, 1ST DOWN. NO PLAY', HOME, 10, 17)] };
  await tracker.poll();
  const now = rows('jx6').find((x) => x.type === 'cfb.team.interception')!;
  assert.equal(now.body, was.body, 'the interception row keeps what it said');
  assert.ok(now.lines.some((l) => /Wiped out by a penalty/.test(l)), now.lines.join(' | '));
  tracker.stop();
});

test('F3: a touchdown ESPN nullifies (NO PLAY, the score back down) keeps the words its alert went out with; the extra point guard does not reword a score the play no longer has', async () => {
  const { g, tracker, history } = await attach('G7', ['jx7', 'team:cfb:55']);
  const td = (text: string, away: number) => play('G7t', 'Passing Touchdown', text, AWAY, away, 17, { scoringPlay: true });
  const sent = '(04:54) J.Kohl pass complete deep right to #2 M.Anderson for 50 yards to the Jax ST00 TOUCHDOWN, clock 04:43, 1ST DOWN';
  g.drives.current = { id: 'G7d1', plays: [history, td(sent, 16)] };
  await tracker.poll();
  g.drives.current = { id: 'G7d1', plays: [history, td(`${sent.replace('TOUCHDOWN', 'TOUCHDOWN nullified by penalty')} PENALTY FIU Holding (#55 D.Harley) 10 yards from FIU40 to FIU30. NO PLAY`, 10)] };
  await tracker.poll();
  await tracker.poll();
  const r = rows('jx7').filter((x) => x.type === 'team.opponent_scored');
  assert.equal(r.length, 1);
  assert.equal(r[0].body, `${sent} — FIU 16, JXST 17`, 'the score alert says what it said when it went out');
  tracker.stop();
});
