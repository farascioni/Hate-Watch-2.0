// F1 alerts merged so a device tracking a lot doesn't get a flood (Singapore's sprint, October 10 2026, replayed
// with everyone tracked: 33 notifications, 13 at lights out and 14 at the final), through the real engine with
// fake ESPN: one start alert naming yours; a double DNF and a team out of the points taking in their drivers'
// alerts; a session's alerts in one publish as one notification; results at "session complete", corrected when a
// penalty changes them (in place, a new one sent, one no longer true withdrawn, off the Hate Watch tally); a
// championship drop as a line on that day's alert.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender, withLines } = await import('../src/fanout.ts');
const { urls } = await import('../src/leagues.ts');
const F = await import('../src/f1.ts');

// ── Six constructors, twelve cars
const TEAMS: Record<string, [string, [string, string][]]> = {
  ALP: ['Alpine', [['GAS', 'Pierre Gasly'], ['COL', 'Franco Colapinto']]], CAD: ['Cadillac', [['PER', 'Sergio Pérez'], ['BOT', 'Valtteri Bottas']]],
  FER: ['Ferrari', [['LEC', 'Charles Leclerc'], ['HAM', 'Lewis Hamilton']]], HAA: ['Haas', [['OCO', 'Esteban Ocon'], ['BEA', 'Oliver Bearman']]],
  MCL: ['McLaren', [['NOR', 'Lando Norris'], ['PIA', 'Oscar Piastri']]], WIL: ['Williams', [['ALB', 'Alexander Albon'], ['SAI', 'Carlos Sainz']]],
};
const teamRow = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'f1', ?, ?, ?, ?, 'badge://f1', 512, 512, 0)`);
const driverRow = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'f1', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
const teamOfCar: Record<string, string> = {};
for (const [id, [name, drivers]] of Object.entries(TEAMS)) {
  teamRow.run(`team:f1:${id}`, id, name, name, id);
  for (const [d, dn] of drivers) { driverRow.run(`player:f1:${d}`, d, dn, `team:f1:${id}`); teamOfCar[d] = name; }
}
loadCatalog();

// ── Devices: everyone tracked; Gasly only; Alpine only; Cadillac and Bottas; Bottas only.
const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
const everything = Object.entries(TEAMS).flatMap(([id, [, ds]]) => [`team:f1:${id}`, ...ds.map(([d]) => `player:f1:${d}`)]);
for (const [id, keys] of Object.entries({ all: everything, gasly: ['player:f1:GAS'], alpine: ['team:f1:ALP'], cadbot: ['team:f1:CAD', 'player:f1:BOT'], bottas: ['player:f1:BOT'] })) {
  device.run(id, 's', 'ios', `tok-${id}`, JSON.stringify(DEFAULT_PREFS));
  for (const k of keys) follow.run(id, k);
}
let pushes: { to: string; title: string; body: string; data: Record<string, unknown> }[] = [];
setPushSender((m) => pushes.push(...m));
const pushedTo = (dev: string) => pushes.filter((p) => p.to === `tok-${dev}`);
/** A device's feed: each row's type, target and title, and its body with the lines it has. */
const feed = (dev: string) => (db.prepare(`SELECT e.type, e.target_key, e.title, e.body, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(dev) as any[])
  .map((r) => ({ line: `${r.type} | ${r.target_key} | ${r.title}`, body: withLines(r.body, r.extra ? JSON.parse(r.extra) : null) }));

// ── Fake ESPN: a sprint; the grid; each car's status; the scoreboard's order once it's over.
const EV = 'E1', SR = 'SR1';
const GRID = ['LEC', 'NOR', 'COL', 'HAM', 'PIA', 'BEA', 'ALB', 'OCO', 'GAS', 'SAI', 'BOT', 'PER'];
const status: Record<string, { name: string; description: string; period: number }> = Object.fromEntries(GRID.map((id) => [id, { name: 'STATUS_ON_TRACK', description: 'On Track', period: 1 }]));
const sprint: any = { id: SR, type: { abbreviation: 'SR' }, date: new Date(Date.now() + 60_000).toISOString(), status: { type: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false } } };
let order: string[] = []; // the scoreboard's, once ESPN has one
const quali: any = { id: 'Q1', type: { abbreviation: 'Qual' }, date: new Date(Date.now() - 3600_000).toISOString(), status: { type: { state: 'in', name: 'STATUS_IN_PROGRESS', completed: false } } };
let withQuali = false;
let standings: Record<string, number> = {};
F.f1Deps.getJson = async (url: string) => {
  if (url === urls.scoreboard('f1')) return { events: [{ id: EV, shortName: 'Test GP', competitions: [{ ...sprint, competitors: order.map((id, i) => ({ id, order: i + 1 })) }, ...(withQuali ? [quali] : [])] }] };
  if (url === urls.f1Competitors(EV, SR) || url === urls.f1Competitors(EV, 'Q1')) return { items: GRID.map((id) => ({ $ref: `fake://car/${id}` })) };
  let m = url.match(/^fake:\/\/car\/(\w+)$/);
  if (m) return { id: m[1], order: GRID.indexOf(m[1]) + 1, startOrder: GRID.indexOf(m[1]) + 1, vehicle: { manufacturer: teamOfCar[m[1]] }, status: { $ref: `fake://status/${m[1]}` } };
  m = url.match(/^fake:\/\/status\/(\w+)$/) ?? url.match(/competitors\/(\w+)\/status$/);
  if (m) { const s = status[m[1]]; return { type: { name: s.name, description: s.description }, period: s.period }; }
  if (url === urls.standings('f1')) return { children: [{ name: 'Driver Standings', standings: { entries: Object.entries(standings).map(([id, rank]) => ({ athlete: { id }, stats: [{ name: 'rank', value: rank }, { type: 'points', displayValue: String(100 - rank) }] })) } }] };
  throw new Error(`unexpected fetch ${url}`);
};
F.f1Deps.setTimeout = () => undefined;
const settle = () => new Promise((r) => setTimeout(r, 40));
const tally = (dev: string) => (db.prepare('SELECT COUNT(*) AS n FROM hate_watches WHERE device_id = ?').get(dev) as { n: number }).n;

test('lights out: one "Hate Watch Starting" for a device, naming its constructors and drivers in the sprint, the back of the grid on it; one notification', async () => {
  await F.scanF1(); // seen before the start
  sprint.status.type = { state: 'in', name: 'STATUS_IN_PROGRESS', completed: false };
  await F.scanF1();
  await settle();
  for (const dev of ['all', 'gasly', 'alpine', 'cadbot', 'bottas']) assert.equal(feed(dev).length, 1, `${dev}: one start alert`);
  assert.deepEqual(feed('all')[0], { line: 'team.game_start | team:f1:ALP | Hate Watch Starting: Test GP · Sprint',
    body: 'Yours: Alpine, Cadillac, Ferrari, Haas, McLaren and 13 more. Valtteri Bottas starts from the back of the grid (P11). Sergio Pérez starts from the back of the grid (P12). Lights out.' });
  assert.deepEqual(feed('gasly')[0], { line: 'f1.driver.session_start | player:f1:GAS | Hate Watch Starting: Test GP · Sprint', body: 'Yours: Pierre Gasly. Lights out.' }, 'a driver tracker gets it too');
  assert.equal(feed('alpine')[0].body, 'Yours: Alpine. Lights out.');
  assert.equal(feed('cadbot')[0].body, 'Yours: Cadillac, Valtteri Bottas. Valtteri Bottas starts from the back of the grid (P11). Lights out.');
  assert.deepEqual(['all', 'gasly', 'alpine', 'cadbot', 'bottas'].map((d) => pushedTo(d).length), [1, 1, 1, 1, 1], 'one notification each');
});

test("live: the second car out is the team's double DNF, which takes in that driver's DNF for a device tracking both", async () => {
  pushes = [];
  await F.races.get(SR)!.poll(); // RaceWatch's baseline (its first poll at the start may not have run)
  Object.assign(status.PER, { name: 'STATUS_RETIRED', description: 'Retired', period: 1 });
  await F.races.get(SR)!.poll();
  Object.assign(status.BOT, { name: 'STATUS_RETIRED', description: 'Retired', period: 6 });
  await F.races.get(SR)!.poll();
  assert.deepEqual(feed('all').slice(1).map((r) => r.line), ['f1.driver.dnf | player:f1:PER | Sergio Pérez retired on lap 1', 'f1.team.double_dnf | team:f1:CAD | Cadillac: double DNF'],
    "Bottas's DNF is in the double DNF");
  assert.equal(feed('all')[2].body, 'Test GP · Sprint: Sergio Pérez retired on lap 1; Valtteri Bottas retired on lap 6');
  assert.deepEqual(feed('cadbot').slice(1).map((r) => r.line), ['f1.team.double_dnf | team:f1:CAD | Cadillac: double DNF']);
  assert.deepEqual(feed('bottas').slice(1).map((r) => r.line), ['f1.driver.dnf | player:f1:BOT | Valtteri Bottas retired on lap 6'], 'tracking just Bottas: his');
  assert.deepEqual([pushedTo('all').length, pushedTo('cadbot').length], [2, 1]);
});

test('the sprint over ("session complete", not yet final): results on the scoreboard\'s order; Alpine out of the points takes in Gasly\'s; one notification for the lot', async () => {
  pushes = [];
  for (const id of GRID.filter((x) => !['BOT', 'PER'].includes(x))) Object.assign(status[id], { name: 'STATUS_CLASSIFIED', description: 'Classified', period: 20 });
  order = ['LEC', 'HAM', 'NOR', 'PIA', 'ALB', 'SAI', 'OCO', 'BEA', 'GAS', 'COL', 'BOT', 'PER'];
  sprint.status.type = { state: 'in', name: 'STATUS_SESSION_COMPLETE', completed: false };
  await F.scanF1();
  assert.deepEqual(feed('all').slice(3).map((r) => r.line), [
    'f1.team.no_points | team:f1:ALP | Successful Hate Watch! Alpine finished outside the points',
    'f1.driver.out_of_points | player:f1:COL | Franco Colapinto finished P10 from P3 on the grid: no points, behind teammate Pierre Gasly (P9)',
    'f1.driver.beaten_by_teammate | player:f1:HAM | Lewis Hamilton finished P2: behind teammate Charles Leclerc (P1)',
    'f1.driver.beaten_by_teammate | player:f1:PIA | Oscar Piastri finished P4: behind teammate Lando Norris (P3)',
    'f1.driver.beaten_by_teammate | player:f1:BEA | Oliver Bearman finished P8: behind teammate Esteban Ocon (P7)',
    'f1.driver.beaten_by_teammate | player:f1:SAI | Carlos Sainz finished P6: behind teammate Alexander Albon (P5)',
  ], "the team first; Gasly's only \"no points\" is in Alpine's (Colapinto's says more); the DNFs and double DNF sent live aren't again");
  assert.equal(feed('all')[3].body, 'Test GP · Sprint: Pierre Gasly P9, Franco Colapinto P10');
  assert.deepEqual(pushedTo('all').map((p) => [p.title, p.body.split('\n').length, p.data.count]), [['🏁 Test GP · Sprint: 6 alerts', 6, 6]], 'one notification, a line each');
  assert.deepEqual(feed('gasly').slice(1).map((r) => r.line), ['f1.driver.out_of_points | player:f1:GAS | Pierre Gasly finished P9: no points'], 'tracking Gasly alone: his own');
  assert.deepEqual([tally('all'), tally('alpine')], [2, 1], "Alpine's (and Cadillac's double DNF for everyone-tracked) on the Hate Watch tally");
  await F.scanF1();
  assert.equal(feed('all').length, 9, 'the same order again: nothing re-read');
});

test("a penalty after: corrected once the new order holds a second scan; what changed in place (no push), what's new sent, what's no longer true withdrawn", async () => {
  pushes = [];
  order = ['LEC', 'HAM', 'PIA', 'ALB', 'SAI', 'NOR', 'OCO', 'GAS', 'BEA', 'COL', 'BOT', 'PER']; // Norris down to P6, Gasly up to P8
  sprint.status.type = { state: 'post', name: 'STATUS_FINAL', completed: true };
  await F.scanF1();
  assert.equal(feed('all').length, 9, 'not on one scan');
  await F.scanF1();
  const all = feed('all');
  assert.deepEqual(all.slice(3).map((r) => r.line), [
    'f1.team.no_points | team:f1:ALP | Correction: Alpine finished P8, P10',
    'f1.driver.out_of_points | player:f1:COL | Franco Colapinto finished P10 from P3 on the grid: no points, behind teammate Pierre Gasly (P8)',
    'f1.driver.beaten_by_teammate | player:f1:HAM | Lewis Hamilton finished P2: behind teammate Charles Leclerc (P1)',
    'f1.driver.beaten_by_teammate | player:f1:PIA | Correction: Oscar Piastri finished P3',
    'f1.driver.out_of_points | player:f1:BEA | Oliver Bearman finished P9 from P6 on the grid: no points, behind teammate Esteban Ocon (P7)',
    'f1.driver.beaten_by_teammate | player:f1:SAI | Carlos Sainz finished P5: behind teammate Alexander Albon (P4)',
    'f1.driver.lost_places | player:f1:NOR | Lando Norris finished P6 from P2 on the grid: behind teammate Oscar Piastri (P3)',
  ], 'Alpine and Piastri withdrawn; Colapinto, Bearman and Sainz corrected in place; Hamilton as he was; Norris new');
  assert.equal(all[3].body, 'Test GP · Sprint: the result changed after this alert.');
  assert.deepEqual(feed('gasly').at(-1)?.line, 'f1.driver.out_of_points | player:f1:GAS | Correction: Pierre Gasly finished P8');
  assert.deepEqual(pushedTo('all').map((p) => p.title), ['🔻 Lando Norris finished P6 from P2 on the grid: behind teammate Oscar Piastri (P3)'], 'only the new one is pushed');
  assert.deepEqual(pushedTo('gasly'), []);
  assert.deepEqual([tally('all'), tally('alpine')], [1, 0], "Alpine's withdrawn: off the tally (Cadillac's stands)");
  await F.scanF1();
  await F.scanF1();
  assert.equal(feed('all').length, 10, 'settled: nothing more');
});

test('a restart: the stored results read again change nothing; alerts stored before they had facts are left alone', () => {
  const meta = { compId: SR, kind: 'sprint' as const, label: 'Test GP · Sprint', at: Date.now() };
  const rows = order.map((id, i) => ({ id, order: i + 1, grid: GRID.indexOf(id) + 1, out: ['BOT', 'PER'].includes(id), outLabel: 'Retired', lap: id === 'PER' ? 1 : id === 'BOT' ? 6 : 20, teamKey: `team:f1:${Object.entries(TEAMS).find(([, [, ds]]) => ds.some(([d]) => d === id))![0]}` }));
  const again = F.settleResults(meta, F.f1SessionResults(meta, rows), rows);
  assert.deepEqual([again.fresh.length, again.revised, again.withdrawn], [0, 0, 0]);
  db.prepare(`INSERT INTO events (id, type, league, game_id, target_key, title, body, occurred_at, detected_at, meta) VALUES ('Q9:f1.finish:LEC', 'f1.driver.lost_places', 'f1', 'Q9', 'player:f1:LEC', 'old words', 'x', 0, 0, '{}')`).run();
  const old = F.settleResults({ ...meta, compId: 'Q9' }, [], rows);
  assert.deepEqual([old.revised, old.withdrawn, (db.prepare(`SELECT title FROM events WHERE id = 'Q9:f1.finish:LEC'`).get() as { title: string }).title], [0, 0, 'old words']);
});

test("a championship drop: a line on that day's alert about them (no new row, no push); with none, an alert of its own", async () => {
  pushes = [];
  standings = { NOR: 5, ALB: 15, VER: 6 };
  await F.scanF1Standings(); // the baseline
  standings = { NOR: 6, ALB: 16, VER: 5 };
  await F.scanF1Standings();
  const all = feed('all');
  assert.equal(all.find((r) => r.line.includes('player:f1:NOR'))!.body, "Down to 6th in the drivers' championship (94 pts). Test GP · Sprint");
  assert.deepEqual(all.filter((r) => r.line.includes('standings_drop')).map((r) => r.line), ["f1.driver.standings_drop | player:f1:ALB | Alexander Albon dropped to 16th in the drivers' championship"],
    "Albon had no alert today: his drop is its own (Norris's is a line)");
  assert.deepEqual(pushes, [], 'drops are feed-only by default');
});

test('qualifying waits for the final: ESPN\'s "session complete" may come between Q1, Q2 and Q3', async () => {
  withQuali = true;
  const qualiAlerts = () => (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE id LIKE 'Q1:%'`).get() as { n: number }).n;
  quali.status.type = { state: 'in', name: 'STATUS_SESSION_COMPLETE', completed: false };
  await F.scanF1();
  assert.equal(qualiAlerts(), 0, 'not at "session complete"');
  quali.status.type = { state: 'post', name: 'STATUS_FINAL', completed: true };
  await F.scanF1();
  assert.ok(qualiAlerts() > 0, 'at the final');
  withQuali = false;
});
