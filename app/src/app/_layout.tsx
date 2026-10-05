import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { StoreProvider } from '../lib/store';
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

export default function RootLayout() {
  return (
    <StoreProvider>
      <StatusBar style="light" />
      {Platform.OS !== 'web' && <NotificationRouter />}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="target/[key]" options={{ title: '', headerBackTitle: 'Back' }} />
        <Stack.Screen name="alerts/[key]" options={{ title: 'Alerts', headerBackTitle: 'Back' }} />
        <Stack.Screen name="a/[code]" options={{ title: 'Shared alert', headerBackTitle: 'Back' }} />
      </Stack>
    </StoreProvider>
  );
}
