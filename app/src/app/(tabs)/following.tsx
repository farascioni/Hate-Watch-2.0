import { Fragment, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { leagueUi } from '../../lib/leagueUi';
import { toggleMostHated, useIsMostHated, useMostHatedCount, useMostHatedSet } from '../../lib/mostHated';
import { usePlus } from '../../lib/plus';
import { Chip, Empty, PrimaryButton, SectionHeader } from '../../components/ui';
import { TrackingCard } from '../../components/TrackingCard';
import { LayoutSheet } from '../../components/LayoutSheet';
import { SnoozeSheet } from '../../components/SnoozeSheet';
import { DAY_MS, snoozeDay, snoozeEnd } from '../../lib/snooze';
import { useTrackingLayout } from '../../lib/trackingLayout';
import { useWebLayout } from '../../lib/webLayout';
import { GridRow } from '../../components/GridRow';
import { gameInfo, teamKeyOf } from '../../lib/trackingInfo';
import { FilterBar, byWeightClass, describeFilter, groupByWeightClass, matchesFilter, playersTitle, useFilter } from '../../components/FilterBar';
import { HATE_RED, colors, radius, space } from '../../theme';
import type { Player, Target, Team } from '../../lib/types';
import { useT } from '../../lib/i18n';

/** Hate Watch Plus: marks one of your trackers as a most hated (a red border on their alerts in the Feed). Only drawn for subscribers. */
function MostHatedStar({ target, compact }: { target: Target; compact?: boolean }) {
  const t = useT();
  const on = useIsMostHated(target.key);
  const press = () => {
    Haptics.selectionAsync().catch(() => {});
    toggleMostHated(target.key);
  };
  return (
    <Pressable onPress={press} hitSlop={8} style={[styles.icon, compact && styles.iconSm, on && styles.iconStar]} accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={t(on ? 'tracking.removeHated' : 'tracking.addHated', { name: target.name })}>
      {/* Off is the same X dimmed, so it never reads as the plain − that unfollows. */}
      <Text style={{ fontSize: compact ? 13 : 17, lineHeight: compact ? 17 : 20, opacity: on ? 1 : 0.4 }}>❌</Text>
    </Pressable>
  );
}

export default function FollowingScreen() {
  const t = useT();
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
  const [snoozing, setSnoozing] = useState<Target | null>(null); // whose snooze menu is open (a long press on the bell)
  // The layout picker lives in the top right of the page (the header), beside nothing else: the leaderboard is on the left.
  const navigation = useNavigation();
  const hasFollows = follows.size > 0;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: hasFollows ? () => (
        <Pressable onPress={() => setMenu(true)} hitSlop={8} style={styles.layoutBtn} accessibilityRole="button" accessibilityLabel={t('tracking.chooseLayout')}>
          <Ionicons name="grid-outline" size={14} color={colors.textDim} /><Text style={styles.layoutText}>{t('tracking.layout')}</Text>
        </Pressable>
      ) : undefined,
    });
  }, [navigation, hasFollows, t]);
  // Not for leagues without divisions (F1), nor where ESPN's only "division" is the league's own name (the EPL's table).
  const divisionOf = (t: Target) => {
    const d = t.kind === 'team' && leagueUi(t.league).divisions ? teams.get(t.key)?.division : undefined;
    const full = leagueInfo(t.league)?.name ?? '';
    return d && d !== full && !(leagueUi(t.league).fullName ?? '').includes(d) ? d : undefined;
  };
  // The ❌ shows only for subscribers; a saved most-hated list keeps it working when the store can't confirm the subscription (offline).
  const { active: plus } = usePlus();
  const starred = useMostHatedCount();
  const starAllowed = plus || starred > 0;
  const muted = new Set(prefs?.muted ?? []);
  const customized = new Set([...Object.keys(prefs?.targetTypes ?? {}), ...Object.keys(prefs?.targetPushTypes ?? {})]);
  const { filter, setFilter, active: filtered, reset: resetFilter } = useFilter();
  const hated = useMostHatedSet();
  const [hatedOnly, setHatedOnly] = useState(false);
  const showHated = hatedOnly && starAllowed; // the filter goes with the ❌
  const active = filtered || showHated;
  const reset = () => { resetFilter(); setHatedOnly(false); };

  // Rows of cards: one each, two in the tiles layout (the section's count is of the cards, not the rows).
  const { cols } = useWebLayout(); // the web's card grid: as many across as fit, never fewer than the layout's own
  const per = Math.max(layout === 'tiles' ? 2 : 1, cols);
  const sections = useMemo((): { title: string; count: number; data: Target[][] }[] => {
    const all = [...follows.values()].filter((t) => matchesFilter(filter, t) && (!showHated || hated.has(t.key))).sort((a, b) => a.name.localeCompare(b.name));
    const groups = byWeightClass(filter) ? groupByWeightClass(all) : [
      { title: t('filter.teams'), data: all.filter((x) => x.kind === 'team') },
      { title: playersTitle(filter.league), data: all.filter((x) => x.kind === 'player') },
    ].filter((s) => s.data.length);
    return groups.map((g) => ({ title: g.title, count: g.data.length, data: Array.from({ length: Math.ceil(g.data.length / per) }, (_, i) => g.data.slice(i * per, i * per + per)) }));
  }, [follows, filter, per, showHated, hated, t]);

  const confirmUnfollow = (tg: Target) => Alert.alert(t('tracking.unfollowTitle', { name: tg.name }), t('tracking.unfollowBody'), [
    { text: t('settings.cancel'), style: 'cancel' },
    { text: t('tracking.unfollow'), style: 'destructive', onPress: () => toggleFollow(tg) },
  ]);

  // A tap on a snoozed bell ends the snooze, so every tap changes what's on screen; otherwise it flips the plain mute.
  const toggleMute = (tg: Target) => {
    if (snoozeEnd(prefs, tg.key)) updatePrefs({ snoozed: { [tg.key]: null } });
    else updatePrefs({ muted: muted.has(tg.key) ? [...muted].filter((k) => k !== tg.key) : [...muted, tg.key] });
  };
  // Snoozing replaces a plain mute: the bell is off either way, and the pushes only come back by themselves if nothing else keeps it muted.
  const snooze = (tg: Target, days: number) => {
    updatePrefs({ snoozed: { [tg.key]: Date.now() + days * DAY_MS }, muted: [...muted].filter((k) => k !== tg.key) });
    setSnoozing(null);
  };
  const endSnooze = (tg: Target) => {
    updatePrefs({ snoozed: { [tg.key]: null } });
    setSnoozing(null);
  };

  if (!follows.size) {
    return <Empty emoji="🎯" title={t('tracking.none')} body={t('tracking.noneBody')} action={<PrimaryButton label={t('tab.search')} onPress={() => router.navigate('/search')} />} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <View style={styles.filters}>
      <FilterBar filter={filter} onChange={setFilter} />
      {starAllowed ? <View style={styles.hatedRow}><Chip label={t('tracking.mostHated')} active={showHated} onPress={() => setHatedOnly(!showHated)} /></View> : null}
    </View>
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.map((x) => x.key).join('|')}
      renderSectionHeader={({ section }) => <SectionHeader>{section.title} · {section.count}</SectionHeader>}
      stickySectionHeadersEnabled // "Teams · 3" / "Players · 6" stay on top while scrolling, on every platform
      ListHeaderComponent={<Text style={styles.hint}>{t('tracking.hint')}{starAllowed ? ` ${t('tracking.hintHated')}` : ''}</Text>}
      renderItem={({ item: row }) => {
        const card = (item: Target) => {
        const until = snoozeEnd(prefs, item.key), off = until > 0 || muted.has(item.key); // a snooze reads as a mute, with its end on the line under the name
        return (
        <TrackingCard
          target={item}
          layout={layout}
          info={{ division: divisionOf(item), record: formOf(item)?.record, streak: formOf(item)?.streak, standing: formOf(item)?.standing, game: gameInfo(item, games, upNext), note: until ? t('tracking.snoozedUntil', { date: snoozeDay(until) }) : undefined }}
          actions={(compact) => (
            <View style={styles.actions}>
              {starAllowed && <MostHatedStar target={item} compact={compact} />}
              {/* A tap flips the mute (or ends a snooze); a long press opens the snooze menu. */}
              <Pressable onPress={() => toggleMute(item)} onLongPress={() => { Haptics.selectionAsync().catch(() => {}); setSnoozing(item); }} hitSlop={8} style={[styles.icon, compact && styles.iconSm]}
                accessibilityRole="button" accessibilityHint={t('tracking.snoozeHint')}
                accessibilityLabel={until ? t('tracking.unsnooze', { name: item.name, date: snoozeDay(until) }) : t(off ? 'tracking.unmute' : 'tracking.mute', { name: item.name })}>
                <Ionicons name={off ? 'notifications-off' : 'notifications'} size={compact ? 17 : 20} color={off ? colors.textFaint : colors.text} />
              </Pressable>
              {/* Per-player/team alert choices. Red when this target has any that differ from the global settings. */}
              <Pressable
                onPress={() => router.push(`/alerts/${encodeURIComponent(item.key)}`)}
                hitSlop={8}
                style={[styles.icon, compact && styles.iconSm, customized.has(item.key) && styles.iconCustom]}
                accessibilityRole="button"
                accessibilityLabel={t(customized.has(item.key) ? 'tracking.alertSettingsCustom' : 'tracking.alertSettings', { name: item.name })}
              >
                <Ionicons name="settings-sharp" size={compact ? 17 : 20} color={customized.has(item.key) ? colors.hate : colors.text} />
              </Pressable>
              {compact ? (
                <Pressable onPress={() => confirmUnfollow(item)} hitSlop={8} style={[styles.icon, styles.iconSm]} accessibilityLabel={t('ui.unfollowName', { name: item.name })}>
                  <Ionicons name="remove" size={22} color={colors.text} />
                </Pressable>
              ) : (
                <Pressable onPress={() => toggleFollow(item)} hitSlop={8} style={styles.unfollow} accessibilityLabel={t('ui.unfollowName', { name: item.name })}>
                  <Text style={styles.unfollowText}>{t('tracking.unfollow')}</Text>
                </Pressable>
              )}
            </View>
          )}
        />
        );
        };
        // The web's card grid puts the other layouts' cards in cells too; the tiles lay themselves out.
        if (per > 1 && layout !== 'tiles') return <GridRow row={row} cols={per} render={card} />;
        return (
          <View style={per > 1 ? styles.tiles : undefined}>
            {row.map((item) => <Fragment key={item.key}>{card(item)}</Fragment>)}
            {Array.from({ length: per > 1 ? per - row.length : 0 }, (_, i) => <View key={`pad${i}`} style={{ flex: 1 }} />)}
          </View>
        );
      }}
      ListEmptyComponent={active ? <Empty emoji="🔎" title={showHated ? t('tracking.noneHated', { what: filtered ? describeFilter(filter) : t('tracking.trackers') }) : t('tracking.noneWhat', { what: describeFilter(filter) })} body={t(showHated ? 'tracking.noneHatedBody' : 'tracking.noneFilterBody')} action={<PrimaryButton label={t('tracking.showEverything')} onPress={reset} />} /> : null}
      contentContainerStyle={{ paddingBottom: space(8), flexGrow: 1 }}
    />
    <LayoutSheet open={menu} onClose={() => setMenu(false)} />
    <SnoozeSheet target={snoozing} until={snoozing ? snoozeEnd(prefs, snoozing.key) : 0} onPick={(days) => snoozing && snooze(snoozing, days)} onEnd={() => snoozing && endSnooze(snoozing)} onClose={() => setSnoozing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { paddingTop: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  hatedRow: { flexDirection: 'row', paddingHorizontal: space(3), paddingBottom: space(2) },
  hint: { color: colors.textFaint, fontSize: 13, paddingHorizontal: space(4), paddingTop: space(3), lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(1.5) },
  tiles: { flexDirection: 'row', gap: space(2), marginHorizontal: space(3), marginVertical: space(1) },
  layoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: space(4), paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  layoutText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  iconSm: { padding: space(1.5) - 1 },
  icon: { padding: space(2) - 1, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'transparent' },
  iconStar: { borderColor: HATE_RED },
  iconCustom: { borderColor: colors.hate },
  unfollow: { marginLeft: 'auto', paddingHorizontal: space(3), paddingVertical: space(1), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  unfollowText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
});
