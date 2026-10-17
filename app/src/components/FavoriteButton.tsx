import { Alert, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from '../lib/store';
import { usePlus } from '../lib/plus';
import { GOLD, colors, radius, space } from '../theme';
import type { Target } from '../lib/types';

/**
 * Hate Watch Plus: root for a team. It isn't tracked: whoever it plays has their alerts sent to you for that game only
 * (favorites.ts on the server). Only on Search and the team page, and only for teams in leagues of games.
 */
export function FavoriteButton({ target }: { target: Target }) {
  const { favorites, addFavorite, removeFavorite } = useStore();
  const { active } = usePlus();
  const on = favorites.has(target.key);
  // Hidden without Plus; a lapsed subscriber who still has this favorite keeps the heart to remove it.
  if (target.kind !== 'team' || target.league === 'f1' || target.league === 'ufc' || (!active && !on)) return null;
  const press = () => (on ? removeFavorite(target.key) : addFavorite(target)).catch(() => Alert.alert("Couldn't update favorites", 'Please try again.'));
  return (
    <Pressable onPress={press} hitSlop={8} style={[styles.icon, on && styles.on]} accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={on ? `Remove ${target.name} from your favorites` : `Add ${target.name} to your favorites`}>
      <Ionicons name={on ? 'heart' : 'heart-outline'} size={20} color={on ? GOLD : colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: { padding: space(2), borderRadius: radius.pill, backgroundColor: colors.surface },
  on: { borderWidth: 1, borderColor: GOLD },
});
