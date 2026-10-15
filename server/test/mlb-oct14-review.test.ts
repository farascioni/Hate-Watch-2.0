// The October 14 2026 MLB post game recording report (NLCS Game 3, Brewers at Dodgers, ESPN 401908032): a strikeout ESPN rewrote
// after its alert went out (F1), and a run handed over by a pitcher who inherited the runner (F2). Each test names its finding.
// The play id and words are the recording's.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_ABS_SETTLE_MS = '200';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { PLAYER_DETECTORS, observePlay } = await import('../src/detectors.ts');
const { liveDeps, GameTracker } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [id, name, short, abbr] of [['8', 'Milwaukee Brewers', 'Brewers', 'MIL'], ['19', 'Los Angeles Dodgers', 'Dodgers', 'LAD']]) team.run(`team:mlb:${id}`, id, name, short, abbr);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, position, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [id, name, pos, t] of [['1', 'Will Smith', 'C', '19'], ['2', 'Freddy Peralta', 'SP', '8'], ['3', 'Roki Sasaki', 'SP', '19'], ['4', 'Justin Wrobleski', 'RP', '19'], ['6', 'Brice Turang', '2B', '8'], ['7', 'Jackson Chourio', 'LF', '8']])
  player.run(`player:mlb:${id}`, id, name, pos, `team:mlb:${t}`);
loadCatalog();
db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('fan', 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
for (const k of ['team:mlb:19', 'player:mlb:1', 'player:mlb:3', 'player:mlb:4']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('fan', k);

const feed = () => (db.prepare(`SELECT e.type, e.title, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'fan' ORDER BY f.rowid`).all() as { type: string; title: string; extra: string | null }[])
  .map((r) => ({ type: r.type, title: r.title, lines: r.extra ? (JSON.parse(r.extra) as string[]) : [] }));
const wait = () => new Promise((r) => setTimeout(r, 400));

// ─── F1: a strikeout ESPN reversed after the alert went out ───
test('NLCS G3 F1: "struck out looking ... upheld" rewritten to "struck out swinging" gets a line on the alert, no second alert', async () => {
  const game = '401908032', play = (id: string, text: string) => ({
    id, type: { text: 'Play Result', type: 'play-result' }, text, period: { type: 'Bottom', number: 7 }, scoringPlay: false, scoreValue: 0, homeScore: 0, awayScore: 1, wallclock: new Date().toISOString(),
    participants: [{ athlete: { id: '2' }, type: 'pitcher' }, { athlete: { id: '1' }, type: 'batter' }],
  });
  const state = { plays: [] as any[] };
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string, o?: any) => {
    if (url.startsWith(urls.corePlays('mlb', game).split('?')[0])) return { items: [] };
    if (url.startsWith(urls.summary('mlb', game))) return { header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [] }] }, plays: state.plays };
    return prev(url, o);
  };
  const tracker = new GameTracker('mlb', game, '19', '8');
  const id = '4019080320704990057';
  state.plays = [play(id, 'Smith struck out looking. Los Angeles Dodgers challenged: call on the field was upheld.')];
  await tracker.poll(); // held: a strikeout on a challenged pitch
  assert.deepEqual(feed(), [], 'waiting for the review');
  await new Promise((r) => setTimeout(r, 240)); // past ABS_SETTLE_MS (200), not past the 1.5 times it takes with the challenge sentence
  await tracker.poll();
  assert.deepEqual(feed(), [], 'a result with the challenge sentence waits longer than a plain strikeout');
  await wait();
  await tracker.poll();
  assert.deepEqual(feed().map((r) => [r.type, r.title, r.lines]), [['mlb.batter.strikeout', 'Will Smith struck out looking 👀', ['Dodgers lost an ABS challenge.']]]); // the lost challenge folds into the strikeout's moment
  state.plays = [play(id, 'Smith struck out swinging.')]; // the challenge overturned a pitch; he went on to strike out swinging
  await tracker.poll();
  await tracker.poll();
  const rows = feed();
  assert.equal(rows.length, 1, 'one alert');
  assert.deepEqual(rows[0].lines, ['Dodgers lost an ABS challenge.', 'ESPN changed this to a strikeout swinging, and the challenge no longer reads upheld.']);
  liveDeps.getJson = prev;
});

// ─── F1, Option B: the lost challenge and the strikeout go out together ───
test('NLCS G3 F1: a lost challenge waits for its at-bat\'s strikeout, even with a later play in the feed, and goes out with it', async () => {
  const game = '401908033', mk = (id: string, type: string, text: string, scoring = false, resultPlay = false) => ({
    id, type: { text: type, type: resultPlay ? 'play-result' : '' }, text, period: { type: 'Bottom', number: 7 }, scoringPlay: scoring, scoreValue: 0, homeScore: 0, awayScore: 1, wallclock: new Date().toISOString(),
    participants: [{ athlete: { id: '2' }, type: 'pitcher' }, { athlete: { id: '1' }, type: 'batter' }],
  });
  const state = { plays: [] as any[] };
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string, o?: any) => {
    if (url.startsWith(urls.corePlays('mlb', game).split('?')[0])) return { items: [] };
    if (url.startsWith(urls.summary('mlb', game))) return { header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [] }] }, plays: state.plays };
    return prev(url, o);
  };
  const before = feed().length;
  const tracker = new GameTracker('mlb', game, '19', '8');
  const pitch = mk('4019080330704060092', 'Strike Looking - Confirmed', 'Pitch 3 : Strike 3 Looking'), result = mk('4019080330704990057', 'Play Result', 'Smith struck out looking. Los Angeles Dodgers challenged: call on the field was upheld.', false, true);
  const next = { ...mk('4019080330705010005', 'Ball', 'Pitch 1 : Ball 1'), participants: [{ athlete: { id: '2' }, type: 'pitcher' }, { athlete: { id: '3' }, type: 'batter' }] }; // the next batter: a later play exists
  state.plays = [pitch, result, next];
  await tracker.poll();
  await new Promise((r) => setTimeout(r, 240)); // past ABS_SETTLE_MS (200): the challenge's own clock is up, the strikeout's (300) is not
  await tracker.poll();
  assert.deepEqual(feed().slice(before), [], 'neither goes out alone');
  await wait();
  await tracker.poll();
  assert.deepEqual(feed().slice(before).map((r) => r.type), ['mlb.batter.strikeout', 'mlb.challenge_lost'], 'the strikeout first, the challenge after it in the same poll');
  liveDeps.getJson = prev;
});

// ─── F2: the run belongs to the pitcher whose runner it was ───
test('NLCS G3 F2: Turang (Sasaki\'s runner) scores on Wrobleski\'s wild pitch: Wrobleski let a run score, Sasaki gave up 1 run', () => {
  const g: any = { league: 'mlb', gameId: 'G3', homeId: '19', awayId: '8', goalies: new Map() };
  const play = (o: any) => ({ id: 'x', type: '', typeSlug: 'play-result', text: '', participants: [], scoring: false, scoreValue: 0, home: 0, away: 0, at: Date.now(), shooting: false, teamId: '8', period: { type: 'Top', number: 8 }, ...o });
  const who = (pitcher: string, batter: string, ...on: [string, string][]) => [{ id: pitcher, role: 'pitcher' }, { id: batter, role: 'batter' }, ...on.map(([role, id]) => ({ id, role }))];
  const run = (p: any) => { const es = PLAYER_DETECTORS.mlb(g, p); observePlay(g, p); return es; };
  run(play({ id: '1', text: 'Turang walked.', participants: who('3', '6', ['onFirst', '6']) })); // reached against Sasaki
  const wp = play({ id: '2', typeSlug: 'wild-pitch', type: 'Wild Pitch', text: 'Turang scored on Wrobleski wild pitch.', scoring: true, scoreValue: 1, away: 1, participants: who('4', '7', ['onThird', '6']) });
  const es = run(wp);
  assert.deepEqual(es.filter((e) => e.targetKey.startsWith('player:')).map((e) => [e.type, e.targetKey, e.title]), [
    ['mlb.pitcher.gift_run', 'player:mlb:4', 'Justin Wrobleski let a run score on a wild pitch'],
    ['mlb.pitcher.runs_allowed', 'player:mlb:3', 'Roki Sasaki gave up 1 run'],
  ]);
  // ESPN posts the run twice, a "Wild Pitch" and a "Play Result" with one text: the same ids, so one alert each.
  const twin = PLAYER_DETECTORS.mlb({ ...g }, { ...wp, id: '3', type: 'Play Result', typeSlug: 'play-result' });
  const ids = (list: typeof es) => list.filter((e) => e.targetKey.startsWith('player:')).map((e) => e.id);
  assert.deepEqual(ids(twin), ids(es));
});
