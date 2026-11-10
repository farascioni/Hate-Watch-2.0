// Tracking officials (docs/officials.md): a referee or umpire is a target of its own, `official:<league>:<slug>`, and the alerts
// are the calls that went against the crew. ESPN names no official on a play, so each alert goes to every official of the game's
// crew (the plate umpire alone for an ABS overturn), all of them one `moment` with the team alerts of the same thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_ABS_SETTLE_MS = '100';
const { db } = await import('../src/db.ts');
const { loadCatalog, addOfficials, catalog, search } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { PLAYER_DETECTORS } = await import('../src/detectors.ts');
const { liveDeps, GameTracker, engine } = await import('../src/live.ts');
const { urls, officialKey } = await import('../src/leagues.ts');
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { HATE_WATCH_TYPES } = await import('../src/hate-watches.ts');

const team = (lg: string) => db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, '${lg}', ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [id, name, short, abbr] of [['10', 'New York Yankees', 'Yankees', 'NYY'], ['30', 'Tampa Bay Rays', 'Rays', 'TB']]) team('mlb').run(`team:mlb:${id}`, id, name, short, abbr);
for (const [id, name, short, abbr] of [['13', 'Los Angeles Lakers', 'Lakers', 'LAL'], ['2', 'Boston Celtics', 'Celtics', 'BOS']]) team('nba').run(`team:nba:${id}`, id, name, short, abbr);
for (const [id, name, short, abbr] of [['23', 'Pittsburgh Steelers', 'Steelers', 'PIT'], ['5', 'Cleveland Browns', 'Browns', 'CLE']]) team('nfl').run(`team:nfl:${id}`, id, name, short, abbr);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [id, name, t] of [['42547', 'Anthony Volpe', '10'], ['42604', 'Griffin Jax', '30']]) player.run(`player:mlb:${id}`, id, name, `team:mlb:${t}`);
loadCatalog();

const HP = { name: 'Angel Hernandez', position: 'Home Plate' };
const FIRST = { name: 'Bill Miller', position: 'First Base' };
const crewOf = (lg: string, ...os: { name: string; position: string }[]) => os.map((o) => ({ key: officialKey(lg as any, o.name), ...o }));
const hpKey = officialKey('mlb', HP.name), firstKey = officialKey('mlb', FIRST.name);

// ─── The catalog ──────────────────────────────────────────────────────────────────────────────────
test('officials join the catalog once, keyed by league and name, and are searchable as officials only', () => {
  addOfficials('mlb', [HP.name, FIRST.name]);
  addOfficials('mlb', [HP.name]); // a second game with the same umpire adds nothing
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM officials WHERE key = ?`).get(hpKey) as any).n, 1);
  assert.equal(catalog.official(hpKey)?.name, HP.name);
  assert.ok(search('Hernandez', { kind: 'player', officials: true }).some((r: any) => r.key === hpKey));
  assert.ok(!search('Hernandez', { kind: 'team', officials: true }).some((r: any) => r.key === hpKey));
  assert.ok(!search('Hernandez', { kind: 'player' }).some((r: any) => r.key === hpKey)); // builds up to 12 never ask for officials
  assert.ok(!search('Hernandez').some((r: any) => r.key === hpKey));
});

test('the official alerts are on in the feed and off for push by default, never a hate watch, and not cloned for the WNBA', () => {
  const ids = ['mlb.ump.abs_overturned', 'mlb.ump.review_overturned', 'nba.ref.challenge_won', 'nba.ref.review_overturned', 'nfl.ref.reversed'];
  const hate = new Set(HATE_WATCH_TYPES as any);
  for (const id of ids) {
    const t = EVENT_TYPES.find((e: any) => e.id === id) as any;
    assert.ok(t, id);
    assert.equal(t.scope, 'official');
    assert.equal(t.defaultOn, true);
    assert.equal(t.defaultPush, false);
    assert.ok(!hate.has(id), id);
  }
  assert.ok(!EVENT_TYPES.some((e: any) => e.id.startsWith('wnba.ref') || e.id.startsWith('wnba.ump')));
});

// ─── Detectors ────────────────────────────────────────────────────────────────────────────────────
const mlbCtx = (gameId: string, crew?: any[]): any => ({ league: 'mlb', gameId, homeId: '10', awayId: '30', goalies: new Map(), crew });
const mlbResult = (id: string, text: string, away = 4, home = 3): any => ({
  id, type: 'Play Result', typeSlug: 'play-result', text, period: { type: 'Bottom', number: 6 },
  participants: [{ id: '42604', role: 'pitcher' }, { id: '42547', role: 'batter' }], scoring: false, scoreValue: 0, home, away, at: 0, shooting: false,
});
const ofType = (es: any[], ...types: string[]) => es.filter((e) => types.includes(e.type));
const VOLPE = 'Volpe doubled, Lombard Jr. scored.  Umpire review: HR call on the field was overturned due to fan interference.';

test('a replay challenge won: every official of the crew gets the alert, one moment each, and it is no alert when the call stood', () => {
  const won = ofType(PLAYER_DETECTORS.mlb(mlbCtx('401907990', crewOf('mlb', HP, FIRST)), mlbResult('4019079900104990057', 'Volpe walked. New York Yankees challenged: call on the field was overturned.')), 'mlb.ump.review_overturned');
  assert.deepEqual(won.map((e) => [e.targetKey, e.title]), [
    [hpKey, "Angel Hernandez's crew had a call overturned on a replay challenge"],
    [firstKey, "Bill Miller's crew had a call overturned on a replay challenge"],
  ]);
  assert.equal(new Set(won.map((e) => e.moment)).size, 1, 'one call: tracking two of the crew is one alert');
  assert.equal(new Set(won.map((e) => e.id)).size, 2);
  const stood = PLAYER_DETECTORS.mlb(mlbCtx('401907990', crewOf('mlb', HP, FIRST)), mlbResult('4019079900104990058', 'Volpe flied out. New York Yankees challenged: call on the field was upheld.'));
  assert.deepEqual(ofType(stood, 'mlb.ump.review_overturned'), []);
});

test('a crew chief review overturning a call shares its moment with the team alert', () => {
  const es = PLAYER_DETECTORS.mlb(mlbCtx('401907987', crewOf('mlb', HP, FIRST)), mlbResult('4019079871104990057', VOLPE));
  const teamAlert = ofType(es, 'mlb.challenge_lost').find((e) => e.targetKey === 'team:mlb:10')!;
  const crew = ofType(es, 'mlb.ump.review_overturned');
  assert.equal(crew.length, 2);
  for (const e of crew) assert.equal(e.moment, teamAlert.moment, 'the Yankees and the umpire are one thing happening');
});

test('no crew yet (ESPN names the officials in a later summary): no official alerts, and the rest is untouched', () => {
  const es = PLAYER_DETECTORS.mlb(mlbCtx('401907987'), mlbResult('4019079871104990057', VOLPE));
  assert.deepEqual(ofType(es, 'mlb.ump.review_overturned'), []);
  assert.ok(ofType(es, 'mlb.challenge_lost').length > 0);
});

test('a game starting: one alert per official of the crew, the start word of the sport, the same moment as the teams, and none before the crew is named', async () => {
  const { officialStartEvents, gameStartEvents } = await import('../src/detectors.ts');
  const ids: Record<string, [string, string]> = { mlb: ['10', '30'], nba: ['13', '2'], nfl: ['23', '5'] };
  const crews: Record<string, any[]> = {
    mlb: crewOf('mlb', HP, FIRST),
    nba: crewOf('nba', { name: 'Scott Foster', position: 'Crew Chief' }, { name: 'Tony Brothers', position: 'Referee' }),
    nfl: crewOf('nfl', { name: 'Brad Allen', position: 'Referee' }),
  };
  const ctx = (league: string, crew?: any[]) => ({ league, gameId: `g-${league}`, homeId: ids[league][0], awayId: ids[league][1], crew }) as any;
  for (const [league, word, type] of [['mlb', 'First pitch', 'mlb.ump.game_start'], ['nba', 'Tip-off', 'nba.ref.game_start'], ['nfl', 'Kickoff', 'nfl.ref.game_start']]) {
    const es = officialStartEvents(ctx(league, crews[league]), { venue: 'Somewhere Park' }, 0);
    assert.equal(es.length, crews[league].length);
    assert.deepEqual(es.map((e) => e.targetKey), crews[league].map((o) => o.key));
    for (const e of es) {
      assert.equal(e.type, type);
      assert.equal(e.body, `${word} at Somewhere Park`);
      assert.ok(e.fold); // a second alert of the moment shows only as a line
      assert.equal(e.moment, gameStartEvents(ctx(league), {}, 0)[0].moment); // one alert with the team's start
    }
    assert.equal(new Set(es.map((e) => e.id)).size, es.length);
    assert.deepEqual(officialStartEvents(ctx(league, crews[league]), { venue: 'Somewhere Park' }, 99).map((e) => e.id), es.map((e) => e.id)); // a re-poll or restart: the same ids
    assert.ok([...EVENT_TYPES].some((t: any) => t.id === type && t.scope === 'official'));
  }
  assert.deepEqual(officialStartEvents(ctx('mlb'), {}, 0), []);
});

const nbaPlay =(id: string, type: string): any => ({
  id, type, typeSlug: '', text: 'Lakers challenged the foul call: the call was overturned', period: { type: 'quarter', number: 2 },
  participants: [], scoring: false, scoreValue: 0, home: 50, away: 48, at: 0, shooting: false,
});
const nbaCtx = (): any => ({ league: 'nba', gameId: '401898999', homeId: '13', awayId: '2', goalies: new Map(), crew: crewOf('nba', { name: 'Scott Foster', position: 'Crew Chief' }, { name: 'Tony Brothers', position: 'Referee' }) });

test("NBA: ESPN types the outcome, so only '(Overturned)' is an alert, as the crew losing a challenge or a call overturned on review", () => {
  const won = ofType(PLAYER_DETECTORS.nba(nbaCtx(), nbaPlay('1', "Coach's Challenge (Overturned)")), 'nba.ref.challenge_won');
  assert.deepEqual(won.map((e) => e.title), ["Scott Foster's crew lost a coach's challenge", "Tony Brothers's crew lost a coach's challenge"]);
  assert.match(won[0].body, /BOS 48, LAL 50$/);
  const rev = ofType(PLAYER_DETECTORS.nba(nbaCtx(), nbaPlay('2', 'Ref-Initiated Review (Overturned)')), 'nba.ref.review_overturned');
  assert.equal(rev.length, 2);
  for (const t of ["Coach's Challenge (Supported)", "Coach's Challenge (Stands)", 'Ref-Initiated Review (Stands)', 'Ref-Initiated Review (Supported)'])
    assert.deepEqual(ofType(PLAYER_DETECTORS.nba(nbaCtx(), nbaPlay('3', t)), 'nba.ref.challenge_won', 'nba.ref.review_overturned'), [], t);
});

test('NFL: a play the replay official reversed is an alert for the crew; one he upheld is not', () => {
  const g: any = { league: 'nfl', gameId: '401999999', homeId: '23', awayId: '5', goalies: new Map(), crew: crewOf('nfl', { name: 'Carl Cheffers', position: 'Referee' }) };
  const play = (text: string): any => ({ id: '9', type: 'Pass Incompletion', typeSlug: '', text, period: { type: 'quarter', number: 3 }, participants: [], scoring: false, scoreValue: 0, home: 10, away: 7, at: 0, shooting: false });
  const es = ofType(PLAYER_DETECTORS.nfl(g, play('D.Watson pass incomplete. The Replay Official reviewed the pass was not tipped ruling, and the play was REVERSED.')), 'nfl.ref.reversed');
  assert.deepEqual(es.map((e) => [e.targetKey, e.title]), [[officialKey('nfl', 'Carl Cheffers'), "Carl Cheffers's crew had a call reversed on replay"]]);
  assert.deepEqual(ofType(PLAYER_DETECTORS.nfl(g, play('D.Watson pass incomplete. The ruling on the field was upheld.')), 'nfl.ref.reversed'), []);
});

// ─── Live: the pipeline from the summary to the feed ─────────────────────────────────────────────
for (const [device, follows] of [['hp-fan', [hpKey]], ['crew-fan', [hpKey, firstKey]], ['hp-and-yankees', [hpKey, 'team:mlb:10']], ['first-fan', [firstKey]]] as const) {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(device, 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
  for (const k of follows) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(device, k);
}
const DEVICES = ['hp-fan', 'crew-fan', 'hp-and-yankees', 'first-fan'];
const feed = (device: string, ...types: string[]) => db.prepare(`SELECT e.type, e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.type IN (${types.map(() => '?').join(',')}) ORDER BY f.rowid`).all(device, ...types) as { type: string; title: string }[];
const UMP = ['mlb.ump.abs_overturned', 'mlb.ump.review_overturned'];
const clear = () => { db.prepare('DELETE FROM feed').run(); db.prepare('DELETE FROM events').run(); };
const wait = () => new Promise((r) => setTimeout(r, 150));

/** A live game whose summary serves whatever `state.plays` holds; `officials: false` is a summary that names none yet. */
function liveGame(gameId: string, officials = true) {
  const state = { plays: [] as any[] };
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string, o?: any) => {
    if (url.startsWith(urls.corePlays('mlb', gameId).split('?')[0])) return { items: [] };
    if (url.startsWith(urls.summary('mlb', gameId))) return {
      header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [] }] }, plays: state.plays,
      ...(officials ? { gameInfo: { officials: [HP, FIRST].map((o) => ({ fullName: o.name, position: { displayName: o.position } })) } } : {}),
    };
    return prev(url, o);
  };
  return { state, tracker: new GameTracker('mlb', gameId, '10', '30'), done: () => { liveDeps.getJson = prev; } };
}
const review = (text: string, at = new Date(), id = '4019079871104990057') => ({
  id, type: { text: 'Play Result', type: 'play-result' }, text, period: { type: 'Bottom', number: 6 }, scoringPlay: true,
  participants: [{ athlete: { id: '42604' }, type: 'pitcher' }, { athlete: { id: '42547' }, type: 'batter' }], wallclock: at.toISOString(), homeScore: 3, awayScore: 4,
});

test('a crew chief review in a live game: each tracker gets one alert however the summary is re-polled or rewritten, a team and an umpire together get one', async () => {
  clear();
  const { state, tracker, done } = liveGame('401907987');
  const before = review('Volpe homered to right, Lombard Jr. scored.');
  state.plays = [before]; await tracker.poll();
  state.plays = [review(VOLPE)]; await tracker.poll();
  state.plays = [before]; await tracker.poll(); // the summary can lag the core feed
  state.plays = [review(VOLPE)]; await tracker.poll(); await tracker.poll();
  done();
  assert.deepEqual(feed('hp-fan', ...UMP).map((e) => e.title), ["Angel Hernandez's crew had a call overturned on replay"]);
  assert.equal(feed('first-fan', ...UMP).length, 1);
  assert.equal(feed('crew-fan', ...UMP).length, 1, 'two umpires of one crew: one alert');
  assert.equal(feed('hp-and-yankees', ...UMP, 'mlb.challenge_lost').length, 1, 'the umpire and the team: one alert');
});

test('a review already in a result when the tracker attached (a restart) is history for officials too', async () => {
  clear();
  const { state, tracker, done } = liveGame('401907987');
  const hourAgo = new Date(Date.now() - 3600_000);
  state.plays = [review(VOLPE, hourAgo)]; await tracker.poll();
  state.plays = [review(VOLPE.replace('Volpe doubled', 'Volpe doubled to right'), hourAgo)]; await tracker.poll();
  done();
  for (const d of DEVICES) assert.deepEqual(feed(d, ...UMP), [], d);
});

test('a summary that names no officials yet: the teams still get their alert, the umpires none', async () => {
  clear();
  const { state, tracker, done } = liveGame('401907986', false); // its own game: alert ids are stored once per game
  const id = '4019079861104990057';
  state.plays = [review('Volpe homered to right, Lombard Jr. scored.', new Date(), id)]; await tracker.poll();
  state.plays = [review(VOLPE, new Date(), id)]; await tracker.poll();
  done();
  assert.deepEqual(feed('hp-fan', ...UMP), []);
  assert.equal(feed('hp-and-yankees', 'mlb.challenge_lost').length, 1);
});

// ESPN's ABS pitch: "Strike Looking - Confirmed" first, then the same pitch rewritten "Ball - Overturned" (abs-settle.test.ts).
const pitch = (id: string, type: string, text: string) => ({
  id, type: { text: type, type: '' }, text, period: { type: 'Bottom', number: 6 }, scoringPlay: false,
  participants: [{ athlete: { id: '42604' }, type: 'pitcher' }, { athlete: { id: '42547' }, type: 'batter' }], wallclock: new Date().toISOString(), homeScore: 3, awayScore: 4,
});

test('an ABS challenge that overturns the plate umpire: the plate umpire alone, once the overturn has held (not on the first read)', async () => {
  clear();
  const { state, tracker, done } = liveGame('401907988');
  state.plays = [pitch('4019079881102060092', 'Strike Looking - Confirmed', 'Pitch 5 : Strike 2 Looking')];
  await tracker.poll();
  state.plays = [
    pitch('4019079881102060089', 'Ball - Overturned', 'Pitch 5 : Ball 4'),
    { ...review('Lombard Jr. walked. New York Yankees challenged: call on the field was overturned.'), id: '4019079881102990057' },
  ];
  await tracker.poll();
  assert.deepEqual(feed('hp-fan', ...UMP), [], 'ESPN may still take it back: not yet');
  await wait(); await tracker.poll();
  done();
  assert.deepEqual(feed('hp-fan', 'mlb.ump.abs_overturned').map((e) => e.title.startsWith('Angel Hernandez ')), [true]);
  assert.deepEqual(feed('first-fan', 'mlb.ump.abs_overturned'), [], 'only the plate umpire calls pitches');
});

test('an ABS challenge that ESPN leaves confirmed is no umpire alert', async () => {
  clear();
  const { state, tracker, done } = liveGame('401907989');
  state.plays = [pitch('4019079891102060092', 'Strike Looking - Confirmed', 'Pitch 5 : Strike 2 Looking')];
  await tracker.poll(); await wait(); await tracker.poll();
  done();
  for (const d of DEVICES) assert.deepEqual(feed(d, ...UMP), [], d);
});

test('officials join the catalog before a game starts: each untracked game on the board is read once, four a scan, and a game with no crew yet is asked again later', async () => {
  const crews: Record<string, string[]> = { 1: ['Zz Alpha'], 2: ['Zz Bravo', 'Zz Charlie'], 3: [], 4: ['Zz Delta'], 5: ['Zz Echo'], 6: ['Zz Foxtrot'] };
  const side = (ha: string, id: string) => ({ homeAway: ha, id, team: { id, displayName: id === '13' ? 'Los Angeles Lakers' : 'Boston Celtics', abbreviation: id === '13' ? 'LAL' : 'BOS' } });
  const events = Object.keys(crews).map((id) => ({
    id, date: new Date(Date.now() + 5 * 3600_000).toISOString(), shortName: 'BOS @ LAL', season: { type: 2 },
    status: { type: { state: 'pre', completed: false } }, competitions: [{ competitors: [side('home', '13'), side('away', '2')] }],
  }));
  let reads: string[] = [];
  const prev = liveDeps.getJson;
  liveDeps.getJson = (async (url: string, ...rest: any[]) => {
    if (url.startsWith(urls.scoreboard('nba').split('?')[0])) return { events };
    for (const id of Object.keys(crews)) {
      if (url === urls.summary('nba', id)) { reads.push(id); return { gameInfo: { officials: crews[id].map((fullName) => ({ fullName, position: { displayName: 'Referee' } })) } }; }
    }
    return (prev as any)(url, ...rest);
  }) as any;
  const found = (name: string) => search(name, { kind: 'player', officials: true }).some((r: any) => r.key === officialKey('nba', name));
  const scan = async () => { reads = []; await (engine as any).scanScoreboard('nba'); await new Promise((r) => setTimeout(r, 20)); return reads.slice().sort(); }; // the sweep runs in the background
  try {
    assert.deepEqual(await scan(), ['1', '2', '3', '4'], 'four summaries on the first scan');
    assert.ok(found('Zz Charlie'), 'a crew is searchable before the game starts');
    assert.deepEqual(await scan(), ['5', '6'], 'the rest next scan; games with a crew and game 3 (waiting to retry) are not read again');
    crews[3] = ['Zz Golf'];
    (engine as any).crewsSwept.set('nba:3', 0); // its 3 h retry has come
    assert.deepEqual(await scan(), ['3']);
    assert.ok(found('Zz Golf'));
    assert.deepEqual(await scan(), [], 'every crew found: nothing left to read');
  } finally { liveDeps.getJson = prev; }
});

test('an odd summary never breaks the scan: garbage officials are skipped', async () => {
  const side = (ha: string, id: string) => ({ homeAway: ha, id, team: { id, displayName: 'Boston Celtics', abbreviation: 'BOS' } });
  const events = [{
    id: '9', date: new Date(Date.now() + 5 * 3600_000).toISOString(), shortName: 'BOS @ LAL', season: { type: 2 },
    status: { type: { state: 'pre', completed: false } }, competitions: [{ competitors: [side('home', '13'), side('away', '2')] }],
  }];
  const prev = liveDeps.getJson;
  liveDeps.getJson = (async (url: string, ...rest: any[]) => {
    if (url.startsWith(urls.scoreboard('nba').split('?')[0])) return { events };
    if (url === urls.summary('nba', '9')) return { gameInfo: { officials: [null, { fullName: 'Zz Odd', position: null }, 7, { position: {} }] } };
    return (prev as any)(url, ...rest);
  }) as any;
  try {
    await assert.doesNotReject((engine as any).sweepOfficials('nba', events));
    const kept = search('Zz Odd', { kind: 'player', officials: true }).some((r: any) => r.key === officialKey('nba', 'Zz Odd'));
    assert.equal(kept, true, 'a named official is kept; entries with no name are skipped');
  } finally { liveDeps.getJson = prev; }
});
