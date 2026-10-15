// Football plays ESPN changes after it posts them (revisions.ts, live.ts), with October 10 2026's noon college games'
// own plays and wording (the recorder's first versions, the final summaries' last): an interception wiped out by a
// penalty, an incompletion that became an interception, a flag added later, a touchdown overturned on review and
// scored on the same drive, the same touchdown re-posted under three ids, the score ahead in the header while the
// drives lag, a stray "End of Game", drives whose result changed. Alerts still go out the moment a play is seen; what
// changes after is a line on them (no push), or the alert it should have been.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
let NOW = Date.parse('2026-10-10T18:00:00Z');
Date.now = () => NOW;
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');
const D = await import('../src/detectors.ts');
const R = await import('../src/revisions.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 500, 500, 0)`);
for (const [id, name, short, abbr] of [['84', 'Indiana Hoosiers', 'Indiana', 'IU'], ['158', 'Nebraska Cornhuskers', 'Nebraska', 'NEB'], ['12', 'Arizona Wildcats', 'Arizona', 'ARIZ'],
  ['277', 'West Virginia Mountaineers', 'West Virginia', 'WVU'], ['154', 'Wake Forest Demon Deacons', 'Wake Forest', 'WAKE'], ['152', 'NC State Wolfpack', 'NC State', 'NCSU'],
  ['245', 'Texas A&M Aggies', 'Texas A&M', 'TA&M'], ['142', 'Missouri Tigers', 'Missouri', 'MIZ'], ['2050', 'Ball State Cardinals', 'Ball State', 'BALL'], ['77', 'Northwestern Wildcats', 'Northwestern', 'NU'],
  ['151', 'East Carolina Pirates', 'East Carolina', 'ECU'], ['242', 'Rice Owls', 'Rice', 'RICE'], ['57', 'Florida Gators', 'Florida', 'FLA'], ['2579', 'South Carolina Gamecocks', 'South Carolina', 'SC'],
  ['48', 'Delaware Blue Hens', 'Delaware', 'DEL'], ['2393', 'Middle Tennessee Blue Raiders', 'MTSU', 'MTSU'],
  ['98', 'Western Kentucky Hilltoppers', 'Western KY', 'WKU'], ['2534', 'Sam Houston Bearkats', 'Sam Houston', 'SHSU']])
  team.run(`team:cfb:${id}`, 'cfb', id, name, short, abbr, short);
team.run('team:cfb:16', 'cfb', '16', 'Sacramento State Hornets', 'Sacramento St', 'SAC', 'Sacramento State'); // ESPN's code: "Sac St"
team.run('team:cfb:189', 'cfb', '189', 'Bowling Green Falcons', 'Bowling Green', 'BGSU', 'Bowling Green');
team.run('team:nfl:12', 'nfl', '12', 'Kansas City Chiefs', 'Chiefs', 'KC', 'Kansas City');
team.run('team:nfl:13', 'nfl', '13', 'Las Vegas Raiders', 'Raiders', 'LV', 'Las Vegas');
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, position, image, image_w, image_h, image_kind, updated_at) VALUES ('player:nfl:3139477', 'nfl', '3139477', 'Patrick Mahomes', 'team:nfl:12', 'QB', 'x', 1, 1, 'headshot', 0)`).run();
for (const [id, name, short, abbr, location] of [['5', 'Cleveland Browns', 'Browns', 'CLE', 'Cleveland'], ['23', 'Pittsburgh Steelers', 'Steelers', 'PIT', 'Pittsburgh'], ['6', 'Dallas Cowboys', 'Cowboys', 'DAL', 'Dallas'],
  ['28', 'Washington Commanders', 'Commanders', 'WSH', 'Washington'], ['3', 'Chicago Bears', 'Bears', 'CHI', 'Chicago'], ['16', 'Minnesota Vikings', 'Vikings', 'MIN', 'Minnesota'],
  ['2', 'Buffalo Bills', 'Bills', 'BUF', 'Buffalo'], ['17', 'New England Patriots', 'Patriots', 'NE', 'New England'], ['30', 'Jacksonville Jaguars', 'Jaguars', 'JAX', 'Jacksonville'],
  ['21', 'Philadelphia Eagles', 'Eagles', 'PHI', 'Philadelphia'], ['7', 'Denver Broncos', 'Broncos', 'DEN', 'Denver'], ['24', 'Los Angeles Chargers', 'Chargers', 'LAC', 'Los Angeles'],
  ['25', 'San Francisco 49ers', '49ers', 'SF', 'San Francisco'], ['26', 'Seattle Seahawks', 'Seahawks', 'SEA', 'Seattle'], ['34', 'Houston Texans', 'Texans', 'HOU', 'Houston'],
  ['10', 'Tennessee Titans', 'Titans', 'TEN', 'Tennessee'], ['20', 'New York Jets', 'Jets', 'NYJ', 'New York'], ['22', 'Arizona Cardinals', 'Cardinals', 'ARI', 'Arizona']])
  team.run(`team:nfl:${id}`, 'nfl', id, name, short, abbr, location);
const nflPlayer = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, position, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'nfl', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [id, name, teamId, position] of [['3122840', 'Deshaun Watson', '5', 'QB'], ['4685327', 'Daylen Everette', '23', 'CB'], ['2576980', 'Marcus Mariota', '28', 'QB'], ['4248911', 'DaRon Bland', '6', 'CB'], ['4431611', 'Caleb Williams', '3', 'QB'],
  ['4035791', 'Cole Van Lanen', '30', 'OT'], ['4242391', 'Robert Hainsey', '30', 'C'], ['4426448', 'Jarrian Jones', '30', 'CB'],
  ['3916655', 'Maxx Crosby', '13', 'DE'], ['4692048', 'Que Robinson', '7', 'LB'], ['3916903', 'Dre Greenlaw', '25', 'LB'], ['4575665', 'Jacob Cowing', '25', 'WR'], ['4360761', 'Michael Wilson', '22', 'WR'], ['3916800', 'Mack Wilson Sr.', '22', 'LB'], ['4432577', 'C.J. Stroud', '34', 'QB']])
  nflPlayer.run(`player:nfl:${id}`, id, name, `team:nfl:${teamId}`, position);
loadCatalog();

const pushes: { to: string; title: string }[] = [];
setPushSender((m) => pushes.push(...m));
const device = (id: string, ...targets: string[]) => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', `tok-${id}`, JSON.stringify(DEFAULT_PREFS));
  targets.forEach((t, i) => db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)').run(id, t, i));
};
/** A device's feed: each alert's type, title and the lines on it. */
const feed = (id: string) => (db.prepare('SELECT e.type, e.title, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all(id) as any[])
  .map((r) => [r.type, r.title, r.extra ? JSON.parse(r.extra) : []]);
const pushed = (id: string) => pushes.filter((p) => p.to === `tok-${id}`).map((p) => p.title.replace(/^\S+ /, ''));

// A summary's drive play, as ESPN posts it: the team with the ball under `start`, where it ends under `end`.
const play = (id: string, type: string, text: string, team: string, away: number, home: number, x: Record<string, any> = {}) =>
  ({ id, type: { text: type }, text, start: { team: { id: team } }, end: { team: { id: x.endTeam ?? team } }, awayScore: away, homeScore: home, period: { number: x.period ?? 3 },
    clock: { displayValue: x.clock ?? '10:00' }, scoringPlay: !!x.scoring, wallclock: new Date(NOW).toISOString() });

/**
 * A game read live: its summary (and the NFL's core plays) as `g` says, polled every 5 seconds of the fake clock. The
 * first read is a baseline, with the score so far (`was`: a scoring play from before, history).
 */
function game(league: 'cfb' | 'nfl', id: string, homeId: string, awayId: string, was = { away: 0, home: 0 }) {
  const old = { ...play(`${id}0`, 'Field Goal Good', 'field goal GOOD', homeId, was.away, was.home, { period: 1, scoring: true }), wallclock: new Date(NOW - 3600_000).toISOString() };
  const g = { state: 'in', ...was, period: 1, clock: '10:00', previous: [{ id: `${id}-1`, plays: [old] }] as any[], current: null as any, core: league === 'nfl' ? [old] : [] as any[] };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.summary(league, id))) return {
      header: { competitions: [{ status: { period: g.period, displayClock: g.clock, type: { state: g.state, completed: g.state === 'post', detail: g.state === 'post' ? 'Final' : '' } },
        competitors: [{ homeAway: 'home', id: homeId, score: String(g.home) }, { homeAway: 'away', id: awayId, score: String(g.away) }] }] },
      drives: { previous: g.previous, current: g.current },
    };
    if (league === 'nfl' && url.startsWith(urls.corePlays(league, id))) return { items: g.core };
    throw new Error(`unexpected fetch ${url}`);
  };
  const tracker = new GameTracker(league, id, homeId, awayId);
  return { g, tracker, poll: async (n = 1) => { for (let i = 0; i < n; i++) { NOW += 5000; await tracker.poll(); } } };
}

test('an interception wiped out by a penalty after it went out: a line on its alert, no second push; the flag that did it goes out (Indiana at Nebraska)', async () => {
  device('neb', 'team:cfb:158');
  device('iu', 'team:cfb:84');
  const T = game('cfb', '401858481', '158', '84', { away: 13, home: 17 });
  await T.poll(); // the first read: a baseline
  const pick = play('401858481541', 'Interception', '(11:09) No Huddle-Shotgun #10 A.Colandrea pass intercepted by #6 P.Zachman at IND43, End Of Play', '158', 13, 17, { endTeam: '84', period: 4, clock: '11:02' });
  T.g.current = { id: '40185848124', plays: [pick] };
  await T.poll();
  assert.deepEqual(pushed('neb'), ['Nebraska threw an interception'], 'at once, as ever');
  T.g.current.plays = [{ ...pick, type: { text: 'Penalty' }, text: `${pick.text} PENALTY IND Roughing The Passer (#95 T.Tucker) 15 yards from NEB16 to NEB31, 1ST DOWN. NO PLAY`, end: { team: { id: '158' } } }];
  await T.poll(3);
  assert.deepEqual(feed('neb'), [['cfb.team.interception', 'Nebraska threw an interception', ['Wiped out by a penalty on Indiana: Roughing The Passer.']]]);
  assert.deepEqual(feed('iu'), [['cfb.team.penalty', 'Indiana was flagged: Roughing The Passer', []]], 'the flag, in the feed');
  assert.deepEqual([pushed('neb'), pushed('iu')], [['Nebraska threw an interception'], []], 'no push for either');
});

test('an incompletion that became an interception, and a flag ESPN added to a play: their alerts when they change (Arizona at West Virginia)', async () => {
  device('ariz', 'team:cfb:12');
  device('wvu', 'team:cfb:277');
  const T = game('cfb', '401856823', '277', '12', { away: 14, home: 3 });
  await T.poll();
  const inc = play('401856823257', 'Pass Incompletion', '(13:09) No Huddle-Shotgun #1 N.Fifita pass incomplete short middle', '12', 14, 3, { period: 2, clock: '13:09' });
  const run = play('401856823202', 'Rush', '(01:03) No Huddle-Shotgun #1 A.Latimer rush left for 11 yards gain to the ARI08 (#6 T.Brown), 1ST DOWN', '277', 14, 3, { period: 2, clock: '1:03' });
  T.g.current = { id: '4018568239', plays: [run, inc] };
  await T.poll();
  assert.deepEqual([feed('ariz'), feed('wvu')], [[], []], 'an incompletion and a run: nothing (by default)');
  T.g.current.plays = [{ ...run, text: '(01:03) No Huddle-Shotgun #1 A.Latimer rush left for 11 yards gain (7) to the ARI08 (#6 T.Brown) PENALTY WVU Illegal Block in Back (#86 C.Traugh) 10 yards from ARI12 to ARI22' },
    { ...inc, type: { text: 'Interception' }, text: '(13:09) No Huddle-Shotgun #1 N.Fifita pass intercepted by #99 D.Afogho at ARI03 broken up by #93 N.Gabriel, End Of Play', end: { team: { id: '277' } } }];
  await T.poll();
  assert.deepEqual(feed('ariz'), [['cfb.team.interception', 'Arizona threw an interception', []]]);
  assert.deepEqual(feed('wvu'), [['cfb.team.penalty', 'West Virginia was flagged: Illegal Block in Back', []]]);
  assert.deepEqual([pushed('ariz'), pushed('wvu')], [['Arizona threw an interception'], []], 'the interception pushes; a flag is the feed\'s');
});

test('a touchdown overturned on review (re-posted as the play it was) and scored on the same drive: one alert, its lines say so (Wake Forest at NC State)', async () => {
  device('ncsu', 'team:cfb:152');
  const T = game('cfb', '401858260', '152', '154', { away: 10, home: 14 });
  await T.poll();
  const drive = (...plays: any[]) => ({ id: '40185826014', plays });
  const p437 = play('401858260437', 'Pass Reception', '(12:46) No Huddle-Shotgun #3 G.Lopez pass complete short right to #22 D.Lawrence caught at NCSU33, for 6 yards to the NCSU26 (#58 E.Satchell), out of bounds', '154', 10, 14, { clock: '12:38' });
  const td = play('401858260442', 'Passing Touchdown', '(12:21) No Huddle-Shotgun #3 G.Lopez pass complete short left to #8 C.Hernandez caught at NCSU17, for 26 yards to the NCSU00 TOUCHDOWN, clock 12:13, 1ST DOWN', '154', 16, 14, { clock: '12:13', scoring: true });
  Object.assign(T.g, { period: 3, home: 14, away: 16, current: drive(p437, td) });
  await T.poll();
  assert.deepEqual(feed('ncsu').map((r) => r[1]), ['Wake Forest scored 6 to take the lead over NC State'], 'at once, as ever');
  const reviewed = play('401858260452', 'Pass Reception', '(12:21) No Huddle-Shotgun #3 G.Lopez pass complete short left to #8 C.Hernandez caught at NCSU17, for 18 yards to the NCSU08, out of bounds at NCSU08, 1ST DOWN. The previous play is under automatic review - "Runner was out of bounds". CALL OVERTURNED. (Original Play: (12:21) No Huddle-Shotgun #3 G.Lopez pass complete short left to #8 C.Hernandez caught at NCSU17, for 26 yards to the NCSU00 TOUCHDOWN, clock 12:13, 1ST DOWN)', '154', 10, 14, { clock: '12:21' });
  Object.assign(T.g, { away: 10, current: drive(p437, reviewed) });
  await T.poll(2);
  assert.deepEqual(feed('ncsu')[0][2], ['Overturned on review.']);
  const real = play('401858260470', 'Passing Touchdown', '(10:46) No Huddle-Shotgun #3 G.Lopez pass complete short left to #8 C.Hernandez caught at NCSU00, for 6 yards to the NCSU00 TOUCHDOWN, clock 10:44', '154', 16, 14, { clock: '10:44', scoring: true });
  Object.assign(T.g, { away: 16, current: drive(p437, reviewed, real) });
  await T.poll();
  Object.assign(T.g, { away: 17, current: drive(p437, reviewed, { ...real, text: `${real.text} #90 C.Calvert kick attempt good (H: #96 J.Ploszay, LS: #49 E.Gilmour)`, awayScore: 17 }) });
  await T.poll(2);
  assert.deepEqual(feed('ncsu'), [['team.fell_behind', 'Wake Forest scored 6 to take the lead over NC State', ['Overturned on review.', 'Then Wake Forest scored on the same drive: WAKE 16, NCSU 14.']]],
    'the real touchdown, and its extra point, are a line on that alert, not another');
});

test('a touchdown overturned in place (the same play, now a catch at the 1) and scored on the next snap: one alert, its lines say so (Ball State at Northwestern)', async () => {
  device('nu', 'team:cfb:77');
  const T = game('cfb', '401858483', '77', '2050', { away: 0, home: 21 });
  await T.poll();
  const drive = (...plays: any[]) => ({ id: '40185848210', plays });
  const td = play('401858482239', 'Passing Touchdown', '(08:40) Shotgun #6 K.Luster pass complete short left to #88 A.Scherle caught at NU03, for 21 yards to the NU00 TOUCHDOWN, clock 08:32, 1ST DOWN', '2050', 6, 21, { period: 2, clock: '8:32', scoring: true });
  Object.assign(T.g, { period: 2, away: 6, current: drive(td) });
  await T.poll();
  Object.assign(T.g, { away: 0, current: drive({ ...td, type: { text: 'Pass Reception' }, text: '(08:40) Shotgun #6 K.Luster pass complete short left to #88 A.Scherle caught at NU03, for 20 yards to the NU01 (#7 O.Adeyi), 1ST DOWN', awayScore: 0, scoringPlay: false }) });
  await T.poll(2);
  const next = play('401858482247', 'Rushing Touchdown', '(08:23) Shotgun #4 T.Horton rush middle for 1 yard gain to the NU00 TOUCHDOWN, clock 08:20', '2050', 6, 21, { period: 2, clock: '8:20', scoring: true });
  Object.assign(T.g, { away: 6, current: drive(T.g.current.plays[0], next) });
  await T.poll();
  Object.assign(T.g, { away: 7, current: drive(T.g.current.plays[0], { ...next, text: `${next.text} #38 B.Boehm kick attempt good (H: #32 C.Stumbaugh, LS: #45 C.Britton)`, awayScore: 7 }) });
  await T.poll(2);
  assert.deepEqual(feed('nu'), [['team.opponent_scored', 'Ball State scored 6 on Northwestern', ['ESPN has since changed this play to a catch.', 'Then Ball State scored on the same drive: BALL 6, NU 21.']]]);
});

test('a touchdown overturned and scored on the next snap while the header never dropped the points: one alert, one line (South Carolina at Florida)', async () => {
  device('fla', 'team:cfb:57');
  const T = game('cfb', '401856714', '57', '2579', { away: 24, home: 13 });
  await T.poll();
  const drive = (...plays: any[]) => ({ id: '40185671425', plays });
  const p588 = play('401856714588', 'Pass Reception', '(01:49) No Huddle-Shotgun #16 L.Sellers pass complete short middle to #8 N.Harbor caught at FLA03, for 12 yards to the FLA03, End Of Play, 1ST DOWN', '2579', 24, 13, { clock: '1:39' });
  const td = play('401856714593', 'Rushing Touchdown', '(01:27) No Huddle-Shotgun #16 L.Sellers rush right for 3 yards gain to the FLA00 TOUCHDOWN, clock 01:20', '2579', 30, 13, { clock: '1:20', scoring: true });
  Object.assign(T.g, { period: 3, away: 30, current: drive(p588, td) });
  await T.poll();
  const reviewed = play('401856714598', 'Rush', '(01:27) No Huddle-Shotgun #16 L.Sellers rush right for 2 yards gain to the FLA01 (#43 A.Allen Jr.). The previous play is under automatic review - "Runner was down by contact". CALL OVERTURNED. (Original Play: (01:27) No Huddle-Shotgun #16 L.Sellers rush right for 3 yards gain to the FLA00 TOUCHDOWN, clock 01:20)', '2579', 24, 13, { clock: '1:27' });
  T.g.current = drive(p588, reviewed);
  await T.poll();
  const real = play('401856714603', 'Rushing Touchdown', '(01:12) #16 L.Sellers rush middle for 1 yard gain to the FLA00 TOUCHDOWN, clock 01:08', '2579', 30, 13, { clock: '1:08', scoring: true });
  T.g.current = drive(p588, reviewed, real);
  await T.poll();
  Object.assign(T.g, { away: 31, current: drive(p588, reviewed, { ...real, text: `${real.text} #14 M.Kelley kick attempt good`, awayScore: 31 }) });
  await T.poll(2);
  assert.deepEqual(feed('fla'), [['team.opponent_scored', 'South Carolina scored 6 on Florida', ['Overturned on review. Then South Carolina scored on the same drive: SC 30, FLA 13.']]]);
});

test("a touchdown's alert from a running score that counted a called-back one (\"scored 12\"): a line when ESPN corrects it (Ball State at Northwestern)", async () => {
  device('bsu', 'team:cfb:2050');
  const T = game('cfb', '401858484', '77', '2050', { away: 14, home: 38 });
  await T.poll();
  const drive = (...plays: any[]) => ({ id: '40185848226', plays });
  const run = play('401858482601', 'Rush', '(01:49) Shotgun #27 G.Sawchuk rush middle for 18 yards gain to the BSU29 (#9 J.Thomas), 1ST DOWN', '77', 14, 44, { clock: '1:43' });
  const td = play('401858482611', 'Passing Touchdown', '(01:02) No Huddle-Shotgun #0 A.Chiles pass complete deep left to #86 A.Honig caught at BSU00, for 32 yards to the BSU00 TOUCHDOWN, clock 00:53, 1ST DOWN', '77', 14, 50, { clock: '0:53', scoring: true });
  Object.assign(T.g, { period: 3, home: 50, current: drive(run, td) });
  await T.poll();
  Object.assign(T.g, { home: 45, current: drive({ ...run, homeScore: 38 }, { ...td, text: `${td.text} #90 J.Kleather kick attempt good`, homeScore: 45 }) });
  await T.poll(2);
  assert.deepEqual(feed('bsu'), [['team.opponent_scored', 'Northwestern scored 12 on Ball State', ['ESPN has since corrected the score: BALL 14, NU 45.']]]);
});

test('the same touchdown re-posted under new ids (a run ruled short, overturned, posted twice more) is one alert; a stray "End of Game" after the 3rd quarter doesn\'t end the game (Texas A&M at Missouri)', async () => {
  device('tamu', 'team:cfb:245');
  const T = game('cfb', '401856716', '142', '245', { away: 3, home: 13 });
  await T.poll();
  const drive = (...plays: any[]) => ({ id: '40185671627', plays });
  const fumble = play('401856716550', 'Fumble Recovery (Own)', '(00:45) No Huddle-Shotgun #13 A.Simmons rush left for 8 yards gain to the A&M02 fumbled by #13 A.Simmons at A&M05 forced by #4 T.Byard recovered by Mizzou #13 A.Simmons at A&M02 (#4 T.Byard)', '142', 3, 13, { clock: '0:17' });
  const short = play('401856716556', 'Rush', '(00:01) No Huddle-Shotgun #20 J.Roberts rush middle for 1 yard gain to the A&M01 (#5 D.Hicks; #11 B.Davis-Swain)', '142', 3, 13, { clock: '0:01' });
  Object.assign(T.g, { period: 3, home: 13, away: 3, current: drive(fumble, short) });
  await T.poll();
  const td = play('401856716571', 'Rushing Touchdown', '(00:01) No Huddle-Shotgun #20 J.Roberts rush middle for 2 yards gain to the A&M00 TOUCHDOWN, clock 00:00, 1ST DOWN. The previous play is under automatic review - "Runner broke the plane". CALL OVERTURNED. (Original Play: (00:01) No Huddle-Shotgun #20 J.Roberts rush middle for 1 yard gain to the A&M01 (#5 D.Hicks; #11 B.Davis-Swain))', '142', 3, 19, { clock: '0:01', scoring: true });
  Object.assign(T.g, { home: 19, current: drive(fumble, td) });
  await T.poll();
  assert.deepEqual(feed('tamu').map((r) => r[1]), ['Missouri scored 6 on Texas A&M'], 'the run ruled short, now a touchdown: its alert');
  const end = play('401856716581', 'End of Game', 'End of 4th quarter.', '142', 3, 20, { period: 4, clock: '0:00' });
  Object.assign(T.g, { home: 20, current: drive(fumble, td, end) });
  await T.poll();
  assert.equal(T.tracker.finished, false, 'no 4th-quarter play yet: not the end');
  // The touchdown taken out for ten minutes, the plays after it with its points; then posted again, twice.
  const kickoff = play('401856716585', 'Kickoff', '(15:00) #40 B.Reus kickoff 65 yards to the A&M00 #2 J.Morrow return 45 yards to the A&M45 (#22 E.Dotson)', '142', 3, 20, { endTeam: '245', period: 4, clock: '15:00' });
  Object.assign(T.g, { previous: [T.g.previous[0], drive(fumble)], current: { id: '40185671629', plays: [kickoff] } });
  for (let i = 0; i < 120; i++) await T.poll(); // 10 minutes
  const again = play('401856716592', 'Rushing Touchdown', 'No Huddle-Shotgun #20 J.Roberts rush middle for 2 yards gain to the A&M00 TOUCHDOWN, clock 00:00, 1ST DOWN #19 B.Craig kick attempt good (H: #40 B.Reus, LS: #49 B.Le Blanc)', '142', 3, 20, { clock: '0:00', scoring: true });
  T.g.previous = [T.g.previous[0], drive(fumble, again)];
  await T.poll(3);
  T.g.previous = [T.g.previous[0], drive(fumble, { ...again, id: '401856716596' })];
  await T.poll(10);
  assert.deepEqual(feed('tamu'), [['team.opponent_scored', 'Missouri scored 6 on Texas A&M', []]], 'one alert, nothing taken back');
  assert.equal(T.tracker.finished, false);
});

test("the header's score ahead of the plays a minute while they trail its clock: the alert without the play; not when plays from after it don't have it (Missouri, Northwestern)", async () => {
  device('tamu2', 'team:cfb:245');
  const T = game('cfb', '401856717', '142', '245', { away: 6, home: 20 });
  await T.poll();
  const run = play('401856716670', 'Rush', 'No Huddle-Shotgun #20 J.Roberts rush middle for 1 yard gain to the Mizzou32 (#4 T.Byard; #16 B.Perry-Wright)', '142', 6, 20, { period: 4, clock: '8:40' });
  Object.assign(T.g, { period: 4, clock: '2:49', home: 27, away: 6, current: { id: '40185671630', plays: [run] } });
  await T.poll(11);
  assert.deepEqual(feed('tamu2'), [], 'under a minute');
  await T.poll(2);
  assert.deepEqual(feed('tamu2'), [['team.opponent_scored', 'Missouri scored 7 on Texas A&M', []]]);
  const td = play('401856716999', 'Rushing Touchdown', '(02:57) #20 J.Roberts rush middle for 24 yards gain to the A&M00 TOUCHDOWN, clock 02:49', '142', 6, 27, { period: 4, clock: '2:49', scoring: true });
  T.g.current = { id: '40185671630', plays: [run, td] };
  await T.poll(3);
  assert.equal(feed('tamu2').length, 1, 'its play, when it comes, is said');

  device('ball', 'team:cfb:2050');
  const N = game('cfb', '401858482', '77', '2050', { away: 14, home: 38 });
  await N.poll();
  const punt = play('401858482551', 'Punt Return', '(04:54) #32 C.Stumbaugh punt 60 yards to the NU04 #19 D.Wagner return 96 yards to the BSU00 TOUCHDOWN, clock 04:34 PENALTY', '2050', 14, 38, { endTeam: '77', clock: '4:34' });
  Object.assign(N.g, { period: 3, clock: '4:34', home: 44, away: 14, current: { id: '40185848225', plays: [punt] } });
  await N.poll(30);
  assert.deepEqual(feed('ball'), [], 'a punt return called back: the header had it, the play from then doesn\'t');
});

test('a scoring play gone for one read (a short read) is nothing; gone for good, its alert gets a line (no push)', async () => {
  device('ecu', 'team:cfb:151');
  const T = game('cfb', '401862797', '151', '242');
  await T.poll();
  const fg = play('401862797100', 'Field Goal Good', '(05:00) #39 T.Hall field goal attempt from 30 yards GOOD', '242', 3, 0, { clock: '5:00', scoring: true, period: 1 });
  const next = play('401862797104', 'Kickoff', '(05:00) #39 T.Hall kickoff 65 yards to the ECU00, Touchback', '242', 3, 0, { endTeam: '151', clock: '5:00', period: 1 });
  Object.assign(T.g, { period: 1, away: 3, current: { id: '4018627973', plays: [fg, next] } });
  await T.poll();
  T.g.current = { id: '4018627973', plays: [] };
  await T.poll();
  T.g.current = { id: '4018627973', plays: [fg, next] };
  await T.poll(10);
  assert.deepEqual(feed('ecu'), [['team.fell_behind', 'Rice scored 3 to take the lead over East Carolina', []]], 'back on the next read: nothing');
  T.g.current = { id: '4018627973', plays: [{ ...next, awayScore: 0 }] };
  T.g.away = 0;
  await T.poll(10);
  assert.deepEqual(feed('ecu'), [['team.fell_behind', 'Rice scored 3 to take the lead over East Carolina', ['ESPN has since taken this play back.']]]);
  assert.deepEqual(pushed('ecu'), []);
});

test("a drive's result changed after it ended: an alert it no longer has gets a line, one it has now goes out (East Carolina, Arizona at West Virginia)", async () => {
  device('ecu2', 'team:cfb:151');
  const T = game('cfb', '401862798', '151', '242');
  await T.poll();
  const snap = (id: string, dd: string) => ({ ...play(id, 'Rush', '(00:31) #11 K.Hinton rush for 1 yard', '151', 0, 7, { period: 2 }), start: { team: { id: '151' }, downDistanceText: dd } });
  const drive = { id: '40186279718', team: { id: '151', abbreviation: 'ECU' }, result: 'DOWNS', displayResult: 'Downs', description: '3 plays, 31 yards, 0:28', offensivePlays: 3, yards: 31, plays: [snap('401862797410', '1st & 10 at ECU 40'), snap('401862797414', '4th & 1 at RICE 41')] };
  T.g.previous = [T.g.previous[0], drive];
  await T.poll();
  assert.deepEqual(feed('ecu2').map((r) => r[1]), ['East Carolina turned it over on downs']);
  T.g.previous = [T.g.previous[0], { ...drive, result: 'END OF HALF', displayResult: 'End of Half', offensivePlays: 3 }];
  await T.poll();
  assert.deepEqual(feed('ecu2'), [['cfb.team.turnover_on_downs', 'East Carolina turned it over on downs', ['ESPN has since changed how the drive ended: End of Half.']]]);

  device('wvu2', 'team:cfb:277');
  const W = game('cfb', '401856824', '277', '12', { away: 31, home: 17 });
  await W.poll();
  const pick = play('401856823548', 'Interception', '(10:08) No Huddle-Shotgun #3 M.Hawkins Jr. pass intercepted by #6 T.Brown at ARI22, End Of Play', '277', 31, 17, { endTeam: '12', clock: '10:02' });
  const wdrive = { id: '40185682325', team: { id: '277', abbreviation: 'WVU' }, result: 'INT', displayResult: 'Interception', description: '10 plays, 40 yards, 4:12', offensivePlays: 10, yards: 40, plays: [pick] };
  W.g.previous = [W.g.previous[0], wdrive];
  await W.poll();
  // Overturned: the pick taken out, re-posted as the incompletion on 4th down it was.
  const inc = play('401856823556', 'Pass Incompletion', '(10:08) No Huddle-Shotgun #3 M.Hawkins Jr. pass incomplete short middle to #2 D.Epps thrown to ARI23, TURNOVER ON DOWNS. The previous play is under automatic review - "Incomplete pass". CALL OVERTURNED. (Original Play: (10:08) No Huddle-Shotgun #3 M.Hawkins Jr. pass intercepted by #6 T.Brown at ARI22, End Of Play)', '277', 31, 17, { endTeam: '12', clock: '10:08' });
  W.g.previous = [W.g.previous[0], { ...wdrive, result: 'DOWNS', displayResult: 'Downs', plays: [inc] }];
  await W.poll();
  assert.deepEqual(feed('wvu2'), [['cfb.team.interception', 'West Virginia threw an interception', ['Overturned on review.']], ['cfb.team.turnover_on_downs', 'West Virginia turned it over on downs', []]]);
  assert.deepEqual(pushed('wvu2'), ['West Virginia threw an interception', 'West Virginia turned it over on downs'], 'what it was, when it was');
});

test('the NFL the same way: a pick wiped out by roughing the passer is a line on the QB\'s alert', async () => {
  device('kc', 'player:nfl:3139477');
  const T = game('nfl', '401771111', '12', '13', { away: 7, home: 7 });
  await T.poll();
  const ref = (kind: string, id: string) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/${kind}/${id}` });
  const pick = { id: '40177111155', type: { text: 'Pass Interception Return' }, text: '(5:00) (Shotgun) P.Mahomes pass short left intended for T.Kelce INTERCEPTED by M.Crosby at KC 30. M.Crosby to KC 30 for no gain.',
    start: { team: ref('teams', '12') }, end: { team: ref('teams', '13') }, participants: [{ athlete: ref('athletes', '3139477'), type: 'passer' }],
    awayScore: 7, homeScore: 7, period: { number: 2 }, clock: { displayValue: '4:52' }, scoringPlay: false, wallclock: new Date(NOW).toISOString() };
  T.g.core = [T.g.core[0], pick];
  await T.poll();
  T.g.core = [T.g.core[0], { ...pick, type: { text: 'Penalty' }, text: `${pick.text} PENALTY on LV-M.Crosby, Roughing the Passer, 15 yards, enforced at KC 30 - No Play.`,
    participants: [...pick.participants, { athlete: ref('athletes', '4361370'), type: 'penalized' }] }];
  await T.poll();
  assert.deepEqual(feed('kc'), [['nfl.qb.interception', 'Patrick Mahomes threw an interception', ['Wiped out by a penalty on the Raiders: Roughing the Passer.']]]);
  assert.deepEqual(pushed('kc'), ['Patrick Mahomes threw an interception']);
});

test('the same play re-posted: same period, a start within 10 seconds, the same player; why an alert no longer holds', () => {
  const p = (text: string, period = 3, clock?: string) => D.fromSitePlay({ id: 'x', type: { text: 'Rush' }, text, period: { number: period }, clock: { displayValue: clock ?? '1:00' } });
  const td = p('(00:01) No Huddle-Shotgun #20 J.Roberts rush middle for 2 yards gain to the A&M00 TOUCHDOWN, clock 00:00');
  assert.equal(R.samePlay(td, p('No Huddle-Shotgun #20 J.Roberts rush middle for 2 yards gain to the A&M00 TOUCHDOWN', 3, '0:00')), true, 'no "(mm:ss)": its clock');
  assert.equal(R.samePlay(td, p('(00:01) No Huddle-Shotgun #13 A.Simmons rush left for 8 yards')), false, 'another player');
  assert.equal(R.samePlay(td, p('(00:20) No Huddle-Shotgun #20 J.Roberts rush middle for 3 yards')), false, '19 seconds before');
  assert.equal(R.samePlay(td, p('(00:01) No Huddle-Shotgun #20 J.Roberts rush middle for 2 yards', 4)), false, 'another quarter');
  const g = { league: 'cfb' as const, homeId: '277', awayId: '12' };
  assert.equal(R.changeLine(g, null), 'ESPN has since taken this play back.');
  assert.equal(R.changeLine(g, p('(00:56) #3 M.Hawkins Jr. rush middle … PENALTY ARI Face Mask (#44 P.Williams) 11 yard from ARI22 to ARI11, 1ST DOWN. NO PLAY')), 'Wiped out by a penalty on Arizona: Face Mask.');
  assert.equal(R.changeLine(g, p('(00:37) pass incomplete PENALTY Sac St Offside declined PENALTY ARI UNS: Unsportsmanlike Conduct 15 yards. NO PLAY')), 'Wiped out by a penalty on Arizona: Unsportsmanlike Conduct.');
  // A code of two words ("Sac St") or before two spaces ("SC  "), the foul without "UNS: ".
  const sac = { league: 'cfb' as const, homeId: '189', awayId: '16' }, sc = { league: 'cfb' as const, homeId: '57', awayId: '2579' };
  assert.equal(R.changeLine(sac, p('(00:37) Shotgun #17 J.Kastantin pass incomplete short to #8 E.Jacon-Duffy thrown to Sac St22 PENALTY Sac St Pass Interference (#29 C.Reese) 15 yards from Sac St41 to Sac St26, 1ST DOWN. NO PLAY')),
    'Wiped out by a penalty on Sacramento St: Pass Interference.');
  assert.equal(D.wipedOutLine(sac, '(12:48) Shotgun #1 A.Dendy rush middle for 6 yards gain to the Sac St49 (#12 M.Nichols; #93 M.Kindle) PENALTY Sac St UNS: Unsportsmanlike Conduct (#18 F.Puloka) 15 yards from Sac St49 to Sac St34, 1ST DOWN'),
    'Wiped out by a penalty on Sacramento St: Unsportsmanlike Conduct.');
  assert.equal(R.changeLine(sc, p('(09:35) No Huddle-Shotgun #9 T.Jones Jr. pass incomplete deep right to #4 T.Abrams thrown to FLA42 PENALTY SC  Offside (#39 C.Herring) 5 yards from FLA22 to FLA27. NO PLAY')),
    'Wiped out by a penalty on South Carolina: Offside.');
  assert.equal(R.changeLine({ league: 'cfb', homeId: '77', awayId: '2050' }, p('(04:32) Shotgun #0 A.Chiles pass incomplete short left to #27 G.Sawchuk thrown to NU00 QB hurried by #7 B.Marsh PENALTY BSU UNR: Unnecessary Roughness (#27 G.Forsha) 15 yards from NU01 to NU16, 1ST DOWN. NO PLAY')),
    'Wiped out by a penalty on Ball State: Unnecessary Roughness.', '"BSU": Ball State\'s initials');
  assert.equal(R.changeLine(g, D.fromSitePlay({ id: 'y', type: { text: 'Pass Reception' }, text: '(08:40) #6 K.Luster pass complete … to the NU01, 1ST DOWN' })), 'ESPN has since changed this play to a catch.');
});

// An NFL core-API play, as ESPN posts it: its teams and players are refs; `clock` in seconds left.
const nflRef = (kind: string, id: string) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/${kind}/${id}` });
const corePlay = (id: string, type: string, text: string, team: string, roles: [string, string][], away: number, home: number, x: { period?: number; clock?: number; endTeam?: string } = {}) => ({
  id, type: { text: type }, text, team: nflRef('teams', team), start: { team: nflRef('teams', team) }, end: { team: nflRef('teams', x.endTeam ?? team) },
  participants: roles.map(([role, athlete]) => ({ athlete: nflRef('athletes', athlete), type: role })), awayScore: away, homeScore: home, period: { number: x.period ?? 4 },
  clock: { value: x.clock ?? 859, displayValue: `${Math.floor((x.clock ?? 859) / 60)}:${String((x.clock ?? 859) % 60).padStart(2, '0')}` }, scoringPlay: false, wallclock: new Date(NOW).toISOString() });
// Browns at Steelers, 2026: an interception wiped out by pass interference, the flag then overturned on review.
const PICK = '(Shotgun) D.Watson pass deep middle intended for D.Boston INTERCEPTED by R.Spears-Jennings [J.Sawyer] at PIT 23. R.Spears-Jennings to PIT 23 for no gain (D.Boston).';
const PICK_FLAG = `${PICK}PENALTY on PIT-D.Everette, Defensive Pass Interference, 42 yards, enforced at CLV 35 - No Play.`;
const PICK_REVIEWED = `${PICK_FLAG}The Replay Official reviewed the pass was not tipped ruling, and the play was REVERSED.(Shotgun) D.Watson pass deep middle intended for D.Boston INTERCEPTED by R.Spears-Jennings (J.Sawyer) [J.Sawyer] at PIT 23. R.Spears-Jennings to PIT 23 for no gain (D.Boston).`;
const PICK_ROLES: [string, string][] = [['passer', '3122840'], ['passDefender', '4820584'], ['returner', '4820584'], ['tackler', '4832800']];

test('an NFL play wiped out by a penalty is only its flags, though ESPN often keeps its type (73 of 734 in the 2026 season\'s first five weeks); after a review that reversed it, the call that stands', () => {
  const alerts = (homeId: string, awayId: string, p: any) => D.PLAYER_DETECTORS.nfl({ league: 'nfl', gameId: String(p.id).slice(0, 9), homeId, awayId, goalies: new Map() }, D.fromCorePlay(p)).map((e) => `${e.type}: ${e.title}`);
  // Cowboys at Commanders: a sack wiped out by defensive holding, still typed a sack.
  const sack = corePlay('4018729442910', 'Sack', '(Shotgun) M.Mariota sacked at WAS 28 for -7 yards (D.Winters).PENALTY on DAL-D.Bland, Defensive Holding, 5 yards, enforced at WAS 35 - No Play.', '28',
    [['passer', '2576980'], ['sackedBy', '4428914'], ['tackler', '4428914'], ['penalized', '4248911']], 27, 13, { period: 3, clock: 387 });
  assert.deepEqual(alerts('28', '6', sack), ['nfl.penalty: DaRon Bland was flagged', 'nfl.penalty: Cowboys were flagged: Defensive Holding'], "the player's flag and his team's; no sack");
  // Bears at Vikings: offsetting fouls, still an incompletion.
  const offsetting = corePlay('401872937429', 'Pass Incompletion', 'C.Williams pass incomplete short right [L.Rodriguez].Penalty on CHI-G.Bradbury, Offensive Holding, offsetting, enforced at MIN 35 - No Play.Penalty on MIN-L.Rodriguez, Roughing the Passer, offsetting.', '3',
    [['passer', '4431611']], 3, 0, { period: 1, clock: 462 });
  assert.deepEqual(alerts('16', '3', offsetting), ['nfl.penalty: Bears were flagged: Offensive Holding', 'nfl.penalty: Vikings were flagged: Roughing the Passer'], 'no player named: each team is flagged, for its team tracker');
  assert.equal(R.changeLine({ league: 'nfl', homeId: '16', awayId: '3' }, D.fromCorePlay(offsetting)), 'Wiped out by offsetting penalties.');
  // Browns at Steelers: the flag that wiped out the interception overturned on review. The interception stands.
  assert.deepEqual(alerts('23', '5', corePlay('4018729643321', 'Pass Interception Return', PICK_REVIEWED, '5', PICK_ROLES, 10, 21, { endTeam: '23' })), ['nfl.qb.interception: Deshaun Watson threw an interception']);
  assert.deepEqual(alerts('23', '5', corePlay('4018729643321', 'Pass Interception Return', PICK_FLAG, '5', PICK_ROLES, 10, 21, { endTeam: '23' })), ['nfl.penalty: Steelers were flagged: Defensive Pass Interference'], 'before the review: wiped out, the Steelers\' flag for their team tracker; after it, no flag stands and none is sent');
  // Patriots at Bills: the flag that wiped it out is the one before "No Play", not one enforced between downs after it.
  assert.equal(D.wipedOutLine({ league: 'nfl', homeId: '2', awayId: '17' }, '(Shotgun) J.Allen pass incomplete short right to D.Moore (M.Jones) [C.Elliss].PENALTY on NE-M.Jones, Defensive Holding, 5 yards, enforced at NE 16 - No Play.PENALTY on NE, Unsportsmanlike Conduct, 5 yards, enforced between downs.'),
    'Wiped out by a penalty on the Patriots: Defensive Holding.');
});

test('an NFL interception wiped out by pass interference (its type kept), then not (the flag overturned on review): a line each time, one push (Browns at Steelers)', async () => {
  device('watson', 'player:nfl:3122840');
  device('everette', 'player:nfl:4685327');
  const T = game('nfl', '401872964', '23', '5', { away: 10, home: 21 });
  await T.poll();
  const pick = corePlay('4018729643321', 'Pass Interception Return', PICK, '5', PICK_ROLES, 10, 21, { endTeam: '23' });
  T.g.core = [T.g.core[0], pick];
  await T.poll();
  assert.deepEqual(pushed('watson'), ['Deshaun Watson threw an interception'], 'at once, as ever');
  T.g.core = [T.g.core[0], { ...pick, text: PICK_FLAG, participants: [...pick.participants, { athlete: nflRef('athletes', '4685327'), type: 'penalized' }] }];
  await T.poll();
  assert.deepEqual(feed('watson'), [['nfl.qb.interception', 'Deshaun Watson threw an interception', ['Wiped out by a penalty on the Steelers: Defensive Pass Interference.']]]);
  assert.deepEqual(feed('everette'), [['nfl.penalty', 'Daylen Everette was flagged', []]]);
  T.g.core = [T.g.core[0], { ...pick, text: PICK_REVIEWED }];
  await T.poll();
  assert.deepEqual(feed('watson'), [['nfl.qb.interception', 'Deshaun Watson threw an interception', ['Wiped out by a penalty on the Steelers: Defensive Pass Interference.', 'Overturned on review: it stands.']]]);
  assert.deepEqual(feed('everette'), [['nfl.penalty', 'Daylen Everette was flagged', ['Overturned on review.']]]);
  assert.deepEqual(pushed('watson'), ['Deshaun Watson threw an interception'], 'one push');
});

test('an NFL play gone from the feed a while, then back as it was or re-posted under a new id: a line on its alert, never the alert again', async () => {
  device('mahomes', 'player:nfl:3139477');
  const T = game('nfl', '401771112', '12', '13', { away: 3, home: 7 });
  await T.poll();
  const sack = corePlay('40177111230', 'Sack', '(Shotgun) P.Mahomes sacked at KC 25 for -8 yards (M.Crosby).', '12', [['passer', '3139477']], 3, 7, { period: 2, clock: 600 });
  const pick = corePlay('40177111240', 'Pass Interception Return', '(Shotgun) P.Mahomes pass short left intended for T.Kelce INTERCEPTED by J.Pickett at KC 30. J.Pickett to KC 30 for no gain.', '12',
    [['passer', '3139477']], 3, 7, { period: 2, clock: 540, endTeam: '13' });
  T.g.core = [T.g.core[0], sack, pick];
  await T.poll();
  assert.deepEqual(pushed('mahomes'), ['Patrick Mahomes threw an interception'], 'the sack is the feed\'s');
  T.g.core = [T.g.core[0]];
  await T.poll(7); // 35 seconds: gone
  const taken = ['ESPN has since taken this play back.'];
  assert.deepEqual(feed('mahomes'), [['nfl.qb.sacked', 'Patrick Mahomes got sacked', taken], ['nfl.qb.interception', 'Patrick Mahomes threw an interception', taken]]);
  T.g.core = [T.g.core[0], sack, { ...pick, id: '40177111241' }];
  await T.poll();
  const back = [...taken, 'ESPN has since put this play back.'];
  assert.deepEqual(feed('mahomes'), [['nfl.qb.sacked', 'Patrick Mahomes got sacked', back], ['nfl.qb.interception', 'Patrick Mahomes threw an interception', back]]);
  assert.deepEqual(pushed('mahomes'), ['Patrick Mahomes threw an interception'], 'one push');
});

test("an NFL flag ESPN moved to another player says so on the first one's alert, never a second alert to who has it; one replay took off says that (Eagles at Jaguars)", async () => {
  device('vanlanen', 'player:nfl:4035791');
  device('linemen', 'player:nfl:4035791', 'player:nfl:4242391');
  device('hainsey', 'player:nfl:4242391');
  device('jones', 'player:nfl:4426448');
  // Installs from before October 11 2026 push flags (keepFlagsPushed); new ones have them in the feed.
  for (const id of ['vanlanen', 'linemen', 'hainsey', 'jones']) db.prepare('UPDATE devices SET prefs = ? WHERE id = ?').run(JSON.stringify({ ...DEFAULT_PREFS, pushTypes: { 'nfl.penalty': true } }), id);
  const T = game('nfl', '401872981', '30', '21', { away: 14, home: 10 });
  await T.poll();
  // A false start on Van Lanen, charged to Hainsey four minutes later.
  const fs = corePlay('4018729813888', 'Penalty', '(Shotgun) PENALTY on JAX-C.Van Lanen, False Start, 5 yards, enforced at JAX 34 - No Play.', '30', [['penalized', '4035791']], 14, 10, { clock: 676 });
  T.g.core = [T.g.core[0], fs];
  await T.poll();
  assert.deepEqual([pushed('vanlanen'), pushed('linemen')], [['Cole Van Lanen was flagged'], ['Cole Van Lanen was flagged']]);
  T.g.core = [T.g.core[0], { ...fs, text: '(Shotgun) PENALTY on JAX-R.Hainsey, False Start, 5 yards, enforced at JAX 34 - No Play.',
    participants: [{ athlete: nflRef('athletes', '4242391'), type: 'penalized' }, { athlete: nflRef('athletes', '4035791'), type: 'other' }] }];
  await T.poll();
  const moved = [['nfl.penalty', 'Cole Van Lanen was flagged', ['ESPN has since charged this flag to Robert Hainsey.']]];
  assert.deepEqual(feed('vanlanen'), moved, 'not "Wiped out by a penalty"');
  assert.deepEqual(feed('linemen'), moved, 'one alert, one line: not "Robert Hainsey was flagged." as well');
  assert.deepEqual(feed('hainsey'), [['nfl.penalty', 'Robert Hainsey was flagged', []]]);
  assert.deepEqual([pushed('linemen'), pushed('hainsey')], [['Cole Van Lanen was flagged'], ['Robert Hainsey was flagged']]);
  // A face mask picked up with the replay assist 12 seconds after it was posted.
  const fm = corePlay('4018729813340', 'Pass Reception', '(Shotgun) J.Hurts pass short left to M.Lemon to PHI 44 for 18 yards (J.Lewis). PENALTY on JAX-Jar.Jones, Face Mask, 15 yards, enforced at PHI 44.', '21',
    [['penalized', '4426448']], 14, 10, { period: 3, clock: 126 });
  T.g.core = [...T.g.core, fm];
  await T.poll();
  T.g.core = [...T.g.core.slice(0, -1), { ...fm, text: '(Shotgun) J.Hurts pass short left to M.Lemon to PHI 44 for 18 yards (J.Lewis).  The penalty was assisted by replay.',
    participants: [{ athlete: nflRef('athletes', '4426448'), type: 'other' }] }];
  await T.poll();
  assert.deepEqual(feed('jones'), [['nfl.penalty', 'Jarrian Jones was flagged', ['ESPN has since taken the flag off.']]], 'not "changed this play to a pass reception"');
});

// ─── The NFL Week 5 recording report (October 11 2026): F5 to F10 ─────────────────────────────────────────────
test('a flag ESPN drops from the play\'s data but keeps in its text stands; one it declines says so; one that became a disqualification says "ejected", not "taken off" (Raiders at Patriots, Broncos at Chargers, 49ers at Seahawks)', async () => {
  device('crosby', 'player:nfl:3916655');
  device('robinson', 'player:nfl:4692048');
  device('greenlaw', 'player:nfl:3916903');
  // Maxx Crosby's unnecessary roughness after a touchdown: ESPN relabeled him "other" a read later, the text kept the flag.
  const A = game('nfl', '401872986', '17', '13', { away: 0, home: 6 });
  await A.poll();
  const crosby = corePlay('401872986293', 'Rush', 'M.Jones up the middle to NE 40 for 2 yards (M.Crosby).PENALTY on LV-M.Crosby, Unnecessary Roughness, 15 yards, enforced between downs.', '17', [['rusher', '4426448'], ['penalized', '3916655']], 0, 6, { period: 1, clock: 683 });
  A.g.core = [A.g.core[0], crosby];
  await A.poll();
  A.g.core = [A.g.core[0], { ...crosby, participants: [{ athlete: nflRef('athletes', '4426448'), type: 'rusher' }, { athlete: nflRef('athletes', '3916655'), type: 'other' }] }];
  await A.poll(2);
  assert.deepEqual(feed('crosby'), [['nfl.penalty', 'Maxx Crosby was flagged', []]], 'the flag stands: no "taken the flag off"');
  // Que Robinson's offside: accepted, then declined.
  const B = game('nfl', '401872989', '24', '7', { away: 10, home: 9 });
  await B.poll();
  const offside = corePlay('4018729892538', 'Rush', 'A.Ekeler right end to LAC 30 for 1 yard (Q.Robinson).PENALTY on DEN-Q.Robinson, Defensive Offside, 5 yards, enforced between downs.', '24', [['rusher', '4426448'], ['penalized', '4692048']], 10, 9, { period: 3, clock: 332 });
  B.g.core = [B.g.core[0], offside];
  await B.poll();
  B.g.core = [B.g.core[0], { ...offside, text: 'A.Ekeler right end to LAC 30 for 1 yard (Q.Robinson). Penalty on DEN-Q.Robinson, Defensive Offside, declined.', participants: [{ athlete: nflRef('athletes', '4426448'), type: 'rusher' }, { athlete: nflRef('athletes', '4692048'), type: 'other' }] }];
  await B.poll(2);
  assert.deepEqual(feed('robinson'), [['nfl.penalty', 'Que Robinson was flagged', ['ESPN has since declined this flag.']]]);
  // Dre Greenlaw's unnecessary roughness, then a disqualification: the ejection replaces the flag alert.
  const C = game('nfl', '401872992', '26', '25', { away: 14, home: 10 });
  await C.poll();
  const dq = corePlay('401872992166', 'Rush', 'S.Darnold scrambles right end pushed ob at SF 47 for 5 yards (D.Greenlaw).PENALTY on SF-D.Greenlaw, Unnecessary Roughness, 15 yards, enforced at SF 47.', '26', [['rusher', '4426448'], ['penalized', '3916903']], 14, 10, { period: 2, clock: 390 });
  C.g.core = [C.g.core[0], dq];
  await C.poll();
  C.g.core = [C.g.core[0], { ...dq, text: dq.text.replace('Unnecessary Roughness', 'Disqualification') }];
  await C.poll(2);
  assert.deepEqual(feed('greenlaw'), [['nfl.penalty', 'Dre Greenlaw was flagged', ['Dre Greenlaw got ejected.']]], 'the ejection\'s line, not "taken the flag off" as well');
});

test('a flag still in the call that stands after a review is not kept; ESPN\'s plain words name the play it became (F7)', () => {
  const g = { league: 'nfl' as const, homeId: '23', awayId: '5' };
  const now = (type: string, text = 'x') => D.fromCorePlay(corePlay('4018729000001', type, text, '5', [], 0, 0));
  assert.equal(R.changeLine(g, now('Fumble Recovery (Own)')), 'ESPN has since changed this play to a fumble its own team recovered.');
  assert.equal(R.changeLine(g, now('Sack Opp Fumble Recovery')), 'ESPN has since changed this play to a strip-sack the defense recovered.');
  assert.equal(R.changeLine(g, now('Pass Interception Return')), 'ESPN has since changed this play to an interception.');
  assert.equal(R.changeLine(g, now('Rush')), 'ESPN has since changed this play to a run.');
  assert.equal(R.changeLine(g, now('Punt')), 'ESPN has since changed this play to a punt.');
  assert.equal(R.changeLine(g, now('Two Point Pass')), 'ESPN has since changed this play to a two point pass.', 'any other: ESPN\'s own, lowercased');
});

test('a muffed punt the kicking team recovers is the returner\'s lost fumble; one he recovers himself is nothing (49ers at Seahawks)', () => {
  const alerts = (p: any) => D.PLAYER_DETECTORS.nfl({ league: 'nfl', gameId: '401872992', homeId: '26', awayId: '25', goalies: new Map() }, D.fromCorePlay(p)).map((e) => `${e.type}: ${e.title}`);
  const muff = corePlay('401872992469', 'Muffed Punt Recovery (Opponent)', '(9:34) M.Dickson punts 39 yards to SF 35, Center-C.Stoll. J.Cowing MUFFS catch, RECOVERED by SEA-E.Saubert at SF 24.', '25',
    [['punter', '4362081'], ['recoverer', '4572077'], ['returner', '4575665']], 7, 0, { period: 1, clock: 574, endTeam: '26' });
  assert.deepEqual(alerts(muff), ['nfl.fumble_lost: Jacob Cowing lost a fumble']);
  const own = corePlay('401872992470', 'Punt', '(9:34) M.Dickson punts 39 yards to SF 35, Center-C.Stoll. J.Cowing MUFFS catch, and recovers at SF 33.', '25',
    [['punter', '4362081'], ['recoverer', '4575665'], ['returner', '4575665']], 7, 0, { period: 1, clock: 574 });
  assert.deepEqual(alerts(own), [], 'his own team recovered it');
});

test('a lost fumble ESPN corrects to its own team\'s recovery after the final says so on the alert (Browns at Jets)', async () => {
  device('watson2', 'player:nfl:3122840');
  const T = game('nfl', '401872983', '20', '5', { away: 12, home: 17 });
  await T.poll();
  const roles: [string, string][] = [['passer', '3122840']];
  const fumble = corePlay('4018729833950', 'Sack Opp Fumble Recovery', '(Shotgun) D.Watson sacked at CLV 19 for 0 yards (W.McDonald). FUMBLES (W.McDonald), RECOVERED by NYJ-J.Smith at CLV 19.', '5', roles, 12, 17, { period: 4, clock: 57, endTeam: '20' });
  T.g.core = [T.g.core[0], fumble];
  await T.poll();
  assert.deepEqual(pushed('watson2'), ['Deshaun Watson lost a fumble']);
  Object.assign(T.g, { state: 'post', period: 4, clock: '0:00' });
  await T.poll(2); // END GAME: the tracker finishes
  assert.equal(T.tracker.finished, true);
  T.g.core = [T.g.core[0], { ...fumble, type: { text: 'Fumble Recovery (Own)' }, text: '(Shotgun) D.Watson sacked at CLV 19 for 0 yards (W.McDonald). FUMBLES (W.McDonald), and recovers at CLV 19. D.Watson to CLV 18 for -1 yards', end: { team: nflRef('teams', '5') } }];
  await T.poll();
  assert.deepEqual(feed('watson2').filter((r) => r[0] === 'nfl.fumble_lost'), [['nfl.fumble_lost', 'Deshaun Watson lost a fumble', ['Deshaun Watson got sacked.', 'ESPN has since corrected it: the Browns kept the ball.']]]);
  assert.deepEqual(pushed('watson2').filter((t) => /fumble/.test(t)), ['Deshaun Watson lost a fumble'], 'no second push for the fumble (the loss pushed once, at the final)');
});

test('a delay of game charged to the quarterback, then marked a punt: the line says it was the punt team\'s (Texans at Titans)', () => {
  const g = { league: 'nfl' as const, gameId: '401872984', homeId: '10', awayId: '34', goalies: new Map(), qbs: { '34': '4432577' } } as any;
  const ledger = new R.PlayLedger(g, () => {});
  const dog = D.fromCorePlay(corePlay('4018729841234', 'Penalty', 'PENALTY on HST, Delay of Game, 5 yards, enforced at TEN 40 - No Play.', '34', [], 26, 3, { period: 3, clock: 480 }));
  const sent = D.PLAYER_DETECTORS.nfl(g, dog);
  assert.deepEqual(sent.map((e) => e.title), ['C.J. Stroud took a delay of game penalty', 'Texans were flagged: Delay of Game'], "the quarterback's, and the team's for a team tracker");
  NOW += 1000;
  ledger.add(dog, sent, { history: false }, NOW);
  const punt = D.fromCorePlay(corePlay('4018729841234', 'Penalty', '(Punt formation) PENALTY on HST, Delay of Game, 5 yards, enforced at TEN 40 - No Play.', '34', [], 26, 3, { period: 3, clock: 480 }));
  const r = ledger.changed(punt, NOW + 12_000)!;
  assert.deepEqual(r.lines.map((e) => e.fold), ['ESPN has since put this on the punt team.']);
});

test('an NFL game that ends tied sends each team\'s trackers a feed-only "tied" alert, one to a device tracking both (Bears and Vikings)', async () => {
  device('bears', 'team:nfl:3');
  device('both', 'team:nfl:3', 'team:nfl:16');
  device('vikings', 'team:nfl:16');
  const T = game('nfl', '401872988', '16', '3', { away: 27, home: 27 });
  await T.poll();
  Object.assign(T.g, { state: 'post', period: 5, clock: '0:00' });
  await T.poll(2);
  const tied = [['nfl.team.tied', 'Bears tied the Vikings, 27-27', []]];
  assert.deepEqual(feed('bears'), tied);
  assert.deepEqual(feed('both'), tied, 'one alert');
  assert.deepEqual(feed('vikings'), [['nfl.team.tied', 'Vikings tied the Bears, 27-27', []]]);
  assert.deepEqual([pushed('bears'), pushed('both'), pushed('vikings')], [[], [], []], 'feed only');
  assert.deepEqual(D.gameTiedEvents({ league: 'nfl', gameId: 'x', homeId: '16', awayId: '3' }, { home: 20, away: 17 }, 0), [], 'a win is not a tie');
});

test('two players with one surname: a flag moves from Michael Wilson to Mack Wilson Sr. (his initials), and a review that put the ball out of bounds is "Overturned on review: …" (Cardinals; Bengals at Dolphins)', async () => {
  device('mwilson', 'player:nfl:4360761');
  device('watson3', 'player:nfl:3122840');
  const T = game('nfl', '401872991', '22', '8', { away: 0, home: 7 });
  await T.poll();
  const block = corePlay('401872991937', 'Rush', 'J.Love left tackle to ARZ 22 for 1 yard (A.Hutchinson).PENALTY on ARZ-Mi.Wilson, Illegal Block Above the Waist, 10 yards, enforced at ARZ 21.', '8', [['rusher', '4426448'], ['penalized', '4360761']], 0, 7, { period: 2, clock: 600 });
  T.g.core = [T.g.core[0], block];
  await T.poll();
  T.g.core = [T.g.core[0], { ...block, text: block.text.replace('Mi.Wilson', 'Ma.Wilson'), participants: [{ athlete: nflRef('athletes', '4426448'), type: 'rusher' }, { athlete: nflRef('athletes', '3916800'), type: 'penalized' }] }];
  await T.poll();
  assert.deepEqual(feed('mwilson'), [['nfl.penalty', 'Michael Wilson was flagged', ['ESPN has since charged this flag to Mack Wilson Sr..']]], 'not kept: the text now names Ma.Wilson');
  // A lost fumble a review reversed (ball out of bounds): the review is the reason, and who kept the ball.
  const g = { league: 'nfl' as const, gameId: '401872982', homeId: '5', awayId: '20', goalies: new Map() } as any;
  const ledger = new R.PlayLedger(g, () => {});
  const lost = D.fromCorePlay(corePlay('4018729821452', 'Sack Opp Fumble Recovery', '(Shotgun) D.Watson sacked at CLV 19 for 0 yards (W.McDonald). FUMBLES (W.McDonald), RECOVERED by NYJ-J.Smith at CLV 19.', '5', [['passer', '3122840']], 0, 0));
  ledger.add(lost, D.PLAYER_DETECTORS.nfl(g, lost), { history: false }, NOW);
  const reviewed = D.fromCorePlay(corePlay('4018729821452', 'Fumble Recovery (Own)', `${lost.text}The Replay Official reviewed the ball was inbounds ruling, and the play was REVERSED.(Shotgun) D.Watson sacked at CLV 19 for 0 yards (W.McDonald). FUMBLES (W.McDonald), ball out of bounds at CLV 19.`, '5', [['passer', '3122840']], 0, 0));
  const r = ledger.changed(reviewed, NOW + 120_000)!;
  assert.deepEqual(r.lines.map((e) => e.fold), ['Overturned on review: the Browns kept the ball.']);
});

test('a safety that puts a college team behind is pushed as the safety, also when ESPN first posted the play as a sack (Delaware at Middle Tennessee, October 13 2026)', async () => {
  device('del', 'team:cfb:48');
  device('mtsu', 'team:cfb:2393');
  const T = game('cfb', '401871067', '2393', '48', { away: 3, home: 3 });
  await T.poll();
  // The play as ESPN first posted it (a sack), then as it settled (the intentional-grounding safety, the score 3-5).
  const sack = play('401871067139', 'Sack', 'No Huddle-Shotgun #7 T.Bell sacked for loss of 15 yards to the DELA00 (#22 G.Gaskins)', '48', 3, 3, { period: 1, clock: '3:25' });
  T.g.current = { id: '4018710678', plays: [sack] };
  await T.poll();
  assert.deepEqual(feed('del').map((r) => r[1]), ['Delaware got sacked (T.Bell)']);
  const safety = { ...sack, type: { text: 'Safety' }, text: 'No Huddle-Shotgun #7 T.Bell pass incomplete short right thrown to DELA10. Middle Tenn. SAFETY, clock 03:25 PENALTY DELA Intentional Grounding (#7 T.Bell)', end: { team: { id: '2393' } }, awayScore: 3, homeScore: 5, scoringPlay: true };
  Object.assign(T.g, { home: 5 });
  T.g.current.plays = [safety];
  await T.poll(3);
  const cards = feed('del');
  assert.deepEqual(cards.map((r) => r[0]), ['cfb.team.sacked', 'cfb.safety'], 'the sack stays in the feed, the safety is its own card');
  assert.equal(cards[1][1], 'Delaware gave up a safety and fell behind MTSU', 'no "the" before a school');
  assert.deepEqual(pushed('del'), ['Delaware gave up a safety and fell behind MTSU'], 'pushed: "Gives up a safety" is on by default');
  assert.ok(cards[0][2].some((l: string) => /changed this play to a safety/.test(l)), 'a line on the sack says what became of it');
  assert.deepEqual(feed('mtsu'), [], 'the side that scored the points gets nothing');
});

test("a flag a review took back is no flag; a sack ESPN types as a fumble is a sack; a flag ESPN posts again as a play of its own is a line, not a second card (Western Kentucky at Sam Houston, October 14 2026)", async () => {
  device('shsu', 'team:cfb:2534');
  device('wku', 'team:cfb:98');
  const T = game('cfb', '401871068', '2534', '98', { away: 10, home: 3 });
  await T.poll();
  // "CALL OVERTURNED. (Original Play: … PENALTY SAM Targeting …)": the penalty is the one that was taken back.
  const overturned = play('401871068375', 'Pass Incompletion', '(00:55) No Huddle-Shotgun #11 B.Glenn pass incomplete short right to #80 J.Stafford Jr. thrown to WKU36 broken up by #8 T.Bailey. The previous play is under automatic review - "Targeting". CALL OVERTURNED. (Original Play: (00:55) No Huddle-Shotgun #11 B.Glenn pass complete short middle to #80 J.Stafford Jr. caught at WKU36, for 13 yards to the WKU36 (#8 T.Bailey), 1ST DOWN, PENALTY SAM Targeting (#8 T.Bailey) 15 yards from WKU36 to SAM49, 1ST DOWN)', '98', 10, 3, { period: 2, clock: '0:55' });
  T.g.current = { id: '4018710689', plays: [overturned] };
  await T.poll(3);
  assert.deepEqual(feed('shsu'), [], 'no "Sam Houston was flagged: Targeting"');
  // A sack with a fumble, typed "Fumble Recovery (Own)", with a flag on it; then the flag again, 2 minutes later, at the same clock.
  const sack = play('401871068731', 'Fumble Recovery (Own)', '(04:19) Shotgun #11 B.Glenn sacked for loss of 14 yards to the WKU30 (#3 B.Henderson), fumble by #11 B.Glenn recovered by WKU  at WKU30, End Of Play PENALTY SAM UNR: Unnecessary Roughness (#98 J.Terrell) 15 yards from WKU30 to WKU45', '98', 16, 3, { period: 4, clock: '4:08' });
  T.g.current.plays = [overturned, sack];
  await T.poll(3);
  assert.deepEqual(feed('wku').map((r) => r[1]), ['Western KY got sacked (B.Glenn)']);
  assert.deepEqual(feed('shsu').map((r) => [r[0], r[1], r[2].length]), [['cfb.team.penalty', 'Sam Houston was flagged: Unnecessary Roughness', 0]]);
  await T.poll(24);
  const copy = play('401871068748', 'Penalty', 'PENALTY SAM UNR: Unnecessary Roughness (#98 J.Terrell) 15 yards from WKU30 to WKU45, 1ST DOWN. NO PLAY', '98', 16, 3, { period: 4, clock: '4:08' });
  T.g.current.plays = [overturned, sack, copy];
  await T.poll(3);
  const cards = feed('shsu');
  assert.equal(cards.length, 1, 'one card for the one flag');
  assert.match(cards[0][2].join(' '), /^ESPN posted this flag again as a play of its own: 15 yards from WKU30 to WKU45, 1ST DOWN\.$/);
  assert.deepEqual(pushed('shsu'), [], 'no push');
});

test("an extra point ESPN adds to a touchdown's play is no \"late score\" (Western Kentucky at Sam Houston, October 14 2026)", async () => {
  const T = game('cfb', '401871069', '2534', '98');
  await T.poll();
  const td = play('401871069700', 'Passing Touchdown', '(10:12) No Huddle-Shotgun #11 B.Glenn pass complete short left to #87 C.Arends caught at SAM04, for 23 yards to the SAM00 TOUCHDOWN, clock 10:06, 1ST DOWN', '98', 6, 0, { period: 1, clock: '10:06', scoring: true });
  Object.assign(T.g, { away: 6 });
  T.g.current = { id: '4018710693', plays: [td] };
  await T.poll(2);
  const logs: string[] = [], was = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
  try {
    T.g.current.plays = [{ ...td, type: { text: 'Pass Reception' }, text: `${td.text} #99 K.Campbell kick attempt good (H: #43 J.Smith, LS: #49 N.Imhoff)`, awayScore: 7 }];
    Object.assign(T.g, { away: 7 });
    await T.poll(3);
  } finally { console.log = was; }
  assert.deepEqual(logs.filter((l) => /late score/.test(l)), []);
});
