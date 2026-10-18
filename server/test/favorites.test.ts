// Hate Watch Plus favorites (favorites.ts): root for the Rays and the Guardians' alerts in the game they play you
// reach your feed and push, with the favorite's own choices; in any other game they don't.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, '#000', 'x', 1, 1, 0)`);
team.run('team:mlb:30', 'mlb', '30', 'Tampa Bay Rays', 'Rays', 'TB');
team.run('team:mlb:5', 'mlb', '5', 'Cleveland Guardians', 'Guardians', 'CLE');
team.run('team:mlb:10', 'mlb', '10', 'New York Yankees', 'Yankees', 'NYY');
loadCatalog();

const { DEFAULT_PREFS, publish, setPushSender, setPrefs, feedItem } = await import('../src/fanout.ts');
const { addFavorite, updateFavorite, registerGame, favoriteTeamKeys, removeFavorite } = await import('../src/favorites.ts');
const { gameLostEvent, gameStartEvents } = await import('../src/detectors.ts');
const { hateWatchTally, RECIPIENTS } = await import('../src/hate-watches.ts');

const pushes: string[] = [];
setPushSender((m) => pushes.push(...m.map((x: any) => `${x.to}|${x.data.eventId}`)));

const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
for (const id of ['fan', 'quiet-fan', 'tracker', 'both', 'yankee-fan']) device.run(id, 's', 'test', `tok-${id}`, JSON.stringify(DEFAULT_PREFS));
db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('tracker', 'team:mlb:5');
db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('both', 'team:mlb:5');
addFavorite('fan', 'team:mlb:30');
addFavorite('quiet-fan', 'team:mlb:30');
addFavorite('both', 'team:mlb:30');
addFavorite('yankee-fan', 'team:mlb:10');
registerGame('mlb', 'G1', 'team:mlb:30', 'team:mlb:5'); // Rays vs Guardians tonight

const scored = (gameId: string, play: string) => ({ id: `${gameId}:${play}:team.opponent_scored:5`, type: 'team.opponent_scored', targetKey: 'team:mlb:5', title: 'Rays scored', body: 'Rays scored 1 run.', at: 1000, meta: { gameId } });
const feed = (dev: string) => db.prepare('SELECT event_id, pushed, fav FROM feed WHERE device_id = ? ORDER BY event_id').all(dev).map((r) => ({ ...r })) as { event_id: string; pushed: number; fav: number }[];

test('a favorite is scanned, not tracked', () => {
  assert.ok(favoriteTeamKeys().has('team:mlb:30'));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM follows WHERE device_id = 'fan'").get() as any).n, 0);
});

test("the Rays' favorite gets the Guardians' alert in tonight's game, pushed unless it turned push off for that team", () => {
  updateFavorite('quiet-fan', 'team:mlb:30', { push: false, pushTypes: { 'team.opponent_scored': true } });
  updateFavorite('fan', 'team:mlb:30', { pushTypes: { 'team.opponent_scored': true } });
  publish([scored('G1', 'p1')], 'mlb');
  assert.deepEqual(feed('fan'), [{ event_id: 'G1:p1:team.opponent_scored:5', pushed: 1, fav: 1 }]);
  assert.deepEqual(feed('quiet-fan'), [{ event_id: 'G1:p1:team.opponent_scored:5', pushed: 0, fav: 1 }], 'push off for this team: feed only');
  assert.equal(feed('yankee-fan').length, 0, 'a fan of another team');
  assert.ok(pushes.includes('tok-fan|G1:p1:team.opponent_scored:5') && !pushes.some((p) => p.startsWith('tok-quiet-fan')));
});

test('tracking the team wins: one row, a hate watcher’s, not a favorite’s', () => {
  assert.deepEqual(feed('both').map((r) => r.fav), [0]);
  assert.equal(feed('tracker').length, 1);
});

test('a favorite’s feed item carries fav (the app draws it with the gold edge); a tracker’s does not', () => {
  const item = (dev: string) => feedItem(db.prepare(`SELECT e.*, f.extra, f.fav, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND f.event_id = ?`).get(dev, 'G1:p1:team.opponent_scored:5') as any) as { fav?: boolean };
  assert.equal(item('fan').fav, true);
  assert.equal(item('both').fav, undefined);
  assert.equal(item('tracker').fav, undefined);
});

test('a favorite’s alert choices decide: a type switched off for this favorite is not delivered', () => {
  updateFavorite('fan', 'team:mlb:30', { types: { 'team.opponent_scored': false } });
  publish([scored('G1', 'p2')], 'mlb');
  assert.equal(feed('fan').length, 1, 'still only the first');
  assert.equal(feed('quiet-fan').length, 2);
});

test('the opponent’s other games and non-game alerts do not reach a favorite', () => {
  publish([scored('G2', 'p1')], 'mlb'); // the Guardians against someone else
  publish([{ id: 'inj:mlb:1:Out:2026-10-17:team', type: 'team.injury', targetKey: 'team:mlb:5', title: 'x', body: 'y', at: 1, meta: {} } as any], 'mlb');
  assert.equal(feed('quiet-fan').length, 2);
});

test('the loss reaches the favorite as the game ends, is not a hate watch for them, and is not counted', () => {
  const loss = gameLostEvent({ league: 'mlb', gameId: 'G1', homeId: '30', awayId: '5' }, { home: 4, away: 2 }, 2000)!;
  publish([loss], 'mlb');
  assert.deepEqual(feed('quiet-fan').map((r) => [r.event_id, r.fav]), [['G1:final:team.lost:5', 1], ['G1:p1:team.opponent_scored:5', 1], ['G1:p2:team.opponent_scored:5', 1]]);
  assert.equal(hateWatchTally('quiet-fan').total, 0, 'a favorite roots against them');
  assert.equal(hateWatchTally('tracker').total, 1);
  const row = db.prepare(`SELECT ${RECIPIENTS} FROM events e WHERE e.id = ?`).get('G1:final:team.lost:5') as { recipients: number };
  assert.equal(row.recipients, 2, 'the two trackers; favorites are not counted');
});

test('a tracked team’s own settings beat the favorite’s: its bell off means no push, though the favorite’s push is on', () => {
  updateFavorite('both', 'team:mlb:30', { pushTypes: { 'team.opponent_scored': true } }); // the favorite would push
  setPrefs('both', { pushTypes: { 'team.opponent_scored': true } });
  publish([scored('G1', 'p8')], 'mlb');
  assert.ok(pushes.includes('tok-both|G1:p8:team.opponent_scored:5'), 'control: the tracked team pushes with its bell on');
  setPrefs('both', { muted: ['team:mlb:5'] });
  publish([scored('G1', 'p9')], 'mlb');
  const row = feed('both').find((r) => r.event_id.includes(':p9:'))!;
  assert.deepEqual([row.pushed, row.fav], [0, 0]);
  assert.ok(!pushes.includes('tok-both|G1:p9:team.opponent_scored:5'));
});

test('a tracked team’s own alert choices beat the favorite’s: a type off for the tracked team is not delivered, though the favorite wants it', () => {
  updateFavorite('both', 'team:mlb:30', { types: { 'team.opponent_scored': true } });
  setPrefs('both', { targetTypes: { 'team:mlb:5': { 'team.opponent_scored': false } } });
  publish([scored('G1', 'p7')], 'mlb');
  assert.ok(!feed('both').some((r) => r.event_id.includes(':p7:')));
});

test('removing a favorite stops the scan', () => {
  for (const d of ['fan', 'quiet-fan', 'both']) removeFavorite(d, 'team:mlb:30');
  assert.ok(!favoriteTeamKeys().has('team:mlb:30'));
});

test('a favorite gets "Hate Watch Starting" when its team’s game begins: once, pushed, and favoriting both sides is still one alert', () => {
  for (const id of ['start-fan', 'start-fan-both']) device.run(id, 's', 'test', `tok-${id}`, JSON.stringify(DEFAULT_PREFS));
  addFavorite('start-fan', 'team:mlb:30');
  addFavorite('start-fan-both', 'team:mlb:30');
  addFavorite('start-fan-both', 'team:mlb:5');
  registerGame('mlb', 'G9', 'team:mlb:30', 'team:mlb:5'); // Rays vs Guardians
  const ctx = { league: 'mlb' as const, gameId: 'G9', homeId: '30', awayId: '5' };
  publish(gameStartEvents(ctx, { venue: 'Tropicana Field', tv: 'FS1' }, 3000), 'mlb');
  publish(gameStartEvents(ctx, { venue: 'Tropicana Field', tv: 'FS1' }, 3000), 'mlb'); // a re-poll: nothing new
  assert.deepEqual(feed('start-fan').map((r) => [r.event_id, r.pushed, r.fav]), [['G9:team.game_start:5', 1, 1]]);
  assert.equal(feed('start-fan-both').length, 1);
  assert.equal(pushes.filter((p) => p.startsWith('tok-start-fan|')).length, 1);
  assert.equal((db.prepare('SELECT title FROM events WHERE id = ?').get('G9:team.game_start:5') as any).title, 'Hate Watch Starting: Guardians vs Rays');
});
