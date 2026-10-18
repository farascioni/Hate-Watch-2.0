import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../lib/store';
import { usePlus } from '../lib/plus';
import { Avatar } from './Avatar';
import { LeagueTag } from './ui';
import { colors, radius, space } from '../theme';
import { useT } from '../lib/i18n';

/**
 * Settings, under Support Hate Watch: the teams a Plus subscriber roots for (the heart on Search and the team page).
 * Each has its own push bell (the Tracking tab's) and its own alert choices (⚙️, the alerts screen in favorite mode); the heart removes it.
 */
export function Favorites() {
  const t = useT();
  const { favorites, updateFavorite, removeFavorite } = useStore();
  const { active } = usePlus();
  const list = [...favorites.values()].filter((f) => f.target).sort((a, b) => a.favoritedAt - b.favoritedAt);
  if (!active) {
    return (
      <View style={[styles.card, styles.locked]}>
        <Text style={styles.title}>
          <Ionicons name="lock-closed" size={15} color={colors.textDim} /> {t('fav.title')}
        </Text>
        <Text style={styles.blurb}>{t('fav.locked')}</Text>
      </View>
    );
  }
  const fail = () => Alert.alert(t('fav.updateFailed'), t('fav.tryAgain'));
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('fav.title')}</Text>
      <Text style={styles.blurb}>
        {list.length
          ? t('fav.blurb')
          : t('fav.blurbNone')}
      </Text>
      {list.map((f) => (
        <View key={f.key} style={styles.row}>
          <Avatar target={f.target!} size={40} />
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>{f.target!.name}</Text>
            <LeagueTag league={f.target!.league} />
          </View>
          {f.target!.league === 'f1' ? null : <>
          <Pressable onPress={() => updateFavorite(f.key, { push: !f.push }).catch(fail)} hitSlop={8} style={styles.icon} accessibilityRole="button"
            accessibilityLabel={t(f.push ? 'fav.pushOff' : 'fav.pushOn', { name: f.target!.name })}>
            <Ionicons name={f.push ? 'notifications' : 'notifications-off'} size={20} color={f.push ? colors.text : colors.textFaint} />
          </Pressable>
          <Pressable onPress={() => router.push(`/alerts/${encodeURIComponent(f.key)}?fav=1`)} hitSlop={8} style={styles.icon} accessibilityRole="button" accessibilityLabel={t('fav.alertsFor', { name: f.target!.name })}>
            <Ionicons name="settings-outline" size={20} color={colors.text} />
          </Pressable>
          </>}
          <Pressable onPress={() => removeFavorite(f.key).catch(fail)} hitSlop={8} style={styles.icon} accessibilityRole="button" accessibilityLabel={t('fav.remove', { name: f.target!.name })}>
            <Ionicons name="close" size={20} color={colors.textDim} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), marginTop: space(3), padding: space(4), gap: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  locked: { opacity: 0.7 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  blurb: { color: colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  text: { flex: 1, gap: 2, alignItems: 'flex-start' },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  icon: { padding: space(1) },
});
