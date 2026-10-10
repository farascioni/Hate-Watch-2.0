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
  ['151', 'East Carolina Pirates', 'East Carolina', 'ECU'], ['242', 'Rice Owls', 'Rice', 'RICE'], ['57', 'Florida Gators', 'Florida', 'FLA'], ['2579', 'South Carolina Gamecocks', 'South Carolina', 'SC']])
  team.run(`team:cfb:${id}`, 'cfb', id, name, short, abbr, short);
team.run('team:nfl:12', 'nfl', '12', 'Kansas City Chiefs', 'Chiefs', 'KC', 'Kansas City');
team.run('team:nfl:13', 'nfl', '13', 'Las Vegas Raiders', 'Raiders', 'LV', 'Las Vegas');
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, position, image, image_w, image_h, image_kind, updated_at) VALUES ('player:nfl:3139477', 'nfl', '3139477', 'Patrick Mahomes', 'team:nfl:12', 'QB', 'x', 1, 1, 'headshot', 0)`).run();
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
  assert.deepEqual(feed('nu'), [['team.opponent_scored', 'Ball State scored 6 on Northwestern', ['ESPN has since changed this play to a pass reception.', 'Then Ball State scored on the same drive: BALL 6, NU 21.']]]);
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
  assert.equal(R.changeLine(g, D.fromSitePlay({ id: 'y', type: { text: 'Pass Reception' }, text: '(08:40) #6 K.Luster pass complete … to the NU01, 1ST DOWN' })), 'ESPN has since changed this play to a pass reception.');
});
