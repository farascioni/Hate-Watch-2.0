// "Up next" on the Scores tab: each tracked team's next game from its ESPN schedule. Shapes as ESPN sent
// them on 2026-10-07 (Yankees: ALDS Games 3-5, the last two "If Necessary"; Hawks: preseason; Liverpool:
// fixtures only when asked; Red Sox: season over).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { nextFromSchedule, refreshUpNext, upNextFor, staleUpNext, upNextDeps } = await import('../src/upnext.ts');
const { urls } = await import('../src/leagues.ts');
const { startApi } = await import('../src/api.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, short, abbr] of [['mlb', '10', 'New York Yankees', 'Yankees', 'NYY'], ['mlb', '30', 'Tampa Bay Rays', 'Rays', 'TB'], ['mlb', '2', 'Boston Red Sox', 'Red Sox', 'BOS'],
  ['nba', '1', 'Atlanta Hawks', 'Hawks', 'ATL'], ['nba', '24', 'San Antonio Spurs', 'Spurs', 'SA'], ['epl', '364', 'Liverpool', 'Liverpool', 'LIV'], ['epl', '382', 'Manchester City', 'Man City', 'MNC'],
  ['nfl', '1', 'Atlanta Falcons', 'Falcons', 'ATL'], ['nfl', '33', 'Baltimore Ravens', 'Ravens', 'BAL']]) team.run(`team:${lg}:${id}`, lg, id, name, short, abbr);
loadCatalog();

const NOW = Date.parse('2026-10-07T16:00:00Z');
const game = (id: string, date: string, home: string, away: string, o: { note?: string; tv?: string; state?: string; type?: number; timeValid?: boolean } = {}) => ({
  id, date, timeValid: o.timeValid ?? true, seasonType: { type: o.type ?? 3 },
  competitions: [{
    status: { type: { state: o.state ?? 'pre' } },
    competitors: [{ id: home, homeAway: 'home', team: {} }, { id: away, homeAway: 'away', team: {} }],
    notes: o.note ? [{ type: 'event', headline: o.note }] : [],
    broadcasts: o.tv ? [{ market: { type: 'National' }, media: { shortName: o.tv } }] : [],
  }],
});
const YANKEES = { requestedSeason: { type: 3 }, events: [
  game('g2', '2026-10-06T00:00Z', '10', '30', { note: 'ALDS - Game 2', state: 'post' }),
  game('g3', '2026-10-08T00:00Z', '10', '30', { note: 'ALDS - Game 3', tv: 'TBS' }),
  game('g4', '2026-10-09T00:00Z', '10', '30', { note: 'ALDS - Game 4 If Necessary', tv: 'TBS' }),
  game('g5', '2026-10-11T00:00Z', '30', '10', { note: 'ALDS - Game 5 If Necessary', tv: 'TBS' }),
] };

test("a team's next game: the first not started, with its TV and what kind of game it is", () => {
  const n = nextFromSchedule('mlb', '10', YANKEES, NOW)!;
  assert.deepEqual([n.key, n.teamKey, n.home.shortName, n.away.shortName, n.tv, n.note], ['mlb:g3', 'team:mlb:10', 'Yankees', 'Rays', 'TBS', 'ALDS Game 3']);
  // Tonight's game over: Game 4, if necessary.
  const after = { ...YANKEES, events: YANKEES.events.map((e) => (e.id === 'g3' ? game('g3', e.date, '10', '30', { state: 'post' }) : e)) };
  assert.equal(nextFromSchedule('mlb', '10', after, NOW)!.note, 'ALDS Game 4 · if necessary');
  assert.equal(nextFromSchedule('nba', '1', { events: [game('p1', '2026-10-09T00:00Z', '24', '1', { type: 1 })] }, NOW)!.note, 'Preseason');
  assert.equal(nextFromSchedule('nfl', '1', { events: [game('w6', '2026-10-12T00:20Z', '1', '33', { type: 2, timeValid: false })] }, NOW)!.timeValid, false);
  assert.equal(nextFromSchedule('mlb', '2', { requestedSeason: { type: 3 }, events: [game('wc2', '2026-09-30T23:00Z', '10', '2', { state: 'post' })] }, NOW), null, 'season over');
});

test('read per team (soccer asks for fixtures; an empty season part looks in the next), shared by the devices that track it', async () => {
  const asked: string[] = [];
  upNextDeps.getJson = async (url: string) => {
    asked.push(url.replace('https://site.api.espn.com/apis/site/v2/sports/', ''));
    if (url === urls.teamSchedule('mlb', '10')) return YANKEES;
    if (url === urls.teamSchedule('mlb', '30')) return YANKEES; // the same series, from the Rays' side
    if (url === urls.teamSchedule('nba', '1')) return { requestedSeason: { type: 1 }, events: [game('p0', '2026-10-01T00:00Z', '1', '24', { type: 1, state: 'post' })] }; // preseason done
    if (url === `${urls.teamSchedule('nba', '1')}?seasontype=2`) return { requestedSeason: { type: 2 }, events: [game('r1', '2026-10-22T23:30Z', '1', '24', { type: 2 })] };
    if (url === urls.teamSchedule('mlb', '2')) return { requestedSeason: { type: 3 }, events: [game('wc2', '2026-09-30T23:00Z', '10', '2', { state: 'post' })] }; // out in the Wild Card round
    if (url === `${urls.teamSchedule('epl', '364')}?fixture=true`) return { events: [game('m1', '2026-10-11T15:30Z', '364', '382', { type: 14308, tv: 'NBC' })] };
    return { events: [] };
  };
  await refreshUpNext(['team:mlb:10', 'team:mlb:30', 'team:nba:1', 'team:epl:364', 'team:mlb:2', 'team:f1:106'], NOW);
  assert.deepEqual(asked.sort(), ['baseball/mlb/teams/10/schedule', 'baseball/mlb/teams/2/schedule', 'baseball/mlb/teams/30/schedule',
    'basketball/nba/teams/1/schedule', 'basketball/nba/teams/1/schedule?seasontype=2', 'soccer/eng.1/teams/364/schedule?fixture=true'].sort(), 'F1 has its own next race weekend; a postseason that is over has nothing later to look in');
  // Soonest first; the Yankees and the Rays are tracked by one device but it's one game.
  assert.deepEqual(upNextFor(['team:mlb:10', 'team:mlb:30', 'team:nba:1', 'team:epl:364', 'team:mlb:2']).map((n) => n.key), ['mlb:g3', 'epl:m1', 'nba:r1']);
  // Not read again until it's due, or the team's game ends.
  asked.length = 0;
  await refreshUpNext(['team:mlb:10', 'team:nba:1'], NOW + 60_000);
  assert.deepEqual(asked, []);
  staleUpNext('team:mlb:10');
  await refreshUpNext(['team:mlb:10', 'team:nba:1'], NOW + 120_000);
  assert.deepEqual(asked, ['baseball/mlb/teams/10/schedule']);
});

test("a device's scores carry its teams' next games", async () => {
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = (await (await fetch(`${base}/devices`, { method: 'POST', body: '{}' })).json()).token as string;
  const auth = { authorization: `Bearer ${token}` };
  await fetch(`${base}/me/follows/${encodeURIComponent('team:epl:364')}`, { method: 'PUT', headers: auth });
  const scores = await (await fetch(`${base}/me/scores`, { headers: auth })).json();
  assert.deepEqual(scores.upNext.map((n: any) => `${n.home.shortName} vs ${n.away.shortName} · ${n.tv}`), ['Liverpool vs Man City · NBC']);
  server.close();
});
