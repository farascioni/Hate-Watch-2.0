import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Avatar } from '../../components/Avatar';
import { UpNextRow } from '../../components/UpNextRow';
import { Empty, LeagueTag, PrimaryButton, SectionHeader, subtitle, useNow } from '../../components/ui';
import { colors, radius, space } from '../../theme';
import type { GameLine, StatGroup, StatsPage, Target } from '../../lib/types';

/**
 * A player's or team's stats, from ESPN through the server (not F1 yet). Players: the season line ESPN
 * picks for their position, postseason and career, their last five games, and their team's next game.
 * Teams: record and standing, the season line, their last five results, and the next game. What a hater
 * wants to see (a hitter's strikeouts, a team's turnovers) is in red, and their losses are the good news.
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

      {page.record ? (
        <View style={styles.card}>
          <Text style={styles.record}>{page.record.overall}</Text>
          {page.record.standing ? <Text style={styles.standing}>{page.record.standing}</Text> : null}
          {page.record.splits.length ? <Text style={styles.splits}>{page.record.splits.map((s) => `${s.label} ${s.value}`).join('   ·   ')}</Text> : null}
        </View>
      ) : null}

      {page.groups.map((g) => <Group key={g.title} group={g} />)}

      {page.recent.length ? (
        <>
          <SectionHeader>Last {page.recent.length} {page.recent.length === 1 ? 'game' : 'games'}</SectionHeader>
          {target.kind === 'team' ? <Form games={page.recent} /> : null}
          <View style={styles.list}>{page.recent.map((g, i) => <GameRow key={g.id} game={g} last={i === page.recent.length - 1} />)}</View>
        </>
      ) : null}

      {page.next ? (
        <>
          <SectionHeader>Next game</SectionHeader>
          <View style={styles.list}><UpNextRow game={page.next} now={now} /></View>
        </>
      ) : null}

      {!page.groups.length && !page.recent.length && !page.record ? (
        <Empty emoji="📊" title="No stats yet" body="ESPN doesn't have numbers for them this season." />
      ) : <Text style={styles.footer}>Stats from ESPN, updated every 10 minutes. In red: the numbers worth gloating about.</Text>}
    </ScrollView>
  );
}

/** A stat line as a grid of tiles: the number, its label, and what it means ("Strikeouts"). */
function Group({ group }: { group: StatGroup }) {
  return (
    <>
      <SectionHeader>{group.title}</SectionHeader>
      <View style={styles.grid}>
        {group.tiles.map((t, i) => (
          <View key={`${t.label}-${i}`} style={[styles.tile, t.bad && styles.tileBad]} accessible accessibilityLabel={`${t.name}: ${t.value}`}>
            <Text style={[styles.value, t.bad && { color: colors.hate }]} numberOfLines={1} adjustsFontSizeToFit>{t.value}</Text>
            <Text style={styles.label} numberOfLines={1}>{t.label}</Text>
            <Text style={styles.full} numberOfLines={2}>{t.name}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

/** Their last results at a glance, oldest to newest: an L is a Successful Hate Watch, so it's the green one. */
function Form({ games }: { games: GameLine[] }) {
  return (
    <View style={styles.form} accessible accessibilityLabel={`Form: ${[...games].reverse().map((g) => g.result || '?').join(', ')}`}>
      {[...games].reverse().map((g) => (
        <View key={g.id} style={[styles.chip, g.result === 'L' ? styles.chipL : g.result === 'W' ? styles.chipW : styles.chipD]}>
          <Text style={[styles.chipText, g.result === 'L' && { color: colors.live }]}>{g.result || '–'}</Text>
        </View>
      ))}
    </View>
  );
}

/** "Oct 6 · @ TB · L 2-5", and a player's line in that game. */
function GameRow({ game, last }: { game: GameLine; last: boolean }) {
  const day = new Date(game.date).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <View style={[styles.gameRow, !last && styles.rowLine]}>
      <View style={styles.inline}>
        <Text style={styles.gameDay}>{day}</Text>
        <Text style={styles.gameVs}>{game.home ? 'vs' : '@'}</Text>
        {game.opponentLogo ? <Image source={{ uri: game.opponentLogo }} style={styles.logo} /> : null}
        <Text style={styles.gameOpp}>{game.opponent}</Text>
        <Text style={[styles.result, game.result === 'L' && { color: colors.live }, game.result === 'W' && { color: colors.textDim }]}>{game.result} {game.score}</Text>
      </View>
      {game.line ? <Text style={styles.line} numberOfLines={2}>{game.line}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(4), backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { color: colors.text, fontSize: 20, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  card: { marginHorizontal: space(3), marginTop: space(4), padding: space(4), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 2 },
  record: { color: colors.text, fontSize: 34, fontWeight: '900', fontVariant: ['tabular-nums'] },
  standing: { color: colors.text, fontSize: 15, fontWeight: '700' },
  splits: { color: colors.textDim, fontSize: 13, marginTop: space(1) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), paddingHorizontal: space(3) },
  tile: { width: '31.5%', flexGrow: 1, padding: space(2.5), backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 1 },
  tileBad: { borderColor: colors.hateDim, backgroundColor: '#1F1012' },
  value: { color: colors.text, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] },
  label: { color: colors.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  full: { color: colors.textFaint, fontSize: 11, lineHeight: 14 },
  form: { flexDirection: 'row', gap: space(1.5), paddingHorizontal: space(4), paddingBottom: space(2) },
  chip: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  chipL: { borderColor: colors.live, backgroundColor: '#0F2E1A' },
  chipW: { borderColor: colors.border, backgroundColor: colors.surface },
  chipD: { borderColor: colors.border, backgroundColor: colors.surfaceHi },
  chipText: { color: colors.textDim, fontWeight: '900', fontSize: 13 },
  list: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  gameRow: { paddingHorizontal: space(4), paddingVertical: space(3), gap: 4 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  gameDay: { color: colors.textDim, fontSize: 13, fontWeight: '700', width: 48 },
  gameVs: { color: colors.textFaint, fontSize: 13, fontWeight: '700', width: 18 },
  logo: { width: 20, height: 20 },
  gameOpp: { color: colors.text, fontSize: 15, fontWeight: '800', flex: 1 },
  result: { color: colors.text, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  line: { color: colors.textDim, fontSize: 12, marginLeft: 48 + space(2) },
  footer: { color: colors.textFaint, fontSize: 12, textAlign: 'center', paddingHorizontal: space(6), paddingTop: space(6) },
});
