// Automatic posts to X (social.ts): which losses are claimed, the claim-once rule, the dry run, the daily cap, and the
// post itself against a stand-in for X's two endpoints. Nothing here reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_SOCIAL_DELAY_MS = '3600000'; // the scheduled post never fires inside a test; postLoss is called directly
const { db, kvGet, kvSet } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { publish } = await import('../src/fanout.ts');
const { gameLostEvent } = await import('../src/detectors.ts');
const { socialLoss, postLoss, postText, oauthHeader, credentials, NBA_HANDLES } = await import('../src/social.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, short, abbr] of [
  ['nba', '4', 'Chicago Bulls', 'Bulls', 'CHI'], ['nba', '7', 'Denver Nuggets', 'Nuggets', 'DEN'],
  ['mlb', '19', 'Los Angeles Dodgers', 'Dodgers', 'LAD'], ['mlb', '26', 'San Francisco Giants', 'Giants', 'SF'],
]) team.run(`team:${lg}:${id}`, lg, id, name, short, abbr);
loadCatalog();

const now = Date.now();
const lossAt = (at: number, gameId = 'G1') => gameLostEvent({ league: 'nba' as const, gameId, homeId: '7', awayId: '4' }, { home: 133, away: 128 }, at)!;
const claimed = (id: string) => kvGet<{ status: string; mode: string }>(`social:${id}`);
const mode = (on?: string) => { if (on) process.env.HW_SOCIAL_ON = on; else delete process.env.HW_SOCIAL_ON; };
const KEYS = { HW_X_API_KEY: 'k', HW_X_API_SECRET: 's', HW_X_ACCESS_TOKEN: 't', HW_X_ACCESS_SECRET: 'ts' };

test('the post is the share sheet text, then the handle; every NBA team has one', () => {
  assert.equal(postText('🪦', 'Successful Hate Watch! Bulls lost to Nuggets', 'Final Score: DEN 133 to CHI 128', '@chicagobulls'),
    '🪦 Successful Hate Watch! Bulls lost to Nuggets\nFinal Score: DEN 133 to CHI 128\n\n@chicagobulls');
  assert.equal(postText('🪦', 'T', 'B'), '🪦 T\nB', 'no handle, no blank line');
  assert.equal(Object.keys(NBA_HANDLES).length, 30);
  assert.ok(Object.values(NBA_HANDLES).every((h) => /^@\w+$/.test(h)));
});

test('the OAuth 1.0a header is signed, repeatable, and carries only oauth_* fields', () => {
  const c = credentials(KEYS)!;
  const a = oauthHeader('POST', 'https://api.x.com/2/tweets', c, 'nonce', '1700000000');
  assert.equal(a, oauthHeader('POST', 'https://api.x.com/2/tweets', c, 'nonce', '1700000000'));
  assert.match(a, /^OAuth oauth_consumer_key="k", oauth_nonce="nonce", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1700000000", oauth_token="t", oauth_version="1.0"$/);
  assert.notEqual(a, oauthHeader('POST', 'https://api.x.com/2/media/upload', c, 'nonce', '1700000000'), 'the url is signed');
  assert.equal(credentials({ ...KEYS, HW_X_ACCESS_SECRET: '' }), null, 'all four secrets or none');
});

test('nothing is claimed while both switches are off', () => {
  mode();
  assert.equal(socialLoss(lossAt(now), 'nba', 'tracker', 'off:1', now), false);
  assert.equal(claimed('off:1'), undefined);
});

test('only a fresh NBA team.lost from the tracker or the board is claimed, once', () => {
  mode('social.nba.dryrun');
  const l = lossAt(now - 60_000);
  assert.equal(socialLoss(l, 'mlb', 'tracker', 'g:1', now), false, 'not NBA');
  assert.equal(socialLoss({ ...l, type: 'player.team_lost' }, 'nba', 'tracker', 'g:2', now), false, 'not a team loss');
  assert.equal(socialLoss(l, 'nba', 'backfill', 'g:3', now), false, 'a launch backfill is not news');
  assert.equal(socialLoss({ ...l, meta: { preseason: true } }, 'nba', 'tracker', 'g:4', now), false, 'preseason');
  assert.equal(socialLoss({ ...l, at: now - 4 * 3600_000 }, 'nba', 'tracker', 'g:5', now), false, 'over 3 hours ago');
  assert.equal(socialLoss(l, 'nba', 'tracker', 'g:6', now), true);
  assert.equal(socialLoss(l, 'nba', 'board', 'g:6', now), false, 'the same loss seen again (restart, board) is not claimed twice');
  assert.deepEqual(claimed('g:6'), { at: now, mode: 'dryrun', status: 'waiting' });
  mode();
});

test('publishing a loss claims it, and a dry run logs the post with the team handle and posts nothing', async () => {
  mode('social.nba.dryrun');
  const lost = lossAt(Date.now() - 60_000, 'G2');
  publish([lost], 'nba');
  assert.equal(claimed(lost.id)?.status, 'waiting');
  const logged: string[] = [];
  const log = console.log; console.log = (...a) => { logged.push(a.join(' ')); };
  try { assert.equal(await postLoss(lost.id, 'dryrun'), 'dryrun'); } finally { console.log = log; }
  const done = kvGet<{ status: string; text: string }>(`social:${lost.id}`)!;
  assert.equal(done.status, 'dryrun');
  assert.match(done.text, /^🪦 Successful Hate Watch! .*\n.*\n\n@chicagobulls$/s);
  assert.match(logged.join('\n'), /would post \d+ byte card/);
  mode();
});

test('a loss already on the list is never claimed later: switching live on does not post the evening\'s earlier games', () => {
  mode();
  const earlier = lossAt(Date.now() - 60_000, 'G5');
  publish([earlier], 'nba'); // recorded while both switches are off
  mode('social.nba.live');
  publish([earlier], 'nba'); // the board sees the same final again
  assert.equal(claimed(earlier.id), undefined);
  const fresh = lossAt(Date.now() - 60_000, 'G6');
  publish([fresh], 'nba');
  assert.equal(claimed(fresh.id)?.mode, 'live', 'a loss new to the list is');
  mode();
});

test('a row that is gone by the time the post is due is dropped', async () => {
  assert.equal(await postLoss('nope', 'dryrun'), 'gone');
  assert.equal(claimed('nope')?.status, 'gone');
});

test('live: no secrets posts nothing, the daily cap stops at 15, otherwise the card and the text go to X', async () => {
  const lost = lossAt(Date.now() - 60_000, 'G3');
  publish([lost], 'nba');
  for (const k of Object.keys(KEYS)) delete process.env[k];
  assert.equal(await postLoss(lost.id, 'live'), 'no-credentials');

  Object.assign(process.env, KEYS);
  kvSet('social:recent', Array.from({ length: 15 }, () => Date.now() - 1000));
  assert.equal(await postLoss(lost.id, 'live'), 'capped');
  kvSet('social:recent', []);

  const calls: { url: string; auth?: string; body: unknown }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    if (url.includes('twemoji')) return new Response('', { status: 404 }); // the card draws a blank emoji
    calls.push({ url, auth: headers?.authorization, body: init?.body });
    return new Response(JSON.stringify({ data: url.endsWith('/media/upload') ? { id: 'm1' } : { id: 't1', text: 'x' } }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await postLoss(lost.id, 'live'), 'posted');
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(calls.map((c) => c.url), ['https://api.x.com/2/media/upload', 'https://api.x.com/2/tweets']);
  assert.ok(calls.every((c) => c.auth?.startsWith('OAuth ')));
  assert.ok(calls[0].body instanceof FormData);
  const tweet = JSON.parse(calls[1].body as string);
  assert.deepEqual(tweet.media, { media_ids: ['m1'] });
  assert.match(tweet.text, /@chicagobulls$/);
  assert.ok(!/https?:\/\//.test(tweet.text), 'no link');
  assert.equal(kvGet<number[]>('social:recent')!.length, 1, 'the post counts toward the cap');
  assert.equal(claimed(lost.id)?.status, 'posted');
});

test('an X failure is recorded, not thrown, and still counts toward the cap', async () => {
  const lost = lossAt(Date.now() - 60_000, 'G4');
  publish([lost], 'nba');
  Object.assign(process.env, KEYS);
  kvSet('social:recent', []);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => (url.includes('twemoji') ? new Response('', { status: 404 }) : new Response('{"title":"Forbidden"}', { status: 403 }))) as typeof fetch;
  const err = console.error; console.error = () => {};
  try { assert.equal(await postLoss(lost.id, 'live'), 'error'); } finally { globalThis.fetch = realFetch; console.error = err; }
  assert.match((kvGet<{ error: string }>(`social:${lost.id}`))!.error, /403/);
  assert.equal(kvGet<number[]>('social:recent')!.length, 1);
});
