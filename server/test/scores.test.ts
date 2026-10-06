// Scores tab: cards built from ESPN scoreboard events, scores that never go backwards mid-game, live
// pushes only to devices that track a side, each device's game list, F1 running order, play-by-play.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { addSocket, DEFAULT_PREFS } = await import('../src/fanout.ts');
const S = await import('../src/scores.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:nfl:1', 'nfl', '1', 'Atlanta Falcons', 'Falcons', 'ATL', '#A71930');
team.run('team:nfl:18', 'nfl', '18', 'New Orleans Saints', 'Saints', 'NO', '#9F8958');
team.run('team:mlb:5', 'mlb', '5', 'Cleveland Guardians', 'Guardians', 'CLE', '#002b5c');
team.run('team:mlb:4', 'mlb', '4', 'Chicago White Sox', 'White Sox', 'CHW', '#000000');
team.run('team:f1:FER', 'f1', 'FER', 'Ferrari', 'Ferrari', 'FER', '#DC0000');
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:nfl:77', 'nfl', '77', 'Saints Kicker', 'team:nfl:18', 'x', 1, 1, 'headshot', 0)`).run();
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:f1:LEC', 'f1', 'LEC', 'Charles Leclerc', 'team:f1:FER', 'x', 1, 1, 'headshot', 0)`).run();
loadCatalog();

const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
for (const id of ['falcons-fan', 'kicker-fan', 'guardians-fan', 'f1-fan', 'nobody']) device.run(id, 's', 'test', JSON.stringify(DEFAULT_PREFS));
follow.run('falcons-fan', 'team:nfl:1');
follow.run('kicker-fan', 'player:nfl:77'); // a player on the Saints: their games count too
follow.run('guardians-fan', 'team:mlb:5');
follow.run('f1-fan', 'player:f1:LEC');

// Shapes as ESPN's scoreboard sends them (the MLB one is from CHW @ CLE, live on 2026-10-05). One fixed
// clock, so two reads of the same game are identical unless the test changes something.
const T0 = Date.now();
const competitor = (id: string, homeAway: string, score: string, abbr: string) => ({ id, homeAway, score, team: { id, abbreviation: abbr } });
const nflEvent = (state: string, home: string, away: string, extra: object = {}) => ({
  id: '401', date: new Date(T0 - 3600_000).toISOString(),
  status: { type: { state, shortDetail: state === 'post' ? 'Final' : 'Q4 - 2:14' } },
  competitions: [{
    competitors: [competitor('18', 'home', home, 'NO'), competitor('1', 'away', away, 'ATL')],
    situation: { possession: '1', downDistanceText: '3rd & 8 at NO 41', isRedZone: false, lastPlay: { probability: { homeWinPercentage: 0.81, tiePercentage: 0.01 } } },
    ...extra,
  }],
});
const mlbEvent = (detail: string, bases: object) => ({
  id: '401907991', date: new Date(T0 - 2 * 3600_000).toISOString(),
  status: { type: { state: 'in', shortDetail: detail } },
  competitions: [{ competitors: [competitor('5', 'home', '2', 'CLE'), competitor('4', 'away', '1', 'CHW')], situation: { outs: 1, ...bases } }],
});

test('cards from scoreboard events: NFL down and distance, MLB bases, win probability', () => {
  const g = S.gameCard('nfl', nflEvent('in', '24', '17'))!;
  assert.equal(g.key, 'nfl:401');
  assert.deepEqual([g.away!.team.abbrev, g.away!.score, g.home!.team.abbrev, g.home!.score], ['ATL', 17, 'NO', 24]);
  assert.equal(g.detail, 'Q4 - 2:14');
  assert.equal(g.possession, 'team:nfl:1');
  assert.equal(g.downDistance, '3rd & 8 at NO 41');
  assert.deepEqual(g.winProb, { home: 0.81, away: 0.18 });

  const m = S.gameCard('mlb', mlbEvent('Bot 8th', { onFirst: true, onSecond: true }))!;
  assert.deepEqual(m.bases, { first: true, second: true, third: false, outs: 1 });
  assert.equal(m.batting, 'team:mlb:5', 'bottom of the inning: the home team bats');
  assert.equal(S.gameCard('mlb', mlbEvent('Top 8th', {}))!.batting, 'team:mlb:4');
  assert.equal(S.gameCard('mlb', mlbEvent('End 4th', {}))!.batting, undefined, 'between halves nobody is up');

  const pre = S.gameCard('nfl', { ...nflEvent('pre', '0', '0'), status: { type: { state: 'pre', shortDetail: '10/5 - 8:15 PM EDT' } } })!;
  assert.deepEqual([pre.home!.score, pre.detail, pre.possession], [null, '', undefined], 'no score or situation before kickoff');
  const fin = nflEvent('post', '24', '17');
  (fin.competitions[0].competitors[0] as any).winner = true;
  assert.equal(S.gameCard('nfl', fin)!.home!.winner, true);
});

test('live: scores never go backwards, changes reach only the devices that track a side', () => {
  const frames: Record<string, any[]> = {};
  for (const id of ['falcons-fan', 'kicker-fan', 'guardians-fan', 'nobody']) {
    frames[id] = [];
    addSocket(id, { send: (m: string) => frames[id].push(JSON.parse(m)), on: () => {} } as any);
  }
  S.upsertGame(S.gameCard('nfl', nflEvent('in', '17', '17'))!); // first sighting: a baseline, not pushed
  assert.equal(frames['falcons-fan'].length, 0);

  S.patchGame('nfl:401', { home: 24, away: 17 }); // the tracker's play-by-play saw the Saints score
  assert.equal(S.getGame('nfl:401')!.home!.score, 24);
  assert.deepEqual(frames['falcons-fan'].map((f) => [f.kind, f.game.home.score]), [['score', 24]]);
  assert.equal(frames['kicker-fan'].length, 1, 'tracking a Saints player counts');
  assert.equal(frames['guardians-fan'].length + frames['nobody'].length, 0, 'nobody else hears about it');

  S.upsertGame(S.gameCard('nfl', nflEvent('in', '17', '17'))!); // a scoreboard read from before that touchdown
  assert.equal(S.getGame('nfl:401')!.home!.score, 24, 'a stale scoreboard does not undo the score');
  S.upsertGame(S.gameCard('nfl', nflEvent('in', '17', '17'))!);
  assert.equal(frames['falcons-fan'].length, 1, 'stale reads that change nothing push nothing');

  S.upsertGame(S.gameCard('nfl', nflEvent('post', '24', '20'))!); // the final is exact
  assert.deepEqual([S.getGame('nfl:401')!.state, S.getGame('nfl:401')!.away!.score], ['post', 20]);
});

test("each device's games: their teams and players' teams, live first, within a day", () => {
  S.upsertGame(S.gameCard('mlb', mlbEvent('Bot 8th', { onFirst: true }))!);
  const later = { ...nflEvent('pre', '0', '0'), id: '402', date: new Date(Date.now() + 5 * 3600_000).toISOString(), status: { type: { state: 'pre' } } };
  const nextWeek = { ...later, id: '403', date: new Date(Date.now() + 5 * 86400_000).toISOString() };
  S.upsertGame(S.gameCard('nfl', later)!);
  S.upsertGame(S.gameCard('nfl', nextWeek)!);
  assert.deepEqual(S.gamesFor('falcons-fan').map((g) => g.key), ['nfl:402', 'nfl:401'], 'upcoming first then the final; next week is too far off');
  assert.deepEqual(S.gamesFor('kicker-fan').map((g) => g.key), ['nfl:402', 'nfl:401']);
  assert.deepEqual(S.gamesFor('guardians-fan').map((g) => g.key), ['mlb:401907991']);
  assert.deepEqual(S.gamesFor('nobody'), []);
  // Following someone new shows their games right away.
  follow.run('nobody', 'team:mlb:4');
  S.forgetDeviceTeams('nobody');
  assert.deepEqual(S.gamesFor('nobody').map((g) => g.key), ['mlb:401907991']);
});

test('MLB at-bat: pitcher, batter and count from the scoreboard, pitches thrown from the box score', () => {
  // As ESPN sent them for CHW @ CLE, Bot 7th, 2026-10-05.
  const atBat = (pitcherId: string, pitcherName: string, balls: number, strikes: number) => ({
    ...mlbEvent('Bot 7th', {}), id: '401907992',
    competitions: [{ competitors: [competitor('5', 'home', '3', 'CLE'), competitor('4', 'away', '3', 'CHW')], situation: {
      outs: 2, balls, strikes,
      pitcher: { playerId: Number(pitcherId), athlete: { id: pitcherId, shortName: pitcherName }, summary: '4.1 IP, 0 ER, 0 H, 5 K, BB' },
      batter: { playerId: 41217, athlete: { id: '41217', shortName: 'B. Rocchio' }, summary: '0-2' },
    } }],
  });
  const g = S.gameCard('mlb', atBat('4867679', 'S. Burke', 1, 1))!;
  assert.deepEqual(g.pitcher, { id: '4867679', key: 'player:mlb:4867679', name: 'S. Burke', line: '4.1 IP, 0 ER, 0 H, 5 K, BB' });
  assert.deepEqual([g.batter!.name, g.batter!.line], ['B. Rocchio', '0-2']);
  assert.deepEqual(g.count, { balls: 1, strikes: 1 });
  assert.equal(S.gameCard('mlb', mlbEvent('End 7th', {}))!.count, undefined, 'between innings: no count, nobody up');

  const box = { boxscore: { players: [{ statistics: [{ type: 'pitching', labels: ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC-ST', 'ERA', 'PC'], athletes: [
    { athlete: { id: '4867679' }, stats: ['4.1', '0', '0', '0', '1', '5', '0', '67-43', '3.24', '67'] },
    { athlete: { id: '999' }, stats: ['0.0', '0', '0', '0', '0', '0', '0', '3-2', '0.00', '3'] },
  ] }] }] } };
  assert.deepEqual(S.boxPitchCounts(box), { 4867679: 67, 999: 3 });
  assert.deepEqual(S.boxPitchCounts({ boxscore: { players: [{ statistics: [{ type: 'pitching', labels: ['IP', 'PC-ST'], athletes: [{ athlete: { id: '7' }, stats: ['1.0', '14-9'] }] }] }] } }), { 7: 14 }, 'PC-ST works when there is no PC column');

  S.upsertGame(g);
  S.patchGame(g.key, { pitchCounts: S.boxPitchCounts(box) });
  assert.equal(S.getGame(g.key)!.pitcher!.pitches, 67, "the tracker's box score adds his pitch count");
  S.upsertGame(S.gameCard('mlb', atBat('4867679', 'S. Burke', 2, 1))!);
  assert.equal(S.getGame(g.key)!.pitcher!.pitches, 67, 'the next scoreboard read keeps it');
  assert.deepEqual(S.getGame(g.key)!.count, { balls: 2, strikes: 1 });
  S.upsertGame(S.gameCard('mlb', atBat('999', 'New Guy', 0, 0))!); // pitching change
  assert.deepEqual([S.getGame(g.key)!.pitcher!.name, S.getGame(g.key)!.pitcher!.pitches], ['New Guy', 3], "the new pitcher's own count");
});

test('NBA, NHL, NFL live details: top scorers, shots and goalies, passers and timeouts, the last play', () => {
  const ev = (lg: string, detail: string, home: object, away: object, situation: object) => ({
    id: `${lg}1`, date: new Date(T0).toISOString(), status: { type: { state: 'in', shortDetail: detail } },
    competitions: [{ competitors: [{ homeAway: 'home', ...home }, { homeAway: 'away', ...away }], situation }],
  });
  // NBA, as ESPN sent MEM @ ATL (2026-10-05, 6:41 - 2nd).
  const nba = S.gameCard('nba', ev('nba', '6:41 - 2nd',
    { id: '1', score: '46', team: { abbreviation: 'ATL' }, leaders: [{ name: 'points', leaders: [{ displayValue: '10', athlete: { id: '3133628', shortName: 'N. Alexander-Walker' } }] }] },
    { id: '29', score: '51', team: { abbreviation: 'MEM' }, leaders: [{ name: 'points', leaders: [{ displayValue: '12', athlete: { id: '4277905', shortName: 'J. Morant' } }] }] },
    { lastPlay: { text: 'Jalen Johnson defensive rebound', probability: { homeWinPercentage: 0.184, tiePercentage: 0 } } }))!;
  assert.deepEqual([nba.leaders!.home!.name, nba.leaders!.home!.line, nba.leaders!.away!.line], ['N. Alexander-Walker', '10 pts', '12 pts']);
  assert.equal(nba.leaders!.home!.key, 'player:nba:3133628');
  assert.equal(nba.lastPlay, 'Jalen Johnson defensive rebound');
  assert.deepEqual(nba.winProb, { home: 0.184, away: 0.816 });

  // NHL, as PHI @ TB at the end of the 1st: TB's goalie made 3 saves, PHI's 9, TB scored once.
  const nhl = S.gameCard('nhl', ev('nhl', 'End of 1st',
    { id: '14', score: '1', team: { abbreviation: 'TB' }, statistics: [{ name: 'saves', displayValue: '3' }] },
    { id: '15', score: '0', team: { abbreviation: 'PHI' }, statistics: [{ name: 'saves', displayValue: '9' }] },
    { lastPlay: { text: 'End of 1st Period' } }))!;
  assert.deepEqual(nhl.shots, { home: 10, away: 3 }, "shots on goal: the other goalie's saves plus your goals");
  assert.equal(nhl.lastPlay, undefined, '"End of 1st Period" is not a play worth showing');
  const box = { boxscore: { players: [
    { team: { id: '15' }, statistics: [{ name: 'goalies', labels: ['GA', 'SA', 'SOS', 'SOSA', 'SV', 'SV%'], athletes: [{ athlete: { id: '3', shortName: 'D. Vladar' }, stats: ['1', '10', '0', '0', '9', '.900'] }] }] },
    { team: { id: '14' }, statistics: [{ name: 'goalies', labels: ['GA', 'SA', 'SOS', 'SOSA', 'SV', 'SV%'], athletes: [
      { athlete: { id: '4', shortName: 'A. Vasilevskiy' }, stats: ['0', '3', '0', '0', '3', '1.000'] },
      { athlete: { id: '5', shortName: 'Backup' }, stats: ['0', '0', '0', '0', '0', '.000'] }] }] },
  ] } };
  assert.deepEqual(S.boxGoalies(box, new Map([['14', '4']])), {
    15: { id: '3', key: 'player:nhl:3', name: 'D. Vladar', line: '9 saves on 10' },
    14: { id: '4', key: 'player:nhl:4', name: 'A. Vasilevskiy', line: '3 saves on 3' },
  }, 'the goalie the tracker saw in net, not the backup listed after him');
  assert.equal(S.boxGoalies(box)![14].name, 'Backup', 'without the tracker: the last goalie listed (the one who came in)');
  S.upsertGame(nhl);
  S.patchGame(nhl.key, { goalies: S.boxGoalies(box, new Map([['14', '4']])) });
  assert.deepEqual([S.getGame(nhl.key)!.goalies!.home!.name, S.getGame(nhl.key)!.goalies!.away!.name], ['A. Vasilevskiy', 'D. Vladar']);
  S.upsertGame(S.gameCard('nhl', { ...ev('nhl', 'Final', {}, {}, {}), id: 'nhl1', status: { type: { state: 'post', shortDetail: 'Final' } },
    competitions: [{ competitors: [{ homeAway: 'home', id: '14', score: '1', team: {} }, { homeAway: 'away', id: '15', score: '0', team: {} }] }] })!);
  assert.equal(S.getGame(nhl.key)!.goalies!.home!.name, 'A. Vasilevskiy', 'the final keeps who was in net');

  // NFL: timeouts and the last play from the scoreboard; each side's passer from the box score.
  const nfl = S.gameCard('nfl', ev('nfl', 'Q2 - 4:10',
    { id: '18', score: '7', team: { abbreviation: 'NO' } },
    { id: '1', score: '3', team: { abbreviation: 'ATL' } },
    { possession: '1', downDistanceText: '2nd & 7 at ATL 33', homeTimeouts: 3, awayTimeouts: 2, lastPlay: { text: 'B.Robinson right end to ATL 33 for 3 yards' } }))!;
  assert.deepEqual(nfl.timeouts, { home: 3, away: 2 });
  assert.equal(nfl.lastPlay, 'B.Robinson right end to ATL 33 for 3 yards');
  assert.equal(S.gameCard('nfl', ev('nfl', 'Q1 - 13:34', { id: '18', score: '0', team: {} }, { id: '1', score: '7', team: {} },
    { lastPlay: { text: 'Official Timeout at 13:34.' } }))!.lastPlay, undefined, 'a TV timeout is not a play');
  // As ESPN's summary sent ATL @ NO (2026-10-06): no shortName in the box; the passer is whoever has thrown the most.
  const labels = ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'RTG'];
  const passing = { boxscore: { players: [
    { team: { id: '1' }, statistics: [{ name: 'passing', labels, athletes: [
      { athlete: { id: '4360423', firstName: 'Michael', lastName: 'Penix Jr.', displayName: 'Michael Penix Jr.' }, stats: ['7/13', '61', '4.7', '0', '1', '1-6', '48.2'] },
      { athlete: { id: '52', firstName: 'Bijan', lastName: 'Robinson', displayName: 'Bijan Robinson' }, stats: ['1/1', '12', '12.0', '1', '0', '0-0', '158.3'] }] }] },
    { team: { id: '18' }, statistics: [{ name: 'passing', labels, athletes: [] }] },
  ] } };
  assert.deepEqual(S.boxPassers(passing), { 1: { id: '4360423', key: 'player:nfl:4360423', name: 'M. Penix Jr.', line: '7/13, 61 YDS, 1 INT' } },
    'a trick-play pass does not make the running back the passer; a side that has not thrown has no line');
  S.upsertGame(nfl);
  S.patchGame(nfl.key, { passers: S.boxPassers(passing) });
  assert.deepEqual(S.getGame(nfl.key)!.leaders, { away: { id: '4360423', key: 'player:nfl:4360423', name: 'M. Penix Jr.', line: '7/13, 61 YDS, 1 INT' } });
  S.upsertGame(S.gameCard('nfl', ev('nfl', 'Q2 - 4:02', { id: '18', score: '7', team: {} }, { id: '1', score: '3', team: {} }, {}))!);
  assert.equal(S.getGame(nfl.key)!.leaders!.away!.name, 'M. Penix Jr.', 'the next scoreboard read keeps the passers');
});

test('F1: a session card carries the running order, for anyone tracking F1', () => {
  const ev = { shortName: 'Singapore GP' };
  const comp = { id: 'R1', date: new Date().toISOString(), type: { text: 'Race' }, status: { period: 34, type: { state: 'in' } },
    competitors: [{ id: 'HAM', order: 2, athlete: { displayName: 'Lewis Hamilton' } }, { id: 'LEC', order: 1 }] };
  const card = S.raceCard(ev, comp);
  assert.equal(card.session, 'Singapore GP · Race');
  assert.equal(card.detail, 'Lap 34');
  assert.deepEqual(card.order!.map((d) => [d.position, d.name, d.teamKey]), [[1, 'Charles Leclerc', 'team:f1:FER'], [2, 'Lewis Hamilton', undefined]]);
  S.upsertGame(card);
  assert.deepEqual(S.gamesFor('f1-fan').map((g) => g.key), ['f1:R1']);
});

test('play-by-play for the game screen: newest first, NFL drives flattened, MLB at-bat results only', async () => {
  S.scoresDeps.getJson = async (url: string) => {
    if (url.includes('/football/nfl/')) return { drives: {
      previous: [{ plays: [{ id: '1', text: 'Kickoff', period: { number: 1 }, clock: { displayValue: '15:00' } }] }],
      current: { plays: [{ id: '2', text: 'B.Robinson up the middle for 2 yards', period: { number: 4 }, clock: { displayValue: '2:14' } },
        { id: '3', text: 'TOUCHDOWN', period: { number: 5 }, clock: { displayValue: '9:01' }, scoringPlay: true }] } } };
    return { plays: [
      { id: 'a', text: 'Pitch 1 : Ball 1', type: { type: 'ball' }, period: { type: 'Bottom', number: 8 } },
      { id: 'b', text: 'Ramírez doubled to left.', type: { type: 'play-result' }, period: { type: 'Bottom', number: 8 } },
    ] };
  };
  const nfl = await S.gamePlays(S.getGame('nfl:402')!);
  assert.deepEqual(nfl.map((p) => [p.when, p.text, p.scoring]), [['OT 9:01', 'TOUCHDOWN', true], ['Q4 2:14', 'B.Robinson up the middle for 2 yards', false], ['Q1 15:00', 'Kickoff', false]]);
  const mlb = await S.gamePlays(S.getGame('mlb:401907991')!);
  assert.deepEqual(mlb.map((p) => [p.when, p.text]), [['Bot 8th', 'Ramírez doubled to left.']]);
});

test("F1 between weekends: the next race weekend from ESPN's calendar, the current one while it's on", () => {
  // As ESPN's F1 scoreboard sent it on 2026-10-06, the day after the Bahrain GP in Malaysia.
  S.setF1Calendar([
    { label: 'Gulf Air Bahrain Grand Prix in Malaysia', startDate: '2026-10-02T07:30Z', endDate: '2026-10-04T10:00Z' },
    { label: 'Singapore Airlines Singapore Grand Prix', startDate: '2026-10-09T11:30Z', endDate: '2026-10-11T15:00Z' },
    { label: 'MSC Cruises United States Grand Prix', startDate: '2026-10-23T20:30Z', endDate: '2026-10-25T23:00Z' },
  ]);
  assert.equal(S.nextF1Weekend(Date.parse('2026-10-06T00:00Z'))?.name, 'Singapore Airlines Singapore Grand Prix');
  assert.equal(S.nextF1Weekend(Date.parse('2026-10-10T00:00Z'))?.name, 'Singapore Airlines Singapore Grand Prix', 'under way: still this one');
  assert.deepEqual(S.nextF1Weekend(Date.parse('2026-10-12T00:00Z')), { name: 'MSC Cruises United States Grand Prix', startsAt: Date.parse('2026-10-23T20:30Z'), endsAt: Date.parse('2026-10-25T23:00Z') });
  assert.equal(S.nextF1Weekend(Date.parse('2026-12-31T00:00Z')), undefined, 'the season is over');
  S.setF1Calendar(undefined); // a scoreboard read without a calendar keeps the last one
  assert.equal(S.nextF1Weekend(Date.parse('2026-10-06T00:00Z'))?.name, 'Singapore Airlines Singapore Grand Prix');
});
