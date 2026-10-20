// The "season in misery" share card: one device's whole run so far (from its first feed row, or its first
// Successful Hate Watch, to now) as a picture it can share. It is not an alert: nothing is pushed and no
// feed gets it. It is an `events` row of type SEASON_TYPE only so that it has a share code like an alert's,
// and /a/<code> draws it (share-styles.ts seasonSheet). The counting is the weekly recap's, over a longer
// range (recap.ts miserySpan). The loss rating is never printed. One row per device, day and tally, so
// asking again with nothing new gives the same link; a new tally is a new card, and old links keep theirs.
import { createHash } from 'node:crypto';
import { db, shareCode } from './db.ts';
import { PUBLIC_URL, getPrefs, NOTICE_TYPE } from './fanout.ts';
import { RECAP_TYPE, dateIn, miserySpan } from './recap.ts';
import { SEASON_TYPE, who } from './share-styles.ts';

// The device's id is hashed: events outlive a device that deletes its data.
const idPrefix = (deviceId: string) => `season:${createHash('sha256').update(deviceId).digest('base64url').slice(0, 16)}:`;

/** "Delete all my data" takes the device's season cards (and so their links) with it. */
export const forgetSeasonCards = (deviceId: string) => { db.prepare('DELETE FROM events WHERE id LIKE ?').run(`${idPrefix(deviceId)}%`); };

/** The link to this device's season card, or null when it has no alerts and no Successful Hate Watches yet. */
export function seasonCard(deviceId: string, now = Date.now()) {
  const first = (db.prepare(`SELECT MIN(t) AS t FROM (SELECT MIN(occurred_at) AS t FROM feed WHERE device_id = ? UNION ALL SELECT MIN(occurred_at) FROM hate_watches WHERE device_id = ?)`)
    .get(deviceId, deviceId) as { t: number | null }).t;
  if (first == null) return null;
  const { watches, total, alerts, low } = miserySpan(deviceId, first, now + 1);
  // The team that delivered the most alerts (not the recap's fallback: that one counts recaps).
  const most = db.prepare(`SELECT e.target_key AS key, COUNT(*) AS n FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND e.type NOT IN ('${RECAP_TYPE}', '${NOTICE_TYPE}')
    GROUP BY e.target_key ORDER BY n DESC, MAX(f.occurred_at) DESC LIMIT 1`).get(deviceId) as { key: string; n: number } | undefined;
  const top = watches[0]?.target_key ?? most?.key; // the team the app opens the card on, as for a recap
  if (!top || (!total && !alerts)) return null;

  const tz = getPrefs(deviceId).quietHours.tz || 'America/New_York';
  const day = (at: number) => new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(at);
  const range = `${day(first)} to ${day(now)}`;
  const lowPoint = low?.replace(/^Successful Hate Watch! /, '') ?? null;
  const teams = watches.slice(0, 3).map((w) => ({ key: w.target_key, n: w.n }));
  const id = `${idPrefix(deviceId)}${dateIn(now, tz)}:${alerts}-${total}`;
  const title = `My season in misery: ${total} Successful Hate Watch${total === 1 ? '' : 'es'}`;
  const body = [
    teams.length ? `${teams.map((t) => `${who(t.key).name} ${t.n}`).join(', ')}${watches.length > 3 ? ', and more' : ''}.` : '',
    `${alerts} alert${alerts === 1 ? '' : 's'}, ${range}.`,
    lowPoint ? `Low point: ${lowPoint}.` : '',
  ].filter(Boolean).join(' ');
  const code = shareCode(id);
  db.prepare(`INSERT OR IGNORE INTO events (id, type, league, game_id, target_key, title, body, occurred_at, detected_at, meta, share_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, SEASON_TYPE, top.split(':')[1], null, top, title, body, now, now, JSON.stringify({ range, watches: total, alerts, teams, most: most ?? null, low: lowPoint }), code);
  return { url: `${PUBLIC_URL}/a/${code}` };
}
