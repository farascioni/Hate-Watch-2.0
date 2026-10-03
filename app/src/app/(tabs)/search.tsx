import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, TextInput, View, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Chip, TargetRow, SectionHeader } from '../../components/ui';
import { colors, leagueColors, radius, space } from '../../theme';
import type { League, Target, Team } from '../../lib/types';

type Kind = 'all' | 'player' | 'team';

export default function SearchScreen() {
  const { leagues } = useStore();
  const [q, setQ] = useState('');
  const [league, setLeague] = useState<League | undefined>();
  const [kind, setKind] = useState<Kind>('all');
  const [results, setResults] = useState<Target[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  // Debounced search; stale responses are discarded so results never flash out of order.
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { results } = await api.search(q, league, kind === 'all' ? undefined : kind);
        if (mine === seq.current) setResults(results);
      } finally { if (mine === seq.current) setLoading(false); }
    }, 150);
    return () => clearTimeout(t);
  }, [q, league, kind]);

  // Empty query: browse every team in the selected league.
  useEffect(() => { api.teams(league).then((r) => setTeams(r.teams)).catch(() => {}); }, [league]);

  const browsing = !q.trim();
  const data: Target[] = browsing ? (kind === 'player' ? [] : teams) : results;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search players or teams"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {loading ? <ActivityIndicator size="small" color={colors.hate} /> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flexGrow: 0 }}>
        <Chip label="All leagues" active={!league} onPress={() => setLeague(undefined)} />
        {leagues.map((l) => <Chip key={l.id} label={l.name} active={league === l.id} color={leagueColors[l.id]} onPress={() => setLeague(league === l.id ? undefined : l.id)} />)}
        <View style={styles.sep} />
        {(['all', 'player', 'team'] as Kind[]).map((k) => <Chip key={k} label={k === 'all' ? 'Everything' : k === 'player' ? 'Players' : 'Teams'} active={kind === k} onPress={() => setKind(k)} />)}
      </ScrollView>
      <FlatList
        data={data}
        keyExtractor={(t) => t.key}
        renderItem={({ item }) => <TargetRow target={item} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={14}
        ListHeaderComponent={browsing && data.length ? <SectionHeader>{league ? `All ${league.toUpperCase()} teams` : 'All teams'} — tap one to see its roster</SectionHeader> : null}
        ListEmptyComponent={!loading && !browsing ? <Text style={styles.none}>No players or teams match “{q}”.</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space(2), margin: space(3), marginBottom: space(2), paddingHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: space(3) },
  chips: { gap: space(2), paddingHorizontal: space(3), paddingBottom: space(2), alignItems: 'center' },
  sep: { width: 1, height: 20, backgroundColor: colors.border, marginHorizontal: space(1) },
  none: { color: colors.textDim, textAlign: 'center', padding: space(8) },
});
