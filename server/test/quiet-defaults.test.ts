// New installs' alert defaults (October 2026): the result and the rare headline failures push, the in-game
// drip is feed only, the noisiest are off. Installs from before keep what they had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
// Installs from before the change, there when the server boots with it: one never touched its alert
// settings (a very old one has no settings at all), one made a few choices of its own.
const install = (id: string, prefs: object) =>
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', null, JSON.stringify(prefs));
install('before', { pushEnabled: true, sound: true, leagues: {}, types: {}, muted: [], targetTypes: {}, pushTypes: {}, targetPushTypes: {} });
install('ancient', {});
install('chose', { types: { 'nba.missed_shot': false, 'mlb.batter.popout': true }, pushTypes: { 'team.opponent_scored': false, 'nfl.qb.interception': false } });
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { DEFAULT_PREFS, getPrefs, keepOldDefaults, pushTypeFor, typeEnabled, WERE_ON, WERE_PUSHED } = await import('../src/fanout.ts');
const { startApi } = await import('../src/api.ts');

type Prefs = typeof DEFAULT_PREFS;
const tier = (p: Prefs, id: string) => (!typeEnabled(p, id) ? 'off' : pushTypeFor(p, 'team:mlb:1', id) ? 'push' : 'feed');
const tiers = (p: Prefs) => Object.fromEntries(EVENT_TYPES.map((t) => [t.id, tier(p, t.id)]));

const OFF = ['mlb.batter.popout', 'mlb.pitcher.walk', 'mlb.team.opponent_risp', 'nfl.qb.incompletion', 'nfl.fumble', 'nba.missed_shot', 'nba.foul',
  'wnba.missed_shot', 'wnba.foul', 'nhl.shot_blocked', 'nhl.shot_saved', 'nhl.giveaway', 'epl.lost_ball', 'epl.pass_given_away'];
const FEED = ['mlb.pitcher.runs_allowed', 'mlb.pitcher.no_quality_start', 'mlb.challenge_lost', 'mlb.team.stranded_risp', 'nfl.qb.sacked',
  'nba.missed_free_throw', 'nba.turnover', 'wnba.missed_free_throw', 'wnba.turnover', 'nhl.shot_missed', 'f1.driver.standings_drop',
  'team.opponent_scored', 'team.fell_behind', 'team.standings_drop', 'team.losing_streak', 'team.player_injured', 'epl.foul', 'mlb.team.down_in_order',
  'team.rival_clinched',
  // October 2026's sport alerts: the in-game drip, feed only.
  'mlb.batter.hitless', 'mlb.team.position_player_pitching', 'nfl.team.three_and_out', 'nba.brick_night', 'nba.scoreless_half', 'nba.team.opponent_run',
  'wnba.brick_night', 'wnba.scoreless_half', 'wnba.team.opponent_run', 'nhl.minus', 'nhl.team.empty_net_goal', 'nhl.team.shorthanded_goal', 'epl.hit_woodwork',
  // College football (October 2026): the NFL's, as its own.
  'cfb.team.three_and_out'];
// Alerts added since: nobody had them, so they come with the new defaults for everyone.
const ADDED = ['mlb.team.down_in_order', 'team.rival_clinched', 'mlb.batter.hitless', 'mlb.team.position_player_pitching', 'nfl.team.three_and_out', 'nba.brick_night', 'nba.scoreless_half',
  'nba.team.opponent_run', 'wnba.brick_night', 'wnba.scoreless_half', 'wnba.team.opponent_run', 'nhl.minus', 'nhl.team.empty_net_goal', 'nhl.team.shorthanded_goal', 'epl.hit_woodwork',
  'cfb.team.three_and_out'];
const NEW = Object.fromEntries(EVENT_TYPES.map((t) => [t.id, OFF.includes(t.id) ? 'off' : FEED.includes(t.id) ? 'feed' : 'push']));

test('a new install: the result and the rare headline failures push, the in-game drip is feed only, the noisiest are off', () => {
  assert.deepEqual(tiers(DEFAULT_PREFS), NEW);
  for (const id of ['team.lost', 'team.game_start', 'player.team_lost', 'mlb.batter.strikeout', 'nfl.qb.interception', 'nhl.goalie.goal_allowed', 'epl.goal_conceded', 'f1.driver.dnf'])
    assert.equal(NEW[id], 'push', id);
  assert.deepEqual([...WERE_PUSHED].sort(), FEED.filter((id) => !ADDED.includes(id)).sort(), 'every feed-only alert pushed before');
  assert.deepEqual([...WERE_ON].sort(), ['epl.lost_ball', 'mlb.team.opponent_risp', 'nba.missed_shot', 'wnba.missed_shot'], 'the three that were on');
});

test('installs from before keep exactly what they had; their own choices stay theirs', () => {
  const OLD = Object.fromEntries(EVENT_TYPES.map((t) => [t.id, WERE_PUSHED.includes(t.id) || WERE_ON.includes(t.id) ? 'push' : NEW[t.id]]));
  assert.deepEqual(tiers(getPrefs('before')), OLD);
  assert.deepEqual(tiers(getPrefs('ancient')), OLD);
  assert.deepEqual(tiers(getPrefs('chose')), { ...OLD, 'nba.missed_shot': 'off', 'mlb.batter.popout': 'push', 'team.opponent_scored': 'feed', 'nfl.qb.interception': 'feed' });

  // Once: an install after the change is a new one, whatever happens at the next boot.
  install('after', DEFAULT_PREFS);
  keepOldDefaults();
  assert.deepEqual(tiers(getPrefs('after')), NEW);
});

test("the app sees each feed-only alert's 🔔 as off (builds that read a missing bell as push show it right), and can turn it on", async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { token, deviceId } = await (await fetch(`${base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"platform":"ios"}' })).json();
  const call = async (method: string, body?: object) =>
    (await fetch(`${base}/me/prefs`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();

  const shown = await call('GET');
  for (const id of FEED) assert.equal(shown.pushTypes[id], false, id);
  assert.equal(shown.pushTypes['team.lost'] ?? true, true);
  assert.equal(tier(getPrefs(deviceId), 'team.opponent_scored'), 'feed');

  const after = await call('PUT', { pushTypes: { 'team.opponent_scored': true } });
  assert.equal(after.pushTypes['team.opponent_scored'], true);
  assert.equal(after.pushTypes['team.fell_behind'], false, 'the rest still shown off');
  assert.equal(tier(getPrefs(deviceId), 'team.opponent_scored'), 'push');
  assert.deepEqual(JSON.parse((db.prepare('SELECT prefs FROM devices WHERE id = ?').get(deviceId) as { prefs: string }).prefs).pushTypes, { 'team.opponent_scored': true },
    'only what they chose is stored: the defaults stay the defaults');
  server.close();
});
