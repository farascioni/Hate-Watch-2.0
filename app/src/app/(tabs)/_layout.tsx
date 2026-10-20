import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View, type ColorValue } from 'react-native';
import { Tabs, router } from 'expo-router';
import { BottomTabBar, type BottomTabBarProps } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../../lib/store';
import { DetailPlaceholder } from '../../components/WebShell';
import { useWebLayout } from '../../lib/webLayout';
import { useT } from '../../lib/i18n';
import { reduceMotion, useOnChange, usePop, useReduceMotion } from '../../lib/motion';
import { colors, space } from '../../theme';

/** Top left of every tab: the leaderboard (the most hated athletes and teams), instead of a sixth tab. */
function LeaderboardButton() {
  const t = useT();
  return (
    <Pressable onPress={() => router.push('/leaderboard')} hitSlop={10} style={({ pressed }) => [{ marginLeft: space(4), marginRight: space(2), padding: 2 }, pressed && { opacity: 0.6 }]}
      accessibilityRole="button" accessibilityLabel={t('tab.leaderboardLabel')}>
      <Ionicons name="podium" size={22} color={colors.text} />
    </Pressable>
  );
}

type TabIconName = React.ComponentProps<typeof Ionicons>['name'];

/** A tab's icon, swelling to 1.25 and springing back when its tab is the one just tapped (docs/motion.md "Tab transition"). */
function TabIcon({ name, color, size, focused }: { name: TabIconName; color: ColorValue; size: number; focused: boolean }) {
  const { scale, pop } = usePop(1.25);
  useOnChange(focused, (_, now) => { if (now) pop(); });
  return <Animated.View style={{ transform: [{ scale }] }}><Ionicons name={name} color={color} size={size} /></Animated.View>;
}
const icon = (name: TabIconName) => ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => <TabIcon name={name} color={color} size={size} focused={focused} />;

/** The default tab bar with a line along its top edge that glides to the tapped tab in 300 ms (a jump under reduce motion). */
function GlideTabBar(props: BottomTabBarProps) {
  const { wide } = useWebLayout();
  const n = props.state.routes.length;
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(props.state.index)).current;
  useEffect(() => {
    if (reduceMotion()) { x.setValue(props.state.index); return; }
    const a = Animated.timing(x, { toValue: props.state.index, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [props.state.index, x]);
  const focused = props.state.routes[props.state.index].name;
  const first = useRef(true);
  // Before paint, so the first screen never shows at 0.
  useLayoutEffect(() => {
    for (const r of props.state.routes) {
      const to = r.name === focused ? 1 : 0;
      if (first.current || reduceMotion()) fade(r.name).setValue(to);
      else Animated.timing(fade(r.name), { toValue: to, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    first.current = false;
  }, [focused]);
  if (wide) return <BottomTabBar {...props} />;
  const slot = w / n;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <BottomTabBar {...props} />
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: slot, alignItems: 'center', transform: [{ translateX: x.interpolate({ inputRange: [0, n - 1], outputRange: [0, (n - 1) * slot] }) }] }}>
        <View style={{ width: 28, height: 2, borderRadius: 1, backgroundColor: colors.hate }} />
      </Animated.View>
    </View>
  );
}

/**
 * One fade value per tab, 1 on the focused tab and 0 on the rest, driven by GlideTabBar. The navigator's own per-tab progress
 * is not used for the look: overlapping taps start new timings on values the previous tap's Animated.parallel is still
 * stopping, so the focused tab's progress could be left at its inactive end and the screen stayed blank.
 */
const fades = new Map<string, Animated.Value>();
const fade = (name: string) => {
  let v = fades.get(name);
  if (!v) fades.set(name, (v = new Animated.Value(0)));
  return v;
};
/** The old screen fades out fast, the new one fades up from 10 px low. */
const settle = (name: string) => () => ({
  sceneStyle: {
    opacity: fade(name).interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }),
    transform: [{ translateY: fade(name).interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  },
});
const SETTLE = { animation: 'timing' as const, config: { duration: 240, easing: Easing.out(Easing.cubic) } };

export default function TabLayout() {
  const { unseen, follows } = useStore();
  const t = useT();
  const { wide, panes } = useWebLayout();
  // The Feed badge swells when an alert lands while the app is open (unseen only ever rises live: store.tsx).
  const { scale, pop } = usePop(1.55);
  useOnChange(unseen, (p, n) => { if (n > p) pop(); });
  // Panes draw the tab beside the router's stack (WebShell's ListPane), so the router's own tab screens would be a second copy.
  if (panes) return <DetailPlaceholder />;
  // A sidebar (WebShell) replaces the tab bar and the leaderboard button.
  // Under reduce motion the screens swap with no animation (read at render, so a change applies from the next render on).
  const still = useReduceMotion();
  return (
    <Tabs
      tabBar={(p) => <GlideTabBar {...p} />}
      screenOptions={({ route }) => ({
        ...(still ? {} : { sceneStyleInterpolator: settle(route.name), transitionSpec: SETTLE }),
        headerStyle: { backgroundColor: colors.bg, borderBottomColor: colors.border },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '900' },
        tabBarStyle: wide ? { display: 'none' } : { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.hate,
        tabBarInactiveTintColor: colors.textFaint,
        sceneStyle: { backgroundColor: colors.bg },
        headerLeft: wide ? undefined : () => <LeaderboardButton />,
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.feed'),
          headerTitle: t('tab.title'),
          tabBarIcon: icon('flame'),
          tabBarBadge: unseen > 0 ? (unseen > 99 ? '99+' : unseen) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.hate, color: colors.onHate, transform: [{ scale }] },
        }}
      />
      <Tabs.Screen
        name="scores"
        options={{ title: t('tab.scores'), tabBarIcon: icon('trophy') }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: t('tab.search'), tabBarIcon: icon('search') }}
      />
      <Tabs.Screen
        name="following"
        options={{
          title: t('tab.tracking'),
          headerTitle: t('tab.trackingCount', { n: follows.size }),
          tabBarIcon: icon('eye'),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t('tab.settings'), tabBarIcon: icon('options') }}
      />
    </Tabs>
  );
}
