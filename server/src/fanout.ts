import type { WebSocket } from 'ws';
import { db } from './db.ts';
import { EVENT_TYPE_BY_ID } from './event-types.ts';
import { targetDto } from './catalog.ts';
import type { Detected } from './detectors.ts';
import type { League } from './leagues.ts';

// ─── Preferences ──────────────────────────────────────────────────────────────────────────────
export interface Prefs {
  pushEnabled: boolean;
  sound: boolean;
  leagues: Partial<Record<League, boolean>>;
  types: Record<string, boolean>;          // overrides of each type's defaultOn
  muted: string[];                         // followed targets silenced without unfollowing
  quietHours: { enabled: boolean; start: string; end: string; tz: string };
}

export const DEFAULT_PREFS: Prefs = {
  pushEnabled: true,
  sound: true,
  leagues: {},
  types: {},
  muted: [],
  quietHours: { enabled: false, start: '23:00', end: '08:00', tz: 'America/New_York' },
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

export function setPrefs(deviceId: string, patch: Partial<Prefs>): Prefs {
  const cur = getPrefs(deviceId);
  const next: Prefs = {
    ...cur, ...patch,
    leagues: { ...cur.leagues, ...patch.leagues },
    types: { ...cur.types, ...patch.types },
    quietHours: { ...cur.quietHours, ...patch.quietHours },
    muted: patch.muted ?? cur.muted,
  };
  db.prepare('UPDATE devices SET prefs = ? WHERE id = ?').run(JSON.stringify(next), deviceId);
  prefsCache.set(deviceId, next);
  return next;
}

export function typeEnabled(p: Prefs, typeId: string) {
  return p.types[typeId] ?? EVENT_TYPE_BY_ID.get(typeId)?.defaultOn ?? false;
}

export function wants(p: Prefs, e: Pick<Detected, 'type' | 'aliases' | 'targetKey'>, league: League) {
  if (p.leagues[league] === false) return false;
  if (p.muted.includes(e.targetKey)) return false;
  return typeEnabled(p, e.type) || (e.aliases ?? []).some((a) => typeEnabled(p, a));
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

/** After a device deletes itself: drop cached prefs and close its live sockets. */
export function forgetDevice(deviceId: string) {
  prefsCache.delete(deviceId);
  for (const ws of sockets.get(deviceId) ?? []) ws.close(4401, 'deleted');
  sockets.delete(deviceId);
}

// ─── Feed item shape (shared by REST + websocket) ─────────────────────────────────────────────
export function feedItem(row: { id: string; type: string; league: string; target_key: string; title: string; body: string; occurred_at: number; detected_at: number; meta: string | null }) {
  const t = EVENT_TYPE_BY_ID.get(row.type);
  return {
    id: row.id, type: row.type, emoji: t?.emoji ?? '😈', typeLabel: t?.label ?? row.type, league: row.league,
    title: row.title, body: row.body, occurredAt: row.occurred_at, detectedAt: row.detected_at,
    target: targetDto(row.target_key) ?? { kind: row.target_key.split(':')[0], key: row.target_key },
  };
}

// ─── Publish: persist once, then fan out to every follower who wants it ───────────────────────
const insEvent = () => db.prepare(`INSERT INTO events (id, type, league, game_id, target_key, title, body, occurred_at, detected_at, meta)
  VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
const insFeed = () => db.prepare('INSERT INTO feed (device_id, event_id, occurred_at, pushed) VALUES (?,?,?,?) ON CONFLICT DO NOTHING');
const followers = () => db.prepare('SELECT f.device_id, d.push_token FROM follows f JOIN devices d ON d.id = f.device_id WHERE f.target_key = ?');

export type PushMessage = { to: string; title: string; body: string; sound: 'default' | null; priority: 'high'; channelId: string; interruptionLevel: string; data: Record<string, unknown> };
let pushSender: (msgs: PushMessage[]) => void = () => {};
export function setPushSender(fn: typeof pushSender) { pushSender = fn; }

export function publish(events: Detected[], league: League) {
  const detectedAt = Date.now();
  const pushes: PushMessage[] = [];
  for (const e of events) {
    const fols = followers().all(e.targetKey) as { device_id: string; push_token: string | null }[];
    if (!fols.length) continue; // nobody tracks this target: don't even store it
    const res = insEvent().run(e.id, e.type, league, (e.meta?.gameId as string) ?? null, e.targetKey, e.title, e.body, e.at, detectedAt, JSON.stringify({ ...e.meta, aliases: e.aliases }));
    if (!res.changes) continue; // already published (re-poll, restart, or overlapping detectors)
    const item = feedItem({ id: e.id, type: e.type, league, target_key: e.targetKey, title: e.title, body: e.body, occurred_at: e.at, detected_at: detectedAt, meta: null });
    const frame = JSON.stringify({ kind: 'event', item });
    for (const f of fols) {
      const prefs = getPrefs(f.device_id);
      if (!wants(prefs, e, league)) continue;
      const willPush = !!(prefs.pushEnabled && f.push_token && !inQuietHours(prefs));
      insFeed().run(f.device_id, e.id, e.at, willPush ? 1 : 0);
      for (const ws of sockets.get(f.device_id) ?? []) ws.send(frame);
      if (willPush) pushes.push({
        to: f.push_token!, title: `${item.emoji} ${e.title}`, body: e.body, sound: prefs.sound ? 'default' : null,
        priority: 'high', channelId: 'hate-events', interruptionLevel: 'time-sensitive',
        data: { eventId: e.id, targetKey: e.targetKey, type: e.type },
      });
    }
    console.log(`[event] ${e.type} → ${e.targetKey}: ${e.title} (lag ${((detectedAt - e.at) / 1000).toFixed(1)}s, ${fols.length} followers)`);
  }
  if (pushes.length) pushSender(pushes);
}
