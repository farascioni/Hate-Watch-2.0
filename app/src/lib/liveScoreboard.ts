import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { getMostHated, mostHatedLoaded, onMostHatedChange } from './mostHated';
import type { LiveBoard } from './types';

/**
 * The lock screen scoreboard (docs/live-activity.md): one Live Activity listing the live games of the teams this device
 * tracks, favorites first, then most hated, then the rest. The server builds the board and pushes every change to Apple
 * (server/src/live-activity.ts); this side starts the activity, hands the server its push token and the most hated keys
 * (kept on the device otherwise), and ends it. iOS builds with the widget extension only; off until switched on in Settings.
 * The app starts it when it comes to the foreground; the server cannot start one on its own (no push-to-start yet).
 */
const KEY = 'hw.liveBoard';
const LAYOUT_KEY = 'hw.liveLayout';
export const liveBoardSupported = Platform.OS === 'ios' && requireOptionalNativeModule('ExpoWidgets') != null;
const activity = () => (liveBoardSupported ? (require('../widgets/ScoreboardActivity').default as typeof import('../widgets/ScoreboardActivity').default) : null);

export type LiveLayout = 'compact' | 'detailed' | 'grid' | 'hero';
export const LIVE_LAYOUTS: LiveLayout[] = ['compact', 'detailed', 'grid', 'hero'];
let on = false, layout: LiveLayout = 'compact';
const listeners = new Set<() => void>();
const loaded = liveBoardSupported
  ? Promise.all([AsyncStorage.getItem(KEY), AsyncStorage.getItem(LAYOUT_KEY)]).then(([v, l]) => { on = v === '1'; layout = LIVE_LAYOUTS.find((x) => x === l) ?? 'compact'; listeners.forEach((fn) => fn()); }).catch(() => {})
  : Promise.resolve();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useLiveBoard = () => useSyncExternalStore(subscribe, () => on);
export const useLiveLayout = () => useSyncExternalStore(subscribe, () => layout);

const end = async () => { try { for (const i of activity()?.getInstances() ?? []) await i.end('immediate').catch(() => {}); } catch { /* none up */ } };

let tokenSub: { remove: () => void } | undefined;

/** Asks the server for the board now and shows it: starts the activity, updates the one already up, or ends it when there is nothing live. One at a time. */
export function syncLiveBoard() {
  if (running) { again = true; return running; }
  running = (async () => {
    do { again = false; await sync().catch(() => {}); } while (again);
  })().finally(() => { running = undefined; });
  return running;
}
let running: Promise<void> | undefined, again = false;

async function sync() {
  await Promise.all([loaded, mostHatedLoaded]); // an empty list sent before the saved one loads would wipe the server's copy
  const act = activity();
  if (!act || !on) return;
  // The server keeps the activity's token between launches, so a failure here (offline) leaves the lock screen as it is.
  const board = (await api.putLiveActivity({ mostHated: getMostHated(), layout, sandbox: __DEV__ })).board;
  const [current, ...extra] = act.getInstances();
  for (const i of extra) await i.end('immediate').catch(() => {});
  if (!board) { await current?.end('immediate').catch(() => {}); return; }
  // start() throws when Live Activities are switched off for Hate Watch in iOS Settings.
  const instance = current ?? act.start(board);
  if (current) await current.update(board).catch(() => {});
  const send = (activityToken: string) => api.putLiveActivity({ activityToken, sandbox: __DEV__ }).catch(() => {});
  tokenSub?.remove();
  tokenSub = instance.addPushTokenListener((e) => { send(e.pushToken); });
  const t = await instance.getPushToken().catch(() => null);
  if (t) send(t);
}

/** Compact (one line a game), detailed (two lines, bases, win chance), grid (cells two across) or hero (the top game big); the server builds the board for it and the widget draws it. */
export async function setLiveLayout(next: LiveLayout) {
  await loaded;
  layout = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(LAYOUT_KEY, next).catch(() => {});
  if (on) await syncLiveBoard();
}

export async function setLiveBoard(next: boolean) {
  await loaded;
  on = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, next ? '1' : '0').catch(() => {});
  if (next) await syncLiveBoard();
  else {
    await end();
    api.deleteLiveActivity().catch(() => {});
  }
}

if (liveBoardSupported) {
  AppState.addEventListener('change', (s) => { if (s === 'active') syncLiveBoard(); });
  syncLiveBoard(); // launch
  onMostHatedChange(() => { syncLiveBoard(); });
}
