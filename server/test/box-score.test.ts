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
  assert.equal(boxScore(game('epl', 'pre'), s), null, 'line-ups come out before kickoff, all zeros: not shown (a preview comes from the rest of the summary)');
  assert.equal(boxScore(game('f1'), s), null);
  assert.equal(boxScore(game('mlb'), { boxscore: { players: [] } }), null, 'no box score yet');
});

// ALDS Game 5, CHW @ CLE (2026-10-10), as ESPN's summary had it the day before, trimmed.
const side = (homeAway: string, id: string, abbreviation: string) => ({ homeAway, team: { id, abbreviation } });
const lead = (displayName: string, id: string, shortName: string, pos: string, displayValue: string) => ({ displayName, leaders: [{ displayValue, athlete: { id, shortName, position: { abbreviation: pos } } }] });
const PREVIEW = {
  header: { competitions: [{ competitors: [side('home', '10', 'NYY'), side('away', '9', 'MIN')] }] },
  leaders: [
    { team: { id: '9' }, leaders: [lead('Batting Average', '41205', 'T. Larnach', 'LF', '.277'), lead('Earned Run Average', '7', 'S. Burke', 'SP', '3.34'), lead('Wins', '7', 'S. Burke', 'SP', '11'), lead('Strikeouts', '7', 'S. Burke', 'SP', '185')] },
    { team: { id: '10' }, leaders: [lead('Home Runs', '33192', 'A. Judge', 'RF', '18')] },
  ],
  boxscore: { teams: [
    { team: { id: '9' }, statistics: [{ name: 'batting', stats: [{ name: 'avg', displayValue: '.236' }, { name: 'runs', displayValue: '776' }, { name: 'gamesPlayed', displayValue: '162' }] }, { name: 'pitching', stats: [{ name: 'ERA', displayValue: '4.12' }] }] },
    { team: { id: '10' }, statistics: [{ name: 'batting', stats: [{ name: 'avg', displayValue: '.239' }, { name: 'runs', displayValue: '678' }] }, { name: 'pitching', stats: [{ name: 'ERA', displayValue: '3.77' }] }] },
  ], players: [{ team: { id: '9' }, statistics: [{ name: 'batting', labels: BATTING, athletes: [] }] }] },
  lastFiveGames: [{ team: { id: '9' }, events: [{ atVs: '@', opponent: { abbreviation: 'HOU' }, gameResult: 'W', score: '7-3', gameDate: '2026-09-30T23:00Z' }, { atVs: 'vs', opponent: { abbreviation: 'NYY' }, gameResult: 'L', score: '9-5', gameDate: '2026-10-08T23:00Z' }] }],
  injuries: [{ team: { id: '10' }, injuries: [{ status: '10-Day-IL', details: { type: 'Back' }, athlete: { id: '35291', shortName: 'R. Hoskins', position: { abbreviation: '1B' } } }] }],
  predictor: { homeTeam: { id: '10', gameProjection: '57.1' }, awayTeam: { id: '9', gameProjection: '42.9' } },
  seasonseries: [{ type: 'current', summary: 'Series tied 2-2' }, { type: 'season', summary: 'MIN win series 7-6' }],
  gameInfo: { venue: { fullName: 'Progressive Field' } },
};
const show = (b: any) => b.teams.map((t: any) => [t.abbrev, t.groups.map((g: any) => [g.title, g.columns.join(' '), g.rows.map((r: any) => `${r.name}${r.detail ? ` (${r.detail})` : ''}: ${r.stats.join(' ')}${r.bad ? ' red' : ''}${r.link ? ' link' : ''}`), g.note ?? ''])]);

test("before the start, a preview as tables (every build's Box score tab): each side's leaders, both sides' season stats, its last five, its injuries", () => {
  const box = boxScore(game('mlb', 'pre'), PREVIEW)!;
  const stats = ['Season stats', 'MIN NYY', ['Batting average: .236 .239', 'Runs: 776 678', 'ERA: 4.12 3.77'],
    "ESPN's matchup predictor: NYY 57%. Regular season: MIN win series 7-6. At Progressive Field."];
  assert.deepEqual(show(box), [
    ['MIN', [
      ['Season leaders', 'AVG ERA W K', ['T. Larnach (LF): .277    link', 'S. Burke (SP):  3.34 11 185'], ''],
      stats,
      ['Last 5 games', 'Result', ['@ HOU (Sep 30): W 7-3', 'vs NYY (Oct 8): L 9-5 red'], ''],
    ]],
    ['NYY', [
      ['Season leaders', 'HR', ['A. Judge (RF): 18'], ''],
      stats,
      ['Injuries', 'Status Injury', ['R. Hoskins (1B): 10-Day-IL Back'], ''],
    ]],
  ], 'away first; a pitcher who leads three is one row; the season stats are the same table on both sides, the series and the predictor under them');
});

test("the preview from other sports' shapes: a short list of season stats as ESPN labels them, a leader's number out of ESPN's line", () => {
  const nfl = { ...PREVIEW, boxscore: { teams: [{ team: { id: '9' }, statistics: [{ name: 'totalPointsPerGame', label: 'Points Per Game', displayValue: '18.8' }] }] },
    leaders: [{ team: { id: '10' }, leaders: [lead('Passing Yards', '1', 'J. Hurts', 'QB', '72/104, 843 YDS, 8 TD, 2 INT'), lead('Goals', '2', 'B. Saka', 'F', 'Matches: 5, Goals: 3')] }],
    lastFiveGames: [], injuries: [], predictor: undefined, seasonseries: [], gameInfo: {} };
  const box = boxScore(game('nfl', 'pre'), nfl)!;
  assert.deepEqual(box.teams[1].groups.find((g) => g.title === 'Season leaders')?.rows.map((r) => r.stats), [['843', ''], ['', '3']], 'the home side\'s');
  assert.deepEqual(box.teams[0].groups.find((g) => g.title === 'Season stats')?.rows.map((r) => [r.name, ...r.stats]), [['Points Per Game', '18.8', '–']], "a side ESPN sent nothing for: a dash");
  assert.equal(boxScore(game('nfl', 'pre'), { header: { competitions: [{ competitors: [] }] } }), null, 'nothing to preview: no tab of blanks');
});
