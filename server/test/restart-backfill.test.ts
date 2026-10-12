// A restart (a deploy) and the plays nobody read: ESPN posts plays 80-105 s after they happen, so with the usual 90 s of
// history a play the old server never read could be skipped by the new one. A game attached on the server's first
// scoreboard read (`atBoot`) takes 5 minutes of plays as news instead, and what the old server already sent stays
// sent once (its ids are in the database). A game followed later keeps 90 s. Also: a follow during a scoreboard scan
// starts tracking as soon as that scan ends (`every`).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { liveDeps, GameTracker, every } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [id, name, short, abbr] of [['10', 'New York Yankees', 'Yankees', 'NYY'], ['30', 'Tampa Bay Rays', 'Rays', 'TB']]) team.run(`team:mlb:${id}`, id, name, short, abbr);
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`)
  .run('player:mlb:33192', '33192', 'Aaron Judge', 'team:mlb:10');
loadCatalog();
db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('judge-fan', 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('judge-fan', 'player:mlb:33192');
const feed = () => (db.prepare(`SELECT e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'judge-fan' ORDER BY f.rowid`).all() as { title: string }[]).map((r) => r.title);

/** A live game whose summary serves `plays`; `done()` puts ESPN back. */
function liveGame(gameId: string, plays: any[], atBoot?: boolean) {
  const prev = liveDeps.getJson;
  liveDeps.getJson = async (url: string, o?: any) => {
    if (url.startsWith(urls.corePlays('mlb', gameId).split('?')[0])) return { items: [] };
    if (url.startsWith(urls.summary('mlb', gameId))) return { header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [] }] }, plays };
    return prev(url, o);
  };
  return { tracker: new GameTracker('mlb', gameId, '10', '30', { atBoot }), done: () => { liveDeps.getJson = prev; } };
}
/** Judge striking out, posted `ago` ms ago (ESPN's wallclock). */
const strikeout = (id: string, ago: number) => ({
  id, type: { text: 'Play Result', type: 'play-result' }, text: 'Judge struck out swinging.', period: { type: 'Bottom', number: 3 },
  participants: [{ athlete: { id: '50001' }, type: 'pitcher' }, { athlete: { id: '33192' }, type: 'batter' }], wallclock: new Date(Date.now() - ago).toISOString(), homeScore: 0, awayScore: 0,
});

test('a game followed mid-way: a strikeout 3 minutes old is history, as before', async () => {
  const { tracker, done } = liveGame('G1', [strikeout('G1p1', 180_000)]);
  await tracker.poll();
  done();
  assert.deepEqual(feed(), []);
});

test('a game live at boot: the same strikeout 3 minutes old is news (the old server may never have read it), and older is history', async () => {
  const { tracker, done } = liveGame('G2', [strikeout('G2p0', 10 * 60_000), strikeout('G2p1', 180_000)], true);
  await tracker.poll();
  done();
  assert.deepEqual(feed(), ['Aaron Judge struck out swinging'], 'one alert: the 3-minute-old play, not the 10-minute-old one');
});

test('a second restart reads the same plays again: what was sent stays sent once', async () => {
  const { tracker, done } = liveGame('G2', [strikeout('G2p0', 10 * 60_000), strikeout('G2p1', 180_000)], true);
  await tracker.poll();
  done();
  assert.deepEqual(feed(), ['Aaron Judge struck out swinging'], 'the id is stored: no second row');
});

test('every(): a kick during a run runs it again as soon as that run ends, not a turn later', async () => {
  let runs = 0, release!: () => void;
  const kick = every(60_000, () => { runs++; return runs === 1 ? new Promise<void>((r) => { release = r; }) : Promise.resolve(); }, { unref: true });
  assert.equal(runs, 1, 'the first run starts at once');
  kick(); // a follow while the first scan is under way
  assert.equal(runs, 1, 'never two at once');
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runs, 2, 'the kick ran right after, not 60 s later');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runs, 2, 'and only once');
});

test("a revision's line has the same id from a new tracker (a game followed again), so it can't take another line's stored id", async () => {
  const { PlayLedger } = await import('../src/revisions.ts');
  const g: any = { league: 'cfb', gameId: '401858481', homeId: '158', awayId: '84', goalies: new Map() };
  const alert: any = { id: '401858481:401858481541:cfb.team.interception:158', type: 'cfb.team.interception', targetKey: 'team:cfb:158', title: 't', body: 'b', at: 0, moment: 'm' };
  const first = new PlayLedger(g, () => {}), again = new PlayLedger(g, () => {});
  const wiped = 'Wiped out by a penalty on Indiana: Roughing The Passer.', back = 'Overturned on review: it stands.';
  assert.equal(first.linesOn([alert], wiped)[0].id, again.linesOn([alert], wiped)[0].id, 'the same line on the same alert: the same id');
  assert.notEqual(again.linesOn([alert], back)[0].id, first.linesOn([alert], wiped)[0].id, 'a different line: a different id, whatever the order');
});
