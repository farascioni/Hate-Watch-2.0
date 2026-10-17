import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * How the Tracking tab draws its cards, picked in the tab's layout menu. Kept on this device only.
 * classic: the banner card; compact: colour bar, status on the right; banner: the game in the banner;
 * tiles: two per row; strip: a scoreboard strip of record, form and the game.
 */
export type TrackingLayout = 'classic' | 'compact' | 'banner' | 'tiles' | 'strip';
export const LAYOUTS: { id: TrackingLayout; name: string; blurb: string }[] = [
  { id: 'classic', name: 'Classic', blurb: 'A banner in the team’s colour' },
  { id: 'compact', name: 'Compact', blurb: 'Colour bar, the game on the right' },
  { id: 'banner', name: 'Banner game', blurb: 'The banner carries the game' },
  { id: 'tiles', name: 'Tiles', blurb: 'Two per row, the most on screen' },
  { id: 'strip', name: 'Scoreboard', blurb: 'Record, form and game in a strip' },
];

const KEY = 'hw.trackingLayout';
let layout: TrackingLayout = 'classic';
const listeners = new Set<() => void>();
const valid = (v: unknown): v is TrackingLayout => LAYOUTS.some((l) => l.id === v);

AsyncStorage.getItem(KEY).then((raw) => {
  if (!valid(raw) || raw === layout) return;
  layout = raw;
  listeners.forEach((l) => l());
}).catch(() => {});

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const setTrackingLayout = (next: TrackingLayout) => {
  layout = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, next).catch(() => {});
};
export const useTrackingLayout = () => useSyncExternalStore(subscribe, () => layout);
