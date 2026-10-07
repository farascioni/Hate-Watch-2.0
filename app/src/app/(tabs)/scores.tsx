import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useStore } from '../../lib/store';
import { GameCardView } from '../../components/GameCard';
import { UpNextRow } from '../../components/UpNextRow';
import { Empty, LiveBadge, PrimaryButton, SectionHeader, useNow } from '../../components/ui';
import { FilterBar, useFilter } from '../../components/FilterBar';
import { SECTION, byState, inWindow, upNextWhen, weekendDates } from '../../lib/scores';
import { colors, space } from '../../theme';
import type { F1Weekend, GameCard, NextGame } from '../../lib/types';

/**
 * Today's games for the teams you track (and the teams of players you track): live first, then later
 * today, then finals. Scores, clocks and win probability update live over the socket (see store.tsx).
 * Then "Up next": each team's next game that isn't already a card here, soonest first. On a day with no
 * games (for the filter), that list is the screen, under "No games today".
 */
export default function ScoresScreen() {
  const { games, nextF1, upNext, refreshScores, follows, feed } = useStore();
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
  // Up next: not one already on the tab as a card, and only games still to come.
  const next = useMemo(() => {
    const shown = new Set(sections.flatMap((s) => s.data.map((g) => g.key)));
    return upNext.filter((n) => !shown.has(n.key) && n.startsAt > now - 3600_000 && (!filter.league || n.league === filter.league));
  }, [upNext, sections, filter.league, now]);
  const listed: { title: string; data: (GameCard | NextGame)[]; upNext?: boolean }[] = next.length
    ? [...sections, { title: 'Up next', data: next, upNext: true }]
    : sections;

  // The newest alert from each game (the feed is newest first).
  const latest = useMemo(() => {
    const m = new Map<string, (typeof feed)[number]>();
    for (const f of feed) if (f.gameId && !m.has(f.gameId)) m.set(f.gameId, f);
    return m;
  }, [feed]);

  const tracked = [...follows.values()];
  const { leagueInfo } = useStore();
  const leagueName = (id: string) => leagueInfo(id)?.name ?? id.toUpperCase();
  const f1 = filter.league === 'f1' || (!filter.league && tracked.length > 0 && tracked.every((t) => t.league === 'f1'));

  const onRefresh = async () => { setRefreshing(true); await refreshScores().catch(() => {}); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.filters}><FilterBar filter={filter} onChange={setFilter} kinds={false} /></View>
      <SectionList<GameCard | NextGame, { title: string; upNext?: boolean }>
        sections={listed}
        keyExtractor={(g, i) => `${'state' in g ? 'game' : 'next'}:${g.key}:${i}`}
        // A day with no games for this filter: say so above what's next (unless what's next is today: a
        // game tonight can be in "Up next" before ESPN's scoreboard turns over to today).
        ListHeaderComponent={!sections.length && next.length && upNextWhen(next[0].startsAt, true, now).day !== 'Today' ? (
          <Text style={styles.none}>{filter.league ? `No ${leagueName(filter.league)} games today.` : 'No games today.'}</Text>
        ) : null}
        renderSectionHeader={({ section }) => <SectionHeader>{section.title} · {section.data.length}</SectionHeader>}
        renderItem={({ item, section }) => (section.upNext
          ? <UpNextRow game={item as NextGame} now={now} />
          : <GameCardView game={item as GameCard} latest={latest.get(item.id)} now={now} />)}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.hate} />}
        contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }}
        ListEmptyComponent={follows.size === 0 ? (
          <Empty emoji="😈" title="Nobody to hate yet" body="Track some players and teams, and their games show up here, live." action={<PrimaryButton label="Find someone to hate" onPress={() => router.navigate('/search')} />} />
        ) : f1 ? (
          <F1Empty next={nextF1} tracking={tracked.some((t) => t.league === 'f1')} now={now} />
        ) : (
          <Empty emoji="🏟️" title={filter.league ? `No ${leagueName(filter.league)} games today` : 'No games today'}
            body="When a team you track, or a player's team, plays today, the game shows up here with the live score. Nothing's scheduled yet after that." />
        )}
      />
    </View>
  );
}

/** F1 with nothing on the tab. Practice isn't shown, so it says when the next race weekend is. */
function F1Empty({ next, tracking, now }: { next: F1Weekend | null; tracking: boolean; now: number }) {
  const when = next && (next.startsAt <= now
    ? `The ${next.name} is this weekend. Practice isn't shown here.`
    : `Next race weekend: ${next.name}, ${weekendDates(next.startsAt, next.endsAt)}.`);
  const how = tracking
    ? 'Qualifying, sprints and races for the drivers and constructors you track show up here the day they run, with the live running order.'
    : 'Track a driver or constructor, and their qualifying, sprints and races show up here the day they run, with the live running order.';
  return (
    <Empty emoji="🏁" title="No F1 sessions today" body={when ? `${when}\n\n${how}` : how}
      action={tracking ? undefined : <PrimaryButton label="Find someone to hate" onPress={() => router.navigate('/search')} />} />
  );
}

const styles = StyleSheet.create({
  none: { color: colors.textDim, fontSize: 14, paddingHorizontal: space(4), paddingTop: space(4) },
  filters: { paddingTop: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
