// Stats pages for players and teams (not F1). Shapes as ESPN sent them on 2026-10-07: Aaron Judge (MLB's
// overview has only his career line, so his season row comes from the stats endpoint), Gerrit Cole, Trae
// Young, the Yankees' team statistics, the EPL table, and team schedules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { playerPage, teamStatGroup, tableGroup, recentFromSchedule, statsFor, statsDeps } = await import('../src/stats.ts');
const { upNextDeps } = await import('../src/upnext.ts');
const { urls } = await import('../src/leagues.ts');
const { startApi } = await import('../src/api.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:mlb:10', 'mlb', '10', 'New York Yankees', 'Yankees', 'NYY');
team.run('team:epl:364', 'epl', '364', 'Liverpool', 'Liverpool', 'LIV');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
player.run('player:mlb:33192', 'mlb', '33192', 'Aaron Judge', 'RF', 'team:mlb:10');
player.run('player:mlb:32081', 'mlb', '32081', 'Gerrit Cole', 'SP', 'team:mlb:10');
player.run('player:f1:4665', 'f1', '4665', 'Max Verstappen', null, 'team:mlb:10');
loadCatalog();

const view = (g: any) => `${g.title}: ${g.tiles.map((t: any) => `${t.label} ${t.value}${t.bad ? '!' : ''}`).join(' · ')}`;
const JUDGE_OVERVIEW = {
  statistics: { labels: ['GP', 'AB', 'H', 'HR', 'SO'], names: ['gamesPlayed', 'atBats', 'hits', 'homeRuns', 'strikeouts'], displayNames: ['Games Played', 'At Bats', 'Hits', 'Home Runs', 'Strikeouts'],
    splits: [{ displayName: 'Career', stats: ['1211', '4342', '1262', '386', '1454'] }] },
  gameLog: {
    statistics: [{ labels: ['AB', 'R', 'H', 'HR', 'RBI', 'SO'], events: [{ eventId: 'e1', stats: ['3', '0', '0', '0', '0', '3'] }, { eventId: 'e2', stats: ['4', '1', '1', '1', '3', '2'] }] }],
    events: { e1: { gameDate: '2026-09-27T17:00:00.000+00:00', atVs: 'vs', gameResult: 'W', score: '2-0', opponent: { abbreviation: 'NYM' } }, e2: { gameDate: '2026-09-25T23:00:00.000+00:00', atVs: '@', gameResult: 'W', score: '8-3', opponent: { abbreviation: 'MIN' } } },
  },
};
const JUDGE_ROWS = { categories: [{ name: 'career-batting', labels: ['GP', 'HR', 'SO', 'CS', 'AVG'], names: ['gamesPlayed', 'homeRuns', 'strikeouts', 'caughtStealing', 'avg'], displayNames: ['Games Played', 'Home Runs', 'Strikeouts', 'Caught Stealing', 'Batting Average'],
  statistics: [{ season: { year: 2025, displayName: '2025' }, stats: ['152', '53', '160', '2', '.331'] }, { season: { year: 2026, displayName: '2026' }, stats: ['66', '18', '85', '0', '.241'] }] }] };

test("a player's page: the season ESPN picks for their position, career, and their last games; their bad numbers in red", () => {
  const judge = playerPage('mlb', '33192', JUDGE_OVERVIEW, JUDGE_ROWS);
  assert.deepEqual(judge.groups.map(view), ['2026 season: GP 66 · HR 18 · SO 85! · CS 0 · AVG .241', 'Career: GP 1211 · AB 4342 · H 1262 · HR 386 · SO 1454!'], 'a hitter: strikeouts in red, but not 0 caught stealing');
  assert.deepEqual(judge.recent.map((r) => `${r.home ? 'vs' : '@'} ${r.opponent} ${r.result} ${r.score} (${r.line})`), ['vs NYM W 2-0 (3 AB · 3 SO)', '@ MIN W 8-3 (4 AB · 1 R · 1 H · 1 HR · 3 RBI · 2 SO)'], 'zeros left out after the first');
  const cole = playerPage('mlb', '32081', { statistics: { labels: ['IP', 'ER', 'HR', 'K'], names: ['innings', 'earnedRuns', 'homeRuns', 'strikeouts'], displayNames: [], splits: [{ displayName: 'Regular Season', stats: ['127.0', '51', '22', '131'] }] } });
  assert.deepEqual(cole.groups.map(view), ['Regular season: IP 127.0 · ER 51! · HR 22! · K 131'], "a pitcher's strikeouts are his good number");
});

test("a team's page: its season line, the EPL's table, and its last results", () => {
  const yankees = teamStatGroup('mlb', { requestedSeason: { name: 'Postseason', displayName: '2026' }, results: { stats: { categories: [
    { name: 'batting', stats: [{ name: 'avg', displayValue: '.246' }, { name: 'strikeouts', displayValue: '33', displayName: 'Strikeouts' }] },
    { name: 'pitching', stats: [{ name: 'ERA', displayValue: '1.32' }] }, { name: 'fielding', stats: [{ name: 'errors', displayValue: '0' }] }] } } })!;
  assert.equal(view(yankees), '2026 Postseason: Batting avg .246 · Strikeouts 33! · ERA 1.32 · Errors 0', 'no errors is nothing to show in red');
  const entry = (id: string, s: Record<string, number>) => ({ team: { id }, stats: Object.entries(s).map(([name, value]) => ({ name, value, ...(name === 'pointDifferential' ? { displayValue: value > 0 ? `+${value}` : String(value) } : {}) })) });
  const table = { children: [{ standings: { entries: [entry('382', { rank: 1, points: 15 }), entry('364', { rank: 6, points: 9, gamesPlayed: 5, wins: 2, ties: 3, losses: 0, pointsFor: 7, pointsAgainst: 4, pointDifferential: 3 })] } }] };
  assert.equal(view(tableGroup('364', table)), 'League table: POS 6th · PTS 9 · P 5 · W-D-L 2-3-0 · GF 7 · GA 4! · GD +3');
  const game = (id: string, date: string, us: number, them: number, home = true, state = 'post') => ({ id, date, competitions: [{ status: { type: { state } }, competitors: [
    { id: '10', homeAway: home ? 'home' : 'away', score: { value: us, displayValue: String(us) }, winner: us > them },
    { id: '30', homeAway: home ? 'away' : 'home', score: { value: them, displayValue: String(them) }, winner: them > us, team: { abbreviation: 'TB' } }] }] });
  const schedule = { events: [game('a', '2026-10-04T23:00Z', 9, 0), game('b', '2026-10-05T23:00Z', 0, 1, false), game('c', '2026-10-06T23:00Z', 2, 5, false), game('d', '2026-10-08T00:00Z', 0, 0, true, 'pre')] };
  assert.deepEqual(recentFromSchedule('10', schedule).map((r) => `${r.home ? 'vs' : '@'} ${r.opponent} ${r.result} ${r.score}`), ['@ TB L 2-5', '@ TB L 0-1', 'vs TB W 9-0'], 'newest first; not tonight\'s');
});

test('served at /targets/:key/stats, read from ESPN once per 10 minutes; nothing for F1', async () => {
  let reads = 0;
  statsDeps.getJson = async (url: string) => {
    reads++;
    if (url === urls.athleteOverview('mlb', '33192')) return JUDGE_OVERVIEW;
    if (url === urls.athleteStats('mlb', '33192')) return JUDGE_ROWS;
    throw new Error(`unexpected ${url}`);
  };
  upNextDeps.getJson = async () => ({ requestedSeason: { type: 3 }, events: [] });
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await (await fetch(`${base}/targets/${encodeURIComponent('player:mlb:33192')}/stats`)).json();
  assert.deepEqual([page.kind, page.groups.map((g: any) => g.title), page.recent.length, page.next], ['player', ['2026 season', 'Career'], 2, null]);
  await statsFor('player:mlb:33192');
  assert.equal(reads, 2, 'the overview and the stats rows, once');
  assert.equal((await fetch(`${base}/targets/${encodeURIComponent('player:f1:4665')}/stats`)).status, 404);
  server.close();
});
