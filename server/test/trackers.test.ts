// How many people track each player or team: on every follow in GET /me/follows, and back from
// following or unfollowing, so the Tracking tab's number is right away correct. Over real HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { startApi } = await import('../src/api.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES ('team:nfl:1', 'nfl', '1', 'Atlanta Falcons', 'Falcons', 'ATL', 'x', 1, 1, 0)`).run();
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:nfl:9', 'nfl', '9', 'Michael Penix Jr.', 'team:nfl:1', 'x', 1, 1, 'headshot', 0)`).run();
db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES ('team:nfl:18', 'nfl', '18', 'New Orleans Saints', 'Saints', 'NO', 'x', 1, 1, 0)`).run();
db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES ('team:nba:1', 'nba', '1', 'Atlanta Hawks', 'Hawks', 'ATL', 'x', 1, 1, 0)`).run();
db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES ('team:nfl:3', 'nfl', '3', 'Chicago Bears', 'Bears', 'CHI', 'x', 1, 1, 0)`).run(); // nobody tracks them
loadCatalog();

test('each tracked player and team says how many people track it', async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, token?: string) =>
    (await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: method === 'POST' ? '{}' : undefined })).json();
  const [a, b, c] = await Promise.all([1, 2, 3].map(async () => (await call('POST', '/devices')).token as string));
  const follows = async (token: string) => Object.fromEntries((await call('GET', '/me/follows', token)).follows.map((f: any) => [f.key, f.trackers]));
  const falcons = encodeURIComponent('team:nfl:1'), penix = encodeURIComponent('player:nfl:9');

  assert.equal((await call('PUT', `/me/follows/${falcons}`, a)).trackers, 1, 'just you');
  assert.equal((await call('PUT', `/me/follows/${falcons}`, b)).trackers, 2);
  assert.equal((await call('PUT', `/me/follows/${falcons}`, b)).trackers, 2, 'following twice counts once');
  await call('PUT', `/me/follows/${penix}`, c);
  assert.deepEqual(await follows(a), { 'team:nfl:1': 2 });
  assert.deepEqual(await follows(c), { 'player:nfl:9': 1 }, 'a player counts on its own, not toward the team');
  assert.equal((await call('DELETE', `/me/follows/${falcons}`, b)).trackers, 1, 'what is left after you unfollow');
  assert.deepEqual(await follows(a), { 'team:nfl:1': 1 });
  await call('DELETE', '/me', a); // "Delete all my data"
  assert.equal((await call('PUT', `/me/follows/${falcons}`, c)).trackers, 1, 'a deleted device stops counting');
  server.close();
});

test('the leaderboard: most hated first, ties share a rank, filtered like the Feed and Tracking tabs', async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (q = '') => { const r = await fetch(`${base}/leaderboard${q}`); return r.ok ? (await r.json()).entries.map((e: any) => `${e.tied ? 'T-' : ''}${e.rank}. ${e.target.name} ${e.haters}`) : r.status; };
  const device = async () => (await (await fetch(`${base}/devices`, { method: 'POST', body: '{}' })).json()).token as string;
  const follow = async (key: string, n: number) => { for (let i = 0; i < n; i++) await fetch(`${base}/me/follows/${encodeURIComponent(key)}`, { method: 'PUT', headers: { authorization: `Bearer ${await device()}` } }); };
  // From the first test: the Falcons and Penix have 1 each.
  await follow('team:nfl:18', 3);
  await follow('team:nba:1', 2);
  await follow('team:nfl:1', 1);
  assert.deepEqual(await get(), ['1. New Orleans Saints 3', 'T-2. Atlanta Falcons 2', 'T-2. Atlanta Hawks 2', '3. Michael Penix Jr. 1'], 'everything, every sport: after a tie for 2nd comes 3rd, not 4th');
  assert.deepEqual(await get('?kind=team'), ['1. New Orleans Saints 3', 'T-2. Atlanta Falcons 2', 'T-2. Atlanta Hawks 2'], 'all sports teams');
  assert.deepEqual(await get('?kind=player'), ['1. Michael Penix Jr. 1'], 'all athletes');
  assert.deepEqual(await get('?league=nba'), ['1. Atlanta Hawks 2'], 'ranked within the filter: the Hawks are 1st in the NBA, not tied for 2nd');
  assert.deepEqual(await get('?kind=team&league=nfl'), ['1. New Orleans Saints 3', '2. Atlanta Falcons 2'], 'no tie once the Hawks are filtered out');
  assert.deepEqual(await get('?kind=player&league=nba'), []);
  assert.deepEqual(await get('?limit=1'), ['1. New Orleans Saints 3']);
  assert.deepEqual(await get('?limit=2'), ['1. New Orleans Saints 3', 'T-2. Atlanta Falcons 2'], 'still a tie when the one it is tied with is past the limit');
  assert.equal(await get('?kind=coach'), 400);
  assert.equal(await get('?league=mls'), 400);
  server.close();
});

test('search, the team list, and a team page with its roster say how many people hate each one', async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string) => (await fetch(base + path)).json();
  // From the tests above: Saints 3, Falcons 2, Hawks 2, Penix 1.
  assert.deepEqual((await get('/search?q=atlanta')).results.map((t: any) => `${t.name} ${t.haters}`).sort(), ['Atlanta Falcons 2', 'Atlanta Hawks 2']);
  assert.deepEqual((await get('/teams?league=nfl')).teams.map((t: any) => `${t.shortName} ${t.haters}`), ['Falcons 2', 'Bears 0', 'Saints 3'], 'nobody yet is 0');
  const falcons = await get(`/targets/${encodeURIComponent('team:nfl:1')}`);
  assert.equal(falcons.haters, 2);
  assert.deepEqual(falcons.roster.map((p: any) => `${p.name} ${p.haters}`), ['Michael Penix Jr. 1']);
  server.close();
});
