// Snoozing (Prefs.snoozed): a tracked target muted until a time. While the end is ahead it does exactly what 🔕 does
// (the alert reaches the feed, nothing is pushed); once it has passed it counts for nothing. PUT /me/prefs validates
// it, 0 or null ends one, and a patch merges into the map like quietHours does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, '#000', 'x', 1, 1, 0)`);
team.run('team:mlb:30', 'mlb', '30', 'Tampa Bay Rays', 'Rays', 'TB');
team.run('team:mlb:5', 'mlb', '5', 'Cleveland Guardians', 'Guardians', 'CLE');
loadCatalog();

const { DEFAULT_PREFS, getPrefs, publish, setPushSender, setPrefs } = await import('../src/fanout.ts');
const { addFavorite, updateFavorite, registerGame } = await import('../src/favorites.ts');
const { startApi } = await import('../src/api.ts');

const GUARDIANS = 'team:mlb:5';
const HOUR = 3600_000;

const pushes: string[] = [];
setPushSender((m) => pushes.push(...m.map((x: any) => `${x.to}|${x.data.eventId}`)));

// "Opponent scored" is feed only by default, so every device turns its bell on: a device that is neither muted nor snoozed pushes.
const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const bellOn = { ...DEFAULT_PREFS, pushTypes: { 'team.opponent_scored': true } };
for (const id of ['control', 'muted', 'snoozed', 'snooze-ended', 'unsnoozed']) {
  device.run(id, 's', 'test', `tok-${id}`, JSON.stringify(bellOn));
  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(id, GUARDIANS);
}
device.run('old-row', 's', 'test', 'tok-old-row', JSON.stringify({ pushEnabled: true })); // saved before snoozing existed
registerGame('mlb', 'G1', 'team:mlb:30', GUARDIANS); // Rays vs Guardians

const scored = (play: string) => ({ id: `G1:${play}:team.opponent_scored:5`, type: 'team.opponent_scored', targetKey: GUARDIANS, title: 'Rays scored', body: 'Rays scored 1 run.', at: 1000, meta: { gameId: 'G1' } });
const feed = (dev: string) => db.prepare('SELECT event_id, pushed FROM feed WHERE device_id = ? ORDER BY event_id').all(dev).map((r) => ({ ...r })) as { event_id: string; pushed: number }[];
const pushed = (play: string, dev: string) => pushes.includes(`tok-${dev}|G1:${play}:team.opponent_scored:5`);

test('a snooze that has not ended does what 🔕 does: the alert is in the feed, nothing is pushed', () => {
  setPrefs('muted', { muted: [GUARDIANS] });
  setPrefs('snoozed', { snoozed: { [GUARDIANS]: Date.now() + HOUR } });
  publish([scored('p1')], 'mlb');
  assert.ok(pushed('p1', 'control'), 'control: the same alert pushes to a device that is neither');
  assert.deepEqual(feed('control'), [{ event_id: 'G1:p1:team.opponent_scored:5', pushed: 1 }]);
  assert.deepEqual(feed('snoozed'), [{ event_id: 'G1:p1:team.opponent_scored:5', pushed: 0 }]);
  assert.deepEqual(feed('snoozed'), feed('muted'), 'exactly what mute leaves');
  assert.ok(!pushed('p1', 'snoozed') && !pushed('p1', 'muted'));
});

test('a snooze in the past counts for nothing: the alert pushes', () => {
  setPrefs('snooze-ended', { snoozed: { [GUARDIANS]: Date.now() - 1 } });
  publish([scored('p2')], 'mlb');
  assert.equal(feed('snooze-ended').find((r) => r.event_id.includes(':p2:'))?.pushed, 1);
  assert.ok(pushed('p2', 'snooze-ended'));
  assert.ok(!pushed('p2', 'snoozed'), 'the unexpired snooze still holds');
});

test('a snooze on another team leaves this target alone', () => {
  setPrefs('unsnoozed', { snoozed: { 'team:mlb:30': Date.now() + HOUR } }); // the Rays, not the Guardians
  publish([scored('p3')], 'mlb');
  assert.ok(pushed('p3', 'unsnoozed'));
});

test('a favorite’s own push choice beats a snooze left on its opponent from tracking it before', () => {
  device.run('fan', 's', 'test', 'tok-fan', JSON.stringify({ ...bellOn, snoozed: { [GUARDIANS]: Date.now() + HOUR } }));
  addFavorite('fan', 'team:mlb:30');
  updateFavorite('fan', 'team:mlb:30', { pushTypes: { 'team.opponent_scored': true } });
  publish([scored('p4')], 'mlb');
  assert.deepEqual(feed('fan').map((r) => r.pushed), [1]);
  assert.ok(pushed('p4', 'fan'));
});

test('an old row with no snoozed field reads as none, and a snooze never leaks into the shared default', () => {
  assert.deepEqual(getPrefs('old-row').snoozed, {});
  setPrefs('old-row', { snoozed: { [GUARDIANS]: Date.now() + HOUR } });
  assert.deepEqual(DEFAULT_PREFS.snoozed, {});
  assert.deepEqual(getPrefs('control').snoozed, {}, 'another device is untouched');
});

test('PUT /me/prefs: a bad snoozed is a 400; a good one merges; 0 or null removes the entry', async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { token } = await (await fetch(`${base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"platform":"ios"}' })).json();
  const call = (method: string, body?: string) => fetch(`${base}/me/prefs`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
  const snoozed = async () => (await (await call('GET')).json()).snoozed;
  const until = Date.now() + 24 * HOUR;

  assert.deepEqual(await snoozed(), {}, 'a new device has none');
  for (const bad of ['"soon"', 'null', '[]', '[123]', '{"team:mlb:5":"tomorrow"}', '{"team:mlb:5":-5}', '{"team:mlb:5":true}', '{"team:mlb:5":{}}', '{"team:mlb:5":1e999}']) {
    assert.equal((await call('PUT', `{"snoozed":${bad}}`)).status, 400, bad);
  }
  assert.deepEqual(await snoozed(), {}, 'nothing was stored');

  assert.equal((await call('PUT', JSON.stringify({ snoozed: { [GUARDIANS]: until } }))).status, 200);
  assert.equal((await call('PUT', JSON.stringify({ snoozed: { 'team:mlb:30': until + 1 } }))).status, 200);
  assert.deepEqual(await snoozed(), { [GUARDIANS]: until, 'team:mlb:30': until + 1 }, 'a patch merges into the map');

  assert.equal((await call('PUT', JSON.stringify({ snoozed: { [GUARDIANS]: null } }))).status, 200);
  assert.deepEqual(await snoozed(), { 'team:mlb:30': until + 1 }, 'null removes the entry');
  await call('PUT', JSON.stringify({ snoozed: { 'team:mlb:30': 0 } }));
  assert.deepEqual(await snoozed(), {}, '0 removes it too');
  await call('PUT', JSON.stringify({ sound: false }));
  assert.equal((await (await call('GET')).json()).sound, false, 'a patch without snoozed still saves');
  server.close();
});
