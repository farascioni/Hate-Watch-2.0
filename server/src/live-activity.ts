// The lock screen scoreboard ("the board"): one iOS Live Activity per device listing its live games, favorites first, then
// most hated, then the teams it only tracks (docs/live-activity.md). The app starts the activity (it asks `GET /me/live-activity`
// for the first board) and registers its push token here; from then on this module builds each device's board whenever a
// game changes and pushes it to Apple directly (apns.ts). Nothing is sent until APNS_* is set and the `liveActivity` flag is on.
//
// Most hated lives only on the device otherwise; the app uploads its keys (`PUT /me/live-activity`) so the board can sort by
// them. Plus is checked on the device only, so a lapse clears them here too (`DELETE /me/live-activity`).
// Imports scores.ts for the games (which notifies `onGameChange`) and favorites.ts for the teams; neither imports this.
import { db } from './db.ts';
import { sendApns, apnsConfigured, tokenGone } from './apns.ts';
import { cardList, deviceTeams, onGameChange, type GameCard } from './scores.ts';
import { favoritesOf } from './favorites.ts';
import { catalog } from './catalog.ts';
import { flagOn } from './flags.ts';
import { GAME_LEAGUES, type League } from './leagues.ts';

/** One line on the board. t: 0 favorite's game, 1 most hated, 2 tracked only. l/r/lc/rc: the line already written and colored
 *  (left text, right text, their colors), so wording and colors change with a deploy; the widget in the installed build draws
 *  these and falls back to the raw fields if they're missing. */
export type BoardGame = { k: string; a: string; as: number | null; h: string; hs: number | null; st: string; live: boolean; t: 0 | 1 | 2; l: string; r: string; lc: string; rc: string };
/** v: the props' version. Only ever add fields (an installed widget draws the ones it knows); mt: the "+N more" line, '' for none. */
export type BoardProps = { v: 1; games: BoardGame[]; more: number; mt: string };

/** The lock screen has room for about four lines; the rest are counted. */
const MAX_GAMES = 4;
/** A final stays on the board this long after it ends. */
const FINAL_KEEP_MS = 10 * 60_000;
const MARKS = ['♥ ', '★ ', ''];
const GOLD = '#F5C451', WHITE = '#FFFFFF', RED = '#E5232B', GREY = '#9A9AA2';
const DEBOUNCE_MS = 1000;
const SWEEP_MS = 30_000;
/** A clock or inning change alone is sent at most this often per device: ESPN's status carries the clock, so it changes every few seconds. */
const QUIET_GAP_MS = 30_000;

type Row = { activity_token: string | null; sandbox: number; most_hated: string };
const rowOf = (deviceId: string) => db.prepare('SELECT activity_token, sandbox, most_hated FROM live_activities WHERE device_id = ?').get(deviceId) as Row | undefined;
const mostHatedOf = (r?: Row): string[] => { try { return JSON.parse(r?.most_hated ?? '[]'); } catch { return []; } };

/** The right-hand text of a live row: ESPN's status plus what ESPN gives for the situation (baseball outs and count, football down and distance). */
export function statusLine(g: GameCard): string {
  const parts = [g.detail];
  if (g.bases) parts.push(`${g.bases.outs} out`);
  if (g.count) parts.push(`${g.count.balls}-${g.count.strikes}`);
  const dd = g.downDistance?.split(' at ')[0];
  if (dd) parts.push(dd);
  return parts.join(' · ');
}

/** The device's board now, or null when no game of its teams is live (or just ended). */
export function buildBoard(deviceId: string, now = Date.now()): BoardProps | null {
  const favs = new Set(favoritesOf(deviceId).map((f) => f.team_key));
  const tracked = deviceTeams(deviceId).teams;
  // A starred player stands for his team.
  const hated = new Set(mostHatedOf(rowOf(deviceId)).flatMap((k) => (k.startsWith('team:') ? [k] : [catalog.player(k)?.teamKey ?? ''])));
  const rows: (BoardGame & { startsAt: number })[] = [];
  for (const g of cardList()) {
    if (!g.home || !g.away || !(GAME_LEAGUES as League[]).includes(g.league)) continue;
    const live = g.state === 'in';
    if (!live && !(g.state === 'post' && g.endedAt && now - g.endedAt < FINAL_KEEP_MS)) continue;
    const keys = [g.home.team.key, g.away.team.key];
    const t = keys.some((k) => favs.has(k)) ? 0 : keys.some((k) => hated.has(k)) ? 1 : 2;
    if (t && !keys.some((k) => tracked.has(k))) continue; // only a favorite's game comes without tracking
    const a = g.away.team.abbrev, h = g.home.team.abbrev, st = live ? g.detail : 'Final';
    const score = (n: number | null) => (n === null ? '-' : String(n));
    rows.push({
      k: g.key, a, as: g.away.score, h, hs: g.home.score, st, live, t,
      l: `${MARKS[t]}${a} ${score(g.away.score)}  ${h} ${score(g.home.score)}`, r: live ? statusLine(g) : st, lc: t === 2 ? WHITE : GOLD, rc: live ? RED : GREY,
      startsAt: g.startsAt,
    });
  }
  if (!rows.length) return null;
  rows.sort((x, y) => x.t - y.t || +y.live - +x.live || x.startsAt - y.startsAt);
  const more = Math.max(0, rows.length - MAX_GAMES);
  return { v: 1, games: rows.slice(0, MAX_GAMES).map(({ startsAt, ...r }) => r), more, mt: more ? `+${more} more` : '' };
}

/** What the app sends: any of the three fields, the rest of the row stays as it was. Returns the board for the first draw. */
export function putLiveActivity(deviceId: string, body: { mostHated?: unknown; activityToken?: unknown; sandbox?: unknown }): BoardProps | null {
  const old = rowOf(deviceId);
  const hated = Array.isArray(body.mostHated)
    ? JSON.stringify(body.mostHated.filter((k): k is string => typeof k === 'string' && k.length <= 64).slice(0, 200))
    : old?.most_hated ?? '[]';
  const token = typeof body.activityToken === 'string' && body.activityToken.length <= 400 ? body.activityToken : old?.activity_token ?? null;
  const sandbox = typeof body.sandbox === 'boolean' ? +body.sandbox : old?.sandbox ?? 0;
  db.prepare(`INSERT INTO live_activities (device_id, activity_token, sandbox, most_hated, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET activity_token = excluded.activity_token, sandbox = excluded.sandbox, most_hated = excluded.most_hated, updated_at = excluded.updated_at`)
    .run(deviceId, token, sandbox, hated, Date.now());
  last.delete(deviceId); // whatever is on the lock screen may be stale: send the next board whole
  schedule();
  return flagOn('liveActivity') ? buildBoard(deviceId) : null;
}

export const getLiveActivity = (deviceId: string) => (flagOn('liveActivity') ? buildBoard(deviceId) : null);
export const deleteLiveActivity = (deviceId: string) => { db.prepare('DELETE FROM live_activities WHERE device_id = ?').run(deviceId); last.delete(deviceId); };

// ─── Pushing ──────────────────────────────────────────────────────────────────────────────────
/** The board each device last got (as JSON), so an unchanged board is never sent again. */
const last = new Map<string, string>();
const lastSentAt = new Map<string, number>();
const scoreSig = (b: BoardProps | null) => (b ? b.games.map((g) => `${g.k}:${g.as}-${g.hs}:${g.live}`).join('|') : '');

const clearToken = (deviceId: string) => { db.prepare('UPDATE live_activities SET activity_token = NULL WHERE device_id = ?').run(deviceId); last.delete(deviceId); };

/** Send every device's board that changed. Exported for tests. */
export async function flush(nowMs = Date.now()) {
  if (!apnsConfigured() || !flagOn('liveActivity')) return;
  const devices = db.prepare('SELECT device_id FROM live_activities WHERE activity_token IS NOT NULL').all() as { device_id: string }[];
  for (const { device_id } of devices) {
    const r = rowOf(device_id)!;
    const board = buildBoard(device_id);
    const json = JSON.stringify(board);
    if (last.get(device_id) === json) continue;
    const now = Math.floor(nowMs / 1000);
    const aps = board
      ? { timestamp: now, event: 'update', 'content-state': { name: 'ScoreboardActivity', props: JSON.stringify(board) } }
      : { timestamp: now, event: 'end', 'dismissal-date': now, 'content-state': { name: 'ScoreboardActivity', props: JSON.stringify({ v: 1, games: [], more: 0, mt: '' }) } };
    // A score or a final is worth waking the screen for; a clock or inning change is not.
    const prev = last.get(device_id);
    const urgent = !prev || scoreSig(JSON.parse(prev)) !== scoreSig(board);
    if (!urgent && nowMs - (lastSentAt.get(device_id) ?? 0) < QUIET_GAP_MS) continue; // the sweep sends it
    const res = await sendApns(r.activity_token!, !!r.sandbox, { aps }, urgent ? 10 : 5);
    if (tokenGone(res) || (res.status === 200 && !board)) { clearToken(device_id); continue; }
    if (res.status === 200) { last.set(device_id, json); lastSentAt.set(device_id, nowMs); }
    else console.warn(`live activity ${device_id}: APNs ${res.status} ${res.reason ?? ''}`);
  }
}

let running = false, again = false, timer: NodeJS.Timeout | undefined;
async function run() {
  if (running) { again = true; return; }
  running = true;
  try { do { again = false; await flush(); } while (again); } catch (e) { console.warn('live activity flush', e); } finally { running = false; }
}
function schedule() { clearTimeout(timer); timer = setTimeout(run, DEBOUNCE_MS); timer.unref(); }

let started = false;
export function startLiveActivities() {
  if (started) return;
  started = true;
  onGameChange((_g: GameCard) => schedule());
  setInterval(run, SWEEP_MS).unref(); // a final leaving the board changes nothing the games announce
}
