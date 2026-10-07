// The leaderboard is the top 100 of each filter, ranked within that filter. Checked against a brute-force
// ranking of a few thousand random follows over every league, for every filter the app offers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { leaderboard, LEADERBOARD_MAX } = await import('../src/leaderboard.ts');
const { LEAGUE_IDS } = await import('../src/leagues.ts');
const { startApi } = await import('../src/api.ts');

// Every league gets 8 teams and 30 players with the same ESPN ids (team:nba:1 and team:wnba:1 are
// different teams), and some names repeat across leagues.
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const names = new Map<string, string>();
const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const lg of LEAGUE_IDS) {
  for (let t = 1; t <= 8; t++) {
    const key = `team:${lg}:${t}`, name = `${['Atlanta', 'Boston', 'Chicago', 'Dallas', 'Élan', 'Fresno', 'Gary', 'Houston'][t - 1]} ${lg.toUpperCase()}`;
    team.run(key, lg, String(t), name, name, `T${t}`);
    names.set(key, name);
  }
  for (let p = 1; p <= 30; p++) {
    const key = `player:${lg}:${100 + p}`, name = p % 5 === 0 ? `Sam Smith` : `Player ${String.fromCharCode(65 + (p % 26))}${p} ${lg}`;
    player.run(key, lg, String(100 + p), name, `team:${lg}:${1 + (p % 8)}`);
    names.set(key, name);
  }
}
loadCatalog();

// 300 devices, each tracking a few targets, popular ones more often: lots of ties, especially at 1.
const keys = [...names.keys()];
const device = db.prepare(`INSERT INTO devices (id, secret, created_at) VALUES (?, 's', 0)`);
const follow = db.prepare(`INSERT OR IGNORE INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)`);
for (let d = 0; d < 300; d++) {
  device.run(`d${d}`);
  for (let i = 0; i < 1 + Math.floor(rand() * 6); i++) follow.run(`d${d}`, keys[Math.floor(rand() ** 2.5 * keys.length)]);
  if (d % 50 === 0) follow.run(`d${d}`, 'player:nfl:999999'); // cut from every roster: never ranked
}

/** The leaderboard worked out the slow way, from the raw follows. */
function bruteForce(kind?: 'team' | 'player', league?: string) {
  const count = new Map<string, number>();
  for (const { target_key } of db.prepare('SELECT target_key FROM follows').all() as { target_key: string }[]) count.set(target_key, (count.get(target_key) ?? 0) + 1);
  const list = [...count].filter(([k]) => names.has(k)).filter(([k]) => { const [kd, lg] = k.split(':'); return (!kind || kd === kind) && (!league || lg === league); })
    .map(([key, haters]) => ({ key, haters, name: names.get(key)! }))
    .sort((a, b) => b.haters - a.haters || a.name.localeCompare(b.name));
  const distinct = [...new Set(list.map((e) => e.haters))]; // most first: a count's rank is its place here
  const ranked = list.map((e) => ({ key: e.key, rank: distinct.indexOf(e.haters) + 1, tied: list.filter((x) => x.haters === e.haters).length > 1, haters: e.haters }));
  const top = ranked.slice(0, 100);
  return { top, total: list.length, moreTied: top.length ? ranked.slice(100).filter((e) => e.haters === top.at(-1)!.haters).length : 0 };
}

test('every filter: the top 100 in it, ranked within it, ties and all, matching a brute-force count', () => {
  let cutInsideATie = 0, cut = 0;
  for (const kind of [undefined, 'team', 'player'] as const) {
    for (const league of [undefined, ...LEAGUE_IDS]) {
      const want = bruteForce(kind, league);
      const got = leaderboard({ kind, league });
      const label = `${kind ?? 'everything'} / ${league ?? 'all sports'}`;
      assert.deepEqual(got.entries.map((e) => ({ key: e.target.key, rank: e.rank, tied: e.tied, haters: e.haters })), want.top, label);
      assert.deepEqual([got.total, got.moreTied], [want.total, want.moreTied], label);
      assert.ok(got.entries.every((e) => (!kind || e.target.kind === kind) && (!league || e.target.league === league)), `${label}: nothing from outside the filter`);
      if (want.total > 100) cut++;
      if (want.moreTied) cutInsideATie++;
    }
  }
  assert.ok(cut >= 2 && cutInsideATie >= 1, `the data exercises the cut (${cut} filters over 100, ${cutInsideATie} cut inside a tie)`);
});

test('never more than the top 100, whatever is asked for', async () => {
  assert.equal(LEADERBOARD_MAX, 100);
  assert.equal(leaderboard({ limit: 500 }).entries.length, 100);
  assert.equal(leaderboard({ limit: 0 }).entries.length, 100, 'nonsense means the default');
  assert.equal(leaderboard({ limit: 5 }).entries.length, 5);
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const q of ['', '?limit=100', '?limit=200', '?limit=abc']) {
    const r = await (await fetch(`${base}/leaderboard${q}`)).json();
    assert.equal(r.entries.length, 100, q);
    assert.equal(r.total, bruteForce().total, q);
  }
  const nba = await (await fetch(`${base}/leaderboard?kind=team&league=nba`)).json();
  assert.deepEqual([nba.total, nba.moreTied], [bruteForce('team', 'nba').total, 0], 'under 100: all of them, nothing cut');
  server.close();
});
