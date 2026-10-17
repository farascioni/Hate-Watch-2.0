// Each team's division (MLB "AL East", NFL "AFC South", NBA "East · Atlantic", NHL "West · Pacific"; the
// WNBA has conferences, the EPL one table), for the Search tab's "By division". From ESPN's standings at
// division level, in ESPN's order (AL East, AL Central, AL West, NL East...), kept for 15 minutes. The same
// response gives each team's record and streak, for the Tracking tab's cards (a postseason streak from the ?seasontype=3 read; the preseason's own record and streak count, the NBA in October).
// F1 has no divisions: its constructors' championship stands in the same fields (points as the record, "3rd in constructors"); a driver's own place comes from the same read (`/f1/drivers`: "3rd in drivers").
import { getJson as espnGetJson } from './espn.ts';
import { LEAGUES, urls, type League } from './leagues.ts';
import { kvGet } from './db.ts';
import { ordinal } from './detectors.ts';
import { standingsOf } from './f1-stats.ts';

/** Seam for tests (test/divisions.test.ts). Production never changes it. */
export const divisionsDeps = { getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number }) => Promise<any> };
const TTL_MS = 15 * 60_000; // a record and a streak change with every game

/** `record`: "82-80" (the NHL's "6-2-0"), `streak`: ESPN's "W2" / "L4"; each only where ESPN's standings have it. `standing` (college football): "3-0 in conference, 1st" ("T-1st" when tied); F1: "3rd in constructors", with the points as the `record` ("120 pts"). */
export interface Division { name: string; order: number; record?: string; streak?: string; standing?: string }

/** "East · Atlantic" from "Eastern Conference" and "Atlantic Division"; MLB's own short names ("AL East"). */
function label(lg: League, group: any, parent: any): string {
  if (lg === 'mlb') return String(group.shortName ?? group.name).replace(/\bCent\b/, 'Central');
  if (lg === 'nfl') return String(group.name); // "AFC South"
  if (lg === 'nba' || lg === 'nhl') return `${String(parent?.name ?? '').replace(/ern Conference$/, '')} · ${String(group.name).replace(/ Division$/, '')}`;
  // A table named for the season ("2026-27 English Premier League"): the league's own name.
  if (/^\d{4}-\d{2,4}/.test(String(group.abbreviation ?? group.name))) return LEAGUES[lg].fullName?.replace(/^English /, '') ?? LEAGUES[lg].name;
  return String(group.name); // the WNBA: "Eastern Conference"
}

/** teamId → its division, from a division-level standings response. Pure, for tests on real payloads. */
export function parseDivisions(lg: League, res: any): Map<string, Division> {
  const out = new Map<string, Division>();
  let order = 0;
  const walk = (n: any, parent?: any) => {
    if (n?.standings?.entries?.length) {
      const name = label(lg, n, parent), at = order++;
      const stat = (e: any, k: string): string | undefined => e.stats?.find((s: any) => s.name === k)?.displayValue || undefined;
      // College football: ESPN lists no rank, so it is the conference record's win share, ties shared.
      const conf = (e: any) => (stat(e, 'vs. Conf.') ?? '').split('-').map(Number);
      const pct = (e: any) => { const [w, l] = conf(e); return w + l > 0 ? w / (w + l) : -1; };
      for (const e of n.standings.entries) {
        if (e.team?.id == null) continue;
        // ESPN's preseason table (the NBA in October) has no "overall": the record is its wins and losses.
        const w = stat(e, 'wins'), l = stat(e, 'losses');
        const record = stat(e, 'overall')?.split(',')[0].trim() ?? (w != null && l != null && (lg === 'nba' || lg === 'wnba') ? `${w}-${l}` : undefined), streak = stat(e, 'streak');
        let standing: string | undefined;
        if (lg === 'cfb' && pct(e) >= 0) {
          const peers = n.standings.entries, rank = 1 + peers.filter((o: any) => pct(o) > pct(e)).length;
          const tied = peers.filter((o: any) => pct(o) === pct(e)).length > 1;
          const th = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] ?? 'th';
          standing = `${stat(e, 'vs. Conf.')} in conference, ${tied ? 'T-' : ''}${rank}${th}`;
        }
        out.set(String(e.team.id), { name, order: at, ...(record ? { record } : {}), ...(streak ? { streak } : {}), ...(standing ? { standing } : {}) });
      }
    }
    for (const c of n?.children ?? []) walk(c, n);
  };
  walk(res);
  return out;
}

/** The season a standings response is of (2026), from its first table. */
function seasonOf(res: any): number | undefined {
  const find = (n: any): number | undefined => n?.standings?.season ?? (n?.children ?? []).map(find).find((x: any) => x != null);
  return find(res);
}

/**
 * teamId → streak in the postseason, from the standings read with ?seasontype=3. ESPN's default standings are the regular season's
 * for good: October's Dodgers read "W3" with four losses in a row in the NLCS. Only teams that played a postseason game this
 * season count (a team out of it, or a league whose postseason is last season's, keeps the regular season's).
 */
export function postseasonStreaks(regular: any, post: any): Map<string, string> {
  const out = new Map<string, string>();
  if (!post || seasonOf(post) == null || seasonOf(post) !== seasonOf(regular)) return out;
  const walk = (n: any) => {
    for (const e of n?.standings?.entries ?? []) {
      const val = (k: string) => Number(e.stats?.find((x: any) => x.name === k)?.value) || 0;
      const streak = e.stats?.find((x: any) => x.name === 'streak')?.displayValue;
      if (e.team?.id != null && streak && val('wins') + val('losses') > 0) out.set(String(e.team.id), streak);
    }
    for (const c of n?.children ?? []) walk(c);
  };
  walk(post);
  return out;
}

/** College football: each team's conference is the catalog's (conferences A to Z, FBS and the rest); ESPN's standings add the record, streak and conference standing. */
function cfbDivisions(standings: Map<string, Division>): Map<string, Division> {
  const confs = kvGet<Record<string, string>>('cfb:conferences') ?? {};
  const names = [...new Set(Object.values(confs))].sort((a, b) => a.localeCompare(b));
  return new Map(Object.entries(confs).map(([id, name]) => {
    const { record, streak, standing } = standings.get(id) ?? {};
    return [id, { name, order: names.indexOf(name), ...(record ? { record } : {}), ...(streak ? { streak } : {}), ...(standing ? { standing } : {}) }];
  }));
}

const cache = new Map<League, { at: number; divisions: Promise<Map<string, Division>> }>();

/** F1's constructors: no divisions, so the championship is the card's form (points as the record, the place as the standing). */
export function constructorStandings(res: any): Map<string, Division> {
  const out = new Map<string, Division>();
  for (const c of standingsOf(res).constructors) if (c.rank > 0) out.set(c.id, { name: 'Constructors', order: 0, record: `${c.points} pts`, standing: `${ordinal(c.rank)} in constructors` });
  return out;
}

/** F1's drivers by ESPN athlete id: their own place in the drivers' championship and points, in the card's fields. */
export function driverStandings(res: any): Map<string, { record: string; standing: string }> {
  const out = new Map<string, { record: string; standing: string }>();
  for (const d of standingsOf(res).drivers) if (d.rank > 0) out.set(d.id, { record: `${d.points} pts`, standing: `${ordinal(d.rank)} in drivers` });
  return out;
}

let f1Table: { at: number; res: Promise<any> } | null = null;
/** ESPN's F1 standings (both championships), read again every 15 minutes. */
function f1Standings(): Promise<any> {
  if (f1Table && Date.now() - f1Table.at < TTL_MS) return f1Table.res;
  const res = divisionsDeps.getJson(urls.standings('f1'), { timeoutMs: 8000 });
  f1Table = { at: Date.now(), res };
  res.catch(() => { f1Table = null; });
  return res;
}
/** Every F1 driver's place (empty when ESPN can't answer). */
export const f1DriverStandings = () => f1Standings().then(driverStandings).catch(() => new Map<string, { record: string; standing: string }>());

/** A league's divisions (F1: its constructors' championship; empty for a league ESPN can't answer for now). */
export async function divisionsOf(lg: League): Promise<Map<string, Division>> {
  const hit = cache.get(lg);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.divisions;
  // The conferences come from the catalog, so a failed read of ESPN still leaves each team its conference.
  const divisions = lg === 'f1'
    ? f1Standings().then(constructorStandings)
    : lg === 'cfb'
    ? divisionsDeps.getJson(`${urls.standings(lg)}?level=3`, { timeoutMs: 8000 }).then((res) => parseDivisions(lg, res)).catch(() => new Map<string, Division>()).then(cfbDivisions).then((m) => { if (!m.size) cache.delete(lg); return m; }) // no catalog yet: ask again
    : Promise.all([
    divisionsDeps.getJson(`${urls.standings(lg)}?level=3`, { timeoutMs: 8000 }),
    divisionsDeps.getJson(`${urls.standings(lg)}?level=3&seasontype=3`, { timeoutMs: 8000 }).catch(() => null),
  ]).then(([res, post]) => {
    const out = parseDivisions(lg, res);
    for (const [id, streak] of postseasonStreaks(res, post)) { const d = out.get(id); if (d) out.set(id, { ...d, streak }); }
    return out;
  });
  cache.set(lg, { at: Date.now(), divisions });
  divisions.catch(() => cache.delete(lg)); // try again next time
  return divisions.catch(() => new Map());
}
