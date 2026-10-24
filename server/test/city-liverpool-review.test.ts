// Man City 3-0 at Liverpool (EPL, 2026-10-11): the five fixes from its alert review (F1 to F5), driven through a real
// GameTracker with fake ESPN responses shaped as ESPN sent that match (the recording of it is in server/data/recordings).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_TOUCH_MS = '0'; // the deep read of the touch feed on every poll here (live: every 10s)
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS: NEW_INSTALL_PREFS, NON_LOSS_WERE_PUSHED, setPushSender } = await import('../src/fanout.ts');
// An install from before the loss-only defaults: it keeps the pushes it had (what keepNonLossPushes pins).
const DEFAULT_PREFS = { ...NEW_INSTALL_PREFS, pushTypes: Object.fromEntries(NON_LOSS_WERE_PUSHED.map((t) => [t, true])) };
const { urls } = await import('../src/leagues.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'epl', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:epl:364', '364', 'Liverpool', 'Liverpool', 'LIV');
team.run('team:epl:382', '382', 'Manchester City', 'Man City', 'MNC');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'epl', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
const PLAYERS: [string, string, string, string][] = [
  ['196876', 'Alisson Becker', 'G', '364'], ['274632', 'Ryan Gravenberch', 'M', '364'], ['249299', 'Alexis Mac Allister', 'M', '364'], ['356075', 'Trey Nyoni', 'M', '364'], ['328238', 'Bradley Barcola', 'F', '364'],
  ['217092', 'Gianluigi Donnarumma', 'G', '382'], ['253989', 'Erling Haaland', 'F', '382'], ['328464', "Nico O'Reilly", 'D', '382'], ['283672', 'Jérémy Doku', 'F', '382'], ['303785', 'Matheus Nunes', 'M', '382'], ['298008', 'Rayan Cherki', 'M', '382'], ['299910', 'Josko Gvardiol', 'D', '382'],
];
for (const [id, name, pos, t] of PLAYERS) player.run(`player:epl:${id}`, id, name, pos, `team:epl:${t}`);
loadCatalog();
const NAME = Object.fromEntries(PLAYERS.map(([id, name]) => [id, name]));
const TEAM = Object.fromEntries(PLAYERS.map(([id, , , t]) => [id, t]));
const rosters = [
  { team: { id: '364', displayName: 'Liverpool' }, roster: PLAYERS.filter((p) => p[3] === '364').map(([id, n, pos]) => ({ athlete: { id, displayName: n }, position: { abbreviation: pos }, starter: true })) },
  { team: { id: '382', displayName: 'Manchester City' }, roster: PLAYERS.filter((p) => p[3] === '382').map(([id, n, pos]) => ({ athlete: { id, displayName: n }, position: { abbreviation: pos }, starter: true })) },
];

// Devices. gra-*: Gravenberch alone. alisson-and-lfc: a keeper and his club. haaland: a City striker.
const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
const DEVICES: [string, string[], any][] = [
  ['gra-default', ['player:epl:274632'], {}],
  ['gra-fouls-pushed', ['player:epl:274632'], { pushTypes: { 'epl.foul': true } }],
  ['gra-no-cards', ['player:epl:274632'], { types: { 'epl.yellow_card': false, 'epl.red_card': false } }],
  ['oreilly-fouls-pushed', ['player:epl:328464'], { pushTypes: { 'epl.foul': true } }],
  ['lfc', ['team:epl:364'], {}],
  ['lfc-and-gra', ['team:epl:364', 'player:epl:274632'], {}],
  ['alisson-and-lfc', ['player:epl:196876', 'team:epl:364'], {}],
  ['alisson', ['player:epl:196876'], {}],
  ['nunes-all', ['player:epl:303785'], { types: { 'epl.pass_given_away': true, 'epl.lost_ball': true } }],
  ['barcola-all', ['player:epl:328238'], { types: { 'epl.pass_given_away': true, 'epl.lost_ball': true } }],
  ['nyoni-all', ['player:epl:356075'], { types: { 'epl.pass_given_away': true, 'epl.lost_ball': true } }],
  ['haaland', ['player:epl:253989'], { pushTypes: { 'epl.foul': true } }],
];
for (const [id, keys, prefs] of DEVICES) {
  device.run(id, 's', 'test', `tok-${id}`, JSON.stringify({ ...DEFAULT_PREFS, ...prefs, types: { ...DEFAULT_PREFS.types, ...prefs.types }, pushTypes: { ...DEFAULT_PREFS.pushTypes, ...prefs.pushTypes } }));
  for (const k of keys) follow.run(id, k);
}
const pushed: { to: string; title: string }[] = [];
setPushSender((m: any[]) => pushed.push(...m.map((x) => ({ to: x.to, title: x.title }))));
/** What a device's feed shows, in the order it was delivered: "title" with a leading "*" when it was pushed, and its lines. */
const feed = (dev: string) => (db.prepare(`SELECT e.title, f.pushed, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(dev) as any[])
  .map((r) => `${r.pushed ? '*' : ''}${r.title}${r.extra ? ` [${JSON.parse(r.extra).join(' | ')}]` : ''}`);
const bodies = (dev: string) => (db.prepare(`SELECT e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(dev) as any[]).map((r) => r.body as string);

// ─── ESPN, as it sent the match ───
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
const pref = (id: string) => `http://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/athletes/${id}?lang=en&region=us`;
const tref = (id: string) => `http://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/teams/${id}?lang=en&region=us`;
/** A key event as the summary has it (a short text first; ESPN rewrites it a minute later). */
const keyEvent = (id: string, type: string, slug: string, minute: string, athletes: string[], text: string, at: number, extra: any = {}) => ({
  id, type: { id: '1', text: type, type: slug }, text, period: { number: 2 }, clock: { displayValue: minute }, scoringPlay: false, shootout: false, wallclock: iso(at),
  team: { id: TEAM[athletes[0]] }, participants: athletes.map((a) => ({ athlete: { id: a } })), ...extra,
});
/** A touch as the core feed has it. `parts`: [role, athlete id] in ESPN's order. */
const touch = (id: string, type: string, slug: string, minute: string, text: string, teamId: string, parts: [string, string][], at: number, extra: any = {}) => ({
  id, type: { id: '1', text: type, type: slug }, text, awayScore: 0, homeScore: 0, period: { number: 2 }, clock: { displayValue: minute }, valid: true, scoringPlay: false, scoreValue: 0,
  team: { $ref: tref(teamId) }, participants: parts.map(([type, a]) => ({ type, athlete: { $ref: pref(a) } })), wallclock: iso(at), ...extra,
});
/** A commentary line; a foul is two lines under one play id. */
const comment = (seq: number, minute: string, playId: string | null, slug: string, text: string, at: number) =>
  ({ sequence: seq, time: { value: seq * 60, displayValue: minute }, text, ...(playId ? { play: { id: playId, type: { type: slug }, wallclock: iso(at), participants: [] } } : {}) });

/** A fake match: what the summary and the touch feed say right now. */
function match(id: string) {
  const m = { keyEvents: [] as any[], commentary: [] as any[], touches: [] as any[], state: 'in', score: { home: '0', away: '0' }, asked: [] as string[], failTouches: false };
  liveDeps.getJson = async (url: string) => {
    m.asked.push(url);
    if (url.startsWith(urls.summary('epl', id))) {
      return { rosters, keyEvents: m.keyEvents, commentary: m.commentary, header: { competitions: [{ status: { type: { state: m.state, completed: m.state === 'post' } }, competitors: [{ homeAway: 'home', score: m.score.home }, { homeAway: 'away', score: m.score.away }] }] } };
    }
    const q = url.match(/plays\?limit=(\d+)&page=(\d+)/);
    if (q) {
      if (m.failTouches) throw new Error('touch feed down');
      const [limit, page] = [Number(q[1]), Number(q[2])];
      return { count: m.touches.length, pageIndex: page, pageSize: limit, pageCount: Math.max(1, Math.ceil(m.touches.length / limit)), items: m.touches.slice((page - 1) * limit, page * limit) };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return m;
}
const foulLines = (seq: number, minute: string, playId: string, fouler: string, fouled: string, at: number) => [
  comment(seq, minute, playId, 'foul', `Foul by ${NAME[fouler]} (${TEAM[fouler] === '364' ? 'Liverpool' : 'Manchester City'}).`, at),
  comment(seq + 1, minute, playId, 'foul', `${NAME[fouled]} (${TEAM[fouled] === '364' ? 'Liverpool' : 'Manchester City'}) wins a free kick in the defensive half.`, at),
];

// ═══ F3: a card and the foul behind it ═══

test('F3: a card and its foul in one poll are one alert: the card, pushed', async () => {
  const m = match('C1'), now = Date.now();
  const game = new GameTracker('epl', 'C1', '364', '382');
  await game.poll();
  m.keyEvents.push(keyEvent('K1', 'Yellow Card', 'yellow-card', "58'", ['328464'], "Nico O'Reilly (Manchester City) Yellow Card at 58'", now));
  m.commentary.push(...foulLines(1, "58'", 'F1', '328464', '274632', now));
  await game.poll();
  assert.deepEqual(feed('oreilly-fouls-pushed'), ["*Nico O'Reilly was booked 🟨"], 'the card, not the card and the foul');
  await game.poll(); // nothing new
  assert.deepEqual(feed('oreilly-fouls-pushed'), ["*Nico O'Reilly was booked 🟨"]);
});

test('F3: the card first, the foul a poll later: the foul is dropped for those who got the card, kept for those without it', async () => {
  const m = match('C2'), now = Date.now();
  const game = new GameTracker('epl', 'C2', '364', '382');
  await game.poll();
  m.keyEvents.push(keyEvent('K2', 'Yellow Card', 'yellow-card', "47'", ['274632'], "Ryan Gravenberch (Liverpool) Yellow Card at 47'", now));
  await game.poll();
  m.commentary.push(...foulLines(1, "47'", 'F2', '274632', '328464', now));
  await game.poll();
  const mine = (dev: string) => feed(dev).filter((t) => /47|booked|foul/.test(t) && !/sent off/.test(t));
  assert.deepEqual(mine('gra-fouls-pushed'), ['*Ryan Gravenberch was booked 🟨'], 'the card alone');
  assert.deepEqual(mine('gra-default'), ['*Ryan Gravenberch was booked 🟨']);
  assert.deepEqual(mine('gra-no-cards'), ['Ryan Gravenberch committed a foul'], 'cards off: the foul is the news (feed only by default)');
});

test('F3 guard: the foul first, the card a poll later: both are delivered, and the card still pushes', async () => {
  const m = match('C3'), now = Date.now();
  const game = new GameTracker('epl', 'C3', '364', '382');
  await game.poll();
  m.commentary.push(...foulLines(1, "90'+1'", 'F3', '274632', '328464', now));
  await game.poll();
  m.keyEvents.push(keyEvent('K3', 'Yellow Card', 'yellow-card', "90'+1'", ['274632'], "Ryan Gravenberch (Liverpool) Yellow Card at 90'+1'", now + 12_000));
  await game.poll();
  const mine = (dev: string) => feed(dev).filter((t) => /booked|foul/.test(t) && /90|booked|foul/.test(t)).slice(-2);
  assert.deepEqual(mine('gra-default'), ['Ryan Gravenberch committed a foul', '*Ryan Gravenberch was booked 🟨'], 'the foul feed only, the card pushed');
  assert.deepEqual(mine('gra-fouls-pushed'), ['*Ryan Gravenberch committed a foul', '*Ryan Gravenberch was booked 🟨']);
});

test('F3: a red card and the foul behind it: the player and his club get the red, the foul joins it', async () => {
  const m = match('C4'), now = Date.now();
  const game = new GameTracker('epl', 'C4', '364', '382');
  await game.poll();
  m.keyEvents.push(keyEvent('K4', 'Red Card', 'red-card', "62'", ['274632'], "Ryan Gravenberch (Liverpool) Red Card at 62'", now));
  m.commentary.push(...foulLines(1, "62'", 'F4', '274632', '328464', now));
  await game.poll();
  assert.deepEqual(feed('gra-fouls-pushed').slice(-1), ['*Ryan Gravenberch was sent off 🟥']);
  assert.deepEqual(feed('lfc-and-gra').slice(-1), ['*Ryan Gravenberch was sent off 🟥'], 'tracking both: one alert');
  assert.deepEqual(feed('lfc').slice(-1), ['*Liverpool are down to 10 men 🟥']);
  assert.notEqual(feed('gra-fouls-pushed').at(-1), '*Ryan Gravenberch committed a foul', 'no foul row after the red');
});

// ═══ F1: ESPN rewrites a card's or goal's first words; the alerts take the rewrite ═══

const SECOND_YELLOW = 'Second yellow card to Ryan Gravenberch (Liverpool) for a bad foul.';
const GOAL_LONG = 'Goal! Liverpool 0, Manchester City 1. Erling Haaland (Manchester City) left footed shot from the centre of the box to the centre of the goal.';

test('F1: a red card ESPN first writes as "Red Card" becomes "(second yellow)" when it rewrites it; the club still has ten men; no second push', async () => {
  const m = match('R1'), now = Date.now();
  const game = new GameTracker('epl', 'R1', '364', '382');
  await game.poll();
  m.keyEvents.push(keyEvent('RK1', 'Red Card', 'red-card', "62'", ['274632'], "Ryan Gravenberch (Liverpool) Red Card at 62'", now));
  await game.poll();
  assert.deepEqual(feed('gra-default').slice(-1), ['*Ryan Gravenberch was sent off 🟥']);
  assert.equal(bodies('gra-default').at(-1), "62' Ryan Gravenberch (Liverpool) Red Card at 62' — MNC 0, LIV 0");
  const pushes = pushed.length, rows = feed('gra-default').length;
  m.keyEvents[0].text = SECOND_YELLOW; // ESPN's rewrite, a minute on
  await game.poll();
  assert.deepEqual(feed('gra-default').slice(-1), ['*Ryan Gravenberch was sent off (second yellow) 🟥'], 'the title says it');
  assert.equal(bodies('gra-default').at(-1), `62' ${SECOND_YELLOW} — MNC 0, LIV 0`);
  assert.deepEqual(feed('lfc').slice(-1), ['*Liverpool are down to 10 men 🟥'], 'ten men, not nine: the detectors did not run again');
  assert.equal(bodies('lfc').at(-1), `62' ${SECOND_YELLOW} — MNC 0, LIV 0`);
  assert.equal(pushed.length, pushes, 'a correction, not a new alert');
  assert.equal(feed('gra-default').length, rows, 'the same row, rewritten');
  m.keyEvents[0].text = "Ryan Gravenberch (Liverpool) Red Card at 62'"; // a shorter text never replaces a longer one
  await game.poll();
  assert.equal(bodies('gra-default').at(-1), `62' ${SECOND_YELLOW} — MNC 0, LIV 0`);
});

test('F1: a goal takes ESPN\'s fuller line on the keeper\'s alert and the club\'s, with the score unchanged', async () => {
  const m = match('R2'), now = Date.now();
  const game = new GameTracker('epl', 'R2', '364', '382');
  await game.poll();
  m.score = { home: '0', away: '1' };
  m.keyEvents.push(keyEvent('RK2', 'Goal', 'goal', "65'", ['253989'], "Erling Haaland (Manchester City) Goal at 65'", now, { scoringPlay: true }));
  await game.poll();
  assert.equal(bodies('alisson').at(-1), "65' Erling Haaland (Manchester City) Goal at 65' — MNC 1, LIV 0");
  const pushes = pushed.length;
  m.keyEvents[0].text = GOAL_LONG;
  await game.poll();
  assert.deepEqual(feed('alisson').slice(-1), ['*Alisson Becker conceded a goal 🥅']);
  assert.equal(bodies('alisson').at(-1), "65' Erling Haaland (Manchester City) left footed shot from the centre of the box to the centre of the goal. — MNC 1, LIV 0");
  assert.equal(bodies('lfc').at(-1), "65' Erling Haaland (Manchester City) left footed shot from the centre of the box to the centre of the goal. — MNC 1, LIV 0", 'the club\'s alert too');
  assert.equal(pushed.length, pushes);
});

test('F1: a rewrite after the window is left alone', async () => {
  const m = match('R3'), now = Date.now();
  const game = new GameTracker('epl', 'R3', '364', '382');
  await game.poll();
  m.keyEvents.push(keyEvent('RK3', 'Yellow Card', 'yellow-card', "58'", ['328464'], "Nico O'Reilly (Manchester City) Yellow Card at 58'", now));
  await game.poll();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6 * 60_000;
    m.keyEvents[0].text = "Nico O'Reilly (Manchester City) is shown the yellow card for a bad foul.";
    await game.poll();
  } finally { Date.now = realNow; }
  assert.equal(bodies('oreilly-fouls-pushed').at(-1), "58' Nico O'Reilly (Manchester City) Yellow Card at 58' — MNC 0, LIV 0");
});

// ═══ F2: the touch feed has fouls, cards and goals before the summary and its commentary do ═══

test('F2: a card in the touch feed is an alert before the summary has it, and the summary\'s copy of it is not another', async () => {
  const m = match('T1'), now = Date.now();
  const game = new GameTracker('epl', 'T1', '364', '382');
  await game.poll();
  m.touches.push(touch('TC1', 'Yellow Card', 'yellow-card', "58'", "Nico O'Reilly (Manchester City) Yellow Card at 58'", '382', [['carded', '328464']], now, { homeScore: 0, awayScore: 0 }));
  await game.poll();
  assert.deepEqual(feed('oreilly-fouls-pushed').slice(-1), ["*Nico O'Reilly was booked 🟨"], 'before the summary has it');
  const rows = feed('oreilly-fouls-pushed').length, pushes = pushed.length;
  m.keyEvents.push(keyEvent('TC1', 'Yellow Card', 'yellow-card', "58'", ['328464'], "Nico O'Reilly (Manchester City) Yellow Card at 58'", now));
  await game.poll();
  assert.equal(feed('oreilly-fouls-pushed').length, rows, 'the summary\'s copy is the same play');
  assert.equal(pushed.length, pushes);
  m.keyEvents[0].text = "Nico O'Reilly (Manchester City) is shown the yellow card for a bad foul.";
  await game.poll();
  assert.equal(bodies('oreilly-fouls-pushed').at(-1), "58' Nico O'Reilly (Manchester City) is shown the yellow card for a bad foul. — MNC 0, LIV 0", 'and its rewrite still reaches the alert');
});

test('F2: a card whose player ESPN has not filled in yet is no play yet: the alert comes when he is on it', async () => {
  const m = match('T7'), now = Date.now();
  const game = new GameTracker('epl', 'T7', '364', '382');
  await game.poll();
  m.touches.push(touch('TC7', 'Yellow Card', 'yellow-card', "33'", 'Yellow Card at 33\'', '364', [], now));
  await game.poll();
  const rows = feed('gra-default').length;
  m.touches[0] = touch('TC7', 'Yellow Card', 'yellow-card', "33'", 'Ryan Gravenberch (Liverpool) Yellow Card at 33\'', '364', [['carded', '274632']], now);
  await game.poll();
  assert.deepEqual(feed('gra-default').slice(rows), ['*Ryan Gravenberch was booked 🟨']);
});

test('F2: a goal typed "Temp Goal" is no alert until ESPN types it Goal; the touch carries the score; the summary adds no second one', async () => {
  const m = match('T2'), now = Date.now();
  const game = new GameTracker('epl', 'T2', '364', '382');
  await game.poll();
  const quiet = feed('alisson').length, quietClub = feed('lfc').length;
  m.touches.push(touch('TG1', 'Temp Goal', 'temp-goal', "68'", 'Jérémy Doku (Manchester City) Temp Goal at 68\'', '382', [['', '283672']], now, { homeScore: 0, awayScore: 1 }));
  await game.poll();
  assert.equal(feed('alisson').length, quiet, 'a temporary goal is not a goal');
  assert.equal(feed('lfc').length, quietClub);
  const before = feed('alisson').length;
  m.touches[0] = touch('TG1', 'Goal', 'goal', "68'", 'Jérémy Doku (Manchester City) Goal at 68\'', '382', [['scorer', '283672']], now, { homeScore: 0, awayScore: 1, scoringPlay: true, scoreValue: 1 });
  await game.poll();
  assert.equal(feed('alisson').length, before + 1);
  assert.deepEqual(feed('alisson').slice(-1), ['*Alisson Becker conceded a goal 🥅']);
  assert.equal(bodies('alisson').at(-1), "68' Jérémy Doku (Manchester City) Goal at 68' — MNC 1, LIV 0", 'the score is the touch\'s own');
  assert.ok(feed('lfc').some((t) => /Man City scored to take the lead over Liverpool/.test(t)), 'and the club\'s alert');
  const lfc = feed('lfc').length;
  m.score = { home: '0', away: '1' };
  m.keyEvents.push(keyEvent('TG1', 'Goal', 'goal', "68'", ['283672'], 'Goal! Liverpool 0, Manchester City 1. Jérémy Doku (Manchester City) right footed shot from the left side of the box.', now, { scoringPlay: true }));
  await game.poll();
  assert.equal(feed('alisson').length, before + 1, 'the same goal');
  assert.equal(feed('lfc').length, lfc);
  assert.equal(bodies('alisson').at(-1), "68' Jérémy Doku (Manchester City) right footed shot from the left side of the box. — MNC 1, LIV 0", 'with the summary\'s words');
});

test('F2: an own goal in the touch feed waits for the summary', async () => {
  const m = match('T3'), now = Date.now();
  const game = new GameTracker('epl', 'T3', '364', '382');
  await game.poll();
  m.touches.push(touch('TO1', 'Own Goal', 'own-goal', "30'", 'Alexis Mac Allister (Liverpool) Own Goal at 30\'', '382', [['scorer', '249299']], now, { homeScore: 0, awayScore: 1, scoringPlay: true, scoreValue: 1 }));
  const before = feed('alisson').length;
  await game.poll();
  assert.equal(feed('alisson').length, before);
});

test('F2: a foul in the touch feed is an alert before its commentary line has a play, and the commentary adds no second; a penalty is still written later', async () => {
  const m = match('T4'), now = Date.now();
  const game = new GameTracker('epl', 'T4', '364', '382');
  await game.poll();
  m.touches.push(touch('TF1', 'Foul', 'foul', "57'", 'Erling Haaland (Manchester City) wins a free kick in the attack', '382', [['fouler', '253989'], ['fouled', '274632']], now));
  m.commentary.push({ sequence: 1, time: { value: 60, displayValue: "57'" }, text: 'Foul by Erling Haaland (Manchester City).' }); // the line, without its play
  await game.poll();
  assert.deepEqual(feed('haaland').slice(-1), ['*Erling Haaland committed a foul']);
  assert.equal(bodies('haaland').at(-1), "57' Foul by Erling Haaland (Manchester City). — MNC 0, LIV 0");
  const rows = feed('haaland').length;
  m.commentary.push(...foulLines(2, "57'", 'TF1', '253989', '274632', now)); // ESPN attaches the play
  await game.poll();
  assert.equal(feed('haaland').length, rows, 'the same foul');
});

test('F2: a handball names only its player', async () => {
  const m = match('T5'), now = Date.now();
  const game = new GameTracker('epl', 'T5', '364', '382');
  await game.poll();
  m.touches.push(touch('TH1', 'Handball', 'handball', "8'", 'Handball by Erling Haaland (Manchester City).', '382', [['', '253989']], now));
  await game.poll();
  assert.deepEqual(feed('haaland').slice(-1), ['*Erling Haaland was called for a handball']);
});

test('F2: a touch feed that fails does not fail the poll: the summary still makes its alerts', async () => {
  const m = match('T6'), now = Date.now();
  const game = new GameTracker('epl', 'T6', '364', '382');
  await game.poll();
  m.failTouches = true;
  m.keyEvents.push(keyEvent('TK6', 'Yellow Card', 'yellow-card', "11'", ['274632'], "Ryan Gravenberch (Liverpool) Yellow Card at 11'", now));
  await game.poll();
  assert.deepEqual(feed('gra-default').slice(-1), ['*Ryan Gravenberch was booked 🟨']);
});

// ═══ F4: ESPN retypes a touch after it was judged ═══

test('F4: a pair is judged again when ESPN retypes a touch: the missing alert is sent, the one already out takes the new words, once', async () => {
  const m = match('P1'), now = Date.now();
  const game = new GameTracker('epl', 'P1', '364', '382');
  await game.poll();
  m.touches.push(
    touch('PA', 'Pass', 'pass', "68'", 'Matheus Nunes (Manchester City) Pass at 68\'', '382', [['passer', '303785']], now),
    touch('PB', 'Dispossessed', 'dispossessed', "68'", 'Bradley Barcola (Liverpool) Dispossessed at 68\'', '364', [['', '328238']], now + 4000),
    touch('PC', 'Tackle', 'tackle', "68'", 'Josko Gvardiol (Manchester City) Tackle at 68\'', '382', [['', '299910']], now + 4000),
    touch('PD', 'Pass', 'pass', "68'", 'Josko Gvardiol (Manchester City) Pass at 68\'', '382', [['passer', '299910']], now + 6000),
  );
  await game.poll();
  assert.deepEqual(feed('barcola-all'), ['*Bradley Barcola lost the ball'], 'dispossessed, then tackled');
  assert.equal(bodies('barcola-all')[0], "68' Dispossessed by Josko Gvardiol — MNC 0, LIV 0");
  assert.deepEqual(feed('nunes-all'), [], 'a pass that went to someone who was then dispossessed: not a turnover');
  const pushes = pushed.length;
  m.touches[1] = touch('PB', 'Take On', 'take-on', "68'", 'Bradley Barcola (Liverpool) Take On at 68\'', '364', [['', '328238']], now + 4000); // ESPN retypes it
  await game.poll();
  assert.deepEqual(feed('nunes-all'), ['*Matheus Nunes gave the ball away'], 'now the pass went straight to Barcola');
  assert.deepEqual(feed('barcola-all'), ['*Bradley Barcola lost the ball'], 'still one alert');
  assert.equal(bodies('barcola-all')[0], "68' Tackled trying to get past Josko Gvardiol — MNC 0, LIV 0", 'with the new words');
  assert.equal(pushed.length, pushes + 1, 'one new push: the pass');
  await game.poll();
  assert.deepEqual(feed('nunes-all'), ['*Matheus Nunes gave the ball away'], 'nothing repeats');
});

test('F4: the touch after a take-on is retyped from Take On to Tackle: the dribbler lost the ball', async () => {
  const m = match('P2'), now = Date.now();
  const game = new GameTracker('epl', 'P2', '364', '382');
  await game.poll();
  m.touches.push(
    touch('QA', 'Take On', 'take-on', "85'", 'Trey Nyoni (Liverpool) Take On at 85\'', '364', [['', '356075']], now),
    touch('QB', 'Take On', 'take-on', "85'", 'Rayan Cherki (Manchester City) Take On at 85\'', '382', [['', '298008']], now),
    touch('QC', 'Pass', 'pass', "85'", 'Rayan Cherki (Manchester City) Pass at 85\'', '382', [['passer', '298008']], now + 2000),
  );
  await game.poll();
  assert.deepEqual(feed('nyoni-all'), []);
  m.touches[1] = touch('QB', 'Tackle', 'tackle', "85'", 'Rayan Cherki (Manchester City) Tackle at 85\'', '382', [['', '298008']], now);
  await game.poll();
  assert.deepEqual(feed('nyoni-all'), ['*Trey Nyoni lost the ball']);
});

// ═══ F5: ESPN takes a touch out ═══

test('F5: a touch ESPN took out leaves no stale copy at the end, and the touches now side by side are judged', async () => {
  const m = match('X1'), now = Date.now();
  const game = new GameTracker('epl', 'X1', '364', '382');
  await game.poll();
  m.touches.push(
    touch('XA', 'Pass', 'pass', "89'", 'Matheus Nunes (Manchester City) Pass at 89\'', '382', [['passer', '303785']], now),
    touch('XB', 'Ball touch', 'ball-touch', "89'", 'Matheus Nunes (Manchester City) Ball touch at 89\'', '382', [['', '303785']], now),
    touch('XC', 'Interception', 'interception', "89'", 'Bradley Barcola (Liverpool) Interception at 89\'', '364', [['', '328238']], now + 2000),
    touch('XD', 'Pass', 'pass', "89'", 'Bradley Barcola (Liverpool) Pass at 89\'', '364', [['passer', '328238']], now + 3000),
  );
  await game.poll();
  const had = feed('nunes-all').length;
  m.touches.splice(1, 1); // ESPN removes the ball touch
  await game.poll();
  assert.equal((game as any).touches.length, 3, 'the feed is cut to ESPN\'s count: no stale last touch');
  assert.deepEqual(feed('nunes-all').slice(had), ['*Matheus Nunes gave the ball away'], 'the pass and the interception are side by side now');
  await game.poll();
  assert.equal(feed('nunes-all').length, had + 1, 'once');
  const barcola = feed('barcola-all').length;
  m.touches.push(touch('XE', 'Pass', 'pass', "89'", 'Matheus Nunes (Manchester City) Pass at 89\'', '382', [['passer', '303785']], now + 5000));
  await game.poll();
  assert.deepEqual(feed('barcola-all').slice(barcola), ['*Bradley Barcola gave the ball away'], 'Barcola\'s pass, straight to the next touch, which is Nunes\'s');
  assert.equal(feed('nunes-all').length, had + 1);
});
