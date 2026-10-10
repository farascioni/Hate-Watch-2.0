// The game screen's box score: each team's players, a table per stat group, from the ESPN summary the
// play-by-play already reads (every league but F1, which has its running order). The columns are picked
// here, per league, so the app only draws tables; the bad numbers (an 0-for-4, a 4th earned run) are flagged
// for red, as on the Stats pages.
import { catalog } from './catalog.ts';
import { SOCCER, type League } from './leagues.ts';
import type { GameCard } from './scores.ts';

export interface BoxRow {
  key: string;        // player:<league>:<espn id>, tracked or not
  name: string;       // ESPN's short name ("J. Randle"), to fit the table
  detail?: string;    // position (MLB, NBA, NHL, soccer)
  sub?: boolean;      // off the bench / came on
  link: boolean;      // we have their page (in the catalog)
  stats: string[];    // one per column
  bad?: number[];     // the columns to show in red
}
export interface BoxGroup { title: string; columns: string[]; rows: BoxRow[]; totals?: string[]; note?: string }
export interface BoxTeam { key: string; abbrev: string; logo: string | null; groups: BoxGroup[] }
/** Away team first, as on the score card. */
export interface BoxScore { teams: BoxTeam[] }

type Stat = (label: string) => string;
/** `subs`: the group has starters and players off the bench (batting, basketball), not a reliever's or a backup's lines. */
interface Spec { group: string; title: string; cols: string[]; subs?: boolean; bad?: (v: Stat) => (string | false)[] }

const n = (s: string) => Number.parseFloat(s) || 0;
/** NFL sacks are "2-11" (2 for 11 yards): the table shows the 2. */
const shown = (col: string, v: string) => (col === 'SACKS' ? v.split('-')[0] : v);
const made = (s: string) => { const [m, a] = s.split(/[-/]/).map(Number); return { m: m || 0, a: a || 0 }; };

const BASKETBALL: Spec[] = [{
  group: '', title: 'Players', cols: ['MIN', 'PTS', 'REB', 'AST', 'FG', '3PT', 'PF'], subs: true,
  bad: (v) => [made(v('FG')).a >= 8 && made(v('FG')).m / made(v('FG')).a <= 0.3 && 'FG', made(v('3PT')).a >= 4 && made(v('3PT')).m === 0 && '3PT', n(v('PF')) >= 5 && 'PF'],
}];
const SKATERS = (group: string, title: string): Spec => ({ group, title, cols: ['G', 'A', '+/-', 'SOG', 'PIM', 'TOI'], bad: (v) => [n(v('+/-')) <= -2 && '+/-', n(v('PIM')) >= 5 && 'PIM'] });

/** Per league, the stat groups shown, in order (ESPN's group names; the NBA's has none), and their columns. */
const SPECS: Partial<Record<League, Spec[]>> = {
  mlb: [
    { group: 'batting', title: 'Batting', cols: ['AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K'], subs: true, bad: (v) => [n(v('AB')) >= 3 && v('H') === '0' && 'H', n(v('K')) >= 2 && 'K'] },
    { group: 'pitching', title: 'Pitching', cols: ['IP', 'H', 'R', 'ER', 'BB', 'K', 'PC'], bad: (v) => [n(v('ER')) >= 4 && 'ER', n(v('BB')) >= 3 && 'BB'] },
  ],
  nba: BASKETBALL,
  wnba: BASKETBALL,
  nhl: [
    SKATERS('forwards', 'Forwards'), SKATERS('defenses', 'Defense'),
    { group: 'goalies', title: 'Goalies', cols: ['SA', 'GA', 'SV', 'SV%', 'TOI'], bad: (v) => [n(v('GA')) >= 4 && 'GA', n(v('SA')) >= 10 && n(v('SV%')) < 0.88 && 'SV%'] },
  ],
  nfl: [
    { group: 'passing', title: 'Passing', cols: ['C/ATT', 'YDS', 'TD', 'INT', 'SACKS'], bad: (v) => [n(v('INT')) >= 1 && 'INT', n(v('SACKS')) >= 3 && 'SACKS'] },
    { group: 'rushing', title: 'Rushing', cols: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'] },
    { group: 'receiving', title: 'Receiving', cols: ['REC', 'TGTS', 'YDS', 'TD', 'LONG'] },
    { group: 'fumbles', title: 'Fumbles', cols: ['FUM', 'LOST'], bad: (v) => [n(v('LOST')) >= 1 && 'LOST'] },
    { group: 'defensive', title: 'Defense', cols: ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD'] },
    { group: 'interceptions', title: 'Interceptions', cols: ['INT', 'YDS', 'TD'] },
    { group: 'kicking', title: 'Kicking', cols: ['FG', 'LONG', 'XP', 'PTS'], bad: (v) => [made(v('FG')).m < made(v('FG')).a && 'FG', made(v('XP')).m < made(v('XP')).a && 'XP'] },
    { group: 'punting', title: 'Punting', cols: ['NO', 'AVG', 'LONG'] },
  ],
};

/** Soccer's lines are in the line-ups (rosters), by stat name, not in a box score. */
const SOCCER_COLS: [string, string][] = [['G', 'totalGoals'], ['A', 'goalAssists'], ['SH', 'totalShots'], ['SOG', 'shotsOnTarget'], ['FC', 'foulsCommitted'], ['YC', 'yellowCards'], ['RC', 'redCards']];
const KEEPER_COLS: [string, string][] = [['SV', 'saves'], ['GA', 'goalsConceded']];

/** ESPN's short name, or one made the same way ("Russell Wilson": NFL lines have no short name). */
const shortName = (a: any) => String(a.athlete?.shortName ?? String(a.athlete?.displayName ?? '').replace(/^(\S)\S*\s+(?=\S)/, '$1. '));

const row = (lg: League, a: any, stats: string[], bad: number[], x: Partial<BoxRow> = {}): BoxRow => {
  const id = String(a.athlete?.id ?? '');
  return {
    key: `player:${lg}:${id}`, name: shortName(a), link: !!catalog.playerByEspn(lg, id), stats,
    ...(bad.length ? { bad } : {}), ...x,
  };
};

function teamInfo(lg: League, teamId: string) {
  const t = catalog.teamByEspn(lg, teamId);
  return { key: `team:${lg}:${teamId}`, abbrev: t?.abbrev ?? '', logo: t?.logo ?? null };
}

function fromBoxscore(lg: League, s: any): BoxTeam[] {
  const specs = SPECS[lg] ?? [];
  return (s?.boxscore?.players ?? []).map((t: any): BoxTeam => {
    const groups: BoxGroup[] = [];
    for (const spec of specs) {
      const st = (t.statistics ?? []).find((x: any) => String(x.name ?? x.type ?? '') === spec.group);
      if (!st?.athletes?.length) continue;
      const labels: string[] = st.labels ?? [];
      const at = (vals: string[]) => (l: string) => String(vals[labels.indexOf(l)] ?? '');
      const cols = spec.cols.filter((c) => labels.includes(c));
      const played = st.athletes.filter((a: any) => !a.didNotPlay && a.stats?.length);
      const rows = played.map((a: any) => {
        const v = at(a.stats);
        const flagged = new Set((spec.bad?.(v) ?? []).filter(Boolean) as string[]);
        return row(lg, a, cols.map((c) => shown(c, v(c))), cols.flatMap((c, i) => (flagged.has(c) ? [i] : [])), {
          detail: a.position?.abbreviation ?? a.athlete?.position?.abbreviation, ...(spec.subs && a.starter === false ? { sub: true } : {}),
        });
      });
      const dnp = st.athletes.filter((a: any) => a.didNotPlay).map((a: any) => a.athlete?.shortName).filter(Boolean);
      const totals = Array.isArray(st.totals) && st.totals.some((x: string) => x) ? cols.map((c) => shown(c, at(st.totals)(c))) : undefined;
      groups.push({ title: spec.title, columns: cols, rows, ...(totals ? { totals } : {}), ...(dnp.length ? { note: `Did not play: ${dnp.join(', ')}` } : {}) });
    }
    return { ...teamInfo(lg, String(t.team?.id ?? '')), groups };
  });
}

function fromRosters(lg: League, s: any): BoxTeam[] {
  return (s?.rosters ?? []).map((t: any): BoxTeam => {
    const value = (a: any, name: string) => String(a.stats?.find((x: any) => x.name === name)?.displayValue ?? '0');
    const line = (a: any, cols: [string, string][], bad: (c: string, v: string) => boolean) => {
      const stats = cols.map(([, name]) => value(a, name));
      return row(lg, a, stats, cols.flatMap(([c], i) => (bad(c, stats[i]) ? [i] : [])), { detail: a.position?.abbreviation, ...(a.starter ? {} : { sub: true }) });
    };
    const cards = (c: string, v: string) => (c === 'YC' || c === 'RC') && n(v) >= 1;
    const played = (t.roster ?? []).filter((a: any) => a.starter || a.subbedIn);
    const keepers = played.filter((a: any) => a.position?.abbreviation === 'G');
    const groups: BoxGroup[] = [
      { title: 'Starters', columns: SOCCER_COLS.map(([c]) => c), rows: played.filter((a: any) => a.starter).map((a: any) => line(a, SOCCER_COLS, cards)) },
      { title: 'Substitutes', columns: SOCCER_COLS.map(([c]) => c), rows: played.filter((a: any) => !a.starter).map((a: any) => line(a, SOCCER_COLS, cards)) },
      { title: 'Goalkeeping', columns: KEEPER_COLS.map(([c]) => c), rows: keepers.map((a: any) => line(a, KEEPER_COLS, (c, v) => c === 'GA' && n(v) >= 3)) },
    ].filter((gr) => gr.rows.length);
    return { ...teamInfo(lg, String(t.team?.id ?? '')), groups };
  });
}

// ─── Before the start: a preview, as tables ─────────────────────────────────────────────────────
// ESPN's summary has no player lines before a game (soccer's line-ups are all zeros), but it has each side's
// season leaders, season stats, last five games and injuries, the matchup predictor, and the season series.
// They go out as box-score tables, so every build's Box score tab shows them before the start.

/** A leader category's column: its short label, and the bit of ESPN's value that's its number ("843" of "72/104, 843 YDS, 8 TD"). */
const LEADER_COLS: Record<string, [string, RegExp?]> = {
  'Batting Average': ['AVG'], 'Home Runs': ['HR'], 'Runs Batted In': ['RBI'], 'Earned Run Average': ['ERA'], Wins: ['W'], Strikeouts: ['K'],
  'Passing Yards': ['PASS', /([\d,]+) YDS/], 'Rushing Yards': ['RUSH', /([\d,]+) YDS/], 'Receiving Yards': ['REC', /([\d,]+) YDS/], Sacks: ['SACK'], Tackles: ['TKL'],
  Points: ['PTS'], Rebounds: ['REB'], Assists: ['AST', /Assists: (\d+)/], Goals: ['G', /Goals: (\d+)/], 'Total Shots': ['SH', /Shots: (\d+)/],
  'Accurate Passes': ['PASS', /Passes: (\d+)/], Saves: ['SV', /Saves: (\d+)/],
};
const leaderCol = (name: string): [string, RegExp?] => LEADER_COLS[name] ?? [name.split(/\s+/).map((w) => w[0]).join('').toUpperCase()];
/** MLB's season stats come in full tables: the few worth a look, by group and name. Other sports' come as a short list. */
const MLB_STATS: [string, string, string][] = [
  ['batting', 'avg', 'Batting average'], ['batting', 'runs', 'Runs'], ['batting', 'homeRuns', 'Home runs'], ['batting', 'OPS', 'OPS'],
  ['pitching', 'ERA', 'ERA'], ['pitching', 'WHIP', 'WHIP'], ['pitching', 'strikeouts', 'Strikeouts (pitching)'], ['fielding', 'errors', 'Errors'],
];
const MAX_STATS = 10;
/** An injury's status, short enough for a column every build draws at most 60 points wide: "10-Day-IL" is "IL-10". */
export const shortStatus = (s: string) => s.replace(/^(\d+)-Day-IL$/i, 'IL-$1').replace(/^Day-To-Day$/i, 'DTD').replace(/^Questionable$/i, 'Ques.')
  .replace(/^Probable$/i, 'Prob.').replace(/^Suspension$/i, 'Susp.');

/** One side's season stats, by label: MLB's few, or the short list ESPN sends for the others. */
function seasonStats(lg: League, t: any): Map<string, string> {
  const st: any[] = t?.statistics ?? [];
  if (lg === 'mlb') {
    return new Map(MLB_STATS.flatMap(([group, name, label]) => {
      const v = st.find((g) => g.name === group)?.stats?.find((x: any) => x.name === name)?.displayValue;
      return v != null ? [[label, String(v)]] : [];
    }));
  }
  return new Map(st.filter((x) => x.displayValue != null && !Array.isArray(x.stats)).slice(0, MAX_STATS).map((x) => [String(x.label ?? x.displayName ?? x.name), String(x.displayValue)]));
}

/** The preview: each side's season leaders, both sides' season stats, its last five, its injuries; null if ESPN has none of it. */
export function previewBox(lg: League, s: any): BoxTeam[] {
  const sides: any[] = s?.header?.competitions?.[0]?.competitors ?? [];
  const home = sides.find((c) => c.homeAway === 'home'), away = sides.find((c) => c.homeAway === 'away');
  if (!home || !away) return [];
  const idOf = (c: any) => String(c.team?.id ?? c.id ?? '');
  const abbr = (c: any) => String(c.team?.abbreviation ?? '');
  const statsOf = (c: any) => seasonStats(lg, (s.boxscore?.teams ?? []).find((t: any) => String(t.team?.id) === idOf(c)));
  const [awayStats, homeStats] = [statsOf(away), statsOf(home)];
  const labels = [...new Set([...awayStats.keys(), ...homeStats.keys()])];
  // What both sides share: their season stats side by side, with ESPN's predictor, the season series and the venue.
  const odds = s.predictor?.homeTeam?.gameProjection != null ? Number(s.predictor.homeTeam.gameProjection) : null;
  const fav = odds == null ? null : odds >= 50 ? [abbr(home), odds] as const : [abbr(away), 100 - odds] as const;
  const series = (s.seasonseries ?? []).find((x: any) => x.type === 'season' || x.type === 'head-to-head')?.summary;
  const venue = s.gameInfo?.venue?.fullName;
  const note = [fav && `ESPN's matchup predictor: ${fav[0]} ${Math.round(fav[1])}%.`, series && `${/head/.test(String((s.seasonseries ?? []).find((x: any) => x.summary === series)?.type)) ? 'Head to head' : 'Regular season'}: ${series}.`, venue && `At ${venue}.`].filter(Boolean).join(' ');
  const shared: BoxGroup | null = labels.length ? {
    title: 'Season stats', columns: [abbr(away), abbr(home)],
    rows: labels.map((label) => ({ key: `stat:${label}`, name: label, link: false, stats: [awayStats.get(label) ?? '–', homeStats.get(label) ?? '–'] })),
    ...(note ? { note } : {}),
  } : null;

  const side = (c: any): BoxTeam => {
    const id = idOf(c);
    const groups: BoxGroup[] = [];
    // Season leaders: a column a category, a row a player (one who leads three is one row).
    const cats: any[] = (s.leaders ?? []).find((l: any) => String(l.team?.id) === id)?.leaders ?? [];
    const cols = cats.map((cat) => leaderCol(String(cat.displayName ?? cat.name)));
    const byPlayer = new Map<string, { a: any; stats: string[] }>();
    cats.forEach((cat, i) => {
      const top = cat.leaders?.[0];
      if (!top?.athlete?.id) return;
      const raw = String(top.displayValue ?? '');
      const value = cols[i][1]?.exec(raw)?.[1] ?? raw;
      const r = byPlayer.get(String(top.athlete.id)) ?? { a: top, stats: cats.map(() => '') };
      r.stats[i] = value;
      byPlayer.set(String(top.athlete.id), r);
    });
    if (byPlayer.size) groups.push({ title: 'Season leaders', columns: cols.map(([c]) => c), rows: [...byPlayer.values()].map(({ a, stats }) => row(lg, a, stats, [], { detail: a.athlete?.position?.abbreviation })) });
    if (shared) groups.push(shared);
    const last: any[] = (s.lastFiveGames ?? []).find((f: any) => String(f.team?.id) === id)?.events ?? [];
    if (last.length) {
      groups.push({ title: 'Last 5 games', columns: ['Result'], rows: last.map((e, i) => ({
        key: `last:${id}:${i}`, name: `${e.atVs === '@' ? '@' : 'vs'} ${e.opponent?.abbreviation ?? '?'}`, link: false,
        detail: e.gameDate ? new Date(e.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : undefined,
        stats: [`${e.gameResult ?? ''} ${e.score ?? ''}`.trim()], ...(e.gameResult === 'L' ? { bad: [0] } : {}),
      })) });
    }
    const hurt: any[] = (s.injuries ?? []).find((x: any) => String(x.team?.id) === id)?.injuries ?? [];
    if (hurt.length) {
      // The injury beside the position ("1B · Back"), the status in the column, short.
      groups.push({ title: 'Injuries', columns: ['Status'], rows: hurt.filter((x) => x.athlete?.id).map((x) => row(lg, x, [shortStatus(String(x.status ?? ''))], [], {
        detail: [x.athlete?.position?.abbreviation, x.details?.type].filter(Boolean).join(' · ') || undefined,
      })) });
    }
    return { ...teamInfo(lg, id), groups };
  };
  return [side(away), side(home)].filter((t) => t.groups.some((g) => g.rows.length));
}

/** The box score once the game has started; before, its preview (previewBox). Never for F1. */
export function boxScore(g: Pick<GameCard, 'league' | 'state' | 'home' | 'away'>, summary: any): BoxScore | null {
  if (g.league === 'f1') return null;
  if (g.state === 'pre') { const teams = previewBox(g.league, summary); return teams.length ? { teams } : null; }
  const teams = (SOCCER.has(g.league) ? fromRosters(g.league, summary) : fromBoxscore(g.league, summary)).filter((t) => t.groups.some((gr) => gr.rows.length));
  if (!teams.length) return null;
  const away = g.away?.team.key;
  return { teams: teams.sort((a, b) => Number(b.key === away) - Number(a.key === away)) };
}
