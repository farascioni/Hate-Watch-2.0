// The EPL: soccer from ESPN's key events (goals, cards, penalties, subs), which carry no score. Event
// shapes as ESPN sent them for September 2026 matches: Fulham 1-1 Man United (an own goal), Newcastle 2-1
// Hull (a saved penalty), Everton 1-0 Ipswich (a second yellow), Coventry 0-5 Brighton (a straight red).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { LEAGUE_IDS, urls } = await import('../src/leagues.ts');
const { PLAYER_DETECTORS, fromKeyEvents, keepers, observePlay, gameLostEvent, teamScoreEvents, START_WORD } = await import('../src/detectors.ts');
const { GameTracker, liveDeps, parseStandings, dropBody } = await import('../src/live.ts');
const { gameCard } = await import('../src/scores.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'epl', ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [id, name, short, abbr] of [['370', 'Fulham', 'Fulham', 'FUL'], ['360', 'Manchester United', 'Man United', 'MAN'], ['361', 'Newcastle United', 'Newcastle', 'NEW'],
  ['306', 'Hull City', 'Hull', 'HUL'], ['373', 'Ipswich Town', 'Ipswich', 'IPS'], ['368', 'Everton', 'Everton', 'EVE'], ['388', 'Coventry City', 'Coventry', 'COV'], ['331', 'Brighton & Hove Albion', 'Brighton', 'BHA']])
  team.run(`team:epl:${id}`, id, name, short, abbr);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'epl', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [id, name, pos, teamId] of [['233937', 'Lisandro Martínez', 'D', '360'], ['301425', 'Senne Lammens', 'G', '360'], ['153765', 'Bernd Leno', 'G', '370'], ['259902', 'Matheus Cunha', 'F', '360'],
  ['224077', 'Yoane Wissa', 'F', '361'], ['318680', 'Abdul Fatawu', 'F', '373'], ['194686', 'Taiwo Awoniyi', 'F', '388'], ['999001', 'Altay Bayindir', 'G', '360']])
  player.run(`player:epl:${id}`, id, name, pos, `team:epl:${teamId}`);
loadCatalog();

const OWN_GOAL = { id: '52737481', type: { text: 'Own Goal', type: 'own-goal' }, text: 'Own Goal by Lisandro Martínez, Manchester United. Fulham 1, Manchester United 0.', clock: { displayValue: "63'" }, scoringPlay: true, team: { id: '370' }, participants: [{ athlete: { id: '233937' } }], wallclock: '2026-09-20T16:48:17Z', shootout: false };
const EQUALIZER = { id: '52740079', type: { text: 'Goal', type: 'goal' }, text: 'Goal! Fulham 1, Manchester United 1. Matheus Cunha (Manchester United) right footed shot from outside the box to the bottom right corner. Assisted by Patrick Dorgu.', clock: { displayValue: "89'" }, scoringPlay: true, team: { id: '360' }, participants: [{ athlete: { id: '259902' } }, { athlete: { id: '366781' } }], wallclock: '2026-09-20T17:14:33Z', shootout: false };
const PEN_SAVED = { id: '52608073', type: { text: 'Penalty - Saved', type: 'penalty---saved' }, text: 'Penalty saved. Yoane Wissa (Newcastle United) right footed shot saved in the bottom right corner by Konstantinos Tzolakis (Hull City).', clock: { displayValue: "45'+2'" }, scoringPlay: false, team: { id: '361' }, participants: [{ athlete: { id: '224077' } }], wallclock: '2026-09-19T14:46:39Z', shootout: false };
const SECOND_YELLOW = { id: '52615554', type: { text: 'Red Card', type: 'red-card' }, text: 'Second yellow card to Abdul Fatawu (Ipswich Town).', clock: { displayValue: "67'" }, scoringPlay: false, team: { id: '373' }, participants: [{ athlete: { id: '318680' } }], wallclock: '2026-09-19T15:23:54Z', shootout: false };
const STRAIGHT_RED = { id: '52351196', type: { text: 'Red Card', type: 'red-card' }, text: 'Taiwo Awoniyi (Coventry City) is shown the red card for violent conduct.', clock: { displayValue: "53'" }, scoringPlay: false, team: { id: '388' }, participants: [{ athlete: { id: '194686' } }], wallclock: '2026-09-13T14:10:01Z', shootout: false };
const LINEUPS = [
  { team: { id: '370' }, roster: [{ athlete: { id: '153765' }, position: { abbreviation: 'G' }, starter: true, subbedIn: false, subbedOut: false }] },
  { team: { id: '360' }, roster: [{ athlete: { id: '301425' }, position: { abbreviation: 'G' }, starter: true, subbedIn: false, subbedOut: false }, { athlete: { id: '999001' }, position: { abbreviation: 'G' }, starter: false, subbedIn: false, subbedOut: false }] },
];
const ctx = (homeId: string, awayId: string): any => ({ league: 'epl', gameId: 'M', homeId, awayId, goalies: new Map() });

test('the EPL is a league: ESPN files it as soccer/eng.1, and the WNBA stays last', () => {
  assert.deepEqual(LEAGUE_IDS.slice(-2), ['epl', 'wnba']);
  assert.equal(urls.summary('epl', '401879276'), 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=401879276');
  assert.equal(urls.standings('epl'), 'https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings');
  assert.equal(urls.headshot('epl', '274632'), 'https://a.espncdn.com/i/headshots/soccer/players/full/274632.png');
  assert.equal(urls.summary('nba', '1'), 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=1', 'other leagues unchanged');
  assert.equal(START_WORD.epl, 'Kickoff');
  const epl = EVENT_TYPES.filter((t) => t.leagues.includes('epl')).map((t) => t.id);
  for (const id of ['epl.goal_conceded', 'epl.own_goal', 'epl.penalty_missed', 'epl.yellow_card', 'epl.red_card', 'team.game_start', 'team.lost', 'team.opponent_scored', 'team.fell_behind', 'team.standings_drop', 'off_field', 'team.fine_suspension'])
    assert.ok(epl.includes(id), id);
  for (const id of ['player.injured', 'team.losing_streak', 'team.eliminated']) assert.ok(!epl.includes(id), `${id}: ESPN has no EPL data for it`);
});

test('key events as plays: the score counted from the goals (an own goal for the team it counts for), the minute in front', () => {
  const plays = fromKeyEvents({ keyEvents: [{ id: 'k', type: { text: 'Kickoff', type: 'kickoff' }, scoringPlay: false, wallclock: '2026-09-20T16:00:00Z' }, OWN_GOAL, EQUALIZER] }, '370', '360');
  assert.deepEqual(plays.map((p) => [p.home, p.away, p.scoring]), [[0, 0, false], [1, 0, true], [1, 1, true]]);
  assert.equal(plays[1].text, "63' Own Goal by Lisandro Martínez, Manchester United.");
  assert.equal(plays[2].text, "89' Matheus Cunha (Manchester United) right footed shot from outside the box to the bottom right corner. Assisted by Patrick Dorgu.");
  assert.deepEqual(plays[2].participants, [{ id: '259902', role: 'scorer' }, { id: '366781', role: 'assist' }]);
  assert.equal(plays[2].at, Date.parse('2026-09-20T17:14:33Z'));
});

test('keepers come from the line-ups: the starter, or the one who came on', () => {
  assert.deepEqual([...keepers({ rosters: LINEUPS })], [['370', '153765'], ['360', '301425']]);
  const subbed = structuredClone(LINEUPS);
  Object.assign(subbed[1].roster[0], { subbedOut: true });
  Object.assign(subbed[1].roster[1], { subbedIn: true });
  assert.equal(keepers({ rosters: subbed }).get('360'), '999001');
});

test('an own goal: the scorer, their keeper, and their team each get theirs', () => {
  const g = ctx('370', '360');
  g.goalies = keepers({ rosters: LINEUPS });
  const [og, eq] = fromKeyEvents({ keyEvents: [OWN_GOAL, EQUALIZER] }, '370', '360');
  assert.deepEqual(PLAYER_DETECTORS.epl(g, og).map((e) => [e.type, e.targetKey, e.title]), [
    ['epl.own_goal', 'player:epl:233937', 'Lisandro Martínez scored an own goal 🤡'],
    ['epl.goal_conceded', 'player:epl:301425', 'Senne Lammens conceded a goal 🥅'],
  ]);
  assert.equal(PLAYER_DETECTORS.epl(g, og)[0].body, "63' Own Goal by Lisandro Martínez, Manchester United. — MAN 0, FUL 1");
  // Team alerts: no "the" for clubs. Going behind is one alert (it's `unless` for the scored-on one).
  assert.deepEqual(teamScoreEvents(g, { home: 0, away: 0 }, og).map((e) => [e.type, e.targetKey, e.title, e.unless]), [
    ['team.opponent_scored', 'team:epl:360', 'Fulham scored against Man United', 'team.fell_behind'],
    ['team.fell_behind', 'team:epl:360', 'Fulham scored to take the lead over Man United', undefined],
  ]);
  assert.deepEqual(PLAYER_DETECTORS.epl(g, eq).map((e) => [e.type, e.targetKey]), [['epl.goal_conceded', 'player:epl:153765']]);
  assert.equal(gameLostEvent({ league: 'epl', gameId: 'M', homeId: '370', awayId: '360' }, { home: 2, away: 1 }, 0)!.title, 'Successful Hate Watch! Man United lost to Fulham');
  assert.equal(gameLostEvent({ league: 'epl', gameId: 'M', homeId: '370', awayId: '360' }, { home: 1, away: 1 }, 0), null, 'a draw is not a loss');
});

test('a keeper who scores an own goal gets one alert, not two', () => {
  const g = ctx('370', '360');
  g.goalies = new Map([['360', '233937']]);
  const [og] = fromKeyEvents({ keyEvents: [OWN_GOAL] }, '370', '360');
  assert.deepEqual(PLAYER_DETECTORS.epl(g, og).map((e) => [e.type, e.aliases]), [['epl.own_goal', ['epl.goal_conceded']]]);
});

test('a saved penalty: the taker and their team, one alert for anyone tracking both', () => {
  const g = ctx('361', '306');
  const es = PLAYER_DETECTORS.epl(g, fromKeyEvents({ keyEvents: [PEN_SAVED] }, '361', '306')[0]);
  assert.deepEqual(es.map((e) => [e.type, e.targetKey, e.title]), [
    ['epl.penalty_missed', 'player:epl:224077', 'Yoane Wissa had a penalty saved 😬'],
    ['epl.penalty_missed', 'team:epl:361', 'Newcastle had a penalty saved 😬'],
  ]);
  assert.equal(es[0].moment, es[1].moment);
  const scored = fromKeyEvents({ keyEvents: [{ ...PEN_SAVED, id: 'x', type: { text: 'Penalty - Scored', type: 'penalty---scored' }, scoringPlay: true }] }, '361', '306')[0];
  assert.ok(!PLAYER_DETECTORS.epl(g, scored).some((e) => e.type === 'epl.penalty_missed'));
});

test('red cards: the player is sent off and the team is down to 10, then 9; a keeper sent off is out of goal', () => {
  const g = ctx('368', '373');
  const [second] = fromKeyEvents({ keyEvents: [SECOND_YELLOW] }, '368', '373');
  const es = PLAYER_DETECTORS.epl(g, second);
  assert.deepEqual(es.map((e) => [e.type, e.targetKey, e.title]), [
    ['epl.red_card', 'player:epl:318680', 'Abdul Fatawu was sent off (second yellow) 🟥'],
    ['epl.red_card', 'team:epl:373', 'Ipswich are down to 10 men 🟥'],
  ]);
  assert.equal(es[0].moment, es[1].moment);
  observePlay(g, second);
  const again = fromKeyEvents({ keyEvents: [{ ...SECOND_YELLOW, id: 'r2' }] }, '368', '373')[0];
  assert.equal(PLAYER_DETECTORS.epl(g, again)[1].title, 'Ipswich are down to 9 men 🟥');

  const c = ctx('388', '331');
  const [red] = fromKeyEvents({ keyEvents: [STRAIGHT_RED] }, '388', '331');
  assert.equal(PLAYER_DETECTORS.epl(c, red)[0].title, 'Taiwo Awoniyi was sent off 🟥');
  c.goalies.set('388', '194686'); // as if he'd been in goal
  observePlay(c, red);
  assert.equal(c.goalies.has('388'), false);
  // The replacement keeper coming on takes over.
  observePlay(c, { ...red, id: 's', type: 'Substitution', typeSlug: 'substitution', teamId: '360', participants: [{ id: '999001', role: 'on' }, { id: '259902', role: 'off' }] });
  assert.equal(c.goalies.get('360'), '999001');
});

test('a yellow card is a booking', () => {
  const yellow = fromKeyEvents({ keyEvents: [{ ...SECOND_YELLOW, id: 'y', type: { text: 'Yellow Card', type: 'yellow-card' }, text: 'Abdul Fatawu (Ipswich Town) is shown the yellow card for a bad foul.' }] }, '368', '373')[0];
  assert.deepEqual(PLAYER_DETECTORS.epl(ctx('368', '373'), yellow).map((e) => [e.type, e.title]), [['epl.yellow_card', 'Abdul Fatawu was booked 🟨']]);
});

test('the table: one group, ranked by position, called the Premier League; dropping into the relegation zone says so', () => {
  const entry = (id: string, rank: number, note?: string) => ({ team: { id }, stats: [{ name: 'rank', value: rank }, { name: 'points', value: 20 - rank }], ...(note ? { note: { description: note } } : {}) });
  const res = { name: 'English Premier League', abbreviation: 'Premier League', children: [{ name: '2026-27 English Premier League', abbreviation: '2026-2027', standings: { entries: [entry('388', 18, 'Relegation'), entry('331', 3, 'Champions League'), entry('370', 17)] } }] };
  const s = parseStandings(res);
  assert.deepEqual([...s].map(([id, x]) => [id, x.rank, x.group, x.note]), [['331', 3, 'Premier League', 'Champions League'], ['370', 17, 'Premier League', undefined], ['388', 18, 'Premier League', 'Relegation']]);
  assert.equal(dropBody({ rank: 16, group: 'Premier League', clincher: '', streak: '' }, s.get('388')!), 'Down from 16th. Into the relegation zone 🪂');
  assert.equal(dropBody({ rank: 2, group: 'East', clincher: '', streak: 'L1' }, { rank: 3, group: 'East', clincher: '', streak: 'L2' }), 'Down from 2nd. Streak: L2');
});

test('a Scores-tab card: shots on target, red cards and the latest goal or card', () => {
  const side = (id: string, homeAway: string, score: string, sot: string) => ({ id, homeAway, score, team: { id, abbreviation: id }, statistics: [{ name: 'shotsOnTarget', displayValue: sot }] });
  const ev = { id: '401878777', date: '2026-09-20T16:00Z', status: { type: { state: 'in', shortDetail: "64'" } }, competitions: [{
    competitors: [side('370', 'home', '1', '3'), side('360', 'away', '0', '2')],
    details: [{ type: { text: 'Yellow Card' }, clock: { displayValue: "45'" }, team: { id: '370' }, redCard: false, athletesInvolved: [{ shortName: 'J. King' }] },
      { type: { text: 'Own Goal' }, clock: { displayValue: "63'" }, team: { id: '370' }, redCard: false, ownGoal: true, athletesInvolved: [{ shortName: 'L. Martínez' }] }],
  }] };
  const card = gameCard('epl', ev)!;
  assert.deepEqual([card.shots, card.redCards, card.lastPlay, card.detail], [{ home: 3, away: 2 }, undefined, "63' Own Goal: L. Martínez", "64'"]);
  ev.competitions[0].details.push({ type: { text: 'Red Card' }, clock: { displayValue: "70'" }, team: { id: '360' }, redCard: true, athletesInvolved: [{ shortName: 'L. Martínez' }] } as any);
  assert.deepEqual(gameCard('epl', ev)!.redCards, { home: 0, away: 1 });
});

test('a live match end to end: key events from the summary, alerts to whoever tracks what', async () => {
  const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
  const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
  for (const [dev, keys] of [['united-hater', ['team:epl:360']], ['keeper-hater', ['player:epl:301425']], ['both', ['team:epl:360', 'player:epl:233937']], ['fulham-hater', ['team:epl:370']]] as const) {
    device.run(dev, 's', 'test', JSON.stringify(DEFAULT_PREFS));
    for (const k of keys) follow.run(dev, k);
  }
  // In the order they were delivered (two alerts can share a millisecond).
  const feed = (dev: string) => (db.prepare(`SELECT e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(dev) as any[]).map((r) => r.title);
  const keyEvents: any[] = [];
  let state = 'in', score = { home: '0', away: '0' };
  const fetched: string[] = [];
  liveDeps.getJson = async (url: string) => {
    fetched.push(url);
    if (url.startsWith(urls.corePlays('epl', 'M1').split('?')[0])) return { count: 0, pageCount: 0, items: [] }; // the touch feed: nothing here
    if (url !== urls.summary('epl', 'M1')) throw new Error(`unexpected fetch ${url}`);
    return { keyEvents, rosters: LINEUPS, header: { competitions: [{ status: { type: { state, completed: state === 'post' } }, competitors: [{ homeAway: 'home', score: score.home }, { homeAway: 'away', score: score.away }] }] } };
  };
  const game = new GameTracker('epl', 'M1', '370', '360');
  await game.poll(); // attached at kickoff: nothing yet
  keyEvents.push({ ...OWN_GOAL, wallclock: new Date().toISOString() });
  await game.poll();
  keyEvents.push({ ...EQUALIZER, wallclock: new Date().toISOString() });
  await game.poll();
  await game.poll(); // nothing new: no repeats
  keyEvents.push({ ...OWN_GOAL, id: 'late', clock: { displayValue: "90'+3'" }, wallclock: new Date().toISOString() });
  state = 'post'; score = { home: '2', away: '1' };
  await game.poll();
  assert.equal(fetched.filter((u) => u.includes('sports.core.api')).length, 1, 'the touch feed (players are tracked here): at most every 10s, not every poll');
  assert.deepEqual(feed('united-hater'), [
    'Fulham scored to take the lead over Man United',
    'Fulham scored to take the lead over Man United',
    'Successful Hate Watch! Man United lost to Fulham',
  ]);
  assert.deepEqual(feed('keeper-hater'), ['Senne Lammens conceded a goal 🥅', 'Senne Lammens conceded a goal 🥅', 'Successful Hate Watch! Senne Lammens and Man United lost to Fulham']);
  assert.ok(!feed('both').includes('Successful Hate Watch! Lisandro Martínez and Man United lost to Fulham'), 'tracks Man United too: their loss once');
  assert.deepEqual(feed('both').filter((t) => /own goal/.test(t)), ['Lisandro Martínez scored an own goal 🤡', 'Lisandro Martínez scored an own goal 🤡']);
  assert.deepEqual(feed('fulham-hater'), ['Man United scored against Fulham']);
});
