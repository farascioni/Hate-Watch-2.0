// `GET /health/deep`: the check an outside monitor hits to learn the server is working, not only answering.
//
// `GET /health` (api.ts) stays what Fly's own check reads: it answers whenever the process is up. This one answers 503 when
// something that matters has stopped, so a monitor (docs/redundancy.md) can message the owner. It is NOT wired to Fly's check:
// a failing Fly check takes the only machine out of routing, which would turn a stuck poller into a full outage.
//
// What it checks:
//  - the database takes a write (a full or read-only volume fails here);
//  - ESPN answered some request in the last ESPN_SILENCE_MS (every league's scoreboard is read every 10s, so silence means
//    ESPN is down or the poller is dead: the owner wants to hear either);
//  - no game tracker's poll loop has stopped turning (a stuck game misses alerts while everything else looks fine);
//  - with replication on (LITESTREAM_REPLICA_URL), Litestream is running and has not logged a sync error since the last
//    check: a backup that quietly stopped is the failure nobody notices until the day it is needed.
// The first BOOT_GRACE_MS after a boot only check the database: the first scans and Litestream's first sync take a moment.

import { db } from './db.ts';
import { lastEspnReplyAt } from './calls.ts';

export const ESPN_SILENCE_MS = 120_000;
export const TRACKER_STALL_MS = 60_000;
export const BOOT_GRACE_MS = 120_000;
/** Litestream's metrics endpoint (litestream.yml `addr`). */
export const LITESTREAM_METRICS_URL = 'http://127.0.0.1:9090/metrics';

export interface Check { name: string; ok: boolean; detail: string }
export interface DeepHealth { ok: boolean; checks: Check[] }

export interface HealthDeps {
  now: number;
  bootAt: number;
  /** Throws when the database can't take a write. */
  dbWrite: () => void;
  lastEspnReplyAt: number;
  trackers: { league: string; gameId: string; finished: boolean; loopAt: number }[];
  /** The metrics text from Litestream, or null when replication isn't configured. Throws when it's configured and unreachable. */
  litestreamMetrics: (() => Promise<string>) | null;
}

/** The sum of a metric's values over its labels in Prometheus text (0 when absent). */
export function metricSum(text: string, name: string): number {
  let total = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith(name) || !/^[{ ]/.test(line.slice(name.length))) continue;
    const v = Number(line.slice(line.lastIndexOf(' ') + 1));
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

let lastSyncErrors: number | null = null;

/** Forgets the last Litestream error count (tests). */
export function resetHealth() { lastSyncErrors = null; }

export async function deepHealth(d: HealthDeps): Promise<DeepHealth> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  try { d.dbWrite(); add('database', true, 'takes writes'); } catch (e) { add('database', false, `write failed: ${(e as Error).message}`); }

  const up = d.now - d.bootAt;
  if (up < BOOT_GRACE_MS) {
    add('boot', true, `up ${Math.round(up / 1000)}s: only the database is checked until ${BOOT_GRACE_MS / 1000}s`);
  } else {
    const silent = d.now - d.lastEspnReplyAt;
    add('espn', d.lastEspnReplyAt > 0 && silent <= ESPN_SILENCE_MS,
      d.lastEspnReplyAt > 0 ? `last reply ${Math.round(silent / 1000)}s ago` : 'no reply since boot');

    const stalled = d.trackers.filter((t) => !t.finished && d.now - t.loopAt > TRACKER_STALL_MS);
    add('trackers', !stalled.length, stalled.length ? `stalled: ${stalled.map((t) => `${t.league} ${t.gameId}`).join(', ')}` : 'every game loop is turning');

    if (d.litestreamMetrics) {
      try {
        const text = await d.litestreamMetrics();
        const errors = metricSum(text, 'litestream_sync_error_count');
        const full = metricSum(text, 'litestream_disk_full') > 0;
        const grew = lastSyncErrors !== null && errors > lastSyncErrors;
        lastSyncErrors = errors;
        add('replication', !grew && !full, full ? 'Litestream reports the disk full' : grew ? `sync errors rose to ${errors}` : `running, ${errors} sync errors since it started`);
      } catch (e) {
        add('replication', false, `Litestream unreachable: ${(e as Error).message}`);
      }
    } else {
      add('replication', true, 'not configured (LITESTREAM_REPLICA_URL unset)');
    }
  }
  return { ok: checks.every((c) => c.ok), checks };
}

const bootAt = Date.now();

/** The live inputs, for the route in api.ts. */
export function liveDeps(trackers: HealthDeps['trackers']): HealthDeps {
  return {
    now: Date.now(),
    bootAt,
    dbWrite: () => { db.prepare("INSERT INTO kv (key, value) VALUES ('health:ping', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(Date.now())); },
    lastEspnReplyAt: lastEspnReplyAt(),
    trackers,
    litestreamMetrics: process.env.LITESTREAM_REPLICA_URL
      ? async () => {
          const res = await fetch(LITESTREAM_METRICS_URL, { signal: AbortSignal.timeout(2000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        }
      : null,
  };
}
