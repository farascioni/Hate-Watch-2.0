import { useLayoutEffect, useRef } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';

/**
 * The little motion the app shares (docs/motion.md): the reduce-motion setting as a plain getter, a hook that
 * fires only when a value changes after the first render, and a pop. Only React Native's own Animated, on the
 * native driver (opacity and transform), so it ships over the air.
 */
let still = false;
AccessibilityInfo.isReduceMotionEnabled().then((v) => { still = v; }).catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { still = v; });

/** True when the phone asks for less motion: every animation then skips to its end. */
export const reduceMotion = () => still;

/** Calls `fn(prev, next)` when `value` changes, never on the first render. */
export function useOnChange<T>(value: T, fn: (prev: T, next: T) => void) {
  const prev = useRef(value);
  const latest = useRef(fn);
  latest.current = fn;
  // A layout effect, so a reset to the start of an animation lands before the frame is painted (no flash of the end state).
  useLayoutEffect(() => {
    if (prev.current === value) return;
    const p = prev.current;
    prev.current = value;
    latest.current(p, value);
  }, [value]);
}

/** A scale that swells to `peak` and springs back; use `scale` in a transform and call `pop()`. */
export function usePop(peak = 1.3) {
  const scale = useRef(new Animated.Value(1)).current;
  const pop = () => {
    if (still) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: peak, duration: 130, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
    ]).start();
  };
  return { scale, pop };
}
