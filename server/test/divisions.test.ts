// The Search tab's "By division": each team's division from ESPN's division-level standings, named the way
// fans say it. Group shapes as ESPN sent them on 2026-10-07.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { parseDivisions, divisionsDeps } = await import('../src/divisions.ts');
const { urls } = await import('../src/leagues.ts');
const { startApi } = await import('../src/api.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, abbr] of [['mlb', '10', 'New York Yankees', 'NYY'], ['mlb', '30', 'Tampa Bay Rays', 'TB'], ['mlb', '5', 'Cleveland Guardians', 'CLE'], ['nfl', '1', 'Atlanta Falcons', 'ATL'], ['nfl', '18', 'New Orleans Saints', 'NO'],
  ['f1', '106', 'Ferrari', 'FER']]) team.run(`team:${lg}:${id}`, lg, id, name, name, abbr);
loadCatalog();

const group = (o: object, ids: string[]) => ({ ...o, standings: { entries: ids.map((id) => ({ team: { id } })) } });
const MLB = { children: [{ name: 'American League', children: [
  group({ name: 'American League East', shortName: 'AL East', abbreviation: 'ALE' }, ['10', '30']),
  group({ name: 'American League Central', shortName: 'AL Cent', abbreviation: 'ALC' }, ['5'])] }] };
const NFL = { children: [{ name: 'National Football Conference', children: [group({ name: 'NFC South', abbreviation: 'SOUTH' }, ['1', '18'])] }] };

test('division names the way fans say them', () => {
  const name = (lg: any, res: any) => [...parseDivisions(lg, res)].map(([id, d]) => `${id} ${d.name} #${d.order}`);
  assert.deepEqual(name('mlb', MLB), ['10 AL East #0', '30 AL East #0', '5 AL Central #1'], "ESPN's short names, \"AL Cent\" spelled out");
  assert.deepEqual(name('nba', { children: [{ name: 'Eastern Conference', children: [group({ name: 'Atlantic', abbreviation: 'AT' }, ['2'])] }] }), ['2 East · Atlantic #0']);
  assert.deepEqual(name('nhl', { children: [{ name: 'Western Conference', children: [group({ name: 'Pacific Division', abbreviation: 'PAC' }, ['6'])] }] }), ['6 West · Pacific #0']);
  assert.deepEqual(name('wnba', { children: [group({ name: 'Eastern Conference', abbreviation: 'E' }, ['20'])] }), ['20 Eastern Conference #0'], 'the WNBA: conferences');
  assert.deepEqual(name('epl', { name: 'English Premier League', children: [group({ name: '2026-27 English Premier League', abbreviation: '2026-2027' }, ['364'])] }), ['364 Premier League #0'], 'one table, named for the league, not the season');
});

test('GET /teams?by=division: by league (the app\'s order), then division, then name; F1\'s constructors together', async () => {
  divisionsDeps.getJson = async (url: string) => (url === `${urls.standings('mlb')}?level=3` ? MLB : url === `${urls.standings('nfl')}?level=3` ? NFL : {});
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const list = async (q: string) => (await (await fetch(`${base}/teams${q}`)).json()).teams.map((t: any) => `${t.abbrev}${t.division ? ` (${t.division})` : ''}`);
  assert.deepEqual(await list('?by=division'), ['NYY (AL East)', 'TB (AL East)', 'CLE (AL Central)', 'ATL (NFC South)', 'NO (NFC South)', 'FER (Constructors)']);
  assert.deepEqual(await list('?league=mlb&by=division'), ['NYY (AL East)', 'TB (AL East)', 'CLE (AL Central)']);
  assert.deepEqual(await list('?league=mlb'), ['CLE', 'NYY', 'TB'], 'A-Z, as before');
  server.close();
});
