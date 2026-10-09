import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, radius, space } from '../theme';
import type { BoxGroup, BoxScore, BoxTeam } from '../lib/types';

/** What you track (the store's follows): a key's in it or not. */
type Tracked = { has: (key: string) => boolean };

/**
 * A game's box score, one team at a time (the one you track first): a table per stat group. The players
 * you track are highlighted, the numbers worth gloating about are in red, and a name opens that player.
 */
export function BoxScoreView({ box, tracked }: { box: BoxScore; tracked: Tracked }) {
  const mine = (t: BoxTeam) => tracked.has(t.key) || t.groups.some((g) => g.rows.some((r) => tracked.has(r.key)));
  const [pick, setPick] = useState<string | null>(null);
  const team = box.teams.find((t) => t.key === pick) ?? box.teams.find(mine) ?? box.teams[0];

  return (
    <View style={{ gap: space(3) }}>
      {box.teams.length > 1 ? (
        <View style={styles.teams} accessibilityRole="tablist">
          {box.teams.map((t) => {
            const on = t.key === team.key;
            return (
              <Pressable key={t.key} onPress={() => setPick(t.key)} style={[styles.team, on && styles.teamOn]}
                accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.abbrev}>
                {t.logo ? <Image source={{ uri: t.logo }} style={styles.logo} /> : null}
                <Text style={[styles.teamText, on && { color: colors.text }]}>{t.abbrev}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {team.groups.map((g) => <Table key={g.title} group={g} tracked={tracked} />)}
    </View>
  );
}

/** Each stat column as wide as its widest value, bold total or label (13px digits are about 7px wide). */
const widthOf = (g: BoxGroup, i: number) =>
  Math.round(Math.min(60, Math.max(26, 6 + Math.max(6.5 * g.columns[i].length, 7.4 * (g.totals?.[i]?.length ?? 0), 7.2 * Math.max(0, ...g.rows.map((r) => r.stats[i]?.length ?? 0))))));
// Enough for "J. McDaniels" next to the NBA's seven columns on a 375-point phone.
const NAME_MIN = 108;
const ROW_H = 38;

/**
 * A stat group: the names in a column of their own, the stats beside them. The names get whatever width
 * the stats leave (at least NAME_MIN); stats that don't fit next to that scroll sideways.
 */
function Table({ group, tracked }: { group: BoxGroup; tracked: Tracked }) {
  const widths = group.columns.map((_, i) => widthOf(group, i));
  const statsW = widths.reduce((a, b) => a + b, 0) + space(2);
  const [cardW, setCardW] = useState(0);
  const nameW = Math.max(NAME_MIN, cardW - statsW);
  const me = (key: string) => tracked.has(key);
  return (
    <View style={styles.card} onLayout={(e) => setCardW(e.nativeEvent.layout.width)}>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: nameW }}>
          <View style={[styles.nameCell, styles.head]}><Text style={styles.title} numberOfLines={1}>{group.title}</Text></View>
          {group.rows.map((r) => {
            const name = (
              <Text style={[styles.nameText, r.sub && styles.sub, me(r.key) && styles.meText]} numberOfLines={1}>
                {r.name}{r.detail ? <Text style={styles.detail}>  {r.detail}</Text> : null}
              </Text>
            );
            return r.link ? (
              <Pressable key={r.key} style={[styles.nameCell, r.sub && styles.indent, me(r.key) && styles.me]} onPress={() => router.push(`/target/${encodeURIComponent(r.key)}`)} accessibilityRole="link">{name}</Pressable>
            ) : <View key={r.key} style={[styles.nameCell, r.sub && styles.indent, me(r.key) && styles.me]}>{name}</View>;
          })}
          {group.totals ? <View style={[styles.nameCell, styles.totals]}><Text style={[styles.nameText, { color: colors.text, fontWeight: '800' }]}>Team</Text></View> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={cardW > 0 && nameW + statsW > cardW} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ flexGrow: 1, minWidth: statsW }}>
            <View style={[styles.statRow, styles.head]}>
              {group.columns.map((c, i) => <Text key={c} style={[styles.cell, styles.label, { width: widths[i] }]} numberOfLines={1}>{c}</Text>)}
            </View>
            {group.rows.map((r) => (
              <View key={r.key} style={[styles.statRow, me(r.key) && styles.me]}>
                {r.stats.map((v, i) => (
                  <Text key={i} style={[styles.cell, { width: widths[i] }, me(r.key) && { color: colors.text }, r.bad?.includes(i) && styles.bad]} numberOfLines={1}>{v}</Text>
                ))}
              </View>
            ))}
            {group.totals ? (
              <View style={[styles.statRow, styles.totals]}>
                {group.totals.map((v, i) => <Text key={i} style={[styles.cell, styles.total, { width: widths[i] }]} numberOfLines={1}>{v}</Text>)}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
      {group.note ? <Text style={styles.note}>{group.note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  teams: { flexDirection: 'row', gap: space(2), paddingHorizontal: space(3) },
  team: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2), paddingVertical: space(2), borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  teamOn: { borderColor: colors.hate, backgroundColor: colors.surfaceHi },
  teamText: { color: colors.textDim, fontSize: 15, fontWeight: '800' },
  logo: { width: 22, height: 22 },
  card: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  // Each row is a fixed height in both halves, so a name and its stats line up.
  nameCell: { height: ROW_H, justifyContent: 'center', paddingLeft: space(3), paddingRight: space(1), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  statRow: { height: ROW_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: space(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  head: { backgroundColor: colors.surfaceHi },
  title: { color: colors.text, fontSize: 12, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  indent: { paddingLeft: space(6) },
  nameText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  sub: { color: colors.textFaint },
  detail: { color: colors.textFaint, fontSize: 11, fontWeight: '700' },
  me: { backgroundColor: colors.hateDim },
  meText: { color: colors.text, fontWeight: '800' },
  label: { color: colors.textFaint, fontSize: 11, fontWeight: '800' },
  cell: { color: colors.textDim, fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums'] },
  bad: { color: colors.hate, fontWeight: '900' },
  totals: { backgroundColor: colors.surfaceHi, borderBottomWidth: 0 },
  total: { color: colors.text, fontWeight: '800', fontSize: 12 }, // a total like "52-104" in bold, in its column
  note: { color: colors.textFaint, fontSize: 12, paddingHorizontal: space(3), paddingVertical: space(2), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
