// Kennesaw State at Missouri State (October 14 2026, ESPN 401871054, Missouri State 24-21), through a real GameTracker with the
// wording of the recording, for the findings of the game's post game recording report:
//  F1  ESPN posted a touchdown for 15 seconds that its own words say is not one ("for 54 yards loss to the MSU00 TOUCHDOWN"):
//      a football scoring play like that waits for ESPN's rewrite (HW_SCORE_WORDS_WAIT_MS), and the score alert with it.
//  F2  the winning field goal never reached ESPN's plays: finish() announces a final score the plays never had.
//  F3  a drive that ends in kneel-downs (ESPN labels it DOWNS) is not "turned it over on downs", not "empty from the red zone".
//  F4  a touchdown ESPN edits to carry a two-point try (and a "NO PLAY" in its words) takes the try, the score and "scored 8".
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_SCORE_WORDS_WAIT_MS = '300';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { nflDriveEvents } = await import('../src/detectors.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES (?, 'cfb', ?, ?, ?, ?, ?, 'x', 500, 500, 0)`);
for (const [id, name, short, abbr, location] of [['2623', 'Missouri State Bears', 'Missouri State', 'MOST', 'Missouri State'], ['338', 'Kennesaw State Owls', 'Kennesaw State', 'KENN', 'Kennesaw State']])
  team.run(`team:cfb:${id}`, id, name, short, abbr, location);
loadCatalog();
setPushSender(() => {});
const device = (id: string, ...follows: string[]) => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', `tok-${id}`, JSON.stringify(DEFAULT_PREFS));
  for (const f of follows) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(id, f);
};
const rows = (deviceId: string) => (db.prepare(`SELECT e.type, e.title, e.body, f.extra, f.pushed FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(deviceId) as any[])
  .map((r) => ({ type: r.type as string, title: r.title as string, body: r.body as string, lines: (r.extra ? JSON.parse(r.extra) : []) as string[], pushed: !!r.pushed }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HOME = '2623', AWAY = '338'; // Missouri State at home, Kennesaw State away
const OLD = new Date(Date.now() - 10 * 60_000).toISOString();
let n = 0;
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
/** The game at 14-7 with Missouri State ahead (a touchdown from before the tracker attached), the tracker's baseline read. */
async function attach(gameId: string, ...devices: string[][]) {
  for (const [id, ...follows] of devices) device(id, ...follows);
  const g = game(gameId), history = play(`${gameId}h`, 'Rushing Touchdown', '(13:39) #5 J.Smith rush for 5 yards to the KENN00 TOUCHDOWN, clock 13:30 #19 K.Boyd kick attempt good', HOME, 7, 14, { scoringPlay: true, wallclock: OLD });
  g.drives.current = { id: `${gameId}d0`, plays: [history] };
  const tracker = new GameTracker('cfb', gameId, HOME, AWAY);
  await tracker.poll();
  return { g, tracker, history };
}
const PHANTOM = '(07:10) #11 D.Cook pass complete to #8 K.Ray for 54 yards loss to the MSU00 TOUCHDOWN, clock 07:00';
const scored = (deviceId: string) => rows(deviceId).filter((x) => /scored/.test(x.title));

test('F1: a touchdown whose words say "yards loss to the MSU00 TOUCHDOWN" that ESPN removes within the hold is never an alert, on either team\'s device', async () => {
  const { g, tracker, history } = await attach('K1', ['kn1', 'team:cfb:338'], ['ms1', 'team:cfb:2623']);
  g.drives.current = { id: 'K1d1', plays: [history, play('K1p', 'Passing Touchdown', PHANTOM, AWAY, 13, 14, { scoringPlay: true })] };
  await tracker.poll();
  await tracker.poll();
  assert.deepEqual(scored('kn1'), [], 'held: no score alert for Kennesaw State');
  assert.deepEqual(scored('ms1'), [], 'held: none for Missouri State either');
  g.drives.current = { id: 'K1d1', plays: [history, play('K1p', 'Pass Incompletion', '(07:10) #11 D.Cook pass incomplete to #8 K.Ray', AWAY, 7, 14)] };
  await tracker.poll();
  await sleep(350);
  await tracker.poll();
  assert.deepEqual(scored('kn1'), [], 'ESPN took it back: never alerted');
  assert.deepEqual(scored('ms1'), []);
  tracker.stop();
});

test('F1: the same play ESPN rewrites into a real touchdown within the hold is alerted once, with the real words', async () => {
  const { g, tracker, history } = await attach('K2', ['kn2', 'team:cfb:2623']);
  g.drives.current = { id: 'K2d1', plays: [history, play('K2p', 'Passing Touchdown', PHANTOM, AWAY, 13, 14, { scoringPlay: true })] };
  await tracker.poll();
  assert.equal(scored('kn2').length, 0, 'held');
  const real = '(07:10) #11 D.Cook pass complete to #8 K.Ray for 54 yards to the MSU00 TOUCHDOWN, clock 07:00';
  g.drives.current = { id: 'K2d1', plays: [history, play('K2p', 'Passing Touchdown', real, AWAY, 13, 14, { scoringPlay: true })] };
  await tracker.poll();
  const r = scored('kn2');
  assert.equal(r.length, 1, rows('kn2').map((x) => x.title).join(' | '));
  assert.match(r[0].body, /54 yards to the MSU00 TOUCHDOWN/);
  tracker.stop();
});

test('F2: a final that is a field goal ahead of ESPN\'s plays announces the score, once', async () => {
  const { tracker } = await attach('K3', ['kn3', 'team:cfb:338']);
  tracker.finish({ home: 17, away: 7 });
  const t = rows('kn3').map((x) => x.title);
  assert.equal(t.filter((x) => /Missouri State scored 3/.test(x)).length, 1, t.join(' | '));
  await tracker.poll(); // the polls after the final (correctionsAfterFinal) still see plays without the field goal: it is not taken back
  await tracker.poll();
  const r = rows('kn3').filter((x) => /Missouri State scored 3/.test(x.title));
  assert.equal(r.length, 1);
  assert.ok(![r[0].body, ...r[0].lines].some((l) => /taken this score back/.test(l)), JSON.stringify(r[0]));
  assert.equal(r[0].pushed, false, 'a game that is over pushes only its loss');
  tracker.stop();
});

test('F2: the field goal ESPN adds to its plays after the final is the catch-up alert\'s play, not a second alert', async () => {
  const { g, tracker, history } = await attach('K7', ['kn7', 'team:cfb:338']);
  tracker.finish({ home: 17, away: 7 });
  const fg = play('K7f', 'Field Goal Good', '(00:20) #19 K.Boyd 32 yard field goal GOOD', HOME, 7, 17, { scoringPlay: true });
  g.drives.current = { id: 'K7d1', plays: [history, fg] };
  await tracker.poll();
  await tracker.poll();
  const r = rows('kn7').filter((x) => /Missouri State scored 3/.test(x.title));
  assert.equal(r.length, 1, rows('kn7').map((x) => `${x.title} | ${x.body}`).join(' || '));
  assert.ok(![r[0].body, ...r[0].lines].some((l) => /taken this score back/.test(l)), JSON.stringify(r[0]));
  assert.equal(r[0].pushed, false, 'a game that is over pushes only its loss');
  tracker.stop();
});

test('F2: a final the plays already have makes no catch-up alert', async () => {
  const { tracker } = await attach('K4', ['kn4', 'team:cfb:338']);
  tracker.finish({ home: 14, away: 7 });
  assert.ok(!rows('kn4').some((x) => /scored/.test(x.title)), rows('kn4').map((x) => x.title).join(' | '));
  tracker.stop();
});

test('F3: a drive that ends in kneel-downs, labelled DOWNS inside the red zone, makes no downs and no red-zone alert; the same drive ending on a real down still does', () => {
  const g = { league: 'cfb', gameId: 'K5', homeId: HOME, awayId: AWAY } as any;
  const snap = (id: string, text: string, down: string) => ({ id, type: { text: 'Rush' }, text, start: { team: { id: HOME }, downDistanceText: down }, homeScore: 21, awayScore: 21, wallclock: new Date().toISOString() });
  const drive = (last: any) => ({ id: 'K5d', team: { id: HOME, abbreviation: 'MOST' }, result: 'DOWNS', displayResult: 'Downs', description: '8 plays, 40 yards', offensivePlays: 8, yards: 40,
    plays: [snap('a', '(02:00) rush for 3 yards', '1st & 10 at KENN 15'), last] });
  const kneel = nflDriveEvents(g, drive(snap('b', '(00:09) Kneel down by #2 H.Belin IV at KSU05 for loss of 2 yards', '3rd & 10 at KENN 13')));
  assert.deepEqual(kneel.map((e) => e.type), []);
  const real = nflDriveEvents(g, drive(snap('b', '(00:09) #2 H.Belin IV rush for no gain', '4th & 2 at KENN 13')));
  assert.deepEqual(real.map((e) => e.type.replace(/^cfb\.(team\.)?/, '')).sort(), ['red_zone_empty', 'turnover_on_downs']);
});

test('F4: a touchdown that ESPN edits to carry a two-point conversion (and a NO PLAY in its words) takes the try and the score on its row, and "scored 6" becomes "scored 8"', async () => {
  const { g, tracker, history } = await attach('K6', ['kn6', 'team:cfb:2623']);
  const td = (text: string, away: number) => play('K6t', 'Passing Touchdown', text, AWAY, away, 14, { scoringPlay: true });
  const six = '(05:00) #11 D.Cook pass complete to #8 K.Ray for 12 yards to the MSU00 TOUCHDOWN, clock 04:50';
  g.drives.current = { id: 'K6d1', plays: [history, td(six, 13)] };
  await tracker.poll();
  assert.equal(scored('kn6').length, 1, rows('kn6').map((x) => x.title).join(' | '));
  assert.match(scored('kn6')[0].title, /scored 6\b/);
  g.drives.current = { id: 'K6d1', plays: [history, td(`${six} TWO-POINT CONVERSION ATTEMPT #11 D.Cook pass complete to #1 T.Lee for 2 yards, ATTEMPT SUCCEEDS. PENALTY MOST Offside declined. NO PLAY`, 15)] };
  await tracker.poll();
  await tracker.poll();
  const r = scored('kn6');
  assert.equal(r.length, 1, 'one row');
  assert.match(r[0].title, /scored 8\b/, r[0].title);
  assert.match(r[0].body, /ATTEMPT SUCCEEDS/);
  assert.match(r[0].body, /15, MOST 14|KENN 15/, r[0].body);
  tracker.stop();
});
