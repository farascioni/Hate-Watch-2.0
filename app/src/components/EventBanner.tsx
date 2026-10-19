import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar } from './Avatar';
import { Bases } from './GameCard';
import { SeriesStrip } from './SeriesStrip';
import { VoteBlock } from './UpcomingEvent';
import { useStore } from '../lib/store';
import { useAnyMostHated } from '../lib/mostHated';
import { gameTargetKeys, isFavoriteGame, loseChance, statusLine, trackedSides, type Side } from '../lib/scores';
import { GOLD, HATE_RED, colors, radius, space } from '../theme';
import { useT } from '../lib/i18n';
import type { EventLine, GameCard, UpcomingEvent } from '../lib/types';

/**
 * A postseason game on the Scores tab's Special Events view (`game.event`, server/src/scores.ts), as the "Ledger":
 * the event and game, the series, both teams with their scores right-aligned, the line score while it's on or done,
 * the situation and the chance the team you hate loses, then the series game by game (server/src/series.ts).
 * Once the series has started, `vote` puts who-should-lose under the scoreboard (the buttons, then the fans' shares; closed when the series is won).
 * Red border: a team on your most hated list is in it; gold: a favorite (red wins), as on the other cards. Opens the game; a played cell in the series strip opens that game's box score.
 */
export const EventBanner = memo(function EventBanner({ game, now, vote }: { game: GameCard; now: number; vote?: { item: UpcomingEvent; failed: boolean; onVote: (team: string) => void; onAlert: (on: boolean) => void } }) {
  const t = useT();
  const { follows, favorites } = useStore();
  const ev = game.event!;
  const mostHated = useAnyMostHated(gameTargetKeys(game, follows));
  const favorite = !mostHated && isFavoriteGame(game, favorites);
  const sides = trackedSides(game, follows);
  const hated: Side | undefined = sides.length === 1 ? sides[0] : undefined;
  const lose = loseChance(game, hated);
  const wins = ev.wins, need = ev.bestOf ? Math.ceil(ev.bestOf / 2) : 0;
  const series = wins ? (() => {
    const lead = wins.home === wins.away ? null : wins.home > wins.away ? game.home! : game.away!;
    const a = Math.max(wins.home, wins.away), b = Math.min(wins.home, wins.away);
    return !lead ? t('event.seriesTied', { a, b }) : t(a >= need ? 'event.seriesWon' : 'event.seriesLeads', { team: lead.team.shortName, a, b });
  })() : null;

  return (
    <View style={[styles.card, mostHated && styles.mostHated, favorite && styles.favorite, game.state === 'post' && { opacity: 0.9 }]}>
      <Pressable onPress={() => router.push(`/game/${encodeURIComponent(game.key)}`)}
        style={({ pressed }) => [{ gap: space(3), borderRadius: radius.md }, pressed && { backgroundColor: colors.surfaceHi }]}
        accessibilityRole="button" accessibilityLabel={[ev.name, ev.game, series, game.away?.team.name, game.away?.score, game.home?.team.name, game.home?.score].filter((x) => x != null && x !== '').join(', ')}>
        <View style={styles.head}>
          <Ionicons name="trophy" size={14} color={GOLD} />
          <Text style={styles.name} numberOfLines={1}>{ev.name.toUpperCase()}</Text>
          <Text style={styles.when} numberOfLines={1}>{[ev.game && ev.bestOf ? `${ev.game} / ${ev.bestOf}` : ev.game, statusLine(game, now)].filter(Boolean).join(' · ')}</Text>
        </View>
        {series ? <Text style={styles.series}>{series}<Text style={styles.seriesDim}> · {t('event.bestOf', { n: ev.bestOf! })}</Text></Text> : null}
        <View style={styles.teams}>
          {(['away', 'home'] as const).map((k) => <TeamLine key={k} game={game} side={k} tracked={sides.includes(k)} line={ev.lines?.[k]} />)}
        </View>
        {ev.lines && game.state !== 'pre' ? <LineScore game={game} /> : null}
        {game.state === 'in' && (game.bases || game.pitcher || game.batter) ? (
          <View style={styles.sit}>
            {game.bases ? <Bases bases={game.bases} count={game.count} /> : null}
            <Text style={styles.sitText} numberOfLines={2}>
              {[game.count ? `${game.count.balls}–${game.count.strikes}` : null, game.pitcher && `${game.pitcher.name} ${game.pitcher.line ?? ''}`.trim(), game.batter && `${game.batter.name} ${game.batter.line ?? ''}`.trim()].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ) : null}
        {lose != null && hated ? (
          <View style={{ gap: 4 }}>
            <View style={styles.between}>
              <Text style={styles.small}>{t('gc.chanceLose', { team: game[hated]!.team.shortName })}</Text>
              <Text style={[styles.small, { color: colors.hateText, fontWeight: '800' }]}>{Math.round(lose * 100)}%</Text>
            </View>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(lose * 100)}%` }]} /></View>
          </View>
        ) : null}
      </Pressable>
      {ev.games?.length ? <SeriesStrip game={game} games={ev.games} /> : null}
      {vote ? <VoteBlock item={vote.item} sides={[game.away!, game.home!]} open={!vote.item.closed} failed={vote.failed} onVote={vote.onVote} onAlert={vote.onAlert} /> : null}
    </View>
  );
});

/** A team: logo, name (with Tracking), record, and its score right-aligned in a fixed-width column so a pill or a wider team never moves it. */
function TeamLine({ game, side, tracked, line }: { game: GameCard; side: Side; tracked: boolean; line?: EventLine }) {
  const t = useT();
  const s = game[side]!;
  const lost = game.state === 'post' && s.winner === false;
  const rec = [line?.rec, line?.split].filter(Boolean).join(' · ');
  return (
    <View style={styles.team}>
      <Avatar target={s.team} size={38} />
      <View style={styles.teamText}>
        <View style={styles.nameRow}>
          <Text style={[styles.teamName, lost && { color: colors.textDim }]} numberOfLines={1}>{s.team.shortName}</Text>
          {tracked ? <Text style={styles.tracking}>{t('lb.tracking')}</Text> : null}
        </View>
        {rec ? <Text style={styles.rec} numberOfLines={1}>{rec}</Text> : null}
      </View>
      {game.state !== 'pre' && s.score != null ? <Text style={[styles.score, lost && { color: colors.textDim }]}>{s.score}</Text> : null}
    </View>
  );
}

/** The line score: each period's runs or points, then the total (and baseball's hits and errors). */
function LineScore({ game }: { game: GameCard }) {
  const lines = game.event!.lines!;
  const n = Math.max(lines.away.periods.length, lines.home.periods.length, game.league === 'mlb' ? 9 : 4);
  const sums = ['R', ...(lines.away.h != null ? ['H', 'E'] : [])];
  const row = (side: Side, header?: boolean) => {
    const l = lines[side];
    const vals = Array.from({ length: n }, (_, i) => (header ? String(i + 1) : l.periods[i] != null ? String(l.periods[i]) : ''));
    const total = header ? sums : [String(game[side]?.score ?? ''), ...(l.h != null ? [String(l.h), String(l.e ?? 0)] : [])];
    return (
      <View style={styles.lsRow}>
        <Text style={[styles.lsTeam, header && styles.lsHead]} numberOfLines={1}>{header ? '' : game[side]!.team.abbrev}</Text>
        {vals.map((v, i) => <Text key={i} style={[styles.lsCell, header && styles.lsHead]}>{v}</Text>)}
        {total.map((v, i) => <Text key={`t${i}`} style={[styles.lsTot, header && styles.lsHead]}>{v}</Text>)}
      </View>
    );
  };
  return <View>{row('away', true)}{row('away')}{row('home')}</View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), marginBottom: space(3), padding: space(3), gap: space(3), backgroundColor: colors.surface, borderRadius: radius.lg + 2, borderWidth: 1, borderColor: colors.border },
  mostHated: { borderColor: HATE_RED, borderWidth: 2 },
  favorite: { borderColor: GOLD, borderWidth: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  name: { color: GOLD, fontSize: 12, fontWeight: '800', letterSpacing: 1.4, flexShrink: 0 },
  when: { flex: 1, color: colors.textDim, fontSize: 12, textAlign: 'right' },
  series: { color: colors.text, fontSize: 13, fontWeight: '700' },
  seriesDim: { color: colors.textFaint, fontWeight: '400' },
  teams: { gap: space(2.5) },
  team: { flexDirection: 'row', alignItems: 'center', gap: space(2.5) },
  teamText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  teamName: { color: colors.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  tracking: { color: colors.hate, fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: colors.hate, borderRadius: 6, paddingHorizontal: 5, overflow: 'hidden', flexShrink: 0 },
  rec: { color: colors.textFaint, fontSize: 12 },
  score: { minWidth: 44, textAlign: 'right', color: colors.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  lsRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lsTeam: { width: 36, color: colors.text, fontSize: 12, fontWeight: '800', paddingVertical: 4 },
  lsCell: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 12, paddingVertical: 4, fontVariant: ['tabular-nums'] },
  lsTot: { width: 26, textAlign: 'center', color: colors.text, fontSize: 12, fontWeight: '800', paddingVertical: 4, fontVariant: ['tabular-nums'] },
  lsHead: { color: colors.textFaint, fontWeight: '700' },
  sit: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  sitText: { flex: 1, color: colors.textDim, fontSize: 12, lineHeight: 18 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) },
  small: { color: colors.textDim, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.hate },
});
