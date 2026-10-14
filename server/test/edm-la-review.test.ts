// What the Oilers at Kings recording (EDM at LA, 2026-10-13, ESPN 401892502, the first NHL game recorded end to end) found,
// through a real GameTracker on the plays ESPN posted (shapes and wording from the recording): a play with no team and no
// shooter ("saved by Devon Levi", gone 20 seconds later) is no goalie change and no pull, and the real pull counts the
// goals that were first posted as missed shots (F1); an empty-netter ESPN first posted as an even-strength goal says so on the
// goalie's alert and the team's (F2); a goal first posted as a missed shot and a shot retyped are lines on the shooter's
// alert (F3); a penalty posted as "Penalty Shot Infraction" gets its call as a line (F4); a final the header has short of
// the plays and the period scores is the higher one (F6); the box score's goalies keep to their teams (F7).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
let NOW = Date.parse('2026-10-14T02:39:00Z');
Date.now = () => NOW;
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');
const { competitorScore } = await import('../src/scores.ts');
const D = await import('../src/detectors.ts');

const EDM = '6', LA = '8';
const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES (?, 'nhl', ?, ?, ?, ?, ?, 'x', 500, 500, 0)`);
team.run(`team:nhl:${EDM}`, EDM, 'Edmonton Oilers', 'Oilers', 'EDM', 'Edmonton');
team.run(`team:nhl:${LA}`, LA, 'Los Angeles Kings', 'Kings', 'LA', 'Los Angeles');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, position, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'nhl', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
const PEOPLE = {
  draisaitl: ['3114727', 'Leon Draisaitl', EDM, 'C'], podkolzin: ['4697403', 'Vasily Podkolzin', EDM, 'RW'], mcdavid: ['3895074', 'Connor McDavid', EDM, 'C'], levi: ['4894487', 'Devon Levi', EDM, 'G'],
  kuemper: ['2610321', 'Darcy Kuemper', LA, 'G'], forsberg: ['3036851', 'Anton Forsberg', LA, 'G'], doughty: ['3995', 'Drew Doughty', LA, 'D'], kempe: ['3114802', 'Adrian Kempe', LA, 'LW'],
} as const;
for (const [id, name, teamId, pos] of Object.values(PEOPLE)) player.run(`player:nhl:${id}`, id, name, `team:nhl:${teamId}`, pos);
loadCatalog();

const pushes: { to: string }[] = [];
setPushSender((m) => pushes.push(...m));
const everything = { ...DEFAULT_PREFS, types: Object.fromEntries(EVENT_TYPES.map((t) => [t.id, true])), pushTypes: Object.fromEntries(EVENT_TYPES.map((t) => [t.id, true])) };
const device = (id: string, targets: string[], prefs: any = everything) => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', `tok-${id}`, JSON.stringify(prefs));
  targets.forEach((t, i) => db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)').run(id, t, i + 1));
};
const feed = (id: string) => (db.prepare(`SELECT e.type, e.title, e.body, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.type != 'team.game_start' ORDER BY f.rowid`).all(id) as any[])
  .map((r) => [r.type, r.title, r.extra ? JSON.parse(r.extra) : []]);
const pushed = (id: string) => pushes.filter((p) => p.to === `tok-${id}`).length;
const P = (who: keyof typeof PEOPLE) => `player:nhl:${PEOPLE[who][0]}`;

/** A play as ESPN's core feed posts it. `parts`: [athlete id, role]. */
const core = (id: string, type: string, text: string, teamId: string | undefined, parts: [string, string | null][], x: Record<string, any> = {}) => ({
  id, type: { text: type }, text, ...(teamId ? { team: { $ref: `http://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/seasons/2027/teams/${teamId}?lang=en&region=us` } } : {}),
  participants: parts.map(([a, role]) => ({ athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/seasons/2027/athletes/${a}?lang=en&region=us` }, ...(role ? { type: role } : {}) })),
  awayScore: x.away ?? 0, homeScore: x.home ?? 0, scoringPlay: !!x.scoring, scoreValue: x.scoring ? 1 : 0, period: { number: x.period ?? 1 }, clock: { value: x.clock ?? 600, displayValue: '10:00' },
  wallclock: new Date(x.at ?? NOW).toISOString(), strength: { text: x.strength ?? 'Even Strength' }, ...(x.pen ? { penalty: { minutes: x.pen } } : {}),
});

/** A game read live (EDM away, LA home): its core plays as `f.plays` says, polled every 5 seconds of the fake clock. */
function game(id: string) {
  const f = { plays: [] as any[], status: { state: 'in', completed: false } as any, away: 0, home: 0 };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.corePlays('nhl', id))) return { items: f.plays };
    if (url.startsWith(urls.summary('nhl', id))) return {
      header: { competitions: [{ status: { type: f.status }, competitors: [{ homeAway: 'home', id: LA, score: String(f.home) }, { homeAway: 'away', id: EDM, score: String(f.away) }] }] }, plays: [],
      boxscore: { players: [
        { team: { id: LA }, statistics: [{ name: 'goalies', athletes: [{ athlete: { id: PEOPLE.kuemper[0] } }, { athlete: { id: PEOPLE.forsberg[0] } }] }] },
        { team: { id: EDM }, statistics: [{ name: 'goalies', athletes: [{ athlete: { id: PEOPLE.levi[0] } }] }] },
      ] },
    };
    throw new Error(`unexpected fetch ${url}`);
  };
  const tracker = new GameTracker('nhl', id, LA, EDM, { sawPre: true });
  const poll = async (n = 1) => { for (let i = 0; i < n; i++) { NOW += 5000; await tracker.poll(); } };
  const put = (p: any) => { const i = f.plays.findIndex((x) => x.id === p.id); if (i >= 0) f.plays[i] = p; else f.plays.push(p); };
  const take = (pid: string) => { f.plays = f.plays.filter((x) => x.id !== pid); };
  return { f, tracker, poll, put, take };
}
const save = (id: string, shooter: keyof typeof PEOPLE, goalie: keyof typeof PEOPLE, teamId: string, x: Record<string, any> = {}) =>
  core(id, 'Shot', `${PEOPLE[shooter][1]} Wrist Shot saved by ${PEOPLE[goalie][1]}`, teamId, [[PEOPLE[shooter][0], 'shooter'], [PEOPLE[goalie][0], 'saver']], x);
/** A goal ESPN first posts as a missed shot (the shooter, and a second player with no role), then types a saved shot, then a goal. */
const missed = (id: string, shooter: keyof typeof PEOPLE, goalie: keyof typeof PEOPLE, x: Record<string, any> = {}) =>
  core(id, 'Missed', 'Missed Shot', EDM, [[PEOPLE[shooter][0], 'shooter'], [PEOPLE[goalie][0], null]], x);
const goal = (id: string, shooter: keyof typeof PEOPLE, away: number, home: number, x: Record<string, any> = {}) =>
  core(id, 'Goal', `${PEOPLE[shooter][1]} Goal (4) Wrist Shot, assists: Connor McDavid (11)`, EDM, [[PEOPLE[shooter][0], 'scorer'], [PEOPLE.mcdavid[0], 'assister']], { scoring: true, away, home, ...x });

test('a play with no team and no shooter is no goalie change: no false pull, and the real pull counts the goals first posted as missed shots', async () => {
  device('kuemper-fan', [P('kuemper')]);
  const x = game('G-PULL');
  await x.poll();
  x.put(save('s1', 'draisaitl', 'kuemper', EDM, { clock: 700 }));
  x.put(save('s2', 'podkolzin', 'kuemper', EDM, { clock: 650 }));
  await x.poll();
  // The phantom: Edmonton's goalie "saved" a shot, no team, no shooter; ESPN takes it out 20 seconds later.
  x.put(core('ghost', 'Shot', ' saved by Devon Levi', undefined, [[PEOPLE.levi[0], 'saver']], { clock: 600 }));
  await x.poll();
  x.take('ghost');
  await x.poll(6);
  assert.deepEqual(feed('kuemper-fan'), [], 'Kuemper is still in net: nothing');
  // Three goals, each posted as a missed shot and made a goal 10 to 30 seconds later.
  for (const [i, id] of ['g1', 'g2', 'g3'].entries()) {
    x.put(missed(id, 'draisaitl', 'kuemper', { clock: 500 - i * 100, away: i, home: 0 }));
    await x.poll();
    x.put(goal(id, 'draisaitl', i + 1, 0, { clock: 500 - i * 100 }));
    await x.poll(2);
  }
  assert.deepEqual(feed('kuemper-fan').map((r) => r[1]), ['Darcy Kuemper let one in 🥅', 'Darcy Kuemper let one in 🥅', 'Darcy Kuemper let one in 🥅']);
  // The 2nd period: Forsberg's first save, with its shooter and team.
  x.put(save('s3', 'draisaitl', 'forsberg', EDM, { period: 2, clock: 1100, away: 3 }));
  await x.poll();
  const pulls = feed('kuemper-fan').filter((r) => r[0] === 'nhl.goalie.pulled');
  assert.deepEqual(pulls.map((r) => r[1]), ['Darcy Kuemper got pulled after allowing 3 goals on 5 shots'], '3 goals and 2 saves: 5 shots, the goals counted as shots');
});

test("a goal first posted as a missed shot: the shooter's alert gets a line, the goalie and team alerts go out once, with no extra push", async () => {
  device('drai-fan', [P('draisaitl')]);
  device('kuemper-fan2', [P('kuemper')]);
  device('kings-fan', [`team:nhl:${LA}`]);
  const x = game('G-GOAL');
  await x.poll();
  const base = pushed('drai-fan');
  x.put(missed('m1', 'draisaitl', 'kuemper', { clock: 435 }));
  await x.poll(5); // the shot waits 20 seconds for ESPN to finish it (tor-uta-review.test.ts), here it is still a missed shot
  assert.deepEqual(feed('drai-fan'), [['nhl.shot_missed', 'Leon Draisaitl shot and missed', []]]);
  x.put(goal('m1', 'draisaitl', 1, 0, { clock: 436 }));
  await x.poll();
  assert.deepEqual(feed('drai-fan'), [['nhl.shot_missed', 'Leon Draisaitl shot and missed', ['ESPN has since changed this: Leon Draisaitl scored.']]]);
  assert.equal(pushed('drai-fan'), base + 1, 'the line never pushes');
  assert.deepEqual(feed('kuemper-fan2').map((r) => r[1]), ['Darcy Kuemper let one in 🥅']);
  assert.deepEqual(feed('kings-fan').map((r) => r[1]), ['Oilers scored to take the lead over the Kings']);
  await x.poll(3);
  assert.equal(feed('kuemper-fan2').length, 1);
  assert.equal(feed('kings-fan').length, 1, 'a re-poll sends nothing');
});

test("a shot ESPN retypes is a line on the shooter's alert; a play ESPN takes out is a line too", async () => {
  device('kempe-fan', [P('kempe')]);
  const x = game('G-RETYPE');
  await x.poll();
  x.put(core('k1', 'Missed', 'Missed Shot', LA, [[PEOPLE.kempe[0], 'shooter']], { clock: 400 }));
  await x.poll(5);
  x.put(core('k1', 'Blocked', 'Adrian Kempe shot blocked by Connor McDavid', LA, [[PEOPLE.kempe[0], 'shooter'], [PEOPLE.mcdavid[0], 'blocker']], { clock: 400 }));
  await x.poll();
  assert.deepEqual(feed('kempe-fan'), [['nhl.shot_missed', 'Adrian Kempe shot and missed', ['ESPN has since changed this: the shot was blocked.']]]);
  x.put(core('k2', 'Missed', 'Missed Shot', LA, [[PEOPLE.kempe[0], 'shooter']], { clock: 300 }));
  await x.poll(5);
  x.take('k2');
  await x.poll(8); // gone for GONE_MS
  const rows = feed('kempe-fan');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1][2], ['ESPN has since taken this play out.']);
});

test("an empty-netter ESPN first posted as an even-strength goal: the goalie's alert says nobody was in net, and the team's says into an empty net", async () => {
  device('forsberg-fan', [P('forsberg')]);
  device('kings-fan3', [`team:nhl:${LA}`]);
  device('en-fan', [`team:nhl:${LA}`], { ...everything, types: { ...everything.types, 'team.opponent_scored': false, 'team.fell_behind': false } });
  const x = game('G-EN');
  await x.poll();
  x.put(save('e0', 'draisaitl', 'forsberg', EDM, { period: 3, clock: 1200 }));
  await x.poll();
  x.put(goal('e1', 'podkolzin', 4, 1, { period: 3, clock: 1062 }));
  await x.poll();
  assert.deepEqual(feed('forsberg-fan').filter((r) => r[0] === 'nhl.goalie.goal_allowed').map((r) => r[1]), ['Anton Forsberg let one in 🥅'], 'first posted as even strength');
  x.put(goal('e1', 'podkolzin', 4, 1, { period: 3, clock: 1062, strength: 'Empty Net' }));
  await x.poll();
  const goalie = feed('forsberg-fan').find((r) => r[0] === 'nhl.goalie.goal_allowed')!;
  assert.deepEqual(goalie[2], ['ESPN has since marked this an empty-net goal: nobody was in net.']);
  const kings = feed('kings-fan3').find((r) => /scored/.test(r[1] as string))!;
  assert.deepEqual(kings[2], ['Into an empty net.'], 'a line on the alert the device already had');
  assert.deepEqual(feed('en-fan').map((r) => [r[0], r[1]]), [['nhl.team.empty_net_goal', 'Kings gave up an empty-netter to the Oilers']], 'a device that wanted only this gets it as its alert');
  await x.poll(3);
  assert.equal(feed('en-fan').length, 1);
});

test('a penalty posted as "Penalty Shot Infraction": the call is a line on the alert, with no push', async () => {
  device('doughty-fan', [P('doughty')]);
  const x = game('G-PEN');
  await x.poll();
  const base = pushed('doughty-fan');
  x.put(core('pn1', 'Penalty Shot Infraction', 'Drew Doughty Minor', LA, [[PEOPLE.doughty[0], null]], { pen: '2', clock: 464 }));
  await x.poll(25); // a penalty ESPN has not named waits 2 minutes (tor-uta-review.test.ts); still the placeholder after that, it goes out as a minor
  assert.deepEqual(feed('doughty-fan'), [['nhl.penalty', 'Drew Doughty went to the box (2 min, minor)', []]]);
  x.put(core('pn1', 'Tripping', 'Drew Doughty Tripping against Kasperi Kapanen', LA, [[PEOPLE.doughty[0], null], ['3114775', null]], { pen: '2', clock: 464 }));
  await x.poll();
  assert.deepEqual(feed('doughty-fan'), [['nhl.penalty', 'Drew Doughty went to the box (2 min, minor)', ['ESPN has since called it tripping against Kasperi Kapanen.']]]);
  assert.equal(pushed('doughty-fan'), base + 1);
});

test("a final the header has short of the plays: the loss says 4 to 1, and a scoreboard's period scores say it too", async () => {
  device('kings-loss', [`team:nhl:${LA}`]);
  const x = game('G-FINAL');
  await x.poll();
  x.put(goal('f1', 'draisaitl', 1, 0, { period: 1, clock: 100 }));
  x.put(goal('f2', 'draisaitl', 2, 0, { period: 1, clock: 200 }));
  x.put(goal('f3', 'draisaitl', 3, 0, { period: 2, clock: 300 }));
  x.put(core('f4', 'Goal', 'Vasily Podkolzin Goal (7) Wrist Shot', EDM, [[PEOPLE.podkolzin[0], 'scorer']], { scoring: true, away: 4, home: 1, period: 3, clock: 1062, strength: 'Empty Net' }));
  x.put(core('end', 'End of Game', 'Game End', undefined, [], { away: 4, home: 1, period: 3, clock: 1200 }));
  x.f.status = { state: 'post', completed: true };
  x.f.away = 3; x.f.home = 1; // the header, as ESPN had it for five minutes after the final
  await x.poll(3);
  const loss = (db.prepare(`SELECT e.title, e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'kings-loss' AND e.type = 'team.lost'`).get() as any);
  assert.equal(loss.body, 'Final Score: 4 to 1');
  const c = (score: string, ls: number[]) => ({ score, linescores: ls.map((n) => ({ displayValue: String(n) })) });
  assert.equal(competitorScore('nhl', c('3', [3, 0, 1])), 4, 'its periods add to more than the score');
  assert.equal(competitorScore('nhl', c('4', [3, 0, 1])), 4);
  assert.equal(competitorScore('nhl', c('3', [1, 1, 0, 0, 1])), 3, "a fifth entry (a shootout's) is not added");
  assert.equal(competitorScore('nba', c('100', [30, 30, 30, 20])), 100, 'only hockey');
});

test("the box score's goalies keep to their teams: a save credited to Edmonton's goalie on an Edmonton shot never puts him in Los Angeles's net", () => {
  const g: any = { league: 'nhl', gameId: 'G', homeId: LA, awayId: EDM, goalies: new Map([[LA, PEOPLE.kuemper[0]], [EDM, PEOPLE.levi[0]]]), goalieTeam: new Map([[PEOPLE.levi[0], EDM], [PEOPLE.kuemper[0], LA]]) };
  D.observePlay(g, D.fromCorePlay(save('w1', 'draisaitl', 'levi', EDM)));
  assert.equal(g.goalies.get(LA), PEOPLE.kuemper[0], 'wrong side: nothing moves');
  D.observePlay(g, D.fromCorePlay(save('w2', 'kempe', 'levi', LA)));
  assert.equal(g.goalies.get(EDM), PEOPLE.levi[0], 'a save by Levi on a Kings shot is his own side, as before');
});

test("mergePlays: an NHL play's core copy with no team takes the summary's team; other leagues are left alone", () => {
  const a = D.fromCorePlay(core('p1', 'Goal', 'Goal', undefined, [], { scoring: true }));
  const b = D.fromSitePlay({ id: 'p1', type: { text: 'Goal' }, text: 'Goal', team: { id: EDM }, participants: [], scoringPlay: true });
  assert.equal(D.mergePlays([a], [b], true)[0].teamId, EDM);
  assert.equal(D.mergePlays([a], [b])[0].teamId, undefined);
});
