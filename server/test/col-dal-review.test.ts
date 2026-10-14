// What the Avalanche at Stars recording (COL at DAL, 2026-10-13, ESPN 401892498) found that the hockey ledger and waits (EDM at LA, TOR at UTA)
// left, through a real GameTracker on plays shaped like the recording's: a shot ESPN posts after the game moved on shows the score now (F5); a
// shot first seen minutes after it happened is back-fill and alerts nobody (F5); hockey plays are watched for 45 minutes, so a giveaway ESPN
// retypes 26 minutes later gets its line (F6); a fight's title leaves out "served by …" (F2); a penalty play that names the call before the
// player ("Instigator against Radek Faksa") alerts nobody until it names him, not the other side's player (F2); a placeholder penalty that
// ESPN takes out within 10 minutes never alerts (F3).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
let NOW = Date.parse('2026-10-14T01:00:00Z');
Date.now = () => NOW;
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, setPushSender } = await import('../src/fanout.ts');
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const COL = '17', DAL = '9';
const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, logo, logo_w, logo_h, updated_at) VALUES (?, 'nhl', ?, ?, ?, ?, ?, 'x', 500, 500, 0)`);
team.run(`team:nhl:${COL}`, COL, 'Colorado Avalanche', 'Avalanche', 'COL', 'Colorado');
team.run(`team:nhl:${DAL}`, DAL, 'Dallas Stars', 'Stars', 'DAL', 'Dallas');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, position, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'nhl', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
const PEOPLE = {
  mackinnon: ['3041969', 'Nathan MacKinnon', COL, 'C'], blackwood: ['3904177', 'Mackenzie Blackwood', COL, 'G'], svechkov: ['4874736', 'Fedor Svechkov', COL, 'LW'],
  schwartz: ['5835', 'Jaden Schwartz', COL, 'LW'], oettinger: ['4196914', 'Jake Oettinger', DAL, 'G'], seguin: ['5430', 'Tyler Seguin', DAL, 'C'],
  faksa: ['2976842', 'Radek Faksa', DAL, 'C'], harley: ['4565239', 'Thomas Harley', DAL, 'D'],
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
  .map((r) => [r.type, r.title, r.extra ? JSON.parse(r.extra) : [], r.body]);
const P = (who: keyof typeof PEOPLE) => `player:nhl:${PEOPLE[who][0]}`;

/** A play as ESPN's core feed posts it. `parts`: [athlete id, role]. ESPN's hockey clock counts up: `clock` is seconds played in the period. */
const core = (id: string, type: string, text: string, teamId: string | undefined, parts: [string, string | null][], x: Record<string, any> = {}) => ({
  id, type: { text: type }, text, ...(teamId ? { team: { $ref: `http://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/seasons/2027/teams/${teamId}?lang=en&region=us` } } : {}),
  participants: parts.map(([a, role]) => ({ athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/seasons/2027/athletes/${a}?lang=en&region=us` }, ...(role ? { type: role } : {}) })),
  awayScore: x.away ?? 0, homeScore: x.home ?? 0, scoringPlay: !!x.scoring, scoreValue: x.scoring ? 1 : 0, period: { number: x.period ?? 1 }, clock: { value: x.clock ?? 600, displayValue: '10:00' },
  wallclock: new Date(x.at ?? NOW).toISOString(), strength: { text: 'Even Strength' }, ...(x.pen ? { penalty: { minutes: x.pen } } : {}),
});

/** A game read live (COL away, DAL home): its core plays as `f.plays` says, polled every 5 seconds of the fake clock. */
function game(id: string) {
  const f = { plays: [] as any[], status: { state: 'in', completed: false } as any };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.corePlays('nhl', id))) return { items: f.plays };
    if (url.startsWith(urls.summary('nhl', id))) return {
      header: { competitions: [{ status: { type: f.status }, competitors: [{ homeAway: 'home', id: DAL, score: '0' }, { homeAway: 'away', id: COL, score: '0' }] }] }, plays: [],
      boxscore: { players: [
        { team: { id: DAL }, statistics: [{ name: 'goalies', athletes: [{ athlete: { id: PEOPLE.oettinger[0] } }] }] },
        { team: { id: COL }, statistics: [{ name: 'goalies', athletes: [{ athlete: { id: PEOPLE.blackwood[0] } }] }] },
      ] },
    };
    throw new Error(`unexpected fetch ${url}`);
  };
  const tracker = new GameTracker('nhl', id, DAL, COL, { sawPre: true });
  const poll = async (n = 1) => { for (let i = 0; i < n; i++) { NOW += 5000; await tracker.poll(); } };
  const put = (p: any) => { const i = f.plays.findIndex((x) => x.id === p.id); if (i >= 0) f.plays[i] = p; else f.plays.push(p); };
  const take = (pid: string) => { f.plays = f.plays.filter((x) => x.id !== pid); };
  return { f, tracker, poll, put, take };
}
const saved = (id: string, x: Record<string, any> = {}) =>
  core(id, 'Shot', 'Nathan MacKinnon Snap Shot saved by Jake Oettinger', COL, [[PEOPLE.mackinnon[0], 'shooter'], [PEOPLE.oettinger[0], 'saver']], x);

test('a shot ESPN posts after the game moved on shows the score now, not the score of its moment', async () => {
  device('mac-fan', [P('mackinnon')]);
  const x = game('G-LATE');
  await x.poll();
  x.put(core('goal1', 'Goal', 'Tyler Seguin Goal (2) Snap Shot, assists: none', DAL, [[PEOPLE.seguin[0], 'scorer']], { scoring: true, home: 1, away: 0, clock: 1146 }));
  await x.poll(2);
  // 10:37 of the 1st, posted 8 minutes of game time late with the score it had then (0-0).
  x.put(saved('late1', { clock: 637, home: 0, away: 0 }));
  await x.poll(6);
  const rows = feed('mac-fan');
  assert.equal(rows.length, 1);
  assert.match(rows[0][3], /COL 0, DAL 1$/, 'the game is 1-0 now');
  // A shot in order keeps the score of its moment.
  x.put(saved('live1', { clock: 1150, home: 1, away: 0 }));
  await x.poll(6);
  assert.match(feed('mac-fan')[1][3], /COL 0, DAL 1$/);
});

test('an alert that went out on time keeps its score when ESPN edits the play after the game has moved on', async () => {
  device('faksa-fan2', [P('faksa')]);
  const x = game('G-KEEP');
  await x.poll();
  x.put(core('g0', 'Goal', 'Tyler Seguin Goal (2) Snap Shot, assists: none', DAL, [[PEOPLE.seguin[0], 'scorer']], { scoring: true, home: 1, away: 0, clock: 900 }));
  x.put(core('pen1', 'Slashing', 'Radek Faksa Slashing', DAL, [[PEOPLE.faksa[0], null]], { pen: '2', clock: 1000, home: 1, away: 0 }));
  await x.poll(2);
  assert.match(feed('faksa-fan2')[0][3], /COL 0, DAL 1$/);
  x.put(core('g1', 'Goal', 'Nathan MacKinnon Goal (4) Backhand, assists: none', COL, [[PEOPLE.mackinnon[0], 'scorer']], { scoring: true, home: 1, away: 1, clock: 1146 }));
  await x.poll(2);
  x.put(core('pen1', 'Slashing', 'Radek Faksa Slashing against Nathan MacKinnon', DAL, [[PEOPLE.faksa[0], null], [PEOPLE.mackinnon[0], null]], { pen: '2', clock: 1000, home: 1, away: 0 }));
  await x.poll(4);
  const rows = feed('faksa-fan2');
  assert.equal(rows.length, 1);
  assert.match(rows[0][3], /COL 0, DAL 1$/, 'the score it went out with, not the score after the edit');
});

test('a shot first seen minutes after it happened is back-fill: it alerts nobody, and the next shot still does', async () => {
  device('mac-fan2', [P('mackinnon')]);
  const x = game('G-STALE');
  await x.poll();
  x.put(saved('old1', { at: NOW - 19 * 60_000, clock: 637 }));
  await x.poll(6);
  assert.deepEqual(feed('mac-fan2'), [], 'posted 19 minutes late');
  x.put(saved('new1', { clock: 700 }));
  await x.poll(6);
  assert.equal(feed('mac-fan2').length, 1);
});

test('hockey plays are watched for 45 minutes: a giveaway ESPN makes a takeaway 26 minutes on gets its line', async () => {
  device('seguin-fan', [P('seguin')]);
  const x = game('G-GIVE');
  await x.poll();
  x.put(core('gv1', 'Giveaway', 'Giveaway by Tyler Seguin', DAL, [[PEOPLE.seguin[0], 'giver']], { clock: 1100 }));
  await x.poll(2);
  assert.deepEqual(feed('seguin-fan').map((r) => r[1]), ['Tyler Seguin gave the puck away']);
  NOW += 26 * 60_000;
  x.put(core('gv1', 'Takeaway', 'Takeaway by Nathan MacKinnon', COL, [[PEOPLE.mackinnon[0], 'taker']], { clock: 1100 }));
  await x.poll(2);
  const rows = feed('seguin-fan');
  assert.equal(rows.length, 1);
  assert.equal(rows[0][2].length, 1, 'a line says ESPN changed it');
});

test('a fight: "served by" is not the opponent', async () => {
  device('svech-fan', [P('svechkov')]);
  const x = game('G-FIGHT');
  await x.poll();
  x.put(core('f1', 'Fighting', 'Fedor Svechkov Fighting against Radek Faksa served by Jaden Schwartz', COL, [[PEOPLE.svechkov[0], null], [PEOPLE.faksa[0], null]], { pen: '5', clock: 1064 }));
  await x.poll(2);
  assert.deepEqual(feed('svech-fan').map((r) => r[1]), ['Fedor Svechkov dropped the gloves with Radek Faksa']);
});

test('a penalty that names the call before the player alerts nobody, and the player ESPN names then', async () => {
  device('faksa-fan', [P('faksa')]);
  device('svech-fan2', [P('svechkov')]);
  const x = game('G-INST');
  await x.poll();
  x.put(core('i1', 'Instigator', 'Instigator against Radek Faksa', COL, [[PEOPLE.faksa[0], null]], { pen: '2', clock: 1064 }));
  await x.poll(3);
  assert.deepEqual(feed('faksa-fan'), [], 'Faksa was attacked, he did not instigate');
  x.put(core('i1', 'Instigator', 'Fedor Svechkov Instigator against Radek Faksa', COL, [[PEOPLE.svechkov[0], null], [PEOPLE.faksa[0], null]], { pen: '2', clock: 1064 }));
  await x.poll(2);
  assert.deepEqual(feed('svech-fan2').map((r) => r[1]), ['Fedor Svechkov went to the box (2 min, Instigator)']);
  assert.deepEqual(feed('faksa-fan'), []);
});

test('a placeholder penalty ESPN takes out within 10 minutes never alerts', async () => {
  device('schwartz-fan', [P('schwartz')]);
  const x = game('G-PHANTOM');
  await x.poll();
  x.put(core('ph1', 'Penalty Shot Infraction', 'Jaden Schwartz Minor', COL, [[PEOPLE.schwartz[0], null]], { pen: '2', clock: 1064 }));
  await x.poll(70); // 350 seconds: past the old 2-minute wait
  assert.deepEqual(feed('schwartz-fan'), []);
  x.take('ph1');
  await x.poll(70);
  assert.deepEqual(feed('schwartz-fan'), []);
});
