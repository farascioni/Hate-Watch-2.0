import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../lib/store';
import { Avatar, readableOn } from './Avatar';
import { HaterCount, LeagueTag, TargetCard, subtitle } from './ui';
import { streakOf, type GameInfo } from '../lib/trackingInfo';
import type { TrackingLayout } from '../lib/trackingLayout';
import { colors, radius, space } from '../theme';
import type { Target } from '../lib/types';

/** What the Tracking tab knows about a card beyond the target: its division, its team's record and streak, its game. */
export interface CardInfo { division?: string; record?: string; streak?: string; standing?: string; game?: GameInfo | null }

const GREEN = colors.live, RED = '#F87171';
const labelColor = (g: GameInfo) => (g.label === 'LIVE' ? colors.hate : g.label === 'NEXT' ? colors.textDim : colors.textFaint);
const gameLine = (g: GameInfo) => `${g.matchup}${g.score ? ` ${g.score}` : ''} · ${g.status}`;

function Pill({ text, tone }: { text: string; tone?: boolean }) {
  const c = tone === undefined ? colors.textDim : tone ? GREEN : RED;
  return <View style={[styles.pill, { borderColor: c + '66' }]}><Text style={[styles.pillText, { color: c }]} numberOfLines={1}>{text}</Text></View>;
}

/** Record and streak as pills; nothing for a league ESPN has neither for. */
function Form({ info, short }: { info: CardInfo; short?: boolean }) {
  const s = streakOf(info.streak);
  if (!info.record && !s && !info.standing) return null;
  return <>{info.record ? <Pill text={info.record} /> : null}{s ? <Pill text={s.text} tone={s.win} /> : null}{info.standing ? <Pill text={short ? info.standing.replace(' in conference', ' conf') : info.standing} /> : null}</>;
}

const open = (t: Target) => router.push(`/target/${encodeURIComponent(t.key)}`);
const tintOf = (t: Target) => (t.kind === 'team' ? t.color : t.teamColor) ?? colors.border;
const sub = (t: Target, info: CardInfo) => [subtitle(t), info.division].filter(Boolean).join(' · ');

/**
 * The Tracking tab's card in the layout picked in its menu (lib/trackingLayout.ts). `actions(compact)` draws the
 * buttons: the icons alone (on the right of the name on the classic card).
 */
export function TrackingCard({ target, layout, info, actions }: { target: Target; layout: TrackingLayout; info: CardInfo; actions: (compact: boolean) => ReactNode }) {
  const { leagueInfo } = useStore();
  if (layout === 'classic') return <TargetCard target={target} division={info.division} actions={actions(true)} />;
  const tint = tintOf(target), ink = readableOn(tint), g = info.game;
  const press = ({ pressed }: { pressed: boolean }) => pressed && { backgroundColor: colors.surfaceHi };

  if (layout === 'compact') {
    return (
      <Pressable onPress={() => open(target)} style={(s) => [styles.card, styles.compact, press(s)]}>
        <View style={[styles.bar, { backgroundColor: tint }]} />
        <View style={styles.compactMain}>
          <Avatar target={target} size={44} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={styles.name}>{target.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>{sub(target, info)}</Text>
          </View>
          {g ? (
            <View style={styles.right}>
              <Text style={[styles.gameTop, { color: labelColor(g) }]} numberOfLines={1}>{g.label} {g.matchup}{g.score ? ` ${g.score}` : ''}</Text>
              <Text style={styles.sub} numberOfLines={1}>{g.status}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.footer}><View style={styles.form}><Form info={info} /></View>{actions(true)}</View>
      </Pressable>
    );
  }

  if (layout === 'banner') {
    return (
      <Pressable onPress={() => open(target)} style={(s) => [styles.card, press(s)]}>
        <View style={[styles.banner, { backgroundColor: tint }]}>
          <Text style={[styles.bannerText, { color: ink }]} numberOfLines={1}>{g ? `${g.label} · ${gameLine(g)}` : leagueInfo(target.league)?.name ?? target.league.toUpperCase()}</Text>
          <HaterCount target={target} tint={ink} size={11} />
        </View>
        <View style={styles.bannerBody}>
          <View style={styles.bannerAvatar}><Avatar target={target} size={48} /></View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={styles.name}>{target.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>{sub(target, info)}</Text>
          </View>
        </View>
        <View style={[styles.footer, { paddingTop: 0 }]}><View style={styles.form}><Form info={info} /></View>{actions(true)}</View>
      </Pressable>
    );
  }

  if (layout === 'tiles') {
    return (
      <Pressable onPress={() => open(target)} style={(s) => [styles.card, styles.tile, { marginHorizontal: 0, borderTopColor: tint, borderTopWidth: 3 }, press(s)]}>
        <View style={styles.tileHead}>
          <Avatar target={target} size={36} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.tileName} numberOfLines={2}>{target.name}</Text>
            <View style={styles.row}><LeagueTag league={target.league} /><HaterCount target={target} size={11} /></View>
          </View>
        </View>
        <View style={styles.row}><Form info={info} short />{!info.record && !info.streak ? <Text style={styles.sub} numberOfLines={1}>{sub(target, info)}</Text> : null}</View>
        <Text style={[styles.sub, g?.label === 'LIVE' && { color: colors.hate, fontWeight: '700' }]} numberOfLines={1}>{g ? `${g.label} ${gameLine(g)}` : 'No game soon'}</Text>
        <View style={styles.tileActions}>{actions(true)}</View>
      </Pressable>
    );
  }

  // strip
  const s = streakOf(info.streak);
  const cell = (label: string, value: string, color?: string) => (
    <View style={styles.cell}><Text style={styles.cellLabel}>{label}</Text><Text style={[styles.cellValue, color ? { color } : null]} numberOfLines={1}>{value}</Text></View>
  );
  return (
    <Pressable onPress={() => open(target)} style={(st) => [styles.card, press(st)]}>
      <View style={styles.stripHead}>
        <Avatar target={target} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>{target.name}</Text>
          <Text style={styles.sub} numberOfLines={1}>{sub(target, info)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}><LeagueTag league={target.league} /><HaterCount target={target} size={11} /></View>
      </View>
      <View style={styles.strip}>
        {cell('RECORD', info.record ?? '–')}
        {cell('FORM', s?.text ?? '–', s?.win === undefined ? undefined : s.win ? GREEN : RED)}
        {cell(g ? g.label : 'GAME', g ? `${g.matchup}${g.score ? ` ${g.score}` : ''}` : '–', g ? labelColor(g) : undefined)}
      </View>
      <View style={styles.footer}>
        <Text style={[styles.sub, { flex: 1 }]} numberOfLines={2}>{[g?.status, info.standing].filter(Boolean).join('\n') || 'No game soon'}</Text>
        {actions(true)}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), marginVertical: space(1), borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), flexWrap: 'wrap' },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sub: { color: colors.textDim, fontSize: 12 },
  pill: { maxWidth: '100%', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space(2), paddingVertical: 2 },
  pillText: { fontSize: 12, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), paddingHorizontal: space(3), paddingBottom: space(2), paddingTop: space(1) },
  form: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space(1.5) },
  compact: { paddingLeft: 4 },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  compactMain: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(3), paddingTop: space(2.5), paddingBottom: space(1) },
  right: { alignItems: 'flex-end', maxWidth: '42%', gap: 1 },
  gameTop: { fontSize: 12, fontWeight: '800' },
  banner: { height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2), paddingRight: space(3), paddingLeft: space(3) + 54 + space(2) },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '800' },
  bannerBody: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2), paddingHorizontal: space(3), paddingBottom: space(1.5) },
  bannerAvatar: { marginTop: -22, padding: 3, borderRadius: radius.pill, backgroundColor: colors.surface },
  tile: { flex: 1, padding: space(2.5), gap: space(1.5) },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  tileName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  tileActions: { flexDirection: 'row', justifyContent: 'space-between' },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), paddingBottom: space(2) },
  strip: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cell: { flex: 1, alignItems: 'center', paddingVertical: space(1.5), gap: 1 },
  cellLabel: { color: colors.textFaint, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  cellValue: { color: colors.text, fontSize: 14, fontWeight: '800' },
});
