// "Hate Watch Starting": drives a real GameTracker with fake ESPN responses through the moment a game
// goes from pre-game to live, and checks what lands in each follower's feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { urls } = await import('../src/leagues.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, 'nfl', ?, ?, ?, ?, '#000', 'x', 1, 1, 0)`);
team.run('team:nfl:21', '21', 'Philadelphia Eagles', 'Eagles', 'PHI');
team.run('team:nfl:3', '3', 'Chicago Bears', 'Bears', 'CHI');
loadCatalog();

// One fan of each team, plus one who turned "Game starts" off.
const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
device.run('eagles-fan', 's', 'test', JSON.stringify(DEFAULT_PREFS));
device.run('bears-fan', 's', 'test', JSON.stringify(DEFAULT_PREFS));
device.run('opted-out', 's', 'test', JSON.stringify({ ...DEFAULT_PREFS, types: { 'team.game_start': false } }));
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
follow.run('eagles-fan', 'team:nfl:21');
follow.run('bears-fan', 'team:nfl:3');
follow.run('opted-out', 'team:nfl:21');
const feed = (dev: string) => (db.prepare(`SELECT e.title, e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY e.id`).all(dev) as any[])
  .map((r) => `${r.title} | ${r.body}`);

// Fake ESPN: no plays yet, and a game state the test flips.
const state: Record<string, string> = { G1: 'pre', G2: 'in' };
liveDeps.getJson = async (url: string) => {
  for (const id of Object.keys(state)) {
    if (url === urls.corePlays('nfl', id)) return { items: [] };
    if (url === urls.summary('nfl', id)) return { header: { competitions: [{ status: { type: { state: state[id], completed: false } }, competitors: [] }] } };
  }
  throw new Error(`unexpected fetch ${url}`);
};

test('a game going live sends "Hate Watch Starting" once, to each side, from its own point of view', async () => {
  const game = new GameTracker('nfl', 'G1', '21', '3', { sawPre: true, venue: 'Lincoln Financial Field', tv: 'FOX' });

  await game.poll(); // pre-game
  assert.deepEqual(feed('eagles-fan'), []);

  state.G1 = 'in'; // kickoff
  await game.poll();
  assert.deepEqual(feed('eagles-fan'), ['Hate Watch Starting: Eagles vs Bears | Kickoff at Lincoln Financial Field · FOX']);
  assert.deepEqual(feed('bears-fan'), ['Hate Watch Starting: Bears vs Eagles | Kickoff at Lincoln Financial Field · FOX']);
  assert.deepEqual(feed('opted-out'), [], 'respects the Game starts switch');

  await game.poll(); // still live: no repeat
  assert.equal(feed('eagles-fan').length, 1);
});

test('a game first seen already under way never gets a late "starting" alert', async () => {
  // e.g. someone follows the Eagles in the 3rd quarter, or the server restarts mid-game
  const game = new GameTracker('nfl', 'G2', '21', '3');
  await game.poll();
  await game.poll();
  assert.equal(feed('eagles-fan').length, 1, 'only the G1 alert from the previous test');
});
