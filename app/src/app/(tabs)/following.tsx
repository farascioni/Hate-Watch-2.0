import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { leagueUi } from '../../lib/leagueUi';
import { toggleMostHated, useIsMostHated, useMostHatedCount } from '../../lib/mostHated';
import { usePlus } from '../../lib/plus';
import { Empty, PrimaryButton, SectionHeader } from '../../components/ui';
import { TrackingCard } from '../../components/TrackingCard';
import { LayoutSheet } from '../../components/LayoutSheet';
import { useTrackingLayout } from '../../lib/trackingLayout';
import { gameInfo, teamKeyOf } from '../../lib/trackingInfo';
import { FilterBar, byWeightClass, describeFilter, groupByWeightClass, matchesFilter, playersTitle, useFilter } from '../../components/FilterBar';
import { GOLD, colors, radius, space } from '../../theme';
import type { Player, Target, Team } from '../../lib/types';

/** Hate Watch Plus: marks one of your trackers as a most hated (a gold border on their alerts in the Feed). */
function MostHatedStar({ target, allowed, compact }: { target: Target; allowed: boolean; compact?: boolean }) {
  const on = useIsMostHated(target.key);
  const press = () => {
    if (!allowed && !on) {
      Alert.alert('Most hated is a Plus perk', 'Hate Watch Plus subscribers can star their most hated players and teams, and their alerts get a gold border in the Feed.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'See Plus', onPress: () => router.navigate('/settings') },
      ]);
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    toggleMostHated(target.key);
  };
  return (
    <Pressable onPress={press} hitSlop={8} style={[styles.icon, compact && styles.iconSm, on && styles.iconStar]} accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={on ? `Remove ${target.name} from your most hated` : `Add ${target.name} to your most hated`}>
      <Ionicons name={on ? 'star' : 'star-outline'} size={compact ? 17 : 20} color={on ? GOLD : colors.text} />
    </Pressable>
  );
}

export default function FollowingScreen() {
  const { follows, toggleFollow, prefs, updatePrefs, refreshTrackers } = useStore();
  // Other people follow and unfollow too: fresh counts each time the tab opens.
  useFocusEffect(useCallback(() => { refreshTrackers().catch(() => {}); }, [refreshTrackers]));
  // Each team's division (MLB "AL East", college football's conference), from the same list Search sorts by.
  const [teams, setTeams] = useState<Map<string, Team>>(new Map());
  useFocusEffect(useCallback(() => {
    let live = true;
    api.teams(undefined, true).then((r) => { if (live) setTeams(new Map(r.teams.map((t) => [t.key, t]))); }).catch(() => {});
    return () => { live = false; };
  }, []));
  // An F1 driver's card says their own place in the drivers' championship (the constructor's is on the team's card).
  const hasDrivers = [...follows.values()].some((t) => t.kind === 'player' && t.league === 'f1');
  const [drivers, setDrivers] = useState<Map<string, Player>>(new Map());
  useFocusEffect(useCallback(() => {
    if (!hasDrivers) return;
    let live = true;
    api.f1Drivers().then((r) => { if (live) setDrivers(new Map(r.drivers.map((d) => [d.key, d]))); }).catch(() => {});
    return () => { live = false; };
  }, [hasDrivers]));
  const formOf = (t: Target): { record?: string; streak?: string; standing?: string } | undefined =>
    t.kind === 'player' && t.league === 'f1' ? drivers.get(t.key) : teams.get(teamKeyOf(t));
  const { leagueInfo, games, upNext } = useStore();
  const layout = useTrackingLayout();
  const [menu, setMenu] = useState(false);
  // The layout picker lives in the top right of the page (the header), beside nothing else: the leaderboard is on the left.
  const navigation = useNavigation();
  const hasFollows = follows.size > 0;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: hasFollows ? () => (
        <Pressable onPress={() => setMenu(true)} hitSlop={8} style={styles.layoutBtn} accessibilityRole="button" accessibilityLabel="Choose how the cards look">
          <Ionicons name="grid-outline" size={14} color={colors.textDim} /><Text style={styles.layoutText}>Layout</Text>
        </Pressable>
      ) : undefined,
    });
  }, [navigation, hasFollows]);
  // Not for leagues without divisions (F1), nor where ESPN's only "division" is the league's own name (the EPL's table).
  const divisionOf = (t: Target) => {
    const d = t.kind === 'team' && leagueUi(t.league).divisions ? teams.get(t.key)?.division : undefined;
    const full = leagueInfo(t.league)?.name ?? '';
    return d && d !== full && !(leagueUi(t.league).fullName ?? '').includes(d) ? d : undefined;
  };
  // A saved most-hated list keeps its stars working when the store can't confirm the subscription (offline).
  const { active: plus } = usePlus();
  const starred = useMostHatedCount();
  const starAllowed = plus || starred > 0;
  const muted = new Set(prefs?.muted ?? []);
  const customized = new Set([...Object.keys(prefs?.targetTypes ?? {}), ...Object.keys(prefs?.targetPushTypes ?? {})]);
  const { filter, setFilter, active, reset } = useFilter();

  // Rows of cards: one each, two in the tiles layout (the section's count is of the cards, not the rows).
  const per = layout === 'tiles' ? 2 : 1;
  const sections = useMemo((): { title: string; count: number; data: Target[][] }[] => {
    const all = [...follows.values()].filter((t) => matchesFilter(filter, t)).sort((a, b) => a.name.localeCompare(b.name));
    const groups = byWeightClass(filter) ? groupByWeightClass(all) : [
      { title: 'Teams', data: all.filter((t) => t.kind === 'team') },
      { title: playersTitle(filter.league), data: all.filter((t) => t.kind === 'player') },
    ].filter((s) => s.data.length);
    return groups.map((g) => ({ title: g.title, count: g.data.length, data: Array.from({ length: Math.ceil(g.data.length / per) }, (_, i) => g.data.slice(i * per, i * per + per)) }));
  }, [follows, filter, per]);

  const confirmUnfollow = (t: Target) => Alert.alert(`Unfollow ${t.name}?`, 'You stop getting their alerts.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Unfollow', style: 'destructive', onPress: () => toggleFollow(t) },
  ]);

  const toggleMute = (t: Target) => {
    const next = muted.has(t.key) ? [...muted].filter((k) => k !== t.key) : [...muted, t.key];
    updatePrefs({ muted: next });
  };

  if (!follows.size) {
    return <Empty emoji="🎯" title="You're not tracking anyone" body="Search for a player or team and tap Track." action={<PrimaryButton label="Search" onPress={() => router.navigate('/search')} />} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <View style={styles.filters}><FilterBar filter={filter} onChange={setFilter} /></View>
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.map((t) => t.key).join('|')}
      renderSectionHeader={({ section }) => <SectionHeader>{section.title} · {section.count}</SectionHeader>}
      stickySectionHeadersEnabled // "Teams · 3" / "Players · 6" stay on top while scrolling, on every platform
      ListHeaderComponent={<Text style={styles.hint}>🔕 turns off push notifications for one player or team; their alerts still show up in your feed. ⚙️ picks which alerts you get for just that player or team. The ✕ (it asks first) stops tracking them entirely. With Hate Watch Plus, ⭐ marks your most hated: their alerts get a gold border in the Feed.</Text>}
      renderItem={({ item: row }) => (
        <View style={per > 1 ? styles.tiles : undefined}>
        {row.map((item) => (
        <TrackingCard
          key={item.key}
          target={item}
          layout={layout}
          info={{ division: divisionOf(item), record: formOf(item)?.record, streak: formOf(item)?.streak, standing: formOf(item)?.standing, game: gameInfo(item, games, upNext) }}
          actions={(compact) => (
            <View style={styles.actions}>
              <MostHatedStar target={item} allowed={starAllowed} compact={compact} />
              <Pressable onPress={() => toggleMute(item)} hitSlop={8} style={[styles.icon, compact && styles.iconSm]} accessibilityLabel={muted.has(item.key) ? `Turn push notifications back on for ${item.name}` : `Turn off push notifications for ${item.name} (alerts stay in your feed)`}>
                <Ionicons name={muted.has(item.key) ? 'notifications-off' : 'notifications'} size={compact ? 17 : 20} color={muted.has(item.key) ? colors.textFaint : colors.text} />
              </Pressable>
              {/* Per-player/team alert choices. Red when this target has any that differ from the global settings. */}
              <Pressable
                onPress={() => router.push(`/alerts/${encodeURIComponent(item.key)}`)}
                hitSlop={8}
                style={[styles.icon, compact && styles.iconSm, customized.has(item.key) && styles.iconCustom]}
                accessibilityRole="button"
                accessibilityLabel={`Alert settings for ${item.name}${customized.has(item.key) ? ' (customized)' : ''}`}
              >
                <Ionicons name="settings-sharp" size={compact ? 17 : 20} color={customized.has(item.key) ? colors.hate : colors.text} />
              </Pressable>
              {compact ? (
                <Pressable onPress={() => confirmUnfollow(item)} hitSlop={8} style={[styles.icon, styles.iconSm]} accessibilityLabel={`Unfollow ${item.name}`}>
                  <Ionicons name="close" size={17} color={colors.textDim} />
                </Pressable>
              ) : (
                <Pressable onPress={() => toggleFollow(item)} hitSlop={8} style={styles.unfollow} accessibilityLabel={`Unfollow ${item.name}`}>
                  <Text style={styles.unfollowText}>Unfollow</Text>
                </Pressable>
              )}
            </View>
          )}
        />
        ))}
        {per > 1 && row.length < per ? <View style={{ flex: 1 }} /> : null}
        </View>
      )}
      ListEmptyComponent={active ? <Empty emoji="🔎" title={`You're not tracking any ${describeFilter(filter)}`} body="Change the filter, or find some on the Search tab." action={<PrimaryButton label="Show everything" onPress={reset} />} /> : null}
      contentContainerStyle={{ paddingBottom: space(8), flexGrow: 1 }}
    />
    <LayoutSheet open={menu} onClose={() => setMenu(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { paddingTop: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  hint: { color: colors.textFaint, fontSize: 13, paddingHorizontal: space(4), paddingTop: space(3), lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(1.5) },
  tiles: { flexDirection: 'row', gap: space(2), marginHorizontal: space(3), marginVertical: space(1) },
  layoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: space(4), paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  layoutText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  iconSm: { padding: space(1.5) },
  icon: { padding: space(2), borderRadius: radius.pill, backgroundColor: colors.surface },
  iconStar: { borderWidth: 1, borderColor: GOLD },
  iconCustom: { borderWidth: 1, borderColor: colors.hate },
  unfollow: { marginLeft: 'auto', paddingHorizontal: space(3), paddingVertical: space(1), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  unfollowText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
});
