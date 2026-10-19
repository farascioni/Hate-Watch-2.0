// Special Events beyond today's scoreboard (series.ts): the series ledger from a team's postseason schedule, the live
// card's scoreboard lines, the playoff games coming in the next week, and the vote on who loses. Real ESPN payloads
// from October 2026 (fixtures: the Guardians' postseason schedule, ALCS Game 5 live, the four wild card Game 1s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const S = await import('../src/scores.ts');
const E = await import('../src/series.ts');

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const schedule = fx('mlb-cle-postseason-schedule.json');
const live = fx('mlb-alcs-game5-live.json');
const wildcard = fx('mlb-wildcard-20260929.json');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [id, name, abbr] of [['5', 'Guardians', 'CLE'], ['30', 'Rays', 'TB'], ['4', 'White Sox', 'CHW'], ['18', 'Astros', 'HOU']]) team.run(`team:mlb:${id}`, 'mlb', id, name, name, abbr, '#123456');
loadCatalog();
const device = db.prepare(`INSERT INTO devices (id, secret, created_at) VALUES (?, 's', 0)`);
for (const d of ['d1', 'd2', 'd3', 'd4']) device.run(d);

test('the ledger: oldest first, the rained-out game left out, its makeup in, "if necessary" marked', () => {
  const games = E.ledgerFromSchedule('mlb', schedule, 'ALCS', '5', '30');
  assert.deepEqual(games.map((g) => g.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(games.find((g) => g.n === 4)!.id, '401908027', 'the makeup, not the postponed 401908026');
  assert.ok(!games.some((g) => g.id === '401908026'));
  assert.deepEqual(games.map((g) => g.state), ['post', 'post', 'post', 'post', 'in', 'pre', 'pre']);
  assert.deepEqual(games[0], { n: 1, id: '401908023', state: 'post', startsAt: Date.parse('2026-10-13T00:00Z'), winner: 'team:mlb:5', score: [7, 3] });
  assert.equal(games[4].winner, undefined);
  assert.deepEqual(games.map((g) => !!g.ifNeeded), [false, false, false, false, false, false, true]);
  assert.deepEqual(E.ledgerFromSchedule('mlb', schedule, 'ALDS', '5', '4').map((g) => g.n), [1, 2, 3, 4, 5], 'a round is its own series');
});

test('a live postseason card has each side\'s innings, hits, errors and record', () => {
  const card = S.gameCard('mlb', live.events[0])!;
  const { lines } = card.event!;
  assert.deepEqual(lines!.home.periods, [0, 0, 0, 0, 0, 1, 0, 0]);
  assert.deepEqual(lines!.away.periods, [1, 1, 1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([lines!.home.h, lines!.home.e, lines!.away.h, lines!.away.e], [5, 0, 11, 0]);
  assert.deepEqual([lines!.home.rec, lines!.home.split, lines!.away.rec, lines!.away.split], ['85-77', '41-40', '98-64', '43-38']);
});

test('the ledger is read for a series on the board and added to its cards', async () => {
  const card = S.gameCard('mlb', live.events[0])!;
  S.upsertGame(card);
  assert.equal(S.getGame(card.key)!.event!.games, undefined);
  E.seriesDeps.getJson = async (url) => { assert.match(url, /teams\/5\/schedule\?seasontype=3$/); return schedule; };
  await E.refreshSeries(1_000_000);
  assert.equal(S.getGame(card.key)!.event!.games!.length, 7);
  assert.equal(S.getGame(card.key)!.event!.games![4].state, 'in');
});

// Four wild card Game 1s, moved to "not started yet" two days from `now`, each series 0-0.
const NOW = Date.parse('2026-09-27T16:00:00Z');
const upcomingFixture = () => ({
  events: wildcard.events.map((ev: any) => {
    const c = ev.competitions[0];
    return {
      ...ev, date: new Date(NOW + 2 * 86400_000).toISOString(), status: { type: { state: 'pre' } },
      competitions: [{ ...c, status: { type: { state: 'pre' } }, series: { ...c.series, competitors: c.series.competitors.map((s: any) => ({ ...s, wins: 0 })) } }],
    };
  }),
});

test('upcoming: each wild card series once, voting hides the percentages until you vote', async () => {
  E.seriesDeps.getJson = async (url) => (/baseball\/mlb\/scoreboard/.test(url) ? upcomingFixture() : { events: [] });
  await E.refreshUpcoming(NOW);
  const items = E.upcomingFor('d1');
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => /WC$/.test(i.game.event!.name) && i.game.event!.bestOf === 3 && !i.mine && !i.votes));
  const hou = items.find((i) => i.game.home!.team.abbrev === 'HOU' || i.game.away!.team.abbrev === 'HOU')!;
  const [a, b] = [hou.game.home!.team.key, hou.game.away!.team.key];

  assert.equal(E.castVote('d1', hou.voteKey, 'team:mlb:999', NOW), null, 'not one of its two teams');
  assert.equal(E.castVote('d1', 'mlb:nope', a, NOW), null, 'not open for voting');
  assert.equal(E.castVote('d1', hou.voteKey, a, NOW + 3 * 86400_000), null, 'the game has started');

  assert.deepEqual(E.castVote('d1', hou.voteKey, a, NOW)!.votes, { [a]: 1, [b]: 0 });
  assert.deepEqual(E.castVote('d2', hou.voteKey, b, NOW)!.votes, { [a]: 1, [b]: 1 });
  assert.deepEqual(E.castVote('d3', hou.voteKey, b, NOW)!.votes, { [a]: 1, [b]: 2 });
  const changed = E.castVote('d1', hou.voteKey, b, NOW)!;
  assert.deepEqual([changed.mine, changed.votes], [b, { [a]: 0, [b]: 3 }], 'a vote can be changed, never counted twice');
  const other = E.upcomingFor('d1').find((i) => i.voteKey !== hou.voteKey)!;
  assert.deepEqual([other.mine, other.votes], [undefined, undefined], 'only the series you voted in shows its results');
  assert.equal(E.upcomingFor('d1').length, 4);
});

test('upcoming: a series that has begun, or a failed read, changes nothing', async () => {
  const before = E.upcomingFor('d1').map((i) => i.voteKey);
  E.seriesDeps.getJson = async () => { throw new Error('ESPN down'); };
  await E.refreshUpcoming(NOW);
  assert.deepEqual(E.upcomingFor('d1').map((i) => i.voteKey), before, 'a failed read keeps the list');

  const g = S.gameCard('mlb', upcomingFixture().events[0])!;
  const started = { ...g, state: 'in' as const };
  assert.equal(E.pickUpcoming([g], [started], NOW).length, 0, 'its series is on the board');
  const oneWin = { ...g, event: { ...g.event!, wins: { home: 1, away: 0 } } };
  assert.equal(E.pickUpcoming([oneWin], [], NOW).length, 0, 'a game 2 is not the series\' start');
  assert.equal(E.pickUpcoming([{ ...g, startsAt: NOW + 8 * 86400_000 }], [], NOW).length, 0, 'a week ahead only');
});

test('upcoming: a team ESPN has not decided yet (a placeholder with a negative id) is not listed', () => {
  const g = S.gameCard('mlb', upcomingFixture().events[0])!;
  const tbd = { ...g, away: { ...g.away!, team: { ...g.away!.team, espnId: '-2' } } };
  assert.equal(E.pickUpcoming([g], [], NOW).length, 1);
  assert.equal(E.pickUpcoming([tbd], [], NOW).length, 0);
});

test('a series that has started stays open for votes (under its scoreboard) until it is won', () => {
  const card = S.gameCard('mlb', live.events[0])!; // ALCS game 5, on now
  S.upsertGame(card);
  const key = card.event!.seriesKey!;
  const [a, b] = [card.home!.team.key, card.away!.team.key];
  const mine = () => E.startedFor('d1').find((i) => i.voteKey === key)!;
  assert.deepEqual([mine().closed, mine().mine, mine().votes], [undefined, undefined, undefined], 'listed, counts withheld');

  assert.deepEqual(E.castVote('d1', key, a, NOW)!.votes, { [a]: 1, [b]: 0 });
  assert.deepEqual(E.castVote('d2', key, b, NOW)!.votes, { [a]: 1, [b]: 1 });
  assert.deepEqual([mine().mine, mine().votes], [a, { [a]: 1, [b]: 1 }]);
  assert.equal(E.startedFor('d3').find((i) => i.voteKey === key)!.votes, undefined, 'a device that has not voted sees no counts');
  assert.equal(E.upcomingFor('d1').some((i) => i.voteKey === key), false, 'not also under Coming up');

  const wins = { home: 4, away: 1 };
  S.upsertGame({ ...card, state: 'post', event: { ...card.event!, wins } });
  assert.equal(E.castVote('d1', key, b, NOW), null, 'won: no more votes');
  assert.deepEqual([mine().closed, mine().mine, mine().votes], [true, a, { [a]: 1, [b]: 1 }], 'its results stay for a device that voted');
  assert.equal(E.startedFor('d3').some((i) => i.voteKey === key), false, 'and nothing for one that did not');
});

test('a won series is read from its newest game even when an older game\'s card is still on the board', () => {
  const card = S.gameCard('mlb', live.events[0])!;
  const ev = { ...card.event!, seriesKey: 'mlb:test-series' };
  const [a, b] = [card.home!.team.key, card.away!.team.key];
  S.upsertGame({ ...card, key: 'mlb:older', state: 'post', startsAt: card.startsAt - 86400_000, event: { ...ev, wins: { home: 3, away: 3 } } });
  S.upsertGame({ ...card, key: 'mlb:newer', state: 'post', startsAt: card.startsAt, event: { ...ev, wins: { home: 4, away: 3 } } });
  assert.equal(E.castVote('d9', 'mlb:test-series', a, NOW), null, 'decided 4-3: no votes, though the 3-3 card is older and first');
  assert.equal(E.startedFor('d9').some((i) => i.voteKey === 'mlb:test-series'), false, 'and not listed for a device that never voted');
  assert.ok(b);
});

const follow = (d: string, k: string) => db.prepare('SELECT event_key, event_until FROM follows WHERE device_id = ? AND target_key = ?').get(d, k) as { event_key: string | null; event_until: number | null } | undefined;

test('the alert toggle tracks the team you voted to lose, moves with your vote, and leaves a team you track alone', async () => {
  E.seriesDeps.getJson = async (url) => (/baseball\/mlb\/scoreboard/.test(url) ? upcomingFixture() : { events: [] });
  await E.refreshUpcoming(NOW);
  const hou = E.upcomingFor('d1').find((i) => i.game.home!.team.abbrev === 'HOU' || i.game.away!.team.abbrev === 'HOU')!;
  const [a, b] = [hou.game.home!.team.key, hou.game.away!.team.key];
  const own = (d: string) => E.upcomingFor(d).find((i) => i.voteKey === hou.voteKey)!;

  assert.equal(E.setAlert('d4', hou.voteKey, true, NOW), null, 'no vote, no alerts');
  E.castVote('d3', hou.voteKey, a, NOW);
  assert.equal(own('d3').alert, undefined, 'off by default');
  assert.equal(follow('d3', a), undefined);
  assert.equal(E.setAlert('d3', hou.voteKey, true, NOW)!.alert, 'event');
  assert.equal(follow('d3', a)!.event_key, hou.voteKey);

  E.castVote('d3', hou.voteKey, b, NOW);
  assert.deepEqual([follow('d3', a), follow('d3', b)!.event_key, own('d3').alert], [undefined, hou.voteKey, 'event'], 'the alert moves with the vote');
  assert.equal(E.setAlert('d3', hou.voteKey, false, NOW)!.alert, undefined);
  assert.equal(follow('d3', b), undefined);
  E.castVote('d3', hou.voteKey, a, NOW);
  assert.equal(follow('d3', a), undefined, 'a vote change with alerts off adds none');

  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?,?,0)').run('d2', b);
  E.castVote('d2', hou.voteKey, b, NOW);
  assert.equal(own('d2').alert, 'tracked');
  E.setAlert('d2', hou.voteKey, true, NOW);
  E.setAlert('d2', hou.voteKey, false, NOW);
  assert.equal(follow('d2', b)!.event_key, null, 'a team you track yourself is never touched');
});

test('event alerts end silently when the series is won, the game is final, or the cap passes', () => {
  const card = S.gameCard('mlb', live.events[0])!;
  const ev = { ...card.event!, seriesKey: 'mlb:alert-series' };
  const a = card.home!.team.key;
  S.upsertGame({ ...card, key: 'mlb:alert-g1', state: 'in', event: { ...ev, wins: { home: 1, away: 1 } } });
  E.castVote('d1', 'mlb:alert-series', a, NOW);
  E.setAlert('d1', 'mlb:alert-series', true, NOW);
  assert.equal(follow('d1', a)!.event_key, 'mlb:alert-series');
  E.endEventAlerts(NOW);
  assert.ok(follow('d1', a), 'under way: kept');

  E.endEventAlerts(follow('d1', a)!.event_until!);
  assert.equal(follow('d1', a), undefined, 'past the cap: dropped');

  E.setAlert('d1', 'mlb:alert-series', true, NOW);
  S.upsertGame({ ...card, key: 'mlb:alert-g1', state: 'post', event: { ...ev, wins: { home: 4, away: 1 } } });
  E.endEventAlerts(NOW);
  const until = follow('d1', a)!.event_until!;
  assert.ok(until > NOW && until <= NOW + 3 * 3600_000, 'series won: kept for a few hours, so the deciding loss still sends');
  E.endEventAlerts(until);
  assert.equal(follow('d1', a), undefined, 'then dropped');
});

test('a one-off game\'s alerts apply to that game only', () => {
  const card = S.gameCard('mlb', live.events[0])!;
  const g = { ...card, key: 'nfl:superbowl', startsAt: NOW + 86400_000, state: 'pre' as const, event: { ...card.event!, seriesKey: undefined } };
  E.setUpcoming([g]);
  const a = g.home!.team.key;
  E.castVote('d1', g.key, a, NOW);
  E.setAlert('d1', g.key, true, NOW);
  assert.ok(follow('d1', a)!.event_until! <= g.startsAt + 12 * 3600_000);
  E.endEventAlerts(NOW);
  assert.ok(follow('d1', a), 'not started: kept');
  S.upsertGame({ ...g, state: 'post' });
  E.endEventAlerts(NOW);
  const until = follow('d1', a)!.event_until!;
  assert.ok(until <= NOW + 3 * 3600_000, 'final: a few hours left');
  E.endEventAlerts(until);
  assert.equal(follow('d1', a), undefined, 'then dropped');
});

test('each final of a series on the board is saved with its box score, served after the board forgets it, and dropped once the series is won and off the board', async () => {
  const card = S.gameCard('mlb', live.events[0])!;
  const ev = { ...card.event!, seriesKey: 'mlb:kept-series' };
  const batting = { name: 'batting', labels: ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K', '#P', 'AVG', 'OBP', 'SLG'], athletes: [{ athlete: { id: '1', shortName: 'A. Hitter' }, position: { abbreviation: 'RF' }, starter: true, stats: ['1-4', '4', '1', '1', '0', '0', '0', '1', '15', '.250', '.300', '.400'] }], totals: [] };
  const summary = { boxscore: { players: [card.home!, card.away!].map((s) => ({ team: { id: s.team.espnId }, statistics: [batting] })) } };
  const was = S.scoresDeps.getJson;
  S.scoresDeps.getJson = async () => summary;
  try {
    const g1 = { ...card, key: 'mlb:kept-1', id: 'kept-1', state: 'post' as const, startsAt: NOW - 2 * 86400_000, event: { ...ev, wins: { home: 1, away: 0 } } };
    S.upsertGame(g1);
    await E.keepSeriesGames(NOW);
    const saved = E.savedGame('mlb:kept-1');
    assert.ok(saved, 'the final is saved');
    assert.ok(saved.box, 'with its box score');
    assert.equal(E.savedGame('mlb:nope'), undefined);
    S.pruneGames('mlb', new Set(), NOW + 100 * 3600_000); // the board forgets it (and every other old card)
    assert.equal(S.getGame('mlb:kept-1'), undefined);
    await E.keepSeriesGames(NOW + 100 * 3600_000);
    assert.ok(E.savedGame('mlb:kept-1'), 'a series not yet won keeps its games with no card on the board');
    S.upsertGame({ ...g1, key: 'mlb:kept-4', id: 'kept-4', startsAt: NOW, event: { ...ev, wins: { home: 4, away: 0 } } });
    await E.keepSeriesGames(NOW);
    assert.ok(E.savedGame('mlb:kept-4'), 'the deciding game is saved while its card is on the board');
    await E.keepSeriesGames(NOW + 1000);
    assert.ok(E.savedGame('mlb:kept-1'), 'won, but the card is still on the board: kept');
    S.pruneGames('mlb', new Set(), NOW + 100 * 3600_000);
    await E.keepSeriesGames(NOW + 100 * 3600_000);
    assert.equal(E.savedGame('mlb:kept-1'), undefined, 'won and gone from the board: dropped');
    assert.equal(E.savedGame('mlb:kept-4'), undefined);
  } finally { S.scoresDeps.getJson = was; }
});

test('an earlier game of the ledger that the board already forgot is rebuilt from its day\'s scoreboard, saved with its box score, and not asked for again when ESPN lacks it', async () => {
  const board = S.gameCard('mlb', live.events[0])!;
  const sk = 'mlb:backfill-series';
  const old = { ...live.events[0], id: 'old-3', status: { type: { state: 'post', completed: true } } };
  const et = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t)).replaceAll('-', '');
  const games = [
    { n: 3, id: 'old-3', state: 'post' as const, startsAt: NOW - 3 * 86400_000 },
    { n: 2, id: 'gone-2', state: 'post' as const, startsAt: NOW - 4 * 86400_000 },
    { n: 5, id: board.id, state: 'post' as const, startsAt: NOW },
  ];
  S.upsertGame({ ...board, key: `mlb:${board.id}`, state: 'post', event: { ...board.event!, seriesKey: sk, games } });
  let reads = 0;
  const wasSeries = E.seriesDeps.getJson, wasScores = S.scoresDeps.getJson;
  E.seriesDeps.getJson = async (url: string) => { reads++; return { events: url.includes(`dates=${et(NOW - 3 * 86400_000)}`) ? [old] : [] }; };
  S.scoresDeps.getJson = async () => ({ boxscore: { players: [] } });
  try {
    await E.keepSeriesGames(NOW);
    assert.equal(E.savedGame('mlb:old-3')?.card.id, 'old-3', 'the forgotten game is saved');
    assert.ok(E.savedGame(`mlb:${board.id}`), 'and the one on the board');
    assert.equal(E.savedGame('mlb:gone-2'), undefined, 'ESPN has no scoreboard entry for it');
    const after = reads;
    await E.keepSeriesGames(NOW + 60_000);
    assert.equal(reads, after, 'a game ESPN lacked is not read again, and a saved one is not either');
  } finally { E.seriesDeps.getJson = wasSeries; S.scoresDeps.getJson = wasScores; }
});

test('an MLB regular-season series: the home team\'s run of games against one opponent, a rain-out left out, a doubleheader in', () => {
  const ev = (id: string, date: string, home: string, away: string, state: 'pre' | 'post', winner?: string, completed = state === 'post') => ({
    id, date,
    competitions: [{ status: { type: { state, completed } }, competitors: [home, away].map((t, i) => ({ id: t, homeAway: i ? 'away' : 'home', ...(state === 'post' && completed ? { winner: t === winner, score: { value: t === winner ? 5 : 2 } } : {}) })) }],
  });
  const res = { events: [
    ev('1', '2026-09-01T23:00Z', '30', '4', 'post', '30'), // an earlier series, other opponent
    ev('10', '2026-09-08T23:00Z', '5', '30', 'post', '5'),
    ev('11', '2026-09-09T23:00Z', '5', '30', 'post', '30', false), // rained out: not a game
    ev('12', '2026-09-10T17:00Z', '5', '30', 'post', '30'),
    ev('13', '2026-09-10T23:00Z', '5', '30', 'pre'), // makeup, a doubleheader's second game
    ev('14', '2026-09-15T23:00Z', '30', '5', 'pre'), // the return series, the other park
  ] };
  const s = E.regularSeries('mlb', res, '12')!;
  assert.deepEqual(s.games.map((g) => [g.n, g.id, g.state]), [[1, '10', 'post'], [2, '12', 'post'], [3, '13', 'pre']]);
  assert.equal(s.games[0].winner, 'team:mlb:5');
  assert.equal(s.key, 'mlb:20260908:30-5', 'the day of its first game and the two teams');
  assert.equal(E.regularSeries('mlb', res, '13')!.key, s.key, 'every game of the series files under one key');
  assert.equal(E.regularSeries('mlb', res, '14'), null, 'a lone game is no series');
  assert.equal(E.regularSeries('mlb', res, '999'), null);
});

test('a regular-season card on the board gets its series from the home team\'s schedule (real ESPN data), its final is saved, and the saved series goes 3 days after the last game', async () => {
  const card = S.gameCard('mlb', fx('mlb-chw-cle-20260915.json').events[0])!;
  assert.equal(card.event, undefined, 'ESPN gives a regular-season game no event');
  S.upsertGame(card);
  const T = card.startsAt + 4 * 3600_000;
  const urls: string[] = [];
  const wasSeries = E.seriesDeps.getJson, wasScores = S.scoresDeps.getJson;
  E.seriesDeps.getJson = async (url: string) => { urls.push(url); return url.includes('schedule') ? fx('mlb-cle-regular-schedule.json') : { events: [] }; };
  S.scoresDeps.getJson = async () => ({ boxscore: { players: [] } });
  const reads = () => urls.filter((u) => u.includes('seasontype=2')).length;
  try {
    await E.refreshSeries(T);
    assert.ok(urls.some((u) => u.includes('/teams/5/schedule') && u.includes('seasontype=2')), 'the home team\'s regular-season schedule is read');
    const { series } = S.getGame(card.key)!;
    assert.deepEqual(series!.games.map((g) => [g.n, g.id, g.state]), [[1, '401816934', 'post'], [2, '401816945', 'post'], [3, '401816960', 'post']]);
    assert.equal(series!.key, 'mlb:20260914:4-5');
    assert.ok(series!.games.every((g) => g.winner && g.score), 'ESPN\'s schedule gives each final its winner and score');
    assert.ok(E.savedGame(card.key), 'the final on the board is saved for its strip');
    const before = reads();
    await E.refreshSeries(T + 5 * 60_000);
    assert.equal(reads(), before, 'a finished series is read again only hours later, not every 2 minutes');
    S.pruneGames('mlb', new Set(), T + 100 * 3600_000); // the board forgets it
    await E.keepSeriesGames(card.startsAt + 2 * 86400_000);
    assert.ok(E.savedGame(card.key), 'kept until 3 days after the last game');
    await E.keepSeriesGames(card.startsAt + 4 * 86400_000);
    assert.equal(E.savedGame(card.key), undefined, 'then dropped');
  } finally { E.seriesDeps.getJson = wasSeries; S.scoresDeps.getJson = wasScores; }
});
