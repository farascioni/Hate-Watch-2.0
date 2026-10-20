// The game screen's "N hate-watching now": GET /me/games/:key answers `watching`, the number of other devices
// `recipients()` would address an alert about either side to (fanout.ts watchingCount).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const S = await import('../src/scores.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, '#000', 'x', 1, 1, 0)`);
team.run('team:mlb:5', 'mlb', '5', 'Cleveland Guardians', 'Guardians', 'CLE');
team.run('team:mlb:4', 'mlb', '4', 'Chicago White Sox', 'White Sox', 'CHW');
team.run('team:mlb:10', 'mlb', '10', 'New York Yankees', 'Yankees', 'NYY');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
player.run('player:mlb:50', '50', 'Jose Ramirez', 'team:mlb:5');
player.run('player:mlb:100', '100', 'Aaron Judge', 'team:mlb:10');
loadCatalog();

const { startApi } = await import('../src/api.ts');
const { watchingCount, setPrefs } = await import('../src/fanout.ts');
const { addFavorite } = await import('../src/favorites.ts');

S.scoresDeps.getJson = async () => { throw new Error('offline'); }; // the route's ESPN read; the card still answers
const competitor = (id: string, homeAway: string, abbr: string) => ({ id, homeAway, score: '2', team: { id, abbreviation: abbr } });
const card = S.gameCard('mlb', {
  id: 'ev1', date: new Date().toISOString(), season: { slug: 'regular-season' },
  status: { type: { state: 'in', shortDetail: 'Top 5th' } },
  competitions: [{ competitors: [competitor('5', 'home', 'CLE'), competitor('4', 'away', 'CHW')] }],
})!;
S.upsertGame(card);

const server = startApi(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const join = async () => (await fetch(`${base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"platform":"ios"}' })).json() as Promise<{ token: string; deviceId: string }>;
const watching = async (who: { token: string }) =>
  (await (await fetch(`${base}/me/games/${encodeURIComponent(card.key)}`, { headers: { authorization: `Bearer ${who.token}` } })).json()).watching;
const follow = (deviceId: string, key: string) => db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(deviceId, key);

const [a, b, c, d, e, offPlayer, other, both, quiet] = await Promise.all(Array.from({ length: 9 }, join));
// only a device that can be reached counts: a push token, or a feed (d has a feed row and no token; quiet has neither)
const token = db.prepare('UPDATE devices SET push_token = ? WHERE id = ?');
for (const who of [a, b, c, offPlayer, other, both]) token.run(`ExponentPushToken[${who.deviceId}]`, who.deviceId);
db.prepare(`INSERT INTO events (id, type, league, target_key, title, body, occurred_at, detected_at) VALUES ('old', 'team.lost', 'mlb', 'team:mlb:4', 't', 'b', 0, 0)`).run();
db.prepare('INSERT INTO feed (device_id, event_id, occurred_at) VALUES (?, ?, 0)').run(d.deviceId, 'old');
follow(a.deviceId, 'team:mlb:4'); // two followers of the away team
follow(b.deviceId, 'team:mlb:4');
follow(c.deviceId, 'player:mlb:50'); // a home player's follower, with "Get their team's alerts" on
setPrefs(c.deviceId, { playerTeams: { 'player:mlb:50': { alerts: true } } });
addFavorite(d.deviceId, 'team:mlb:4'); // a favorite is sent the opponent's alerts: this game's
// not counted: e asks; a player's follower with the team's alerts off; a follower of another team and its player; and one device tracking
// the away team and a home player (and favoriting the home team) is counted once
follow(offPlayer.deviceId, 'player:mlb:50');
follow(quiet.deviceId, 'team:mlb:4'); // follows the away team but has no push token and no feed
follow(other.deviceId, 'team:mlb:10');
follow(other.deviceId, 'player:mlb:100');
setPrefs(other.deviceId, { playerTeams: { 'player:mlb:100': { alerts: true } } });
follow(both.deviceId, 'team:mlb:4');
follow(both.deviceId, 'player:mlb:50');
setPrefs(both.deviceId, { playerTeams: { 'player:mlb:50': { alerts: true } } });
addFavorite(both.deviceId, 'team:mlb:5');

test('the game answers how many other devices would get an alert for either side', async () => {
  assert.equal(await watching(e), 5, 'a, b, c, d and both: followers of the away team, a home player with team alerts on, a favorite');
});

test('the device asking is not counted', async () => {
  for (const who of [a, b, c, d, both]) assert.equal(await watching(who), 4, who.deviceId);
});

test('one device tracking a side more than one way, or its player and favoriting, counts once', async () => {
  assert.equal(watchingCount(['team:mlb:5', 'team:mlb:4'], e.deviceId), 5);
  assert.equal(watchingCount(['team:mlb:4', 'team:mlb:5'], both.deviceId), 4, 'the pair in either order');
});

test('a follower with no push token and an empty feed is not counted, until it has a feed', async () => {
  assert.equal(await watching(e), 5, 'quiet is not among the five');
  db.prepare('INSERT INTO feed (device_id, event_id, occurred_at) VALUES (?, ?, 0)').run(quiet.deviceId, 'old');
  assert.equal(await watching(e), 6, 'a feed row makes it reachable');
  db.prepare('DELETE FROM feed WHERE device_id = ?').run(quiet.deviceId);
});

test('a player’s follower with "Get their team’s alerts" off, and followers of other games, are not counted', async () => {
  assert.equal(watchingCount(['team:mlb:5', 'team:mlb:4'], offPlayer.deviceId), 5);
  setPrefs(c.deviceId, { playerTeams: { 'player:mlb:50': { alerts: false } } });
  assert.equal(await watching(e), 4, 'c turned the team’s alerts off');
});

test('a game with no tracked side, or nobody watching, is 0', async () => {
  assert.equal(watchingCount([], e.deviceId), 0, 'an F1 session has no sides');
  assert.equal(watchingCount(['team:mlb:77', 'team:mlb:78'], e.deviceId), 0);
  server.close();
});
