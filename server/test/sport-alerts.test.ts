// The sport-by-sport alerts (October 2026), on the wording ESPN uses (from 2025-26 games), and how each
// keeps to one alert per device: in place of the alert it says more than, or a line on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, publish, setPushSender, feedItem } = await import('../src/fanout.ts');
const d = await import('../src/detectors.ts');
const { PLAYER_DETECTORS, observePlay, teamScoreEvents, bundleByPlay, pitcherEvents, nflDriveEvents, soccerCommentaryEvents, lossFacts, gameLostEvent, boxPlayerFacts, playerFinalEvents, scorelessAtHalf } = d;
const { f1SessionResults, backOfGrid } = await import('../src/f1.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, short, abbr] of [
  ['mlb', '10', 'New York Yankees', 'Yankees', 'NYY'], ['mlb', '30', 'Tampa Bay Rays', 'Rays', 'TB'],
  ['nba', '2', 'Boston Celtics', 'Celtics', 'BOS'], ['nba', '18', 'New York Knicks', 'Knicks', 'NY'],
  ['nhl', '5', 'Pittsburgh Penguins', 'Penguins', 'PIT'], ['nhl', '13', 'New York Rangers', 'Rangers', 'NYR'],
  ['nfl', '9', 'Green Bay Packers', 'Packers', 'GB'], ['nfl', '28', 'Washington Commanders', 'Commanders', 'WSH'],
  ['epl', '371', 'West Ham United', 'West Ham', 'WHU'], ['epl', '363', 'Chelsea', 'Chelsea', 'CHE'],
  ['f1', 'mclaren', 'McLaren', 'McLaren', 'MCL'], ['f1', 'aston', 'Aston Martin', 'Aston Martin', 'AMR'],
]) team.run(`team:${lg}:${id}`, lg, id, name, short, abbr);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [lg, id, name, pos, t] of [
  ['mlb', '32081', 'Gerrit Cole', 'SP', '10'], ['mlb', '33192', 'Aaron Judge', 'RF', '10'], ['mlb', '42547', 'Anthony Volpe', 'SS', '10'], ['mlb', '4000', 'Austin Wells', 'C', '10'],
  ['mlb', '4683371', 'Junior Caminero', '3B', '30'], ['mlb', '5000', 'Yandy Diaz', '1B', '30'],
  ['nba', '4065648', 'Jayson Tatum', 'F', '2'], ['nba', '3934672', 'Jalen Brunson', 'G', '18'],
  ['nhl', '3124', 'Evgeni Malkin', 'C', '5'], ['nhl', '3114', 'Tristan Jarry', 'G', '5'], ['nhl', '5100', 'Alex Nedeljkovic', 'G', '5'], ['nhl', '5200', 'Artemi Panarin', 'LW', '13'],
  ['nfl', '3139477', 'Jordan Love', 'QB', '9'], ['nfl', '4000400', 'Malik Willis', 'QB', '9'], ['nfl', '4362921', 'Josh Jacobs', 'RB', '9'], ['nfl', '3054211', 'Aaron Banks', 'G', '9'],
  ['epl', '170376', 'Niclas Füllkrug', 'F', '371'], ['epl', '228102', 'Callum Wilson', 'F', '371'],
  ['f1', '5579', 'Lando Norris', '', 'mclaren'], ['f1', '5752', 'Oscar Piastri', '', 'mclaren'], ['f1', '4396', 'Lance Stroll', '', 'aston'], ['f1', '348', 'Fernando Alonso', '', 'aston'],
]) player.run(`player:${lg}:${id}`, lg, id, name, pos, `team:${lg}:${t}`);
loadCatalog();

const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
const fan = (id: string, keys: string[], prefs: object = {}) => { device.run(id, 's', 'ios', `tok-${id}`, JSON.stringify({ ...DEFAULT_PREFS, ...prefs })); for (const k of keys) follow.run(id, k); };
const pushes: { to: string; title: string }[] = [];
setPushSender((m) => pushes.push(...m));
const got = (dev: string) => (db.prepare('SELECT e.*, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all(dev) as any[])
  .map(feedItem).map((i) => `${i.type}: ${i.title} | ${i.body}`);
const types = (es: { type: string; aliases?: string[] }[]) => es.map((e) => [e.type, ...(e.aliases ?? [])].join(' / '));

// ─── MLB ──────────────────────────────────────────────────────────────────────────────────────
const mlbCtx = (): any => ({ league: 'mlb', gameId: 'M', homeId: '10', awayId: '30', goalies: new Map() });
let n = 0;
const ab = (half: string, text: string, pitcher: string, batter: string, x: object = {}) => ({ id: `ab${n++}`, type: 'Play Result', typeSlug: 'play-result', text, teamId: half.startsWith('Top') ? '30' : '10',
  period: { type: half.split(' ')[0], number: Number(half.split(' ')[1]) }, participants: [{ id: pitcher, role: 'pitcher' }, { id: batter, role: 'batter' }], scoring: false, scoreValue: 0, home: 0, away: 0, at: 0, shooting: false, ...x });
const run = (g: any, p: any) => { const es = PLAYER_DETECTORS.mlb(g, p); observePlay(g, p); return es; };

test('MLB: the 3rd and 4th strikeouts are a hat trick and a golden sombrero, in place of the strikeout', () => {
  const g = mlbCtx();
  for (let i = 0; i < 2; i++) assert.deepEqual(types(run(g, ab('Bottom 2', 'Judge struck out swinging.', '5000', '33192'))), ['mlb.batter.strikeout']);
  const third = run(g, ab('Bottom 5', 'Judge struck out looking.', '5000', '33192'));
  assert.deepEqual(third.map((e) => [e.type, e.title, e.aliases]), [['mlb.batter.multi_strikeout', 'Aaron Judge struck out for the 3rd time: a hat trick 🎩', ['mlb.batter.strikeout']]]);
  assert.match(run(g, ab('Bottom 7', 'Judge struck out swinging.', '5000', '33192'))[0].title, /4th time: a golden sombrero$/);
});

test("MLB: a run handed over, once, whoever's it is (wild pitch, balk, passed ball, a bases-loaded walk)", () => {
  const g = mlbCtx();
  // ESPN posts a wild pitch's run twice, as the "Wild Pitch" play and the "Play Result", same text.
  const wp = { ...ab('Top 3', 'Diaz scored on Cole wild pitch.', '32081', '4683371', { scoring: true, scoreValue: 1, away: 1 }), type: 'Wild Pitch', typeSlug: 'wild-pitch', participants: [{ id: '32081', role: 'pitcher' }] };
  const a = run(g, wp), b = run(g, { ...wp, id: 'wp-result', type: 'Play Result', typeSlug: 'play-result' });
  assert.deepEqual(a.map((e) => [e.type, e.title, e.aliases]), [['mlb.pitcher.gift_run', 'Gerrit Cole let a run score on a wild pitch', ['mlb.pitcher.runs_allowed']]]);
  assert.equal(a[0].id, b[0].id, 'one alert, whichever ESPN posts first');
  assert.equal(run(g, { ...wp, id: 'balk', text: 'Diaz scored on a balk.' })[0].title, 'Gerrit Cole balked in a run');
  const walk = run(g, ab('Top 4', 'Diaz walked, Caminero scored, Lowe to second, Arozarena to third.', '32081', '5000', { scoring: true, scoreValue: 1, away: 2 }));
  assert.deepEqual(walk.map((e) => [e.type, e.title, e.aliases]), [['mlb.pitcher.gift_run', 'Gerrit Cole walked in a run', ['mlb.pitcher.runs_allowed', 'mlb.pitcher.walk']]], 'not "gave up a run" and "issued a walk"');
  const pb = run(g, { ...wp, id: 'pb', text: 'Caminero scored on a passed ball by Wells, Diaz to second on passed ball by Wells.' });
  assert.deepEqual(pb.filter((e) => e.targetKey.startsWith('player:')).map((e) => [e.type, e.targetKey, e.title]), [
    ['mlb.pitcher.runs_allowed', 'player:mlb:32081', 'Gerrit Cole gave up 1 run'],
    ['mlb.catcher.passed_ball', 'player:mlb:4000', 'Austin Wells let a run score on a passed ball'],
  ]);
});

test('MLB: back-to-back homers off one pitcher; outs on the bases, the batter\'s and a runner\'s', () => {
  const g = mlbCtx();
  assert.deepEqual(types(run(g, ab('Top 6', 'Caminero homered to left (402 feet).', '32081', '4683371', { scoring: true, scoreValue: 1 }))), ['mlb.pitcher.home_run_allowed / mlb.pitcher.runs_allowed']);
  const b2b = run(g, ab('Top 6', 'Diaz homered to right (380 feet).', '32081', '5000', { scoring: true, scoreValue: 1 }));
  assert.deepEqual(b2b.map((e) => [e.title, e.aliases]), [['Gerrit Cole gave up back-to-back homers', ['mlb.pitcher.home_run_allowed', 'mlb.pitcher.runs_allowed']]]);
  assert.deepEqual(run(g, ab('Bottom 6', 'Judge doubled to left, Judge out stretching at third.', '5000', '33192')).map((e) => [e.type, e.title]),
    [['mlb.runner.out_on_bases', 'Aaron Judge got thrown out stretching at third']]);
  assert.deepEqual(run(g, ab('Bottom 7', 'Wells lined into double play, pitcher to first, Volpe doubled off first.', '5000', '4000')).map((e) => [e.type, e.targetKey, e.title]), [
    ['mlb.batter.double_play', 'player:mlb:4000', 'Austin Wells lined into a double play'],
    ['mlb.runner.out_on_bases', 'player:mlb:42547', 'Anthony Volpe got doubled off first'],
  ]);
});

test('MLB: being no-hit through 6, once, only from a hit count ESPN gave', () => {
  const g = mlbCtx();
  const end = (half: string) => ({ ...ab(half, 'End of inning', '5000', '33192'), typeSlug: 'end-inning', type: 'End Inning', participants: [] });
  run(g, ab('Bottom 6', 'Judge flied out to center.', '5000', '33192', { outs: 3 }));
  assert.deepEqual(run(g, end('Bottom 6')).filter((e) => e.type === 'mlb.team.no_hit'), [], 'no hit count yet: no guess');
  const h = mlbCtx();
  run(h, ab('Bottom 6', 'Judge flied out to center.', '5000', '33192', { outs: 3, hits: { home: 0, away: 4 } }));
  assert.deepEqual(run(h, end('Bottom 6')).filter((e) => e.type === 'mlb.team.no_hit').map((e) => e.title), ['Yankees are being no-hit through 6']);
  run(h, ab('Bottom 7', 'Judge flied out to center.', '5000', '33192', { outs: 3, hits: { home: 0, away: 5 } }));
  assert.deepEqual(run(h, end('Bottom 7')).filter((e) => e.type === 'mlb.team.no_hit'), [], 'once a game');
});

test('MLB: chased early, and when "no quality start" came first, a line on it without a push', () => {
  fan('cole-fan', ['player:mlb:32081']);
  const g = mlbCtx(), done = new Set<string>();
  const cole = (outs: number, er: number, active: boolean) => [{ id: '32081', teamId: '10', starter: true, active, ip: `${Math.floor(outs / 3)}.${outs % 3}`, outs, er, line: `${Math.floor(outs / 3)}.${outs % 3} IP, ${er} ER`, notes: [] }];
  publish(bundleByPlay(pitcherEvents(g, cole(5, 4, true), { final: false, score: { home: 0, away: 4 }, at: 1 }, done)), 'mlb'); // a 4th earned run in the 2nd
  publish(bundleByPlay(pitcherEvents(g, cole(6, 5, false), { final: false, score: { home: 0, away: 5 }, at: 2 }, done)), 'mlb'); // and the hook
  assert.deepEqual(got('cole-fan'), ['mlb.pitcher.no_quality_start: No quality start for Gerrit Cole: 4 earned runs in 1.2 innings | Chased after 2 innings. 1.2 IP, 4 ER — TB 4, NYY 0']);
  assert.equal(pushes.filter((p) => p.to === 'tok-cole-fan').length, 0, 'feed only, like "no quality start"');
  // Pulled before 3 innings in one read: one alert, chased (and counting as no quality start).
  const one = pitcherEvents(mlbCtx(), cole(7, 6, false), { final: false, score: { home: 0, away: 6 }, at: 3 }, new Set());
  assert.deepEqual(one.map((e) => [e.title, e.aliases]), [['Gerrit Cole got chased after 2.1 innings (6 earned runs)', ['mlb.pitcher.no_quality_start']]]);
});

// ─── NBA ──────────────────────────────────────────────────────────────────────────────────────
const nbaCtx = (): any => ({ league: 'nba', gameId: 'B', homeId: '2', awayId: '18', goalies: new Map() });
const foul = (i: number) => ({ id: `f${i}`, type: 'Personal Foul', typeSlug: '', text: 'Jayson Tatum personal foul', teamId: '2', participants: [{ id: '4065648' }], scoring: false, scoreValue: 0, home: 0, away: 0, at: 0, shooting: false });

test('NBA: the 6th personal foul is fouling out, in place of the foul (technicals don\'t count)', () => {
  const g = nbaCtx();
  const nb = (p: any) => { const es = PLAYER_DETECTORS.nba(g, p); observePlay(g, p); return es; };
  for (let i = 1; i <= 5; i++) nb(foul(i));
  nb({ ...foul(55), type: 'Technical Foul', text: 'Jayson Tatum technical foul' });
  assert.deepEqual(nb(foul(6)).map((e) => [e.type, e.title, e.aliases]), [['nba.fouled_out', 'Jayson Tatum fouled out', ['nba.foul']]]);
  // An offensive foul and the turnover ESPN logs for it at the same moment are one foul (Hamby, 2025); the
  // turnover alone is one too (Nelson-Ododa's box score counts those).
  const h = nbaCtx(), at = (i: number, type: string, clockSec: number) => ({ ...foul(100 + i), type, text: `Jayson Tatum ${type.toLowerCase()}`, periodNum: 2, clockSec });
  const fouls: string[] = [];
  for (const [i, [type, sec]] of ([['Offensive Foul', 82], ['Offensive Foul Turnover', 82], ['Offensive Foul Turnover', 60], ['Personal Foul', 50], ['Offensive Foul', 40], ['Offensive Foul Turnover', 40], ['Shooting Foul', 30], ['Loose Ball Foul', 20]] as const).entries()) {
    const es = PLAYER_DETECTORS.nba(h, at(i, type, sec)); observePlay(h, at(i, type, sec));
    fouls.push(...es.filter((e) => e.type === 'nba.fouled_out').map(() => type));
  }
  assert.deepEqual(fouls, ['Loose Ball Foul'], 'the 6th: two offensive fouls with their turnovers, one turnover alone, three others');
  // A 6th that's a turnover alone: fouling out is the alert, the turnover a line on it.
  fan('tatum-fan', ['player:nba:4065648']);
  const k = nbaCtx();
  for (let i = 0; i < 5; i++) { const f = at(10 + i, 'Personal Foul', 100 - i); PLAYER_DETECTORS.nba(k, f); observePlay(k, f); }
  publish(bundleByPlay(PLAYER_DETECTORS.nba(k, { ...at(20, 'Offensive Foul Turnover', 12), text: 'Jayson Tatum offensive foul turnover' })), 'nba');
  assert.deepEqual(got('tatum-fan'), ['nba.fouled_out: Jayson Tatum fouled out | Jayson Tatum turned it over. Jayson Tatum offensive foul turnover — NY 0, BOS 0']);
});

test('NBA: a 14-0 run against them, once a run, and the box score\'s bad nights', () => {
  const g = nbaCtx();
  const score = (home: number, away: number, prev: { home: number; away: number }) => teamScoreEvents(g, prev, { id: `s${home}-${away}`, type: 'Jump Shot', typeSlug: '', text: 'shot', participants: [], scoring: true, scoreValue: 2, home, away, at: 0, shooting: true } as any);
  let prev = { home: 40, away: 30 };
  const runs: string[] = [];
  for (const away of [33, 36, 39, 42, 44, 46]) { runs.push(...score(40, away, prev).filter((e) => e.type === 'nba.team.opponent_run').map((e) => e.title)); prev = { home: 40, away }; }
  assert.deepEqual(runs, ['Knicks are on a 14-0 run against the Celtics'], 'when it reaches 14, not again at 16');
  score(42, 46, prev); // the Celtics score: the run is over
  // The box score: Tatum's brick night, Brunson's 41 (in the Celtics' loss).
  const box = { boxscore: { players: [
    { team: { id: '2' }, statistics: [{ labels: ['MIN', 'PTS', 'FG', '3PT', 'FT'], athletes: [{ athlete: { id: '4065648' }, stats: ['38', '12', '5-19', '0-7', '2-2'] }] }] },
    { team: { id: '18' }, statistics: [{ labels: ['MIN', 'PTS', 'FG', '3PT', 'FT'], athletes: [{ athlete: { id: '3934672' }, stats: ['40', '41', '15-24', '5-9', '6-6'] }] }] },
  ] } };
  assert.deepEqual(boxPlayerFacts('nba', box).map((f) => f.title), ['Jayson Tatum shot 5-for-19, 0-for-7 from three']);
  const lost = gameLostEvent(g, { home: 100, away: 112 }, 0)!;
  assert.deepEqual(lossFacts(g, lost, { home: 100, away: 112 }, { box }).map((f) => [f.type, f.fold, f.foldOnly]), [['nba.team.star_went_off', 'Jalen Brunson scored 41 on them.', true]]);
  assert.deepEqual(scorelessAtHalf(g, { boxscore: { players: [{ team: { id: '2' }, statistics: [{ labels: ['MIN', 'PTS', 'FG', '3PT'], athletes: [{ athlete: { id: '4065648' }, stats: ['16', '0', '0-6', '0-3'] }] }] }] } }).map((e) => e.title),
    ['Jayson Tatum is scoreless at the half: 0-6 from the field']);
});

// ─── NHL ──────────────────────────────────────────────────────────────────────────────────────
const nhlCtx = (): any => ({ league: 'nhl', gameId: 'H', homeId: '5', awayId: '13', goalies: new Map([['5', '3114']]) });
const puck = (id: string, type: string, x: object = {}) => ({ id, type, typeSlug: '', text: type, teamId: '13', participants: [], scoring: false, scoreValue: 0, home: 0, away: 0, at: 0, shooting: false, periodNum: 1, ...x });
const nh = (g: any, p: any) => { const es = PLAYER_DETECTORS.nhl(g, p); observePlay(g, p); return es; };
const shot = (id: string, saver: string, x: object = {}) => puck(id, 'Shot', { participants: [{ id: '5200', role: 'shooter' }, { id: saver, role: 'saver' }], ...x });

test("NHL: a goalie pulled, from the new goalie's first save, once", () => {
  const g = nhlCtx();
  nh(g, shot('s1', '3114'));
  nh(g, puck('g1', 'Goal', { scoring: true, scoreValue: 1, away: 1, participants: [{ id: '5200', role: 'scorer' }], strength: 'Even Strength' }));
  nh(g, puck('g2', 'Goal', { scoring: true, scoreValue: 1, away: 2, participants: [{ id: '5200', role: 'scorer' }], strength: 'Power Play' }));
  const pulled = nh(g, shot('s2', '5100', { periodNum: 2, away: 2 })).filter((e) => e.type === 'nhl.goalie.pulled');
  assert.deepEqual(pulled.map((e) => [e.targetKey, e.title, e.body]), [['player:nhl:3114', 'Tristan Jarry got pulled after allowing 2 goals on 3 shots', 'Alex Nedeljkovic is in net — NYR 2, PIT 0']]);
  assert.deepEqual(nh(g, shot('s3', '5100', { periodNum: 2 })).filter((e) => e.type === 'nhl.goalie.pulled'), [], 'his next save is nothing new');
  // The first goalie the box score names can be the backup: the starter's first save isn't a pull.
  const h = { ...nhlCtx(), goalies: new Map([['5', '5100']]) };
  assert.deepEqual(nh(h, shot('t1', '3114')).filter((e) => e.type === 'nhl.goalie.pulled'), []);
});

test('NHL: a shootout miss or stop in place of the shot; a fight in place of the penalty', () => {
  const g = nhlCtx();
  nh(g, puck('so0', 'Shootout', { text: 'Start of Shootout', periodNum: 5 }));
  const so = (id: string, type: string) => nh(g, puck(id, type, { teamId: '5', periodNum: 5, participants: [{ id: '3124', role: 'shooter' }, ...(type === 'Shot' ? [{ id: '9', role: 'saver' }] : [])] }));
  assert.deepEqual(so('so1', 'Shot').map((e) => [e.type, e.title, e.aliases, e.body]), [['nhl.shootout_miss', 'Evgeni Malkin got stopped in the shootout', ['nhl.shot_saved'], 'Shootout: Shot']], "no score: the play's isn't the game's");
  assert.deepEqual(so('so2', 'Missed').map((e) => [e.type, e.title, e.aliases]), [['nhl.shootout_miss', 'Evgeni Malkin missed in the shootout', ['nhl.shot_missed']]]);
  const fight = nh(nhlCtx(), puck('p1', 'Fighting', { teamId: '5', text: 'Evgeni Malkin Fighting against Artemi Panarin', penaltyMinutes: 5, participants: [{ id: '3124' }], periodNum: 2, clockSec: 600 }));
  assert.deepEqual(fight.map((e) => [e.type, e.title, e.aliases]), [['nhl.fight', 'Evgeni Malkin dropped the gloves with Artemi Panarin', ['nhl.penalty']]]);
});

test("NHL: an empty-netter or a short-handed goal against is that goal's one alert for the team", () => {
  fan('pens-fan', ['team:nhl:5']);
  const goal = (id: string, strength: string, away: number) => publish(bundleByPlay(teamScoreEvents(nhlCtx(), { home: 2, away: away - 1 }, puck(id, 'Goal', { scoring: true, scoreValue: 1, home: 2, away, strength, text: `Panarin goal (${strength})` }) as any)), 'nhl');
  goal('en', 'Empty Net', 4);
  goal('sh', 'Shorthanded', 2);
  assert.deepEqual(got('pens-fan'), [
    'nhl.team.empty_net_goal: Penguins gave up an empty-netter to the Rangers | Panarin goal (Empty Net) — NYR 4, PIT 2',
    'nhl.team.shorthanded_goal: Penguins gave up a short-handed goal to the Rangers | Panarin goal (Shorthanded) — NYR 2, PIT 2',
  ], 'not "Rangers scored" as well');
});

test("NHL: the box score's power play and minus, at the final", () => {
  const g = nhlCtx();
  const box = { boxscore: {
    teams: [{ team: { id: '5' }, statistics: [{ name: 'powerPlayGoals', displayValue: '0' }, { name: 'powerPlayOpportunities', displayValue: '5' }] }],
    players: [{ team: { id: '5' }, statistics: [{ name: 'forwards', labels: ['G', 'A', '+/-', 'TOI'], athletes: [{ athlete: { id: '3124' }, stats: ['0', '0', '-3', '18:02'] }] }] }],
  } };
  const lost = gameLostEvent(g, { home: 1, away: 4 }, 0)!;
  assert.deepEqual(lossFacts(g, lost, { home: 1, away: 4 }, { box }).map((f) => [f.type, f.fold, f.foldOnly]), [['nhl.team.power_play_fail', '0-for-5 on the power play.', true]]);
  assert.deepEqual(boxPlayerFacts('nhl', box).map((f) => [f.type, f.title, f.line]), [['nhl.minus', 'Evgeni Malkin finished -3', '0 G, 0 A, 18:02 TOI']]);
});

// ─── NFL ──────────────────────────────────────────────────────────────────────────────────────
const nflCtx = (): any => ({ league: 'nfl', gameId: 'F', homeId: '9', awayId: '28', goalies: new Map() });
const snap = (id: string, type: string, text: string, participants: object[], x: object = {}) => ({ id, type, typeSlug: '', text, teamId: '9', participants, scoring: false, scoreValue: 0, home: 0, away: 7, at: 0, shooting: false, periodNum: 2, ...x });
const nf = (g: any, p: any) => { const es = PLAYER_DETECTORS.nfl(g, p); observePlay(g, p); return es; };

test('NFL: the starting QB pulled (another QB throws twice in a row after his 5th pass), once a game', () => {
  const g = nflCtx();
  const pass = (id: string, qb: string) => nf(g, snap(id, 'Pass Reception', 'pass complete', [{ id: qb, role: 'passer' }]));
  for (let i = 0; i < 5; i++) assert.deepEqual(pass(`l${i}`, '3139477'), []);
  assert.deepEqual(pass('w1', '4000400'), [], 'one throw can be a package play');
  assert.deepEqual(pass('w2', '4000400').map((e) => [e.type, e.targetKey, e.title]), [['nfl.qb.pulled', 'player:nfl:3139477', 'Jordan Love got pulled: Malik Willis is in at quarterback']]);
  pass('l5', '3139477');
  pass('w3', '4000400');
  assert.deepEqual(pass('w4', '4000400'), [], 'once a game');
  // Early, before the starter's 5th pass, it's nothing: a package or a trick play.
  const h = nflCtx();
  for (const [id, qb] of [['a', '3139477'], ['b', '4000400'], ['c', '4000400']]) assert.deepEqual(nf(h, snap(id, 'Pass Reception', 'pass', [{ id: qb, role: 'passer' }])), []);
});

test("NFL: a touchdown wiped out by a penalty: the flagged player's (in place of his penalty) and his team's, one alert", () => {
  fan('packers-and-banks', ['team:nfl:9', 'player:nfl:3054211']);
  const text = 'J.Love pass short right to J.Jacobs for 12 yards, TOUCHDOWN NULLIFIED by Penalty. PENALTY on GB-A.Banks, Offensive Holding, 10 yards, enforced at WSH 22 - No Play.';
  const es = nf(nflCtx(), snap('td', 'Penalty', text, [{ id: '3139477', role: 'passer' }, { id: '3054211', role: 'penalized' }]));
  assert.deepEqual(es.map((e) => [e.type, e.targetKey, e.title, e.aliases]), [
    ['nfl.td_wiped_out', 'player:nfl:3054211', "Aaron Banks's penalty wiped out a touchdown", ['nfl.penalty']],
    ['nfl.td_wiped_out', 'team:nfl:9', 'Packers had a touchdown wiped out by a penalty', undefined],
  ]);
  publish(bundleByPlay(es), 'nfl');
  assert.deepEqual(got('packers-and-banks'), [`nfl.td_wiped_out: Aaron Banks's penalty wiped out a touchdown | Packers had a touchdown wiped out by a penalty. ${text} — WSH 7, GB 0`]);
});

test("NFL drives: three-and-out, on downs, empty in the red zone; the drive's result goes on the QB's alert for that play", () => {
  const drive = (id: string, result: string, display: string, plays: object[], x: object = {}) => ({ id, team: { id: '9' }, result, displayResult: display, description: `${plays.length} plays, 4 yards, 1:32`, offensivePlays: plays.length, yards: 4, plays, ...x });
  const play = (id: string, toGo: number) => ({ id, homeScore: 0, awayScore: 7, type: { text: 'Rush' }, start: { team: { id: '9' }, yardsToEndzone: toGo, downDistanceText: `1st & 10 at ${toGo > 50 ? `GB ${100 - toGo}` : `WSH ${toGo}`}` } });
  assert.deepEqual(nflDriveEvents(nflCtx(), drive('d1', 'PUNT', 'Punt', [play('a', 75), play('b', 73), play('c', 71)])).map((e) => e.title), ['Packers went three-and-out']);
  assert.deepEqual(nflDriveEvents(nflCtx(), drive('d2', 'DOWNS', 'Downs', [play('d', 40), play('e', 12), play('f', 9)], { yards: 31 })).map((e) => [e.type, e.title]), [
    ['nfl.team.turnover_on_downs', 'Packers turned it over on downs'],
    ['nfl.team.red_zone_empty', 'Packers came away empty from the red zone (downs)'],
  ]);
  assert.deepEqual(nflDriveEvents(nflCtx(), drive('d3', 'FG', 'Field Goal', [play('g', 15)])), [], 'a field goal is points');
  // ESPN's yardsToEndzone is 0 on a timeout and wrong on a punt: the down and distance says where they were.
  const timeout = { id: 't', type: { text: 'Timeout' }, start: { team: { id: '9' }, yardsToEndzone: 0, downDistanceText: '3rd & 1 at GB 30' } };
  const punt = { id: 'p', type: { text: 'Punt' }, start: { team: { id: '9' }, yardsToEndzone: 14, downDistanceText: '4th & 7 at GB 14' } };
  assert.deepEqual(nflDriveEvents(nflCtx(), drive('d5', 'PUNT', 'Punt', [play('i', 75), timeout, punt], { yards: 11 })), [], 'never past their own 30');
  // An interception in the red zone: Love's alert, and a poll later the drive's result as a line on it, no push.
  fan('packers-and-love', ['team:nfl:9', 'player:nfl:3139477']);
  const g = nflCtx(), mine = () => pushes.filter((x) => x.to === 'tok-packers-and-love').length;
  publish(bundleByPlay(nf(g, snap('int', 'Pass Interception Return', 'J.Love pass deep left INTERCEPTED by J.Whyte.', [{ id: '3139477', role: 'passer' }]))), 'nfl');
  publish(bundleByPlay(nflDriveEvents(g, drive('d4', 'INT', 'Interception', [play('h', 30), play('int', 14)]))), 'nfl');
  assert.deepEqual(got('packers-and-love'), ['nfl.qb.interception: Jordan Love threw an interception | No points from the red zone (interception). J.Love pass deep left INTERCEPTED by J.Whyte. — WSH 7, GB 0']);
  assert.equal(mine(), 1, 'the one push, for the interception');
});

// ─── Soccer ───────────────────────────────────────────────────────────────────────────────────
const eplCtx = (): any => ({ league: 'epl', gameId: 'E', homeId: '371', awayId: '363', goalies: new Map() });
const kick = (id: string, typeSlug: string, text: string, x: object = {}) => ({ id, type: typeSlug, typeSlug, text, teamId: '371', participants: [], scoring: false, scoreValue: 0, home: 0, away: 0, at: 0, shooting: false, ...x });

test('Soccer: a late goal against, in place of "falls behind" or "opponent scores"', () => {
  fan('hammers-fan', ['team:epl:371']);
  const goal = (id: string, clock: string, prev: { home: number; away: number }) => publish(bundleByPlay(teamScoreEvents(eplCtx(), prev,
    kick(id, 'goal', 'Goal! Chelsea scores.', { teamId: '363', scoring: true, scoreValue: 1, clock, home: prev.home, away: prev.away + 1 }) as any)), 'epl');
  goal('g1', "88'", { home: 1, away: 1 });
  goal('g2', "90'+3'", { home: 2, away: 1 });
  goal('g3', "70'", { home: 0, away: 0 });
  assert.deepEqual(got('hammers-fan').map((x) => x.split(' | ')[0]), [
    'epl.team.late_goal: Chelsea took the lead against West Ham in the 88th minute',
    "epl.team.late_goal: Chelsea equalized against West Ham in stoppage time (90'+3')",
    'team.fell_behind: Chelsea scored to take the lead over West Ham',
  ]);
});

test('Soccer: taken off by halftime (not hurt), the woodwork, and a goal ruled out by VAR (one alert for the scorer and his team)', () => {
  const sub = (clock: string, text = 'Callum Wilson replaces Niclas Füllkrug.') => PLAYER_DETECTORS.epl(eplCtx(), kick(`sub${clock}`, 'substitution', text, { clock, participants: [{ id: '228102', role: 'on' }, { id: '170376', role: 'off' }] })).map((e) => e.title);
  assert.deepEqual(sub("46'"), ['Niclas Füllkrug was taken off at halftime']);
  assert.deepEqual(sub("45'+2'"), ['Niclas Füllkrug was taken off at halftime'], "first-half stoppage time is the first half");
  assert.deepEqual(sub("31'"), ['Niclas Füllkrug was taken off in the 31st minute']);
  assert.deepEqual(sub("58'"), []);
  assert.deepEqual(sub("30'", 'Callum Wilson replaces Niclas Füllkrug because of an injury.'), []);
  const said = (typeSlug: string, text: string) => soccerCommentaryEvents(eplCtx(), kick(typeSlug, typeSlug, text, { participants: [{ id: '170376', role: 'player' }] }));
  assert.deepEqual(said('woodwork', "Niclas Füllkrug (West Ham United) hits the right post with a right footed shot from the centre of the box.").map((e) => e.title), ['Niclas Füllkrug hit the post']);
  fan('hammers-and-fullkrug', ['team:epl:371', 'player:epl:170376']);
  const var_ = said('var-no-goal', 'GOAL OVERTURNED BY VAR: Niclas Füllkrug (West Ham United) scores but the goal is ruled out after a VAR review.');
  assert.deepEqual(var_.map((e) => [e.targetKey, e.title]), [['player:epl:170376', 'Niclas Füllkrug had a goal ruled out by VAR'], ['team:epl:371', 'West Ham had a goal ruled out by VAR']]);
  publish(bundleByPlay(var_), 'epl');
  assert.deepEqual(got('hammers-and-fullkrug').map((x) => x.split(' | ')[0]), ['epl.goal_disallowed: Niclas Füllkrug had a goal ruled out by VAR']);
});

test('Soccer: into the relegation zone, with the drop that put them there as a line', async () => {
  const { kvSet } = await import('../src/db.ts');
  const { liveDeps, scanStandings } = await import('../src/live.ts');
  const { urls } = await import('../src/leagues.ts');
  fan('hammers-table', ['team:epl:371']);
  kvSet('standings:epl', { 371: { rank: 17, group: 'Premier League', clincher: '', streak: '' }, 363: { rank: 4, group: 'Premier League', clincher: '', streak: '' } });
  const entry = (id: string, rank: number, note?: string) => ({ team: { id }, stats: [{ name: 'rank', value: rank }], ...(note ? { note: { description: note } } : {}) });
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.standings('epl'))) return { name: 'English Premier League', abbreviation: 'Premier League', children: [{ name: '2026-27 English Premier League', abbreviation: '2026-2027', standings: { entries: [entry('371', 18, 'Relegation'), entry('363', 4)] } }] };
    throw new Error(`unexpected ${url}`);
  };
  try { await scanStandings('epl'); } finally { liveDeps.getJson = prev; }
  assert.deepEqual(got('hammers-table'), ['epl.team.relegation_zone: West Ham dropped into the relegation zone | Down to 18th in the Premier League. Down from 17th. Into the relegation zone 🪂']);
});

// ─── F1 ───────────────────────────────────────────────────────────────────────────────────────
const f1Meta = (kind: any) => ({ compId: `C-${kind}`, kind, label: 'Test GP', at: 0 });
const car = (id: string, order: number, grid: number, team: string, x: object = {}) => ({ id, order, grid, out: false, outLabel: '', lap: null, teamKey: `team:f1:${team}`, ...x });

test('F1: lapped, in the finish alert; the back of the grid at lights out', () => {
  const field = [car('5579', 1, 1, 'mclaren'), car('5752', 2, 2, 'mclaren'), car('348', 9, 9, 'aston'),
    ...Array.from({ length: 16 }, (_, i) => car(`x${i}`, i + 3 + (i >= 6 ? 1 : 0), i + 3 + (i >= 6 ? 1 : 0), `t${i}`)),
    car('4396', 20, 20, 'aston', { lapsDown: 2 })];
  const stroll = f1SessionResults(f1Meta('race'), field).filter((e) => e.targetKey === 'player:f1:4396');
  assert.deepEqual(stroll.map((e) => [e.type, e.title, e.aliases]), [['f1.driver.out_of_points', 'Lance Stroll finished P20: no points, 2 laps down, behind teammate Fernando Alonso (P9)', ['f1.driver.beaten_by_teammate', 'f1.driver.lapped']]]);
  assert.deepEqual(backOfGrid(f1Meta('race'), field).map((e) => e.title), ['Your tracked driver starts from the back of the grid (P19)', 'Lance Stroll starts from the back of the grid (P20)'], 'the last row: P19 and P20 of 20');
  assert.deepEqual(backOfGrid(f1Meta('race'), field.slice(0, 8)), [], 'not with a field this small (a bad read)');
});
