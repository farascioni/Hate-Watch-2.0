import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';
import { reduceMotion } from '../lib/motion';

export interface SegmentOption<T extends string> { id: T; label: string; a11y?: string }

/**
 * The two-or-three-way switch of the Scores tab (My / Special / All, F1's Live / Upcoming), the same look as the Feed's FilterBar: the
 * lit pill slides to the option you pick (280 ms) instead of jumping. Until the row is measured, or when the number of options changes,
 * it just sits where it belongs; under reduce motion it always does.
 */
// Keyed by the segment width, so a different number of options (MLB's Playoffs appearing, NBA's going) mounts a new pill already in place:
// resetting one native-driven value with setValue left the pill at its old offset beside its new width, hanging off the row.
function Thumb({ idx, bw }: { idx: number; bw: number }) {
  const x = useRef(new Animated.Value(idx * bw)).current;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (reduceMotion()) x.setValue(idx * bw);
    else Animated.timing(x, { toValue: idx * bw, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [idx, bw, x]);
  return <Animated.View pointerEvents="none" style={[styles.thumb, { width: bw, transform: [{ translateX: x }] }]} />;
}

export function Segment<T extends string>({ options, value, onChange, label }: { options: SegmentOption<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  const [w, setW] = useState(0);
  const bw = w / options.length;
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel={label}>
      <View style={styles.row} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {bw > 0 ? <Thumb key={bw} idx={idx} bw={bw} /> : null}
        {options.map((o) => {
          const on = o.id === value;
          return (
            <Pressable key={o.id} onPress={() => onChange(o.id)} style={[styles.segBtn, on && !bw && styles.thumbStill]}
              accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.a11y}>
              <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { marginHorizontal: space(3), marginBottom: space(2), padding: 3, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row' },
  thumb: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.surfaceHi, borderRadius: radius.sm },
  thumbStill: { backgroundColor: colors.surfaceHi },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space(2), borderRadius: radius.sm },
  segText: { color: colors.textDim, fontWeight: '700', fontSize: 14 },
  segTextOn: { color: colors.text },
});
