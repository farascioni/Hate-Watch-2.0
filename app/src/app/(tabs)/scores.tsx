import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { GameCardView } from '../../components/GameCard';
import { UpNextRow } from '../../components/UpNextRow';
import { F1Grid } from '../../components/F1Preview';
import { UfcBoutRow, cardDate, fightTime } from '../../components/UfcCard';
import { Empty, LiveBadge, PrimaryButton, SectionHeader, useNow } from '../../components/ui';
import { FilterBar, useFilter } from '../../components/FilterBar';
import { SECTION, byState, inWindow, upNextWhen, weekendDates } from '../../lib/scores';
import { colors, radius, space } from '../../theme';
import type { F1Preview, F1Weekend, GameCard, NextGame, UfcCard } from '../../lib/types';

/** How often "All games" re-reads the server while it's on screen (it reads ESPN's scoreboards every 10s). */
const ALL_GAMES_MS = 15_000;
/** And the UFC's cards, with its chip on (the server reads ESPN every 20 seconds while a fight's live, else every 5 minutes). */
const UFC_MS = 30_000;

type Mode = 'mine' | 'all';
const MODES: Mode[] = ['mine', 'all'];
/** What the tab lists, by the league chip: games; the UFC's fights; every league at once, events (F1's: races, its own switch). */
const eventsWord = (league?: string) => (!league ? 'events' : league === 'ufc' ? 'fights' : 'games');
/** F1 (its chip on): every session is everyone's, so the switch is when, not whose. */
type F1Mode = 'live' | 'upcoming';
const F1_MODES: { id: F1Mode; label: string }[] = [{ id: 'live', label: 'Live races' }, { id: 'upcoming', label: 'Upcoming races' }];
/** A session of the weekend ahead not on the Scores tab yet (Sunday's race on Friday): a row that opens the weekend's preview. */
interface SessionAhead { kind: 'session'; key: string; name: string; at: number; eventId: string }

/**
 * My games: today's games for the teams you track (and the teams of players you track): live first, then
 * later today, then finals. Scores, clocks and win probability update live over the socket (see store.tsx).
 * Then "Up next": each team's next game that isn't already a card here, soonest first. On a day with no
 * games (for the filter), that list is the screen, under "No games today" (UFC: fights; All: events).
 * All games: every game live now, then every one starting within a day, tracked or not, each by league,
 * re-read every 15s while it's showing (the socket only carries games you track; those use its fresher copy).
 * F1's chip on: Live races (live now, then today's finished) and Upcoming races (the weekend's sprint,
 * qualifying and race still to come: a card once it's on the tab, else a row that opens the weekend preview).
 * The UFC's chip on: the next card and the one after (UfcScores).
 */
export default function ScoresScreen() {
  const { games, nextF1, upNext, refreshScores, follows, feed, leagues } = useStore();
  const { filter, setFilter } = useFilter();
  const [mode, setMode] = useState<Mode>('mine');
  const [f1Pick, setF1Pick] = useState<F1Mode | null>(null);
  const [allGames, setAllGames] = useState<GameCard[]>([]);
  const [ufc, setUfc] = useState<UfcCard[] | null>(null);
  const [ufcFailed, setUfcFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  const nav = useNavigation();
  useEffect(() => { nav.setOptions({ headerRight: () => <LiveBadge /> }); }, [nav]);
  const readAllGames = useCallback(() => api.allScores().then((r) => setAllGames(r.games)), []);
  const readUfc = useCallback(() => api.ufcCards().then((r) => { setUfc(r.cards); setUfcFailed(false); }, () => setUfcFailed(true)), []);
  useFocusEffect(useCallback(() => {
    refreshScores().catch(() => {});
    readAllGames().catch(() => {}); // the switch shows how many are live, in either view
    if (filter.league === 'ufc') {
      readUfc();
      const timer = setInterval(() => { readUfc(); }, UFC_MS);
      return () => clearInterval(timer);
    }
    if (mode !== 'all' && filter.league !== 'f1') return; // F1's views read every session, tracked or not
    const timer = setInterval(() => { readAllGames().catch(() => {}); }, ALL_GAMES_MS);
    return () => clearInterval(timer);
  }, [refreshScores, readAllGames, readUfc, mode, filter.league]));

  const sections = useMemo(() => {
    const list = [...games.values()].filter((g) => inWindow(g, now) && (!filter.league || g.league === filter.league)).sort(byState);
    return (['in', 'pre', 'post'] as const)
      .map((state) => ({ title: SECTION[state], data: list.filter((g) => g.state === state) }))
      .filter((s) => s.data.length);
  }, [games, filter.league, now]);
  // Up next: not one already on the tab as a card, and only games still to come.
  const next = useMemo(() => {
    const shown = new Set(sections.flatMap((s) => s.data.map((g) => g.key)));
    return upNext.filter((n) => !shown.has(n.key) && n.startsAt > now - 3600_000 && (!filter.league || n.league === filter.league));
  }, [upNext, sections, filter.league, now]);

  const { leagueInfo } = useStore();
  const leagueName = (id: string) => leagueInfo(id)?.name ?? id.toUpperCase();
  // All games: live by league, then upcoming by league (the server sends them in that order). A game you
  // track comes from the socket-fed store, which is ahead of the 15s read; one that has ended since drops off.
  const everyGame = useMemo(() => allGames
    .map((g) => games.get(g.key) ?? g)
    .filter((g) => (g.state === 'in' || (g.state === 'pre' && inWindow(g, now))) && (!filter.league || g.league === filter.league)), [allGames, games, filter.league, now]);
  const allSections = useMemo(() => {
    const out: { title: string; kind: string; data: GameCard[] }[] = [];
    for (const [state, kind] of [['in', 'live'], ['pre', 'upcoming']] as const) {
      // In the league chips' order, then soonest start.
      const rank = (g: GameCard) => leagues.findIndex((l) => l.id === g.league);
      for (const g of everyGame.filter((x) => x.state === state).sort((a, b) => rank(a) - rank(b) || a.startsAt - b.startsAt)) {
        const title = leagueName(g.league);
        const into = out.find((s) => s.title === title && s.kind === kind);
        if (into) into.data.push(g); else out.push({ title, kind, data: [g] });
      }
    }
    return out;
  }, [everyGame, leagueInfo, leagues]);

  // F1: every session the server has (live, or starting within a day), with the socket's fresher copy of yours.
  const f1Only = filter.league === 'f1';
  const f1Games = useMemo(() => {
    const m = new Map<string, GameCard>();
    for (const g of [...allGames, ...games.values()]) if (g.league === 'f1' && inWindow(g, now)) m.set(g.key, games.get(g.key) ?? g);
    return [...m.values()].sort(byState);
  }, [allGames, games, now]);
  const liveF1 = f1Games.filter((g) => g.state === 'in');
  const f1Mode: F1Mode = f1Pick ?? (liveF1.length ? 'live' : 'upcoming');
  // The weekend under way or next (newer servers: its preview has every session).
  const [weekend, setWeekend] = useState<F1Preview | null>(null);
  useEffect(() => { if (f1Only && nextF1?.eventId) api.f1Preview(nextF1.eventId).then(setWeekend, () => setWeekend(null)); }, [f1Only, nextF1?.eventId]);
  const f1Sections = useMemo((): { title: string; data: (GameCard | SessionAhead)[] }[] => {
    if (f1Mode === 'live') {
      return [{ title: 'Live now', data: liveF1 }, { title: 'Final', data: f1Games.filter((g) => g.state === 'post') }].filter((x) => x.data.length);
    }
    // The weekend's sessions still to come, but practice: a card once the tab has it, else a row.
    const ahead = weekend?.sessions.filter((x) => x.state === 'pre' && !/^practice/i.test(x.name))
      .map((x): GameCard | SessionAhead => f1Games.find((g) => g.key === x.key) ?? { kind: 'session', key: x.key, name: x.name, at: x.at, eventId: weekend.event.id })
      ?? f1Games.filter((g) => g.state === 'pre');
    return ahead.length ? [{ title: weekend?.event.shortName ?? 'Coming up', data: ahead }] : [];
  }, [f1Mode, liveF1, f1Games, weekend]);

  // Under a sprint or race in Upcoming races: its full grid once ESPN has set it, else what sets it.
  const gridUnder = (key: string) => {
    const s = weekend?.sessions.find((x) => x.key === key), g = weekend?.grid;
    if (g && (g.key ? g.key === key : g.session === s?.name)) return <F1Grid grid={g} />;
    if (!s || !['Sprint', 'Race'].includes(s.name)) return null;
    return <Text style={styles.gridNote}>Grid set after {s.name === 'Sprint' ? 'the Sprint Shootout' : 'Qualifying'}.</Text>;
  };

  const listed: { title: string; data: (GameCard | NextGame | SessionAhead)[]; upNext?: boolean; kind?: string }[] = f1Only ? f1Sections
    : mode === 'all' ? allSections
    : next.length ? [...sections, { title: 'Up next', data: next, upNext: true }] : sections;

  // The newest alert from each game (the feed is newest first).
  const latest = useMemo(() => {
    const m = new Map<string, (typeof feed)[number]>();
    for (const f of feed) if (f.gameId && !m.has(f.gameId)) m.set(f.gameId, f);
    return m;
  }, [feed]);

  const word = eventsWord(filter.league);
  const tracked = [...follows.values()];
  const f1 = filter.league === 'f1' || (!filter.league && tracked.length > 0 && tracked.every((t) => t.league === 'f1'));
  const ufcOnly = filter.league === 'ufc';
  const liveCount = ufcOnly ? (ufc?.[0]?.segments.flatMap((s) => s.bouts).filter((b) => b.state === 'in').length ?? 0) : everyGame.filter((g) => g.state === 'in').length;

  const onRefresh = async () => { setRefreshing(true); await Promise.all([refreshScores(), readAllGames(), ...(ufcOnly ? [readUfc()] : [])]).catch(() => {}); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.filters}>
        {f1Only ? (
          <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel="Which races">
            {F1_MODES.map(({ id, label }) => {
              const on = f1Mode === id;
              return (
                <Pressable key={id} onPress={() => setF1Pick(id)} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                  <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{id === 'live' && liveF1.length ? `${label} · ${liveF1.length}` : label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel="Which games">
          {MODES.map((id) => {
            const on = mode === id;
            const label = `${id === 'all' ? 'All' : 'My'} ${word}`;
            const text = id === 'all' && liveCount ? `${label} · ${liveCount} live` : label;
            return (
              <Pressable key={id} onPress={() => setMode(id)} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={id === 'all' ? `All ${word}, live and coming up${liveCount ? `, ${liveCount} live now` : ''}` : `${word[0].toUpperCase()}${word.slice(1)} for the players and teams you track`}>
                <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{text}</Text>
              </Pressable>
            );
          })}
        </View>}
        <FilterBar filter={filter} onChange={setFilter} kinds={false} />
      </View>
      {ufcOnly ? <UfcScores cards={ufc} failed={ufcFailed} mode={mode} onAll={() => setMode('all')} refreshing={refreshing} onRefresh={onRefresh} /> : <SectionList<GameCard | NextGame | SessionAhead, { title: string; upNext?: boolean; kind?: string }>
        sections={listed}
        keyExtractor={(g, i) => `${'state' in g ? 'game' : 'kind' in g && g.kind === 'session' ? 'session' : 'next'}:${g.key}:${i}`}
        // A day with no games for this filter: say so above what's next (unless what's next is today: a
        // game tonight can be in "Up next" before ESPN's scoreboard turns over to today).
        ListHeaderComponent={f1Only ? (f1Mode === 'upcoming' && weekend ? (
          <Pressable onPress={() => router.push(`/f1/${weekend.event.id}`)} style={({ pressed }) => [styles.preview, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Text style={styles.previewText}>Preview the weekend: the grid, the championship, every session</Text>
          </Pressable>
        ) : null) : mode === 'mine' && !sections.length && next.length && upNextWhen(next[0].startsAt, true, now).day !== 'Today' ? (
          <Text style={styles.none}>{filter.league ? `No ${leagueName(filter.league)} ${word} today.` : `No ${word} today.`}</Text>
        ) : null}
        renderSectionHeader={({ section }) => <SectionHeader>{section.title} · {section.data.length}{section.kind ? ` ${section.kind}` : ''}</SectionHeader>}
        renderItem={({ item, section }) => (section.upNext
          ? <UpNextRow game={item as NextGame} now={now} />
          : 'kind' in item && item.kind === 'session' ? <>{<SessionAheadRow session={item} />}{f1Only ? gridUnder(item.key) : null}</>
          : <>{<GameCardView game={item as GameCard} latest={latest.get((item as GameCard).id)} now={now} />}{f1Only && f1Mode === 'upcoming' ? gridUnder(item.key) : null}</>)}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.hate} />}
        contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }}
        ListEmptyComponent={f1Only && f1Mode === 'live' ? (
          <Empty emoji="🏁" title="No race live right now" body={(() => {
            const soon = weekend?.sessions.find((x) => x.state === 'pre' && !/^practice/i.test(x.name));
            return soon ? `Next: ${soon.name}, ${new Date(soon.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : '';
          })()} />
        ) : f1Only ? (
          <F1Empty next={nextF1} tracking={tracked.some((t) => t.league === 'f1')} now={now} />
        ) : mode === 'all' ? (
          <Empty emoji="📺" title={filter.league ? `No ${leagueName(filter.league)} ${word} today` : `No ${word} today`}
            body={`Every ${word.slice(0, -1)} that's live or starts in the next 24 hours shows up here, whether you track anyone in it or not.`} />
        ) : follows.size === 0 ? (
          <Empty emoji="😈" title="Nobody to hate yet" body="Track some players and teams, and their games show up here, live." action={<PrimaryButton label="Find someone to hate" onPress={() => router.navigate('/search')} />} />
        ) : f1 ? (
          <F1Empty next={nextF1} tracking={tracked.some((t) => t.league === 'f1')} now={now} />
        ) : (
          <Empty emoji="🏟️" title={filter.league ? `No ${leagueName(filter.league)} ${word} today` : `No ${word} today`}
            body="When a team you track, or a player's team, plays today, the game shows up here with the live score. Nothing's scheduled yet after that." />
        )}
      />}
    </View>
  );
}

/**
 * The UFC's chip. All fights: the next card (tonight's until the night's over), each segment's fights top of the
 * bill first, under a link to the card's preview, then the card after. My fights: the fights of the fighters you
 * track on either. A fight opens the card with it on top.
 */
function UfcScores({ cards, failed, mode, onAll, refreshing, onRefresh }: { cards: UfcCard[] | null; failed: boolean; mode: Mode; onAll: () => void; refreshing: boolean; onRefresh: () => void }) {
  const { follows } = useStore();
  const open = (c: UfcCard, fight?: string) => router.push(fight ? `/ufc/${c.event.id}?fight=${encodeURIComponent(fight)}` : `/ufc/${c.event.id}`);
  const [next, after] = cards ?? [];
  // Your fighters' fights, by card and segment ("Allen vs. Duncan · Main card · Sat, Oct 10, 8:00 PM").
  const mine = (cards ?? []).flatMap((c) => c.segments.map((s) => ({ c, s, bouts: s.bouts.filter((b) => b.corners.some((x) => follows.has(x.key))) }))).filter((x) => x.bouts.length);
  const tracking = [...follows.values()].some((t) => t.league === 'ufc');
  const where = (c: UfcCard) => [cardDate(c.event.startsAt), c.event.venue].filter(Boolean).join(' · ');

  const body = !cards ? (failed
    ? <Empty emoji="🥊" title="Couldn't load the UFC card" body="ESPN didn't answer. Pull down to try again." />
    : <View style={{ paddingTop: space(10) }}><ActivityIndicator color={colors.hate} /></View>)
    : !next ? <Empty emoji="🥊" title="No UFC card coming up" body="ESPN's calendar has no card on it yet. Check back closer to fight night." />
    : mode === 'all' ? (
      <>
        <Pressable onPress={() => open(next)} style={({ pressed }) => [styles.preview, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={styles.previewText}>Preview the card: the odds, the tale of the tape, every fight</Text>
        </Pressable>
        <Text style={styles.cardName}>{next.event.name}</Text>
        <Text style={styles.cardWhere}>{where(next)}</Text>
        {next.segments.map((s) => (
          <View key={s.id}>
            <SectionHeader>{s.name} · {fightTime(s.startsAt)}{s.broadcast ? ` · ${s.broadcast}` : ''}</SectionHeader>
            {s.bouts.map((b) => <UfcBoutRow key={b.id} bout={b} onPress={() => open(next, b.id)} />)}
          </View>
        ))}
        {after ? (
          <>
            <SectionHeader>Coming up</SectionHeader>
            <Pressable onPress={() => open(after)} style={({ pressed }) => [styles.ahead, pressed && { backgroundColor: colors.surfaceHi }]}
              accessibilityRole="button" accessibilityLabel={`${after.event.name}, ${cardDate(after.event.startsAt)}. Opens the card's preview`}>
              <Text style={[styles.aheadName, { flex: 1 }]} numberOfLines={2}>{after.event.name}</Text>
              <Text style={styles.aheadWhen}>{cardDate(after.event.startsAt)}</Text>
            </Pressable>
          </>
        ) : null}
      </>
    ) : mine.length ? mine.map(({ c, s, bouts }) => (
      <View key={`${c.event.id}:${s.id}`}>
        <SectionHeader>{c.event.name.split(': ')[1] ?? c.event.name} · {s.name} · {cardDate(s.startsAt)}, {fightTime(s.startsAt)}</SectionHeader>
        {bouts.map((b) => <UfcBoutRow key={b.id} bout={b} onPress={() => open(c, b.id)} />)}
      </View>
    )) : !tracking ? (
      <Empty emoji="🥊" title="No fighters tracked" body="Track a fighter, and their fights show up here: the odds before, the result after."
        action={<PrimaryButton label="Find someone to hate" onPress={() => router.navigate('/search')} />} />
    ) : (
      <Empty emoji="🥊" title={`None of your fighters are on the next ${after ? 'two cards' : 'card'}`} body={`Next: ${next.event.name}, ${cardDate(next.event.startsAt)}.${after ? ` Then ${after.event.name}, ${cardDate(after.event.startsAt)}.` : ''}`}
        action={<PrimaryButton label="See all fights" onPress={onAll} />} />
    );
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.hate} />}>
      {body}
    </ScrollView>
  );
}

/** A session of the weekend ahead that isn't on the tab yet: its name and when; it opens the weekend's preview. */
function SessionAheadRow({ session }: { session: SessionAhead }) {
  const when = new Date(session.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <Pressable onPress={() => router.push(`/f1/${session.eventId}`)} style={({ pressed }) => [styles.ahead, pressed && { backgroundColor: colors.surfaceHi }]}
      accessibilityRole="button" accessibilityLabel={`${session.name}, ${when}. Opens the weekend preview`}>
      <Text style={styles.aheadName}>{session.name}</Text>
      <Text style={styles.aheadWhen}>{when}</Text>
    </Pressable>
  );
}

/** F1 with nothing on the tab. Practice isn't shown, so it says when the next race weekend is. */
function F1Empty({ next, tracking, now }: { next: F1Weekend | null; tracking: boolean; now: number }) {
  const when = next && (next.startsAt <= now
    ? `The ${next.name} is this weekend. Practice isn't shown here.`
    : `Next race weekend: ${next.name}, ${weekendDates(next.startsAt, next.endsAt)}.`);
  const how = tracking
    ? 'Qualifying, sprints and races for the drivers and constructors you track show up here the day they run, with the live running order.'
    : 'Track a driver or constructor, and their qualifying, sprints and races show up here the day they run, with the live running order.';
  // The weekend ahead has a page of its own (newer servers send its event): where, when, the championship.
  const preview = next?.eventId ? <PrimaryButton label="Preview the weekend" onPress={() => router.push(`/f1/${next.eventId}`)} /> : null;
  return (
    <Empty emoji="🏁" title="No F1 sessions today" body={when ? `${when}\n\n${how}` : how}
      action={tracking ? preview : <View style={{ gap: space(2) }}>{preview}<PrimaryButton label="Find someone to hate" onPress={() => router.navigate('/search')} /></View>} />
  );
}

const styles = StyleSheet.create({
  none: { color: colors.textDim, fontSize: 14, paddingHorizontal: space(4), paddingTop: space(4) },
  // F1's Upcoming races: the weekend preview link, and a session not on the tab yet (as a card's frame).
  preview: { marginHorizontal: space(3), marginTop: space(3), padding: space(3), borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hate, backgroundColor: colors.hateDim },
  previewText: { color: colors.text, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  ahead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2), marginHorizontal: space(3), marginBottom: space(2), padding: space(3), backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  aheadName: { color: colors.text, fontSize: 15, fontWeight: '800' },
  aheadWhen: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  cardName: { color: colors.text, fontSize: 18, fontWeight: '900', textAlign: 'center', marginTop: space(4), marginHorizontal: space(4) },
  cardWhere: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: space(1), marginHorizontal: space(4) },
  gridNote: { color: colors.textFaint, fontSize: 13, marginHorizontal: space(4), marginTop: -space(1), marginBottom: space(3) },
  filters: { paddingTop: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  // The same two-way switch as the Feed's Everything / Teams / Players (FilterBar).
  segment: { flexDirection: 'row', marginHorizontal: space(3), marginBottom: space(2), padding: 3, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space(2), borderRadius: radius.sm },
  segOn: { backgroundColor: colors.surfaceHi },
  segText: { color: colors.textDim, fontWeight: '700', fontSize: 14 },
  segTextOn: { color: colors.text },
});
