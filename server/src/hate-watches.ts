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

/** SQL column for a feed query over `events e`: how many devices got that alert (feedItem's `recipients`). */
export const RECIPIENTS = '(SELECT COUNT(*) FROM feed x WHERE x.event_id = e.id) AS recipients';

/**
 * Scores tab: finals that gave this device a Successful Hate Watch carry how many others got it too
 * (`hateWatch.alsoGot`). Per device, so it's added to the device's copy of the card, not the shared one.
 */
export function withHateWatch<G extends { id: string; state: string }>(deviceId: string, games: G[]): (G & { hateWatch?: { alsoGot: number } })[] {
  const ids = games.filter((g) => g.state === 'post').map((g) => g.id);
  if (!ids.length) return games;
  const rows = db.prepare(`SELECT e.game_id, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id
    WHERE f.device_id = ? AND e.type IN (${[...HATE_WATCH_TYPES].map(() => '?').join(',')}) AND e.game_id IN (${ids.map(() => '?').join(',')})`)
    .all(deviceId, ...HATE_WATCH_TYPES, ...ids) as { game_id: string; recipients: number }[];
  const others = new Map(rows.map((r) => [r.game_id, Math.max(0, r.recipients - 1)]));
  return games.map((g) => (others.has(g.id) ? { ...g, hateWatch: { alsoGot: others.get(g.id)! } } : g));
}

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
