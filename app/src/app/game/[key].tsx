import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { GameCardView } from '../../components/GameCard';
import { FeedCard } from '../../components/FeedCard';
import { BoxScoreView } from '../../components/BoxScore';
import { HighlightsView } from '../../components/Highlights';
import { F1PreviewView } from '../../components/F1Preview';
import { Empty, SectionHeader, useNow } from '../../components/ui';
import { trackedDrivers } from '../../lib/scores';
import { colors, radius, space } from '../../theme';
import type { F1Preview, FeedItem, GameDetail } from '../../lib/types';
import { leagueUi } from '../../lib/leagueUi';

/** Whether "Your alerts from this game" is open, as you last left it (every game screen; kept on the device). */
const ALERTS_OPEN_KEY = 'game:alertsOpen';

/**
 * One game from the Scores tab: the live score card, the box score and the highlights (ESPN's clips and the
 * key plays) as tabs (F1: the running order; before the session starts, the weekend's preview), then your
 * alerts from this game, which you can minimize. The card stays live over the socket; the box score and
 * highlights refresh every 15s while live.
 */
export default function GameScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const gameKey = decodeURIComponent(key);
  const { games, feed, follows } = useStore();
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'box' | 'highlights'>('box');
  const [alertsOpen, setAlertsOpen] = useState(true);
  useEffect(() => { AsyncStorage.getItem(ALERTS_OPEN_KEY).then((v) => { if (v === '0') setAlertsOpen(false); }).catch(() => {}); }, []);
  const toggleAlerts = () => setAlertsOpen((open) => { AsyncStorage.setItem(ALERTS_OPEN_KEY, open ? '0' : '1').catch(() => {}); return !open; });
  const now = useNow();
  const game = games.get(gameKey) ?? detail?.game;
  // F1 before the start: the weekend's preview (a server from before it has none: the running order instead).
  const [preview, setPreview] = useState<F1Preview | null>(null);
  const previewOf = game?.league === 'f1' && game.state === 'pre' ? game.eventId : undefined;
  const loadPreview = useCallback(() => (previewOf ? api.f1Preview(previewOf).then(setPreview, () => setPreview(null)) : Promise.resolve()), [previewOf]);
  useEffect(() => { loadPreview(); }, [loadPreview]);

  const load = useCallback(() => api.game(gameKey).then((d) => { setDetail(d); setFailed(false); }, () => setFailed(true)), [gameKey]);
  useEffect(() => { load(); }, [load]);
  const live = game?.state === 'in';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [live, load]);

  // Alerts that arrived over the socket since the screen loaded join the ones the server sent.
  const alerts = useMemo(() => {
    const byId = new Map<string, FeedItem>();
    for (const a of [...(detail?.alerts ?? []), ...feed.filter((f) => game && f.gameId === game.id)]) byId.set(a.id, a);
    return [...byId.values()].sort((a, b) => b.occurredAt - a.occurredAt);
  }, [detail, feed, game]);

  if (!game) {
    return failed
      ? <Empty emoji="🏟️" title="This game isn't available" body="Games stay on the Scores tab until the day after they finish." />
      : <View style={styles.center}><ActivityIndicator color={colors.hate} /></View>;
  }
  const title = game.league === 'f1' ? game.session ?? 'Race' : `${game.away?.team.shortName} @ ${game.home?.team.shortName}`;
  const mine = new Set(trackedDrivers(game, follows).map((d) => d.key));

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await Promise.all([load(), loadPreview()]); setRefreshing(false); }} tintColor={colors.hate} />}>
        <GameCardView game={game} now={now} big />

        {game.league === 'f1' && game.state === 'pre' && preview ? (
          <F1PreviewView preview={preview} current={game.key} />
        ) : game.league === 'f1' ? (
          <>
            <SectionHeader>Running order</SectionHeader>
            <View style={styles.list}>
              {(game.order ?? []).map((d) => (
                <View key={d.key} style={[styles.line, mine.has(d.key) && styles.mine]}>
                  <Text style={styles.when}>{d.position ? `P${d.position}` : '–'}</Text>
                  <Text style={[styles.text, mine.has(d.key) && { color: colors.text, fontWeight: '800' }]}>{d.name}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            <View style={styles.tabs} accessibilityRole="tablist">
              {([['box', 'Box score'], ['highlights', 'Highlights']] as const).map(([id, label]) => (
                <Pressable key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabOn]}
                  accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
                  <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {tab === 'box' ? (
              detail?.box ? <BoxScoreView box={detail.box} tracked={follows} />
                : <Text style={styles.none}>{detail ? (game.state === 'pre' ? 'The box score shows up here once it starts.' : 'No box score yet.') : 'Loading…'}</Text>
            ) : detail?.clips?.length || detail?.keyPlays?.length ? (
              <HighlightsView clips={detail.clips ?? []} plays={detail.keyPlays ?? []} now={now} />
            ) : <Text style={styles.none}>{detail ? (game.state === 'pre' ? 'Highlights show up here once it starts.' : 'No highlights yet.') : 'Loading…'}</Text>}
          </>
        )}

        <Pressable onPress={toggleAlerts} style={({ pressed }) => [styles.alertsHead, pressed && { opacity: 0.6 }]} hitSlop={6}
          accessibilityRole="button" aria-expanded={alertsOpen} accessibilityHint={alertsOpen ? 'Minimizes your alerts' : 'Shows your alerts'}>
          <SectionHeader>Your alerts from this {leagueUi(game.league).game} · {alerts.length}</SectionHeader>
          <Ionicons name={alertsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textFaint} style={styles.alertsChevron} />
        </Pressable>
        {alertsOpen ? (alerts.length
          ? alerts.map((a) => <FeedCard key={a.id} item={a} now={now} />)
          : <Text style={styles.none}>Nothing yet. When something goes wrong for them, it lands here.</Text>) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  none: { color: colors.textFaint, fontSize: 14, paddingHorizontal: space(4), paddingVertical: space(2) },
  // Your alerts: the section's title and a chevron, the whole row a button that minimizes it.
  alertsHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: space(2) },
  alertsChevron: { paddingRight: space(4), paddingBottom: space(2) },
  list: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  line: { flexDirection: 'row', gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  mine: { backgroundColor: colors.hateDim },
  when: { color: colors.textFaint, fontSize: 12, fontWeight: '700', width: 64 },
  text: { color: colors.textDim, fontSize: 14, lineHeight: 19, flex: 1 },
  // Box score and play by play: edge-to-edge tabs, the open one underlined in red (as on a player's page).
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginTop: space(4), marginBottom: space(3) },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space(3), borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -StyleSheet.hairlineWidth },
  tabOn: { borderBottomColor: colors.hate },
  tabText: { color: colors.textDim, fontSize: 15, fontWeight: '800' },
  tabTextOn: { color: colors.text },
});
