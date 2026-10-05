import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { Avatar } from './Avatar';
import { useStore } from '../lib/store';
import { colors, leagueColors, radius, space } from '../theme';
import type { Target } from '../lib/types';

export function Chip({ label, active, onPress, color, style }: { label: string; active?: boolean; onPress?: () => void; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, style, active && { backgroundColor: color ?? colors.hate, borderColor: color ?? colors.hate }]} accessibilityRole="button" accessibilityState={{ selected: !!active }}>
      <Text style={[styles.chipText, active && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function LeagueTag({ league }: { league: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: leagueColors[league] ?? colors.surfaceHi }]}>
      <Text style={styles.tagText}>{league.toUpperCase()}</Text>
    </View>
  );
}

export function FollowButton({ target, compact }: { target: Target; compact?: boolean }) {
  const { isFollowing, toggleFollow } = useStore();
  const on = isFollowing(target.key);
  return (
    <Pressable
      onPress={() => toggleFollow(target)}
      hitSlop={8}
      style={[styles.follow, on ? styles.followOn : styles.followOff, compact && { paddingHorizontal: space(3) }]}
      accessibilityRole="button"
      accessibilityLabel={on ? `Unfollow ${target.name}` : `Follow ${target.name}`}
    >
      <Text style={[styles.followText, on && { color: colors.hate }]}>{on ? 'Tracking' : 'Track'}</Text>
    </Pressable>
  );
}

export function subtitle(t: Target) {
  if (t.kind === 'team') return t.league === 'f1' ? 'Constructor' : t.location ?? t.abbrev;
  // F1 team codes (RBR, AMR) are our own badge labels, so drivers show the constructor's name instead.
  const team = t.league === 'f1' ? t.teamName : t.teamAbbrev;
  return [team, t.position, t.jersey ? `#${t.jersey}` : null].filter(Boolean).join(' · ');
}

export function TargetRow({ target, right }: { target: Target; right?: ReactNode }) {
  return (
    <Pressable onPress={() => router.push(`/target/${encodeURIComponent(target.key)}`)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHi }]}>
      <Avatar target={target} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{target.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <LeagueTag league={target.league} />
          <Text style={styles.rowSub} numberOfLines={1}>{subtitle(target)}</Text>
        </View>
      </View>
      {right ?? <FollowButton target={target} />}
    </Pressable>
  );
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Empty({ emoji, title, body, action }: { emoji: string; title: string; body: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={{ fontSize: 48 }}>{emoji}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

export function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.8 }]}>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

/** Re-renders every `ms` so relative timestamps stay honest. */
export function useNow(ms = 10_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The realtime connection state, for a tab's header (Feed, Scores). */
export function LiveBadge() {
  const { live } = useStore();
  const color = live === 'live' ? colors.live : live === 'connecting' ? colors.warn : colors.textFaint;
  return (
    <View style={styles.liveWrap} accessibilityLabel={`Realtime ${live}`}>
      <View style={[styles.liveDot, { backgroundColor: color }]} />
      <Text style={[styles.liveText, { color }]}>{live === 'live' ? 'LIVE' : live === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  liveWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: space(4) },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  chip: { paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  tagText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  follow: { paddingHorizontal: space(4), paddingVertical: space(2), borderRadius: radius.pill, borderWidth: 1.5, minWidth: 92, alignItems: 'center' },
  followOff: { backgroundColor: colors.hate, borderColor: colors.hate },
  followOn: { backgroundColor: 'transparent', borderColor: colors.hate },
  followText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3) },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowSub: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  // Opaque, like the Feed's day headers: iOS pins SectionList headers while scrolling, and rows must not show through.
  section: { color: colors.textFaint, backgroundColor: colors.bg, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: space(4), paddingTop: space(6), paddingBottom: space(2) },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space(10), gap: space(3), flexGrow: 1 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  emptyBody: { color: colors.textDim, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  primary: { marginTop: space(3), backgroundColor: colors.hate, paddingHorizontal: space(6), paddingVertical: space(3), borderRadius: radius.pill },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
