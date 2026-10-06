import AsyncStorage from '@react-native-async-storage/async-storage';

/** Hidden reactions to tracking certain players (by catalog key), each shown once per device. */
const EGGS: Record<string, { emoji: string }> = {
  'player:wnba:4433403': { emoji: '🤨' }, // Caitlin Clark
};

type Egg = (typeof EGGS)[string];
const listeners = new Set<(egg: Egg) => void>();

/** EasterEggOverlay listens here. Returns the unsubscribe. */
export function onEasterEgg(fn: (egg: Egg) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** After a follow: the first time this device tracks one of them, their reaction pops up. */
export async function trackedEasterEgg(key: string) {
  const egg = EGGS[key];
  if (!egg) return;
  const seen = `hatewatch.egg.${key}`;
  try {
    if (await AsyncStorage.getItem(seen)) return;
    await AsyncStorage.setItem(seen, '1');
  } catch { /* storage unavailable: show it anyway */ }
  for (const fn of listeners) fn(egg);
}
