import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

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

/** Opening the app (a cold start, or coming back to it after a minute away) syncs the latest update without waiting for a relaunch. */
export function useAutoUpdate() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const check = () => {
      if (Date.now() - lastCheck < RECHECK_MS) return;
      lastCheck = Date.now();
      syncUpdate().catch(() => {}); // offline or a failed download: the next open tries again
    };
    check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, []);
}
