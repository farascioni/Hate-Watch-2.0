import { useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar } from './Avatar';
import { LeagueTag } from './ui';
import { useStore } from '../lib/store';
import { colors, radius, space } from '../theme';
import type { HateWatchTally, Target } from '../lib/types';

const SHOWN = 3; // teams with a chip; "Show all" lists every one

/**
 * The top of Settings: how many Successful Hate Watches you've had (a team you track lost, or a tracked
 * player's team, counted under the team; F1, your constructor scored no points), and the teams that gave you the most. With more than three teams,
 * "+N more" expands it into the full list, most first. Counted on the server whatever your alert
 * settings are, so turning "Loses a game" off or clearing the feed doesn't reset it.
 */
export function HateWatchCounter() {
  const { hateWatches } = useStore();
  const [open, setOpen] = useState(false);
  const total = hateWatches?.total;
  const teams = hateWatches?.teams ?? [];
  const label = total === 1 ? 'Successful Hate Watch' : 'Successful Hate Watches';
  const more = teams.length > SHOWN;
  const toggle = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => !o); };

  return (
    <View style={styles.card}>
      <View style={styles.head} accessible accessibilityRole="summary"
        accessibilityLabel={total == null ? 'Successful Hate Watches, loading' : `${total} ${label}`}>
        <Text style={styles.count}>{total == null ? '–' : total.toLocaleString()}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{label}</Text>
          <Text style={styles.sub}>{total ? 'Each time a team you track lost.' : 'Your first one lands when a team you track loses.'}</Text>
        </View>
      </View>

      {open ? (
        <View style={styles.list}>
          {teams.map((t, i) => <Row key={t.target.key} team={t} last={i === teams.length - 1} />)}
        </View>
      ) : teams.length ? (
        <View style={styles.teams}>
          {teams.slice(0, SHOWN).map((t) => (
            <View key={t.target.key} style={styles.chip} accessible accessibilityLabel={`${short(t.target)}, ${t.count}`}>
              <Avatar target={t.target} size={22} />
              <Text style={styles.chipName} numberOfLines={1}>{short(t.target)}</Text>
              <Text style={styles.chipCount}>{t.count}</Text>
            </View>
          ))}
          {more ? (
            <Pressable onPress={toggle} style={({ pressed }) => [styles.chip, styles.moreChip, pressed && { opacity: 0.7 }]}
              accessibilityRole="button" accessibilityLabel={`Show all ${teams.length} teams`} aria-expanded={false} hitSlop={6}>
              <Text style={styles.more}>+{teams.length - SHOWN} more</Text>
              <Ionicons name="chevron-down" size={14} color={colors.textDim} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {open ? (
        <Pressable onPress={toggle} style={({ pressed }) => [styles.less, pressed && { opacity: 0.7 }]}
          accessibilityRole="button" accessibilityLabel="Show fewer teams" aria-expanded hitSlop={6}>
          <Text style={styles.more}>Show less</Text>
          <Ionicons name="chevron-up" size={14} color={colors.textDim} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One team in the full list: logo, name, league, and how many times they lost on you. */
function Row({ team: { target, count }, last }: { team: HateWatchTally['teams'][number]; last: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowLine]} accessible accessibilityLabel={`${target.name}, ${count} Successful Hate Watch${count === 1 ? '' : 'es'}`}>
      <Avatar target={target} size={28} />
      <Text style={styles.rowName} numberOfLines={1}>{target.name}</Text>
      <LeagueTag league={target.league} />
      <Text style={styles.rowCount}>{count}</Text>
    </View>
  );
}

// F1 constructors' ESPN short names are junk (Ferrari is "JK"), and their names are short already.
const short = (t: Target) => (t.kind === 'team' && t.league !== 'f1' ? t.shortName : t.name);

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), marginTop: space(4), padding: space(4), gap: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hateDim },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(4) },
  count: { color: colors.hate, fontSize: 44, fontWeight: '900', minWidth: 44, textAlign: 'center', fontVariant: ['tabular-nums'] },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 2, lineHeight: 17 },
  teams: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(2) },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), backgroundColor: colors.surfaceHi, borderRadius: radius.pill, paddingLeft: 3, paddingRight: space(2.5), paddingVertical: 3, maxWidth: '100%' },
  chipName: { color: colors.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  chipCount: { color: colors.hate, fontSize: 13, fontWeight: '900' },
  moreChip: { paddingLeft: space(2.5), minHeight: 28, gap: space(1) },
  more: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  list: { backgroundColor: colors.surfaceHi, borderRadius: radius.md, paddingHorizontal: space(3) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2.5), paddingVertical: space(2) },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowName: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  rowCount: { color: colors.hate, fontSize: 15, fontWeight: '900', minWidth: 24, textAlign: 'right', fontVariant: ['tabular-nums'] },
  less: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(1), alignSelf: 'center', paddingVertical: space(1), paddingHorizontal: space(3) },
});
