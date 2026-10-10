// An F1 weekend's preview (f1-preview.ts), in ESPN's shapes: a sprint weekend whose sprint grid is set and
// whose race's isn't (ESPN lists a session's cars only once its grid is), a weekend two weeks out, a live
// card's state over the season scoreboard's, and the standings failing with the schedule still there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { urls } = await import('../src/leagues.ts');
const { raceCard, upsertGame } = await import('../src/scores.ts');
const P = await import('../src/f1-preview.ts');
const F = await import('../src/f1-stats.ts');
const { startApi } = await import('../src/api.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES ('team:f1:10', 'f1', '10', 'Red Bull', 'Red Bull', 'RBR', 'badge://f1', 512, 512, 0)`).run();
const driver = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'f1', ?, ?, 'team:f1:10', 'badge://f1', 512, 512, 'team_logo', 0)`);
driver.run('player:f1:1', '1', 'Max Verstappen');
driver.run('player:f1:2', '2', 'Isack Hadjar');
loadCatalog();

const NOW = Date.parse('2026-10-10T01:00:00Z');
P.f1PreviewDeps.now = () => NOW;
const session = (abbr: string, id: string, date: string, state = 'pre') => ({ id, date, type: { abbreviation: abbr }, status: { type: { state, completed: state === 'post', name: state === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED' } } });
const MALAYSIA = { id: 'E0', name: 'Gulf Air Bahrain Grand Prix in Malaysia', shortName: 'Malaysia GP', date: '2026-10-02T00:00Z',
  competitions: [{ ...session('Race', 'R0', '2026-10-04T07:00Z', 'post'), competitors: [{ id: '1', order: 1 }, { id: '2', order: 2 }] }] };
const SINGAPORE = { id: 'E1', name: 'Singapore Airlines Singapore Grand Prix', shortName: 'Singapore GP', date: '2026-10-09T08:30Z',
  circuit: { fullName: 'Marina Bay Street Circuit', address: { city: 'Singapore', country: 'Singapore' } },
  competitions: [session('Race', 'R1', '2026-10-11T12:00Z'), session('FP1', 'P1', '2026-10-09T08:30Z', 'post'), session('SS', 'S1', '2026-10-09T12:30Z', 'post'),
    session('SR', 'SR1', '2026-10-10T09:00Z'), session('Qual', 'Q1', '2026-10-10T13:00Z')] };
const AUSTIN = { id: 'E2', name: 'MSC Cruises United States Grand Prix', shortName: 'United States GP', date: '2026-10-23T17:30Z',
  circuit: { fullName: 'Circuit of the Americas', address: { city: 'Austin', state: 'TX', country: 'USA' } },
  competitions: [session('FP1', 'P2', '2026-10-23T17:30Z'), session('Qual', 'Q2', '2026-10-24T21:00Z'), session('Race', 'R2', '2026-10-25T20:00Z')] };
const BOARD = { events: [MALAYSIA, SINGAPORE, AUSTIN] };
let reads: string[] = [];
P.f1PreviewDeps.getJson = async (url: string) => {
  reads.push(url);
  if (url === urls.scoreboard('f1', '2026')) return BOARD;
  if (url === urls.scoreboard('f1', '2027')) return { events: [] };
  if (url === urls.f1Competitors('E1', 'SR1')) return { items: [{ id: '2', startOrder: 2, vehicle: { manufacturer: 'Red Bull' } }, { id: '1', startOrder: 1, vehicle: { manufacturer: 'Red Bull' } }] };
  if (url.includes('/competitors')) return { items: [] }; // a race or qualifying before its grid is set
  throw new Error(`unexpected ${url}`);
};
let standingsDown = false;
F.f1StatsDeps.getJson = async (url: string) => {
  if (url === urls.standings('f1')) {
    if (standingsDown) throw new Error('503');
    return { children: [{ name: 'Driver Standings', standings: { season: 2026, entries: [
      { athlete: { id: '2' }, stats: [{ name: 'rank', displayValue: '2' }, { name: 'championshipPts', displayValue: '18' }] },
      { athlete: { id: '1' }, stats: [{ name: 'rank', displayValue: '1' }, { name: 'championshipPts', displayValue: '25' }] },
    ] } }, { name: 'Constructor Standings', standings: { season: 2026, entries: [{ team: { id: '10' }, stats: [{ name: 'rank', displayValue: '1' }, { name: 'points', displayValue: '43' }] }] } }] };
  }
  if (url === urls.scoreboard('f1', '2026')) return BOARD;
  if (url === urls.f1Competitors('E0', 'R0')) return { items: [{ id: '1', order: 1, startOrder: 2, vehicle: { manufacturer: 'Red Bull' }, status: { $ref: 'st:1' } }, { id: '2', order: 2, startOrder: 1, vehicle: { manufacturer: 'Red Bull' }, status: { $ref: 'st:2' } }] };
  if (url === 'st:1') return { type: { name: 'STATUS_FINISH' } };
  if (url === 'st:2') return { type: { name: 'STATUS_RETIRED', description: 'Retired' }, period: 30 };
  throw new Error(`unexpected ${url}`);
};

test("a sprint weekend: where and when, every session in order, the sprint's grid; the championship with each driver's last races", async () => {
  const p = (await P.f1Preview('E1'))!;
  assert.deepEqual(p.event, { id: 'E1', name: SINGAPORE.name, shortName: 'Singapore GP', circuit: 'Marina Bay Street Circuit', place: 'Singapore',
    startsAt: Date.parse('2026-10-09T08:30Z'), endsAt: Date.parse('2026-10-11T12:00Z') });
  assert.deepEqual(p.sessions.map((s) => `${s.key} ${s.name} ${s.state}`), ['f1:P1 Practice 1 post', 'f1:S1 Sprint Shootout post', 'f1:SR1 Sprint pre', 'f1:Q1 Qualifying pre', 'f1:R1 Race pre']);
  assert.deepEqual(p.grid, { key: 'f1:SR1', session: 'Sprint', cars: [
    { key: 'player:f1:1', name: 'Max Verstappen', teamKey: 'team:f1:10', grid: 1 }, { key: 'player:f1:2', name: 'Isack Hadjar', teamKey: 'team:f1:10', grid: 2 }] });
  assert.equal(p.gridAfter, undefined);
  assert.deepEqual(p.drivers.map((d) => `${d.rank}. ${d.name} ${d.points} [${d.form.join(' ')}]`), ['1. Max Verstappen 25 [P1]', '2. Isack Hadjar 18 [DNF]'], 'a car classified 2nd that retired is a DNF');
  assert.deepEqual(p.constructors, [{ key: 'team:f1:10', name: 'Red Bull', rank: 1, points: 43 }]);
  assert.equal(await P.f1Preview('nope'), null, 'not a weekend ESPN has');
});

test('once the sprint is over (its live card says so before the season read does): the race next, its grid set after qualifying', async () => {
  P.forgetF1Preview();
  upsertGame(raceCard(SINGAPORE, { ...session('SR', 'SR1', '2026-10-10T09:00Z', 'post'), competitors: [] }));
  const p = (await P.f1Preview('E1'))!;
  assert.equal(p.sessions.find((s) => s.key === 'f1:SR1')?.state, 'post', "the live card's, over the season scoreboard's 'pre'");
  assert.deepEqual([p.grid, p.gridAfter], [null, 'Qualifying']);
});

test('a weekend two weeks out: its schedule; the standings down: the schedule and grid stand, no championship', async () => {
  P.forgetF1Preview();
  F.forgetF1Season();
  standingsDown = true;
  const p = (await P.f1Preview('E2'))!;
  assert.deepEqual([p.event.circuit, p.event.place, p.sessions.map((s) => s.name), p.grid, p.gridAfter, p.drivers, p.constructors],
    ['Circuit of the Americas', 'Austin, USA', ['Practice 1', 'Qualifying', 'Race'], null, 'Qualifying', [], []]);
  standingsDown = false;
  F.forgetF1Season();
});

test('served at /f1/events/:id/preview; 404 for a weekend ESPN lacks; read from ESPN once a minute at most', async () => {
  P.forgetF1Preview();
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    reads = [];
    const p = await (await fetch(`${base}/f1/events/E2/preview`)).json();
    await fetch(`${base}/f1/events/E2/preview`);
    assert.deepEqual([p.event.shortName, p.sessions.length, reads.filter((u) => u.includes('scoreboard')).length], ['United States GP', 3, 1], 'the season scoreboard, once');
    assert.equal((await fetch(`${base}/f1/events/nope/preview`)).status, 404);
  } finally { server.close(); }
});
