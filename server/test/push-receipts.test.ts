// Push receipts (push.ts): Expo answers a send with tickets at once and the verdict from Apple and Google 15 minutes
// later, as receipts. A DeviceNotRegistered receipt clears the device's push token, as the ticket does; any other error
// is logged and the token stays; an id Expo hasn't reported yet is asked about once more, then dropped. Expo is a
// stubbed fetch and the 15 minutes are mock timers.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { sendPushes } = await import('../src/push.ts');

const WAIT = 15 * 60_000;
const gone = (message = 'not registered') => ({ status: 'error', message, details: { error: 'DeviceNotRegistered' } });

const insert = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const addDevices = (...ids: string[]) => ids.forEach((id) => insert.run(id, 's', 'test', `tok-${id}`, '{}'));
const tokenOf = (id: string) => (db.prepare('SELECT push_token FROM devices WHERE id = ?').get(id) as { push_token: string | null }).push_token;
const push = (...ids: string[]) => sendPushes(ids.map((id) => ({ to: `tok-${id}`, title: 't', body: 'b', data: {} }) as any));

/** A receipts reply: the receipts by id, an HTTP status, or an error to throw. The last one repeats. */
type Reply = Record<string, unknown> | number | Error;

/** Stubs Expo: `tickets` answer the send; `receipts` answer the getReceipts requests in turn. Returns the ids each receipts request asked for. */
function expo(t: TestContext, tickets: unknown[], receipts: Reply[]) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const asked: string[][] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/send')) return Response.json({ data: tickets });
    assert.ok(url.endsWith('/getReceipts'), url);
    asked.push(JSON.parse(String(init.body)).ids);
    const reply = receipts[Math.min(asked.length - 1, receipts.length - 1)];
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'number') return new Response('error', { status: reply });
    return Response.json({ data: reply });
  });
  return asked;
}
const logs = (t: TestContext) => {
  const spy = t.mock.method(console, 'error', () => {});
  return () => spy.mock.calls.map((c) => c.arguments.join(' '));
};
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const wait = async (t: TestContext, ms: number) => { t.mock.timers.tick(ms); await flush(); };

test('a DeviceNotRegistered receipt clears the token, an ok receipt leaves it, and nothing is asked before 15 minutes', async (t) => {
  addDevices('dead-1', 'live-1');
  const asked = expo(t, [{ status: 'ok', id: 'A' }, { status: 'ok', id: 'B' }], [{ A: gone(), B: { status: 'ok' } }]);
  push('dead-1', 'live-1');
  await flush();
  assert.deepEqual([tokenOf('dead-1'), asked.length], ['tok-dead-1', 0], 'the ticket was ok: no verdict yet');
  await wait(t, WAIT - 1);
  assert.equal(asked.length, 0);
  await wait(t, 1);
  assert.deepEqual(asked, [['A', 'B']]);
  assert.equal(tokenOf('dead-1'), null);
  assert.equal(tokenOf('live-1'), 'tok-live-1');
  await wait(t, 10 * WAIT);
  assert.equal(asked.length, 1, 'every id had its verdict: nothing is asked again');
});

test('any other receipt error leaves the token, is logged once with its code and message, and is not asked again', async (t) => {
  addDevices('busy-1');
  const log = logs(t);
  const asked = expo(t, [{ status: 'ok', id: 'C' }], [{ C: { status: 'error', message: 'too many messages', details: { error: 'MessageRateExceeded' } } }]);
  push('busy-1');
  await flush();
  await wait(t, WAIT);
  assert.equal(tokenOf('busy-1'), 'tok-busy-1');
  const lines = log().filter((l) => l.includes('MessageRateExceeded'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /too many messages/);
  await wait(t, 10 * WAIT);
  assert.equal(asked.length, 1);
  assert.equal(log().length, 1, 'logged once');
});

test('an id with no receipt is asked about once more 15 minutes later, then dropped', async (t) => {
  addDevices('late-1', 'never-1');
  const log = logs(t);
  const asked = expo(t, [{ status: 'ok', id: 'D' }, { status: 'ok', id: 'E' }], [{}, { D: gone() }]);
  push('late-1', 'never-1');
  await flush();
  await wait(t, WAIT);
  assert.deepEqual(asked, [['D', 'E']]);
  assert.equal(tokenOf('late-1'), 'tok-late-1', 'no receipt yet');
  await wait(t, WAIT);
  assert.deepEqual(asked, [['D', 'E'], ['D', 'E']]);
  assert.equal(tokenOf('late-1'), null, 'its receipt came on the second try');
  assert.equal(tokenOf('never-1'), 'tok-never-1', 'no verdict means the token stays');
  assert.ok(log().some((l) => l.includes('no receipt for 1 ')));
  await wait(t, 10 * WAIT);
  assert.equal(asked.length, 2, 'dropped: no third request');
});

test('a failed receipts request keeps the ids for the retry, which clears the token', async (t) => {
  addDevices('flaky-1');
  const log = logs(t);
  const asked = expo(t, [{ status: 'ok', id: 'F' }], [500, { F: gone() }]);
  push('flaky-1');
  await flush();
  await wait(t, WAIT);
  assert.equal(tokenOf('flaky-1'), 'tok-flaky-1');
  assert.ok(log().some((l) => l.includes('receipts failed') && l.includes('500')));
  await wait(t, WAIT);
  assert.deepEqual(asked, [['F'], ['F']]);
  assert.equal(tokenOf('flaky-1'), null);
});

test('a DeviceNotRegistered ticket still clears the token at once, and only the ok ticket gets a receipt check', async (t) => {
  addDevices('old-1', 'new-1');
  const asked = expo(t, [gone(), { status: 'ok', id: 'G' }], [{ G: { status: 'ok' } }]);
  push('old-1', 'new-1');
  await flush();
  assert.equal(tokenOf('old-1'), null);
  assert.equal(tokenOf('new-1'), 'tok-new-1');
  await wait(t, WAIT);
  assert.deepEqual(asked, [['G']]);
});
