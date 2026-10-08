// A tracked player's team, from the player's ⚙️ screen: whether the team's games show on the Scores tab
// (on by default), and whether the team's own alerts come too (off by default), as if the team were tracked.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, getPrefs, mergePlayerTeams, publish, setPrefs, setPushSender } = await import('../src/fanout.ts');
const { deviceTeams, forgetDeviceTeams } = await import('../src/scores.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES ('team:mlb:19', 'mlb', '19', 'Los Angeles Dodgers', 'Dodgers', 'LAD', 'x', 1, 1, 0)`).run();
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:mlb:30193', 'mlb', '30193', 'Freddie Freeman', 'team:mlb:19', 'x', 1, 1, 'headshot', 0)`).run();
loadCatalog();
const FREEMAN = 'player:mlb:30193', DODGERS = 'team:mlb:19';
const device = (id: string, follows: string[], prefs: object = {}) => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', `ExponentPushToken[${id}]`, JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  for (const k of follows) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(id, k);
};
device('fan', [FREEMAN]);
device('both', [FREEMAN, DODGERS]);
device('quiet', [FREEMAN], { muted: [FREEMAN] });
const feed = (id: string) => (db.prepare(`SELECT e.type FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ?`).all(id) as { type: string }[]).map((r) => r.type);
let n = 0;
const start = () => ({ id: `start-${n++}`, type: 'team.game_start', targetKey: DODGERS, title: 'Hate Watch Starting: Dodgers at Braves', body: 'First pitch', at: Date.now(), meta: { gameId: `g${n}` } });

test("the Scores tab: a tracked player's team's games show unless that player's switch is off", () => {
  assert.ok(deviceTeams('fan').teams.has(DODGERS), 'on by default, as before');
  setPrefs('fan', { playerTeams: { [FREEMAN]: { scores: false } } });
  forgetDeviceTeams('fan');
  assert.ok(!deviceTeams('fan').teams.has(DODGERS));
  setPrefs('both', { playerTeams: { [FREEMAN]: { scores: false } } });
  forgetDeviceTeams('both');
  assert.ok(deviceTeams('both').teams.has(DODGERS), 'tracking the team itself still shows it');
  setPrefs('fan', { playerTeams: { [FREEMAN]: { scores: null } } });
  forgetDeviceTeams('fan');
  assert.ok(deviceTeams('fan').teams.has(DODGERS), 'null: back to the default');
  assert.deepEqual(getPrefs('fan').playerTeams, {}, 'nothing left stored');
});

test("the team's own alerts come through a tracked player only with that player's switch on, once, and the player's mute holds", () => {
  const sent: string[] = [];
  setPushSender((msgs) => sent.push(...msgs.map((m) => m.to)));
  publish([start()], 'mlb');
  assert.deepEqual(feed('fan'), [], 'off by default: tracking a player sends only player alerts');
  assert.deepEqual(feed('both'), ['team.game_start']);

  for (const id of ['fan', 'both', 'quiet']) setPrefs(id, { playerTeams: { [FREEMAN]: { alerts: true } } });
  sent.length = 0;
  publish([start()], 'mlb');
  assert.deepEqual(feed('fan'), ['team.game_start'], "with it on: the Dodgers' game start");
  assert.deepEqual(feed('both'), ['team.game_start', 'team.game_start'], 'tracking the team too: one copy each time, not two');
  assert.deepEqual(feed('quiet'), ['team.game_start']);
  assert.deepEqual(sent.sort(), ['ExponentPushToken[both]', 'ExponentPushToken[fan]'], "Freeman muted: his team's alerts go to the feed without a push");
  setPushSender(() => {});
});

test('only players, and only those two choices, are stored', () => {
  assert.deepEqual(mergePlayerTeams({}, { [DODGERS]: { alerts: true }, [FREEMAN]: { alerts: true, junk: true } as any, 'player:mlb:1': { scores: 'yes' } as any }), { [FREEMAN]: { alerts: true } });
});
