import type { GameCard, GameSide, RaceDriver, Target } from './types';
import { isFootball } from './leagueUi';
import { currentLocale, tr } from './i18n';

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

/** Target keys a game card involves: its teams and the players you track on them, or (F1) your drivers and their constructors. */
export const gameTargetKeys = (g: GameCard, follows: Map<string, Target>): string[] =>
  g.league === 'f1'
    ? trackedDrivers(g, follows).flatMap((d) => [d.key, ...(d.teamKey ? [d.teamKey] : [])])
    : SIDES.flatMap((k) => (g[k] ? [g[k]!.team.key, ...trackedPlayers(g, k, follows).map((p) => p.key)] : []));

/** Hate Watch Plus: a favorite's game: either team is a favorite, or (F1) a favorite constructor has a car in the session. */
export const isFavoriteGame = (g: GameCard, favorites: Map<string, unknown>): boolean =>
  g.league === 'f1' ? (g.order ?? []).some((d) => !!d.teamKey && favorites.has(d.teamKey)) : SIDES.some((k) => !!g[k] && favorites.has(g[k]!.team.key));

/** F1: a car's places since the start, "▲10 from P19", "▼3 from P4", "Started P1", read out in words. None out of it, or without a grid slot. */
export function fromGrid(d: RaceDriver): { text: string; label: string; lost: boolean } | null {
  if (!d.grid || !d.position || d.out) return null;
  const n = d.grid - d.position, grid = d.grid;
  if (n > 0) return { text: tr('grid.up', { n, grid }), label: tr('grid.upLabel', { n, grid }), lost: false };
  if (n < 0) return { text: tr('grid.down', { n: -n, grid }), label: tr('grid.downLabel', { n: -n, grid }), lost: true };
  return { text: tr('grid.started', { grid }), label: tr('grid.startedLabel', { grid }), lost: false };
}
/** F1: "1 stop", "2 stops" (none before the first). */
export const stopsText = (pits?: number) => (pits ? tr('f1.stops', { n: pits }) : null);

export type Tone = 'good' | 'warn' | 'neutral' | 'done';
/**
 * The status pill, from the hater's side: their trouble is good news. "Threatening" is the hated team
 * in a spot to score: the red zone in the NFL, a runner in scoring position while they bat in MLB.
 */
export function hateTag(g: GameCard, side: Side | undefined): { text: string; tone: Tone } | null {
  if (!side || !g.home || !g.away || g.state === 'pre') return null;
  const me = g[side]!, them = g[side === 'home' ? 'away' : 'home']!;
  const diff = (me.score ?? 0) - (them.score ?? 0);
  if (g.state === 'post') return diff < 0 ? { text: tr('feed.successful'), tone: 'done' } : { text: tr(diff > 0 ? 'tag.won' : 'tag.tie'), tone: 'neutral' };
  const threat = (isFootball(g.league) && !!g.redZone && g.possession === me.team.key)
    || (g.league === 'mlb' && g.batting === me.team.key && !!g.bases && (g.bases.second || g.bases.third));
  if (threat) return { text: tr('tag.threat'), tone: 'warn' };
  return diff < 0 ? { text: tr('tag.down', { n: -diff }), tone: 'good' } : { text: diff > 0 ? tr('tag.up', { n: diff }) : tr('tag.tied'), tone: 'neutral' };
}

/**
 * Chance the side you track doesn't win: live, ESPN's win probability (where ESPN publishes it: the server reads it for any league); before the
 * start, the other side's chance from the betting line (a soccer draw isn't a loss).
 */
export function loseChance(g: GameCard, side: Side | undefined) {
  if (!side) return null;
  if (g.state === 'in' && g.winProb) return 1 - g.winProb[side];
  if (g.state === 'pre' && g.preview?.chance) return g.preview.chance[side === 'home' ? 'away' : 'home'] / 100;
  return null;
}

/** "8:15 PM" today, "Tue 8:15 PM" otherwise. */
export function startLabel(ts: number) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(currentLocale(), { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(currentLocale(), { weekday: 'short' })} ${time}`;
}

/**
 * When an "Up next" game is, as two lines: the day ("Today", "Tomorrow", "Sun", or "Oct 19" past a week)
 * and the time ("8:20 PM", or "Time TBA" before ESPN sets it).
 */
export function upNextWhen(ts: number, timeValid: boolean, now = Date.now()) {
  const d = new Date(ts), today = new Date(now);
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86400_000);
  const day = days <= 0 ? tr('time.today') : days === 1 ? tr('time.tomorrow') : days < 7 ? d.toLocaleDateString(currentLocale(), { weekday: 'short' }) : d.toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric' });
  return { day, time: timeValid ? d.toLocaleTimeString(currentLocale(), { hour: 'numeric', minute: '2-digit' }) : tr('time.tba'), isToday: days <= 0 };
}

/** A race weekend's dates in the phone's time zone: "Oct 9–11", or "Oct 30 – Nov 1" across months. */
export function weekendDates(from: number, to: number) {
  const a = new Date(from), b = new Date(to);
  const month = (d: Date) => d.toLocaleDateString(currentLocale(), { month: 'short' });
  if (a.toDateString() === b.toDateString()) return `${month(a)} ${a.getDate()}`;
  return month(a) === month(b) ? `${month(a)} ${a.getDate()}–${b.getDate()}` : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`;
}

/** "Yesterday" or "Sun" for a game from before today ('' for today's). */
function dayLabel(ts: number, now = Date.now()) {
  const d = new Date(ts), today = new Date(now);
  if (d.toDateString() === today.toDateString()) return '';
  return d.toDateString() === new Date(now - 86400_000).toDateString() ? tr('time.yesterday') : d.toLocaleDateString(currentLocale(), { weekday: 'short' });
}

/** The status line under the teams: clock or inning, who has the ball, or the start time. Doubleheaders say which game. */
export function statusLine(g: GameCard, now = Date.now()) {
  let line: string;
  if (g.state === 'pre') line = startLabel(g.startsAt);
  else if (isFootball(g.league) && g.state === 'in' && g.downDistance) {
    const ball = g.possession === g.home?.team.key ? g.home?.team.abbrev : g.possession === g.away?.team.key ? g.away?.team.abbrev : null;
    line = `${g.detail} · ${ball ? `${tr('score.ball', { team: ball })}, ` : ''}${g.downDistance}`;
  } else line = g.state === 'post' ? [g.detail, dayLabel(g.startsAt, now)].filter(Boolean).join(' · ') : g.detail;
  return g.note ? `${g.note} · ${line}` : line;
}

/** A typical game, start to final (the server's GAME_LENGTH_MS), for a final without an end time. */
const GAME_LENGTH_MS: Partial<Record<string, number>> = { mlb: 3 * 3600_000, nfl: 3.25 * 3600_000, cfb: 3.5 * 3600_000, nba: 2.25 * 3600_000, wnba: 2 * 3600_000, nhl: 2.5 * 3600_000, epl: 2 * 3600_000, f1: 2 * 3600_000 };
const gameLength = (league: string) => GAME_LENGTH_MS[league] ?? 2 * 3600_000; // a league this build doesn't know: a soccer match's
/** Same window as the server: live, starting within a day, or finished in the last 24 hours. */
export const inWindow = (g: GameCard, now = Date.now()) =>
  g.state === 'in' || (g.state === 'pre' && g.startsAt - now < 24 * 3600_000)
  || (g.state === 'post' && now - (g.endedAt ?? g.startsAt + gameLength(g.league)) < 24 * 3600_000);

export const sectionTitle = (state: GameCard['state']) => tr(`scores.section.${state}`);
const RANK = { in: 0, pre: 1, post: 2 } as const;
export const byState = (a: GameCard, b: GameCard) =>
  RANK[a.state] - RANK[b.state] || (a.state === 'post' ? b.startsAt - a.startsAt : a.startsAt - b.startsAt);
