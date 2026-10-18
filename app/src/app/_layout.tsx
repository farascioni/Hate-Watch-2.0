import { Fragment, useEffect, type ComponentType, type ReactNode } from 'react';
import { Platform, type ViewStyle } from 'react-native';
import { DarkTheme, Stack, ThemeProvider, router, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { StoreProvider } from '../lib/store';
import { EasterEggOverlay } from '../components/EasterEggOverlay';
import { needsGuide, settleGuide } from '../lib/guide';
import { iapAvailable } from '../lib/plus';
import { useAutoUpdate } from '../lib/updates';
import { DETAIL_MAX, WIDE_HOST, useWebLayout } from '../lib/webLayout';
import { WebShell } from '../components/WebShell';
import { colors } from '../theme';

/** A screen opened straight from a link (a shared alert) still has the tabs underneath to go back to. */
export const unstable_settings = { anchor: '(tabs)' };

/** Tapping a push opens the Feed tab (works from cold start too). */
function NotificationRouter() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (last?.notification.request.content.data?.eventId) router.navigate('/');
  }, [last]);
  return null;
}

/** A device's first launch opens the startup guide over the app, once the navigator is ready. */
function FirstLaunchGuide() {
  const ready = !!useRootNavigationState()?.key;
  useEffect(() => {
    if (!ready) return;
    needsGuide().then((first) => (first ? router.push('/guide?first=1') : settleGuide()));
  }, [ready]);
  return null;
}

// Required lazily: evaluating expo-iap without its native module (Expo Go, web) throws.
const PlusStore: ComponentType<{ children: ReactNode }> = iapAvailable ? require('../components/PlusStore').PlusStore : Fragment;

// On the web and on an iPad the app is a phone layout in a centred column; in a wide window, a sidebar and the picked layout (WebShell).
const Shell: ComponentType<{ children: ReactNode }> = WIDE_HOST ? WebShell : Fragment;

// The stack's screen wrapper paints the navigation theme's background (light grey) behind a screen that is narrower than the window (web, DETAIL_MAX).
const appTheme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg } };

export default function RootLayout() {
  useAutoUpdate();
  const { wide } = useWebLayout();
  // A game, player or alert reads best narrow: centred in the room the sidebar leaves (the tabs fill it).
  const detail: ViewStyle | undefined = wide ? { width: '100%', maxWidth: DETAIL_MAX, marginHorizontal: 'auto' as unknown as number } : undefined;
  return (
    <PlusStore>
    <StoreProvider>
      <StatusBar style="light" />
      {Platform.OS !== 'web' && <NotificationRouter />}
      <FirstLaunchGuide />
      <Shell>
      <ThemeProvider value={appTheme}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: colors.bg, ...detail },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        <Stack.Screen name="target/[key]" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="stats/[key]" options={{ title: 'Stats', headerBackTitle: 'Back' }} />
        <Stack.Screen name="alerts/[key]" options={{ title: 'Alerts', headerBackTitle: 'Back' }} />
        <Stack.Screen name="game/[key]" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="f1/[event]" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="ufc/[event]" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="leaderboard" options={{ title: 'Leaderboard', headerBackTitle: 'Back' }} />
        <Stack.Screen name="a/[code]" options={{ title: 'Shared alert', headerBackTitle: 'Back' }} />
        <Stack.Screen name="guide" options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false, animation: 'fade' }} />
      </Stack>
      </ThemeProvider>
      </Shell>
      <EasterEggOverlay />
    </StoreProvider>
    </PlusStore>
  );
}
