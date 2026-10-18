import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.HW_DB ?? 'data/hatewatch.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
-- Litestream (docs/redundancy.md) takes the write lock for a moment at each checkpoint; without a wait, a write landing then
-- throws "database is locked" at once (node:sqlite's default is 0). Its docs recommend 5 seconds.
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
  key TEXT PRIMARY KEY, league TEXT NOT NULL, espn_id TEXT NOT NULL,
  name TEXT NOT NULL, short_name TEXT NOT NULL, abbrev TEXT NOT NULL, location TEXT,
  color TEXT, alt_color TEXT,
  logo TEXT NOT NULL, logo_dark TEXT, logo_w INTEGER NOT NULL, logo_h INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  key TEXT PRIMARY KEY, league TEXT NOT NULL, espn_id TEXT NOT NULL,
  name TEXT NOT NULL, short_name TEXT, position TEXT, jersey TEXT,
  team_key TEXT NOT NULL REFERENCES teams(key),
  image TEXT NOT NULL, image_w INTEGER NOT NULL, image_h INTEGER NOT NULL,
  image_kind TEXT NOT NULL CHECK (image_kind IN ('headshot','team_logo')),
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS players_team ON players(team_key);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, secret TEXT NOT NULL, platform TEXT,
  push_token TEXT, prefs TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS follows (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  target_key TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, target_key)
);
CREATE INDEX IF NOT EXISTS follows_target ON follows(target_key);

-- Hate Watch Plus favorites: a team the device roots for. Not tracked: the alerts about whoever plays it in a game
-- go to the device for that game only (favorites.ts). types / push_types are that team's own choices (typeId → on/off).
CREATE TABLE IF NOT EXISTS favorites (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  team_key TEXT NOT NULL, created_at INTEGER NOT NULL,
  push INTEGER NOT NULL DEFAULT 1, types TEXT NOT NULL DEFAULT '{}', push_types TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (device_id, team_key)
);
CREATE INDEX IF NOT EXISTS favorites_team ON favorites(team_key);

-- id is a deterministic dedupe key (e.g. game:play:type:athlete) so re-polls never double-notify.
-- share_code is the short public code in the alert's share link (/a/<code>), see shareCode().
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, league TEXT NOT NULL, game_id TEXT,
  target_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  occurred_at INTEGER NOT NULL, detected_at INTEGER NOT NULL, meta TEXT, share_code TEXT
);
CREATE TABLE IF NOT EXISTS feed (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id),
  occurred_at INTEGER NOT NULL, pushed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, event_id)
);
CREATE INDEX IF NOT EXISTS feed_order ON feed(device_id, occurred_at DESC);
-- How many devices got an alert (a Successful Hate Watch says how many others got it too).
CREATE INDEX IF NOT EXISTS feed_event ON feed(event_id);

-- Successful Hate Watches (hate-watches.ts): kept apart from the feed so clearing it doesn't reset the count.
CREATE TABLE IF NOT EXISTS hate_watches (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL, target_key TEXT NOT NULL, occurred_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, event_id)
);

-- Lock screen scoreboard (live-activity.ts): the push token of the device's running Live Activity, and the keys it starred
-- as most hated (kept on the device otherwise) so the board can sort by them. sandbox: a development build's token.
CREATE TABLE IF NOT EXISTS live_activities (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  activity_token TEXT, sandbox INTEGER NOT NULL DEFAULT 0,
  most_hated TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

/** Short, unguessable-enough public code for an alert's share link, derived from its id (stable across restarts). */
export const shareCode = (eventId: string) => createHash('sha256').update(eventId).digest('base64url').slice(0, 11);

// Share links came after launch: older databases get the column, and their alerts get codes.
if (!(db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).some((c) => c.name === 'share_code')) {
  db.exec('ALTER TABLE events ADD COLUMN share_code TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS events_share ON events(share_code)');
// Every position a player has played this season ("P,DH,SP"), for which alerts fit them: added later.
if (!(db.prepare('PRAGMA table_info(players)').all() as { name: string }[]).some((c) => c.name === 'positions')) {
  db.exec('ALTER TABLE players ADD COLUMN positions TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS events_game ON events(game_id)'); // a loss's alerts, together (RECIPIENTS)
// ESPN's clip of an alert's play (clips.ts), as JSON, once it's out.
if (!(db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).some((c) => c.name === 'clip')) {
  db.exec('ALTER TABLE events ADD COLUMN clip TEXT');
}
// One device's lines on a feed alert: other facts of its moment folded into it (Detected.fold), as JSON.
if (!(db.prepare('PRAGMA table_info(feed)').all() as { name: string }[]).some((c) => c.name === 'extra')) {
  db.exec('ALTER TABLE feed ADD COLUMN extra TEXT');
}
// 1 on a favorite's row (favorites.ts): the device roots against this team's opponent, so it isn't a Successful Hate Watch and isn't counted in "N others got it" (RECIPIENTS).
if (!(db.prepare('PRAGMA table_info(feed)').all() as { name: string }[]).some((c) => c.name === 'fav')) {
  db.exec('ALTER TABLE feed ADD COLUMN fav INTEGER NOT NULL DEFAULT 0');
}
// The device's lock screen scoreboard layout (live-activity.ts LAYOUTS): 0 compact, 1 detailed, 2 grid, 3 hero.
if (!(db.prepare('PRAGMA table_info(live_activities)').all() as { name: string }[]).some((c) => c.name === 'layout')) {
  db.exec('ALTER TABLE live_activities ADD COLUMN layout INTEGER NOT NULL DEFAULT 0');
}
// Games the device added to or removed from its board by hand (live-activity.ts), as JSON {"on": [game keys], "off": [game keys]}.
if (!(db.prepare('PRAGMA table_info(live_activities)').all() as { name: string }[]).some((c) => c.name === 'picks')) {
  db.exec(`ALTER TABLE live_activities ADD COLUMN picks TEXT NOT NULL DEFAULT '{}'`);
}
{
  const missing = db.prepare('SELECT id FROM events WHERE share_code IS NULL').all() as { id: string }[];
  const set = db.prepare('UPDATE events SET share_code = ? WHERE id = ?');
  if (missing.length) tx(() => { for (const { id } of missing) set.run(shareCode(id), id); });
}

export function kvGet<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function kvSet(key: string, value: unknown) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
