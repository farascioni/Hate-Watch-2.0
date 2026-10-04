// Only loaded when expo-iap's native module is present (see TipJar.tsx).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { isUserCancelledError, useIAP } from 'expo-iap';
import { DonateCard } from './DonateCard';
import { TIPS, TIP_SKUS } from '../lib/tips';
import { colors, radius, space } from '../theme';

export function TipJarStore() {
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const { connected, products, fetchProducts, requestPurchase, finishTransaction } = useIAP({
    // Also fires on launch for a tip that was paid but never finished (e.g. the app was killed).
    onPurchaseSuccess: async (purchase) => {
      if (!TIP_SKUS.includes(purchase.productId)) return;
      // Consumable: finishing it lets the same tip be bought again (and stops Android's 3-day auto-refund).
      await finishTransaction({ purchase, isConsumable: true });
      setPending(null);
      setChoosing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Thank you! 🙏', 'You just helped keep Hate Watch running, and ad free.');
    },
    onPurchaseError: (error) => {
      setPending(null);
      if (isUserCancelledError(error)) return;
      Alert.alert("Donation didn't go through", error.message || 'Please try again.');
    },
  });

  useEffect(() => {
    if (connected) fetchProducts({ skus: TIP_SKUS, type: 'in-app' }).catch(() => {});
  }, [connected, fetchProducts]);

  const tips = TIPS.map((t) => ({ ...t, product: products.find((p) => p.id === t.sku) }));
  const ready = tips.some((t) => t.product);

  const buy = async (sku: string) => {
    setPending(sku);
    try {
      // Event-based: the result arrives in onPurchaseSuccess / onPurchaseError above.
      await requestPurchase({ request: { apple: { sku }, google: { skus: [sku] } }, type: 'in-app' });
    } catch (e) {
      setPending(null);
      if (!isUserCancelledError(e)) Alert.alert("Donation didn't go through", String((e as Error)?.message ?? e));
    }
  };

  if (!choosing) {
    return (
      <DonateCard
        onDonate={() => {
          if (!ready) {
            Alert.alert('Donate', connected ? "Donations aren't available right now. Please try again later." : "Can't reach the App Store right now. Please try again in a moment.");
            return;
          }
          setChoosing(true);
        }}
      />
    );
  }

  return (
    <DonateCard>
      <View style={styles.row}>
        {tips.filter((t) => t.product).map((t) => (
          <Pressable
            key={t.sku}
            disabled={!!pending}
            onPress={() => buy(t.sku)}
            style={({ pressed }) => [styles.amount, pressed && { opacity: 0.85 }, pending && pending !== t.sku && { opacity: 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel={`Donate ${t.product!.displayPrice}`}
          >
            {pending === t.sku ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={styles.emoji}>{t.emoji}</Text>
                <Text style={styles.price}>{t.product!.displayPrice}</Text>
              </>
            )}
          </Pressable>
        ))}
      </View>
      {!pending ? (
        <Pressable onPress={() => setChoosing(false)} hitSlop={8} style={styles.cancel}>
          <Text style={styles.cancelText}>Maybe later</Text>
        </Pressable>
      ) : null}
    </DonateCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(2) },
  amount: { flex: 1, minHeight: 64, backgroundColor: colors.hate, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingVertical: space(2) },
  emoji: { fontSize: 20 },
  price: { color: '#fff', fontWeight: '800', fontSize: 15, marginTop: 2 },
  cancel: { alignSelf: 'center' },
  cancelText: { color: colors.textFaint, fontWeight: '700', fontSize: 13 },
});
