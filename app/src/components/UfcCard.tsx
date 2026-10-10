import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SectionHeader } from './ui';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { colors, radius, space } from '../theme';
import type { StatsPage, UfcBout, UfcCorner } from '../lib/types';

export const fightTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const cardDate = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const openPage = (c: UfcCorner) => router.push(`/target/${encodeURIComponent(c.key)}`);
/** "Middleweight · 5 rounds · Main event". */
const boutMeta = (b: UfcBout) => [b.weight, `${b.rounds} rounds`, b.billing].filter(Boolean).join(' · ');
const beltWord = (c: UfcCorner) => (c.belt === 'champion' ? 'Champion' : c.belt === 'interim' ? 'Interim champion' : null);
/** Where a fight is: live (its round), over, called off; nothing before it starts (its segment's time is above it). */
function stateWord(b: UfcBout): { text: string; color: string } | null {
  if (b.canceled) return { text: 'Cancelled', color: colors.textFaint };
  if (b.state === 'in') return { text: b.round ? `Live · R${b.round}` : 'Live', color: colors.live };
  if (b.state === 'post') return { text: 'Final', color: colors.textDim };
  return null;
}

/**
 * A fight on a card: its weight, rounds and billing (its belt under), each fighter with their record and, before
 * it, their odds to win; once it's over, who won and how. A tracked fighter's line is highlighted. `onPress`:
 * the Scores tab opens the card on it; the card's screen shows it on top.
 */
export function UfcBoutRow({ bout, onPress, selected }: { bout: UfcBout; onPress: () => void; selected?: boolean }) {
  const { follows } = useStore();
  const state = stateWord(bout);
  const over = bout.state === 'post' && !bout.canceled;
  const fav = bout.corners.find((c) => (c.chance ?? 0) > 50);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.bout, selected && { borderColor: colors.hate }, pressed && { backgroundColor: colors.surfaceHi }]}
      accessibilityRole="button" accessibilityLabel={`${bout.corners.map((c) => c.name).join(' versus ')}. ${boutMeta(bout)}${bout.title ? `, ${bout.title}` : ''}${state ? `. ${state.text}` : ''}${bout.result ? `. ${bout.result.line}` : ''}`}>
      <View style={styles.boutHead}>
        <Text style={styles.meta} numberOfLines={1}>{boutMeta(bout)}</Text>
        {state ? <Text style={[styles.state, { color: state.color }]}>{state.text}</Text> : null}
      </View>
      {bout.title ? <Text style={styles.belt}>{bout.title}</Text> : null}
      {bout.corners.map((c) => {
        const mine = follows.has(c.key), strong = over ? c.winner === true : c === fav;
        return (
          <View key={c.key} style={[styles.corner, mine && styles.mine]}>
            <Text style={[styles.name, strong && styles.strong, over && c.winner === false && { color: colors.textFaint }]} numberOfLines={1}>
              {c.name}{beltWord(c) ? <Text style={styles.tag}>  {beltWord(c)}</Text> : null}
            </Text>
            {c.record ? <Text style={styles.record}>{c.record}</Text> : null}
            <Text style={[styles.side, over && c.winner && { color: colors.text }]}>{over ? (c.winner ? 'W' : c.winner === false ? 'L' : '') : c.odds?.win ?? ''}</Text>
          </View>
        );
      })}
      {bout.result ? <Text style={styles.result}>{[bout.result.line, bout.result.detail].filter(Boolean).join(' · ')}</Text> : null}
    </Pressable>
  );
}

/** A fighter's record by how, from their stats page's tiles: "6 KO · 14 sub"; "Never" when nothing of the kind. */
function byHow(page: StatsPage | undefined, ko: string, sub: string, none: string): string | null {
  const tiles = page?.groups.flatMap((g) => g.tiles) ?? [];
  const n = (label: string) => tiles.find((t) => t.label === label)?.value;
  if (n(ko) == null && n(sub) == null) return null;
  return Number(n(ko) ?? 0) + Number(n(sub) ?? 0) === 0 ? none : `${n(ko) ?? 0} KO · ${n(sub) ?? 0} sub`;
}

/**
 * One fight in full, on top of a card's screen: who (each name opens their page), the result once it's in, the
 * line's chances (you track one of them: the chance they lose, and how they'd lose by the odds on their opponent
 * each way), the tale of the tape with each one's record by how, and their last five fights. Where your fighter's
 * opponent is ahead on a number, it's red. Anything ESPN lacks is left out.
 */
export function UfcFightView({ bout, startsAt, segment }: { bout: UfcBout; startsAt: number; segment: string }) {
  const { follows } = useStore();
  const [pages, setPages] = useState<Record<string, StatsPage>>({});
  useEffect(() => {
    let live = true;
    setPages({});
    for (const c of bout.corners.filter((x) => x.linked)) api.stats(c.key).then((p) => { if (live) setPages((m) => ({ ...m, [c.key]: p })); }, () => {});
    return () => { live = false; };
  }, [bout.corners[0].key, bout.corners[1].key]);

  const mineIx = bout.corners.findIndex((c) => follows.has(c.key));
  const both = bout.corners.every((c) => follows.has(c.key));
  const me = mineIx >= 0 && !both ? bout.corners[mineIx] : null, them = me ? bout.corners[1 - mineIx] : null;
  const over = bout.state === 'post' && !bout.canceled;
  const winner = bout.corners.find((c) => c.winner === true);
  const [a, b] = bout.corners;
  const ways = (c: UfcCorner) => [c.odds?.ko && `KO/TKO ${c.odds.ko}`, c.odds?.decision && `decision ${c.odds.decision}`, c.odds?.sub && `submission ${c.odds.sub}`].filter(Boolean).join(' · ');
  const tape = [
    ...bout.tape,
    ...[['Wins by', 'KO W', 'SUB W', 'None'], ['Finished', 'KO L', 'SUB L', 'Never']].map(([label, ko, sub, none]) => ({ label, values: [byHow(pages[a.key], ko, sub, none), byHow(pages[b.key], ko, sub, none)] as [string | null, string | null] }))
      .filter((r) => r.values.some((v) => v != null)),
  ];

  return (
    <View>
      <SectionHeader>{[me ? 'Your fighter' : both ? 'Your fighters' : null, bout.billing ?? segment].filter(Boolean).join(' · ')}</SectionHeader>
      <View style={styles.box}>
        <Text style={[styles.meta, { padding: space(3), paddingBottom: space(1) }]}>{[bout.weight, `${bout.rounds} rounds`, bout.state === 'pre' && !bout.canceled ? fightTime(startsAt) : null].filter(Boolean).join(' · ')}</Text>
        {bout.title ? <Text style={[styles.belt, { paddingHorizontal: space(3) }]}>{bout.title}</Text> : null}
        {bout.corners.map((c) => (
          <Pressable key={c.key} disabled={!c.linked} onPress={() => openPage(c)} accessibilityRole={c.linked ? 'link' : undefined}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHi }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.inline}>
                <Text style={[styles.fighter, over && c.winner === false && { color: colors.textDim }]} numberOfLines={1}>{c.name}</Text>
                {follows.has(c.key) ? <Text style={styles.tracking}>Tracking</Text> : null}
              </View>
              {[c.record, beltWord(c)].some(Boolean) ? <Text style={styles.record}>{[c.record, beltWord(c)].filter(Boolean).join(' · ')}</Text> : null}
            </View>
            <Text style={styles.side}>{over ? (c.winner ? 'W' : c.winner === false ? 'L' : '') : c.odds?.win ?? ''}</Text>
          </Pressable>
        ))}
        {bout.canceled ? <Text style={styles.foot}>This fight is off the card.</Text> : null}
        {over && bout.result ? (
          <Text style={[styles.foot, styles.strong, me && winner && winner !== me && { color: colors.hate }]}>
            {[winner ? `${winner.last} won` : null, bout.result.line, bout.result.detail].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {!over && !bout.canceled && a.chance != null && b.chance != null ? (
          <View style={styles.chance}>
            <View style={styles.chanceHead}>
              <Text style={styles.chanceLabel}>{me ? `Chance ${me.last} loses` : `${a.last} ${a.chance}% · ${b.last} ${b.chance}%`}</Text>
              {me ? <Text style={[styles.chanceLabel, { color: colors.hate, fontWeight: '800' }]}>{them!.chance}%</Text> : null}
            </View>
            <View style={styles.bar}><View style={[styles.fill, { width: `${me ? them!.chance! : a.chance}%` }, !me && { backgroundColor: colors.textDim }]} /></View>
            {me && ways(them!) ? <Text style={styles.ways}>How {me.last} could lose: {them!.last} by {ways(them!)}</Text>
              : !me ? [a, b].filter((c) => ways(c)).map((c) => <Text key={c.key} style={styles.ways}>{c.last} by {ways(c)}</Text>) : null}
            {bout.oddsBy ? <Text style={styles.by}>Odds: {bout.oddsBy}</Text> : null}
          </View>
        ) : null}
      </View>

      {tape.length ? (
        <>
          <SectionHeader>Tale of the tape</SectionHeader>
          <View style={styles.box}>
            <View style={styles.tapeRow}>
              <Text style={[styles.tapeL, styles.strong]} numberOfLines={1}>{a.last}</Text>
              <Text style={styles.tapeLabel} />
              <Text style={[styles.tapeR, styles.strong]} numberOfLines={1}>{b.last}</Text>
            </View>
            {tape.map((r) => {
              // The side ahead: red when it's your fighter's opponent, else just bolder.
              const tone = (i: 0 | 1) => ('edge' in r && r.edge === i ? (me && bout.corners[i] !== me ? { color: colors.hate } : styles.strong) : null);
              return (
                <View key={r.label} style={styles.tapeRow}>
                  <Text style={[styles.tapeL, tone(0)]}>{r.values[0] ?? '–'}</Text>
                  <Text style={styles.tapeLabel}>{r.label}</Text>
                  <Text style={[styles.tapeR, tone(1)]}>{r.values[1] ?? '–'}</Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {bout.corners.map((c) => (pages[c.key]?.recent.length ? (
        <View key={c.key}>
          <SectionHeader>{c.last}'s last {Math.min(5, pages[c.key].recent.length)}</SectionHeader>
          <View style={styles.box}>
            {pages[c.key].recent.slice(0, 5).map((g) => (
              <View key={g.id} style={styles.row}>
                <Text style={[styles.wl, { color: g.result === 'W' ? colors.live : g.result === 'L' ? colors.hate : colors.textDim }]}>{g.result}</Text>
                <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{g.opponent}</Text>
                <Text style={styles.record}>{[g.score, g.line].filter(Boolean).join(' · ')}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null))}
    </View>
  );
}

const styles = StyleSheet.create({
  bout: { marginHorizontal: space(3), marginBottom: space(2), paddingVertical: space(2.5), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  boutHead: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(3), marginBottom: space(1) },
  meta: { flex: 1, color: colors.textFaint, fontSize: 12, fontWeight: '700' },
  state: { fontSize: 12, fontWeight: '800' },
  belt: { color: colors.hate, fontSize: 12, fontWeight: '800', paddingHorizontal: space(3), marginBottom: space(1) },
  corner: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(3), paddingVertical: space(1.5) },
  mine: { backgroundColor: colors.hateDim },
  name: { flex: 1, color: colors.textDim, fontSize: 15 },
  strong: { color: colors.text, fontWeight: '800' },
  fighter: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '800' },
  tag: { color: colors.warn, fontSize: 12, fontWeight: '700' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  // The game cards' pill (GameCard).
  tracking: { color: colors.hate, fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: colors.hate, borderRadius: 6, paddingHorizontal: 5, overflow: 'hidden' },
  record: { color: colors.textFaint, fontSize: 13, fontVariant: ['tabular-nums'] },
  side: { color: colors.textDim, fontSize: 14, fontWeight: '700', minWidth: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },
  result: { color: colors.textDim, fontSize: 13, fontWeight: '700', paddingHorizontal: space(3), paddingTop: space(1.5) },
  box: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  foot: { color: colors.textDim, fontSize: 14, padding: space(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  chance: { padding: space(3), gap: space(1.5), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  chanceHead: { flexDirection: 'row', justifyContent: 'space-between', gap: space(2) },
  chanceLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.hate, borderRadius: 3 },
  ways: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  by: { color: colors.textFaint, fontSize: 12 },
  tapeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(3), paddingVertical: space(2), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tapeL: { flex: 1, color: colors.textDim, fontSize: 14, fontVariant: ['tabular-nums'] },
  tapeR: { flex: 1, color: colors.textDim, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] },
  tapeLabel: { flex: 1.3, color: colors.textFaint, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  wl: { width: 16, fontSize: 14, fontWeight: '900' },
});
