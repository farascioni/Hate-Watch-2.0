import { StyleSheet } from 'react-native';
import { useStore } from './store';
import { useMostHatedSet } from './mostHated';
import { GOLD, HATE_RED } from '../theme';

/**
 * Hate Watch Plus, F1: a favorite constructor's drivers are gold in the race order, the grid and the championship tables, and a most hated
 * constructor's red; both is red, as on every other surface. Fixed colours (the Plus gold accent only recolours the app's own red). A tracked driver keeps the usual tint.
 */
export type F1Tone = 'fav' | 'hate';

export function useF1Tone() {
  const { favorites } = useStore();
  const hated = useMostHatedSet();
  return (teamKey?: string | null): F1Tone | undefined => (!teamKey ? undefined : hated.has(teamKey) ? 'hate' : favorites.has(teamKey) ? 'fav' : undefined);
}

export const toneMark = { fav: '♥', hate: '❌' } as const;

/** Row style, name style and the mark's words for a screen reader. */
export const toneStyles = StyleSheet.create({
  fav: { borderLeftWidth: 3, borderLeftColor: GOLD, backgroundColor: GOLD + '33' },
  hate: { borderLeftWidth: 3, borderLeftColor: HATE_RED, backgroundColor: HATE_RED + '33' },
  favName: { color: '#FFD866', fontWeight: '800' },
  hateName: { color: '#FF8A8F', fontWeight: '800' },
  mark: { fontSize: 12 },
});
export const toneRow = (t?: F1Tone) => (t ? toneStyles[t] : undefined);
export const toneName = (t?: F1Tone) => (t === 'fav' ? toneStyles.favName : t === 'hate' ? toneStyles.hateName : undefined);
