import { useSyncExternalStore } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/**
 * How the web version uses a wide window, picked with the buttons at the bottom of its sidebar. Kept in this browser only.
 * column: one centred column, as on a phone. grid: cards flow into as many columns as fit. panes: the tab on the left,
 * what you opened (a game, a player, an alert) on the right. Under WIDE px, and on every native build, none of this applies:
 * the phone layout, bottom tabs and all.
 */
export type WebLayout = 'column' | 'grid' | 'panes';
export const WEB_LAYOUTS: { id: WebLayout; name: string; icon: 'list-outline' | 'grid-outline' | 'browsers-outline' }[] = [
  { id: 'column', name: 'One column', icon: 'list-outline' },
  { id: 'grid', name: 'Card grid', icon: 'grid-outline' },
  { id: 'panes', name: 'Panes', icon: 'browsers-outline' },
];

export const WIDE = 700;        // from here: a sidebar instead of the bottom tabs
export const FULL = 1100;       // from here: the sidebar has labels, below it's an icon rail
export const SIDEBAR = 208;
export const RAIL = 64;
export const LIST_PANE = 400;   // panes: the tab's width
export const DETAIL_MAX = 760;  // a game, player or alert reads best at this width, centred in what's left
const GRID_MAX = 1600;
const CARD_MIN = 340;

const KEY = 'hw.webLayout';
const valid = (v: unknown): v is WebLayout => WEB_LAYOUTS.some((l) => l.id === v);
let layout: WebLayout = (() => {
  if (Platform.OS !== 'web') return 'grid';
  try { const v = localStorage.getItem(KEY); return valid(v) ? v : 'grid'; } catch { return 'grid'; }
})();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const setWebLayout = (next: WebLayout) => {
  layout = next;
  listeners.forEach((l) => l());
  try { localStorage.setItem(KEY, next); } catch { /* private window: it lasts until the tab closes */ }
};

/** The window's shape for the web version: whether there's a sidebar, its width, the picked layout and how many card columns fit. */
export function useWebLayout() {
  const { width } = useWindowDimensions();
  const picked = useSyncExternalStore(subscribe, () => layout);
  const wide = Platform.OS === 'web' && width >= WIDE;
  const rail = wide && width < FULL;
  const sidebar = wide ? (rail ? RAIL : SIDEBAR) : 0;
  const cols = wide && picked === 'grid' ? Math.max(1, Math.min(4, Math.floor((Math.min(width - sidebar, GRID_MAX) - 16) / CARD_MIN))) : 1;
  return { wide, rail, sidebar, layout: picked, panes: wide && picked === 'panes', cols };
}

/** Cuts every section's cards into rows of `cols(section)`: what a SectionList draws a card grid from. One per row leaves a row of one card. */
export function chunkSections<S extends { data: readonly unknown[] }>(sections: S[], cols: (s: S) => number): (Omit<S, 'data'> & { data: S['data'][number][][] })[] {
  return sections.map((s) => {
    const n = Math.max(1, cols(s));
    return { ...s, data: Array.from({ length: Math.ceil(s.data.length / n) }, (_, i) => s.data.slice(i * n, i * n + n)) };
  });
}
