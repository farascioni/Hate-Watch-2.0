import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ago } from './ui';
import { colors, radius, space } from '../theme';
import type { Clip, KeyPlay } from '../lib/types';

/**
 * A game's highlights: ESPN's video clips (newest first; one plays at a time, right in the list), then the
 * key plays: the scores, lead changes, turnovers, cards and ejections, each with the score after it, and
 * the plays that sent you alerts, shaded.
 */
export function HighlightsView({ clips, plays, now }: { clips: Clip[]; plays: KeyPlay[]; now: number }) {
  const [playing, setPlaying] = useState<string | null>(null);
  return (
    <View style={{ gap: space(3) }}>
      {clips.length ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Clips · {clips.length}</Text>
          {clips.map((c) => (
            <View key={c.id} style={styles.clip}>
              {playing === c.id ? <ClipPlayer clip={c} /> : null}
              <Pressable style={styles.clipRow} onPress={() => setPlaying(playing === c.id ? null : c.id)}
                accessibilityRole="button" accessibilityLabel={`${playing === c.id ? 'Close' : 'Play'} ${c.title}, ${duration(c.seconds)}`}>
                <View style={styles.thumb}>
                  {c.thumb ? <Image source={{ uri: c.thumb }} style={StyleSheet.absoluteFill} /> : null}
                  <View style={styles.play}><Text style={styles.playIcon}>{playing === c.id ? '■' : '▶'}</Text></View>
                  <Text style={styles.length}>{duration(c.seconds)}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.clipTitle} numberOfLines={3}>{c.title}</Text>
                  {c.at ? <Text style={styles.meta}>{ago(c.at, now)}</Text> : null}
                </View>
              </Pressable>
            </View>
          ))}
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

const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** The clip, playing as soon as it's open, with the system's controls (full screen among them). */
function ClipPlayer({ clip }: { clip: Clip }) {
  // Browsers mostly can't play HLS; phones get the stream that adapts to the connection.
  const uri = Platform.OS === 'web' ? clip.mp4 ?? clip.hls : clip.hls ?? clip.mp4;
  const player = useVideoPlayer(uri, (p) => { p.play(); });
  // On the web the setup's play() comes before the video is on the page: start it once it is.
  useEffect(() => { player.play(); }, [player]);
  // If the stream won't play, the MP4 of the same clip.
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error' && clip.mp4 && uri !== clip.mp4) player.replaceAsync(clip.mp4).then(() => player.play()).catch(() => {});
  });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} />;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  heading: { color: colors.text, fontSize: 12, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: space(3), paddingVertical: space(2.5), backgroundColor: colors.surfaceHi },
  clip: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3) },
  thumb: { width: 128, aspectRatio: 16 / 9, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceHi, alignItems: 'center', justifyContent: 'center' },
  play: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  playIcon: { color: '#fff', fontSize: 12 },
  length: { position: 'absolute', right: 4, bottom: 4, color: '#fff', fontSize: 11, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 4, borderRadius: 3, overflow: 'hidden', fontVariant: ['tabular-nums'] },
  clipTitle: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  meta: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  line: { flexDirection: 'row', gap: space(3), paddingHorizontal: space(3), paddingVertical: space(2.5), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  when: { color: colors.textFaint, fontSize: 12, fontWeight: '700', width: 64 },
  alerted: { backgroundColor: colors.hateDim },
  tag: { color: colors.hate, fontSize: 11, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  text: { color: colors.textDim, fontSize: 14, lineHeight: 19 },
  scoring: { color: colors.text, fontWeight: '800' },
});
