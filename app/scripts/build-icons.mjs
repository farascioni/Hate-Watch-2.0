// Generates every app icon / splash PNG from one vector mark.  Run: npm run icons
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (name) => fileURLToPath(new URL(`../assets/${name}`, import.meta.url));

const BG = '#0B0B0D';
const RED = '#E5232B';
const WHITE = '#F4F4F5';

// The mark: an angry eye. Drawn centred on (0,0), ~690 units wide, so it fits a 1024 canvas at scale 1.
const EYE = 'M -340 40 Q 0 -230 340 40 Q 0 310 -340 40 Z';
// Tapered brow: thin at the outer end, thick where it bears down toward the eye = a scowl.
const browShape = (fill) => `
  <path d="M -306.4 -256.7 L 272.8 -187.4 L 257.2 -92.6 L -313.6 -213.3 Z" fill="${fill}"/>
  <circle cx="-310" cy="-235" r="22" fill="${fill}"/>
  <circle cx="265" cy="-140" r="48" fill="${fill}"/>`;

function mark({ mono = false } = {}) {
  if (mono) {
    // Android 13 themed icon: one colour, shapes defined by alpha only.
    return `
      <mask id="m"><rect x="-512" y="-512" width="1024" height="1024" fill="#fff"/><circle cx="0" cy="40" r="125" fill="#000"/></mask>
      ${browShape('#fff')}
      <path d="${EYE}" fill="#fff" mask="url(#m)"/>
      <circle cx="0" cy="40" r="58" fill="#fff"/>`;
  }
  return `
    <clipPath id="eye"><path d="${EYE}"/></clipPath>
    ${browShape(RED)}
    <path d="${EYE}" fill="${WHITE}"/>
    <g clip-path="url(#eye)">
      <circle cx="0" cy="40" r="125" fill="${RED}"/>
      <circle cx="0" cy="40" r="125" fill="none" stroke="#7A0D12" stroke-width="14"/>
      <circle cx="0" cy="40" r="58" fill="${BG}"/>
      <circle cx="36" cy="6" r="22" fill="#fff" opacity="0.92"/>
    </g>`;
}

const background = `
  <radialGradient id="bg" cx="50%" cy="52%" r="62%">
    <stop offset="0" stop-color="#3B0D12"/><stop offset="0.55" stop-color="#170A0C"/><stop offset="1" stop-color="${BG}"/>
  </radialGradient>
  <rect width="1024" height="1024" fill="url(#bg)"/>`;

/** scale: mark size; dy centres the brow+eye block visually (it spans y -270..175). */
const svg = ({ bg = false, scale = 1, mono = false, size = 1024 } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  ${bg ? background : ''}
  <g transform="translate(512 ${512 + 47 * scale}) scale(${scale})">${mark({ mono })}</g>
</svg>`;

function render(name, opts, px = 1024) {
  const png = new Resvg(svg(opts), { fitTo: { mode: 'width', value: px }, background: opts.bg ? BG : undefined }).render().asPng();
  writeFileSync(out(name), png);
  console.log(`${name.padEnd(30)} ${px}x${px}`);
}

render('icon.png', { bg: true, scale: 1 });                          // iOS: opaque, full-bleed (iOS applies its own mask)
render('android-icon-background.png', { bg: true, scale: 0 });       // adaptive icon background layer
render('android-icon-foreground.png', { scale: 0.8 });               // fits the adaptive safe zone (inner 66%)
render('android-icon-monochrome.png', { scale: 0.8, mono: true });   // Android 13+ themed icon
render('splash-icon.png', { scale: 1.2 });                           // transparent; shown on BG by expo-splash-screen
render('favicon.png', { bg: true, scale: 1 }, 48);
render('notification-icon.png', { scale: 1.35, mono: true }, 96);   // Android status bar: white on transparent
