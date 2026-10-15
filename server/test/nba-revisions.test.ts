// Basketball plays ESPN changes after it posts them (revisions.ts, live.ts, detectors.ts), with the plays and wording of
// October 11 2026's three preseason games (Magic at Cavaliers, Bucks at Hornets, Bulls at Nuggets): ESPN posts a shot
// as "No Shot (Default Shot)" and types it minutes later, a free throw with no shooter or as "misses" before it flips to
// "makes", a block names the wrong shooter for 4 seconds, and a foul or shot is taken out and re-posted under a new id.
// A play is judged again on its latest version: a line (no push) on an alert it no longer has, the right player's alert,
// a re-post is one alert, a removed play is taken back, fouls are recounted. Also: a shot not yet typed is an unknown
// shot, a block never goes to the blocker, a lead changing hands again within 2 minutes is a line, and the
// preseason's standings table says nothing. From Cavaliers at Magic (October 13 2026): the free throw a technical
// gives is not a technical on its shooter, a traveling turnover is a turnover, a turnover moved to another player
// 20 minutes later is still corrected (basketball watches a play for 45 minutes), and a block that becomes a plain
// miss gets only "ESPN has since changed this: the shot was not blocked."
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
let NOW = Date.parse('2026-10-11T22:43:00Z');
Date.now = () => NOW;
const { db, kvGet } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { GameTracker, liveDeps, scanStandings, standingsSeasonType } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');
const D = await import('../src/detectors.ts');
const R = await import('../src/revisions.ts');

const CLE = '5', ORL = '19';
const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES (?, 'nba', ?, ?, ?, ?, ?, 'x', 500, 500, 0)`);
team.run(`team:nba:${CLE}`, CLE, 'Cleveland Cavaliers', 'Cavaliers', 'CLE', 'Cleveland');
team.run(`team:nba:${ORL}`, ORL, 'Orlando Magic', 'Magic', 'ORL', 'Orlando');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, position, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'nba', ?, ?, ?, 'G', 'x', 1, 1, 'headshot', 0)`);
const PEOPLE = { banchero: ['4432573', 'Paolo Banchero', ORL], bane: ['4066320', 'Desmond Bane', ORL], dasilva: ['4702382', 'Tristan da Silva', ORL], cain: ['4278572', 'Jamal Cain', ORL],
  harden: ['3992', 'James Harden', CLE], mobley: ['4432158', 'Evan Mobley', CLE], hezonja: ['3155526', 'Mario Hezonja', CLE] } as const;
for (const [id, name, teamId] of Object.values(PEOPLE)) player.run(`player:nba:${id}`, id, name, `team:nba:${teamId}`);
const GHOST = '999999'; // a player ESPN lists who isn't in the catalog
loadCatalog();

const pushes: { to: string }[] = [];
setPushSender((m) => pushes.push(...m));
const everything = { ...DEFAULT_PREFS, types: Object.fromEntries(EVENT_TYPES.map((t) => [t.id, true])), pushTypes: Object.fromEntries(EVENT_TYPES.map((t) => [t.id, true])) };
const device = (id: string, targets: string[], prefs: any = DEFAULT_PREFS) => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', `tok-${id}`, JSON.stringify(prefs));
  targets.forEach((t, i) => db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)').run(id, t, i + 1));
};
/** A device's feed: each alert's type, title and the lines on it. */
const feed = (id: string) => (db.prepare('SELECT e.type, e.title, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all(id) as any[])
  .map((r) => [r.type, r.title, r.extra ? JSON.parse(r.extra) : []]);
const pushed = (id: string) => pushes.filter((p) => p.to === `tok-${id}`).length;
const P = (who: keyof typeof PEOPLE) => `player:nba:${PEOPLE[who][0]}`;

/** A play as ESPN's core feed posts it. `parts`: [athlete id, role]. */
let seq = 0;
const core = (id: string, type: string, text: string, teamId: string | undefined, parts: [string, string][], x: Record<string, any> = {}) => ({
  id, type: { text: type }, text, ...(teamId ? { team: { $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/teams/${teamId}?lang=en&region=us` } } : {}),
  participants: parts.map(([a, role]) => ({ athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/athletes/${a}?lang=en&region=us` }, type: role })),
  awayScore: x.away ?? 0, homeScore: x.home ?? 0, scoringPlay: !!x.scoring, shootingPlay: !!x.shooting, scoreValue: x.value ?? 0,
  period: { number: x.period ?? 1 }, clock: { value: x.clock ?? 600 - seq++, displayValue: '10:00' }, wallclock: new Date(x.at ?? NOW).toISOString(),
  ...(x.coordinate ? { coordinate: x.coordinate, pointsAttempted: x.points } : {}),
});

/** A game read live: its core plays as `f.plays` says, polled every 5 seconds of the fake clock. */
function game(id: string) {
  const f = { plays: [] as any[] };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.corePlays('nba', id))) return { items: f.plays };
    if (url.startsWith(urls.summary('nba', id))) return {
      header: { competitions: [{ status: { type: { state: 'in', completed: false } }, competitors: [{ homeAway: 'home', id: CLE, score: '0' }, { homeAway: 'away', id: ORL, score: '0' }] }] }, plays: [],
    };
    throw new Error(`unexpected fetch ${url}`);
  };
  const tracker = new GameTracker('nba', id, CLE, ORL, { sawPre: true });
  const poll = async (n = 1) => { for (let i = 0; i < n; i++) { NOW += 5000; await tracker.poll(); } };
  const put = (p: any) => { const i = f.plays.findIndex((x) => x.id === p.id); if (i >= 0) f.plays[i] = p; else f.plays.push(p); };
  const take = (pid: string) => { f.plays = f.plays.filter((x) => x.id !== pid); };
  return { f, tracker, poll, put, take };
}
const missPlay = (id: string, who: keyof typeof PEOPLE, text: string, type = 'Jump Shot', x: Record<string, any> = {}) =>
  core(id, type, text, PEOPLE[who][2], [[PEOPLE[who][0], 'shooter']], { shooting: true, ...x });

// ─── The wording and the block ───

test('a shot ESPN has not typed yet is an unknown shot: its distance and "three", never "no shot (default shot)"', () => {
  const ctx: any = { league: 'nba', gameId: 'G', homeId: CLE, awayId: ORL, goalies: new Map() };
  const miss = (x: Record<string, any>, type = 'No Shot (Default Shot)', text = 'Donovan Mitchell misses shot') =>
    D.missedShot(ctx, D.fromCorePlay(core('m', type, text, CLE, [['3908809', 'shooter']], { shooting: true, ...x })), 'Donovan Mitchell');
  assert.equal(miss({ coordinate: { x: 25, y: 30 }, points: 3 }), 'Donovan Mitchell missed a 29-foot three');
  assert.equal(miss({ coordinate: { x: 25, y: 10 }, points: 2 }), 'Donovan Mitchell missed a 9-foot shot');
  assert.equal(miss({ coordinate: { x: 25, y: 4 }, points: 2 }), 'Donovan Mitchell missed a shot', 'inside 5 feet: no distance');
  assert.equal(miss({}), 'Donovan Mitchell missed a shot', 'nothing known');
  assert.equal(miss({}, 'No Shot (Default Shot)', 'Donovan Mitchell misses 24-foot three point jumper'), 'Donovan Mitchell missed a 24-foot three', 'ESPN\'s own distance and three');
  assert.equal(miss({}, 'Jump Shot', 'Donovan Mitchell misses 24-foot three point jumper'), 'Donovan Mitchell missed a 24-foot three', 'a typed shot reads as before');
  assert.equal(miss({}, 'Pullup Jump Shot', 'Donovan Mitchell misses 26-foot three point pullup jump shot'), 'Donovan Mitchell missed a 26-foot pull-up three');
  assert.equal(miss({ coordinate: { x: 25, y: 45 }, points: 3 }), null, 'a heave is still no alert');
});

test('a block goes to the shooter, never to the blocker: a shooter missing from the catalog gets nothing', () => {
  const ctx: any = { league: 'nba', gameId: 'G', homeId: CLE, awayId: ORL, goalies: new Map() };
  const block = (shooter: string) => D.PLAYER_DETECTORS.nba(ctx, D.fromCorePlay(core('b1', 'Layup Shot', 'Paolo Banchero blocks the shot', CLE, [[shooter, 'shooter'], [PEOPLE.banchero[0], 'blocker']], { shooting: true })));
  assert.deepEqual(block(PEOPLE.harden[0]).map((e) => [e.type, e.targetKey, e.title]), [['nba.got_blocked', P('harden'), 'James Harden got sent back ✋']]);
  assert.deepEqual(block(GHOST).filter((e) => e.targetKey === P('banchero')), [], 'Dallas at Houston: the blocker got "got sent back" when his shooter was not in the catalog');
  // Without ESPN's roles (the site feed's plays) and the shooter off the catalog: nothing, not the second player listed.
  const bare = D.fromCorePlay({ ...core('b2', 'Layup Shot', 'Paolo Banchero blocks the shot', CLE, [], { shooting: true }),
    participants: [{ athlete: { $ref: '.../athletes/999999?x' } }, { athlete: { $ref: '.../athletes/4432573?x' } }] });
  assert.deepEqual(D.PLAYER_DETECTORS.nba(ctx, bare), []);
});

// ─── A play judged again ───

test('a free throw posted with no shooter alerts nothing until ESPN names one, then it goes out', async () => {
  device('ft-dasilva', [P('dasilva')]);
  const x = game('G-FT1');
  await x.poll();
  x.put(core('ft1', 'Free Throw - 2 of 2', 'misses free throw 2 of 2', undefined, [], { shooting: true }));
  await x.poll();
  assert.deepEqual(feed('ft-dasilva'), [], 'no shooter: nothing');
  x.put(core('ft1', 'Free Throw - 2 of 2', 'Tristan da Silva misses free throw 2 of 2', ORL, [[PEOPLE.dasilva[0], 'shooter']], { shooting: true }));
  await x.poll();
  assert.deepEqual(feed('ft-dasilva'), [['nba.missed_free_throw', 'Tristan da Silva missed a free throw', []]]);
});

test('a free throw ESPN flips from "misses" to "makes": a line on the alert, no push, no second alert', async () => {
  device('ft-harden', [P('harden')], everything);
  const x = game('G-FT2');
  await x.poll();
  const base = pushed('ft-harden');
  x.put(core('ft2', 'Free Throw - 1 of 3', 'James Harden misses free throw 1 of 3', CLE, [[PEOPLE.harden[0], 'shooter']], { shooting: true }));
  await x.poll();
  assert.deepEqual(feed('ft-harden'), [['nba.missed_free_throw', 'James Harden missed a free throw', []]]);
  assert.equal(pushed('ft-harden'), base + 1);
  x.put(core('ft2', 'Free Throw - 1 of 3', 'James Harden makes free throw 1 of 3', CLE, [[PEOPLE.harden[0], 'shooter']], { shooting: true, scoring: true, value: 1, home: 1 }));
  await x.poll();
  assert.deepEqual(feed('ft-harden'), [['nba.missed_free_throw', 'James Harden missed a free throw', ['ESPN has since changed this: the free throw was made.']]]);
  assert.equal(pushed('ft-harden'), base + 1, 'the correction never pushes');
});

test('a shot first credited to Desmond Bane and typed later is Paolo Banchero\'s: Bane\'s alert gets a line, Banchero\'s goes out', async () => {
  device('shot-bane', [P('bane')], everything);
  device('shot-banchero', [P('banchero')], everything);
  const x = game('G-SHOT1');
  await x.poll();
  x.put(missPlay('s1', 'bane', 'Desmond Bane misses shot', 'No Shot (Default Shot)', { coordinate: { x: 25, y: 30 }, points: 3 }));
  await x.poll(3);
  assert.deepEqual(feed('shot-bane'), [], 'an untyped shot waits for its type');
  await x.poll();
  assert.deepEqual(feed('shot-bane'), [['nba.missed_shot', 'Desmond Bane missed a 29-foot three', []]], 'still untyped after 15 seconds: the unknown shot, worded as one');
  assert.deepEqual(feed('shot-banchero'), []);
  x.put(missPlay('s1', 'banchero', 'Paolo Banchero misses driving layup', 'Driving Layup Shot'));
  await x.poll();
  assert.deepEqual(feed('shot-bane'), [['nba.missed_shot', 'Desmond Bane missed a 29-foot three', ['ESPN has since credited this play to Paolo Banchero.']]]);
  assert.deepEqual(feed('shot-banchero'), [['nba.missed_shot', 'Paolo Banchero missed a driving layup', []]]);
});

test('a miss that was a block: a line on the "missed" alert, and the shooter\'s "got sent back" for a device that never had the first', async () => {
  device('blk-cain-all', [P('cain')], everything);
  device('blk-cain-default', [P('cain')]); // misses are off by default; blocks are on and pushed
  const x = game('G-BLK1');
  await x.poll();
  x.put(missPlay('c1', 'cain', 'Jamal Cain misses tip shot', 'Tip Shot'));
  await x.poll();
  assert.deepEqual(feed('blk-cain-default'), []);
  x.put(core('c1', 'Tip Shot', "Mario Hezonja blocks Jamal Cain's tip shot", ORL, [[PEOPLE.cain[0], 'shooter'], [PEOPLE.hezonja[0], 'blocker']], { shooting: true }));
  await x.poll();
  assert.deepEqual(feed('blk-cain-default'), [['nba.got_blocked', 'Jamal Cain got sent back ✋', []]]);
  assert.equal(pushed('blk-cain-default'), 1, '"got sent back" is pushed by default');
  const all = feed('blk-cain-all');
  assert.equal(all.length, 1, 'one alert for one play (the moment)');
  assert.ok(all[0][2].includes('ESPN has since changed this: the shot was blocked.'), all[0][2].join(' | '));
});

test('a play re-posted under a new id at the same moment is the same play: one alert, not two', async () => {
  device('repost-dasilva', [P('dasilva')], everything);
  const x = game('G-RP1');
  await x.poll();
  const foul = (id: string) => core(id, 'Shooting Foul', 'Tristan da Silva shooting foul', ORL, [[PEOPLE.dasilva[0], 'fouler']], { clock: 695 });
  x.put(foul('f1'));
  await x.poll();
  assert.equal(feed('repost-dasilva').length, 1);
  x.take('f1');
  x.put(foul('f1-again'));
  await x.poll();
  await x.poll(8);
  assert.deepEqual(feed('repost-dasilva'), [['nba.foul', 'Tristan da Silva committed a foul', []]], 'the same foul, once, with nothing to correct');
});

test('a play ESPN takes out for good: a line on its alert after 30 seconds, not before', async () => {
  device('gone-banchero', [P('banchero')], everything);
  const x = game('G-GONE1');
  await x.poll();
  x.put(missPlay('g1', 'banchero', 'Paolo Banchero misses 25-foot three point jumper'));
  x.put(core('g2', 'Defensive Rebound', 'Evan Mobley defensive rebound', CLE, [[PEOPLE.mobley[0], 'rebounder']])); // a read that has plays: an empty one is a failed read
  await x.poll();
  x.take('g1');
  await x.poll(3);
  assert.deepEqual(feed('gone-banchero')[0][2], [], 'one short read is nothing');
  await x.poll(5);
  assert.deepEqual(feed('gone-banchero')[0][2], ['ESPN has since taken this play out.']);
  assert.equal(feed('gone-banchero').length, 1);
});

test('a turnover ESPN makes a team turnover: a line on the player\'s alert', async () => {
  device('to-mobley', [P('mobley')], everything);
  const x = game('G-TO1');
  await x.poll();
  x.put(core('t1', 'No Turnover', 'Evan Mobley turnover', CLE, [[PEOPLE.mobley[0], 'offense']]));
  await x.poll();
  assert.equal(feed('to-mobley').length, 1);
  x.put(core('t1', '5-Second Inbound Turnover', '5 sec inbound turnover', CLE, []));
  await x.poll();
  assert.deepEqual(feed('to-mobley')[0][2], ['ESPN has since made this a team turnover.']);
});

// ─── Fouls are recounted with each version ───

test('fouling out: a foul ESPN re-posts is counted once, and a 6th foul named late is still the 6th', async () => {
  device('fo-dasilva', [P('dasilva')], everything);
  const x = game('G-FO1');
  await x.poll();
  const foul = (id: string, clock: number, named = true, text = 'Tristan da Silva personal foul') =>
    core(id, 'Personal Foul', text, ORL, named ? [[PEOPLE.dasilva[0], 'fouler']] : [], { clock });
  for (let i = 0; i < 5; i++) { x.put(foul(`pf${i}`, 600 - i * 60)); await x.poll(); }
  assert.equal(feed('fo-dasilva').filter((r) => r[0] === 'nba.foul').length, 5);
  // ESPN re-posts the 5th under a new id: still 5 fouls.
  x.take('pf4');
  x.put(foul('pf4-again', 600 - 4 * 60));
  await x.poll(2);
  // The 6th comes without its fouler, then with him.
  x.put(foul('pf5', 100, false, 'personal foul'));
  await x.poll();
  assert.deepEqual(feed('fo-dasilva').filter((r) => r[0] === 'nba.fouled_out'), []);
  x.put(foul('pf5', 100));
  await x.poll();
  assert.deepEqual(feed('fo-dasilva').filter((r) => r[0] === 'nba.fouled_out').map((r) => r[1]), ['Tristan da Silva fouled out']);
  assert.equal(feed('fo-dasilva').filter((r) => r[0] === 'nba.foul').length, 5, 'the 6th foul is fouled out, not a sixth "committed a foul"');
});

test('un-counting a foul: a foul and its turnover are one foul, and it stays counted while either play stands', () => {
  const g: any = { league: 'nba', gameId: 'G', homeId: CLE, awayId: ORL, goalies: new Map() };
  const foul = D.fromCorePlay(core('o1', 'Offensive Foul', 'Evan Mobley offensive foul', CLE, [[PEOPLE.mobley[0], 'fouler']], { clock: 300 }));
  const turnover = D.fromCorePlay(core('o2', 'Offensive Foul Turnover', 'Evan Mobley offensive foul turnover', CLE, [[PEOPLE.mobley[0], 'offense']], { clock: 300 }));
  D.observePlay(g, foul); D.observePlay(g, turnover);
  assert.equal(g.fouls[PEOPLE.mobley[0]], 1);
  D.unobservePlay(g, turnover);
  assert.equal(g.fouls[PEOPLE.mobley[0]], 1, 'the foul play still vouches for it');
  D.unobservePlay(g, foul);
  assert.equal(g.fouls[PEOPLE.mobley[0]], 0);
  D.unobservePlay(g, foul);
  assert.equal(g.fouls[PEOPLE.mobley[0]], 0, 'never below zero, nor twice');
});

test('samePlay for basketball: the same player and kind of play within 10 seconds of the clock', () => {
  const p = (type: string, who: string | undefined, clock: number, extra: Record<string, any> = {}) =>
    D.fromCorePlay(core('x', type, 'x', ORL, who ? [[who, 'shooter']] : [], { clock, shooting: /shot/i.test(type), ...extra }));
  assert.equal(R.samePlay(p('Jump Shot', '1', 684), p('Pullup Jump Shot', '1', 686), true), true, 'Banchero\'s three at 11:24 and 11:26');
  assert.equal(R.samePlay(p('Jump Shot', '1', 684), p('Jump Shot', '2', 684), true), false, 'another player');
  assert.equal(R.samePlay(p('Jump Shot', '1', 684), p('Jump Shot', '1', 660), true), false, '24 seconds apart');
  assert.equal(R.samePlay(p('Jump Shot', '1', 684), p('Shooting Foul', '1', 684), true), false, 'a shot and a foul by the same player');
  assert.equal(R.samePlay(p('Free Throw - 1 of 2', '1', 300), p('Free Throw - 2 of 2', '1', 300), true), false, 'free throws 1 and 2 are two plays');
  assert.equal(R.samePlay(p('Delay of Game', undefined, 300), p('Delay of Game', undefined, 298), true), true, 'no players: the same type');
});

// ─── A lead that keeps changing hands ───

test('falling behind again within 2 minutes is a line on the earlier alert; after 2 minutes it is an alert', async () => {
  device('lead-magic', [`team:nba:${ORL}`]);
  const x = game('G-LEAD1');
  await x.poll();
  const bucket = (id: string, who: 'home' | 'away', away: number, home: number, text: string) =>
    core(id, 'Layup Shot', text, who === 'home' ? CLE : ORL, [[who === 'home' ? PEOPLE.harden[0] : PEOPLE.banchero[0], 'shooter']], { shooting: true, scoring: true, value: 2, away, home });
  x.put(bucket('l1', 'home', 0, 2, 'James Harden makes layup'));      // Cavaliers lead: the Magic fall behind
  await x.poll();
  x.put(bucket('l2', 'away', 3, 2, 'Paolo Banchero makes three'));     // Magic lead
  await x.poll(4);
  x.put(bucket('l3', 'home', 3, 4, 'James Harden makes layup'));       // Cavaliers lead again, 30 seconds later
  await x.poll();
  const first = feed('lead-magic').filter((r) => r[0] === 'team.fell_behind');
  assert.equal(first.length, 1, 'one card');
  assert.deepEqual(first[0][2], ['Cavaliers took the lead again: ORL 3, CLE 4.']);
  x.put(bucket('l4', 'away', 5, 4, 'Paolo Banchero makes layup'));
  await x.poll(30);
  NOW += 3 * 60_000; // three minutes on
  x.put(bucket('l5', 'home', 5, 6, 'James Harden makes layup'));
  await x.poll();
  assert.equal(feed('lead-magic').filter((r) => r[0] === 'team.fell_behind').length, 2, 'a card of its own once 2 minutes have passed');
});

// ─── The preseason's standings ───

test('the preseason table says nothing: no drop, no clinch, no streak, and the season starting is a new baseline', async () => {
  device('pre-magic', [`team:nba:${ORL}`], everything);
  const entry = (id: string, seed: number, streak = '') => ({ team: { id }, stats: [{ name: 'playoffSeed', value: seed }, { name: 'clincher', displayValue: '' }, { name: 'streak', displayValue: streak }] });
  const table = (seasonType: number | undefined, magicSeed: number, streak = '') => ({ children: [{ abbreviation: 'East', standings: { ...(seasonType ? { seasonType } : {}), entries: [entry(CLE, 5 - (magicSeed > 4 ? 1 : 0)), entry(ORL, magicSeed, streak)] } }] });
  assert.equal(standingsSeasonType(table(1, 4)), 1);
  assert.equal(standingsSeasonType(table(undefined, 4)), undefined);
  const prev = liveDeps.getJson;
  try {
    liveDeps.getJson = async () => table(1, 4); await scanStandings('nba');          // the baseline, in the preseason
    liveDeps.getJson = async () => table(1, 10, 'L3'); await scanStandings('nba');   // a loss moves the preseason table
    assert.deepEqual(feed('pre-magic'), [], 'no drop and no losing streak in the preseason');
    assert.equal(kvGet('standings-season:nba'), 1);
    liveDeps.getJson = async () => table(2, 1); await scanStandings('nba');          // the regular season: a new table, a baseline
    liveDeps.getJson = async () => table(2, 3); await scanStandings('nba');          // and then a drop is news
    assert.deepEqual(feed('pre-magic').map((r) => r[0]), ['team.standings_drop']);
  } finally { liveDeps.getJson = prev; }
});

test('the regular season ending (the playoffs begin) is no baseline reset: a drop and an elimination in a type 3 table still alert', async () => {
  device('post-cavs', [`team:nba:${CLE}`], everything);
  const entry = (id: string, seed: number, clincher = '') => ({ team: { id }, stats: [{ name: 'playoffSeed', value: seed }, { name: 'clincher', displayValue: clincher }, { name: 'streak', displayValue: '' }] });
  const table = (seasonType: number, cleSeed: number, clincher = '') => ({ children: [{ abbreviation: 'East', standings: { seasonType, entries: [entry(ORL, 1), entry(CLE, cleSeed, clincher)] } }] });
  const prev = liveDeps.getJson;
  try {
    liveDeps.getJson = async () => table(2, 3); await scanStandings('nba');          // the regular season's last table: a baseline
    liveDeps.getJson = async () => table(3, 6, 'e'); await scanStandings('nba');     // the postseason's first: a drop, and out
  } finally { liveDeps.getJson = prev; }
  const rows = feed('post-cavs');
  assert.deepEqual(rows.map((r) => r[0]), ['team.eliminated'], 'the standings read shares one moment: the elimination, with the drop as a line');
  assert.ok(rows[0][2].some((l: string) => /^Down to/.test(l)), rows[0][2].join(' | '));
});

test('the preseason gate is for the sports whose type 1 is the preseason: the Premier League\'s regular season is type 1 and still drops', async () => {
  db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES ('team:epl:364', 'epl', '364', 'Liverpool', 'Liverpool', 'LIV', 'Liverpool', 'x', 1, 1, 0)`).run();
  loadCatalog();
  device('pre-liverpool', ['team:epl:364']);
  const table = (rank: number) => ({ children: [{ abbreviation: 'EPL', standings: { seasonType: 1, entries: [{ team: { id: '364' }, stats: [{ name: 'rank', value: rank }, { name: 'clincher', displayValue: '' }, { name: 'streak', displayValue: '' }] }] } }] });
  const prev = liveDeps.getJson;
  try {
    liveDeps.getJson = async () => table(2); await scanStandings('epl');
    liveDeps.getJson = async () => table(5); await scanStandings('epl');
  } finally { liveDeps.getJson = prev; }
  assert.deepEqual(feed('pre-liverpool').map((r) => [r[0], r[1]]), [['team.standings_drop', 'Liverpool dropped to 5th in the EPL']]);
});

// ─── Cavaliers at Magic, October 13 2026 ───

test('the free throw a technical gives is its shooter\'s: the call alerts the fouler, the made free throw alerts nobody, the missed one is a missed free throw', () => {
  const ctx: any = { league: 'nba', gameId: 'G', homeId: CLE, awayId: ORL, goalies: new Map() };
  const run = (p: any) => D.PLAYER_DETECTORS.nba(ctx, D.fromCorePlay(p)).map((e) => [e.type, e.title]);
  assert.deepEqual(run(core('t1', 'Technical Foul', 'Mario Hezonja technical foul', CLE, [[PEOPLE.hezonja[0], 'fouler']])), [['nba.technical', 'Mario Hezonja picked up a technical']]);
  assert.deepEqual(run(core('t2', 'Free Throw - Technical', 'Desmond Bane makes technical free throw', ORL, [[PEOPLE.bane[0], 'shooter']], { shooting: true, scoring: true, value: 1 })), [], 'Malaki Branham\'s free throw was pushed as "picked up a technical"');
  assert.deepEqual(run(core('t3', 'Free Throw - Technical', 'Desmond Bane misses technical free throw', ORL, [[PEOPLE.bane[0], 'shooter']], { shooting: true })), [['nba.missed_free_throw', 'Desmond Bane missed a free throw']]);
  assert.deepEqual(run(core('t4', 'Free Throw - Flagrant 1 of 2', 'Desmond Bane makes flagrant free throw 1 of 2', ORL, [[PEOPLE.bane[0], 'shooter']], { shooting: true, scoring: true, value: 1 })), []);
  assert.deepEqual(run(core('t5', 'Flagrant Foul Type 1', 'Mario Hezonja flagrant foul type 1', CLE, [[PEOPLE.hezonja[0], 'fouler']])), [['nba.technical', 'Mario Hezonja committed a flagrant foul']], 'the call itself still alerts, in its own words (CHI at MIL: "picked up a technical" over a body that said flagrant)');
});

test('a traveling turnover is a turnover: ESPN types it "Traveling", the text says turnover', () => {
  const ctx: any = { league: 'nba', gameId: 'G', homeId: CLE, awayId: ORL, goalies: new Map() };
  const run = (type: string, text: string) => D.PLAYER_DETECTORS.nba(ctx, D.fromCorePlay(core('v1', type, text, ORL, [[PEOPLE.cain[0], 'offense']]))).map((e) => e.title);
  assert.deepEqual(run('Traveling', 'Jamal Cain traveling turnover'), ['Jamal Cain turned it over']);
  assert.deepEqual(run('Bad Pass Turnover', 'Jamal Cain bad pass turnover (Evan Mobley steals)'), ['Jamal Cain turned it over'], 'a typed turnover as before');
  assert.deepEqual(run('Defensive Rebound', 'Jamal Cain defensive rebound'), [], 'a play that does not say turnover');
});

test('a turnover ESPN moves to another player 20 minutes later is corrected (basketball watches a play for 45 minutes); 46 minutes later it is not', async () => {
  device('late-harden', [P('harden')], everything);
  device('late-mobley', [P('mobley')], everything);
  const x = game('G-LATE1');
  await x.poll();
  const turnover = (id: string, who: keyof typeof PEOPLE, at: number) => core(id, 'Bad Pass Turnover', `${PEOPLE[who][1]} bad pass turnover (Desmond Bane steals)`, CLE, [[PEOPLE[who][0], 'offense']], { at });
  const at = NOW;
  x.put(turnover('to1', 'harden', at));
  await x.poll();
  assert.deepEqual(feed('late-harden'), [['nba.turnover', 'James Harden turned it over', []]]);
  NOW += 20 * 60_000;
  x.put(turnover('to1', 'mobley', at));
  await x.poll();
  assert.deepEqual(feed('late-harden'), [['nba.turnover', 'James Harden turned it over', ['ESPN has since credited this play to Evan Mobley.']]]);
  assert.deepEqual(feed('late-mobley'), [['nba.turnover', 'Evan Mobley turned it over', []]]);
  // Past the 45 minutes ESPN's change is not news: the alert stands as it was.
  const later = NOW;
  x.put(turnover('to2', 'harden', later));
  await x.poll();
  NOW += 46 * 60_000;
  x.put(turnover('to2', 'mobley', later));
  await x.poll();
  assert.deepEqual(feed('late-harden').map((r) => r[2]), [['ESPN has since credited this play to Evan Mobley.'], []], 'the second turnover has no line');
  assert.equal(feed('late-mobley').length, 1, 'and Mobley gets nothing for it');
});

test('a block ESPN re-posts as a plain miss: the line says the shot was not blocked, with no "missed" line; changed back, it says so', async () => {
  device('blk-bane', [P('bane')], everything);
  const x = game('G-BLK2');
  await x.poll();
  const block = core('k1', 'Layup Shot', "Evan Mobley blocks Desmond Bane's 3-foot shot", ORL, [[PEOPLE.bane[0], 'shooter'], [PEOPLE.mobley[0], 'blocker']], { shooting: true });
  x.put(block);
  await x.poll();
  assert.deepEqual(feed('blk-bane'), [['nba.got_blocked', 'Desmond Bane got sent back ✋', []]]);
  x.put(missPlay('k1', 'bane', 'Desmond Bane misses driving layup', 'Driving Layup Shot'));
  await x.poll();
  assert.deepEqual(feed('blk-bane'), [['nba.got_blocked', 'Desmond Bane got sent back ✋', ['ESPN has since changed this: the shot was not blocked, it was a missed driving layup.']]], 'one alert, one line, saying what the shot was (BKN at MIA)');
  x.put(block);
  await x.poll();
  assert.deepEqual(feed('blk-bane'), [['nba.got_blocked', 'Desmond Bane got sent back ✋', ['ESPN has since changed this: the shot was not blocked, it was a missed driving layup.', 'ESPN has since changed this play back.']]]);
});

// ─── From Trail Blazers at Kings (October 13 2026, preseason): the play types and wording are ESPN's, the players stand in ───

test('an offensive charge is a personal foul (Mogbo, 3Q 2:07): it alerts, counts toward fouling out, and is one foul with its turnover', async () => {
  const run = (type: string, text: string) => D.PLAYER_DETECTORS.nba({ league: 'nba', gameId: 'G', homeId: CLE, awayId: ORL, goalies: new Map() } as any, D.fromCorePlay(core('c0', type, text, CLE, [[PEOPLE.mobley[0], 'fouler']]))).map((e) => [e.type, e.title]);
  assert.deepEqual(run('Offensive Charge', 'Evan Mobley offensive charge'), [['nba.foul', 'Evan Mobley committed a foul']], 'it had been ignored: no "foul" in its type');
  assert.deepEqual(run('Offensive Foul', 'Evan Mobley offensive foul'), [['nba.foul', 'Evan Mobley committed a foul']], 'an offensive foul as before');
  device('chg-mobley', [P('mobley')], everything);
  const x = game('G-CHG1');
  await x.poll();
  for (let i = 1; i <= 5; i++) x.put(core(`pf${i}`, 'Personal Foul', 'Evan Mobley personal foul', CLE, [[PEOPLE.mobley[0], 'fouler']], { clock: 600 + i * 30 }));
  await x.poll();
  assert.equal(feed('chg-mobley').length, 5, 'five fouls, five alerts');
  // The charge is his 6th: fouled out (not "committed a foul"). The turnover ESPN logs for it at the same moment is a line on it, and not a 7th foul.
  x.put(core('ch1', 'Offensive Charge', 'Evan Mobley offensive charge', CLE, [[PEOPLE.mobley[0], 'fouler']], { clock: 127 }));
  x.put(core('ch2', 'Offensive Foul Turnover', 'Evan Mobley offensive foul turnover', CLE, [[PEOPLE.mobley[0], 'offense']], { clock: 127 }));
  await x.poll();
  assert.deepEqual(feed('chg-mobley').slice(5), [['nba.fouled_out', 'Evan Mobley fouled out', ['Evan Mobley turned it over.']]]);
});

test('a play ESPN posts minutes late alerts with the game\'s score now; one a few seconds out of order keeps its own', async () => {
  device('late-score', [P('harden')], everything);
  const x = game('G-LATE2');
  await x.poll();
  // The 4th quarter at 6:59 and 102-78 (ORL away, CLE home), then Harden's turnover from 10:27 (97-69), then another from 7:05.
  x.put(core('ls1', 'Jump Shot', 'Mario Hezonja makes 15-foot jumper', CLE, [[PEOPLE.hezonja[0], 'shooter']], { period: 4, clock: 419, home: 78, away: 102, scoring: true, shooting: true, value: 2 }));
  x.put(core('ls2', 'Lost Ball Turnover', 'James Harden lost ball turnover (Desmond Bane steals)', CLE, [[PEOPLE.harden[0], 'offense']], { period: 4, clock: 627, home: 69, away: 97 }));
  x.put(core('ls3', 'Bad Pass Turnover', 'James Harden bad pass turnover (Desmond Bane steals)', CLE, [[PEOPLE.harden[0], 'offense']], { period: 4, clock: 425, home: 77, away: 102 }));
  await x.poll();
  const bodies = (db.prepare('SELECT e.title, e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all('late-score') as any[]).map((r) => r.body);
  assert.deepEqual(bodies, ['James Harden lost ball turnover (Desmond Bane steals) — ORL 102, CLE 78', 'James Harden bad pass turnover (Desmond Bane steals) — ORL 102, CLE 77']);
});

test('a defensive 3-seconds call is "called for defensive 3 seconds", feed only, with ESPN\'s trailing space gone', async () => {
  device('d3s-mobley', [P('mobley')], everything);
  const x = game('G-D3S');
  await x.poll();
  const before = pushed('d3s-mobley');
  x.put(core('d3', 'Defensive 3-Seconds Technical', 'Evan Mobley defensive 3-seconds (technical foul) ', CLE, [[PEOPLE.mobley[0], 'fouler']], { home: 10, away: 21 }));
  x.put(core('t9', 'Technical Foul', 'Evan Mobley technical foul', CLE, [[PEOPLE.mobley[0], 'fouler']]));
  await x.poll();
  assert.deepEqual(feed('d3s-mobley').map((r) => r[1]), ['Evan Mobley was called for defensive 3 seconds', 'Evan Mobley picked up a technical']);
  const body = (db.prepare("SELECT e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'd3s-mobley' ORDER BY f.rowid").get() as any).body;
  assert.equal(body, 'Evan Mobley defensive 3-seconds (technical foul) — ORL 21, CLE 10');
  assert.equal(pushed('d3s-mobley') - before, 1, 'the other technical pushes; the defensive 3 seconds does not');
});

test('a missed shot ESPN describes differently later gets a line only when it contradicts the alert: a three that is not, or 2 feet out', async () => {
  device('shot-hezonja', [P('hezonja')], everything);
  const x = game('G-SHOT');
  await x.poll();
  const shot = (id: string, text: string, type: string) => missPlay(id, 'hezonja', text, type);
  x.put(shot('sh1', 'Mario Hezonja misses 26-foot three point jumper', 'Jump Shot'));
  x.put(shot('sh2', 'Mario Hezonja misses 9-foot two point shot', 'Fade Away Bank Jump Shot'));
  x.put(shot('sh3', 'Mario Hezonja misses 12-foot jumper', 'Jump Shot'));
  await x.poll();
  x.put(shot('sh1', 'Mario Hezonja misses two point shot', 'Driving Floating Bank Jump Shot'));
  x.put(shot('sh2', 'Mario Hezonja misses 10-foot two point shot', 'Turnaround Fade Away Jump Shot'));
  x.put(shot('sh3', 'Mario Hezonja misses 15-foot jumper', 'Jump Shot'));
  const before = pushed('shot-hezonja');
  await x.poll();
  assert.deepEqual(feed('shot-hezonja').map((r) => r[2]), [
    ['ESPN has since changed this: it was a driving bank floater.'], // a 26-foot three that ESPN now calls a two point shot
    [], // 9 feet became 10: ESPN's tidying
    ['ESPN has since changed this: it was a 15-foot jumper.'], // 12 feet became 15
  ]);
  assert.equal(pushed('shot-hezonja'), before, 'a line never pushes');
});

test('a shot ESPN rewrites twice: against the alert as sent, once per real change, and "changed back" when it fits again (Herro, Holiday)', async () => {
  device('rw-hezonja', [P('hezonja')], everything);
  device('rw-harden', [P('harden')], everything);
  const x = game('G-RW');
  await x.poll();
  const shot = (id: string, who: keyof typeof PEOPLE, text: string, type: string) => missPlay(id, who, text, type);
  const steps: [string, string][] = [['Mario Hezonja misses 26-foot three point jumper', 'Jump Shot'], ['Mario Hezonja misses 22-foot jumper', 'Jump Shot'], ['Mario Hezonja misses 27-foot three point jumper', 'Jump Shot']];
  const holiday: [string, string][] = [['James Harden misses 26-foot three point jumper', 'Jump Shot'], ['James Harden misses layup', 'Layup Shot'], ['James Harden misses two point shot', 'Driving Floating Bank Jump Shot']];
  for (let i = 0; i < 3; i++) {
    x.put(shot('rw1', 'hezonja', ...steps[i]));
    x.put(shot('rw2', 'harden', ...holiday[i]));
    await x.poll();
  }
  assert.deepEqual(feed('rw-hezonja'), [['nba.missed_shot', 'Mario Hezonja missed a 26-foot three', ['ESPN has since changed this: it was a 22-foot jumper.', 'ESPN has since changed this play back.']]],
    'ESPN ends within a foot of the alert: the second description is "changed back", not another claim');
  assert.deepEqual(feed('rw-harden'), [['nba.missed_shot', 'James Harden missed a 26-foot three', ['ESPN has since changed this: it was a layup.']]],
    'a layup that becomes a bank floater adds nothing: it does not contradict what the last line said');
});

test('a missed shot ESPN has not typed yet waits up to 15 seconds for its type, and a block is a block from the start (GS vs LAL, October 13 2026)', async () => {
  device('wait-hezonja', [P('hezonja')], everything);
  device('wait-cain', [P('cain')], everything);
  const x = game('G-WAIT');
  await x.poll();
  x.put(missPlay('w1', 'hezonja', 'Mario Hezonja misses shot', 'No Shot (Default Shot)'));
  x.put(missPlay('w2', 'cain', 'Jamal Cain misses shot', 'No Shot (Default Shot)'));
  await x.poll();
  x.put(missPlay('w1', 'hezonja', 'Mario Hezonja misses layup', 'Layup Shot'));
  x.put(core('w2', 'No Shot (Default Shot)', "Mario Hezonja blocks Jamal Cain's 7-foot shot", ORL, [[PEOPLE.cain[0], 'shooter'], [PEOPLE.hezonja[0], 'blocker']], { shooting: true }));
  await x.poll();
  assert.deepEqual(feed('wait-hezonja'), [['nba.missed_shot', 'Mario Hezonja missed a layup', []]], 'named by the time it was judged');
  assert.deepEqual(feed('wait-cain'), [['nba.got_blocked', 'Jamal Cain got sent back ✋', []]], 'no "missed a shot" first');
  assert.equal(pushed('wait-cain'), 1);
});

test('an offensive foul and its turnover are one alert, whichever play comes first, the other a line with no second push (GS vs LAL, October 13 2026)', async () => {
  device('off-mobley', [P('mobley')], everything);
  device('off-harden', [P('harden')], everything);
  const x = game('G-OFF');
  await x.poll();
  x.put(core('o1', 'Offensive Foul', 'Evan Mobley offensive foul', CLE, [[PEOPLE.mobley[0], 'fouler']], { period: 3, clock: 300 }));
  await x.poll();
  x.put(core('o2', 'Offensive Foul Turnover', 'Evan Mobley offensive foul turnover', CLE, [[PEOPLE.mobley[0], 'offense']], { period: 3, clock: 300 }));
  await x.poll();
  assert.deepEqual(feed('off-mobley'), [['nba.foul', 'Evan Mobley committed a foul', ['Evan Mobley turned it over.']]]);
  assert.equal(pushed('off-mobley'), 1);
  x.put(core('o3', 'Offensive Foul Turnover', 'James Harden offensive foul turnover', CLE, [[PEOPLE.harden[0], 'offense']], { period: 3, clock: 250 }));
  await x.poll();
  x.put(core('o4', 'Offensive Foul', 'James Harden offensive foul', CLE, [[PEOPLE.harden[0], 'fouler']], { period: 3, clock: 250 }));
  await x.poll();
  assert.deepEqual(feed('off-harden'), [['nba.turnover', 'James Harden turned it over', ['James Harden committed a foul.']]]);
});

// ─── NY at TOR, October 13 2026 ───

test('a block ESPN adds more than 2 minutes after the play is a feed row with no push that says where the play was; inside 2 minutes it pushes as before', async () => {
  device('late5-cain', [P('cain')]); // misses are off by default; "got sent back" is on and pushed
  const x = game('G-LATE5');
  await x.poll();
  const miss = (id: string, at: number) => missPlay(id, 'cain', 'Jamal Cain misses tip shot', 'Tip Shot', { at, period: 1, clock: 71 });
  const block = (id: string, at: number) => core(id, 'Tip Shot', "Mario Hezonja blocks Jamal Cain's tip shot", ORL, [[PEOPLE.cain[0], 'shooter'], [PEOPLE.hezonja[0], 'blocker']], { shooting: true, at, period: 1, clock: 71 });
  const body = (play: string) => (db.prepare(`SELECT body FROM events WHERE id LIKE ? AND type = 'nba.got_blocked'`).get(`G-LATE5:${play}:%`) as any)?.body as string;
  const early = NOW;
  x.put(miss('b1', early));
  await x.poll();
  NOW += 60_000;
  x.put(block('b1', early));
  await x.poll();
  assert.equal(pushed('late5-cain'), 1, 'a minute on: pushed');
  assert.ok(!/quarter/.test(body('b1')), body('b1'));
  const late = NOW;
  x.put(miss('b2', late));
  await x.poll();
  NOW += 12 * 60_000;
  x.put(block('b2', late));
  await x.poll();
  assert.equal(feed('late5-cain').length, 2);
  assert.equal(pushed('late5-cain'), 1, 'twelve minutes on: feed only');
  assert.ok(body('b2').startsWith('1st quarter, 1:11. Mario Hezonja blocks Jamal Cain'), body('b2'));
});

test('preseason: "their team lost" skips a followed player the box score does not list; the regular season sends it to everyone', async () => {
  device('tl-banchero', [P('banchero')]);
  device('tl-bane', [P('bane')]);
  const box = (type: number) => ({
    header: { season: { type } },
    boxscore: { players: [{ team: { id: ORL }, statistics: [{ athletes: [{ athlete: { id: PEOPLE.banchero[0] }, stats: ['12'] }, { athlete: { id: PEOPLE.dasilva[0] }, stats: [] }] }] }] },
  });
  const lost = (id: string, type: number) => { const t = game(id).tracker as any; t.box = box(type); t.finish({ home: 148, away: 98 }); };
  lost('G-TL1', 1);
  assert.deepEqual(feed('tl-banchero').map((r) => r[0]), ['player.team_lost'], 'he dressed');
  assert.deepEqual(feed('tl-bane'), [], 'Bane did not');
  lost('G-TL2', 2);
  assert.equal(feed('tl-bane').length, 1, 'regular season: played or not');
});

test('a play ESPN first posts more than 2 minutes after its own wall clock goes to the feed with no push; one a minute late still pushes', async () => {
  device('post-cain', [P('cain')]); // "got sent back" is on and pushed by default
  const x = game('G-POST');
  await x.poll();
  const block = (id: string, at: number) => core(id, 'Tip Shot', "Mario Hezonja blocks Jamal Cain's tip shot", ORL, [[PEOPLE.cain[0], 'shooter'], [PEOPLE.hezonja[0], 'blocker']], { shooting: true, at });
  x.put(block('p1', NOW - 60_000));
  await x.poll();
  assert.equal(pushed('post-cain'), 1, 'a minute late: pushed');
  x.put(block('p2', NOW - 3 * 60_000));
  await x.poll();
  assert.equal(feed('post-cain').length, 2, 'both are in the feed');
  assert.equal(pushed('post-cain'), 1, 'three minutes late: feed only');
});

test('a player fouling out is still pushed when ESPN names the fouler more than 5 minutes late', async () => {
  device('fo-late', [P('harden')]); // "fouls out" is pushed
  const x = game('G-FOLATE');
  await x.poll();
  const foul = (id: string, who: string | undefined, clock: number, at: number) => core(id, 'Personal Foul', `${who ? PEOPLE.harden[1] : ''} personal foul`.trim(), CLE, who ? [[who, 'fouler']] : [], { period: 2, clock, at });
  for (let i = 0; i < 5; i++) { x.put(foul(`fo${i}`, PEOPLE.harden[0], 500 - i * 30, NOW)); await x.poll(); }
  const at = NOW;
  x.put(foul('fo5', undefined, 100, at)); // the 6th, no fouler named yet
  await x.poll();
  NOW += 7 * 60_000;
  x.put(foul('fo5', PEOPLE.harden[0], 100, at));
  await x.poll();
  assert.ok(feed('fo-late').some((r) => r[0] === 'nba.fouled_out'), JSON.stringify(feed('fo-late')));
  assert.equal(pushed('fo-late'), 1, 'pushed, though the change came 7 minutes after the play');
});
