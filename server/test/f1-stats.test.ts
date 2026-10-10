// F1's stats pages (f1-stats.ts), from a small season in ESPN's shapes: a race called off, one where a car
// was classified but had retired and another didn't start, one after two drivers swapped teams, and a
// standings column whose race name starts another's ("Gulf Air Bahrain Grand Prix", "…in Malaysia").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { urls } = await import('../src/leagues.ts');
const F = await import('../src/f1-stats.ts');
const { startApi } = await import('../src/api.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'f1', ?, ?, ?, ?, 'badge://f1', 512, 512, 0)`);
team.run('team:f1:10', '10', 'Red Bull', 'Red Bull', 'RBR');
team.run('team:f1:20', '20', 'Racing Bulls', 'Racing Bulls', 'RB');
const driver = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'f1', ?, ?, ?, 'badge://f1', 512, 512, 'team_logo', 0)`);
for (const [id, name, t] of [['1', 'Max Verstappen', '10'], ['2', 'Isack Hadjar', '10'], ['3', 'Liam Lawson', '20'], ['4', 'Arvid Lindblad', '20']]) driver.run(`player:f1:${id}`, id, name, `team:f1:${t}`);
loadCatalog();

const BAHRAIN = 'Gulf Air Bahrain Grand Prix', MALAYSIA = 'Gulf Air Bahrain Grand Prix in Malaysia', MONACO = 'Monaco Grand Prix';
const row = (rank: number, pts: number, weekends: Record<string, string>) => [
  { name: 'rank', displayName: 'Rank', abbreviation: 'RK', displayValue: String(rank) },
  { name: 'championshipPts', displayName: 'Points', abbreviation: 'PTS', displayValue: String(pts) },
  ...Object.entries(weekends).map(([race, v], i) => ({ name: `R${i}`, abbreviation: `R${i}`, displayName: race, displayValue: v })),
];
const STANDINGS = { children: [
  { name: 'Driver Standings', standings: { season: 2026, entries: [
    { athlete: { id: '2' }, stats: row(1, 43, { [BAHRAIN]: ' ', [MONACO]: '25', [MALAYSIA]: '18' }) },
    { athlete: { id: '3' }, stats: row(2, 43, { [BAHRAIN]: ' ', [MONACO]: '18', [MALAYSIA]: '25' }) },
    { athlete: { id: '1' }, stats: row(3, 15, { [BAHRAIN]: ' ', [MONACO]: '-', [MALAYSIA]: '15' }) },
    { athlete: { id: '4' }, stats: row(4, 12, { [BAHRAIN]: ' ', [MONACO]: ' ', [MALAYSIA]: '12' }) },
  ] } },
  { name: 'Constructor Standings', standings: { season: 2026, entries: [
    { team: { id: '10' }, stats: [{ name: 'rank', displayValue: '1' }, { name: 'points', displayValue: '83' }] },
    { team: { id: '20' }, stats: [{ name: 'rank', displayValue: '2' }, { name: 'points', displayValue: '55' }] },
  ] } },
] };
const session = (abbr: string, id: string, state: string, order: string[] = [], name = state === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED') => ({
  id, date: '2026-01-01T00:00Z', type: { abbreviation: abbr }, status: { type: { name, state, completed: state === 'post' } },
  competitors: order.map((d, i) => ({ id: d, order: i + 1 })),
});
const SCOREBOARD = { events: [
  { id: 'E1', name: BAHRAIN, shortName: 'Gulf Air Bahrain GP', date: '2026-04-10T00:00Z', competitions: [session('Qual', 'Q1', 'pre'), session('Race', 'R1', 'post', [], 'STATUS_CANCELED')] },
  { id: 'E2', name: MONACO, shortName: 'Monaco GP', date: '2026-06-05T00:00Z', competitions: [session('Qual', 'Q2', 'post', ['1', '3', '2', '4']), { ...session('Race', 'R2', 'post'), date: '2026-06-07T13:00Z' }] },
  { id: 'E3', name: MALAYSIA, shortName: 'Gulf Air Bahrain GP in Malaysia', date: '2026-10-02T00:00Z', competitions: [session('SS', 'S3', 'post', ['4', '3', '2', '1']), session('Qual', 'Q3', 'post', ['2', '3', '1', '4']), { ...session('Race', 'R3', 'post'), date: '2026-10-04T13:00Z' }] },
  { id: 'E4', name: 'Singapore Grand Prix', shortName: 'Singapore GP', date: '2026-10-09T00:00Z', competitions: [session('Race', 'R4', 'pre')] },
] };
/** A race's cars: [driver, team, finish, grid, ESPN status, its lap]. */
const CARS: Record<string, [string, string, number, number, string, number][]> = {
  R2: [['2', 'Red Bull', 1, 3, 'STATUS_FINISH', 78], ['3', 'Racing Bulls', 2, 2, 'STATUS_FINISH', 78], ['1', 'Red Bull', 3, 1, 'STATUS_RETIRED', 46], ['4', 'Racing Bulls', 4, 4, 'STATUS_DNS', 0]],
  // Lawson and Verstappen swapped seats for the weekend.
  R3: [['3', 'Red Bull', 1, 2, 'STATUS_FINISH', 56], ['2', 'Red Bull', 2, 1, 'STATUS_FINISH', 56], ['1', 'Racing Bulls', 3, 3, 'STATUS_FINISH', 56], ['4', 'Racing Bulls', 4, 4, 'STATUS_FINISH', 56]],
};
const DESCRIPTION: Record<string, string> = { STATUS_FINISH: 'Finished', STATUS_RETIRED: 'Retired', STATUS_DNS: 'Did not start' };
let reads: string[] = [], failStatus: string | null = null;
F.f1StatsDeps.getJson = async (url: string) => {
  reads.push(url);
  if (url === urls.standings('f1')) return STANDINGS;
  if (url === urls.scoreboard('f1', '2026')) return SCOREBOARD;
  for (const [compId, cars] of Object.entries(CARS)) {
    const ev = compId === 'R2' ? 'E2' : 'E3';
    if (url === urls.f1Competitors(ev, compId)) return { items: cars.map(([id, maker, order, grid]) => ({ id, order, startOrder: grid, vehicle: { manufacturer: maker }, status: { $ref: `status:${compId}:${id}` } })) };
    for (const [id, , , , name, lap] of cars) if (url === `status:${compId}:${id}`) {
      if (url === failStatus) throw new Error('timeout');
      return { period: lap, type: { name, description: DESCRIPTION[name] } };
    }
  }
  throw new Error(`unexpected ${url}`);
};
const show = (p: import('../src/stats.ts').StatsPage) => ({
  record: p.record && `${p.record.overall} · ${p.record.standing}`,
  tiles: p.groups.map((g) => `${g.title}: ${g.tiles.map((t) => `${t.label} ${t.value}${t.bad ? ' (red)' : ''}`).join(', ')}`),
  recent: p.recent.map((r) => `${r.opponent} | ${r.result || '-'} ${r.score} | ${r.line}`),
});

test("a finished race's cars are read once, whole: one whose status didn't load is read again; a race called off or still to come isn't read", async () => {
  failStatus = 'status:R3:4';
  const s = await F.readSeason();
  assert.deepEqual(s.races.map((r) => r.name), ['Monaco GP', 'Gulf Air Bahrain GP in Malaysia'], 'not Bahrain (called off) or Singapore (to come)');
  failStatus = null;
  reads = [];
  await F.readSeason();
  assert.deepEqual(reads.filter((u) => !u.includes('standings') && !u.includes('scoreboard')).map((u) => u.split('/').at(-1)!.replace(/\?.*/, '')).sort(),
    ['competitors', 'status:R3:1', 'status:R3:2', 'status:R3:3', 'status:R3:4'].sort(), 'Monaco kept; Malaysia read again, whole this time');
  reads = [];
  await F.readSeason();
  assert.equal(reads.length, 2, 'the standings and the scoreboard: every race kept');
});

test("a driver's page: championship, wins to DNFs (a car classified 3rd that retired is a DNF), against the teammate in each race's other car, the last races", async () => {
  F.forgetF1Season();
  const p = show(await F.f1Page('player', '1', 'player:f1:1'));
  assert.deepEqual(p, {
    record: "15 pts · 3rd in the Drivers' Championship, 28 pts behind Hadjar",
    tiles: ['2026 season, 2 races: W 0, POD 1, POLE 1, DNF 1 (red), AVG 3.0, VS TM 1-1'],
    recent: [
      'Gulf Air Bahrain GP in Malaysia | - P3 | Started P3 · 15 pts this weekend', // the column for Malaysia, not the Bahrain race called off
      'Monaco GP | L DNF | Retired on lap 46 · started P1 · no points',
    ],
  });
  const hadjar = show(await F.f1Page('player', '2', 'player:f1:2'));
  assert.equal(hadjar.record, "43 pts · 1st in the Drivers' Championship, level on points with Lawson");
  assert.equal(show(await F.f1Page('player', '3', 'player:f1:3')).record, "43 pts · 2nd in the Drivers' Championship, level on points with Hadjar");
  assert.deepEqual(hadjar.tiles, ['2026 season, 2 races: W 1, POD 2, POLE 1, DNF 0, AVG 1.5, VS TM 1-1'], 'ahead of Verstappen (out at Monaco), behind Lawson in Malaysia');
  const lindblad = show(await F.f1Page('player', '4', 'player:f1:4'));
  assert.deepEqual(lindblad.tiles, ['2026 season, 1 race: W 0, POD 0, POLE 0, DNF 0, AVG 4.0, VS TM 0-1 (red)'], "didn't start at Monaco: not a race, not a DNF");
  assert.equal(lindblad.recent.at(-1), 'Monaco GP | L DNS | Did not start · no points');
});

test("a constructor's page: both cars, whoever drove them that day; the weekend's points are its drivers'", async () => {
  const rb = show(await F.f1Page('team', '10', 'team:f1:10'));
  assert.deepEqual(rb, {
    record: "83 pts · 1st in the Constructors' Championship, 28 pts clear of Racing Bulls",
    tiles: ['2026 season, 2 races: W 2, POD 3, 1-2 1, POLE 2, DNF 1 (red), 2 DNF 0'],
    recent: [
      'Gulf Air Bahrain GP in Malaysia | W P1, P2 | Lawson P1 · Hadjar P2 · 43 pts this weekend',
      'Monaco GP | W P1, DNF | Hadjar P1 · Verstappen DNF · 25 pts this weekend',
    ],
  });
  const vcarb = show(await F.f1Page('team', '20', 'team:f1:20'));
  assert.deepEqual(vcarb.recent, [
    'Gulf Air Bahrain GP in Malaysia | - P3, P4 | Verstappen P3 · Lindblad P4 · 27 pts this weekend',
    'Monaco GP | - P2 | Lawson P2 · 18 pts this weekend',
  ], 'a car that didn\'t start isn\'t on it');
});

test('every driver at /f1/drivers, by constructor, with their haters: Search with nothing typed', async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const { drivers } = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/f1/drivers`)).json();
    assert.deepEqual(drivers.map((d: any) => [d.teamName, d.name, d.haters]),
      [['Racing Bulls', 'Arvid Lindblad', 0], ['Racing Bulls', 'Liam Lawson', 0], ['Red Bull', 'Isack Hadjar', 0], ['Red Bull', 'Max Verstappen', 0]]);
  } finally { server.close(); }
});

test('served at /targets/:key/stats for drivers and constructors', async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const page = await (await fetch(`${base}/targets/${encodeURIComponent('team:f1:20')}/stats`)).json();
    assert.deepEqual([page.kind, page.league, page.record.overall, page.recent.length, page.next], ['team', 'f1', '55 pts', 2, null]);
  } finally { server.close(); }
});
