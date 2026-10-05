import AsyncStorage from '@react-native-async-storage/async-storage';

// The startup guide: shown once per install (app/src/app/guide.tsx), and any time from
// Settings → Show the guide.
const SEEN_KEY = 'hatewatch.guideSeen';

let settle!: () => void;
/**
 * Resolves once the first-launch guide is out of the way (finished, skipped, or seen before). The store
 * waits on it before asking for notification permission, so the system prompt never covers the guide.
 */
export const guideSettled = new Promise<void>((resolve) => { settle = resolve; });
export const settleGuide = () => settle();

/** Has this install not seen the guide yet? Storage trouble counts as seen: better no guide than a stuck one. */
export async function needsGuide() {
  try { return (await AsyncStorage.getItem(SEEN_KEY)) == null; } catch { return false; }
}

export function markGuideSeen() {
  AsyncStorage.setItem(SEEN_KEY, String(Date.now())).catch(() => {});
}
