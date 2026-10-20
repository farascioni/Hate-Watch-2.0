// The HTTP and WebSocket API the app and the public pages talk to: a route table (`route`), device-token auth, and the
// server that reads each request. Nothing in a request is trusted: a body is JSON of at most 64 KB (400 / 413 otherwise),
// a numeric query value is clamped to its route's range (`intParam`), a device registers with a known platform at
// most 30 times an hour per client IP (429), and a share link's host is the caller's only if it is one of ours (`origin`).
// Docs: docs/run-it.md "Request limits", docs/sharing.md (the host rule).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { db, kvGet } from './db.ts';
import { catalog, search, teamDto, playerDto, targetDto, listed, type Player } from './catalog.ts';
import type { WeightClass } from './ufc-classes.ts';
import { EVENT_TYPES } from './event-types.ts';
import { LEAGUES, LEAGUE_IDS, GAME_LEAGUES, TEAMS_ONLY, type League } from './leagues.ts';
import { addFavorite, favoriteOf, favoritesOf, removeFavorite, updateFavorite, registerGame, type FavoriteRow } from './favorites.ts';
import { addSocket, feedItem, forgetDevice, getPrefs, setPrefs, prefsDto, publish, DEFAULT_PREFS, PUBLIC_URL } from './fanout.ts';
import { engine } from './live.ts';
import { callStats } from './calls.ts';
import { privacyPage, supportPage } from './pages.ts';
import { appSiteAssociation, shareCard, sharedAlert, shareLink, type Reply } from './share.ts';
import { allGames, deviceTeams, forgetDeviceTeams, gameDetail, gamesFor, getGame, nextF1Weekend } from './scores.ts';
import { forDevice } from './highlights.ts';
import { flagOn } from './flags.ts';
import { getLatestBuild } from './app-build.ts';
import { deleteLiveActivity, getLiveActivity, putLiveActivity } from './live-activity.ts';
import { withoutImages } from './images.ts';
import { RECIPIENTS, hateWatchTally, withHateWatch } from './hate-watches.ts';
import { LEADERBOARD_MAX, leaderboard, withHaters } from './leaderboard.ts';
import { upNextFor } from './upnext.ts';
import { castVote, savedGame, setAlert, startedFor, upcomingFor, type UpcomingItem } from './series.ts';
import { statsFor } from './stats.ts';
import { MISERY_DAYS, miseryRows } from './misery.ts';
import { f1Preview } from './f1-preview.ts';
import { ufcCard, ufcCards } from './ufc-preview.ts';
import { RECAP_TYPE } from './recap.ts';
import { divisionsOf, f1DriverStandings } from './divisions.ts';
import { deepHealth, liveDeps } from './health.ts';

class Html {
  body: string;
  constructor(body: string) { this.body = body; }
}
/** Any other response: an image, a redirect, a page with its own status. */
class Raw {
  reply: Reply;
  constructor(reply: Reply) { this.reply = reply; }
}

type Handler = (req: IncomingMessage & { deviceId?: string }, url: URL, params: string[], body: any) => unknown | Promise<unknown>;
class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

/** A numeric query value truncated and clamped to [min, max]; `def` when it is missing or not a number (it reaches SQLite as a bound number, where NaN or a negative LIMIT misbehave). */
const intParam = (url: URL, name: string, def: number, min: number, max: number) => {
  const raw = url.searchParams.get(name)?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : def;
};

/** A push token from a request body: a string, or null / absent for none. */
const pushTokenOf = (v: unknown) => {
  if (v == null) return null;
  if (typeof v !== 'string') throw new HttpError(400, 'pushToken is a string or null');
  return v;
};

/** What `POST /devices` takes for platform: `Platform.OS` in the app's `ensureToken` (the web export registers too). */
const PLATFORMS = ['ios', 'android', 'web'];

const MAX_BODY = 64 * 1024;
/** The request's JSON body ({} when empty). Past MAX_BODY it is 413: the rest of the upload is read but dropped, since
 * abandoning the stream would reset the connection before the 413 reached the caller. */
async function readBody(req: IncomingMessage) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw new HttpError(413, 'body too large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) if ((size += (c as Buffer).length) <= MAX_BODY) chunks.push(c as Buffer);
  if (size > MAX_BODY) throw new HttpError(413, 'body too large');
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'bad json'); }
}

/** Fly's proxy puts the client's address in `fly-client-ip` (its docs don't say it replaces one a caller sends: unchecked, so the device cap is abuse control, not a guarantee). Off Fly: the first `x-forwarded-for` entry, which is whatever the caller sent, then the socket's. */
const clientIp = (req: IncomingMessage) =>
  String(req.headers['fly-client-ip'] ?? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

// A device row costs a feed row on every developer notice (notices.ts), so one address registers only so many an hour.
// shortcut: fixed window, in memory (a restart forgets it), one machine; upgrade when the API runs on more than one.
const DEVICES_PER_HOUR = 30;
const newDevices = new Map<string, { n: number; resetAt: number }>(); // oldest window first, so pruning stops at the first live one
const overDeviceCap = (ip: string, now = Date.now()) => {
  for (const [k, v] of newDevices) { if (v.resetAt > now) break; newDevices.delete(k); }
  const w = newDevices.get(ip) ?? { n: 0, resetAt: now + 3_600_000 };
  newDevices.set(ip, w);
  return ++w.n > DEVICES_PER_HOUR;
};

const routes: { method: string; re: RegExp; auth: boolean; fn: Handler }[] = [];
const route = (method: string, path: string, auth: boolean, fn: Handler) =>
  routes.push({ method, re: new RegExp(`^${path.replace(/:[a-zA-Z]+/g, '([^/]+)')}$`), auth, fn });

function authDevice(header: string | undefined | null): string | undefined {
  const [id, secret] = (header ?? '').replace(/^Bearer /, '').split('.');
  if (!id || !secret) return;
  const row = db.prepare('SELECT secret FROM devices WHERE id = ?').get(id) as { secret: string } | undefined;
  if (!row) return;
  const a = Buffer.from(row.secret), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? id : undefined;
}

// ─── Public ───────────────────────────────────────────────────────────────────────────────────
route('GET', '/health', false, () => ({ ok: true, catalog: catalog.size(), live: engine.status(), calls: callStats() }));
// The outside monitor's check (health.ts, docs/redundancy.md): 503 when the database, ESPN reads, a game's loop or the backup stopped.
// Not Fly's check: that one stays on /health, since failing it would pull the only machine out of routing.
route('GET', '/health/deep', false, async () => {
  const trackers = engine.status().flatMap((t) => ('loopAt' in t ? [t] : [])); // the games; F1 and the UFC have their own engines
  const h = await deepHealth(liveDeps(trackers));
  return h.ok ? h : new Raw({ status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: Buffer.from(JSON.stringify(h)) });
});
// Each league's sport too: the app shows any soccer league's matches the soccer way.
// `ui`: how the app shows each league (its color, filter, words: leagues.ts LeagueUi). `teamsOnly`: a league with no players (college football).
route('GET', '/catalog/event-types', false, () => ({ leagues: LEAGUE_IDS.map((id) => ({ id, name: LEAGUES[id].name, sport: LEAGUES[id].sport, ui: LEAGUES[id].ui, ...(TEAMS_ONLY.has(id) ? { teamsOnly: true } : {}) })), types: EVENT_TYPES }));
route('GET', '/app/latest-build', false, () => getLatestBuild()); // the newest build and where to get it, for the app's "update available" alert (app-build.ts)
route('GET', '/catalog/report', false, () => kvGet('ingest:report'));
route('GET', '/search', false, (_r, url) => ({
  results: withHaters(search(url.searchParams.get('q') ?? '', {
    league: (url.searchParams.get('league') as League) || undefined,
    kind: (url.searchParams.get('kind') as 'team' | 'player') || undefined,
    limit: intParam(url, 'limit', 40, 1, 100),
  })),
}));
// ?by=division: each team says its division (`division`, and `divisionOrder`: ESPN's order of them) and, where
// ESPN's standings have them, its `record` and `streak` ("W2", "L4"; the Tracking tab's cards), and the list comes by league (the app's order), then division, then name. Otherwise A-Z.
route('GET', '/teams', false, async (_r, url) => {
  const lg = url.searchParams.get('league');
  const teams = catalog.allTeams().filter((t) => listed(t) && (!lg || t.league === lg)); // not the UFC's placeholder
  if (url.searchParams.get('by') !== 'division') return { teams: withHaters(teams.sort((a, b) => a.name.localeCompare(b.name)).map(teamDto)) };
  const leagues = [...new Set(teams.map((t) => t.league))];
  const div = new Map(await Promise.all(leagues.map(async (l) => [l, await divisionsOf(l)] as const)));
  const rows = teams.map((t) => {
    const d = div.get(t.league)?.get(t.espnId);
    return { ...teamDto(t), division: d?.name ?? (t.league === 'f1' ? 'Constructors' : LEAGUES[t.league].name), divisionOrder: d?.order ?? 99, record: d?.record, streak: d?.streak, standing: d?.standing };
  });
  rows.sort((a, b) => LEAGUE_IDS.indexOf(a.league) - LEAGUE_IDS.indexOf(b.league) || a.divisionOrder - b.divisionOrder || a.name.localeCompare(b.name));
  return { teams: withHaters(rows) };
});
// The UFC's weight classes, heaviest first, each with its champion and top fighters (ufc-classes.ts): the UFC's
// "Weight classes" on Search. Not in /teams: the UFC has none, and every build lists /teams as teams.
route('GET', '/ufc/weight-classes', false, () => ({
  classes: (kvGet<WeightClass[]>('ufc:weight-classes') ?? [])
    .map((c) => ({ name: c.name, fighters: withHaters(c.keys.map((k) => catalog.player(k)).filter((p): p is Player => !!p).map(playerDto)) }))
    .filter((c) => c.fighters.length),
}));
// Every F1 driver, by constructor (A-Z), each team's A-Z: Search's Drivers with nothing typed.
// Each says its own place in the drivers' championship (`record` "444 pts", `standing` "2nd in drivers"; the Tracking tab's cards).
route('GET', '/f1/drivers', false, async () => {
  const places = await f1DriverStandings();
  return {
    drivers: withHaters(catalog.allTeams().filter((t) => t.league === 'f1').sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((t) => [...catalog.roster(t.key)].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ ...playerDto(p), ...places.get(p.espnId) })))),
  };
});
// An F1 weekend's preview: where, when, the grid once it's set, the championship (f1-preview.ts).
route('GET', '/f1/events/:id/preview', false, async (_r, _u, [id]) => {
  const preview = await f1Preview(decodeURIComponent(id));
  if (!preview) throw new HttpError(404, 'no such F1 weekend');
  return preview;
});
// The UFC's next card and the one after, and one card: every fight, its odds and tape, results once in (ufc-preview.ts).
route('GET', '/ufc/cards', false, async () => ({ cards: await ufcCards() }));
route('GET', '/ufc/cards/:id', false, async (_r, _u, [id]) => {
  const card = await ufcCard(decodeURIComponent(id));
  if (!card) throw new HttpError(404, 'no such UFC card');
  return card;
});
// A player's or team's stats page.
route('GET', '/targets/:key/stats', false, async (_r, _u, [key]) => {
  const page = await statsFor(decodeURIComponent(key));
  if (!page) throw new HttpError(404, 'no stats for this one');
  return page;
});
// A player's or team's Recent misery: the priority things that happened to them (a loss, an ejection, a bad race), the
// same list for everyone (misery.ts). The last 30 days, newest first; no device token.
route('GET', '/targets/:key/misery', false, (_r, _u, [key]) => {
  const k = decodeURIComponent(key);
  if (!targetDto(k)) throw new HttpError(404, 'not found');
  return { items: miseryRows(k).map((r) => ({ ...feedItem({ ...r, detected_at: r.occurred_at, extra: r.lines } as Parameters<typeof feedItem>[0]), loss: r.kind === 'loss' })), days: MISERY_DAYS };
});
route('GET', '/targets/:key', false, (_r, _u, [key]) => {
  const k = decodeURIComponent(key);
  const t = targetDto(k);
  if (!t) throw new HttpError(404, 'not found');
  const [me] = withHaters([t]);
  return t.kind === 'team' ? { ...me, roster: withHaters(catalog.roster(k).map(playerDto)) } : me;
});

// ─── Devices (anonymous accounts) ─────────────────────────────────────────────────────────────
route('POST', '/devices', false, (req, _u, _p, body) => {
  if (!PLATFORMS.includes(body?.platform)) throw new HttpError(400, `platform is ${PLATFORMS.join(', ')}`);
  const pushToken = pushTokenOf(body.pushToken);
  if (overDeviceCap(clientIp(req))) throw new HttpError(429, 'too many new devices from this address, try again later');
  const id = randomUUID();
  const secret = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, secret, body.platform, pushToken, JSON.stringify(DEFAULT_PREFS), Date.now());
  return { token: `${id}.${secret}`, deviceId: id };
});
route('PUT', '/me/push-token', true, (req, _u, _p, body) => {
  db.prepare('UPDATE devices SET push_token = ? WHERE id = ?').run(pushTokenOf(body?.pushToken), req.deviceId!);
  return { ok: true };
});

// ─── Follows ──────────────────────────────────────────────────────────────────────────────────
/** How many devices track a player or team (the Tracking tab shows it; follows_target indexes it). */
const trackers = (key: string) => (db.prepare('SELECT COUNT(*) AS n FROM follows WHERE target_key = ?').get(key) as { n: number }).n;
route('GET', '/me/follows', true, (req) => ({
  follows: (db.prepare(`SELECT target_key, created_at, (SELECT COUNT(*) FROM follows x WHERE x.target_key = f.target_key) AS trackers
    FROM follows f WHERE device_id = ? ORDER BY created_at DESC`).all(req.deviceId!) as any[])
    .map((r) => ({ key: r.target_key, followedAt: r.created_at, trackers: r.trackers, target: targetDto(r.target_key) })),
}));
route('PUT', '/me/follows/:key', true, (req, _u, [key]) => {
  const k = decodeURIComponent(key);
  if (!targetDto(k)) throw new HttpError(404, 'unknown team/player');
  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?,?,?) ON CONFLICT (device_id, target_key) DO UPDATE SET event_key = NULL, event_until = NULL').run(req.deviceId!, k, Date.now());
  forgetDeviceTeams(req.deviceId!); // their Scores tab changes now
  engine.kick(); // a game in progress for this target starts tracking right now
  return { ok: true, trackers: trackers(k) };
});
route('DELETE', '/me/follows/:key', true, (req, _u, [key]) => {
  db.prepare('DELETE FROM follows WHERE device_id = ? AND target_key = ?').run(req.deviceId!, decodeURIComponent(key));
  forgetDeviceTeams(req.deviceId!);
  engine.kick();
  return { ok: true, trackers: trackers(decodeURIComponent(key)) };
});

// ─── Favorites (Hate Watch Plus; favorites.ts): a team you root for, not track ─────────────────
const favoriteDto = (r: FavoriteRow) => ({ key: r.team_key, favoritedAt: r.created_at, push: r.push, types: r.types, pushTypes: r.push_types, target: targetDto(r.team_key) });
/** A map of alert type → on/off (null: back to the global setting); anything else in it is dropped. */
const flagMap = (v: unknown): Record<string, boolean | null> => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([, x]) => x === null || typeof x === 'boolean')) as Record<string, boolean | null>;
route('GET', '/me/favorites', true, (req) => ({ favorites: favoritesOf(req.deviceId!).map(favoriteDto) }));
route('PUT', '/me/favorites/:key', true, (req, _u, [key]) => {
  const k = decodeURIComponent(key), t = targetDto(k);
  if (!t || t.kind !== 'team' || !([...GAME_LEAGUES, 'f1'] as League[]).includes(t.league)) throw new HttpError(404, 'a favorite is a team in a league of games, or an F1 constructor');
  addFavorite(req.deviceId!, k);
  forgetDeviceTeams(req.deviceId!); // its game is on the Scores tab now
  engine.kick(); // a game in progress for it is tracked right now
  return { favorite: favoriteDto(favoriteOf(req.deviceId!, k)!) };
});
route('PUT', '/me/favorites/:key/settings', true, (req, _u, [key], body) => {
  const row = updateFavorite(req.deviceId!, decodeURIComponent(key), { push: typeof body?.push === 'boolean' ? body.push : undefined, types: flagMap(body?.types), pushTypes: flagMap(body?.pushTypes) });
  if (!row) throw new HttpError(404, 'not a favorite');
  return { favorite: favoriteDto(row) };
});
route('DELETE', '/me/favorites/:key', true, (req, _u, [key]) => { removeFavorite(req.deviceId!, decodeURIComponent(key)); forgetDeviceTeams(req.deviceId!); return { ok: true }; });
route('DELETE', '/me/favorites', true, (req) => { removeFavorite(req.deviceId!); forgetDeviceTeams(req.deviceId!); return { ok: true }; }); // Plus lapsed

// ─── Lock screen scoreboard (live-activity.ts): the Live Activity's push token, and the keys starred as most hated ──
route('GET', '/me/live-activity', true, (req) => ({ board: getLiveActivity(req.deviceId!) }));
route('PUT', '/me/live-activity', true, (req, _u, _p, body) => ({ board: putLiveActivity(req.deviceId!, body ?? {}) }));
route('DELETE', '/me/live-activity', true, (req) => { deleteLiveActivity(req.deviceId!); return { ok: true }; }); // Plus lapsed, or the board turned off

// ─── Scores tab: today's games for the teams (and players' teams) you track ─────────────────────
// upNext: each of the device's teams' next game (the app leaves out any already on the tab as a card).
route('GET', '/me/scores', true, (req) => ({ games: withHateWatch(req.deviceId!, gamesFor(req.deviceId!)), nextF1: nextF1Weekend(), upNext: upNextFor([...deviceTeams(req.deviceId!).teams, ...favoritesOf(req.deviceId!).map((f) => f.team_key)]) }));
// "All games" on the Scores tab: every game live now or starting within a day, tracked or not.
route('GET', '/me/scores/all', true, (req) => ({ games: withHateWatch(req.deviceId!, allGames()) }));
// Special Events: the playoff games and series starting within a week (events) and the series under way (started), and who this device wants to lose (series.ts). Percentages only after it voted.
const withGame = (deviceId: string) => (e: UpcomingItem) => ({ ...e, game: withHateWatch(deviceId, [e.game])[0] });
route('GET', '/me/events/upcoming', true, (req) => ({ events: upcomingFor(req.deviceId!).map(withGame(req.deviceId!)), started: startedFor(req.deviceId!).map(withGame(req.deviceId!)) }));
route('PUT', '/me/events/:key/vote', true, (req, _u, [key], body) => {
  const out = typeof body?.team === 'string' ? castVote(req.deviceId!, decodeURIComponent(key), body.team) : null;
  if (!out) throw new HttpError(400, 'not open for voting, or not one of its teams');
  return { event: { ...out, game: withHateWatch(req.deviceId!, [out.game])[0] } };
});
route('PUT', '/me/events/:key/alert', true, (req, _u, [key], body) => {
  const out = typeof body?.on === 'boolean' ? setAlert(req.deviceId!, decodeURIComponent(key), body.on) : null;
  if (!out) throw new HttpError(400, 'not open, or this device has not voted');
  engine.kick(); // a game in progress for the team starts tracking right now
  return { event: { ...out, game: withHateWatch(req.deviceId!, [out.game])[0] } };
});
route('GET', '/me/games/:key', true, async (req, _u, [key]) => {
  const onBoard = getGame(decodeURIComponent(key));
  const saved = onBoard ? undefined : savedGame(decodeURIComponent(key)); // a finished game of a series on Special Events, kept after the board forgot it (series.ts)
  const game = onBoard ?? saved?.card;
  if (!game) throw new HttpError(404, 'game not found');
  const rows = db.prepare(`SELECT e.*, f.extra, f.fav, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id
    WHERE f.device_id = ? AND e.game_id = ? ORDER BY f.occurred_at DESC LIMIT 100`).all(req.deviceId!, game.id) as any[];
  const detail = await gameDetail(game).catch(() => null); // the score card still works if ESPN hiccups
  const mine = new Set(rows.map((r) => JSON.parse(r.meta ?? 'null')?.playId).filter(Boolean).map(String)); // the plays that sent this device alerts
  return {
    game: withHateWatch(req.deviceId!, [game])[0], alerts: rows.map(feedItem), plays: detail?.plays ?? [], box: detail?.box ?? saved?.box ?? null,
    clips: flagOn('clips.highlights') ? detail?.clips ?? [] : [], keyPlays: detail ? forDevice(detail.highlights, mine) : [], // clips: a switch (flags.ts)
  };
});

// ─── Leaderboard: the most hated players and teams (public: it's counts, never who) ────────────
route('GET', '/leaderboard', false, (_r, url) => {
  const kind = url.searchParams.get('kind'), league = url.searchParams.get('league');
  if (kind && kind !== 'team' && kind !== 'player') throw new HttpError(400, 'kind is team or player');
  if (league && !LEAGUE_IDS.includes(league as League)) throw new HttpError(400, 'unknown league');
  const limit = Number(url.searchParams.get('limit') ?? LEADERBOARD_MAX) || LEADERBOARD_MAX; // capped at the top 100 by leaderboard()
  return leaderboard({ kind: (kind ?? undefined) as 'team' | 'player' | undefined, league: (league ?? undefined) as League | undefined, limit });
});

// ─── Settings counter: Successful Hate Watches (a team or UFC fighter you track lost) ─────────────────────────
route('GET', '/me/hate-watches', true, (req) => hateWatchTally(req.deviceId!));

// ─── Prefs ────────────────────────────────────────────────────────────────────────────────────
route('GET', '/me/prefs', true, (req) => prefsDto(getPrefs(req.deviceId!)));
route('PUT', '/me/prefs', true, (req, _u, _p, body) => {
  const p = prefsDto(setPrefs(req.deviceId!, body ?? {}));
  if (body?.playerTeams) forgetDeviceTeams(req.deviceId!); // a player's team on or off the Scores tab, now
  return p;
});

// ─── Feed (chronological by when it happened, newest first) ───────────────────────────────────
route('GET', '/me/feed', true, (req, url) => {
  const limit = intParam(url, 'limit', 50, 1, 200);
  const before = intParam(url, 'before', Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
  const after = intParam(url, 'after', 0, 0, Number.MAX_SAFE_INTEGER);
  const target = url.searchParams.get('target'); // one player's or team's alerts (their page's "Recent misery")
  const rows = db.prepare(`SELECT e.*, f.extra, f.fav, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id
    WHERE f.device_id = ? AND f.occurred_at < ? AND f.occurred_at > ?${target ? ` AND e.target_key = ? AND e.type != '${RECAP_TYPE}'` : ''}
    ORDER BY f.occurred_at DESC, e.detected_at DESC LIMIT ?`)
    .all(req.deviceId!, before, after, ...(target ? [target] : []), limit) as any[];
  return { items: rows.map(feedItem) };
});
route('DELETE', '/me/feed', true, (req) => {
  db.prepare('DELETE FROM feed WHERE device_id = ?').run(req.deviceId!);
  return { ok: true };
});

// "Delete all my data": the device row cascades to follows + feed (see db.ts foreign keys).
route('DELETE', '/me', true, (req) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.deviceId!);
  forgetDevice(req.deviceId!);
  engine.kick();
  return { ok: true };
});

// ─── Public pages (App Store privacy policy + support URLs) ───────────────────────────────────
route('GET', '/privacy', false, () => new Html(privacyPage()));
route('GET', '/support', false, () => new Html(supportPage()));

// ─── Share links: a page whose preview is a picture of the alert (see share.ts) ───────────────
// The Host header is the caller's, and a share page is cached for 5 minutes, so a made-up Host would put someone else's
// site in the canonical, og:url and card image links everyone gets. Only our own hosts (and localhost, for development) are used.
const SHARE_HOSTS = ['hate-watch-api.fly.dev', 'hatewatch.dev', 'www.hatewatch.dev'];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const origin = (req: IncomingMessage) => {
  const host = String(req.headers.host ?? '').toLowerCase();
  if (LOCAL_HOST.test(host)) return `http://${host}`;
  return SHARE_HOSTS.includes(host) ? `https://${host}` : PUBLIC_URL; // PUBLIC_URL itself for anything else, its own host included
};
route('GET', '/a/:code/card.png', false, async (_r, u, [code]) => {
  const png = await shareCard(code, u.searchParams.get('s'));
  if (!png) throw new HttpError(404, 'no such alert');
  return new Raw({ status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }, body: png });
});
route('GET', '/a/:code', false, (req, u, [code]) => new Raw(shareLink(code, String(req.headers['user-agent'] ?? ''), origin(req), u.searchParams.get('s'))));
// Universal links: lets iOS open /a/* links in the app when it's installed.
route('GET', '/.well-known/apple-app-site-association', false, () => appSiteAssociation());
// The alert behind a share link, for the screen the app opens it on.
route('GET', '/shared/:code', false, (_r, _u, [code]) => {
  const item = sharedAlert(code);
  if (!item) throw new HttpError(404, 'no such alert');
  return { item };
});

// ─── Dev only: inject a fake event to test push + feed end to end ─────────────────────────────
if (process.env.HW_DEV === '1') {
  route('POST', '/dev/simulate', true, (req, _u, _p, body) => {
    const follows = db.prepare('SELECT target_key FROM follows WHERE device_id = ?').all(req.deviceId!) as { target_key: string }[];
    const favs = favoritesOf(req.deviceId!);
    // No key given: one of the follows or favorites at random, so both get exercised.
    const pick = Math.floor(Math.random() * (follows.length + favs.length));
    const key = body?.targetKey ?? (pick < follows.length ? follows[pick].target_key : undefined);
    if (!key && favs.length) {
      // A favorite's test: it plays a made-up game against another team of its league, and that team's alert is published (fanout routes it to the favorite).
      const fav = favs[Math.floor(Math.random() * favs.length)].team_key;
      const league = (targetDto(fav) as { league: League }).league;
      const rival = catalog.allTeams().find((x) => x.league === league && x.key !== fav);
      if (!rival) throw new HttpError(400, 'no other team to play');
      const gameId = `sim-game-${randomUUID()}`;
      registerGame(league, gameId, fav, rival.key);
      const pool = EVENT_TYPES.filter((e) => e.scope === 'team' && e.leagues.includes(league));
      const type = body?.type ?? pool[Math.floor(Math.random() * pool.length)].id;
      publish([{ id: `${gameId}:${randomUUID()}:${type}:${rival.key}`, type, targetKey: rival.key, title: `[TEST] ${rival.name}: ${EVENT_TYPES.find((e) => e.id === type)?.label}`, body: `Simulated: ${rival.name} play your favorite`, at: Date.now(), meta: { gameId } }], league);
      return { ok: true, type, targetKey: rival.key, favorite: fav };
    }
    if (!key) throw new HttpError(400, 'follow something first');
    const t = targetDto(key)!;
    const pool = EVENT_TYPES.filter((e) => e.scope === t.kind && e.leagues.includes(t.league));
    const type = body?.type ?? pool[Math.floor(Math.random() * pool.length)].id;
    publish([{ id: `sim:${randomUUID()}`, type, targetKey: key, title: `[TEST] ${t.name}: ${EVENT_TYPES.find((e) => e.id === type)?.label}`, body: 'Simulated event from /dev/simulate', at: Date.now() }], t.league);
    return { ok: true, type, targetKey: key };
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────────────────────
export function startApi(port: number) {
  const server = createServer(async (req: IncomingMessage & { deviceId?: string }, res: ServerResponse) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      // HEAD is answered like GET (Node drops the body), for link-preview fetchers that check first.
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const r = routes.find((x) => x.method === method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'no route');
      if (r.auth && !(req.deviceId = authDevice(req.headers.authorization))) throw new HttpError(401, 'bad token');
      let body: any;
      if (req.method === 'POST' || req.method === 'PUT') body = await readBody(req);
      const out = await r.fn(req, url, url.pathname.match(r.re)!.slice(1), body);
      if (out instanceof Html) return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }).end(out.body);
      if (out instanceof Raw) return void res.writeHead(out.reply.status, out.reply.headers).end(out.reply.body);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(withoutImages(out ?? null))); // the image switches (images.ts)
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  // Realtime feed: one socket per open app. Push notifications cover the app-closed case.
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const token = new URL(req.url ?? '', 'http://x').searchParams.get('token');
    const deviceId = authDevice(token);
    if (!deviceId) return ws.close(4401, 'bad token');
    addSocket(deviceId, ws);
    let alive = true;
    ws.on('pong', () => (alive = true));
    const hb = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 25_000);
    ws.on('close', () => clearInterval(hb));
    ws.send(JSON.stringify({ kind: 'hello', serverTime: Date.now() }));
  });

  server.listen(port, () => console.log(`[api] listening on :${port}`));
  return server;
}
