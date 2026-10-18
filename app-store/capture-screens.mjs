// Takes the app's real screens for the App Store images: the web app (expo start --web, port 8081) at iPhone size, 3x,
// into app-store/raw/*.jpg. build-store-images.mjs then frames and captions them.
// Run: HW_TOKEN=<a dev device's token> HW_PLAYER=player:nba:4065648 node app-store/capture-screens.mjs
//   HW_TOKEN: the 'hatewatch.token' in localStorage of a dev-server web session that tracks teams and players across leagues
//   (the screens show that device's follows and feed); HW_PLAYER: one of its tracked athletes (for the per-player alerts screen).
//   HW_LANG (en, es, fr, pt, de, ja; default en): the app's language; the screens go to raw/<lang>/ (English: raw/ itself).
//   PLAYWRIGHT_CORE and CHROME point at a playwright-core install and a Chromium binary (defaults: the npx cache and Playwright's own).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { HW_TOKEN, HW_PLAYER, HW_LANG = 'en' } = process.env;
// The language's own words for what the script clicks (strings/<lang>.ts, same file the app reads).
const word = (key) => readFileSync(here(`../app/src/lib/strings/${HW_LANG}.ts`), 'utf8').match(new RegExp(`'${key.replace('.', '\\.')}': '((?:[^'\\\\]|\\\\.)*)'`))[1].replace(/\\'/g, "'");
const dir = HW_LANG === 'en' ? 'raw' : `raw/${HW_LANG}`;
if (!HW_TOKEN || !HW_PLAYER) throw new Error('set HW_TOKEN and HW_PLAYER (see the header)');
const { chromium } = createRequire(process.env.PLAYWRIGHT_CORE ?? execFileSync('sh', ['-c', 'ls -d ~/.npm/_npx/*/node_modules | head -1']).toString().trim() + '/')('playwright-core');
const chrome = process.env.CHROME ?? `${homedir()}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const b = await chromium.launch({ executablePath: chrome });
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, colorScheme: 'dark' });
await ctx.addInitScript(([t, l]) => { localStorage.setItem('hatewatch.token', t); localStorage.setItem('hatewatch.guideSeen', '1'); if (l !== 'en') localStorage.setItem('hw.language', l); }, [HW_TOKEN, HW_LANG]);
const p = await ctx.newPage();
mkdirSync(here(dir), { recursive: true });
const shot = async (name) => {
  // The web tab bar clips the descenders of "Tracking" and "Settings"; a native one doesn't.
  await p.addStyleTag({ content: '[role=tab] *{overflow:visible!important}' });
  await p.waitForTimeout(4500);
  const png = here(`${dir}/.${name}.png`);
  await p.screenshot({ path: png });
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', png, '--out', here(`${dir}/${name}.jpg`)], { stdio: 'ignore' });
  rmSync(png);
  console.log(name);
};
const go = (path) => p.goto('http://localhost:8081' + path);
await go('/'); await shot('feed');
await go('/search'); await p.locator('input').first().fill('Boston'); await shot('search');
await go('/scores'); await shot('scores');
await go('/following'); await shot('tracking');
await go('/alerts/' + encodeURIComponent(HW_PLAYER)); await shot('player-alerts');
await go('/settings'); await p.waitForTimeout(3000);
const nba = new RegExp(word('settings.leagueAlerts').replace('{name}', 'NBA'), 'i');
await p.getByText(nba).first().click(); await p.waitForTimeout(800);
await p.evaluate((src) => { const re = new RegExp(src, 'i'); [...document.querySelectorAll('*')].find((e) => re.test(e.textContent) && e.children.length === 0)?.scrollIntoView({ block: 'start' }); }, nba.source);
await shot('settings');
await b.close();
