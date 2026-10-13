// GET /health/deep (health.ts): the checks an outside monitor reads, with every input handed in.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:'; // before the imports: health.ts opens the database, and this must not be the development one
const { deepHealth, metricSum, resetHealth, ESPN_SILENCE_MS, TRACKER_STALL_MS, BOOT_GRACE_MS } = await import('../src/health.ts');
const { recordCall, lastEspnReplyAt, resetCalls } = await import('../src/calls.ts');

const NOW = 1_800_000_000_000;
const base = () => ({
  now: NOW,
  bootAt: NOW - 10 * 60_000,
  dbWrite: () => {},
  lastEspnReplyAt: NOW - 5_000,
  trackers: [{ league: 'mlb', gameId: '401908031', finished: false, loopAt: NOW - 2_000 }],
  litestreamMetrics: null,
});
const named = (h: Awaited<ReturnType<typeof deepHealth>>, name: string) => h.checks.find((c) => c.name === name)!;

beforeEach(() => { resetHealth(); resetCalls(); });

test('a healthy server passes every check', async () => {
  const h = await deepHealth(base());
  assert.equal(h.ok, true);
  assert.deepEqual(h.checks.map((c) => [c.name, c.ok]), [['database', true], ['espn', true], ['trackers', true], ['replication', true]]);
  assert.match(named(h, 'replication').detail, /not configured/);
});

test('a database that cannot take a write fails', async () => {
  const h = await deepHealth({ ...base(), dbWrite: () => { throw new Error('database or disk is full'); } });
  assert.equal(h.ok, false);
  assert.match(named(h, 'database').detail, /disk is full/);
});

test('ESPN silent for longer than the limit fails, and never answering fails', async () => {
  const quiet = await deepHealth({ ...base(), lastEspnReplyAt: NOW - ESPN_SILENCE_MS - 1 });
  assert.equal(named(quiet, 'espn').ok, false);
  const never = await deepHealth({ ...base(), lastEspnReplyAt: 0 });
  assert.equal(named(never, 'espn').ok, false);
  assert.match(named(never, 'espn').detail, /no reply since boot/);
});

test('a stalled game loop fails and names the game; a finished one does not', async () => {
  const stalled = { league: 'nfl', gameId: '401872994', finished: false, loopAt: NOW - TRACKER_STALL_MS - 1 };
  const bad = await deepHealth({ ...base(), trackers: [...base().trackers, stalled] });
  assert.equal(bad.ok, false);
  assert.match(named(bad, 'trackers').detail, /nfl 401872994/);
  const done = await deepHealth({ ...base(), trackers: [{ ...stalled, finished: true }] });
  assert.equal(done.ok, true);
});

test('the first two minutes after a boot check only the database', async () => {
  const h = await deepHealth({ ...base(), bootAt: NOW - BOOT_GRACE_MS + 1, lastEspnReplyAt: 0, trackers: [{ league: 'nfl', gameId: '1', finished: false, loopAt: 0 }] });
  assert.equal(h.ok, true);
  assert.deepEqual(h.checks.map((c) => c.name), ['database', 'boot']);
});

test('replication: unreachable fails, errors rising since the last check fail, steady errors pass', async () => {
  const metrics = (n: number, full = 0) => async () =>
    `# HELP litestream_sync_error_count x\nlitestream_sync_error_count{db="/data/hatewatch.db"} ${n}\nlitestream_disk_full{db="/data/hatewatch.db"} ${full}\n`;
  const down = await deepHealth({ ...base(), litestreamMetrics: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(named(down, 'replication').ok, false);
  assert.match(named(down, 'replication').detail, /unreachable/);

  resetHealth();
  assert.equal(named(await deepHealth({ ...base(), litestreamMetrics: metrics(3) }), 'replication').ok, true); // first look: a baseline
  assert.equal(named(await deepHealth({ ...base(), litestreamMetrics: metrics(3) }), 'replication').ok, true); // unchanged
  const grew = await deepHealth({ ...base(), litestreamMetrics: metrics(5) });
  assert.equal(named(grew, 'replication').ok, false);
  assert.equal(named(await deepHealth({ ...base(), litestreamMetrics: metrics(5) }), 'replication').ok, true); // steady again

  const full = await deepHealth({ ...base(), litestreamMetrics: metrics(5, 1) });
  assert.match(named(full, 'replication').detail, /disk full/);
});

test('metricSum adds a metric over its labels and ignores metrics that only share its prefix', () => {
  const text = [
    'litestream_sync_error_count{db="a"} 2',
    'litestream_sync_error_count{db="b"} 3',
    'litestream_sync_error_count_total 99',
    'litestream_sync_count{db="a"} 40',
    'litestream_txid 7',
  ].join('\n');
  assert.equal(metricSum(text, 'litestream_sync_error_count'), 5);
  assert.equal(metricSum(text, 'litestream_txid'), 7);
  assert.equal(metricSum(text, 'litestream_missing'), 0);
});

test('calls.ts remembers when ESPN last answered, and a 404 counts, an error does not', () => {
  assert.equal(lastEspnReplyAt(), 0);
  recordCall('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', 'error', 5, false);
  assert.equal(lastEspnReplyAt(), 0);
  recordCall('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', 'notFound', 5, false);
  assert.ok(lastEspnReplyAt() > 0);
});
