// Stats pages for players and teams, from ESPN (F1's: f1-stats.ts; the UFC's: ufc.ts). Players: the season line ESPN picks for
// their position (a pitcher's innings and earned runs, a receiver's catches and yards), postseason and
// career, their last five games, and their team's next game. Teams: record and standing, a season stat
// line, their last five results, and their next game. The numbers a hater wants to see (a batter's
// strikeouts, a quarterback's interceptions, a team's turnovers) are marked \`bad\` for the app to show in red.
import { getJson as espnGetJson } from './espn.ts';
import { fighterPage } from './ufc.ts';
import { f1Page } from './f1-stats.ts';
import { catalog } from './catalog.ts';
import { ordinal } from './detectors.ts';
import { LEAGUES, SOCCER, urls, type League } from './leagues.ts';
import { nextGameOf, type NextGame } from './upnext.ts';

/** Seam for tests (test/stats.test.ts). Production never changes it. */
export const statsDeps = { getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number }) => Promise<any> };
const TTL_MS = 10 * 60_000;

export interface StatTile { label: string; name: string; value: string; bad?: boolean }
export interface StatGroup { title: string; tiles: StatTile[] }
/** One of the last games: "vs TB · W 5-3", with the player's line ("1 H · 2 SO") for players. */
export interface GameLine { id: string; date: number; home: boolean; opponent: string; opponentLogo?: string; result: 'W' | 'L' | 'T' | 'D' | ''; score: string; line?: string }
export interface StatsPage {
  key: string; kind: 'team' | 'player'; league: League;
  /** Teams: "93-68 · 2nd in AL East" and the splits ESPN has ("Home 46-34", "Road 47-34"). */
  record?: { overall: string; standing?: string; splits: { label: string; value: string }[] };
  groups: StatGroup[];
  recent: GameLine[];
  next: NextGame | null;
}

// ─── What's bad to have a lot of ──────────────────────────────────────────────────────────────
const BAD: Record<string, string[]> = {
  batter: ['strikeouts', 'caughtStealing', 'groundIntoDoublePlay'],
  pitcher: ['earnedRuns', 'homeRuns', 'walks', 'losses', 'blownSaves'],
  qb: ['interceptions', 'sacks', 'fumbles', 'fumblesLost'],
  football: ['fumbles', 'fumblesLost'],
  basketball: ['avgTurnovers', 'turnovers', 'avgFouls', 'fouls', 'technicalFouls', 'flagrantFouls'],
  skater: ['penaltyMinutes', 'giveaways'],
  goalie: ['goalsAgainst', 'avgGoalsAgainst', 'losses', 'overtimeLosses'],
  soccer: ['foulsCommitted', 'yellowCards', 'redCards', 'ownGoals', 'offsides', 'goalsConceded'],
};
function badFor(lg: League, position: string | null): Set<string> {
  const p = (position ?? '').toUpperCase();
  if (lg === 'mlb') return new Set(BAD[/^(P|SP|RP)$/.test(p) ? 'pitcher' : 'batter']);
  if (lg === 'nfl') return new Set(BAD[p === 'QB' ? 'qb' : 'football']);
  if (lg === 'nhl') return new Set(BAD[p === 'G' ? 'goalie' : 'skater']);
  if (SOCCER.has(lg)) return new Set(BAD.soccer);
  return new Set(BAD.basketball);
}

/** A count worth showing in red: some of it (0 penalty minutes is nothing to gloat about). */
const some = (v: unknown) => Number(String(v ?? '').replace(/,/g, '')) > 0;

/** ESPN's labels, names and values as tiles; \`displayNames\` tell apart a receiver's YDS from his rushing YDS. */
function tiles(labels: string[], names: string[], displayNames: string[], values: string[], bad: Set<string>): StatTile[] {
  return labels.map((label, i) => ({ label, name: String(displayNames[i] ?? label), value: String(values[i] ?? '–'), ...(bad.has(names[i]) && some(values[i]) ? { bad: true } : {}) }))
    .filter((t) => t.value !== '' && t.value !== 'undefined');
}

// ─── Players ──────────────────────────────────────────────────────────────────────────────────
/**
 * A player's page from ESPN's athlete overview: its season split ("Regular Season"; soccer: the league's
 * own competition, "2026-27 English Premier League"), postseason, career, and game log. MLB's overview
 * has only the career line for hitters, so their season row comes from the stats endpoint.
 */
export function playerPage(lg: League, athleteId: string, overview: any, statsRes?: any): Omit<StatsPage, 'next'> {
  const p = catalog.playerByEspn(lg, athleteId);
  const bad = badFor(lg, p?.position ?? null);
  const st = overview?.statistics ?? {};
  const labels: string[] = st.labels ?? [], names: string[] = st.names ?? [], full: string[] = st.displayNames ?? [];
  const splits: { displayName: string; stats: string[] }[] = st.splits ?? [];
  const groups: StatGroup[] = [];
  const own = LEAGUES[lg].fullName;
  const season = splits.find((s) => /regular season/i.test(s.displayName)) ?? (own ? [...splits].reverse().find((s) => s.displayName.includes(own)) : undefined)
    ?? (SOCCER.has(lg) ? splits.find((s) => !/career|projected/i.test(s.displayName)) : undefined);
  if (season) groups.push({ title: season.displayName.replace(/^Regular Season$/, 'Regular season'), tiles: tiles(labels, names, full, season.stats, bad) });
  else {
    // The latest season row of the stats endpoint's first category (MLB hitters: "career-batting").
    const cat = statsRes?.categories?.[0];
    const row = [...(cat?.statistics ?? [])].sort((a: any, b: any) => Number(b.season?.year ?? 0) - Number(a.season?.year ?? 0))[0];
    if (row) groups.push({ title: `${row.season?.displayName ?? row.season?.year} season`, tiles: tiles(cat.labels ?? [], cat.names ?? [], cat.displayNames ?? [], row.stats ?? [], bad) });
  }
  const post = splits.find((s) => /postseason/i.test(s.displayName));
  if (post) groups.push({ title: 'Postseason', tiles: tiles(labels, names, full, post.stats, bad) });
  const career = splits.find((s) => /career/i.test(s.displayName));
  if (career) groups.push({ title: 'Career', tiles: tiles(labels, names, full, career.stats, bad) });

  const log = overview?.gameLog, cols = log?.statistics?.[0];
  const recent: GameLine[] = (cols?.events ?? []).slice(0, 5).flatMap((row: any) => {
    const ev = log.events?.[row.eventId];
    if (!ev) return [];
    // The game in numbers: what they did, up to 10 (zeros after the first left out, and "Started" and the like).
    const pairs = (cols.labels ?? []).map((l: string, i: number) => [String(row.stats?.[i] ?? ''), l] as const)
      .filter(([v]: readonly [string, string], i: number) => /^-?[\d.,:/%-]+$/.test(v) && (i === 0 || v.includes(':') || Number(v.replace(/[,%]/g, '')) !== 0));
    const line = pairs.slice(0, 10).map(([v, l]: readonly [string, string]) => `${v} ${l}`).join(' · ');
    return [{ id: String(row.eventId), date: Date.parse(ev.gameDate), home: ev.atVs !== '@', opponent: String(ev.opponent?.abbreviation ?? '?'), ...(ev.opponent?.logo ? { opponentLogo: String(ev.opponent.logo) } : {}),
      result: (['W', 'L', 'T', 'D'].includes(ev.gameResult) ? ev.gameResult : '') as GameLine['result'], score: String(ev.score ?? ''), line }];
  });
  return { key: `player:${lg}:${athleteId}`, kind: 'player', league: lg, groups, recent };
}

// ─── Teams ────────────────────────────────────────────────────────────────────────────────────
/** A team's season line: [ESPN category, stat name, our label, bad to have a lot of]. */
type Pick = [string, string, string, boolean?];
const BASKETBALL_TEAM: Pick[] = [['offensive', 'avgPoints', 'Points / game'], ['offensive', 'fieldGoalPct', 'FG%'], ['offensive', 'threePointPct', '3P%'], ['general', 'avgRebounds', 'Rebounds / game'],
  ['offensive', 'avgAssists', 'Assists / game'], ['offensive', 'avgTurnovers', 'Turnovers / game', true], ['general', 'avgFouls', 'Fouls / game', true]];
const TEAM_STATS: Partial<Record<League, Pick[]>> = {
  mlb: [['batting', 'avg', 'Batting avg'], ['batting', 'runs', 'Runs'], ['batting', 'homeRuns', 'Home runs'], ['batting', 'OPS', 'OPS'], ['batting', 'strikeouts', 'Strikeouts', true],
    ['pitching', 'ERA', 'ERA'], ['pitching', 'WHIP', 'WHIP'], ['fielding', 'errors', 'Errors', true]],
  nfl: [['scoring', 'totalPointsPerGame', 'Points / game'], ['passing', 'yardsPerGame', 'Yards / game'], ['passing', 'interceptions', 'Interceptions thrown', true], ['miscellaneous', 'totalGiveaways', 'Giveaways', true],
    ['miscellaneous', 'turnOverDifferential', 'Turnover margin'], ['passing', 'sacks', 'Sacks taken', true], ['miscellaneous', 'totalPenalties', 'Penalties', true], ['miscellaneous', 'thirdDownConvPct', '3rd down %']],
  nba: BASKETBALL_TEAM, wnba: BASKETBALL_TEAM,
  nhl: [['offensive', 'goals', 'Goals'], ['defensive', 'goalsAgainst', 'Goals against', true], ['defensive', 'savePct', 'Save %'], ['offensive', 'shootingPct', 'Shooting %'],
    ['offensive', 'powerPlayGoals', 'Power play goals'], ['penalties', 'penaltyMinutes', 'Penalty minutes', true], ['general', 'plusMinus', '+/-']],
};

/** The season line from ESPN's team statistics, titled with the part of the season it covers ("2026 Postseason"). */
export function teamStatGroup(lg: League, res: any): StatGroup | null {
  const picks = TEAM_STATS[lg], cats: any[] = res?.results?.stats?.categories ?? [];
  if (!picks || !cats.length) return null;
  const found = picks.flatMap(([cat, name, label, bad]) => {
    const s = cats.find((c) => c.name === cat)?.stats?.find((x: any) => x.name === name);
    // ESPN's short code on top ("SO"), our words under it ("Strikeouts"), like a player's tiles; where those
    // are the code itself ("ERA"), ESPN's own words ("Earned Run Average").
    const code = String(s?.abbreviation ?? label);
    return s ? [{ label: code, name: label === code ? String(s.displayName ?? label) : label, value: String(s.displayValue), ...(bad && some(s.displayValue) ? { bad: true } : {}) }] : [];
  });
  const part = res.requestedSeason?.name ?? res.season?.name;
  const year = res.requestedSeason?.displayName ?? res.season?.displayName ?? res.season?.year;
  return found.length ? { title: [year, part].filter(Boolean).join(' ').replace('Regular Season', 'regular season'), tiles: found } : null;
}

/** Soccer has no team stat line on ESPN; its table does: position, points, W-D-L, goals. */
export function tableGroup(teamId: string, standings: any): StatGroup | null {
  let entry: any;
  const walk = (n: any) => { for (const e of n?.standings?.entries ?? []) if (String(e.team?.id) === teamId) entry = e; (n?.children ?? []).forEach(walk); };
  walk(standings);
  if (!entry) return null;
  const v = (name: string) => entry.stats?.find((s: any) => s.name === name);
  const n = (name: string) => Number(v(name)?.value ?? 0);
  return {
    title: 'League table',
    tiles: [
      { label: 'POS', name: 'Position', value: ordinal(n('rank')) },
      { label: 'PTS', name: 'Points', value: String(n('points')) },
      { label: 'P', name: 'Played', value: String(n('gamesPlayed')) },
      { label: 'W-D-L', name: 'Won, drawn, lost', value: `${n('wins')}-${n('ties')}-${n('losses')}` },
      { label: 'GF', name: 'Goals for', value: String(n('pointsFor')) },
      { label: 'GA', name: 'Goals against', value: String(n('pointsAgainst')), ...(n('pointsAgainst') > 0 ? { bad: true } : {}) },
      { label: 'GD', name: 'Goal difference', value: String(v('pointDifferential')?.displayValue ?? n('pointDifferential')) },
    ],
  };
}

/** The last five finished games from a team schedule, newest first: "@ BOS · W 9-0". */
export function recentFromSchedule(teamId: string, schedule: any, soccer = false): GameLine[] {
  const score = (c: any) => (typeof c?.score === 'object' ? c.score?.displayValue : c?.score);
  return (schedule?.events ?? [])
    .filter((e: any) => e.competitions?.[0]?.status?.type?.state === 'post')
    .sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date))
    .flatMap((e: any) => {
      const cs = e.competitions[0].competitors ?? [];
      const me = cs.find((c: any) => String(c.id) === teamId), them = cs.find((c: any) => String(c.id) !== teamId);
      if (!me || !them || score(me) == null || score(them) == null) return []; // postponed
      const [a, b] = [Number(score(me)), Number(score(them))];
      const result: GameLine['result'] = me.winner === true || a > b ? 'W' : them.winner === true || a < b ? 'L' : soccer ? 'D' : 'T';
      return [{ id: String(e.id), date: Date.parse(e.date), home: me.homeAway === 'home', opponent: String(them.team?.abbreviation ?? '?'),
        ...(them.team?.logos?.[0]?.href ? { opponentLogo: String(them.team.logos[0].href) } : {}), result, score: `${score(me)}-${score(them)}` }];
    })
    .slice(0, 5);
}

async function teamPage(lg: League, teamId: string): Promise<Omit<StatsPage, 'next'>> {
  const soccer = SOCCER.has(lg);
  const [info, stats, schedule] = await Promise.all([
    statsDeps.getJson(urls.team(lg, teamId), { timeoutMs: 8000 }),
    (soccer ? statsDeps.getJson(urls.standings(lg), { timeoutMs: 8000 }) : statsDeps.getJson(urls.teamStats(lg, teamId), { timeoutMs: 10_000 })).catch(() => null),
    statsDeps.getJson(urls.teamSchedule(lg, teamId), { timeoutMs: 10_000 }).catch(() => null), // soccer's plain schedule is its results
  ]);
  const t = info?.team ?? {};
  const items: any[] = t.record?.items ?? [];
  const overall = items.find((i) => i.type === 'total')?.summary ?? items[0]?.summary;
  const SPLIT: Record<string, string> = { home: 'Home', road: 'Road', away: 'Away' };
  const record = overall ? { overall: String(overall), ...(t.standingSummary ? { standing: String(t.standingSummary) } : {}),
    splits: items.filter((i) => SPLIT[i.type]).map((i) => ({ label: SPLIT[i.type], value: String(i.summary) })) } : undefined;
  const group = soccer ? tableGroup(teamId, stats) : teamStatGroup(lg, stats);
  return { key: `team:${lg}:${teamId}`, kind: 'team', league: lg, ...(record ? { record } : {}), groups: group ? [group] : [], recent: recentFromSchedule(teamId, schedule, soccer) };
}

// ─── Cached, so a busy page is one ESPN read every 10 minutes ────────────────────────────────
const cache = new Map<string, { at: number; page: Promise<StatsPage> }>();

/**
 * A player's or team's stats page (null for the UFC's placeholder team, or a key we don't know). A fighter's
 * is their record (ufc.ts); a driver's or a constructor's, their season (f1-stats.ts).
 */
export async function statsFor(key: string): Promise<StatsPage | null> {
  const [kind, lg, id] = key.split(':') as ['team' | 'player', League, string];
  if ((lg === 'ufc' && kind === 'team') || !LEAGUES[lg] || !(kind === 'team' ? catalog.team(key) : catalog.player(key))) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.page;
  const page = (async (): Promise<StatsPage> => {
    if (lg === 'ufc') return fighterPage(id);
    if (lg === 'f1') return f1Page(kind, id, key);
    if (kind === 'team') return { ...(await teamPage(lg, id)), next: await nextGameOf(key).catch(() => null) };
    const overview = await statsDeps.getJson(urls.athleteOverview(lg, id), { timeoutMs: 10_000 });
    const needsRows = !(overview?.statistics?.splits ?? []).some((s: any) => /regular season/i.test(s.displayName)) && !SOCCER.has(lg);
    const rows = needsRows ? await statsDeps.getJson(urls.athleteStats(lg, id), { timeoutMs: 10_000 }).catch(() => null) : undefined;
    const team = catalog.player(key)?.teamKey;
    return { ...playerPage(lg, id, overview, rows), next: team ? await nextGameOf(team).catch(() => null) : null };
  })();
  cache.set(key, { at: Date.now(), page });
  page.catch(() => cache.delete(key)); // a failed read isn't kept
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return page;
}
