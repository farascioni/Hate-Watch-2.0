// The WNBA: every NBA alert, under its own switches, from the same basketball detectors. Play shapes
// as ESPN sent NY @ ATL (WNBA playoffs, 2026-10-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { PLAYER_DETECTORS, teamScoreEvents, START_WORD } = await import('../src/detectors.ts');
const { LEAGUE_IDS } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'wnba', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:wnba:20', '20', 'Atlanta Dream', 'Dream', 'ATL');
team.run('team:wnba:9', '9', 'New York Liberty', 'Liberty', 'NY');
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'wnba', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`)
  .run('player:wnba:3058901', '3058901', 'Allisha Gray', 'team:wnba:20');
loadCatalog();

const play = (o: object) => ({ id: 'p1', type: '', typeSlug: '', text: '', participants: [], scoring: false, scoreValue: 0, home: 0, away: 0, at: 0, shooting: false, ...o });
const g: any = { league: 'wnba', gameId: 'G', homeId: '20', awayId: '9', goalies: new Map() };

test('every NBA alert has a WNBA twin, and every multi-league alert the NBA is in covers the WNBA', () => {
  assert.ok(LEAGUE_IDS.includes('wnba'));
  const nbaOnly = EVENT_TYPES.filter((t) => t.leagues.length === 1 && t.leagues[0] === 'nba');
  const wnbaOnly = EVENT_TYPES.filter((t) => t.leagues.length === 1 && t.leagues[0] === 'wnba');
  assert.deepEqual(wnbaOnly.map((t) => t.id), nbaOnly.map((t) => t.id.replace('nba.', 'wnba.')));
  assert.deepEqual(wnbaOnly.map((t) => [t.label, t.defaultOn]), nbaOnly.map((t) => [t.label, t.defaultOn]), 'same labels and defaults');
  for (const t of EVENT_TYPES.filter((x) => x.leagues.length > 1 && x.leagues.includes('nba'))) assert.ok(t.leagues.includes('wnba'), t.id);
  assert.equal(EVENT_TYPES.filter((t) => t.leagues.includes('wnba')).length, EVENT_TYPES.filter((t) => t.leagues.includes('nba')).length);
  assert.equal(START_WORD.wnba, 'Tip-off');
});

test('the basketball detectors on a WNBA play: wnba.* alerts, named from the WNBA roster', () => {
  const miss = play({ type: 'Pullup Jump Shot', text: 'Allisha Gray misses 5-foot pullup jump shot', shooting: true, teamId: '20', participants: [{ id: '3058901' }] });
  assert.deepEqual(PLAYER_DETECTORS.wnba(g, miss).map((e) => [e.type, e.targetKey, e.title]), [['wnba.missed_shot', 'player:wnba:3058901', 'Allisha Gray missed a shot']]);
  const turnover = play({ id: 'p2', type: 'Bad Pass\nTurnover', text: 'Allisha Gray bad pass (Breanna Stewart steals)', teamId: '20', participants: [{ id: '3058901' }] });
  assert.deepEqual(PLAYER_DETECTORS.wnba(g, turnover).map((e) => e.type), ['wnba.turnover']);
});

test('team scoring like the NBA: no alert for every basket, but a lead change is one', () => {
  const es = teamScoreEvents(g, { home: 10, away: 10 }, play({ text: 'Breanna Stewart makes 3-foot layup', scoring: true, home: 10, away: 12 }));
  assert.deepEqual(es.map((e) => [e.type, e.targetKey, e.title]), [['team.fell_behind', 'team:wnba:20', 'Liberty scored 2 to take the lead over the Dream']]);
});
