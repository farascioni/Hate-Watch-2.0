// Knocked out of the playoffs: that game's Successful Hate Watch says so, in one alert. The standings
// never mark these teams eliminated (the 2026 Wild Card losers kept their "y"/"x"), so it comes from the
// final on the scoreboard: a series that's over, or an NFL playoff loss. Shapes as ESPN sent them
// (2026-09-30, 2026-10-01, 2026-04-30, 2026-02-08), and tonight's TB @ NYY (ALDS Game 3, Rays up 2-0)
// through the live scoreboard scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
process.env.HW_DECISION_RETRY_MS = '1'; // an MLB final looks for pitching decisions; don't wait for them here
process.env.HW_PLAYOFF_FINAL_WAIT_MS = '150';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { DEFAULT_PREFS } = await import('../src/fanout.ts');
const { eliminationOf, gameLostEvent } = await import('../src/detectors.ts');
const { engine, liveDeps, GameTracker } = await import('../src/live.ts');
const { hateWatchTally } = await import('../src/hate-watches.ts');
const { urls } = await import('../src/leagues.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, short, abbr] of [['mlb', '10', 'New York Yankees', 'Yankees', 'NYY'], ['mlb', '30', 'Tampa Bay Rays', 'Rays', 'TB'], ['mlb', '2', 'Boston Red Sox', 'Red Sox', 'BOS'],
  ['mlb', '22', 'Philadelphia Phillies', 'Phillies', 'PHI'], ['mlb', '15', 'Atlanta Braves', 'Braves', 'ATL'], ['nhl', '9', 'Dallas Stars', 'Stars', 'DAL'], ['nhl', '30', 'Minnesota Wild', 'Wild', 'MIN'],
  ['nfl', '17', 'New England Patriots', 'Patriots', 'NE'], ['nfl', '26', 'Seattle Seahawks', 'Seahawks', 'SEA']]) team.run(`team:${lg}:${id}`, lg, id, name, short, abbr);
db.prepare(`INSERT INTO players (key, league, espn_id, name, team_key, image, image_w, image_h, image_kind, updated_at) VALUES ('player:mlb:33192', 'mlb', '33192', 'Aaron Judge', 'team:mlb:10', 'x', 1, 1, 'headshot', 0)`).run();
loadCatalog();

/** A postseason final as the scoreboard has it. */
const final = (o: { id: string; home: [string, number]; away: [string, number]; round: string; series?: { wins: Record<string, number>; done: boolean; total?: number }; type?: number }) => ({
  id: o.id, date: new Date(Date.now() - 3 * 3600_000).toISOString(), season: { year: 2026, type: o.type ?? 3 }, shortName: 'X @ Y',
  status: { type: { state: 'post', completed: true, shortDetail: 'Final' } },
  competitions: [{
    competitors: [{ id: o.home[0], homeAway: 'home', score: String(o.home[1]), team: {} }, { id: o.away[0], homeAway: 'away', score: String(o.away[1]), team: {} }],
    notes: [{ type: 'event', headline: o.round }],
    ...(o.series ? { series: { type: 'playoff', completed: o.series.done, totalCompetitions: o.series.total ?? 5, competitors: Object.entries(o.series.wins).map(([id, wins]) => ({ id, wins, ties: 0 })) } } : {}),
  }],
});

test('who a playoff final knocks out, and whether it was a sweep', () => {
  // BOS @ NYY, 2026-09-30: "NYY win series 2-0". PHI @ ATL, 2026-10-01: "ATL wins series 2-1". DAL @ MIN, 2026-04-30: "MIN wins series 4-2".
  assert.deepEqual(eliminationOf('mlb', final({ id: 'a', home: ['10', 3], away: ['2', 1], round: 'ALWC - Game 2', series: { wins: { 2: 0, 10: 2 }, done: true, total: 3 } })),
    { loserId: '2', winnerId: '10', sweep: true, line: 'Swept 2-0 by the Yankees in the AL Wild Card Series' });
  assert.equal(eliminationOf('mlb', final({ id: 'b', home: ['15', 4], away: ['22', 2], round: 'NLWC - Game 3', series: { wins: { 22: 1, 15: 2 }, done: true, total: 3 } }))!.line, 'Lost the NL Wild Card Series 2-1 to the Braves');
  assert.equal(eliminationOf('nhl', final({ id: 'c', home: ['30', 4], away: ['9', 2], round: 'West 1st Round - Game 6', series: { wins: { 9: 2, 30: 4 }, done: true, total: 7 } }))!.line, 'Lost the West 1st Round 4-2 to the Wild');
  assert.equal(eliminationOf('nfl', final({ id: 'd', home: ['17', 13], away: ['26', 29], round: 'Super Bowl LX' }))!.line, 'Lost Super Bowl LX to the Seahawks');
  // The scoreboard can show a final before it counts it in the series: Game 3 over, wins still 2-0.
  assert.deepEqual(eliminationOf('mlb', final({ id: 'e', home: ['10', 2], away: ['30', 5], round: 'ALDS - Game 3', series: { wins: { 10: 0, 30: 2 }, done: false } })),
    { loserId: '10', winnerId: '30', sweep: true, line: 'Swept 3-0 by the Rays in the ALDS' });
  // Not the end: Game 2 counted (2-0 in a best of 5), a series tied, the regular season.
  assert.equal(eliminationOf('mlb', final({ id: 'f', home: ['10', 2], away: ['30', 5], round: 'ALDS - Game 2', series: { wins: { 10: 0, 30: 2 }, done: false } })), null);
  assert.equal(eliminationOf('mlb', final({ id: 'g', home: ['15', 2], away: ['22', 5], round: 'NLWC - Game 2', series: { wins: { 22: 1, 15: 1 }, done: false, total: 3 } })), null);
  assert.equal(eliminationOf('mlb', final({ id: 'h', home: ['10', 2], away: ['30', 5], round: '', type: 2 })), null);
});

test("the loss and the elimination are one alert, counting for either switch", () => {
  const g = { league: 'mlb' as const, gameId: 'G', homeId: '10', awayId: '30' };
  const out = eliminationOf('mlb', final({ id: 'G', home: ['10', 2], away: ['30', 5], round: 'ALDS - Game 3', series: { wins: { 10: 0, 30: 3 }, done: true } }));
  const e = gameLostEvent(g, { home: 2, away: 5 }, 0, out)!;
  assert.deepEqual([e.id, e.type, e.title, e.body, e.aliases], ['G:final:team.lost:10', 'team.lost', 'Successful Hate Watch! Yankees got SWEPT 🧹 and are ELIMINATED ⚰️', 'Swept 3-0 by the Rays in the ALDS. Final Score: 5 to 2', ['team.eliminated']]);
  assert.equal(gameLostEvent(g, { home: 2, away: 5 }, 0)!.title, 'Successful Hate Watch! Yankees lost to the Rays', 'any other loss');
  const nfl = gameLostEvent({ league: 'nfl', gameId: 'S', homeId: '17', awayId: '26' }, { home: 13, away: 29 }, 0, eliminationOf('nfl', final({ id: 'S', home: ['17', 13], away: ['26', 29], round: 'Super Bowl LX' })))!;
  assert.deepEqual([nfl.title, nfl.body], ['Successful Hate Watch! Patriots are ELIMINATED ⚰️', 'Lost Super Bowl LX to the Seahawks. Final Score: 29 to 13']);
});

const device = db.prepare('INSERT INTO devices (id, secret, platform, prefs, created_at) VALUES (?, ?, ?, ?, 0)');
const follow = db.prepare('INSERT INTO follows (device_id, target_key, created_at) VALUES (?, ?, 0)');
for (const [id, key, prefs] of [
  ['yankees-hater', 'team:mlb:10', {}],
  ['eliminations-only', 'team:mlb:10', { types: { 'team.lost': false } }],
  ['both-off', 'team:mlb:10', { types: { 'team.lost': false, 'team.eliminated': false } }],
  ['judge-hater', 'player:mlb:33192', {}],
  ['rays-hater', 'team:mlb:30', {}],
] as const) { device.run(id, 's', 'test', JSON.stringify({ ...DEFAULT_PREFS, ...prefs })); follow.run(id, key); }
const feed = (dev: string) => (db.prepare(`SELECT e.type, e.title, e.body FROM feed f JOIN events e ON e.id = f.event_id WHERE f.device_id = ? ORDER BY f.rowid`).all(dev) as any[]).map((r) => `${r.type}: ${r.title} | ${r.body}`);

test('tonight: if the Rays finish the sweep at Yankee Stadium, one alert says it all', async () => {
  const tonight = final({ id: '401890003', home: ['10', 2], away: ['30', 5], round: 'ALDS - Game 3', series: { wins: { 10: 0, 30: 3 }, done: true } });
  liveDeps.getJson = async (url: string) => {
    if (url === urls.scoreboard('mlb')) return { events: [tonight] };
    if (url.startsWith(urls.summary('mlb', '401890003'))) return {}; // no pitching decisions in this fake
    throw new Error(`unexpected fetch ${url}`);
  };
  const scan = () => (engine as any).scanScoreboard('mlb');
  await scan();
  await scan(); // the final stays on the scoreboard, read every 10s
  const sweep = 'team.lost: Successful Hate Watch! Yankees got SWEPT 🧹 and are ELIMINATED ⚰️ | Swept 3-0 by the Rays in the ALDS. Final Score: 5 to 2';
  assert.deepEqual(feed('yankees-hater'), [sweep]);
  assert.deepEqual(feed('eliminations-only'), [sweep], 'loss alerts off, eliminations on: still told');
  assert.deepEqual(feed('both-off'), []);
  assert.deepEqual(feed('judge-hater'), ['player.team_lost: Successful Hate Watch! Aaron Judge and the Yankees lost to the Rays | Swept 3-0 by the Rays in the ALDS. Final Score: 5 to 2']);
  assert.deepEqual(feed('rays-hater'), [], 'the Rays won');
  for (const dev of ['yankees-hater', 'both-off', 'judge-hater']) assert.equal(hateWatchTally(dev).total, 1, `${dev}: one Successful Hate Watch`);
});

test('a playoff final the tracker sees first waits for the scoreboard, and goes out anyway if it never comes', async () => {
  let state = 'in';
  liveDeps.getJson = async (url: string) => {
    if (url.startsWith(urls.corePlays('mlb', 'P2').split('?')[0])) return { items: [] };
    if (url.startsWith(urls.summary('mlb', 'P2'))) return { header: { season: { type: 3 }, competitions: [{ status: { type: { state, completed: state === 'post' } }, competitors: [{ homeAway: 'home', score: '1' }, { homeAway: 'away', score: '4' }] }] } };
    throw new Error(`unexpected fetch ${url}`);
  };
  const game = new GameTracker('mlb', 'P2', '10', '30');
  await game.poll();
  state = 'post';
  await game.poll();
  assert.equal(feed('yankees-hater').filter((t) => t.includes('Final Score: 4 to 1')).length, 0, 'waiting for the scoreboard');
  await new Promise((r) => setTimeout(r, 200));
  await game.poll();
  assert.deepEqual(feed('yankees-hater').filter((t) => t.includes('Final Score: 4 to 1')), ['team.lost: Successful Hate Watch! Yankees lost to the Rays | Final Score: 4 to 1'], 'no series: the plain loss');
});
