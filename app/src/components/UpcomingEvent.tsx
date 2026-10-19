import { memo } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { useStore } from '../lib/store';
import { useAnyMostHated } from '../lib/mostHated';
import { gameTargetKeys, isFavoriteGame, trackedSides, upNextWhen } from '../lib/scores';
import { GOLD, HATE_RED, colors, radius, space } from '../theme';
import { useT } from '../lib/i18n';
import type { GameSide, UpcomingEvent } from '../lib/types';

/**
 * A playoff game or series in the next 7 days (Special Events, GET /me/events/upcoming): the matchup and when, and who you
 * want to lose. Before you vote there are two buttons and no numbers; after, each team's share of the votes (the server
 * only sends them then) and a tap on either team changes your vote. Votes close when the first game starts. Same
 * red/gold borders as the other cards.
 */
export const UpcomingCard = memo(function UpcomingCard({ item, now, failed, onVote, onAlert }: { item: UpcomingEvent; now: number; failed: boolean; onVote: (team: string) => void; onAlert: (on: boolean) => void }) {
  const t = useT();
  const { follows, favorites } = useStore();
  const g = item.game, ev = g.event!;
  const mostHated = useAnyMostHated(gameTargetKeys(g, follows));
  const favorite = !mostHated && isFavoriteGame(g, favorites);
  const tracked = trackedSides(g, follows);
  const when = upNextWhen(g.startsAt, true, now);
  const sides = [g.away!, g.home!];
  const open = !item.closed && g.startsAt > now;
  const tag = (s: GameSide) => (tracked.includes(s === g.home ? 'home' : 'away') ? t('lb.tracking') : favorites.has(s.team.key) ? t('event.favorite') : null);

  return (
    <View style={[styles.card, mostHated && styles.mostHated, favorite && styles.favorite]}>
      <View style={styles.head}>
        <Text style={styles.pill}>{when.day.toUpperCase()}</Text>
        <Text style={styles.event} numberOfLines={1}>{[ev.name.toUpperCase(), ev.game?.toUpperCase()].filter(Boolean).join(' · ')}</Text>
        {ev.bestOf ? <Text style={styles.fmt}>{t('event.bestOf', { n: ev.bestOf })}</Text> : null}
      </View>
      <View style={styles.matchup}>
        {sides.map((s, i) => (
          <View key={s.team.key} style={styles.matchupRow}>
            {i === 1 ? <Text style={styles.at}>{t('event.at').toUpperCase()}</Text> : null}
            <View style={styles.team}>
              <Avatar target={s.team} size={48} />
              <Text style={styles.teamName} numberOfLines={1}>{s.team.shortName}</Text>
              {tag(s) ? <Text style={[styles.tag, !tracked.includes(s === g.home ? 'home' : 'away') && styles.tagFav]}>{tag(s)}</Text> : null}
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.when}>{when.day} · {when.time}</Text>
      <VoteBlock item={item} sides={sides} open={open} failed={failed} onVote={onVote} onAlert={onAlert} />
    </View>
  );
});

/**
 * Who you want to lose: two buttons before you vote (no numbers), each team's share after (the server only sends them then).
 * `open` lets a tap change the vote, and shows the alert toggle on the vote line ("Alert me when X loses": the server tracks that team
 * for the event; a team you already track shows it on and locked). Shared by the "Coming up" card and, once a series has started, the series card under its score.
 */
export function VoteBlock({ item, sides, open, failed, onVote, onAlert }: { item: UpcomingEvent; sides: GameSide[]; open: boolean; failed: boolean; onVote: (team: string) => void; onAlert: (on: boolean) => void }) {
  const t = useT();
  const total = item.votes ? sides.reduce((n, s) => n + (item.votes![s.team.key] ?? 0), 0) : 0;
  const pctA = total ? Math.round((100 * (item.votes![sides[0].team.key] ?? 0)) / total) : 0;
  const shown = (s: GameSide) => (s === sides[0] ? pctA : 100 - pctA);
  const mine = sides.find((s) => s.team.key === item.mine);
  return (
    <>
      {item.mine && item.votes ? (
        <View style={{ gap: space(2) }}>
          <Text style={styles.q}>{t('event.fansLose', { n: total.toLocaleString() }).toUpperCase()}</Text>
          {sides.map((s) => (
            <Pressable key={s.team.key} disabled={!open} onPress={() => onVote(s.team.key)} style={styles.result}
              accessibilityRole="button" accessibilityLabel={`${t('event.toLose', { team: s.team.name })}, ${shown(s)}%`}>
              <Text style={styles.abbrev}>{s.team.abbrev}</Text>
              <View style={styles.track}><View style={[styles.fill, { width: `${shown(s)}%`, backgroundColor: s.team.color ?? HATE_RED }]} /></View>
              <Text style={styles.percent}>{shown(s)}%</Text>
            </Pressable>
          ))}
          <View style={styles.mineRow}>
            <View style={styles.mineText}>
              <Text style={styles.mine}>✓ {t('event.yourVote', { team: mine?.team.abbrev ?? '' }).toUpperCase()}</Text>
              {open ? <Text style={styles.hint}>{t(item.alert === 'tracked' ? 'event.alertTracked' : 'event.alertMe', { team: mine?.team.shortName ?? '' })}</Text> : null}
            </View>
            {open ? (
              <Switch value={!!item.alert} disabled={item.alert === 'tracked'} onValueChange={onAlert}
                trackColor={{ true: colors.hate, false: colors.border }} thumbColor="#fff" ios_backgroundColor={colors.border}
                // react-native-web otherwise paints the "on" thumb Material teal
                {...({ activeThumbColor: '#fff' } as object)}
                accessibilityLabel={t('event.alertMe', { team: mine?.team.name ?? '' })} />
            ) : null}
          </View>
          {open ? <Text style={styles.hint}>{t('event.tapChange')}</Text> : null}
        </View>
      ) : open ? (
        <View style={{ gap: space(2) }}>
          <Text style={styles.q}>{t('event.whoLose').toUpperCase()}</Text>
          <View style={styles.buttons}>
            {sides.map((s) => (
              <Pressable key={s.team.key} onPress={() => onVote(s.team.key)} style={({ pressed }) => [styles.vote, pressed && { backgroundColor: colors.surfaceHi }]}
                accessibilityRole="button" accessibilityLabel={t('event.toLose', { team: s.team.name })}>
                <Text style={styles.voteAbbrev}>{s.team.abbrev}</Text>
                <Text style={styles.voteSub} numberOfLines={1}>{t('event.toLose', { team: s.team.shortName })}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {failed ? <Text style={styles.error}>{t('event.voteFail')}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), marginBottom: space(3), padding: space(3), gap: space(3), backgroundColor: colors.surface, borderRadius: radius.lg + 2, borderWidth: 1, borderColor: colors.border },
  mostHated: { borderColor: HATE_RED, borderWidth: 2 },
  favorite: { borderColor: GOLD, borderWidth: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  pill: { backgroundColor: GOLD, color: colors.bg, fontSize: 11, fontWeight: '800', borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2, overflow: 'hidden' },
  event: { flex: 1, color: GOLD, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  fmt: { color: colors.textDim, fontSize: 12 },
  matchup: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start' },
  matchupRow: { flexDirection: 'row', alignItems: 'flex-start' },
  at: { width: 40, textAlign: 'center', paddingTop: 18, color: colors.textFaint, fontSize: 11, fontWeight: '800' },
  team: { width: 120, alignItems: 'center', gap: 3 },
  teamName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  tag: { color: colors.hate, fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: colors.hate, borderRadius: 6, paddingHorizontal: 5, overflow: 'hidden' },
  tagFav: { color: GOLD, borderColor: GOLD },
  when: { color: colors.textDim, fontSize: 12, textAlign: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space(2.5) },
  q: { color: colors.text, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  buttons: { flexDirection: 'row', gap: space(2) },
  vote: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: space(2.5), paddingHorizontal: space(1), gap: 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  voteAbbrev: { color: colors.text, fontSize: 14, fontWeight: '800' },
  voteSub: { color: colors.textFaint, fontSize: 11 },
  result: { flexDirection: 'row', alignItems: 'center', gap: space(2), minHeight: 28 },
  abbrev: { width: 38, color: colors.text, fontSize: 13, fontWeight: '800' },
  track: { flex: 1, height: 14, borderRadius: 7, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 7 },
  percent: { width: 46, textAlign: 'right', color: colors.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  mineText: { flex: 1, gap: 2 },
  mine: { color: colors.live, fontSize: 11, fontWeight: '800' },
  hint: { color: colors.textFaint, fontSize: 11 },
  error: { color: colors.warn, fontSize: 12, fontWeight: '700' },
});
