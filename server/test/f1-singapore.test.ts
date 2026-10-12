// What the 2026 Singapore GP recording report found (docs/alerts.md "F1 how"): a stoppage that counts every car's
// pit stop at once, a parked car "lapped", results held a scan while a car still reads on track, and the
// championship drops told with the results (ESPN's table comes 22 minutes later, with the same ids).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { urls } = await import('../src/leagues.ts');
const F = await import('../src/f1.ts');

const teamRow = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'f1', ?, ?, ?, ?, 'badge://f1', 512, 512, 0)`);
const driverRow = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'f1', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
const DRIVERS: [string, string, string][] = [['VER', 'Max Verstappen', 'RBR'], ['HAD', 'Isack Hadjar', 'RBR'], ['LEC', 'Charles Leclerc', 'FER'], ['HAM', 'Lewis Hamilton', 'FER'],
  ['NOR', 'Lando Norris', 'MCL'], ['PIA', 'Oscar Piastri', 'MCL'], ['BOR', 'Gabriel Bortoleto', 'AUD'], ['HUL', 'Nico Hülkenberg', 'AUD']];
const TEAMS: Record<string, string> = { RBR: 'Red Bull', FER: 'Ferrari', MCL: 'McLaren', AUD: 'Audi' };
for (const [id, name] of Object.entries(TEAMS)) teamRow.run(`team:f1:${id}`, id, name, name, id);
for (const [id, name, t] of DRIVERS) driverRow.run(`player:f1:${id}`, id, name, `team:f1:${t}`);
loadCatalog();
db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)').run('dev', 's', 'test', JSON.stringify(DEFAULT_PREFS));
for (const k of ['player:f1:LEC', 'player:f1:BOR', 'player:f1:HUL', 'player:f1:HAM']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('dev', k);
const feed = () => (db.prepare(`SELECT e.type, e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'dev' ORDER BY f.rowid`).all() as any[]).map((r) => `${r.type} | ${r.title}`);

const meta = { compId: 'R', kind: 'race' as const, label: 'Test GP · Race', at: 0 };
const car = (id: string, place: number, grid: number, over: Partial<{ pits: number; lapsDown: number; laps: number; out: boolean }> = {}) =>
  ({ id, place, grid, pits: 0, lapsDown: 0, laps: 20, out: false, outLabel: '', outLap: null, ...over });

test('a stop for nearly every car in one read is the field being counted (a stoppage): no pit alerts; a real stop still is', () => {
  const memo = F.boardMemo();
  const ids = DRIVERS.map(([id]) => id);
  const board = (lap: number, pits: (id: string) => number) => ({ lap, laps: 20, flag: 'GREEN', cars: ids.map((id, i) => car(id, i + 1, i + 1, { pits: pits(id) })) });
  const watched = new Set(['LEC']);
  const b0 = board(3, () => 1), b1 = board(4, () => 2), b2 = board(5, () => 2), b3 = board(6, (id) => (id === 'LEC' ? 3 : 2)), b4 = board(7, (id) => (id === 'LEC' ? 3 : 2));
  assert.deepEqual(F.boardAlerts(meta, b0, b1, watched, memo), [], 'everyone +1 in one read');
  assert.deepEqual(F.boardAlerts(meta, b1, b2, watched, memo), [], 'and nothing a read later');
  assert.deepEqual(F.boardAlerts(meta, b2, b3, watched, memo), [], 'Leclerc alone stops: told a read later');
  assert.deepEqual(F.boardAlerts(meta, b3, b4, watched, memo).map((e) => e.title), ['Charles Leclerc pitted and held P3']);
});

test('a car whose laps stopped going up is parked: no "lapped" for it, until it moves again', () => {
  const memo = F.boardMemo();
  const cars = (laps: number, lapsDown: number) => [car('VER', 1, 1, { laps: 30 }), car('HAD', 2, 2, { laps: 30 }), car('HAM', 3, 3, { laps: 30 }), car('BOR', 8, 4, { laps, lapsDown })];
  const watched = new Set(['BOR']);
  const seen: string[] = [];
  let prev = { lap: 9, laps: 62, flag: 'GREEN', cars: cars(7, 0) };
  // Seven laps for ten reads (5 minutes), the last four with a lap down: parked, and ESPN has not called him out yet.
  for (let i = 0; i < 10; i++) {
    const cur = { lap: 9 + i, laps: 62, flag: 'GREEN', cars: cars(7, i >= 6 ? 1 : 0) };
    seen.push(...F.boardAlerts(meta, prev, cur, watched, memo).map((e) => e.title));
    prev = cur;
  }
  assert.deepEqual(seen, []);
  const moving = { lap: 19, laps: 62, flag: 'GREEN', cars: cars(8, 1) };
  assert.deepEqual(F.boardAlerts(meta, prev, moving, watched, memo).map((e) => e.title), ['Gabriel Bortoleto was lapped by Max Verstappen'], 'running again: lapped, once');
  assert.deepEqual(F.boardAlerts(meta, moving, moving, watched, memo), []);
});

// ── The engine: results wait a scan for a car ESPN still has on track.
let cars: Record<string, { order: number; grid: number; status: string; behind: number; team: string }> = {};
let phase: 'in' | 'complete' | 'final' = 'in';
let COMP = 'R9';
const scoreboardRace = () => ({
  id: COMP, type: { abbreviation: 'Race', text: 'Race' }, date: new Date(Date.now() - 3600_000).toISOString(),
  status: { period: 62, type: phase === 'in' ? { state: 'in', completed: false, name: 'STATUS_IN_PROGRESS' } : phase === 'complete' ? { state: 'in', completed: false, name: 'STATUS_SESSION_COMPLETE' } : { state: 'post', completed: true, name: 'STATUS_FINAL' } },
  competitors: Object.entries(cars).map(([id, c]) => ({ id, order: c.order, athlete: { displayName: id } })),
});
let espnTable: any = null; // the standings ESPN serves
F.f1Deps.getJson = async (url: string) => {
  if (url === urls.scoreboard('f1')) return { events: [{ id: 'E9', shortName: 'Test GP', competitions: [scoreboardRace()] }] };
  if (url === urls.f1Competitors('E9', COMP)) return { items: Object.keys(cars).map((id) => ({ $ref: `fake://car/${id}` })) };
  if (url === urls.standings('f1')) return espnTable;
  let m = url.match(/^fake:\/\/car\/(\w+)$/);
  if (m) return { id: m[1], order: cars[m[1]].order, startOrder: cars[m[1]].grid, vehicle: { manufacturer: TEAMS[cars[m[1]].team] }, status: { $ref: `fake://status/${m[1]}` }, statistics: { $ref: `fake://stats/${m[1]}` } };
  m = url.match(/^fake:\/\/status\/(\w+)$/);
  if (m) return { type: { name: cars[m[1]].status, description: 'x' }, period: 62 };
  m = url.match(/^fake:\/\/stats\/(\w+)$/);
  if (m) return { splits: { categories: [{ stats: [{ name: 'behindLaps', value: cars[m[1]].behind }] }] } };
  throw new Error(`unexpected fetch ${url}`);
};
F.f1Deps.setTimeout = () => undefined;

const GRIDS = ['VER', 'HAD', 'NOR', 'PIA', 'LEC', 'HAM', 'HUL', 'BOR'];
const startCars = (behindHul: number) => Object.fromEntries(GRIDS.map((id, i) => [id, { order: i + 1, grid: i + 1, status: 'STATUS_ON_TRACK', behind: id === 'HUL' ? behindHul : 0, team: DRIVERS.find((d) => d[0] === id)![2] }]));
const finishedLines = () => feed().filter((l) => l.includes('finished'));

test('results wait one scan while a car still reads on track at "session complete", so its laps down are in them', async () => {
  COMP = 'R9';
  cars = startCars(1);
  phase = 'complete';
  await F.scanF1();
  assert.deepEqual(finishedLines(), [], "held: cars are still on track in ESPN's status");
  for (const c of Object.values(cars)) c.status = 'STATUS_CLASSIFIED';
  await F.scanF1();
  assert.deepEqual(finishedLines(), [
    'f1.driver.beaten_by_teammate | Lewis Hamilton finished P6: behind teammate Charles Leclerc (P5)',
    'f1.driver.lapped | Nico Hülkenberg finished P7: lapped',
    'f1.driver.beaten_by_teammate | Gabriel Bortoleto finished P8: behind teammate Nico Hülkenberg (P7)',
  ]);
});

test('a status that stays on track never holds the results for more than that one scan', async () => {
  COMP = 'R10';
  cars = startCars(1);
  phase = 'complete';
  await F.scanF1();
  const before = finishedLines().length;
  await F.scanF1();
  assert.ok(finishedLines().length > before, 'sent on the second scan, as ESPN had it');
});

test('the championship drops come with the results; ESPN\'s table a while later adds nothing, nor does a later re-read; constructors too', async () => {
  for (const k of ['player:f1:PIA', 'player:f1:NOR', 'player:f1:VER', 'team:f1:FER', 'team:f1:MCL', 'team:f1:RBR']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('dev', k);
  const entry = (id: string, rank: number, pts: number, team = false) => ({ [team ? 'team' : 'athlete']: { id }, stats: [{ name: 'rank', value: rank }, { type: 'points', displayValue: String(pts) }] });
  const table = (drivers: [string, number, number][], teams: [string, number, number][]) => ({ children: [
    { name: 'Driver Standings', standings: { entries: drivers.map((x) => entry(...x)) } },
    { name: 'Constructor Standings', standings: { entries: teams.map((x) => entry(x[0], x[1], x[2], true)) } }] });
  // The tables before the race: Leclerc 4th on 197, Verstappen 5th on 196. Verstappen wins, Leclerc is second.
  const drivers0: [string, number, number][] = [['HAM', 1, 300], ['NOR', 2, 250], ['PIA', 3, 212], ['LEC', 4, 197], ['VER', 5, 196]];
  const teams0: [string, number, number][] = [['FER', 1, 400], ['MCL', 2, 390], ['RBR', 3, 300]];
  espnTable = table(drivers0, teams0);
  await F.scanF1Standings(); // the baseline
  F.freezeStandings('R9'); // when the race went live
  const rows = [['VER', 1, 'RBR'], ['LEC', 2, 'FER'], ['HAM', 3, 'FER'], ['NOR', 4, 'MCL'], ['PIA', 5, 'MCL'], ['HAD', 6, 'RBR']].map(([id, order, t]) => ({ id: id as string, order: order as number, grid: order as number, out: false, outLabel: '', lap: null, teamKey: `team:f1:${t}` }));
  const meta9 = { compId: 'R9', kind: 'race' as const, label: 'Test GP · Race' };
  await F.projectStandings(meta9, rows);
  const drops = () => (db.prepare(`SELECT id, title, body FROM events WHERE id LIKE 'f1st:%' ORDER BY id`).all() as { id: string; title: string; body: string }[]);
  // Drivers: Verstappen 221 and Leclerc 215: Leclerc drops to 5th. Constructors: Ferrari 400+18+15 = 433 and McLaren 390+12+10 = 412, Red Bull 300+25+8 = 333: no drop.
  assert.deepEqual(drops().map((d) => [d.title, d.body]), [["Charles Leclerc dropped to 5th in the drivers' championship", 'Down from 4th · 215 pts']]);
  await F.projectStandings(meta9, rows);
  assert.equal(drops().length, 1, 'the same read again: the same id');
  // A constructors' drop: Red Bull passes McLaren when it scores more (a second race, its own session).
  const rows2 = [['VER', 1, 'RBR'], ['HAD', 2, 'RBR'], ['LEC', 3, 'FER'], ['HAM', 4, 'FER'], ['NOR', 5, 'MCL'], ['PIA', 6, 'MCL']].map(([id, order, t]) => ({ id: id as string, order: order as number, grid: order as number, out: false, outLabel: '', lap: null, teamKey: `team:f1:${t}` }));
  espnTable = table(drivers0, [['FER', 1, 400], ['MCL', 2, 390], ['RBR', 3, 380]]);
  await F.scanF1Standings();
  F.freezeStandings('R11');
  await F.projectStandings({ compId: 'R11', kind: 'race' as const, label: 'Test GP · Race' }, rows2);
  // Red Bull 380+25+18 = 423 passes McLaren 390+10+8 = 408 (Ferrari 400+15+12 = 427 stays first).
  assert.ok(drops().some((d) => d.title === "McLaren dropped to 3rd in the constructors' championship" && d.body === 'Down from 2nd · 408 pts'), JSON.stringify(drops().map((d) => d.title)));
  // ESPN's table arrives with the same result a while later: the same drop, the same id: nothing more. Then a re-read of the
  // results (the final, a penalty) finds ESPN's table moved: nothing is projected on top of points it already has.
  espnTable = table([['HAM', 1, 315], ['NOR', 2, 262], ['PIA', 3, 222], ['VER', 4, 221], ['LEC', 5, 215]], [['FER', 1, 433], ['MCL', 2, 412], ['RBR', 3, 333]]);
  await F.scanF1Standings();
  const n = drops().length;
  assert.equal(drops().filter((d) => d.title.startsWith('Charles Leclerc')).length, 1, "once, though ESPN's own scan saw the drop too");
  await F.projectStandings(meta9, rows);
  await F.scanF1Standings();
  await F.projectStandings(meta9, rows);
  assert.equal(drops().length, n, 'the stored table moved on to ESPN\'s, but the base is the one from before the race: nothing double counted');
});
