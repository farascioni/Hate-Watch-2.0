import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

export const CHANNEL_ID = 'hate-events'; // must match the channelId the server sends

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export type PushStatus = 'granted' | 'denied' | 'unavailable';

/** Asks permission and returns this device's Expo push token (APNs on iOS, FCM on Android). */
export async function registerForPush(): Promise<{ status: PushStatus; token: string | null; reason?: string }> {
  if (Platform.OS === 'web') return { status: 'unavailable', token: null, reason: 'Push is not supported on web' };
  if (!Device.isDevice) return { status: 'unavailable', token: null, reason: 'Push needs a physical device' };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Hate events',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 120, 80, 120],
      lightColor: '#E5232B',
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { status: 'denied', token: null };

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { status: 'unavailable', token: null, reason: 'Run `eas init` to set an EAS projectId' };
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { status: 'granted', token: data };
  } catch (e) {
    return { status: 'unavailable', token: null, reason: String(e) };
  }
}
