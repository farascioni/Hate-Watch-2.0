// Special Events (Scores tab): a postseason game's card carries ESPN's note ("ALCS - Game 5") as `event`, and for a
// series its length and each side's wins. Regular-season games and doubleheader notes carry none.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const S = await import('../src/scores.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:mlb:5', 'mlb', '5', 'Cleveland Guardians', 'Guardians', 'CLE', '#002b5c');
team.run('team:mlb:4', 'mlb', '4', 'Chicago White Sox', 'White Sox', 'CHW', '#000000');
loadCatalog();

const competitor = (id: string, homeAway: string, abbr: string) => ({ id, homeAway, score: '2', team: { id, abbreviation: abbr } });
const game = (slug: string, headline: string, series?: object) => ({
  id: 'ev1', date: new Date().toISOString(), season: { slug },
  status: { type: { state: 'in', shortDetail: 'Top 5th' } },
  competitions: [{ competitors: [competitor('5', 'home', 'CLE'), competitor('4', 'away', 'CHW')], notes: [{ type: 'event', headline }], ...(series ? { series } : {}) }],
});

test('a postseason game carries its event, series length and wins', () => {
  const series = { type: 'playoff', totalCompetitions: 7, competitors: [{ id: '5', wins: 3 }, { id: '4', wins: 1 }] };
  const card = S.gameCard('mlb', game('post-season', 'ALCS - Game 5', series))!;
  assert.deepEqual({ ...card.event, lines: undefined }, { lines: undefined, name: 'ALCS', game: 'Game 5', bestOf: 7, wins: { home: 3, away: 1 }, seriesKey: S.seriesKey('mlb', 'ALCS', '5', '4') });
  assert.equal(S.seriesKey('mlb', 'ALCS', '4', '5'), card.event!.seriesKey, 'the same series whichever team hosts');
});

test('a one-game event has a name and no series', () => {
  const ev = S.gameCard('mlb', game('post-season', 'Super Bowl'))!.event!;
  assert.equal(ev.name, 'Super Bowl');
  assert.ok(!ev.seriesKey && !ev.bestOf && !ev.wins);
});

test('regular-season games and doubleheader notes have no event', () => {
  assert.equal(S.gameCard('mlb', game('regular-season', 'ALCS - Game 5'))!.event, undefined);
  assert.equal(S.gameCard('mlb', game('post-season', 'Doubleheader - Game 1'))!.event, undefined);
});

test('a series\' first game has no series from ESPN yet and still gets a seriesKey', () => {
  const ev = S.gameCard('mlb', game('post-season', 'World Series - Game 1'))!.event!;
  assert.equal(ev.game, 'Game 1');
  assert.equal(ev.seriesKey, S.seriesKey('mlb', 'World Series', '5', '4'));
  assert.ok(!ev.bestOf && !ev.wins, 'no length or wins until ESPN sends them');
});
