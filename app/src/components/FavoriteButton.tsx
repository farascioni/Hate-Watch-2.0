import { useRef } from 'react';
import { Alert, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../lib/store';
import { usePlus } from '../lib/plus';
import { GOLD, colors, radius, space } from '../theme';
import type { Target } from '../lib/types';
import { useT } from '../lib/i18n';
import { reduceMotion, useOnChange, usePop } from '../lib/motion';

const SIZE = 20;

/** The gold heart splitting down the middle and the halves falling away, 0→1 over 600 ms (a 150 ms crack, then a 450 ms fall); 0 is hidden. */
function Break({ k }: { k: Animated.Value }) {
  const out = (v: number[]) => k.interpolate({ inputRange: [0, 0.001, 0.25, 1], outputRange: v });
  const half = (dir: 1 | -1) => ({
    opacity: out([0, 1, 1, 0]),
    transformOrigin: dir === 1 ? 'left bottom' : 'right bottom',
    transform: [
      { translateY: k.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0, 18] }) },
      { rotate: k.interpolate({ inputRange: [0, 0.25, 1], outputRange: ['0deg', `${22 * dir}deg`, `${22 * dir}deg`] }) },
    ],
  });
  return (
    <View style={styles.breakWrap} pointerEvents="none">
      <Animated.View style={[styles.half, { left: 0 }, half(-1)]}>
        <Ionicons name="heart" size={SIZE} color={GOLD} />
      </Animated.View>
      <Animated.View style={[styles.half, { left: SIZE / 2 }, half(1)]}>
        <Ionicons name="heart" size={SIZE} color={GOLD} style={{ marginLeft: -SIZE / 2 }} />
      </Animated.View>
    </View>
  );
}

/**
 * Hate Watch Plus: root for a team. It isn't tracked: whoever it plays has their alerts sent to you for that game only
 * (favorites.ts on the server). Only on Search and the team page, and only for teams in leagues of games and F1 constructors (whose drivers are gold in the race order).
 */
export function FavoriteButton({ target }: { target: Target }) {
  const t = useT();
  const { favorites, addFavorite, removeFavorite } = useStore();
  const { active } = usePlus();
  const on = favorites.has(target.key);
  // The heart pops when you turn it on, not when favorites finish loading (only a press arms it).
  const pressed = useRef(false);
  const { scale, pop } = usePop(1.35);
  const k = useRef(new Animated.Value(0)).current;
  useOnChange(on, (_, n) => {
    if (pressed.current && n) pop();
    else if (pressed.current && !reduceMotion()) {
      k.setValue(0);
      Animated.timing(k, { toValue: 1, duration: 600, easing: Easing.linear, useNativeDriver: true }).start(() => k.setValue(0));
    }
    pressed.current = false;
  });
  // Hidden until subscribed: a lapsed subscription has already cleared the favorites (lapsePlus).
  if (target.kind !== 'team' || target.league === 'ufc' || !active) return null;
  const press = () => {
    pressed.current = true;
    (on ? removeFavorite(target.key) : addFavorite(target)).catch(() => { pressed.current = false; Alert.alert(t('fav.updateFailedFav'), t('fav.tryAgain')); });
  };
  return (
    <Pressable onPress={press} hitSlop={8} style={[styles.icon, on && styles.on]} accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={t(on ? 'fav.remove' : 'fav.add', { name: target.name })}>
      <Animated.View style={{ width: SIZE, height: SIZE, transform: [{ scale }] }}>
        <Ionicons name={on ? 'heart' : 'heart-outline'} size={SIZE} color={on ? GOLD : colors.text} />
        <Break k={k} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: { padding: space(2), borderRadius: radius.pill, backgroundColor: colors.surface },
  on: { borderWidth: 1, borderColor: GOLD },
  breakWrap: { position: 'absolute', top: 0, left: 0, width: SIZE, height: SIZE },
  half: { position: 'absolute', top: 0, width: SIZE / 2, height: SIZE, overflow: 'hidden' },
});
