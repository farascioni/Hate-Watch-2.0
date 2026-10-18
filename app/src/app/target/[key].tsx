import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Avatar } from '../../components/Avatar';
import { FavoriteButton } from '../../components/FavoriteButton';
import { FeedCard } from '../../components/FeedCard';
import { StatsView } from '../../components/StatsView';
import { ChipRows, FollowButton, HaterCount, LeagueTag, SectionHeader, TargetRow, subtitle, useNow } from '../../components/ui';
import { colors, space } from '../../theme';
import type { FeedItem, Player, StatsPage, Target } from '../../lib/types';
import { ROSTER_GROUPS } from '../../lib/positions';
import { tr, useT } from '../../lib/i18n';

const DAY = 24 * 3600_000;
const MISERY_DAYS = 30; // "Recent misery": the last 30 days (server MISERY_DAYS)

/** A loss is a "Successful Hate Watch!" only for someone who tracks the team or player; the server's list has no such wording. */
const withHateWatch = (item: FeedItem, tracked: boolean): FeedItem => (item.loss && tracked ? { ...item, title: `${tr('feed.successful')} ${item.title}` } : item);

export default function TargetScreen() {
  const tx = useT();
  const { key } = useLocalSearchParams<{ key: string }>();
  const targetKey = decodeURIComponent(key);
  const { noteTrackers, leagueInfo, isFollowing } = useStore();
  const [misery, setMisery] = useState<FeedItem[] | null>(null); // null: not loaded yet
  const [miseryFailed, setMiseryFailed] = useState(false);
  const [tab, setTab] = useState<'stats' | 'misery'>('stats'); // Stats first (F1 and the UFC have stats pages too: f1-stats.ts, ufc.ts)
  const [stats, setStats] = useState<StatsPage | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [target, setTarget] = useState<(Target & { roster?: Player[] }) | null>(null);
  const [position, setPosition] = useState<string | null>(null); // the roster filter: a group's label, or all
  const now = useNow();

  useEffect(() => { api.target(targetKey).then((t) => { setTarget(t); noteTrackers([t, ...(t.roster ?? [])]); }).catch(() => {}); }, [targetKey, noteTrackers]);
  // Fetched alongside the target, since Stats is the tab that shows first (F1's 404 is ignored).
  const loadStats = () => { setStatsFailed(false); api.stats(targetKey).then(setStats).catch(() => setStatsFailed(true)); };
  useEffect(loadStats, [targetKey]);
  // Recent misery is the same list for everyone (server misery.ts): the priority things that happened to them, not
  // this device's alerts. A server without it (an older one) answers with this device's own last day instead.
  const loadMisery = () => {
    setMiseryFailed(false);
    api.misery(targetKey).then((r) => setMisery(r.items))
      .catch(() => api.targetFeed(targetKey, Date.now() - DAY).then((r) => setMisery(r.items.filter((f) => f.type !== 'app.weekly_recap'))))
      .catch(() => setMiseryFailed(true));
  };
  useEffect(loadMisery, [targetKey]);
  useEffect(() => { // while it's open, a loss that comes in shows up
    if (tab !== 'misery') return;
    const t = setInterval(loadMisery, 60_000);
    return () => clearInterval(t);
  }, [tab, targetKey]);
  // The roster by position group (MLB starters, relievers, catchers…), each with its players; only groups that have some.
  const groups = useMemo(() => {
    const roster = target?.roster ?? [];
    return (ROSTER_GROUPS[leagueInfo(target?.league ?? '')?.sport ?? ''] ?? [])
      .map((g) => ({ label: g.label, players: roster.filter((p) => !!p.position && g.positions.includes(p.position)) }))
      .filter((g) => g.players.length);
  }, [target, leagueInfo]);

  if (!target) return <View style={styles.center}><ActivityIndicator color={colors.hate} /></View>;
  const accent = (target.kind === 'team' ? target.color : target.teamColor) ?? colors.hate;
  const roster = (position && groups.find((g) => g.label === position)?.players) || target.roster || [];
  const view = tab;

  const header = (
    <View>
      <View style={[styles.hero, { borderBottomColor: accent }]}>
        <Avatar target={target} size={112} />
        <Text style={styles.name}>{target.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <LeagueTag league={target.league} />
          {/* F1's subtitle already starts with the constructor's name */}
          <Text style={styles.sub}>{target.kind === 'player' && target.league !== 'f1' ? `${target.teamName ?? ''} · ${subtitle(target)}` : subtitle(target)}</Text>
        </View>
        <HaterCount target={target} size={14} />
        <View style={styles.actions}>
          <FollowButton target={target} />
          <FavoriteButton target={target} />
        </View>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {([['stats', tx('target.stats')], ['misery', tx('target.misery')]] as const).map(([id, label]) => (
          <Pressable key={id} onPress={() => { setTab(id); if (id === 'misery') loadMisery(); }} style={[styles.tab, view === id && styles.tabOn]}
            accessibilityRole="tab" accessibilityState={{ selected: view === id }}>
            <Text style={[styles.tabText, view === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {view === 'stats' ? (
        stats ? <StatsView page={stats} target={target} now={now} />
        : statsFailed ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>{tx('target.statsFailed')}</Text>
            <Pressable onPress={loadStats} hitSlop={8} accessibilityRole="button"><Text style={styles.retry}>{tx('plus.tryAgain')}</Text></Pressable>
          </View>
        ) : <ActivityIndicator color={colors.hate} style={styles.note} />
      ) : (
        <>
          <SectionHeader>Last {MISERY_DAYS} days</SectionHeader>
          {misery?.length ? misery.map((h) => <FeedCard key={h.id} item={withHateWatch(h, isFollowing(h.target.key) || isFollowing(targetKey))} now={now} />)
            : miseryFailed ? (
              <View style={styles.note}>
                <Text style={styles.noteText}>{tx('target.miseryFailed')}</Text>
                <Pressable onPress={loadMisery} hitSlop={8} accessibilityRole="button"><Text style={styles.retry}>{tx('plus.tryAgain')}</Text></Pressable>
              </View>
            ) : misery ? <Text style={[styles.noteText, styles.note]}>{tx('target.miseryNone', { n: MISERY_DAYS })}</Text>
            : <ActivityIndicator color={colors.hate} style={styles.note} />}
          {misery?.length ? <Text style={[styles.noteText, styles.footer]}>{tx('target.miseryFooter')}</Text> : null}
        </>
      )}
      {target.roster?.length ? <SectionHeader>{tx('target.roster', { n: target.roster.length })}</SectionHeader> : null}
      {groups.length > 1 ? (
        <ChipRows style={styles.positions} gap={space(1.5)} chipStyle={styles.positionChip} accessibilityLabel={tx('target.filterRoster')} items={[
          { key: 'all', label: tx('target.allN', { n: target.roster!.length }), active: !position, onPress: () => setPosition(null) },
          ...groups.map((g) => ({ key: g.label, label: `${g.label} ${g.players.length}`, active: position === g.label, onPress: () => setPosition(position === g.label ? null : g.label) })),
        ]} />
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: target.kind === 'team' ? target.abbrev : target.shortName ?? target.name }} />
      <FlatList
        data={roster}
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginTop: space(3) },
  // Stats and Recent misery: edge-to-edge tabs, the open one underlined in red.
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.bg },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space(3), borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -StyleSheet.hairlineWidth },
  tabOn: { borderBottomColor: colors.hate },
  tabText: { color: colors.textDim, fontSize: 15, fontWeight: '800' },
  tabTextOn: { color: colors.text },
  note: { alignItems: 'center', gap: space(2), paddingVertical: space(8), paddingHorizontal: space(6) },
  noteText: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
  footer: { paddingHorizontal: space(6), paddingVertical: space(3), fontSize: 12 },
  retry: { color: colors.text, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  // Wraps like the league chips in Search: every position group in view, each chip whole.
  positions: { paddingHorizontal: space(3), paddingBottom: space(2) },
  positionChip: { paddingHorizontal: space(2) },
});
