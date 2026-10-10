import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SectionHeader } from './ui';
import { useStore } from '../lib/store';
import { colors, radius, space } from '../theme';
import type { F1Preview } from '../lib/types';

const day = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** A driver's or constructor's page; one ESPN listed that the catalog lacks ('?') has none. */
const opens = (name: string) => name !== '?';
const open = (key: string) => router.push(`/target/${encodeURIComponent(key)}`);
const pressedBg = { backgroundColor: colors.surfaceHi };

/**
 * An F1 weekend before its race, as other sports' previews come before a game: where it is and its
 * sessions (one on the Scores tab opens its screen), the next grid once it's set, and the championship
 * with each driver's last three races. Tracked drivers and constructors (and a tracked constructor's
 * drivers) are highlighted; each name opens its page. `current`: the session whose screen this is, marked in the schedule.
 * ESPN has no F1 odds, so there are no win chances here.
 */
export function F1PreviewView({ preview, current }: { preview: F1Preview; current?: string }) {
  const { follows, games } = useStore();
  const mine = (key: string, teamKey?: string | null) => follows.has(key) || (!!teamKey && follows.has(teamKey));
  const { event, sessions, grid, gridAfter, drivers, constructors } = preview;
  // The championship: the top ten, and anyone tracked below them.
  const table = drivers.filter((d, i) => i < 10 || mine(d.key, d.teamKey));
  const teams = constructors.filter((t, i) => i < 5 || follows.has(t.key));
  return (
    <View>
      <SectionHeader>Where and when</SectionHeader>
      <View style={styles.list}>
        {event.circuit ? (
          <View style={styles.row}>
            <Text style={styles.when}>Circuit</Text>
            <Text style={styles.text}>{[event.circuit, event.place].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : null}
        {sessions.map((s) => {
          const open = games.has(s.key) && s.key !== current; // on the Scores tab: its own screen
          return (
            <Pressable key={s.key} disabled={!open} onPress={() => router.push(`/game/${encodeURIComponent(s.key)}`)}
              style={({ pressed }) => [styles.row, s.key === current && styles.mine, pressed && { backgroundColor: colors.surfaceHi }]}
              accessibilityRole={open ? 'button' : undefined} accessibilityLabel={`${s.name}, ${day(s.at)}, ${s.state === 'post' ? 'final' : s.state === 'in' ? 'live now' : time(s.at)}`}>
              <Text style={styles.when}>{day(s.at)}</Text>
              <Text style={[styles.text, (s.key === current || open) && styles.strong]}>{s.name}</Text>
              <Text style={[styles.side, s.state === 'in' && { color: colors.live }]}>{s.state === 'post' ? 'Final' : s.state === 'in' ? 'Live' : time(s.at)}</Text>
            </Pressable>
          );
        })}
      </View>

      {grid ? (
        <>
          <SectionHeader>Starting grid · {grid.session}</SectionHeader>
          <View style={styles.list}>
            {grid.cars.map((c) => (
              <Pressable key={c.key} disabled={!opens(c.name)} onPress={() => open(c.key)} accessibilityRole={opens(c.name) ? 'link' : undefined}
                style={({ pressed }) => [styles.row, mine(c.key, c.teamKey) && styles.mine, pressed && pressedBg]}>
                <Text style={styles.when}>P{c.grid}</Text>
                <Text style={[styles.text, mine(c.key, c.teamKey) && styles.strong]}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : gridAfter ? <Text style={styles.note}>The grid is set after {gridAfter}.</Text> : null}

      {table.length ? (
        <>
          <SectionHeader>Drivers' Championship</SectionHeader>
          <View style={styles.list}>
            {table.map((d) => (
              <Pressable key={d.key} disabled={!opens(d.name)} onPress={() => open(d.key)} accessibilityRole={opens(d.name) ? 'link' : undefined}
                style={({ pressed }) => [styles.row, mine(d.key, d.teamKey) && styles.mine, pressed && pressedBg]}>
                <Text style={styles.rank}>{d.rank}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.text, mine(d.key, d.teamKey) && styles.strong]} numberOfLines={1}>{d.name}</Text>
                  {d.form.length ? <Text style={styles.form} accessibilityLabel={`Last races: ${d.form.join(', ')}`}>Last races: {d.form.join(' · ')}</Text> : null}
                </View>
                <Text style={styles.side}>{d.points} pts</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {teams.length ? (
        <>
          <SectionHeader>Constructors' Championship</SectionHeader>
          <View style={styles.list}>
            {teams.map((t) => (
              <Pressable key={t.key} disabled={!opens(t.name)} onPress={() => open(t.key)} accessibilityRole={opens(t.name) ? 'link' : undefined}
                style={({ pressed }) => [styles.row, follows.has(t.key) && styles.mine, pressed && pressedBg]}>
                <Text style={styles.rank}>{t.rank}</Text>
                <Text style={[styles.text, follows.has(t.key) && styles.strong]} numberOfLines={1}>{t.name}</Text>
                <Text style={styles.side}>{t.points} pts</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

/**
 * A full starting grid, two cars a row as they line up (P1 left, P2 right): under a sprint or race in
 * Scores' Upcoming races. Tracked drivers (and a tracked constructor's) highlighted; each opens its page.
 */
export function F1Grid({ grid }: { grid: NonNullable<F1Preview['grid']> }) {
  const { follows } = useStore();
  const mine = (c: { key: string; teamKey: string | null }) => follows.has(c.key) || (!!c.teamKey && follows.has(c.teamKey));
  const rows = Array.from({ length: Math.ceil(grid.cars.length / 2) }, (_, i) => grid.cars.slice(i * 2, i * 2 + 2));
  return (
    <View style={styles.gridBox} accessibilityLabel={`Starting grid for the ${grid.session}: ${grid.cars.map((c) => `P${c.grid} ${c.name}`).join(', ')}`}>
      <Text style={styles.gridTitle}>Starting grid</Text>
      {rows.map((pair, i) => (
        <View key={i} style={styles.gridRow}>
          {pair.map((c) => (
            <Pressable key={c.key} disabled={!opens(c.name)} onPress={() => open(c.key)} accessibilityRole={opens(c.name) ? 'link' : undefined}
              accessibilityLabel={`P${c.grid} ${c.name}`} style={({ pressed }) => [styles.gridCell, mine(c) && styles.mine, pressed && pressedBg]}>
              <Text style={styles.gridPos}>P{c.grid}</Text>
              <Text style={[styles.gridName, mine(c) && styles.strong]} numberOfLines={1}>{c.name}</Text>
            </Pressable>
          ))}
          {pair.length < 2 ? <View style={styles.gridCell} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  mine: { backgroundColor: colors.hateDim },
  when: { color: colors.textFaint, fontSize: 12, fontWeight: '700', width: 84 },
  rank: { color: colors.textFaint, fontSize: 13, fontWeight: '800', width: 22, textAlign: 'right', fontVariant: ['tabular-nums'] },
  text: { color: colors.textDim, fontSize: 14, lineHeight: 19, flex: 1 },
  strong: { color: colors.text, fontWeight: '800' },
  side: { color: colors.textDim, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  form: { color: colors.textFaint, fontSize: 12, marginTop: 1 },
  note: { color: colors.textFaint, fontSize: 14, paddingHorizontal: space(4), paddingTop: space(3) },
  gridBox: { marginHorizontal: space(3), marginTop: -space(1), marginBottom: space(3), padding: space(2), gap: space(1), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  gridTitle: { color: colors.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: space(1), paddingBottom: space(0.5) },
  gridRow: { flexDirection: 'row', gap: space(1) },
  gridCell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space(1.5), paddingHorizontal: space(2), paddingVertical: space(1.5), borderRadius: radius.sm },
  gridPos: { color: colors.textFaint, fontSize: 12, fontWeight: '800', width: 26, fontVariant: ['tabular-nums'] },
  gridName: { color: colors.textDim, fontSize: 13, flex: 1 },
});
