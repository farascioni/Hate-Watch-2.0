import { db } from './db.ts';
import { targetDto } from './catalog.ts';
import type { League } from './leagues.ts';

/** How many people (devices) track each of these players or teams (0 for nobody). For lists: Search, the team list, a roster. */
export function haterCounts(keys: string[]): Map<string, number> {
  const out = new Map(keys.map((k) => [k, 0]));
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    if (!chunk.length) continue;
    const rows = db.prepare(`SELECT target_key, COUNT(*) AS n FROM follows WHERE target_key IN (${chunk.map(() => '?').join(',')}) GROUP BY target_key`).all(...chunk) as { target_key: string; n: number }[];
    for (const r of rows) out.set(r.target_key, r.n);
  }
  return out;
}
/** Each item with its `haters` count. */
export const withHaters = <T extends { key: string }>(items: T[]): (T & { haters: number })[] => {
  const n = haterCounts(items.map((t) => t.key));
  return items.map((t) => ({ ...t, haters: n.get(t.key) ?? 0 }));
};

/** `rank` is within the filtered list; `tied` when others share it (the app shows "T-2"), even past the limit. */
export interface LeaderboardEntry { rank: number; tied: boolean; haters: number; target: NonNullable<ReturnType<typeof targetDto>> }

/**
 * The leaderboard: players and teams by how many people (devices) track them, most hated first. It
 * filters like the Feed and Tracking tabs: players, teams or both, in one league or every sport. Ties
 * share a rank and the next count is the next rank, with no gap (1, T-2, T-2, 3: "3rd most hated"),
 * listed by name. Counted live from `follows`, so a follow shows at once.
 */
export function leaderboard(o: { kind?: 'team' | 'player'; league?: League; limit?: number } = {}): LeaderboardEntry[] {
  // Target keys are `${kind}:${league}:${espnId}`, so a filter is a key prefix.
  const prefixes = (o.kind ? [o.kind] : ['team', 'player']).map((k) => `${k}:${o.league ? `${o.league}:` : ''}%`);
  const rows = db.prepare(`SELECT target_key, COUNT(*) AS n FROM follows WHERE ${prefixes.map(() => 'target_key LIKE ?').join(' OR ')} GROUP BY target_key`)
    .all(...prefixes) as { target_key: string; n: number }[];
  const ranked = rows
    .flatMap((r) => { const target = targetDto(r.target_key); return target ? [{ target, haters: r.n }] : []; })
    .sort((a, b) => b.haters - a.haters || a.target.name.localeCompare(b.target.name));
  const sharing = new Map<number, number>(); // haters → how many have that many, in the whole filtered list
  for (const e of ranked) sharing.set(e.haters, (sharing.get(e.haters) ?? 0) + 1);
  const out: LeaderboardEntry[] = [];
  for (const [i, e] of ranked.slice(0, o.limit ?? 100).entries()) {
    const rank = i === 0 ? 1 : e.haters === ranked[i - 1].haters ? out[i - 1].rank : out[i - 1].rank + 1;
    out.push({ rank, tied: sharing.get(e.haters)! > 1, ...e });
  }
  return out;
}
