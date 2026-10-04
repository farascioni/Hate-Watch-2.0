import { test } from 'node:test';
import assert from 'node:assert/strict';

// The DB module opens its file on import, so point it at memory before loading app code.
process.env.HW_DB = ':memory:';
const { wants, inQuietHours, DEFAULT_PREFS } = await import('../src/fanout.ts');
const { parseStandings } = await import('../src/live.ts');
const { nextScore, ordinal, mergePlays, observePlay, mlbFinalHalfInning, PLAYER_DETECTORS } = await import('../src/detectors.ts');

const play = (o: object) => ({ id: '1', type: '', typeSlug: '', text: '', participants: [], scoring: false, scoreValue: 0, home: 0, away: 0, at: 0, shooting: false, ...o });
const { normalize } = await import('../src/catalog.ts');

const prefs = (over: object = {}) => ({ ...DEFAULT_PREFS, ...over });
const ev = { type: 'mlb.batter.strikeout', targetKey: 'player:mlb:1' };

test('type defaults come from the catalog', () => {
  assert.equal(wants(prefs(), ev, 'mlb'), true);
  assert.equal(wants(prefs(), { ...ev, type: 'mlb.batter.popout' }, 'mlb'), false); // defaultOn: false
});

test('user can turn a type off, a league off, or mute one target', () => {
  assert.equal(wants(prefs({ types: { 'mlb.batter.strikeout': false } }), ev, 'mlb'), false);
  assert.equal(wants(prefs({ leagues: { mlb: false } }), ev, 'mlb'), false);
  assert.equal(wants(prefs({ muted: ['player:mlb:1'] }), ev, 'mlb'), false);
  assert.equal(wants(prefs({ muted: ['player:mlb:2'] }), ev, 'mlb'), true);
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
  assert.match(run(['onFirst', 'onSecond', 'onThird'])[0].title, /left the bases loaded/);
  assert.equal(run(['onFirst']).length, 0, 'a runner on first is not in scoring position');
  assert.equal(run([]).length, 0);

  // The game's last half-inning has no End Inning play: checked at the final instead.
  const g = ctx(); observePlay(g, result(['onThird']));
  assert.equal(mlbFinalHalfInning(g).length, 1);
  const walkoff = ctx(); observePlay(walkoff, result(['onSecond'], { outs: 1 }));
  assert.equal(mlbFinalHalfInning(walkoff).length, 0, 'a walk-off ends with fewer than 3 outs');
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
  assert.equal(PLAYER_DETECTORS.mlb(g, play({ id: 'sb', typeSlug: 'stolen-base', teamId: '22', text: 'Butler stole second.' })).filter((e) => e.type === 'mlb.runner.caught_stealing').length, 0);
});

test('ordinals and search normalization', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  assert.equal(normalize('Ronald Acuña Jr.'), 'ronald acuna jr');
  assert.equal(normalize("De'Aaron Fox"), 'de aaron fox');
});
