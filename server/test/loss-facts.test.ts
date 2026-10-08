// A loss's facts (a walk-off, losing as the favorite, a shutout, a sweep…) and how they reach a device:
// one alert per loss, with each fact it wants as a line, never a second alert. The games are real ones
// (ids, scores, lines, records and go-ahead plays as ESPN has them).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db, kvSet, kvGet } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, addSocket, setPushSender, feedItem } = await import('../src/fanout.ts');
const { RECIPIENTS, hateWatchTally } = await import('../src/hate-watches.ts');
const { gameLostEvent, lossFacts, seriesSpot } = await import('../src/detectors.ts');
const { GameTracker, liveDeps, scanStandings } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, short, abbr] of [
  ['mlb', '22', 'Philadelphia Phillies', 'Phillies', 'PHI'], ['mlb', '20', 'Washington Nationals', 'Nationals', 'WSH'],
  ['mlb', '26', 'San Francisco Giants', 'Giants', 'SF'], ['mlb', '19', 'Los Angeles Dodgers', 'Dodgers', 'LAD'], ['mlb', '15', 'Atlanta Braves', 'Braves', 'ATL'],
  ['nba', '3', 'New Orleans Pelicans', 'Pelicans', 'NO'], ['nba', '10', 'Houston Rockets', 'Rockets', 'HOU'],
  ['nba', '19', 'Orlando Magic', 'Magic', 'ORL'], ['nba', '22', 'Portland Trail Blazers', 'Trail Blazers', 'POR'],
  ['nhl', '14', 'Ottawa Senators', 'Senators', 'OTT'], ['nhl', '3', 'Calgary Flames', 'Flames', 'CGY'],
  ['nfl', '1', 'Atlanta Falcons', 'Falcons', 'ATL'], ['nfl', '18', 'New Orleans Saints', 'Saints', 'NO'],
  ['epl', '360', 'Manchester United', 'Man United', 'MAN'], ['epl', '379', 'Burnley', 'Burnley', 'BUR'],
]) team.run(`team:${lg}:${id}`, lg, id, name, short, abbr);
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`)
  .run('player:mlb:39832', '39832', 'Shohei Ohtani', 'team:mlb:19');
loadCatalog();

/** A scoring play, as the game tracker has it (NPlay). */
const scored = (id: string, x: { home: number; away: number; period?: { type: string; number: number }; periodNum?: number; clockSec?: number; clock?: string; text?: string }) =>
  ({ id, type: 'Play', typeSlug: 'play-result', text: x.text ?? '', participants: [], scoring: true, scoreValue: 0, at: 0, shooting: false, ...x });
const facts = (lg: string, gameId: string, homeId: string, awayId: string, final: { home: number; away: number }, f: Parameters<typeof lossFacts>[3]) => {
  const g = { league: lg as any, gameId, homeId, awayId };
  return lossFacts(g, gameLostEvent(g, final, 0)!, final, f).map((e) => [e.type, e.title, e.fold]);
};

test('a walk-off, after blowing a 4-run lead (Nationals @ Phillies, April 1: Crawford singles in the 10th)', () => {
  assert.deepEqual(facts('mlb', '401814769', '22', '20', { home: 6, away: 5 }, {
    plays: [
      scored('a', { away: 4, home: 0, period: { type: 'Top', number: 2 } }), scored('b', { away: 4, home: 4, period: { type: 'Bottom', number: 6 } }),
      scored('c', { away: 5, home: 4, period: { type: 'Top', number: 10 } }), scored('d', { away: 5, home: 5, period: { type: 'Bottom', number: 10 } }),
      scored('4018147691902990057', { away: 5, home: 6, period: { type: 'Bottom', number: 10 }, text: 'Crawford singled to right, Marsh scored, Realmuto to second.' }),
    ],
    pre: { chance: { home: 71, away: 29 }, records: { home: '2-3', away: '3-2' } },
  }), [
    ['team.last_second_loss', 'Successful Hate Watch! Phillies walked off the Nationals in the 10th', 'Walk-off loss in the 10th.'],
    ['team.blew_lead', 'Successful Hate Watch! Nationals blew a 4-run lead and lost to the Phillies', 'Blew a 4-run lead.'],
  ], 'underdogs (29%), and too early in the season for the records to say anything');
});

test('blew a 25-point lead as 77% favorites, to the 5-22 Pelicans (Rockets @ Pelicans, December 18, in overtime)', () => {
  assert.deepEqual(facts('nba', '401810230', '3', '10', { home: 133, away: 128 }, {
    plays: [
      scored('x', { home: 10, away: 35, periodNum: 2, clockSec: 300 }), scored('y', { home: 120, away: 120, periodNum: 4, clockSec: 0.5 }),
      scored('401810230769', { home: 125, away: 123, periodNum: 5, clockSec: 123, text: 'Saddiq Bey makes 22-foot step back jumpshot (Jose Alvarado assists)' }),
    ],
    pre: { chance: { home: 23, away: 77 }, records: { home: '5-22', away: '16-7' }, streak: { away: 'W2' } },
  }), [
    ['team.blew_lead', 'Successful Hate Watch! Rockets blew a 25-point lead and lost to the Pelicans', 'Blew a 25-point lead.'],
    ['team.lost_as_favorite', 'Successful Hate Watch! Rockets lost to the Pelicans as 77% favorites', 'Lost as 77% favorites.'],
    ['team.lost_to_worse', 'Successful Hate Watch! Rockets lost to the 5-22 Pelicans', 'Lost to the 5-22 Pelicans.'],
  ], 'the go-ahead had 2:03 left in overtime: not the last seconds');
});

test('the last seconds: a buzzer-beater, a shootout, a stoppage-time winner', () => {
  // Trail Blazers @ Magic, November 10: Desmond Bane's three with 0.0 left.
  assert.deepEqual(facts('nba', '401810055', '19', '22', { home: 115, away: 112 }, {
    plays: [scored('t', { home: 112, away: 112, periodNum: 4, clockSec: 5 }), scored('401810055759', { home: 115, away: 112, periodNum: 4, clockSec: 0 })],
  }), [['team.last_second_loss', 'Successful Hate Watch! Magic beat the Trail Blazers at the buzzer', 'Beaten at the buzzer.']]);
  assert.deepEqual(facts('nba', 'G', '19', '22', { home: 115, away: 112 }, {
    plays: [scored('t', { home: 112, away: 112, periodNum: 4, clockSec: 9 }), scored('u', { home: 115, away: 112, periodNum: 4, clockSec: 2.1 })],
  }), [['team.last_second_loss', 'Successful Hate Watch! Magic beat the Trail Blazers with 2.1 seconds left', 'Beaten with 2.1 seconds left.']]);
  // Flames @ Senators, October 30: "Final/SO".
  assert.deepEqual(facts('nhl', '401802519', '14', '3', { home: 4, away: 3 }, { overtime: 'so', pre: { records: { home: '5-5-1', away: '2-8-1' } } }),
    [['team.last_second_loss', 'Successful Hate Watch! Flames lost to the Senators in a shootout', 'Lost in a shootout.']], 'a shootout loss is an OT loss: their record doesn\'t drop');
  // Burnley @ Man United, August 30: Bruno Fernandes' penalty at 90\'+7\'.
  assert.deepEqual(facts('epl', '740621', '360', '379', { home: 3, away: 2 }, {
    plays: [scored('1', { home: 1, away: 0, clock: "22'" }), scored('2', { home: 1, away: 1, clock: "55'" }), scored('3', { home: 2, away: 1, clock: "70'" }), scored('4', { home: 2, away: 2, clock: "90'+1'" }),
      scored('45794245', { home: 3, away: 2, clock: "90'+7'", text: "90'+7' Bruno Fernandes (Manchester United) converts the penalty" })],
  }), [['team.last_second_loss', 'Successful Hate Watch! Burnley conceded a stoppage-time winner to Man United', "Conceded a stoppage-time winner (90'+7')."]]);
  // A field goal as time expires: the NFL in the last 30 seconds.
  assert.deepEqual(facts('nfl', 'N', '1', '18', { home: 13, away: 10 }, { plays: [scored('k', { home: 10, away: 10, periodNum: 4, clockSec: 300 }), scored('fg', { home: 13, away: 10, periodNum: 4, clockSec: 0 })] }),
    [['team.last_second_loss', 'Successful Hate Watch! Falcons beat the Saints as time expired', 'Beaten as time expired.']]);
  assert.deepEqual(facts('nfl', 'N', '1', '18', { home: 13, away: 10 }, { plays: [scored('k', { home: 10, away: 10, periodNum: 4, clockSec: 300 }), scored('fg', { home: 13, away: 10, periodNum: 4, clockSec: 24 })] }).map(([, , f]) => f),
    ['Beaten with 0:24 left.']);
});

const LAD_AT_SF = {
  plays: [scored('4018150541304990057', { home: 3, away: 0, period: { type: 'Bottom', number: 7 }, text: 'Bailey homered to left center (407 feet), Lee scored and Ramos scored.' })],
  pre: { chance: { home: 36, away: 64 }, records: { home: '10-13', away: '16-7' }, streak: { away: 'L4' }, seasonType: 2 },
};
test('64% favorites, shut out by a worse team, a fifth straight loss (Dodgers @ Giants, April 22); the playoffs skip the regular-season facts', () => {
  assert.deepEqual(facts('mlb', '401815054', '26', '19', { home: 3, away: 0 }, LAD_AT_SF), [
    ['team.lost_as_favorite', 'Successful Hate Watch! Dodgers lost to the Giants as 64% favorites', 'Lost as 64% favorites.'],
    ['team.shut_out', 'Successful Hate Watch! Dodgers were shut out by the Giants', 'Shut out.'],
    ['team.lost_to_worse', 'Successful Hate Watch! Dodgers lost to the 10-13 Giants', 'Lost to the 10-13 Giants.'],
    ['team.losing_streak', 'Successful Hate Watch! Dodgers have lost 5 straight', 'Lost 5 straight.'],
  ]);
  // The playoffs skip the regular-season facts, the streak too: the standings still show the regular
  // season's last one (a team that ended it on L4 and won two playoff games is on no losing streak).
  assert.deepEqual(facts('mlb', '401815054', '26', '19', { home: 3, away: 0 }, { ...LAD_AT_SF, postseason: true }).map(([t]) => t),
    ['team.lost_as_favorite', 'team.shut_out']);
  assert.deepEqual(facts('mlb', '401815054', '26', '19', { home: 3, away: 0 }, { ...LAD_AT_SF, pre: { ...LAD_AT_SF.pre, seasonType: 1 } }).map(([t]) => t).includes('team.losing_streak'), false, 'the preseason');
  assert.deepEqual(facts('mlb', '401815054', '26', '19', { home: 3, away: 0 }, { ...LAD_AT_SF, pre: { ...LAD_AT_SF.pre, records: { ...LAD_AT_SF.pre.records, away: '2-1' } } }).map(([t]) => t).includes('team.losing_streak'), false,
    "an L4 with one loss on the record: last season's streak");
});

test('below .500 (in the NHL only a regulation loss counts), and sweeps from the schedule', () => {
  assert.deepEqual(facts('mlb', 'B', '26', '19', { home: 3, away: 2 }, { pre: { records: { away: '20-20' } } }),
    [['team.below_500', 'Successful Hate Watch! Dodgers lost to the Giants and fell below .500', 'Now 20-21, below .500.']]);
  assert.deepEqual(facts('nhl', 'H', '14', '3', { home: 3, away: 2 }, { pre: { records: { away: '10-10-3' } } }).map(([, , f]) => f), ['Now 10-11-3, below .500.']);
  assert.deepEqual(facts('nhl', 'H', '14', '3', { home: 3, away: 2 }, { overtime: 'ot', pre: { records: { away: '10-10-3' } } }).map(([t]) => t), ['team.last_second_loss']);
  assert.deepEqual(facts('mlb', 'B', '26', '19', { home: 3, away: 2 }, { pre: { records: { away: '5-5' } } }), [], 'ten games in: too early');

  // ESPN's schedule shape: the games before this one against the same team, and who's next.
  const game = (id: string, opp: string, won?: boolean) => ({ id, date: `2026-05-0${id}T23:05Z`, competitions: [{ status: { type: { completed: won !== undefined } },
    competitors: [{ id: '19', winner: won === true }, { id: opp, winner: won === false }] }] });
  const sched = { events: [game('1', '15', true), game('2', '26', false), game('3', '26', false), game('4', '26'), game('5', '15')] };
  const spot = seriesSpot('mlb', sched, '4', '19');
  assert.deepEqual(spot, { kind: 'series', before: 2, lostBefore: 2, last: true });
  assert.deepEqual(facts('mlb', '4', '26', '19', { home: 5, away: 1 }, { pre: { series: { away: spot } } }),
    [['team.swept', 'Successful Hate Watch! Dodgers got swept by the Giants', 'Swept in the series, 0-3.']]);
  assert.equal(seriesSpot('mlb', { events: [game('3', '26', false), game('4', '26'), game('5', '26')] }, '4', '19')!.last, false, 'one more game in the series');
  const two = seriesSpot('mlb', { events: [game('3', '26', false), game('4', '26'), game('5', '15')] }, '4', '19');
  assert.deepEqual(facts('mlb', '4', '26', '19', { home: 5, away: 1 }, { pre: { series: { away: two } } }), [], 'a two-game series is no sweep');
  // NFL division rivals meet twice: that's a season sweep.
  const nfl = seriesSpot('nfl', { events: [game('1', '1', false), game('2', '7', true), game('3', '1')].map((e) => ({ ...e, competitions: [{ ...e.competitions[0], competitors: e.competitions[0].competitors.map((c) => ({ ...c, id: c.id === '19' ? '18' : c.id })) }] })) }, '3', '18');
  assert.deepEqual(nfl, { kind: 'season', before: 1, lostBefore: 1, last: true });
  assert.deepEqual(facts('nfl', '3', '1', '18', { home: 20, away: 10 }, { pre: { series: { away: nfl } } }).map(([, , f]) => f), ['Swept in the season series, 0-2.']);
});

// ─── How the facts reach each device ─────────────────────────────────────────────────────────────
const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)');
const FANS: [string, string[], object][] = [
  ['dodgers-fan', ['team:mlb:19'], {}],
  ['ohtani-fan', ['player:mlb:39832'], {}],
  ['both', ['team:mlb:19', 'player:mlb:39832'], {}],
  ['loss-off', ['team:mlb:19'], { types: { 'team.lost': false } }],
  ['some-facts-off', ['team:mlb:19'], { types: { 'team.lost_as_favorite': false, 'team.shut_out': false } }],
  ['quiet-loss', ['team:mlb:19'], { pushTypes: { 'team.lost': false } }],
  ['all-quiet', ['team:mlb:19'], { pushTypes: { 'team.lost': false, 'team.lost_as_favorite': false, 'team.shut_out': false, 'team.lost_to_worse': false } }],
  ['streaker', ['team:mlb:19'], {}],
  ['joined-late', ['team:mlb:19'], {}],
  ['streak-off', ['team:mlb:19'], { types: { 'team.losing_streak': false } }],
];
for (const [id, keys, prefs] of FANS) {
  device.run(id, 's', 'ios', `ExponentPushToken[${id}]`, JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  for (const k of keys) follow.run(id, k, 0);
}
// The four losses before this one: the streaker and streak-off watched all of them, joined-late the last two.
const old = db.prepare(`INSERT INTO events (id, type, league, game_id, target_key, title, body, occurred_at, detected_at, meta) VALUES (?, 'team.lost', 'mlb', ?, 'team:mlb:19', 'x', 'x', ?, ?, '{}')`);
const watched = db.prepare(`INSERT INTO hate_watches (device_id, event_id, target_key, occurred_at) VALUES (?, ?, 'team:mlb:19', ?)`);
for (const n of [1, 2, 3, 4]) {
  old.run(`old${n}`, `old${n}`, n * 1000, n * 1000);
  for (const dev of ['streaker', 'streak-off', ...(n >= 3 ? ['joined-late'] : [])]) watched.run(dev, `old${n}`, n * 1000);
}
const frames = new Map<string, any[]>();
for (const [id] of FANS) addSocket(id, { on() {}, send: (f: string) => frames.set(id, [...(frames.get(id) ?? []), JSON.parse(f)]) } as any);
const pushes: { to: string; title: string; body: string }[] = [];
setPushSender((msgs) => pushes.push(...msgs));
const feed = (dev: string) => (db.prepare(`SELECT e.*, f.extra, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(dev) as any[]).map(feedItem);

test('one alert per device for the loss, with the facts it wants as lines (Dodgers @ Giants)', () => {
  const tracker = new GameTracker('mlb', '401815054', '26', '19');
  Object.assign(tracker as any, { plays: LAD_AT_SF.plays, pre: LAD_AT_SF.pre });
  tracker.finish({ home: 3, away: 0 });
  const got = (dev: string) => feed(dev).map((i) => `${i.type}: ${i.title} | ${i.body}`);
  const lost = 'team.lost: Successful Hate Watch! Dodgers lost to the Giants';
  assert.deepEqual(got('dodgers-fan'), [`${lost} | Lost as 64% favorites. Shut out. Lost to the 10-13 Giants. Lost 5 straight. Final Score: 3 to 0`]);
  assert.deepEqual(got('ohtani-fan'), ['player.team_lost: Successful Hate Watch! Shohei Ohtani and the Dodgers lost to the Giants | Final Score: 3 to 0'],
    'a player\'s fan gets "their team lost", as before: the facts are team alerts');
  assert.deepEqual(got('both'), got('dodgers-fan'), 'the team and its player: the team\'s alert, once');
  assert.deepEqual(got('loss-off'), ['team.lost_as_favorite: Successful Hate Watch! Dodgers lost to the Giants as 64% favorites | Shut out. Lost to the 10-13 Giants. Lost 5 straight. Final Score: 3 to 0'],
    '"Loses a game" off: the first fact they want is the alert, saying the loss too');
  assert.deepEqual(got('some-facts-off'), [`${lost} | Lost to the 10-13 Giants. Lost 5 straight. Final Score: 3 to 0`]);
  assert.deepEqual(got('streaker'), [`${lost} | Lost as 64% favorites. Shut out. Lost to the 10-13 Giants. Lost 5 straight, every one on your Hate Watch. Final Score: 3 to 0`],
    'the team\'s streak and theirs: one line');
  assert.deepEqual(got('joined-late'), [`${lost} | Lost as 64% favorites. Shut out. Lost to the 10-13 Giants. Lost 5 straight, 3 on your Hate Watch. Final Score: 3 to 0`]);
  assert.deepEqual(got('streak-off'), [`${lost} | Lost as 64% favorites. Shut out. Lost to the 10-13 Giants. Your Hate Watch streak: 5 straight losses. Final Score: 3 to 0`],
    'the team streak off, theirs on');

  // One push each, with the lines. The loss's own bell off still pushes when a fact on it pushes.
  const to = (dev: string) => pushes.filter((p) => p.to === `ExponentPushToken[${dev}]`);
  for (const [dev] of FANS.filter(([d]) => d !== 'all-quiet')) assert.equal(to(dev).length, 1, dev);
  assert.equal(to('quiet-loss')[0].body, 'Lost as 64% favorites. Shut out. Lost to the 10-13 Giants. Lost 5 straight. Final Score: 3 to 0');
  assert.equal(to('all-quiet').length, 0, 'everything on it feed-only: no push');
  assert.equal(feed('all-quiet').length, 1);

  // Live frames carry the device's lines; the count of fellow hate watchers counts every one of them.
  assert.equal(frames.get('dodgers-fan')!.find((f) => f.kind === 'event').item.body, feed('dodgers-fan')[0].body);
  for (const [dev] of FANS) assert.equal(feed(dev)[0].alsoGot, FANS.length - 1, dev);
  assert.equal(hateWatchTally('loss-off').total, 1, 'still a Successful Hate Watch');
});

test('NHL overtime from the periods played, when the final comes without "Final/OT": no false "below .500"', () => {
  device.run('flames-fan', 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
  follow.run('flames-fan', 'team:nhl:3', 0);
  const tracker = new GameTracker('nhl', 'OT1', '14', '3');
  Object.assign(tracker as any, { plays: [scored('g1', { home: 1, away: 1, periodNum: 2 }), scored('g2', { home: 2, away: 1, periodNum: 4 })], pre: { records: { away: '10-10-3' }, seasonType: 2 } });
  tracker.finish({ home: 2, away: 1 });
  assert.deepEqual(feed('flames-fan').map((i) => i.body), ['Lost in overtime. Final Score: 2 to 1']);
});

test("with the loss off, a blown lead is only a line: on the first fact they want, or nothing", () => {
  device.run('rockets-loss-off', 's', 'ios', null, JSON.stringify({ ...DEFAULT_PREFS, types: { 'team.lost': false } }));
  device.run('rockets-blew-only', 's', 'ios', null, JSON.stringify({ ...DEFAULT_PREFS, types: { 'team.lost': false, 'team.lost_as_favorite': false, 'team.lost_to_worse': false } }));
  for (const d of ['rockets-loss-off', 'rockets-blew-only']) follow.run(d, 'team:nba:10', 0);
  const tracker = new GameTracker('nba', '401810230', '3', '10');
  Object.assign(tracker as any, { plays: [scored('x', { home: 10, away: 35, periodNum: 2 }), scored('401810230769', { home: 125, away: 123, periodNum: 5, clockSec: 123 })],
    pre: { chance: { home: 23, away: 77 }, records: { home: '5-22', away: '16-7' }, seasonType: 2 } });
  tracker.finish({ home: 133, away: 128 });
  assert.deepEqual(feed('rockets-loss-off').map((i) => `${i.title} | ${i.body}`),
    ['Successful Hate Watch! Rockets lost to the Pelicans as 77% favorites | Blew a 25-point lead. Lost to the 5-22 Pelicans. Final Score: 133 to 128']);
  assert.deepEqual(feed('rockets-blew-only'), [], 'nothing else they want about it: no alert for the loss they turned off');
});

test('whoever had the loss off gets its new facts off too, once (in Settings, or for one team)', async () => {
  const { lossFactsFollowLoss, LOSS_FACT_TYPES, getPrefs } = await import('../src/fanout.ts');
  device.run('old-loss-off', 's', 'ios', null, JSON.stringify({ ...DEFAULT_PREFS, types: { 'team.lost': false } }));
  device.run('old-off-for-one', 's', 'ios', null, JSON.stringify({ ...DEFAULT_PREFS, targetTypes: { 'team:mlb:19': { 'team.lost': false } } }));
  device.run('old-loss-on', 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
  db.prepare("DELETE FROM kv WHERE key = 'prefs:loss-facts'").run();
  lossFactsFollowLoss();
  const off = Object.fromEntries(LOSS_FACT_TYPES.map((t) => [t, false]));
  assert.deepEqual(getPrefs('old-loss-off').types, { ...off, 'team.lost': false });
  assert.deepEqual(getPrefs('old-off-for-one').targetTypes, { 'team:mlb:19': { ...off, 'team.lost': false } });
  assert.deepEqual(getPrefs('old-loss-on').types, {});
  db.prepare('UPDATE devices SET prefs = ? WHERE id = ?').run(JSON.stringify({ ...DEFAULT_PREFS, types: { 'team.lost': false } }), 'old-loss-on');
  lossFactsFollowLoss();
  assert.equal(getPrefs('old-loss-on').types['team.shut_out'], undefined, 'once: a loss turned off later keeps its facts, which Settings lists');
});

test("the standings' losing streak isn't said again after the loss said it", async () => {
  assert.equal(kvGet('streak-told:mlb:19'), 'L5');
  const table = (streak: string, rank: number) => ({ children: [{ abbreviation: 'NL', standings: { entries: [
    { team: { id: '19' }, stats: [{ name: 'playoffSeed', value: rank }, { name: 'streak', displayValue: streak }, { name: 'clincher', displayValue: '' }] },
  ] } }] });
  kvSet('standings:mlb', Object.fromEntries([['19', { rank: 3, group: 'NL', clincher: '', streak: 'L4' }]]));
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string) => (url.startsWith(urls.standings('mlb')) ? table('L5', 3) : prev(url));
  await scanStandings('mlb');
  assert.equal(feed('dodgers-fan').length, 1, 'no second "lost 5 straight"');
  // A streak the loss didn't say (a game we missed, say) still comes from the standings.
  liveDeps.getJson = async (url: string) => (url.startsWith(urls.standings('mlb')) ? table('L6', 3) : prev(url));
  await scanStandings('mlb');
  liveDeps.getJson = prev;
  assert.deepEqual(feed('dodgers-fan').slice(1).map((i) => i.title), ['Dodgers have lost 6 straight']);
});
