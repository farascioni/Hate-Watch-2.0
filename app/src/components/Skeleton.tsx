import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../theme';
import { useShimmer } from '../lib/motion';
import { useT } from '../lib/i18n';

const BAR = 70;

/**
 * Placeholder cards for a tab whose first load is still pending (docs/motion.md "Shimmer"): they appear only if the wait passes
 * 400 ms, so a quick load never flashes them, and a slanted light bar sweeps across them while it lasts. Under reduce motion they
 * sit still. The real list's own wave-in takes over when the data lands.
 */
export function Skeleton({ cards = 4 }: { cards?: number }) {
  const t = useT();
  const show = useRef(new Animated.Value(0)).current;
  const { v } = useShimmer(true);
  const [w, setW] = useState(0);
  useEffect(() => {
    const a = Animated.timing(show, { toValue: 1, duration: 250, delay: 400, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [show]);
  const slide = { transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-BAR, w] }) }, { skewX: '-20deg' as const }] };
  return (
    <Animated.View style={[styles.wrap, { opacity: show }]} accessibilityRole="progressbar" accessibilityLabel={t('game.loading')}>
      {Array.from({ length: cards }, (_, i) => (
        <View key={i} style={styles.card} onLayout={i === 0 ? (e) => setW(e.nativeEvent.layout.width) : undefined}>
          <View style={styles.row}>
            <View style={styles.dot} />
            <View style={{ flex: 1, gap: space(2) }}>
              <View style={[styles.bar, { width: '55%' }]} />
              <View style={[styles.bar, { width: '35%', height: 10 }]} />
            </View>
          </View>
          <View style={[styles.bar, { width: '80%', height: 10 }]} />
          <Animated.View pointerEvents="none" style={[styles.sweep, slide]} />
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space(3), gap: space(3), backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space(4), gap: space(4), overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  dot: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceHi },
  bar: { height: 14, borderRadius: 7, backgroundColor: colors.surfaceHi },
  sweep: { position: 'absolute', top: 0, bottom: 0, width: BAR, backgroundColor: 'rgba(255,255,255,0.07)' },
});
