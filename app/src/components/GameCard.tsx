import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Avatar } from './Avatar';
import { SeriesStrip } from './SeriesStrip';
import { AlsoGot, LeagueTag, ago } from './ui';
import { useStore } from '../lib/store';
import { useAnyMostHated } from '../lib/mostHated';
import { fromGrid, gameTargetKeys, hateTag, isFavoriteGame, loseChance, statusLine, stopsText, trackedDrivers, trackedPlayers, trackedSides, type Side, type Tone } from '../lib/scores';
import { GOLD, HATE_RED, colors, radius, space } from '../theme';
import type { FeedItem, GameCard, LivePlayer } from '../lib/types';
import { isFootball } from '../lib/leagueUi';
import { liveBoardSupported, toggleBoardGame, useOnBoard } from '../lib/liveScoreboard';
import { useT } from '../lib/i18n';
import type { Key } from '../lib/strings/en';

const TONE: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: colors.hateDim, fg: colors.hateText },  // they're losing: good news
  warn: { bg: '#3D2A06', fg: colors.warn },      // they could score
  neutral: { bg: colors.surfaceHi, fg: colors.textDim },
  done: { bg: '#0F2E1A', fg: colors.live },      // a Successful Hate Watch
};

/** One game on the Scores tab. `big` is the header of the game screen (no tap-through, larger scores). A game in a series (`game.series` for MLB regular season, `game.event.games` for a postseason series) gets the series strip under the card (`SeriesStrip`). */
export const GameCardView = memo(function GameCardView({ game, latest, now, big }: { game: GameCard; latest?: FeedItem; now: number; big?: boolean }) {
  const tx = useT();
  const { follows, favorites } = useStore();
  const sides = trackedSides(game, follows);
  // Hate Watch Plus: a red border while a team (or a player or driver) on your most hated list is in this game, a gold one while a favorite is (red wins).
  // Not on the game screen's header.
  const mostHated = useAnyMostHated(gameTargetKeys(game, follows)) && !big;
  const favorite = !mostHated && !big && isFavoriteGame(game, favorites);
  const side: Side | undefined = sides.length === 1 ? sides[0] : undefined; // hating both sides: no "down 7"
  const tag = hateTag(game, side);
  const lose = loseChance(game, side);
  const open = () => router.push(`/game/${encodeURIComponent(game.key)}`);
  // A team's row opens its page; VoiceOver reads the card as one button, so the teams are its actions too.
  const teams = game.league === 'f1' ? [] : (['away', 'home'] as const).filter((k) => game[k]);

  const body = game.league === 'f1' ? <F1Body game={game} big={big} /> : (
    <>
      {game.state === 'pre' && game.preview?.chance ? <Text style={styles.chanceHead} importantForAccessibility="no">{tx('gc.winPct')}</Text> : null}
      {(['away', 'home'] as const).map((k) => <TeamRow key={k} game={game} side={k} tracked={sides.includes(k)} big={big} />)}
      <View style={styles.meta}>
        <Text style={styles.metaText} numberOfLines={2}>{statusLine(game, now)}</Text>
        {game.bases ? <Bases bases={game.bases} count={game.count} /> : null}
        {tag ? <View style={[styles.pill, { backgroundColor: TONE[tag.tone].bg }]}><Text style={[styles.pillText, { color: TONE[tag.tone].fg }]}>{tag.text}</Text></View> : null}
        {!big && game.state !== 'post' ? <BoardButton game={game} /> : null}
      </View>
      {game.hateWatch && game.state === 'post' ? <AlsoGot n={game.hateWatch.alsoGot} /> : null}
      {game.state === 'pre' ? <PreviewDetails game={game} big={big} /> : <LiveDetails game={game} big={big} />}
      {lose != null && side ? (
        <View style={{ gap: 4 }}>
          <View style={styles.meta}>
            <Text style={styles.metaText}>{tx('gc.chanceLose', { team: game[side]!.team.shortName })}</Text>
            <Text style={[styles.metaText, { color: colors.hateText, fontWeight: '800' }]}>{Math.round(lose * 100)}%</Text>
          </View>
          <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(lose * 100)}%` }]} /></View>
        </View>
      ) : null}
    </>
  );

  const content = (
    <>
      {body}
      {latest ? <Text style={styles.alert} numberOfLines={2}>{latest.emoji} {latest.title} · {ago(latest.occurredAt, now)}</Text> : null}
    </>
  );
  if (big) return <View style={[styles.card, styles.bigCard]}>{content}</View>;
  const press = {
    onPress: open, accessibilityRole: 'button' as const, accessibilityHint: tx('gc.openHint'),
    accessibilityActions: teams.map((k) => ({ name: k, label: tx('gc.openTeam', { name: game[k]!.team.shortName }) })),
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => { const k = teams.find((t) => t === e.nativeEvent.actionName); if (k) openTeam(game[k]!.team.key); },
  };
  const frame = [styles.card, mostHated && styles.mostHated, favorite && styles.favorite, game.state === 'post' && { opacity: 0.8 }];
  // MLB series (server/src/series.ts): the strip is a sibling of the card's button, never inside it.
  // A postseason series (`game.event.games`, the Special Events card's ledger) gets the same strip in My and All Events.
  const strip = game.series?.games ?? game.event?.games;
  if (strip && strip.length > 1) return (
    <View style={frame}>
      <Pressable {...press} style={({ pressed }) => [{ gap: space(2), borderRadius: radius.md }, pressed && { backgroundColor: colors.surfaceHi }]}>{content}</Pressable>
      <SeriesStrip game={game} games={strip} title={game.series ? seriesTitle(game, tx) : eventSeriesTitle(game, tx)} />
    </View>
  );
  return <Pressable {...press} style={({ pressed }) => [...frame, pressed && { backgroundColor: colors.surfaceHi }]}>{content}</Pressable>;
});

/** "ALCS · Game 6 / 7 · Rays lead 3–2": a postseason game's place in its series, from ESPN's note and series score (as EventBanner's header). */
function eventSeriesTitle(game: GameCard, tx: ReturnType<typeof useT>): string {
  const ev = game.event!, w = ev.wins, need = ev.bestOf ? Math.ceil(ev.bestOf / 2) : 0;
  const a = w ? Math.max(w.home, w.away) : 0, b = w ? Math.min(w.home, w.away) : 0;
  const lead = !w || w.home === w.away ? null : w.home > w.away ? game.home! : game.away!;
  const status = !w ? null : !lead ? tx('event.seriesTied', { a, b }) : tx(a >= need ? 'event.seriesWon' : 'event.seriesLeads', { team: lead.team.shortName, a, b });
  return [ev.name, ev.game && ev.bestOf ? `${ev.game} / ${ev.bestOf}` : ev.game, status].filter(Boolean).join(' · ');
}

/** "Game 2 of 3 · Rays lead 1–0": this game's place in its regular-season series and the series so far. */
function seriesTitle(game: GameCard, tx: ReturnType<typeof useT>): string {
  const games = game.series!.games, n = games.findIndex((g) => g.id === game.id) + 1;
  const wins = (k?: string) => games.filter((g) => g.winner === k).length;
  const [home, away] = [game.home!, game.away!], a = wins(home.team.key), b = wins(away.team.key);
  const lead = a > b ? home : away, hi = Math.max(a, b), lo = Math.min(a, b);
  const status = a + b === 0 ? null : a === b ? tx('event.seriesTied', { a, b }) : tx(a + b === games.length ? 'event.seriesWon' : 'event.seriesLeads', { team: lead.team.shortName, a: hi, b: lo });
  return [n ? tx('event.gameOf', { n, of: games.length }) : null, status].filter(Boolean).join(' · ');
}

/** The lock: puts the game on the lock screen scoreboard (docs/live-activity.md), or takes it off. iOS builds with the widget only. */
function BoardButton({ game }: { game: GameCard }) {
  const tx = useT();
  const onBoard = useOnBoard(game.key);
  if (!liveBoardSupported) return null;
  return (
    <Pressable onPress={() => { toggleBoardGame(game.key).catch(() => {}); }} hitSlop={10} accessibilityRole="button" accessibilityState={{ selected: onBoard }}
      accessibilityLabel={tx(onBoard ? 'gc.boardOff' : 'gc.boardOn')}>
      <Ionicons name={onBoard ? 'eye' : 'eye-outline'} size={16} color={onBoard ? colors.live : colors.textDim} />
    </Pressable>
  );
}

/** A team's page, as Search opens it: their stats, recent misery and roster. */
const openTeam = (key: string) => router.push(`/target/${encodeURIComponent(key)}`);

function TeamRow({ game, side, tracked, big }: { game: GameCard; side: Side; tracked: boolean; big?: boolean }) {
  const tx = useT();
  const { follows } = useStore();
  const s = game[side]!;
  const players = trackedPlayers(game, side, follows);
  const lost = game.state === 'post' && game[side === 'home' ? 'away' : 'home']?.winner;
  const pv = game.state === 'pre' ? game.preview : undefined;
  const record = pv?.records?.[side];
  const split = side === 'home' ? pv?.records?.homeSplit : pv?.records?.awaySplit;
  const chance = pv?.chance?.[side];
  const open = () => openTeam(s.team.key);
  return (
    <View style={styles.team}>
      {/* The logo and the name (as wide as it is) open the team's page; the rest of the card, the game. */}
      <Pressable onPress={open} accessible={false} style={({ pressed }) => pressed && { opacity: 0.6 }}>
        <Avatar target={s.team} size={big ? 40 : 30} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameRow}>
          <Pressable onPress={open} hitSlop={{ top: 4, bottom: 4 }} style={({ pressed }) => [styles.nameTap, pressed && { opacity: 0.6 }]}
            accessibilityRole="link" accessibilityLabel={s.team.name} accessibilityHint={tx('gc.theirPage')}>
            <Text style={[styles.teamName, big && { fontSize: 18 }, !tracked && { color: colors.textDim }]}>{s.team.shortName}</Text>
          </Pressable>
          {tracked ? <Text style={styles.tracking}>{tx('lb.tracking')}</Text> : null}
        </View>
        {players.length && !follows.has(s.team.key) ? <Text style={styles.players} numberOfLines={1}>{players.map((p) => p.name).join(', ')}</Text> : null}
        {record ? <Text style={styles.record} numberOfLines={1}>{record}{split ? ` · ${split} ${tx(side === 'home' ? 'gc.atHome' : 'gc.away')}` : ''}</Text> : null}
      </View>
      {chance != null
        ? <Text style={[styles.chance, big && { fontSize: 20 }]} accessibilityLabel={tx('gc.chanceWin', { n: chance })}>{chance}%</Text>
        : <Text style={[styles.score, big && { fontSize: 30 }, (!tracked || lost) && { color: colors.textDim }]}>{s.score ?? ''}</Text>}
    </View>
  );
}

/**
 * An F1 session: its name, the lap of how many with a bar (newer servers), the track's flag when it isn't green,
 * and your drivers: where they are, their places since the start, gap to the leader and stops, or when they went out.
 */
function F1Body({ game, big }: { game: GameCard; big?: boolean }) {
  const tx = useT();
  const { follows } = useStore();
  const mine = trackedDrivers(game, follows);
  // The server's status line names the flag too, for builds without the pill.
  const line = game.flag ? statusLine(game).replace(` · ${game.flag}`, '') : statusLine(game);
  // A red flag stops the race (good news, here); the chequered flag ends it; the rest slow it.
  const flagTone = !game.flag ? TONE.neutral : /red/i.test(game.flag) ? TONE.good : /cheq|check/i.test(game.flag) ? TONE.neutral : TONE.warn;
  return (
    <>
      <View style={styles.inline}>
        <LeagueTag league="f1" />
        {/* Names and titles wrap rather than cut off, for large text sizes ("Singapore Airlines Singapore Grand Prix · Race"). */}
        <Text style={[styles.teamName, big && { fontSize: 18 }]}>{game.session}</Text>
      </View>
      <View style={[styles.inline, { flexWrap: 'wrap' }]}>
        <Text style={styles.metaText}>{line}</Text>
        {game.flag && game.state === 'in' ? <View style={[styles.pill, { backgroundColor: flagTone.bg }]}><Text style={[styles.pillText, { color: flagTone.fg }]}>{game.flag}</Text></View> : null}
      </View>
      {game.state === 'in' && game.lap && game.laps ? (
        <View style={styles.bar} accessibilityLabel={tx('gc.lap', { lap: game.lap, laps: game.laps })}>
          <View style={[styles.barFill, styles.lapFill, { width: `${Math.min(100, Math.round((game.lap / game.laps) * 100))}%` }]} />
        </View>
      ) : null}
      {game.hateWatch && game.state === 'post' ? <AlsoGot n={game.hateWatch.alsoGot} /> : null}
      {mine.map((d) => {
        const grid = fromGrid(d);
        const rest = [game.state === 'in' ? d.gap : null, stopsText(d.pits)].filter(Boolean).join(' · ');
        return (
          <View key={d.key} style={{ gap: 1 }}>
            <View style={styles.meta}>
              <Text style={styles.teamName}>{d.name}</Text>
              <Text style={styles.score}>{d.position ? `P${d.position}` : '–'}</Text>
            </View>
            {d.out ? <Text style={[styles.atBat, styles.down]}>{d.out}</Text>
              : grid || rest ? (
                <Text style={styles.atBat}>
                  {grid ? <Text style={grid.lost ? styles.down : undefined}>{grid.text}</Text> : null}{grid && rest ? ' · ' : ''}{rest}
                </Text>
              ) : null}
          </View>
        );
      })}
    </>
  );
}

/**
 * The live detail lines under the score, per sport. MLB: who's pitching (and how many he's thrown) and
 * who's up. NBA: each side's top scorer. NFL: timeouts left and the passer (both on the game screen).
 * NHL: shots on goal and who's in net. Soccer: shots on target and red cards. All but MLB: the last play
 * (soccer: the latest goal or card). Tracked players in red.
 */
function LiveDetails({ game, big }: { game: GameCard; big?: boolean }) {
  const tx = useT();
  const { follows, leagueInfo } = useStore();
  const name = (x: { key: string; name: string }) => <Text style={follows.has(x.key) ? styles.mine : styles.who}>{x.name}</Text>;
  const abbr = (side: Side) => game[side]?.team.abbrev ?? '';
  const lines: ReactNode[] = [];
  const line = (key: string, node: ReactNode, rows = 1) => lines.push(<Text key={key} style={styles.atBat} numberOfLines={big ? rows + 1 : rows}>{node}</Text>);
  // Away first, like the team rows.
  const both = (pair: { home?: LivePlayer; away?: LivePlayer } | undefined, fmt: (p: LivePlayer, side: Side) => ReactNode) =>
    (['away', 'home'] as const).filter((s) => pair?.[s]).map((s, i) => <Text key={s}>{i ? ' · ' : ''}{fmt(pair![s]!, s)}</Text>);

  if (game.league === 'mlb') {
    const p = game.pitcher, b = game.batter;
    // ESPN's batter line is hits-at bats today ("0-2"), sometimes with extras ("1-3, HR").
    const today = (l?: string) => l?.replace(/^(\d+)-(\d+)/, tx('gc.hitsFor'));
    if (p) line('p', <>{tx('gc.pitching')}: {name(p)}{p.pitches != null ? `, ${tx('gc.pitches', { n: p.pitches })}` : ''}{(big || p.pitches == null) && p.line ? ` · ${p.line}` : ''}</>);
    if (b) line('b', <>{tx('gc.atBat')}: {name(b)}{b.line ? `, ${today(b.line)}` : ''}</>);
  }
  if ((game.league === 'nba' || game.league === 'wnba') && game.leaders) line('lead', <>{tx('gc.topScorers')}: {both(game.leaders, (p) => <>{name(p)} {p.line}</>)}</>);
  if (isFootball(game.league)) {
    if (game.timeouts && game.state === 'in') line('to', `${tx('gc.timeouts')}: ${abbr('away')} ${game.timeouts.away} · ${abbr('home')} ${game.timeouts.home}`);
    const withBall: Side | undefined = game.possession === game.home?.team.key ? 'home' : game.possession === game.away?.team.key ? 'away' : undefined;
    if (big && game.leaders) line('pass', <>{tx('guide.scores.passing').replace(/:$/, '')}: {both(game.leaders, (p) => <>{name(p)} {p.line}</>)}</>, 2);
    else if (withBall && game.leaders?.[withBall]) { const p = game.leaders[withBall]!; line('pass', <>{tx('guide.scores.passing').replace(/:$/, '')}: {name(p)}, {p.line}</>); }
  }
  if (game.league === 'nhl') {
    if (game.shots) line('sog', `${tx('gc.shotsGoal')}: ${abbr('away')} ${game.shots.away} · ${abbr('home')} ${game.shots.home}`);
    if (game.goalies) line('g', <>{tx('gc.inNet')}: {both(game.goalies, (p) => <>{name(p)}{p.line ? ` (${p.line})` : ''}</>)}</>);
  }
  if (leagueInfo(game.league)?.sport === 'soccer') {
    if (game.shots) line('sot', `${tx('gc.shotsTarget')}: ${abbr('away')} ${game.shots.away} · ${abbr('home')} ${game.shots.home}`);
    if (game.redCards) line('red', `${tx('gc.redCards')} 🟥 ${abbr('away')} ${game.redCards.away} · ${abbr('home')} ${game.redCards.home}`);
  }
  if (game.lastPlay && game.state === 'in') line('last', <>{tx('gc.lastPlay')}: <Text style={styles.who}>{game.lastPlay}</Text></>);
  return lines.length ? <View style={{ gap: 2 }}>{lines}</View> : null;
}

/**
 * Before the start: the probable starters (MLB pitchers with their record and ERA, NHL goalies), the betting
 * line the win chances come from (soccer: and the chance of a draw), soccer form and the playoff series.
 * Away first, like the team rows; tracked players in red.
 */
function PreviewDetails({ game, big }: { game: GameCard; big?: boolean }) {
  const tx = useT();
  const { follows } = useStore();
  const pv = game.preview;
  if (!pv) return null;
  const name = (x: { key: string; name: string }) => <Text style={follows.has(x.key) ? styles.mine : styles.who}>{x.name}</Text>;
  const abbr = (side: Side) => game[side]?.team.abbrev ?? '';
  const lines: ReactNode[] = [];
  const line = (key: string, node: ReactNode, rows = 1) => lines.push(<Text key={key} style={styles.atBat} numberOfLines={big ? rows + 1 : rows}>{node}</Text>);
  const st = pv.starters;
  if (st && (st.home || st.away)) {
    const who = (s: Side) => (st[s] ? <>{name(st[s]!)}{st[s]!.line ? ` (${st[s]!.line})` : ''}</> : <Text style={styles.who}>{tx('gc.tbd')}</Text>);
    line('sp', <>{st.label}: {who('away')} · {who('home')}</>, 2);
  }
  if (pv.line || pv.total != null || pv.chance?.draw != null) {
    const parts = [pv.line, pv.total != null ? `O/U ${pv.total}` : null, pv.chance?.draw != null ? `${tx('gc.draw')} ${pv.chance.draw}%` : null].filter(Boolean);
    line('odds', `${pv.source ? tx('gc.oddsSource', { source: pv.source }) : tx('gc.odds')}: ${parts.join(' · ')}`);
  }
  if (pv.form && (pv.form.home || pv.form.away)) line('form', `${tx('gc.form')}: ${abbr('away')} ${pv.form.away ?? '–'} · ${abbr('home')} ${pv.form.home ?? '–'}`);
  if (pv.series) line('series', pv.series);
  return lines.length ? <View style={{ gap: 2 }}>{lines}</View> : null;
}

/** MLB: who's on base (filled), how many out, and the count. */
export function Bases({ bases, count }: { bases: NonNullable<GameCard['bases']>; count?: GameCard['count'] }) {
  const tx = useT();
  const base = (on: boolean, pos: object) => <View style={[styles.base, pos, on && styles.baseOn]} />;
  return (
    <View style={styles.inline} accessibilityLabel={`${['first', 'second', 'third'].filter((b) => bases[b as 'first']).map((b) => tx(`gc.base.${b}` as Key)).join(tx('gc.and')) || tx('gc.basesEmpty')}, ${tx('gc.outs', { n: bases.outs })}`}>
      <View style={styles.diamond}>
        {base(bases.second, { left: 10, top: 0 })}
        {base(bases.third, { left: 0, top: 10 })}
        {base(bases.first, { left: 20, top: 10 })}
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>{[0, 1].map((i) => <View key={i} style={[styles.out, i < bases.outs && styles.outOn]} />)}</View>
      {count ? <Text style={styles.count} accessibilityLabel={tx('gc.count', { balls: count.balls, strikes: count.strikes })}>{count.balls}-{count.strikes}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), marginBottom: space(2), padding: space(3), gap: space(2), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  mostHated: { borderColor: HATE_RED, borderWidth: 2 },
  favorite: { borderColor: GOLD, borderWidth: 2 },
  bigCard: { marginTop: space(3), padding: space(4) },
  team: { flexDirection: 'row', alignItems: 'center', gap: space(2.5) },
  // Around a team's name: only as wide as the name, so the space after it still opens the game.
  nameTap: { flexShrink: 1, minWidth: 0 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  // A name and its Tracking badge: at large text sizes the badge goes under the name rather than squeezing it.
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space(2), rowGap: 2 },
  teamName: { color: colors.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  tracking: { color: colors.hate, fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: colors.hate, borderRadius: 6, paddingHorizontal: 5, overflow: 'hidden', flexShrink: 0 },
  players: { color: colors.textFaint, fontSize: 12, marginTop: 1 },
  score: { color: colors.text, fontSize: 20, fontWeight: '900', minWidth: 28, textAlign: 'right' },
  // Before the start: the team's record under its name, and its chance to win where the score will be.
  record: { color: colors.textFaint, fontSize: 12, marginTop: 1 },
  chance: { color: colors.textDim, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  // "Win %" once, over the column of chances.
  chanceHead: { color: colors.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textAlign: 'right', marginBottom: -space(1.5) },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) },
  metaText: { color: colors.textDim, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  pill: { borderRadius: radius.pill, paddingHorizontal: space(2.5), paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '800' },
  bar: { height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.hate },
  lapFill: { backgroundColor: colors.textDim },
  // F1: a driver's places lost, or out of it: their bad afternoon, in the colour of good news here.
  down: { color: colors.hateText, fontWeight: '700' },
  alert: { color: colors.textDim, fontSize: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space(2) },
  diamond: { width: 30, height: 22, position: 'relative' },
  base: { position: 'absolute', width: 9, height: 9, borderWidth: 1, borderColor: colors.textDim, transform: [{ rotate: '45deg' }] },
  baseOn: { backgroundColor: colors.warn, borderColor: colors.warn },
  out: { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: colors.textDim },
  outOn: { backgroundColor: colors.textDim },
  count: { color: colors.text, fontSize: 12, fontWeight: '800' },
  atBat: { color: colors.textFaint, fontSize: 12 },
  who: { color: colors.textDim, fontWeight: '700' },
  mine: { color: colors.hate, fontWeight: '800' },
});
