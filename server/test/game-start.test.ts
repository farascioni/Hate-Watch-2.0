// "Hate Watch Starting": drives a real GameTracker with fake ESPN responses through the moment a game
// goes from pre-game to live, and checks what lands in each follower's feed. Also the loss wording.
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

test('a loss is a "Successful Hate Watch!", with the final score winner first; a tie is not a loss', async () => {
  const { gameLostEvent } = await import('../src/detectors.ts');
  const g = { league: 'nfl' as const, gameId: 'G9', homeId: '21', awayId: '3' };
  const lost = gameLostEvent(g, { home: 17, away: 24 }, 0)!;
  assert.equal(lost.targetKey, 'team:nfl:21');
  assert.equal(lost.title, 'Successful Hate Watch! Eagles lost to the Bears');
  assert.equal(lost.body, 'Final Score: 24 to 17');
  assert.equal(lost.id, 'G9:final:team.lost:21', 'same id as before the wording change: no repeat for a game final across the deploy');
  assert.equal(gameLostEvent(g, { home: 30, away: 10 }, 0)!.title, 'Successful Hate Watch! Bears lost to the Eagles', 'by 20: one short of a blowout');
  assert.equal(gameLostEvent(g, { home: 20, away: 20 }, 0), null);
});

test('a blowout loss says so: "got BLOWN OUT", and by how much', async () => {
  const { gameLostEvent, playerTeamLostEvents, isBlowout } = await import('../src/detectors.ts');
  const g = { league: 'nfl' as const, gameId: 'B1', homeId: '21', awayId: '3' };
  const lost = gameLostEvent(g, { home: 31, away: 10 }, 0)!;
  assert.deepEqual([lost.title, lost.body, lost.meta?.blowout], ['Successful Hate Watch! Bears got BLOWN OUT by the Eagles', 'Final Score: 31 to 10. A 21-point blowout.', true]);
  assert.equal(lost.id, 'B1:final:team.lost:3', 'the same alert, just its words');
  assert.equal(playerTeamLostEvents(g, lost, [{ key: 'player:nfl:9', espnId: '9', name: 'Caleb Williams' }])[0].title, 'Successful Hate Watch! Caleb Williams and the Bears got BLOWN OUT by the Eagles');
  // Each sport's line: at it is a blowout, one short isn't.
  for (const [lg, at] of [['mlb', 7], ['nfl', 21], ['nba', 25], ['wnba', 20], ['nhl', 4], ['epl', 3]] as const) {
    assert.ok(isBlowout(lg, at) && !isBlowout(lg, at - 1), lg);
  }
  assert.equal(isBlowout('f1', 99), false);
  assert.equal(gameLostEvent({ league: 'mlb', gameId: 'M1', homeId: '21', awayId: '3' }, { home: 2, away: 9 }, 0)!.body, 'Final Score: 9 to 2. A 7-run blowout.');
  assert.equal(gameLostEvent({ league: 'nhl', gameId: 'H1', homeId: '21', awayId: '3' }, { home: 1, away: 5 }, 0)!.body, 'Final Score: 5 to 1. A 4-goal blowout.');
  assert.equal(gameLostEvent({ league: 'mlb', gameId: 'M2', homeId: '21', awayId: '3' }, { home: 0, away: 8 }, 0)!.body, 'Final Score: 8 to 0. An 8-run blowout.');
});

test('a game first seen already under way never gets a late "starting" alert', async () => {
  // e.g. someone follows the Eagles in the 3rd quarter, or the server restarts mid-game
  const game = new GameTracker('nfl', 'G2', '21', '3');
  await game.poll();
  await game.poll();
  assert.equal(feed('eagles-fan').length, 1, 'only the G1 alert from the previous test');
});
