import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { db, kvGet } from './db.ts';
import { catalog, search, teamDto, playerDto, targetDto } from './catalog.ts';
import { EVENT_TYPES } from './event-types.ts';
import { LEAGUES, LEAGUE_IDS, type League } from './leagues.ts';
import { addSocket, feedItem, forgetDevice, getPrefs, setPrefs, publish, DEFAULT_PREFS, PUBLIC_URL } from './fanout.ts';
import { engine } from './live.ts';
import { privacyPage, supportPage } from './pages.ts';
import { appSiteAssociation, shareCard, sharedAlert, shareLink, type Reply } from './share.ts';
import { forgetDeviceTeams, gamePlays, gamesFor, getGame, nextF1Weekend } from './scores.ts';
import { RECIPIENTS, hateWatchTally, withHateWatch } from './hate-watches.ts';
import { leaderboard, withHaters } from './leaderboard.ts';

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
route('GET', '/health', false, () => ({ ok: true, catalog: catalog.size(), live: engine.status() }));
route('GET', '/catalog/event-types', false, () => ({ leagues: LEAGUE_IDS.map((id) => ({ id, name: LEAGUES[id].name })), types: EVENT_TYPES }));
route('GET', '/catalog/report', false, () => kvGet('ingest:report'));
route('GET', '/search', false, (_r, url) => ({
  results: withHaters(search(url.searchParams.get('q') ?? '', {
    league: (url.searchParams.get('league') as League) || undefined,
    kind: (url.searchParams.get('kind') as 'team' | 'player') || undefined,
    limit: Math.min(Number(url.searchParams.get('limit') ?? 40), 100),
  })),
}));
route('GET', '/teams', false, (_r, url) => ({
  teams: withHaters(catalog.allTeams().filter((t) => !url.searchParams.get('league') || t.league === url.searchParams.get('league'))
    .sort((a, b) => a.name.localeCompare(b.name)).map(teamDto)),
}));
route('GET', '/targets/:key', false, (_r, _u, [key]) => {
  const k = decodeURIComponent(key);
  const t = targetDto(k);
  if (!t) throw new HttpError(404, 'not found');
  const [me] = withHaters([t]);
  return t.kind === 'team' ? { ...me, roster: withHaters(catalog.roster(k).map(playerDto)) } : me;
});

// ─── Devices (anonymous accounts) ─────────────────────────────────────────────────────────────
route('POST', '/devices', false, (_r, _u, _p, body) => {
  const id = randomUUID();
  const secret = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO devices (id, secret, platform, push_token, prefs, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, secret, String(body?.platform ?? 'unknown'), body?.pushToken ?? null, JSON.stringify(DEFAULT_PREFS), Date.now());
  return { token: `${id}.${secret}`, deviceId: id };
});
route('PUT', '/me/push-token', true, (req, _u, _p, body) => {
  db.prepare('UPDATE devices SET push_token = ? WHERE id = ?').run(body?.pushToken ?? null, req.deviceId!);
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
  db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(req.deviceId!, k, Date.now());
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

// ─── Scores tab: today's games for the teams (and players' teams) you track ─────────────────────
route('GET', '/me/scores', true, (req) => ({ games: withHateWatch(req.deviceId!, gamesFor(req.deviceId!)), nextF1: nextF1Weekend() }));
route('GET', '/me/games/:key', true, async (req, _u, [key]) => {
  const game = getGame(decodeURIComponent(key));
  if (!game) throw new HttpError(404, 'game not found');
  const alerts = (db.prepare(`SELECT e.*, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id
    WHERE f.device_id = ? AND e.game_id = ? ORDER BY f.occurred_at DESC LIMIT 100`).all(req.deviceId!, game.id) as any[]).map(feedItem);
  const plays = await gamePlays(game).catch(() => []); // the score card still works if ESPN hiccups
  return { game: withHateWatch(req.deviceId!, [game])[0], alerts, plays };
});

// ─── Leaderboard: the most hated players and teams (public: it's counts, never who) ────────────
route('GET', '/leaderboard', false, (_r, url) => {
  const kind = url.searchParams.get('kind'), league = url.searchParams.get('league');
  if (kind && kind !== 'team' && kind !== 'player') throw new HttpError(400, 'kind is team or player');
  if (league && !LEAGUE_IDS.includes(league as League)) throw new HttpError(400, 'unknown league');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 200);
  return { entries: leaderboard({ kind: (kind ?? undefined) as 'team' | 'player' | undefined, league: (league ?? undefined) as League | undefined, limit }) };
});

// ─── Settings counter: Successful Hate Watches (a team you track lost) ─────────────────────────
route('GET', '/me/hate-watches', true, (req) => hateWatchTally(req.deviceId!));

// ─── Prefs ────────────────────────────────────────────────────────────────────────────────────
route('GET', '/me/prefs', true, (req) => getPrefs(req.deviceId!));
route('PUT', '/me/prefs', true, (req, _u, _p, body) => setPrefs(req.deviceId!, body ?? {}));

// ─── Feed (chronological by when it happened, newest first) ───────────────────────────────────
route('GET', '/me/feed', true, (req, url) => {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
  const after = Number(url.searchParams.get('after') ?? 0);
  const target = url.searchParams.get('target'); // one player's or team's alerts (their page's "Recent misery")
  const rows = db.prepare(`SELECT e.*, ${RECIPIENTS} FROM feed f JOIN events e ON e.id = f.event_id
    WHERE f.device_id = ? AND f.occurred_at < ? AND f.occurred_at > ?${target ? ' AND e.target_key = ?' : ''}
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
const origin = (req: IncomingMessage) =>
  req.headers.host ? `${String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0]}://${req.headers.host}` : PUBLIC_URL;
route('GET', '/a/:code/card.png', false, async (_r, _u, [code]) => {
  const png = await shareCard(code);
  if (!png) throw new HttpError(404, 'no such alert');
  return new Raw({ status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }, body: png });
});
route('GET', '/a/:code', false, (req, _u, [code]) => new Raw(shareLink(code, String(req.headers['user-agent'] ?? ''), origin(req))));
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
    const key = body?.targetKey ?? follows[Math.floor(Math.random() * follows.length)]?.target_key;
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
      if (req.method === 'POST' || req.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      }
      const out = await r.fn(req, url, url.pathname.match(r.re)!.slice(1), body);
      if (out instanceof Html) return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }).end(out.body);
      if (out instanceof Raw) return void res.writeHead(out.reply.status, out.reply.headers).end(out.reply.body);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out ?? null));
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
