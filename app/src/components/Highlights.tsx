import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ago } from './ui';
import { ClipPlayer, ClipThumb, duration, useNowPlaying } from './Clip';
import { colors, radius, space } from '../theme';
import type { Clip, KeyPlay } from '../lib/types';

/**
 * A game's highlights: ESPN's video clips (newest first; one plays at a time, right in the list), then the
 * key plays: the scores, lead changes, turnovers, cards and ejections, each with the score after it, and
 * the plays that sent you alerts, shaded.
 */
export function HighlightsView({ clips, plays, now }: { clips: Clip[]; plays: KeyPlay[]; now: number }) {
  return (
    <View style={{ gap: space(3) }}>
      {clips.length ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Clips · {clips.length}</Text>
          {clips.map((c) => <ClipRow key={c.id} clip={c} now={now} />)}
        </View>
      ) : null}
      {plays.length ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Key plays</Text>
          {plays.map((p) => (
            <View key={p.id} style={[styles.line, p.alerted && styles.alerted]}>
              <Text style={styles.when}>{p.when}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                {p.tag || p.alerted ? <Text style={[styles.tag, p.alerted && { color: colors.text }]}>{[p.tag, p.alerted && 'Your alert'].filter(Boolean).join(' · ')}</Text> : null}
                <Text style={[styles.text, p.scoring && styles.scoring]}>{p.text}</Text>
                {p.score ? <Text style={styles.meta}>{p.score}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ClipRow({ clip, now }: { clip: Clip; now: number }) {
  const [open, toggle] = useNowPlaying(`highlights:${clip.id}`);
  return (
    <View style={styles.clip}>
      {open ? <ClipPlayer clip={clip} /> : null}
      <Pressable style={styles.clipRow} onPress={toggle} accessibilityRole="button" accessibilityLabel={`${open ? 'Close' : 'Play'} ${clip.title}, ${duration(clip.seconds)}`}>
        <ClipThumb clip={clip} open={open} width={128} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.clipTitle} numberOfLines={3}>{clip.title}</Text>
          {clip.at ? <Text style={styles.meta}>{ago(clip.at, now)}</Text> : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  heading: { color: colors.text, fontSize: 12, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: space(3), paddingVertical: space(2.5), backgroundColor: colors.surfaceHi },
  clip: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3) },
  clipTitle: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  meta: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  line: { flexDirection: 'row', gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  alerted: { backgroundColor: colors.hateDim },
  when: { color: colors.textFaint, fontSize: 12, fontWeight: '700', width: 64 },
  tag: { color: colors.hate, fontSize: 11, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  text: { color: colors.textDim, fontSize: 14, lineHeight: 19 },
  scoring: { color: colors.text, fontWeight: '800' },
});
