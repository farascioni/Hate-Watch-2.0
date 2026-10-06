import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { useStore } from '../lib/store';
import { colors, radius, space } from '../theme';

const SHOWN = 3; // teams with a chip; the rest are "+N more"

/**
 * The top of Settings: how many Successful Hate Watches you've had (a team you track lost; F1, your
 * constructor scored no points), and the teams that gave you the most. Counted on the server whatever
 * your alert settings are, so turning "Loses a game" off or clearing the feed doesn't reset it.
 */
export function HateWatchCounter() {
  const { hateWatches } = useStore();
  const total = hateWatches?.total;
  const teams = hateWatches?.teams ?? [];
  const label = total === 1 ? 'Successful Hate Watch' : 'Successful Hate Watches';
  return (
    <View style={styles.card} accessible accessibilityRole="summary"
      accessibilityLabel={total == null ? 'Successful Hate Watches, loading' : `${total} ${label}${teams.length ? `: ${teams.map((t) => `${name(t.target)} ${t.count}`).join(', ')}` : ''}`}>
      <View style={styles.head}>
        <Text style={styles.count}>{total == null ? '–' : total.toLocaleString()}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{label}</Text>
          <Text style={styles.sub}>{total ? 'Each time a team you track lost.' : 'Your first one lands when a team you track loses.'}</Text>
        </View>
      </View>
      {teams.length ? (
        <View style={styles.teams}>
          {teams.slice(0, SHOWN).map((t) => (
            <View key={t.target.key} style={styles.chip}>
              <Avatar target={t.target} size={22} />
              <Text style={styles.chipName} numberOfLines={1}>{name(t.target)}</Text>
              <Text style={styles.chipCount}>{t.count}</Text>
            </View>
          ))}
          {teams.length > SHOWN ? <Text style={styles.more}>+{teams.length - SHOWN} more</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const name = (t: { kind: string; name: string; shortName: string | null }) => (t.kind === 'team' ? t.shortName ?? t.name : t.name);

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
  more: { color: colors.textFaint, fontSize: 13, fontWeight: '700' },
});
