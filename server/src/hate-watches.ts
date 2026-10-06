import { db, kvGet, kvSet } from './db.ts';
import { targetDto } from './catalog.ts';
import type { Detected } from './detectors.ts';

/**
 * A Successful Hate Watch: a team you track loses (F1: your constructor finishes outside the points,
 * a double DNF included). It counts whatever your alert settings are, and clearing the feed doesn't
 * reset it; "Delete all my data" does (the device row cascades).
 */
export const HATE_WATCH_TYPES = new Set(['team.lost', 'f1.team.no_points', 'f1.team.double_dnf']);
export const isHateWatch = (e: Pick<Detected, 'type' | 'aliases'>) => [e.type, ...(e.aliases ?? [])].some((t) => HATE_WATCH_TYPES.has(t));

const ins = () => db.prepare('INSERT INTO hate_watches (device_id, event_id, target_key, occurred_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING');

/** true if it's new for this device (publish() then tells the app its new tally). */
export const recordHateWatch = (deviceId: string, e: Pick<Detected, 'id' | 'targetKey' | 'at'>) => ins().run(deviceId, e.id, e.targetKey, e.at).changes > 0;

/** The Settings counter: the total, and each team's count (most first). */
export function hateWatchTally(deviceId: string) {
  const rows = db.prepare(`SELECT target_key, COUNT(*) AS n FROM hate_watches WHERE device_id = ?
    GROUP BY target_key ORDER BY n DESC, MAX(occurred_at) DESC`).all(deviceId) as { target_key: string; n: number }[];
  return {
    total: rows.reduce((sum, r) => sum + r.n, 0),
    teams: rows.flatMap((r) => { const target = targetDto(r.target_key); return target ? [{ target, count: r.n }] : []; }),
  };
}

// The counter came after launch: count the losses already in feeds, and the ones that happened to a
// team while the device tracked it but didn't make its feed (the alert was off).
if (!kvGet<boolean>('hate_watches_backfilled')) {
  const types = [...HATE_WATCH_TYPES].map(() => '?').join(',');
  db.prepare(`INSERT OR IGNORE INTO hate_watches (device_id, event_id, target_key, occurred_at)
    SELECT f.device_id, e.id, e.target_key, e.occurred_at FROM feed f JOIN events e ON e.id = f.event_id WHERE e.type IN (${types})
    UNION SELECT fo.device_id, e.id, e.target_key, e.occurred_at FROM events e
      JOIN follows fo ON fo.target_key = e.target_key AND fo.created_at <= e.detected_at WHERE e.type IN (${types})`).run(...HATE_WATCH_TYPES, ...HATE_WATCH_TYPES);
  kvSet('hate_watches_backfilled', true);
}
