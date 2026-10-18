// Renders the Google Play Console images from the app's own screens in app-store/raw/ (taken by capture-screens.mjs):
// the 512x512 icon, the 1024x500 feature graphic and six 1080x1920 phone screenshots, into play/.
// Same look and captions as build-store-images.mjs (the App Store set), both from locales.mjs; Play's own sizes: its
// screenshots can't be taller than 2:1 (the iPhone ones are 2.17:1), so the phone bleeds off the bottom of a 9:16 canvas.
// One set per language: English in app-store/play/, the others in app-store/localized/<lang>/play/ (the icon only in English).
// Run: node app-store/build-play-images.mjs [lang ...]   (needs app/node_modules; macOS `sips` scales and converts)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { LOCALES, langs, useLang, out, here, png, text, defs, MARK, rawB64, WHITE } from './store-art.mjs';

const GREY = '#9a9aa2';

const chips = (x0, y, h, size) => {
  const names = ['NBA', 'MLB', 'NFL', 'NHL', 'F1'], w = h * 2.3, gap = h * 0.4;
  return names.map((n, i) => {
    const x = x0 + i * (w + gap);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#1c1c20" stroke="#34343a" stroke-width="2"/>` +
      text(x + w / 2, y + h * 0.68, size, 700, '#c9c9ce', n);
  }).join('');
};

// Feature graphic 1024x500. Play crops it on some surfaces, so everything sits in the centre.
const feature = (L) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  ${defs(1024, 500)}
  <g transform="translate(215 250) scale(0.5)">${MARK}</g>
  ${text(420, 215, 58, 800, WHITE, L.tagline[0], 'start', 540)}
  ${text(420, 285, 58, 800, WHITE, L.tagline[1], 'start', 540)}
  ${text(420, 332, 24, 500, GREY, L.headerSub, 'start', 570)}
  ${chips(420, 365, 40, 19)}
</svg>`;

const SHOTS = [['1-feed', 'feed'], ['2-search', 'search'], ['3-scores', 'scores'], ['4-tracking', 'tracking'], ['5-player-alerts', 'player-alerts'], ['6-settings', 'settings']];
const W = 1080, H = 1920;
const shot = (raw, [h1, h2, s1, s2]) => {
  const sw = 760, sh = Math.round(sw * 2796 / 1290), sx = (W - sw) / 2, sy = 520;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(W, H)}
  ${text(W / 2, 200, 98, 800, WHITE, h1, 'middle', 960)}
  ${text(W / 2, 308, 98, 800, WHITE, h2, 'middle', 960)}
  ${text(W / 2, 400, 44, 500, GREY, s1, 'middle', 900)}
  ${text(W / 2, 458, 44, 500, GREY, s2, 'middle', 900)}
  <clipPath id="scr"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="70"/></clipPath>
  <rect x="${sx - 16}" y="${sy - 16}" width="${sw + 32}" height="${sh + 32}" rx="86" fill="#2a2a30"/>
  <image href="data:image/jpeg;base64,${rawB64(raw)}" x="${sx}" y="${sy}" width="${sw}" height="${sh}" clip-path="url(#scr)"/>
</svg>`;
};

// Play wants opaque 24-bit images for the graphic and screenshots (PNG or JPEG), so JPEG; the icon stays a 32-bit PNG.
const toJpeg = (svg, file) => {
  const tmp = file + '.png';
  writeFileSync(tmp, png(svg).asPng());
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', tmp, '--out', file], { stdio: 'ignore' });
  rmSync(tmp);
};

for (const lang of langs) {
  if (!LOCALES[lang]) throw new Error(`unknown language ${lang}; known: ${Object.keys(LOCALES).join(', ')}`);
  const L = useLang(lang);
  console.log(`== ${lang}`);
  rmSync(out('play'), { recursive: true, force: true });
  mkdirSync(out('play/screenshots'), { recursive: true });
  if (lang === 'en') execFileSync('sips', ['-z', '512', '512', here('../app/assets/icon.png'), '--out', out('play/icon-512.png')], { stdio: 'ignore' });
  toJpeg(feature(L), out('play/feature-graphic-1024x500.jpg'));
  SHOTS.forEach(([name, raw], i) => {
    toJpeg(shot(raw, L.shots[i]), out(`play/screenshots/${name}.jpg`));
    console.log(name);
  });
}
