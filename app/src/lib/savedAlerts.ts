import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FeedItem } from './types';

/**
 * Hate Watch Plus: the alert vault. The star on a feed card or an alert's own screen saves the alert; the Feed's Saved
 * chip lists them. Each alert is kept whole (a snapshot), so it stays after the server's feed has paged past it. Kept on
 * this device only; a lapsed subscription only hides it (it is back on resubscribing); deleting the device's data clears it.
 * A saved alert's clip is not kept: it follows the server's `clips.*` switches (server/src/flags.ts), which a copy on the
 * phone would outlive. The live feed's copy of an alert (its clip, a fact added later) wins when the feed still has it.
 */
const KEY = 'hw.savedAlerts';
// shortcut: a hard cap that drops the oldest-saved, so the stored list can't grow without limit; raise it if people hit it.
const MAX = 300;
let saved = new Map<string, FeedItem>(); // oldest saved first
const listeners = new Set<() => void>();

const publish = (next: Map<string, FeedItem>) => {
  while (next.size > MAX) next.delete(next.keys().next().value!);
  saved = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify([...next.values()])).catch(() => {});
};

export const savedAlertsLoaded = AsyncStorage.getItem(KEY).then((raw) => {
  if (!raw) return;
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list)) return;
  // Alerts saved while this was loading stay on top of what was stored.
  const next = new Map<string, FeedItem>();
  for (const i of list) if (i && typeof i.id === 'string' && i.target && typeof i.occurredAt === 'number') next.set(i.id, i);
  saved.forEach((v, k) => next.set(k, v));
  saved = next;
  listeners.forEach((l) => l());
}).catch(() => {});

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const toggleSavedAlert = (item: FeedItem) => {
  const next = new Map(saved);
  if (!next.delete(item.id)) {
    const { clip: _clip, ...rest } = item;
    next.set(item.id, rest);
  }
  publish(next);
};
export const clearSavedAlerts = () => { if (saved.size) publish(new Map()); };
/** The saved copy of an alert, for the alert's screen when neither the feed nor the list it was opened from has it. */
export const savedAlert = (id: string) => saved.get(id);

export const useIsSaved = (id: string) => useSyncExternalStore(subscribe, () => saved.has(id));
/** The whole vault, replaced (never changed in place) on every save. */
export const useSavedMap = () => useSyncExternalStore(subscribe, () => saved);
