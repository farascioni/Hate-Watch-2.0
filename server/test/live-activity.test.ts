// The lock screen scoreboard (live-activity.ts, apns.ts): who is on a device's board and in what order (favorites, then most
// hated, then tracked), when a push goes out, and that nothing is sent without the APNS_* secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, color, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, '#000', 'x', 1, 1, 0)`);
const CODES = ['NYY', 'BOS', 'TB', 'MIA', 'CLE', 'DET', 'LAD', 'SF', 'SEA', 'HOU', 'ATL', 'NYM'];
CODES.forEach((c, i) => team.run(`team:mlb:${i + 1}`, 'mlb', String(i + 1), c, c, c));
const T = Object.fromEntries(CODES.map((c, i) => [c, `team:mlb:${i + 1}`]));
loadCatalog();

const { upsertGame, forgetDeviceTeams } = await import('../src/scores.ts');
const { addFavorite } = await import('../src/favorites.ts');
const { buildBoard, putLiveActivity, getLiveActivity, flush, statusLine } = await import('../src/live-activity.ts');
const { setApnsSender, apnsJwt, apnsConfigured, tokenGone } = await import('../src/apns.ts');
const { setFlag } = await import('../src/flags.ts');

const HOUR = 3600_000;
const side = (code: string, score: number | null) => ({ team: { key: T[code], abbrev: code } as any, score });
let n = 0;
const game = (away: string, home: string, state: 'in' | 'post' | 'pre', o: { as?: number; hs?: number; detail?: string; startsAt?: number; key?: string } = {}) => {
  const key = o.key ?? `mlb:${++n}`;
  upsertGame({ key, league: 'mlb', id: key.slice(4), state, startsAt: o.startsAt ?? Date.now() - HOUR, detail: o.detail ?? 'Top 3rd', away: side(away, o.as ?? 0), home: side(home, o.hs ?? 0) });
  return key;
};

db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)').run('dev', 's', 'ios', '{}');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
for (const c of ['NYY', 'CLE', 'SEA', 'HOU', 'ATL', 'NYM']) follow.run('dev', T[c]);
addFavorite('dev', T.TB); // a favorite, not tracked

// Listed so the sort has to reorder them.
game('BOS', 'NYY', 'in');                                  // tracked only
game('DET', 'CLE', 'in');                                  // most hated
const rays = game('MIA', 'TB', 'in', { as: 1, hs: 2 });    // favorite, not tracked
game('LAD', 'SF', 'in');                                   // nobody's
game('SEA', 'LAD', 'pre');                                 // not started
game('HOU', 'LAD', 'post', { startsAt: Date.now() - 3 * HOUR - 5 * 60_000 }); // ended 5 minutes ago
game('ATL', 'LAD', 'post', { startsAt: Date.now() - 4 * HOUR });               // ended an hour ago
putLiveActivity('dev', { mostHated: [T.CLE] });

test('favorites first, then most hated, then tracked; finals for 10 minutes; games nobody follows left out', () => {
  const b = buildBoard('dev')!;
  assert.deepEqual(b.games.map((g) => [`${g.a}@${g.h}`, g.t]), [['MIA@TB', 0], ['DET@CLE', 1], ['BOS@NYY', 2], ['HOU@LAD', 2]]);
  assert.equal(b.more, 0);
  assert.deepEqual(b.games[0], { k: rays, a: 'MIA', as: 1, h: 'TB', hs: 2, st: 'Top 3rd', live: true, t: 0, l: '♥ MIA 1  TB 2', r: 'Top 3rd', lc: '#F5C451', rc: '#E5232B' });
  assert.deepEqual([b.v, b.mt], [1, ''], 'the version, and no "+N more" line');
  assert.deepEqual([b.games[1].l, b.games[1].lc], ['★ DET 0  CLE 0', '#F5C451']);
  assert.deepEqual([b.games[2].l, b.games[2].lc], ['BOS 0  NYY 0', '#FFFFFF']);
  assert.equal(b.games[3].st, 'Final');
});

test('a starred player stands for his team', () => {
  db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:mlb:9', 'mlb', '9', 'A Pitcher', ?, 'x', 1, 1, 'headshot', 0)`).run(T.NYY);
  loadCatalog();
  putLiveActivity('dev', { mostHated: ['player:mlb:9'] });
  assert.deepEqual(buildBoard('dev')!.games.map((g) => g.t), [0, 1, 2, 2], 'the Yankees game moves up to most hated');
  assert.equal(buildBoard('dev')!.games[1].a, 'BOS');
  putLiveActivity('dev', { mostHated: [T.CLE] });
});

test('past four games the rest are counted, and the payload stays small', () => {
  for (const c of ['SEA', 'SEA', 'ATL', 'NYM']) game('MIA', c, 'in');
  const b = buildBoard('dev')!;
  assert.equal(b.games.length, 4);
  assert.equal(b.more, 4);
  assert.equal(b.mt, '+4 more');
  assert.ok(JSON.stringify({ aps: { 'content-state': { name: 'ScoreboardActivity', props: JSON.stringify(b) } } }).length < 1800, 'Apple allows 4096 bytes');
});

test('the provider token is a valid ES256 JWT', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  process.env.APNS_KEY_P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n');
  process.env.APNS_KEY_ID = 'KEY123';
  process.env.APNS_TEAM_ID = 'TEAM123';
  assert.ok(apnsConfigured());
  const [h, p, sig] = apnsJwt().split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'KEY123' });
  assert.equal(JSON.parse(Buffer.from(p, 'base64url').toString()).iss, 'TEAM123');
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  assert.equal(apnsJwt(), `${h}.${p}.${sig}`, 'cached');
});

const sent: { token: string; sandbox: boolean; payload: any; priority: number }[] = [];
let reply = { status: 200 } as { status: number; reason?: string };
setApnsSender(async (token, sandbox, payload, priority) => { sent.push({ token, sandbox, payload, priority }); return reply; });
const token = () => (db.prepare("SELECT activity_token t FROM live_activities WHERE device_id = 'dev'").get() as any).t;

test('a board is sent once, again only when it changes: a score at priority 10, a clock at 5', async () => {
  putLiveActivity('dev', { activityToken: 'tok1', sandbox: true });
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].token, 'tok1');
  assert.equal(sent[0].sandbox, true);
  assert.equal(sent[0].priority, 10);
  assert.equal(sent[0].payload.aps.event, 'update');
  assert.equal(JSON.parse(sent[0].payload.aps['content-state'].props).games[0].a, 'MIA');
  await flush();
  assert.equal(sent.length, 1, 'nothing changed');
  game('MIA', 'TB', 'in', { as: 1, hs: 2, detail: 'Top 4th', key: rays });
  await flush();
  assert.equal(sent.length, 1, 'a clock change within 30 seconds of the last send waits');
  await flush(Date.now() + 31_000);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].priority, 5, 'only the inning moved');
  game('MIA', 'TB', 'in', { as: 1, hs: 3, detail: 'Top 4th', key: rays });
  await flush();
  assert.equal(sent[2].priority, 10, 'a run');
});

test('a 410 clears the token; no games ends the activity', async () => {
  reply = { status: 410 };
  game('MIA', 'TB', 'in', { as: 1, hs: 4, detail: 'Top 4th', key: rays });
  await flush();
  assert.equal(token(), null);
  assert.ok(tokenGone({ status: 400, reason: 'BadDeviceToken' }) && !tokenGone({ status: 429 }));
  reply = { status: 200 };
  db.prepare('DELETE FROM follows').run();
  db.prepare('DELETE FROM favorites').run();
  forgetDeviceTeams('dev');
  putLiveActivity('dev', { activityToken: 'tok2' });
  const before = sent.length;
  await flush();
  assert.equal(buildBoard('dev'), null);
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1)!.payload.aps.event, 'end');
  assert.equal(token(), null, 'an ended activity has no token');
});

test('nothing is sent without the secrets or with the flag off, and the app is told there is no board', async () => {
  db.prepare("INSERT INTO follows (device_id, target_key, created_at) VALUES ('dev', ?, 0)").run(T.NYY);
  forgetDeviceTeams('dev');
  putLiveActivity('dev', { activityToken: 'tok3' });
  const before = sent.length;
  setFlag('liveActivity', false);
  await flush();
  assert.equal(getLiveActivity('dev'), null);
  setFlag('liveActivity', true);
  delete process.env.APNS_KEY_P8;
  await flush();
  assert.equal(sent.length, before);
  assert.ok(getLiveActivity('dev'));
});

test('a live row says what ESPN gives for the situation: baseball outs and count, football down and distance', () => {
  const card = (o: object) => ({ detail: 'Bot 8th', ...o }) as any;
  assert.equal(statusLine(card({})), 'Bot 8th');
  assert.equal(statusLine(card({ bases: { first: true, second: false, third: true, outs: 1 }, count: { balls: 3, strikes: 2 } })), 'Bot 8th · 1 out · 3-2');
  assert.equal(statusLine(card({ bases: { first: false, second: false, third: false, outs: 0 } })), 'Bot 8th · 0 out', 'between batters there is no count');
  assert.equal(statusLine(card({ detail: 'Q4 - 2:14', downDistance: '3rd & 6 at LAR 38' })), 'Q4 - 2:14 · 3rd & 6');
});
