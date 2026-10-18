// The newest TestFlight build (app-build.ts): unset until recorded, then whole numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HW_DB = ':memory:';
const { getLatestBuild, setLatestBuild, TESTFLIGHT_URL, APPSTORE_URL } = await import('../src/app-build.ts');

test('no build is offered until one is recorded, then the latest is served', () => {
  assert.deepEqual(getLatestBuild(), { ios: null, url: TESTFLIGHT_URL });
  setLatestBuild(16);
  assert.deepEqual(getLatestBuild(), { ios: 16, url: TESTFLIGHT_URL });
  setLatestBuild(17, true);
  assert.deepEqual(getLatestBuild(), { ios: 17, url: APPSTORE_URL });
});

test('a build number is a whole number from 1', () => {
  for (const bad of [0, -3, 1.5, NaN]) assert.throws(() => setLatestBuild(bad));
  assert.equal(getLatestBuild().ios, 17);
});
