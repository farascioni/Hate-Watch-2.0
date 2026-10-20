import { useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useWave } from '../lib/motion';
import { space } from '../theme';

/**
 * One row of a card grid (webLayout's chunkSections): the cards side by side, the last row's gaps left empty so every
 * card is the same width. The cards carry their own side margin (space(3)), so each cell takes half of it back to
 * make the gap between two cards as wide as the edge. A row of one is the card as it was.
 * `wave` names the tab: its first rows rise in one after another when it first loads, once per launch (useWave).
 */
export function GridRow<T>({ row, cols, render, wave }: { row: T[]; cols: number; render: (item: T) => ReactNode; wave?: string }) {
  const tab = useRef(wave).current; // fixed at mount: a changing wrapper would remount every card in the row
  const rise = useWave(tab);
  const cells = cols <= 1 ? render(row[0]) : (
    <View style={styles.row}>
      {Array.from({ length: cols }, (_, i) => <View key={i} style={styles.cell}>{i < row.length ? render(row[i]) : null}</View>)}
    </View>
  );
  return tab ? <Animated.View style={rise}>{cells}</Animated.View> : <>{cells}</>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space(1.5) },
  cell: { flex: 1, minWidth: 0, marginHorizontal: -space(1.5) },
});
