import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Hate Watch Plus: the players and teams a subscriber marks as their most hated (the star on the Tracking tab).
 * Their alerts get a gold border in the Feed. Kept on this device as a set of target keys (sent to the server only while the
 * lock screen scoreboard is on, liveScoreboard.ts); a lapsed subscription clears it (lapsePlus) and so does deleting the device's data.
 */
const KEY = 'hw.mostHated';
let keys = new Set<string>();
const listeners = new Set<() => void>();

const publish = (next: Set<string>) => {
  keys = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify([...next])).catch(() => {});
};

export const mostHatedLoaded = AsyncStorage.getItem(KEY).then((raw) => {
  if (!raw) return;
  const saved: unknown = JSON.parse(raw);
  if (!Array.isArray(saved)) return;
  keys = new Set([...saved.filter((k): k is string => typeof k === 'string'), ...keys]);
  listeners.forEach((l) => l());
}).catch(() => {});

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const toggleMostHated = (key: string) => {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  publish(next);
};
/** The lock screen scoreboard (liveScoreboard.ts) sorts by these: it uploads them and watches for changes. */
export const getMostHated = () => [...keys];
export const onMostHatedChange = subscribe;
export const clearMostHated = () => { if (keys.size) publish(new Set()); };

export const useIsMostHated = (key: string) => useSyncExternalStore(subscribe, () => keys.has(key));
/** Whether any of these target keys is marked: a scoreboard's teams, their tracked players, an F1 session's drivers. */
export const useAnyMostHated = (targets: string[]) => useSyncExternalStore(subscribe, () => targets.some((k) => keys.has(k)));
/** How many are marked: Following keeps the star working for someone whose subscription can't be confirmed (offline). */
export const useMostHatedCount = () => useSyncExternalStore(subscribe, () => keys.size);
