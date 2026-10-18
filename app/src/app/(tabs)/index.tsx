import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useStore } from '../../lib/store';
import { FeedCard } from '../../components/FeedCard';
import { Empty, LiveBadge, PrimaryButton, useNow } from '../../components/ui';
import { FilterBar, describeFilter, matchesFilter, useFilter } from '../../components/FilterBar';
import { GridRow } from '../../components/GridRow';
import { chunkSections, useWebLayout } from '../../lib/webLayout';
import { colors, space } from '../../theme';
import type { FeedItem } from '../../lib/types';
import { currentLocale, tr, useT } from '../../lib/i18n';

function dayLabel(ts: number) {
  const d = new Date(ts); const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return tr('time.today');
  if (d.toDateString() === y.toDateString()) return tr('time.yesterday');
  return d.toLocaleDateString(currentLocale(), { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function FeedScreen() {
  const tx = useT();
  const { feed, ready, refreshFeed, loadMore, markSeen, follows } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [openedAt, setOpenedAt] = useState(Date.now());
  const now = useNow(10_000);
  const nav = useNavigation();
  const { filter, setFilter, active, reset } = useFilter();
  const { cols } = useWebLayout();

  useEffect(() => { nav.setOptions({ headerRight: () => <LiveBadge /> }); }, [nav]);
  useFocusEffect(useCallback(() => { markSeen(); setOpenedAt(Date.now()); }, [feed.length]));

  // Filters what's loaded; scrolling down keeps paging in older alerts, which are filtered too.
  const visible = useMemo(
    () => (active ? feed.filter((i) => matchesFilter(filter, { kind: i.target.kind, league: i.league })) : feed),
    [feed, filter, active],
  );

  const sections = useMemo(() => {
    const out: { title: string; data: FeedItem[] }[] = [];
    for (const item of visible) {
      const t = dayLabel(item.occurredAt);
      if (out.at(-1)?.title !== t) out.push({ title: t, data: [] });
      out.at(-1)!.data.push(item);
    }
    return out;
  }, [visible]);

  const rows = useMemo(() => chunkSections(sections, () => cols), [sections, cols]);

  if (!ready) return <View style={styles.center}><ActivityIndicator color={colors.hate} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    {feed.length ? <View style={styles.filters}><FilterBar filter={filter} onChange={setFilter} /></View> : null}
    <SectionList
      sections={rows}
      keyExtractor={(row) => row.map((i) => i.id).join('|')}
      renderItem={({ item: row }) => <GridRow row={row} cols={cols} render={(item) => <FeedCard item={item} now={now} highlight fresh={item.detectedAt > openedAt - 15_000 && now - item.detectedAt < 60_000} />} />}
      renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
      stickySectionHeadersEnabled
      contentContainerStyle={{ paddingBottom: space(6), flexGrow: 1 }}
      onEndReached={() => loadMore().catch(() => {})}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.hate} onRefresh={async () => { setRefreshing(true); await refreshFeed().catch(() => {}); setRefreshing(false); }} />}
      ListEmptyComponent={
        feed.length && active ? (
          <Empty emoji="🔎" title={tx('feed.nothingFor', { what: describeFilter(filter) })} body={tx('feed.nothingBody')} action={<PrimaryButton label={tx('tracking.showEverything')} onPress={reset} />} />
        ) : follows.size === 0 ? (
          <Empty emoji="😈" title={tx('feed.nobody')} body={tx('feed.nobodyBody')} action={<PrimaryButton label={tx('common.findSomeone')} onPress={() => router.navigate('/search')} />} />
        ) : (
          <Empty emoji="👀" title={tx('feed.watching')} body={tx('feed.watchingBody', { n: follows.size })} />
        )
      }
    />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { paddingTop: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  day: { color: colors.textFaint, backgroundColor: colors.bg, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(2) },
});
