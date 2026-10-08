// The weekly misery recap: on Monday morning, each device's last week in one alert. Its Successful Hate
// Watches by team, how many alerts it got, and the worst loss ("Your week in misery: 4 Successful Hate
// Watches", "Yankees 2, Jets 1, Lakers 1. 37 alerts in all. Low point: Jets got BLOWN OUT by the Bills.").
import { createHash } from 'node:crypto';
import { db } from './db.ts';
import { catalog } from './catalog.ts';
import { getPrefs, publishTo, typeEnabled } from './fanout.ts';
import type { League } from './leagues.ts';

export const RECAP_TYPE = 'app.weekly_recap';
/** Sent once it's this hour or later on Monday, in the device's time zone. */
const RECAP_HOUR = 9;
/** A quiet week (no Successful Hate Watch, fewer alerts than this) gets no recap. */
const MIN_ALERTS = 5;

/** Weekday, the time since midnight, and the date, in a time zone. */
function localNow(now: number, tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour), sinceMidnight: ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 };
}
const dateIn = (at: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);

/**
 * One device's recap of the week that ended at midnight this Monday, or null for a quiet week. Its time
 * zone is the one the app sends with quiet hours (Eastern until someone turns them on).
 */
export function recapFor(deviceId: string, now = Date.now()) {
  const tz = getPrefs(deviceId).quietHours.tz || 'America/New_York';
  const local = localNow(now, tz);
  const end = now - local.sinceMidnight, start = end - 7 * 86400_000;
  const week = dateIn(start + 3600_000, tz); // the Monday it began
  const watches = db.prepare(`SELECT target_key, COUNT(*) AS n FROM hate_watches WHERE device_id = ? AND occurred_at >= ? AND occurred_at < ?
    GROUP BY target_key ORDER BY n DESC, MAX(occurred_at) DESC`).all(deviceId, start, end) as { target_key: string; n: number }[];
  const alerts = (db.prepare(`SELECT COUNT(*) AS n FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND f.occurred_at >= ? AND f.occurred_at < ?
    AND e.type != '${RECAP_TYPE}'`).get(deviceId, start, end) as { n: number }).n;
  const total = watches.reduce((s, w) => s + w.n, 0);
  if (!total && alerts < MIN_ALERTS) return null;
  // The worst loss they got: the biggest margin.
  const low = db.prepare(`SELECT e.title FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND f.occurred_at >= ? AND f.occurred_at < ?
    AND e.type = 'team.lost' ORDER BY CAST(json_extract(e.meta, '$.margin') AS INTEGER) DESC LIMIT 1`).get(deviceId, start, end) as { title: string } | undefined;
  const top = watches[0]?.target_key ?? (db.prepare(`SELECT e.target_key FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND f.occurred_at >= ? AND f.occurred_at < ?
    GROUP BY e.target_key ORDER BY COUNT(*) DESC LIMIT 1`).get(deviceId, start, end) as { target_key: string } | undefined)?.target_key;
  if (!top) return null;
  const name = (key: string) => catalog.team(key)?.shortName ?? catalog.player(key)?.name ?? key;
  const body = [
    watches.length ? `${watches.slice(0, 5).map((w) => `${name(w.target_key)} ${w.n}`).join(', ')}${watches.length > 5 ? ', and more' : ''}.` : '',
    `${alerts} alert${alerts === 1 ? '' : 's'} in all.`,
    low ? `Low point: ${low.title.replace(/^Successful Hate Watch! /, '')}.` : '',
  ].filter(Boolean).join(' ');
  return {
    // The device's id is hashed: events outlive a device that deletes its data.
    id: `recap:${createHash('sha256').update(deviceId).digest('base64url').slice(0, 16)}:${week}`,
    type: RECAP_TYPE,
    targetKey: top,
    title: total ? `Your week in misery: ${total} Successful Hate Watch${total === 1 ? '' : 'es'}` : `Your week in misery: ${alerts} alerts`,
    body,
    at: now,
    meta: { week, watches: total, alerts },
    local,
  };
}

/** Every device's recap, once it's Monday 9 am or later where it is. Each is sent once (its id is the week). */
export function weeklyRecaps(now = Date.now()) {
  const devices = db.prepare('SELECT DISTINCT device_id AS id FROM follows').all() as { id: string }[];
  for (const { id } of devices) {
    const prefs = getPrefs(id);
    if (!typeEnabled(prefs, RECAP_TYPE)) continue;
    const local = localNow(now, prefs.quietHours.tz || 'America/New_York');
    if (local.weekday !== 'Mon' || local.hour < RECAP_HOUR) continue;
    const recap = recapFor(id, now);
    if (!recap) continue;
    const { local: _, ...e } = recap;
    publishTo(id, e, e.targetKey.split(':')[1] as League);
  }
}
