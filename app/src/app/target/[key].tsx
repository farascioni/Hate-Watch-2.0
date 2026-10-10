import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Avatar } from '../../components/Avatar';
import { FeedCard } from '../../components/FeedCard';
import { StatsView } from '../../components/StatsView';
import { Chip, FollowButton, HaterCount, LeagueTag, SectionHeader, TargetRow, subtitle, useNow } from '../../components/ui';
import { colors, space } from '../../theme';
import type { FeedItem, Player, StatsPage, Target } from '../../lib/types';
import { ROSTER_GROUPS } from '../../lib/positions';

const DAY = 24 * 3600_000; // "Recent misery" is the last day's alerts

export default function TargetScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const targetKey = decodeURIComponent(key);
  const { feed, noteTrackers, leagueInfo } = useStore();
  const [recent, setRecent] = useState<FeedItem[]>([]);
  const [tab, setTab] = useState<'stats' | 'misery'>('stats'); // Stats first; F1 has no stats yet, so only misery
  const [stats, setStats] = useState<StatsPage | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [target, setTarget] = useState<(Target & { roster?: Player[] }) | null>(null);
  const [position, setPosition] = useState<string | null>(null); // the roster filter: a group's label, or all
  const now = useNow();

  useEffect(() => { api.target(targetKey).then((t) => { setTarget(t); noteTrackers([t, ...(t.roster ?? [])]); }).catch(() => {}); }, [targetKey, noteTrackers]);
  // Fetched alongside the target, since Stats is the tab that shows first (F1's 404 is ignored).
  const loadStats = () => { setStatsFailed(false); api.stats(targetKey).then(setStats).catch(() => setStatsFailed(true)); };
  useEffect(loadStats, [targetKey]);
  // Their last day of alerts from the server (the app's loaded feed may not reach back that far),
  // plus any that arrive live while you're here.
  useEffect(() => { api.targetFeed(targetKey, Date.now() - DAY).then((r) => setRecent(r.items)).catch(() => {}); }, [targetKey]);
  const history = useMemo(() => {
    const byId = new Map<string, FeedItem>();
    // The weekly recap is filed under your top team, but it's about your week, not theirs.
    for (const f of [...recent, ...feed]) if (f.target.key === targetKey && f.type !== 'app.weekly_recap' && now - f.occurredAt < DAY) byId.set(f.id, f);
    return [...byId.values()].sort((a, b) => b.occurredAt - a.occurredAt);
  }, [recent, feed, targetKey, now]);
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
        </View>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {([['stats', 'Stats'], ['misery', 'Recent misery']] as const).map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} style={[styles.tab, view === id && styles.tabOn]}
            accessibilityRole="tab" accessibilityState={{ selected: view === id }}>
            <Text style={[styles.tabText, view === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {view === 'stats' ? (
        stats ? <StatsView page={stats} target={target} now={now} />
        : statsFailed ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>Couldn't load the stats. ESPN didn't answer.</Text>
            <Pressable onPress={loadStats} hitSlop={8} accessibilityRole="button"><Text style={styles.retry}>Try again</Text></Pressable>
          </View>
        ) : <ActivityIndicator color={colors.hate} style={styles.note} />
      ) : (
        <>
          <SectionHeader>Last 24 hours</SectionHeader>
          {history.length ? history.map((h) => <FeedCard key={h.id} item={h} now={now} />)
            : <Text style={[styles.noteText, styles.note]}>No misery in the last 24 hours. Give it time.</Text>}
        </>
      )}
      {target.roster?.length ? <SectionHeader>Roster · {target.roster.length}</SectionHeader> : null}
      {groups.length > 1 ? (
        <View style={styles.positions} accessibilityLabel="Filter the roster by position">
          <Chip label={`All ${target.roster!.length}`} active={!position} onPress={() => setPosition(null)} style={styles.positionChip} />
          {groups.map((g) => (
            <Chip key={g.label} label={`${g.label} ${g.players.length}`} active={position === g.label} onPress={() => setPosition(position === g.label ? null : g.label)} style={styles.positionChip} />
          ))}
        </View>
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
  retry: { color: colors.text, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  // Wraps like the league chips in Search: every position group in view, each chip whole.
  positions: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5), paddingHorizontal: space(3), paddingBottom: space(2) },
  positionChip: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: space(2) },
});
