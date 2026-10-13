// How bad a loss was (loss-rating.ts): the formula per league, its clamps and garbage inputs, the label boundaries, the
// upset part (written and tested, not wired to anything yet), and the real week of production losses (October 6-13, 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.HW_DB = ':memory:';
const { BLOWOUT_MARGIN } = await import('../src/detectors.ts');
const { BANDS, labelOf, marginFromBody, rateLoss } = await import('../src/loss-rating.ts');
const { ratingOf } = await import('../src/misery.ts');

const LEAGUES = ['mlb', 'nba', 'nfl', 'cfb', 'nhl', 'wnba', 'epl'] as const;

test('each league scores 25 / 50 / 75 / 85 at 0.44, 0.88, 1.32 and 1.5 times its blowout size, and nothing at 0', () => {
  for (const lg of LEAGUES) {
    const size = BLOWOUT_MARGIN[lg]!;
    assert.ok(size > 0, `${lg} has a blowout size`);
    assert.equal(rateLoss(lg, { margin: 0 }), null, `${lg}: a margin of 0 is no loss to rate`);
    assert.deepEqual([0.44, 0.88, 1.32, 1.5].map((x) => rateLoss(lg, { margin: x * size })!.score), [25, 50, 75, 85], lg);
    assert.deepEqual([0.44, 0.88, 1.32, 1.5].map((x) => rateLoss(lg, { margin: x * size })!.label), ['Rough', 'Ugly', 'Disaster', 'Disaster'], lg);
  }
});

test('the real margins land where the blowout size says: a blowout is Ugly, 1.5 times it is a Disaster, soccer included', () => {
  const at = (lg: string, margin: number) => rateLoss(lg, { margin })!;
  assert.deepEqual([at('mlb', 7), at('mlb', 10)].map((r) => r.label), ['Ugly', 'Disaster'], 'MLB: 7 runs is the blowout, 10 is a Disaster');
  assert.deepEqual([at('nfl', 21), at('nfl', 28)].map((r) => r.label), ['Ugly', 'Disaster']);
  assert.deepEqual([at('nhl', 1), at('nhl', 2), at('nhl', 4), at('nhl', 6)].map((r) => r.label), [null, 'Rough', 'Ugly', 'Disaster']);
  assert.deepEqual([at('epl', 1), at('epl', 2), at('epl', 3), at('epl', 4)].map((r) => r.label), [null, 'Rough', 'Ugly', 'Disaster'], 'soccer: 3 goals is "thrashed"');
  assert.equal(at('mlb', 1).score, 8, 'a one-run loss still has a score; only its label is none');
  assert.equal(at('mlb', 1).label, null);
});

test('a margin past 1.5 times the blowout size is clamped at 85; a margin that is not a win, or not a number, is never rated', () => {
  assert.equal(rateLoss('nba', { margin: 100 })!.score, 85);
  assert.equal(rateLoss('nba', { margin: 1e9 })!.score, 85);
  for (const margin of [0, -3, NaN, Infinity, -Infinity, '12', null, undefined, {}, [4]]) assert.equal(rateLoss('nba', { margin }), null, `margin ${String(margin)}`);
  assert.equal(rateLoss('nba', {}), null);
  assert.equal(rateLoss('nba', null), null);
  assert.equal(rateLoss('nba', undefined), null);
});

test('a league with no blowout size (the UFC, F1, an unknown one) is never rated', () => {
  for (const lg of ['ufc', 'f1', 'xyz', '']) assert.equal(rateLoss(lg, { margin: 50 }), null, lg);
});

test('the labels: under 25 none, 25 Rough, 50 Ugly, 75 Disaster', () => {
  assert.deepEqual(BANDS.map((b) => [b.from, b.label]), [[75, 'Disaster'], [50, 'Ugly'], [25, 'Rough']]);
  assert.deepEqual([0, 24, 25, 49, 50, 74, 75, 85, 100].map(labelOf), [null, null, 'Rough', 'Rough', 'Ugly', 'Ugly', 'Disaster', 'Disaster', 'Disaster']);
});

test("the margin from a loss alert's body, for rows that lost theirs", () => {
  assert.equal(marginFromBody('Final Score: 4 to 1'), 3);
  assert.equal(marginFromBody('Down 0-2 in the NLCS. Final Score: 7 to 4'), 3);
  assert.equal(marginFromBody('Final Score: 119 to 66. A 53-point blowout.'), 53);
  for (const body of ['Final Score: 3 to 3', 'Final Score: 1 to 4', 'Swept 3-0 by the Rays in the ALDS.', '', null, undefined]) assert.equal(marginFromBody(body), null, String(body));
});

test('the upset part (written, not wired to anything yet): how far above an even game the loser was, to 15 points past "lost as the favorite"', () => {
  // MLB: even at 50, full at 62 + 15 = 77. The chance alone is a score (85 at most); with no margin B is 0.
  assert.equal(rateLoss('mlb', { chance: 50 })!.score, 0);
  assert.equal(rateLoss('mlb', { chance: 40 })!.score, 0, 'an underdog that loses is no upset');
  assert.equal(rateLoss('mlb', { chance: 62 })!.score, 38, '62% is the "lost as the favorite" line: 12 of 27 points to the top');
  assert.equal(rateLoss('mlb', { chance: 77 })!.score, 85);
  assert.equal(rateLoss('mlb', { chance: 99 })!.score, 85, 'clamped');
  // NBA: 75 is the favorite line, full at 90.
  assert.equal(rateLoss('nba', { chance: 90 })!.score, 85);
  assert.equal(rateLoss('nba', { chance: 75 })!.label, 'Ugly');
  // Soccer is a three-way share, so even is about 40 and the top is 60 + 15.
  assert.equal(rateLoss('epl', { chance: 40 })!.score, 0);
  assert.equal(rateLoss('epl', { chance: 75 })!.score, 85);
  // Both together: either alone tops out at 85, both reach 98.
  assert.equal(rateLoss('mlb', { margin: 15, chance: 77 })!.score, 98);
  assert.equal(rateLoss('mlb', { margin: 4, chance: 62 })!.score, Math.round(100 * (1 - (1 - 0.85 * (12 / 27)) * (1 - 0.85 * (4 / 10.5)))));
  // A chance that is not a number is ignored: the margin alone is rated.
  assert.deepEqual(rateLoss('mlb', { margin: 7, chance: 'high' }), rateLoss('mlb', { margin: 7 }));
  assert.equal(rateLoss('mlb', { margin: 7, chance: NaN })!.score, 57);
});

/** The week's losses as production kept them (October 6-13, 2026): the rows' own league, title and meta. */
const week = JSON.parse(readFileSync(new URL('./fixtures/misery-losses-week-2026-10-13.json', import.meta.url), 'utf8')) as { league: string; title: string; meta: string }[];
const rated = (title: string) => {
  const r = week.find((w) => w.title === title);
  assert.ok(r, title);
  return ratingOf({ kind: 'loss', league: r.league, body: '', meta: r.meta });
};

test("production's week with these bands: 3 Disaster, 4 Ugly, 15 Rough, 26 none, and 7 rows nothing can rate", () => {
  const tally: Record<string, number> = {};
  for (const w of week) {
    const r = ratingOf({ kind: 'loss', league: w.league, body: '', meta: w.meta });
    const k = r ? r.label ?? 'none' : 'unrated';
    tally[k] = (tally[k] ?? 0) + 1;
  }
  assert.equal(week.length, 55);
  assert.deepEqual(tally, { Disaster: 3, Ugly: 4, Rough: 15, none: 26, unrated: 7 });
});

test('real rows: the blowouts and the squeakers', () => {
  assert.deepEqual(rated('Raiders got BLOWN OUT by the Patriots'), { score: 76, label: 'Disaster' }, 'NFL 45-17, 28 points');
  assert.deepEqual(rated('Bears got BLOWN OUT by the Packers'), { score: 65, label: 'Ugly' }, 'NFL 31-7');
  assert.deepEqual(rated('Flames got BLOWN OUT by the Avalanche'), { score: 57, label: 'Ugly' }, 'NHL 7-3, 4 goals');
  assert.deepEqual(rated('Dodgers lost to the Brewers'), { score: 8, label: null }, 'MLB 2-1: a score, no label');
  assert.deepEqual(rated('Seahawks lost to the 49ers'), { score: 8, label: null }, 'NFL 32-29: 3 points');
  assert.equal(rated('Alpine finished outside the points'), null, 'F1 has no score');
  assert.equal(rated('Newcastle were thrashed 4-1 by Coventry'), null, 'the soccer row that kept no margin: nothing to rate from its meta (its body is the fallback: misery.test.ts)');
});

test('real rows with no margin in their meta are not rated (never guessed)', () => {
  for (const title of ['Braves lost to the Dodgers', 'Brewers lost to the Padres']) assert.equal(rated(title), null, title);
});
