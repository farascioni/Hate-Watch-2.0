// The newest build from the shell (app-build.ts): `node /app/src/build-cli.ts` shows it, `node /app/src/build-cli.ts
// <build number> [appstore]` sets it (`appstore`: "Update" opens the App Store page, else TestFlight). Apps behind it offer
// the update the next time they open. It opens
// the server's database: HW_DB if set, else the volume's (/data) when there is one, and says which.
import { existsSync } from 'node:fs';

process.env.HW_DB ??= existsSync('/data/hatewatch.db') ? '/data/hatewatch.db' : 'data/hatewatch.db';
const { getLatestBuild, setLatestBuild } = await import('./app-build.ts');

console.log(`database ${process.env.HW_DB}`);
const arg = process.argv[2];
if (arg !== undefined) {
  try { setLatestBuild(Number(arg), process.argv[3] === 'appstore'); } catch (e) { console.error(`usage: node /app/src/build-cli.ts [build number [appstore]]\n${(e as Error).message}`); process.exit(1); }
}
const { ios, url } = getLatestBuild();
console.log(ios == null ? 'latest build: not set' : `latest build: ${ios}, Update opens ${url}`);
