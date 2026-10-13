// How bad a loss was: a 0-100 score and a label ("Rough", "Ugly", "Disaster") for a loss, from how many points,
// runs or goals it was lost by and, once the pre-game chance is kept (not yet), how heavily the loser was favored.
// Pure arithmetic on numbers: it reads no database, makes no ESPN call and writes nothing, so the Recent misery
// endpoint (api.ts, misery.ts `ratingOf`) works it out at read time from a row's own facts, and every row already
// stored can be rated without a migration. docs/recent-misery.md, "How bad a loss was", has the formula, the bands and
// what is not covered yet.
//
//   B (blowout) = margin / (1.5 * BLOWOUT_MARGIN[league]), 0..1. BLOWOUT_MARGIN is the size at which the loss alert says
//                 "BLOWN OUT" (detectors.ts, about 1 in 8 losses), so a loss that size is B = 0.67 and 1.5 times it is 1.
//   U (upset)   = (chance - N) / (FAVORITE_CHANCE + 15 - N), 0..1: how far above an even game the loser's pre-game chance
//                 was, to 15 points past the "lost as the favorite" line. 0 when the chance isn't known.
//   score       = round(100 * (1 - (1 - 0.85 U) * (1 - 0.85 B))): either alone reaches 85, both together 98.
// Margin only (what the server has for every loss today) is the same formula with U = 0: round(85 * B).
//
// Labels: under 25 none (an ordinary loss shows nothing), 25-49 Rough, 50-74 Ugly, 75 and up Disaster.
import { BLOWOUT_MARGIN, FAVORITE_CHANCE } from './detectors.ts';
import { SOCCER, type League } from './leagues.ts';

export type LossLabel = 'Rough' | 'Ugly' | 'Disaster';
export interface LossRating { score: number; label: LossLabel | null }

/** Where each label starts, on the 0-100 score. */
export const BANDS: readonly { from: number; label: LossLabel }[] = [{ from: 75, label: 'Disaster' }, { from: 50, label: 'Ugly' }, { from: 25, label: 'Rough' }];
/** The most one part can count for: so either alone tops out at 85, and a perfect score takes both. */
const WEIGHT = 0.85;
/** How many times the blowout size the margin part is full at. */
const FULL_AT = 1.5;
/** The pre-game chance (percent) of an even game: soccer's is a three-way share, so a side of about 40 is level. */
const NEUTRAL_CHANCE = (lg: League) => (SOCCER.has(lg) ? 40 : 50);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const number = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The label for a score, or null below the first band. */
export const labelOf = (score: number): LossLabel | null => BANDS.find((b) => score >= b.from)?.label ?? null;

/**
 * Rate a loss. `margin`: the winner's score minus the loser's. `chance`: the loser's pre-game win chance in percent (not
 * passed yet). Null when there is nothing to rate: a league with no blowout size (UFC, F1), or no usable margin and
 * chance (a tie or a missing number is never guessed at). Never throws.
 */
export function rateLoss(league: string, facts: { margin?: unknown; chance?: unknown } | null | undefined): LossRating | null {
  const lg = league as League, size = BLOWOUT_MARGIN[lg];
  if (size == null) return null;
  const margin = number(facts?.margin) && facts.margin > 0 ? facts.margin : null;
  const chance = number(facts?.chance) ? facts.chance : null;
  if (margin == null && chance == null) return null;
  const b = margin == null ? 0 : clamp01(margin / (FULL_AT * size));
  const n = NEUTRAL_CHANCE(lg), top = (FAVORITE_CHANCE[lg] ?? 62) + 15;
  const u = chance == null ? 0 : clamp01((chance - n) / (top - n));
  const score = Math.round(100 * (1 - (1 - WEIGHT * u) * (1 - WEIGHT * b)));
  return { score, label: labelOf(score) };
}

/**
 * The margin of a loss whose row lost it (a backfilled row, a soccer 3+ goal loss stored before its alert carried it):
 * the loss alert's own body says "Final Score: 4 to 1" (gameLostEvent, always winner first). Null if the body doesn't or
 * the numbers aren't a win.
 */
export function marginFromBody(body: string | null | undefined): number | null {
  const m = /Final Score: (\d+) to (\d+)/.exec(body ?? '');
  const margin = m ? Number(m[1]) - Number(m[2]) : 0;
  return margin > 0 ? margin : null;
}

/** The line a row carries for older app builds, for the labels only: "Loss rating: Ugly (65/100)." */
export const ratingLine = (r: LossRating): string | null => (r.label ? `Loss rating: ${r.label} (${r.score}/100).` : null);
