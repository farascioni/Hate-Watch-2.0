// What the two October 14 2026 hockey recordings found (MTL at WSH, ESPN 401892504; DAL at COL, 401892505), through a real GameTracker on plays
// shaped like the recordings': a copy of a shot ESPN deletes minutes later is feed only for 60 seconds (MTL F1); ESPN correcting a goal's
// assists is a line and the text follows (MTL F3); a penalty body follows ESPN's "against …" (MTL F4); a shot deleted just before the final
// still gets its "taken out" line (MTL F5); a shootout is not a tie (DAL F1); a goal with no scorer waits 90 seconds and then says "scorer to
// be named", never ", assists: none" (DAL F2); a goal ESPN takes out after it pushed pushes "Goal taken off the board" (DAL F3); a recycled
// play id is lines only, and a line never carries a bare type (DAL F4); a shootout attempt on a recycled id still pushes (DAL F5).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
let NOW = Date.parse('2026-10-15T01:00:00Z');
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
  oettinger: ['4196914', 'Jake Oettinger', DAL, 'G'], harley: ['4565239', 'Thomas Harley', DAL, 'D'], faksa: ['2976842', 'Radek Faksa', DAL, 'C'],
} as const;
for (const [id, name, teamId, pos] of Object.values(PEOPLE)) player.run(`player:nhl:${id}`, id, name, `team:nhl:${teamId}`, pos);
loadCatalog();

setPushSender(() => {});
const everything = { ...DEFAULT_PREFS, types: Object.fromEntries(EVENT_TYPES.map((t) => [t.id, true])), pushTypes: Object.fromEntries(EVENT_TYPES.map((t) => [t.id, true])) };
const device = (id: string, targets: string[]) => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(id, 's', 'ios', `tok-${id}`, JSON.stringify(everything));
  targets.forEach((t, i) => db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, ?)').run(id, t, i + 1));
};
const feed = (id: string) => (db.prepare(`SELECT e.type, e.title, e.body, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.type != 'team.game_start' ORDER BY f.rowid`).all(id) as any[])
  .map((r) => [r.type, r.title, r.extra ? JSON.parse(r.extra) : [], r.body]);
const P = (who: keyof typeof PEOPLE) => `player:nhl:${PEOPLE[who][0]}`;
const T = (id: string) => `team:nhl:${id}`;

/** A play as ESPN's core feed posts it. `parts`: [athlete id, role]. ESPN's hockey clock counts up: `clock` is seconds played in the period. */
const core = (id: string, type: string, text: string, teamId: string | undefined, parts: [string, string | null][], x: Record<string, any> = {}) => ({
  id, type: { text: type }, text, ...(teamId ? { team: { $ref: `http://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/seasons/2027/teams/${teamId}?lang=en&region=us` } } : {}),
  participants: parts.map(([a, role]) => ({ athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/seasons/2027/athletes/${a}?lang=en&region=us` }, ...(role ? { type: role } : {}) })),
  awayScore: x.away ?? 0, homeScore: x.home ?? 0, scoringPlay: !!x.scoring, scoreValue: x.scoring ? 1 : 0, period: { number: x.period ?? 1 }, clock: { value: x.clock ?? 600, displayValue: '10:00' },
  wallclock: new Date(x.at ?? NOW).toISOString(), strength: { text: 'Even Strength' }, ...(x.pen ? { penalty: { minutes: x.pen } } : {}),
});

/** A game read live (COL away, DAL home): its core plays as `f.plays` says, the header's score as `f.home` and `f.away`, polled every 5 seconds of the fake clock. */
function game(id: string) {
  const f = { plays: [] as any[], status: { state: 'in', completed: false } as any, home: 0, away: 0 };
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.corePlays('nhl', id))) return { items: f.plays };
    if (url.startsWith(urls.summary('nhl', id))) return {
      header: { competitions: [{ status: { type: f.status }, competitors: [{ homeAway: 'home', id: DAL, score: String(f.home) }, { homeAway: 'away', id: COL, score: String(f.away) }] }] }, plays: [],
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
const saved = (id: string, x: Record<string, any> = {}, who: keyof typeof PEOPLE = 'mackinnon') =>
  core(id, 'Shot', `${PEOPLE[who][1]} Snap Shot saved by Jake Oettinger`, COL, [[PEOPLE[who][0], 'shooter'], [PEOPLE.oettinger[0], 'saver']], x);
const goal = (id: string, text: string, x: Record<string, any> = {}) =>
  core(id, 'Goal', text, COL, [[PEOPLE.svechkov[0], 'scorer']], { scoring: true, away: 1, ...x });
const eventsLike = (pattern: string) => (db.prepare('SELECT id, body FROM events WHERE id LIKE ?').all(pattern) as { id: string; body: string }[]);

test('MTL F1: a copy of a shot is feed only for a minute, and never alerts when ESPN deletes it', async () => {
  device('mac-copy', [P('mackinnon')]);
  const x = game('G-COPY');
  await x.poll();
  x.put(saved('c1', { clock: 212 }));
  await x.poll(6); // a shot waits 20 seconds for ESPN to type it
  assert.equal(feed('mac-copy').length, 1, 'the first shot alerts as ever');
  x.put(saved('c2', { clock: 214 })); // the same shooter, the same result, two game seconds on
  await x.poll(8);
  x.take('c2'); // ESPN deletes the copy 44 seconds on
  await x.poll(20);
  assert.equal(feed('mac-copy').length, 1, 'the copy never alerted');
});

test('MTL F1: a repeat that is still in ESPN\'s feed a minute later alerts then', async () => {
  device('mac-repeat', [P('mackinnon')]);
  const x = game('G-REPEAT');
  await x.poll();
  x.put(saved('r1', { clock: 164 }));
  await x.poll(6);
  x.put(saved('r2', { clock: 165 }));
  await x.poll(6);
  assert.equal(feed('mac-repeat').length, 1, 'held');
  await x.poll(10);
  assert.equal(feed('mac-repeat').length, 2, 'a real second shot, a minute late');
});

test('MTL F3: ESPN changing a goal\'s assists is a line, the text follows, and an assist list filling in is not a change', async () => {
  device('dal-assist', [T(DAL)]);
  const x = game('G-ASSIST');
  await x.poll();
  x.put(goal('a1', 'Fedor Svechkov Goal (2) Wrist Shot, assists: Radek Faksa (2)', { clock: 300 }));
  x.put(goal('a2', 'Fedor Svechkov Goal (3) Wrist Shot, assists: none', { clock: 900, away: 2 }));
  x.put(goal('a3', 'Fedor Svechkov Goal (4) Wrist Shot, assists: Radek Faksa (2)', { clock: 1000, away: 3 }));
  await x.poll(2);
  assert.equal(feed('dal-assist').length, 3);
  NOW += 38 * 60_000;
  x.put(goal('a1', 'Fedor Svechkov Goal (2) Wrist Shot, assists: Thomas Harley (4)', { clock: 300 })); // 38 minutes on
  x.put(goal('a2', 'Fedor Svechkov Goal (3) Wrist Shot, assists: Radek Faksa (3)', { clock: 900, away: 2 }));
  x.put(goal('a3', 'Fedor Svechkov Goal (4) Wrist Shot, assists: Radek Faksa (2), Thomas Harley (4)', { clock: 1000, away: 3 }));
  await x.poll(2);
  const [first, second, third] = feed('dal-assist');
  assert.deepEqual(first[2], ['ESPN has since changed the assists.']);
  assert.match(first[3], /assists: Thomas Harley \(4\)/, 'the row follows ESPN');
  assert.deepEqual(second[2], [], '"none" filling in is ESPN\'s lag, not a correction');
  assert.match(second[3], /assists: Radek Faksa \(3\)/);
  assert.deepEqual(third[2], [], 'a second assist joining the first is lag, not a correction');
});

test('MTL F4: a penalty\'s body follows ESPN adding "against …"', async () => {
  device('faksa-pen', [P('faksa')]);
  const x = game('G-PEN');
  await x.poll();
  x.put(core('p1', 'Interference', 'Radek Faksa Interference', DAL, [[PEOPLE.faksa[0], null]], { pen: '2', clock: 700 }));
  await x.poll(2);
  assert.match(feed('faksa-pen')[0][3], /Radek Faksa Interference — /);
  x.put(core('p1', 'Interference', 'Radek Faksa Interference against Nathan MacKinnon', DAL, [[PEOPLE.faksa[0], null], [PEOPLE.mackinnon[0], null]], { pen: '2', clock: 700 }));
  await x.poll(3);
  const rows = feed('faksa-pen');
  assert.equal(rows.length, 1);
  assert.match(rows[0][3], /Interference against Nathan MacKinnon — /);
  assert.deepEqual(rows[0][2], [], 'silently');
});

test('MTL F5: a shot ESPN deletes just before the final still gets its "taken out" line', async () => {
  device('mac-final', [P('mackinnon')]);
  const x = game('G-LASTCALL');
  await x.poll();
  x.put(saved('l1', { clock: 3000, at: NOW - 5000 }));
  x.put(core('l2', 'Takeaway', 'Takeaway by Radek Faksa', DAL, [[PEOPLE.faksa[0], 'taker']], { clock: 3010, at: NOW }));
  await x.poll(6);
  assert.equal(feed('mac-final').length, 1);
  x.take('l1');
  x.f.status = { state: 'post', completed: true };
  x.f.home = 3; x.f.away = 2;
  await x.poll();
  assert.match(feed('mac-final')[0][2].join(' '), /taken this play out/);
});

test('DAL F1: a shootout is not a tie: the End Game play\'s tally does not finish the game, the scoreboard\'s final does', async () => {
  device('col-so', [T(COL)]);
  const x = game('G-SO');
  await x.poll();
  x.put(core('so0', 'Start of Shootout', 'Start of Shootout', undefined, [], { period: 5, clock: 0 }));
  x.put(core('so9', 'End Game', 'End of Game', undefined, [], { period: 5, clock: 300, home: 2, away: 1 })); // the shootout's tally
  x.f.home = 2; x.f.away = 2;
  await x.poll(3);
  assert.deepEqual(feed('col-so').filter((r) => /lost|tied/i.test(r[1])), [], 'not finished from the plays');
  x.f.status = { state: 'post', completed: true };
  x.f.home = 3;
  await x.poll();
  const lost = feed('col-so').find((r) => r[0] === 'team.lost');
  assert.ok(lost, 'the Avalanche lost');
  assert.match(lost[1], /Avalanche lost to the Stars/);
  assert.match(lost[3], /^Lost to .+ in a shootout\. Final [A-Z]+ 3, [A-Z]+ 2\.$/);
});

test('DAL F2: a goal with no scorer waits, and says "scorer to be named", never ", assists: none"', async () => {
  device('dal-unnamed', [T(DAL)]);
  device('dal-named', [T(DAL)]);
  const x = game('G-UNNAMED');
  await x.poll();
  x.put(goal('u1', ', assists: none', { clock: 400 }));
  await x.poll(12); // a minute: still waiting for ESPN
  assert.equal(feed('dal-unnamed').length, 0);
  await x.poll(10);
  const rows = feed('dal-unnamed');
  assert.equal(rows.length, 1);
  assert.match(rows[0][3], /^Goal, scorer to be named/);
  assert.doesNotMatch(rows[0][3], /^\s*,/);
  const y = game('G-NAMED');
  await y.poll();
  y.put(goal('n1', ', assists: none', { clock: 400 }));
  await y.poll(6);
  y.put(goal('n1', 'Fedor Svechkov Goal (2) Wrist Shot, assists: none', { clock: 400 }));
  await y.poll(20);
  const named = feed('dal-named').filter((r) => /Svechkov Goal/.test(r[3]));
  assert.equal(named.length, 1, 'named inside the wait: one alert, with his name');
});

test('DAL F3: a goal ESPN takes out after it went out pushes "Goal taken off the board"', async () => {
  device('dal-off', [T(DAL)]);
  const x = game('G-OFF');
  await x.poll();
  x.put(goal('o1', 'Fedor Svechkov Goal (2) Wrist Shot, assists: none', { clock: 500 }));
  x.put(core('o2', 'Takeaway', 'Takeaway by Radek Faksa', DAL, [[PEOPLE.faksa[0], 'taker']], { clock: 520 })); // later plays exist, as in a real feed
  await x.poll(2);
  assert.equal(feed('dal-off').length, 1);
  x.take('o1');
  await x.poll(10);
  const rows = feed('dal-off');
  const off = rows.find((r) => r[1] === 'Goal taken off the board');
  assert.ok(off, 'the board alert');
  assert.match(off[3], /Colorado's goal was disallowed\. Still COL 0, DAL 0\.$/);
  assert.equal(rows.filter((r) => r[1] === 'Goal taken off the board').length, 1);
});

test('DAL F3: a goal missing only from the final read (a short read) does not push "taken off the board"', async () => {
  device('dal-final-off', [T(DAL)]);
  const x = game('G-OFF-FINAL');
  await x.poll();
  x.put(goal('f1', 'Fedor Svechkov Goal (2) Wrist Shot, assists: none', { clock: 500, at: NOW - 5000 }));
  x.put(core('f2', 'Takeaway', 'Takeaway by Radek Faksa', DAL, [[PEOPLE.faksa[0], 'taker']], { clock: 520, at: NOW }));
  await x.poll(2);
  x.take('f1');
  x.f.status = { state: 'post', completed: true };
  await x.poll();
  const rows = feed('dal-final-off');
  assert.equal(rows.filter((r) => r[1] === 'Goal taken off the board').length, 0);
  assert.equal(rows.length, 1, 'only the goal\'s own alert');
});

test('DAL F4: a recycled play id is lines only: the new shooter gets no alert, and no line says only "Blocked Shot"', async () => {
  device('mac-recycled', [P('mackinnon')]);
  device('svech-recycled', [P('svechkov')]);
  device('harley-recycled', [P('harley')]);
  const x = game('G-RECYCLED');
  await x.poll();
  x.put(saved('y1', { clock: 800 }));
  await x.poll(6);
  assert.equal(feed('mac-recycled').length, 1);
  x.put(saved('y1', { clock: 800 }, 'svechkov')); // ESPN reuses the id for another shooter's shot
  await x.poll(3);
  assert.equal(feed('svech-recycled').length, 0, 'no second alert for one play id');
  assert.equal(feed('mac-recycled').length, 1);
  assert.equal(feed('mac-recycled')[0][2].length, 1, 'a line says ESPN changed it');
  x.put(core('b1', 'Blocked Shot', 'Thomas Harley shot blocked by Nathan MacKinnon', DAL, [[PEOPLE.harley[0], 'shooter'], [PEOPLE.mackinnon[0], 'blocker']], { clock: 900 }));
  await x.poll(2);
  x.put(core('b1', 'Blocked Shot', 'Blocked Shot', DAL, [], { clock: 900 }));
  await x.poll(3);
  const bodies = eventsLike('G-RECYCLED:%:changed:%').map((e) => e.body);
  assert.ok(bodies.length > 0);
  assert.ok(bodies.every((b) => !/^Blocked Shot\b/.test(b)), `a line's body is never a bare type: ${bodies.join(' | ')}`);
});

test('DAL F5: a shootout attempt on a recycled id still pushes', async () => {
  device('svech-so', [P('svechkov')]);
  const x = game('G-RECYCLED-SO');
  await x.poll();
  x.put(saved('s1', { clock: 3000, period: 3 }));
  await x.poll(2);
  x.put(core('so0', 'Start of Shootout', 'Start of Shootout', undefined, [], { period: 5, clock: 0 }));
  await x.poll(2);
  x.put(core('s1', 'Shot', 'Fedor Svechkov Tip-In saved by Jake Oettinger', COL, [[PEOPLE.svechkov[0], 'shooter'], [PEOPLE.oettinger[0], 'saver']], { period: 5, clock: 100 }));
  await x.poll(3);
  assert.deepEqual(feed('svech-so').map((r) => r[0]), ['nhl.shootout_miss']);
});
