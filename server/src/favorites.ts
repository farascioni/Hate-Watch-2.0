/**
 * Hate Watch Plus favorites: a team the device roots for. A favorite is not tracked. While the team is in a game, the
 * alerts about its opponent in that game (the team's own alerts, not the opponent's players') go to the device's feed
 * and push, with the favorite's own alert choices and push switch; once the game is over nothing more about that
 * opponent reaches it. Rooting for the Rays, a Guardians loss tonight reaches the device, a Guardians injury doesn't.
 *
 * Why a registry of games: fanout.publish() knows an alert's team and game id, not who the team played. The game
 * tracker registers each game's two sides when it starts (`registerGame`), and fanout asks `opponentOf` for the side
 * a device favorites. Matching on the game id is what ends it: another game of the opponent's matches nobody, and the
 * loss alert, published as the game finishes, still matches. Entries are dropped after 36 hours.
 *
 * Plus is checked on the device only (expo-iap); the server stores whatever a device sends (docs/known-limits.md).
 * Imports only db.ts so fanout, live and api can all use it.
 */
import { db } from './db.ts';

export type FavoriteRow = { team_key: string; created_at: number; push: boolean; types: Record<string, boolean>; push_types: Record<string, boolean> };

const parse = (s: string): Record<string, boolean> => { try { return JSON.parse(s) ?? {}; } catch { return {}; } };
const row = (r: { team_key: string; created_at: number; push: number; types: string; push_types: string }): FavoriteRow =>
  ({ team_key: r.team_key, created_at: r.created_at, push: !!r.push, types: parse(r.types), push_types: parse(r.push_types) });

export const favoritesOf = (deviceId: string): FavoriteRow[] =>
  (db.prepare('SELECT team_key, created_at, push, types, push_types FROM favorites WHERE device_id = ? ORDER BY created_at').all(deviceId) as any[]).map(row);

export const favoriteOf = (deviceId: string, teamKey: string): FavoriteRow | undefined => {
  const r = db.prepare('SELECT team_key, created_at, push, types, push_types FROM favorites WHERE device_id = ? AND team_key = ?').get(deviceId, teamKey) as any;
  return r && row(r);
};

export function addFavorite(deviceId: string, teamKey: string) {
  db.prepare('INSERT INTO favorites (device_id, team_key, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(deviceId, teamKey, Date.now());
  invalidateFavorites();
}
export function removeFavorite(deviceId: string, teamKey?: string) {
  if (teamKey) db.prepare('DELETE FROM favorites WHERE device_id = ? AND team_key = ?').run(deviceId, teamKey);
  else db.prepare('DELETE FROM favorites WHERE device_id = ?').run(deviceId);
  invalidateFavorites();
}

/** A favorite's own choices: push on/off, and per alert type on/off (true/false sets one, null removes it: back to the global setting). */
export function updateFavorite(deviceId: string, teamKey: string, patch: { push?: boolean; types?: Record<string, boolean | null>; pushTypes?: Record<string, boolean | null> }) {
  const cur = favoriteOf(deviceId, teamKey);
  if (!cur) return undefined;
  const merge = (base: Record<string, boolean>, p?: Record<string, boolean | null>) => {
    const out = { ...base };
    for (const [k, v] of Object.entries(p ?? {})) { if (v === null) delete out[k]; else if (typeof v === 'boolean') out[k] = v; }
    return out;
  };
  db.prepare('UPDATE favorites SET push = ?, types = ?, push_types = ? WHERE device_id = ? AND team_key = ?').run(
    patch.push === undefined ? +cur.push : +patch.push, JSON.stringify(merge(cur.types, patch.types)), JSON.stringify(merge(cur.push_types, patch.pushTypes)), deviceId, teamKey);
  return favoriteOf(deviceId, teamKey);
}

/** Devices that favorite a team, with their push tokens and choices. */
export const favoriters = (teamKey: string) =>
  (db.prepare(`SELECT fv.device_id, d.push_token, fv.team_key, fv.created_at, fv.push, fv.types, fv.push_types FROM favorites fv
    JOIN devices d ON d.id = fv.device_id WHERE fv.team_key = ?`).all(teamKey) as any[]).map((r) => ({ device_id: r.device_id as string, push_token: r.push_token as string | null, fav: row(r) }));

// The teams anyone favorites, so the live scan attaches a tracker to their games (live.ts). Not in watchedTeamKeys():
// that one also feeds the Scores tab and "up next", which a favorite doesn't change.
let cache = { at: 0, teams: new Set<string>() };
export function favoriteTeamKeys(): Set<string> {
  if (Date.now() - cache.at < 3000) return cache.teams;
  cache = { at: Date.now(), teams: new Set((db.prepare('SELECT DISTINCT team_key FROM favorites').all() as { team_key: string }[]).map((r) => r.team_key)) };
  return cache.teams;
}
export function invalidateFavorites() { cache.at = 0; }

// ─── Which two teams played game X ────────────────────────────────────────────────────────────
const KEEP_MS = 36 * 3600_000;
const games = new Map<string, { teams: [string, string]; at: number }>();
export function registerGame(league: string, gameId: string, homeKey: string, awayKey: string) {
  const now = Date.now();
  for (const [k, g] of games) if (now - g.at > KEEP_MS) games.delete(k);
  games.set(`${league}:${gameId}`, { teams: [homeKey, awayKey], at: now });
}
/** The other side of a game, or undefined if the team wasn't in it (or the game isn't known). */
export function opponentOf(league: string, gameId: string, teamKey: string): string | undefined {
  const g = games.get(`${league}:${gameId}`);
  return g?.teams[0] === teamKey ? g.teams[1] : g?.teams[1] === teamKey ? g.teams[0] : undefined;
}
