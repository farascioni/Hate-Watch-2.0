// ESPN's clips on alerts (clips.ts): a play's clip goes on the alerts about that play when it comes out,
// minutes later, to the feeds that have them, without a push; a loss's alerts get the winning play's clip,
// or the recap; and each kind can be switched off on the server (flags.ts), which takes them out of the feed.
// Clip records and play ids in ESPN's shapes (Guardians @ White Sox, 2026-10-08).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_DECISION_RETRY_MS = '1';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, addSocket, feedItem, setPushSender } = await import('../src/fanout.ts');
const { liveDeps, GameTracker } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');
const { playIdsIn, clipShown, isRecap } = await import('../src/clips.ts');
const { flagOn, setFlag } = await import('../src/flags.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:mlb:5', '5', 'Cleveland Guardians', 'Guardians', 'CLE');
team.run('team:mlb:4', '4', 'Chicago White Sox', 'White Sox', 'CHW');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
player.run('player:mlb:35400', '35400', 'Erick Fedde', 'team:mlb:4');
player.run('player:mlb:4345843', '4345843', 'Patrick Bailey', 'team:mlb:5');
loadCatalog();

const device = db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
device.run('sox-hater', 's', 'ios', 'tok-sox-hater', JSON.stringify(DEFAULT_PREFS));
for (const k of ['team:mlb:4', 'player:mlb:35400']) follow.run('sox-hater', k);
const pushes: { to: string }[] = [];
setPushSender((m) => pushes.push(...m));
const frames: any[] = [];
addSocket('sox-hater', { on() {}, send: (f: string) => frames.push(JSON.parse(f)) } as any);
const feed = () => (db.prepare('SELECT e.*, f.extra FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid').all('sox-hater') as any[]).map(feedItem);

const HR = '4019079930801990057', GO_AHEAD = '4019079930804990057';
const now = Date.now(), soon = new Date(now + 2 * 86400_000).toISOString();
/** A clip as the summary lists it; its record (the clip API) names `plays`. */
const video = (id: number, headline: string, seconds = 21) => ({
  id, headline, duration: seconds, thumbnail: `https://img/${id}.jpg`, originalPublishDate: new Date(now).toISOString(), timeRestrictions: { expirationDate: soon },
  links: { api: { self: { href: `https://clips/${id}` } }, source: { href: `https://cdn/${id}.mp4`, HLS: { href: `https://hls/${id}.m3u8` } } },
});
const records: Record<string, string> = {
  // The id's digits as ESPN sends them: a JSON number past 2^53, which JSON.parse would round.
  'https://clips/50136804': `{"videos":[{"id":50136804,"gameId":401907993,"plays":[{"id":${HR}}]}]}`,
  'https://clips/50136898': `{"videos":[{"id":50136898,"gameId":401907993,"plays":[{"id":${GO_AHEAD}}]}]}`,
  'https://clips/50140000': `{"videos":[{"id":50140000,"gameId":401907993,"plays":[{"id":4019079930101990057}]}]}`,
};
const atBat = (id: string, half: string, text: string, away: number, home: number, batter: string) => ({
  id, type: { text: 'Play Result', type: 'play-result' }, text, period: { type: half.split(' ')[0], number: Number(half.split(' ')[1]) }, scoringPlay: true,
  participants: [{ athlete: { id: '35400' }, type: 'pitcher' }, { athlete: { id: batter }, type: 'batter' }], wallclock: new Date().toISOString(), awayScore: away, homeScore: home,
});

/** The clip reads a poll starts and doesn't wait for. */
const settle = () => new Promise((r) => setTimeout(r, 20));
/** The game's summary, serving `state`'s plays and clips on each read; `done()` puts ESPN back. */
function liveGame(gameId: string) {
  const state = { plays: [] as any[], videos: [] as any[], status: 'in' };
  const [getJson, getText] = [liveDeps.getJson, liveDeps.getText];
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.corePlays('mlb', gameId).split('?')[0])) return { items: [] };
    if (url.startsWith(urls.summary('mlb', gameId))) return { header: { competitions: [{ status: { type: { state: state.status } }, competitors: [] }] }, plays: state.plays, videos: state.videos };
    throw new Error(`unexpected ${url}`);
  };
  liveDeps.getText = async (url: string) => { if (records[url]) return records[url]; throw new Error(`unexpected ${url}`); };
  return { state, tracker: new GameTracker('mlb', gameId, '4', '5'), done: () => { liveDeps.getJson = getJson; liveDeps.getText = getText; } };
}

test("ESPN's 19-digit play ids, read from the record's text; a recap is no play's clip", () => {
  assert.deepEqual(playIdsIn(records['https://clips/50136804']), [HR]);
  assert.deepEqual(playIdsIn('{"plays":[{"id":"1"},{"id":2}]}'), ['1', '2']);
  assert.equal(isRecap({ title: 'Cleveland Guardians vs. Chicago White Sox: Game Highlights' }), true);
  assert.equal(isRecap({ title: 'Patrick Bailey crushes a solo HR for the Guardians' }), false);
  assert.equal(isRecap({ title: 'Mathieu Olivier and Arber Xhekaj drop the gloves' }), false, 'a long clip of one play is still that play\'s');
});

test('a homer: the alert goes out, and its clip, out minutes later, goes on that alert: sent again live, no second push', async () => {
  const { state, tracker, done } = liveGame('401907993');
  try {
    await tracker.poll(); // before the game's plays
    state.plays = [atBat(HR, 'Top 1', 'Bailey homered to right (376 feet).', 1, 0, '4345843')];
    await tracker.poll();
    assert.deepEqual(feed().map((i) => [i.title, i.clip ?? null]), [['Erick Fedde gave up a 376-foot solo homer', null]]);
    const pushed = pushes.length;
    state.videos = [video(50136804, 'Patrick Bailey crushes a solo HR for the Guardians')];
    await tracker.poll();
    await settle();
    const [item] = feed();
    assert.deepEqual([item.clip?.id, item.clip?.title, item.clip?.hls, item.clip?.mp4], ['50136804', 'Patrick Bailey crushes a solo HR for the Guardians', 'https://hls/50136804.m3u8', 'https://cdn/50136804.mp4']);
    assert.equal(frames.filter((f) => f.kind === 'eventUpdate' && f.item.clip?.id === '50136804').length, 1, 'the app gets the alert again, with its clip');
    assert.equal(pushes.length, pushed, 'no second notification');
    await tracker.poll();
    await settle();
    assert.equal(frames.filter((f) => f.kind === 'eventUpdate').length, 1, 'once');
  } finally { done(); }
});

test('the switches: clips on alerts off takes them out of the feed at once, and back on brings them back; HW_FLAGS_OFF too', () => {
  assert.ok(feed()[0].clip);
  setFlag('clips.feed', false);
  assert.equal(flagOn('clips.feed'), false);
  assert.equal(feed()[0].clip, undefined);
  setFlag('clips.feed', true);
  assert.ok(feed()[0].clip);
  process.env.HW_FLAGS_OFF = 'clips';
  assert.deepEqual([flagOn('clips.feed'), flagOn('clips.loss'), flagOn('clips.highlights'), feed()[0].clip], [false, false, false, undefined], '"clips" is all of them');
  delete process.env.HW_FLAGS_OFF;
  assert.ok(feed()[0].clip);
  assert.equal(clipShown({ ...feed()[0].clip!, expires: now - 1 }, null), null, 'gone once ESPN takes it down');
});

test("a loss: its alert gets the winning play's clip (the go-ahead homer, clipped before the final)", async () => {
  const { state, tracker, done } = liveGame('401907994');
  try {
    await tracker.poll();
    state.plays = [atBat('4019079940101990057', 'Bottom 1', 'Vargas homered to left (386 feet).', 0, 1, '1'), atBat(GO_AHEAD, 'Top 8', 'Ramírez homered to right center (378 feet), Kwan scored.', 2, 1, '2')];
    state.videos = [video(50136898, 'Jose Ramirez cranks a 2-run HR to put the Guardians on top')];
    await tracker.poll();
    await settle();
    tracker.finish({ home: 1, away: 2 });
    await settle();
    const lost = feed().find((i) => i.type === 'team.lost')!;
    assert.deepEqual([lost.title, lost.clip?.title], ['Successful Hate Watch! White Sox lost to the Guardians', 'Jose Ramirez cranks a 2-run HR to put the Guardians on top']);
    setFlag('clips.loss', false);
    assert.equal(feed().find((i) => i.type === 'team.lost')!.clip, undefined, 'its own switch');
    setFlag('clips.loss', true);
  } finally { done(); tracker.stop(); }
});

test("a clip whose record won't load is tried a few times, then skipped: it doesn't keep newer clips waiting", async () => {
  const { state, tracker, done } = liveGame('401907996');
  try {
    const broken = [1, 2, 3, 4].map((n) => video(50150000 + n, `Broken ${n}`));
    state.plays = [atBat('4019079960101990057', 'Top 1', 'Bailey homered to right (376 feet).', 1, 0, '4345843')];
    await tracker.poll();
    records['https://clips/50160000'] = `{"videos":[{"plays":[{"id":4019079960101990057}]}]}`;
    state.videos = [...broken, video(50160000, 'Patrick Bailey goes deep')];
    for (let i = 0; i < 4; i++) { await tracker.readClips({ videos: state.videos }); }
    assert.equal(feed().find((i) => i.gameId === '401907996')?.clip?.title, 'Patrick Bailey goes deep');
  } finally { done(); delete records['https://clips/50160000']; }
});

test("a loss whose winning play has no clip gets the recap when it's out; the recap goes on no play's alert", async () => {
  const { state, tracker, done } = liveGame('401907995');
  try {
    await tracker.poll();
    state.plays = [atBat('4019079950101990057', 'Top 1', 'Bailey singled to left, Kwan scored.', 1, 0, '4345843')];
    await tracker.poll();
    tracker.finish({ home: 0, away: 1 });
    assert.equal(feed().find((i) => i.gameId === '401907995' && i.type === 'team.lost')!.clip, undefined, 'nothing yet');
    state.videos = [video(50149999, 'Cleveland Guardians vs. Chicago White Sox: Game Highlights', 74)];
    await tracker.readClips({ videos: state.videos }); // what the after-final reads do, a minute apart
    const mine = feed().filter((i) => i.gameId === '401907995');
    assert.deepEqual(mine.map((i) => [i.type, i.clip?.title ?? null]), [
      ['mlb.pitcher.runs_allowed', null],
      ['team.lost', 'Cleveland Guardians vs. Chicago White Sox: Game Highlights'],
    ]);
  } finally { done(); tracker.stop(); }
});
