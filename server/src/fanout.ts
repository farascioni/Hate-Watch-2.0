import type { WebSocket } from 'ws';
import { db, shareCode } from './db.ts';
import { EVENT_TYPE_BY_ID } from './event-types.ts';
import { catalog, targetDto } from './catalog.ts';
import type { Detected } from './detectors.ts';
import type { League } from './leagues.ts';

// ─── Preferences ──────────────────────────────────────────────────────────────────────────────
export interface Prefs {
  pushEnabled: boolean;
  sound: boolean;
  leagues: Partial<Record<League, boolean>>;
  types: Record<string, boolean>;          // overrides of each type's defaultOn
  muted: string[];                         // followed targets with push off: alerts still go to the feed
  quietHours: { enabled: boolean; start: string; end: string; tz: string };
  /**
   * Per-player/per-team alert choices (the ⚙️ on the Tracking tab): targetKey → typeId → on/off.
   * An entry here beats every global alert setting (type and league switches) for that target.
   */
  targetTypes: Record<string, Record<string, boolean>>;
  /** An alert type's 🔔 in Settings: typeId → false sends it to the feed without a push. Missing = push. */
  pushTypes: Record<string, boolean>;
  /** The 🔔 on one alert type for one player or team (their ⚙️ screen): targetKey → typeId → push. Beats pushTypes. */
  targetPushTypes: Record<string, Record<string, boolean>>;
}

/** A PUT /me/prefs patch: like Prefs, but a per-target value of null means "back to the global setting". */
export type PrefsPatch = Partial<Omit<Prefs, 'targetTypes' | 'targetPushTypes'>> & {
  targetTypes?: Record<string, Record<string, boolean | null>>;
  targetPushTypes?: Record<string, Record<string, boolean | null>>;
};

export const DEFAULT_PREFS: Prefs = {
  pushEnabled: true,
  sound: true,
  leagues: {},
  types: {},
  muted: [],
  quietHours: { enabled: false, start: '23:00', end: '08:00', tz: 'America/New_York' },
  targetTypes: {},
  pushTypes: {},
  targetPushTypes: {},
};

const prefsCache = new Map<string, Prefs>();

export function getPrefs(deviceId: string): Prefs {
  let p = prefsCache.get(deviceId);
  if (!p) {
    const row = db.prepare('SELECT prefs FROM devices WHERE id = ?').get(deviceId) as { prefs: string } | undefined;
    const stored = row ? JSON.parse(row.prefs) : {};
    p = { ...DEFAULT_PREFS, ...stored, quietHours: { ...DEFAULT_PREFS.quietHours, ...stored.quietHours } } as Prefs;
    prefsCache.set(deviceId, p);
  }
  return p;
}

export function setPrefs(deviceId: string, patch: PrefsPatch): Prefs {
  const cur = getPrefs(deviceId);
  const next: Prefs = {
    ...cur, ...patch,
    leagues: { ...cur.leagues, ...patch.leagues },
    types: { ...cur.types, ...patch.types },
    quietHours: { ...cur.quietHours, ...patch.quietHours },
    muted: patch.muted ?? cur.muted,
    targetTypes: mergeTargetTypes(cur.targetTypes, patch.targetTypes),
    pushTypes: { ...cur.pushTypes, ...patch.pushTypes },
    targetPushTypes: mergeTargetTypes(cur.targetPushTypes, patch.targetPushTypes),
  };
  db.prepare('UPDATE devices SET prefs = ? WHERE id = ?').run(JSON.stringify(next), deviceId);
  prefsCache.set(deviceId, next);
  return next;
}

const TARGET_KEY = /^(player|team):[a-z0-9]+:[\w-]+$/;

/** Merge per-target overrides: true/false sets one, null removes it (back to global). Unknown keys/types are ignored. */
export function mergeTargetTypes(cur: Prefs['targetTypes'] = {}, patch?: PrefsPatch['targetTypes']): Prefs['targetTypes'] {
  if (!patch) return cur;
  const out: Prefs['targetTypes'] = { ...cur };
  for (const [target, types] of Object.entries(patch)) {
    if (!TARGET_KEY.test(target) || !types || typeof types !== 'object') continue;
    const merged = { ...out[target] };
    for (const [typeId, v] of Object.entries(types)) {
      if (!EVENT_TYPE_BY_ID.has(typeId)) continue;
      if (v === null) delete merged[typeId];
      else if (typeof v === 'boolean') merged[typeId] = v;
    }
    if (Object.keys(merged).length) out[target] = merged; else delete out[target];
  }
  return out;
}

/** The global (Settings tab) answer for one alert type. */
export function typeEnabled(p: Prefs, typeId: string) {
  return p.types[typeId] ?? EVENT_TYPE_BY_ID.get(typeId)?.defaultOn ?? false;
}

/**
 * Is this alert type on for this specific target? A per-target choice always wins; otherwise the
 * global settings decide (the league switch, then the type switch).
 */
export function typeEnabledFor(p: Prefs, targetKey: string, typeId: string, league: League) {
  const own = p.targetTypes?.[targetKey]?.[typeId];
  if (own !== undefined) return own;
  return p.leagues[league] !== false && typeEnabled(p, typeId);
}

/** Does this user want this alert at all (feed + live)? Muting a target does NOT affect this. */
export function wants(p: Prefs, e: Pick<Detected, 'type' | 'aliases' | 'targetKey'>, league: League) {
  return [e.type, ...(e.aliases ?? [])].some((t) => typeEnabledFor(p, e.targetKey, t, league));
}

/** Should an alert they want also be pushed? Muted targets (🔕 on the Tracking tab) are feed-only. */
export function pushAllowed(p: Prefs, targetKey: string, now = new Date()) {
  return p.pushEnabled && !p.muted.includes(targetKey) && !inQuietHours(p, now);
}

/** Push or feed-only for one alert type and target: that target's own 🔔 wins, then the Settings 🔔, then push. */
export function pushTypeFor(p: Prefs, targetKey: string, typeId: string) {
  return p.targetPushTypes?.[targetKey]?.[typeId] ?? p.pushTypes?.[typeId] ?? true;
}

/**
 * Does the alert's type want a push (its 🔔)? An alert that counts for several types follows the most
 * specific one the user has switched on: with home runs feed-only and runs pushed, a homer stays quiet;
 * with home runs switched off, it arrives as a run and pushes.
 */
export function pushWanted(p: Prefs, e: Pick<Detected, 'type' | 'aliases' | 'targetKey'>, league: League) {
  const decider = [e.type, ...(e.aliases ?? [])].find((t) => typeEnabledFor(p, e.targetKey, t, league));
  return decider !== undefined && pushTypeFor(p, e.targetKey, decider);
}

/**
 * Final per-user decision. On top of `wants`, an event marked `unless: X` is dropped for users who
 * want X, because the X event already covers that moment (e.g. stranded runners vs. NOBLETIGER).
 */
export function shouldDeliver(p: Prefs, e: Pick<Detected, 'type' | 'aliases' | 'targetKey' | 'unless'>, league: League) {
  if (!wants(p, e, league)) return false;
  return !(e.unless && wants(p, { type: e.unless, targetKey: e.targetKey }, league));
}

export function inQuietHours(p: Prefs, now = new Date()) {
  if (!p.quietHours.enabled) return false;
  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: p.quietHours.tz }).format(now);
  const { start, end } = p.quietHours;
  return start <= end ? hm >= start && hm < end : hm >= start || hm < end;
}

// ─── Live sockets ─────────────────────────────────────────────────────────────────────────────
const sockets = new Map<string, Set<WebSocket>>();
export function addSocket(deviceId: string, ws: WebSocket) {
  if (!sockets.has(deviceId)) sockets.set(deviceId, new Set());
  sockets.get(deviceId)!.add(ws);
  ws.on('close', () => sockets.get(deviceId)?.delete(ws));
}

/** Send a frame to every connected device that passes `to` (live scores: see scores.ts). */
export function sendToConnected(frame: string, to: (deviceId: string) => boolean) {
  for (const [deviceId, set] of sockets) if (set.size && to(deviceId)) for (const ws of set) ws.send(frame);
}

/** After a device deletes itself: drop cached prefs and close its live sockets. */
export function forgetDevice(deviceId: string) {
  prefsCache.delete(deviceId);
  for (const ws of sockets.get(deviceId) ?? []) ws.close(4401, 'deleted');
  sockets.delete(deviceId);
}

// ─── Feed item shape (shared by REST + websocket) ─────────────────────────────────────────────
/** Where links that leave the app point (an alert's share link). */
export const PUBLIC_URL = process.env.HW_PUBLIC_URL ?? 'https://hate-watch-api.fly.dev';

export function feedItem(row: { id: string; type: string; league: string; target_key: string; title: string; body: string; occurred_at: number; detected_at: number; meta: string | null; share_code?: string | null; game_id?: string | null }) {
  const t = EVENT_TYPE_BY_ID.get(row.type);
  return {
    id: row.id, type: row.type, emoji: t?.emoji ?? '😈', typeLabel: t?.label ?? row.type, league: row.league,
    gameId: row.game_id ?? null, // the game (F1: session) it happened in, for the Scores tab's game screen
    title: row.title, body: row.body, occurredAt: row.occurred_at, detectedAt: row.detected_at,
    target: targetDto(row.target_key) ?? { kind: row.target_key.split(':')[0], key: row.target_key },
    // A page whose link preview is a picture of this alert; tapping it opens the App Store (see share.ts).
    shareUrl: `${PUBLIC_URL}/a/${row.share_code ?? shareCode(row.id)}`,
  };
}

// ─── Publish: persist once, then fan out to every follower who wants it ───────────────────────
const insEvent = () => db.prepare(`INSERT INTO events (id, type, league, game_id, target_key, title, body, occurred_at, detected_at, meta, share_code)
  VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
const insFeed = () => db.prepare('INSERT INTO feed (device_id, event_id, occurred_at, pushed) VALUES (?,?,?,?) ON CONFLICT DO NOTHING');
const followers = () => db.prepare('SELECT f.device_id, d.push_token FROM follows f JOIN devices d ON d.id = f.device_id WHERE f.target_key = ?');

export type PushMessage = { to: string; title: string; body: string; sound: 'default' | null; priority: 'high'; channelId: string; interruptionLevel: string; threadId: string; data: Record<string, unknown> };

/** iOS stacks notifications that share a thread: one stack per team, with its players' alerts in it. */
export const pushThread = (targetKey: string) => (targetKey.startsWith('team:') ? targetKey : catalog.player(targetKey)?.teamKey ?? targetKey);
let pushSender: (msgs: PushMessage[]) => void = () => {};
export function setPushSender(fn: typeof pushSender) { pushSender = fn; }

export function publish(events: Detected[], league: League) {
  const detectedAt = Date.now();
  const pushes: PushMessage[] = [];
  for (const e of events) {
    const fols = followers().all(e.targetKey) as { device_id: string; push_token: string | null }[];
    if (!fols.length) continue; // nobody tracks this target: don't even store it
    const gameId = ((e.meta?.gameId ?? e.meta?.compId) as string | undefined) ?? null; // F1: the session
    const res = insEvent().run(e.id, e.type, league, gameId, e.targetKey, e.title, e.body, e.at, detectedAt, JSON.stringify({ ...e.meta, aliases: e.aliases, unless: e.unless }), shareCode(e.id));
    if (!res.changes) continue; // already published (re-poll, restart, or overlapping detectors)
    const item = feedItem({ id: e.id, type: e.type, league, target_key: e.targetKey, title: e.title, body: e.body, occurred_at: e.at, detected_at: detectedAt, meta: null, game_id: gameId });
    const frame = JSON.stringify({ kind: 'event', item });
    for (const f of fols) {
      const prefs = getPrefs(f.device_id);
      if (!shouldDeliver(prefs, e, league)) continue;
      const willPush = !!f.push_token && pushAllowed(prefs, e.targetKey) && pushWanted(prefs, e, league);
      insFeed().run(f.device_id, e.id, e.at, willPush ? 1 : 0);
      for (const ws of sockets.get(f.device_id) ?? []) ws.send(frame);
      if (willPush) pushes.push({
        to: f.push_token!, title: `${item.emoji} ${e.title}`, body: e.body, sound: prefs.sound ? 'default' : null,
        priority: 'high', channelId: 'hate-events', interruptionLevel: 'time-sensitive', threadId: pushThread(e.targetKey),
        data: { eventId: e.id, targetKey: e.targetKey, type: e.type },
      });
    }
    console.log(`[event] ${e.type} → ${e.targetKey}: ${e.title} (lag ${((detectedAt - e.at) / 1000).toFixed(1)}s, ${fols.length} followers)`);
  }
  if (pushes.length) pushSender(pushes);
}
