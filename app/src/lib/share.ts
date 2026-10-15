import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { FeedItem } from './types';

/**
 * What gets shared: the alert's link. Its preview is a picture of the alert (drawn by the server), and
 * tapping it opens the App Store. Plain text if the server didn't send a link.
 */
export function shareText(item: FeedItem, url = item.shareUrl) {
  return url
    ? `${item.emoji} ${item.title}\n${url}`
    : `${item.emoji} ${item.title}\n${item.body}\n\nvia Hate Watch 😈`;
}

/**
 * Opens the native share sheet (iOS / Android, or the browser's where it has one). Browsers without
 * a share sheet get the text copied to the clipboard instead. `url` is the link of the look the person picked
 * (ShareStyleSheet); without one, the alert's own.
 */
export async function shareAlert(item: FeedItem, url = item.shareUrl): Promise<'shared' | 'copied' | 'dismissed'> {
  const message = shareText(item, url);
  const copy = async () => {
    try { await Clipboard.setStringAsync(message); return 'copied' as const; } catch { return 'dismissed' as const; }
  };
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && !('share' in navigator)) return copy();
  // iOS and browsers: the link on its own, so Messages shows one bubble (the alert card). Android's
  // share sheet only takes text, so the link goes at the end of it.
  const content = url && Platform.OS !== 'android' ? { url } : { message };
  try {
    const result = await Share.share(content, { dialogTitle: 'Share this alert', subject: item.title });
    return result.action === Share.sharedAction ? 'shared' : 'dismissed';
  } catch (e) {
    // Cancelling the web share sheet rejects with AbortError: that's a choice, not a failure.
    if ((e as Error)?.name === 'AbortError') return 'dismissed';
    return copy(); // the browser refused to share: copy instead
  }
}
