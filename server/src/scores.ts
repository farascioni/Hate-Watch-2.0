// Live scores for the app's Scores tab. The live engine already reads every league's ESPN scoreboard
// every 10s (and each tracked live game's summary every 2s, F1's scoreboard every 30s). This keeps one
// card per game from those reads and pushes { kind: 'score', game } to connected devices that track a
// team in the game, or a player on one. GET /me/scores lists a device's games; GET /me/games/<key> adds
// its alerts from that game and the play-by-play.
import { getJson as espnGetJson } from './espn.ts';
import { db } from './db.ts';
import { catalog, teamDto } from './catalog.ts';
import { ordinal } from './detectors.ts';
import { playerKey, teamKey, urls, type League } from './leagues.ts';
import { sendToConnected } from './fanout.ts';

/** Seam for tests (test/scores.test.ts). Production never changes it. */
export const scoresDeps = {
  getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number; bust?: boolean }) => Promise<any>,
};

type TeamDto = ReturnType<typeof teamDto>;
export interface Side { team: TeamDto; score: number | null; winner?: boolean }
export interface Driver { athleteId: string; key: string; name: string; position: number | null; teamKey?: string }
/** MLB: who's pitching and who's up. `line` is ESPN's (pitcher "4.1 IP, 0 ER, 5 K"; batter "0-2" today). */
export interface AtBatPlayer { id: string; key: string; name: string; line?: string; pitches?: number }
export interface GameCard {
  key: string;            // `${league}:${ESPN event id}` (F1: `f1:${session id}`)
  league: League;
  id: string;             // ESPN event id (F1: the session's competition id), also events.game_id
  state: 'pre' | 'in' | 'post';
  startsAt: number;
  detail: string;         // ESPN's short status: "Q4 - 2:14", "Bot 8th", "Final/OT" ('' before the start)
  home?: Side;
  away?: Side;
  possession?: string;    // NFL: team key with the ball
  downDistance?: string;  // NFL: "3rd & 8 at NO 41"
  redZone?: boolean;      // NFL
  bases?: { first: boolean; second: boolean; third: boolean; outs: number }; // MLB
  batting?: string;       // MLB: team key at bat
  count?: { balls: number; strikes: number }; // MLB: the at-bat's count
  pitcher?: AtBatPlayer;  // MLB: pitches = thrown today (from the box score)
  batter?: AtBatPlayer;
  winProb?: { home: number; away: number }; // chance each side wins, where ESPN publishes it (NFL, MLB)
  session?: string;       // F1: "Singapore GP · Race"
  order?: Driver[];       // F1: running order / classification
}

// ─── Building cards from ESPN ─────────────────────────────────────────────────────────────────
function sideTeam(lg: League, c: any): TeamDto {
  const t = catalog.teamByEspn(lg, String(c.id));
  if (t) return teamDto(t);
  const st = c.team ?? {};
  return {
    kind: 'team', key: teamKey(lg, String(c.id)), league: lg, espnId: String(c.id), name: st.displayName ?? st.name ?? '?',
    shortName: st.shortDisplayName ?? st.name ?? '?', abbrev: st.abbreviation ?? '?', location: st.location ?? null,
    color: st.color ? `#${st.color}` : null, altColor: null, logo: st.logo ?? '', logoDark: null, logoW: 500, logoH: 500,
  };
}

/** One game from a scoreboard event (NBA, MLB, NFL, NHL). Pure, so it can be tested on real payloads. */
export function gameCard(lg: League, ev: any): GameCard | null {
  const c = ev?.competitions?.[0];
  const home = c?.competitors?.find((x: any) => x.homeAway === 'home');
  const away = c?.competitors?.find((x: any) => x.homeAway === 'away');
  if (!home || !away) return null;
  const state = (['pre', 'in', 'post'].includes(ev.status?.type?.state) ? ev.status.type.state : 'pre') as GameCard['state'];
  const side = (x: any): Side => ({
    team: sideTeam(lg, x),
    score: state === 'pre' || x.score == null || x.score === '' ? null : Number(x.score),
    ...(x.winner === true ? { winner: true } : {}),
  });
  const card: GameCard = {
    key: `${lg}:${ev.id}`, league: lg, id: String(ev.id), state, startsAt: Date.parse(ev.date),
    detail: state === 'pre' ? '' : String(ev.status?.type?.shortDetail ?? ''),
    home: side(home), away: side(away),
  };
  const sit = c.situation;
  if (state === 'in' && sit) {
    if (lg === 'nfl') {
      if (sit.possession != null) card.possession = teamKey('nfl', String(sit.possession));
      if (sit.downDistanceText ?? sit.shortDownDistanceText) card.downDistance = String(sit.downDistanceText ?? sit.shortDownDistanceText);
      if (sit.isRedZone) card.redZone = true;
    }
    if (lg === 'mlb') {
      card.bases = { first: !!sit.onFirst, second: !!sit.onSecond, third: !!sit.onThird, outs: Number(sit.outs ?? 0) };
      const half = card.detail.match(/^(Top|Bot)/)?.[1]; // "Mid 5th" / "End 4th": between halves, nobody's up
      if (half) card.batting = half === 'Top' ? card.away!.team.key : card.home!.team.key;
      const who = (x: any): AtBatPlayer | undefined => {
        const id = x?.playerId ?? x?.athlete?.id;
        if (id == null) return undefined;
        const name = x.athlete?.shortName ?? x.athlete?.displayName ?? catalog.playerByEspn('mlb', String(id))?.name ?? '?';
        return { id: String(id), key: playerKey('mlb', String(id)), name, ...(x.summary ? { line: String(x.summary) } : {}) };
      };
      card.pitcher = who(sit.pitcher);
      card.batter = who(sit.batter);
      if (card.batter) card.count = { balls: Number(sit.balls ?? 0), strikes: Number(sit.strikes ?? 0) };
    }
    const pr = sit.lastPlay?.probability;
    if (pr?.homeWinPercentage != null) card.winProb = winProb(pr);
  }
  return card;
}

/** MLB: pitches thrown by each pitcher today, from a summary's box score ("PC", or the first half of "PC-ST"). */
export function boxPitchCounts(summary: any): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const t of summary?.boxscore?.players ?? []) {
    for (const st of t.statistics ?? []) {
      if (st.type !== 'pitching' && st.name !== 'pitching') continue;
      const labels: string[] = st.labels ?? st.keys ?? [];
      const pc = labels.indexOf('PC'), pcst = labels.indexOf('PC-ST');
      for (const a of st.athletes ?? []) {
        const v = pc >= 0 ? Number(a.stats?.[pc]) : pcst >= 0 ? Number(String(a.stats?.[pcst] ?? '').split('-')[0]) : NaN;
        if (a.athlete?.id != null && Number.isFinite(v)) out[String(a.athlete.id)] = v;
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** ESPN's { homeWinPercentage, tiePercentage } (0..1) as each side's chance to win. */
export function winProb(p: { homeWinPercentage: number; tiePercentage?: number }) {
  const r = (x: number) => Math.round(x * 1000) / 1000; // float noise would look like a change worth pushing
  const home = Number(p.homeWinPercentage);
  return { home: r(home), away: r(Math.max(0, 1 - home - Number(p.tiePercentage ?? 0))) };
}

/** One F1 session (race, sprint or qualifying) from the F1 scoreboard: the running order is in it. */
export function raceCard(ev: any, comp: any): GameCard {
  const state = (['pre', 'in', 'post'].includes(comp.status?.type?.state) ? comp.status.type.state : 'pre') as GameCard['state'];
  const lap = Number(comp.status?.period ?? 0);
  const order: Driver[] = (comp.competitors ?? []).map((x: any) => {
    const id = String(x.id);
    const p = catalog.playerByEspn('f1', id);
    return { athleteId: id, key: playerKey('f1', id), name: p?.name ?? x.athlete?.displayName ?? '?', position: Number(x.order) || null, ...(p ? { teamKey: p.teamKey } : {}) };
  }).sort((a: Driver, b: Driver) => (a.position ?? 99) - (b.position ?? 99));
  return {
    key: `f1:${comp.id}`, league: 'f1', id: String(comp.id), state, startsAt: Date.parse(comp.date),
    detail: state === 'in' ? (lap ? `Lap ${lap}` : 'Live') : state === 'post' ? 'Final' : '',
    session: `${ev.shortName ?? ev.name} · ${comp.type?.text ?? comp.type?.abbreviation ?? 'Session'}`,
    order,
  };
}

// ─── The live set ─────────────────────────────────────────────────────────────────────────────
const cards = new Map<string, GameCard>();
const lastSent = new Map<string, string>();
/** MLB: pitches thrown per pitcher (athleteId → count), from the tracker's box score reads. */
const pitchCounts = new Map<string, Record<string, number>>();
const withPitches = (g: GameCard): GameCard => {
  const pc = g.pitcher && pitchCounts.get(g.key)?.[g.pitcher.id];
  return pc != null && g.pitcher ? { ...g, pitcher: { ...g.pitcher, pitches: pc } } : g;
};
export const getGame = (key: string) => cards.get(key);

/**
 * Store a card from a scoreboard read (or a tracker update) and push it if anything changed. While a
 * game is live, each side's score only goes up: the scoreboard trails the play-by-play the tracker
 * reads by several seconds, and a stale read must not undo a run the feed already announced.
 */
export function upsertGame(next: GameCard) {
  next = withPitches(next); // the scoreboard has the pitcher; the box score has his pitch count
  const prev = cards.get(next.key);
  if (prev && next.state === 'in' && prev.state === 'in') {
    for (const s of ['home', 'away'] as const) {
      const a = prev[s]?.score, b = next[s]?.score;
      if (next[s] && a != null && (b == null || a > b)) next[s] = { ...next[s]!, score: a };
    }
    if (!next.winProb && prev.winProb) next.winProb = prev.winProb; // from the tracker's summary
  }
  cards.set(next.key, next);
  const json = JSON.stringify(next);
  if (lastSent.get(next.key) === json) return;
  lastSent.set(next.key, json);
  if (prev) broadcast(next); // the first sighting (e.g. right after a restart) is a baseline, not news
}

/** What the game tracker (2s polls of a live game) knows sooner than the scoreboard. */
export function patchGame(key: string, patch: { home?: number; away?: number; winProb?: GameCard['winProb']; pitchCounts?: Record<string, number> }) {
  if (patch.pitchCounts) pitchCounts.set(key, patch.pitchCounts);
  const cur = cards.get(key);
  if (!cur || cur.state !== 'in') return;
  const next: GameCard = withPitches({ ...cur });
  if (patch.home != null && cur.home) next.home = { ...cur.home, score: Math.max(cur.home.score ?? 0, patch.home) };
  if (patch.away != null && cur.away) next.away = { ...cur.away, score: Math.max(cur.away.score ?? 0, patch.away) };
  if (patch.winProb) next.winProb = patch.winProb;
  upsertGame(next);
}

/** After a league's scoreboard read: forget games that left it more than a day and a half ago. */
export function pruneGames(league: League, seen: Set<string>, now = Date.now()) {
  for (const [k, g] of cards) {
    if (g.league === league && !seen.has(k) && now - g.startsAt > 36 * 3600_000) { cards.delete(k); lastSent.delete(k); pitchCounts.delete(k); }
  }
}

// ─── Whose games ──────────────────────────────────────────────────────────────────────────────
interface Mine { teams: Set<string>; f1: boolean }
const mineCache = new Map<string, { at: number; mine: Mine }>();

/** A device's teams: the ones it tracks, plus the team of every player it tracks. */
export function deviceTeams(deviceId: string): Mine {
  const hit = mineCache.get(deviceId);
  if (hit && Date.now() - hit.at < 5000) return hit.mine;
  const keys = (db.prepare('SELECT target_key FROM follows WHERE device_id = ?').all(deviceId) as { target_key: string }[]).map((r) => r.target_key);
  const teams = new Set<string>();
  for (const k of keys) {
    if (k.startsWith('team:')) teams.add(k);
    else { const p = catalog.player(k); if (p) teams.add(p.teamKey); }
  }
  const mine = { teams, f1: keys.some((k) => k.includes(':f1:')) };
  mineCache.set(deviceId, { at: Date.now(), mine });
  return mine;
}
/** Call when a device follows or unfollows, so its scores change right away. */
export const forgetDeviceTeams = (deviceId: string) => mineCache.delete(deviceId);

const involves = (g: GameCard, mine: Mine) =>
  g.league === 'f1' ? mine.f1 : !!(g.home && mine.teams.has(g.home.team.key)) || !!(g.away && mine.teams.has(g.away.team.key));

/** Live now, starting within a day, or finished in the last 16 hours. */
export const inWindow = (g: GameCard, now = Date.now()) =>
  g.state === 'in' || (g.state === 'pre' && g.startsAt - now < 24 * 3600_000) || (g.state === 'post' && now - g.startsAt < 16 * 3600_000);

const RANK = { in: 0, pre: 1, post: 2 } as const;
/** A device's games for the Scores tab: live first, then upcoming, then finals (newest first). */
export function gamesFor(deviceId: string, now = Date.now()): GameCard[] {
  const mine = deviceTeams(deviceId);
  return [...cards.values()]
    .filter((g) => involves(g, mine) && inWindow(g, now))
    .sort((a, b) => RANK[a.state] - RANK[b.state] || (a.state === 'post' ? b.startsAt - a.startsAt : a.startsAt - b.startsAt));
}

function broadcast(g: GameCard) {
  const frame = JSON.stringify({ kind: 'score', game: g });
  sendToConnected(frame, (deviceId) => involves(g, deviceTeams(deviceId)));
}

// ─── Play-by-play for the game screen ─────────────────────────────────────────────────────────
export interface PlayLine { id: string; text: string; when: string; scoring: boolean }
const playCache = new Map<string, { at: number; plays: PlayLine[] }>();

function when(lg: League, p: any) {
  const n = Number(p.period?.number ?? 0);
  const clock = p.clock?.displayValue ? ` ${p.clock.displayValue}` : '';
  if (lg === 'mlb') return `${/top/i.test(p.period?.type ?? '') ? 'Top' : 'Bot'} ${ordinal(n)}`;
  if (lg === 'nhl') return `${n > 3 ? 'OT' : `P${n}`}${clock}`;
  return `${n > 4 ? 'OT' : `Q${n}`}${clock}`;
}

/** The latest 25 plays, newest first. MLB keeps at-bat results only (not every pitch). */
export async function gamePlays(g: GameCard): Promise<PlayLine[]> {
  if (g.league === 'f1') return [];
  const hit = playCache.get(g.key);
  if (hit && Date.now() - hit.at < (g.state === 'in' ? 8000 : 300_000)) return hit.plays;
  const s = await scoresDeps.getJson(urls.summary(g.league, g.id), { timeoutMs: 6000, bust: g.state === 'in' });
  let raw: any[] = g.league === 'nfl'
    ? [...(s.drives?.previous ?? []).flatMap((d: any) => d.plays ?? []), ...(s.drives?.current?.plays ?? [])]
    : (s.plays ?? []);
  if (g.league === 'mlb') raw = raw.filter((p) => p.type?.type === 'play-result' || p.scoringPlay);
  const seen = new Set<string>();
  const plays = raw.filter((p) => p.text && !seen.has(String(p.id)) && seen.add(String(p.id)))
    .slice(-25).reverse()
    .map((p) => ({ id: String(p.id), text: String(p.text), when: when(g.league, p), scoring: !!p.scoringPlay }));
  playCache.set(g.key, { at: Date.now(), plays });
  if (playCache.size > 200) playCache.delete(playCache.keys().next().value!);
  return plays;
}
