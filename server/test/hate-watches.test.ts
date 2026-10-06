// The Settings counter: every Successful Hate Watch (a team you track lost; F1, no points) per device,
// whatever its alert settings, surviving a cleared feed, and counted for losses from before it existed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, '#000', 'x', 1, 1, 0)`);
team.run('team:nfl:1', 'nfl', '1', 'Atlanta Falcons', 'Falcons', 'ATL');
team.run('team:nfl:18', 'nfl', '18', 'New Orleans Saints', 'Saints', 'NO');
team.run('team:f1:williams', 'f1', 'williams', 'Williams', 'Williams', 'WIL');
loadCatalog();

const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)');
const tally = async (dev: string) => (await import('../src/hate-watches.ts')).hateWatchTally(dev);
const summary = async (dev: string) => { const t = await tally(dev); return [t.total, t.teams.map((x) => `${x.target.key} ×${x.count}`)]; };

// Before the counter existed: a Falcons loss on 2026-09-28, detected at t=100.
db.prepare(`INSERT INTO events (id, type, league, target_key, title, body, occurred_at, detected_at) VALUES (?, ?, 'nfl', 'team:nfl:1', 'Successful Hate Watch!', '', 90, 100)`)
  .run('OLD:final:team.lost:1', 'team.lost');
for (const [id, prefs] of [['old-fan', {}], ['alert-off', { types: { 'team.lost': false } }], ['late-fan', {}], ['saints-fan', {}]] as const) {
  device.run(id, 's', 'test', JSON.stringify(prefs));
}
follow.run('old-fan', 'team:nfl:1', 0);
follow.run('alert-off', 'team:nfl:1', 0); // tracked them then, but the loss never made the feed
follow.run('late-fan', 'team:nfl:1', 500); // started tracking after that loss
follow.run('saints-fan', 'team:nfl:18', 0);
db.prepare('INSERT INTO feed (device_id, event_id, occurred_at) VALUES (?, ?, 90)').run('old-fan', 'OLD:final:team.lost:1');

const { publish, addSocket, DEFAULT_PREFS } = await import('../src/fanout.ts'); // loading it counts the old losses
const { gameLostEvent } = await import('../src/detectors.ts');
for (const id of ['old-fan', 'alert-off', 'late-fan', 'saints-fan']) {
  const cur = JSON.parse((db.prepare('SELECT prefs FROM devices WHERE id = ?').get(id) as any).prefs);
  db.prepare('UPDATE devices SET prefs = ? WHERE id = ?').run(JSON.stringify({ ...DEFAULT_PREFS, ...cur }), id);
}

test('losses from before the counter: the ones in a feed, and ones a tracker had switched off', async () => {
  assert.deepEqual(await summary('old-fan'), [1, ['team:nfl:1 ×1']]);
  assert.deepEqual(await summary('alert-off'), [1, ['team:nfl:1 ×1']]);
  assert.deepEqual(await summary('late-fan'), [0, []], 'not tracking them yet');
});

test('a loss counts for every tracker, alert on or off, once, and the app hears the new tally', async () => {
  const frames: any[] = [];
  addSocket('late-fan', { send: (s: string) => frames.push(JSON.parse(s)), on: () => {} } as any);
  const loss = gameLostEvent({ league: 'nfl', gameId: 'G1', homeId: '18', awayId: '1' }, { home: 27, away: 13 }, 1000)!;
  publish([loss], 'nfl');
  publish([loss], 'nfl'); // a re-poll
  assert.deepEqual(await summary('old-fan'), [2, ['team:nfl:1 ×2']]);
  assert.deepEqual(await summary('alert-off'), [2, ['team:nfl:1 ×2']], 'counted even though the alert is off');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM feed WHERE device_id = 'alert-off'").get() as any).n, 0, '…and still kept out of the feed');
  assert.deepEqual(await summary('saints-fan'), [0, []], 'the winners are not a hate watch');
  assert.deepEqual(frames.filter((f) => f.kind === 'hateWatches').map((f) => f.tally.total), [1], 'one frame, with the new total');

  // How many others got it: old-fan and late-fan did (alert-off has the alert off), so one other each.
  assert.equal(frames.find((f) => f.kind === 'event').item.alsoGot, 1, 'live, in the alert itself');
  const { RECIPIENTS, withHateWatch } = await import('../src/hate-watches.ts');
  const { feedItem } = await import('../src/fanout.ts');
  const read = (dev: string) => (db.prepare(`SELECT e.*, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.game_id = 'G1'`).all(dev) as any[]).map(feedItem);
  assert.deepEqual(read('old-fan').map((i) => [i.type, i.alsoGot]), [['team.lost', 1]], 'and from the feed later');
  const final = { id: 'G1', state: 'post' }, live = { id: 'G9', state: 'in' };
  assert.deepEqual(withHateWatch('late-fan', [final, live]), [{ ...final, hateWatch: { alsoGot: 1 } }, live], 'the Scores tab: on the final it came from');
  assert.deepEqual(withHateWatch('alert-off', [final]), [final], "the alert was off: it wasn't received, so no count");

  db.prepare("DELETE FROM feed WHERE device_id = 'old-fan'").run(); // Settings → Clear feed
  assert.equal((await tally('old-fan')).total, 2, 'clearing the feed keeps the count');
});

test('F1: a constructor out of the points counts (a double DNF too); other alerts do not', async () => {
  follow.run('late-fan', 'team:f1:williams', 0);
  const base = { targetKey: 'team:f1:williams', title: 'x', body: 'x', at: 2000, meta: { compId: 'R1' } };
  publish([{ ...base, id: 'R1:f1.team.no_points:williams', type: 'f1.team.no_points' }], 'f1');
  publish([{ ...base, id: 'R2:f1.team.double_dnf:williams', type: 'f1.team.double_dnf', aliases: ['f1.team.no_points'] }], 'f1');
  publish([{ ...base, id: 'R3:team.game_start:williams', type: 'team.game_start' }], 'f1');
  assert.deepEqual(await summary('late-fan'), [3, ['team:f1:williams ×2', 'team:nfl:1 ×1']], 'most first');
});

test('"Delete all my data" takes the count with it', async () => {
  db.prepare("DELETE FROM devices WHERE id = 'old-fan'").run();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM hate_watches WHERE device_id = 'old-fan'").get() as any).n, 0);
});
