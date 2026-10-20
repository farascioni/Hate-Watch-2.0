import { memo, useEffect, useId, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppAvatar, Avatar } from './Avatar';
import { AlsoGot, LeagueTag, ago } from './ui';
import { ClipPlayer, ClipThumb, duration, useNowPlaying } from './Clip';
import { isNotice, openAlert, targetHref } from '../lib/alerts';
import { useShare } from './ShareStyleSheet';
import { useIsMostHated } from '../lib/mostHated';
import { toggleSavedAlert, useHasSaved, useIsSaved } from '../lib/savedAlerts';
import { usePlus } from '../lib/plus';
import { GOLD, HATE_RED, colors, radius, space } from '../theme';
import type { Clip, FeedItem } from '../lib/types';
import { useT } from '../lib/i18n';
import { reduceMotion, useOnChange, usePop } from '../lib/motion';

/** Alerts that already played their entrance, so scrolling one out of the list and back never replays it. */
const entered = new Set<string>();

export const FeedCard = memo(function FeedCard({ item, now, fresh, highlight }: { item: FeedItem; now: number; fresh?: boolean; highlight?: boolean }) {
  const tx = useT();
  const [pressed, setPressed] = useState(false);
  const { share, copied, sheet } = useShare(item);
  const check = usePop(1.4);
  useOnChange(copied, (_, n) => { if (n) check.pop(); });
  // Hate Watch Plus's alert vault: the star saves the alert. It pops when you tap it, not when the saved list finishes loading.
  const { active: plus } = usePlus();
  const saved = useIsSaved(item.id);
  const hasSaved = useHasSaved();
  const starAllowed = plus || hasSaved; // a lapsed subscriber's offline blip never hides the star on what's saved
  const starTapped = useRef(false);
  const star = usePop(1.5);
  useOnChange(saved, (_, n) => { if (starTapped.current && n) star.pop(); starTapped.current = false; });
  // A live alert lands: the card drops in, and a red wash fades over it (the static red border stays for the minute).
  // Decided once, so the first painted frame is already the start state (no flash of the finished card).
  const plays = useRef(!!fresh && !entered.has(item.id) && !reduceMotion()).current;
  const enter = useRef(new Animated.Value(plays ? 0 : 1)).current;
  const pulse = useRef(new Animated.Value(plays ? 1 : 0)).current;
  useEffect(() => {
    if (!plays) return;
    entered.add(item.id);
    Animated.parallel([
      Animated.spring(enter, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [plays, item.id, enter, pulse]);
  // Only the Feed tab passes `highlight`: the same card on a game, a target page or a shared alert stays plain.
  const mostHated = useIsMostHated(item.target.key) && !!highlight;
  const favorite = !!item.fav && !!highlight && !mostHated; // a favorite's game: the opponent's alert, edged gold (a most hated target stays red)

  // The alert opens on its own screen, all of its text (here, three lines); its photo opens its player's or team's
  // page. Its clip sits below, outside that tap area, so playing the video (or its controls) never opens anything.
  // A developer notice is from Hate Watch itself: the app's icon, no page to open, no league, nothing to share.
  const notice = isNotice(item);
  return (
    <Animated.View style={[styles.card, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }, notice && (item.urgent ? styles.urgent : styles.notice), fresh && styles.fresh, mostHated && styles.mostHated, favorite && styles.favorite, pressed && { backgroundColor: colors.surfaceHi }]}>
      <Animated.View pointerEvents="none" style={[styles.pulse, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.18] }) }]} />
      <Pressable
        onPress={() => openAlert(item)}
        onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
        style={styles.row}
      >
        {notice ? (
          <View>
            <AppAvatar size={52} />
            <Text style={styles.emoji}>{item.emoji}</Text>
          </View>
        ) : (
          <Pressable onPress={() => router.push(targetHref(item.target))} hitSlop={4} accessibilityRole="button"
            accessibilityLabel={'name' in item.target ? tx('alert.page', { name: item.target.name }) : tx('feedCard.theirPage')}>
            <Avatar target={item.target} size={52} />
            <Text style={styles.emoji}>{item.emoji}</Text>
          </Pressable>
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
          {item.alsoGot != null ? <AlsoGot n={item.alsoGot} /> : null}
          <View style={styles.meta}>
            {notice ? null : <LeagueTag league={item.league} />}
            <Text style={[styles.metaText, notice && styles.noticeLabel]}>{item.typeLabel}</Text>
            <Text style={styles.metaDot}>•</Text>
            <Text style={styles.metaText}>{ago(item.occurredAt, now)}</Text>
          </View>
        </View>
        {/* Their own tap targets: starring or sharing doesn't open the alert behind it. */}
        {notice ? null : <View style={styles.actions}>
          {starAllowed ? <Pressable onPress={() => { starTapped.current = true; toggleSavedAlert(item); }} hitSlop={10} style={({ pressed }) => [styles.share, pressed && { opacity: 0.6 }]}
            accessibilityRole="button" accessibilityState={{ selected: saved }} accessibilityLabel={tx(saved ? 'alert.unsaveA11y' : 'alert.saveA11y')}>
            <Animated.View style={{ transform: [{ scale: star.scale }] }}>
              <Ionicons name={saved ? 'star' : 'star-outline'} size={20} color={saved ? GOLD : colors.textDim} />
            </Animated.View>
          </Pressable> : null}
          <Pressable onPress={share} hitSlop={10} style={({ pressed }) => [styles.share, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={copied ? tx('alert.copiedA11y') : tx('alert.share')}>
            <Animated.View style={{ transform: [{ scale: check.scale }] }}>
              <Ionicons name={copied ? 'checkmark' : Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} size={20} color={copied ? colors.live : colors.textDim} />
            </Animated.View>
            {copied ? <Text style={styles.copied}>{tx('alert.copied')}</Text> : null}
          </Pressable>
        </View>}
      </Pressable>
      {sheet}
      {item.clip ? <AlertClip clip={item.clip} /> : null}
    </Animated.View>
  );
});

/** The alert's play on video, playing right here. `style`: its place (in a card, in line with the alert's text). */
export function AlertClip({ clip, style }: { clip: Clip; style?: StyleProp<ViewStyle> }) {
  const tx = useT();
  const [open, toggle] = useNowPlaying(`alert:${useId()}`);
  return (
    <View style={[styles.clip, style]}>
      {open ? <ClipPlayer clip={clip} /> : null}
      <Pressable onPress={toggle} style={({ pressed }) => [styles.clipRow, pressed && { opacity: 0.7 }]} accessibilityRole="button"
        accessibilityLabel={tx(open ? 'feedCard.closeClip' : 'feedCard.watchClip', { title: clip.title, time: duration(clip.seconds) })}>
        <ClipThumb clip={clip} open={open} width={96} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={styles.watch}>{open ? tx('feedCard.close') : tx('feedCard.watch')}</Text>
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
  // A developer notice: edged in red (an important one, amber), so it reads as Hate Watch speaking, not an alert.
  notice: { borderColor: colors.hateDim },
  urgent: { borderColor: colors.warn },
  noticeLabel: { color: colors.textDim, fontWeight: '800' },
  pulse: { ...StyleSheet.absoluteFill, borderRadius: radius.lg, backgroundColor: HATE_RED },
  fresh: { borderColor: colors.hate, shadowColor: colors.hate, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  // A subscriber's most hated (the red X on the Tracking tab): a red edge, and a favorite's (the heart) a gold one, as on the lock screen scoreboard.
  mostHated: { borderColor: HATE_RED, borderWidth: 2 },
  favorite: { borderColor: GOLD, borderWidth: 2 },
  emoji: { position: 'absolute', right: -6, bottom: -6, fontSize: 20 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800', lineHeight: 21 },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), marginTop: 2, flexWrap: 'wrap' },
  metaText: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
  metaDot: { color: colors.textFaint, fontSize: 12 },
  actions: { alignSelf: 'flex-start', alignItems: 'center', marginTop: -space(1), marginRight: -space(1) },
  share: { alignItems: 'center', padding: space(1) },
  copied: { color: colors.live, fontSize: 10, fontWeight: '800', marginTop: 2 },
});
