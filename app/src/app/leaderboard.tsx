import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Avatar } from '../components/Avatar';
import { Empty, LeagueTag, PrimaryButton, subtitle } from '../components/ui';
import { FilterBar, describeFilter, kindOf, useFilter } from '../components/FilterBar';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { colors, radius, space } from '../theme';
import type { Leaderboard, LeaderboardEntry } from '../lib/types';

/**
 * The most hated players and teams: how many people track each one. The same filter as the Feed and
 * Tracking tabs; "All" is every sport, so Teams + All is every team in every league. The top 100 of each
 * filter, ranked by the server within that filter. Opened from the button at the top left of every tab.
 */
export default function LeaderboardScreen() {
  const { follows } = useStore();
  const { filter, setFilter, active, reset } = useFilter();
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const entries = board?.entries ?? null;
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Only the latest request may land: tap MLB then NBA quickly and a slow MLB reply mustn't fill the NBA board.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const kind = kindOf(filter);
      const r = await api.leaderboard({ kind: kind === 'all' ? undefined : kind, league: filter.league });
      if (mine !== latest.current) return;
      setBoard(r);
      setFailed(false);
    } catch { if (mine === latest.current) setFailed(true); }
  }, [filter]);
  // On open, on each filter change, and on coming back (follows change, here and everywhere).
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const change = (f: typeof filter) => { setBoard(null); setFilter(f); };
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.filters}><FilterBar filter={filter} onChange={change} /></View>
      {entries == null && !failed ? <ActivityIndicator color={colors.hate} style={{ marginTop: space(10) }} /> : (
        <FlatList
          data={entries ?? []}
          keyExtractor={(e) => e.target.key}
          renderItem={({ item }) => <Row entry={item} tied={item.tied ?? (entries ?? []).some((e) => e !== item && e.rank === item.rank)} mine={follows.has(item.target.key)} />}
          ListHeaderComponent={entries?.length ? <Text style={styles.hint}>Ranked by how many people track them on Hate Watch.</Text> : null}
          ListFooterComponent={board ? <Cut board={board} /> : null}
          ListEmptyComponent={failed
            ? <Empty emoji="📡" title="Couldn't load the leaderboard" body="Check your connection and try again." action={<PrimaryButton label="Try again" onPress={() => { setFailed(false); setBoard(null); void load(); }} />} />
            : <Empty emoji="🏆" title={`Nobody hates any ${describeFilter(filter)} yet`} body="Track someone and they'll show up here."
                action={active ? <PrimaryButton label="Show everything" onPress={() => change({ kind: 'all' })} /> : <PrimaryButton label="Find someone to hate" onPress={() => router.navigate('/search')} />} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.hate} />}
          contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }}
        />
      )}
    </View>
  );
}

/** Under a list that's been cut at 100: how many there are in all, and anyone tied with #100 who didn't fit. */
function Cut({ board: { entries, total, moreTied } }: { board: Leaderboard }) {
  if (total == null || total <= entries.length) return null;
  const last = entries.at(-1)!;
  return (
    <Text style={styles.cut}>
      Showing the top {entries.length} of {total.toLocaleString()}.
      {moreTied ? ` ${moreTied.toLocaleString()} more ${moreTied === 1 ? 'is' : 'are'} also tied for ${last.rank}${ordinalSuffix(last.rank)} with ${last.haters.toLocaleString()} ${last.haters === 1 ? 'hater' : 'haters'}.` : ''}
    </Text>
  );
}
const ordinalSuffix = (n: number) => { const v = n % 100; return v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'; };

const MEDALS = ['🥇', '🥈', '🥉'];

/** The rank within the current filter: 🥇🥈🥉 for the top three, a number after that; a tie reads "T-2" (under the medal in the top three). */
function Row({ entry: { rank, haters, target }, tied, mine }: { entry: LeaderboardEntry; tied: boolean; mine: boolean }) {
  const place = tied ? `T-${rank}` : String(rank);
  return (
    <Pressable onPress={() => router.push(`/target/${encodeURIComponent(target.key)}`)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHi }]}
      accessibilityRole="button" accessibilityLabel={`${tied ? `Tied for ${rank}` : `Number ${rank}`}, ${target.name}, ${haters} ${haters === 1 ? 'hater' : 'haters'}${mine ? ', you track them' : ''}`}>
      <View style={styles.rank}>
        {MEDALS[rank - 1] ? <Text style={styles.medal}>{MEDALS[rank - 1]}</Text> : <Text style={styles.rankText} numberOfLines={1}>{place}</Text>}
        {MEDALS[rank - 1] && tied ? <Text style={styles.tie}>{place}</Text> : null}
      </View>
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
  cut: { color: colors.textFaint, fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: space(6), paddingTop: space(4) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3) },
  rank: { width: 40, alignItems: 'center' },
  rankText: { color: colors.textDim, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tie: { color: colors.textFaint, fontSize: 10, fontWeight: '800', marginTop: -2 },
  medal: { fontSize: 22 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  name: { color: colors.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  tracking: { color: colors.hate, fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: colors.hate, borderRadius: radius.sm, paddingHorizontal: 5, overflow: 'hidden', flexShrink: 0 },
  sub: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  count: { alignItems: 'flex-end', minWidth: 48 },
  countN: { color: colors.hate, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  countLabel: { color: colors.textFaint, fontSize: 11, fontWeight: '700' },
});
