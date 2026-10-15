// Basketball plays ESPN posts twice, moves or retypes (the seven NBA games of October 14 2026: Bulls at Bucks, Hornets at Celtics,
// Nets at Heat, Suns at Spurs, Pistons at Timberwolves, Pelicans at Mavericks, Nuggets at Clippers). A copy of a turnover or foul
// still in the feed is counted, not alerted (twin), and the entry moves to it when ESPN deletes its own; a re-post is judged against
// every earlier version, so a turnover credited to someone else for a while still matches; a foul and the turnover for it share a
// moment and one foul; a play first seen long after it happened is held a few minutes; a turnover typed later takes the typed words;
// a block credited to another player, a flagrant foul and a made shot that flips back to a miss each get their own wording; a late change is late from the play's first wall clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_GHOST_AGE_MS = '60000'; // the ghost hold, shortened for the tests: a play first seen 1 minute late is held 30 seconds
process.env.HW_GHOST_HOLD_MS = '30000';
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


/** The body an alert's feed row shows. */
const bodyOf = (id: string) => (db.prepare('SELECT e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all(id) as any[]).map((r) => r.body as string);
const turnover = (id: string, who: keyof typeof PEOPLE, clock: number, x: Record<string, any> = {}) =>
  core(id, x.type ?? 'Lost Ball Turnover', x.text ?? `${PEOPLE[who][1]} lost ball turnover`, PEOPLE[who][2], [[PEOPLE[who][0], 'turnover']], { clock, ...x });
const foul = (id: string, who: keyof typeof PEOPLE, clock: number, type = 'Personal Foul', x: Record<string, any> = {}) =>
  core(id, type, `${PEOPLE[who][1]} ${type.toLowerCase()}`, PEOPLE[who][2], [[PEOPLE[who][0], 'fouler']], { clock, period: 4, ...x });
const fouls = (x: ReturnType<typeof game>, who: keyof typeof PEOPLE) => (x.tracker as any).ctx.fouls?.[PEOPLE[who][0]] ?? 0;

// ─── The same play twice ───

test('a turnover ESPN posts twice at once is one alert, and the copy takes over when ESPN deletes the first, with no "taken out" line', async () => {
  device('tw-mobley', [P('mobley')], everything);
  const x = game('G-TW1');
  await x.poll();
  x.put(core('reb', 'Defensive Rebound', 'Evan Mobley defensive rebound', CLE, [[PEOPLE.mobley[0], 'rebounder']])); // a read with no plays is a failed read
  x.put(turnover('a1', 'mobley', 572));
  await x.poll();
  x.put(turnover('a2', 'mobley', 572));
  await x.poll();
  assert.equal(feed('tw-mobley').length, 1, 'the copy makes no alert');
  x.take('a1');
  await x.poll(8); // longer than GONE_MS
  assert.deepEqual(feed('tw-mobley').map((r) => [r[0], r[2]]), [['nba.turnover', []]], 'the copy is the play now: nothing was taken back');
  x.take('a2');
  await x.poll(8);
  assert.deepEqual(feed('tw-mobley')[0][2], ['ESPN has since taken this play out.'], 'a play ESPN removes for good still is');
});

test('a personal foul ESPN then calls a shooting foul is one foul, one alert; two fouls on different seconds, or a foul and a technical, are two', async () => {
  device('tw-cain', [P('cain')], everything);
  const x = game('G-TW2');
  await x.poll();
  x.put(foul('f1', 'cain', 400));
  await x.poll();
  x.put(foul('f2', 'cain', 400, 'Shooting Foul'));
  await x.poll();
  assert.equal(feed('tw-cain').length, 1);
  assert.equal(fouls(x, 'cain'), 1, 'counted once');
  x.put(foul('f3', 'cain', 300));
  await x.poll();
  assert.equal(feed('tw-cain').length, 2, 'another second: another foul');
  x.put(core('f4', 'Technical Foul', 'Jamal Cain technical foul', ORL, [[PEOPLE.cain[0], 'fouler']], { clock: 300, period: 4 }));
  await x.poll();
  assert.deepEqual(feed('tw-cain').map((r) => r[0]), ['nba.foul', 'nba.foul', 'nba.technical'], 'a technical at the same second is not a copy');
});

test('a fifth foul posted twice does not foul the player out', async () => {
  device('fo-dasilva', [P('dasilva')]);
  const x = game('G-TW3');
  await x.poll();
  for (let i = 0; i < 4; i++) { x.put(foul(`d${i}`, 'dasilva', 500 - i * 60)); await x.poll(); }
  x.put(foul('d4', 'dasilva', 200));
  await x.poll();
  x.put(foul('d5', 'dasilva', 200, 'Shooting Foul'));
  await x.poll();
  assert.equal(fouls(x, 'dasilva'), 5);
  assert.ok(!feed('fo-dasilva').some((r) => r[0] === 'nba.fouled_out'));
});

test('a personal foul and the offensive foul turnover ESPN adds for it are one alert with a line, and one foul', async () => {
  device('of-banchero', [P('banchero')], everything);
  const x = game('G-OF');
  await x.poll();
  x.put(foul('o1', 'banchero', 562));
  await x.poll();
  x.put(core('o2', 'Offensive Foul Turnover', 'Paolo Banchero offensive foul turnover', ORL, [[PEOPLE.banchero[0], 'turnover']], { clock: 562, period: 4 }));
  await x.poll();
  const rows = feed('of-banchero');
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0][0], 'nba.foul');
  assert.ok(rows[0][2].some((l: string) => /turned it over/.test(l)), JSON.stringify(rows[0][2]));
  assert.equal(fouls(x, 'banchero'), 1);
});

test('a re-post is matched to an earlier version of the play, not only the last: a turnover credited to someone else for a while', async () => {
  device('ea-hezonja', [P('hezonja')], everything);
  device('ea-cain', [P('cain')], everything);
  const x = game('G-EA');
  await x.poll();
  x.put(turnover('e1', 'hezonja', 572));
  await x.poll();
  x.put(turnover('e1', 'cain', 572));
  await x.poll();
  x.take('e1');
  await x.poll(8);
  x.put(turnover('e2', 'hezonja', 572));
  await x.poll();
  assert.equal(feed('ea-hezonja').length, 1, JSON.stringify(feed('ea-hezonja')));
  assert.equal(feed('ea-cain').length, 1);
});

// ─── The words of a revision ───

test('a turnover ESPN posted untyped takes the typed words on its row, with no push and no line', async () => {
  device('rt-hezonja', [P('hezonja')], everything);
  const x = game('G-RT');
  await x.poll();
  x.put(turnover('r1', 'hezonja', 572, { type: 'No Turnover', text: 'Mario Hezonja turnover Jamal Cain' }));
  await x.poll();
  const base = pushed('rt-hezonja');
  assert.ok(!/Cain/.test(bodyOf('rt-hezonja')[0]), 'the guessed name is cut');
  x.put(turnover('r1', 'hezonja', 572, { type: 'Bad Pass Turnover', text: 'Mario Hezonja bad pass (Jamal Cain steals)' }));
  await x.poll();
  assert.match(bodyOf('rt-hezonja')[0], /bad pass \(Jamal Cain steals\)/);
  assert.deepEqual(feed('rt-hezonja')[0][2], []);
  assert.equal(pushed('rt-hezonja'), base);
});

test('ESPN crediting a block to another player is a line on the shooter\'s alert, and a flagrant foul is its own words', async () => {
  device('bl-cain', [P('cain')]);
  device('fl-hezonja', [P('hezonja')], everything);
  const x = game('G-BL');
  await x.poll();
  const block = (who: string) => core('b1', 'Tip Shot', `${who} blocks Jamal Cain's tip shot`, ORL, [[PEOPLE.cain[0], 'shooter'], [PEOPLE.hezonja[0], 'blocker']], { shooting: true });
  x.put(block('Mario Hezonja'));
  await x.poll();
  x.put(block('Evan Mobley'));
  await x.poll();
  assert.deepEqual(feed('bl-cain').map((r) => r[2]), [['ESPN has since credited the block to Evan Mobley.']]);
  x.put(foul('fl1', 'hezonja', 300));
  await x.poll();
  x.put(foul('fl1', 'hezonja', 300, 'Flagrant Foul Type 1'));
  await x.poll();
  // The retyped play is the same stop (one moment), so the flagrant foul is a line on the foul alert; a device with only technicals on gets it as its alert.
  assert.deepEqual(feed('fl-hezonja').map((r) => [r[0], r[1], r[2]]), [
    ['nba.foul', 'Mario Hezonja committed a foul', ['ESPN has since called this a flagrant foul.', 'Mario Hezonja committed a flagrant foul.']],
  ]);
});

test('a made shot that ESPN flips to a miss is in the feed without a push', async () => {
  device('mm-cain', [P('cain')], everything);
  const x = game('G-MM');
  await x.poll();
  const base = pushed('mm-cain');
  x.put(missPlay('m1', 'cain', 'Jamal Cain makes layup', 'Layup Shot', { scoring: true, value: 2, home: 0, away: 2 }));
  await x.poll();
  x.put(missPlay('m1', 'cain', 'Jamal Cain misses layup', 'Layup Shot'));
  await x.poll();
  assert.ok(feed('mm-cain').some((r) => r[0] === 'nba.missed_shot'), JSON.stringify(feed('mm-cain')));
  assert.equal(pushed('mm-cain'), base);
});

// ─── A play first seen long after it happened ───

test('a play first seen more than a minute after its wall clock waits 30 seconds: one ESPN deletes in that time is never judged', async () => {
  device('gh-hezonja', [P('hezonja')], everything);
  const x = game('G-GH');
  await x.poll();
  x.put(turnover('g1', 'hezonja', 572, { at: NOW - 5 * 60_000 }));
  x.put(turnover('g2', 'hezonja', 400, { at: NOW - 5 * 60_000 }));
  await x.poll(2);
  assert.deepEqual(feed('gh-hezonja'), [], 'held');
  x.take('g1'); // a ghost
  await x.poll(8);
  assert.deepEqual(feed('gh-hezonja').map((r) => r[0]), ['nba.turnover'], 'g2 stood 30 seconds and was judged; g1 never was');
});

// ─── A late change is late from the play's first read, not from a wall clock ESPN rewrites ───

test('a free throw named 70 seconds after it was posted still pushes when ESPN also moves its wall clock back; one named 3 minutes later is feed only', async () => {
  device('lt-cain', [P('cain')], everything);
  device('lt-hezonja', [P('hezonja')], everything);
  const x = game('G-LT');
  await x.poll();
  const freeThrow = (id: string, who: keyof typeof PEOPLE, at: number, named: boolean) => core(id, 'Free Throw - 1 of 2', named ? `${PEOPLE[who][1]} misses free throw 1 of 2` : 'misses free throw 1 of 2',
    named ? PEOPLE[who][2] : undefined, named ? [[PEOPLE[who][0], 'shooter']] : [], { shooting: true, at, clock: 300, period: 4 });
  const posted = NOW - 20_000;
  x.put(freeThrow('ft-c', 'cain', posted, false));
  x.put(freeThrow('ft-h', 'hezonja', posted, false));
  await x.poll(); // first read: no shooter, so nothing yet
  const [c0, h0] = [pushed('lt-cain'), pushed('lt-hezonja')];
  await x.poll(13); // 65 seconds
  x.put(freeThrow('ft-c', 'cain', NOW - 5 * 60_000, true)); // named, and the wall clock moved 4 minutes back (AJ Johnson, NO at DAL)
  await x.poll();
  assert.deepEqual(feed('lt-cain').map((r) => [r[0], r[1]]), [['nba.missed_free_throw', 'Jamal Cain missed a free throw']]);
  assert.equal(pushed('lt-cain'), c0 + 1, 'about a minute after it was first read: a push');
  assert.ok(!bodyOf('lt-cain')[0].startsWith('4th quarter'), bodyOf('lt-cain')[0]);
  await x.poll(20); // 3 minutes since the first read
  x.put(freeThrow('ft-h', 'hezonja', posted, true));
  await x.poll();
  assert.equal(feed('lt-hezonja').length, 1);
  assert.equal(pushed('lt-hezonja'), h0, 'named more than 2 minutes after the play: feed only');
  assert.match(bodyOf('lt-hezonja')[0], /^4th quarter, /);
});
