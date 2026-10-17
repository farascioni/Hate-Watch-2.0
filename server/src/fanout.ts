import type { WebSocket } from 'ws';
import { db, kvGet, kvSet, shareCode, tx } from './db.ts';
import { EVENT_TYPES, EVENT_TYPE_BY_ID, soccerType } from './event-types.ts';
import { catalog, targetDto } from './catalog.ts';
import type { Detected } from './detectors.ts';
import { LOSS_ABOUT, RECIPIENTS, hateWatchOf, hateWatchTally, isHateWatch, isLossAlert, recordHateWatch, watchedOfLast } from './hate-watches.ts';
import { SOCCER, type League } from './leagues.ts';
import { recordMisery, reviseMisery } from './misery.ts';
import { clipShown } from './clips.ts';
import { frameWithoutImages } from './images.ts';
import { shareStyles } from './share-styles.ts';
import { favoriters, opponentOf, type FavoriteRow } from './favorites.ts';

// ─── Preferences ──────────────────────────────────────────────────────────────────────────────
export interface Prefs {
  pushEnabled: boolean;
  sound: boolean;
  leagues: Partial<Record<League, boolean>>;
  types: Record<string, boolean>;          // overrides of each type's defaultOn
  muted: string[];                         // followed targets with push off: alerts still go to the feed
  quietHours: { enabled: boolean; start: string; end: string; tz: string };
  /**
   * Per-player/per-team alert choices (the ⚙️ on the Tracking tab): targetKey → typeId → on/off.
   * An entry here beats every global alert setting (type and league switches) for that target.
   */
  targetTypes: Record<string, Record<string, boolean>>;
  /** An alert type's 🔔 in Settings: typeId → false sends it to the feed without a push. Missing = push. */
  pushTypes: Record<string, boolean>;
  /** The 🔔 on one alert type for one player or team (their ⚙️ screen): targetKey → typeId → push. Beats pushTypes. */
  targetPushTypes: Record<string, Record<string, boolean>>;
  /**
   * A tracked player's team (their ⚙️ screen): playerKey → `scores` false keeps the team's games off the
   * Scores tab (shown by default), `alerts` true sends the team's own alerts too, as if the team were tracked
   * (off by default; it follows the Team alerts settings). Tracking the team itself gets both anyway.
   */
  playerTeams: Record<string, { scores?: boolean; alerts?: boolean }>;
}

/** A PUT /me/prefs patch: like Prefs, but a per-target value of null means "back to the global setting". */
export type PrefsPatch = Partial<Omit<Prefs, 'targetTypes' | 'targetPushTypes' | 'playerTeams'>> & {
  targetTypes?: Record<string, Record<string, boolean | null>>;
  targetPushTypes?: Record<string, Record<string, boolean | null>>;
  playerTeams?: Record<string, { scores?: boolean | null; alerts?: boolean | null }>;
};

export const DEFAULT_PREFS: Prefs = {
  pushEnabled: true,
  sound: true,
  leagues: {},
  types: {},
  muted: [],
  quietHours: { enabled: false, start: '23:00', end: '08:00', tz: 'America/New_York' },
  targetTypes: {},
  pushTypes: {},
  targetPushTypes: {},
  playerTeams: {},
};

const prefsCache = new Map<string, Prefs>();

export function getPrefs(deviceId: string): Prefs {
  let p = prefsCache.get(deviceId);
  if (!p) {
    const row = db.prepare('SELECT prefs FROM devices WHERE id = ?').get(deviceId) as { prefs: string } | undefined;
    const stored = row ? JSON.parse(row.prefs) : {};
    p = { ...DEFAULT_PREFS, ...stored, quietHours: { ...DEFAULT_PREFS.quietHours, ...stored.quietHours } } as Prefs;
    prefsCache.set(deviceId, p);
  }
  return p;
}

export function setPrefs(deviceId: string, patch: PrefsPatch): Prefs {
  const cur = getPrefs(deviceId);
  const next: Prefs = {
    ...cur, ...patch,
    leagues: { ...cur.leagues, ...patch.leagues },
    types: { ...cur.types, ...patch.types },
    quietHours: { ...cur.quietHours, ...patch.quietHours },
    muted: patch.muted ?? cur.muted,
    targetTypes: mergeTargetTypes(cur.targetTypes, patch.targetTypes),
    pushTypes: { ...cur.pushTypes, ...patch.pushTypes },
    targetPushTypes: mergeTargetTypes(cur.targetPushTypes, patch.targetPushTypes),
    playerTeams: mergePlayerTeams(cur.playerTeams, patch.playerTeams),
  };
  db.prepare('UPDATE devices SET prefs = ? WHERE id = ?').run(JSON.stringify(next), deviceId);
  prefsCache.set(deviceId, next);
  return next;
}

const TARGET_KEY = /^(player|team):[a-z0-9]+:[\w-]+$/;

/** Merge per-target overrides: true/false sets one, null removes it (back to global). Unknown keys/types are ignored. */
export function mergeTargetTypes(cur: Prefs['targetTypes'] = {}, patch?: PrefsPatch['targetTypes']): Prefs['targetTypes'] {
  if (!patch) return cur;
  const out: Prefs['targetTypes'] = { ...cur };
  for (const [target, types] of Object.entries(patch)) {
    if (!TARGET_KEY.test(target) || !types || typeof types !== 'object') continue;
    const merged = { ...out[target] };
    for (const [typeId, v] of Object.entries(types)) {
      if (!EVENT_TYPE_BY_ID.has(typeId)) continue;
      if (v === null) delete merged[typeId];
      else if (typeof v === 'boolean') merged[typeId] = v;
    }
    if (Object.keys(merged).length) out[target] = merged; else delete out[target];
  }
  return out;
}

/** Merge a tracked player's team choices: true/false sets one, null removes it (back to the default). Only players' keys, only those two. */
export function mergePlayerTeams(cur: Prefs['playerTeams'] = {}, patch?: PrefsPatch['playerTeams']): Prefs['playerTeams'] {
  if (!patch) return cur;
  const out: Prefs['playerTeams'] = { ...cur };
  for (const [player, v] of Object.entries(patch)) {
    if (!/^player:[a-z0-9]+:[\w-]+$/.test(player) || !v || typeof v !== 'object') continue;
    const merged = { ...out[player] };
    for (const k of ['scores', 'alerts'] as const) {
      if (v[k] === null) delete merged[k];
      else if (typeof v[k] === 'boolean') merged[k] = v[k] as boolean;
    }
    if (Object.keys(merged).length) out[player] = merged; else delete out[player];
  }
  return out;
}

/** The global (Settings tab) answer for one alert type. */
export function typeEnabled(p: Prefs, typeId: string) {
  return p.types[typeId] ?? EVENT_TYPE_BY_ID.get(typeId)?.defaultOn ?? false;
}

/**
 * Is this alert type on for this specific target? A per-target choice always wins; otherwise the
 * global settings decide (the league switch, then the type switch).
 */
export function typeEnabledFor(p: Prefs, targetKey: string, typeId: string, league: League) {
  const own = p.targetTypes?.[targetKey]?.[typeId];
  if (own !== undefined) return own;
  return p.leagues[league] !== false && typeEnabled(p, typeId);
}

/** Does this user want this alert at all (feed + live)? Muting a target does NOT affect this. */
export function wants(p: Prefs, e: Pick<Detected, 'type' | 'aliases' | 'targetKey'>, league: League) {
  return [e.type, ...(e.aliases ?? [])].some((t) => typeEnabledFor(p, e.targetKey, t, league));
}

/** Should an alert they want also be pushed? Muted targets (🔕 on the Tracking tab) are feed-only. */
export function pushAllowed(p: Prefs, targetKey: string, now = new Date()) {
  return p.pushEnabled && !p.muted.includes(targetKey) && !inQuietHours(p, now);
}

/**
 * Push or feed-only for one alert type and target: that target's own 🔔 wins, then the Settings 🔔, then
 * the type's default (`defaultPush`: the in-game drip is feed-only until its 🔔 is tapped), then push.
 */
export function pushTypeFor(p: Prefs, targetKey: string, typeId: string) {
  return p.targetPushTypes?.[targetKey]?.[typeId] ?? p.pushTypes?.[typeId] ?? EVENT_TYPE_BY_ID.get(typeId)?.defaultPush ?? true;
}

const FEED_ONLY_BY_DEFAULT = Object.fromEntries(EVENT_TYPES.filter((t) => t.defaultPush === false).map((t) => [t.id, false]));

/**
 * Prefs as the app sees them (GET and PUT /me/prefs): the 🔔 of every feed-only-by-default alert filled
 * in, so app builds that read a missing bell as "push" show it right.
 */
export const prefsDto = (p: Prefs): Prefs => ({ ...p, pushTypes: { ...FEED_ONLY_BY_DEFAULT, ...p.pushTypes } });

/**
 * October 2026: new installs got quieter defaults, with these alerts off or feed-only. Installs from
 * before keep what they had: once, each existing device's settings get the old defaults written out
 * wherever it hadn't chosen. A later default change needs its own list and kv key.
 */
export const WERE_ON = ['mlb.team.opponent_risp', 'nba.missed_shot', 'wnba.missed_shot', ...[...SOCCER].map((lg) => soccerType(lg, 'lost_ball'))];
export const WERE_PUSHED = [
  'mlb.pitcher.runs_allowed', 'mlb.pitcher.no_quality_start', 'mlb.challenge_lost', 'mlb.team.stranded_risp', 'nfl.qb.sacked',
  'nba.missed_free_throw', 'nba.turnover', 'wnba.missed_free_throw', 'wnba.turnover', 'nhl.shot_missed', 'f1.driver.standings_drop',
  'team.opponent_scored', 'team.fell_behind', 'team.standings_drop', 'team.losing_streak', 'team.player_injured',
  ...[...SOCCER].map((lg) => soccerType(lg, 'foul')),
];
export function keepOldDefaults() {
  if (kvGet('prefs:quiet-defaults')) return;
  const rows = db.prepare('SELECT id, prefs FROM devices').all() as { id: string; prefs: string }[];
  const save = db.prepare('UPDATE devices SET prefs = ? WHERE id = ?');
  tx(() => {
    for (const { id, prefs } of rows) {
      const p = JSON.parse(prefs || '{}');
      p.types = { ...Object.fromEntries(WERE_ON.map((t) => [t, true])), ...p.types };
      p.pushTypes = { ...Object.fromEntries(WERE_PUSHED.map((t) => [t, true])), ...p.pushTypes };
      save.run(JSON.stringify(p), id);
    }
    kvSet('prefs:quiet-defaults', { at: Date.now(), devices: rows.length });
  });
  prefsCache.clear();
  if (rows.length) console.log(`[prefs] kept the old alert defaults for ${rows.length} existing devices`);
}
keepOldDefaults();

/**
 * October 2026: a loss's facts (lossFacts) are new alerts, on by default, and with "Loses a game" off the
 * first one a device wants is its alert. Whoever had turned the loss off (in Settings, or for one team)
 * gets them off too, once, so a loss they'd silenced doesn't come back as "lost as 64% favorites".
 */
export const LOSS_FACT_TYPES = ['team.last_second_loss', 'team.lost_as_favorite', 'team.shut_out', 'team.swept', 'team.lost_to_worse', 'team.below_500'];
export function lossFactsFollowLoss() {
  if (kvGet('prefs:loss-facts')) return;
  const rows = db.prepare('SELECT id, prefs FROM devices').all() as { id: string; prefs: string }[];
  const save = db.prepare('UPDATE devices SET prefs = ? WHERE id = ?');
  const off = Object.fromEntries(LOSS_FACT_TYPES.map((t) => [t, false]));
  let changed = 0;
  tx(() => {
    for (const { id, prefs } of rows) {
      const p = JSON.parse(prefs || '{}');
      let touched = false;
      if (p.types?.['team.lost'] === false) { p.types = { ...off, ...p.types }; touched = true; }
      for (const [k, t] of Object.entries((p.targetTypes ?? {}) as Record<string, Record<string, boolean>>)) {
        if (t['team.lost'] === false) { p.targetTypes[k] = { ...off, ...t }; touched = true; }
      }
      if (touched) { save.run(JSON.stringify(p), id); changed++; }
    }
    kvSet('prefs:loss-facts', { at: Date.now(), devices: changed });
  });
  prefsCache.clear();
  if (changed) console.log(`[prefs] the loss's new facts are off for ${changed} devices that had the loss off`);
}
lossFactsFollowLoss();

/**
 * October 11 2026: an NFL player's flag is feed only for new installs (the Jaguars, team and players, got 14 pushes
 * for flags of 19 in London). A touchdown wiped out, an ejection and the quarterback's delay of game still push. Installs
 * from before keep flags pushed, once, wherever they hadn't chosen.
 */
export const FLAGS_WERE_PUSHED = ['nfl.penalty'];
export function keepFlagsPushed() {
  if (kvGet('prefs:nfl-flags-feed')) return;
  const rows = db.prepare('SELECT id, prefs FROM devices').all() as { id: string; prefs: string }[];
  const save = db.prepare('UPDATE devices SET prefs = ? WHERE id = ?');
  tx(() => {
    for (const { id, prefs } of rows) {
      const p = JSON.parse(prefs || '{}');
      p.pushTypes = { ...Object.fromEntries(FLAGS_WERE_PUSHED.map((t) => [t, true])), ...p.pushTypes };
      save.run(JSON.stringify(p), id);
    }
    kvSet('prefs:nfl-flags-feed', { at: Date.now(), devices: rows.length });
  });
  prefsCache.clear();
  if (rows.length) console.log(`[prefs] NFL flags stay pushed for ${rows.length} existing devices`);
}
keepFlagsPushed();

/**
 * Does the alert's type want a push (its 🔔)? An alert that counts for several types follows the most
 * specific one the user has switched on: with home runs feed-only and runs pushed, a homer stays quiet;
 * with home runs switched off, it arrives as a run and pushes.
 */
export function pushWanted(p: Prefs, e: Pick<Detected, 'type' | 'aliases' | 'targetKey'>, league: League) {
  const decider = [e.type, ...(e.aliases ?? [])].find((t) => typeEnabledFor(p, e.targetKey, t, league));
  return decider !== undefined && pushTypeFor(p, e.targetKey, decider);
}

/**
 * Final per-user decision. On top of `wants`, an event marked `unless: X` is dropped for users who
 * want X, because the X event already covers that moment (e.g. stranded runners vs. NOBLETIGER).
 */
export function shouldDeliver(p: Prefs, e: Pick<Detected, 'type' | 'aliases' | 'targetKey' | 'unless'>, league: League) {
  if (!wants(p, e, league)) return false;
  return !(e.unless && wants(p, { type: e.unless, targetKey: e.targetKey }, league));
}

export function inQuietHours(p: Prefs, now = new Date()) {
  if (!p.quietHours.enabled) return false;
  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: p.quietHours.tz }).format(now);
  const { start, end } = p.quietHours;
  return start <= end ? hm >= start && hm < end : hm >= start || hm < end;
}

// ─── Live sockets ─────────────────────────────────────────────────────────────────────────────
/** A device's open connection, as the server writes to it (addSocket: each frame through the image switches). */
type Live = { send: (frame: string) => void; close: (code?: number, reason?: string) => void };
const sockets = new Map<string, Set<Live>>();
export function addSocket(deviceId: string, ws: WebSocket) {
  if (!sockets.has(deviceId)) sockets.set(deviceId, new Set());
  // Every frame to it goes through the image switches (images.ts) on the way out.
  const live = { send: (frame: string) => ws.send(frameWithoutImages(frame)), close: (code?: number, reason?: string) => ws.close(code, reason) };
  sockets.get(deviceId)!.add(live);
  ws.on('close', () => sockets.get(deviceId)?.delete(live));
}

/** Send a frame to every connected device that passes `to` (live scores: see scores.ts). */
export function sendToConnected(frame: string, to: (deviceId: string) => boolean) {
  for (const [deviceId, set] of sockets) if (set.size && to(deviceId)) for (const ws of set) ws.send(frame);
}

/** After a device deletes itself: drop cached prefs and close its live sockets. */
export function forgetDevice(deviceId: string) {
  prefsCache.delete(deviceId);
  for (const ws of sockets.get(deviceId) ?? []) ws.close(4401, 'deleted');
  sockets.delete(deviceId);
}

// ─── Feed item shape (shared by REST + websocket) ─────────────────────────────────────────────
/** Where links that leave the app point (an alert's share link). */
export const PUBLIC_URL = process.env.HW_PUBLIC_URL ?? 'https://hate-watch-api.fly.dev';

/** An alert's body with a device's folded lines first (publish(), Detected.fold): "Walk-off in the 10th. Final Score: 4 to 3". */
export const withLines = (body: string, lines: string[] | null | undefined) => (lines?.length ? `${lines.join(' ')} ${body}` : body);

/**
 * `recipients`: how many devices got this alert in their feed (see RECIPIENTS). A Successful Hate Watch
 * then says how many others got it too (`alsoGot`, the reader not counted). `extra`: the feed row's lines
 * for this device (other facts of the moment, folded in).
 */
export function feedItem(row: { id: string; type: string; league: string; target_key: string; title: string; body: string; occurred_at: number; detected_at: number; meta: string | null; share_code?: string | null; game_id?: string | null; recipients?: number; extra?: string | null; clip?: string | null }) {
  const meta = row.meta ? JSON.parse(row.meta) : null;
  const t = EVENT_TYPE_BY_ID.get(row.type) ?? (row.type === NOTICE_TYPE ? noticeLook(meta) : undefined);
  const clip = clipShown(row.clip ? JSON.parse(row.clip) : null, meta); // its play's clip, while ESPN has it up and clips are on
  const shareUrl = `${PUBLIC_URL}/a/${row.share_code ?? shareCode(row.id)}`; // a page whose link preview is a picture of this alert; tapping it opens the App Store (see share.ts)
  const styles = row.type === NOTICE_TYPE ? [] : shareStyles(row);
  return {
    ...(clip ? { clip } : {}),
    ...(row.recipients != null && isLossAlert({ type: row.type, meta }) ? { alsoGot: Math.max(0, row.recipients - 1) } : {}),
    ...(row.type === NOTICE_TYPE && meta?.urgent ? { urgent: true } : {}),
    id: row.id, type: row.type, emoji: t?.emoji ?? '😈', typeLabel: t?.label ?? row.type, league: row.league,
    gameId: row.game_id ?? null, // the game (F1: session) it happened in, for the Scores tab's game screen
    title: row.title, body: withLines(row.body, row.extra ? JSON.parse(row.extra) : null), occurredAt: row.occurred_at, detectedAt: row.detected_at,
    target: row.type === NOTICE_TYPE ? NOTICE_SENDER : targetDto(row.target_key) ?? { kind: row.target_key.split(':')[0], key: row.target_key },
    shareUrl,
    // The other ways to share it (share-styles.ts): the link and its preview picture for each, classic first. Left out when classic is the only one.
    ...(styles.length > 1 ? { shareStyles: styles.map((s) => ({ id: s.id, label: s.label, url: s.id === 'classic' ? shareUrl : `${shareUrl}?s=${s.id}`, image: `${shareUrl}/card.png${s.id === 'classic' ? '' : `?s=${s.id}`}` })) } : {}),
  };
}

// ─── Developer notices (notices.ts): a message from Hate Watch in every feed, never a push ─────
export const NOTICE_TYPE = 'app.notice';
/** A notice's league: no league's, so it shows under All; builds without notices tag it "NEWS". */
export const NOTICE_LEAGUE = 'news';
/**
 * Who a notice is from, as a team every build can draw: a red "HW" badge (builds draw a "badge://" logo as a
 * badge in its colour with its code, as for F1's constructors). Builds that know notices draw the app's icon.
 */
export const NOTICE_SENDER = {
  kind: 'team', key: 'app:hatewatch', league: NOTICE_LEAGUE, espnId: '', name: 'Hate Watch', shortName: 'Hate Watch', abbrev: 'HW',
  location: null, color: '#E5232B', altColor: null, logo: 'badge://hatewatch', logoDark: null, logoW: 512, logoH: 512,
} as const;
/** Not an alert type (nothing to turn off in Settings): its emoji and label in the feed. */
export const noticeLook = (meta: { urgent?: boolean } | null) => (meta?.urgent ? { emoji: '⚠️', label: 'Important: from Hate Watch' } : { emoji: '📣', label: 'From Hate Watch' });

// ─── Publish: persist once, then fan out to every follower who wants it ───────────────────────
const insEvent = () => db.prepare(`INSERT INTO events (id, type, league, game_id, target_key, title, body, occurred_at, detected_at, meta, share_code)
  VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
const insFeed = () => db.prepare('INSERT INTO feed (device_id, event_id, occurred_at, pushed, extra, fav) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING');
const followers = () => db.prepare('SELECT f.device_id, d.push_token, f.created_at FROM follows f JOIN devices d ON d.id = f.device_id WHERE f.target_key = ?');
/** Devices tracking a player on a team, with which player (`via`). */
const playerFollowers = () => db.prepare(`SELECT f.device_id, d.push_token, f.created_at, f.target_key AS via FROM follows f
  JOIN devices d ON d.id = f.device_id JOIN players p ON p.key = f.target_key WHERE p.team_key = ?`);
type Recipient = { device_id: string; push_token: string | null; via?: string; fav?: FavoriteRow };
/**
 * Who an alert goes to: everyone tracking its target, and for a team's alert, everyone tracking one of the
 * team's players with "Get their team's alerts" on (playerTeams), and everyone who favorites the team's
 * opponent in this game (`fav`: favorites.ts; their own choices decide, they're not hate watchers). Once per device.
 */
function recipients(targetKey: string, league: League, gameId?: string): Recipient[] {
  const out = followers().all(targetKey) as unknown as Recipient[];
  if (!targetKey.startsWith('team:')) return out;
  const have = new Set(out.map((f) => f.device_id));
  for (const f of playerFollowers().all(targetKey) as unknown as (Recipient & { via: string })[]) {
    if (have.has(f.device_id) || !getPrefs(f.device_id).playerTeams?.[f.via]?.alerts) continue;
    have.add(f.device_id);
    out.push(f);
  }
  const rooted = gameId ? opponentOf(league, gameId, targetKey) : undefined;
  if (rooted) for (const f of favoriters(rooted)) {
    if (have.has(f.device_id)) continue; // tracking the team wins over rooting against it
    have.add(f.device_id);
    out.push({ device_id: f.device_id, push_token: f.push_token, fav: f.fav });
  }
  return out;
}

/** A favorite's choices as the device's settings for the team it roots against: its alert types and push switch beat the global ones, quiet hours and the rest still apply. */
function favoritePrefs(p: Prefs, targetKey: string, fav: FavoriteRow): Prefs {
  return {
    ...p,
    targetTypes: { ...p.targetTypes, [targetKey]: fav.types },
    targetPushTypes: { ...p.targetPushTypes, [targetKey]: fav.push_types },
    muted: fav.push ? p.muted.filter((k) => k !== targetKey) : [...p.muted, targetKey],
  };
}

export type PushMessage = { to: string; title: string; body: string; sound: 'default' | null; priority: 'high'; channelId: string; interruptionLevel: string; threadId: string; data: Record<string, unknown> };

/** iOS stacks notifications that share a thread: one stack per team, with its players' alerts in it. */
export const pushThread = (targetKey: string) => (targetKey.startsWith('team:') ? targetKey : catalog.player(targetKey)?.teamKey ?? targetKey);
let pushSender: (msgs: PushMessage[]) => void = () => {};
export function setPushSender(fn: typeof pushSender) { pushSender = fn; }

/** One device's copy of an alert: who, their settings, the other facts of its moment folded into it, and the `alt` groups it has used. */
type Delivery = { f: Recipient; prefs: Prefs; folded: Detected[]; alts: Set<string> };

/** What makes a folded alert the same as another: its sentence, or its name in a list. */
const foldKey = (e: Detected) => e.fold ?? (e.list ? `${e.list.label}\u0000${e.list.item}` : undefined);
const LIST_MAX = 5;
/** A device's `list` alerts of a moment as one line each: "Yours: Alpine, Aston Martin, George Russell." (5 names, then "and N more"). */
function listLines(es: Detected[]): string[] {
  const by = new Map<string, string[]>();
  for (const e of es) if (e.list) by.set(e.list.label, [...(by.get(e.list.label) ?? []), e.list.item]);
  return [...by].map(([label, items]) => `${label}: ${items.slice(0, LIST_MAX).join(', ')}${items.length > LIST_MAX ? ` and ${items.length - LIST_MAX} more` : ''}.`);
}
/** The device's latest alert about a target since a time, of some types, or one of a team's loss alerts (`lateOn`): its id, or null. */
function latestAbout(deviceId: string, on: NonNullable<Detected['lateOn']>): string | null {
  const row = db.prepare(`SELECT f.event_id FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND ((e.target_key = ? AND e.type IN (${on.types.map(() => '?').join(',')}))${on.loss ? ` OR ${LOSS_ABOUT('e')}` : ''})
    AND f.occurred_at >= ? ORDER BY f.occurred_at DESC LIMIT 1`).get(deviceId, on.targetKey, ...on.types, ...(on.loss ? [on.targetKey, on.targetKey] : []), on.since) as { event_id: string } | undefined;
  return row?.event_id ?? null;
}
type Pending = PushMessage & { bundle?: string; label?: string };
/**
 * F1: a device's alerts from one session in one publish (the start and its back-of-grid, the results) are one
 * notification, "Singapore GP · Sprint: 7 alerts", each alert's title a line of it. Each is still its own feed row.
 */
function bundled(pushes: Pending[]): PushMessage[] {
  const out: PushMessage[] = [], groups = new Map<string, Pending[]>();
  for (const p of pushes) {
    if (!p.bundle) { out.push(p); continue; }
    if (!groups.has(p.bundle)) out.push(p); // its place in the order, filled in below
    groups.set(p.bundle, [...(groups.get(p.bundle) ?? []), p]);
  }
  return out.map((p) => {
    const { bundle, label, ...msg } = p as Pending;
    const g = bundle ? groups.get(bundle)! : [];
    if (g.length < 2) return msg;
    return {
      ...msg, title: `🏁 ${label || 'F1'}: ${g.length} alerts`, body: g.map((x) => x.title).join('\n'), sound: g.some((x) => x.sound) ? 'default' : null,
      threadId: `f1:${bundle!.split('\u0000')[1]}`, data: { ...msg.data, count: g.length },
    };
  });
}

/**
 * Moments already delivered in an earlier publish (a fact can come a poll later: an NFL drive's result after
 * its last play, a game misconduct after the instigator penalty): moment → device → its alert. A late fact
 * becomes a line on that alert, with no push. Kept in memory for LATE_FOLD_MS, so not across a restart.
 */
const LATE_FOLD_MS = 6 * 3600_000;
const delivered = new Map<string, { at: number; devices: Map<string, { eventId: string; alts: Set<string>; lines: Set<string>; weak?: boolean }> }>();
function pruneDelivered(now: number) {
  for (const [m, d] of delivered) { if (now - d.at < LATE_FOLD_MS) break; delivered.delete(m); } // oldest first
}

/**
 * Store each new alert once, then send it to every follower who wants it. Alerts that share a moment are
 * one thing happening, and a device gets one alert for it: the first in the list it wants. Each later
 * one it wants either adds its `fold` sentence to that alert (a fact it doesn't say: "Lost as 78%
 * favorites.") or, without one, is dropped (the same news about another target). The device's alert is
 * pushed if any of what it carries would be.
 */
export function publish(events: Detected[], league: League) {
  const detectedAt = Date.now();
  const pushes: Pending[] = [];
  const got = new Map<string, Map<string, Delivery>>(); // moment → device → the alert it gets for it
  const late: { deviceId: string; eventId: string; line: string }[] = []; // facts for alerts sent in an earlier publish
  pruneDelivered(detectedAt);
  const waiting = new Map<string, Map<string, Detected[]>>(); // moment → device → fold-only lines before its alert
  // Who gets what first, then the feed rows, frames and pushes: a Successful Hate Watch says how many
  // others got it, and a team's loss counts everyone who got one of its alerts (the team's or a player's).
  const planned: { e: Detected; gameId: string | null; deliver: Delivery[]; followers: number }[] = [];
  // Of a moment's firstFollowed alerts, each device's is the one about what it followed first (and wants).
  const firstFollowed = new Map<string, Map<string, { key: string; at: number }>>(); // moment → device → target
  for (const e of events) {
    if (!e.firstFollowed || !e.moment) continue;
    const mine = firstFollowed.get(e.moment) ?? firstFollowed.set(e.moment, new Map()).get(e.moment)!;
    for (const f of followers().all(e.targetKey) as { device_id: string; created_at: number }[]) {
      const had = mine.get(f.device_id);
      if ((!had || f.created_at < had.at) && shouldDeliver(getPrefs(f.device_id), e, league)) mine.set(f.device_id, { key: e.targetKey, at: f.created_at });
    }
  }
  for (const e of events) {
    recordMisery(e, league); // Recent misery is the same for everyone, so it keeps what nobody tracks (misery.ts); it never changes what is sent
    const gameId = ((e.meta?.gameId ?? e.meta?.compId) as string | undefined) ?? null; // F1: the session
    // A favorite's opponent is found by the game: the alert's own game id, or the one every game alert's id starts with.
    const fols = recipients(e.targetKey, league, gameId ?? e.id.split(':')[0]);
    if (!fols.length) continue; // nobody tracks this target: don't even store it
    const res = insEvent().run(e.id, e.type, league, gameId, e.targetKey, e.title, e.body, e.at, detectedAt, JSON.stringify({ ...e.meta, aliases: e.aliases, unless: e.unless }), shareCode(e.id));
    if (!res.changes) continue; // already published (re-poll, restart, or overlapping detectors)
    const hateWatch = isHateWatch(e);
    // Who gets it, first: a Successful Hate Watch says how many others got it too, from the first frame.
    const deliver: Delivery[] = [];
    for (const f of fols) {
      // A Successful Hate Watch counts for everyone tracking the team (or a player on it), whatever their alert settings.
      // A favorite (f.fav) roots against the team, so its loss is not a hate watch for them.
      if (!f.fav && hateWatch && recordHateWatch(f.device_id, e)) {
        const tally = JSON.stringify({ kind: 'hateWatches', tally: hateWatchTally(f.device_id) });
        for (const ws of sockets.get(f.device_id) ?? []) ws.send(tally);
      }
      const prefs = f.fav ? favoritePrefs(getPrefs(f.device_id), e.targetKey, f.fav) : getPrefs(f.device_id);
      if (!shouldDeliver(prefs, e, league)) continue;
      // A line on the device's alert about it today, when it has one (a championship drop on that day's race alert).
      const on = e.lateOn ? latestAbout(f.device_id, e.lateOn) : null;
      if (on) { late.push({ deviceId: f.device_id, eventId: on, line: e.lateOn!.line }); continue; }
      if (!f.fav && e.firstFollowed && e.moment && firstFollowed.get(e.moment)?.get(f.device_id)?.key !== e.targetKey) continue; // another of theirs, followed earlier
      const d: Delivery = { f, prefs, folded: [], alts: new Set(e.alt ? [e.alt] : []) };
      if (e.moment) {
        const mine = got.get(e.moment) ?? got.set(e.moment, new Map()).get(e.moment)!;
        const first = mine.get(f.device_id);
        if (first) {
          // They already get this moment's alert: a fact it doesn't say goes on it, the same news again doesn't
          // (no fold, or one of its alternatives already said: `alt`).
          const key = foldKey(e);
          if (key && !(e.alt && first.alts.has(e.alt)) && !first.folded.some((x) => foldKey(x) === key)) {
            first.folded.push(e);
            if (e.alt) first.alts.add(e.alt);
          }
          continue;
        }
        const before = delivered.get(e.moment)?.devices.get(f.device_id);
        if (before) {
          // A weak alert (`afterOthers`: a team's NFL flag, feed only) holds its moment for no one else. Its own lines land on it;
          // a line about an alert this device doesn't have doesn't; and any other alert is an alert of its own, not a line without a
          // push on a flag (a pushed drive result arriving a poll after the flag would have lost its push).
          const aboutIt = !!e.foldOnly && e.id.startsWith(`${before.eventId}:changed:`);
          if (e.releases && aboutIt) before.weak = true; // it was taken back (football): it no longer holds the moment
          if (e.foldOnly && (e.afterOthers || before.weak) && !aboutIt) continue;
          // The one thing a weak flag does hold: the same flag with its player named a poll later (ESPN adds the penalized player to
          // a play it posted without him), when that wouldn't push (its bell, or `noPush` after the final): it is a line on the
          // team's flag, not a second row.
          const sameFlag = e.type === 'nfl.penalty' && (!!e.noPush || !pushWanted(prefs, e, league));
          if (!before.weak || e.foldOnly || sameFlag) {
            // They got this moment's alert in an earlier publish: the fact goes on it as a line, without a push.
            if (e.fold && !(e.alt && before.alts.has(e.alt)) && !before.lines.has(e.fold)) {
              before.lines.add(e.fold);
              if (e.alt) before.alts.add(e.alt);
              late.push({ deviceId: f.device_id, eventId: before.eventId, line: e.fold });
            }
            continue;
          }
        }
        const held = waiting.get(e.moment) ?? waiting.set(e.moment, new Map()).get(e.moment)!;
        if (e.foldOnly) { held.set(f.device_id, [...(held.get(f.device_id) ?? []), e]); continue; } // a line on its alert, once there is one
        for (const x of held.get(f.device_id) ?? []) if (!(x.alt && d.alts.has(x.alt))) { d.folded.push(x); if (x.alt) d.alts.add(x.alt); }
        mine.set(f.device_id, d);
      }
      deliver.push(d);
    }
    planned.push({ e, gameId, deliver, followers: fols.length });
  }
  const perMoment = new Map<string, number>();
  const hateWatchers = (deliver: Delivery[]) => deliver.filter((d) => !d.f.fav).length; // a favorite's copy isn't counted (RECIPIENTS)
  for (const { e, deliver } of planned) if (e.moment && isLossAlert(e)) perMoment.set(e.moment, (perMoment.get(e.moment) ?? 0) + hateWatchers(deliver));
  for (const { e, gameId, deliver, followers } of planned) {
    const recipients = e.moment && isLossAlert(e) ? perMoment.get(e.moment)! : hateWatchers(deliver);
    const item = feedItem({ id: e.id, type: e.type, league, target_key: e.targetKey, title: e.title, body: e.body, occurred_at: e.at, detected_at: detectedAt, meta: JSON.stringify(e.meta ?? null), game_id: gameId, recipients });
    const frame = JSON.stringify({ kind: 'event', item });
    const moment = e.moment ? events.filter((x) => x.moment === e.moment) : [];
    for (const { f, prefs, folded } of deliver) {
      const streak = f.fav ? [] : streakLines(f.device_id, prefs, e, folded, moment, league); // may rewrite a folded streak line; a favorite has no hate watch streak
      const lines = [...listLines([e, ...folded]), ...folded.filter((x) => x.fold).map((x) => x.fold!), ...streak];
      // Through a player: that player's 🔕 keeps their team's alerts quiet too.
      const willPush = !e.noPush && !!f.push_token && pushAllowed(prefs, e.targetKey) && !(f.via && prefs.muted.includes(f.via)) && [e, ...folded].some((x) => pushWanted(prefs, x, league));
      insFeed().run(f.device_id, e.id, e.at, willPush ? 1 : 0, lines.length ? JSON.stringify(lines) : null, f.fav ? 1 : 0);
      const body = withLines(e.body, lines);
      for (const ws of sockets.get(f.device_id) ?? []) ws.send(lines.length ? JSON.stringify({ kind: 'event', item: { ...item, body } }) : frame);
      if (willPush) pushes.push({
        to: f.push_token!, title: `${item.emoji} ${e.title}`, body, sound: prefs.sound ? 'default' : null,
        priority: 'high', channelId: 'hate-events', interruptionLevel: 'time-sensitive', threadId: pushThread(e.targetKey),
        data: { eventId: e.id, targetKey: e.targetKey, type: e.type },
        ...(league === 'f1' && gameId ? { bundle: `${f.push_token}\u0000${gameId}`, label: String(e.meta?.label ?? '') } : {}),
      });
    }
    console.log(`[event] ${e.type} → ${e.targetKey}: ${e.title} (lag ${((detectedAt - e.at) / 1000).toFixed(1)}s, ${followers} followers${deliver.some((d) => d.folded.length) ? ', with folded facts' : ''})`);
    // Remember who got this moment's alert, for facts that come in a later publish.
    if (e.moment) {
      const m = delivered.get(e.moment) ?? (delivered.set(e.moment, { at: detectedAt, devices: new Map() }), delivered.get(e.moment)!);
      for (const d of deliver) m.devices.set(d.f.device_id, { eventId: e.id, alts: d.alts, lines: new Set(d.folded.map((x) => x.fold!)), ...(e.afterOthers ? { weak: true } : {}) });
    }
  }
  if (pushes.length) pushSender(bundled(pushes));
  for (const l of late) addLateLine(l.deviceId, l.eventId, l.line);
}

/**
 * A fact that came after its alert: one more line on the device's feed row (none if it cleared its feed, or
 * already has that line), sent live as an `eventUpdate` frame. No push: the alert already made a sound.
 */
function addLateLine(deviceId: string, eventId: string, line: string) {
  const row = db.prepare('SELECT extra FROM feed WHERE device_id = ? AND event_id = ?').get(deviceId, eventId) as { extra: string | null } | undefined;
  if (!row) return;
  const had = row.extra ? JSON.parse(row.extra) as string[] : [];
  if (had.includes(line)) return;
  const lines = [...had, line];
  db.prepare('UPDATE feed SET extra = ? WHERE device_id = ? AND event_id = ?').run(JSON.stringify(lines), deviceId, eventId);
  const item = db.prepare(`SELECT e.*, f.extra, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? AND f.event_id = ?`).get(deviceId, eventId) as Parameters<typeof feedItem>[0];
  for (const ws of sockets.get(deviceId) ?? []) ws.send(JSON.stringify({ kind: 'eventUpdate', item: feedItem(item) }));
  console.log(`[event] late line on ${eventId} for ${deviceId.slice(0, 6)}…: ${line}`);
}

/** An alert changed after it went out (a clip of its play came): each feed that has it gets it again, live. No push. */
export function eventChanged(eventId: string) {
  const rows = db.prepare(`SELECT f.device_id, e.*, f.extra, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id WHERE f.event_id = ?`).all(eventId) as (Parameters<typeof feedItem>[0] & { device_id: string })[];
  for (const r of rows) for (const ws of sockets.get(r.device_id) ?? []) ws.send(JSON.stringify({ kind: 'eventUpdate', item: feedItem(r) }));
}

/**
 * An alert whose facts changed after it went out (an F1 result a penalty changed): its type, title, body and
 * facts become the new ones, sent live to each feed that has it, with no push. One that no longer stands
 * (`withdrawn`) is no longer a Successful Hate Watch: it comes off each device's tally, and says nothing of
 * how many others got it. False if there's no such alert.
 */
export function reviseEvent(id: string, e: Pick<Detected, 'type' | 'aliases' | 'title' | 'body' | 'meta'> & { withdrawn?: boolean }): boolean {
  const row = db.prepare('SELECT meta FROM events WHERE id = ?').get(id) as { meta: string | null } | undefined;
  if (!row) return false;
  const meta = { ...(row.meta ? JSON.parse(row.meta) : {}), ...e.meta, aliases: e.aliases, withdrawn: e.withdrawn || undefined };
  db.prepare('UPDATE events SET type = ?, title = ?, body = ?, meta = ? WHERE id = ?').run(e.type, e.title, e.body, JSON.stringify(meta), id);
  reviseMisery(id, { ...e, meta, targetKey: (db.prepare('SELECT target_key FROM events WHERE id = ?').get(id) as { target_key: string }).target_key });
  if (e.withdrawn || !isHateWatch(e)) {
    const devices = db.prepare('SELECT device_id FROM hate_watches WHERE event_id = ?').all(id) as { device_id: string }[];
    db.prepare('DELETE FROM hate_watches WHERE event_id = ?').run(id);
    for (const { device_id } of devices) {
      const tally = JSON.stringify({ kind: 'hateWatches', tally: hateWatchTally(device_id) });
      for (const ws of sockets.get(device_id) ?? []) ws.send(tally);
    }
  }
  eventChanged(id);
  return true;
}

/**
 * An alert for one device only (its weekly recap, recap.ts): stored once, put in its feed, sent live, and
 * pushed if its settings allow (the type's 🔔, push on, not in quiet hours). False if it was sent before.
 */
export function publishTo(deviceId: string, e: Detected, league: League): boolean {
  const res = insEvent().run(e.id, e.type, league, null, e.targetKey, e.title, e.body, e.at, Date.now(), JSON.stringify(e.meta ?? null), shareCode(e.id));
  if (!res.changes) return false;
  const prefs = getPrefs(deviceId);
  const token = (db.prepare('SELECT push_token FROM devices WHERE id = ?').get(deviceId) as { push_token: string | null } | undefined)?.push_token;
  const willPush = !!token && prefs.pushEnabled && !inQuietHours(prefs) && pushTypeFor(prefs, e.targetKey, e.type);
  insFeed().run(deviceId, e.id, e.at, willPush ? 1 : 0, null, 0);
  const item = feedItem({ id: e.id, type: e.type, league, target_key: e.targetKey, title: e.title, body: e.body, occurred_at: e.at, detected_at: Date.now(), meta: JSON.stringify(e.meta ?? null) });
  for (const ws of sockets.get(deviceId) ?? []) ws.send(JSON.stringify({ kind: 'event', item }));
  if (willPush) pushSender([{ to: token!, title: `${item.emoji} ${e.title}`, body: e.body, sound: prefs.sound ? 'default' : null, priority: 'high', channelId: 'hate-events', interruptionLevel: 'active', threadId: 'recap', data: { eventId: e.id, targetKey: e.targetKey, type: e.type } }]);
  console.log(`[recap] ${deviceId.slice(0, 6)}… ${e.title}${willPush ? ' (pushed)' : ''}`);
  return true;
}

/**
 * A loss's streak lines for one device. The team's losing streak (a fact of the loss, `team.losing_streak`)
 * and the device's own Hate Watch streak (how many of those losses it watched, `team.hate_watch_streak`)
 * make one line, not two: "Lost 5 straight, every one on your Hate Watch." / "Lost 9 straight, 5 on your
 * Hate Watch." With only the Hate Watch streak on: "Your Hate Watch streak: 5 straight losses." Returns
 * lines to add; a team streak line already folded in is rewritten in place.
 */
function streakLines(deviceId: string, prefs: Prefs, e: Detected, folded: Detected[], moment: Detected[], league: League): string[] {
  if (!isLossAlert(e)) return [];
  const streak = moment.find((x) => x.type === 'team.losing_streak');
  const n = Number(streak?.meta?.streak ?? 0);
  if (n < 3 || !shouldDeliver(prefs, { type: 'team.hate_watch_streak', targetKey: e.targetKey }, league)) return [];
  const watched = watchedOfLast(deviceId, hateWatchOf(streak!).targetKey, n);
  if (watched < 3) return [];
  const mine = watched === n ? 'every one' : String(watched);
  const i = folded.findIndex((x) => x.type === 'team.losing_streak'); // the team's, or its copy on a player's alert (playerLossLines)
  if (i >= 0) { folded[i] = { ...streak!, fold: `Lost ${n} straight, ${mine} on your Hate Watch.` }; return []; }
  if (e === streak) return [`${watched === n ? 'Every one' : watched} on your Hate Watch.`];
  return [`Your Hate Watch streak: ${watched} straight losses.`];
}
