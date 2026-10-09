import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SectionList, StyleSheet, TextInput, View, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { TargetRow, SectionHeader } from '../../components/ui';
import { FilterBar, playersWord, useFilter } from '../../components/FilterBar';
import { colors, radius, space } from '../../theme';
import type { Target, Team } from '../../lib/types';

export default function SearchScreen() {
  const { noteTrackers } = useStore();
  const [q, setQ] = useState('');
  // Teams or players, Teams first: no Everything here (FilterBar `everything`).
  const { filter, setFilter } = useFilter('team');
  const { kind, league } = filter;
  const [results, setResults] = useState<Target[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  /** The last search couldn't reach the server (offline, or it's down): say so instead of leaving old results up. */
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  // Browsing teams: A-Z, or grouped by league and division. The tab stays mounted, so the choice survives switching tabs.
  const [byDivision, setByDivision] = useState(false);
  const { leagueInfo } = useStore();
  const seq = useRef(0);

  // Debounced search; stale responses are discarded so results never flash out of order.
  useEffect(() => {
    if (!q.trim()) { setResults([]); setFailed(false); return; }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { results } = await api.search(q, league, kind === 'all' ? undefined : kind);
        if (mine === seq.current) { setResults(results); setFailed(false); noteTrackers(results); }
      } catch {
        if (mine === seq.current) { setResults([]); setFailed(true); }
      } finally { if (mine === seq.current) setLoading(false); }
    }, 150);
    return () => clearTimeout(t);
  }, [q, league, kind]);

  // Empty query: browse every team in the selected league (or every league), A-Z or by division.
  useEffect(() => {
    let live = true;
    api.teams(league, byDivision).then((r) => { if (live) { setTeams(r.teams); noteTrackers(r.teams); } }).catch(() => {});
    return () => { live = false; };
  }, [league, byDivision, noteTrackers]);

  const browsing = !q.trim();
  const showTeams = browsing && kind !== 'player';
  const name = (id: string) => leagueInfo(id)?.name ?? id.toUpperCase();
  // The search box says what it searches: "Search teams", "Search NBA players", "Search F1 drivers".
  const players = playersWord(league);
  const placeholder = `Search ${league ? `${name(league)} ` : ''}${kind === 'player' ? players : kind === 'team' ? 'teams' : `${players} or teams`}`;
  // One section of results, or of teams A-Z; by division, a section each ("AL East"; "MLB · AL East" across every league).
  const sections = useMemo(() => {
    if (!browsing) return results.length ? [{ title: '', data: results }] : [];
    if (!showTeams || !teams.length) return [];
    if (!byDivision || !teams.some((t) => t.division)) return [{ title: `${league ? `All ${name(league)} teams` : 'All teams'} — tap one to see its roster`, data: teams as Target[] }];
    const groups = new Map<string, Target[]>();
    for (const t of teams) {
      const title = league ? (t.division ?? name(t.league)) : `${name(t.league)} · ${t.division ?? name(t.league)}`;
      groups.set(title, [...(groups.get(title) ?? []), t]);
    }
    return [...groups].map(([title, data]) => ({ title, data }));
  }, [browsing, showTeams, byDivision, teams, results, league, leagueInfo]);

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
      {showTeams ? (
        <View style={styles.sortRow} accessibilityRole="tablist" accessibilityLabel="Sort teams">
          <Text style={styles.sortLabel}>Sort teams</Text>
          {([[false, 'A–Z'], [true, 'By division']] as const).map(([on, label]) => (
            <Pressable key={label} onPress={() => setByDivision(on)} hitSlop={6} style={[styles.sortBtn, byDivision === on && styles.sortOn]}
              accessibilityRole="tab" accessibilityState={{ selected: byDivision === on }} accessibilityLabel={on ? 'Sort teams by league and division' : 'Sort teams A to Z'}>
              <Text style={[styles.sortText, byDivision === on && styles.sortTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <SectionList<Target, { title: string }>
        sections={sections}
        keyExtractor={(t) => t.key}
        renderItem={({ item }) => <TargetRow target={item} />}
        renderSectionHeader={({ section }) => (section.title ? <SectionHeader>{section.title}{byDivision && browsing ? ` · ${section.data.length}` : ''}</SectionHeader> : null)}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={14}
        ListEmptyComponent={
          loading ? null
            : failed && !browsing ? <Text style={styles.none}>Couldn't search. Check your connection and try again.</Text>
            : browsing ? <Text style={styles.none}>Type a name to find {league ? `${league.toUpperCase()} ` : ''}{players}.</Text>
            : <Text style={styles.none}>No {kind === 'all' ? `${players} or teams` : kind === 'player' ? players : 'teams'} match “{q}”.</Text>
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
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(4), paddingBottom: space(2) },
  sortLabel: { color: colors.textFaint, fontSize: 12, fontWeight: '800', letterSpacing: 0.5, marginRight: space(1) },
  sortBtn: { paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sortOn: { backgroundColor: colors.surfaceHi, borderColor: colors.textFaint },
  sortText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  sortTextOn: { color: colors.text },
});
