import { test } from 'node:test';
import assert from 'node:assert/strict';

// The DB module opens its file on import, so point it at memory before loading app code.
process.env.HW_DB = ':memory:';
const { wants, inQuietHours, DEFAULT_PREFS } = await import('../src/fanout.ts');
const { parseStandings, ordinal } = await import('../src/live.ts');
const { nextScore } = await import('../src/detectors.ts');
const { normalize } = await import('../src/catalog.ts');

const prefs = (over: object = {}) => ({ ...DEFAULT_PREFS, ...over });
const ev = { type: 'mlb.batter.strikeout', targetKey: 'player:mlb:1' };

test('type defaults come from the catalog', () => {
  assert.equal(wants(prefs(), ev, 'mlb'), true);
  assert.equal(wants(prefs(), { ...ev, type: 'mlb.batter.popout' }, 'mlb'), false); // defaultOn: false
});

test('user can turn a type off, a league off, or mute one target', () => {
  assert.equal(wants(prefs({ types: { 'mlb.batter.strikeout': false } }), ev, 'mlb'), false);
  assert.equal(wants(prefs({ leagues: { mlb: false } }), ev, 'mlb'), false);
  assert.equal(wants(prefs({ muted: ['player:mlb:1'] }), ev, 'mlb'), false);
  assert.equal(wants(prefs({ muted: ['player:mlb:2'] }), ev, 'mlb'), true);
});

test('aliases: a homer still arrives for users who only want "gives up runs"', () => {
  const hr = { type: 'mlb.pitcher.home_run_allowed', aliases: ['mlb.pitcher.runs_allowed'], targetKey: 'player:mlb:1' };
  assert.equal(wants(prefs({ types: { 'mlb.pitcher.home_run_allowed': false } }), hr, 'mlb'), true);
  assert.equal(wants(prefs({ types: { 'mlb.pitcher.home_run_allowed': false, 'mlb.pitcher.runs_allowed': false } }), hr, 'mlb'), false);
});

test('quiet hours handle windows that cross midnight, in the user timezone', () => {
  const p = prefs({ quietHours: { enabled: true, start: '23:00', end: '08:00', tz: 'UTC' } });
  assert.equal(inQuietHours(p, new Date('2026-10-03T23:30:00Z')), true);
  assert.equal(inQuietHours(p, new Date('2026-10-03T07:59:00Z')), true);
  assert.equal(inQuietHours(p, new Date('2026-10-03T12:00:00Z')), false);
  assert.equal(inQuietHours(prefs({ quietHours: { enabled: true, start: '23:00', end: '08:00', tz: 'America/New_York' } }), new Date('2026-10-04T03:30:00Z')), true);
});

test('only scoring plays move the score, and scores never go backwards', () => {
  const play = (o: object) => ({ id: '1', seq: 1, type: '', typeSlug: '', text: '', participants: [], scoring: false, scoreValue: 0, home: 0, away: 0, at: 0, shooting: false, ...o });
  assert.deepEqual(nextScore({ home: 0, away: 0 }, play({ home: 3 })), { home: 0, away: 0 });
  assert.deepEqual(nextScore({ home: 0, away: 0 }, play({ home: 3, scoring: true })), { home: 3, away: 0 });
  assert.deepEqual(nextScore({ home: 3, away: 1 }, play({ home: 0, away: 2, scoring: true })), { home: 3, away: 2 });
});

test('standings parser ranks by playoff seed within each group', () => {
  const entry = (id: string, seed: number, clincher = '', streak = 'W1') => ({ team: { id }, stats: [{ name: 'playoffSeed', value: seed }, { name: 'clincher', displayValue: clincher }, { name: 'streak', displayValue: streak }] });
  const res = { children: [{ abbreviation: 'AL', standings: { entries: [entry('2', 2), entry('1', 1), entry('3', 3, 'e', 'L4')] } }] };
  const s = parseStandings(res);
  assert.equal(s.get('1')!.rank, 1);
  assert.equal(s.get('3')!.clincher, 'e');
  assert.equal(s.get('3')!.streak, 'L4');
});

test('ordinals and search normalization', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  assert.equal(normalize('Ronald Acuña Jr.'), 'ronald acuna jr');
  assert.equal(normalize("De'Aaron Fox"), 'de aaron fox');
});
