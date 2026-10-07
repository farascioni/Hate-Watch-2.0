// "Their team loses": people who track a player hear when the player's team loses. One alert per device
// for one loss, whether it tracks the team too or several of its players. Through a real GameTracker's
// final and publish().
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { RECIPIENTS, hateWatchTally, withHateWatch } = await import('../src/hate-watches.ts');
const { addSocket, feedItem } = await import('../src/fanout.ts');

// Live frames, as a connected app would get them.
const frames = new Map<string, any[]>();
for (const dev of ['penix-fan', 'both']) addSocket(dev, { on() {}, send: (f: string) => frames.set(dev, [...(frames.get(dev) ?? []), JSON.parse(f)]) } as any);
const { GameTracker, trackedPlayersOn } = await import('../src/live.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:nfl:1', 'nfl', '1', 'Atlanta Falcons', 'Falcons', 'ATL');
team.run('team:nfl:18', 'nfl', '18', 'New Orleans Saints', 'Saints', 'NO');
team.run('team:epl:364', 'epl', '364', 'Liverpool', 'Liverpool', 'LIV');
team.run('team:epl:349', 'epl', '349', 'AFC Bournemouth', 'Bournemouth', 'BOU');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
player.run('player:nfl:9', 'nfl', '9', 'Michael Penix Jr.', 'team:nfl:1');
player.run('player:nfl:7', 'nfl', '7', 'Bijan Robinson', 'team:nfl:1');
player.run('player:nfl:20', 'nfl', '20', 'Drake London', 'team:nfl:1'); // nobody tracks him
player.run('player:nfl:41', 'nfl', '41', 'Alvin Kamara', 'team:nfl:18');
player.run('player:epl:235662', 'epl', '235662', 'Alexander Isak', 'team:epl:364');
loadCatalog();

const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
const fans: [string, string[], object][] = [
  ['penix-fan', ['player:nfl:9'], {}],
  ['both', ['team:nfl:1', 'player:nfl:9'], {}],
  ['both-team-loss-off', ['team:nfl:1', 'player:nfl:9'], { types: { 'team.lost': false } }],
  ['two-players', ['player:nfl:9', 'player:nfl:7'], {}],
  ['switched-off', ['player:nfl:9'], { types: { 'player.team_lost': false } }],
  ['off-for-penix', ['player:nfl:9'], { targetTypes: { 'player:nfl:9': { 'player.team_lost': false } } }],
  ['kamara-fan', ['player:nfl:41'], {}],
  ['isak-fan', ['player:epl:235662'], {}],
];
for (const [id, keys, prefs] of fans) {
  device.run(id, 's', 'test', JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  for (const k of keys) follow.run(id, k);
}
// Two Falcons tracked, Penix first: the alert is his, though Bijan Robinson comes first by name. Unless
// Penix's alert is switched off: then it's the next one they track.
const followAt = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)');
for (const [id, prefs] of [['penix-first', {}], ['penix-first-but-off', { targetTypes: { 'player:nfl:9': { 'player.team_lost': false } } }]] as const) {
  device.run(id, 's', 'test', JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  followAt.run(id, 'player:nfl:9', 100);
  followAt.run(id, 'player:nfl:7', 200);
}
const feed = (dev: string) => (db.prepare(`SELECT e.type, e.title, e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY e.id`).all(dev) as any[])
  .map((r) => `${r.type}: ${r.title} | ${r.body}`);

test('one switch, for players, in every league but F1', () => {
  const t = EVENT_TYPES.find((x) => x.id === 'player.team_lost')!;
  assert.equal(t.scope, 'player');
  assert.deepEqual(t.leagues, ['nba', 'wnba', 'mlb', 'nfl', 'nhl', 'epl']);
  assert.deepEqual(trackedPlayersOn('team:nfl:1').map((p) => p.name).sort(), ['Bijan Robinson', 'Michael Penix Jr.'], 'only players someone tracks');
});

test("a tracked player's team loses: their fans hear it once, and nobody tracking the team hears it twice", () => {
  new GameTracker('nfl', 'G1', '18', '1').finish({ home: 27, away: 13 }); // Saints 27, Falcons 13
  const loss = 'team.lost: Successful Hate Watch! Falcons lost to the Saints | Final Score: 27 to 13';
  const penix = 'player.team_lost: Successful Hate Watch! Michael Penix Jr. and the Falcons lost to the Saints | Final Score: 27 to 13';
  assert.deepEqual(feed('penix-fan'), [penix]);
  assert.deepEqual(feed('both'), [loss], 'tracks the team too: the team loss only');
  assert.deepEqual(feed('both-team-loss-off'), [penix], 'team loss alerts off: the player one instead');
  assert.deepEqual(feed('two-players'), ['player.team_lost: Successful Hate Watch! Bijan Robinson and the Falcons lost to the Saints | Final Score: 27 to 13'], 'two players on one team, followed at the same moment: one alert, by name');
  assert.deepEqual(feed('penix-first'), [penix], 'the one they tracked first');
  assert.deepEqual(feed('penix-first-but-off'), ['player.team_lost: Successful Hate Watch! Bijan Robinson and the Falcons lost to the Saints | Final Score: 27 to 13'], "the first one's alert is off: the next");
  assert.deepEqual(feed('switched-off'), [], 'the Settings switch');
  assert.deepEqual(feed('off-for-penix'), [], "the player's own ⚙️ switch");
  assert.deepEqual(feed('kamara-fan'), [], 'his team won');
});

test("a player's team losing is a Successful Hate Watch for that team, once per device, never listing the player", () => {
  const tally = (dev: string) => { const t = hateWatchTally(dev); return [t.total, t.teams.map((x: any) => `${x.target.key} ${x.count}`)]; };
  assert.deepEqual(tally('penix-fan'), [1, ['team:nfl:1 1']], 'counted for the Falcons, not for Penix');
  assert.deepEqual(tally('both'), [1, ['team:nfl:1 1']], 'tracks the Falcons and Penix: one');
  assert.deepEqual(tally('two-players'), [1, ['team:nfl:1 1']], 'two Falcons: one');
  assert.deepEqual(tally('switched-off'), [1, ['team:nfl:1 1']], 'counted whatever the alert settings, like a team loss');
  assert.deepEqual(tally('kamara-fan'), [0, []], 'his team won');
  // "N other hate watchers": everyone who got one of the loss's alerts. Penix's fan, the team alert in
  // "both", Penix's in "both-team-loss-off", Bijan's in "two-players", and the two who followed Penix
  // first: 6 devices, so 5 others each.
  const items = (dev: string) => (db.prepare(`SELECT e.*, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ?`).all(dev) as any[]).map((r) => feedItem(r));
  for (const dev of ['penix-fan', 'both', 'both-team-loss-off', 'two-players']) assert.deepEqual(items(dev).map((i) => i.alsoGot), [5], dev);
  // The final on the Scores tab says the same, for the player's fan as for the team's.
  for (const dev of ['penix-fan', 'both']) assert.deepEqual(withHateWatch(dev, [{ id: 'G1', state: 'post' }])[0].hateWatch, { alsoGot: 5 }, dev);
  // Live too: the alert's own frame already counts both kinds, and the counter's new tally follows it.
  for (const dev of ['penix-fan', 'both']) {
    assert.deepEqual(frames.get(dev)!.filter((x) => x.kind === 'event').map((x) => [x.item.type, x.item.alsoGot]), [[dev === 'both' ? 'team.lost' : 'player.team_lost', 5]], dev);
    assert.deepEqual(frames.get(dev)!.filter((x) => x.kind === 'hateWatches').map((x) => x.tally.total), [1], `${dev}: one new tally`);
  }
});

test('soccer wording, and a draw is nobody’s loss', () => {
  new GameTracker('epl', 'M1', '349', '364').finish({ home: 1, away: 1 });
  assert.deepEqual(feed('isak-fan'), []);
  new GameTracker('epl', 'M2', '349', '364').finish({ home: 1, away: 0 });
  assert.deepEqual(feed('isak-fan'), ['player.team_lost: Successful Hate Watch! Alexander Isak and Liverpool lost to Bournemouth | Final Score: 1 to 0']);
});
