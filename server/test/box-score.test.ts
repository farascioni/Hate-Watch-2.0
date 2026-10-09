// The game screen's box score (boxscore.ts): ESPN's summary to a table per stat group, away team first, the
// bad numbers flagged for red, from the shapes ESPN sends (2025-26 games).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { boxScore } = await import('../src/boxscore.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:mlb:9', 'mlb', '9', 'Minnesota Twins', 'Twins', 'MIN');
team.run('team:mlb:10', 'mlb', '10', 'New York Yankees', 'Yankees', 'NYY');
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:mlb:41205', 'mlb', '41205', 'Trevor Larnach', 'team:mlb:9', 'x', 1, 1, 'headshot', 0)`).run();
loadCatalog();

const game = (league: string, state = 'in') => ({ league, state, away: { team: { key: `team:${league}:9` } }, home: { team: { key: `team:${league}:10` } } }) as any;
const batter = (id: string, short: string, pos: string, stats: string[], starter = true) => ({ athlete: { id, shortName: short }, position: { abbreviation: pos }, starter, stats });
const BATTING = ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K', '#P', 'AVG', 'OBP', 'SLG'];
const PITCHING = ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC-ST', 'ERA', 'PC'];
const mlb = { boxscore: { players: [
  { team: { id: '10' }, statistics: [{ name: 'batting', labels: BATTING, athletes: [batter('33192', 'A. Judge', 'RF', ['2-4', '4', '1', '2', '1', '1', '0', '1', '18', '.300', '.400', '.600'])], totals: ['2-4', '4', '1', '2', '1', '1', '0', '1', '18', '', '', ''] }] },
  { team: { id: '9' }, statistics: [
    { name: 'batting', labels: BATTING, athletes: [
      batter('41205', 'T. Larnach', 'LF', ['0-4', '4', '0', '0', '0', '0', '0', '3', '23', '.287', '.379', '.430']),
      batter('5', 'K. Clemens', 'PH', ['1-1', '1', '0', '1', '0', '0', '0', '0', '4', '.250', '.300', '.400'], false),
    ], totals: ['1-5', '5', '0', '1', '0', '0', '0', '3', '27', '', '', ''] },
    { name: 'pitching', labels: PITCHING, athletes: [batter('6', 'M. Paredes', 'P', ['4.0', '6', '5', '5', '3', '2', '2', '81-49', '4.60', '81']), batter('7', 'J. Topa', 'P', ['1.0', '2', '2', '2', '0', '1', '1', '20-12', '3.10', '20'], false)] },
  ] },
] } };

test('MLB: away team first, batting and pitching, the subs marked, and an 0-for-4 with 3 strikeouts in red', () => {
  const box = boxScore(game('mlb'), mlb)!;
  assert.deepEqual(box.teams.map((t) => [t.key, t.abbrev, t.groups.map((g) => g.title)]), [['team:mlb:9', 'MIN', ['Batting', 'Pitching']], ['team:mlb:10', 'NYY', ['Batting']]]);
  const [batting, pitching] = box.teams[0].groups;
  assert.deepEqual(batting.columns, ['AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K']);
  assert.deepEqual(batting.rows.map((r) => [r.name, r.detail, r.sub ?? false, r.link, r.stats.join(' '), (r.bad ?? []).map((i) => batting.columns[i])]), [
    ['T. Larnach', 'LF', false, true, '4 0 0 0 0 0 3', ['H', 'K']],
    ['K. Clemens', 'PH', true, false, '1 0 1 0 0 0 0', []],
  ]);
  assert.deepEqual(batting.totals, ['5', '0', '1', '0', '0', '0', '3']);
  assert.deepEqual(pitching.rows.map((r) => [r.stats.join(' '), (r.bad ?? []).map((i) => pitching.columns[i]), r.sub ?? false]), [['4.0 6 5 5 3 2 81', ['ER', 'BB'], false], ['1.0 2 2 2 0 1 20', [], false]],
    '5 earned runs, 3 walks (PC is the pitch count); a reliever is no sub, he gets a line like the starter');
});

test("NBA: who didn't play is a note, not a row of blanks; NFL sacks are the count, names shortened", () => {
  const LABELS = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'];
  const nba = { boxscore: { players: [{ team: { id: '9' }, statistics: [{ labels: LABELS, athletes: [
    { athlete: { id: '1', shortName: 'R. Gobert' }, position: { abbreviation: 'C' }, starter: true, stats: ['38', '6', '2-11', '0-4', '2-2', '13', '2', '1', '0', '2', '4', '9', '5', '-8'] },
    { athlete: { id: '2', shortName: 'J. Ingles' }, didNotPlay: true, stats: [] },
  ] }] }] } };
  const g = boxScore(game('nba'), nba)!.teams[0].groups[0];
  assert.deepEqual([g.rows.map((r) => r.stats.join(' ')), g.rows[0].bad?.map((i) => g.columns[i]), g.note], [['38 6 13 2 2-11 0-4 5'], ['FG', '3PT', 'PF'], 'Did not play: J. Ingles']);
  const nfl = { boxscore: { players: [{ team: { id: '9' }, statistics: [{ name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], athletes: [
    { athlete: { id: '14881', displayName: 'Russell Wilson' }, stats: ['17/37', '168', '4.5', '0', '2', '4-31', '20.5', '59.3'] },
  ] }, { name: 'interceptions', labels: ['INT', 'YDS', 'TD'], athletes: [] }] }] } };
  const pass = boxScore(game('nfl'), nfl)!.teams[0].groups;
  assert.deepEqual(pass.map((x) => [x.title, x.rows.map((r) => [r.name, r.stats.join(' '), r.bad?.map((i) => x.columns[i])])]), [['Passing', [['R. Wilson', '17/37 168 0 2 4', ['INT', 'SACKS']]]]], 'an empty group is left out');
});

test("Soccer: the line-ups' stats (starters, the subs who came on, the keeper); nothing before kickoff; never F1", () => {
  const stat = (name: string, v: number) => ({ name, displayValue: String(v) });
  const p = (id: string, short: string, pos: string, starter: boolean, subbedIn: boolean, stats: [string, number][]) => ({ athlete: { id, shortName: short }, position: { abbreviation: pos }, starter, subbedIn, stats: stats.map(([n, v]) => stat(n, v)) });
  const s = { rosters: [{ team: { id: '9' }, roster: [
    p('1', 'A. Becker', 'G', true, false, [['saves', 4], ['goalsConceded', 3]]),
    p('2', 'M. Salah', 'F', true, false, [['totalGoals', 1], ['totalShots', 4], ['shotsOnTarget', 2], ['yellowCards', 1]]),
    p('3', 'W. Endo', 'M', false, true, [['foulsCommitted', 2]]),
    p('4', 'Unused', 'D', false, false, []),
  ] }] };
  const groups = boxScore(game('epl'), s)!.teams[0].groups;
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => `${r.name} ${r.stats.join(' ')}${r.bad?.length ? ` red:${r.bad.map((i) => g.columns[i])}` : ''}`)]), [
    ['Starters', ['A. Becker 0 0 0 0 0 0 0', 'M. Salah 1 0 4 2 0 1 0 red:YC']],
    ['Substitutes', ['W. Endo 0 0 0 0 2 0 0']],
    ['Goalkeeping', ['A. Becker 4 3 red:GA']],
  ]);
  assert.equal(boxScore(game('epl', 'pre'), s), null, 'line-ups come out before kickoff, all zeros');
  assert.equal(boxScore(game('f1'), s), null);
  assert.equal(boxScore(game('mlb'), { boxscore: { players: [] } }), null, 'no box score yet');
});
