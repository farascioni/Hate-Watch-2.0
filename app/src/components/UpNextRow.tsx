import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar } from './Avatar';
import { LeagueTag } from './ui';
import { useStore } from '../lib/store';
import { upNextWhen } from '../lib/scores';
import { colors, space } from '../theme';
import type { NextGame } from '../lib/types';

/**
 * One tracked team's next game in "Up next": "Falcons vs Ravens", "NBC", and when ("Sun" / "8:20 PM").
 * The tracked team comes first; two tracked teams in one game read "Saints at Falcons". Tapping it
 * opens the tracked team's page.
 */
export function UpNextRow({ game, now }: { game: NextGame; now: number }) {
  const { follows } = useStore();
  const isMine = (key: string) => follows.has(key) || [...follows.values()].some((t) => t.kind === 'player' && t.teamKey === key);
  const both = isMine(game.home.key) && isMine(game.away.key);
  const homeIsMine = game.teamKey === game.home.key;
  const [mine, them] = homeIsMine ? [game.home, game.away] : [game.away, game.home];
  const title = both ? `${game.away.shortName} at ${game.home.shortName}` : `${mine.shortName} ${homeIsMine ? 'vs' : 'at'} ${them.shortName}`;
  // A team tracked through its players says whose: "Tracking Aaron Judge".
  const players = follows.has(mine.key) ? [] : [...follows.values()].filter((t) => t.kind === 'player' && t.teamKey === mine.key).map((t) => t.name);
  const sub = [players.length ? `Tracking ${players.join(', ')}` : '', game.note, game.tv].filter(Boolean).join(' · ');
  const when = upNextWhen(game.startsAt, game.timeValid, now);
  return (
    <Pressable onPress={() => router.push(`/target/${encodeURIComponent(mine.key)}`)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHi }]}
      accessibilityRole="button" accessibilityLabel={`${title}, ${when.day} ${when.time}${sub ? `, ${sub}` : ''}`}>
      <Avatar target={mine} size={36} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={styles.inline}>
          <LeagueTag league={game.league} />
          {sub ? <Text style={styles.sub} numberOfLines={1}>{sub}</Text> : null}
        </View>
      </View>
      <View style={styles.when}>
        <Text style={styles.day}>{when.day}</Text>
        <Text style={styles.time}>{when.time}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(2.5) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  title: { color: colors.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  sub: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
  when: { alignItems: 'flex-end', minWidth: 64 },
  day: { color: colors.text, fontSize: 13, fontWeight: '800' },
  time: { color: colors.textDim, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
