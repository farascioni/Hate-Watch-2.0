import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { FeedItem } from './types';

/** What gets shared: the alert as the user saw it, plus a little credit. */
export function shareText(item: FeedItem) {
  return `${item.emoji} ${item.title}\n${item.body}\n\nvia Hate Watch 😈`;
}

/**
 * Opens the native share sheet (iOS / Android, or the browser's where it has one). Browsers without
 * a share sheet get the text copied to the clipboard instead.
 */
export async function shareAlert(item: FeedItem): Promise<'shared' | 'copied' | 'dismissed'> {
  const message = shareText(item);
  const copy = async () => {
    try { await Clipboard.setStringAsync(message); return 'copied' as const; } catch { return 'dismissed' as const; }
  };
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !('share' in navigator)) return copy();
  try {
    const result = await Share.share({ message }, { dialogTitle: 'Share this alert' });
    return result.action === Share.sharedAction ? 'shared' : 'dismissed';
  } catch (e) {
    // Cancelling the web share sheet rejects with AbortError: that's a choice, not a failure.
    if ((e as Error)?.name === 'AbortError') return 'dismissed';
    return copy(); // the browser refused to share: copy instead
  }
}
