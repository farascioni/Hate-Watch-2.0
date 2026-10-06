// Players on an injured list who are off their team's roster still join it: MLB's 60-day IL takes
// a player off the 40-man roster ESPN gives us. Shapes as ESPN's MLB injury report had them (2026-10-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { injuredOffRoster } = await import('../src/catalog.ts');

const astros = { key: 'team:mlb:18', espnId: '18', abbrev: 'HOU' } as any;
const athlete = (id: string, name: string, pos: string) => ({
  displayName: name, shortName: name.replace(/^(\w)\w*/, '$1.'), position: { abbreviation: pos },
  headshot: { href: `https://a.espncdn.com/i/headshots/mlb/players/full/${id}.png`, alt: name },
  links: [{ rel: ['playercard'], href: `https://www.espn.com/mlb/player/_/id/${id}` }],
});
const report = { injuries: [
  { id: '18', displayName: 'Houston Astros', injuries: [
    { status: 'Out', athlete: athlete('41261', 'Cristian Javier', 'SP') }, // on the 10-day IL, still on the 40-man
    { status: '60-Day-IL', athlete: athlete('32653', 'Carlos Correa', 'SS') },
  ] },
  { id: '999', displayName: 'Not a team we know', injuries: [{ status: 'Out', athlete: athlete('1', 'Nobody', 'P') }] },
] };

test('injured players off the roster join their team; ones already on it are not added twice', () => {
  const out = injuredOffRoster(report, [astros], new Set(['41261']));
  assert.deepEqual(out.map((e) => [e.a.id, e.a.displayName, e.a.position.abbreviation, e.team.key]), [['32653', 'Carlos Correa', 'SS', 'team:mlb:18']]);
  assert.equal(out[0].a.headshot.href, 'https://a.espncdn.com/i/headshots/mlb/players/full/32653.png', 'his own headshot, for the same check as everyone else');
  assert.deepEqual(injuredOffRoster(null, [astros], new Set()), [], 'no report: just the rosters');
});
