// What the Maple Leafs at Mammoth recording (TOR at UTA, 2026-10-13, ESPN 401892500) found that ESPN's later edits only fixed after the alert
// went out, through a real GameTracker on plays shaped like the recording's: a shot waits 20 seconds for ESPN to finish it, so a shot that
// becomes a goal sends no shot alert (F3, F4); a penalty typed "Penalty Shot Infraction" waits up to 10 minutes for its call and goes out
// as a minor if ESPN never names it, and a flip back to the placeholder is no call (F2); a goal with no scorer in its text holds the goalie's
// alert and the team's together, and the goals after it come in order (F1); a goal's alerts take ESPN's later text, shorter or longer, on
// their feed rows with no push (F1). A shootout and a new goalie's first save are never held.
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

const bodies = (gameId: string, type: string) => (db.prepare(`SELECT body FROM events WHERE id LIKE ? AND id NOT LIKE '%:changed:%' AND type = ? ORDER BY id`).all(`${gameId}:%`, type) as { body: string }[]).map((r) => r.body.replace(/ — .*$/, ''));

test('a shot waits 20 seconds for ESPN to finish it, and a shot that becomes a goal in that time sends no shot alert', async () => {
  device('drai-fan', [P('draisaitl')]);
  device('kuemper-fan', [P('kuemper'), `team:nhl:${LA}`]);
  const x = game('G-SHOT');
  await x.poll();
  x.put(core('a1', 'Missed', 'Leon Draisaitl Missed Shot Wide Left', EDM, [[PEOPLE.draisaitl[0], 'shooter']], { clock: 400 }));
  await x.poll(3); // 15 seconds
  assert.deepEqual(feed('drai-fan'), [], 'not yet');
  await x.poll(2);
  assert.deepEqual(feed('drai-fan').map((r) => r[1]), ['Leon Draisaitl shot and missed'], 'after 20 seconds, as it stands');
  // A second shot is a goal 10 seconds in: the shot's alert never goes out, the goal's alerts do, once.
  x.put(core('a2', 'Missed', 'Leon Draisaitl Missed Shot Off Crossbar', EDM, [[PEOPLE.draisaitl[0], 'shooter']], { clock: 300 }));
  await x.poll(2);
  x.put(goal('a2', 'draisaitl', 1, 0, { clock: 301 }));
  await x.poll(8);
  assert.deepEqual(feed('drai-fan').map((r) => r[1]), ['Leon Draisaitl shot and missed'], 'the goal is not a miss');
  assert.deepEqual(feed('kuemper-fan').map((r) => r[1]), ['Darcy Kuemper let one in 🥅'], 'the goalie and the team, one alert, as before the wait');
});

test('a penalty typed "Penalty Shot Infraction" waits for its call; unnamed after 10 minutes it goes out as a minor; a flip back is no call', async () => {
  device('doughty-fan', [P('doughty')]);
  device('kempe-fan', [P('kempe')]);
  const x = game('G-PEN2');
  await x.poll();
  const base = pushed('doughty-fan');
  x.put(core('p1', 'Penalty Shot Infraction', 'Drew Doughty Minor', LA, [[PEOPLE.doughty[0], null]], { pen: '2', clock: 464 }));
  await x.poll(10); // 50 seconds
  assert.deepEqual(feed('doughty-fan'), [], 'waiting for the call');
  x.put(core('p1', 'Tripping', 'Drew Doughty Tripping against Kasperi Kapanen', LA, [[PEOPLE.doughty[0], null], ['3114775', null]], { pen: '2', clock: 464 }));
  await x.poll();
  assert.deepEqual(feed('doughty-fan'), [['nhl.penalty', 'Drew Doughty went to the box (2 min, Tripping)', []]], 'one alert, named');
  assert.equal(pushed('doughty-fan'), base + 1);
  // ESPN puts the placeholder back for a few seconds: nothing is written on the alert.
  x.put(core('p1', 'Penalty Shot Infraction', 'Drew Doughty Minor', LA, [[PEOPLE.doughty[0], null]], { pen: '2', clock: 464 }));
  await x.poll(2);
  x.put(core('p1', 'Tripping', 'Drew Doughty Tripping against Kasperi Kapanen', LA, [[PEOPLE.doughty[0], null], ['3114775', null]], { pen: '2', clock: 464 }));
  await x.poll(2);
  assert.deepEqual(feed('doughty-fan'), [['nhl.penalty', 'Drew Doughty went to the box (2 min, Tripping)', []]]);
  // Never named: after 10 minutes it is a minor, and the call is a line when it comes.
  x.put(core('p2', 'Penalty Shot Infraction', 'Adrian Kempe Minor', LA, [[PEOPLE.kempe[0], null]], { pen: '2', clock: 300 }));
  await x.poll(119); // 595 seconds
  assert.deepEqual(feed('kempe-fan'), []);
  await x.poll(2);
  assert.deepEqual(feed('kempe-fan'), [['nhl.penalty', 'Adrian Kempe went to the box (2 min, minor)', []]]);
  x.put(core('p2', 'Slashing', 'Adrian Kempe Slashing against Connor McDavid', LA, [[PEOPLE.kempe[0], null], [PEOPLE.mcdavid[0], null]], { pen: '2', clock: 300 }));
  await x.poll();
  assert.deepEqual(feed('kempe-fan'), [['nhl.penalty', 'Adrian Kempe went to the box (2 min, minor)', ['ESPN has since called it slashing against Connor McDavid.']]]);
});

test('a fight ESPN flips back to the placeholder for a few seconds stays one fight alert: no lines, no penalty row', async () => {
  device('fight-fan', [P('kempe'), `team:nhl:${LA}`]);
  const x = game('G-FIGHT');
  await x.poll();
  const fight = (type: string, text: string) => core('f1', type, text, LA, [[PEOPLE.kempe[0], null], [PEOPLE.mcdavid[0], null]], { pen: '5', clock: 200 });
  x.put(fight('Fighting', 'Adrian Kempe Fighting against Connor McDavid'));
  await x.poll();
  const rows = () => feed('fight-fan').map((r) => [r[0], r[1], r[2]]);
  const first = rows();
  assert.deepEqual(first.map((r) => r[1]), ['Adrian Kempe dropped the gloves with Connor McDavid']);
  x.put(fight('Penalty Shot Infraction', 'Adrian Kempe Minor'));
  await x.poll(2);
  x.put(fight('Fighting', 'Adrian Kempe Fighting against Connor McDavid'));
  await x.poll(3);
  assert.deepEqual(rows(), first, 'one fight alert, no lines, no penalty row');
});

test('a goal with no scorer in its text holds the goalie and the team together; the goals after it come in order and the goalie keeps his push', async () => {
  device('both', [P('kuemper'), `team:nhl:${LA}`]);
  device('kings-fan', [`team:nhl:${LA}`]);
  const x = game('G-HOLD');
  await x.poll();
  const base = pushed('both');
  x.put(core('h1', 'Goal', ', assists: Connor McDavid (11)', EDM, [[PEOPLE.podkolzin[0], 'scorer'], [PEOPLE.mcdavid[0], 'assister']], { scoring: true, away: 1, home: 0, clock: 500 }));
  await x.poll(2);
  // Another goal, with its text whole, 10 seconds on: it waits its turn behind the first.
  x.put(goal('h2', 'draisaitl', 2, 0, { clock: 490 }));
  await x.poll(2);
  assert.deepEqual(feed('both').map((r) => r[1]), ['Darcy Kuemper let one in 🥅'], "the second goal's goalie alert (its text is whole), nothing for the first");
  assert.deepEqual(feed('kings-fan'), [], 'no score announced past the goal that has no scorer');
  x.put(core('h1', 'Goal', 'Vasily Podkolzin Goal (3) Wrist Shot, assists: Connor McDavid (11)', EDM, [[PEOPLE.podkolzin[0], 'scorer'], [PEOPLE.mcdavid[0], 'assister']], { scoring: true, away: 1, home: 0, clock: 500 }));
  await x.poll(2);
  assert.deepEqual(feed('kings-fan').map((r) => r[1]), ['Oilers scored to take the lead over the Kings', 'Oilers scored on the Kings'], 'both announced, in order, once');
  assert.equal(feed('both').filter((r) => r[0] === 'nhl.goalie.goal_allowed').length, 2);
  assert.equal(pushed('both'), base + 2, "the goalie's two alerts push once each");
  await x.poll(4);
  assert.equal(feed('kings-fan').length, 2, 'a re-poll sends nothing');
  assert.equal(bodies('G-HOLD', 'nhl.goalie.goal_allowed').length, 2);
});

test("a goal's alerts take ESPN's later text on their feed rows, shorter or longer, with no push; the shot alert from before keeps its words", async () => {
  device('both2', [P('kuemper'), `team:nhl:${LA}`, P('draisaitl')]);
  const x = game('G-TEXT');
  await x.poll();
  x.put(core('t1', 'Missed', 'Leon Draisaitl Missed Shot Off Crossbar', EDM, [[PEOPLE.draisaitl[0], 'shooter']], { clock: 400 }));
  await x.poll(5); // its alert goes out after the wait; the goal is a line on it
  x.put(core('t1', 'Goal', 'Leon Draisaitl Goal (4) Snap Shot, assists: none', EDM, [[PEOPLE.draisaitl[0], 'scorer']], { scoring: true, away: 1, home: 0, clock: 399 }));
  await x.poll(2);
  const before = pushed('both2');
  assert.deepEqual(bodies('G-TEXT', 'nhl.goalie.goal_allowed'), ['Leon Draisaitl Goal (4) Snap Shot, assists: none']);
  // ESPN: another scorer, with an assist; then one assist taken away.
  x.put(core('t1', 'Goal', 'Vasily Podkolzin Goal (3) Wrist Shot, assists: Connor McDavid (11), Leon Draisaitl (9)', EDM, [[PEOPLE.podkolzin[0], 'scorer']], { scoring: true, away: 1, home: 0, clock: 399 }));
  await x.poll();
  x.put(core('t1', 'Goal', 'Vasily Podkolzin Goal (3) Wrist Shot, assists: Leon Draisaitl (9)', EDM, [[PEOPLE.podkolzin[0], 'scorer']], { scoring: true, away: 1, home: 0, clock: 399 }));
  await x.poll();
  assert.deepEqual(bodies('G-TEXT', 'nhl.goalie.goal_allowed'), ['Vasily Podkolzin Goal (3) Wrist Shot, assists: Leon Draisaitl (9)']);
  assert.deepEqual(bodies('G-TEXT', 'team.fell_behind'), ['Vasily Podkolzin Goal (3) Wrist Shot, assists: Leon Draisaitl (9)'], "the team's alert too");
  assert.deepEqual(bodies('G-TEXT', 'nhl.shot_missed'), ['Leon Draisaitl Missed Shot Off Crossbar'], 'the shot alert keeps its words');
  assert.equal(pushed('both2'), before, 'a rewrite never pushes');
  // Back to a first version with no scorer: not a text to take.
  x.put(core('t1', 'Goal', ', assists: Leon Draisaitl (9)', EDM, [[PEOPLE.podkolzin[0], 'scorer']], { scoring: true, away: 1, home: 0, clock: 399 }));
  await x.poll();
  assert.deepEqual(bodies('G-TEXT', 'nhl.goalie.goal_allowed'), ['Vasily Podkolzin Goal (3) Wrist Shot, assists: Leon Draisaitl (9)']);
});

test("a shootout shot and a new goalie's first save are never held: the shootout miss and the pull go out at once", async () => {
  device('so-fan', [P('draisaitl')]);
  device('kuemper-fan3', [P('kuemper')]);
  const x = game('G-SO');
  await x.poll();
  x.put(goal('q1', 'draisaitl', 1, 0, { clock: 800 }));
  await x.poll(2);
  // The 2nd period: Forsberg's first save, with its shooter and team: judged at once, not after 20 seconds.
  x.put(save('q2', 'draisaitl', 'forsberg', EDM, { period: 2, clock: 1100, away: 1 }));
  await x.poll();
  assert.deepEqual(feed('kuemper-fan3').filter((r) => r[0] === 'nhl.goalie.pulled').map((r) => r[1]), ['Darcy Kuemper got pulled after allowing 1 goal on 1 shot']);
  x.put(core('so0', 'Period Start', 'Start of shootout', undefined, [], { period: 5, clock: 300, away: 1, home: 1 }));
  await x.poll();
  x.put(core('so1', 'Missed', 'Leon Draisaitl Missed Shot', EDM, [[PEOPLE.draisaitl[0], 'shooter']], { period: 5, clock: 290, away: 1, home: 1 }));
  await x.poll();
  assert.equal(feed('so-fan').filter((r) => r[0] === 'nhl.shootout_miss').length, 1, 'the very next poll');
});
