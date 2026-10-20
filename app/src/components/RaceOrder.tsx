import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutAnimation, StyleSheet, Text, View } from 'react-native';
import { reduceMotion } from '../lib/motion';
import { fromGrid, stopsText } from '../lib/scores';
import { useF1Tone, toneRow, toneName, toneMark, toneStyles, trackedRow, type F1Tone } from '../lib/f1Tone';
import { colors, HATE_RED, radius, space } from '../theme';
import type { GameCard, RaceDriver } from '../lib/types';
import { useT, tr } from '../lib/i18n';

/**
 * An F1 session's running order (the results once it's over), yours in red. A race or sprint on a newer server
 * has its timing: each car's gap to the leader and, under it, to the car ahead; its places since the start and
 * its pit stops; a car out of it says when. The name and that line wrap, so large text sizes fit.
 * When the order changes the rows slide to their new places (420 ms); when exactly two neighbours swap, the one that gained
 * the place flashes green and the one passed red for 900 ms (a pit-stop shuffle of several rows just slides). Not under reduce motion.
 */
export function RaceOrder({ game, mine }: { game: GameCard; mine: Set<string> }) {
  const t = useT();
  const order = game.order ?? [];
  const live = game.state === 'in';
  const timed = order.some((d) => d.gap || d.interval);
  const tone = useF1Tone();
  const keys = order.map((d) => d.key).join();
  const prev = useRef<string[] | null>(null);
  const [flash, setFlash] = useState<{ up: string; down: string } | null>(null);
  // A layout effect so the slide is armed before the new order is laid out; the rows keep their keys, so they move rather than remount.
  useLayoutEffect(() => {
    const before = prev.current, now = order.map((d) => d.key);
    prev.current = now;
    if (!before || before.join() === keys || before.length !== now.length || reduceMotion()) return;
    LayoutAnimation.configureNext({ duration: 420, update: { type: LayoutAnimation.Types.easeOut } });
    const moved = now.flatMap((k, i) => (before[i] === k ? [] : [i]));
    const [i, j] = moved;
    if (moved.length === 2 && j === i + 1 && before[i] === now[j] && before[j] === now[i]) setFlash({ up: now[i], down: now[j] });
  }, [keys]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(id);
  }, [flash]);
  return (
    <View style={styles.list}>
      {live && timed ? <Text style={styles.legend}>{t('race.legend')}</Text> : null}
      {order.map((d) => <Row key={d.key} d={d} mine={mine.has(d.key)} tone={tone(d.teamKey)} leader={live && timed && d.position === 1 && !d.out}
        flash={flash?.up === d.key ? 'up' : flash?.down === d.key ? 'down' : undefined} />)}
    </View>
  );
}

/** A tint that fades out over the row (900 ms): green for the place gained, red for the one lost. */
function Flash({ kind }: { kind: 'up' | 'down' }) {
  const a = useRef(new Animated.Value(0.35)).current;
  useEffect(() => { Animated.timing(a, { toValue: 0, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(); }, [a]);
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: kind === 'up' ? colors.live : HATE_RED, opacity: a }]} />;
}

function Row({ d, mine, tone, leader, flash }: { d: RaceDriver; mine: boolean; tone?: F1Tone; leader: boolean; flash?: 'up' | 'down' }) {
  const t = useT();
  const grid = fromGrid(d), stops = stopsText(d.pits);
  const detail = d.out ? [d.out] : [grid?.text, stops].filter(Boolean);
  const label = [`${d.position ? `P${d.position}` : t('race.noPosition')}, ${d.name}`, d.out ?? grid?.label, stops,
    leader ? t('race.leading') : d.gap ? t('race.toLeader', { gap: d.gap }) : null, d.interval ? t('race.toCar', { gap: d.interval }) : null].filter(Boolean).join(', ');
  return (
    <View style={[styles.line, mine && trackedRow, toneRow(tone)]} accessible accessibilityLabel={label}>
      {flash ? <Flash kind={flash} /> : null}
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
          <Text style={styles.gap}>{leader ? t('race.leader') : d.gap}</Text>
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
