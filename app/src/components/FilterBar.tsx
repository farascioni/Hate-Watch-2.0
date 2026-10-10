import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip } from './ui';
import { useStore } from '../lib/store';
import { colors, leagueColors, radius, space } from '../theme';
import type { League, Target } from '../lib/types';

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

/**
 * The UFC has no teams: its one option is Fighters, grouped by weight class where a screen lists people (Search,
 * Tracking); the Feed and the Leaderboard show them all. The kind picked for other leagues is kept for leaving it.
 */
export const byWeightClass = (f: Filter) => f.league === 'ufc';
/** College football has no players (the server's `teamsOnly`): its one option is Teams. */
export const teamsOnly = (f: Filter) => f.league === 'cfb';
/** What a filter shows: teams, players or both (the UFC: its fighters; college football: its teams). */
export const kindOf = (f: Filter): Kind => (byWeightClass(f) ? 'player' : teamsOnly(f) ? 'team' : f.kind);

export function matchesFilter(f: Filter, target: { kind: string; league: string }) {
  const kind = kindOf(f);
  return (kind === 'all' || target.kind === kind) && (!f.league || target.league === f.league);
}

/** The UFC's weight classes, heaviest first, men's then women's (the server's order, ufc-classes.ts). */
const WEIGHT_CLASSES = [
  'Heavyweight', 'Light Heavyweight', 'Middleweight', 'Welterweight', 'Lightweight', 'Featherweight', 'Bantamweight', 'Flyweight',
  "Women's Featherweight", "Women's Bantamweight", "Women's Flyweight", "Women's Strawweight",
];
/** Fighters in a section per weight class, in the UFC's order; anyone without one (only catch weight bouts) last. */
export function groupByWeightClass(targets: Target[]): { title: string; data: Target[] }[] {
  const groups = new Map<string, Target[]>();
  for (const t of targets) { const w = (t.kind === 'player' && t.position) || 'Other'; groups.set(w, [...(groups.get(w) ?? []), t]); }
  const order = (w: string) => { const i = WEIGHT_CLASSES.indexOf(w); return w === 'Other' ? WEIGHT_CLASSES.length + 1 : i < 0 ? WEIGHT_CLASSES.length : i; };
  return [...groups].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b)).map(([title, data]) => ({ title, data }));
}

/**
 * What a league's players are called: F1's are drivers, the UFC's fighters ("Search UFC fighters"); every
 * league's at once (All), athletes.
 */
export const playersWord = (league?: string) => (!league ? 'athletes' : league === 'f1' ? 'drivers' : league === 'ufc' ? 'fighters' : 'players');
/** The same as a heading or label: "Athletes", "Players", "Drivers", "Fighters". */
export const playersTitle = (league?: string) => { const w = playersWord(league); return w[0].toUpperCase() + w.slice(1); };

/** Human description of the active filter, e.g. "NBA players", "F1 drivers", "athletes and teams", for empty states. */
export function describeFilter(f: Filter) {
  const players = playersWord(f.league), kind = kindOf(f);
  const what = kind === 'team' ? 'teams' : kind === 'player' ? players : `${players} and teams`;
  return f.league ? `${f.league.toUpperCase()} ${what}` : what;
}

/**
 * Everything / Teams / Players (the UFC: Fighters alone), plus All and each league (NBA … WNBA, UFC). Two fixed rows rather than a
 * horizontal scroller, so every option is always visible (same on iOS, Android and web).
 */
export function FilterBar({ filter, onChange, kinds = true, everything = true }: {
  filter: Filter; onChange: (f: Filter) => void;
  /** false: league chips only (Scores tab) */ kinds?: boolean;
  /** false: Teams / Players only, no Everything (Search, where the two are separate lists) */ everything?: boolean;
}) {
  const { leagues } = useStore();
  const ufc = byWeightClass(filter), fixed = ufc || teamsOnly(filter);
  const options = ufc ? KINDS.filter((k) => k.id === 'player') : teamsOnly(filter) ? KINDS.filter((k) => k.id === 'team') : KINDS.filter((k) => everything || k.id !== 'all');
  return (
    <View>
      {kinds ? <View style={styles.segment} accessibilityRole="tablist">
        {options.map(({ id, label }) => {
          const on = kindOf(filter) === id;
          return (
            <Pressable key={id} onPress={fixed ? undefined : () => onChange({ ...filter, kind: id })} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{id === 'player' ? playersTitle(filter.league) : label}</Text>
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
  leagues: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1), paddingHorizontal: space(3), paddingBottom: space(2) },
  // Sized to their labels, then stretched to fill the row: nine chips (All to UFC) fit an iPhone SE without squeezing "WNBA".
  leagueChip: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: 1 },
});
