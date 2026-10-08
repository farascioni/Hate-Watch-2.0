// MLB "Loses a challenge" for crew chief reviews: the umpires review a call themselves, and when they
// overturn it, the team the call had gone for lost it. The plays are the ones ESPN sent, with their real
// ids: Volpe's home run taken away for fan interference (Rays @ Yankees, 2026-10-07), and the 2026 season's
// other overturned reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { PLAYER_DETECTORS, observePlay, umpireReviewLost } = await import('../src/detectors.ts');
const { liveDeps, GameTracker } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [id, name, short, abbr] of [['10', 'New York Yankees', 'Yankees', 'NYY'], ['30', 'Tampa Bay Rays', 'Rays', 'TB'], ['3', 'Los Angeles Angels', 'Angels', 'LAA'],
  ['22', 'Philadelphia Phillies', 'Phillies', 'PHI'], ['18', 'Houston Astros', 'Astros', 'HOU'], ['28', 'Miami Marlins', 'Marlins', 'MIA'],
  ['14', 'Toronto Blue Jays', 'Blue Jays', 'TOR'], ['2', 'Boston Red Sox', 'Red Sox', 'BOS']]) team.run(`team:mlb:${id}`, id, name, short, abbr);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [id, name, t] of [['42547', 'Anthony Volpe', '10'], ['42604', 'Griffin Jax', '30'], ['41273', 'Jeremy Peña', '18']]) player.run(`player:mlb:${id}`, id, name, `team:mlb:${t}`);
loadCatalog();

const ctx = (gameId: string, homeId: string, awayId: string): any => ({ league: 'mlb', gameId, homeId, awayId, goalies: new Map() });
const result = (id: string, half: string, text: string, pitcher: string, batter: string, away: number, home: number) => ({
  id, type: 'Play Result', typeSlug: 'play-result', text, period: { type: half.split(' ')[0], number: Number(half.split(' ')[1]) },
  participants: [{ id: pitcher, role: 'pitcher' }, { id: batter, role: 'batter' }], scoring: false, scoreValue: 0, home, away, at: 0, shooting: false,
});
const VOLPE = 'Volpe doubled, Lombard Jr. scored.  Umpire review: HR call on the field was overturned due to fan interference.';
const detect = (g: any, p: any) => { const es = PLAYER_DETECTORS.mlb(g, p).filter((e) => e.type === 'mlb.challenge_lost'); observePlay(g, p); return es; };

test("a home run overturned by a crew chief review: the batter lost it, and so did the batting team (Volpe, fan interference)", () => {
  const es = detect(ctx('401907987', '10', '30'), result('4019079871104990057', 'Bottom 6', VOLPE, '42604', '42547', 4, 3));
  assert.deepEqual(es.map((e) => [e.targetKey, e.title, e.body]), [
    ['player:mlb:42547', "Anthony Volpe's home run was overturned", 'Bottom 6th: a crew chief review took it away (fan interference). Volpe doubled, Lombard Jr. scored. — TB 4, NYY 3'],
    ['team:mlb:10', 'Yankees lost a crew chief review', "Bottom 6th: Anthony Volpe's home run was overturned (fan interference). Volpe doubled, Lombard Jr. scored. — TB 4, NYY 3"],
  ]);
  assert.equal(es[0].moment, es[1].moment, 'one review: tracking Volpe and the Yankees gets you one alert');
});

test('an overturned review with an out in the result: a safe call became an out, so the batting team lost it (Peraza, PHI @ LAA)', () => {
  const es = detect(ctx('401816746', '3', '22'), result('4018167461703990057', 'Bottom 9',
    "Meckler grounded into fielder's choice to second, Peraza out at second.  Umpire review: call on the field was overturned.", '4630789', '4424090', 5, 1));
  assert.deepEqual(es.map((e) => [e.targetKey, e.title, e.body]), [
    ['team:mlb:3', 'Angels lost a crew chief review', "Bottom 9th: the call on the field was overturned. Meckler grounded into fielder's choice to second, Peraza out at second. — PHI 5, LAA 1"],
  ]);
});

test('an overturned review that ends in a home run: the call had gone against the batting team, so the fielding team lost it (Peña, MIA @ HOU)', () => {
  const es = detect(ctx('401816209', '18', '28'), result('4018162090101990057', 'Bottom 1', 'Peña homered to left center (405 feet).  Umpire review: call on the field was overturned.', '41247', '41273', 0, 1));
  assert.deepEqual(es.map((e) => [e.targetKey, e.title]), [['team:mlb:28', 'Marlins lost a crew chief review']], 'no batter alert: Peña came out ahead');
});

test('a guess, pinned: an overturned result with both an out and a run counts as the out (Rafaela, BOS @ TOR)', () => {
  const es = detect(ctx('401816469', '14', '2'), result('4018164691204990057', 'Top 7',
    'Rafaela sacrificed into double play, center to second to first, Seigler scored, Sogard thrown out at first.  Umpire review: call on the field was overturned.', '41383', '4987382', 1, 2));
  assert.deepEqual(es.map((e) => e.title), ['Red Sox lost a crew chief review']);
});

test('an upheld review is no alert: nobody asked for it, so nobody lost it', () => {
  assert.deepEqual(detect(ctx('401907963', '10', '2'), result('4019079630604990057', 'Top 6', 'Contreras homered to right center (387 feet).  Umpire review: call on the field was upheld.', '1', '2', 1, 0)), []);
});

test("the alert's id comes from the play, not its text, which ESPN rewrites", () => {
  const g = ctx('401907987', '10', '30');
  const a = umpireReviewLost(g, result('4019079871104990057', 'Bottom 6', VOLPE, '42604', '42547', 4, 3) as any);
  const b = umpireReviewLost(g, result('4019079871104990057', 'Bottom 6', VOLPE.replace(' due to fan interference', ''), '42604', '42547', 4, 3) as any);
  assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id));
});

// ─── Live: the review written into a result ESPN had already posted ───────────────────────────────
for (const [device, follows] of [['volpe-fan', ['player:mlb:42547']], ['yankees-fan', ['team:mlb:10']], ['both', ['player:mlb:42547', 'team:mlb:10']]] as const) {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run(device, 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
  for (const k of follows) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(device, k);
}
const reviews = (device: string) => (db.prepare(`SELECT e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.type = 'mlb.challenge_lost' ORDER BY f.rowid`).all(device) as { title: string }[]).map((r) => r.title);

/** A live game whose summary serves whatever `state.plays` holds on each poll; `done()` puts ESPN back. */
function liveGame(gameId: string, homeId: string, awayId: string) {
  const state = { plays: [] as any[] };
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string, o?: any) => {
    if (url.startsWith(urls.corePlays('mlb', gameId).split('?')[0])) return { items: [] };
    if (url.startsWith(urls.summary('mlb', gameId))) return { header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [] }] }, plays: state.plays };
    return prev(url, o);
  };
  return { state, tracker: new GameTracker('mlb', gameId, homeId, awayId), done: () => { liveDeps.getJson = prev; } };
}
/** Volpe's at-bat result in the summary's shape, with this text, posted at `at`. */
const volpe = (text: string, at = new Date()) => ({
  id: '4019079871104990057', type: { text: 'Play Result', type: 'play-result' }, text, period: { type: 'Bottom', number: 6 }, scoringPlay: true,
  participants: [{ athlete: { id: '42604' }, type: 'pitcher' }, { athlete: { id: '42547' }, type: 'batter' }], wallclock: at.toISOString(), homeScore: 3, awayScore: 4,
});

test('ESPN posts the home run, then rewrites the result once the review overturns it: the alert goes out then, once', async () => {
  const { state, tracker, done } = liveGame('401907987', '10', '30');
  const play = (text: string) => volpe(text);
  // ESPN's first version isn't known: this one is a reconstruction (the home run as called on the field).
  const before = play('Volpe homered to right, Lombard Jr. scored.');
  state.plays = [before];
  await tracker.poll();
  assert.deepEqual(['volpe-fan', 'yankees-fan', 'both'].map(reviews), [[], [], []], 'a home run, as called: nothing yet');
  state.plays = [play(VOLPE)];
  await tracker.poll();
  state.plays = [before]; // the summary can lag the core feed: the old text again, then the new
  await tracker.poll();
  state.plays = [play(VOLPE)];
  await tracker.poll();
  done();
  assert.deepEqual(['volpe-fan', 'yankees-fan', 'both'].map(reviews), [
    ["Anthony Volpe's home run was overturned"],
    ['Yankees lost a crew chief review'],
    ["Anthony Volpe's home run was overturned"],
  ]);
});

test("a review that was already in a result when the tracker attached is history, even if ESPN edits that result later", async () => {
  db.prepare(`DELETE FROM feed WHERE event_id IN (SELECT id FROM events WHERE type = 'mlb.challenge_lost')`).run();
  db.prepare(`DELETE FROM events WHERE type = 'mlb.challenge_lost'`).run();
  const { state, tracker, done } = liveGame('401907987', '10', '30');
  const hourAgo = new Date(Date.now() - 3600_000); // a restart mid-game: the review was an hour ago
  state.plays = [volpe(VOLPE, hourAgo)];
  await tracker.poll();
  state.plays = [volpe(VOLPE.replace('Volpe doubled', 'Volpe doubled to right'), hourAgo)];
  await tracker.poll();
  done();
  assert.deepEqual(['volpe-fan', 'yankees-fan', 'both'].map(reviews), [[], [], []]);
});
