import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChipRows } from './ui';
import { LeagueSheet } from './LeagueSheet';
import { useStore } from '../lib/store';
import { colors, radius, space } from '../theme';
import { leagueColor, leagueUi } from '../lib/leagueUi';
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
 * What a league's filter offers is the server's (leagueUi `kinds`): the UFC has no teams (Fighters alone, grouped
 * by weight class where a screen lists people: Search, Tracking), college football no players (Teams alone). The
 * kind picked for other leagues is kept for leaving it.
 */
export const byWeightClass = (f: Filter) => !!f.league && leagueUi(f.league).groupPlayers === 'weightClass';
/** A league with one kind (UFC fighters, college football teams): that kind, else none. */
export const onlyKind = (f: Filter): Kind | undefined => { const k = f.league ? leagueUi(f.league).kinds : []; return k.length === 1 ? k[0] : undefined; };
/** What a filter shows: teams, players or both (a league with one kind: that one). */
export const kindOf = (f: Filter): Kind => onlyKind(f) ?? f.kind;

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
export const playersWord = (league?: string) => (!league ? 'athletes' : leagueUi(league).players);
/** The same as a heading or label: "Athletes", "Players", "Drivers", "Fighters". */
export const playersTitle = (league?: string) => { const w = playersWord(league); return w[0].toUpperCase() + w.slice(1); };

/** Human description of the active filter, e.g. "NBA players", "F1 drivers", "athletes and teams", for empty states. */
export function describeFilter(f: Filter) {
  const players = playersWord(f.league), kind = kindOf(f);
  const what = kind === 'team' ? 'teams' : kind === 'player' ? players : `${players} and teams`;
  return f.league ? `${f.league.toUpperCase()} ${what}` : what;
}

/** With nothing tracked yet, the leagues on the filter's row: the first few in the server's order (NBA, MLB, NFL, NHL). */
const FIRST_LEAGUES = 4;

/**
 * Everything / Teams / Players (the UFC: Fighters alone), then the leagues: All, the leagues you track (the first
 * few, until you track someone), one picked from More if it isn't one of those, and More, which opens every league
 * by sport (LeagueSheet). So the row stays short however many leagues there are; it wraps, All on top, only when
 * you track more than fit (ChipRows). No More when the row already has every league.
 */
export function FilterBar({ filter, onChange, kinds = true, everything = true }: {
  filter: Filter; onChange: (f: Filter) => void;
  /** false: league chips only (Scores tab) */ kinds?: boolean;
  /** false: Teams / Players only, no Everything (Search, where the two are separate lists) */ everything?: boolean;
}) {
  const { leagues, follows } = useStore();
  const [sheet, setSheet] = useState(false);
  const yours = useMemo(() => {
    const tracked = new Set([...follows.values()].map((t) => t.league));
    return leagues.filter((l) => tracked.has(l.id)).map((l) => l.id);
  }, [leagues, follows]);
  const shown = yours.length ? yours : leagues.slice(0, FIRST_LEAGUES).map((l) => l.id);
  const row = filter.league && !shown.includes(filter.league) ? [...shown, filter.league] : shown;
  const more = leagues.some((l) => !row.includes(l.id));
  const name = (id: League) => leagues.find((l) => l.id === id)?.name ?? id.toUpperCase();
  const pick = (league: League | undefined) => onChange({ ...filter, league });
  const only = onlyKind(filter);
  const options = only ? KINDS.filter((k) => k.id === only) : KINDS.filter((k) => everything || k.id !== 'all');
  return (
    <View>
      {kinds ? <View style={styles.segment} accessibilityRole="tablist">
        {options.map(({ id, label }) => {
          const on = kindOf(filter) === id;
          return (
            <Pressable key={id} onPress={only ? undefined : () => onChange({ ...filter, kind: id })} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{id === 'player' ? playersTitle(filter.league) : label}</Text>
            </Pressable>
          );
        })}
      </View> : null}
      <ChipRows style={styles.leagues} gap={space(1)} chipStyle={styles.leagueChip} items={[
        { key: 'all', label: 'All', active: !filter.league, onPress: () => pick(undefined) },
        ...row.map((id) => ({ key: id, label: name(id), active: filter.league === id, color: leagueColor(id), onPress: () => pick(filter.league === id ? undefined : id) })),
        ...(more ? [{ key: 'more', label: 'More', onPress: () => setSheet(true), accessibilityLabel: 'More leagues' }] : []),
      ]} />
      <LeagueSheet open={sheet} onClose={() => setSheet(false)} leagues={leagues} yours={yours} picked={filter.league} onPick={pick} />
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', marginHorizontal: space(3), marginBottom: space(2), padding: 3, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space(2), borderRadius: radius.sm },
  segOn: { backgroundColor: colors.surfaceHi },
  segText: { color: colors.textDim, fontWeight: '700', fontSize: 14 },
  segTextOn: { color: colors.text },
  // One row while the chips fit (All, yours, More); past that, All across the top and the rest below (ChipRows).
  leagues: { paddingHorizontal: space(3), paddingBottom: space(2) },
  leagueChip: { paddingHorizontal: 1 },
});
