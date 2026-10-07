import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Avatar } from '../../components/Avatar';
import { FeedCard } from '../../components/FeedCard';
import { FollowButton, HaterCount, LeagueTag, SectionHeader, TargetRow, subtitle, useNow } from '../../components/ui';
import { colors, space } from '../../theme';
import type { FeedItem, Player, Target } from '../../lib/types';

const DAY = 24 * 3600_000; // "Recent misery" is the last day's alerts

export default function TargetScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const targetKey = decodeURIComponent(key);
  const { feed, noteTrackers } = useStore();
  const [recent, setRecent] = useState<FeedItem[]>([]);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<(Target & { roster?: Player[] }) | null>(null);
  const now = useNow();

  useEffect(() => { api.target(targetKey).then((t) => { setTarget(t); noteTrackers([t, ...(t.roster ?? [])]); }).catch(() => {}); }, [targetKey, noteTrackers]);
  // Their last day of alerts from the server (the app's loaded feed may not reach back that far),
  // plus any that arrive live while you're here.
  useEffect(() => { api.targetFeed(targetKey, Date.now() - DAY).then((r) => setRecent(r.items)).catch(() => {}); }, [targetKey]);
  const history = useMemo(() => {
    const byId = new Map<string, FeedItem>();
    for (const f of [...recent, ...feed]) if (f.target.key === targetKey && now - f.occurredAt < DAY) byId.set(f.id, f);
    return [...byId.values()].sort((a, b) => b.occurredAt - a.occurredAt);
  }, [recent, feed, targetKey, now]);

  if (!target) return <View style={styles.center}><ActivityIndicator color={colors.hate} /></View>;
  const accent = (target.kind === 'team' ? target.color : target.teamColor) ?? colors.hate;

  const header = (
    <View>
      <View style={[styles.hero, { borderBottomColor: accent }]}>
        <Avatar target={target} size={112} />
        <Text style={styles.name}>{target.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <LeagueTag league={target.league} />
          <Text style={styles.sub}>{target.kind === 'player' ? `${target.teamName ?? ''} · ${subtitle(target)}` : subtitle(target)}</Text>
        </View>
        <HaterCount target={target} size={14} />
        <View style={styles.actions}>
          <FollowButton target={target} />
          {/* Stats: every league but F1 (for now). */}
          {target.league !== 'f1' ? (
            <Pressable onPress={() => router.push(`/stats/${encodeURIComponent(target.key)}`)} style={({ pressed }) => [styles.stats, pressed && { opacity: 0.7 }]}
              accessibilityRole="button" accessibilityLabel={`${target.name} stats`}>
              <Ionicons name="stats-chart" size={14} color={colors.text} />
              <Text style={styles.statsText}>Stats</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {history.length ? <SectionHeader>Recent misery · last 24 hours</SectionHeader> : null}
      {(open ? history : history.slice(0, 1)).map((h) => <FeedCard key={h.id} item={h} now={now} />)}
      {history.length > 1 ? (
        <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8} style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}
          accessibilityRole="button" aria-expanded={open} accessibilityLabel={open ? 'Show only the latest alert' : `Show ${history.length - 1} more alert${history.length === 2 ? '' : 's'} from the last 24 hours`}>
          <Text style={styles.moreText}>{open ? 'Show less' : `Show ${history.length - 1} more`}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textDim} />
        </Pressable>
      ) : null}
      {target.roster?.length ? <SectionHeader>Roster · {target.roster.length}</SectionHeader> : null}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: target.kind === 'team' ? target.abbrev : target.shortName ?? target.name }} />
      <FlatList
        data={target.roster ?? []}
        keyExtractor={(p) => p.key}
        ListHeaderComponent={header}
        renderItem={({ item }) => <TargetRow target={item} />}
        initialNumToRender={12}
        contentContainerStyle={{ paddingBottom: space(10) }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  hero: { alignItems: 'center', gap: space(2), paddingVertical: space(6), borderBottomWidth: 3, backgroundColor: colors.surface },
  name: { color: colors.text, fontSize: 26, fontWeight: '900', marginTop: space(2), textAlign: 'center', paddingHorizontal: space(4) },
  sub: { color: colors.textDim, fontSize: 14 },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(1), alignSelf: 'center', paddingVertical: space(2), paddingHorizontal: space(4), marginBottom: space(2) },
  moreText: { color: colors.textDim, fontSize: 14, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginTop: space(3) },
  stats: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), paddingHorizontal: space(4), paddingVertical: space(2), borderRadius: 999, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceHi },
  statsText: { color: colors.text, fontWeight: '800', fontSize: 13 },
});
