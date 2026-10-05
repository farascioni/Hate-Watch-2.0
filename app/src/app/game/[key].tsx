import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { GameCardView } from '../../components/GameCard';
import { FeedCard } from '../../components/FeedCard';
import { Empty, SectionHeader, useNow } from '../../components/ui';
import { trackedDrivers } from '../../lib/scores';
import { colors, radius, space } from '../../theme';
import type { FeedItem, GameDetail } from '../../lib/types';

/**
 * One game from the Scores tab: the live score card, your alerts from this game, and the play-by-play
 * (F1: the running order). The card stays live over the socket; plays refresh every 15s while live.
 */
export default function GameScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const gameKey = decodeURIComponent(key);
  const { games, feed, follows } = useStore();
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  const game = games.get(gameKey) ?? detail?.game;

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.hate} />}>
        <GameCardView game={game} now={now} big />

        <SectionHeader>Your alerts from this game · {alerts.length}</SectionHeader>
        {alerts.length
          ? alerts.map((a) => <FeedCard key={a.id} item={a} now={now} />)
          : <Text style={styles.none}>Nothing yet. When something goes wrong for them, it lands here.</Text>}

        {game.league === 'f1' ? (
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
            <SectionHeader>Play by play</SectionHeader>
            {detail?.plays.length ? (
              <View style={styles.list}>
                {detail.plays.map((p) => (
                  <View key={p.id} style={styles.line}>
                    <Text style={styles.when}>{p.when}</Text>
                    <Text style={[styles.text, p.scoring && { color: colors.text, fontWeight: '800' }]}>{p.text}</Text>
                  </View>
                ))}
              </View>
            ) : <Text style={styles.none}>{detail ? (game.state === 'pre' ? 'Plays show up here once it starts.' : 'No plays yet.') : 'Loading…'}</Text>}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  none: { color: colors.textFaint, fontSize: 14, paddingHorizontal: space(4), paddingVertical: space(2) },
  list: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  line: { flexDirection: 'row', gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  mine: { backgroundColor: colors.hateDim },
  when: { color: colors.textFaint, fontSize: 12, fontWeight: '700', width: 64 },
  text: { color: colors.textDim, fontSize: 14, lineHeight: 19, flex: 1 },
});
