// Request hardening (October 2026): a bad body or query answers 400/413 instead of 500 or a silent empty list, a push token
// is a string or null, a new device is limited per address, and a share page's links never take the caller's Host header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db, shareCode } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { PUBLIC_URL } = await import('../src/fanout.ts');
const { startApi } = await import('../src/api.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES ('team:mlb:15', 'mlb', '15', 'Atlanta Braves', 'Braves', 'ATL', '#0c2340', 'x', 1, 1, 0)`).run();
loadCatalog();
const ALERT = 'G1:final:team.lost:15';
db.prepare('INSERT INTO events (id, type, league, target_key, title, body, occurred_at, detected_at, share_code) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)')
  .run(ALERT, 'team.lost', 'mlb', 'team:mlb:15', 'Successful Hate Watch! Braves lost to the Dodgers', 'Final Score: 3 to 2', shareCode(ALERT));

const server = startApi(0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;
const JSON_HEADERS = { 'content-type': 'application/json' };
// Each test registers from its own address, so the per-address device cap of one never reaches another.
let nextIp = 1;
const register = (ip = `203.0.113.${nextIp++}`, body = '{"platform":"ios"}') =>
  fetch(`${base}/devices`, { method: 'POST', headers: { ...JSON_HEADERS, 'fly-client-ip': ip }, body });
const newDevice = async () => (await (await register()).json()) as { token: string; deviceId: string };

test('a body that is not JSON is a 400, not a 500', async () => {
  for (const body of ['{"platform":', 'not json', '{"platform":"ios"}}']) {
    const r = await register(undefined, body);
    assert.equal(r.status, 400, body);
    assert.deepEqual(await r.json(), { error: 'bad json' });
  }
  assert.equal((await register(undefined, '')).status, 400, 'an empty body is no platform');
});

test('a body over 64 KB is a 413, however it is sent, and the server keeps answering', async () => {
  for (const size of [70 * 1024, 2 * 1024 * 1024]) {
    const r = await register(undefined, JSON.stringify({ platform: 'ios', pad: 'x'.repeat(size) }));
    assert.equal(r.status, 413, `${size} bytes`);
  }
  // Chunked, with no Content-Length to check up front: read to the cap, then refused.
  const status = await new Promise<number>((resolve, reject) => {
    const req = request({ port, method: 'POST', path: '/devices', headers: { ...JSON_HEADERS, 'fly-client-ip': '203.0.113.200' } }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject);
    for (let i = 0; i < 40; i++) req.write('x'.repeat(4096));
    req.end();
  });
  assert.equal(status, 413);
  const small = await register(undefined, JSON.stringify({ platform: 'ios', pad: 'x'.repeat(60 * 1024) }));
  assert.equal(small.status, 200, 'just under the cap still goes through');
});

test('a bad number in a query falls back to its default instead of a 500 or an empty list', async () => {
  const { token } = await newDevice();
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, body: await r.json() };
  };
  db.prepare('INSERT INTO feed (device_id, event_id, occurred_at) SELECT id, ?, 5 FROM devices').run(ALERT);
  const normal = await get('/me/feed');
  assert.equal(normal.status, 200);
  assert.equal(normal.body.items.length, 1, 'the one alert');
  for (const q of ['limit=abc', 'limit=', 'limit=NaN', 'limit=-5', 'limit=1e999', 'before=abc', 'before=', 'after=abc', 'limit=abc&before=abc&after=abc']) {
    const r = await get(`/me/feed?${q}`);
    assert.equal(r.status, 200, q);
    assert.deepEqual(r.body.items.map((i: { id: string }) => i.id), normal.body.items.map((i: { id: string }) => i.id), q);
  }
  assert.equal((await get('/me/feed?limit=0')).body.items.length, 1, 'a limit below the least is the least');
  assert.equal((await get('/me/feed?limit=1.9')).body.items.length, 1);

  const search = await get('/search?q=braves');
  assert.equal(search.status, 200);
  assert.ok(search.body.results.length >= 1);
  for (const q of ['limit=-1', 'limit=0', 'limit=abc']) {
    const r = await get(`/search?q=braves&${q}`);
    assert.equal(r.status, 200, q);
    assert.equal(r.body.results.length, search.body.results.length, `${q} still gives the whole answer`);
  }
  assert.equal((await get('/leaderboard?limit=abc')).status, 200);
});

test('a push token is a string or null; anything else is a 400', async () => {
  const { token } = await newDevice();
  const put = (body: string) => fetch(`${base}/me/push-token`, { method: 'PUT', headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` }, body });
  for (const bad of ['{"pushToken":{"a":1}}', '{"pushToken":[]}', '{"pushToken":5}', '{"pushToken":true}']) assert.equal((await put(bad)).status, 400, bad);
  assert.equal((await put('{"pushToken":"ExponentPushToken[abc]"}')).status, 200);
  assert.equal((await put('{"pushToken":null}')).status, 200);
  assert.equal((await put('{}')).status, 200, 'none at all clears it too');

  assert.equal((await register(undefined, '{"platform":"ios","pushToken":{"a":1}}')).status, 400, 'registering with an object token');
  assert.equal((await register(undefined, '{"platform":"android","pushToken":"abc"}')).status, 200);
});

test('a device registers with a platform the app sends, or it is a 400', async () => {
  for (const body of ['{}', '{"platform":"symbian"}', '{"platform":5}', '{"platform":null}', '{"platform":["ios"]}', 'null', '[]']) {
    assert.equal((await register(undefined, body)).status, 400, body);
  }
  for (const platform of ['ios', 'android', 'web']) assert.equal((await register(undefined, JSON.stringify({ platform }))).status, 200, platform);
});

test('an address can register 30 devices an hour; the 31st is a 429, and another address is not held up', async () => {
  const ip = '198.51.100.7';
  for (let i = 0; i < 30; i++) assert.equal((await register(ip)).status, 200, `device ${i + 1}`);
  const over = await register(ip);
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /too many new devices/);
  assert.equal((await register(ip, '{"platform":"nope"}')).status, 400, 'a bad request is refused as bad, and costs nothing');
  assert.equal((await register('198.51.100.8')).status, 200, 'someone else');
  assert.equal((await fetch(`${base}/devices`, { method: 'POST', headers: { ...JSON_HEADERS, 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }, body: '{"platform":"ios"}' })).status, 200, 'with no Fly header, the forwarded address');
});

// fetch can't set Host, so the share page is asked for with node:http.
const sharePage = (host: string | undefined, headers: Record<string, string> = {}) => new Promise<{ status: number; html: string }>((resolve, reject) => {
  const req = request({ port, path: `/a/${shareCode(ALERT)}`, headers: { 'user-agent': 'Twitterbot/1.0', ...(host ? { host } : {}), ...headers } }, (res) => {
    let html = '';
    res.setEncoding('utf8').on('data', (c) => (html += c)).on('end', () => resolve({ status: res.statusCode!, html }));
  });
  req.on('error', reject).end();
});
const links = (html: string) => [...html.matchAll(/(?:property|name)="(?:og:url|og:image|twitter:image)" content="([^"]*)"/g)].map((m) => m[1]);

test("a share page's links use our own address, never the caller's Host header", async () => {
  const code = shareCode(ALERT);
  for (const [host, headers] of [['evil.example', {}], ['evil.example:8080', { 'x-forwarded-proto': 'http' }], ['hate-watch-api.fly.dev.evil.example', {}], ['localhost.evil.example', {}], ['evil.example/x', {}]] as const) {
    const r = await sharePage(host, headers);
    assert.equal(r.status, 200, host);
    const found = links(r.html);
    assert.ok(found.length >= 3, host);
    for (const l of found) assert.ok(l.startsWith(`${PUBLIC_URL}/a/${code}`), `${host}: ${l}`);
    assert.ok(!r.html.includes('evil.example'), host);
  }
  for (const [host, origin] of [['hatewatch.dev', 'https://hatewatch.dev'], ['www.hatewatch.dev', 'https://www.hatewatch.dev'], [`127.0.0.1:${port}`, `http://127.0.0.1:${port}`], [`localhost:${port}`, `http://localhost:${port}`]]) {
    for (const l of links((await sharePage(host, { 'x-forwarded-proto': 'http' })).html)) assert.ok(l.startsWith(`${origin}/a/${code}`), `${host}: ${l}`);
  }
});

test.after(() => void server.close());
