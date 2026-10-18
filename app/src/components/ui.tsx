import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar, readableOn } from './Avatar';
import { useStore } from '../lib/store';
import { GOLD, colors, radius, space } from '../theme';
import { usePlus } from '../lib/plus';
import { syncUpdate } from '../lib/updates';
import type { Target } from '../lib/types';
import { leagueColor } from '../lib/leagueUi';

export function Chip({ label, active, onPress, color, style, accessibilityLabel }: { label: string; active?: boolean; onPress?: () => void; color?: string; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const { active: plus } = usePlus();
  const fill = color && plus ? GOLD : color; // a chip with its own colour (a league) turns gold for Plus subscribers
  return (
    <Pressable onPress={onPress} style={[styles.chip, style, active && { backgroundColor: fill ?? colors.hate, borderColor: fill ?? colors.hate }]} accessibilityRole="button" accessibilityState={{ selected: !!active }} accessibilityLabel={accessibilityLabel}>
      <Text style={[styles.chipText, active && { color: fill ? (fill === GOLD ? '#1A1200' : '#fff') : colors.onHate }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** One chip in a ChipRows: its label, whether it's picked, and its color when picked; what VoiceOver says, if not its label. */
export interface ChipItem { key: string; label: string; active?: boolean; color?: string; onPress: () => void; accessibilityLabel?: string }

/**
 * The rows a ChipRows lays its chips out in, as indexes: all on one row when they fit (`widths`: each chip's own
 * width, `width`: the row's), else the first (All) on a row of its own and the rest on as few rows as they fit on,
 * as even as can be, the longer rows first, so no chip is left alone on a row.
 */
export function chipRows(widths: number[], width: number, gap: number): number[][] {
  const fits = (ix: number[]) => ix.reduce((sum, i) => sum + widths[i], 0) + gap * (ix.length - 1) <= width + 0.5;
  const all = widths.map((_, i) => i);
  if (fits(all)) return [all];
  const rest = all.slice(1);
  for (let rows = 1; rows < rest.length; rows++) {
    const split: number[][] = [];
    for (let r = 0, at = 0; r < rows; r++) { const n = Math.ceil((rest.length - at) / (rows - r)); split.push(rest.slice(at, at + n)); at += n; }
    if (split.every(fits)) return [[0], ...split];
  }
  return [[0], ...rest.map((i) => [i])];
}

/**
 * Filter chips that fill the width (the league filter, a roster's positions): on one row when they all fit, each
 * stretched to share it; when they don't, All across the top and the rest evenly below it (chipRows). Each chip's
 * own width comes from an unseen copy of them that can't be pressed or read out; until it's in, they wrap as they come.
 */
export function ChipRows({ items, gap, chipStyle, style, accessibilityLabel }: {
  items: ChipItem[]; gap: number; chipStyle?: StyleProp<ViewStyle>; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const [width, setWidth] = useState(0); // the rows', inside `style`'s padding
  const [widths, setWidths] = useState<Record<string, number>>({});
  const rows = width > 0 && items.every((i) => widths[i.key] > 0) ? chipRows(items.map((i) => widths[i.key]), width, gap) : null;
  const chip = (i: ChipItem) => <Chip label={i.label} active={i.active} color={i.color} onPress={i.onPress} style={chipStyle} accessibilityLabel={i.accessibilityLabel} />;
  return (
    <View style={style} accessibilityLabel={accessibilityLabel}>
      {/* A hidden tab can lay out at 0 wide: keep the last real width. */}
      <View style={[styles.chipRows, { gap }]} onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - width) > 0.5) setWidth(w); }}>
        {rows ? rows.map((row, r) => (
          <View key={r} style={[styles.chipRow, { gap }]}>
            {row.map((i) => <View key={items[i].key} style={styles.chipCell}>{chip(items[i])}</View>)}
          </View>
        )) : (
          <View style={[styles.chipRow, styles.chipWrap, { gap }]}>
            {items.map((i) => <View key={i.key} style={styles.chipCell}>{chip(i)}</View>)}
          </View>
        )}
        <View style={styles.chipMeasure} pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {items.map((i) => (
            <View key={i.key} style={[styles.chip, chipStyle, styles.chipNatural]}
              onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0) setWidths((m) => (Math.abs((m[i.key] ?? 0) - w) > 0.5 ? { ...m, [i.key]: w } : m)); }}>
              <Text style={styles.chipText} numberOfLines={1}>{i.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export function LeagueTag({ league }: { league: string }) {
  const { leagueInfo } = useStore(); // its short name from the server ("EPL"), for leagues this build doesn't know too
  return (
    <View style={[styles.tag, { backgroundColor: leagueColor(league) ?? colors.surfaceHi }]}>
      <Text style={styles.tagText}>{leagueInfo(league)?.name ?? league.toUpperCase()}</Text>
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

/**
 * "👁 12 haters": how many people track this player or team. The freshest count the app has (from a
 * list the server just sent, or your own follow or unfollow), else the one on the target.
 */
export function HaterCount({ target, size = 12, tint }: { target: Target; size?: number; tint?: string }) {
  const { trackers, follows } = useStore();
  const n = trackers.get(target.key) ?? target.haters;
  if (n == null) return null;
  const mine = follows.has(target.key);
  const label = n === 0 ? 'No haters yet' : n === 1 && mine ? 'Just you' : `${n.toLocaleString()} hater${n === 1 ? '' : 's'}`;
  return (
    <View style={styles.haters} accessible accessibilityLabel={n === 0 ? 'Nobody tracks them yet' : `${n} ${n === 1 ? 'person tracks' : 'people track'} them${mine ? ', you included' : ''}`}>
      <Ionicons name="eye" size={size} color={tint ?? colors.textFaint} />
      <Text style={[styles.hatersText, { fontSize: size }, tint ? { color: tint } : null]}>{label}</Text>
    </View>
  );
}

/** A player or team in a list, with how many people hate them. `extra` replaces that line. */
export function TargetRow({ target, right, extra }: { target: Target; right?: ReactNode; extra?: ReactNode }) {
  return (
    <Pressable onPress={() => router.push(`/target/${encodeURIComponent(target.key)}`)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHi }]}>
      <Avatar target={target} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{target.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <LeagueTag league={target.league} />
          <Text style={styles.rowSub} numberOfLines={1}>{subtitle(target)}</Text>
        </View>
        {extra ?? <HaterCount target={target} />}
      </View>
      {right ?? <FollowButton target={target} />}
    </Pressable>
  );
}

/**
 * The Tracking tab's card: a banner in the team's colour (league on the left, hater count on the right), the avatar
 * overlapping it, the name wrapping freely, the subtitle (a team's division after its city), and `actions` along the bottom.
 */
export function TargetCard({ target, division, actions }: { target: Target; division?: string; actions: ReactNode }) {
  const { leagueInfo } = useStore();
  const tint = (target.kind === 'team' ? target.color : target.teamColor) ?? colors.border;
  const ink = readableOn(tint);
  return (
    <Pressable onPress={() => router.push(`/target/${encodeURIComponent(target.key)}`)} style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfaceHi }]}>
      <View style={[styles.banner, { backgroundColor: tint }]}>
        <Text style={[styles.bannerLeague, { color: ink }]}>{leagueInfo(target.league)?.name ?? target.league.toUpperCase()}</Text>
        <HaterCount target={target} tint={ink} />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <View style={styles.cardAvatar}><Avatar target={target} size={44} /></View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>{target.name}</Text>
            <Text style={styles.rowSub}>{[subtitle(target), division].filter(Boolean).join(' · ')}</Text>
          </View>
          <View style={styles.cardActions}>{actions}</View>
        </View>
      </View>
    </Pressable>
  );
}

/** A Successful Hate Watch's company: "23 other hate watchers" got the same alert. */
export function AlsoGot({ n }: { n: number }) {
  const label = `${n.toLocaleString()} other hate watcher${n === 1 ? '' : 's'}`;
  return (
    <View style={styles.alsoGot} accessible accessibilityLabel={`${label} got this alert too`}>
      <Text style={styles.alsoGotText}>{label}</Text>
    </View>
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

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primary, (pressed || disabled) && { opacity: disabled ? 0.5 : 0.8 }]} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}>
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

/** The LIVE badge's tap: syncs now and says so when there is nothing to take or the build can't take one. */
async function tapSync() {
  try {
    const r = await syncUpdate();
    if (r === 'off') Alert.alert('No updates here', 'This build (development or web) does not take over-the-air updates.');
    else if (r === 'current') Alert.alert('Up to date', 'You have the latest version.');
  } catch {
    Alert.alert("Couldn't check for updates", 'Try again in a moment.');
  }
}

/** The realtime connection state, for a tab's header (Feed, Scores). Tapping it syncs the latest over-the-air update. */
export function LiveBadge() {
  const { live } = useStore();
  const [busy, setBusy] = useState(false);
  const color = live === 'live' ? colors.live : live === 'connecting' ? colors.warn : colors.textFaint;
  const press = async () => {
    if (busy) return;
    setBusy(true);
    await tapSync();
    setBusy(false);
  };
  return (
    <Pressable onPress={press} hitSlop={8} style={styles.liveWrap} accessibilityRole="button" accessibilityLabel={`Realtime ${live}. Tap to check for an app update`}>
      <View style={[styles.liveDot, { backgroundColor: color }]} />
      <Text style={[styles.liveText, { color }]}>{busy ? 'CHECKING' : live === 'live' ? 'LIVE' : live === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  haters: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hatersText: { color: colors.textFaint, fontWeight: '600' },
  alsoGot: { alignSelf: 'flex-start', backgroundColor: '#0F2E1A', borderRadius: radius.pill, paddingHorizontal: space(2.5), paddingVertical: 3 },
  alsoGotText: { color: colors.live, fontSize: 12, fontWeight: '800' },
  liveWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: space(4) },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  chip: { paddingHorizontal: space(3), paddingVertical: space(1.5), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
  // ChipRows: its rows clip the unseen copy (a long row of every chip, wider than the screen) so it can't scroll the page.
  chipRows: { overflow: 'hidden' },
  chipRow: { flexDirection: 'row' },
  chipWrap: { flexWrap: 'wrap' },
  chipCell: { flexGrow: 1, flexBasis: 'auto' },
  chipMeasure: { position: 'absolute', left: 0, top: 0, width: 4000, flexDirection: 'row', alignItems: 'flex-start', opacity: 0 },
  chipNatural: { flexShrink: 0 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  tagText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  follow: { paddingHorizontal: space(4), paddingVertical: space(2), borderRadius: radius.pill, borderWidth: 1.5, minWidth: 92, alignItems: 'center' },
  followOff: { backgroundColor: colors.hate, borderColor: colors.hate },
  followOn: { backgroundColor: 'transparent', borderColor: colors.hate },
  followText: { color: colors.onHate, fontWeight: '800', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3) },
  card: { marginHorizontal: space(3), marginVertical: space(1), borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  banner: { height: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space(3), paddingLeft: space(3) + 50 + space(3) }, // the left gap clears the avatar (44 + 2 × 3 padding) that overlaps the banner
  bannerLeague: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  cardBody: { paddingHorizontal: space(3), paddingBottom: space(2) },
  cardActions: { width: 148, paddingTop: space(1) }, // room for the four small icons in one row (4 icons + borders + gaps ≈ 139)
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3) },
  cardText: { flex: 1, minWidth: 0, gap: 1, paddingTop: space(1) },
  cardAvatar: { marginTop: -16, padding: 3, borderRadius: radius.pill, backgroundColor: colors.surface },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowSub: { color: colors.textDim, fontSize: 13, flexShrink: 1 },
  // Opaque, like the Feed's day headers: iOS pins SectionList headers while scrolling, and rows must not show through.
  section: { color: colors.textFaint, backgroundColor: colors.bg, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: space(4), paddingTop: space(6), paddingBottom: space(2) },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space(10), gap: space(3), flexGrow: 1 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  emptyBody: { color: colors.textDim, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  primary: { marginTop: space(3), backgroundColor: colors.hate, paddingHorizontal: space(6), paddingVertical: space(3), borderRadius: radius.pill, alignItems: 'center' },
  primaryText: { color: colors.onHate, fontWeight: '800', fontSize: 15 },
});
