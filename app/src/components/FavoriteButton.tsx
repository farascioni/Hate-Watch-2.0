import { useRef } from 'react';
import { Alert, Animated, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../lib/store';
import { usePlus } from '../lib/plus';
import { GOLD, colors, radius, space } from '../theme';
import type { Target } from '../lib/types';
import { useT } from '../lib/i18n';
import { useOnChange, usePop } from '../lib/motion';

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
  useOnChange(on, (_, n) => { if (pressed.current && n) pop(); pressed.current = false; });
  // Hidden until subscribed: a lapsed subscription has already cleared the favorites (lapsePlus).
  if (target.kind !== 'team' || target.league === 'ufc' || !active) return null;
  const press = () => {
    pressed.current = true;
    (on ? removeFavorite(target.key) : addFavorite(target)).catch(() => { pressed.current = false; Alert.alert(t('fav.updateFailedFav'), t('fav.tryAgain')); });
  };
  return (
    <Pressable onPress={press} hitSlop={8} style={[styles.icon, on && styles.on]} accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={t(on ? 'fav.remove' : 'fav.add', { name: target.name })}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={on ? 'heart' : 'heart-outline'} size={20} color={on ? GOLD : colors.text} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: { padding: space(2), borderRadius: radius.pill, backgroundColor: colors.surface },
  on: { borderWidth: 1, borderColor: GOLD },
});
