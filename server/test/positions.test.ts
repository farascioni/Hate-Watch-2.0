// Which alerts fit a player, by the positions they've played: a pitcher's ⚙️ screen has no hitting alerts,
// a skater's no goalie ones. The rule is the app's (app/src/lib/positions.ts), on each alert's `positions`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { positionsOf } = await import('../src/catalog.ts');

type T = (typeof EVENT_TYPES)[number];
const fits = (t: T, mine: string[]) => !t.positions || !mine.length || mine.some((p) => (!t.positions!.only || t.positions!.only.includes(p)) && !t.positions!.not?.includes(p));
// A player's ⚙️ screen: their league's player alerts (and team ones that are also about players), then the shared ones.
const screen = (league: string, mine: string[]) => EVENT_TYPES
  .filter((t) => t.leagues.includes(league as T['leagues'][number]) && (t.scope === 'player' || t.alsoScope === 'player') && fits(t, mine))
  .filter((t) => t.leagues.length === 1).map((t) => t.label);

test('MLB: pitchers get no hitting alerts, hitters no pitching ones, two-way players both', () => {
  const skubal = screen('mlb', ['SP', 'P']), judge = screen('mlb', ['RF']), ohtani = screen('mlb', ['DH', 'P', 'SP']);
  assert.deepEqual(skubal, ['Commits an error', 'Blows a save', 'Takes the loss', 'Gives up a home run', 'Gives up back-to-back homers', 'Gets chased early', 'Hands over a run', 'No quality start', 'Gives up runs', 'Issues a walk / HBP', 'Loses a challenge']);
  assert.deepEqual(judge, ['Strikes out', 'Strikes out 3+ times', 'Hits into a double or triple play', 'Gets caught stealing or picked off', 'Gets thrown out on the bases', 'Goes hitless', 'Makes an out', 'Commits an error', 'Loses a challenge']);
  assert.equal(ohtani.length, 18, 'every MLB player alert but the catcher\'s');
  assert.equal(screen('mlb', []).length, 19, 'no position known: everything');
});

test('NFL: passing alerts for quarterbacks, kicks for kickers, fumbles for whoever carries the ball, a safety for the offense', () => {
  // Anyone can be flagged, so anyone can wipe out a touchdown.
  assert.deepEqual(screen('nfl', ['QB']), ['Throws an interception', 'Loses a fumble', 'Gives up a safety', 'Delay of game', 'Gets pulled', 'Gets sacked', 'Throws an incompletion', 'Fumbles (any)', 'Commits a penalty', 'Touchdown wiped out by a penalty']);
  assert.deepEqual(screen('nfl', ['WR']), ['Loses a fumble', 'Gives up a safety', 'Fumbles (any)', 'Commits a penalty', 'Touchdown wiped out by a penalty']);
  assert.deepEqual(screen('nfl', ['PK']), ['Commits a penalty', 'Touchdown wiped out by a penalty', 'Misses a kick']);
  assert.deepEqual(screen('nfl', ['DE']), ['Commits a penalty', 'Touchdown wiped out by a penalty']);
  assert.deepEqual(screen('nfl', ['CB']), ['Loses a fumble', 'Fumbles (any)', 'Commits a penalty', 'Touchdown wiped out by a penalty'], 'an interception or a punt return can end in a fumble');
  assert.deepEqual(screen('nfl', ['G']), ['Gives up a safety', 'Commits a penalty', 'Touchdown wiped out by a penalty'], 'a guard: held in his own end zone');
});

test('NHL and soccer: goalies get the goals against, skaters and outfield players the rest', () => {
  assert.deepEqual(screen('nhl', ['G']), ['Gives the puck away', 'Takes a penalty', 'Drops the gloves', 'Goalie allows a goal', 'Gets pulled']);
  assert.deepEqual(screen('nhl', ['C']), ['Misses in the shootout', 'Shoots and misses', 'Finishes -3 or worse', 'Gets a shot blocked', 'Shot gets saved', 'Gives the puck away', 'Takes a penalty', 'Drops the gloves']);
  assert.deepEqual(screen('epl', ['G']), ['Gives the ball away', 'Scores an own goal', 'Gives away a penalty', 'Sent off', 'Gets booked', 'Commits a foul', 'Keeper concedes a goal', 'Taken off early']);
  assert.ok(!screen('epl', ['F']).includes('Keeper concedes a goal'));
  assert.ok(screen('epl', ['F']).includes('Misses a penalty'));
  assert.equal(screen('nba', ['C']).length, 9, 'basketball: everyone gets every alert');
});

test("a roster entry's positions: its main one first, then every other it lists", () => {
  // ESPN's roster entry for Shohei Ohtani (Dodgers, October 2026).
  assert.deepEqual(positionsOf({ position: { abbreviation: 'DH' }, positions: [{ abbreviation: 'P' }, { abbreviation: 'DH' }, { abbreviation: 'SP' }] }), ['DH', 'P', 'SP']);
  assert.deepEqual(positionsOf({ position: { abbreviation: 'RF' } }), ['RF']);
  assert.equal(positionsOf({}), null);
});
