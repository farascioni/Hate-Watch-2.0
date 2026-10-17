import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Hate Watch Plus: a subscriber can swap the red accent for gold. Styles are built once at load
 * (StyleSheet.create all over the app), so the choice is read here, synchronously, at launch and
 * changing it reloads the app (components/Plus.tsx). SecureStore's getItem is synchronous; on web it doesn't exist.
 */
const GOLD_KEY = 'hw.goldAccent';
export const gold = (() => {
  if (Platform.OS === 'web') return false;
  try { return SecureStore.getItem(GOLD_KEY) === '1'; } catch { return false; }
})();
/** Gold, as the accent when switched on and as the most-hated star and border. */
export const GOLD = '#E0A800';
export const setGold = (on: boolean) => (on ? SecureStore.setItemAsync(GOLD_KEY, '1') : SecureStore.deleteItemAsync(GOLD_KEY));

export const colors = {
  bg: '#0B0B0D',
  surface: '#16161A',
  surfaceHi: '#1F1F25',
  border: '#2A2A31',
  text: '#F4F4F5',
  textDim: '#A1A1AA',
  textFaint: '#71717A',
  hate: gold ? GOLD : '#E5232B',       // brand red (gold when a Plus subscriber switches it on)
  hateDim: gold ? '#5A4410' : '#5A1014',
  hateText: gold ? '#FFD866' : '#FF8A8F',  // light tint of it: text on hateDim
  hateTint: gold ? '#1F1808' : '#1F1012',  // the faintest wash of it behind a tile
  onHate: gold ? '#1A1200' : '#fff',        // text or spinner on a hate-coloured fill (white on gold fails contrast)
  live: '#22C55E',
  warn: '#F59E0B',
};

export const leagueColors: Record<string, string> = {
  nba: '#C9082A',
  wnba: '#E8590C', // WNBA orange
  mlb: '#1D6FD8',
  nfl: '#2E7D32',
  nhl: '#9CA3AF',
  f1: '#E10600',
  epl: '#7B2FBE', // Premier League purple, lifted to read on the dark background
  cfb: '#B45309', // college football: leather brown
};

export const space = (n: number) => n * 4;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
