import { db, kvGet, kvSet } from './db.ts';
import { targetDto } from './catalog.ts';
import type { Detected } from './detectors.ts';
import { SOCCER } from './leagues.ts';

/**
 * A Successful Hate Watch: a team you track loses, or the team of a player you track (F1: your
 * constructor finishes outside the points, a double DNF included; the UFC: a fighter you track loses). It counts whatever your alert
 * settings are, and clearing the feed doesn't reset it; "Delete all my data" does (the device row cascades).
 */
/** Soccer: a loss by 3+ goals, sent instead of the plain loss to those who want it. */
const HEAVY_LOSSES = [...SOCCER].map((lg) => `${lg}.team.heavy_loss`);
export const HATE_WATCH_TYPES = new Set(['team.lost', 'player.team_lost', ...HEAVY_LOSSES, 'f1.team.no_points', 'f1.team.double_dnf', 'ufc.lost']);
export const isHateWatch = (e: Pick<Detected, 'type' | 'aliases'>) => [e.type, ...(e.aliases ?? [])].some((t) => HATE_WATCH_TYPES.has(t));
/**
 * An alert that is a team's loss for whoever gets it: the loss itself, "their team lost", or one of the
 * loss's facts sent in its place ("lost as 78% favorites", with the loss's id in `lostId`, see lossFacts). Not one
 * withdrawn after it went out (an F1 result a penalty changed: reviseEvent).
 */
export const isLossAlert = (e: { type: string; meta?: Record<string, unknown> | null }) => !e.meta?.withdrawn && (HATE_WATCH_TYPES.has(e.type) || typeof e.meta?.lostId === 'string');
/** One team's loss: its own alert (or soccer's 3+ goal one), and "their team lost" for its players. They share a game, a moment and a count. A fighter's loss (the UFC) too. */
const LOSS_TYPES = ['team.lost', 'player.team_lost', ...HEAVY_LOSSES, 'ufc.lost'];
/** SQL: an `events e` row that is one of a loss's alerts (a loss type, or a fact of the loss sent in its place). */
const LOSS_ROW = (e: string) => `(${e}.type IN (${LOSS_TYPES.map((t) => `'${t}'`).join(', ')}) OR json_extract(${e}.meta, '$.lostId') IS NOT NULL)`;
/**
 * SQL: an `events e` row that is one of a team's loss alerts, whichever a device got: the loss (soccer's 3+ goal one
 * too), a fact of it sent in its place, or "their team lost" for a player on it (those two carry the team's
 * `teamKey`). Takes the team's key twice.
 */
export const LOSS_ABOUT = (e: string) => `((${e}.target_key = ? AND ${LOSS_ROW(e)}) OR (json_extract(${e}.meta, '$.teamKey') = ? AND json_extract(${e}.meta, '$.lostId') IS NOT NULL))`;

const ins = () => db.prepare('INSERT INTO hate_watches (device_id, event_id, target_key, occurred_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING');

/**
 * What a hate watch counts as. A player's "their team lost", or soccer's 3+ goal loss, counts for the
 * team (the counter lists teams, never players), under the team loss's own id (`lostId`): one row per
 * device and loss, so tracking the team and a player on it, or two of its players, counts once.
 */
export function hateWatchOf(e: Pick<Detected, 'id' | 'type' | 'targetKey' | 'at' | 'meta'>): Pick<Detected, 'id' | 'targetKey' | 'at'> {
  const lostId = e.meta?.lostId, teamKey = e.meta?.teamKey;
  return typeof lostId === 'string' && typeof teamKey === 'string' ? { id: lostId, targetKey: teamKey, at: e.at } : e;
}

/** true if it's new for this device (publish() then tells the app its new tally). */
export const recordHateWatch = (deviceId: string, e: Pick<Detected, 'id' | 'type' | 'targetKey' | 'at' | 'meta'>) => {
  const hw = hateWatchOf(e);
  return ins().run(deviceId, hw.id, hw.targetKey, hw.at).changes > 0;
};

/**
 * SQL column for a feed query over `events e`: how many devices got that alert (feedItem's `recipients`).
 * A team's loss counts everyone who got any alert about it, the team's or a player's (a device gets one).
 */
export const RECIPIENTS = `(CASE WHEN ${LOSS_ROW('e')} AND e.game_id IS NOT NULL
  THEN (SELECT COUNT(DISTINCT x.device_id) FROM events y JOIN feed x ON x.event_id = y.id
    WHERE y.game_id = e.game_id AND y.league = e.league AND ${LOSS_ROW('y')})
  ELSE (SELECT COUNT(*) FROM feed x WHERE x.event_id = e.id) END) AS recipients`;

/**
 * Scores tab: finals that gave this device a Successful Hate Watch carry how many others got it too
 * (`hateWatch.alsoGot`). Per device, so it's added to the device's copy of the card, not the shared one.
 */
export function withHateWatch<G extends { id: string; state: string }>(deviceId: string, games: G[]): (G & { hateWatch?: { alsoGot: number } })[] {
  const ids = games.filter((g) => g.state === 'post').map((g) => g.id);
  if (!ids.length) return games;
  const rows = db.prepare(`SELECT e.game_id, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id
    WHERE f.device_id = ? AND (e.type IN (${[...HATE_WATCH_TYPES].map(() => '?').join(',')}) OR json_extract(e.meta, '$.lostId') IS NOT NULL)
      AND e.game_id IN (${ids.map(() => '?').join(',')})`)
    .all(deviceId, ...HATE_WATCH_TYPES, ...ids) as { game_id: string; recipients: number }[];
  const others = new Map(rows.map((r) => [r.game_id, Math.max(0, r.recipients - 1)]));
  return games.map((g) => (others.has(g.id) ? { ...g, hateWatch: { alsoGot: others.get(g.id)! } } : g));
}

/**
 * A device's Hate Watch streak: of the team's last `n` losses (its losing streak, this one included), how
 * many it watched. A loss counts for whoever tracked the team or a player on it then (hateWatchOf).
 */
export function watchedOfLast(deviceId: string, teamKey: string, n: number): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM hate_watches WHERE device_id = ? AND target_key = ? AND event_id IN
    (SELECT id FROM events WHERE type = 'team.lost' AND target_key = ? ORDER BY occurred_at DESC LIMIT ?)`).get(deviceId, teamKey, teamKey, n) as { c: number }).c;
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
// (Players' "their team lost" came later, counted as it happens: it isn't in this.)
if (!kvGet<boolean>('hate_watches_backfilled')) {
  const backfill = ['team.lost', 'f1.team.no_points', 'f1.team.double_dnf'];
  const types = backfill.map(() => '?').join(',');
  db.prepare(`INSERT OR IGNORE INTO hate_watches (device_id, event_id, target_key, occurred_at)
    SELECT f.device_id, e.id, e.target_key, e.occurred_at FROM feed f JOIN events e ON e.id = f.event_id WHERE e.type IN (${types})
    UNION SELECT fo.device_id, e.id, e.target_key, e.occurred_at FROM events e
      JOIN follows fo ON fo.target_key = e.target_key AND fo.created_at <= e.detected_at WHERE e.type IN (${types})`).run(...backfill, ...backfill);
  kvSet('hate_watches_backfilled', true);
}
