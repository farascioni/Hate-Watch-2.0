import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { UfcBoutRow, UfcFightView, cardDate, fightTime } from '../../components/UfcCard';
import { Empty, LeagueTag, SectionHeader, useNow } from '../../components/ui';
import { colors, space } from '../../theme';
import type { UfcCard } from '../../lib/types';

/** How often the card re-reads once the night is under way (the server reads ESPN every 20 seconds then). */
const LIVE_MS = 30_000;
/** Under way: from 5 minutes before the start until every fight is over or off, between fights too (the server's rule). */
const EARLY_MS = 5 * 60_000;

/**
 * A UFC card (from the Scores tab's UFC chip): where and when each segment's on, one fight in full on top (the
 * one tapped on Scores, else your fighter's, else the main event), then every fight, top of the bill first. A
 * fight tapped in the list goes on top. Under way, it re-reads every 30 seconds: rounds, results, the next fight starting.
 */
export default function UfcCardScreen() {
  const { event, fight } = useLocalSearchParams<{ event: string; fight?: string }>();
  const { follows } = useStore();
  const [card, setCard] = useState<UfcCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setPicked] = useState<string | null>(fight ?? null);
  const scroll = useRef<ScrollView>(null);
  const load = useCallback(() => api.ufcCard(decodeURIComponent(event)).then((c) => { setCard(c); setFailed(false); }, () => setFailed(true)), [event]);
  useEffect(() => { load(); }, [load]);
  const now = useNow();
  const underway = !!card && now >= card.event.startsAt - EARLY_MS && card.segments.some((s) => s.bouts.some((b) => b.state !== 'post' && !b.canceled));
  useEffect(() => {
    if (!underway) return;
    const t = setInterval(() => { load(); }, LIVE_MS);
    return () => clearInterval(t);
  }, [underway, load]);

  if (!card) {
    return failed
      ? <Empty emoji="🥊" title="No preview for this card" body="ESPN doesn't have it right now. Try again in a bit." />
      : <View style={styles.center}><ActivityIndicator color={colors.hate} /></View>;
  }
  const all = card.segments.flatMap((s) => s.bouts.map((b) => ({ b, s })));
  const top = all.find((x) => x.b.id === picked) ?? all.find((x) => x.b.corners.some((c) => follows.has(c.key))) ?? all[0];
  const { event: ev } = card;
  return (
    <>
      <Stack.Screen options={{ title: ev.name.split(': ')[1] ?? ev.name }} />
      <ScrollView ref={scroll} style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.hate} />}>
        <View style={styles.hero}>
          <LeagueTag league="ufc" />
          <Text style={styles.name}>{ev.name}</Text>
          <Text style={styles.sub}>{[cardDate(ev.startsAt), [ev.venue, ev.place].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</Text>
          <Text style={styles.faint}>{[...card.segments].reverse().map((s) => `${s.name} ${fightTime(s.startsAt)}`).join(' · ')}{card.segments[0]?.broadcast ? ` · ${card.segments[0].broadcast}` : ''}</Text>
        </View>
        {top ? <UfcFightView bout={top.b} startsAt={top.s.startsAt} segment={top.s.name} /> : null}
        {card.segments.map((s) => (
          <View key={s.id}>
            <SectionHeader>{s.name} · {fightTime(s.startsAt)}</SectionHeader>
            {s.bouts.map((b) => (
              <UfcBoutRow key={b.id} bout={b} selected={b.id === top?.b.id} onPress={() => { setPicked(b.id); scroll.current?.scrollTo({ y: 0, animated: true }); }} />
            ))}
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  hero: { alignItems: 'center', gap: space(1.5), paddingVertical: space(5), paddingHorizontal: space(4), backgroundColor: colors.surface, borderBottomWidth: 3, borderBottomColor: colors.hate },
  name: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  sub: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
  faint: { color: colors.textFaint, fontSize: 13, textAlign: 'center' },
});
