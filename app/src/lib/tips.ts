import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Consumable in-app purchases used as tips. Create these exact product IDs in
 * App Store Connect (type: Consumable) and Google Play Console (one-time products).
 * Tips unlock nothing (App Review guideline 3.1.1 allows "tipping" the developer via IAP).
 */
// Suggested prices: $1.99 / $4.99 / $9.99. The app always shows the store's localized price.
export const TIPS = [
  { sku: 'com.hatewatch.app.tip.small', emoji: '☕' },
  { sku: 'com.hatewatch.app.tip.medium', emoji: '🍕' },
  { sku: 'com.hatewatch.app.tip.large', emoji: '🏆' },
] as const;

export const TIP_SKUS: string[] = TIPS.map((t) => t.sku);

/**
 * expo-iap's native module exists only in development and store builds, not in Expo Go
 * or on web. Importing expo-iap without it crashes the app, so callers check this first.
 */
export const iapAvailable = Platform.OS !== 'web' && requireOptionalNativeModule('ExpoIap') != null;
