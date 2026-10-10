import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { weekendDates } from '../../lib/scores';
import { F1PreviewView } from '../../components/F1Preview';
import { Empty, LeagueTag } from '../../components/ui';
import { colors, space } from '../../theme';
import type { F1Preview } from '../../lib/types';

/** An F1 race weekend ahead (from the Scores tab's next weekend): where, when, the grid once it's set, the championship. */
export default function F1WeekendScreen() {
  const { event } = useLocalSearchParams<{ event: string }>();
  const [preview, setPreview] = useState<F1Preview | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => api.f1Preview(decodeURIComponent(event)).then((p) => { setPreview(p); setFailed(false); }, () => setFailed(true)), [event]);
  useEffect(() => { load(); }, [load]);

  if (!preview) {
    return failed
      ? <Empty emoji="🏁" title="No preview for this weekend" body="ESPN doesn't have it yet. Try again closer to the weekend." />
      : <View style={styles.center}><ActivityIndicator color={colors.hate} /></View>;
  }
  const { event: ev } = preview;
  return (
    <>
      <Stack.Screen options={{ title: ev.shortName }} />
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.hate} />}>
        <View style={styles.hero}>
          <LeagueTag league="f1" />
          <Text style={styles.name}>{ev.name}</Text>
          <Text style={styles.sub}>{weekendDates(ev.startsAt, ev.endsAt)}</Text>
        </View>
        <F1PreviewView preview={preview} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  hero: { alignItems: 'center', gap: space(1.5), paddingVertical: space(5), paddingHorizontal: space(4), backgroundColor: colors.surface, borderBottomWidth: 3, borderBottomColor: colors.hate },
  name: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  sub: { color: colors.textDim, fontSize: 14 },
});
