// The lock screen scoreboard ("the board"): one iOS Live Activity per device listing its live games, favorites first, then
// most hated, then the teams it only tracks (docs/live-activity.md). The app starts the activity (it asks `GET /me/live-activity`
// for the first board) and registers its push token here; from then on this module builds each device's board whenever a
// game changes and pushes it to Apple directly (apns.ts). Nothing is sent until APNS_* is set and the `liveActivity` flag is on.
//
// The board lists a device's live games, the ones about to start (SOON_MS) and finals for 10 minutes; the device can also add a
// game of any team to it, or take one off, by hand (`picks`, from the card's lock screen button).
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
export type BoardGame = {
  k: string; a: string; as: number | null; h: string; hs: number | null; st: string; live: boolean; t: 0 | 1 | 2; l: string; r: string; lc: string; rc: string;
  /** Each team's own look (builds after 19): the color of the away and home team (gold a favorite, red a most hated, white the rest)
   *  and the mark before its code ('♥ ', '❌ ' or ''). An older build ignores them and draws `l` in `lc`. */
  ac?: string; hc?: string; am?: string; hm?: string;
  /** The detailed layout (`lay` 1): the second line (count and pitcher, down and distance, shots, the latest play) and its color,
   *  baseball's runners on first, second and third as "101", and the chance the row's own team wins, as a percent and as a label ("TB 62%").
   *  The hero layout (`lay` 3) gives its first row `sub` (the count and outs, the down, the shots: the middle of the big game) and `bs` too. */
  sub?: string; sc?: string; bs?: string; wp?: number; wl?: string;
};
/** v: the props' version. Only ever add fields (an installed widget draws the ones it knows); mt: the "+N more" line, '' for none;
 *  lay: 0 the compact layout (one line a game), 1 the detailed one (two lines, a base diamond, a win chance bar), 2 the grid (two
 *  cells across, a short status each), 3 the hero (the top game big, the rest as lines); builds after 18. */
export type BoardProps = { v: 1; lay: 0 | 1 | 2 | 3; games: BoardGame[]; more: number; mt: string };
export type BoardLayout = 'compact' | 'detailed' | 'grid' | 'hero';
/** `lay` is the index. */
const LAYOUTS: BoardLayout[] = ['compact', 'detailed', 'grid', 'hero'];

/** The lock screen has room for about four one-line games, three two-line ones, four grid cells or a hero and two lines; the rest are counted. */
const MAX_GAMES = [4, 3, 4, 3];
/** A final stays on the board this long after it ends. */
const FINAL_KEEP_MS = 10 * 60_000;
/** A game not yet started is on the board from this long before its start (and for DELAYED_MS after it, while ESPN still has it as not started). */
const SOON_MS = 60 * 60_000;
const DELAYED_MS = 3 * 3600_000;
const MAX_PICKS = 100;
const MARKS = ['♥ ', '❌ ', ''];
const GOLD = '#F5C451', WHITE = '#FFFFFF', RED = '#E5232B', GREY = '#9A9AA2';
/** By tier: a favorite gold, a most hated red, the rest white. */
const TIER_COLORS = [GOLD, RED, WHITE];
const DEBOUNCE_MS = 1000;
const SWEEP_MS = 30_000;
/** A clock or inning change alone is sent at most this often per device: ESPN's status carries the clock, so it changes every few seconds. */
const QUIET_GAP_MS = 30_000;

type Row = { activity_token: string | null; sandbox: number; most_hated: string; layout: number; picks: string };
const rowOf = (deviceId: string) => db.prepare('SELECT activity_token, sandbox, most_hated, layout, picks FROM live_activities WHERE device_id = ?').get(deviceId) as Row | undefined;
const mostHatedOf = (r?: Row): string[] => { try { return JSON.parse(r?.most_hated ?? '[]'); } catch { return []; } };
/** The games the device added (`on`) and removed (`off`) by hand. */
const picksOf = (r?: Row): { on: string[]; off: string[] } => { try { const p = JSON.parse(r?.picks ?? '{}'); return { on: p.on ?? [], off: p.off ?? [] }; } catch { return { on: [], off: [] }; } };
const keyList = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && k.length <= 64).slice(0, max) : undefined);

const outs = (n: number) => `${n} out${n === 1 ? '' : 's'}`;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** The right-hand text of a live row: ESPN's status plus what ESPN gives for the situation (baseball outs and count, football down and distance). */
export function statusLine(g: GameCard, withCount = true): string {
  const parts = [g.detail];
  if (g.bases) parts.push(outs(g.bases.outs));
  if (g.count && withCount) parts.push(`${g.count.balls}-${g.count.strikes}`);
  const dd = g.downDistance?.split(' at ')[0];
  if (dd) parts.push(dd);
  return parts.join(' · ');
}

/** The detailed layout's second line, by what ESPN gives for the sport: baseball's count, outs and pitcher, football's ball and down,
 *  hockey's shots, otherwise the latest play. */
export function subLine(g: GameCard): string {
  if (g.bases) return [g.count && `${g.count.balls}-${g.count.strikes}`, outs(g.bases.outs), g.pitcher && `P: ${g.pitcher.name}`].filter(Boolean).join(' · ');
  if (g.downDistance) {
    const ball = g.possession && [g.away, g.home].find((s) => s?.team.key === g.possession)?.team.abbrev;
    return [ball && `${ball} ball`, g.downDistance, g.redZone && 'Red zone'].filter(Boolean).join(' · ');
  }
  if (g.shots) return `Shots ${g.shots.away}-${g.shots.home}`;
  return g.lastPlay ? clip(g.lastPlay, 40) : '';
}

/** The middle of the hero layout's big game, under its clock: baseball's count and outs, football's down and distance, hockey's shots. */
export function heroLine(g: GameCard): string {
  if (g.bases) return [g.count && `${g.count.balls}-${g.count.strikes}`, outs(g.bases.outs)].filter(Boolean).join(' · ');
  if (g.downDistance) return g.downDistance.split(' at ')[0];
  return g.shots ? `Shots ${g.shots.away}-${g.shots.home}` : '';
}

/** The device's board now, or null when no game of its teams is live, about to start or just ended (and none was added by hand). */
export function buildBoard(deviceId: string, now = Date.now()): BoardProps | null {
  const favs = new Set(favoritesOf(deviceId).map((f) => f.team_key));
  const tracked = deviceTeams(deviceId).teams;
  // A starred player stands for his team.
  const row = rowOf(deviceId);
  const hated = new Set(mostHatedOf(row).flatMap((k) => (k.startsWith('team:') ? [k] : [catalog.player(k)?.teamKey ?? ''])));
  const lay = (row?.layout ?? 0) as BoardProps['lay'];
  const picks = { on: new Set(picksOf(row).on), off: new Set(picksOf(row).off) };
  const gridCell = lay === 2, heroRow = (i: number) => lay === 3 && i === 0;
  const rows: (BoardGame & { startsAt: number; card: GameCard })[] = [];
  for (const g of cardList()) {
    if (!g.home || !g.away || !(GAME_LEAGUES as League[]).includes(g.league)) continue;
    const live = g.state === 'in';
    const soon = g.state === 'pre' && now - g.startsAt < DELAYED_MS && (g.startsAt - now < SOON_MS || picks.on.has(g.key)); // a game picked by hand comes early
    if (!live && !soon && !(g.state === 'post' && g.endedAt && now - g.endedAt < FINAL_KEEP_MS)) continue;
    if (picks.off.has(g.key)) continue; // taken off by hand, even a favorite's
    const keys = [g.home.team.key, g.away.team.key];
    const t = keys.some((k) => favs.has(k)) ? 0 : keys.some((k) => hated.has(k)) ? 1 : 2;
    if (t && !keys.some((k) => tracked.has(k)) && !picks.on.has(g.key)) continue; // only a favorite's game, or one added by hand, comes without tracking
    const tier = (team: string) => (hated.has(team) ? 1 : favs.has(team) ? 0 : 2); // a team both favorite and most hated is red, as everywhere in the app
    const ta = tier(g.away.team.key), th = tier(g.home.team.key);
    const a = g.away.team.abbrev, h = g.home.team.abbrev, st = live ? g.detail : soon ? (g.startsAt - now < SOON_MS ? 'Starts soon' : 'Upcoming') : 'Final';
    const score = (n: number | null) => (n === null ? '-' : String(n));
    const as = soon ? null : g.away.score, hs = soon ? null : g.home.score; // no score yet
    // The detailed layout's bar is the chance the team that put the game on the board wins.
    const own = [g.away, g.home].find((x) => (t === 0 ? favs : t === 1 ? hated : tracked).has(x!.team.key)) ?? g.away; // a game added by hand may have none
    const chance = live && g.winProb ? Math.round(100 * (own === g.home ? g.winProb.home : g.winProb.away)) : null;
    rows.push({
      k: g.key, a, as, h, hs, st, live, t,
      l: `${MARKS[t]}${a} ${score(as)}  ${h} ${score(hs)}`, r: live ? statusLine(g) : st, lc: TIER_COLORS[t], rc: live ? RED : GREY,
      ac: TIER_COLORS[ta], hc: TIER_COLORS[th], am: MARKS[ta], hm: MARKS[th],
      ...(lay === 1 && {
        r: st, sub: live ? subLine(g) : '', sc: GREY, bs: g.bases ? [g.bases.first, g.bases.second, g.bases.third].map(Number).join('') : '',
        ...(chance !== null && { wp: chance, wl: `${own.team.abbrev} ${chance}%` }),
      }),
      ...(gridCell && live && { r: statusLine(g, false) }), // a half-width cell has no room for the count
      startsAt: g.startsAt, card: g,
    });
  }
  if (!rows.length) return null;
  const rank = (g: GameCard) => (g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2); // live, then about to start, then final
  rows.sort((x, y) => x.t - y.t || rank(x.card) - rank(y.card) || x.startsAt - y.startsAt);
  const max = MAX_GAMES[lay];
  const more = Math.max(0, rows.length - max);
  const games = rows.slice(0, max).map(({ startsAt, card, ...r }, i) =>
    // The hero's first row: the plain clock, the count/outs/down/shots under it and the bases; the others stay compact rows.
    heroRow(i) ? { ...r, r: r.st, sub: r.live ? heroLine(card) : '', bs: card.bases ? [card.bases.first, card.bases.second, card.bases.third].map(Number).join('') : '' } : r);
  return { v: 1, lay, games, more, mt: more ? `+${more} more` : '' };
}

/** What the app sends: any of the fields (`pins`: game keys added to the board, `hides`: removed), the rest of the row stays as it was. Returns the board for the first draw. */
export function putLiveActivity(deviceId: string, body: { mostHated?: unknown; activityToken?: unknown; sandbox?: unknown; layout?: unknown; pins?: unknown; hides?: unknown }): BoardProps | null {
  const old = rowOf(deviceId);
  const hated = Array.isArray(body.mostHated)
    ? JSON.stringify(body.mostHated.filter((k): k is string => typeof k === 'string' && k.length <= 64).slice(0, 200))
    : old?.most_hated ?? '[]';
  const token = typeof body.activityToken === 'string' && body.activityToken.length <= 400 ? body.activityToken : old?.activity_token ?? null;
  const sandbox = typeof body.sandbox === 'boolean' ? +body.sandbox : old?.sandbox ?? 0;
  const named = LAYOUTS.indexOf(body.layout as BoardLayout);
  const layout = named >= 0 ? named : old?.layout ?? 0; // anything else leaves it as it was
  const was = picksOf(old), on = keyList(body.pins, MAX_PICKS), off = keyList(body.hides, MAX_PICKS);
  const picks = JSON.stringify({ on: on ?? was.on, off: off ?? was.off });
  db.prepare(`INSERT INTO live_activities (device_id, activity_token, sandbox, most_hated, layout, picks, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET activity_token = excluded.activity_token, sandbox = excluded.sandbox, most_hated = excluded.most_hated, layout = excluded.layout, picks = excluded.picks, updated_at = excluded.updated_at`)
    .run(deviceId, token, sandbox, hated, layout, picks, Date.now());
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
      : { timestamp: now, event: 'end', 'dismissal-date': now, 'content-state': { name: 'ScoreboardActivity', props: JSON.stringify({ v: 1, lay: 0, games: [], more: 0, mt: '' }) } };
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
