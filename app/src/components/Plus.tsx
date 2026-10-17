import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { API_URL } from '../lib/api';
import { EULA_URL, MANAGE_URL, applyGold, goldIconOn, goldIconSupported, iapAvailable, setGoldIcon, usePlus } from '../lib/plus';
import { SettingRow } from './SettingRow';
import { colors, gold, radius, space } from '../theme';

const BLURB = "Servers cost money and I'd like to keep the app ad free! Subscribing unlocks gold accents, a gold app icon, and the ability to add teams and athletes to your most hated list.";

const open = (url: string) => Linking.openURL(url).catch(() => {});

/**
 * Hate Watch Plus card for Settings: the $5/month subscription, and, once subscribed, the Gold accents and Gold app icon switches.
 * Without a store (Expo Go, web) it only explains where Plus works. The store itself lives in PlusStore.
 */
export function Plus() {
  const { active, price, busy, subscribe, restore } = usePlus();
  // A saved gold choice keeps its switch even if the store can't be reached to confirm the subscription right now.
  const [iconOn, setIconOn] = useState(goldIconOn);
  const canToggle = active || gold || iconOn;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Hate Watch Plus</Text>
      <Text style={styles.blurb}>{BLURB}</Text>

      {canToggle ? (
        <View style={styles.switchWrap}>
          <SettingRow
            title="Gold accents"
            desc="Swaps the red for gold throughout the app. Switching restarts the app."
            value={gold}
            onChange={(on) => { applyGold(on).catch(() => Alert.alert("Couldn't switch", 'Please try again.')); }}
          />
          {goldIconSupported() ? (
            <SettingRow
              title="Gold app icon"
              desc="Changes the Home Screen icon to gold."
              value={iconOn}
              onChange={(on) => { setGoldIcon(on).then(() => setIconOn(on)).catch(() => Alert.alert("Couldn't switch", 'Please try again.')); }}
            />
          ) : null}
        </View>
      ) : iapAvailable ? (
        <>
          <Pressable
            onPress={subscribe}
            disabled={busy}
            style={({ pressed }) => [styles.subscribe, (pressed || busy) && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`Subscribe to Hate Watch Plus${price ? ` for ${price} a month` : ''}`}
          >
            {busy ? <ActivityIndicator color={colors.onHate} /> : <Text style={styles.subscribeText}>Subscribe{price ? `  ${price} / month` : ''}</Text>}
          </Pressable>
          <Text style={styles.fine}>
            {`Hate Watch Plus is a monthly subscription${price ? ` at ${price}` : ''}. Payment is charged to your ${Platform.OS === 'ios' ? 'Apple ID' : 'Google Play account'} and renews every month until you cancel, at least 24 hours before the period ends, in your ${Platform.OS === 'ios' ? 'App Store' : 'Google Play'} subscription settings.`}
          </Text>
        </>
      ) : (
        <Text style={styles.fine}>Plus works in the App Store and Google Play versions of Hate Watch.</Text>
      )}

      {iapAvailable ? (
        <View style={styles.links}>
          <Pressable onPress={restore} disabled={busy} hitSlop={6} accessibilityRole="button"><Text style={styles.link}>Restore Purchases</Text></Pressable>
          {active ? <Pressable onPress={() => open(MANAGE_URL)} hitSlop={6} accessibilityRole="link"><Text style={styles.link}>Manage Subscription</Text></Pressable> : null}
          <Pressable onPress={() => open(`${API_URL}/privacy`)} hitSlop={6} accessibilityRole="link"><Text style={styles.link}>Privacy</Text></Pressable>
          <Pressable onPress={() => open(EULA_URL)} hitSlop={6} accessibilityRole="link"><Text style={styles.link}>Terms</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), padding: space(4), gap: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  blurb: { color: colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  subscribe: { backgroundColor: colors.hate, borderRadius: radius.pill, paddingVertical: space(3), alignItems: 'center' },
  subscribeText: { color: colors.onHate, fontWeight: '800', fontSize: 16 },
  switchWrap: { marginHorizontal: -space(4), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  fine: { color: colors.textFaint, fontSize: 11, lineHeight: 15, textAlign: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space(4), rowGap: space(2) },
  link: { color: colors.textDim, fontWeight: '700', fontSize: 12, textDecorationLine: 'underline' },
});
