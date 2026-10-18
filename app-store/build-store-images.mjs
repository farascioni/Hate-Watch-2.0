// Renders the App Store Connect images from the app's own screens in app-store/raw/ (taken by capture-screens.mjs):
// the "Header" (21:9) and "Search Results" (3:2) into header-search/, and the framed, captioned screenshots into
// screenshots/ (1320x2868), screenshots-6.5in/ (1284x2778) and screenshots-6.3in/ (1206x2622).
// One set per language in locales.mjs: English in app-store/, the others in app-store/localized/<lang>/ (same folders).
// Run: node app-store/build-store-images.mjs [lang ...]   (needs app/node_modules; macOS `sips` scales the screenshots)
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { LOCALES, langs, useLang, out, write, png, text, defs, MARK, rawB64, WHITE } from './store-art.mjs';

const GREY = '#9a9aa2';

const chips = (cx, y, h, size) => {
  const names = ['NBA', 'MLB', 'NFL', 'NHL', 'F1'], w = h * 2.3, gap = h * 0.45;
  const x0 = cx - (names.length * w + (names.length - 1) * gap) / 2;
  return names.map((n, i) => {
    const x = x0 + i * (w + gap);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#1c1c20" stroke="#34343a" stroke-width="4"/>` +
      text(x + w / 2, y + h * 0.68, size, 700, '#c9c9ce', n);
  }).join('');
};

// Header 21:9. Cropped differently on each device, so everything sits in the centre ~60%.
const header = (L, w = 3840, h = 1646) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${defs(w, h)}
  <g transform="translate(-140 0)">
  <g transform="translate(1200 ${h / 2 - 20}) scale(1.35)">${MARK}</g>
  ${text(1780, 690, 190, 800, WHITE, L.tagline[0], 'start', 1900)}
  ${text(1780, 900, 190, 800, WHITE, L.tagline[1], 'start', 1900)}
  ${text(1780, 1040, 76, 500, GREY, L.headerSub, 'start', 1800)}
  ${chips(2555, 1150, 100, 46)}
  </g>
</svg>`;

// Search results 3:2: headline, then the feed bleeding off the bottom.
const search = (L, w = 3840, h = 2560) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${defs(w, h)}
  <g transform="translate(${w / 2} 330) scale(0.62)">${MARK}</g>
  ${text(w / 2, 770, 250, 800, WHITE, L.tagline[0], 'middle', 3500)}
  ${text(w / 2, 1030, 250, 800, WHITE, L.tagline[1], 'middle', 3500)}
  ${text(w / 2, 1235, 92, 500, GREY, L.searchSub, 'middle', 3500)}
  <clipPath id="card"><rect x="${w / 2 - 650}" y="1390" width="1300" height="${h}" rx="110"/></clipPath>
  <rect x="${w / 2 - 665}" y="1375" width="1330" height="${h}" rx="122" fill="#2a2a30"/>
  <image href="data:image/jpeg;base64,${rawB64('feed')}" x="${w / 2 - 650}" y="1390" width="1300" height="2818" clip-path="url(#card)"/>
</svg>`;

// Screenshots 1320x2868: caption on the gradient, the app screen in a phone frame. Captions are in locales.mjs, in this order.
const SHOTS = [['1-feed', 'feed'], ['2-search', 'search'], ['3-scores', 'scores'], ['4-tracking', 'tracking'], ['5-player-alerts', 'player-alerts'], ['6-settings', 'settings']];
const shot = (raw, [h1, h2, s1, s2], w = 1320, h = 2868) => {
  const sw = 930, sh = Math.round(sw * 2796 / 1290), sx = (w - sw) / 2, sy = 700;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${defs(w, h)}
  ${text(w / 2, 300, 128, 800, WHITE, h1, 'middle', 1260)}
  ${text(w / 2, 435, 128, 800, WHITE, h2, 'middle', 1260)}
  ${text(w / 2, 575, 58, 500, GREY, s1, 'middle', 1200)}
  ${text(w / 2, 645, 58, 500, GREY, s2, 'middle', 1200)}
  <clipPath id="scr"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="84"/></clipPath>
  <rect x="${sx - 20}" y="${sy - 20}" width="${sw + 40}" height="${sh + 40}" rx="104" fill="#2a2a30"/>
  <image href="data:image/jpeg;base64,${rawB64(raw)}" x="${sx}" y="${sy}" width="${sw}" height="${sh}" clip-path="url(#scr)"/>
</svg>`;
};

// Screenshots: PNG from resvg, then JPEG (opaque, as Apple requires) at each size Apple accepts for iPhone.
const SIZES = [['screenshots', 1320, 2868], ['screenshots-6.5in', 1284, 2778], ['screenshots-6.3in', 1206, 2622]];

for (const lang of langs) {
  if (!LOCALES[lang]) throw new Error(`unknown language ${lang}; known: ${Object.keys(LOCALES).join(', ')}`);
  const L = useLang(lang);
  console.log(`== ${lang}`);
  mkdirSync(out('header-search'), { recursive: true });
  for (const [svg, name] of [[header(L), 'header-3840x1646.png'], [search(L), 'search-results-3840x2560.png']]) {
    const r = png(svg);
    write(out(`header-search/${name}`), r.asPng());
    console.log(name, r.width, r.height);
  }
  for (const [dir] of SIZES) { rmSync(out(dir), { recursive: true, force: true }); mkdirSync(out(dir), { recursive: true }); }
  SHOTS.forEach(([name, raw], i) => {
    const tmp = out(`header-search/.${name}.png`);
    write(tmp, png(shot(raw, L.shots[i])).asPng());
    for (const [dir, w, h] of SIZES)
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', '-z', String(h), String(w), tmp, '--out', out(`${dir}/${name}.jpg`)], { stdio: 'ignore' });
    rmSync(tmp);
    console.log(name);
  });
}
