// Soccer alerts beyond goals and cards: fouls (and dives), penalties conceded, losing the ball, passes
// given away, and a loss by 3+ goals. Shapes as ESPN sent Coventry 0-5 Brighton (2026-09-13) and
// Fulham 1-1 Man United (2026-09-20). Every soccer league gets these, each under its own switches.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_TOUCH_MS = '0'; // read the touch feed on every poll here (live: every 10s)
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { EVENT_TYPES, SOCCER_ALERT_KEYS } = await import('../src/event-types.ts');
const { SOCCER, urls } = await import('../src/leagues.ts');
const { fromCommentary, fromCorePlay, soccerFoul, soccerTouch, heavyLossEvent, gameLostEvent, PLAYER_DETECTORS, START_WORD } = await import('../src/detectors.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { hateWatchTally, RECIPIENTS } = await import('../src/hate-watches.ts');
const { GAME_LENGTH_MS } = await import('../src/scores.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'epl', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:epl:388', '388', 'Coventry City', 'Coventry', 'COV');
team.run('team:epl:331', '331', 'Brighton & Hove Albion', 'Brighton', 'BHA');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'epl', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [id, name, pos, t] of [['303931', 'Bobby Thomas', 'D', '388'], ['387489', 'Chema Andrés', 'M', '331'], ['301327', 'Maxim De Cuyper', 'D', '331'], ['258491', 'Frank Onyeka', 'M', '388'],
  ['387655', 'Charalambos Kostoulas', 'F', '331'], ['359097', 'Malick Yalcouyé', 'M', '331'], ['300001', 'Jack Rudoni', 'M', '388']])
  player.run(`player:epl:${id}`, id, name, pos, `team:epl:${t}`);
loadCatalog();

const g = (): any => ({ league: 'epl', gameId: 'M', homeId: '388', awayId: '331', goalies: new Map() });
const rosters = [
  { team: { id: '388', displayName: 'Coventry City' }, roster: [['303931', 'Bobby Thomas'], ['258491', 'Frank Onyeka'], ['300001', 'Jack Rudoni']].map(([id, n]) => ({ athlete: { id, displayName: n } })) },
  { team: { id: '331', displayName: 'Brighton & Hove Albion' }, roster: [['387489', 'Chema Andrés'], ['301327', 'Maxim De Cuyper'], ['387655', 'Charalambos Kostoulas'], ['359097', 'Malick Yalcouyé']].map(([id, n]) => ({ athlete: { id, displayName: n } })) },
];
const line = (seq: number, minute: string, id: string | null, type: string, text: string, who: string[] = [], at = '2026-09-13T14:00:00Z') =>
  ({ sequence: seq, time: { value: seq * 60, displayValue: minute }, text, ...(id ? { play: { id, type: { type }, wallclock: at, participants: who.map((n) => ({ athlete: { displayName: n } })) } } : {}) });
// As ESPN wrote them: each foul twice under one id, fouler first. At 67' the participants are stale (De
// Cuyper) and the text is right (Andrés). A penalty adds two more lines. A dive has no play at all.
const COMMENTARY = [
  line(1, "1'", '52343724', 'foul', 'Bobby Thomas (Coventry City) wins a free kick in the defensive half.', ['Malick Yalcouyé', 'Bobby Thomas']),
  line(2, "1'", '52343724', 'foul', 'Foul by Malick Yalcouyé (Brighton and Hove Albion).', ['Malick Yalcouyé', 'Bobby Thomas']),
  line(3, "62'", '52352800', 'handball', 'Handball by Charalampos Kostoulas (Brighton and Hove Albion).', ['Charalambos Kostoulas']),
  line(4, "67'", '52353046', 'foul', 'Frank Onyeka (Coventry City) wins a free kick in the defensive half.', ['Maxim De Cuyper', 'Frank Onyeka']),
  line(5, "67'", '52353046', 'foul', 'Foul by Chema Andrés (Brighton and Hove Albion).', ['Maxim De Cuyper', 'Frank Onyeka']),
  line(6, "68'", '52353379', 'foul', 'Penalty conceded by Bobby Thomas (Coventry City) after a foul in the penalty area.', ['Bobby Thomas', 'Charalambos Kostoulas']),
  line(7, "68'", '52353379', 'foul', 'Penalty Brighton and Hove Albion. Charalampos Kostoulas draws a foul in the penalty area.', ['Bobby Thomas', 'Charalambos Kostoulas']),
  line(8, "75'", null, '', 'Frank Onyeka (Coventry City) has gone down, but the referee deems it simulation.'),
];

test('every soccer league gets every soccer alert, under its own switches', () => {
  assert.deepEqual([...SOCCER], ['epl']);
  for (const lg of SOCCER) {
    const own = EVENT_TYPES.filter((t) => t.leagues.length === 1 && t.leagues[0] === lg).map((t) => t.id);
    assert.deepEqual(own, SOCCER_ALERT_KEYS.map((k) => `${lg}.${k}`), lg);
    assert.equal(typeof PLAYER_DETECTORS[lg], 'function');
    assert.equal(START_WORD[lg], 'Kickoff');
    assert.equal(GAME_LENGTH_MS[lg], 2 * 3600_000);
    for (const id of ['team.lost', 'player.team_lost', 'team.opponent_scored', 'off_field']) assert.ok(EVENT_TYPES.find((t) => t.id === id)!.leagues.includes(lg), `${id} covers ${lg}`);
  }
  const byId = (id: string) => EVENT_TYPES.find((t) => t.id === id)!;
  assert.deepEqual(['epl.foul', 'epl.penalty_conceded', 'epl.lost_ball', 'epl.pass_given_away', 'epl.team.heavy_loss'].map((id) => [id, byId(id).scope, byId(id).alsoScope ?? null, byId(id).defaultOn]), [
    ['epl.foul', 'player', null, true],
    ['epl.penalty_conceded', 'player', 'team', true],
    ['epl.lost_ball', 'player', null, true],
    ['epl.pass_given_away', 'player', null, false],
    ['epl.team.heavy_loss', 'team', null, true],
  ]);
});

test('fouls from the commentary: one per play, the fouler from the text, dives and handballs too', () => {
  const plays = fromCommentary({ rosters, commentary: COMMENTARY }, { home: 0, away: 2 });
  assert.deepEqual(plays.map((p) => [p.typeSlug, p.participants.map((x) => `${x.role} ${x.id}`).join(', '), p.text]), [
    ['foul', 'fouler 359097, fouled 303931', "1' Foul by Malick Yalcouyé (Brighton and Hove Albion)."],
    ['handball', 'fouler 387655', "62' Handball by Charalampos Kostoulas (Brighton and Hove Albion)."],
    ['foul', 'fouler 387489, fouled 258491', "67' Foul by Chema Andrés (Brighton and Hove Albion)."],
    ['penalty-conceded', 'fouler 303931, fouled 387655', "68' Penalty conceded by Bobby Thomas (Coventry City) after a foul in the penalty area."],
    ['simulation', 'fouler 258491', "75' Frank Onyeka (Coventry City) has gone down, but the referee deems it simulation."],
  ]);
  assert.deepEqual(plays.flatMap((p) => soccerFoul(g(), p)).map((e) => [e.type, e.targetKey, e.title, e.aliases ?? null]), [
    ['epl.foul', 'player:epl:359097', 'Malick Yalcouyé committed a foul', null],
    ['epl.foul', 'player:epl:387655', 'Charalambos Kostoulas was called for a handball', null],
    ['epl.foul', 'player:epl:387489', 'Chema Andrés committed a foul', null],
    ['epl.penalty_conceded', 'player:epl:303931', 'Bobby Thomas gave away a penalty 🤦', ['epl.foul']],
    ['epl.penalty_conceded', 'team:epl:388', 'Coventry gave away a penalty 🤦', null],
    ['epl.foul', 'player:epl:258491', 'Frank Onyeka went down, and the referee called it a dive 🤿', null],
  ]);
  const [pen, team] = soccerFoul(g(), plays[3]);
  assert.equal(pen.moment, team.moment, 'tracking Thomas and Coventry: one alert');
  assert.equal(pen.body, "68' Penalty conceded by Bobby Thomas (Coventry City) after a foul in the penalty area. — BHA 2, COV 0");
});

// The core feed's shapes: refs carry the ids.
const ref = (kind: string, id: string) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/${kind}/${id}?lang=en&region=us` });
const touch = (id: number, type: string, teamId: string, athleteId: string, name: string, minute = "8'", at = '2026-09-13T13:08:00Z') => ({
  id: String(id), type: { text: type, type: type.toLowerCase().replace(/ /g, '-') }, text: `${name} (${teamId === '388' ? 'Coventry City' : 'Brighton and Hove Albion'}) ${type} at ${minute}`,
  team: ref('teams', teamId), participants: [{ athlete: ref('athletes', athleteId), team: ref('teams', teamId) }], clock: { displayValue: minute }, homeScore: 0, awayScore: 0, wallclock: at,
});

test('losing the ball and giving it away, judged from the next touch', () => {
  const t = (...xs: any[]) => xs.map(fromCorePlay);
  const judge = (a: any, b: any) => soccerTouch(g(), ...(t(a, b) as [any, any])).map((e) => `${e.type}: ${e.title} | ${e.body}`);
  // A dribble into their tackle; one that got past (their tackle missed: "Attempted tackle").
  assert.deepEqual(judge(touch(1, 'Take On', '388', '300001', 'Jack Rudoni'), touch(2, 'Tackle', '331', '359097', 'Malick Yalcouyé')),
    ["epl.lost_ball: Jack Rudoni lost the ball | 8' Tackled trying to get past Malick Yalcouyé — BHA 0, COV 0"]);
  assert.deepEqual(judge(touch(1, 'Take On', '388', '300001', 'Jack Rudoni'), touch(2, 'Attempted Tackle', '331', '359097', 'Malick Yalcouyé')), []);
  assert.deepEqual(judge(touch(1, 'Dispossessed', '388', '300001', 'Jack Rudoni'), touch(2, 'Tackle', '331', '359097', 'Malick Yalcouyé')),
    ["epl.lost_ball: Jack Rudoni lost the ball | 8' Dispossessed by Malick Yalcouyé — BHA 0, COV 0"]);
  // Passes: to a teammate, fouled, or a failed tackle is fine; intercepted, blocked, cleared, or to them is not.
  const pass = touch(10, 'Pass', '388', '258491', 'Frank Onyeka');
  assert.deepEqual(judge(pass, touch(11, 'Pass', '388', '300001', 'Jack Rudoni')), []);
  assert.deepEqual(judge(pass, touch(11, 'Foul', '331', '359097', 'Malick Yalcouyé')), []);
  assert.deepEqual(judge(pass, touch(11, 'Attempted Tackle', '331', '359097', 'Malick Yalcouyé')), []);
  for (const [next, how] of [['Interception', 'intercepted by'], ['Blocked Pass', 'blocked by'], ['Clear', 'cleared by'], ['Pass', 'straight to']])
    assert.deepEqual(judge(pass, touch(11, next, '331', '387489', 'Chema Andrés')), [`epl.pass_given_away: Frank Onyeka gave the ball away | 8' Pass ${how} Chema Andrés — BHA 0, COV 0`], next);
  assert.deepEqual(judge(pass, touch(11, 'Interception', '331', '999999', 'Somebody New')), ["epl.pass_given_away: Frank Onyeka gave the ball away | 8' Pass intercepted by Somebody New — BHA 0, COV 0"], 'a name off the roster comes from the text');
});

// Devices for the tracker tests.
const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
for (const [id, keys, prefs] of [
  ['rudoni-fan', ['player:epl:300001'], { types: { 'epl.pass_given_away': true } }],
  ['thomas-and-coventry', ['player:epl:303931', 'team:epl:388'], {}],
  ['coventry-hater', ['team:epl:388'], {}],
  ['coventry-no-thrashing', ['team:epl:388'], { types: { 'epl.team.heavy_loss': false } }],
] as const) {
  device.run(id, 's', 'test', JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  for (const k of keys) follow.run(id, k);
}
const feed = (dev: string) => (db.prepare(`SELECT e.type, e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(dev) as any[]).map((r) => `${r.type}: ${r.title}`);

test('a live match: fouls from the commentary as it grows, touches from the newest page on, once a player is tracked', async () => {
  const now = () => new Date().toISOString();
  const commentary: any[] = [];
  // 250 touches already (history), then new ones on page 3.
  const touches: any[] = Array.from({ length: 250 }, (_, i) => touch(1000 + i, 'Pass', i % 2 ? '388' : '331', i % 2 ? '258491' : '387489', 'X', "40'", '2026-09-13T13:40:00Z'));
  const asked: string[] = [];
  liveDeps.getJson = async (url: string) => {
    asked.push(url);
    if (url === urls.summary('epl', 'L1')) return { rosters, commentary, keyEvents: [], header: { competitions: [{ status: { type: { state: 'in', completed: false } }, competitors: [] }] } };
    const m = url.match(/plays\?limit=(\d+)&page=(\d+)$/);
    if (m) { const [limit, page] = [Number(m[1]), Number(m[2])]; return { count: touches.length, pageIndex: page, pageCount: Math.ceil(touches.length / limit), items: touches.slice((page - 1) * limit, page * limit) }; }
    throw new Error(`unexpected fetch ${url}`);
  };
  const game = new GameTracker('epl', 'L1', '388', '331');
  await game.poll();
  assert.deepEqual(asked.filter((u) => u.includes('plays?')).map((u) => u.split('?')[1]), ['limit=100&page=1', 'limit=100&page=3'],
    'the first read gets the count, then jumps to the newest page: 2 pages of history never read');
  // A foul and its penalty, written a poll apart; then Rudoni loses the ball, judged once the tackle is in.
  commentary.push(line(1, "68'", 'P1', 'foul', 'Penalty Brighton and Hove Albion. Charalampos Kostoulas draws a foul in the penalty area.', ['Bobby Thomas', 'Charalambos Kostoulas'], now()));
  touches.push(touch(2000, 'Take On', '388', '300001', 'Jack Rudoni', "69'", now()));
  await game.poll();
  commentary.push(line(2, "68'", 'P1', 'foul', 'Penalty conceded by Bobby Thomas (Coventry City) after a foul in the penalty area.', ['Bobby Thomas', 'Charalambos Kostoulas'], now()));
  touches.push(touch(2001, 'Tackle', '331', '359097', 'Malick Yalcouyé', "69'", now()));
  touches.push(touch(2002, 'Pass', '388', '300001', 'Jack Rudoni', "70'", now()));
  touches.push(touch(2003, 'Interception', '331', '387489', 'Chema Andrés', "70'", now()));
  await game.poll();
  await game.poll();
  assert.deepEqual(feed('thomas-and-coventry'), ['epl.penalty_conceded: Bobby Thomas gave away a penalty 🤦'], 'the penalty once it was written; tracking both, the player one');
  assert.deepEqual(feed('coventry-hater'), ['epl.penalty_conceded: Coventry gave away a penalty 🤦']);
  assert.deepEqual(feed('rudoni-fan'), ['epl.lost_ball: Jack Rudoni lost the ball', 'epl.pass_given_away: Jack Rudoni gave the ball away'], 'nothing from the 250 touches before it attached');
  assert.deepEqual(asked.filter((u) => u.includes('plays?')).slice(2).map((u) => u.split('?')[1]), ['limit=100&page=3', 'limit=100&page=3', 'limit=100&page=3'], 'then from the page it stopped in');
});

test('a loss by 3+ goals: "thrashed" instead of the plain loss for those who want it, one Successful Hate Watch either way', () => {
  new GameTracker('epl', 'F1', '388', '331').finish({ home: 0, away: 5 });
  assert.deepEqual(feed('coventry-hater').slice(-1), ['epl.team.heavy_loss: Successful Hate Watch! Coventry were thrashed 5-0 by Brighton']);
  assert.deepEqual(feed('coventry-no-thrashing').slice(-1), ['team.lost: Successful Hate Watch! Coventry lost to Brighton']);
  assert.deepEqual(feed('thomas-and-coventry').slice(-1), ['epl.team.heavy_loss: Successful Hate Watch! Coventry were thrashed 5-0 by Brighton']);
  for (const dev of ['coventry-hater', 'coventry-no-thrashing', 'thomas-and-coventry']) {
    const t = hateWatchTally(dev);
    assert.deepEqual([t.total, t.teams.map((x: any) => x.target.key)], [1, ['team:epl:388']], dev);
  }
  assert.deepEqual(feed('rudoni-fan').slice(-1), ['player.team_lost: Successful Hate Watch! Jack Rudoni and Coventry lost to Brighton'], 'tracks a Coventry player');
  // "3 other hate watchers": four devices got one of the loss's alerts.
  const others = db.prepare(`SELECT ${RECIPIENTS} FROM events e WHERE e.id = ?`).get('F1:final:epl.team.heavy_loss:388') as any;
  assert.equal(others.recipients, 4);
  // A two-goal loss is just a loss; and only soccer has it.
  const lost = gameLostEvent({ league: 'epl', gameId: 'F2', homeId: '388', awayId: '331' }, { home: 1, away: 3 }, 0)!;
  assert.equal(heavyLossEvent({ league: 'epl', gameId: 'F2' }, lost, { home: 1, away: 3 }), null);
  const nhl = gameLostEvent({ league: 'nhl', gameId: 'H1', homeId: '1', awayId: '2' }, { home: 0, away: 6 }, 0)!;
  assert.equal(heavyLossEvent({ league: 'nhl', gameId: 'H1' }, nhl, { home: 0, away: 6 }), null);
});
