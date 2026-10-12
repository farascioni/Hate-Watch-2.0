// Developer notices (notices.ts): a message from Hate Watch in every install's feed, never a push. Sent from the
// shell, shown in open apps within seconds, drawn as from Hate Watch (a red "HW" badge every build can draw), left
// out of the weekly recap, and withdrawn from every feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { DEFAULT_PREFS, setPushSender, feedItem, addSocket, NOTICE_TYPE } = await import('../src/fanout.ts');
const { sendNotice, listNotices, withdrawNotice, noticeProblem, watchNotices } = await import('../src/notices.ts');
const { recapFor } = await import('../src/recap.ts');

const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
for (const id of ['a', 'b', 'c']) device.run(id, 's', 'ios', `ExponentPushToken[${id}]`, JSON.stringify(DEFAULT_PREFS));
let pushes = 0;
setPushSender((m) => { pushes += m.length; });
const feedOf = (deviceId: string) => (db.prepare(`SELECT e.*, f.pushed FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(deviceId) as any[]);

test('a notice goes into every feed, never pushed, drawn as from Hate Watch', () => {
  const sent = sendNotice({ title: 'Live scores are delayed', body: 'ESPN is slow tonight; alerts may come a minute late.' }, { now: 1_000 });
  assert.deepEqual(sent, { id: 'notice:1000', devices: 3 });
  for (const d of ['a', 'b', 'c']) {
    const rows = feedOf(d);
    assert.equal(rows.length, 1, d);
    assert.equal(rows[0].type, NOTICE_TYPE);
    assert.equal(rows[0].pushed, 0, `${d}: feed only`);
  }
  assert.equal(pushes, 0, 'no push is ever sent');
  const item = feedItem(feedOf('a')[0]);
  assert.equal(item.title, 'Live scores are delayed');
  assert.equal(item.emoji, '📣');
  assert.equal(item.typeLabel, 'From Hate Watch');
  assert.equal(item.league, 'news');
  assert.equal(item.urgent, undefined);
  // Team-shaped, with a "badge://" logo: every build draws it (build 12 would crash on a bare { kind, key }).
  assert.equal(item.target.kind, 'team');
  assert.equal((item.target as any).abbrev, 'HW');
  assert.match((item.target as any).logo, /^badge:\/\//);
});

test('an urgent notice says so', () => {
  sendNotice({ title: 'Wrong alerts went out', body: 'Some NFL alerts this afternoon named the wrong player. Fixed now.', urgent: true }, { now: 2_000 });
  const item = feedItem(feedOf('b').at(-1));
  assert.equal(item.emoji, '⚠️');
  assert.equal(item.typeLabel, 'Important: from Hate Watch');
  assert.equal(item.urgent, true);
  assert.deepEqual(listNotices().map((n) => [n.id, n.devices]), [['notice:2000', 3], ['notice:1000', 3]]);
});

test('a dry run reaches no one; a notice needs a title and a body, the title short', () => {
  assert.deepEqual(sendNotice({ title: 'x', body: 'y' }, { dryRun: true }), { id: null, devices: 3 });
  assert.equal(listNotices().length, 2, 'nothing sent');
  assert.match(noticeProblem({ title: ' ', body: 'y' })!, /title/);
  assert.match(noticeProblem({ title: 'x', body: '' })!, /body/);
  assert.match(noticeProblem({ title: 'x'.repeat(121), body: 'y' })!, /120/);
  assert.equal(noticeProblem({ title: 'x', body: 'y' }), null);
  assert.throws(() => sendNotice({ title: '', body: 'y' }), /title/);
});

test("the weekly recap doesn't count notices", () => {
  // Monday 9 am Eastern, the week after: notices are the only thing in these feeds, so nothing to recap.
  const monday = Date.parse('2026-10-12T13:00:00Z');
  for (let i = 0; i < 6; i++) sendNotice({ title: `News ${i}`, body: 'Coming soon.' }, { now: monday - 86400_000 - i * 1000 });
  assert.equal(recapFor('c', monday), null);
});

test('open apps get a new notice within seconds, only those whose feed has it', async () => {
  const frames: Record<string, any[]> = { a: [], z: [] };
  addSocket('a', { on() {}, send: (f: string) => frames.a.push(JSON.parse(f)) } as any);
  addSocket('z', { on() {}, send: (f: string) => frames.z.push(JSON.parse(f)) } as any); // not a device when it was sent
  const timer = watchNotices(10);
  try {
    sendNotice({ title: 'Something new', body: 'Track UFC fighters now.' }, { now: 3_000 });
    await new Promise((r) => setTimeout(r, 60));
  } finally { clearInterval(timer); }
  assert.deepEqual(frames.a.map((f) => [f.kind, f.item.id, f.item.title]), [['event', 'notice:3000', 'Something new']]);
  assert.deepEqual(frames.z, []);
});

test('a notice is withdrawn from every feed', () => {
  assert.deepEqual(withdrawNotice('notice:1000'), { found: true, feeds: 3 });
  for (const d of ['a', 'b', 'c']) assert.ok(!feedOf(d).some((r) => r.id === 'notice:1000'), d);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events WHERE id = ?').get('notice:1000') as { n: number }).n, 0);
  assert.deepEqual(withdrawNotice('notice:1000'), { found: false, feeds: 0 });
  assert.deepEqual(withdrawNotice('team:nfl:1'), { found: false, feeds: 0 }, 'only notices');
});
