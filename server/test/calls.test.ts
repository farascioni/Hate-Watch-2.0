// The ESPN call counter (calls.ts): every URL the server reads is filed under its league and kind of read, and getJson and
// probePng count each HTTP attempt they send, a retry included.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_CALLS_FINGERPRINT = '1'; // before the imports: calls.ts reads it once
const { classify, callStats, callLog, resetCalls } = await import('../src/calls.ts');
const { getJson, probePng } = await import('../src/espn.ts');

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'http://sports.core.api.espn.com/v2/sports';

test('every URL the server reads is filed by league and kind', () => {
  const cases: [string, string, string][] = [
    [`${SITE}/baseball/mlb/scoreboard`, 'mlb', 'scoreboard'],
    [`${SITE}/football/college-football/scoreboard?groups=80&limit=300`, 'cfb', 'scoreboard'],
    [`${SITE}/baseball/mlb/summary?event=401908031&_hw=1760000000000`, 'mlb', 'summary'],
    [`${CORE}/baseball/leagues/mlb/events/401908031/competitions/401908031/plays?limit=1000`, 'mlb', 'plays'],
    [`${CORE}/soccer/leagues/eng.1/events/401879264/competitions/401879264/plays?limit=100&page=3`, 'epl', 'touches'],
    [`https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings?level=3`, 'nhl', 'standings'],
    [`${SITE}/hockey/nhl/injuries`, 'nhl', 'injuries'],
    [`${SITE}/basketball/wnba/news?limit=50`, 'wnba', 'news'],
    [`${SITE}/basketball/nba/teams?limit=100`, 'nba', 'teams'],
    [`${SITE}/basketball/nba/teams/13/roster`, 'nba', 'roster'],
    [`${SITE}/football/nfl/teams/12/schedule?seasontype=2`, 'nfl', 'schedule'],
    [`${SITE}/football/nfl/teams/12/statistics`, 'nfl', 'team stats'],
    [`${SITE}/football/nfl/teams/12`, 'nfl', 'team'],
    [`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/32801/overview`, 'mlb', 'athlete overview'],
    [`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/32801/stats`, 'mlb', 'athlete stats'],
    [`${CORE}/racing/leagues/f1/events/600057445/competitions/600057449/competitors/5498/statistics`, 'f1', 'timing'],
    [`${CORE}/racing/leagues/f1/events/600057445/competitions/600057449/competitors?limit=50`, 'f1', 'entry list'],
    [`${CORE}/racing/leagues/f1/events/600057445/competitions/600057449/status`, 'f1', 'session'],
    [`${CORE}/mma/leagues/ufc/events/401863575/competitions/401863576`, 'ufc', 'fight'],
    [`${CORE}/mma/athletes/4350812`, 'ufc', 'athlete'],
    [`https://a.espncdn.com/i/headshots/mlb/players/full/32801.png`, 'mlb', 'headshot check'],
    [`https://a.espncdn.com/i/headshots/soccer/players/full/1.png`, 'epl', 'headshot check'],
    [`https://a.espncdn.com/i/teamlogos/nhl/500/cgy.png`, 'nhl', 'logo check'],
    ['not a url', '?', 'other'],
  ];
  for (const [url, league, kind] of cases) assert.deepEqual(classify(url), { league, kind }, url);
});

const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(status === 404 ? 'no' : JSON.stringify(body), { status, headers: { 'content-length': '1234', ...headers } });

beforeEach(() => resetCalls());
afterEach(() => mock.restoreAll());

test('getJson counts a read, its bytes, and the cache-busted copy as the same kind', async () => {
  mock.method(globalThis, 'fetch', async () => reply(200));
  await getJson(`${SITE}/baseball/mlb/summary?event=1`, { bust: true });
  await getJson(`${SITE}/baseball/mlb/summary?event=2`);
  const s = callStats();
  assert.equal(s.total, 2);
  assert.deepEqual(s.rows.map((r) => [r.league, r.kind, r.calls, r.retries, r.errors, r.notFound]), [['mlb', 'summary', 2, 0, 0, 0]]);
  assert.equal(s.rows[0].mb, 0); // 2 x 1,234 bytes rounds to 0.0 MB
});

test('getJson counts a retry as a second call, and the failed attempt as an error', async () => {
  let n = 0;
  mock.method(globalThis, 'fetch', async () => (++n === 1 ? reply(500) : reply(200)));
  await getJson(`${SITE}/hockey/nhl/injuries`);
  const [row] = callStats().rows;
  assert.deepEqual([row.league, row.kind, row.calls, row.retries, row.errors], ['nhl', 'injuries', 2, 1, 1]);
});

test('a 404 is one call, counted as not found, not as an error, and is not retried', async () => {
  mock.method(globalThis, 'fetch', async () => reply(404));
  await assert.rejects(getJson(`${CORE}/racing/leagues/f1/events/1/competitions/2/competitors?limit=50`));
  const [row] = callStats().rows;
  assert.deepEqual([row.league, row.kind, row.calls, row.retries, row.errors, row.notFound], ['f1', 'entry list', 1, 0, 0, 1]);
});

test('a read that never gets an answer is counted as an error, once per attempt', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  await assert.rejects(getJson(`${SITE}/football/nfl/scoreboard`));
  const [row] = callStats().rows;
  assert.deepEqual([row.calls, row.retries, row.errors], [3, 2, 3]);
});

test('probePng counts an image that does not exist as not found', async () => {
  mock.method(globalThis, 'fetch', async () => reply(404));
  assert.equal(await probePng('https://a.espncdn.com/i/headshots/nba/players/full/9.png'), null);
  const [row] = callStats().rows;
  assert.deepEqual([row.league, row.kind, row.calls, row.notFound, row.errors], ['nba', 'headshot check', 1, 1, 0]);
});

test('the hourly log shows the calls since the last one, busiest first, then starts over', async () => {
  mock.method(globalThis, 'fetch', async () => reply(200));
  for (let i = 0; i < 3; i++) await getJson(`${SITE}/baseball/mlb/summary?event=1`);
  await getJson(`${SITE}/hockey/nhl/injuries`);
  const first = callLog();
  assert.match(first[0], /^\[calls\] 4 calls \(0 retries, 0 errors, 0 not found\)/);
  assert.match(first[1], /mlb summary\s+3 calls/);
  assert.match(first[2], /nhl injuries\s+1 calls/);
  assert.deepEqual(callLog(), ['[calls] none in the last window']);
  await getJson(`${SITE}/hockey/nhl/injuries`);
  assert.match(callLog()[0], /^\[calls\] 1 calls/);
  assert.equal(callStats().total, 5); // since boot keeps counting
});

test('with the fingerprint on, a bucket counts the reads that returned what the one before did, the cache-buster ignored', async () => {
  const bodies = [{ n: 1 }, { n: 1 }, { n: 1 }, { n: 2 }];
  mock.method(globalThis, 'fetch', async () => reply(200, bodies.shift()));
  const u = `${CORE}/baseball/leagues/mlb/events/9/competitions/9/plays?limit=1000`;
  await getJson(u, { bust: true });  // first: nothing to compare with
  await getJson(u, { bust: true });  // same
  await getJson(u);                  // same (no buster now, same URL)
  await getJson(u, { bust: true });  // changed
  const [row] = callStats().rows;
  assert.deepEqual([row.kind, row.calls, row.compared, row.same], ['plays', 4, 3, 2]);
  assert.match(callLog()[1], /plays\s+4 calls.*67% unchanged/);
});

test('a top-level timestamp that moves on every read is not a change', async () => {
  const bodies = [{ timestamp: '2026-10-12T22:00:00Z', injuries: [1] }, { timestamp: '2026-10-12T22:00:30Z', injuries: [1] }, { timestamp: '2026-10-12T22:01:00Z', injuries: [1, 2] }];
  mock.method(globalThis, 'fetch', async () => reply(200, bodies.shift()));
  for (let i = 0; i < 3; i++) await getJson(`${SITE}/hockey/nhl/injuries`);
  const [row] = callStats().rows;
  assert.deepEqual([row.kind, row.compared, row.same], ['injuries', 2, 1]);
});
