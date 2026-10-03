import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Avatar } from '../../components/Avatar';
import { FeedCard } from '../../components/FeedCard';
import { FollowButton, LeagueTag, SectionHeader, TargetRow, subtitle, useNow } from '../../components/ui';
import { colors, space } from '../../theme';
import type { Player, Target } from '../../lib/types';

export default function TargetScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const targetKey = decodeURIComponent(key);
  const { feed } = useStore();
  const [target, setTarget] = useState<(Target & { roster?: Player[] }) | null>(null);
  const now = useNow();

  useEffect(() => { api.target(targetKey).then(setTarget).catch(() => {}); }, [targetKey]);
  const history = useMemo(() => feed.filter((f) => f.target.key === targetKey).slice(0, 20), [feed, targetKey]);

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
        <View style={{ marginTop: space(3) }}><FollowButton target={target} /></View>
      </View>
      {history.length ? <SectionHeader>Recent misery</SectionHeader> : null}
      {history.map((h) => <FeedCard key={h.id} item={h} now={now} />)}
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
});
