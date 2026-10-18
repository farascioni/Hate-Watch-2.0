// Renders the Google Play Console images from the app's own screens in app-store/raw/ (taken by capture-screens.mjs):
// the 512x512 icon, the 1024x500 feature graphic and six 1080x1920 phone screenshots, into play/.
// Same look and captions as build-store-images.mjs (the App Store set); Play's own sizes: its screenshots can't be
// taller than 2:1 (the iPhone ones are 2.17:1), so the phone bleeds off the bottom of a 9:16 canvas.
// Run: node app-store/build-play-images.mjs   (needs app/node_modules; macOS `sips` scales and converts)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { Resvg } = createRequire(here('../app/package.json'))('@resvg/resvg-js');

const FONT = (w) => here(`../app/node_modules/expo-dev-menu/android/src/debug/res/font/inter_${w}.ttf`);
const BG = '#0B0B0D', RED = '#E5232B', WHITE = '#F4F4F5';

// Same mark as build-store-images.mjs and app/scripts/build-icons.mjs, centred on (0,0), ~690 wide.
const EYE = 'M -340 40 Q 0 -230 340 40 Q 0 310 -340 40 Z';
const MARK = `
  <clipPath id="eye"><path d="${EYE}"/></clipPath>
  <path d="M -306.4 -256.7 L 272.8 -187.4 L 257.2 -92.6 L -313.6 -213.3 Z" fill="${RED}"/>
  <circle cx="-310" cy="-235" r="22" fill="${RED}"/><circle cx="265" cy="-140" r="48" fill="${RED}"/>
  <path d="${EYE}" fill="${WHITE}"/>
  <g clip-path="url(#eye)">
    <circle cx="0" cy="40" r="125" fill="${RED}"/>
    <circle cx="0" cy="40" r="125" fill="none" stroke="#7A0D12" stroke-width="14"/>
    <circle cx="0" cy="40" r="58" fill="${BG}"/><circle cx="36" cy="6" r="22" fill="#fff" opacity="0.92"/>
  </g>`;

const defs = (w, h) => `
  <radialGradient id="bg" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#3B0D12"/><stop offset="0.55" stop-color="#170A0C"/><stop offset="1" stop-color="${BG}"/></radialGradient>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>`;

const text = (x, y, size, weight, fill, s, anchor = 'middle') =>
  `<text x="${x}" y="${y}" font-family="Inter" font-weight="${weight}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${s}</text>`;

const chips = (x0, y, h, size) => {
  const names = ['NBA', 'MLB', 'NFL', 'NHL', 'F1'], w = h * 2.3, gap = h * 0.4;
  return names.map((n, i) => {
    const x = x0 + i * (w + gap);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#1c1c20" stroke="#34343a" stroke-width="2"/>` +
      text(x + w / 2, y + h * 0.68, size, 700, '#c9c9ce', n);
  }).join('');
};

// Feature graphic 1024x500. Play crops it on some surfaces, so everything sits in the centre.
const feature = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  ${defs(1024, 500)}
  <g transform="translate(215 250) scale(0.5)">${MARK}</g>
  ${text(420, 215, 58, 800, WHITE, 'Know the second', 'start')}
  ${text(420, 285, 58, 800, WHITE, 'your rivals <tspan fill="' + RED + '">fail</tspan>', 'start')}
  ${text(420, 332, 24, 500, '#9a9aa2', 'Real-time alerts for the rivals you can’t stand', 'start')}
  ${chips(420, 365, 40, 19)}
</svg>`;

const rawB64 = (name) => readFileSync(here(`raw/${name}.jpg`)).toString('base64');
// Same captions as build-store-images.mjs (SHOTS).
const SHOTS = [
  ['1-feed', 'feed', ['Know the second', 'your rivals <tspan fill="' + RED + '">fail</tspan>'], ['Real-time alerts when the players', 'and teams you can’t stand mess up']],
  ['2-search', 'search', ['Track anyone', 'you love to <tspan fill="' + RED + '">hate</tspan>'], ['Teams and athletes across the pros,', 'college football, F1 and UFC']],
  ['3-scores', 'scores', ['Watch their games', 'as they <tspan fill="' + RED + '">happen</tspan>'], ['Live scores and win chances for every', 'game your rivals play']],
  ['4-tracking', 'tracking', ['Mute the pings,', 'keep the <tspan fill="' + RED + '">misery</tspan>'], ['Silence push for anyone and', 'still see their alerts in your feed']],
  ['5-player-alerts', 'player-alerts', ['Your rules,', '<tspan fill="' + RED + '">player</tspan> by player'], ['Turn off one alert for one player', 'and keep it for everyone else']],
  ['6-settings', 'settings', ['Every <tspan fill="' + RED + '">painful</tspan>', 'moment'], ['Strikeouts, picks, blown leads,', 'DNFs and dozens more']],
];
const W = 1080, H = 1920;
const shot = (raw, head, sub) => {
  const sw = 760, sh = Math.round(sw * 2796 / 1290), sx = (W - sw) / 2, sy = 520;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(W, H)}
  ${text(W / 2, 200, 98, 800, WHITE, head[0])}
  ${text(W / 2, 308, 98, 800, WHITE, head[1])}
  ${text(W / 2, 400, 44, 500, '#9a9aa2', sub[0])}
  ${text(W / 2, 458, 44, 500, '#9a9aa2', sub[1])}
  <clipPath id="scr"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="70"/></clipPath>
  <rect x="${sx - 16}" y="${sy - 16}" width="${sw + 32}" height="${sh + 32}" rx="86" fill="#2a2a30"/>
  <image href="data:image/jpeg;base64,${rawB64(raw)}" x="${sx}" y="${sy}" width="${sw}" height="${sh}" clip-path="url(#scr)"/>
</svg>`;
};

const FONTS = { fontFiles: [FONT('bold'), FONT('semibold'), FONT('medium'), FONT('regular')], loadSystemFonts: false, defaultFontFamily: 'Inter' };
const png = (svg) => new Resvg(svg, { background: BG, font: FONTS }).render().asPng();
// Play wants opaque 24-bit images for the graphic and screenshots (PNG or JPEG), so JPEG; the icon stays a 32-bit PNG.
const toJpeg = (pngBytes, out) => {
  const tmp = out + '.png';
  writeFileSync(tmp, pngBytes);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', tmp, '--out', out], { stdio: 'ignore' });
  rmSync(tmp);
};

rmSync(here('play'), { recursive: true, force: true });
mkdirSync(here('play/screenshots'), { recursive: true });
execFileSync('sips', ['-z', '512', '512', here('../app/assets/icon.png'), '--out', here('play/icon-512.png')], { stdio: 'ignore' });
toJpeg(png(feature()), here('play/feature-graphic-1024x500.jpg'));
for (const [name, raw, head, sub] of SHOTS) {
  toJpeg(png(shot(raw, head, sub)), here(`play/screenshots/${name}.jpg`));
  console.log(name);
}
