import { useSyncExternalStore } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, radius } from '../theme';
import type { Clip } from '../lib/types';

// The one clip playing anywhere in the app (the feed, a game's Highlights): opening another closes it.
let playing: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
/** Whether this clip is the one playing, and a toggle: open it (closing any other), or close it. */
export function useNowPlaying(key: string): [boolean, () => void] {
  const on = useSyncExternalStore(subscribe, () => playing === key, () => false);
  return [on, () => { playing = playing === key ? null : key; for (const fn of listeners) fn(); }];
}

export const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** The clip's picture with a play (or stop) button and its length. */
export function ClipThumb({ clip, open, width }: { clip: Clip; open: boolean; width: number }) {
  return (
    <View style={[styles.thumb, { width }]}>
      {clip.thumb ? <Image source={{ uri: clip.thumb }} style={StyleSheet.absoluteFill} /> : null}
      <View style={styles.play}><Text style={styles.playIcon}>{open ? '■' : '▶'}</Text></View>
      <Text style={styles.length}>{duration(clip.seconds)}</Text>
    </View>
  );
}

/** The clip, open with the system's controls (full screen among them): it plays when you press play, never on its own. */
export function ClipPlayer({ clip }: { clip: Clip }) {
  // Browsers mostly can't play HLS; phones get the stream that adapts to the connection.
  const uri = Platform.OS === 'web' ? clip.mp4 ?? clip.hls : clip.hls ?? clip.mp4;
  const player = useVideoPlayer(uri);
  // If the stream won't play, the MP4 of the same clip.
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error' && clip.mp4 && uri !== clip.mp4) player.replaceAsync(clip.mp4).catch(() => {});
  });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} />;
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  thumb: { aspectRatio: 16 / 9, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceHi, alignItems: 'center', justifyContent: 'center' },
  play: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  playIcon: { color: '#fff', fontSize: 12 },
  length: { position: 'absolute', right: 4, bottom: 4, color: '#fff', fontSize: 11, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 4, borderRadius: 3, overflow: 'hidden', fontVariant: ['tabular-nums'] },
});
