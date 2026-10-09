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

/** The box score once the game has started (soccer's line-ups are out before kickoff, all zeros), and never for F1. */
export function boxScore(g: Pick<GameCard, 'league' | 'state' | 'home' | 'away'>, summary: any): BoxScore | null {
  if (g.league === 'f1' || g.state === 'pre') return null;
  const teams = (SOCCER.has(g.league) ? fromRosters(g.league, summary) : fromBoxscore(g.league, summary)).filter((t) => t.groups.some((gr) => gr.rows.length));
  if (!teams.length) return null;
  const away = g.away?.team.key;
  return { teams: teams.sort((a, b) => Number(b.key === away) - Number(a.key === away)) };
}
