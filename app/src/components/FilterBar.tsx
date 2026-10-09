import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip } from './ui';
import { useStore } from '../lib/store';
import { colors, leagueColors, radius, space } from '../theme';
import type { League } from '../lib/types';

export type Kind = 'all' | 'player' | 'team';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'team', label: 'Teams' },
  { id: 'player', label: 'Players' },
];

export interface Filter { kind: Kind; league?: League }

/** Filter state for a screen, starting on `kind` (Search: Teams). Tab screens stay mounted, so a filter survives switching tabs. */
export function useFilter(kind: Kind = 'all') {
  const [filter, setFilter] = useState<Filter>({ kind });
  const active = filter.kind !== 'all' || !!filter.league;
  return { filter, setFilter, active, reset: () => setFilter({ kind }) };
}

export function matchesFilter(f: Filter, target: { kind: string; league: string }) {
  return (f.kind === 'all' || target.kind === f.kind) && (!f.league || target.league === f.league);
}

/** What a league's players are called: F1's are drivers ("Search F1 drivers"). */
export const playersWord = (league?: string) => (league === 'f1' ? 'drivers' : 'players');

/** Human description of the active filter, e.g. "NBA players", "F1 drivers", for empty states. */
export function describeFilter(f: Filter, noun = 'players and teams') {
  const what = f.kind === 'player' ? playersWord(f.league) : f.kind === 'team' ? 'teams' : noun;
  return f.league ? `${f.league.toUpperCase()} ${what}` : what;
}

/**
 * Everything / Teams / Players, plus All and each league (NBA … EPL, WNBA). Two fixed rows rather than a
 * horizontal scroller, so every option is always visible (same on iOS, Android and web).
 */
export function FilterBar({ filter, onChange, kinds = true, everything = true }: {
  filter: Filter; onChange: (f: Filter) => void;
  /** false: league chips only (Scores tab) */ kinds?: boolean;
  /** false: Teams / Players only, no Everything (Search, where the two are separate lists) */ everything?: boolean;
}) {
  const { leagues } = useStore();
  return (
    <View>
      {kinds ? <View style={styles.segment} accessibilityRole="tablist">
        {KINDS.filter((k) => everything || k.id !== 'all').map(({ id, label }) => {
          const on = filter.kind === id;
          return (
            <Pressable key={id} onPress={() => onChange({ ...filter, kind: id })} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{id === 'player' && filter.league === 'f1' ? 'Drivers' : label}</Text>
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
  // Wraps to a second row if the server adds leagues past what fits (each chip stays whole).
  leagues: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5), paddingHorizontal: space(3), paddingBottom: space(2) },
  // Sized to their labels, then stretched to fill the row: eight chips fit an iPhone SE without squeezing "WNBA".
  leagueChip: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: space(1) },
});
