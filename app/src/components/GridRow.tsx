import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '../theme';

/**
 * One row of a card grid (webLayout's chunkSections): the cards side by side, the last row's gaps left empty so every
 * card is the same width. The cards carry their own side margin (space(3)), so each cell takes half of it back to
 * make the gap between two cards as wide as the edge. A row of one is the card as it was.
 */
export function GridRow<T>({ row, cols, render }: { row: T[]; cols: number; render: (item: T) => ReactNode }) {
  if (cols <= 1) return <>{render(row[0])}</>;
  return (
    <View style={styles.row}>
      {Array.from({ length: cols }, (_, i) => <View key={i} style={styles.cell}>{i < row.length ? render(row[i]) : null}</View>)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space(1.5) },
  cell: { flex: 1, minWidth: 0, marginHorizontal: -space(1.5) },
});
