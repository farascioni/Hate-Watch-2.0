// Drives a whole simulated race weekend through the REAL F1 engine (scoreboard scan → live status
// polling → chequered flag → re-scan) with fake ESPN responses, and checks exactly what lands in a
// follower's feed at each step. Covers the live path that can't be exercised outside a real race.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { urls } = await import('../src/leagues.ts');
const { f1Deps, scanF1, races } = await import('../src/f1.ts');

// ── Catalog: Cadillac (Bottas, Pérez) and Ferrari (Leclerc, Hamilton)
const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, 'f1', ?, ?, ?, ?, ?, 'badge://f1', 512, 512, 0)`);
team.run('team:f1:CAD', 'CAD', 'Cadillac', 'Cadillac', 'CAD', '#A2AAAD');
team.run('team:f1:FER', 'FER', 'Ferrari', 'Ferrari', 'FER', '#DC0000');
const driver = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, jersey, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'f1', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
driver.run('player:f1:BOT', 'BOT', 'Valtteri Bottas', 'team:f1:CAD', '77');
driver.run('player:f1:PER', 'PER', 'Sergio Pérez', 'team:f1:CAD', '11');
driver.run('player:f1:LEC', 'LEC', 'Charles Leclerc', 'team:f1:FER', '16');
driver.run('player:f1:HAM', 'HAM', 'Lewis Hamilton', 'team:f1:FER', '44');
loadCatalog();

// ── A user who tracks the Cadillac team, Bottas, and Leclerc (not Pérez, not Hamilton)
db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)').run('dev', 's', 'test', JSON.stringify(DEFAULT_PREFS));
for (const k of ['team:f1:CAD', 'player:f1:BOT', 'player:f1:LEC']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('dev', k);
// In delivery order (rowid): the simulated race runs fast enough for several alerts to share a millisecond.
const feed = () => (db.prepare(`SELECT e.type, e.target_key, e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'dev' ORDER BY f.rowid`).all() as any[])
  .map((r) => `${r.type} | ${r.target_key} | ${r.title}`);

// ── Fake ESPN
const EV = 'E1', RACE = 'R1';
const cars: Record<string, { order: number; grid: number; team: string }> = {
  LEC: { order: 0, grid: 1, team: 'Ferrari' }, HAM: { order: 0, grid: 3, team: 'Ferrari' },
  BOT: { order: 0, grid: 18, team: 'Cadillac' }, PER: { order: 0, grid: 20, team: 'Cadillac' },
};
const status: Record<string, { name: string; description: string; period: number }> = {};
for (const id of Object.keys(cars)) status[id] = { name: 'STATUS_IN_PROGRESS', description: 'In Progress', period: 1 };
const race = { id: RACE, type: { abbreviation: 'Race', text: 'Race' }, date: new Date(Date.now() - 3600_000).toISOString(), status: { type: { state: 'in', completed: false } } };
// An old, already-finished race from days ago must never be announced (e.g. right after a deploy).
const oldRace = { id: 'OLD', type: { abbreviation: 'Race', text: 'Race' }, date: new Date(Date.now() - 3 * 86400_000).toISOString(), status: { type: { state: 'post', completed: true } } };
const sessions: any[] = [oldRace, race];
const fetched: string[] = [];
f1Deps.getJson = async (url: string) => {
  fetched.push(url);
  if (url === urls.scoreboard('f1')) return { events: [{ id: EV, shortName: 'Test GP', competitions: sessions }] };
  if (url === urls.f1Competitors(EV, RACE)) return { items: Object.keys(cars).map((id) => ({ $ref: `fake://car/${id}` })) };
  let m = url.match(/^fake:\/\/car\/(\w+)$/);
  if (m) { const c = cars[m[1]]; return { id: m[1], order: c.order, startOrder: c.grid, vehicle: { manufacturer: c.team }, status: { $ref: `fake://status/${m[1]}` } }; }
  m = url.match(/^fake:\/\/status\/(\w+)$/) ?? url.match(new RegExp(`competitors/(\\w+)/status$`));
  if (m) { const s = status[m[1]]; return { type: { name: s.name, description: s.description }, period: s.period }; }
  throw new Error(`unexpected fetch ${url}`);
};
f1Deps.setTimeout = () => undefined; // the test drives each poll itself
const settle = () => new Promise((r) => setTimeout(r, 30));

test('a simulated race goes through the real F1 engine end to end', async () => {
  // 1. Lights out: the scan starts watching the race. The first status poll is a silent baseline.
  await scanF1();
  await settle();
  assert.ok(races.has(RACE), 'race is being watched');
  assert.deepEqual(feed(), [], 'nothing on the baseline poll');
  assert.ok(!fetched.some((u) => u.includes('/OLD/')), 'the days-old race is never fetched or announced');

  // 2. Lap 7: Bottas retires → instant DNF alert (user follows Bottas).
  Object.assign(status.BOT, { name: 'STATUS_RETIRED', description: 'Retired', period: 7 });
  await races.get(RACE)!.poll();
  assert.deepEqual(feed(), ['f1.driver.dnf | player:f1:BOT | Valtteri Bottas retired on lap 7']);

  // 3. Lap 30: Pérez retires too → Cadillac double DNF (user follows the team, not Pérez himself).
  Object.assign(status.PER, { name: 'STATUS_RETIRED', description: 'Retired', period: 30 });
  await races.get(RACE)!.poll();
  assert.deepEqual(feed().slice(1), ['f1.team.double_dnf | team:f1:CAD | Cadillac: double DNF']);

  // 4. Polling again changes nothing: no repeats.
  await races.get(RACE)!.poll();
  assert.equal(feed().length, 2);

  // 5. Chequered flag: Hamilton P1, Leclerc P2 (from pole, behind his teammate).
  Object.assign(cars.HAM, { order: 1 }); Object.assign(cars.LEC, { order: 2 });
  Object.assign(cars.BOT, { order: 21 }); Object.assign(cars.PER, { order: 22 });
  for (const id of ['HAM', 'LEC']) Object.assign(status[id], { name: 'STATUS_CLASSIFIED', description: 'Classified' });
  race.status.type = { state: 'post', completed: true };
  await scanF1();
  assert.ok(!races.has(RACE), 'stopped watching once finished');
  assert.deepEqual(feed().slice(2), ['f1.driver.beaten_by_teammate | player:f1:LEC | Charles Leclerc finished P2: behind teammate Lewis Hamilton (P1)'],
    'final results add only what is new: the DNFs and double DNF already sent are not repeated');

  // 6. Later scans don't re-announce the race.
  await scanF1();
  assert.equal(feed().length, 3);
  // (Step 1 also proved a race found already running gets no late "Hate Watch Starting".)
});

test('lights out on a race seen beforehand: "Hate Watch Starting" for followed teams only, once', async () => {
  const sprint = { id: 'S1', type: { abbreviation: 'Sprint', text: 'Sprint' }, date: new Date(Date.now() + 60_000).toISOString(), status: { type: { state: 'pre', completed: false } } };
  sessions.push(sprint);
  const before = feed().length;
  await scanF1(); // before the start
  assert.equal(feed().length, before);

  sprint.status.type.state = 'in';
  await scanF1();
  await settle();
  assert.deepEqual(feed().slice(before), ['team.game_start | team:f1:CAD | Hate Watch Starting: Cadillac'],
    'the user follows Cadillac (not Ferrari, and drivers are not teams)');

  await scanF1();
  assert.equal(feed().length, before + 1, 'announced once');
});
