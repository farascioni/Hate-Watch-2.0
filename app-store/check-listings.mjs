// Checks the store listing texts in app-store/listings/<lang>.md against the stores' limits and rules.
// Run: node app-store/check-listings.mjs   (exit code 1 if anything is over a limit or a section is missing)
// Limits: App Store name 30, subtitle 30, keywords 100, promotional text 170, description 4000; Google Play short description 80.
// The description is shared by both stores, so it may not name another platform (Apple rejects that in metadata).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCALES } from './locales.mjs';

const LIMITS = { 'App name': 30, 'Apple subtitle': 30, 'Apple keywords': 100, 'Apple promotional text': 170, 'Play short description': 80, Description: 4000 };
const OTHER_PLATFORM = /google|android|play store/i;
let bad = 0;
for (const lang of Object.keys(LOCALES).filter((l) => l !== 'en')) {
  const md = readFileSync(fileURLToPath(new URL(`listings/${lang}.md`, import.meta.url)), 'utf8');
  const sections = Object.fromEntries([...md.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map((m) => [m[1], m[2].trim()]));
  for (const [name, max] of Object.entries(LIMITS)) {
    const text = sections[name];
    const n = text === undefined ? -1 : [...text].length;
    const problem = n < 0 ? 'missing' : n > max ? `${n} > ${max}` : name === 'Description' && OTHER_PLATFORM.test(text) ? 'names another platform' : '';
    if (problem) bad++;
    console.log(`${problem ? 'FAIL' : 'ok  '} ${lang} ${name}: ${n < 0 ? '' : `${n}/${max} `}${problem}`);
  }
}
process.exit(bad ? 1 : 0);
