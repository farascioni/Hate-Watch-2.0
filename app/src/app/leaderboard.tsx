import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Avatar } from '../components/Avatar';
import { Empty, LeagueTag, PrimaryButton, subtitle } from '../components/ui';
import { FilterBar, describeFilter, useFilter } from '../components/FilterBar';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { colors, radius, space } from '../theme';
import type { LeaderboardEntry } from '../lib/types';

/**
 * The most hated players and teams: how many people track each one. The same filter as the Feed and
 * Tracking tabs; "All" is every sport, so Teams + All is every team in every league. Opened from the
 * button at the top left of every tab.
 */
export default function LeaderboardScreen() {
  const { follows } = useStore();
  const { filter, setFilter, active, reset } = useFilter();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.leaderboard({ kind: filter.kind === 'all' ? undefined : filter.kind, league: filter.league });
      setEntries(r.entries);
      setFailed(false);
    } catch { setFailed(true); }
  }, [filter]);
  // On open, on each filter change, and on coming back (follows change, here and everywhere).
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const change = (f: typeof filter) => { setEntries(null); setFilter(f); };
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.filters}><FilterBar filter={filter} onChange={change} /></View>
      {entries == null && !failed ? <ActivityIndicator color={colors.hate} style={{ marginTop: space(10) }} /> : (
        <FlatList
          data={entries ?? []}
          keyExtractor={(e) => e.target.key}
          renderItem={({ item }) => <Row entry={item} mine={follows.has(item.target.key)} />}
          ListHeaderComponent={entries?.length ? <Text style={styles.hint}>Ranked by how many people track them on Hate Watch.</Text> : null}
          ListEmptyComponent={failed
            ? <Empty emoji="📡" title="Couldn't load the leaderboard" body="Check your connection and try again." action={<PrimaryButton label="Try again" onPress={() => { setFailed(false); setEntries(null); void load(); }} />} />
            : <Empty emoji="🏆" title={`Nobody hates any ${describeFilter(filter)} yet`} body="Track someone and they'll show up here."
                action={active ? <PrimaryButton label="Show everything" onPress={() => change({ kind: 'all' })} /> : <PrimaryButton label="Find someone to hate" onPress={() => router.navigate('/search')} />} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.hate} />}
          contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }}
        />
      )}
    </View>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

function Row({ entry: { rank, haters, target }, mine }: { entry: LeaderboardEntry; mine: boolean }) {
  return (
    <Pressable onPress={() => router.push(`/target/${encodeURIComponent(target.key)}`)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHi }]}
      accessibilityRole="button" accessibilityLabel={`Number ${rank}, ${target.name}, ${haters} ${haters === 1 ? 'hater' : 'haters'}${mine ? ', you track them' : ''}`}>
      <View style={styles.rank}>{MEDALS[rank - 1] ? <Text style={styles.medal}>{MEDALS[rank - 1]}</Text> : <Text style={styles.rankText}>{rank}</Text>}</View>
      <Avatar target={target} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={styles.inline}>
          <Text style={styles.name} numberOfLines={1}>{target.name}</Text>
          {mine ? <Text style={styles.tracking}>Tracking</Text> : null}
        </View>
        <View style={styles.inline}>
          <LeagueTag league={target.league} />
          <Text style={styles.sub} numberOfLines={1}>{subtitle(target)}</Text>
        </View>
      </View>
      <View style={styles.count}>
        <Text style={styles.countN}>{haters.toLocaleString()}</Text>
        <Text style={styles.countLabel}>{haters === 1 ? 'hater' : 'haters'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: { paddingTop: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  hint: { color: colors.textFaint, fontSize: 13, paddingHorizontal: space(4), paddingTop: space(3), paddingBottom: space(1) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3) },
  rank: { width: 28, alignItems: 'center' },
  rankText: { color: colors.textDim, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  medal: { fontSize: 22 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  name: { color: colors.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  tracking: { color: colors.hate, fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: colors.hate, borderRadius: radius.sm, paddingHorizontal: 5, overflow: 'hidden', flexShrink: 0 },
  sub: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  count: { alignItems: 'flex-end', minWidth: 48 },
  countN: { color: colors.hate, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  countLabel: { color: colors.textFaint, fontSize: 11, fontWeight: '700' },
});
