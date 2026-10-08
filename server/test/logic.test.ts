import { test } from 'node:test';
import assert from 'node:assert/strict';

// The DB module opens its file on import, so point it at memory before loading app code.
process.env.HW_DB = ':memory:';
const { wants, shouldDeliver, pushAllowed, inQuietHours, DEFAULT_PREFS } = await import('../src/fanout.ts');
const { parseStandings } = await import('../src/live.ts');
const { nextScore, ordinal, mergePlays, observePlay, mlbFinalHalfInning, PLAYER_DETECTORS, teamScoreEvents } = await import('../src/detectors.ts');

const play = (o: object) => ({ id: '1', type: '', typeSlug: '', text: '', participants: [], scoring: false, scoreValue: 0, home: 0, away: 0, at: 0, shooting: false, ...o });
const { normalize } = await import('../src/catalog.ts');

const prefs = (over: object = {}) => ({ ...DEFAULT_PREFS, ...over });
const ev = { type: 'mlb.batter.strikeout', targetKey: 'player:mlb:1' };

test('type defaults come from the catalog', () => {
  assert.equal(wants(prefs(), ev, 'mlb'), true);
  assert.equal(wants(prefs(), { ...ev, type: 'mlb.batter.popout' }, 'mlb'), false); // defaultOn: false
});

test('user can turn a type off or a league off', () => {
  assert.equal(wants(prefs({ types: { 'mlb.batter.strikeout': false } }), ev, 'mlb'), false);
  assert.equal(wants(prefs({ leagues: { mlb: false } }), ev, 'mlb'), false);
});

test('muting a target (🔕) only stops push: its alerts still go to the feed', () => {
  const noon = new Date('2026-10-03T12:00:00Z');
  const muted = prefs({ muted: ['player:mlb:1'] });
  assert.equal(wants(muted, ev, 'mlb'), true, 'still delivered to the feed');
  assert.equal(pushAllowed(muted, 'player:mlb:1', noon), false, 'but no push');
  assert.equal(pushAllowed(muted, 'player:mlb:2', noon), true, 'other targets still push');
  assert.equal(pushAllowed(prefs({ pushEnabled: false }), 'player:mlb:2', noon), false);
  assert.equal(pushAllowed(prefs({ quietHours: { enabled: true, start: '11:00', end: '13:00', tz: 'UTC' } }), 'player:mlb:2', noon), false);
});

test('aliases: a homer still arrives for users who only want "gives up runs"', () => {
  const hr = { type: 'mlb.pitcher.home_run_allowed', aliases: ['mlb.pitcher.runs_allowed'], targetKey: 'player:mlb:1' };
  assert.equal(wants(prefs({ types: { 'mlb.pitcher.home_run_allowed': false } }), hr, 'mlb'), true);
  assert.equal(wants(prefs({ types: { 'mlb.pitcher.home_run_allowed': false, 'mlb.pitcher.runs_allowed': false } }), hr, 'mlb'), false);
});

test('quiet hours handle windows that cross midnight, in the user timezone', () => {
  const p = prefs({ quietHours: { enabled: true, start: '23:00', end: '08:00', tz: 'UTC' } });
  assert.equal(inQuietHours(p, new Date('2026-10-03T23:30:00Z')), true);
  assert.equal(inQuietHours(p, new Date('2026-10-03T07:59:00Z')), true);
  assert.equal(inQuietHours(p, new Date('2026-10-03T12:00:00Z')), false);
  assert.equal(inQuietHours(prefs({ quietHours: { enabled: true, start: '23:00', end: '08:00', tz: 'America/New_York' } }), new Date('2026-10-04T03:30:00Z')), true);
});

test('only scoring plays move the score, and scores never go backwards', () => {
  assert.deepEqual(nextScore({ home: 0, away: 0 }, play({ home: 3 })), { home: 0, away: 0 });
  assert.deepEqual(nextScore({ home: 0, away: 0 }, play({ home: 3, scoring: true })), { home: 3, away: 0 });
  assert.deepEqual(nextScore({ home: 3, away: 1 }, play({ home: 0, away: 2, scoring: true })), { home: 3, away: 2 });
});

test('standings parser ranks by playoff seed within each group', () => {
  const entry = (id: string, seed: number, clincher = '', streak = 'W1') => ({ team: { id }, stats: [{ name: 'playoffSeed', value: seed }, { name: 'clincher', displayValue: clincher }, { name: 'streak', displayValue: streak }] });
  const res = { children: [{ abbreviation: 'AL', standings: { entries: [entry('2', 2), entry('1', 1), entry('3', 3, 'e', 'L4')] } }] };
  const s = parseStandings(res);
  assert.equal(s.get('1')!.rank, 1);
  assert.equal(s.get('3')!.clincher, 'e');
  assert.equal(s.get('3')!.streak, 'L4');
});

test('merging the two ESPN sources keeps play order (never sorts) and slots in source-only plays', () => {
  const ids = (ps: { id: string }[]) => ps.map((p) => p.id).join(',');
  const P = (id: string) => play({ id });
  // MLB-style: ids are not chronological, so any sort would scramble them.
  assert.equal(ids(mergePlays([P('9'), P('2'), P('7')], [P('9'), P('2'), P('7')])), '9,2,7');
  // Core (primary) is missing play 5 that only the summary has: it lands after its predecessor 2.
  assert.equal(ids(mergePlays([P('9'), P('2'), P('7')], [P('9'), P('2'), P('5'), P('7')])), '9,2,5,7');
  // Core failed entirely: summary order is used.
  assert.equal(ids(mergePlays([], [P('3'), P('1')])), '3,1');
});

test('MLB: stranding runners in scoring position', () => {
  const ctx = () => ({ league: 'mlb' as const, gameId: 'g', homeId: '15', awayId: '22', goalies: new Map() });
  const result = (runners: string[], extra: object = {}) => play({
    id: `r-${runners.join('')}`, typeSlug: 'play-result', teamId: '22', text: 'Stott struck out looking.', outs: 3,
    period: { type: 'Top', number: 4 },
    participants: [{ id: '1', role: 'pitcher' }, { id: '2', role: 'batter' }, ...runners.map((r, i) => ({ id: `${10 + i}`, role: r }))],
    ...extra,
  });
  const endInning = play({ id: 'end', typeSlug: 'end-inning', teamId: '22' });
  const run = (runners: string[]) => { const g = ctx(); observePlay(g, result(runners)); return PLAYER_DETECTORS.mlb(g, endInning); };

  const second = run(['onSecond']);
  assert.equal(second.length, 1);
  assert.equal(second[0].type, 'mlb.team.stranded_risp');
  assert.equal(second[0].targetKey, 'team:mlb:22'); // the batting team is the one that stranded them
  assert.match(second[0].title, /stranded a runner on second/);
  assert.match(second[0].body, /^Top 4th: Stott struck out looking\./);
  assert.match(run(['onSecond', 'onThird'])[0].title, /stranded 2 runners in scoring position/);
  assert.match(run(['onFirst', 'onSecond'])[0].title, / stranded runners on first and second$/, 'a runner left on first is in it too');
  assert.match(run(['onFirst', 'onThird'])[0].title, / stranded runners on first and third$/);
  assert.match(run(['onFirst', 'onSecond', 'onThird'])[0].title, /left the bases loaded/);
  assert.equal(run(['onFirst']).length, 0, 'a runner on first is not in scoring position');
  assert.equal(run([]).length, 0);

  // The game's last half-inning has no End Inning play: checked at the final instead.
  const g = ctx(); observePlay(g, result(['onThird']));
  assert.equal(mlbFinalHalfInning(g).length, 1);
  const walkoff = ctx(); observePlay(walkoff, result(['onSecond'], { outs: 1 }));
  assert.equal(mlbFinalHalfInning(walkoff).length, 0, 'a walk-off ends with fewer than 3 outs');
});

test('MLB: going down in order, and striking out in order', () => {
  const ctx = (): any => ({ league: 'mlb', gameId: 'g', homeId: '15', awayId: '22', goalies: new Map() });
  let n = 0;
  // At-bat results as ESPN writes them (Brewers v Padres, October 2026): the batter, and any runners after the play.
  const ab = (text: string, o: { runners?: string[]; outs?: number; scoring?: boolean } = {}) => play({
    id: `ab${n++}`, typeSlug: 'play-result', teamId: '22', text, outs: o.outs ?? 0, scoring: !!o.scoring, period: { type: 'Bottom', number: 2 },
    participants: [{ id: 'P', role: 'pitcher' }, { id: 'B', role: 'batter' }, ...(o.runners ?? []).map((r, i) => ({ id: `R${i}`, role: r }))],
  });
  const inning = (...plays: ReturnType<typeof play>[]) => {
    const g = ctx();
    for (const p of plays) observePlay(g, p);
    return PLAYER_DETECTORS.mlb(g, play({ id: `end${n++}`, typeSlug: 'end-inning', teamId: '22' })).filter((e) => e.type === 'mlb.team.down_in_order');
  };

  const [dio] = inning(ab('Chourio grounded out to third.', { outs: 1 }), ab('Turang grounded out to third.', { outs: 2 }), ab('Bauers struck out swinging.', { outs: 3 }));
  assert.equal(dio.targetKey, 'team:mlb:22', 'the batting team');
  assert.match(dio.title, / went down in order$/);
  assert.ok(dio.body.startsWith('Bottom 2nd: Chourio grounded out to third. Turang grounded out to third. Bauers struck out swinging. — '), dio.body);

  const [ks] = inning(ab('Contreras struck out swinging.', { outs: 1 }), ab('Mitchell struck out looking.', { outs: 2 }),
    ab('Yelich struck out swinging. San Diego Padres challenged: call on the field was upheld.', { outs: 3 }));
  assert.match(ks.title, / struck out in order 🌀$/, 'all three strikeouts say so');
  assert.ok(ks.body.startsWith('Bottom 2nd: Contreras struck out swinging. Mitchell struck out looking. Yelich struck out swinging. — '), "a challenge's sentence is left out");
  assert.equal(ks.meta!.strikeouts, 3);

  // Somebody got on, so it wasn't 1-2-3, even when three batters made three outs.
  assert.deepEqual(inning(ab('Yelich singled to left.', { runners: ['onFirst'] }), ab('Contreras grounded into double play, second to shortstop to first, Yelich out at second.', { outs: 2 }),
    ab('Mitchell flied out to center.', { outs: 3 })), [], 'a single, then a double play: three batters, but not in order');
  assert.deepEqual(inning(ab('Bauers homered to right (402 feet).', { scoring: true }), ab('Chourio struck out swinging.', { outs: 1 }), ab('Turang flied out to left.', { outs: 2 }),
    ab('Contreras grounded out to second.', { outs: 3 })), [], 'a solo homer leaves the bases empty');
  assert.deepEqual(inning(ab('Mitchell struck out swinging, reached first on wild pitch.', { runners: ['onFirst'] }), ab('Yelich struck out looking.', { outs: 1 }),
    ab('Turang struck out swinging.', { outs: 2 }), ab('Bauers struck out swinging.', { outs: 3 })), [], 'four strikeouts, one of them reaching');
  assert.deepEqual(inning(ab('Bauers flied out to center.', { runners: ['onSecond'], outs: 1 }), ab('Chourio struck out swinging.', { runners: ['onSecond'], outs: 2 }),
    ab('Turang grounded out to first.', { runners: ['onSecond'], outs: 3 })), [], "extra innings' runner on second");
  assert.deepEqual(inning(ab('Bauers flied out to center.', { outs: 1 }), ab('Bauers flied out to center.', { outs: 1 })), [], 'two outs is not an inning');

  // The game's last half-inning has no End Inning play: checked at the final.
  const g = ctx();
  for (const p of [ab('Jones grounded out to first.', { outs: 1 }), ab('Lombard Jr. grounded out to second.', { outs: 2 }), ab('Chisholm Jr. grounded out to first.', { outs: 3 })]) observePlay(g, p);
  assert.deepEqual(mlbFinalHalfInning(g).map((e) => e.type), ['mlb.team.down_in_order']);
});

test('MLB: caught stealing is pinned on the runner from the base they left', () => {
  const g: any = { league: 'mlb', gameId: 'g', homeId: '15', awayId: '22', goalies: new Map() };
  // A pitch with the batter + runners is a full snapshot of the bases.
  observePlay(g, play({ id: 'p1', typeSlug: 'strike-swinging', teamId: '15', participants: [{ id: 'P', role: 'pitcher' }, { id: 'B', role: 'batter' }, { id: 'R1', role: 'onFirst' }, { id: 'R2', role: 'onSecond' }] }));
  // ESPN's runner-event plays list only the pitcher; they must not wipe the bases.
  const csPlay = { typeSlug: 'caught-stealing', teamId: '22', text: 'Butler caught stealing third, catcher to third.', period: { type: 'Top', number: 3 }, participants: [{ id: 'P', role: 'pitcher' }] };
  observePlay(g, play({ id: 'x', ...csPlay }));
  const [a] = PLAYER_DETECTORS.mlb(g, play({ id: 'cs-1', ...csPlay }));
  assert.equal(a.type, 'mlb.runner.caught_stealing');
  assert.equal(a.targetKey, 'player:mlb:R2', 'stealing third means the runner came from second');
  assert.match(a.title, /caught stealing third$/);

  // ESPN repeats it as a "Play Result" with the same text: same id, so one notification.
  const [b] = PLAYER_DETECTORS.mlb(g, play({ id: 'cs-2', ...csPlay, typeSlug: 'play-result' }));
  assert.equal(b.id, a.id);

  // Strike-'em-out-throw-'em-out: the runner's name sits mid-sentence.
  const [c] = PLAYER_DETECTORS.mlb(g, play({ id: 'dp', typeSlug: 'play-result', teamId: '22', text: 'Smith struck out swinging and Acuña Jr. caught stealing second, catcher to shortstop.', participants: [{ id: 'P', role: 'pitcher' }] }));
  assert.equal(c.targetKey, 'player:mlb:R1', 'stealing second means the runner came from first');

  // Not a caught stealing: nothing.
  const runnerOuts = (p: object) => PLAYER_DETECTORS.mlb(g, play(p)).filter((e) => e.type === 'mlb.runner.caught_stealing');
  assert.equal(runnerOuts({ id: 'sb', typeSlug: 'stolen-base', teamId: '22', text: 'Butler stole second.' }).length, 0);

  // Pickoffs share the same notification type (one toggle).
  const pickoff = { teamId: '22', text: 'Bolte picked off second.', period: { type: 'Top', number: 3 }, participants: [{ id: 'P', role: 'pitcher' }] };
  const [po] = runnerOuts({ id: 'po-1', typeSlug: 'pick-off', ...pickoff });
  assert.equal(po.targetKey, 'player:mlb:R2', 'picked off second means the runner was standing on second');
  assert.match(po.title, /got picked off second$/);
  assert.equal(runnerOuts({ id: 'po-2', typeSlug: 'play-result', ...pickoff })[0].id, po.id, 'ESPN twin plays collapse to one');
  // "picked off and caught stealing": the runner left first heading for second.
  const [pocs] = runnerOuts({ id: 'pocs', typeSlug: 'play-result', teamId: '22', text: 'Bolte picked off and caught stealing second, pitcher to shortstop.' });
  assert.equal(pocs.targetKey, 'player:mlb:R1');
  assert.match(pocs.title, /picked off \(caught stealing second\)/);
  // A failed pickoff attempt is not an out.
  assert.equal(runnerOuts({ id: 'poe', typeSlug: 'play-result', teamId: '22', text: 'Bolte to second on pickoff error by pitcher.' }).length, 0);
});

test('NFL: delay of game goes to the offense QB; safeties replace the generic alert', async () => {
  // Minimal catalog: Steelers (PIT, ESPN id 23) and Browns (CLE, 5), plus players with positions.
  const { db } = await import('../src/db.ts');
  const { loadCatalog } = await import('../src/catalog.ts');
  const team = db.prepare(`INSERT OR REPLACE INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'nfl', ?, ?, ?, ?, 'x', 1, 1, 0)`);
  team.run('team:nfl:23', '23', 'Pittsburgh Steelers', 'Steelers', 'PIT');
  team.run('team:nfl:5', '5', 'Cleveland Browns', 'Browns', 'CLE');
  const player = db.prepare(`INSERT OR REPLACE INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'nfl', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
  player.run('player:nfl:QB1', 'QB1', 'Aaron Rodgers', 'QB', 'team:nfl:23');
  player.run('player:nfl:RB1', 'RB1', 'Jaylen Warren', 'RB', 'team:nfl:23');
  player.run('player:nfl:OL1', 'OL1', 'Isaac Seumalo', 'G', 'team:nfl:23');
  loadCatalog();

  const g: any = { league: 'nfl', gameId: 'g', homeId: '5', awayId: '23', goalies: new Map() };
  const nfl = (o: object) => PLAYER_DETECTORS.nfl(g, play({ id: Math.random().toString(), teamId: '23', ...o }));
  // QB is tracked from passes; a running back's trick-play pass doesn't replace him.
  observePlay(g, play({ teamId: '23', participants: [{ id: 'QB1', role: 'passer' }] }));
  observePlay(g, play({ teamId: '23', participants: [{ id: 'RB1', role: 'passer' }] }));

  const dog = nfl({ text: '(Shotgun) PENALTY on PIT, Delay of Game, 5 yards, enforced at CLV 11 - No Play.' });
  assert.equal(dog.length, 1);
  assert.equal(dog[0].type, 'nfl.qb.delay_of_game');
  assert.equal(dog[0].targetKey, 'player:nfl:QB1');
  assert.equal(nfl({ text: '(Punt formation) PENALTY on PIT, Delay of Game, 5 yards, enforced at PIT 9 - No Play.' }).length, 0, 'not on punts');
  assert.equal(nfl({ text: '(Field Goal formation) PENALTY on PIT, Delay of Game, 5 yards - No Play.' }).length, 0, 'not on field goals');
  assert.equal(nfl({ text: 'PENALTY on CLV, Delay of Game, 5 yards, enforced at PIT 30.' }).length, 0, 'a flag on the defense (CLV = CLE) is not our QB');
  assert.equal(nfl({ text: 'PENALTY on PIT, Delay of Game, declined.' }).length, 0);

  // Penalty safety: the flagged player gets ONE alert (safety, which also counts as "commits a penalty").
  const pen = nfl({ type: 'Penalty', scoring: true, scoreValue: 2, text: '(Shotgun) A.Rodgers sacked at PIT 6. PENALTY on PIT-I.Seumalo, Offensive Holding, 6 yards, enforced in End Zone, SAFETY - No Play.', participants: [{ id: 'QB1', role: 'passer' }, { id: 'OL1', role: 'penalized' }] });
  assert.deepEqual(pen.map((e) => [e.type, e.targetKey]), [['nfl.safety', 'player:nfl:OL1']]);
  assert.deepEqual(pen[0].aliases, ['nfl.penalty']);
  // Regular safety: the ball carrier.
  const reg = play({ id: 's', type: 'Safety', scoring: true, scoreValue: 2, teamId: '23', home: 2, away: 0, text: 'Myles Garrett Safety', participants: [{ id: 'RB1', role: 'rusher' }, { id: 'D1', role: 'scorer' }] });
  assert.equal(PLAYER_DETECTORS.nfl(g, reg)[0].targetKey, 'player:nfl:RB1');
  // Team side: "gave up a safety" replaces "opponent scored 2" (and counts as that toggle).
  const team23 = teamScoreEvents(g, { home: 0, away: 0 }, reg).filter((e) => e.targetKey === 'team:nfl:23');
  const types = team23.map((e) => e.type);
  assert.ok(types.includes('nfl.safety') && !types.includes('team.opponent_scored'), `got ${types}`);
  assert.match(team23.find((e) => e.type === 'nfl.safety')!.title, /Steelers gave up a safety/);
  // It also put them behind 2-0: the safety alert yields to one combined "fell behind" alert.
  assert.equal(team23.find((e) => e.type === 'nfl.safety')!.unless, 'team.fell_behind');
  assert.match(team23.find((e) => e.type === 'team.fell_behind')!.title, /Steelers gave up a safety and fell behind the Browns/);
  // Overturned: nothing.
  assert.equal(nfl({ type: 'Safety', scoring: false, text: 'N.Cross tackled in End Zone, SAFETY NULLIFIED by Penalty' }).filter((e) => e.type === 'nfl.safety').length, 0);
});

test('MLB: NOBLETIGER (bases loaded, nobody out, no runs) and no duplicate with stranded runners', () => {
  const LOADED = ['onFirst', 'onSecond', 'onThird'];
  let n = 0;
  // An at-bat result: the bases and outs AFTER the play, like ESPN's play-result plays.
  const ab = (outs: number, runners: string[], extra: object = {}) => play({
    id: `ab${n++}`, typeSlug: 'play-result', teamId: '22', outs, text: `result ${n}`, period: { type: 'Top', number: 4 },
    participants: [{ id: 'P', role: 'pitcher' }, { id: `B${n}`, role: 'batter' }, ...runners.map((r, i) => ({ id: `R${i}`, role: r }))],
    ...extra,
  });
  const endInning = play({ id: 'end', typeSlug: 'end-inning', period: { type: 'Mid', number: 4 } });
  const inning = (...plays: ReturnType<typeof play>[]) => {
    const g: any = { league: 'mlb', gameId: 'g', homeId: '15', awayId: '22', goalies: new Map() };
    for (const p of plays) observePlay(g, p);
    return PLAYER_DETECTORS.mlb(g, endInning);
  };
  const types = (es: { type: string; unless?: string }[]) => es.map((e) => (e.unless ? `${e.type} unless ${e.unless}` : e.type));

  // Walk loads them with 0 outs, then K, popup, K: classic NOBLETIGER, bases still loaded.
  const classic = inning(ab(0, ['onFirst', 'onSecond']), ab(0, LOADED), ab(1, LOADED), ab(2, LOADED), ab(3, LOADED));
  assert.deepEqual(types(classic), ['mlb.team.nobletiger', 'mlb.team.stranded_risp unless mlb.team.nobletiger']);
  assert.match(classic[0].title, /pulled a NOBLETIGER/);
  assert.equal(classic[0].targetKey, 'team:mlb:22');

  assert.deepEqual(types(inning(ab(1, LOADED), ab(2, LOADED), ab(3, LOADED))), ['mlb.team.stranded_risp'], 'loaded with 1 out is not a NOBLETIGER');
  assert.deepEqual(types(inning(ab(0, LOADED), ab(1, LOADED, { scoring: true }), ab(2, LOADED), ab(3, LOADED))), ['mlb.team.stranded_risp'], 'scoring after loading them cancels it');
  assert.deepEqual(types(inning(ab(0, LOADED, { scoring: true }), ab(1, LOADED), ab(2, LOADED), ab(3, LOADED))).includes('mlb.team.nobletiger'), true, 'a run on the play that loaded them happened before, so it still counts');
  assert.deepEqual(types(inning(ab(0, LOADED), ab(3, []))), ['mlb.team.nobletiger'], 'triple play: NOBLETIGER, nobody left to strand');

  // The game's last half-inning (no "End Inning" play) is checked at the final.
  const g: any = { league: 'mlb', gameId: 'g', homeId: '15', awayId: '22', goalies: new Map() };
  for (const p of [ab(0, LOADED), ab(1, LOADED), ab(2, LOADED), ab(3, LOADED)]) observePlay(g, p);
  assert.deepEqual(types(mlbFinalHalfInning(g)), ['mlb.team.nobletiger', 'mlb.team.stranded_risp unless mlb.team.nobletiger']);

  // Delivery: every user gets exactly ONE alert for that inning, depending on their toggles.
  const [noble, stranded] = classic;
  const delivered = (types: Record<string, boolean>) =>
    [noble, stranded].filter((e) => shouldDeliver(prefs({ types }), e, 'mlb')).map((e) => e.type);
  assert.deepEqual(delivered({}), ['mlb.team.nobletiger'], 'both on (default): just the NOBLETIGER');
  assert.deepEqual(delivered({ 'mlb.team.nobletiger': false }), ['mlb.team.stranded_risp'], 'NOBLETIGER off: falls back to stranded');
  assert.deepEqual(delivered({ 'mlb.team.stranded_risp': false }), ['mlb.team.nobletiger']);
  assert.deepEqual(delivered({ 'mlb.team.nobletiger': false, 'mlb.team.stranded_risp': false }), []);
});

test('MLB: opponent gets a runner in scoring position: the fielding team hears it once per half-inning', () => {
  let n = 0;
  const runners = (rs: string[]) => rs.map((r, i) => ({ id: `R${i}`, role: r }));
  const at = (half: string) => ({ type: half.split(' ')[0], number: Number(half.split(' ')[1]) });
  // Shapes from a real game (ATL @ LAD): at-bat results and pitches list the batter and every runner;
  // a steal lists the pitcher and the runner's new base, and ESPN sends it twice with the same text.
  const ab = (half: string, text: string, rs: string[], extra: object = {}) =>
    play({ id: `p${n++}`, typeSlug: 'play-result', text, period: at(half), participants: [{ id: 'P', role: 'pitcher' }, { id: 'B', role: 'batter' }, ...runners(rs)], ...extra });
  const pitch = (half: string, rs: string[]) =>
    play({ id: `p${n++}`, typeSlug: 'ball', text: 'Pitch 2 : Ball 1', period: at(half), participants: [{ id: 'P', role: 'pitcher' }, { id: 'B', role: 'batter' }, ...runners(rs)] });
  const runnerPlay = (half: string, typeSlug: string, text: string, rs: string[] = []) =>
    play({ id: `p${n++}`, typeSlug, text, period: at(half), participants: [{ id: 'P', role: 'pitcher' }, ...runners(rs)] });
  const newGame = (): any => ({ league: 'mlb', gameId: 'g', homeId: '15', awayId: '22', goalies: new Map() });
  // What the live tracker does for each new play: detect, then update game state.
  const live = (g: any, p: ReturnType<typeof play>) => { const es = PLAYER_DETECTORS.mlb(g, p).filter((e) => e.type === 'mlb.team.opponent_risp'); observePlay(g, p); return es; };

  const g = newGame();
  assert.deepEqual(live(g, ab('Top 1', 'Acuña Jr. singled to left.', ['onFirst'])), [], 'a runner on first is not in scoring position');
  const [stole] = live(g, runnerPlay('Top 1', 'stolen-base', 'Acuña Jr. stole second.', ['onSecond']));
  assert.equal(stole.targetKey, 'team:mlb:15', 'top of the inning: the home team is fielding');
  assert.match(stole.title, /have a runner on second against the /);
  assert.match(stole.body, /^Top 1st: Acuña Jr\. stole second\. — /);
  assert.equal(stole.unless, undefined);
  assert.deepEqual(live(g, runnerPlay('Top 1', 'play-result', 'Acuña Jr. stole second.', ['onSecond'])), [], "ESPN's duplicate of the steal");
  assert.deepEqual(live(g, ab('Top 1', 'Albies walked, Olson to second, Acuña Jr. to third.', ['onFirst', 'onSecond', 'onThird'])), [], 'once per half-inning');

  const [double] = live(g, ab('Bottom 1', 'Rojas doubled to left.', ['onSecond']));
  assert.equal(double.targetKey, 'team:mlb:22', 'bottom of the inning: the away team is fielding');

  // Wording follows the bases: loaded, two runners, one.
  assert.match(live(g, ab('Top 2', 'Baldwin walked.', ['onFirst', 'onSecond', 'onThird']))[0].title, /have the bases loaded against/);
  assert.match(live(g, ab('Bottom 2', 'Pages singled.', ['onFirst', 'onThird']))[0].title, /have runners on first and third against/);

  // A wild pitch (real SD @ MIL wording) moves the runner between pitches: caught right away.
  assert.deepEqual(live(g, ab('Top 3', 'Machado walked.', ['onFirst'])), []);
  const [wildPitch] = live(g, runnerPlay('Top 3', 'wild-pitch', 'Machado to second on wild pitch by Henderson.', ['onSecond']));
  assert.match(wildPitch.body, /^Top 3rd: Machado to second on wild pitch by Henderson\./);

  // A runner thrown out is not a runner in scoring position, even though the text says "to second".
  assert.deepEqual(live(g, ab('Bottom 3', 'Edman singled.', ['onFirst'])), []);
  assert.deepEqual(live(g, runnerPlay('Bottom 3', 'caught-stealing', 'Edman caught stealing second, catcher to second.')), []);
  // A move we can't read is caught up by the next pitch, without "Ball 1" as the story.
  assert.deepEqual(live(g, runnerPlay('Bottom 3', 'defensive-indifference', 'Defensive indifference.')), []);
  const [caughtUp] = live(g, pitch('Bottom 3', ['onSecond']));
  assert.match(caughtUp.body, /^Bottom 3rd — /);

  // A run scoring on the same play: "Opponent scores" says more, so this one is `unless` it.
  const [scored] = live(g, ab('Top 5', 'Ohtani doubled, Betts scored.', ['onSecond'], { scoring: true, scoreValue: 1 }));
  assert.equal(scored.unless, 'team.opponent_scored');
  const risp = { 'mlb.team.opponent_risp': true }; // off by default
  assert.equal(shouldDeliver(prefs({ types: risp }), scored, 'mlb'), false, 'the scored-on alert covers it');
  assert.equal(shouldDeliver(prefs({ types: { ...risp, 'team.opponent_scored': false } }), scored, 'mlb'), true, '"Opponent scores" off: this one arrives');

  // Attaching mid-threat (history is observed, never alerted) must not send a late alert.
  const late = newGame();
  observePlay(late, ab('Top 4', 'Murphy doubled.', ['onSecond']));
  assert.deepEqual(live(late, pitch('Top 4', ['onSecond'])), []);
  assert.deepEqual(live(late, ab('Top 4', 'Baldwin walked.', ['onFirst', 'onSecond'])), []);
});

test('scored on AND fell behind on the same play: one alert per user, not two', () => {
  const g: any = { league: 'nhl', gameId: 'g', homeId: '1', awayId: '2', goalies: new Map() };
  const goal = (home: number, away: number) => play({ id: `${home}-${away}`, scoring: true, home, away, text: 'Goal' });
  const forHome = (prev: { home: number; away: number }, p: ReturnType<typeof play>) =>
    teamScoreEvents(g, prev, p).filter((e) => e.targetKey === 'team:nhl:1');

  // Tied 1-1, away team scores: home is scored on AND falls behind. Falling behind comes first: of a play's
  // alerts for a team (one moment), a device gets the first it wants.
  const [behind, scored] = forHome({ home: 1, away: 1 }, goal(1, 2));
  assert.equal(behind.moment, scored.moment, 'one moment');
  assert.equal(scored.type, 'team.opponent_scored');
  assert.equal(scored.unless, 'team.fell_behind');
  assert.equal(behind.type, 'team.fell_behind');
  assert.match(behind.title, /scored to take the lead over the/, 'the combined alert says both things');

  const delivered = (types: Record<string, boolean>) => [scored, behind].filter((e) => shouldDeliver(prefs({ types }), e, 'nhl')).map((e) => e.type);
  assert.deepEqual(delivered({}), ['team.fell_behind'], 'both on (default): just the combined alert');
  assert.deepEqual(delivered({ 'team.fell_behind': false }), ['team.opponent_scored'], '"falls behind" off: the plain scored-on alert');
  assert.deepEqual(delivered({ 'team.opponent_scored': false }), ['team.fell_behind']);
  assert.deepEqual(delivered({ 'team.opponent_scored': false, 'team.fell_behind': false }), []);

  // Scored on but still leading (3-1 → 3-2): nothing to merge, the scored-on alert is unconditional.
  const notLead = forHome({ home: 3, away: 1 }, goal(3, 2));
  assert.deepEqual(notLead.map((e) => [e.type, e.unless]), [['team.opponent_scored', undefined]]);
});

test('F1: session results become one alert per driver, with merged facts and team alerts', async () => {
  const { f1SessionResults, isOut } = await import('../src/f1.ts');
  const row = (id: string, order: number, grid: number, team: string, out = '') =>
    ({ id, order, grid, out: !!out, outLabel: out, lap: out ? 12 : null, teamKey: `team:f1:${team}` });
  const meta = (kind: 'race' | 'sprint' | 'qual') => ({ compId: 'c', kind, label: 'Test GP', at: 0 });
  const by = <T extends { targetKey: string }>(es: T[], key: string) => es.filter((e) => e.targetKey === key);

  // Double DNF: both cars out → one team alert that also covers "no points".
  const race = f1SessionResults(meta('race'), [row('A', 1, 1, 'X'), row('B', 2, 3, 'X'), row('C', 21, 5, 'Y', 'Retired'), row('D', 22, 6, 'Y', 'Disqualified')]);
  const y = by(race, 'team:f1:Y');
  assert.deepEqual(y.map((e) => e.type), ['f1.team.double_dnf']);
  assert.deepEqual(y[0].aliases, ['f1.team.no_points']);
  assert.match(by(race, 'player:f1:C')[0].title, /retired on lap 12/);
  assert.match(by(race, 'player:f1:D')[0].title, /was disqualified/);
  assert.equal(by(race, 'player:f1:A').length, 0, 'the winner gets nothing');
  assert.equal(by(race, 'team:f1:X').length, 0, 'a team with points gets nothing');

  // Neither car in the points (one DNF): a Successful Hate Watch for the constructor.
  const pointless = by(f1SessionResults(meta('race'), [row('A', 12, 9, 'Z'), row('B', 20, 8, 'Z', 'Retired')]), 'team:f1:Z');
  assert.deepEqual(pointless.map((e) => [e.type, e.title, e.body]),
    [['f1.team.no_points', 'Successful Hate Watch! Your tracked team finished outside the points', 'Test GP: P12, DNF']]);

  // Sprint: points go to the top 8, so P9 is "no points" (it wouldn't be in a race).
  const sprint = f1SessionResults(meta('sprint'), [row('A', 9, 9, 'X'), row('B', 1, 1, 'X')]);
  assert.match(by(sprint, 'player:f1:A')[0].title, /P9: no points, behind teammate/);
  assert.deepEqual(by(sprint, 'player:f1:A').map((e) => [e.type, e.aliases]), [['f1.driver.out_of_points', ['f1.driver.beaten_by_teammate']]]);

  // Unknown grid (0) never claims "lost places".
  assert.equal(f1SessionResults(meta('race'), [row('A', 9, 0, 'X')]).length, 0);
  // Exactly 3 places lost counts; 2 does not.
  assert.equal(f1SessionResults(meta('race'), [row('A', 8, 5, 'X')])[0].type, 'f1.driver.lost_places');
  assert.equal(f1SessionResults(meta('race'), [row('A', 7, 5, 'X')]).length, 0);

  // 20-car qualifying: P11-15 out in Q2, P16-20 out in Q1.
  const q = f1SessionResults(meta('qual'), Array.from({ length: 20 }, (_, i) => row(`Q${i + 1}`, i + 1, 0, 'X')));
  assert.equal(q.length, 10);
  assert.match(by(q, 'player:f1:Q15')[0].title, /Q2 \(P15\)/);
  assert.match(by(q, 'player:f1:Q16')[0].title, /Q1 \(P16\)/);

  assert.equal(isOut('STATUS_CLASSIFIED'), false);
  assert.equal(isOut('STATUS_RETIRED'), true);
  assert.equal(isOut('STATUS_NOT_CLASSIFIED'), true);
});

test('per-player/team alert choices override the global settings', async () => {
  const { mergeTargetTypes } = await import('../src/fanout.ts');
  const JONES = 'player:nfl:1', OTHER_QB = 'player:nfl:2';
  const int = (targetKey: string) => ({ type: 'nfl.qb.interception', targetKey });

  // Interceptions on globally, off just for Daniel Jones.
  const p = prefs({ targetTypes: { [JONES]: { 'nfl.qb.interception': false } } });
  assert.equal(wants(p, int(JONES), 'nfl'), false, 'off for Jones');
  assert.equal(wants(p, int(OTHER_QB), 'nfl'), true, 'still on for every other QB');

  // The reverse: off globally (even the whole NFL), but explicitly on for Jones → Jones wins.
  const q = prefs({ types: { 'nfl.qb.interception': false }, leagues: { nfl: false }, targetTypes: { [JONES]: { 'nfl.qb.interception': true } } });
  assert.equal(wants(q, int(JONES), 'nfl'), true);
  assert.equal(wants(q, int(OTHER_QB), 'nfl'), false);

  // "One alert, not two" rules use the same per-target answer: NOBLETIGER off for this team only
  // means that team's stranded-runners alert comes through instead.
  const TEAM = 'team:mlb:22';
  const r = prefs({ targetTypes: { [TEAM]: { 'mlb.team.nobletiger': false } } });
  assert.equal(shouldDeliver(r, { type: 'mlb.team.stranded_risp', targetKey: TEAM, unless: 'mlb.team.nobletiger' }, 'mlb'), true);
  assert.equal(shouldDeliver(r, { type: 'mlb.team.stranded_risp', targetKey: 'team:mlb:15', unless: 'mlb.team.nobletiger' }, 'mlb'), false);

  // Merging a patch: true/false set, null resets to global, junk is ignored, empty targets disappear.
  let t = mergeTargetTypes({}, { [JONES]: { 'nfl.qb.interception': false, 'nfl.qb.sacked': true } });
  assert.deepEqual(t, { [JONES]: { 'nfl.qb.interception': false, 'nfl.qb.sacked': true } });
  t = mergeTargetTypes(t, { [JONES]: { 'nfl.qb.sacked': null, 'not.a.type': true } as any, 'bogus key': { 'nfl.qb.sacked': true } });
  assert.deepEqual(t, { [JONES]: { 'nfl.qb.interception': false } });
  t = mergeTargetTypes(t, { [JONES]: { 'nfl.qb.interception': null } });
  assert.deepEqual(t, {}, 'resetting the last override removes the target entirely');
});

test('per-alert 🔔: an alert can go to the feed without a push, globally or for one player or team', async () => {
  const { pushWanted, setPrefs, publish, setPushSender } = await import('../src/fanout.ts');
  const { db } = await import('../src/db.ts');
  const JONES = 'player:nfl:1', OTHER_QB = 'player:nfl:2';
  const int = (targetKey: string) => ({ type: 'nfl.qb.interception', targetKey });

  assert.equal(pushWanted(prefs(), int(JONES), 'nfl'), true, 'default: an interception pushes');
  const feedOnly = prefs({ pushTypes: { 'nfl.qb.interception': false } });
  assert.equal(shouldDeliver(feedOnly, int(JONES), 'nfl'), true, 'feed-only still lands in the feed');
  assert.equal(pushWanted(feedOnly, int(JONES), 'nfl'), false);

  // One player's own bell beats the Settings bell, both ways.
  const jonesLoud = prefs({ pushTypes: { 'nfl.qb.interception': false }, targetPushTypes: { [JONES]: { 'nfl.qb.interception': true } } });
  assert.equal(pushWanted(jonesLoud, int(JONES), 'nfl'), true);
  assert.equal(pushWanted(jonesLoud, int(OTHER_QB), 'nfl'), false);
  const jonesQuiet = prefs({ targetPushTypes: { [JONES]: { 'nfl.qb.interception': false } } });
  assert.equal(pushWanted(jonesQuiet, int(JONES), 'nfl'), false);
  assert.equal(pushWanted(jonesQuiet, int(OTHER_QB), 'nfl'), true);

  // An alert that counts for several types follows the most specific one that's switched on.
  const homer = { type: 'mlb.pitcher.home_run_allowed', aliases: ['mlb.pitcher.runs_allowed'], targetKey: 'player:mlb:9' };
  assert.equal(pushWanted(prefs({ pushTypes: { 'mlb.pitcher.home_run_allowed': false } }), homer, 'mlb'), false, 'homers feed-only, runs pushed: the homer is quiet');
  assert.equal(pushWanted(prefs({ types: { 'mlb.pitcher.home_run_allowed': false } }), homer, 'mlb'), false, 'homers switched off: it arrives as a run, and runs are feed only by default');
  assert.equal(pushWanted(prefs({ types: { 'mlb.pitcher.home_run_allowed': false }, pushTypes: { 'mlb.pitcher.home_run_allowed': false, 'mlb.pitcher.runs_allowed': true } }), homer, 'mlb'), true, '…and with the runs 🔔 on, it pushes');
  assert.equal(pushWanted(prefs({ types: { 'nfl.qb.interception': false } }), int(JONES), 'nfl'), false, 'an alert that is not wanted never pushes');

  // End to end: the feed-only alert is stored and delivered, but no notification is sent for it.
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('bell', 's', 'ios', 'ExponentPushToken[test]', JSON.stringify(DEFAULT_PREFS));
  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('bell', JONES);
  setPrefs('bell', { pushTypes: { 'nfl.qb.interception': false }, targetPushTypes: { [JONES]: { 'nfl.qb.sacked': true }, 'bogus key': { 'nfl.qb.sacked': false } } });
  const sent: { data: Record<string, unknown> }[] = [];
  setPushSender((msgs) => sent.push(...msgs));
  publish([
    { id: 'bell:pick', type: 'nfl.qb.interception', targetKey: JONES, title: 'Jones threw a pick', body: '', at: 1 },
    { id: 'bell:sack', type: 'nfl.qb.sacked', targetKey: JONES, title: 'Jones got sacked', body: '', at: 2 },
  ], 'nfl');
  const rows = db.prepare("SELECT event_id, pushed FROM feed WHERE device_id = 'bell' ORDER BY event_id").all() as { event_id: string; pushed: number }[];
  assert.deepEqual(rows.map((r) => [r.event_id, r.pushed]), [['bell:pick', 0], ['bell:sack', 1]]);
  assert.deepEqual(sent.map((m) => m.data.eventId), ['bell:sack']);
  setPushSender(() => {});
});

test('ordinals and search normalization', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  assert.equal(normalize('Ronald Acuña Jr.'), 'ronald acuna jr');
  assert.equal(normalize("De'Aaron Fox"), 'de aaron fox');
});

test('NFL: the opponent recovering an onside kick (real kickoff text, TEN @ BAL)', async () => {
  const { db } = await import('../src/db.ts');
  const { loadCatalog } = await import('../src/catalog.ts');
  // Team codes for the "RECOVERED by TEN-…" fallback. Last test in the file, so nothing else sees this catalog.
  const team = db.prepare(`INSERT OR IGNORE INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, 'nfl', ?, ?, ?, ?, '#000', 'x', 1, 1, 0)`);
  team.run('team:nfl:10', '10', 'Tennessee Titans', 'Titans', 'TEN');
  team.run('team:nfl:33', '33', 'Baltimore Ravens', 'Ravens', 'BAL');
  loadCatalog();
  const g: any = { league: 'nfl', gameId: 'g', homeId: '33', awayId: '10', goalies: new Map() };
  // Core plays: teamId is start.team (the kicking team), endTeamId is end.team (who has the ball after).
  const kick = (text: string, endTeamId?: string) =>
    play({ id: 'k', type: 'Kickoff', typeSlug: 'K', text, teamId: '10', endTeamId, participants: [{ id: '1', role: 'kicker' }] });
  const onside = (p: ReturnType<typeof play>) => PLAYER_DETECTORS.nfl(g, p).filter((e) => e.type === 'nfl.team.onside_recovered');

  assert.deepEqual(onside(kick("J.Slye kicks onside 9 yards from TEN 35 to TEN 44. M.Starks (didn't try to advance) to TEN 44 for no gain.", '33')), [],
    'the real one failed: Baltimore had the ball at the end');
  const [kept] = onside(kick('J.Slye kicks onside 11 yards from TEN 35 to TEN 46. RECOVERED by TEN-J.Smith.', '10'));
  assert.equal(kept.targetKey, 'team:nfl:33', 'the receiving team gets the alert');
  assert.equal(kept.title, 'Titans recovered an onside kick against the Ravens');
  assert.equal(onside(kick('J.Slye kicks onside 11 yards from TEN 35 to TEN 46. RECOVERED by TEN-J.Smith.')).length, 1, 'no end team: the RECOVERED by text decides');
  assert.equal(onside(kick('J.Slye kicks onside 11 yards from TEN 35 to TEN 46. MUFFS, RECOVERED by TEN-J.Smith, RECOVERED by BLT-R.Smith.')).length, 0,
    'the last recovery counts, and NFL codes (BLT) map to ESPN abbreviations (BAL)');
  assert.equal(onside(kick('J.Slye kicks onside 11 yards from TEN 35 to TEN 46. RECOVERED by TEN-J.Smith. PENALTY on TEN-X.Young, Offside on Free Kick, 5 yards, enforced at TEN 35 - No Play.', '10')).length, 0,
    'wiped out by a penalty');
  assert.equal(onside(kick('J.Slye kicks 65 yards from TEN 35 to BAL 0. Touchback.', '10')).length, 0, 'an ordinary kickoff is never an onside kick');
});
