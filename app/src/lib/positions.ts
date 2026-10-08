import type { EventType, Player } from './types';

type Positioned = Pick<Player, 'position' | 'positions'>;

/** Every position a player has played this season (Ohtani: DH, P, SP), or their main one (older servers send only that). */
export const positionsOf = (p: Positioned): string[] => (p.positions?.length ? p.positions : p.position ? [p.position] : []);

/**
 * Does this alert fit this player (no hitting alerts for a pitcher, no goalie ones for a skater)? Yes if any
 * position they've played fits its rule from the server, and when either side doesn't say.
 */
export function fitsPosition(t: EventType, p: Positioned) {
  const rule = t.positions, mine = positionsOf(p);
  if (!rule || !mine.length) return true;
  return mine.some((pos) => (!rule.only || rule.only.includes(pos)) && !rule.not?.includes(pos));
}

/**
 * A team page's roster filter, per sport: each group and the positions (ESPN's codes) a player is listed at
 * for it. Players listed at none of them are under All only. F1 teams have two drivers: no filter.
 */
export const ROSTER_GROUPS: Record<string, { label: string; positions: string[] }[]> = {
  baseball: [
    { label: 'Starters', positions: ['SP'] },
    { label: 'Relievers', positions: ['RP', 'P'] },
    { label: 'Catchers', positions: ['C'] },
    { label: 'Infield', positions: ['1B', '2B', '3B', 'SS', 'IF'] },
    { label: 'Outfield', positions: ['LF', 'CF', 'RF', 'OF'] },
    { label: 'DH', positions: ['DH'] },
  ],
  football: [
    { label: 'QB', positions: ['QB'] },
    { label: 'RB', positions: ['RB', 'FB'] },
    { label: 'WR', positions: ['WR'] },
    { label: 'TE', positions: ['TE'] },
    { label: 'O-line', positions: ['OT', 'G', 'C', 'OL'] },
    { label: 'D-line', positions: ['DE', 'DT'] },
    { label: 'LB', positions: ['LB'] },
    { label: 'DB', positions: ['CB', 'S', 'DB'] },
    { label: 'Specialists', positions: ['PK', 'P', 'LS'] },
  ],
  basketball: [
    { label: 'Guards', positions: ['G'] },
    { label: 'Forwards', positions: ['F'] },
    { label: 'Centers', positions: ['C'] },
  ],
  hockey: [
    { label: 'Forwards', positions: ['C', 'LW', 'RW'] },
    { label: 'Defense', positions: ['D'] },
    { label: 'Goalies', positions: ['G'] },
  ],
  soccer: [
    { label: 'Goalkeepers', positions: ['G'] },
    { label: 'Defenders', positions: ['D'] },
    { label: 'Midfielders', positions: ['M'] },
    { label: 'Forwards', positions: ['F'] },
  ],
};
