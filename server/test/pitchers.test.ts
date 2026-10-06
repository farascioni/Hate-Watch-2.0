// MLB pitcher alerts from the box score: blown saves, no quality starts, losses. Box shapes are ESPN's
// (NYY @ TB live on 2026-10-06: TB's starter pulled at 4.2, the reliever "active"; finals with "L, 0-1"
// and "B, 3" decision notes from 2026-09-20 and 2026-10-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_DECISION_RETRY_MS = '5';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { boxPitchers, pitcherEvents } = await import('../src/detectors.ts');
const { GameTracker, liveDeps } = await import('../src/live.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, 'mlb', ?, ?, ?, ?, 'x', 1, 1, 0)`);
team.run('team:mlb:30', '30', 'Tampa Bay Rays', 'Rays', 'TB');
team.run('team:mlb:10', '10', 'New York Yankees', 'Yankees', 'NYY');
const player = db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES (?, 'mlb', ?, ?, ?, 'x', 1, 1, 'headshot', 0)`);
for (const [id, name, t] of [['1', 'Freddy Peralta', '30'], ['2', 'Cam Booser', '30'], ['3', 'Rays Closer', '30'], ['4', 'Cam Schlittler', '10'], ['5', 'Yankees Reliever', '10']]) player.run(`player:mlb:${id}`, id, name, `team:mlb:${t}`);
loadCatalog();

const LABELS = ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC-ST', 'ERA', 'PC'];
type Arm = { id: string; ip: string; er: number; starter?: boolean; active?: boolean; notes?: string[] };
const arm = (a: Arm) => ({
  athlete: { id: a.id, displayName: `#${a.id}` }, stats: [a.ip, '3', String(a.er), String(a.er), '2', '5', '0', '80-50', '3.00', '80'],
  starter: !!a.starter, active: !!a.active, notes: (a.notes ?? []).map((text) => ({ type: 'pitchingDecision', text })),
});
const box = (tb: Arm[], nyy: Arm[]) => ({ boxscore: { players: [
  { team: { id: '10' }, statistics: [{ name: 'pitching', type: 'pitching', labels: LABELS, athletes: nyy.map(arm) }] },
  { team: { id: '30' }, statistics: [{ name: 'pitching', type: 'pitching', labels: LABELS, athletes: tb.map(arm) }] },
] } });
const g: any = { league: 'mlb', gameId: 'G0', homeId: '30', awayId: '10', goalies: new Map() };
const live = { final: false, score: { home: 1, away: 3 }, at: 0 };

test('box score: each pitcher, whether they started or are pitching now, outs recorded, earned runs, decisions', () => {
  const [peralta] = boxPitchers(box([{ id: '1', ip: '4.2', er: 1, starter: true, notes: ['L, 0-1'] }], []));
  assert.deepEqual(peralta, { id: '1', teamId: '30', starter: true, active: false, ip: '4.2', outs: 14, er: 1, line: '4.2 IP, 3 H, 1 ER, 2 BB, 5 K', notes: ['L, 0-1'] });
});

test('no quality start: when the starter is pulled before 6 innings, or gives up a 4th earned run; once', () => {
  const done = new Set<string>();
  const pulled = box([{ id: '1', ip: '4.2', er: 1, starter: true }, { id: '2', ip: '0.0', er: 0, active: true }], [{ id: '4', ip: '4.0', er: 0, starter: true, active: true }]);
  assert.deepEqual(pitcherEvents(g, boxPitchers(pulled), live, done).map((e) => [e.type, e.targetKey, e.title, e.body]), [
    ['mlb.pitcher.no_quality_start', 'player:mlb:1', 'No quality start for Freddy Peralta: pulled after 4.2 innings', '4.2 IP, 3 H, 1 ER, 2 BB, 5 K — NYY 3, TB 1'],
  ], 'still pitching through 4 (Schlittler) is not news yet');
  assert.deepEqual(pitcherEvents(g, boxPitchers(pulled), live, done), [], 'the next read: already said');
  const rocked = box([], [{ id: '4', ip: '3.1', er: 4, starter: true, active: true }]);
  assert.equal(pitcherEvents(g, boxPitchers(rocked), live, done)[0].title, 'No quality start for Cam Schlittler: 4 earned runs in 3.1 innings', 'still in the game, but it is settled');
  const fine = box([{ id: '1', ip: '6.0', er: 3, starter: true }], []);
  assert.deepEqual(pitcherEvents(g, boxPitchers(fine), live, new Set()), [], '6 innings, 3 earned: a quality start, pulled or not');
  const relief = box([{ id: '2', ip: '1.0', er: 2 }], []);
  assert.deepEqual(pitcherEvents(g, boxPitchers(relief), live, new Set()), [], 'relievers have no quality start to miss');
});

test('blown save as soon as ESPN posts it; the loss only at the final; together they are one alert', () => {
  const done = new Set<string>();
  const bs = box([{ id: '3', ip: '0.2', er: 1, active: true, notes: ['B, 3'] }], []);
  assert.deepEqual(pitcherEvents(g, boxPitchers(bs), live, done).map((e) => [e.type, e.title, e.body]), [
    ['mlb.pitcher.blown_save', 'Rays Closer blew the save', '0.2 IP, 3 H, 1 ER, 2 BB, 5 K · 3rd blown save this season — NYY 3, TB 1'],
  ]);
  const final = { final: true, score: { home: 3, away: 4 }, at: 0 };
  const lost = box([{ id: '3', ip: '0.2', er: 1, notes: ['B, 3', 'L, 2-4'] }], [{ id: '5', ip: '1.0', er: 0, notes: ['W, 5-1'] }]);
  assert.deepEqual(pitcherEvents(g, boxPitchers(lost), { ...live }, new Set(['mlb.pitcher.blown_save:3'])), [], 'no decisions before the final');
  assert.deepEqual(pitcherEvents(g, boxPitchers(lost), final, done).map((e) => [e.type, e.title, e.body]), [
    ['mlb.pitcher.loss', 'Rays Closer took the loss', '0.2 IP, 3 H, 1 ER, 2 BB, 5 K · now 2-4 — Final: NYY 4, TB 3'],
  ], 'the blown save already went out live: just the loss');
  const both = pitcherEvents(g, boxPitchers(lost), final, new Set());
  assert.deepEqual(both.map((e) => [e.type, e.aliases, e.title]), [['mlb.pitcher.blown_save', ['mlb.pitcher.loss'], 'Rays Closer blew the save and took the loss']],
    'both posted at the final: one alert that counts as either toggle');
  const short = box([{ id: '1', ip: '5.0', er: 2, starter: true, active: true, notes: ['L, 9-9'] }], []);
  assert.equal(pitcherEvents(g, boxPitchers(short), final, new Set())[0].title, 'Freddy Peralta took the loss without a quality start', 'a 5-inning complete game');
});

test('the live tracker: attaching mid-game is history, later news is alerted, the loss comes from the final box score', async () => {
  const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
  device.run('hater', 's', 'test', JSON.stringify(DEFAULT_PREFS));
  device.run('no-losses', 's', 'test', JSON.stringify({ ...DEFAULT_PREFS, types: { 'mlb.pitcher.loss': false } }));
  for (const d of ['hater', 'no-losses']) for (const p of ['1', '3', '4']) db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)').run(d, `player:mlb:${p}`);
  const feed = (dev: string) => (db.prepare(`SELECT e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.id LIKE 'G1:%' ORDER BY f.rowid`).all(dev) as any[]).map((r) => r.title);

  let summary: any = box([{ id: '1', ip: '4.2', er: 1, starter: true }, { id: '2', ip: '0.0', er: 0, active: true }], [{ id: '4', ip: '4.0', er: 0, starter: true, active: true }]);
  liveDeps.getJson = async (url: string) => {
    if (url === urls.corePlays('mlb', 'G1')) return { items: [] };
    if (url === urls.summary('mlb', 'G1')) return { header: { competitions: [{ status: { type: { state: 'in', completed: false } }, competitors: [] }] }, plays: [], ...summary };
    throw new Error(`unexpected fetch ${url}`);
  };
  const game = new GameTracker('mlb', 'G1', '30', '10');
  await game.poll();
  assert.deepEqual(feed('hater'), [], 'Peralta was already out when we attached: history');

  summary = box([{ id: '1', ip: '4.2', er: 1, starter: true }, { id: '3', ip: '0.2', er: 1, active: true, notes: ['B, 3'] }], [{ id: '4', ip: '3.1', er: 4, starter: true, active: true }]);
  await game.poll();
  assert.deepEqual(feed('hater').sort(), ['No quality start for Cam Schlittler: 4 earned runs in 3.1 innings', 'Rays Closer blew the save']);

  summary = box([{ id: '3', ip: '0.2', er: 1, notes: ['B, 3', 'L, 2-4'] }], [{ id: '4', ip: '3.1', er: 4, starter: true }]);
  await game.finalPitching({ home: 3, away: 4 });
  assert.deepEqual(feed('hater').slice(2), ['Rays Closer took the loss']);
  assert.deepEqual(feed('no-losses').slice(2), [], '"Takes the loss" off');
});
