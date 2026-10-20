// Server-side switches for what leans on something outside our control (ESPN's video clips, and its player
// photos and team logos, in case of a rights issue), so they can be turned off without an app build: every
// one is on until turned off. Turning one off works at once (read every few seconds, no restart) from the
// server's shell:
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
  'clips.loss.ufc': 'A lost UFC fight\'s clip on its loss alerts (from the card\'s and the fighter\'s videos)',
  images: 'ESPN\'s player photos and team logos, everywhere below',
  'images.headshots': 'Player photos (a badge in the team\'s colour with its code and the jersey number instead)',
  'images.logos': 'Team logos (a badge in the team\'s colour with its code instead)',
  liveActivity: 'The lock screen scoreboard (Live Activity): no board for the app to start, no updates sent',
  savings: 'Kill switch for every saving below: off turns them all off, on never turns one on (each is opt-in)',
} as const;
export type Flag = keyof typeof FLAGS;

// Savings: ways to read ESPN less, built but OFF until turned on one by one (the opposite of the flags above, which are
// on until turned off). Each is judged where it's used (`savingOn`), so turning one on or off works within seconds, no
// restart, and the five at the top change nothing anyone sees; the two at the bottom can delay an alert by seconds and
// are to be turned on only after a recorded game has been replayed with them (docs/real-time.md, "Reading ESPN less").
//   fly ssh console -a hate-watch-api -C "node /app/src/flag-cli.ts savings.injuries on"     (off to undo)
// or for good, surviving a fresh database, with a secret (which restarts the app):
//   fly secrets set -a hate-watch-api HW_SAVINGS_ON=savings.injuries,savings.news
// The flag `savings` off (or HW_FLAGS_OFF=savings) turns every saving off at once, whatever is on below.
export const SAVINGS = {
  'savings.photo-checks': 'The catalog refresh keeps a player\'s or team\'s verified image instead of fetching it again',
  'savings.scoreboard-sleep': 'A league\'s scoreboard is read once in 5 minutes while no game of it is live or within 20 minutes',
  'savings.injuries': 'Injury reports are read once in 5 minutes unless a game of the league is live or within 3 hours (else every 30 s)',
  'savings.news': 'League news is read once in 20 minutes (else every 3): an off-field alert can come up to 20 minutes after ESPN posts it',
  'savings.standings': 'Standings are read every 60 s only for 15 minutes after a game ends, else once in 30 minutes',
  'savings.summary-on-demand': 'MLB, NBA, WNBA and NHL: a live game\'s summary is read every 10 s, not 2 (plays still every 2 s); can delay the start, final and box-score alerts by up to 10 s',
  'savings.slow-breaks': 'A live game at halftime, between periods or in a delay is read every 6 s, not 2; the first play after it can be up to 4 s later',
} as const;
export type Saving = keyof typeof SAVINGS;

const SAVINGS_KEY = 'savings';
let savingsCache: { at: number; on: string[] } | null = null;

/** Whether a saving is on: turned on (database or HW_SAVINGS_ON), and the `savings` kill switch not off. */
export function savingOn(saving: Saving): boolean {
  if (!flagOn('savings')) return false;
  if (!savingsCache || Date.now() - savingsCache.at >= FRESH_MS) {
    const stored = kvGet<Record<string, boolean>>(SAVINGS_KEY) ?? {};
    savingsCache = { at: Date.now(), on: Object.entries(stored).filter(([, on]) => on === true).map(([s]) => s) };
  }
  return savingsCache.on.includes(saving) || (process.env.HW_SAVINGS_ON ?? '').split(',').map((x) => x.trim()).includes(saving);
}

/** Turn a saving on or off in the database (a secret's HW_SAVINGS_ON still turns it on). */
export function setSaving(saving: Saving, on: boolean) {
  const stored = kvGet<Record<string, boolean>>(SAVINGS_KEY) ?? {};
  if (on) stored[saving] = true; else delete stored[saving];
  kvSet(SAVINGS_KEY, stored);
  savingsCache = null;
}

export const savingList = () => (Object.keys(SAVINGS) as Saving[]).map((s) => ({ saving: s, on: savingOn(s), about: SAVINGS[s] }));

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
