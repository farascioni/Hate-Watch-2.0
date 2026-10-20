import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useStore } from '../../lib/store';
import { FeedCard } from '../../components/FeedCard';
import { Chip, Empty, LiveBadge, PrimaryButton, useNow } from '../../components/ui';
import { usePlus } from '../../lib/plus';
import { useSavedMap } from '../../lib/savedAlerts';
import { setActiveProfile, useProfileScope } from '../../lib/profiles';
import { inProfile } from '../../lib/profileLogic';
import { ProfileChips } from '../../components/ProfileChips';
import { FilterBar, describeFilter, matchesFilter, useFilter } from '../../components/FilterBar';
import { GridRow } from '../../components/GridRow';
import { Skeleton } from '../../components/Skeleton';
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

  // Hate Watch Plus's alert vault: the Saved chip swaps the feed for the alerts you starred, newest first. The feed's own
  // copy of a saved alert wins while the feed still has it. A lapsed subscriber's list is kept but hidden (chip and vault view) until they subscribe again.
  const { active: plus } = usePlus();
  const saved = useSavedMap();
  const [vault, setVault] = useState(false);
  const showVault = vault && plus;
  const source = useMemo(() => {
    if (!showVault) return feed;
    const live = new Map(feed.map((i) => [i.id, i]));
    return [...saved.values()].map((i) => live.get(i.id) ?? i).sort((a, b) => b.occurredAt - a.occurredAt);
  }, [showVault, feed, saved]);

  // Hate Watch Plus's tracking profile narrows the feed to its players and teams; the saved list ignores it.
  const { scope, profile } = useProfileScope(follows);
  const profiled = !showVault && !!scope;

  // Filters what's loaded; scrolling down keeps paging in older alerts, which are filtered too.
  const visible = useMemo(() => {
    const inScope = profiled ? source.filter((i) => inProfile(scope, i)) : source;
    return active ? inScope.filter((i) => matchesFilter(filter, { kind: i.target.kind, league: i.league })) : inScope;
  }, [source, filter, active, profiled, scope]);

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

  if (!ready) return <Skeleton />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    {feed.length || (plus && saved.size) ? <View style={styles.filters}><FilterBar filter={filter} onChange={setFilter} /></View> : null}
    {plus ? <ProfileChips follows={follows} hidden={showVault} style={styles.savedRow} lead={<Chip label={tx('feed.saved')} active={showVault} onPress={() => setVault(!showVault)} />} /> : null}
    <SectionList
      sections={rows}
      keyExtractor={(row) => row.map((i) => i.id).join('|')}
      renderItem={({ item: row }) => {
        const fresh = (item: FeedItem) => item.detectedAt > openedAt - 15_000 && now - item.detectedAt < 60_000; // those drop in on their own
        return <GridRow row={row} cols={cols} wave={row.some(fresh) ? undefined : 'feed'} render={(item) => <FeedCard item={item} now={now} highlight fresh={fresh(item)} />} />;
      }}
      renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
      stickySectionHeadersEnabled
      contentContainerStyle={{ paddingBottom: space(6), flexGrow: 1 }}
      onEndReached={showVault ? undefined : () => loadMore().catch(() => {})}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.hate} onRefresh={async () => { setRefreshing(true); await refreshFeed().catch(() => {}); setRefreshing(false); }} />}
      ListEmptyComponent={
        profiled && !visible.length && !active ? (
          <Empty emoji="🎯" title={tx('profile.feedTitle', { name: profile!.name })} body={tx('profile.feedBody')} action={<PrimaryButton label={tx('profile.showEveryone')} onPress={() => setActiveProfile(null)} />} />
        ) : source.length && active ? (
          <Empty emoji="🔎" title={tx('feed.nothingFor', { what: describeFilter(filter) })} body={tx('feed.nothingBody')} action={<PrimaryButton label={tx('tracking.showEverything')} onPress={reset} />} />
        ) : showVault ? (
          <Empty emoji="⭐" title={tx('feed.savedEmpty')} body={tx('feed.savedEmptyBody')} action={<PrimaryButton label={tx('feed.savedBack')} onPress={() => setVault(false)} />} />
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
  savedRow: { paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  day: { color: colors.textFaint, backgroundColor: colors.bg, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(2) },
});
