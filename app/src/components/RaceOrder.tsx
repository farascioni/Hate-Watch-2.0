import { StyleSheet, Text, View } from 'react-native';
import { fromGrid, stopsText } from '../lib/scores';
import { useF1Tone, toneRow, toneName, toneMark, toneStyles, type F1Tone } from '../lib/f1Tone';
import { colors, radius, space } from '../theme';
import type { GameCard, RaceDriver } from '../lib/types';

/**
 * An F1 session's running order (the results once it's over), yours in red. A race or sprint on a newer server
 * has its timing: each car's gap to the leader and, under it, to the car ahead; its places since the start and
 * its pit stops; a car out of it says when. The name and that line wrap, so large text sizes fit.
 */
export function RaceOrder({ game, mine }: { game: GameCard; mine: Set<string> }) {
  const order = game.order ?? [];
  const live = game.state === 'in';
  const timed = order.some((d) => d.gap || d.interval);
  const tone = useF1Tone();
  return (
    <View style={styles.list}>
      {live && timed ? <Text style={styles.legend}>Gap to the leader, and to the car ahead</Text> : null}
      {order.map((d) => <Row key={d.key} d={d} mine={mine.has(d.key)} tone={tone(d.teamKey)} leader={live && timed && d.position === 1 && !d.out} />)}
    </View>
  );
}

function Row({ d, mine, tone, leader }: { d: RaceDriver; mine: boolean; tone?: F1Tone; leader: boolean }) {
  const grid = fromGrid(d), stops = stopsText(d.pits);
  const detail = d.out ? [d.out] : [grid?.text, stops].filter(Boolean);
  const label = [`${d.position ? `P${d.position}` : 'No position'}, ${d.name}`, d.out ?? grid?.label, stops,
    leader ? 'leading' : d.gap ? `${d.gap} to the leader` : null, d.interval ? `${d.interval} to the car ahead` : null].filter(Boolean).join(', ');
  return (
    <View style={[styles.line, mine && styles.mine, toneRow(tone)]} accessible accessibilityLabel={label}>
      <Text style={styles.pos}>{d.position ? `P${d.position}` : '–'}</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[styles.name, d.out && styles.outName, mine && styles.nameMine, toneName(tone)]}>{d.name}{tone ? <Text style={toneStyles.mark}>{` ${toneMark[tone]}`}</Text> : null}</Text>
        {detail.length ? (
          <Text style={styles.detail}>
            {d.out ? <Text style={mine ? styles.bad : undefined}>{d.out}</Text>
              : <>{grid ? <Text style={mine && grid.lost ? styles.bad : undefined}>{grid.text}</Text> : null}{grid && stops ? ' · ' : ''}{stops}</>}
          </Text>
        ) : null}
      </View>
      {leader || d.gap ? (
        <View style={styles.gaps}>
          <Text style={styles.gap}>{leader ? 'Leader' : d.gap}</Text>
          {d.interval ? <Text style={styles.interval}>{d.interval}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  legend: { color: colors.textFaint, fontSize: 11, fontWeight: '700', textAlign: 'right', paddingHorizontal: space(3), paddingTop: space(2), paddingBottom: space(1) },
  line: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  mine: { backgroundColor: colors.hateDim },
  // As wide as "P22" needs at the text size (it grows rather than wrap at large ones).
  pos: { color: colors.textFaint, fontSize: 12, fontWeight: '700', minWidth: 32, flexShrink: 0, fontVariant: ['tabular-nums'] },
  name: { color: colors.textDim, fontSize: 14, lineHeight: 19 },
  nameMine: { color: colors.text, fontWeight: '800' },
  outName: { color: colors.textFaint },
  detail: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  // Your driver's places lost, or out of it: their bad afternoon, in the colour of good news here.
  bad: { color: colors.hateText, fontWeight: '700' },
  gaps: { alignItems: 'flex-end', flexShrink: 0 },
  gap: { color: colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  interval: { color: colors.textFaint, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
