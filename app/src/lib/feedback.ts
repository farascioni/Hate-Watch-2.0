import { Alert, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Clipboard from 'expo-clipboard';
import { tr } from './i18n';

export const FEEDBACK_EMAIL = 'hatewatchfeedback@gmail.com';

/** Opens the user's mail app with a pre-addressed feedback email; falls back to showing/copying the address. */
export async function sendFeedback() {
  // Context at the bottom of the email so bug reports are actionable. Nothing personal is included.
  const details = [
    `Hate Watch ${Constants.expoConfig?.version ?? ''}`.trim(),
    `${Platform.OS} ${Platform.Version}`,
    Device.modelName ?? undefined,
  ].filter(Boolean).join(' · ');
  const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Hate Watch feedback')}&body=${encodeURIComponent(`\n\n\n—\n${details}`)}`;

  try {
    await Linking.openURL(url);
  } catch {
    // No mail app set up (common on iPads, or if the Mail app was deleted).
    if (Platform.OS === 'web') { window.alert(tr('feedback.sendTo', { email: FEEDBACK_EMAIL })); return; }
    Alert.alert(tr('feedback.title'), tr('feedback.emailUs', { email: FEEDBACK_EMAIL }), [
      { text: tr('feedback.copy'), onPress: () => { Clipboard.setStringAsync(FEEDBACK_EMAIL).catch(() => {}); } },
      { text: tr('common.ok'), style: 'cancel' },
    ]);
  }
}
