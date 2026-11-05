// Automatic posts to X (the NBA pilot). When an NBA team loses, a "Successful Hate Watch" is posted from our own account
// as a standalone post: the alert as the app's share sheet words it (emoji, title, score), the share card (share.ts) as its
// picture, and the team's @handle. No link, no reply, no quote: X blocks API replies to accounts that haven't engaged with
// the app, and a link makes a post cost 13 times as much. misery.ts calls socialLoss as it records a loss, so every loss the
// app knows about, tracked or not, passes through here once.
//
// Both switches are off until turned on (flags.ts SOCIAL): `social.nba.dryrun` logs what it would post, `social.nba.live`
// posts and needs the four HW_X_* secrets. A loss is claimed (kv `social:<id>`) the moment it is seen, in either mode, so a
// post is made at most once, and turning live on later does not post the evening's earlier games. The post waits a minute
// (the misery row can be revised by then), is dropped if the row is gone, if the game ended over 3 hours ago, or if 15 posts
// went out in the last 24 hours. Nothing is retried: a failed post is recorded as failed and stays failed.
//
// shortcut: the handles below are from memory and unverified: check them before going live.
// shortcut: media goes to POST /2/media/upload signed with OAuth 1.0a; X documents OAuth 2.0 `media.write` there, so the first
//   live post must be watched (docs/social-posts.md).
import { createHmac, randomBytes } from 'node:crypto';
import { db, kvGet, kvSet } from './db.ts';
import { socialOn } from './flags.ts';
import type { League } from './leagues.ts';
import type { Detected } from './detectors.ts';

/** NBA teams' X handles by team key (`team:nba:<espnId>`). */
export const NBA_HANDLES: Record<string, string> = {
  'team:nba:1': '@ATLHawks', 'team:nba:17': '@BrooklynNets', 'team:nba:2': '@celtics', 'team:nba:30': '@hornets',
  'team:nba:4': '@chicagobulls', 'team:nba:5': '@cavs', 'team:nba:6': '@dallasmavs', 'team:nba:7': '@nuggets',
  'team:nba:8': '@DetroitPistons', 'team:nba:9': '@warriors', 'team:nba:10': '@HoustonRockets', 'team:nba:11': '@Pacers',
  'team:nba:12': '@LAClippers', 'team:nba:13': '@Lakers', 'team:nba:29': '@memgrizz', 'team:nba:14': '@MiamiHEAT',
  'team:nba:15': '@Bucks', 'team:nba:16': '@Timberwolves', 'team:nba:3': '@PelicansNBA', 'team:nba:18': '@nyknicks',
  'team:nba:25': '@okcthunder', 'team:nba:19': '@OrlandoMagic', 'team:nba:20': '@sixers', 'team:nba:21': '@Suns',
  'team:nba:22': '@trailblazers', 'team:nba:24': '@spurs', 'team:nba:23': '@SacramentoKings', 'team:nba:28': '@Raptors',
  'team:nba:26': '@utahjazz', 'team:nba:27': '@WashWizards',
};

const MAX_AGE_MS = 3 * 3600_000;
const DAY_MS = 24 * 3600_000;
const DAY_CAP = 15;
const delayMs = () => Number(process.env.HW_SOCIAL_DELAY_MS ?? 60_000);
const HATE_WATCH = 'Successful Hate Watch! '; // misery.ts stores a loss's title without it

type Mode = 'dryrun' | 'live';
type Status = 'waiting' | 'dryrun' | 'posted' | 'gone' | 'no-card' | 'no-credentials' | 'capped' | 'error';
const record = (id: string, patch: { status: Status; [k: string]: unknown }) => {
  const prev = kvGet<Record<string, unknown>>(`social:${id}`) ?? {};
  kvSet(`social:${id}`, { ...prev, ...patch });
};

/** The post as the app's share sheet words an alert (emoji, title, body), then the team's handle if we have it. */
export const postText = (emoji: string, title: string, body: string, handle?: string) =>
  [`${emoji} ${title}\n${body}`, handle].filter(Boolean).join('\n\n');

/**
 * A loss was just recorded as misery row `id`. Claims it and schedules the post. Returns whether it was claimed (for tests).
 * Never throws: misery.ts calls this inside the alert's own path.
 */
export function socialLoss(e: Pick<Detected, 'type' | 'at' | 'meta'>, league: League, source: string, id: string, now = Date.now()): boolean {
  try {
    if (league !== 'nba' || e.type !== 'team.lost' || source === 'backfill' || e.meta?.preseason) return false;
    const mode: Mode | null = socialOn('social.nba.live') ? 'live' : socialOn('social.nba.dryrun') ? 'dryrun' : null;
    if (!mode || now - e.at > MAX_AGE_MS) return false;
    const claim = db.prepare('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)').run(`social:${id}`, JSON.stringify({ at: now, mode, status: 'waiting' }));
    if (claim.changes !== 1) return false;
    setTimeout(() => void postLoss(id, mode), delayMs()).unref();
    return true;
  } catch (err) { console.error('[social]', id, err); return false; }
}

/** Post (or, in a dry run, log) misery row `id`. Re-reads the row, which may have been revised or removed in the wait. */
export async function postLoss(id: string, mode: Mode, now = Date.now()): Promise<Status> {
  try {
    const row = db.prepare('SELECT title, body, target_key, share_code FROM misery WHERE id = ?').get(id) as { title: string; body: string; target_key: string; share_code: string } | undefined;
    if (!row) { record(id, { status: 'gone' }); return 'gone'; }
    const recent = (kvGet<number[]>('social:recent') ?? []).filter((t) => now - t < DAY_MS);
    if (mode === 'live' && recent.length >= DAY_CAP) { record(id, { status: 'capped' }); return 'capped'; }
    const { EVENT_TYPE_BY_ID } = await import('./event-types.ts'); // lazy: share.ts imports misery.ts, which imports this
    const { shareCard } = await import('./share.ts');
    const png = await shareCard(row.share_code);
    if (!png) { record(id, { status: 'no-card' }); return 'no-card'; }
    const text = postText(EVENT_TYPE_BY_ID.get('team.lost')?.emoji ?? '🪦', HATE_WATCH + row.title, row.body, NBA_HANDLES[row.target_key]);
    if (mode === 'dryrun') {
      console.log(`[social] dry run, would post ${png.length} byte card with:\n${text}`);
      record(id, { status: 'dryrun', text });
      return 'dryrun';
    }
    const creds = credentials();
    if (!creds) { record(id, { status: 'no-credentials' }); return 'no-credentials'; }
    kvSet('social:recent', [...recent, now]); // counted before the call: a post that errors may still have gone out
    const post = await postToX(text, png, creds);
    record(id, { status: 'posted', text, post });
    return 'posted';
  } catch (err) {
    console.error('[social]', id, err);
    record(id, { status: 'error', error: String(err).slice(0, 300) });
    return 'error';
  }
}

// ─── X ──────────────────────────────────────────────────────────────────────────────────────────

export interface Credentials { apiKey: string; apiSecret: string; token: string; tokenSecret: string }
export function credentials(env = process.env): Credentials | null {
  const { HW_X_API_KEY: apiKey, HW_X_API_SECRET: apiSecret, HW_X_ACCESS_TOKEN: token, HW_X_ACCESS_SECRET: tokenSecret } = env;
  return apiKey && apiSecret && token && tokenSecret ? { apiKey, apiSecret, token, tokenSecret } : null;
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a header (HMAC-SHA1). Only the oauth_* parameters are signed: JSON and multipart bodies are not part of the signature. */
export function oauthHeader(method: string, url: string, c: Credentials, nonce = randomBytes(16).toString('hex'), ts = String(Math.floor(Date.now() / 1000))) {
  const params: Record<string, string> = { oauth_consumer_key: c.apiKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: ts, oauth_token: c.token, oauth_version: '1.0' };
  const base = [method.toUpperCase(), enc(url), enc(Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&'))].join('&');
  params.oauth_signature = createHmac('sha1', `${enc(c.apiSecret)}&${enc(c.tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.keys(params).sort().map((k) => `${enc(k)}="${enc(params[k])}"`).join(', ');
}

async function x(url: string, init: { body: BodyInit; json?: boolean }, c: Credentials): Promise<any> {
  const res = await fetch(url, {
    method: 'POST', body: init.body, signal: AbortSignal.timeout(20_000),
    headers: { authorization: oauthHeader('POST', url, c), ...(init.json ? { 'content-type': 'application/json' } : {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`X ${url} ${res.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { data: unknown }).data;
}

/** Upload the card, then post the text with it. Returns X's answer (the post's id and text). */
async function postToX(text: string, png: Buffer, c: Credentials) {
  const form = new FormData();
  form.set('media', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'card.png');
  form.set('media_category', 'tweet_image');
  const media = await x('https://api.x.com/2/media/upload', { body: form }, c) as { id: string };
  return x('https://api.x.com/2/tweets', { body: JSON.stringify({ text, media: { media_ids: [media.id] } }), json: true }, c);
}
