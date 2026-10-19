// Special Events beyond today's scoreboard (Scores tab → "Special Events"): a postseason series' game-by-game
// ledger, the playoff games and series coming in the next 7 days, and each device's vote on who it wants to lose.
//  - Ledger: the scoreboard only has today's game. A series' results come from a team's postseason schedule
//    (seasontype=3), keyed by `seriesKey` (not by game id: a rained-out game's makeup has a new id) and added
//    to each of the series' cards as `event.games` (scores.ts setSeriesGames). Read often while a game is on or
//    just ended, rarely otherwise.
//  - Regular season (MLB): a series is the back-to-back games of the same two teams at one park (a gap over 3 days
//    starts another), found in the home team's regular-season schedule (seasontype=2, regularSeries) and added to the
//    card as `series` (scores.ts setCardSeries) so it shows the same strip as a playoff card, and its finals are saved like
//    a playoff series'. No votes, alert toggle or Special Events. Read every 2 minutes while a game is on, else every 6 hours.
//  - Upcoming: the scoreboards of the next 8 days (single dates: ESPN refuses ranges), the postseason games
//    not yet started, a series once (its first game, while it's 0-0), a one-off game (a wild card is a series;
//    the Super Bowl is one game) once. Every 30 minutes; a failed read keeps the last list.
//  - Votes: one per device per series or game, changeable, until the first game starts, and then, for a series, until
//    it is won (startedFor: the series on the board under way, shown under their scoreboard; a won series keeps its
//    results for a device that voted, and takes no more votes). The percentages are withheld until the device has
//    voted (server-side, so a client can't peek). Ballots are open to anyone who registers a
//    device (docs/known-limits.md).
//  - The alert toggle under a vote ("Alert me when X loses", default off): a temporary row in `follows` for the
//    team the device voted to lose (event_key = the vote key, event_until = the cap), so every tracked-team alert
//    works as if the device tracked it. endEventAlerts drops those rows silently (no alert, no notice) when the
//    series is won or the one game is final, or at the cap. A team the device tracks itself is left alone. No new
//    alert kind or id, so this isn't an alert file (docs/duplicate-alerts.md).
//  - Saved games: a card is dropped from the board 36 h after its start (and a restart empties it), so each final of a
//    series on the board is saved with its box score (kv `series-games:<seriesKey>`, keepSeriesGames; earlier ledger games
//    the board forgot are rebuilt from their day's scoreboard, ledgerCard) and served by
//    GET /me/games/:key when the board no longer has it (savedGame). Dropped once the series is won and none of its
//    cards is on the board (the card has left Special Events), or at the cap. Not alert state.
import { getJson as espnGetJson, mapLimit } from './espn.ts';
import { db, kvGet, kvSet } from './db.ts';
import type { BoxScore } from './boxscore.ts';
import { teamKey, urls, type League } from './leagues.ts';
import { cardList, forgetDeviceTeams, gameCard, gameDetail, setCardSeries, setSeriesGames, type GameCard, type RegularSeries, type SeriesGame } from './scores.ts';

/** Seam for tests (test/series.test.ts). Production never changes it. */
export const seriesDeps = { getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number }) => Promise<any> };

const LIVE_READ_MS = 60_000;          // a series with a game on, or a finished game its ledger lacks
const IDLE_READ_MS = 30 * 60_000;     // between games
const REG_LIVE_READ_MS = 2 * 60_000;  // regular season: the same, but up to 15 games at once
const REG_IDLE_READ_MS = 6 * 3600_000;
const REG_KEEP_MS = 3 * 86400_000;      // a regular-season series' saved games, after its last game
const AHEAD_MS = 7 * 86400_000;
const UPCOMING_LEAGUES: League[] = ['mlb', 'nfl', 'nba', 'nhl', 'wnba'];

const headlineOf = (c: any): string => String((c?.notes ?? []).map((n: any) => n.headline).find(Boolean) ?? '');

/** One game of a series from a schedule event; null for a postponed game (its makeup is a game of its own). score is the winner's then the loser's. */
function seriesGameOf(lg: League, ev: any, n: number): SeriesGame | null {
  const c = ev.competitions?.[0], state = c?.status?.type?.state;
  if (state === 'post' && c.status.type.completed !== true) return null;
  const won = c.competitors.find((x: any) => x.winner === true);
  const lost = c.competitors.find((x: any) => x.winner === false);
  const pts = (x: any) => Number(x.score?.value ?? x.score);
  return {
    n, id: String(ev.id), state, startsAt: Date.parse(ev.date),
    ...(state === 'post' && won && lost ? { winner: teamKey(lg, String(won.id)), score: [pts(won), pts(lost)] as [number, number] } : {}),
  };
}

/**
 * One series' games from a team's postseason schedule: oldest first, a postponed game left out (its makeup
 * is a game of its own), "If Necessary" games marked. score is the winner's then the loser's. Pure, for tests on real payloads.
 */
export function ledgerFromSchedule(lg: League, res: any, name: string, a: string, b: string): SeriesGame[] {
  const want = new Set([String(a), String(b)]);
  const out: SeriesGame[] = [];
  for (const ev of res?.events ?? []) {
    const c = ev.competitions?.[0], headline = headlineOf(c);
    const [round] = headline.split(/\s+-\s+/);
    const ids = (c?.competitors ?? []).map((x: any) => String(x.id));
    if (round !== name || ids.length !== 2 || !ids.every((id: string) => want.has(id))) continue;
    const n = Number(headline.match(/\bgame (\d+)/i)?.[1]);
    if (!Number.isFinite(n)) continue;
    const g = seriesGameOf(lg, ev, n);
    if (g) out.push({ ...g, ...(/\bif necessary\b/i.test(headline) ? { ifNeeded: true } : {}) });
  }
  return out.sort((x, y) => x.n - y.n);
}

/**
 * The regular-season series a game is in, from the home team's schedule (seasontype=2): the run of back-to-back games
 * of the same two teams at the same park, a postponed game left out and a gap of more than 3 days starting another.
 * Null for a game not in it (the All-Star Game) or alone in its run. Pure, for tests on real payloads.
 */
export function regularSeries(lg: League, res: any, gameId: string): RegularSeries | null {
  let run: { ev: any; home: string; pair: string }[] = [], found: typeof run | undefined;
  const flush = () => { if (run.some((x) => String(x.ev.id) === gameId)) found = run; };
  for (const ev of res?.events ?? []) {
    const cs: any[] = ev.competitions?.[0]?.competitors ?? [];
    const home = cs.find((x) => x.homeAway === 'home');
    if (cs.length !== 2 || !home || (ev.competitions[0].status?.type?.state === 'post' && ev.competitions[0].status.type.completed !== true)) continue;
    const next = { ev, home: String(home.id), pair: cs.map((x) => String(x.id)).sort().join('-') };
    const last = run[run.length - 1];
    if (last && (last.home !== next.home || last.pair !== next.pair || Date.parse(ev.date) - Date.parse(last.ev.date) > 3 * 86400_000)) { flush(); run = []; }
    run.push(next);
  }
  flush();
  if (!found || found.length < 2) return null;
  const games = found.map((x, i) => seriesGameOf(lg, x.ev, i + 1)!);
  return { key: `${lg}:${etDay(games[0].startsAt)}:${found[0].pair}`, games };
}

// ─── Ledgers ──────────────────────────────────────────────────────────────────────────────────
const readAt = new Map<string, number>(); // seriesKey → when its ledger was last read
let reading = false;

/** The series on the scoreboard whose ledger is due: read the postseason schedule of one of its teams. */
export async function refreshSeries(now = Date.now()) {
  if (reading) return;
  reading = true;
  try {
    const bySeries = new Map<string, GameCard[]>();
    for (const g of cardList()) if (g.event?.seriesKey) bySeries.set(g.event.seriesKey, [...(bySeries.get(g.event.seriesKey) ?? []), g]);
    const due = [...bySeries].filter(([key, cards]) => {
      const ledger = cards[0].event?.games ?? [];
      const behind = cards.some((g) => g.state === 'post' && !ledger.some((x) => x.id === g.id && x.state === 'post'));
      const hot = cards.some((g) => g.state === 'in') || behind;
      return now - (readAt.get(key) ?? 0) >= (hot ? LIVE_READ_MS : IDLE_READ_MS);
    });
    await mapLimit(due, 3, async ([key, cards]) => {
      const g = cards[0];
      try {
        const res = await seriesDeps.getJson(`${urls.teamSchedule(g.league, g.home!.team.espnId)}?seasontype=3`, { timeoutMs: 10_000 });
        const games = ledgerFromSchedule(g.league, res, g.event!.name, g.home!.team.espnId, g.away!.team.espnId);
        readAt.set(key, now);
        if (games.length) setSeriesGames(key, games);
      } catch { /* try again next tick */ }
    });
    await refreshRegular(now);
  } finally { reading = false; }
  endEventAlerts(now);
  await keepSeriesGames(now).catch(() => {}); // a failed read of ESPN's summary tries again next tick
}

/** The MLB regular-season games on the board, by home team: read that team's schedule when due and give each game its series. */
async function refreshRegular(now: number) {
  const byHome = new Map<string, GameCard[]>();
  for (const g of cardList()) if (g.league === 'mlb' && !g.event && !g.home!.team.espnId.startsWith('-')) byHome.set(g.home!.team.espnId, [...(byHome.get(g.home!.team.espnId) ?? []), g]);
  const due = [...byHome].filter(([home, cards]) => {
    const behind = cards.some((g) => g.state === 'post' && g.series && !g.series.games.some((x) => x.id === g.id && x.winner));
    return now - (readAt.get(`reg:${home}`) ?? 0) >= (behind || cards.some((g) => g.state === 'in') ? REG_LIVE_READ_MS : REG_IDLE_READ_MS);
  });
  await mapLimit(due, 3, async ([home, cards]) => {
    try {
      const res = await seriesDeps.getJson(`${urls.teamSchedule('mlb', home)}?seasontype=2`, { timeoutMs: 10_000 });
      readAt.set(`reg:${home}`, now);
      for (const g of cards) { const s = regularSeries('mlb', res, g.id); if (s) setCardSeries(g.key, s); }
    } catch { /* try again next tick */ }
  });
}

// ─── Saved box scores ─────────────────────────────────────────────────────────────────────────
// A series' finished games stay tappable on its card for as long as the series is on Special Events (a regular-season
// series: until 3 days after its last game), but the board forgets
// a game a day and a half after it was played (scores.ts pruneGames) and ESPN's scoreboard has only today's. Each final is
// saved (its card and box score) in `kv` under its series, and dropped once the series is won and no card of it is left
// on the board. A series that never shows a winner (a postponed finish) is dropped after SERIES_ALERT_MS.
const SAVED = 'series-games:';
interface SavedGame { card: GameCard; box: BoxScore | null; at: number }
type SavedSeries = Record<string, SavedGame>;
const missed = new Set<string>(); // ledger games ESPN's scoreboards no longer have
const savedKeys = () => (db.prepare('SELECT key FROM kv WHERE key LIKE ?').all(`${SAVED}%`) as { key: string }[]).map((r) => r.key);

/** A saved game's card and box score by game key, for a game the board no longer has (GET /me/games/:key). */
export function savedGame(gameKey: string): SavedGame | undefined {
  for (const k of savedKeys()) { const g = kvGet<SavedSeries>(k)?.[gameKey]; if (g) return g; }
  return undefined;
}

/**
 * Save each final game of the series on the board (its box score is retried for an hour if ESPN has none yet), including
 * the earlier games its ledger lists that the board has already forgotten (rebuilt from that day's scoreboard, which ESPN
 * keeps), then drop the series that are over and gone from the board.
 */
export async function keepSeriesGames(now = Date.now()) {
  const onBoard = new Set<string>(), keys = new Set(cardList().map((g) => g.key));
  const finals: { g: GameCard; sk: string }[] = [];
  for (const g of cardList()) {
    const sk = g.event?.seriesKey ?? g.series?.key;
    if (!sk) continue;
    onBoard.add(sk);
    if (g.state === 'post') finals.push({ g, sk });
    for (const l of g.event?.games ?? g.series?.games ?? []) {
      const key = `${g.league}:${l.id}`;
      if (l.state !== 'post' || missed.has(key) || keys.has(key) || kvGet<SavedSeries>(SAVED + sk)?.[key] || finals.some((f) => f.g.key === key)) continue;
      const old = await ledgerCard(g, l);
      if (old) finals.push({ g: old, sk }); else missed.add(key); // not asked again until a restart
    }
  }
  for (const { g, sk } of finals) {
    const have = kvGet<SavedSeries>(SAVED + sk)?.[g.key];
    if (g.series && have && (have.box || now - have.at > 3600_000)) continue; // a regular-season final doesn't change: not rewritten every tick
    const box = have && (have.box || now - have.at > 3600_000) ? have.box : (await gameDetail(g).catch(() => null))?.box ?? null;
    kvSet(SAVED + sk, { ...kvGet<SavedSeries>(SAVED + sk), [g.key]: { card: g, box, at: have?.at ?? now } });
  }
  for (const k of savedKeys()) {
    if (onBoard.has(k.slice(SAVED.length))) continue;
    const games = Object.values(kvGet<SavedSeries>(k) ?? {});
    const newest = games.reduce((a, b) => (b.card.startsAt > a.card.startsAt ? b : a), games[0]);
    // a regular-season series is over when its last game was played 3 days ago (the board forgets a card after 36 hours)
    if (!newest || won(newest.card) || now - newest.card.startsAt > (newest.card.series ? REG_KEEP_MS : SERIES_ALERT_MS)) db.prepare('DELETE FROM kv WHERE key = ?').run(k);
  }
}

/** A finished game of a series that the board forgot: its card from the scoreboard of its day (ET; the day before is tried too, for a game filed under UTC), carrying the series. Null when ESPN no longer has it. */
async function ledgerCard(from: GameCard, l: SeriesGame): Promise<GameCard | null> {
  for (const d of [etDay(l.startsAt), etDay(l.startsAt - 86400_000)]) {
    try {
      const ev = (await seriesDeps.getJson(urls.scoreboard(from.league, d), { timeoutMs: 10_000 }))?.events?.find((e: any) => String(e.id) === l.id);
      const c = ev && gameCard(from.league, ev);
      if (c) return { ...c, event: c.event ?? from.event, ...(from.series ? { series: from.series } : {}) };
    } catch { /* tried again on the next tick */ }
  }
  return null;
}

// ─── Upcoming ─────────────────────────────────────────────────────────────────────────────────
let upcoming: GameCard[] = [];

const etDay = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t)).replaceAll('-', '');
const voteKey = (g: GameCard) => g.event?.seriesKey ?? g.key;

/** The postseason games not yet started and within a week, one per series (its first game) or one-off game. Pure, for tests. */
export function pickUpcoming(games: GameCard[], onBoard: GameCard[], now = Date.now()): GameCard[] {
  const started = new Set(onBoard.filter((g) => g.state !== 'pre' && g.event?.seriesKey).map((g) => g.event!.seriesKey));
  const out = new Map<string, GameCard>();
  for (const g of [...games].sort((a, b) => a.startsAt - b.startsAt)) {
    if (g.state !== 'pre' || !g.event || g.startsAt < now || g.startsAt > now + AHEAD_MS) continue;
    if (g.home!.team.espnId.startsWith('-') || g.away!.team.espnId.startsWith('-')) continue; // a team not decided yet (ESPN's "Rays/Guardians", id -2)
    const { seriesKey, wins } = g.event;
    if (seriesKey && (started.has(seriesKey) || (wins ? wins.home + wins.away : 0) > 0)) continue;
    if (!out.has(voteKey(g))) out.set(voteKey(g), g);
  }
  return [...out.values()];
}

/** Read the next 8 days of every league that has playoff games; replace the list only when every read worked. */
export async function refreshUpcoming(now = Date.now()) {
  const days = Array.from({ length: 8 }, (_, i) => etDay(now + i * 86400_000));
  const reads = UPCOMING_LEAGUES.flatMap((lg) => days.map((d) => [lg, d] as const));
  let failed = false;
  const found: GameCard[] = [];
  await mapLimit(reads, 4, async ([lg, d]) => {
    try {
      const res = await seriesDeps.getJson(urls.scoreboard(lg, d), { timeoutMs: 10_000 });
      for (const ev of res?.events ?? []) { const g = gameCard(lg, ev); if (g) found.push(g); }
    } catch { failed = true; }
  });
  if (!failed) upcoming = pickUpcoming(found, cardList(), now);
}

export interface UpcomingItem {
  voteKey: string;
  game: GameCard;
  closed?: true;                       // a series that has been won: results only
  mine?: string;                       // the team key this device wants to lose
  alert?: 'event' | 'tracked';         // the toggle: 'event' = alerts on for this event, 'tracked' = the device already tracks that team
  votes?: Record<string, number>;      // team key → votes; only once this device has voted
}

function item(deviceId: string, g: GameCard, closed = false): UpcomingItem {
  const key = voteKey(g), base: UpcomingItem = { voteKey: key, game: g, ...(closed ? { closed } : {}) };
  const mine = (db.prepare('SELECT team_key FROM event_votes WHERE event_key = ? AND device_id = ?').get(key, deviceId) as { team_key: string } | undefined)?.team_key;
  if (!mine) return base;
  const fol = db.prepare('SELECT event_key FROM follows WHERE device_id = ? AND target_key = ?').get(deviceId, mine) as { event_key: string | null } | undefined;
  const alert = fol ? (fol.event_key === key ? 'event' as const : fol.event_key ? undefined : 'tracked' as const) : undefined;
  const votes: Record<string, number> = { [g.home!.team.key]: 0, [g.away!.team.key]: 0 };
  for (const r of db.prepare('SELECT team_key, COUNT(*) AS n FROM event_votes WHERE event_key = ? GROUP BY team_key').all(key) as { team_key: string; n: number }[]) votes[r.team_key] = r.n;
  return { ...base, mine, votes, ...(alert ? { alert } : {}) };
}

export const upcomingFor = (deviceId: string): UpcomingItem[] => upcoming.map((g) => item(deviceId, g));

const won = (g: GameCard) => {
  const w = g.event?.wins, need = g.event?.bestOf ? Math.ceil(g.event.bestOf / 2) : 0;
  return !!w && need > 0 && Math.max(w.home, w.away) >= need;
};

/** The series on the board that have started (a game on or done, or a win on the books), one card each (the newest game's), both teams known. */
function startedCards(): Map<string, GameCard> {
  const out = new Map<string, GameCard>();
  for (const g of cardList()) {
    const key = g.event?.seriesKey;
    if (!key || g.home!.team.espnId.startsWith('-') || g.away!.team.espnId.startsWith('-')) continue;
    if ((g.state !== 'pre' || (g.event!.wins ? g.event!.wins.home + g.event!.wins.away : 0) > 0) && g.startsAt >= (out.get(key)?.startsAt ?? 0)) out.set(key, g); // the newest game's card has the latest wins
  }
  return out;
}

/** Started series for the Special Events cards: open until won; a won series is listed (closed) only for a device that voted. */
export const startedFor = (deviceId: string): UpcomingItem[] =>
  [...startedCards().values()].map((g) => item(deviceId, g, won(g))).filter((i) => !i.closed || i.mine);

/** The event a device can still vote on (or set alerts for): its first game not started, or a series not yet won. */
function openEvent(key: string, now: number): GameCard | undefined {
  const live = startedCards().get(key);
  return upcoming.find((x) => voteKey(x) === key && x.startsAt > now) ?? (live && !won(live) ? live : undefined);
}

// shortcut: a series has no known end date, so its alerts are cut off after 21 days (a best of 7 is about 2 weeks), a one-off game after 12 hours, if the board never shows the finish.
const SERIES_ALERT_MS = 21 * 86400_000;
const GAME_ALERT_MS = 12 * 3600_000;

/** After the event is over, alerts last this long, so the deciding game's loss, recap and late ESPN edits still reach the device. */
const OVER_GRACE_MS = 3 * 3600_000;
const setFollow = (deviceId: string, team: string, g: GameCard, now: number) =>
  db.prepare(`INSERT INTO follows (device_id, target_key, created_at, event_key, event_until) VALUES (?,?,?,?,?)
    ON CONFLICT (device_id, target_key) DO UPDATE SET event_key = excluded.event_key, event_until = excluded.event_until WHERE follows.event_key IS NOT NULL`)
    .run(deviceId, team, now, voteKey(g), Math.max(g.startsAt, now) + (g.event?.seriesKey ? SERIES_ALERT_MS : GAME_ALERT_MS));

/** Record (or change) a device's vote; null when the event isn't open for voting or the team isn't one of its two. A vote's alerts move with it. */
export function castVote(deviceId: string, key: string, team: string, now = Date.now()): UpcomingItem | null {
  const g = openEvent(key, now);
  if (!g || (team !== g.home!.team.key && team !== g.away!.team.key)) return null;
  const before = db.prepare('SELECT team_key FROM event_votes WHERE event_key = ? AND device_id = ?').get(key, deviceId) as { team_key: string } | undefined;
  db.prepare('INSERT INTO event_votes (event_key, device_id, team_key, voted_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_key, device_id) DO UPDATE SET team_key = excluded.team_key, voted_at = excluded.voted_at')
    .run(key, deviceId, team, now);
  if (before && before.team_key !== team && db.prepare('DELETE FROM follows WHERE device_id = ? AND target_key = ? AND event_key = ?').run(deviceId, before.team_key, key).changes) {
    setFollow(deviceId, team, g, now);
    forgetDeviceTeams(deviceId);
  }
  return item(deviceId, g);
}

/**
 * The alert toggle under a vote: tracks the team the device voted to lose, as if it had tracked it itself, until the event is over
 * (endEventAlerts). Null when the event is closed or the device hasn't voted. A team the device already tracks is left alone ('tracked').
 */
export function setAlert(deviceId: string, key: string, on: boolean, now = Date.now()): UpcomingItem | null {
  const g = openEvent(key, now);
  const mine = (db.prepare('SELECT team_key FROM event_votes WHERE event_key = ? AND device_id = ?').get(key, deviceId) as { team_key: string } | undefined)?.team_key;
  if (!g || !mine) return null;
  if (on) setFollow(deviceId, mine, g, now);
  else db.prepare('DELETE FROM follows WHERE device_id = ? AND target_key = ? AND event_key = ?').run(deviceId, mine, key);
  forgetDeviceTeams(deviceId);
  return item(deviceId, g);
}

/** Is the event over: its series won, or its one game final. */
function eventOver(key: string): boolean {
  const s = startedCards().get(key);
  if (s) return won(s);
  return cardList().some((g) => g.key === key && g.state === 'post');
}

/** Drop the alert follows of finished events, silently (no notice, no alert), a grace period after the event is over. Run with each series read. */
export function endEventAlerts(now = Date.now()) {
  const rows = db.prepare('SELECT DISTINCT event_key FROM follows WHERE event_key IS NOT NULL').all() as { event_key: string }[];
  for (const { event_key } of rows) {
    if (eventOver(event_key)) db.prepare('UPDATE follows SET event_until = MIN(event_until, ?) WHERE event_key = ?').run(now + OVER_GRACE_MS, event_key);
    const gone = db.prepare('SELECT device_id FROM follows WHERE event_key = ? AND event_until <= ?').all(event_key, now) as { device_id: string }[];
    if (!gone.length) continue;
    db.prepare('DELETE FROM follows WHERE event_key = ? AND event_until <= ?').run(event_key, now);
    for (const { device_id } of gone) forgetDeviceTeams(device_id);
  }
}

/** Test seam: replace the upcoming list. */
export const setUpcoming = (games: GameCard[]) => { upcoming = games; };
