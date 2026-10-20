import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { snoozeDay } from '../lib/snooze';
import { colors, radius, space } from '../theme';
import { useT } from '../lib/i18n';
import type { Target } from '../lib/types';

const CHOICES = [{ days: 1, key: 'snooze.d1' }, { days: 3, key: 'snooze.d3' }, { days: 7, key: 'snooze.w1' }] as const;

/** The Tracking tab's snooze menu, opened by a long press on a card's bell: no push notifications for 1 day, 3 days or a week, or an end to the one running (`until`, 0 when none). Choosing closes it. */
export function SnoozeSheet({ target, until, onPick, onEnd, onClose }: { target: Target | null; until: number; onPick: (days: number) => void; onEnd: () => void; onClose: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('snooze.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]} accessibilityViewIsModal>
          <View style={styles.grab} />
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{t('snooze.title', { name: target?.name ?? '' })}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Text style={styles.done}>{t('guide.done')}</Text></Pressable>
          </View>
          <Text style={styles.blurb}>{t('snooze.blurb')}</Text>
          {until ? <Text style={styles.until}>{t('tracking.snoozedUntil', { date: snoozeDay(until) })}</Text> : null}
          {CHOICES.map((c) => (
            <Pressable key={c.days} onPress={() => onPick(c.days)} style={styles.option} accessibilityRole="button" accessibilityLabel={`${t('snooze.title', { name: target?.name ?? '' })}: ${t(c.key)}`}>
              <Text style={styles.name}>{t(c.key)}</Text>
              <Ionicons name="notifications-off" size={18} color={colors.textDim} />
            </Pressable>
          ))}
          {until ? (
            <Pressable onPress={onEnd} style={[styles.option, styles.optionEnd]} accessibilityRole="button">
              <Text style={[styles.name, { color: colors.hate }]}>{t('snooze.end')}</Text>
              <Ionicons name="notifications" size={18} color={colors.hate} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: space(4), paddingTop: space(2), gap: space(2) },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space(1) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3), marginBottom: space(1) },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' },
  done: { color: colors.hate, fontSize: 15, fontWeight: '800' },
  blurb: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  until: { color: colors.text, fontSize: 13, fontWeight: '700' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  optionEnd: { borderColor: colors.hate, backgroundColor: colors.hateTint },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
});
