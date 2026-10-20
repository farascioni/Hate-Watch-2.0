import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import { useIsFocused } from 'expo-router';

/**
 * The little motion the app shares (docs/motion.md): the reduce-motion setting as a plain getter and as a hook, a hook that
 * fires only when a value changes after the first render, a pop, a slide for a list under a switch, three looping effects (a pulse, a breath and a shimmer sweep) that run
 * only while their screen is the one showing, and the first-load wave of cards. Only React Native's own Animated, on the
 * native driver (opacity and transform), so it ships over the air.
 */
let still = false;
AccessibilityInfo.isReduceMotionEnabled().then((v) => { still = v; }).catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { still = v; });

/** True when the phone asks for less motion: every animation then skips to its end. */
export const reduceMotion = () => still;

/** The same setting as state, for what is decided at render (the tab transition): a change of the setting applies at once. */
export function useReduceMotion() {
  const [v, setV] = useState(still);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setV).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setV);
    return () => sub.remove();
  }, []);
  return v;
}

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

/** A scale that swells to `peak` and springs back; use `scale` in a transform and call `pop()` (optionally after `delay` ms). */
export function usePop(peak = 1.3) {
  const scale = useRef(new Animated.Value(1)).current;
  const pop = (delay = 0) => {
    if (still) return;
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(scale, { toValue: peak, duration: 130, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
    ]).start();
  };
  return { scale, pop };
}

/**
 * A 0→1 value that loops while `on` and its screen is showing (a tab you left keeps its views mounted), and stops, reset to 0,
 * when either ends or under reduce motion. `running` says whether it is moving, so a caller can hide what only makes sense moving.
 */
function useLoop(on: boolean, make: (v: Animated.Value) => Animated.CompositeAnimation) {
  const v = useRef(new Animated.Value(0)).current;
  const focused = useIsFocused();
  const running = on && focused && !still;
  useEffect(() => {
    if (!running) return;
    const loop = Animated.loop(make(v));
    loop.start();
    return () => { loop.stop(); v.setValue(0); };
  }, [running, v, make]);
  return { v, running };
}

const pulse = (v: Animated.Value) => Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true });
const breath = (v: Animated.Value) => Animated.sequence([
  Animated.timing(v, { toValue: 1, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
  Animated.timing(v, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
]);

/** One 1,600 ms cycle for a live dot's two rings (the second half a cycle behind: see LiveDot). */
export const usePulse = (on: boolean) => useLoop(on, pulse);

/** A 4,200 ms there-and-back (0→1→0) for a slow glow. */
export const useBreath = (on: boolean) => useLoop(on, breath);

const sweep = (v: Animated.Value) => Animated.timing(v, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: true });

/** One 1,300 ms 0→1 sweep for the light crossing placeholder cards (see Skeleton). */
export const useShimmer = (on: boolean) => useLoop(on, sweep);

/**
 * A translateX that starts 16 px off, in the direction `index` moved, and settles to 0 in 240 ms: the list under a switch sliding the way you
 * went. `group` names which switch's indexes these are; a change of group (another set of options) changes the index without sliding.
 */
export function useSlide(index: number, group = '') {
  const x = useRef(new Animated.Value(0)).current;
  const was = useRef(group);
  const same = useRef(true);
  same.current = was.current === group;
  was.current = group;
  useOnChange(index, (p, n) => {
    if (still || !same.current) return;
    x.setValue(n > p ? 16 : -16);
    Animated.timing(x, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  });
  return { transform: [{ translateX: x }] };
}

const WAVE_ROWS = 6, WAVE_WINDOW = 400, WAVE_GAP = 45;
const waves = new Map<string, { at: number; n: number }>();

/**
 * The first-load entrance of a tab's list: the first few rows to mount (within 400 ms of the first one) rise in 45 ms apart.
 * Once per launch per `tab`: a refresh, a filter change or a row scrolled into view later mounts outside that window and just appears.
 * With no `tab`, or under reduce motion, the style is the finished state.
 */
export function useWave(tab?: string) {
  const w = useRef<{ t: Animated.Value; slot: number } | null>(null);
  if (!w.current) {
    let slot = -1;
    if (tab && !still) {
      const now = Date.now();
      let s = waves.get(tab);
      if (!s) waves.set(tab, s = { at: now, n: 0 });
      if (now - s.at < WAVE_WINDOW && s.n < WAVE_ROWS) slot = s.n++;
    }
    w.current = { t: new Animated.Value(slot < 0 ? 1 : 0), slot };
  }
  const { t, slot } = w.current;
  useEffect(() => {
    if (slot < 0) return;
    Animated.timing(t, { toValue: 1, duration: 300, delay: slot * WAVE_GAP, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slot, t]);
  return { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] };
}
