import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GOLD, colors, space } from '../theme';
import { useT } from '../lib/i18n';

/**
 * The bottom sheet the Hate Watch Plus profile and preset editors share (the same shell as LeagueSheet): a title, a header
 * button, and a scrolling body. An editor passes `onSave` so the header button is a gold Save (dimmed while `canSave` is
 * false), not a Done that closes without saving: the editors' own Save button is far down a long list.
 */
export function PlusSheet({ title, onClose, onSave, canSave = true, children }: { title: string; onClose: () => void; onSave?: () => void; canSave?: boolean; children: ReactNode }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('leagueSheet.closeA11y')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]} accessibilityViewIsModal>
          <View style={styles.grab} />
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">{title}</Text>
            {onSave ? (
              <Pressable onPress={onSave} disabled={!canSave} hitSlop={10} accessibilityRole="button" style={!canSave && { opacity: 0.4 }}><Text style={[styles.done, { color: GOLD }]}>{t('profile.save')}</Text></Pressable>
            ) : (
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Text style={styles.done}>{t('guide.done')}</Text></Pressable>
            )}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} style={{ flexShrink: 1 }}>{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { maxHeight: '85%', backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: space(4), paddingTop: space(2) },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space(3) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(3) },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  done: { color: colors.hate, fontSize: 15, fontWeight: '800' },
  body: { gap: space(3), paddingBottom: space(2) },
});
