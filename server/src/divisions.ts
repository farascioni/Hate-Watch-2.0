// Each team's division (MLB "AL East", NFL "AFC South", NBA "East · Atlantic", NHL "West · Pacific"; the
// WNBA has conferences, the EPL one table), for the Search tab's "By division". From ESPN's standings at
// division level, in ESPN's order (AL East, AL Central, AL West, NL East...), kept for 12 hours.
import { getJson as espnGetJson } from './espn.ts';
import { LEAGUES, urls, type League } from './leagues.ts';
import { kvGet } from './db.ts';

/** Seam for tests (test/divisions.test.ts). Production never changes it. */
export const divisionsDeps = { getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number }) => Promise<any> };
const TTL_MS = 12 * 3600_000;

export interface Division { name: string; order: number }

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
      for (const e of n.standings.entries) if (e.team?.id != null) out.set(String(e.team.id), { name, order: at });
    }
    for (const c of n?.children ?? []) walk(c, n);
  };
  walk(res);
  return out;
}

const cache = new Map<League, { at: number; divisions: Promise<Map<string, Division>> }>();

/** A league's divisions (empty for F1: constructors have none, and for a league ESPN can't answer for now). */
export async function divisionsOf(lg: League): Promise<Map<string, Division>> {
  if (lg === 'f1') return new Map();
  // College football: each team's conference, as the catalog read them (no read of ESPN), conferences A to Z.
  if (lg === 'cfb') {
    const confs = kvGet<Record<string, string>>('cfb:conferences') ?? {};
    const names = [...new Set(Object.values(confs))].sort((a, b) => a.localeCompare(b));
    return new Map(Object.entries(confs).map(([id, name]) => [id, { name, order: names.indexOf(name) }]));
  }
  const hit = cache.get(lg);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.divisions;
  const divisions = divisionsDeps.getJson(`${urls.standings(lg)}?level=3`, { timeoutMs: 8000 }).then((res) => parseDivisions(lg, res));
  cache.set(lg, { at: Date.now(), divisions });
  divisions.catch(() => cache.delete(lg)); // try again next time
  return divisions.catch(() => new Map());
}
