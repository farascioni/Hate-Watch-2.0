// How often and how far back a soccer tracker reads ESPN's touch feed (live.ts refreshTouches): the newest page on every
// poll, and a deeper look back every HW_TOUCH_MS, because ESPN retypes a touch (and takes one out) for a minute or two.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_TOUCH_MS = '60000';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { urls } = await import('../src/leagues.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'epl', ?, ?, ?, ?, 'x', 1, 1, 0)`).run('team:epl:364', '364', 'Liverpool', 'Liverpool', 'LIV');
db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'epl', ?, ?, ?, ?, 'x', 1, 1, 0)`).run('team:epl:382', '382', 'Manchester City', 'Man City', 'MNC');
loadCatalog();
db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)').run('lfc', 's', 'test', JSON.stringify(DEFAULT_PREFS));
db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('lfc', 'team:epl:364');

const pref = (id: string) => `http://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/athletes/${id}?lang=en&region=us`;
const tref = (id: string) => `http://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/teams/${id}?lang=en&region=us`;
const pass = (i: number) => ({ id: String(1000 + i), type: { text: 'Pass', type: 'pass' }, text: 'Pass', homeScore: 0, awayScore: 0, period: { number: 1 }, clock: { displayValue: "10'" }, scoringPlay: false,
  team: { $ref: tref(i % 2 ? '364' : '382') }, participants: [{ type: 'passer', athlete: { $ref: pref(String(i % 7)) } }], wallclock: new Date().toISOString() });

test('the newest page on every poll; the pages back to TOUCH_DEEP touches only every HW_TOUCH_MS', async () => {
  const touches: any[] = Array.from({ length: 50 }, (_, i) => pass(i));
  const asked: number[][] = [[]];
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.summary('epl', 'S1'))) return { keyEvents: [], commentary: [], header: { competitions: [{ status: { type: { state: 'in', completed: false } }, competitors: [] }] } };
    const q = url.match(/plays\?limit=(\d+)&page=(\d+)/);
    if (!q) throw new Error(`unexpected fetch ${url}`);
    const [limit, page] = [Number(q[1]), Number(q[2])];
    asked.at(-1)!.push(page);
    return { count: touches.length, pageIndex: page, pageCount: Math.max(1, Math.ceil(touches.length / limit)), items: touches.slice((page - 1) * limit, page * limit) };
  };
  const game = new GameTracker('epl', 'S1', '364', '382');
  await game.poll(); // the first read: the count, and the one page there is
  assert.deepEqual(asked.at(-1), [1]);
  touches.push(...Array.from({ length: 300 }, (_, i) => pass(50 + i)));
  asked.push([]);
  await game.poll(); // from the end of what it held, to the end
  assert.deepEqual(asked.at(-1), [1, 2, 3, 4]);
  asked.push([]);
  await game.poll();
  assert.deepEqual(asked.at(-1), [4], 'then only the page the newest touches are on');
  asked.push([]);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 61_000;
    await game.poll();
  } finally { Date.now = realNow; }
  assert.deepEqual(asked.at(-1), [2, 3, 4], 'and every HW_TOUCH_MS, 250 touches back');
  asked.push([]);
  await game.poll();
  assert.deepEqual(asked.at(-1), [4]);
});
