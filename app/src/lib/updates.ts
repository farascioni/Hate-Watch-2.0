import { useEffect } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { tr } from './i18n';

/** Checks for an over-the-air update, downloads it and restarts into it. 'off' in development builds and on web, which take none. */
export async function syncUpdate(): Promise<'reloading' | 'current' | 'off'> {
  const Updates = require('expo-updates');
  if (!Updates.isEnabled) return 'off';
  if (!(await Updates.checkForUpdateAsync()).isAvailable) return 'current';
  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
  return 'reloading';
}

const RECHECK_MS = 60_000;
let lastCheck = 0;

const BUILD_ASKED_KEY = 'hw.buildAsked';

/** This install's build number (iOS only; null in development, on web and in a build without the module). */
const installedBuild = (): number | null => {
  const n = Number(requireOptionalNativeModule('ExpoApplication')?.nativeBuildVersion);
  return !__DEV__ && Platform.OS === 'ios' && Number.isInteger(n) && n > 0 ? n : null;
};

/** A newer build than this install (the server records the newest by hand, build-cli.ts): offers to open TestFlight or the App Store, whichever the server says, once per build number. */
async function offerNewBuild() {
  const mine = installedBuild();
  if (mine == null) return;
  const { ios, url } = await api.latestBuild();
  if (ios == null || ios <= mine || !/^itms-(beta|apps):\/\//.test(url) || Number(await AsyncStorage.getItem(BUILD_ASKED_KEY)) >= ios) return;
  const asked = () => AsyncStorage.setItem(BUILD_ASKED_KEY, String(ios)); // on a tap, so an update restart that wipes the alert asks again
  Alert.alert(tr('update.title'), tr('update.body', { build: ios }), [
    { text: tr('update.later'), style: 'cancel', onPress: asked },
    { text: tr('update.update'), onPress: () => { asked(); Linking.openURL(url).catch(() => {}); } },
  ]);
}

/** Opening the app (a cold start, or coming back to it after a minute away) syncs the latest update without waiting for a relaunch, then checks for a newer TestFlight build. */
export function useAutoUpdate() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const check = () => {
      if (Date.now() - lastCheck < RECHECK_MS) return;
      lastCheck = Date.now();
      syncUpdate().catch(() => {}); // offline or a failed download: the next open tries again
      offerNewBuild().catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, []);
}
