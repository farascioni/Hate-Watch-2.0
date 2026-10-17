import { startLabel, statusLine, upNextWhen } from './scores';
import type { GameCard, NextGame, Target } from './types';

/** A tracked team's (or player's team's) game, as the Tracking tab's cards say it. */
export interface GameInfo {
  label: 'LIVE' | 'NEXT' | 'FINAL';
  /** "vs CLE" / "at CLE". */
  matchup: string;
  /** "3-2", their team's score first; live and final only. */
  score?: string;
  /** "Top 7th", "Today 7:05 PM", "Final · Yesterday". */
  status: string;
}

/** The team a card is about: the team itself, or a player's. */
export const teamKeyOf = (t: Target) => (t.kind === 'team' ? t.key : t.teamKey);

/** Live first, then the nearest one to come, then the latest final; else the "Up next" game. F1 and UFC have none. */
export function gameInfo(t: Target, games: Map<string, GameCard>, upNext: NextGame[], now = Date.now()): GameInfo | null {
  const tk = teamKeyOf(t);
  const mine = [...games.values()].filter((g) => g.home?.team.key === tk || g.away?.team.key === tk);
  const g = mine.find((x) => x.state === 'in')
    ?? mine.filter((x) => x.state === 'pre').sort((a, b) => a.startsAt - b.startsAt)[0]
    ?? mine.filter((x) => x.state === 'post').sort((a, b) => b.startsAt - a.startsAt)[0];
  if (g) {
    const home = g.home?.team.key === tk, me = home ? g.home : g.away, opp = home ? g.away : g.home;
    const score = g.state !== 'pre' && me?.score != null && opp?.score != null ? `${me.score}-${opp.score}` : undefined;
    return {
      label: g.state === 'in' ? 'LIVE' : g.state === 'pre' ? 'NEXT' : 'FINAL',
      matchup: `${home ? 'vs' : 'at'} ${opp?.team.abbrev ?? '?'}`,
      score,
      status: g.state === 'pre' ? startLabel(g.startsAt) : statusLine(g, now),
    };
  }
  const n = upNext.find((x) => x.teamKey === tk);
  if (!n) return null;
  const home = n.home.key === tk, w = upNextWhen(n.startsAt, n.timeValid, now);
  return { label: 'NEXT', matchup: `${home ? 'vs' : 'at'} ${(home ? n.away : n.home).abbrev}`, status: `${w.day} ${w.time}` };
}

/** ESPN's "W2" / "L4" as a pill: `win` is true for W, false for L, undefined for anything else (a draw, "D1"). */
export function streakOf(streak?: string): { text: string; win?: boolean } | null {
  if (!streak) return null;
  return { text: streak, win: streak[0] === 'W' ? true : streak[0] === 'L' ? false : undefined };
}
