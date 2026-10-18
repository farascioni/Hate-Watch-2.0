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
import { currentLocale, useT } from '../lib/i18n';

/**
 * The most hated athletes and teams: how many people track each one. The same filter as the Feed and
 * Tracking tabs, in its words (Athletes with All, Players in a league, F1's Drivers, the UFC's Fighters alone,
 * college football's Teams alone); "All" is every sport, so Teams + All is every team in every league. The top 100 of each
 * filter, ranked by the server within that filter. Opened from the button at the top left of every tab.
 */
export default function LeaderboardScreen() {
  const tx = useT();
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
          ListHeaderComponent={entries?.length ? <Text style={styles.hint}>{tx('lb.hint')}</Text> : null}
          ListFooterComponent={board ? <Cut board={board} /> : null}
          ListEmptyComponent={failed
            ? <Empty emoji="📡" title={tx('lb.failed')} body={tx('lb.failedBody')} action={<PrimaryButton label={tx('plus.tryAgain')} onPress={() => { setFailed(false); setBoard(null); void load(); }} />} />
            : <Empty emoji="🏆" title={tx('lb.nobody', { what: describeFilter(filter) })} body={tx('lb.nobodyBody')}
                action={active ? <PrimaryButton label={tx('tracking.showEverything')} onPress={() => change({ kind: 'all' })} /> : <PrimaryButton label={tx('common.findSomeone')} onPress={() => router.navigate('/search')} />} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.hate} />}
          contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }}
        />
      )}
    </View>
  );
}

/** Under a list that's been cut at 100: how many there are in all, and anyone tied with #100 who didn't fit. */
function Cut({ board: { entries, total, moreTied } }: { board: Leaderboard }) {
  const tx = useT();
  if (total == null || total <= entries.length) return null;
  const last = entries.at(-1)!;
  return (
    <Text style={styles.cut}>
      {tx('lb.cut', { n: entries.length, total })}
      {moreTied ? ` ${tx('lb.tied', { n: moreTied, rank: last.rank, haters: tx('ui.haters', { n: last.haters }) })}` : ''}
    </Text>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** The rank within the current filter: 🥇🥈🥉 for the top three, a number after that; a tie reads "T-2" (under the medal in the top three). */
function Row({ entry: { rank, haters, target }, tied, mine }: { entry: LeaderboardEntry; tied: boolean; mine: boolean }) {
  const tx = useT();
  const place = tied ? `T-${rank}` : String(rank);
  return (
    <Pressable onPress={() => router.push(`/target/${encodeURIComponent(target.key)}`)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHi }]}
      accessibilityRole="button" accessibilityLabel={`${tx(tied ? 'lb.rankTied' : 'lb.rank', { rank })}, ${target.name}, ${tx('ui.haters', { n: haters })}${mine ? `, ${tx('lb.youTrack')}` : ''}`}>
      <View style={styles.rank}>
        {MEDALS[rank - 1] ? <Text style={styles.medal}>{MEDALS[rank - 1]}</Text> : <Text style={styles.rankText} numberOfLines={1}>{place}</Text>}
        {MEDALS[rank - 1] && tied ? <Text style={styles.tie}>{place}</Text> : null}
      </View>
      <Avatar target={target} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={styles.inline}>
          <Text style={styles.name} numberOfLines={1}>{target.name}</Text>
          {mine ? <Text style={styles.tracking}>{tx('lb.tracking')}</Text> : null}
        </View>
        <View style={styles.inline}>
          <LeagueTag league={target.league} />
          <Text style={styles.sub} numberOfLines={1}>{subtitle(target)}</Text>
        </View>
      </View>
      <View style={styles.count}>
        <Text style={styles.countN}>{haters.toLocaleString(currentLocale())}</Text>
        <Text style={styles.countLabel}>{tx('lb.haterWord', { n: haters })}</Text>
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
