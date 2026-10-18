import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { API_URL } from '../lib/api';
import { EULA_URL, MANAGE_URL, applyGold, goldIconOn, goldIconSupported, iapAvailable, setGoldIcon, usePlus } from '../lib/plus';
import { SettingRow } from './SettingRow';
import { colors, gold, radius, space } from '../theme';
import { tr, useT } from '../lib/i18n';

const open = (url: string) => Linking.openURL(url).catch(() => {});

/**
 * Hate Watch Plus card for Settings: the $5/month subscription, and, once subscribed, the Gold accents and Gold app icon switches.
 * Without a store (Expo Go, web) it only explains where Plus works. The store itself lives in PlusStore.
 */
export function Plus() {
  const t = useT();
  const { active, price, busy, subscribe, restore } = usePlus();
  // A saved gold choice keeps its switch even if the store can't be reached to confirm the subscription right now.
  const [iconOn, setIconOn] = useState(goldIconOn);
  const canToggle = active || gold || iconOn;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('plus.title')}</Text>
      <Text style={styles.blurb}>{t('plus.blurb')}</Text>

      {canToggle ? (
        <View style={styles.switchWrap}>
          <SettingRow
            title={t('plus.gold')}
            desc={t('plus.goldDesc')}
            value={gold}
            onChange={(on) => { applyGold(on).catch(() => Alert.alert(t('plus.switchFailed'), t('plus.tryAgain'))); }}
          />
          {goldIconSupported() ? (
            <SettingRow
              title={t('plus.icon')}
              desc={t('plus.iconDesc')}
              value={iconOn}
              onChange={(on) => { setGoldIcon(on).then(() => setIconOn(on)).catch(() => Alert.alert(t('plus.switchFailed'), t('plus.tryAgain'))); }}
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
            accessibilityLabel={price ? t('plus.subscribeA11yPrice', { price }) : t('plus.subscribeA11y')}
          >
            {busy ? <ActivityIndicator color={colors.onHate} /> : <Text style={styles.subscribeText}>{price ? t('plus.subscribePrice', { price }) : t('plus.subscribe')}</Text>}
          </Pressable>
          <Text style={styles.fine}>
            {t(Platform.OS === 'ios' ? (price ? 'plus.fineIos' : 'plus.fineIosNoPrice') : (price ? 'plus.fineAndroid' : 'plus.fineAndroidNoPrice'), { price: price ?? '' })}
          </Text>
        </>
      ) : (
        <Text style={styles.fine}>{t('plus.worksIn')}</Text>
      )}

      {iapAvailable ? (
        <View style={styles.links}>
          <Pressable onPress={restore} disabled={busy} hitSlop={6} accessibilityRole="button"><Text style={styles.link}>{t('plus.restore')}</Text></Pressable>
          {active ? <Pressable onPress={() => open(MANAGE_URL)} hitSlop={6} accessibilityRole="link"><Text style={styles.link}>{t('plus.manage')}</Text></Pressable> : null}
          <Pressable onPress={() => open(`${API_URL}/privacy`)} hitSlop={6} accessibilityRole="link"><Text style={styles.link}>{t('plus.privacy')}</Text></Pressable>
          <Pressable onPress={() => open(EULA_URL)} hitSlop={6} accessibilityRole="link"><Text style={styles.link}>{t('plus.terms')}</Text></Pressable>
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
