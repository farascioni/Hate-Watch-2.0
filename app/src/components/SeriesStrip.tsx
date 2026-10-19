import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../lib/store';
import { startLabel, trackedSides } from '../lib/scores';
import { GOLD, HATE_RED, colors, space } from '../theme';
import { useT } from '../lib/i18n';
import type { GameCard, SeriesGame } from '../lib/types';

/**
 * A series game by game (server/src/series.ts): one cell per game with who won and the score, a tap on a played one opens its
 * box score, and the next game's day and time under it once this card's game is over. Shared by the playoff card
 * (EventBanner, `event.games`) and the regular-season card (GameCardView, `series.games`). The strip is a sibling of the card's
 * own button, never inside it (a button in a button breaks on the web).
 */
export function SeriesStrip({ game, games, title }: { game: GameCard; games: SeriesGame[]; title?: string }) {
  const t = useT();
  const { follows, favorites } = useStore();
  const sides = trackedSides(game, follows);
  const hated = sides.length === 1 ? sides[0] : undefined;
  const abbrevOf = (key: string) => (game.home?.team.key === key ? game.home : game.away)?.team.abbrev ?? '';
  // The ledger is marked from one team's side: the one you hate (a win of theirs is red, a loss green, or gold when the winner is a favorite), else a favorite (a win of theirs is gold).
  const focus = hated ? game[hated]?.team.key : (['home', 'away'] as const).map((k) => game[k]?.team).find((tm) => tm && favorites.has(tm.key))?.key;
  const mark = (g: SeriesGame) => {
    if (g.state === 'in') return colors.live;
    if (g.state !== 'post' || !g.winner || !focus) return colors.border;
    if (hated) return g.winner === focus ? HATE_RED : favorites.has(g.winner) ? GOLD : colors.live;
    return g.winner === focus ? GOLD : colors.border;
  };
  const nextGame = games.find((g) => g.state === 'pre' && !g.ifNeeded && g.id !== game.id);
  return (
    <View style={{ gap: space(1.5) }}>
      {title ? <Text style={styles.small} numberOfLines={1}>{title}</Text> : null}
      <View style={styles.ledger}>
        {games.map((g) => {
          const played = g.state !== 'pre';
          const score = g.score ? `${g.score[0]}–${g.score[1]}` : '';
          return (
            <Pressable key={g.n} disabled={!played} onPress={() => router.push(`/game/${encodeURIComponent(`${game.league}:${g.id}`)}`)}
              style={({ pressed }) => [styles.cell, g.state === 'in' && { borderColor: colors.live }, g.ifNeeded && g.state === 'pre' && styles.cellIf, pressed && { backgroundColor: colors.surfaceHi }]}
              accessibilityRole={played ? 'button' : undefined} accessibilityLabel={played ? [t('event.gameShort', { n: g.n }), g.winner ? abbrevOf(g.winner) : '', score].filter(Boolean).join(' ') : undefined}>
              <Text style={styles.cellN}>{t('event.gameShort', { n: g.n })}</Text>
              <Text style={styles.cellW} numberOfLines={1}>{g.state === 'in' ? t('ui.state.live').toUpperCase() : g.winner ? abbrevOf(g.winner) : ' '}</Text>
              <Text style={styles.cellS} numberOfLines={1}>{score || (g.state === 'pre' && !g.ifNeeded ? startLabel(g.startsAt).split(' ')[0] : ' ')}</Text>
              <View style={[styles.cellMark, { backgroundColor: mark(g) }]} />
            </Pressable>
          );
        })}
      </View>
      {nextGame && game.state === 'post' ? <Text style={styles.small} numberOfLines={1}>{`G${nextGame.n} · ${startLabel(nextGame.startsAt)}`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  small: { color: colors.textDim, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  ledger: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', paddingTop: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cellIf: { borderStyle: 'dashed', opacity: 0.6 },
  cellN: { color: colors.textFaint, fontSize: 10, fontWeight: '700' },
  cellW: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 1 },
  cellS: { color: colors.textDim, fontSize: 10, marginTop: 1 },
  cellMark: { alignSelf: 'stretch', height: 3, marginTop: 4 },
});
