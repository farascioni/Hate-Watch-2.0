import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { Avatar } from '../../components/Avatar';
import { StatsView } from '../../components/StatsView';
import { Empty, LeagueTag, PrimaryButton, subtitle, useNow } from '../../components/ui';
import { colors, space } from '../../theme';
import type { StatsPage, Target } from '../../lib/types';

/**
 * A player's or team's stats on a screen of their own (components/StatsView). The player page shows the
 * same stats in its Stats tab; this screen stays for links that still open it.
 */
export default function StatsScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const targetKey = decodeURIComponent(key);
  const now = useNow();
  const [target, setTarget] = useState<Target | null>(null);
  const [page, setPage] = useState<StatsPage | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    api.target(targetKey).then(setTarget).catch(() => {});
    api.stats(targetKey).then(setPage).catch(() => setFailed(true));
  };
  useEffect(load, [targetKey]);

  const title = target ? (target.kind === 'team' ? target.abbrev : target.shortName ?? target.name) : 'Stats';
  if (failed) return (<><Stack.Screen options={{ title }} />
    <Empty emoji="📉" title="Couldn't load the stats" body="ESPN didn't answer. Check your connection and try again." action={<PrimaryButton label="Try again" onPress={load} />} /></>);
  if (!page || !target) return <View style={styles.center}><Stack.Screen options={{ title }} /><ActivityIndicator color={colors.hate} /></View>;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: space(12) }}>
      <Stack.Screen options={{ title: `${title} stats` }} />
      <View style={styles.head}>
        <Avatar target={target} size={56} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={styles.name} numberOfLines={1}>{target.name}</Text>
          <View style={styles.inline}>
            <LeagueTag league={target.league} />
            <Text style={styles.sub} numberOfLines={1}>{target.kind === 'player' ? [target.teamName, subtitle(target)].filter(Boolean).join(' · ') : subtitle(target)}</Text>
          </View>
        </View>
      </View>
      <StatsView page={page} target={target} now={now} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(4), backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { color: colors.text, fontSize: 20, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
});
