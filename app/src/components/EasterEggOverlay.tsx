import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { onEasterEgg } from '../lib/easterEggs';

const HOLD_MS = 3000; // on screen this long, then it fades
const IN_MS = 250, OUT_MS = 500;

/**
 * An easter egg's reaction (lib/easterEggs.ts): an emoji that pops up in the middle of the screen,
 * stays 3 seconds and fades away. Over everything, but never in the way of a tap.
 */
export function EasterEggOverlay() {
  const [emoji, setEmoji] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => onEasterEgg(async ({ emoji: e }) => {
    const still = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
    setEmoji(e);
    opacity.setValue(0);
    scale.setValue(still ? 1 : 0.5);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: IN_MS, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
      ]),
      Animated.delay(HOLD_MS - IN_MS),
      Animated.timing(opacity, { toValue: 0, duration: OUT_MS, useNativeDriver: true }),
    ]).start(() => setEmoji(null));
  }), [opacity, scale]);

  if (!emoji) return null;
  return (
    <View pointerEvents="none" style={styles.layer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.Text style={[styles.emoji, { opacity, transform: [{ scale }] }]}>{emoji}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  emoji: { fontSize: 96, lineHeight: 112, textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 18, textShadowOffset: { width: 0, height: 4 } },
});
