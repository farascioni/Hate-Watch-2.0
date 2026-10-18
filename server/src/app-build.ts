// The newest iOS build, which the app compares with its own build number when it opens and offers "Update" (opens
// `url`) when it is behind. An app can't ask Apple, and an install can't tell TestFlight from the App Store, so the
// number and where "Update" goes are recorded by hand once the build is ready to install:
//   fly ssh console -a hate-watch-api -C "node /app/src/build-cli.ts <build number> [appstore]"
// `url` is TestFlight unless `appstore` is given (the app's App Store page, once it is public). Nothing is offered until a
// number is set. Served by GET /app/latest-build.
import { kvGet, kvSet } from './db.ts';

const KEY = 'latestBuild';
export const TESTFLIGHT_URL = 'itms-beta://';
export const APPSTORE_URL = 'itms-apps://apps.apple.com/app/id6819054268';

export const getLatestBuild = (): { ios: number | null; url: string } => {
  const v = kvGet<{ ios: number; url?: string }>(KEY);
  return { ios: v?.ios ?? null, url: v?.url ?? TESTFLIGHT_URL };
};

export function setLatestBuild(ios: number, store = false) {
  if (!Number.isInteger(ios) || ios < 1) throw new Error('a build number is a whole number from 1');
  kvSet(KEY, { ios, url: store ? APPSTORE_URL : TESTFLIGHT_URL });
}
