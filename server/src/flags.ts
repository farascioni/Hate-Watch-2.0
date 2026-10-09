// Server-side switches for features that lean on something outside our control (ESPN's video clips), so
// they can be turned off without an app build: every one is on until turned off. Turning one off works at
// once (read every few seconds, no restart) from the server's shell:
//   fly ssh console -a hate-watch-api -C "node /app/src/flag-cli.ts clips.feed off"
// or for good, surviving a fresh database, with a secret (which restarts the app):
//   fly secrets set -a hate-watch-api HW_FLAGS_OFF=clips.feed,clips.loss
// A flag's parent turns off all of it: "clips" off is every clip.
import { kvGet, kvSet } from './db.ts';

export const FLAGS = {
  clips: 'All of ESPN\'s video clips, everywhere below',
  'clips.highlights': 'Clips on a game\'s Highlights tab (its key plays stay)',
  'clips.feed': 'Clips on alerts in the feed, for the play they\'re about',
  'clips.loss': 'The winning play\'s clip (or the game recap) on loss alerts',
} as const;
export type Flag = keyof typeof FLAGS;

const KEY = 'flags';
const FRESH_MS = 5000;
let cache: { at: number; off: string[] } | null = null;

/** The flags turned off: the secret's, and the database's (read again every few seconds). */
function offNow(): Set<string> {
  if (!cache || Date.now() - cache.at >= FRESH_MS) {
    const stored = kvGet<Record<string, boolean>>(KEY) ?? {};
    cache = { at: Date.now(), off: Object.entries(stored).filter(([, on]) => on === false).map(([f]) => f) };
  }
  return new Set([...(process.env.HW_FLAGS_OFF ?? '').split(',').map((x) => x.trim()).filter(Boolean), ...cache.off]);
}

/** On unless it, or a flag it's part of ("clips" for "clips.feed"), is off. */
export function flagOn(flag: Flag): boolean {
  const off = offNow();
  const parts = flag.split('.');
  return !parts.some((_, i) => off.has(parts.slice(0, i + 1).join('.')));
}

/** Turn a flag on or off in the database (a secret's HW_FLAGS_OFF still wins). */
export function setFlag(flag: Flag, on: boolean) {
  const stored = kvGet<Record<string, boolean>>(KEY) ?? {};
  if (on) delete stored[flag]; else stored[flag] = false;
  kvSet(KEY, stored);
  cache = null;
}

export const flagList = () => (Object.keys(FLAGS) as Flag[]).map((f) => ({ flag: f, on: flagOn(f), about: FLAGS[f] }));
