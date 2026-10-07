// A tracked hitter's outs: what kind ("grounded out"), double and triple plays saying so (and counting for
// "Makes an out" too), and a hit with a runner thrown out not being the hitter's out. Play text as ESPN
// wrote it in September 2026 (the triple play's shape follows its double plays).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { PLAYER_DETECTORS } = await import('../src/detectors.ts');
const { DEFAULT_PREFS, shouldDeliver } = await import('../src/fanout.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES ('team:mlb:19', 'mlb', '19', 'Los Angeles Dodgers', 'Dodgers', 'LAD', 'x', 1, 1, 0)`).run();
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:mlb:1', 'mlb', '1', 'Michael Busch', 'team:mlb:19', 'x', 1, 1, 'headshot', 0)`).run();
loadCatalog();

const g: any = { league: 'mlb', gameId: 'G', homeId: '19', awayId: '15', goalies: new Map() };
const result = (text: string) => ({ id: text.slice(0, 12), type: 'Play Result', typeSlug: 'play-result', text, teamId: '19', participants: [{ id: '1', role: 'batter' }, { id: '9', role: 'pitcher' }],
  scoring: false, scoreValue: 0, home: 0, away: 0, at: 0, shooting: false, period: { type: 'Bottom', number: 3 } });
const alert = (text: string) => PLAYER_DETECTORS.mlb(g, result(text) as any).filter((e) => e.targetKey === 'player:mlb:1').map((e) => `${e.type}: ${e.title}${e.aliases ? ` (also ${e.aliases})` : ''}`);

test('double and triple plays say which, with how it was hit, and count as an out', () => {
  assert.deepEqual(alert('Busch grounded into double play, second to shortstop to first, Bregman out at second, Taylor to third.'),
    ['mlb.batter.double_play: Michael Busch grounded into a double play (also mlb.batter.popout)']);
  assert.deepEqual(alert('Busch flied into double play, left to second to first, Vargas doubled off first.'), ['mlb.batter.double_play: Michael Busch flied into a double play (also mlb.batter.popout)']);
  assert.deepEqual(alert('Busch lined into double play, shortstop to first, Muncy doubled off first.'), ['mlb.batter.double_play: Michael Busch lined into a double play (also mlb.batter.popout)']);
  assert.deepEqual(alert('Busch grounded into triple play, third to second to first, Ohtani out at third, Freeman out at second.'), ['mlb.batter.double_play: Michael Busch grounded into a TRIPLE PLAY 😱 (also mlb.batter.popout)'],
    'a triple play used to send nothing');
});

test("one alert either way: with only \"Makes an out\" on, or only the double play switch", () => {
  const [dp] = PLAYER_DETECTORS.mlb(g, result('Busch grounded into double play, shortstop to first, Taylor out at second.') as any);
  const prefs = (types: Record<string, boolean>) => ({ ...DEFAULT_PREFS, types });
  assert.equal(shouldDeliver(prefs({ 'mlb.batter.double_play': false, 'mlb.batter.popout': true }), dp, 'mlb'), true, 'outs on, double plays off: still told, as a double play');
  assert.equal(shouldDeliver(prefs({ 'mlb.batter.double_play': true, 'mlb.batter.popout': false }), dp, 'mlb'), true);
  assert.equal(shouldDeliver(prefs({ 'mlb.batter.double_play': false, 'mlb.batter.popout': false }), dp, 'mlb'), false);
});

test('ordinary outs say what kind; a hit with a runner thrown out is not the hitter\'s out', () => {
  assert.deepEqual(alert('Busch grounded out to shortstop.'), ['mlb.batter.popout: Michael Busch grounded out']);
  assert.deepEqual(alert('Busch flied out to center.'), ['mlb.batter.popout: Michael Busch flied out']);
  assert.deepEqual(alert('Busch grounded into fielder\'s choice to shortstop, Hoerner out at second.'), ['mlb.batter.popout: Michael Busch grounded into a fielder\'s choice']);
  assert.deepEqual(alert('Busch doubled to left, out at third.'), ['mlb.batter.popout: Michael Busch made an out'], 'thrown out stretching: his own out');
  assert.deepEqual(alert('Busch singled to right, Shaw to second, Conforto thrown out at home.'), [], 'he got a hit');
});
