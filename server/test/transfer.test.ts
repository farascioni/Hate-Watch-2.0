// Recovery codes (transfer.ts): a new install redeems the code of the device it replaces and takes over its data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { startApi } = await import('../src/api.ts');
const { normalize } = await import('../src/transfer.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES ('team:mlb:15', 'mlb', '15', 'Atlanta Braves', 'Braves', 'ATL', '#0c2340', 'x', 1, 1, 0)`).run();
loadCatalog();

const server = startApi(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
// Each device gets its own address, so neither the device cap nor the wrong-code cap of one reaches another.
let nextIp = 1;
type Dev = { token: string; deviceId: string; ip: string };
const call = (d: { token: string; ip: string }, method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'fly-client-ip': d.ip, authorization: `Bearer ${d.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
const newDevice = async (platform = 'ios', pushToken?: string): Promise<Dev> => {
  const a = `198.51.100.${nextIp++}`;
  const r = await fetch(`${base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': a }, body: JSON.stringify({ platform, pushToken }) });
  return { ...(await r.json() as { token: string; deviceId: string }), ip: a };
};
const codeOf = async (d: Dev) => ((await (await call(d, 'POST', '/me/transfer-code')).json()) as { code: string }).code;
const row = (id: string) => db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as { platform: string; push_token: string | null } | undefined;

test('normalize folds case, dashes, spaces and look-alikes', () => {
  assert.equal(normalize(' ab0o-1il9-zzzz '), 'AB001119ZZZZ');
});

test('a code moves follows and hate watches to the new install, and the old token stops working', async () => {
  const old = await newDevice('ios', 'old-push');
  await call(old, 'PUT', '/me/follows/team:mlb:15');
  db.prepare('INSERT INTO hate_watches (device_id, event_id, target_key, occurred_at) VALUES (?,?,?,0)').run(old.deviceId, 'E1', 'team:mlb:15');
  const code = await codeOf(old);
  assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  const fresh = await newDevice('android', 'new-push');
  const r = await call(fresh, 'POST', '/transfer/redeem', { code: code.toLowerCase().replace(/-/g, ' ') });
  assert.equal(r.status, 200);
  const out = (await r.json()) as { token: string; deviceId: string };
  assert.equal(out.deviceId, old.deviceId);

  assert.equal((await call(old, 'GET', '/me/follows')).status, 401, 'the old install is signed out');
  assert.equal((await call(fresh, 'GET', '/me/follows')).status, 401, 'the blank device is gone');
  assert.equal(row(fresh.deviceId), undefined);

  const follows = (await (await call({ token: out.token, ip: fresh.ip }, 'GET', '/me/follows')).json()) as { follows: { key: string }[] };
  assert.deepEqual(follows.follows.map((f) => f.key), ['team:mlb:15']);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM hate_watches WHERE device_id = ?').get(old.deviceId) as { n: number }).n, 1);
  const moved = row(old.deviceId)!;
  assert.equal(moved.platform, 'android');
  assert.equal(moved.push_token, 'new-push', 'pushes go to the new install');
});

test('a code works once', async () => {
  const code = await codeOf(await newDevice());
  assert.equal((await call(await newDevice(), 'POST', '/transfer/redeem', { code })).status, 200);
  assert.equal((await call(await newDevice(), 'POST', '/transfer/redeem', { code })).status, 404);
});

test('a new code replaces the last one', async () => {
  const old = await newDevice();
  const first = await codeOf(old);
  const second = await codeOf(old);
  assert.notEqual(first, second);
  assert.equal((await call(await newDevice(), 'POST', '/transfer/redeem', { code: first })).status, 404);
  assert.equal((await call(await newDevice(), 'POST', '/transfer/redeem', { code: second })).status, 200);
});

test('a device cannot redeem its own code, and a bad body is a 400', async () => {
  const d = await newDevice();
  const code = await codeOf(d);
  assert.equal((await call(d, 'POST', '/transfer/redeem', { code })).status, 400);
  assert.equal((await call(d, 'POST', '/transfer/redeem', {})).status, 400);
  assert.equal((await call(d, 'POST', '/transfer/redeem', { code: 'x'.repeat(65) })).status, 400);
  assert.equal((await call(d, 'GET', '/me/follows')).status, 200, 'its own token still works');
});

test('deleting all data deletes the code', async () => {
  const old = await newDevice();
  const code = await codeOf(old);
  await call(old, 'DELETE', '/me');
  assert.equal((await call(await newDevice(), 'POST', '/transfer/redeem', { code })).status, 404);
});

test('ten wrong codes from one address are refused until the hour passes; other addresses are not affected', async () => {
  const guesser = await newDevice();
  for (let i = 0; i < 10; i++) assert.equal((await call(guesser, 'POST', '/transfer/redeem', { code: `AAAA-AAAA-AA${i}${i}` })).status, 404);
  const code = await codeOf(await newDevice());
  assert.equal((await call(guesser, 'POST', '/transfer/redeem', { code })).status, 429, 'even the right code, from the guessing address');
  assert.equal((await call(await newDevice(), 'POST', '/transfer/redeem', { code })).status, 200);
});

test('a device makes ten codes an hour', async () => {
  const d = await newDevice();
  for (let i = 0; i < 10; i++) assert.equal((await call(d, 'POST', '/me/transfer-code')).status, 200);
  assert.equal((await call(d, 'POST', '/me/transfer-code')).status, 429);
});

test.after(() => void server.close());
