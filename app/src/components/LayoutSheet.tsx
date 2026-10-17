import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LAYOUTS, setTrackingLayout, useTrackingLayout } from '../lib/trackingLayout';
import { colors, radius, space } from '../theme';

/** The Tracking tab's layout menu: how its cards look. Picking one applies it and closes. */
export function LayoutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const picked = useTrackingLayout();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the card layout menu" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]} accessibilityViewIsModal>
          <View style={styles.grab} />
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">Card layout</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Text style={styles.done}>Done</Text></Pressable>
          </View>
          {LAYOUTS.map((l) => (
            <Pressable key={l.id} onPress={() => { setTrackingLayout(l.id); onClose(); }} style={[styles.option, picked === l.id && styles.optionOn]}
              accessibilityRole="radio" accessibilityState={{ selected: picked === l.id }} accessibilityLabel={`${l.name}: ${l.blurb}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{l.name}</Text>
                <Text style={styles.blurb}>{l.blurb}</Text>
              </View>
              {picked === l.id ? <Ionicons name="checkmark-circle" size={22} color={colors.hate} /> : null}
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: space(4), paddingTop: space(2), gap: space(2) },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space(1) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(1) },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  done: { color: colors.hate, fontSize: 15, fontWeight: '800' },
  option: { flexDirection: 'row', alignItems: 'center', padding: space(3), borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  optionOn: { borderColor: colors.hate, backgroundColor: colors.hateTint },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  blurb: { color: colors.textDim, fontSize: 13 },
});
