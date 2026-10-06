import { catalog, ingest, loadCatalog, nextIngestIn, INGEST_EVERY_MS, type IngestReport } from './catalog.ts';
import { setPushSender } from './fanout.ts';
import { sendPushes } from './push.ts';
import { startApi } from './api.ts';
import { engine } from './live.ts';
import { db, kvGet } from './db.ts';
import { LEAGUE_IDS } from './leagues.ts';

loadCatalog();
// Ingest on boot if the catalog is empty or a newly added league (e.g. F1) isn't in it yet.
const missing = LEAGUE_IDS.filter((lg) => !catalog.allTeams().some((t) => t.league === lg));
if (missing.length) {
  console.log(`[boot] catalog missing ${missing.join(', ')}; ingesting rosters from ESPN…`);
  await ingest();
}
console.log('[boot] catalog', catalog.size());

// Rosters change daily (trades, call-ups, cuts). Refresh every 6h, counted from the last refresh rather than
// from boot, and in the background right away if the ingest changed (nextIngestIn). A failed refresh keeps the old catalog.
const refresh = () => ingest().catch((e) => console.error('[ingest] refresh failed, keeping previous catalog', e));
const due = nextIngestIn(kvGet<IngestReport>('ingest:report'));
console.log(`[boot] next roster refresh in ${Math.round(due / 60_000)} min`);
setTimeout(() => { void refresh(); setInterval(refresh, INGEST_EVERY_MS); }, due);

setPushSender(sendPushes);
const server = startApi(Number(process.env.PORT ?? 8787));
engine.start();

// Hosts (Fly, Docker) send SIGTERM on deploy/restart: stop accepting work and close SQLite cleanly.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    console.log(`[shutdown] ${sig}`);
    server.close();
    db.close();
    process.exit(0);
  });
}
