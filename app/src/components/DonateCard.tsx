import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';

export const BLURB = "Servers cost money and I'd like to keep the app ad free!";

/** Donate button with the blurb underneath. `children` replaces the button while choosing an amount. */
export function DonateCard({ onDonate, children }: { onDonate?: () => void; children?: ReactNode }) {
  return (
    <View style={styles.card}>
      {children ?? (
        <Pressable onPress={onDonate} style={({ pressed }) => [styles.donate, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Donate to Hate Watch">
          <Text style={styles.donateText}>❤️  Donate</Text>
        </Pressable>
      )}
      {/* Non-breaking space keeps "ad free!" together instead of orphaning "free!" on its own line. */}
      <Text style={styles.blurb}>{BLURB.replace('ad free', 'ad free')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), padding: space(4), gap: space(2), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  donate: { backgroundColor: colors.hate, borderRadius: radius.pill, paddingVertical: space(3), alignItems: 'center' },
  donateText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  blurb: { color: colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
