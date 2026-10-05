import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useStore } from '../../lib/store';
import { GameCardView } from '../../components/GameCard';
import { Empty, LiveBadge, PrimaryButton, SectionHeader, useNow } from '../../components/ui';
import { FilterBar, useFilter } from '../../components/FilterBar';
import { SECTION, byState, inWindow } from '../../lib/scores';
import { colors, space } from '../../theme';
import type { GameCard } from '../../lib/types';

/**
 * Today's games for the teams you track (and the teams of players you track): live first, then later
 * today, then finals. Scores, clocks and win probability update live over the socket (see store.tsx).
 */
export default function ScoresScreen() {
  const { games, refreshScores, follows, feed } = useStore();
  const { filter, setFilter } = useFilter();
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  const nav = useNavigation();
  useEffect(() => { nav.setOptions({ headerRight: () => <LiveBadge /> }); }, [nav]);
  useFocusEffect(useCallback(() => { refreshScores().catch(() => {}); }, [refreshScores]));

  const sections = useMemo(() => {
    const list = [...games.values()].filter((g) => inWindow(g, now) && (!filter.league || g.league === filter.league)).sort(byState);
    return (['in', 'pre', 'post'] as const)
      .map((state) => ({ title: SECTION[state], data: list.filter((g) => g.state === state) }))
      .filter((s) => s.data.length);
  }, [games, filter.league, now]);

  // The newest alert from each game (the feed is newest first).
  const latest = useMemo(() => {
    const m = new Map<string, (typeof feed)[number]>();
    for (const f of feed) if (f.gameId && !m.has(f.gameId)) m.set(f.gameId, f);
    return m;
  }, [feed]);

  const onRefresh = async () => { setRefreshing(true); await refreshScores().catch(() => {}); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.filters}><FilterBar filter={filter} onChange={setFilter} kinds={false} /></View>
      <SectionList<GameCard>
        sections={sections}
        keyExtractor={(g) => g.key}
        renderSectionHeader={({ section }) => <SectionHeader>{section.title} · {section.data.length}</SectionHeader>}
        renderItem={({ item }) => <GameCardView game={item} latest={latest.get(item.id)} now={now} />}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.hate} />}
        contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }}
        ListEmptyComponent={follows.size === 0 ? (
          <Empty emoji="😈" title="Nobody to hate yet" body="Track some players and teams, and their games show up here, live." action={<PrimaryButton label="Find someone to hate" onPress={() => router.navigate('/search')} />} />
        ) : (
          <Empty emoji="🏟️" title={filter.league ? `No ${filter.league.toUpperCase()} games today` : 'No games today'}
            body="When a team you track, or a player's team, plays today, the game shows up here with the live score." />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { paddingTop: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
