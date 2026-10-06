import { db } from './db.ts';
import { targetDto } from './catalog.ts';
import type { League } from './leagues.ts';

export interface LeaderboardEntry { rank: number; haters: number; target: NonNullable<ReturnType<typeof targetDto>> }

/**
 * The leaderboard: players and teams by how many people (devices) track them, most hated first. It
 * filters like the Feed and Tracking tabs: players, teams or both, in one league or every sport. Ties
 * share a rank (1, 2, 2, 4) and are listed by name. Counted live from `follows`, so a follow shows at once.
 */
export function leaderboard(o: { kind?: 'team' | 'player'; league?: League; limit?: number } = {}): LeaderboardEntry[] {
  // Target keys are `${kind}:${league}:${espnId}`, so a filter is a key prefix.
  const prefixes = (o.kind ? [o.kind] : ['team', 'player']).map((k) => `${k}:${o.league ? `${o.league}:` : ''}%`);
  const rows = db.prepare(`SELECT target_key, COUNT(*) AS n FROM follows WHERE ${prefixes.map(() => 'target_key LIKE ?').join(' OR ')} GROUP BY target_key`)
    .all(...prefixes) as { target_key: string; n: number }[];
  const ranked = rows
    .flatMap((r) => { const target = targetDto(r.target_key); return target ? [{ target, haters: r.n }] : []; })
    .sort((a, b) => b.haters - a.haters || a.target.name.localeCompare(b.target.name));
  const out: LeaderboardEntry[] = [];
  for (const [i, e] of ranked.slice(0, o.limit ?? 100).entries()) {
    out.push({ rank: i > 0 && e.haters === ranked[i - 1].haters ? out[i - 1].rank : i + 1, ...e });
  }
  return out;
}
