// The app lists alerts in EVENT_TYPES' order under each one's section: offense, defense, pitching (or
// goaltending), then the team's; within a section the headline ones first, then feed-only, then off.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { EVENT_TYPES } = await import('../src/event-types.ts');
const { LEAGUE_IDS } = await import('../src/leagues.ts');

// Settings' groups, as the app makes them (settings.tsx).
const GROUPS: [string, typeof EVENT_TYPES][] = [
  ...LEAGUE_IDS.map((lg) => [`${lg} alerts`, EVENT_TYPES.filter((t) => t.leagues.length === 1 && t.leagues[0] === lg)] as [string, typeof EVENT_TYPES]),
  ['All player alerts', EVENT_TYPES.filter((t) => t.scope === 'player' && t.leagues.length > 1)],
  ['Team alerts', EVENT_TYPES.filter((t) => t.scope === 'team' && t.leagues.length > 1)],
];
const sectionsOf = (types: typeof EVENT_TYPES) => types.map((t) => t.section).filter((s, i, a) => s !== a[i - 1]);

test("each Settings group's sections, in order, each in one piece", () => {
  assert.deepEqual(Object.fromEntries(GROUPS.map(([g, types]) => [g, sectionsOf(types)])), {
    'nba alerts': ['Offense', 'Fouls', 'Team'],
    'wnba alerts': ['Offense', 'Fouls', 'Team'],
    'mlb alerts': ['Offense', 'Defense', 'Pitching', 'Challenges', 'Team'],
    'nfl alerts': ['Offense', 'Penalties', 'Special teams', 'Team'],
    'nhl alerts': ['Offense', 'Penalties', 'Goaltending', 'Team'],
    'f1 alerts': ['Race', 'Qualifying', 'Championship', 'Team'],
    'epl alerts': ['Attack', 'Defense', 'Cards & fouls', 'Goalkeeping', 'Lineup', 'Team'],
    'All player alerts': ['Game', 'Injuries & news'],
    'Team alerts': ['Game', 'Season', 'Injuries & news', 'Your Hate Watch'],
  });
  for (const [g, types] of GROUPS) assert.equal(new Set(sectionsOf(types)).size, sectionsOf(types).length, `${g}: a section comes back later`);
  assert.ok(EVENT_TYPES.every((t) => t.section), 'every alert has a section');
});

test('within a section: the ones that push first, then feed-only, then the ones off by default', () => {
  const tier = (t: (typeof EVENT_TYPES)[number]) => (!t.defaultOn ? 2 : t.defaultPush === false ? 1 : 0);
  for (const [g, types] of GROUPS) for (const s of sectionsOf(types)) {
    const tiers = types.filter((t) => t.section === s).map(tier);
    assert.deepEqual(tiers, [...tiers].sort(), `${g} / ${s}`);
  }
});

test('MLB in full, as Settings shows it', () => {
  const mlb = GROUPS.find(([g]) => g === 'mlb alerts')![1];
  assert.deepEqual(sectionsOf(mlb).map((s) => `${s}: ${mlb.filter((t) => t.section === s).map((t) => t.label).join(' · ')}`), [
    'Offense: Strikes out · Strikes out 3+ times · Hits into a double or triple play · Gets caught stealing or picked off · Gets thrown out on the bases · Goes down in order · Goes hitless · Makes an out',
    'Defense: Commits an error · Lets a run score on a passed ball',
    'Pitching: Blows a save · Takes the loss · Gives up a home run · Gives up back-to-back homers · Gets chased early · Hands over a run · No quality start · Gives up runs · Issues a walk / HBP',
    'Challenges: Loses a challenge',
    'Team: Gets no-hit · NOBLETIGER · Strands runners in scoring position · Has a position player pitching · Opponent has runners in scoring position',
  ]);
});
