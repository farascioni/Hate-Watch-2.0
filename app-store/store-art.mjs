// What build-store-images.mjs (App Store) and build-play-images.mjs (Google Play) share: the colours, the icon's eye mark,
// the background, the text helper (red `*word*`, shrinks a line that would run off the image), the fonts per language and
// where each language's files go (English: app-store/ itself; others: app-store/localized/<lang>/). Texts: locales.mjs.
// Run a build for some languages only: node app-store/build-store-images.mjs es ja   (no argument: all).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCALES } from './locales.mjs';

export { LOCALES };
export const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const { Resvg } = createRequire(here('../app/package.json'))('@resvg/resvg-js');
export const BG = '#0B0B0D', RED = '#E5232B', WHITE = '#F4F4F5';

const INTER = (w) => here(`../app/node_modules/expo-dev-menu/android/src/debug/res/font/inter_${w}.ttf`);
const HIRAGINO = (w) => `/System/Library/Fonts/ヒラギノ角ゴシック W${w}.ttc`;
const FONTS = {
  latin: { family: 'Inter', files: ['bold', 'semibold', 'medium', 'regular'].map(INTER) },
  ja: { family: 'Hiragino Sans', files: [HIRAGINO(6), HIRAGINO(4)] },
};

export const langs = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(LOCALES);
let lang = 'en';
export const useLang = (l) => { lang = l; return LOCALES[l]; };
export const out = (rel) => (lang === 'en' ? here(rel) : here(`localized/${lang}/${rel}`));

// Same mark as app/scripts/build-icons.mjs, centred on (0,0), ~690 wide.
const EYE = 'M -340 40 Q 0 -230 340 40 Q 0 310 -340 40 Z';
export const MARK = `
  <clipPath id="eye"><path d="${EYE}"/></clipPath>
  <path d="M -306.4 -256.7 L 272.8 -187.4 L 257.2 -92.6 L -313.6 -213.3 Z" fill="${RED}"/>
  <circle cx="-310" cy="-235" r="22" fill="${RED}"/><circle cx="265" cy="-140" r="48" fill="${RED}"/>
  <path d="${EYE}" fill="${WHITE}"/>
  <g clip-path="url(#eye)">
    <circle cx="0" cy="40" r="125" fill="${RED}"/>
    <circle cx="0" cy="40" r="125" fill="none" stroke="#7A0D12" stroke-width="14"/>
    <circle cx="0" cy="40" r="58" fill="${BG}"/><circle cx="36" cy="6" r="22" fill="#fff" opacity="0.92"/>
  </g>`;

export const defs = (w, h) => `
  <radialGradient id="bg" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#3B0D12"/><stop offset="0.55" stop-color="#170A0C"/><stop offset="1" stop-color="${BG}"/></radialGradient>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>`;

// Estimated width of s at `size`; a line wider than maxW is drawn smaller (CJK is one em per character, Latin about half).
// shortcut: an estimate, not a measurement; if a language's lines look cramped or clipped, change the factors or the words.
const fit = (s, size, weight, maxW) => {
  const em = [...s].reduce((n, c) => n + (c.codePointAt(0) > 0x2e80 ? 1 : weight >= 700 ? 0.56 : 0.5), 0);
  return Math.min(size, Math.floor((size * maxW) / (em * size)));
};
export const text = (x, y, size, weight, fill, s, anchor = 'middle', maxW = Infinity) => {
  const plain = s.replace(/\*/g, '');
  const svg = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*(.+?)\*/g, `<tspan fill="${RED}">$1</tspan>`);
  return `<text x="${x}" y="${y}" font-family="${FONTS[LOCALES[lang].font ?? 'latin'].family}" font-weight="${weight}" font-size="${fit(plain, size, weight, maxW)}" fill="${fill}" text-anchor="${anchor}">${svg}</text>`;
};

export const rawB64 = (name) => readFileSync(here(`raw/${name}.jpg`)).toString('base64');
export const png = (svg) => {
  const f = FONTS[LOCALES[lang].font ?? 'latin'];
  return new Resvg(svg, { background: BG, font: { fontFiles: f.files, loadSystemFonts: false, defaultFontFamily: f.family } }).render();
};
export const write = (file, bytes) => writeFileSync(file, bytes);
