import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SectionList, StyleSheet, TextInput, View, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { TargetRow, SectionHeader } from '../../components/ui';
import { FilterBar, byWeightClass, groupByWeightClass, kindOf, playersWord, useFilter } from '../../components/FilterBar';
import { colors, radius, space } from '../../theme';
import type { Player, Target, Team, WeightClass } from '../../lib/types';
import { leagueUi } from '../../lib/leagueUi';

export default function SearchScreen() {
  const { noteTrackers } = useStore();
  const [q, setQ] = useState('');
  // Teams or players, Teams first: no Everything here (FilterBar `everything`).
  const { filter, setFilter } = useFilter('team');
  const { kind, league } = filter;
  // The UFC: its fighters, a section per weight class (its champion and top five while nothing's typed).
  const classes = byWeightClass(filter), searchKind = kindOf(filter);
  const [weightClasses, setWeightClasses] = useState<WeightClass[]>([]);
  // F1's drivers: all of them while nothing's typed, each constructor's together.
  const allDrivers = league === 'f1' && kind === 'player';
  const [drivers, setDrivers] = useState<Player[]>([]);
  const [results, setResults] = useState<Target[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  /** The last search couldn't reach the server (offline, or it's down): say so instead of leaving old results up. */
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  // Browsing teams: A-Z, or grouped by league and division. The tab stays mounted, so the choice survives switching tabs.
  const [sortByDivision, setByDivision] = useState(false);
  // F1's constructors have no divisions: always A-Z, with no sort to pick (the choice stays for other leagues).
  const byDivision = sortByDivision && leagueUi(league).divisions; // F1's constructors have none (the server's leagueUi)
  const { leagueInfo } = useStore();
  const seq = useRef(0);

  // Debounced search; stale responses are discarded so results never flash out of order.
  useEffect(() => {
    if (!q.trim()) { setResults([]); setFailed(false); return; }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { results } = await api.search(q, league, searchKind === 'all' ? undefined : searchKind);
        if (mine === seq.current) { setResults(results); setFailed(false); noteTrackers(results); }
      } catch {
        if (mine === seq.current) { setResults([]); setFailed(true); }
      } finally { if (mine === seq.current) setLoading(false); }
    }, 150);
    return () => clearTimeout(t);
  }, [q, league, searchKind]);

  // Empty query: browse every team in the selected league (or every league), A-Z or by division.
  useEffect(() => {
    if (classes) return;
    let live = true;
    api.teams(league, byDivision).then((r) => { if (live) { setTeams(r.teams); noteTrackers(r.teams); } }).catch(() => {});
    return () => { live = false; };
  }, [league, byDivision, classes, noteTrackers]);
  useEffect(() => {
    if (!classes) return;
    let live = true;
    api.weightClasses().then((r) => { if (live) { setWeightClasses(r.classes); noteTrackers(r.classes.flatMap((c) => c.fighters)); } }).catch(() => {});
    return () => { live = false; };
  }, [classes, noteTrackers]);

  useEffect(() => {
    if (!allDrivers) return;
    let live = true;
    api.f1Drivers().then((r) => { if (live) { setDrivers(r.drivers); noteTrackers(r.drivers); } }).catch(() => {});
    return () => { live = false; };
  }, [allDrivers, noteTrackers]);

  const browsing = !q.trim();
  // What the bar shows, not the last pick: Athletes picked, then CFB (teams only), lists CFB's teams.
  const showTeams = browsing && searchKind !== 'player' && !classes;
  const name = (id: string) => leagueInfo(id)?.name ?? id.toUpperCase();
  // The search box says what it searches: "Search teams", "Search NBA players", "Search F1 drivers", "Search UFC fighters".
  const players = playersWord(league);
  // What this search finds: "players", "teams", "athletes or teams" (the box's placeholder, and the hint under it).
  const what = searchKind === 'player' ? players : searchKind === 'team' ? 'teams' : `${players} or teams`;
  const placeholder = `Search ${league ? `${name(league)} ` : ''}${what}`;
  // One section of results, or of teams A-Z; by division, a section each ("AL East"; "MLB · AL East" across every league).
  // The UFC's weight classes: a section each, for results too.
  const sections = useMemo(() => {
    if (!browsing) return !results.length ? [] : classes ? groupByWeightClass(results) : [{ title: '', data: results }];
    if (classes) return weightClasses.map((c) => ({ title: c.name, data: c.fighters as Target[] }));
    if (allDrivers) {
      const byTeam = new Map<string, Target[]>();
      for (const d of drivers) byTeam.set(d.teamName ?? 'F1', [...(byTeam.get(d.teamName ?? 'F1') ?? []), d]);
      return [...byTeam].map(([title, data]) => ({ title, data }));
    }
    if (!showTeams || !teams.length) return [];
    // A league without players (college football) has no roster to see: its page.
    const tap = league && !leagueUi(league).kinds.includes('player') ? 'tap one for its page' : 'tap one to see its roster';
    if (!byDivision || !teams.some((t) => t.division)) return [{ title: `${league ? `All ${name(league)} teams` : 'All teams'} — ${tap}`, data: teams as Target[] }];
    const groups = new Map<string, Target[]>();
    for (const t of teams) {
      const title = league ? (t.division ?? name(t.league)) : `${name(t.league)} · ${t.division ?? name(t.league)}`;
      groups.set(title, [...(groups.get(title) ?? []), t]);
    }
    return [...groups].map(([title, data]) => ({ title, data }));
  }, [browsing, showTeams, byDivision, teams, results, league, leagueInfo, classes, weightClasses, allDrivers, drivers]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.searchBox, focused && { borderColor: colors.hate }]}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {loading ? <ActivityIndicator size="small" color={colors.hate} /> : null}
      </View>
      <FilterBar filter={filter} onChange={setFilter} everything={false} />
      {showTeams && league !== 'f1' ? (
        <View style={styles.sortRow} accessibilityRole="tablist" accessibilityLabel="Sort teams">
          <Text style={styles.sortLabel}>Sort teams</Text>
          {([[false, 'A–Z'], [true, 'By division']] as const).map(([on, label]) => (
            <Pressable key={label} onPress={() => setByDivision(on)} hitSlop={6} style={[styles.sortBtn, sortByDivision === on && styles.sortOn]}
              accessibilityRole="tab" accessibilityState={{ selected: sortByDivision === on }} accessibilityLabel={on ? 'Sort teams by league and division' : 'Sort teams A to Z'}>
              <Text style={[styles.sortText, sortByDivision === on && styles.sortTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <SectionList<Target, { title: string }>
        sections={sections}
        keyExtractor={(t) => t.key}
        renderItem={({ item }) => <TargetRow target={item} />}
        renderSectionHeader={({ section }) => (section.title ? <SectionHeader>{section.title}{byDivision && showTeams ? ` · ${section.data.length}` : ''}</SectionHeader> : null)}
        ListHeaderComponent={classes && browsing && sections.length ? <Text style={styles.hint}>Each class's champion, then whoever has headlined and won the most lately. Type a name to find anyone else.</Text> : null}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={14}
        ListEmptyComponent={
          loading ? null
            : failed && !browsing ? <Text style={styles.none}>Couldn't search. Check your connection and try again.</Text>
            : browsing ? <Text style={styles.none}>Type a name to find {league ? `${name(league)} ` : ''}{what}.</Text>
            : <Text style={styles.none}>No {searchKind === 'all' ? `${players} or teams` : searchKind === 'player' ? players : 'teams'} match “{q}”.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space(2), margin: space(3), marginBottom: space(2), paddingHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  // The browser focus ring is replaced by the red searchBox border above (web only; no-op on native).
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: space(3), ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  none: { color: colors.textDim, textAlign: 'center', padding: space(8) },
  hint: { color: colors.textFaint, fontSize: 13, lineHeight: 18, paddingHorizontal: space(4), paddingBottom: space(1) },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(4), paddingBottom: space(2) },
  sortLabel: { color: colors.textFaint, fontSize: 12, fontWeight: '800', letterSpacing: 0.5, marginRight: space(1) },
  sortBtn: { paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sortOn: { backgroundColor: colors.surfaceHi, borderColor: colors.textFaint },
  sortText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  sortTextOn: { color: colors.text },
});
