// Renders the iPad App Store screenshots (13-inch, 2064x2752) into screenshots-ipad-13in/ from the simulator screens in
// app-store/raw-ipad/ (iPad Pro 13" simulator, `xcrun simctl io <udid> screenshot raw-ipad/<name>.png`; see docs/deploy.md).
// Captions reuse the phone set's lines in locales.mjs (index = the phone shot the iPad screen stands in for), so every language
// works with no new text. One set per language: English in app-store/, the others in app-store/localized/<lang>/.
// Run: node app-store/build-ipad-images.mjs [lang ...]   (needs app/node_modules; macOS `sips` makes the opaque JPEGs)
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { LOCALES, langs, useLang, out, write, png, text, defs, WHITE, here } from './store-art.mjs';

const GREY = '#9a9aa2';
const W = 2064, H = 2752;
// [file, raw screen in raw-ipad/, caption index in locales.mjs `shots`]
const SHOTS = [['1-scores', 'scores', 0], ['2-search', 'search', 1], ['3-game', 'panes', 2], ['4-tracking', 'tracking', 3], ['5-player-alerts', 'player-alerts', 4], ['6-settings', 'settings', 5]];

// The simulator draws a grey resize grip in the screen's bottom-right corner (below row 2670), so the frame stops above it.
const KEEP = 2670 / 2752;
const shot = (raw, [h1, h2, s1, s2]) => {
  const sw = 1400, sh = Math.round(sw * 2752 / 2064), sx = (W - sw) / 2, sy = 700;
  const b64 = readFileSync(here(`raw-ipad/${raw}.png`)).toString('base64');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(W, H)}
  ${text(W / 2, 230, 150, 800, WHITE, h1, 'middle', 1900)}
  ${text(W / 2, 400, 150, 800, WHITE, h2, 'middle', 1900)}
  ${text(W / 2, 520, 66, 500, GREY, s1, 'middle', 1800)}
  ${text(W / 2, 600, 66, 500, GREY, s2, 'middle', 1800)}
  <clipPath id="scr"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh * KEEP}" rx="60"/></clipPath>
  <rect x="${sx - 20}" y="${sy - 20}" width="${sw + 40}" height="${sh * KEEP + 40}" rx="80" fill="#2a2a30"/>
  <image href="data:image/png;base64,${b64}" x="${sx}" y="${sy}" width="${sw}" height="${sh}" clip-path="url(#scr)"/>
</svg>`;
};

for (const lang of langs) {
  if (!LOCALES[lang]) throw new Error(`unknown language ${lang}; known: ${Object.keys(LOCALES).join(', ')}`);
  const L = useLang(lang);
  console.log(`== ${lang}`);
  rmSync(out('screenshots-ipad-13in'), { recursive: true, force: true });
  mkdirSync(out('screenshots-ipad-13in'), { recursive: true });
  for (const [name, raw, i] of SHOTS) {
    const tmp = out(`screenshots-ipad-13in/.${name}.png`);
    write(tmp, png(shot(raw, L.shots[i])).asPng());
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', tmp, '--out', out(`screenshots-ipad-13in/${name}.jpg`)], { stdio: 'ignore' });
    rmSync(tmp);
    console.log(name);
  }
}
