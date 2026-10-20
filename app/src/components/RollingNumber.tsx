import { useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type TextStyle, View } from 'react-native';
import { reduceMotion } from '../lib/motion';

/**
 * A number that rolls up when it goes up: the old text slides out the top while the new one slides in from
 * below. Rolls only for an increase from a number (not the first value, not a drop, not under reduce motion),
 * so loading and corrections just change. It slides the whole text, so separators and a growing digit count
 * need no special case. `lineHeight` is required: the box is clipped to one line.
 */
export function RollingNumber({ value, text, style, lineHeight, onRoll }: {
  value: number | null; text: string; style: StyleProp<TextStyle>; lineHeight: number; onRoll?: () => void;
}) {
  const [out, setOut] = useState<string | null>(null);
  const prev = useRef({ value, text });
  const t = useRef(new Animated.Value(1)).current;
  const roll = useRef(onRoll);
  roll.current = onRoll;

  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = { value, text };
    if (p.text === text) return;
    if (p.value == null || value == null || value <= p.value || reduceMotion()) { setOut(null); return; }
    setOut(p.text);
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setOut(null); });
    roll.current?.();
  }, [value, text, t]);

  const rise = lineHeight * 0.7;
  const flat = StyleSheet.flatten([style, { lineHeight }]);
  return (
    <View style={styles.clip}>
      <Animated.Text style={[flat, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] }]}>{text}</Animated.Text>
      {out != null ? (
        <Animated.Text style={[flat, styles.out, { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) }] }]}
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{out}</Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  out: { position: 'absolute', left: 0, right: 0, top: 0 },
});
