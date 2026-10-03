import { catalog, ingest, loadCatalog } from './catalog.ts';
import { setPushSender } from './fanout.ts';
import { sendPushes } from './push.ts';
import { startApi } from './api.ts';
import { engine } from './live.ts';
import { db } from './db.ts';

loadCatalog();
if (!catalog.size().players) {
  console.log('[boot] empty catalog, ingesting rosters from ESPN…');
  await ingest();
}
console.log('[boot] catalog', catalog.size());

// Rosters change daily (trades, call-ups, cuts). Refresh every 6h; a failed refresh keeps the old catalog.
setInterval(() => ingest().catch((e) => console.error('[ingest] refresh failed, keeping previous catalog', e)), 6 * 3600_000);

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
