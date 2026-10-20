// PUT /me/prefs rejects a body that would break alert delivery (prefsProblem, fanout.ts), a bad row already stored
// reads as defaults, and one device failing inside publish() doesn't cost the others their alert.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, '#000', 'x', 1, 1, 0)`)
  .run('team:mlb:5', 'mlb', '5', 'Cleveland Guardians', 'Guardians', 'CLE');
loadCatalog();

const { DEFAULT_PREFS, addSocket, getPrefs, inQuietHours, publish, pushAllowed, setPushSender } = await import('../src/fanout.ts');
const { startApi } = await import('../src/api.ts');

const server = startApi(0);
await new Promise((r) => server.once('listening', r));
after(() => { server.close(); });
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const { token, deviceId } = await (await fetch(`${base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"platform":"ios"}' })).json();
const put = (body: unknown) => fetch(`${base}/me/prefs`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const stored = () => (db.prepare('SELECT prefs FROM devices WHERE id = ?').get(deviceId) as { prefs: string }).prefs;

const MAPS = ['leagues', 'types', 'pushTypes', 'targetTypes', 'targetPushTypes', 'playerTeams'] as const;
const BAD: [unknown, string][] = [
  [{ muted: 5 }, 'muted'], [{ muted: 'team:mlb:5' }, 'muted'], [{ muted: [1] }, 'muted'], [{ muted: [null] }, 'muted'], [{ muted: { a: 1 } }, 'muted'],
  [{ quietHours: { enabled: true, tz: 'Mars/Olympus' } }, 'quietHours.tz'], [{ quietHours: { tz: 5 } }, 'quietHours.tz'], [{ quietHours: { tz: '' } }, 'quietHours.tz'],
  [{ quietHours: { start: '25:00' } }, 'quietHours.start'], [{ quietHours: { start: '9:00' } }, 'quietHours.start'], [{ quietHours: { start: '09:60' } }, 'quietHours.start'],
  [{ quietHours: { end: 'noon' } }, 'quietHours.end'], [{ quietHours: { end: 7 } }, 'quietHours.end'],
  [{ quietHours: { enabled: 'yes' } }, 'quietHours.enabled'], [{ quietHours: 'always' }, 'quietHours'], [{ quietHours: [] }, 'quietHours'], [{ quietHours: null }, 'quietHours'],
  [{ pushEnabled: 'no' }, 'pushEnabled'], [{ pushEnabled: null }, 'pushEnabled'], [{ sound: 1 }, 'sound'],
  ...MAPS.flatMap((k): [unknown, string][] => [[{ [k]: [] }, k], [{ [k]: 'x' }, k], [{ [k]: 5 }, k], [{ [k]: null }, k]]),
  [[], 'object'], [5, 'object'], ['x', 'object'],
];

test('a body that would break alert delivery answers 400 and leaves the stored settings as they were', async () => {
  const before = stored();
  for (const [body, word] of BAD) {
    const res = await put(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(String((await res.json()).error).includes(word), `${JSON.stringify(body)} names ${word}`);
  }
  assert.equal(stored(), before);
  assert.deepEqual(getPrefs(deviceId), JSON.parse(before), 'the cached copy too');
});

test('a body that mixes a good change with a bad one stores neither', async () => {
  const before = stored();
  assert.equal((await put({ sound: false, muted: 5 })).status, 400);
  assert.equal(stored(), before);
});

test('valid settings still store and merge as before: the phone’s own zone ("UTC", an alias), HH:MM, resets to null, an empty body', async () => {
  const ok = async (body: unknown) => { const res = await put(body); assert.equal(res.status, 200, JSON.stringify(body)); return res.json(); };
  let p = await ok({ quietHours: { enabled: true, tz: 'UTC' } }); // not in Intl.supportedValuesOf('timeZone'), but the zone a phone reports
  assert.deepEqual(p.quietHours, { ...DEFAULT_PREFS.quietHours, enabled: true, tz: 'UTC' });
  p = await ok({ quietHours: { start: '22:30', tz: 'Asia/Calcutta' } });
  assert.deepEqual(p.quietHours, { ...DEFAULT_PREFS.quietHours, enabled: true, start: '22:30', tz: 'Asia/Calcutta' }, 'the rest of quietHours is kept');
  assert.equal((await ok({ quietHours: { tz: 'Asia/Kolkata' } })).quietHours.tz, 'Asia/Kolkata');
  assert.deepEqual((await ok({ muted: ['team:mlb:5'], pushEnabled: false })).muted, ['team:mlb:5']);
  p = await ok({ targetTypes: { 'team:mlb:5': { 'team.lost': false } }, playerTeams: { 'player:mlb:1': { scores: false } } });
  assert.equal(p.targetTypes['team:mlb:5']['team.lost'], false);
  p = await ok({ targetTypes: { 'team:mlb:5': { 'team.lost': null } }, playerTeams: { 'player:mlb:1': { scores: null } } });
  assert.equal(p.targetTypes['team:mlb:5']?.['team.lost'], undefined, 'null resets to the global setting');
  await ok({});
  assert.doesNotThrow(() => inQuietHours(getPrefs(deviceId)), 'the stored zone formats');
});

// ─── A row stored before the validator existed ────────────────────────────────────────────────

const insert = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
const ROWS: Record<string, string> = {
  'muted-number': JSON.stringify({ ...DEFAULT_PREFS, muted: 5 }),
  'bad-zone': JSON.stringify({ ...DEFAULT_PREFS, quietHours: { enabled: true, start: '00:00', end: '23:59', tz: 'Mars/Olympus' } }),
  'maps-wrong': JSON.stringify({ ...DEFAULT_PREFS, leagues: 'x', types: 5, pushTypes: [], targetTypes: null, targetPushTypes: 'y', playerTeams: 7 }),
  'quiet-hours-string': JSON.stringify({ ...DEFAULT_PREFS, quietHours: 'always' }),
  'not-json': 'not json',
  'json-null': 'null',
};

test('a bad stored row reads as defaults for the part that is wrong, and nothing in the alert path throws on it', () => {
  for (const [id, prefs] of Object.entries(ROWS)) insert.run(id, 's', 'test', `tok-${id}`, prefs);
  for (const id of Object.keys(ROWS)) {
    const p = getPrefs(id);
    assert.deepEqual(p.muted, [], id);
    assert.equal(p.quietHours.tz, DEFAULT_PREFS.quietHours.tz, id);
    for (const k of MAPS) assert.equal(typeof p[k], 'object', `${id} ${k}`);
    assert.doesNotThrow(() => { pushAllowed(p, 'team:mlb:5'); inQuietHours(p); }, id);
  }
  assert.equal(getPrefs('bad-zone').quietHours.enabled, true, 'what is right in the row is kept');
  assert.equal(getPrefs('bad-zone').quietHours.end, '23:59');
});

// ─── publish() ────────────────────────────────────────────────────────────────────────────────

const pushes: string[] = [];
setPushSender((m) => pushes.push(...m.map((x: any) => `${x.to}|${x.data.eventId}`)));
const alert = (play: string) => ({ id: `G1:${play}:team.opponent_scored:5`, type: 'team.opponent_scored', targetKey: 'team:mlb:5', title: 'Rays scored', body: 'Rays scored 1 run.', at: 1000, meta: { gameId: 'G1' } });
const feed = (dev: string) => (db.prepare('SELECT event_id, pushed FROM feed WHERE device_id = ? ORDER BY event_id').all(dev) as { event_id: string; pushed: number }[]).map((r) => ({ ...r }));
const PUSH_OPPONENT_SCORED = JSON.stringify({ ...DEFAULT_PREFS, pushTypes: { 'team.opponent_scored': true } });

test('with one follower’s stored row corrupted, the other follower still gets its feed row and its push', () => {
  // 'a-' is read before 'z-' whether the follower scan goes by insertion or by device id.
  insert.run('a-corrupt', 's', 'test', 'tok-a-corrupt', JSON.stringify({ ...DEFAULT_PREFS, muted: 5, pushTypes: { 'team.opponent_scored': true } }));
  insert.run('z-good', 's', 'test', 'tok-z-good', PUSH_OPPONENT_SCORED);
  follow.run('a-corrupt', 'team:mlb:5');
  follow.run('z-good', 'team:mlb:5');
  publish([alert('p1')], 'mlb');
  assert.deepEqual(feed('z-good'), [{ event_id: 'G1:p1:team.opponent_scored:5', pushed: 1 }]);
  assert.ok(pushes.includes('tok-z-good|G1:p1:team.opponent_scored:5'));
  assert.deepEqual(feed('a-corrupt'), [{ event_id: 'G1:p1:team.opponent_scored:5', pushed: 1 }], 'the corrupted one reads as defaults and is served too');
});

test('when something still throws for one follower, it is logged with the device id and the others get the alert', () => {
  // A socket that fails on send: the failure comes after the device's feed row, before its push.
  insert.run('b-bad', 's', 'test', 'tok-b-bad', PUSH_OPPONENT_SCORED);
  insert.run('y-good', 's', 'test', 'tok-y-good', PUSH_OPPONENT_SCORED);
  follow.run('b-bad', 'team:mlb:5');
  follow.run('y-good', 'team:mlb:5');
  addSocket('b-bad', { send() { throw new Error('socket down'); }, close() {}, on() {} } as any);
  const logged: string[] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try {
    publish([alert('p2')], 'mlb');
    publish([alert('p2')], 'mlb'); // a re-poll is still a no-op: the event is stored once
  } finally { console.error = log; }
  assert.deepEqual(feed('y-good'), [{ event_id: 'G1:p2:team.opponent_scored:5', pushed: 1 }]);
  assert.ok(pushes.includes('tok-y-good|G1:p2:team.opponent_scored:5'));
  assert.ok(pushes.includes('tok-z-good|G1:p2:team.opponent_scored:5'), 'a follower handled before it');
  assert.ok(logged.some((l) => l.includes('b-bad') && l.includes('G1:p2:team.opponent_scored:5') && l.includes('socket down')), logged.join('\n'));
  assert.equal(pushes.filter((p) => p === 'tok-y-good|G1:p2:team.opponent_scored:5').length, 1, 'once');
});
