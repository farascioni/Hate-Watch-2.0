import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar } from './Avatar';
import { AlsoGot, LeagueTag, ago } from './ui';
import { useStore } from '../lib/store';
import { hateTag, loseChance, statusLine, trackedDrivers, trackedPlayers, trackedSides, type Side, type Tone } from '../lib/scores';
import { colors, radius, space } from '../theme';
import type { FeedItem, GameCard, LivePlayer } from '../lib/types';

const TONE: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: colors.hateDim, fg: '#FF8A8F' },  // they're losing: good news
  warn: { bg: '#3D2A06', fg: colors.warn },      // they could score
  neutral: { bg: colors.surfaceHi, fg: colors.textDim },
  done: { bg: '#0F2E1A', fg: colors.live },      // a Successful Hate Watch
};

/** One game on the Scores tab. `big` is the header of the game screen (no tap-through, larger scores). */
export const GameCardView = memo(function GameCardView({ game, latest, now, big }: { game: GameCard; latest?: FeedItem; now: number; big?: boolean }) {
  const { follows } = useStore();
  const sides = trackedSides(game, follows);
  const side: Side | undefined = sides.length === 1 ? sides[0] : undefined; // hating both sides: no "down 7"
  const tag = hateTag(game, side);
  const lose = loseChance(game, side);
  const open = () => router.push(`/game/${encodeURIComponent(game.key)}`);
  // A team's row opens its page; VoiceOver reads the card as one button, so the teams are its actions too.
  const teams = game.league === 'f1' ? [] : (['away', 'home'] as const).filter((k) => game[k]);

  const body = game.league === 'f1' ? <F1Body game={game} big={big} /> : (
    <>
      {game.state === 'pre' && game.preview?.chance ? <Text style={styles.chanceHead} importantForAccessibility="no">Win %</Text> : null}
      {(['away', 'home'] as const).map((k) => <TeamRow key={k} game={game} side={k} tracked={sides.includes(k)} big={big} />)}
      <View style={styles.meta}>
        <Text style={styles.metaText} numberOfLines={2}>{statusLine(game, now)}</Text>
        {game.bases ? <Bases bases={game.bases} count={game.count} /> : null}
        {tag ? <View style={[styles.pill, { backgroundColor: TONE[tag.tone].bg }]}><Text style={[styles.pillText, { color: TONE[tag.tone].fg }]}>{tag.text}</Text></View> : null}
      </View>
      {game.hateWatch && game.state === 'post' ? <AlsoGot n={game.hateWatch.alsoGot} /> : null}
      {game.state === 'pre' ? <PreviewDetails game={game} big={big} /> : <LiveDetails game={game} big={big} />}
      {lose != null && side ? (
        <View style={{ gap: 4 }}>
          <View style={styles.meta}>
            <Text style={styles.metaText}>Chance the {game[side]!.team.shortName} lose</Text>
            <Text style={[styles.metaText, { color: '#FF8A8F', fontWeight: '800' }]}>{Math.round(lose * 100)}%</Text>
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
  return (
    <Pressable onPress={open} style={({ pressed }) => [styles.card, game.state === 'post' && { opacity: 0.8 }, pressed && { backgroundColor: colors.surfaceHi }]}
      accessibilityRole="button" accessibilityHint="Opens the play-by-play and your alerts from this game"
      accessibilityActions={teams.map((k) => ({ name: k, label: `Open the ${game[k]!.team.shortName} page` }))}
      onAccessibilityAction={(e) => { const k = teams.find((t) => t === e.nativeEvent.actionName); if (k) openTeam(game[k]!.team.key); }}>
      {content}
    </Pressable>
  );
});

/** A team's page, as Search opens it: their stats, recent misery and roster. */
const openTeam = (key: string) => router.push(`/target/${encodeURIComponent(key)}`);

function TeamRow({ game, side, tracked, big }: { game: GameCard; side: Side; tracked: boolean; big?: boolean }) {
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
        <View style={styles.inline}>
          <Pressable onPress={open} hitSlop={{ top: 4, bottom: 4 }} style={({ pressed }) => [styles.nameTap, pressed && { opacity: 0.6 }]}
            accessibilityRole="link" accessibilityLabel={s.team.name} accessibilityHint="Opens their page">
            <Text style={[styles.teamName, big && { fontSize: 18 }, !tracked && { color: colors.textDim }]} numberOfLines={1}>{s.team.shortName}</Text>
          </Pressable>
          {tracked ? <Text style={styles.tracking}>Tracking</Text> : null}
        </View>
        {players.length && !follows.has(s.team.key) ? <Text style={styles.players} numberOfLines={1}>{players.map((p) => p.name).join(', ')}</Text> : null}
        {record ? <Text style={styles.record} numberOfLines={1}>{record}{split ? ` · ${split} ${side === 'home' ? 'at home' : 'away'}` : ''}</Text> : null}
      </View>
      {chance != null
        ? <Text style={[styles.chance, big && { fontSize: 20 }]} accessibilityLabel={`${chance}% chance to win`}>{chance}%</Text>
        : <Text style={[styles.score, big && { fontSize: 30 }, (!tracked || lost) && { color: colors.textDim }]}>{s.score ?? ''}</Text>}
    </View>
  );
}

function F1Body({ game, big }: { game: GameCard; big?: boolean }) {
  const { follows } = useStore();
  const mine = trackedDrivers(game, follows);
  return (
    <>
      <View style={styles.inline}>
        <LeagueTag league="f1" />
        <Text style={[styles.teamName, big && { fontSize: 18 }]} numberOfLines={1}>{game.session}</Text>
      </View>
      <Text style={styles.metaText}>{statusLine(game)}</Text>
      {game.hateWatch && game.state === 'post' ? <AlsoGot n={game.hateWatch.alsoGot} /> : null}
      {mine.map((d) => (
        <View key={d.key} style={styles.meta}>
          <Text style={styles.teamName} numberOfLines={1}>{d.name}</Text>
          <Text style={styles.score}>{d.position ? `P${d.position}` : '–'}</Text>
        </View>
      ))}
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
    const today = (l?: string) => l?.replace(/^(\d+)-(\d+)/, '$1 for $2');
    if (p) line('p', <>Pitching: {name(p)}{p.pitches != null ? `, ${p.pitches} pitches` : ''}{(big || p.pitches == null) && p.line ? ` · ${p.line}` : ''}</>);
    if (b) line('b', <>At bat: {name(b)}{b.line ? `, ${today(b.line)}` : ''}</>);
  }
  if ((game.league === 'nba' || game.league === 'wnba') && game.leaders) line('lead', <>Top scorers: {both(game.leaders, (p) => <>{name(p)} {p.line}</>)}</>);
  if (game.league === 'nfl') {
    if (game.timeouts && game.state === 'in') line('to', `Timeouts left: ${abbr('away')} ${game.timeouts.away} · ${abbr('home')} ${game.timeouts.home}`);
    const withBall: Side | undefined = game.possession === game.home?.team.key ? 'home' : game.possession === game.away?.team.key ? 'away' : undefined;
    if (big && game.leaders) line('pass', <>Passing: {both(game.leaders, (p) => <>{name(p)} {p.line}</>)}</>, 2);
    else if (withBall && game.leaders?.[withBall]) { const p = game.leaders[withBall]!; line('pass', <>Passing: {name(p)}, {p.line}</>); }
  }
  if (game.league === 'nhl') {
    if (game.shots) line('sog', `Shots on goal: ${abbr('away')} ${game.shots.away} · ${abbr('home')} ${game.shots.home}`);
    if (game.goalies) line('g', <>In net: {both(game.goalies, (p) => <>{name(p)}{p.line ? ` (${p.line})` : ''}</>)}</>);
  }
  if (leagueInfo(game.league)?.sport === 'soccer') {
    if (game.shots) line('sot', `Shots on target: ${abbr('away')} ${game.shots.away} · ${abbr('home')} ${game.shots.home}`);
    if (game.redCards) line('red', `Red cards 🟥 ${abbr('away')} ${game.redCards.away} · ${abbr('home')} ${game.redCards.home}`);
  }
  if (game.lastPlay && game.state === 'in') line('last', <>Last play: <Text style={styles.who}>{game.lastPlay}</Text></>);
  return lines.length ? <View style={{ gap: 2 }}>{lines}</View> : null;
}

/**
 * Before the start: the probable starters (MLB pitchers with their record and ERA, NHL goalies), the betting
 * line the win chances come from (soccer: and the chance of a draw), soccer form and the playoff series.
 * Away first, like the team rows; tracked players in red.
 */
function PreviewDetails({ game, big }: { game: GameCard; big?: boolean }) {
  const { follows } = useStore();
  const pv = game.preview;
  if (!pv) return null;
  const name = (x: { key: string; name: string }) => <Text style={follows.has(x.key) ? styles.mine : styles.who}>{x.name}</Text>;
  const abbr = (side: Side) => game[side]?.team.abbrev ?? '';
  const lines: ReactNode[] = [];
  const line = (key: string, node: ReactNode, rows = 1) => lines.push(<Text key={key} style={styles.atBat} numberOfLines={big ? rows + 1 : rows}>{node}</Text>);
  const st = pv.starters;
  if (st && (st.home || st.away)) {
    const who = (s: Side) => (st[s] ? <>{name(st[s]!)}{st[s]!.line ? ` (${st[s]!.line})` : ''}</> : <Text style={styles.who}>TBD</Text>);
    line('sp', <>{st.label}: {who('away')} · {who('home')}</>, 2);
  }
  if (pv.line || pv.total != null || pv.chance?.draw != null) {
    const parts = [pv.line, pv.total != null ? `O/U ${pv.total}` : null, pv.chance?.draw != null ? `Draw ${pv.chance.draw}%` : null].filter(Boolean);
    line('odds', `${pv.source ? `Odds (${pv.source})` : 'Odds'}: ${parts.join(' · ')}`);
  }
  if (pv.form && (pv.form.home || pv.form.away)) line('form', `Form: ${abbr('away')} ${pv.form.away ?? '–'} · ${abbr('home')} ${pv.form.home ?? '–'}`);
  if (pv.series) line('series', pv.series);
  return lines.length ? <View style={{ gap: 2 }}>{lines}</View> : null;
}

/** MLB: who's on base (filled), how many out, and the count. */
export function Bases({ bases, count }: { bases: NonNullable<GameCard['bases']>; count?: GameCard['count'] }) {
  const base = (on: boolean, pos: object) => <View style={[styles.base, pos, on && styles.baseOn]} />;
  return (
    <View style={styles.inline} accessibilityLabel={`${['first', 'second', 'third'].filter((b) => bases[b as 'first']).join(' and ') || 'Bases empty'}, ${bases.outs} out`}>
      <View style={styles.diamond}>
        {base(bases.second, { left: 10, top: 0 })}
        {base(bases.third, { left: 0, top: 10 })}
        {base(bases.first, { left: 20, top: 10 })}
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>{[0, 1].map((i) => <View key={i} style={[styles.out, i < bases.outs && styles.outOn]} />)}</View>
      {count ? <Text style={styles.count} accessibilityLabel={`${count.balls} balls, ${count.strikes} strikes`}>{count.balls}-{count.strikes}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space(3), marginBottom: space(2), padding: space(3), gap: space(2), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  bigCard: { marginTop: space(3), padding: space(4) },
  team: { flexDirection: 'row', alignItems: 'center', gap: space(2.5) },
  // Around a team's name: only as wide as the name, so the space after it still opens the game.
  nameTap: { flexShrink: 1, minWidth: 0 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  teamName: { color: colors.text, fontSize: 15, fontWeight: '800', flexShrink: 1 },
  tracking: { color: colors.hate, fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: colors.hate, borderRadius: 6, paddingHorizontal: 5, overflow: 'hidden' },
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
