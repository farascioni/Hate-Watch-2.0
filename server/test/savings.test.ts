// The savings (flags.ts SAVINGS): ways to read ESPN less, off until turned on. Off, every read is what it always was;
// on, the reads drop and (for the two that touch live games) the alerts a game makes stay the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_ABS_SETTLE_MS = '100';
delete process.env.HW_SAVINGS_ON;
const { db } = await import('../src/db.ts');
const { loadCatalog, knownHeadshot, knownLogo } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { liveDeps, GameTracker, engine, isBreak } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');
const { SAVINGS, savingOn, setSaving, setFlag } = await import('../src/flags.ts');
type Saving = keyof typeof SAVINGS;

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [id, name, short, abbr] of [['10', 'New York Yankees', 'Yankees', 'NYY'], ['30', 'Tampa Bay Rays', 'Rays', 'TB']]) team.run(`team:mlb:${id}`, id, name, short, abbr);
db.prepare(`UPDATE teams SET logo = 'https://x/yankees.png', logo_w = 500, logo_h = 400 WHERE key = 'team:mlb:10'`).run();
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, ?, ?, ?, 0)`);
player.run('player:mlb:1', '1', 'George Lombard Jr.', 'team:mlb:10', 'https://x/1.png', 300, 200, 'headshot');
player.run('player:mlb:2', '2', 'Austin Wells', 'team:mlb:10', 'https://x/yankees.png', 500, 400, 'team_logo');
player.run('player:mlb:3', '3', 'Griffin Jax', 'team:mlb:30', 'x', 1, 1, 'headshot');
loadCatalog();
db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('fan', 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
for (const k of ['team:mlb:10', 'team:mlb:30']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('fan', k);

const on = (...s: Saving[]) => { for (const x of Object.keys(SAVINGS) as Saving[]) setSaving(x, s.includes(x)); };
const eng = engine as any;

test('every saving is off until turned on; the kill switch beats them', () => {
  for (const s of Object.keys(SAVINGS) as Saving[]) assert.equal(savingOn(s), false, s);
  setSaving('savings.news', true);
  assert.equal(savingOn('savings.news'), true);
  assert.equal(savingOn('savings.injuries'), false, 'turning one on turns no other on');
  setFlag('savings', false);
  assert.equal(savingOn('savings.news'), false, 'the kill switch');
  setFlag('savings', true);
  assert.equal(savingOn('savings.news'), true, 'and the kill switch back on turns nothing new on');
  setSaving('savings.news', false);
  process.env.HW_SAVINGS_ON = 'savings.injuries, savings.news';
  assert.equal(savingOn('savings.injuries'), true, 'the secret');
  setFlag('savings', false);
  assert.equal(savingOn('savings.injuries'), false, 'the kill switch beats the secret too');
  setFlag('savings', true);
  delete process.env.HW_SAVINGS_ON;
  on();
});

test('a scan skips turns only with its saving on, unless the usual pace is asked for', () => {
  const key = 'news:nba';
  const turn = (fast = false) => eng.skipTurn(key, 'savings.news', 20 * 60_000, fast);
  on();
  assert.equal(turn(), false); assert.equal(turn(), false, 'off: never skipped');
  on('savings.news');
  eng.ranAt.delete(key);
  assert.equal(turn(), false, 'the first turn runs');
  assert.equal(turn(), true, 'the next, a moment later, is skipped');
  assert.equal(turn(true), false, 'fast: runs');
  eng.ranAt.set(key, Date.now() - 21 * 60_000);
  assert.equal(turn(), false, 'idle time has passed');
  on();
});

test('injuries: the usual pace while a game is live or within 3 hours, or before any scoreboard read', () => {
  assert.equal(eng.gameSoon('nba'), true, 'no scoreboard read yet');
  eng.gameDay.nba = { live: false, nextStart: Date.now() + 5 * 3600_000 };
  assert.equal(eng.gameSoon('nba'), false);
  eng.gameDay.nba = { live: false, nextStart: Date.now() + 2 * 3600_000 };
  assert.equal(eng.gameSoon('nba'), true, 'inactive lists come ahead of kickoff');
  eng.gameDay.nba = { live: true, nextStart: Infinity };
  assert.equal(eng.gameSoon('nba'), true);
  eng.gameDay.nba = { live: false, nextStart: Infinity };
  assert.equal(eng.gameSoon('nba'), false);
});

test('scoreboard-sleep: a league with nothing live or soon is read once in 5 minutes, and a new follow reads at once', async () => {
  const prev = liveDeps.getJson;
  let reads = 0;
  const sb = (events: any[]) => { reads = 0; liveDeps.getJson = async (url: string) => { if (url.startsWith(urls.scoreboard('nba').split('?')[0])) { reads++; return { events }; } return {}; }; };
  try {
    const quiet = [{ id: '1', date: new Date(Date.now() + 5 * 3600_000).toISOString(), status: { type: { state: 'pre' } } }];
    on();
    sb(quiet);
    for (let i = 0; i < 3; i++) await eng.scanScoreboard('nba');
    assert.equal(reads, 3, 'off: every turn reads');
    delete eng.quietUntil.nba;
    on('savings.scoreboard-sleep');
    sb(quiet);
    for (let i = 0; i < 3; i++) await eng.scanScoreboard('nba');
    assert.equal(reads, 1, 'on: one read, then quiet');
    eng.kick();
    await eng.scanScoreboard('nba');
    assert.equal(reads, 2, 'a kick (a new follow) reads at once');
    const live = [{ id: '1', date: new Date(Date.now() - 3600_000).toISOString(), status: { type: { state: 'in' } } }];
    sb(live);
    delete eng.quietUntil.nba;
    for (let i = 0; i < 3; i++) await eng.scanScoreboard('nba');
    assert.equal(reads, 3, 'a live game: every turn reads');
    const soon = [{ id: '1', date: new Date(Date.now() + 10 * 60_000).toISOString(), status: { type: { state: 'pre' } } }];
    sb(soon);
    for (let i = 0; i < 3; i++) await eng.scanScoreboard('nba');
    assert.equal(reads, 3, 'a game within 20 minutes: every turn reads');
  } finally { liveDeps.getJson = prev; on(); delete eng.quietUntil.nba; }
});

test('standings: read every 60 s only for 15 minutes after a game ends (a followed game, or any new final on the board), else once in 30', async () => {
  const prev = liveDeps.getJson;
  let reads = 0;
  liveDeps.getJson = async (url: string) => { if (url.includes('standings')) reads++; return {}; };
  try {
    on('savings.standings');
    eng.ranAt.delete('standings:nhl');
    for (let i = 0; i < 3; i++) await eng.standingsTurn('nhl', false);
    assert.equal(reads, 1, 'quiet: one read');
    engine.onGameFinal('nhl');
    for (let i = 0; i < 3; i++) await eng.standingsTurn('nhl', false);
    assert.equal(reads, 4, 'after a final: every turn');
    delete eng.standingsHotUntil.nhl;
    eng.finalsSeen.clear();
    liveDeps.getJson = async (url: string) => {
      if (url.startsWith(urls.scoreboard('nhl').split('?')[0])) return { events: [{ id: '9', date: new Date(Date.now() - 3 * 3600_000).toISOString(), status: { type: { state: 'post', completed: true } } }] };
      if (url.includes('standings')) reads++;
      return {};
    };
    await eng.scanScoreboard('nhl');
    assert.ok(eng.standingsHotUntil.nhl > Date.now(), 'a new final on the scoreboard, followed or not, starts the hot window');
    reads = 0;
    for (let i = 0; i < 2; i++) await eng.standingsTurn('nhl', false);
    assert.equal(reads, 2);
    on();
    delete eng.standingsHotUntil.nhl;
    for (let i = 0; i < 3; i++) await eng.standingsTurn('nhl', false);
    assert.equal(reads, 5, 'off: every turn');
  } finally { liveDeps.getJson = prev; on(); }
});

test('photo-checks: a verified headshot or logo is kept; a badge, a new URL or the saving off is checked again', async () => {
  on();
  assert.equal(knownHeadshot('player:mlb:1', 'https://x/1.png'), null, 'off');
  assert.equal(await knownLogo({ key: 'team:mlb:10', logo: 'https://x/yankees.png' } as any), null, 'off');
  on('savings.photo-checks');
  assert.deepEqual(knownHeadshot('player:mlb:1', 'https://x/1.png'), { width: 300, height: 200 });
  assert.deepEqual(await knownLogo({ key: 'team:mlb:10', logo: 'https://x/yankees.png' } as any), { width: 500, height: 400 });
  assert.equal(knownHeadshot('player:mlb:1', 'https://x/other.png'), null, 'the URL changed');
  assert.equal(knownHeadshot('player:mlb:2', 'https://x/yankees.png'), null, 'a player on his team logo is checked for a photo again');
  assert.equal(knownHeadshot('player:mlb:99', 'https://x/99.png'), null, 'a new player');
  on();
});

// ── A live game, served through both of ESPN's feeds, with and without summary-on-demand and slow-breaks ──
const site = (id: string, type: string, text: string, half: string, pitcher: string, batter: string, typeSlug = '') => ({
  id, type: { text: type, type: typeSlug }, text, period: { type: half.split(' ')[0], number: Number(half.split(' ')[1]) },
  participants: [{ athlete: { id: pitcher }, type: 'pitcher' }, { athlete: { id: batter }, type: 'batter' }], wallclock: new Date().toISOString(), homeScore: 0, awayScore: 0,
});
const core = (p: any) => ({ ...p, participants: p.participants.map((x: any) => ({ type: x.type, athlete: { $ref: `http://x/athletes/${x.athlete.id}?lang=en` } })) });
function game(id: string) {
  const state = { plays: [] as any[], status: 'STATUS_IN_PROGRESS', coreFails: false, reads: { plays: 0, summary: 0 } };
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string, o?: any) => {
    if (url.startsWith(urls.corePlays('mlb', id).split('?')[0])) { state.reads.plays++; if (state.coreFails) throw new Error('down'); return { items: state.plays.map(core) }; }
    if (url.startsWith(urls.summary('mlb', id))) { state.reads.summary++; return { header: { competitions: [{ status: { type: { state: 'in', name: state.status } }, competitors: [] }] }, plays: state.plays }; }
    return prev(url, o);
  };
  return { state, tracker: new GameTracker('mlb', id, '10', '30') as any, restore: () => { liveDeps.getJson = prev; } };
}
const alerts = (id: string) => (db.prepare(`SELECT e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'fan' AND e.game_id = ? ORDER BY f.rowid`).all(id) as { title: string }[]).map((r) => r.title);
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** The Wells challenge from abs-settle.test.ts: a lost challenge is held, then goes out once the game moves on. */
async function wellsChallenge(id: string) {
  const { state, tracker, restore } = game(id);
  try {
    const lost = site(`${id}0303050092`, 'Strike Looking - Confirmed', 'Pitch 4 : Strike 2 Looking', 'Bottom 2', '3', '2');
    state.plays = [lost];
    await tracker.poll(); await wait(); await tracker.poll();
    state.plays = [lost, site(`${id}0303060005`, 'Ball', 'Pitch 5 : Ball 2', 'Bottom 2', '3', '2')];
    await tracker.poll(); await tracker.poll(); await tracker.poll();
    return { alerts: alerts(id), reads: state.reads };
  } finally { restore(); }
}

test('summary-on-demand: the summary is read far less, the alerts of a game with a held challenge are the same, and the hold keeps the usual pace', async () => {
  on();
  const off = await wellsChallenge('401000001');
  on('savings.summary-on-demand');
  const saving = await wellsChallenge('401000002');
  assert.deepEqual(saving.alerts.map((a) => a.replace(/^.*?: /, '')), off.alerts.map((a) => a.replace(/^.*?: /, '')), 'the same alerts');
  assert.equal(off.alerts.length, 1, 'the challenge went out');
  assert.equal(off.reads.summary, off.reads.plays, 'off: both feeds every poll');
  assert.ok(saving.reads.summary < saving.reads.plays, `on: the summary less often than the plays (${saving.reads.summary} of ${saving.reads.plays})`);
  on();
});

test('summary-on-demand: plays every poll, the summary at most every 10 s, and a fresh one when core fails or brings an End play', async () => {
  on('savings.summary-on-demand');
  const { state, tracker, restore } = game('401000003');
  try {
    state.plays = [site('4010000030101010001', 'Ball', 'Pitch 1 : Ball 1', 'Top 1', '3', '1')];
    for (let i = 0; i < 5; i++) await tracker.poll();
    assert.deepEqual(state.reads, { plays: 5, summary: 1 }, 'one summary for five polls');
    state.coreFails = true;
    await tracker.poll();
    assert.equal(state.reads.summary, 2, 'core failing: the summary is read for that poll');
    state.coreFails = false;
    state.plays = [...state.plays, site('4010000030101010002', 'End Inning', 'End of the 1st inning', 'Top 1', '3', '1')];
    await tracker.poll();
    assert.equal(state.reads.summary, 3, 'an End play: a fresh summary at once');
    tracker.summaryCache.at -= 11_000;
    await tracker.poll();
    assert.equal(state.reads.summary, 4, 'ten seconds on: a fresh one');
  } finally { restore(); on(); }
});

test('slow-breaks: halftime and delays are read every 6 s; the usual pace with the saving off, or while something is held', async () => {
  const { state, tracker, restore } = game('401000004');
  try {
    state.plays = [site('4010000040101010001', 'Ball', 'Pitch 1 : Ball 1', 'Top 1', '3', '1')];
    state.status = 'STATUS_HALFTIME';
    await tracker.poll();
    on();
    assert.equal(tracker.slowBreak(), false, 'saving off');
    on('savings.slow-breaks');
    assert.equal(tracker.slowBreak(), true, 'at halftime');
    tracker.absHeld.set('x', { events: [], since: Date.now() });
    assert.equal(tracker.slowBreak(), false, 'a held alert keeps the usual pace');
    tracker.absHeld.clear();
    state.status = 'STATUS_IN_PROGRESS';
    await tracker.poll();
    assert.equal(tracker.slowBreak(), false, 'play on');
    state.status = 'STATUS_RAIN_DELAY';
    await tracker.poll();
    assert.equal(tracker.slowBreak(), true, 'a delay');
  } finally { restore(); on(); }
});

test('what is a break: halftime and delays, the end of a period except a league\'s last (the final or overtime follows at once)', () => {
  assert.equal(isBreak('nba', 'STATUS_HALFTIME', 2), true);
  assert.equal(isBreak('nba', 'STATUS_END_PERIOD', 1), true);
  assert.equal(isBreak('nba', 'STATUS_END_PERIOD', 3), true);
  assert.equal(isBreak('nba', 'STATUS_END_PERIOD', 4), false, 'the end of the 4th quarter: the final may be next');
  assert.equal(isBreak('nhl', 'STATUS_END_PERIOD', 2), true);
  assert.equal(isBreak('nhl', 'STATUS_END_PERIOD', 3), false);
  assert.equal(isBreak('mlb', 'STATUS_RAIN_DELAY', 4), true);
  assert.equal(isBreak('mlb', 'STATUS_END_PERIOD', 1), false, 'a league whose last period is unknown is never slowed at a period end');
  assert.equal(isBreak('nba', 'STATUS_IN_PROGRESS', 2), false);
});

test("summary-on-demand: MLB's End Batter/Pitcher (after every at-bat) does not force a read, but an End Inning does", async () => {
  on('savings.summary-on-demand');
  const { state, tracker, restore } = game('401000005');
  try {
    state.plays = [site('4010000050101010001', 'Ball', 'Pitch 1 : Ball 1', 'Top 1', '3', '1')];
    await tracker.poll(); await tracker.poll();
    assert.equal(state.reads.summary, 1);
    state.plays = [...state.plays, site('4010000050101010002', 'End Batter/Pitcher', 'End of the at-bat', 'Top 1', '3', '1')];
    await tracker.poll();
    assert.equal(state.reads.summary, 1, 'End Batter/Pitcher: no new summary');
    state.plays = [...state.plays, site('4010000050101010003', 'End Inning', 'End of the 1st inning', 'Top 1', '3', '1')];
    await tracker.poll();
    assert.equal(state.reads.summary, 2, 'End Inning: a new summary');
  } finally { restore(); on(); }
});
