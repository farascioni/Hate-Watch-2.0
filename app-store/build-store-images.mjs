// Renders the App Store Connect images from the app's own screens in app-store/raw/ (taken by capture-screens.mjs):
// the "Header" (21:9) and "Search Results" (3:2) into header-search/, and the framed, captioned screenshots into
// screenshots/ (1320x2868), screenshots-6.5in/ (1284x2778) and screenshots-6.3in/ (1206x2622).
// Run: node app-store/build-store-images.mjs   (needs app/node_modules; macOS `sips` scales the screenshots)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { Resvg } = createRequire(here('../app/package.json'))('@resvg/resvg-js');

const FONT = (w) => here(`../app/node_modules/expo-dev-menu/android/src/debug/res/font/inter_${w}.ttf`);
const BG = '#0B0B0D', RED = '#E5232B', WHITE = '#F4F4F5';

// Same mark as app/scripts/build-icons.mjs, centred on (0,0), ~690 wide.
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
const header = (w = 3840, h = 1646) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${defs(w, h)}
  <g transform="translate(-140 0)">
  <g transform="translate(1200 ${h / 2 - 20}) scale(1.35)">${MARK}</g>
  ${text(1780, 690, 190, 800, WHITE, 'Know the second', 'start')}
  ${text(1780, 900, 190, 800, WHITE, 'your rivals <tspan fill="' + RED + '">fail</tspan>', 'start')}
  ${text(1780, 1040, 76, 500, '#9a9aa2', 'Real-time alerts for the rivals you can’t stand', 'start')}
  ${chips(2555, 1150, 100, 46)}
  </g>
</svg>`;

// Search results 3:2: headline, then the feed bleeding off the bottom.
const rawB64 = (name) => readFileSync(here(`raw/${name}.jpg`)).toString('base64');
const search = (w = 3840, h = 2560) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${defs(w, h)}
  <g transform="translate(${w / 2} 330) scale(0.62)">${MARK}</g>
  ${text(w / 2, 770, 250, 800, WHITE, 'Know the second')}
  ${text(w / 2, 1030, 250, 800, WHITE, 'your rivals <tspan fill="' + RED + '">fail</tspan>')}
  ${text(w / 2, 1235, 92, 500, '#9a9aa2', 'Real-time alerts when the players and teams you can’t stand mess up')}
  <clipPath id="card"><rect x="${w / 2 - 650}" y="1390" width="1300" height="${h}" rx="110"/></clipPath>
  <rect x="${w / 2 - 665}" y="1375" width="1330" height="${h}" rx="122" fill="#2a2a30"/>
  <image href="data:image/jpeg;base64,${rawB64('feed')}" x="${w / 2 - 650}" y="1390" width="1300" height="2818" clip-path="url(#card)"/>
</svg>`;

// Screenshots 1320x2868: caption on the gradient, the app screen in a phone frame.
const SHOTS = [
  ['1-feed', 'feed', ['Know the second', 'your rivals <tspan fill="' + RED + '">fail</tspan>'], ['Real-time alerts when the players', 'and teams you can’t stand mess up']],
  ['2-search', 'search', ['Track anyone', 'you love to <tspan fill="' + RED + '">hate</tspan>'], ['Teams and athletes across the pros,', 'college football, F1 and UFC']],
  ['3-scores', 'scores', ['Watch their games', 'as they <tspan fill="' + RED + '">happen</tspan>'], ['Live scores and win chances for every', 'game your rivals play']],
  ['4-tracking', 'tracking', ['Mute the pings,', 'keep the <tspan fill="' + RED + '">misery</tspan>'], ['Silence push for anyone and', 'still see their alerts in your feed']],
  ['5-player-alerts', 'player-alerts', ['Your rules,', '<tspan fill="' + RED + '">player</tspan> by player'], ['Turn off one alert for one player', 'and keep it for everyone else']],
  ['6-settings', 'settings', ['Every <tspan fill="' + RED + '">painful</tspan>', 'moment'], ['Strikeouts, picks, blown leads,', 'DNFs and dozens more']],
];
const shot = (raw, head, sub, w = 1320, h = 2868) => {
  const sw = 930, sh = Math.round(sw * 2796 / 1290), sx = (w - sw) / 2, sy = 700;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${defs(w, h)}
  ${text(w / 2, 300, 128, 800, WHITE, head[0])}
  ${text(w / 2, 435, 128, 800, WHITE, head[1])}
  ${text(w / 2, 575, 58, 500, '#9a9aa2', sub[0])}
  ${text(w / 2, 645, 58, 500, '#9a9aa2', sub[1])}
  <clipPath id="scr"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="84"/></clipPath>
  <rect x="${sx - 20}" y="${sy - 20}" width="${sw + 40}" height="${sh + 40}" rx="104" fill="#2a2a30"/>
  <image href="data:image/jpeg;base64,${rawB64(raw)}" x="${sx}" y="${sy}" width="${sw}" height="${sh}" clip-path="url(#scr)"/>
</svg>`;
};

mkdirSync(here('header-search'), { recursive: true });
const FONTS = { fontFiles: [FONT('bold'), FONT('semibold'), FONT('medium'), FONT('regular')], loadSystemFonts: false, defaultFontFamily: 'Inter' };
const render = (svg, name) => {
  const png = new Resvg(svg, { background: BG, font: FONTS }).render();
  writeFileSync(here(`header-search/${name}`), png.asPng());
  console.log(name, png.width, png.height);
};
render(header(), 'header-3840x1646.png');
render(search(), 'search-results-3840x2560.png');

// Screenshots: PNG from resvg, then JPEG (opaque, as Apple requires) at each size Apple accepts for iPhone.
const SIZES = [['screenshots', 1320, 2868], ['screenshots-6.5in', 1284, 2778], ['screenshots-6.3in', 1206, 2622]];
for (const [dir] of SIZES) { rmSync(here(dir), { recursive: true, force: true }); mkdirSync(here(dir)); }
for (const [name, raw, head, sub] of SHOTS) {
  const png = new Resvg(shot(raw, head, sub), { background: BG, font: FONTS }).render().asPng();
  const tmp = here(`header-search/.${name}.png`);
  writeFileSync(tmp, png);
  for (const [dir, w, h] of SIZES)
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', '-z', String(h), String(w), tmp, '--out', here(`${dir}/${name}.jpg`)], { stdio: 'ignore' });
  rmSync(tmp);
  console.log(name);
}
