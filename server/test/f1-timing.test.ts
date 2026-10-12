// A running race's timing (ESPN's core API: each car's place, gap, laps down and pit stops; the lap and the flag)
// through the real F1 engine with fake ESPN: the Scores tab's running order with gaps, and a followed driver's live
// alerts (a pit stop, getting lapped, falling places behind their grid slot, not for a pit cycle), which their
// finish alert then doesn't count again.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_F1_BOARD_MS = '0';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { urls } = await import('../src/leagues.ts');
const { getGame } = await import('../src/scores.ts');
const F = await import('../src/f1.ts');

// ── Four constructors, six cars
const TEAMS: Record<string, [string, [string, string][]]> = {
  RBR: ['Red Bull', [['VER', 'Max Verstappen']]], FER: ['Ferrari', [['LEC', 'Charles Leclerc'], ['HAM', 'Lewis Hamilton']]],
  MCL: ['McLaren', [['NOR', 'Lando Norris'], ['PIA', 'Oscar Piastri']]], AST: ['Aston Martin', [['STR', 'Lance Stroll']]],
};
const teamRow = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'f1', ?, ?, ?, ?, 'badge://f1', 512, 512, 0)`);
const driverRow = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'f1', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
const teamOfCar: Record<string, string> = {};
for (const [id, [name, drivers]] of Object.entries(TEAMS)) {
  teamRow.run(`team:f1:${id}`, id, name, name, id);
  for (const [d, dn] of drivers) { driverRow.run(`player:f1:${d}`, d, dn, `team:f1:${id}`); teamOfCar[d] = name; }
}
loadCatalog();

// ── A user who tracks Leclerc, Norris and Stroll
db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)').run('dev', 's', 'test', JSON.stringify(DEFAULT_PREFS));
for (const k of ['player:f1:LEC', 'player:f1:NOR', 'player:f1:STR']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('dev', k);
const feed = () => (db.prepare(`SELECT e.type, e.title, e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'dev' ORDER BY f.rowid`).all() as any[])
  .map((r) => `${r.type} | ${r.title} | ${r.body}`);

// ── Fake ESPN: the timing as each read sees it
const EV = 'E1', RACE = 'R1';
const GRID = { VER: 1, LEC: 2, NOR: 3, HAM: 4, PIA: 5, STR: 6 } as Record<string, number>;
interface Car { place: number; gap?: string; lapsDown: number; pits: number; out?: number }
let cars: Record<string, Car> = {};
let lap = 0, flag = 'GREEN', state: 'in' | 'post' = 'in';
/** One read: the order, each car's gap ("1L" a lap down) and stops. */
const timing = (l: number, order: [string, string, number][], f = 'GREEN') => {
  lap = l; flag = f;
  cars = Object.fromEntries(order.map(([id, gap, pits], i) => [id, {
    place: i + 1, pits, lapsDown: gap === '1L' ? 1 : 0, ...(gap && gap !== '1L' && !gap.startsWith('out') ? { gap } : {}), ...(gap.startsWith('out') ? { out: Number(gap.slice(4)) } : {}),
  }]));
};
const stats = (c: Car) => ({ splits: { categories: [
  { name: 'general', stats: [{ name: 'place', value: c.place }, { name: 'pitsTaken', value: c.pits }, ...(c.lapsDown ? [{ name: 'behindLaps', value: c.lapsDown }] : [])] },
  { name: 'gapToLeader', stats: [{ name: 'position', value: c.place }, ...(c.gap ? [{ name: 'gapToLeader', displayValue: c.gap }] : []), ...(c.lapsDown ? [{ name: 'lapsBehind', value: c.lapsDown }] : [])] },
] } });
const status = (c: Car) => (c.out ? { type: { name: 'STATUS_RETIRED', description: 'Retired' }, period: c.out }
  : { type: { name: state === 'in' ? 'STATUS_ON_TRACK' : 'STATUS_FINISHED', description: 'On Track' }, period: lap });
const competitor = (id: string) => ({ $ref: `fake://car/${id}`, id, order: cars[id].place, startOrder: GRID[id], vehicle: { manufacturer: teamOfCar[id] }, status: { $ref: `fake://status/${id}` }, statistics: { $ref: `fake://stats/${id}` } });
const race = () => ({
  id: RACE, type: { abbreviation: 'Race', text: 'Race' }, date: new Date(Date.now() - 3600_000).toISOString(),
  status: { period: lap, type: state === 'in' ? { state: 'in', completed: false, name: 'STATUS_IN_PROGRESS' } : { state: 'post', completed: true, name: 'STATUS_FINAL' } },
  competitors: Object.keys(cars).map((id) => ({ id, order: cars[id].place, athlete: { displayName: id } })),
});
F.f1Deps.getJson = async (url: string) => {
  if (url === urls.scoreboard('f1')) return { events: [{ id: EV, shortName: 'Test GP', competitions: [race()] }] };
  if (url === urls.f1Competitors(EV, RACE)) return { items: Object.keys(cars).map(competitor) };
  if (url === urls.f1SessionStatus(EV, RACE)) return { period: lap, flag, type: { name: 'STATUS_IN_PROGRESS' } };
  if (url === urls.f1SessionStats(EV, RACE)) return { name: 'All Splits', categories: [{ name: 'general', stats: [{ name: 'laps', value: 62 }, { name: 'length', value: 305 }] }] };
  let m = url.match(/competitors\/(\w+)\/statistics$/) ?? url.match(/^fake:\/\/stats\/(\w+)$/);
  if (m) return stats(cars[m[1]]);
  m = url.match(/competitors\/(\w+)\/status$/) ?? url.match(/^fake:\/\/status\/(\w+)$/);
  if (m) return status(cars[m[1]]);
  m = url.match(/^fake:\/\/car\/(\w+)$/);
  if (m) return competitor(m[1]);
  throw new Error(`unexpected fetch ${url}`);
};
F.f1Deps.setTimeout = () => undefined; // the test drives each read itself
const settle = () => new Promise((r) => setTimeout(r, 30));
const read = async () => { await F.races.get(RACE)!.readBoard(); };
const order = () => getGame(`f1:${RACE}`)!.order!.map((d) => [d.name, d.position, d.gap ?? d.out ?? '', d.interval ?? '', d.grid, d.pits].join(' '));

test('the running order has the timing; followed drivers get their pit stops, getting lapped and lost places live', async () => {
  // Lap 10: the first read is a baseline (we may have come in mid-race).
  timing(10, [['VER', '', 0], ['NOR', '+2.104', 0], ['LEC', '+3.250', 0], ['PIA', '+9.8', 0], ['HAM', '+1:02.007', 0], ['STR', '+1:20.5', 0]]);
  await F.scanF1();
  await settle();
  assert.ok(F.races.has(RACE));
  assert.deepEqual(feed(), []);
  const card = getGame(`f1:${RACE}`)!;
  assert.equal(card.detail, 'Lap 10 of 62');
  assert.equal(card.lap, 10);
  assert.equal(card.laps, 62);
  assert.deepEqual(order(), [
    'Max Verstappen 1   1 0', 'Lando Norris 2 +2.104  3 0', 'Charles Leclerc 3 +3.250 +1.146 2 0',
    'Oscar Piastri 4 +9.8 +6.550 5 0', 'Lewis Hamilton 5 +1:02.007 +52.207 4 0', 'Lance Stroll 6 +1:20.5 +18.493 6 0',
  ]);

  // Lap 11: Leclerc pits (ESPN counts the stop; he's still P3). Lap 12: he's out P5, and Stroll has been lapped.
  timing(11, [['VER', '', 0], ['NOR', '+2.5', 0], ['LEC', '+3.9', 1], ['PIA', '+10.1', 0], ['HAM', '+1:03.0', 0], ['STR', '+1:31.0', 0]]);
  await read();
  assert.deepEqual(feed(), [], 'the stop is told with where he came out');
  timing(12, [['VER', '', 0], ['NOR', '+2.6', 0], ['PIA', '+10.4', 0], ['HAM', '+1:03.4', 0], ['LEC', '+1:05.0', 1], ['STR', '1L', 0]]);
  await read();
  assert.deepEqual(feed(), ['f1.driver.pit_stop | Charles Leclerc pitted and dropped from P3 to P5 | Test GP · Race: lap 11, 1st stop'],
    'P5 from P2 on the grid, but only until the others stop: no lost places');
  assert.equal(getGame(`f1:${RACE}`)!.order!.at(-1)!.gap, '+1 lap');

  // Lap 13, under the safety car: Stroll still a lap down, two reads in a row.
  timing(13, [['VER', '', 0], ['NOR', '+1.0', 0], ['PIA', '+2.0', 0], ['HAM', '+3.0', 0], ['LEC', '+4.0', 1], ['STR', '1L', 0]], 'SAFETY_CAR');
  await read();
  assert.equal(feed().length, 2);
  assert.equal(feed()[1], 'f1.driver.lapped | Lance Stroll was lapped by Max Verstappen | Test GP · Race: lap 13, running P6');
  assert.equal(getGame(`f1:${RACE}`)!.detail, 'Lap 13 of 62 · Safety car');
  assert.equal(getGame(`f1:${RACE}`)!.flag, 'Safety car');

  // Lap 20: the others have stopped and Leclerc is still P5: three of those who started behind him are ahead,
  // having stopped as often. Norris's and Stroll's stops are told a read later.
  // (Three of the field stop first, a read of their own: a stop for nearly every car in one read is the field being counted.)
  timing(16, [['VER', '', 1], ['NOR', '+1.2', 0], ['PIA', '+3.0', 1], ['HAM', '+5.0', 1], ['LEC', '+8.0', 1], ['STR', '1L', 0]]);
  await read();
  for (const l of [20, 21, 22]) {
    timing(l, [['VER', '', 1], ['PIA', '+3.0', 1], ['HAM', '+5.0', 1], ['NOR', '+6.0', 1], ['LEC', '+8.0', 1], ['STR', '1L', 1]]);
    await read();
  }
  assert.deepEqual(feed().slice(2), [
    'f1.driver.pit_stop | Lando Norris pitted and dropped from P2 to P4 | Test GP · Race: lap 20, 1st stop',
    'f1.driver.pit_stop | Lance Stroll pitted and held P6 | Test GP · Race: lap 20, 1st stop',
    'f1.driver.lost_places | Charles Leclerc is down to P5 from P2 on the grid | Test GP · Race: lap 22',
  ]);
  assert.equal(getGame(`f1:${RACE}`)!.flag, undefined, 'green again');
  assert.equal(getGame(`f1:${RACE}`)!.detail, 'Lap 22 of 62');

  // More of the same: nothing again. Hamilton retires: out, at the bottom.
  timing(40, [['VER', '', 1], ['PIA', '+3.0', 1], ['NOR', '+6.0', 1], ['LEC', '+8.0', 1], ['STR', '1L', 1], ['HAM', 'out 38', 1]]);
  await read();
  await read();
  assert.equal(feed().length, 5);
  assert.deepEqual(order().slice(-2), ['Lance Stroll 5 +1 lap  6 1', 'Lewis Hamilton 6 Retired on lap 38  4 1']);

  // The flag: the classification is the scoreboard's; where each started, the stops and who went out stay, the gaps go.
  // Stroll's lap down was told live: in the points, his finish has nothing more to tell. Norris behind Piastri is the finish's.
  state = 'post';
  timing(62, [['VER', '', 1], ['PIA', '+3.0', 1], ['NOR', '+6.0', 1], ['LEC', '+8.0', 1], ['STR', '1L', 1], ['HAM', 'out 38', 1]]);
  await F.scanF1();
  await settle();
  const final = getGame(`f1:${RACE}`)!;
  assert.equal(final.detail, 'Final');
  assert.equal(final.lap, undefined);
  assert.deepEqual(order(), ['Max Verstappen 1   1 1', 'Oscar Piastri 2   5 1', 'Lando Norris 3   3 1', 'Charles Leclerc 4   2 1', 'Lance Stroll 5   6 1', 'Lewis Hamilton 6 Retired on lap 38  4 1']);
  assert.deepEqual(feed().slice(5), ['f1.driver.beaten_by_teammate | Lando Norris finished P3: behind teammate Oscar Piastri (P2) | Test GP · Race']);
});

test('a finish alert leaves out what was told live, but still says it', () => {
  const meta = { compId: 'X', kind: 'race' as const, label: 'Test GP · Race', at: 0 };
  const rows = [
    { id: 'VER', order: 1, grid: 1, out: false, outLabel: '', lap: null, teamKey: 'team:f1:RBR' },
    { id: 'LEC', order: 12, grid: 2, out: false, outLabel: '', lap: null, teamKey: 'team:f1:FER' },
    { id: 'HAM', order: 3, grid: 4, out: false, outLabel: '', lap: null, teamKey: 'team:f1:FER' },
    { id: 'STR', order: 8, grid: 9, out: false, outLabel: '', lap: null, teamKey: 'team:f1:AST', lapsDown: 1 },
  ];
  const before = F.f1SessionResults(meta, rows).map((e) => [e.type, ...(e.aliases ?? [])].join('+'));
  assert.deepEqual(before, ['f1.driver.out_of_points+f1.driver.lost_places+f1.driver.beaten_by_teammate', 'f1.driver.lapped']);
  const after = F.f1SessionResults(meta, rows, { lapped: new Set(['STR']), lost: new Set(['LEC']) });
  assert.deepEqual(after.map((e) => [e.type, ...(e.aliases ?? [])].join('+')), ['f1.driver.out_of_points+f1.driver.beaten_by_teammate']);
  assert.equal(after[0].title, 'Charles Leclerc finished P12: no points, behind teammate Lewis Hamilton (P3)', 'the places lost were told live: not said again');
  assert.equal(before[0] && F.f1SessionResults(meta, rows)[0].title, 'Charles Leclerc finished P12 from P2 on the grid: no points, behind teammate Lewis Hamilton (P3)', 'told here when they were not told live');
});

test('places lost: not for a pit cycle', () => {
  const car = (id: string, place: number, grid: number, pits: number, out = false) => ({ id, place, grid, pits, out, lapsDown: 0, outLabel: '', outLap: null });
  const d = car('D', 6, 3, 1);
  // Three who started behind are ahead, but two of them haven't stopped yet.
  assert.equal(F.placesLost(d, [d, car('A', 1, 4, 0), car('B', 2, 5, 0), car('C', 3, 6, 1), car('E', 4, 1, 1), car('F', 5, 2, 1)]), 1);
  // One who started ahead is behind, out: a place gained for good. One behind while stopping more: not.
  assert.equal(F.placesLost(d, [d, car('A', 1, 4, 1), car('B', 2, 5, 1), car('C', 3, 6, 1), car('E', 7, 1, 1, true), car('F', 8, 2, 2)]), 2);
});

test("the flag as ESPN has it, readable; none while it's green", () => {
  for (const [raw, label] of [['GREEN', undefined], ['', undefined], ['green_flag', undefined], ['SAFETY_CAR', 'Safety car'], ['RED', 'Red flag'], ['YELLOW', 'Yellow flag'],
    ['VSC', 'VSC'], ['virtual safety car', 'Virtual safety car'], ['CHECKER', 'Chequered flag'], ['CHEQUERED', 'Chequered flag']] as const) assert.equal(F.flagLabel(raw), label, raw);
});

test('nothing live on the last lap (a car the leader has finished ahead of looks a lap down) or after the flag', () => {
  const meta = { compId: 'Y', kind: 'race' as const, label: 'Test GP · Race', at: 0 };
  const car = (id: string, place: number, grid: number, lapsDown = 0) => ({ id, place, grid, pits: 1, lapsDown, out: false, outLabel: '', outLap: null });
  const cars = [car('VER', 1, 1), car('PIA', 2, 5), car('HAM', 3, 4), car('NOR', 4, 3), car('LEC', 5, 2, 1)];
  for (const [lap, over] of [[62, false], [62, true]] as const) {
    const memo = F.boardMemo(), board = { lap, laps: 62, flag: over ? 'CHECKER' : 'GREEN', cars, over };
    const alerts = [1, 2, 3, 4].flatMap(() => F.boardAlerts(meta, board, board, new Set(['LEC']), memo));
    assert.deepEqual(alerts, [], `lap ${lap}${over ? ', flag' : ''}`);
  }
  // A lap earlier: lapped (two reads) and down places (three).
  const memo = F.boardMemo(), board = { lap: 61, laps: 62, flag: 'GREEN', cars };
  assert.deepEqual([1, 2, 3].flatMap(() => F.boardAlerts(meta, board, board, new Set(['LEC']), memo)).map((e) => e.title),
    ['Charles Leclerc was lapped by Max Verstappen', 'Charles Leclerc is down to P5 from P2 on the grid']);
});
