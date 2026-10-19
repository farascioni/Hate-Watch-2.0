import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { DevSettings, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { gold, setGold } from '../theme';
import { api } from './api';
import { clearMostHated } from './mostHated';

/**
 * Hate Watch Plus: a $5/month auto-renewing subscription whose only perk is switching the red accent to gold.
 * Create this exact product ID in App Store Connect (auto-renewable subscription, 1 month) and in
 * Google Play Console (a subscription with one monthly base plan). The app shows the store's localized price.
 */
export const PLUS_SKU = 'com.hatewatch.app.plus.monthly';

/** The old consumable tips. Gone from the app, but one paid and never finished must still be closed out. */
export const LEGACY_TIP_SKUS = ['com.hatewatch.app.tip.coffee', 'com.hatewatch.app.tip.pizza', 'com.hatewatch.app.tip.trophy'];

/** Apple's standard licence agreement, which an auto-renewing subscription must link to. */
export const EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
export const MANAGE_URL = Platform.OS === 'ios'
  ? 'https://apps.apple.com/account/subscriptions'
  : `https://play.google.com/store/account/subscriptions?sku=${PLUS_SKU}&package=com.hatewatch.app`;

/**
 * expo-iap's native module exists only in development and store builds, not in Expo Go
 * or on web. Importing expo-iap without it crashes the app, so callers check this first.
 */
export const iapAvailable = Platform.OS !== 'web' && requireOptionalNativeModule('ExpoIap') != null;

/**
 * Saves the gold choice and restarts the JavaScript so every style is rebuilt with it (theme.ts reads it once at launch).
 * expo-updates' reload does not exist in development builds, so those fall back to React Native's.
 */
const reload = async () => {
  try {
    await require('expo-updates').reloadAsync();
  } catch {
    DevSettings.reload();
  }
};

export async function applyGold(on: boolean) {
  await setGold(on);
  await reload();
}

/**
 * The gold Home Screen icon (an alternate icon named in app.json's expo-alternate-app-icons plugin). Its native module
 * ships only in builds made after it was added, so it is loaded lazily and everything here is a no-op without it.
 * Android restarts the app when the icon changes.
 */
const GOLD_ICON = 'Gold';
const iconModule = (): typeof import('expo-alternate-app-icons') | null =>
  Platform.OS !== 'web' && requireOptionalNativeModule('ExpoAlternateAppIcons') != null ? require('expo-alternate-app-icons') : null;
export const goldIconSupported = () => !!iconModule()?.supportsAlternateIcons;
export const goldIconOn = () => iconModule()?.getAppIconName() === GOLD_ICON;
export const setGoldIcon = async (on: boolean) => { await iconModule()?.setAlternateAppIcon(on ? GOLD_ICON : null); };

/**
 * Development only (Settings, next to "Send a test event"): reads as a subscriber whatever the store says, so Plus's
 * perks can be tried on a test server. Saved on this device; never exists in a release build.
 */
const DEV_KEY = 'hw.devPlus';
let devOn = false;
const devListeners = new Set<() => void>();
const devLoaded = __DEV__ ? AsyncStorage.getItem(DEV_KEY).then((v) => { devOn = v === '1'; devListeners.forEach((l) => l()); }).catch(() => {}) : Promise.resolve();
// Behind __DEV__ so the minifier drops the body and the 'hw.devPlus' string from release builds (a strings scan of the archive finds nothing).
export const setDevPlus = (on: boolean) => {
  if (!__DEV__) return;
  devOn = on;
  devListeners.forEach((l) => l());
  AsyncStorage.setItem(DEV_KEY, on ? '1' : '0').catch(() => {});
};
const devSubscribe = (l: () => void) => { devListeners.add(l); return () => { devListeners.delete(l); }; };
export const useDevPlus = () => useSyncExternalStore(devSubscribe, () => __DEV__ && devOn);

/** The store (lib/store.tsx) listens here to drop its copy of the favorites when a subscription lapses. */
const lapseListeners = new Set<() => void>();
export const onLapse = (l: () => void) => { lapseListeners.add(l); return () => { lapseListeners.delete(l); }; };

/** A definite "not subscribed": gold goes back to red, the colours and the icon. Whatever was undone can only be redone by subscribing. */
export async function lapsePlus() {
  await devLoaded;
  if (__DEV__ && devOn) return;
  clearMostHated();
  lapseListeners.forEach((l) => l());
  // The server stops sending their opponents' alerts. A failed call (offline) is retried at the next launch or return to the app, while still lapsed.
  api.clearFavorites().catch(() => {});
  // Colours first: changing the icon can close the app on Android before a later step runs.
  if (gold) await setGold(false).catch(() => {});
  if (goldIconOn()) await setGoldIcon(false).catch(() => {});
  if (gold) await reload();
}

export type Plus = {
  /** True once the store says the subscription is active; false until then (and in Expo Go and on web). */
  active: boolean;
  /** The store's price for one month, e.g. "$4.99", once loaded. */
  price: string | null;
  /** The store can be reached (the subscribe button can work). */
  ready: boolean;
  busy: boolean;
  subscribe: () => void;
  restore: () => void;
};

/** Development only: EXPO_PUBLIC_PLUS_DEV=1 makes a build with no store (web, Expo Go) read as a subscriber, to try Plus's perks. */
const devPlus = __DEV__ && process.env.EXPO_PUBLIC_PLUS_DEV === '1';
export const PlusContext = createContext<Plus>({ active: devPlus, price: null, ready: false, busy: false, subscribe: () => {}, restore: () => {} });
export const usePlus = (): Plus => {
  const plus = useContext(PlusContext);
  const dev = useDevPlus();
  return useMemo(() => (dev && !plus.active ? { ...plus, active: true } : plus), [plus, dev]);
};
