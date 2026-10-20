// DELETE /me/prefs ("Reset alert settings" in the app): every alert setting back to a new install's, nothing else touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { DEFAULT_PREFS, getPrefs, prefsDto } = await import('../src/fanout.ts');
const { startApi } = await import('../src/api.ts');

test('a reset puts every alert setting back to the defaults, keeps the follows, and touches no other device', async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const register = async () => (await fetch(`${base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"platform":"ios"}' })).json();
  const mine = await register();
  const other = await register();
  const call = async (who: { token: string }, method: string, body?: object) =>
    (await fetch(`${base}/me/prefs`, { method, headers: { authorization: `Bearer ${who.token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();

  const CHOICES = {
    pushEnabled: false, sound: false, muted: ['team:mlb:10'],
    types: { 'nba.missed_shot': true, 'team.lost': false }, leagues: { nba: false },
    pushTypes: { 'team.lost': false }, targetTypes: { 'team:mlb:10': { 'team.lost': false } }, targetPushTypes: { 'team:mlb:10': { 'team.lost': false } },
    quietHours: { enabled: true, start: '22:00', end: '07:00', tz: 'America/Chicago' },
    playerTeams: { 'player:mlb:1': { scores: true, alerts: true } },
  };
  await call(mine, 'PUT', CHOICES);
  await call(other, 'PUT', { sound: false });
  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(mine.deviceId, 'team:mlb:10');
  const changed = await call(mine, 'GET');
  assert.equal(changed.sound, false);
  assert.deepEqual(changed.targetTypes, CHOICES.targetTypes);
  assert.deepEqual(changed.playerTeams, CHOICES.playerTeams);

  const reset = await call(mine, 'DELETE');
  assert.deepEqual(reset, prefsDto(DEFAULT_PREFS), 'answers the stored settings, like GET');
  assert.deepEqual(await call(mine, 'GET'), reset);
  assert.deepEqual(getPrefs(mine.deviceId), DEFAULT_PREFS, 'the server judges alerts by the defaults from now on');
  assert.deepEqual(JSON.parse((db.prepare('SELECT prefs FROM devices WHERE id = ?').get(mine.deviceId) as { prefs: string }).prefs), DEFAULT_PREFS);

  assert.deepEqual((db.prepare('SELECT target_key FROM follows WHERE device_id = ?').all(mine.deviceId) as { target_key: string }[]).map((f) => f.target_key), ['team:mlb:10'], 'follows stay');
  assert.equal((await call(other, 'GET')).sound, false, "another device's settings stay");

  // The reset is not a shared object: a change afterwards must not reach the defaults.
  await call(mine, 'PUT', { types: { 'team.lost': false } });
  assert.deepEqual(DEFAULT_PREFS.types, {});
  assert.deepEqual((await call(mine, 'DELETE')).types, {});
  server.close();
});

test('a reset needs a device', async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/me/prefs`, { method: 'DELETE' });
  assert.equal(res.status, 401);
  server.close();
});
