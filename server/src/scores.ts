// Live scores for the app's Scores tab. The live engine already reads every league's ESPN scoreboard
// every 10s (and each tracked live game's summary every 2s, F1's scoreboard every 30s). This keeps one
// card per game from those reads and pushes { kind: 'score', game } to connected devices that track a
// team in the game, or a player on one. GET /me/scores lists a device's games, GET /me/scores/all every
// game live or starting within a day (tracked or not); GET /me/games/<key> adds its alerts from that game and the play-by-play.
import { getJson as espnGetJson } from './espn.ts';
import { db } from './db.ts';
import { catalog, teamDto } from './catalog.ts';
import { ordinal } from './detectors.ts';
import { BASKETBALL, LEAGUE_IDS, SOCCER, playerKey, teamKey, urls, type League } from './leagues.ts';
import { getPrefs, sendToConnected } from './fanout.ts';
import { boxScore, type BoxScore } from './boxscore.ts';
import { clipsOf, highlights, type Clip, type Highlights } from './highlights.ts';

/** Seam for tests (test/scores.test.ts). Production never changes it. */
export const scoresDeps = {
  getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number; bust?: boolean }) => Promise<any>,
};

type TeamDto = ReturnType<typeof teamDto>;
export interface Side { team: TeamDto; score: number | null; winner?: boolean }
export interface Driver { athleteId: string; key: string; name: string; position: number | null; teamKey?: string }
/** MLB: who's pitching and who's up. `line` is ESPN's (pitcher "4.1 IP, 0 ER, 5 K"; batter "0-2" today). */
export interface LivePlayer { id: string; key: string; name: string; line?: string; pitches?: number }
export interface GameCard {
  key: string;            // `${league}:${ESPN event id}` (F1: `f1:${session id}`)
  league: League;
  id: string;             // ESPN event id (F1: the session's competition id), also events.game_id
  state: 'pre' | 'in' | 'post';
  startsAt: number;
  /** Finals: when it ended (when we saw it go final; estimated for one already over when first seen). */
  endedAt?: number;
  detail: string;         // ESPN's short status: "Q4 - 2:14", "Bot 8th", "Final/OT" ('' before the start)
  /** Doubleheaders: "Game 1" / "Game 2", from ESPN's note ("Doubleheader - Game 1 - Makeup from May 23"). */
  note?: string;
  home?: Side;
  away?: Side;
  possession?: string;    // NFL: team key with the ball
  downDistance?: string;  // NFL: "3rd & 8 at NO 41"
  redZone?: boolean;      // NFL
  bases?: { first: boolean; second: boolean; third: boolean; outs: number }; // MLB
  batting?: string;       // MLB: team key at bat
  count?: { balls: number; strikes: number }; // MLB: the at-bat's count
  pitcher?: LivePlayer;  // MLB: pitches = thrown today (from the box score)
  batter?: LivePlayer;
  winProb?: { home: number; away: number }; // chance each side wins, where ESPN publishes it (NFL, MLB, NBA)
  lastPlay?: string;      // NBA, NFL, NHL: ESPN's text for the latest play (soccer: the latest goal or card, "57' Goal: A. Isak")
  leaders?: { home?: LivePlayer; away?: LivePlayer }; // NBA: each side's top scorer; NFL: each side's passer
  timeouts?: { home: number; away: number };          // NFL: timeouts left
  shots?: { home: number; away: number };             // NHL: shots on goal (soccer: shots on target)
  redCards?: { home: number; away: number };          // soccer, once anyone's been sent off
  goalies?: { home?: LivePlayer; away?: LivePlayer }; // NHL: who's in net, with saves (from the box score)
  session?: string;       // F1: "Singapore GP · Race"
  order?: Driver[];       // F1: running order / classification
  /** Before the start: each side's chance from the betting line, the line, records and probable starters. */
  preview?: GamePreview;
}

/** What a game that hasn't started looks like, from ESPN's scoreboard (gamePreview). */
export interface GamePreview {
  /** Chance to win, in whole percents adding up to 100, from the moneyline with the bookmaker's margin taken out (soccer: and the draw). */
  chance?: { home: number; away: number; draw?: number };
  /** The line as ESPN shows it ("CLE -115", "DAL -9.5"), the total (over/under) and whose line it is ("DraftKings"). */
  line?: string;
  total?: number;
  source?: string;
  /** Season records: overall, plus the home side's record at home and the away side's on the road. All-zero records (before a team's first game) are left out. */
  records?: { home?: string; away?: string; homeSplit?: string; awaySplit?: string };
  /** MLB's probable starting pitchers ("0-1, 4.15 ERA"), the NHL's probable goalies. */
  starters?: { label: string; home?: LivePlayer; away?: LivePlayer };
  /** Soccer: each side's recent results as ESPN lists them ("LWWWW"). */
  form?: { home?: string; away?: string };
  /** Playoffs: "CHW lead series 2-1". */
  series?: string;
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

/** One game from a scoreboard event (NBA, MLB, NFL, NHL, EPL). Pure, so it can be tested on real payloads. */
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
  if (state === 'pre') {
    const preview = gamePreview(lg, c, home, away);
    if (Object.keys(preview).length) card.preview = preview;
  }
  const doubleheader = (c.notes ?? []).map((n: any) => String(n.headline ?? '')).find((h: string) => /doubleheader/i.test(h));
  const gameNo = doubleheader?.match(/\bgame (\d)\b/i)?.[1];
  if (gameNo) card.note = `Game ${gameNo}`;
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
      const who = (x: any): LivePlayer | undefined => {
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
    // MLB already says who's pitching and who's up; the other sports get the latest play.
    if (lg !== 'mlb' && sit.lastPlay?.text && !/^((end|start) of |official timeout)/i.test(sit.lastPlay.text)) card.lastPlay = String(sit.lastPlay.text);
    if (lg === 'nfl' && sit.homeTimeouts != null && sit.awayTimeouts != null) card.timeouts = { home: Number(sit.homeTimeouts), away: Number(sit.awayTimeouts) };
  }
  if (state !== 'pre') {
    // NBA/WNBA: each side's top scorer, from ESPN's leaders on the scoreboard.
    if (BASKETBALL.has(lg)) {
      const h = leader(lg, home, 'points', 'pts'), a = leader(lg, away, 'points', 'pts');
      if (h || a) card.leaders = { ...(h ? { home: h } : {}), ...(a ? { away: a } : {}) };
    }
    // NFL passers: once it kicks off, the scoreboard only has the game's single passing leader, so
    // each side's comes from the tracker's box score (boxPassers → patchGame).
    // NHL: a side's shots on goal are the other goalie's saves plus its own goals.
    if (lg === 'nhl') {
      const saves = (x: any) => Number(x.statistics?.find((st: any) => st.name === 'saves')?.displayValue);
      const hs = saves(home), as = saves(away);
      if (Number.isFinite(hs) && Number.isFinite(as)) card.shots = { home: as + (card.home!.score ?? 0), away: hs + (card.away!.score ?? 0) };
    }
    // Soccer: shots on target, red cards and the latest goal or card, from the scoreboard's stats and match details.
    if (SOCCER.has(lg)) {
      const onTarget = (x: any) => Number(x.statistics?.find((st: any) => st.name === 'shotsOnTarget')?.displayValue);
      const hs = onTarget(home), as = onTarget(away);
      if (Number.isFinite(hs) && Number.isFinite(as)) card.shots = { home: hs, away: as };
      const details: any[] = c.details ?? [];
      const reds = (x: any) => details.filter((d) => d.redCard && String(d.team?.id) === String(x.id)).length;
      if (details.some((d) => d.redCard)) card.redCards = { home: reds(home), away: reds(away) };
      const last = details.at(-1);
      const who = (last?.athletesInvolved ?? []).map((a: any) => a.shortName ?? a.displayName).filter(Boolean).join(', ');
      if (state === 'in' && last?.type?.text) card.lastPlay = `${last.clock?.displayValue ? `${last.clock.displayValue} ` : ''}${last.type.text}${who ? `: ${who}` : ''}`;
    }
  }
  return card;
}

/** American odds ("-115", "+150", "EVEN") as a chance from 0 to 1, the bookmaker's margin still in. */
function impliedChance(odds: unknown): number | undefined {
  const n = /^\s*even\s*$/i.test(String(odds ?? '')) ? 100 : Number(odds);
  if (!Number.isFinite(n) || Math.abs(n) < 100) return undefined;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

/**
 * Each side's chance to win, in whole percents adding up to 100, from the moneyline: each price's implied
 * chance, divided by their total to take the bookmaker's margin out (CLE -115 / CHW -104: 51% / 49%).
 * Soccer's three-way line has the draw too.
 */
export function lineChances(home: unknown, away: unknown, draw?: unknown): GamePreview['chance'] | undefined {
  const h = impliedChance(home), a = impliedChance(away), d = draw == null ? undefined : impliedChance(draw);
  if (h == null || a == null || (draw != null && d == null)) return undefined;
  const sum = h + a + (d ?? 0);
  const pct = { home: (h / sum) * 100, away: (a / sum) * 100, ...(d != null ? { draw: (d / sum) * 100 } : {}) };
  const out = Object.fromEntries(Object.entries(pct).map(([k, v]) => [k, Math.round(v)])) as Record<string, number>;
  const top = Object.keys(out).reduce((x, y) => (pct[x as keyof typeof pct]! >= pct[y as keyof typeof pct]! ? x : y));
  out[top] += 100 - Object.values(out).reduce((x, y) => x + y, 0); // rounding: the favorite takes the leftover
  return out as GamePreview['chance'];
}

/** Each side's chance from one of ESPN's odds entries: a scoreboard's `odds[0]`, or a summary's `pickcenter[0]` (kept after the final). */
export function oddsChance(lg: League, o: any): GamePreview['chance'] | undefined {
  const ml = (x: any) => x?.close?.odds ?? x?.open?.odds;
  return lineChances(ml(o?.moneyline?.home) ?? o?.homeTeamOdds?.moneyLine, ml(o?.moneyline?.away) ?? o?.awayTeamOdds?.moneyLine,
    SOCCER.has(lg) ? o?.drawOdds?.moneyLine ?? ml(o?.moneyline?.draw) : undefined);
}

/** A game before its start: the line and the chances it gives, records, probable starters, form, series. */
export function gamePreview(lg: League, c: any, home: any, away: any): GamePreview {
  const p: GamePreview = {};
  const o = c.odds?.[0];
  if (o) {
    const chance = oddsChance(lg, o);
    if (chance) p.chance = chance;
    if (o.details) p.line = String(o.details);
    if (o.overUnder != null && Number.isFinite(Number(o.overUnder))) p.total = Number(o.overUnder);
    if ((p.chance || p.line) && o.provider?.name) p.source = String(o.provider.name);
  }
  const rec = (x: any, type: string) => {
    const v = x.records?.find((r: any) => r.type === type)?.summary;
    return v && /[1-9]/.test(String(v)) ? String(v) : undefined; // "0-0": no games yet
  };
  const records = { home: rec(home, 'total'), away: rec(away, 'total'), homeSplit: rec(home, 'home'), awaySplit: rec(away, 'road') };
  if (Object.values(records).some(Boolean)) p.records = Object.fromEntries(Object.entries(records).filter(([, v]) => v)) as GamePreview['records'];
  if (lg === 'mlb' || lg === 'nhl') {
    const starter = (x: any): LivePlayer | undefined => {
      const pr = x.probables?.find((q: any) => /^probableStarting/.test(String(q.name ?? ''))) ?? x.probables?.[0];
      const id = pr?.athlete?.id;
      if (id == null) return undefined;
      const record = String(pr.record ?? '').replace(/^\((.*)\)$/, '$1').trim(); // "(0-1, 4.15)"
      const line = lg === 'mlb' ? record.replace(/, ([\d.]+)$/, ', $1 ERA') : record;
      return { id: String(id), key: playerKey(lg, String(id)), name: pr.athlete.shortName ?? pr.athlete.displayName ?? '?', ...(line ? { line } : {}) };
    };
    const h = starter(home), a = starter(away);
    if (h || a) p.starters = { label: lg === 'mlb' ? 'Probable pitchers' : 'Probable goalies', ...(h ? { home: h } : {}), ...(a ? { away: a } : {}) };
  }
  if (SOCCER.has(lg) && (home.form || away.form)) p.form = { ...(home.form ? { home: String(home.form) } : {}), ...(away.form ? { away: String(away.form) } : {}) };
  if (c.series?.type === 'playoff' && c.series.summary) p.series = String(c.series.summary);
  return p;
}

/** One side's leader in a stat from the scoreboard (e.g. NBA points: "N. Alexander-Walker", "10 pts"). */
function leader(lg: League, side: any, stat: string, unit = ''): LivePlayer | undefined {
  const top = side.leaders?.find((l: any) => l.name === stat)?.leaders?.[0];
  const id = top?.athlete?.id;
  if (id == null) return undefined;
  return { id: String(id), key: playerKey(lg, String(id)), name: top.athlete.shortName ?? top.athlete.displayName ?? '?', line: unit ? `${top.displayValue ?? top.value} ${unit}` : String(top.displayValue ?? top.value) };
}

/**
 * NHL: each side's goalie in net, with saves and shots against, from a summary's box score. `inNet` is
 * the live tracker's goalie per team (teamId → athleteId); without it, the last goalie listed (the
 * one who came in) is in net.
 */
export function boxGoalies(summary: any, inNet?: Map<string, string>): Record<string, LivePlayer> | undefined {
  const out: Record<string, LivePlayer> = {};
  for (const t of summary?.boxscore?.players ?? []) {
    const st = t.statistics?.find((x: any) => x.name === 'goalies' || x.type === 'goalies');
    if (!st?.athletes?.length) continue;
    const labels: string[] = st.labels ?? st.keys ?? [];
    const sv = labels.indexOf('SV'), sa = labels.indexOf('SA');
    const teamId = String(t.team?.id);
    const pick = st.athletes.find((a: any) => String(a.athlete?.id) === inNet?.get(teamId)) ?? st.athletes.at(-1);
    const id = pick?.athlete?.id;
    if (id == null) continue;
    const saves = sv >= 0 ? Number(pick.stats?.[sv]) : NaN, against = sa >= 0 ? Number(pick.stats?.[sa]) : NaN;
    out[teamId] = {
      id: String(id), key: playerKey('nhl', String(id)), name: pick.athlete.shortName ?? pick.athlete.displayName ?? '?',
      ...(Number.isFinite(saves) ? { line: `${saves} save${saves === 1 ? '' : 's'}${Number.isFinite(against) ? ` on ${against}` : ''}` } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/** NFL: each side's passer (the most attempts) with his line ("14/22, 168 YDS, 1 TD, 1 INT"), from a summary's box score. */
export function boxPassers(summary: any): Record<string, LivePlayer> | undefined {
  const out: Record<string, LivePlayer> = {};
  for (const t of summary?.boxscore?.players ?? []) {
    const st = t.statistics?.find((x: any) => x.name === 'passing');
    const labels: string[] = st?.labels ?? [];
    const at = (a: any, l: string) => a.stats?.[labels.indexOf(l)];
    const att = (a: any) => Number(String(at(a, 'C/ATT') ?? '').split('/')[1]) || 0;
    const pick = (st?.athletes ?? []).reduce((best: any, a: any) => (!best || att(a) > att(best) ? a : best), undefined);
    const p = pick?.athlete;
    if (p?.id == null || at(pick, 'C/ATT') == null) continue;
    const td = Number(at(pick, 'TD')), int = Number(at(pick, 'INT'));
    out[String(t.team?.id)] = {
      id: String(p.id), key: playerKey('nfl', String(p.id)),
      name: p.shortName ?? (p.firstName && p.lastName ? `${p.firstName[0]}. ${p.lastName}` : p.displayName ?? '?'), // the box has no shortName
      line: [at(pick, 'C/ATT'), at(pick, 'YDS') != null && `${at(pick, 'YDS')} YDS`, td > 0 && `${td} TD`, int > 0 && `${int} INT`].filter(Boolean).join(', '),
    };
  }
  return Object.keys(out).length ? out : undefined;
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

/**
 * An F1 session's name for people. ESPN names one by its abbreviation alone ("FP1", "SS", "SR", "Qual",
 * "Race"); a name of its own, where a feed has one, is the fallback.
 */
export function sessionName(comp: any): string {
  const names: Record<string, string> = { FP1: 'Practice 1', FP2: 'Practice 2', FP3: 'Practice 3', SS: 'Sprint Shootout', SR: 'Sprint', Qual: 'Qualifying', Race: 'Race' };
  const a = String(comp?.type?.abbreviation ?? '');
  return names[a] ?? comp?.type?.text ?? (a || 'Session');
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
    session: `${ev.shortName ?? ev.name} · ${sessionName(comp)}`,
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
  // Finals stay on the tab for a day after they end: the moment we saw it go final, or, for one
  // already over when first seen (a restart, yesterday's scoreboard), a typical game's length after the start.
  if (next.state === 'post') {
    next.endedAt = prev?.endedAt ?? (prev && prev.state !== 'post' ? Date.now() : Math.min(Date.now(), next.startsAt + GAME_LENGTH_MS[next.league]));
  }
  // NHL goalies and NFL passers come from the tracker's box score (not the scoreboard): keep them, through the final too.
  if (prev?.goalies && !next.goalies && next.state !== 'pre') next.goalies = prev.goalies;
  if (prev?.leaders && !next.leaders && next.state !== 'pre') next.leaders = prev.leaders;
  cards.set(next.key, next);
  const json = JSON.stringify(next);
  if (lastSent.get(next.key) === json) return;
  lastSent.set(next.key, json);
  if (prev) broadcast(next); // the first sighting (e.g. right after a restart) is a baseline, not news
}

/** What the game tracker (2s polls of a live game) knows sooner than the scoreboard. */
export function patchGame(key: string, patch: { home?: number; away?: number; winProb?: GameCard['winProb']; pitchCounts?: Record<string, number>; goalies?: Record<string, LivePlayer>; passers?: Record<string, LivePlayer> }) {
  if (patch.pitchCounts) pitchCounts.set(key, patch.pitchCounts);
  const cur = cards.get(key);
  if (!cur || cur.state !== 'in') return;
  const next: GameCard = withPitches({ ...cur });
  if (patch.home != null && cur.home) next.home = { ...cur.home, score: Math.max(cur.home.score ?? 0, patch.home) };
  if (patch.away != null && cur.away) next.away = { ...cur.away, score: Math.max(cur.away.score ?? 0, patch.away) };
  if (patch.winProb) next.winProb = patch.winProb;
  // teamId → player (boxGoalies / boxPassers) as the card's home and away.
  const sides = (byTeam: Record<string, LivePlayer>) => {
    const h = cur.home && byTeam[cur.home.team.espnId], a = cur.away && byTeam[cur.away.team.espnId];
    return h || a ? { ...(h ? { home: h } : {}), ...(a ? { away: a } : {}) } : undefined;
  };
  if (patch.goalies) next.goalies = sides(patch.goalies) ?? next.goalies;
  if (patch.passers) next.leaders = sides(patch.passers) ?? next.leaders;
  upsertGame(next);
}

/** After a league's scoreboard read: forget games that left it more than a day and a half ago, once their final is off the tab. */
export function pruneGames(league: League, seen: Set<string>, now = Date.now()) {
  for (const [k, g] of cards) {
    if (g.league !== league || seen.has(k) || now - g.startsAt < 36 * 3600_000 || (g.state === 'post' && inWindow(g, now))) continue;
    cards.delete(k); lastSent.delete(k); pitchCounts.delete(k);
  }
}

/** F1's race weekends, from the scoreboard's calendar: when no session is on, the Scores tab says when the next one is. */
export interface F1Weekend { name: string; startsAt: number; endsAt: number }
let f1Weekends: F1Weekend[] = [];
export function setF1Calendar(cal: any) {
  if (!Array.isArray(cal)) return;
  f1Weekends = cal.map((c: any) => ({ name: String(c.label ?? ''), startsAt: Date.parse(c.startDate), endsAt: Date.parse(c.endDate) }))
    .filter((w) => w.name && Number.isFinite(w.startsAt) && Number.isFinite(w.endsAt)).sort((a, b) => a.startsAt - b.startsAt);
}
/** The weekend under way, or else the next one (none after the season's last race). */
export const nextF1Weekend = (now = Date.now()) => f1Weekends.find((w) => w.endsAt > now);

// ─── Whose games ──────────────────────────────────────────────────────────────────────────────
interface Mine { teams: Set<string>; f1: boolean }
const mineCache = new Map<string, { at: number; mine: Mine }>();

/** A device's teams: the ones it tracks, plus the team of every player it tracks, unless that player's "Show their team's games" is off. */
export function deviceTeams(deviceId: string): Mine {
  const hit = mineCache.get(deviceId);
  if (hit && Date.now() - hit.at < 5000) return hit.mine;
  const keys = (db.prepare('SELECT target_key FROM follows WHERE device_id = ?').all(deviceId) as { target_key: string }[]).map((r) => r.target_key);
  const teams = new Set<string>();
  const playerTeams = getPrefs(deviceId).playerTeams ?? {};
  for (const k of keys) {
    if (k.startsWith('team:')) teams.add(k);
    else if (playerTeams[k]?.scores !== false) { const p = catalog.player(k); if (p) teams.add(p.teamKey); }
  }
  const mine = { teams, f1: keys.some((k) => k.includes(':f1:')) };
  mineCache.set(deviceId, { at: Date.now(), mine });
  return mine;
}
/** Call when a device follows or unfollows, so its scores change right away. */
export const forgetDeviceTeams = (deviceId: string) => mineCache.delete(deviceId);

const involves = (g: GameCard, mine: Mine) =>
  g.league === 'f1' ? mine.f1 : !!(g.home && mine.teams.has(g.home.team.key)) || !!(g.away && mine.teams.has(g.away.team.key));

/** How long a final stays on the Scores tab after it ends: the last game a team played, for a day. */
export const KEEP_FINALS_MS = 24 * 3600_000;
/** A typical game, start to final: when a game was already over the first time we saw it. */
export const GAME_LENGTH_MS = {
  mlb: 3 * 3600_000, nfl: 3.25 * 3600_000, nba: 2.25 * 3600_000, wnba: 2 * 3600_000, nhl: 2.5 * 3600_000, f1: 2 * 3600_000,
  ...Object.fromEntries([...SOCCER].map((lg) => [lg, 2 * 3600_000])),
} as Record<League, number>;
/** Live now, starting within a day, or finished in the last 24 hours (every game, so both halves of a doubleheader). */
export const inWindow = (g: GameCard, now = Date.now()) =>
  g.state === 'in' || (g.state === 'pre' && g.startsAt - now < 24 * 3600_000)
  || (g.state === 'post' && now - (g.endedAt ?? g.startsAt + GAME_LENGTH_MS[g.league]) < KEEP_FINALS_MS);

const RANK = { in: 0, pre: 1, post: 2 } as const;
/** A device's games for the Scores tab: live first, then upcoming, then finals (newest first). */
export function gamesFor(deviceId: string, now = Date.now()): GameCard[] {
  const mine = deviceTeams(deviceId);
  return [...cards.values()]
    .filter((g) => involves(g, mine) && inWindow(g, now))
    .sort((a, b) => RANK[a.state] - RANK[b.state] || (a.state === 'post' ? b.startsAt - a.startsAt : a.startsAt - b.startsAt));
}

/**
 * Every game live right now, then every one starting within a day, whoever plays in it: the Scores tab's
 * "All games". Each by league in the app's order, then soonest start. These cards come from the scoreboard
 * reads (every 10s), and from the 2s game tracker too when someone tracks a side; they're pushed only to
 * devices that track a side, so the app polls this.
 */
export function allGames(now = Date.now()): GameCard[] {
  const order = (g: GameCard) => LEAGUE_IDS.indexOf(g.league);
  return [...cards.values()]
    .filter((g) => g.state === 'in' || (g.state === 'pre' && inWindow(g, now)))
    .map(withPitches)
    .sort((a, b) => RANK[a.state] - RANK[b.state] || order(a) - order(b) || a.startsAt - b.startsAt);
}

function broadcast(g: GameCard) {
  const frame = JSON.stringify({ kind: 'score', game: g });
  sendToConnected(frame, (deviceId) => involves(g, deviceTeams(deviceId)));
}

// ─── Play-by-play and box score for the game screen ───────────────────────────────────────────
export interface PlayLine { id: string; text: string; when: string; scoring: boolean }
/** `highlights` is everyone's: the route makes each device's key plays from it (forDevice). */
type Detail = { plays: PlayLine[]; box: BoxScore | null; clips: Clip[]; highlights: Highlights };
const detailCache = new Map<string, { at: number } & Detail>();

function when(lg: League, p: any) {
  const n = Number(p.period?.number ?? 0);
  const clock = p.clock?.displayValue ? ` ${p.clock.displayValue}` : '';
  if (lg === 'mlb') return `${/top/i.test(p.period?.type ?? '') ? 'Top' : 'Bot'} ${ordinal(n)}`;
  if (lg === 'nhl') return `${n > 3 ? 'OT' : `P${n}`}${clock}`;
  if (SOCCER.has(lg)) return p.clock?.displayValue || (n === 2 ? '2nd half' : '1st half'); // the minute: "57'", "90'+4'"
  return `${n > 4 ? 'OT' : `Q${n}`}${clock}`;
}

/**
 * The game screen's box score and highlights (ESPN's clips and the key plays), from one read of ESPN's
 * summary (8s fresh while live). `plays`, the latest 25 of the play-by-play, is for builds from before
 * the Highlights tab: MLB keeps at-bat results only (not every pitch); soccer is its key events.
 */
export async function gameDetail(g: GameCard): Promise<Detail> {
  if (g.league === 'f1') return { plays: [], box: null, clips: [], highlights: { keyPlays: [], alerted: new Map() } };
  const hit = detailCache.get(g.key);
  if (hit && Date.now() - hit.at < (g.state === 'in' ? 8000 : 300_000)) return hit;
  const s = await scoresDeps.getJson(urls.summary(g.league, g.id), { timeoutMs: 6000, bust: g.state === 'in' });
  let raw: any[] = g.league === 'nfl'
    ? [...(s.drives?.previous ?? []).flatMap((d: any) => d.plays ?? []), ...(s.drives?.current?.plays ?? [])]
    : SOCCER.has(g.league) ? (s.keyEvents ?? []).filter((k: any) => !/delay/.test(k.type?.type ?? ''))
    : (s.plays ?? []);
  if (g.league === 'mlb') raw = raw.filter((p) => p.type?.type === 'play-result' || p.scoringPlay);
  const seen = new Set<string>();
  const plays = raw.filter((p) => p.text && !seen.has(String(p.id)) && seen.add(String(p.id)))
    .slice(-25).reverse()
    .map((p) => ({ id: String(p.id), text: String(p.text), when: when(g.league, p), scoring: !!p.scoringPlay }));
  // The plays anyone got an alert for in this game, so each device's key plays can include its own.
  const alertIds = new Set((db.prepare(`SELECT DISTINCT json_extract(meta, '$.playId') AS id FROM events WHERE game_id = ? AND json_extract(meta, '$.playId') IS NOT NULL`)
    .all(g.id) as { id: string }[]).map((r) => String(r.id)));
  const detail = { at: Date.now(), plays, box: boxScore(g, s), clips: clipsOf(s), highlights: highlights(g, s, when, alertIds) };
  detailCache.set(g.key, detail);
  if (detailCache.size > 200) detailCache.delete(detailCache.keys().next().value!);
  return detail;
}

export const gamePlays = async (g: GameCard) => (await gameDetail(g)).plays;
