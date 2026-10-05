import type { GameCard, GameSide, Target } from './types';

// Scores tab helpers: which side of a game you hate, and how it's going for them.

export type Side = 'home' | 'away';
const SIDES = ['away', 'home'] as const;

const isMine = (s: GameSide | undefined, follows: Map<string, Target>) =>
  !!s && (follows.has(s.team.key) || [...follows.values()].some((t) => t.kind === 'player' && t.teamKey === s.team.key));

/** The sides you track: the team itself, or a player on it. */
export const trackedSides = (g: GameCard, follows: Map<string, Target>): Side[] => SIDES.filter((k) => isMine(g[k], follows));

/** Players you track on one side, for "Tracking Bryce Harper". */
export const trackedPlayers = (g: GameCard, side: Side, follows: Map<string, Target>) =>
  [...follows.values()].filter((t) => t.kind === 'player' && t.teamKey === g[side]?.team.key);

/** F1: the drivers you track, or the cars of a constructor you track. */
export const trackedDrivers = (g: GameCard, follows: Map<string, Target>) =>
  (g.order ?? []).filter((d) => follows.has(d.key) || (!!d.teamKey && follows.has(d.teamKey)));

export type Tone = 'good' | 'warn' | 'neutral' | 'done';
/**
 * The status pill, from the hater's side: their trouble is good news. "Threatening" is the hated team
 * in a spot to score: the red zone in the NFL, a runner in scoring position while they bat in MLB.
 */
export function hateTag(g: GameCard, side: Side | undefined): { text: string; tone: Tone } | null {
  if (!side || !g.home || !g.away || g.state === 'pre') return null;
  const me = g[side]!, them = g[side === 'home' ? 'away' : 'home']!;
  const diff = (me.score ?? 0) - (them.score ?? 0);
  if (g.state === 'post') return diff < 0 ? { text: 'Successful Hate Watch!', tone: 'done' } : { text: diff > 0 ? 'They won' : 'Tie', tone: 'neutral' };
  const threat = (g.league === 'nfl' && !!g.redZone && g.possession === me.team.key)
    || (g.league === 'mlb' && g.batting === me.team.key && !!g.bases && (g.bases.second || g.bases.third));
  if (threat) return { text: 'Threatening', tone: 'warn' };
  return diff < 0 ? { text: `Down ${-diff}`, tone: 'good' } : { text: diff > 0 ? `Up ${diff}` : 'Tied', tone: 'neutral' };
}

/** Chance the side you track doesn't win (ESPN's win probability; NFL and MLB publish it). */
export const loseChance = (g: GameCard, side: Side | undefined) =>
  side && g.state === 'in' && g.winProb ? 1 - g.winProb[side] : null;

/** "8:15 PM" today, "Tue 8:15 PM" otherwise. */
export function startLabel(ts: number) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

/** The status line under the teams: clock or inning, who has the ball, or the start time. */
export function statusLine(g: GameCard) {
  if (g.state === 'pre') return startLabel(g.startsAt);
  if (g.league === 'nfl' && g.state === 'in' && g.downDistance) {
    const ball = g.possession === g.home?.team.key ? g.home?.team.abbrev : g.possession === g.away?.team.key ? g.away?.team.abbrev : null;
    return `${g.detail} · ${ball ? `${ball} ball, ` : ''}${g.downDistance}`;
  }
  return g.detail;
}

/** Same window as the server: live, starting within a day, or finished in the last 16 hours. */
export const inWindow = (g: GameCard, now = Date.now()) =>
  g.state === 'in' || (g.state === 'pre' && g.startsAt - now < 24 * 3600_000) || (g.state === 'post' && now - g.startsAt < 16 * 3600_000);

export const SECTION: Record<GameCard['state'], string> = { in: 'Live now', pre: 'Later today', post: 'Final' };
const RANK = { in: 0, pre: 1, post: 2 } as const;
export const byState = (a: GameCard, b: GameCard) =>
  RANK[a.state] - RANK[b.state] || (a.state === 'post' ? b.startsAt - a.startsAt : a.startsAt - b.startsAt);
