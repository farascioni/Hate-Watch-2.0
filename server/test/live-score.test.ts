// Team scoring alerts when ESPN edits plays after publishing them: a goal marked as scoring only
// later, a goal taken back, a goal only seen through the next one. Drives a real GameTracker with fake
// feeds shaped like ESPN's NHL site plays (WPG @ PIT, 2026-10-05).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'nhl', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:nhl:16', '16', 'Pittsburgh Penguins', 'Penguins', 'PIT');
team.run('team:nhl:28', '28', 'Winnipeg Jets', 'Jets', 'WPG');
loadCatalog();
db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)').run('fan', 's', 'test', JSON.stringify(DEFAULT_PREFS));
for (const t of ['team:nhl:16', 'team:nhl:28']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('fan', t);

const now = new Date().toISOString();
const goal = (id: string, teamId: string, away: number, home: number, text: string, scoring = true) =>
  ({ id, type: { text: 'Goal', type: 'goal' }, text, team: { id: teamId }, participants: [], scoringPlay: scoring, awayScore: away, homeScore: home, wallclock: now, period: { number: 3 } });
const faceoff = (id: string, away: number, home: number) => ({ id, type: { text: 'Face Off', type: 'faceoff' }, text: 'Faceoff', team: { id: '16' }, participants: [], scoringPlay: false, awayScore: away, homeScore: home, wallclock: now });

let n = 0;
function game() {
  const id = `G${n++}`;
  const feed: { plays: any[] } = { plays: [] };
  liveDeps.getJson = async (url: string) => {
    if (url === urls.corePlays('nhl', id)) return { items: [] };
    if (url === urls.summary('nhl', id)) return { header: { competitions: [{ status: { type: { state: 'in', completed: false } }, competitors: [] }] }, plays: feed.plays };
    throw new Error(`unexpected fetch ${url}`);
  };
  const tracker = new GameTracker('nhl', id, '16', '28');
  const alerts = () => (db.prepare(`SELECT e.type, e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'fan' AND e.game_id = ? ORDER BY f.rowid`).all(id) as any[])
    .map((r) => r.title);
  return { feed, tracker, alerts };
}

test('ordinary goals: one alert each (and a lead change), no repeats on re-polls', async () => {
  const { feed, tracker, alerts } = game();
  await tracker.poll();
  feed.plays = [goal('a', '16', 0, 1, 'Ben Kindel Goal (2) Tip-In')];
  await tracker.poll();
  feed.plays.push(goal('b', '28', 1, 1, 'Alex Iafallo Goal (1) Wrist Shot'));
  await tracker.poll();
  await tracker.poll();
  assert.deepEqual(alerts(), ['Penguins scored to take the lead over the Jets', 'Jets scored on the Penguins']);
});

test('a goal first published without its scoring flag still alerts when ESPN sets it', async () => {
  const { feed, tracker, alerts } = game();
  await tracker.poll();
  feed.plays = [goal('a', '28', 1, 0, 'Adam Lowry Goal (1) Backhand', false)];
  await tracker.poll();
  assert.deepEqual(alerts(), [], 'not a goal yet as far as ESPN says');
  feed.plays = [goal('a', '28', 1, 0, 'Adam Lowry Goal (1) Backhand')];
  await tracker.poll();
  await tracker.poll();
  assert.deepEqual(alerts(), ['Jets scored to take the lead over the Penguins']);
});

test('a goal taken back after review: the same team\'s next goal is still news', async () => {
  const { feed, tracker, alerts } = game();
  await tracker.poll();
  feed.plays = [goal('a', '16', 0, 1, 'Declan Carlile Goal (2) Wrist Shot')];
  await tracker.poll();
  feed.plays = [goal('a', '16', 0, 0, 'Declan Carlile Goal (2) Wrist Shot', false), faceoff('f', 0, 0)]; // disallowed
  await tracker.poll();
  feed.plays.push(goal('c', '16', 0, 1, 'Evgeni Malkin Goal (3) Snap Shot'));
  await tracker.poll();
  assert.deepEqual(alerts(), ['Penguins scored to take the lead over the Jets', 'Penguins scored to take the lead over the Jets'],
    'the disallowed one went out before the review; the real one goes out too');
});

test('a goal only seen through the next one: both alert once, and its late scoring flag adds nothing', async () => {
  const { feed, tracker, alerts } = game();
  await tracker.poll();
  feed.plays = [goal('a', '28', 1, 0, 'Iafallo'), goal('x', '16', 1, 1, 'Carlile Goal (2)', false), faceoff('f', 1, 1), goal('y', '28', 2, 1, 'Perfetti Goal (2)')];
  await tracker.poll();
  assert.deepEqual(alerts(), ['Jets scored to take the lead over the Penguins', 'Jets scored on the Penguins', 'Penguins scored on the Jets'],
    "the 2-1 play shows the Penguins' goal too");
  feed.plays[1] = goal('x', '16', 1, 1, 'Carlile Goal (2)');
  await tracker.poll();
  assert.equal(alerts().length, 3, 'no second alert for the Penguins goal');
});

test('attaching mid-game: goals already on the board are history', async () => {
  const { feed, tracker, alerts } = game();
  feed.plays = [{ ...goal('a', '16', 0, 1, 'early'), wallclock: new Date(Date.now() - 10 * 60_000).toISOString() }];
  await tracker.poll();
  feed.plays.push(goal('b', '28', 1, 1, 'Iafallo'));
  await tracker.poll();
  assert.deepEqual(alerts(), ['Jets scored on the Penguins']);
});
