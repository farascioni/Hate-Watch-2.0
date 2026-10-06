// MLB "Loses a challenge": ABS (ball/strike) and replay challenges, from the play shapes ESPN sent for
// ATL @ LAD (2026-10-04) and CHW @ CLE (2026-10-05), and one alert per device for each challenge.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, publish } = await import('../src/fanout.ts');
const { PLAYER_DETECTORS, observePlay } = await import('../src/detectors.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:mlb:19', '19', 'Los Angeles Dodgers', 'Dodgers', 'LAD');
team.run('team:mlb:15', '15', 'Atlanta Braves', 'Braves', 'ATL');
team.run('team:mlb:4', '4', 'Chicago White Sox', 'White Sox', 'CHW');
team.run('team:mlb:5', '5', 'Cleveland Guardians', 'Guardians', 'CLE');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [id, name, t] of [['38309', 'Will Smith', '19'], ['42468', 'Andy Pages', '19'], ['30193', 'Freddie Freeman', '19'], ['33039', 'Mookie Betts', '19'],
  ['5291189', 'Braves Reliever', '15'], ['4416462', 'Braves Starter', '15'], ['4345076', 'Guardians Starter', '5'], ['4872685', 'Sox Shortstop', '4'], ['31208', 'Tommy Pham', '4']]) {
  player.run(`player:mlb:${id}`, id, name, `team:mlb:${t}`);
}
loadCatalog();

let n = 0;
const half = (h: string) => ({ type: h.split(' ')[0], number: Number(h.split(' ')[1]) });
const pitch = (h: string, type: string, text: string, pitcher: string, batter: string) => ({
  id: `p${n++}`, type, typeSlug: type.toLowerCase().replace(/ /g, '-'), text, period: half(h),
  participants: [{ id: pitcher, role: 'pitcher' }, { id: batter, role: 'batter' }], scoring: false, scoreValue: 0, home: 2, away: 3, at: 0, shooting: false,
});
const result = (h: string, text: string, pitcher: string, batter: string, id = `p${n++}`) => ({ ...pitch(h, 'Play Result', text, pitcher, batter), id, typeSlug: 'play-result' });
// What the live tracker does with each new play: detect, then update the game state.
const live = (g: any, p: any) => { const es = PLAYER_DETECTORS.mlb(g, p).filter((e) => e.type === 'mlb.challenge_lost'); observePlay(g, p); return es; };
const atLad = (): any => ({ league: 'mlb', gameId: '401908014', homeId: '19', awayId: '15', goalies: new Map() });
const atCle = (): any => ({ league: 'mlb', gameId: '401907990', homeId: '5', awayId: '4', goalies: new Map() });

test("ABS: a batter's challenge of a called strike fails; the batter and the team hear it, the result's text doesn't repeat it", () => {
  const g = atLad();
  const es = live(g, pitch('Bottom 8', 'Strike Looking - Confirmed', 'Pitch 5 : Strike 3 Looking', '5291189', '38309'));
  assert.deepEqual(es.map((e) => [e.targetKey, e.title, e.body]), [
    ['player:mlb:38309', 'Will Smith lost an ABS challenge', 'Bottom 8th: challenged strike 3 looking, and the call stands — ATL 3, LAD 2'],
    ['team:mlb:19', 'Dodgers lost an ABS challenge', 'Bottom 8th: Will Smith challenged strike 3 looking, and the call stands — ATL 3, LAD 2'],
  ]);
  assert.equal(es[0].moment, es[1].moment, 'one challenge: the two alerts share a moment');
  assert.deepEqual(live(g, result('Bottom 8', 'Smith struck out looking. Los Angeles Dodgers challenged: call on the field was upheld.', '5291189', '38309')), [],
    'the same challenge, again in the at-bat result: not a second alert (nor a "replay challenge")');
});

test('ABS: won challenges (overturned) are not alerts', () => {
  const g = atLad();
  assert.deepEqual(live(g, pitch('Bottom 5', 'Ball - Overturned', 'Pitch 5 : Ball 4', '5291189', '33039')), []);
  assert.deepEqual(live(g, result('Bottom 5', 'Betts walked. Los Angeles Dodgers challenged: call on the field was overturned.', '5291189', '33039')), []);
  assert.deepEqual(live(g, pitch('Bottom 8', 'Strike Looking - Overturned', 'Pitch 5 : Strike 3 Looking', '5291189', '30193')), []);
  assert.deepEqual(live(g, result('Bottom 8', 'Freeman struck out looking. Atlanta Braves challenged: call on the field was overturned.', '5291189', '30193')), []);
});

test("ABS: a ball challenged by the fielding team stands; the pitcher's alert says it was on that pitch", () => {
  const g = atCle();
  const es = live(g, pitch('Top 3', 'Ball - Confirmed', 'Pitch 4 : Ball 2', '4345076', '4872685'));
  assert.deepEqual(es.map((e) => [e.targetKey, e.title, e.body]), [
    ['player:mlb:4345076', "ABS challenge on Guardians Starter's pitch failed", 'Top 3rd: ball 2 to Sox Shortstop stands — CHW 3, CLE 2'],
    ['team:mlb:5', 'Guardians lost an ABS challenge', 'Top 3rd: ball 2 to Sox Shortstop stands (Guardians Starter pitching) — CHW 3, CLE 2'],
  ]);
  assert.deepEqual(live(g, pitch('Top 3', 'Ball', 'Pitch 5 : Ball 3', '4345076', '4872685')), [], 'an ordinary pitch');
});

test('replay: a manager challenge that fails is a team alert, once, even though ESPN sends runner plays twice', () => {
  const g = atCle();
  live(g, pitch('Top 6', 'Fly Out', 'Pitch 1 : Ball In Play', '5194333', '31208'));
  const text = 'Pham flied into double play, left to second to first, Vargas doubled off first. Chicago White Sox challenged: call on the field was upheld.';
  const a = live(g, result('Top 6', text, '5194333', '31208'));
  assert.deepEqual(a.map((e) => [e.targetKey, e.title]), [['team:mlb:4', 'White Sox lost a replay challenge']]);
  assert.equal(a[0].body, `${text} — CHW 3, CLE 2`);
  const again = live(g, { ...result('Top 6', text, '5194333', '31208'), typeSlug: 'double-play' });
  assert.equal(again[0].id, a[0].id, 'the same text from another play has the same id, so it publishes once');
  assert.deepEqual(live(g, result('Top 7', 'Kwan singled to left. Umpires reviewed the play: call on the field was upheld.', '1', '2')), [], 'an umpire review is no team\'s challenge');
});

test('one alert per device: tracking the batter and the team, or with the player switch off, or the alert off', () => {
  const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
  const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
  const setup: [string, object, string[]][] = [
    ['both', {}, ['player:mlb:38309', 'team:mlb:19']],
    ['team-only', {}, ['team:mlb:19']],
    ['player-only', {}, ['player:mlb:38309']],
    ['player-switch-off', { targetTypes: { 'player:mlb:38309': { 'mlb.challenge_lost': false } } }, ['player:mlb:38309', 'team:mlb:19']],
    ['alert-off', { types: { 'mlb.challenge_lost': false } }, ['player:mlb:38309', 'team:mlb:19']],
  ];
  for (const [id, prefs, targets] of setup) {
    device.run(id, 's', 'test', JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
    for (const t of targets) follow.run(id, t);
  }
  const g = { ...atLad(), gameId: 'G2' };
  publish(live(g, pitch('Bottom 2', 'Strike Looking - Confirmed', 'Pitch 5 : Strike 3 Looking', '4416462', '38309')), 'mlb');
  const feed = (dev: string) => (db.prepare('SELECT e.target_key FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ?').all(dev) as any[]).map((r) => r.target_key);
  assert.deepEqual(feed('both'), ['player:mlb:38309'], 'the more specific one');
  assert.deepEqual(feed('team-only'), ['team:mlb:19']);
  assert.deepEqual(feed('player-only'), ['player:mlb:38309']);
  assert.deepEqual(feed('player-switch-off'), ['team:mlb:19'], 'the player alert is off for Smith, so the team one comes instead');
  assert.deepEqual(feed('alert-off'), []);
});
