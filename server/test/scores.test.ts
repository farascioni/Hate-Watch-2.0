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
