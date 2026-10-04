import type { ComponentType } from 'react';
import { Alert, Platform } from 'react-native';
import { DonateCard } from './DonateCard';
import { iapAvailable } from '../lib/tips';

// Required lazily: evaluating expo-iap without its native module (Expo Go, web) throws.
const Store: ComponentType | null = iapAvailable ? require('./TipJarStore').TipJarStore : null;

/**
 * Donate button + blurb. In store and development builds it is backed by real in-app
 * purchases (TipJarStore). In Expo Go and on web there is no store to pay through,
 * so the button explains that instead.
 */
export function TipJar() {
  if (Store) return <Store />;
  return (
    <DonateCard
      onDonate={() => {
        const msg = 'Donations work in the App Store and Google Play versions of Hate Watch.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Donate', msg);
      }}
    />
  );
}
