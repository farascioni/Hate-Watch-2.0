// A half-inning's end waits for a read with its third out (live.ts halfInningEnds), but not forever: after
// HW_HALF_END_WAIT_MS it's judged on the plays as they stand, once. The bottom of the 8th of ALDS Game 5 (October 10
// 2026, test/fixtures), with Adell's at-bat, the third out, never coming.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.HW_DB = ':memory:';
process.env.HW_HALF_END_WAIT_MS = '100';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { liveDeps, GameTracker } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const fx = JSON.parse(readFileSync(new URL('./fixtures/alds-game5-401907994.json', import.meta.url), 'utf8'));
const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:mlb:5', '5', 'Cleveland Guardians', 'Guardians', 'CLE');
team.run('team:mlb:4', '4', 'Chicago White Sox', 'White Sox', 'CHW');
loadCatalog();
db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('guardians', 's', 'ios', null, JSON.stringify(DEFAULT_PREFS));
db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('guardians', 'team:mlb:5');
const got = () => (db.prepare(`SELECT e.title, e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = 'guardians' ORDER BY f.rowid`).all() as { title: string; body: string }[])
  .map((r) => `${r.title} | ${r.body}`);
const logs: string[] = [];
const realLog = console.log;

test("no third out within the wait: judged on the plays as they stand, once, and logged", async () => {
  let core: any[] = [];
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.corePlays('mlb', '401907994').split('?')[0])) return { items: core };
    if (url.startsWith(urls.summary('mlb', '401907994'))) return { header: { season: { type: 3 }, competitions: [{ status: { type: { state: 'in' } }, competitors: [] }] }, plays: [] };
    throw new Error(`unexpected fetch ${url}`);
  };
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  const tracker = new GameTracker('mlb', '401907994', '5', '4');
  const now = (ps: any[]) => ps.map((p) => ({ ...p, wallclock: new Date().toISOString() }));
  await tracker.poll(); // the game on, nothing yet
  const b8 = fx.plays.filter((p: any) => p.id.slice(9, 11) === '15');
  const withoutAdell = b8.filter((p: any) => p.id.slice(11, 13) !== '06');
  const end = fx.endInnings.find((p: any) => p.id.slice(9, 11) === '15');
  core = now([...withoutAdell, end]);
  await tracker.poll();
  assert.deepEqual(got(), [], 'waiting for the third out');
  await new Promise((r) => setTimeout(r, 120));
  await tracker.poll();
  console.log = realLog;
  const loaded = "Guardians left the bases loaded 🤦 | Bottom 8th: DeLauter grounded into fielder's choice to second, Ramírez to second, Kwan to third, Halpin out at home. — CHW 0, CLE 2";
  assert.deepEqual(got(), [loaded], "on the plays it has: DeLauter's out, the bases loaded");
  assert.ok(logs.some((l) => /Bottom8 over: mlb\.team\.stranded_risp .*no third out after 0\.1s/.test(l)), logs.join('\n'));
  core = now([...b8, end]); // Adell's at-bat after all
  await tracker.poll();
  assert.deepEqual(got(), [loaded], 'judged once');
});
