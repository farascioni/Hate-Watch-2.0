// Developer notices: a message from Hate Watch in every install's feed, never a push. For an emergency (an
// outage, wrong alerts that went out) or news of what's coming. Sent from the shell (notice-cli.ts), which writes
// the notice and every device's feed row; the running server sends it to every open app within seconds
// (watchNotices). How it looks: fanout.ts NOTICE_SENDER and noticeLook.
import { db, kvGet, kvSet, shareCode, tx } from './db.ts';
import { feedItem, sendToConnected, NOTICE_LEAGUE, NOTICE_SENDER, NOTICE_TYPE } from './fanout.ts';

export interface Notice { title: string; body: string; urgent?: boolean }
/** The latest notice sent, for the running server to pass to open apps. */
const LATEST = 'notices:latest';

/** Checks a notice's text: something to say, short enough for a card's title. */
export function noticeProblem(n: Notice): string | null {
  if (!n.title?.trim()) return 'a notice needs a title';
  if (!n.body?.trim()) return 'a notice needs a body';
  if (n.title.length > 120) return `the title is ${n.title.length} characters; keep it to 120 (the rest goes in the body)`;
  return null;
}

/**
 * Sends a notice: one event, and a feed row for every device there is now (none pushed). `dryRun`: says how many
 * it would reach and sends nothing. Returns its id and how many devices got it.
 */
export function sendNotice(n: Notice, opts: { dryRun?: boolean; now?: number } = {}) {
  const problem = noticeProblem(n);
  if (problem) throw new Error(problem);
  const devices = (db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number }).n;
  if (opts.dryRun) return { id: null, devices };
  const now = opts.now ?? Date.now(), id = `notice:${now}`;
  tx(() => {
    db.prepare(`INSERT INTO events (id, type, league, game_id, target_key, title, body, occurred_at, detected_at, meta, share_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, NOTICE_TYPE, NOTICE_LEAGUE, null, NOTICE_SENDER.key, n.title.trim(), n.body.trim(), now, now, JSON.stringify(n.urgent ? { urgent: true } : {}), shareCode(id));
    // (SQLite reads an upsert after INSERT … SELECT only with a WHERE in the SELECT.)
    db.prepare('INSERT INTO feed (device_id, event_id, occurred_at, pushed, extra) SELECT id, ?, ?, 0, NULL FROM devices WHERE true ON CONFLICT DO NOTHING').run(id, now);
    kvSet(LATEST, { id, at: now });
  });
  return { id, devices };
}

/** The latest notices, newest first, with how many feeds each is in. */
export function listNotices(limit = 20) {
  return db.prepare(`SELECT e.id, e.title, e.body, e.occurred_at AS at, e.meta, (SELECT COUNT(*) FROM feed f WHERE f.event_id = e.id) AS devices
    FROM events e WHERE e.type = ? ORDER BY e.occurred_at DESC LIMIT ?`).all(NOTICE_TYPE, limit) as { id: string; title: string; body: string; at: number; meta: string | null; devices: number }[];
}

/** Takes a notice back out of every feed (an app that has it open keeps it until it next loads its feed). */
export function withdrawNotice(id: string) {
  return tx(() => {
    const found = db.prepare('SELECT 1 FROM events WHERE id = ? AND type = ?').get(id, NOTICE_TYPE);
    if (!found) return { found: false, feeds: 0 };
    const feeds = db.prepare('DELETE FROM feed WHERE event_id = ?').run(id).changes;
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
    return { found: true, feeds: Number(feeds) };
  });
}

/**
 * The running server: every `ms`, a notice sent since goes to every open app whose feed has it (an `event`
 * frame, as a live alert does), so it shows without a reload. Returns the timer.
 */
export function watchNotices(ms = Number(process.env.HW_NOTICE_POLL_MS ?? 5000)) {
  let seen = kvGet<{ id: string }>(LATEST)?.id;
  const check = () => {
    const latest = kvGet<{ id: string }>(LATEST);
    if (!latest || latest.id === seen) return;
    seen = latest.id;
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(latest.id) as Parameters<typeof feedItem>[0] | undefined;
    if (!row) return; // withdrawn already
    const got = new Set((db.prepare('SELECT device_id FROM feed WHERE event_id = ?').all(latest.id) as { device_id: string }[]).map((r) => r.device_id));
    sendToConnected(JSON.stringify({ kind: 'event', item: feedItem(row) }), (deviceId) => got.has(deviceId));
    console.log(`[notice] ${latest.id} sent live to the open apps of ${got.size} devices: ${row.title}`);
  };
  return setInterval(check, ms);
}
