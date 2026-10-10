import { leagueColors } from '../theme';
import type { LeagueInfo } from './types';

/**
 * How a league is shown, as the server says (`ui` on each league from /catalog/event-types, server leagues.ts
 * LeagueUi), so its color, filter and words change with a server deploy, not an app build. A server from before
 * sends none: then this build's own (FALLBACK), which match what it said when this build was made.
 * `kinds`: what its filter offers. `players`: what its people are called. `groupPlayers`: the UFC's by weight
 * class. `game` / `events`: one event, and the Scores switch's word. `football`: down and distance, possession and
 * timeouts on its cards. `divisions`: Search can sort its teams by division.
 */
export interface LeagueUi {
  color?: string; kinds: ('team' | 'player')[]; players: string; groupPlayers?: 'weightClass';
  game: string; events: string; football?: boolean; divisions: boolean;
}
const UI = (x: Partial<LeagueUi> = {}): LeagueUi => ({ kinds: ['team', 'player'], players: 'players', game: 'game', events: 'games', divisions: true, ...x });
const FALLBACK: Record<string, LeagueUi> = {
  nba: UI(), mlb: UI(), nhl: UI(), epl: UI(), wnba: UI(),
  nfl: UI({ football: true }),
  f1: UI({ players: 'drivers', game: 'race', events: 'races', divisions: false }),
  ufc: UI({ kinds: ['player'], players: 'fighters', groupPlayers: 'weightClass', game: 'fight', events: 'fights', divisions: false }),
  cfb: UI({ kinds: ['team'], football: true }),
};

let fromServer = new Map<string, Partial<LeagueUi>>();
/** The store calls this with the server's leagues (each render after it reads them). */
export function setLeagueUi(leagues: (LeagueInfo & { ui?: Partial<LeagueUi> })[]) {
  fromServer = new Map(leagues.filter((l) => l.ui).map((l) => [l.id, l.ui!]));
}

/** A league's look and words: the server's, over this build's own; a league neither knows is shown as a plain one. */
export function leagueUi(id?: string): LeagueUi {
  if (!id) return UI();
  return { ...(FALLBACK[id] ?? UI()), ...(leagueColors[id] ? { color: leagueColors[id] } : {}), ...fromServer.get(id) };
}
export const leagueColor = (id: string) => leagueUi(id).color;
export const isFootball = (id: string) => !!leagueUi(id).football;
