// Pacers at Thunder (preseason, October 13 2026): the findings of its post game recording report that were not built already
// (the charge, the traveling turnover and the block that becomes a miss were fixed by the CLE-ORL, POR-SAC and GS-LAL reports).
// F1 a basket ESPN posts with no scorer named, taken back 10 seconds later, was announced as a lead change: it waits for its
// scorer (20 seconds), and a named basket ESPN later takes back gets a line on its alerts. F3 a player the box score lists and no
// roster does (Rienk Mast, Keba Keita) is added to the catalog and kept by the next ingest. F5 a foul ESPN re-posts 11 seconds
// off its clock is the same foul. F7 "with 0.0 seconds left" on a shot ESPN has not typed is its first guess, so it is left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
let NOW = Date.parse('2026-10-14T02:30:00Z');
Date.now = () => NOW;
const { db, kvGet } = await import('../src/db.ts');
const { addBoxPlayers, catalog, keepBoxPlayers, loadCatalog, search } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');
const D = await import('../src/detectors.ts');
const R = await import('../src/revisions.ts');

const IND = '11', OKC = '25';
const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES (?, 'nba', ?, ?, ?, ?, ?, 'x', 500, 500, 0)`);
team.run(`team:nba:${IND}`, IND, 'Indiana Pacers', 'Pacers', 'IND', 'Indiana');
team.run(`team:nba:${OKC}`, OKC, 'Oklahoma City Thunder', 'Thunder', 'OKC', 'Oklahoma City');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, position, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'nba', ?, ?, ?, 'G', 'x', 1, 1, 'headshot', 0)`);
const PEOPLE = { haliburton: ['4396993', 'Tyrese Haliburton', IND], smith: ['5105854', 'Braden Smith', IND], sga: ['4278073', 'Shai Gilgeous-Alexander', OKC] } as const;
for (const [id, name, teamId] of Object.values(PEOPLE)) player.run(`player:nba:${id}`, id, name, `team:nba:${teamId}`);
loadCatalog();

setPushSender(() => {});
const device = (id: string, targets: string[]) => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', `tok-${id}`, JSON.stringify(DEFAULT_PREFS));
  targets.forEach((t, i) => db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)').run(id, t, i + 1));
};
/** A device's feed, without the game's start: each alert's title and the lines on it. */
const feed = (id: string) => (db.prepare(`SELECT e.title, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.type != 'team.game_start' ORDER BY f.rowid`).all(id) as any[])
  .map((r) => [r.title, r.extra ? JSON.parse(r.extra) : []]);

let seq = 0;
/** A play as ESPN's core feed posts it. `parts`: [athlete id, role]. */
const core = (id: string, type: string, text: string, teamId: string | undefined, parts: [string, string][], x: Record<string, any> = {}) => ({
  id, type: { text: type }, text, ...(teamId ? { team: { $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/teams/${teamId}?lang=en&region=us` } } : {}),
  participants: parts.map(([a, role]) => ({ athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/athletes/${a}?lang=en&region=us` }, type: role })),
  awayScore: x.away ?? 0, homeScore: x.home ?? 0, scoringPlay: !!x.scoring, shootingPlay: !!x.shooting, scoreValue: x.value ?? 0,
  period: { number: x.period ?? 1 }, clock: { value: x.clock ?? 600 - seq++, displayValue: '10:00' }, wallclock: new Date(x.at ?? NOW).toISOString(),
});

/** A game read live (IND away, OKC home): its core plays as `f.plays` says, polled every 5 seconds of the fake clock. */
function game(id: string, box: any[] = []) {
  const f = { plays: [] as any[], site: [] as any[], coreDown: false };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.corePlays('nba', id))) { if (f.coreDown) throw new Error('HTTP 503'); return { items: f.plays }; }
    if (url.startsWith(urls.summary('nba', id))) return {
      header: { competitions: [{ status: { type: { state: 'in', completed: false } }, competitors: [{ homeAway: 'home', id: OKC, score: '0' }, { homeAway: 'away', id: IND, score: '0' }] }] },
      plays: f.site, boxscore: { players: box },
    };
    throw new Error(`unexpected fetch ${url}`);
  };
  const tracker = new GameTracker('nba', id, OKC, IND, { sawPre: true });
  const poll = async (n = 1) => { for (let i = 0; i < n; i++) { NOW += 5000; await tracker.poll(); } };
  const put = (p: any) => { const i = f.plays.findIndex((x) => x.id === p.id); if (i >= 0) f.plays[i] = p; else f.plays.push(p); };
  return { f, poll, put };
}

// ─── F1: a basket with no scorer yet ───

test('F1: a basket posted with no scorer that ESPN makes a miss 10 seconds later is never announced as a lead change', async () => {
  device('okc-fan', [`team:nba:${OKC}`]);
  const g = game('G1');
  // The Thunder lead 102-100; ESPN posts a Pacers basket with no player (103-102), then takes it back as Braden Smith's miss.
  g.put(core('p1', 'Layup Shot', 'Shai Gilgeous-Alexander makes layup', OKC, [[PEOPLE.sga[0], 'shooter']], { scoring: true, shooting: true, home: 102, away: 100, value: 2, period: 5 }));
  g.put(core('p2', 'No Shot (Default Shot)', 'makes 24-foot shot', IND, [], { scoring: true, shooting: true, home: 102, away: 105, value: 3, period: 5 }));
  await g.poll(2);
  assert.deepEqual(feed('okc-fan').map((r) => r[0]), [], 'the basket waits for its scorer');
  g.put(core('p2', 'No Shot (Default Shot)', 'Braden Smith misses shot', IND, [[PEOPLE.smith[0], 'shooter']], { shooting: true, home: 102, away: 100, period: 5 }));
  await g.poll(8);
  assert.deepEqual(feed('okc-fan').map((r) => r[0]), [], 'a miss is no lead change');
});

test('F1: a basket ESPN names within 20 seconds is announced once it is named; one it never names is announced after 20 seconds', async () => {
  device('okc-fan-2', [`team:nba:${OKC}`]);
  const g = game('G2');
  g.put(core('q1', 'Layup Shot', 'Shai Gilgeous-Alexander makes layup', OKC, [[PEOPLE.sga[0], 'shooter']], { scoring: true, shooting: true, home: 2, away: 0, value: 2 }));
  g.put(core('q2', 'No Shot (Default Shot)', 'makes 24-foot shot', IND, [], { scoring: true, shooting: true, home: 2, away: 3, value: 3 }));
  await g.poll(2);
  assert.deepEqual(feed('okc-fan-2').map((r) => r[0]), []);
  g.put(core('q2', 'Jump Shot', 'Braden Smith makes 24-foot three point jumper', IND, [[PEOPLE.smith[0], 'shooter']], { scoring: true, shooting: true, home: 2, away: 3, value: 3 }));
  await g.poll();
  assert.deepEqual(feed('okc-fan-2').map((r) => r[0]), ['Pacers scored 3 to take the lead over the Thunder']);

  device('okc-fan-3', [`team:nba:${OKC}`]);
  const h = game('G3');
  h.put(core('r1', 'Layup Shot', 'Shai Gilgeous-Alexander makes layup', OKC, [[PEOPLE.sga[0], 'shooter']], { scoring: true, shooting: true, home: 2, away: 0, value: 2 }));
  h.put(core('r2', 'No Shot (Default Shot)', 'makes 24-foot shot', IND, [], { scoring: true, shooting: true, home: 2, away: 3, value: 3 }));
  await h.poll(2);
  assert.deepEqual(feed('okc-fan-3').map((r) => r[0]), [], 'held');
  await h.poll(5);
  assert.deepEqual(feed('okc-fan-3').map((r) => r[0]).slice(-1), ['Pacers scored 3 to take the lead over the Thunder'], 'not held for ever');
});

test('F1: a named basket ESPN takes back later puts a line on its alerts', async () => {
  device('okc-fan-4', [`team:nba:${OKC}`]);
  const g = game('G4');
  g.put(core('s1', 'Layup Shot', 'Shai Gilgeous-Alexander makes layup', OKC, [[PEOPLE.sga[0], 'shooter']], { scoring: true, shooting: true, home: 2, away: 0, value: 2 }));
  g.put(core('s2', 'Jump Shot', 'Tyrese Haliburton makes 24-foot three point jumper', IND, [[PEOPLE.haliburton[0], 'shooter']], { scoring: true, shooting: true, home: 2, away: 3, value: 3 }));
  await g.poll(2);
  assert.deepEqual(feed('okc-fan-4').map((r) => r[0]), ['Pacers scored 3 to take the lead over the Thunder']);
  g.put(core('s2', 'Jump Shot', 'Tyrese Haliburton misses 24-foot three point jumper', IND, [[PEOPLE.haliburton[0], 'shooter']], { shooting: true, home: 2, away: 0 }));
  await g.poll();
  assert.deepEqual(feed('okc-fan-4')[0], ['Pacers scored 3 to take the lead over the Thunder', ['ESPN has since changed this: the shot did not go in.']]);
});

test('F1: a core read that fails while the summary lags behind puts no line on an alert', async () => {
  device('okc-fan-5', [`team:nba:${OKC}`]);
  const g = game('G6');
  const site = (id: string, type: string, text: string, teamId: string, who: string, x: Record<string, any>) =>
    ({ ...core(id, type, text, undefined, [], x), team: { id: teamId }, participants: [{ athlete: { id: who } }] });
  const plays = [
    ['t1', 'Layup Shot', 'Shai Gilgeous-Alexander makes layup', OKC, PEOPLE.sga[0], { scoring: true, shooting: true, home: 2, away: 0, value: 2 }],
    ['t2', 'Jump Shot', 'Tyrese Haliburton makes 24-foot three point jumper', IND, PEOPLE.haliburton[0], { scoring: true, shooting: true, home: 2, away: 3, value: 3 }],
  ] as const;
  for (const [id, type, text, teamId, who, x] of plays) { g.put(core(id, type, text, teamId, [[who, 'shooter']], x)); g.f.site.push(site(id, type, text, teamId, who, x)); }
  await g.poll(2);
  assert.deepEqual(feed('okc-fan-5'), [['Pacers scored 3 to take the lead over the Thunder', []]]);
  g.f.coreDown = true; // ESPN's core feed fails (a 503) and the summary has not got the Pacers' basket yet
  g.f.site = g.f.site.slice(0, 1);
  await g.poll(2);
  g.f.coreDown = false;
  await g.poll(2);
  assert.deepEqual(feed('okc-fan-5'), [['Pacers scored 3 to take the lead over the Thunder', []]], 'no line, no second alert');
});

// ─── F3: a player the box score lists and no roster does ───

const mast = { id: '4592677', displayName: 'Rienk Mast', shortName: 'R. Mast', jersey: '51', position: { abbreviation: 'NA' } };

test('F3: a box score player the catalog lacks is added on his team, searchable, and listed on its roster', async () => {
  assert.equal(catalog.playerByEspn('nba', mast.id), undefined);
  const added = await addBoxPlayers('nba', IND, [mast, { id: PEOPLE.haliburton[0], displayName: 'Tyrese Haliburton' }], async () => ({ width: 600, height: 436 }));
  assert.deepEqual(added.map((p) => p.name), ['Rienk Mast'], 'a player already in the catalog is left alone');
  const p = catalog.playerByEspn('nba', mast.id)!;
  assert.deepEqual([p.teamKey, p.jersey, p.position, p.imageKind, p.image], ['team:nba:11', '51', null, 'headshot', urls.headshot('nba', mast.id)]);
  assert.ok(catalog.roster('team:nba:11').some((x) => x.espnId === mast.id));
  assert.deepEqual(search('rienk mast').map((r: any) => r.key), ['player:nba:4592677']);
  assert.ok(db.prepare('SELECT 1 FROM players WHERE key = ?').get('player:nba:4592677'));
  assert.equal(Object.keys(kvGet<any>('catalog:box-added')).join(), 'player:nba:4592677', 'kept for the next ingest');
  assert.deepEqual(await addBoxPlayers('nba', IND, [mast], async () => null), [], 'once');
});

test('F3: a player with no ESPN photo gets his team logo, and an unknown team adds nobody', async () => {
  const added = await addBoxPlayers('nba', OKC, [{ id: '5105647', displayName: 'Keba Keita', shortName: 'K. Keita', jersey: '13', position: { abbreviation: 'C' } }], async () => null);
  assert.deepEqual([added[0].imageKind, added[0].image, added[0].imageW, added[0].position], ['team_logo', 'x', 500, 'C']);
  assert.deepEqual(await addBoxPlayers('nba', '9999', [{ id: '1', displayName: 'Nobody' }], async () => null), []);
});

test('F3: the tracker adds the box score players the catalog lacks, once', async () => {
  globalThis.fetch = async () => new Response('', { status: 404 }); // ESPN has no photo: the team logo
  const box = [{ team: { id: IND }, statistics: [{ athletes: [{ athlete: { id: '5242424', displayName: 'Pat Camp', shortName: 'P. Camp', jersey: '77', position: { abbreviation: 'NA' } } }] }] }];
  const g = game('G5', box);
  await g.poll(2);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(catalog.playerByEspn('nba', '5242424')?.name, 'Pat Camp');
  assert.equal(catalog.playerByEspn('nba', '5242424')?.imageKind, 'team_logo');
});

// ─── F5: a foul ESPN re-posts off its clock ───

test('F5: a foul re-posted 11 seconds off its clock is the same foul; a shot that far off is another', () => {
  const play = (type: string, text: string, clock: number, shooting = false) => D.fromCorePlay(core('x', type, text, IND, [[PEOPLE.haliburton[0], 'fouler']], { clock, period: 3, shooting }));
  assert.equal(R.samePlay(play('Shooting Foul', 'Jay Huff shooting foul', 495), play('Personal Foul', 'Jay Huff personal foul', 506), true), true);
  assert.equal(R.samePlay(play('Shooting Foul', 'Jay Huff shooting foul', 495), play('Personal Foul', 'Jay Huff personal foul', 511), true), false, 'over 15 seconds');
  assert.equal(R.samePlay(play('Jump Shot', 'Jay Huff misses jumper', 495, true), play('Jump Shot', 'Jay Huff misses jumper', 506, true), true), false, 'a shot: 10 seconds');
});

// ─── F7: the clock of a shot ESPN has not typed ───

test('F7: "with 0.0 seconds left" is left off a shot ESPN has not typed; a typed shot at 0.0 keeps it', () => {
  const ctx: any = { league: 'nba', gameId: 'G', homeId: OKC, awayId: IND, goalies: new Map() };
  const miss = (type: string, text: string, clock: number) =>
    D.missedShot(ctx, D.fromCorePlay(core('m', type, text, IND, [[PEOPLE.smith[0], 'shooter']], { shooting: true, clock, period: 4, home: 100, away: 100 })), 'Keba Keita');
  assert.equal(miss('No Shot (Default Shot)', 'Keba Keita misses shot', 0), 'Keba Keita missed a shot');
  assert.equal(miss('No Shot (Default Shot)', 'Keba Keita misses shot', 2), 'Keba Keita missed a shot for the lead with 2 seconds left');
  assert.equal(miss('Layup Shot', 'Keba Keita misses layup', 0), 'Keba Keita missed a layup for the lead with 0.0 seconds left');
});

// ─── F3: what the next ingest keeps ───

test('F3: the ingest keeps a box score player until a roster lists him, his team goes, or 30 days pass', () => {
  const p = (key: string, teamKey: string) => ({ key, teamKey }) as any;
  const day = 86400_000, now = Date.parse('2026-11-20T00:00:00Z');
  const kept = { a: { p: p('player:nba:1', 'team:nba:11'), at: now - day }, b: { p: p('player:nba:2', 'team:nba:11'), at: now - day },
    c: { p: p('player:nba:3', 'team:nba:99'), at: now - day }, d: { p: p('player:nba:4', 'team:nba:11'), at: now - 31 * day } };
  const out = keepBoxPlayers(kept, [p('player:nba:2', 'team:nba:11')], new Set(['team:nba:11']), now);
  assert.deepEqual(out.map((x: any) => x.key), ['player:nba:1'], 'kept; one a roster lists, one on a team that is gone and one older than 30 days are not');
  assert.deepEqual(Object.keys(kept), ['a', 'b', 'c'], 'the expired is forgotten');
});
