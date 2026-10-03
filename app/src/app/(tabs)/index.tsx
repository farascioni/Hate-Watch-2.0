import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useStore } from '../../lib/store';
import { FeedCard } from '../../components/FeedCard';
import { Empty, PrimaryButton, useNow } from '../../components/ui';
import { colors, space } from '../../theme';
import type { FeedItem } from '../../lib/types';

function dayLabel(ts: number) {
  const d = new Date(ts); const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function LiveBadge() {
  const { live } = useStore();
  const color = live === 'live' ? colors.live : live === 'connecting' ? colors.warn : colors.textFaint;
  return (
    <View style={styles.liveWrap} accessibilityLabel={`Realtime ${live}`}>
      <View style={[styles.liveDot, { backgroundColor: color }]} />
      <Text style={[styles.liveText, { color }]}>{live === 'live' ? 'LIVE' : live === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</Text>
    </View>
  );
}

export default function FeedScreen() {
  const { feed, ready, refreshFeed, loadMore, markSeen, follows } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [openedAt, setOpenedAt] = useState(Date.now());
  const now = useNow(10_000);
  const nav = useNavigation();

  useEffect(() => { nav.setOptions({ headerRight: () => <LiveBadge /> }); }, [nav]);
  useFocusEffect(useCallback(() => { markSeen(); setOpenedAt(Date.now()); }, [feed.length]));

  const sections = useMemo(() => {
    const out: { title: string; data: FeedItem[] }[] = [];
    for (const item of feed) {
      const t = dayLabel(item.occurredAt);
      if (out.at(-1)?.title !== t) out.push({ title: t, data: [] });
      out.at(-1)!.data.push(item);
    }
    return out;
  }, [feed]);

  if (!ready) return <View style={styles.center}><ActivityIndicator color={colors.hate} /></View>;

  return (
    <SectionList
      sections={sections}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <FeedCard item={item} now={now} fresh={item.detectedAt > openedAt - 15_000 && now - item.detectedAt < 60_000} />}
      renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
      stickySectionHeadersEnabled
      contentContainerStyle={{ paddingBottom: space(6), flexGrow: 1 }}
      onEndReached={() => loadMore().catch(() => {})}
      onEndReachedThreshold={0.4}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.hate} onRefresh={async () => { setRefreshing(true); await refreshFeed().catch(() => {}); setRefreshing(false); }} />}
      ListEmptyComponent={
        follows.size === 0 ? (
          <Empty emoji="😈" title="Nobody to hate yet" body="Track the players and teams you can't stand. Every strikeout, pick and loss lands here the moment it happens." action={<PrimaryButton label="Find someone to hate" onPress={() => router.navigate('/search')} />} />
        ) : (
          <Empty emoji="👀" title="Watching…" body={`Tracking ${follows.size} target${follows.size === 1 ? '' : 's'}. Their misfortune will show up here live.`} />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  day: { color: colors.textFaint, backgroundColor: colors.bg, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(2) },
  liveWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: space(4) },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
});
