import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet, TextInput, View, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { TargetRow, SectionHeader } from '../../components/ui';
import { FilterBar, useFilter } from '../../components/FilterBar';
import { colors, radius, space } from '../../theme';
import type { Target, Team } from '../../lib/types';

export default function SearchScreen() {
  const { noteTrackers } = useStore();
  const [q, setQ] = useState('');
  const { filter, setFilter } = useFilter();
  const { kind, league } = filter;
  const [results, setResults] = useState<Target[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const seq = useRef(0);

  // Debounced search; stale responses are discarded so results never flash out of order.
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { results } = await api.search(q, league, kind === 'all' ? undefined : kind);
        if (mine === seq.current) { setResults(results); noteTrackers(results); }
      } finally { if (mine === seq.current) setLoading(false); }
    }, 150);
    return () => clearTimeout(t);
  }, [q, league, kind]);

  // Empty query: browse every team in the selected league.
  useEffect(() => { api.teams(league).then((r) => { setTeams(r.teams); noteTrackers(r.teams); }).catch(() => {}); }, [league, noteTrackers]);

  const browsing = !q.trim();
  const data: Target[] = browsing ? (kind === 'player' ? [] : teams) : results;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.searchBox, focused && { borderColor: colors.hate }]}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search players or teams"
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
      <FilterBar filter={filter} onChange={setFilter} />
      <FlatList
        data={data}
        keyExtractor={(t) => t.key}
        renderItem={({ item }) => <TargetRow target={item} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={14}
        ListHeaderComponent={browsing && data.length ? <SectionHeader>{league ? `All ${league.toUpperCase()} teams` : 'All teams'} — tap one to see its roster</SectionHeader> : null}
        ListEmptyComponent={
          loading ? null
            : browsing ? <Text style={styles.none}>Type a name to find {league ? `${league.toUpperCase()} ` : ''}players.</Text>
            : <Text style={styles.none}>No {kind === 'all' ? 'players or teams' : `${kind}s`} match “{q}”.</Text>
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
});
