// Injury reports: one team alert per report update (not one per player), players who aren't injured
// (NFL game-day "Active") never alert, and iOS stacks a team's notifications in one thread.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS, publish, setPushSender } = await import('../src/fanout.ts');
const { injuryEvents, parseInjuryReport } = await import('../src/live.ts');

db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES ('team:nfl:1', 'nfl', '1', 'Atlanta Falcons', 'Falcons', 'ATL', '#A71930', 'x', 1, 1, 0)`).run();
const NAMES = ['Cooper Rush', 'Robert Longerbeam', 'Jared Ivey', 'Drake London', 'Bijan Robinson', 'Kyle Pitts', 'Michael Penix Jr.'];
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'nfl', ?, ?, 'team:nfl:1', 'x', 1, 1, 'headshot', 0)`);
NAMES.forEach((n, i) => player.run(`player:nfl:${101 + i}`, String(101 + i), n));
loadCatalog();

const DAY = '2026-10-05';
const report = (entries: [number, string][]) => Object.fromEntries(entries.map(([id, status]) => [String(id), { status, teamId: '1', detail: '' }]));
const teamAlerts = (es: { type: string }[]) => es.filter((e) => e.type === 'team.player_injured') as any[];

test("ESPN's report: NFL game-day Active and MLB paternity leave aren't injuries", () => {
  const res = { injuries: [{ id: '1', injuries: [
    { athlete: { id: '101' }, status: 'Out', shortComment: 'Knee' },
    { athlete: { id: '102' }, status: 'Active' },
    { athlete: { links: [{ href: 'https://www.espn.com/nfl/player/_/id/103/jared-ivey' }] }, status: 'Questionable' },
    { athlete: { id: '104' }, status: 'paternity' },
  ] }] };
  assert.deepEqual(parseInjuryReport(res), {
    101: { status: 'Out', teamId: '1', detail: 'Knee' },
    103: { status: 'Questionable', teamId: '1', detail: '' },
  });
});

test('six Falcons ruled out at once: six player alerts, ONE team alert', () => {
  const prev = report([[101, 'Questionable'], [102, 'Questionable'], [103, 'Questionable'], [104, 'Questionable'], [105, 'Questionable'], [106, 'Questionable']]);
  const now = report([[101, 'Out'], [102, 'Out'], [103, 'Out'], [104, 'Out'], [105, 'Out'], [106, 'Out']]);
  const es = injuryEvents('nfl', prev, now, DAY, 0);
  assert.equal(es.filter((e) => e.type === 'player.injured').length, 6, 'each player still gets their own');
  const [t] = teamAlerts(es);
  assert.equal(teamAlerts(es).length, 1);
  assert.equal(t.title, 'Falcons: 6 players downgraded to Out');
  assert.equal(t.body, 'Bijan Robinson, Cooper Rush, Drake London and 3 more');
  assert.deepEqual(t.meta.athleteIds.length, 6);
  assert.equal(injuryEvents('nfl', prev, now, DAY, 0).find((e) => e.type === 'team.player_injured')!.id, t.id, 'the same changes always get the same id');
});

test('mixed statuses and new names: one alert that counts them', () => {
  const es = injuryEvents('nfl', {}, report([[101, 'Out'], [102, 'Questionable'], [103, 'Out']]), DAY, 0);
  const [t] = teamAlerts(es);
  assert.equal(t.title, 'Falcons: 3 players on the injury report (2 Out, 1 Questionable)');
  assert.equal(t.body, 'Cooper Rush (Out), Jared Ivey (Out), Robert Longerbeam (Questionable)', 'worst first');
});

test('one player: the same alert and id as before batching', () => {
  const [p, t] = injuryEvents('nfl', report([[101, 'Questionable']]), report([[101, 'Out']]), DAY, 0);
  assert.equal(p.title, 'Cooper Rush downgraded to Out');
  assert.equal(t.title, 'Falcons: Cooper Rush downgraded to Out');
  assert.equal(t.id, `inj:nfl:101:Out:${DAY}:team`);
  assert.deepEqual(injuryEvents('nfl', report([[101, 'Out']]), report([[101, 'Questionable']]), DAY, 0), [], 'getting better is not news');
});

test('delivery: one Falcons notification for the batch, stacked with the player alerts on iOS', () => {
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?, ?, ?, ?, ?, 0)').run('fan', 's', 'ios', 'ExponentPushToken[t]', JSON.stringify(DEFAULT_PREFS));
  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('fan', 'team:nfl:1');
  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run('fan', 'player:nfl:101');
  const sent: { title: string; threadId: string }[] = [];
  setPushSender((msgs) => sent.push(...msgs));
  const now = report([[101, 'Out'], [102, 'Out'], [103, 'Out'], [104, 'Out'], [105, 'Out'], [106, 'Out']]);
  publish(injuryEvents('nfl', {}, now, DAY, 0), 'nfl');
  publish(injuryEvents('nfl', {}, now, DAY, 0), 'nfl'); // the next scan sees the same report: nothing new
  assert.deepEqual(sent.map((m) => m.title), ['🤕 Cooper Rush is injured (Out)', '🚑 Falcons: 6 players on the injury report (6 Out)'],
    'their tracked player, plus one alert for the team: not seven');
  assert.deepEqual([...new Set(sent.map((m) => m.threadId))], ['team:nfl:1'], 'one iOS stack for the Falcons');
  setPushSender(() => {});
});
