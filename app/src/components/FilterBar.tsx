import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip } from './ui';
import { useStore } from '../lib/store';
import { colors, leagueColors, radius, space } from '../theme';
import type { League } from '../lib/types';

export type Kind = 'all' | 'player' | 'team';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'player', label: 'Players' },
  { id: 'team', label: 'Teams' },
];

export interface Filter { kind: Kind; league?: League }

/** Filter state for a screen. Tab screens stay mounted, so a filter survives switching tabs. */
export function useFilter() {
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const active = filter.kind !== 'all' || !!filter.league;
  return { filter, setFilter, active, reset: () => setFilter({ kind: 'all' }) };
}

export function matchesFilter(f: Filter, target: { kind: string; league: string }) {
  return (f.kind === 'all' || target.kind === f.kind) && (!f.league || target.league === f.league);
}

/** Human description of the active filter, e.g. "NBA players", for empty states. */
export function describeFilter(f: Filter, noun = 'players and teams') {
  const what = f.kind === 'player' ? 'players' : f.kind === 'team' ? 'teams' : noun;
  return f.league ? `${f.league.toUpperCase()} ${what}` : what;
}

/**
 * Everything / Players / Teams, plus All / NBA / MLB / NFL / NHL. Two fixed rows rather than a
 * horizontal scroller, so every option is always visible (same on iOS, Android and web).
 */
export function FilterBar({ filter, onChange, kinds = true }: { filter: Filter; onChange: (f: Filter) => void; /** false: league chips only (Scores tab) */ kinds?: boolean }) {
  const { leagues } = useStore();
  return (
    <View>
      {kinds ? <View style={styles.segment} accessibilityRole="tablist">
        {KINDS.map(({ id, label }) => {
          const on = filter.kind === id;
          return (
            <Pressable key={id} onPress={() => onChange({ ...filter, kind: id })} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{label}</Text>
            </Pressable>
          );
        })}
      </View> : null}
      <View style={styles.leagues}>
        <Chip label="All" active={!filter.league} onPress={() => onChange({ ...filter, league: undefined })} style={styles.leagueChip} />
        {leagues.map((l) => (
          <Chip
            key={l.id}
            label={l.name}
            active={filter.league === l.id}
            color={leagueColors[l.id]}
            onPress={() => onChange({ ...filter, league: filter.league === l.id ? undefined : l.id })}
            style={styles.leagueChip}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', marginHorizontal: space(3), marginBottom: space(2), padding: 3, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space(2), borderRadius: radius.sm },
  segOn: { backgroundColor: colors.surfaceHi },
  segText: { color: colors.textDim, fontWeight: '700', fontSize: 14 },
  segTextOn: { color: colors.text },
  leagues: { flexDirection: 'row', gap: space(2), paddingHorizontal: space(3), paddingBottom: space(2) },
  // Sized to their labels, then stretched to fill the row: seven chips fit an iPhone SE without squeezing "WNBA".
  leagueChip: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: space(1.5) },
});
