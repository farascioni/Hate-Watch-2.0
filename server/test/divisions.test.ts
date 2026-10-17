// The Search tab's "By division": each team's division from ESPN's division-level standings, named the way
// fans say it. Group shapes as ESPN sent them on 2026-10-07.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.HW_DB = ':memory:';
const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/catalog.ts');
const { parseDivisions, postseasonStreaks, constructorStandings, driverStandings, divisionsDeps } = await import('../src/divisions.ts');
const { urls } = await import('../src/leagues.ts');
const { startApi } = await import('../src/api.ts');

const team = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, logo, logo_w, logo_h, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x', 1, 1, 0)`);
for (const [lg, id, name, abbr] of [['mlb', '10', 'New York Yankees', 'NYY'], ['mlb', '30', 'Tampa Bay Rays', 'TB'], ['mlb', '5', 'Cleveland Guardians', 'CLE'], ['nfl', '1', 'Atlanta Falcons', 'ATL'], ['nfl', '18', 'New Orleans Saints', 'NO'],
  ['f1', '106', 'Ferrari', 'FER']]) team.run(`team:${lg}:${id}`, lg, id, name, name, abbr);
loadCatalog();

const group = (o: object, ids: string[], stats: object[] = []) => ({ ...o, standings: { entries: ids.map((id) => ({ team: { id }, stats })) } });
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

test('record and streak come with the division, only where ESPN has them', () => {
  const got = (lg: any, stats: object[]) => parseDivisions(lg, { children: [group({ name: 'Atlantic Division', abbreviation: 'AT' }, ['2'], stats)] }).get('2');
  assert.deepEqual(got('mlb', [{ name: 'overall', displayValue: '93-68' }, { name: 'streak', displayValue: 'W1' }]), { name: 'AL East'.replace('AL East', got('mlb', [])!.name), order: 0, record: '93-68', streak: 'W1' });
  assert.equal(got('nhl', [{ name: 'overall', displayValue: '6-2-0, 12 PTS' }])?.record, '6-2-0', "the NHL's points are cut off");
  assert.equal(got('epl', [{ name: 'overall', displayValue: '7-0-0' }])?.streak, undefined, 'no streak, no key');
  assert.equal('record' in got('nba', [])!, false);
});

test('a postseason streak replaces the regular season\'s, only for teams that played one this season', () => {
  const table = (season: number, rows: [string, number, number, string][]) => ({ children: [{ standings: { season, entries: rows.map(([id, w, l, streak]) => ({ team: { id }, stats: [{ name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'streak', displayValue: streak }] })) } }] });
  const regular = table(2026, [['19', 100, 62, 'W3'], ['10', 93, 68, 'W1']]);
  assert.deepEqual([...postseasonStreaks(regular, table(2026, [['19', 3, 5, 'L4'], ['10', 0, 0, 'W1']]))], [['19', 'L4']], 'the Dodgers lost four in a row; the Yankees played none');
  assert.equal(postseasonStreaks(regular, table(2025, [['19', 3, 5, 'L4']])).size, 0, "last season's postseason is not this season's");
  assert.equal(postseasonStreaks(regular, null).size, 0, 'no answer, no change');
});

test('GET /teams?by=division: by league (the app\'s order), then division, then name; F1\'s constructors together', async () => {
  divisionsDeps.getJson = async (url: string) => (url === `${urls.standings('mlb')}?level=3` ? MLB : url === `${urls.standings('nfl')}?level=3` ? NFL : url === urls.standings('f1') ? { children: [{ name: "Constructors' Championship", standings: { entries: [{ team: { id: '106' }, stats: [{ name: 'rank', value: 3 }, { name: 'championshipPts', displayValue: '88' }] }] } }] } : {});
  const server = startApi(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const list = async (q: string) => (await (await fetch(`${base}/teams${q}`)).json()).teams.map((t: any) => `${t.abbrev}${t.division ? ` (${t.division})` : ''}`);
  assert.deepEqual(await list('?by=division'), ['NYY (AL East)', 'TB (AL East)', 'CLE (AL Central)', 'ATL (NFC South)', 'NO (NFC South)', 'FER (Constructors)']);
  const fer = (await (await fetch(`${base}/teams?league=f1&by=division`)).json()).teams[0];
  assert.deepEqual([fer.record, fer.standing], ['88 pts', '3rd in constructors'], "F1's constructors carry the championship");
  assert.deepEqual(await list('?league=mlb&by=division'), ['NYY (AL East)', 'TB (AL East)', 'CLE (AL Central)']);
  assert.deepEqual(await list('?league=mlb'), ['CLE', 'NYY', 'TB'], 'A-Z, as before');
  server.close();
});

test("college football: record, streak and a conference standing from the conference record, ties shared", () => {
  const e = (id: string, overall: string, conf: string, streak = 'W1') => ({ team: { id }, stats: [{ name: 'overall', displayValue: overall }, { name: 'vs. Conf.', displayValue: conf }, { name: 'streak', displayValue: streak }] });
  const got = parseDivisions('cfb', { children: [{ name: 'Big Ten Conference', standings: { entries: [e('1', '6-0', '3-0'), e('2', '5-1', '3-0'), e('3', '4-2', '2-1'), e('4', '3-3', '0-3'), e('5', '6-0', '0-0')] } }] });
  assert.equal(got.get('1')?.record, '6-0');
  assert.equal(got.get('1')?.standing, '3-0 in conference, T-1st');
  assert.equal(got.get('3')?.standing, '2-1 in conference, 3rd');
  assert.equal(got.get('4')?.standing, '0-3 in conference, 4th');
  assert.equal(got.get('5')?.standing, undefined, 'no conference game yet (or an independent): no standing');
  assert.equal(parseDivisions('mlb', MLB).get('10')?.standing, undefined, 'only college football');
});

test("a preseason table (the NBA in October) has no overall: the record is its wins and losses, and its streak counts", () => {
  const e = { team: { id: '2' }, stats: [{ name: 'wins', displayValue: '1' }, { name: 'losses', displayValue: '4' }, { name: 'streak', displayValue: 'W1' }] };
  const at = (lg: any) => parseDivisions(lg, { children: [{ name: 'Atlantic', abbreviation: 'AT', standings: { seasonType: 1, entries: [e] } }] }).get('2');
  assert.deepEqual([at('nba')?.record, at('nba')?.streak], ['1-4', 'W1']);
  assert.equal(at('epl')?.record, undefined, "only basketball's record is wins-losses: soccer has draws");
});

test("F1's constructors: the place in the championship and the points", () => {
  const res = { children: [{ name: "Constructors' Championship", standings: { season: 2026, entries: [
    { team: { id: '106' }, stats: [{ name: 'rank', value: 2 }, { name: 'championshipPts', displayValue: '151' }] },
    { team: { id: '107' }, stats: [{ name: 'rank', value: 1 }, { name: 'championshipPts', displayValue: '170' }] },
  ] } }] };
  const got = constructorStandings(res);
  assert.deepEqual([got.get('106')?.standing, got.get('106')?.record], ['2nd in constructors', '151 pts']);
  assert.equal(got.get('107')?.standing, '1st in constructors');
  assert.equal(constructorStandings({}).size, 0, 'no table, no placement');
});

test("F1's drivers: their own place in the drivers' championship, not their constructor's", () => {
  const res = { children: [{ name: "Drivers' Championship", standings: { season: 2026, entries: [
    { athlete: { id: '5498' }, stats: [{ name: 'rank', value: 3 }, { name: 'championshipPts', displayValue: '88' }] },
    { athlete: { id: '4665' }, stats: [{ name: 'rank', value: 1 }, { name: 'championshipPts', displayValue: '120' }] },
  ] } }] };
  const got = driverStandings(res);
  assert.deepEqual(got.get('5498'), { record: '88 pts', standing: '3rd in drivers' });
  assert.equal(got.get('4665')?.standing, '1st in drivers');
  assert.equal(driverStandings({}).size, 0, 'no table, no placement');
});
