import { memo, useId, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar } from './Avatar';
import { AlsoGot, LeagueTag, ago } from './ui';
import { ClipPlayer, ClipThumb, duration, useNowPlaying } from './Clip';
import { shareAlert } from '../lib/share';
import { colors, radius, space } from '../theme';
import type { Clip, FeedItem } from '../lib/types';

export const FeedCard = memo(function FeedCard({ item, now, fresh }: { item: FeedItem; now: number; fresh?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [pressed, setPressed] = useState(false);
  const share = async () => {
    if ((await shareAlert(item)) === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // The alert opens its player's or team's page; its clip sits below, outside that tap area, so playing the
  // video (or its controls) never opens the page.
  return (
    <View style={[styles.card, fresh && styles.fresh, pressed && { backgroundColor: colors.surfaceHi }]}>
      <Pressable
        onPress={() => router.push(`/target/${encodeURIComponent(item.target.key)}`)}
        onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
        style={styles.row}
      >
        <View>
          <Avatar target={item.target} size={52} />
          <Text style={styles.emoji}>{item.emoji}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
          {item.alsoGot != null ? <AlsoGot n={item.alsoGot} /> : null}
          <View style={styles.meta}>
            <LeagueTag league={item.league} />
            <Text style={styles.metaText}>{item.typeLabel}</Text>
            <Text style={styles.metaDot}>•</Text>
            <Text style={styles.metaText}>{ago(item.occurredAt, now)}</Text>
          </View>
        </View>
        {/* Its own tap target: sharing doesn't open the player/team page behind it. */}
        <Pressable onPress={share} hitSlop={10} style={({ pressed }) => [styles.share, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={copied ? 'Copied to clipboard' : 'Share this alert'}>
          <Ionicons name={copied ? 'checkmark' : Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} size={20} color={copied ? colors.live : colors.textDim} />
          {copied ? <Text style={styles.copied}>Copied</Text> : null}
        </Pressable>
      </Pressable>
      {item.clip ? <AlertClip clip={item.clip} /> : null}
    </View>
  );
});

/** The alert's play on video, playing right here. */
function AlertClip({ clip }: { clip: Clip }) {
  const [open, toggle] = useNowPlaying(`alert:${useId()}`);
  return (
    <View style={styles.clip}>
      {open ? <ClipPlayer clip={clip} /> : null}
      <Pressable onPress={toggle} style={({ pressed }) => [styles.clipRow, pressed && { opacity: 0.7 }]} accessibilityRole="button"
        accessibilityLabel={`${open ? 'Close' : 'Watch'} the clip: ${clip.title}, ${duration(clip.seconds)}`}>
        <ClipThumb clip={clip} open={open} width={96} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={styles.watch}>{open ? 'Close' : 'Watch it'}</Text>
          <Text style={styles.clipTitle} numberOfLines={2}>{clip.title}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // In line with the alert's text (past the avatar).
  clip: { marginTop: space(3), marginLeft: 52 + space(3), borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceHi },
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: space(2.5), padding: space(2) },
  watch: { color: colors.hate, fontSize: 11, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  clipTitle: { color: colors.text, fontSize: 13, fontWeight: '700', lineHeight: 17 },
  card: { padding: space(4), marginHorizontal: space(3), marginBottom: space(2), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', gap: space(3) },
  fresh: { borderColor: colors.hate, shadowColor: colors.hate, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  emoji: { position: 'absolute', right: -6, bottom: -6, fontSize: 20 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800', lineHeight: 21 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), marginTop: 2, flexWrap: 'wrap' },
  metaText: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
  metaDot: { color: colors.textFaint, fontSize: 12 },
  share: { alignSelf: 'flex-start', alignItems: 'center', padding: space(1), marginTop: -space(1), marginRight: -space(1) },
  copied: { color: colors.live, fontSize: 10, fontWeight: '800', marginTop: 2 },
});
