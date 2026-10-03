import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.HW_DB ?? 'data/hatewatch.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
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

-- id is a deterministic dedupe key (e.g. game:play:type:athlete) so re-polls never double-notify.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, league TEXT NOT NULL, game_id TEXT,
  target_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  occurred_at INTEGER NOT NULL, detected_at INTEGER NOT NULL, meta TEXT
);
CREATE TABLE IF NOT EXISTS feed (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id),
  occurred_at INTEGER NOT NULL, pushed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, event_id)
);
CREATE INDEX IF NOT EXISTS feed_order ON feed(device_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

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
