// Only loaded when expo-iap's native module is present (see app/_layout.tsx).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { isUserCancelledError, useIAP } from 'expo-iap';
import { LEGACY_TIP_SKUS, PLUS_SKU, PlusContext, lapsePlus, type Plus } from '../lib/plus';

/**
 * The one owner of the store connection: Settings reads the subscription from here (usePlus).
 * The entitlement is the store's own answer on this device; there is no server-side receipt check.
 */
export function PlusStore({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  const { connected, subscriptions, fetchProducts, requestPurchase, finishTransaction, restorePurchases, hasActiveSubscriptions } = useIAP({
    // Also fires on launch for a purchase that was paid but never finished (e.g. the app was killed).
    onPurchaseSuccess: async (purchase) => {
      if (LEGACY_TIP_SKUS.includes(purchase.productId)) {
        await finishTransaction({ purchase, isConsumable: true });
        return;
      }
      if (purchase.productId !== PLUS_SKU) return;
      // Not consumable: finishing acknowledges it, which stops Android refunding it after 3 days.
      await finishTransaction({ purchase, isConsumable: false });
      setActive(true);
      setBusy(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Welcome to Hate Watch Plus 🙏', 'Thank you for keeping Hate Watch running and ad free. Switch on Gold accents in Settings.');
    },
    onPurchaseError: (error) => {
      setBusy(false);
      if (isUserCancelledError(error)) return;
      Alert.alert("Subscription didn't go through", error.message || 'Please try again.');
    },
  });

  // Asks the store whether the subscription is live. Only a definite "no" lapses gold: an error or
  // being offline must never take away a subscriber's colour.
  const refresh = useCallback(async () => {
    let yes: boolean;
    try {
      yes = await hasActiveSubscriptions([PLUS_SKU]);
    } catch {
      return null;
    }
    setActive(yes);
    return yes;
  }, [hasActiveSubscriptions]);

  const checked = useRef(false);
  useEffect(() => {
    if (!connected) return;
    fetchProducts({ skus: [PLUS_SKU], type: 'subs' }).catch(() => {});
    if (checked.current) return;
    checked.current = true;
    refresh().then((yes) => {
      if (yes === false) lapsePlus();
    });
  }, [connected, fetchProducts, refresh]);

  const product = subscriptions.find((p) => p.id === PLUS_SKU);

  const subscribe = useCallback(async () => {
    if (!product) {
      Alert.alert('Hate Watch Plus', connected ? "Subscriptions aren't available right now. Please try again later." : "Can't reach the store right now. Please try again in a moment.");
      return;
    }
    setBusy(true);
    try {
      // Android needs the base plan's offer token; Apple ignores it. The result arrives in onPurchaseSuccess / onPurchaseError.
      const offerToken = product.subscriptionOffers?.find((o) => o.offerTokenAndroid)?.offerTokenAndroid;
      await requestPurchase({
        request: {
          apple: { sku: PLUS_SKU },
          google: { skus: [PLUS_SKU], subscriptionOffers: offerToken ? [{ sku: PLUS_SKU, offerToken }] : undefined },
        },
        type: 'subs',
      });
    } catch (e) {
      setBusy(false);
      if (!isUserCancelledError(e)) Alert.alert("Subscription didn't go through", String((e as Error)?.message ?? e));
    }
  }, [product, connected, requestPurchase]);

  const restore = useCallback(async () => {
    setBusy(true);
    try {
      await restorePurchases();
      const yes = await refresh();
      if (yes === false) Alert.alert('Restore purchases', 'No active Hate Watch Plus subscription was found on this account.');
      else if (yes) Alert.alert('Restore purchases', 'Hate Watch Plus is back on.');
    } catch (e) {
      Alert.alert("Couldn't restore", String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [restorePurchases, refresh]);

  const value = useMemo<Plus>(
    () => ({ active, price: product?.displayPrice ?? null, ready: !!product, busy, subscribe, restore }),
    [active, product, busy, subscribe, restore],
  );
  return <PlusContext.Provider value={value}>{children}</PlusContext.Provider>;
}
