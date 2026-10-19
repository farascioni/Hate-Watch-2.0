import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { GameCardView } from '../../components/GameCard';
import { EventBanner } from '../../components/EventBanner';
import { UpcomingCard } from '../../components/UpcomingEvent';
import { UpNextRow } from '../../components/UpNextRow';
import { F1Grid } from '../../components/F1Preview';
import { UfcBoutRow, cardDate, fightTime } from '../../components/UfcCard';
import { Empty, LiveBadge, PrimaryButton, SectionHeader, useNow } from '../../components/ui';
import { FilterBar, useFilter } from '../../components/FilterBar';
import { GridRow } from '../../components/GridRow';
import { chunkSections, useWebLayout } from '../../lib/webLayout';
import { sectionTitle, byState, inWindow, oneCardPerSeries, upNextWhen, weekendDates } from '../../lib/scores';
import { colors, radius, space } from '../../theme';
import type { F1Preview, F1Weekend, GameCard, NextGame, UfcCard, UpcomingEvent } from '../../lib/types';
import { leagueUi } from '../../lib/leagueUi';
import { currentLocale, phrase, useT, wordT } from '../../lib/i18n';

/** How often "All games" re-reads the server while it's on screen (it reads ESPN's scoreboards every 10s). */
const ALL_GAMES_MS = 15_000;
/** And the UFC's cards, with its chip on (the server reads ESPN every 20 seconds while a fight's live, else every 5 minutes). */
const UFC_MS = 30_000;

type Mode = 'mine' | 'events' | 'all';
const MODES: Mode[] = ['mine', 'events', 'all'];
/** What the tab lists, by the league chip: games; the UFC's fights; every league at once, events (F1's: races, its own switch). */
const eventsWord = (league?: string) => (!league ? 'events' : leagueUi(league).events); // the server's word for a league (leagueUi)
/** F1 (its chip on): every session is everyone's, so the switch is when, not whose. */
type F1Mode = 'live' | 'upcoming';
const F1_MODES: F1Mode[] = ['live', 'upcoming'];
/** A session of the weekend ahead not on the Scores tab yet (Sunday's race on Friday): a row that opens the weekend's preview. */
interface SessionAhead { kind: 'session'; key: string; name: string; at: number; eventId: string }

/**
 * My games: today's games for the teams you track (and the teams of players you track): live first, then
 * later today, then finals. Scores, clocks and win probability update live over the socket (see store.tsx).
 * Then "Up next": each team's next game that isn't already a card here or a cell of a series card's strip, soonest first. On a day with no
 * games (for the filter), that list is the screen, under "No games today" (UFC: fights; All: events).
 * All games: every game live now, then every one starting within a day, tracked or not, each by league,
 * re-read every 15s while it's showing (the socket only carries games you track; those use its fresher copy).
 * Special Events (between the two): the postseason games (`game.event`) as EventBanners, live, then later today, then finals, under no section headers.
 * F1's chip on: Live races (live now, then today's finished) and Upcoming races (the weekend's sprint,
 * qualifying and race still to come: a card once it's on the tab, else a row that opens the weekend preview).
 * The UFC's chip on: the next card and the one after (UfcScores).
 */
export default function ScoresScreen() {
  const t = useT();
  const { games, nextF1, upNext, refreshScores, refreshFollows, follows, feed, leagues } = useStore();
  const { filter, setFilter } = useFilter();
  const [picked, setMode] = useState<Mode>('mine');
  const [f1Pick, setF1Pick] = useState<F1Mode | null>(null);
  const [allGames, setAllGames] = useState<GameCard[]>([]);
  const [ufc, setUfc] = useState<UfcCard[] | null>(null);
  const [ufcFailed, setUfcFailed] = useState(false);
  const [upcoming, setUpcoming] = useState<UpcomingEvent[]>([]);
  const [started, setStarted] = useState<UpcomingEvent[]>([]);
  const [voteFailed, setVoteFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  const nav = useNavigation();
  useEffect(() => { nav.setOptions({ headerRight: () => <LiveBadge /> }); }, [nav]);
  const readAllGames = useCallback(() => api.allScores().then((r) => setAllGames(r.games)), []);
  // Special Events' playoff games and series in the next 7 days, and the series under way, with your votes. An older server has none (404): the section just isn't there.
  const readUpcoming = useCallback(() => api.upcomingEvents().then((r) => { setUpcoming(r.events); setStarted(r.started ?? []); }, () => {}), []);
  const readUfc = useCallback(() => api.ufcCards().then((r) => { setUfc(r.cards); setUfcFailed(false); }, () => setUfcFailed(true)), []);
  useFocusEffect(useCallback(() => {
    refreshScores().catch(() => {});
    readAllGames().catch(() => {}); // with the votes, they decide whether the Special Events switch shows at all
    readUpcoming();
    if (filter.league === 'ufc') {
      readUfc();
      const timer = setInterval(() => { readUfc(); }, UFC_MS);
      return () => clearInterval(timer);
    }
    if (picked === 'mine' && filter.league !== 'f1') return; // F1's views read every session, tracked or not
    const timer = setInterval(() => { readAllGames().catch(() => {}); readUpcoming(); }, ALL_GAMES_MS);
    return () => clearInterval(timer);
  }, [refreshScores, readAllGames, readUfc, readUpcoming, picked, filter.league]));

  const byStateSections = (list: GameCard[]) => (['in', 'pre', 'post'] as const)
    .map((state) => ({ title: sectionTitle(state), data: list.filter((g) => g.state === state) }))
    .filter((s) => s.data.length);
  const sections = useMemo(
    () => byStateSections(oneCardPerSeries([...games.values()].filter((g) => inWindow(g, now) && (!filter.league || g.league === filter.league))).sort(byState)),
    [games, filter.league, now]);
  // Special Events: postseason games (the server's `event`), from the All list and your own, with the socket's fresher copy;
  // then the games and series still a few days off (a series' first game is only there, not also as a card), each with its vote.
  const upcomingShown = useMemo(() => upcoming.filter((u) => !filter.league || u.game.league === filter.league), [upcoming, filter.league]);
  const eventSections = useMemo((): { title: string; data: GameCard[]; upcoming?: boolean }[] => {
    const m = new Map<string, GameCard>();
    const later = new Set(upcoming.map((u) => u.game.key));
    for (const g of [...allGames, ...games.values()]) if (g.event && !later.has(g.key) && inWindow(g, now) && (!filter.league || g.league === filter.league)) m.set(g.key, games.get(g.key) ?? g);
    // One list with no Live now / Later today / Final headers: a series card says its own status, and "Final" over a series still under way reads as over.
    // One card per series: the game on now, else the next, else the last final; earlier games are the ledger strip's cells.
    const shown = oneCardPerSeries([...m.values()]).sort(byState);
    return [...(shown.length ? [{ title: '', data: shown }] : []), ...(upcomingShown.length ? [{ title: t('event.coming'), data: upcomingShown.map((u) => u.game), upcoming: true }] : [])];
  }, [allGames, games, filter.league, now, upcoming, upcomingShown, t]);
  // Special Events is a switch only while it has something to show; a pick of it falls back to My when it empties.
  const mode: Mode = picked === 'events' && !eventSections.length ? 'mine' : picked;
  const upcomingByGame = useMemo(() => new Map(upcoming.map((u) => [u.game.key, u])), [upcoming]);
  const startedBySeries = useMemo(() => new Map(started.map((u) => [u.voteKey, u])), [started]);
  // The vote and its alert switch go on each series' one card.
  const voteCard = useMemo(() => {
    const m = new Map<string, GameCard>();
    for (const s of eventSections) for (const g of s.data) { const k = g.event?.seriesKey; if (k && (!m.get(k) || g.startsAt > m.get(k)!.startsAt)) m.set(k, g); }
    return m;
  }, [eventSections]);
  const vote = (item: UpcomingEvent, team: string) => {
    setVoteFailed(null);
    api.voteEvent(item.voteKey, team).then((r) => { const swap = (all: UpcomingEvent[]) => all.map((u) => (u.voteKey === item.voteKey ? r.event : u)); setUpcoming(swap); setStarted(swap); }, () => setVoteFailed(item.voteKey));
  };
  const setEventAlert = (item: UpcomingEvent, on: boolean) => {
    setVoteFailed(null);
    api.alertEvent(item.voteKey, on).then((r) => { const swap = (all: UpcomingEvent[]) => all.map((u) => (u.voteKey === item.voteKey ? r.event : u)); setUpcoming(swap); setStarted(swap); refreshFollows().catch(() => {}); }, () => setVoteFailed(item.voteKey));
  };
  // Up next: not one already on the tab as a card (or in a card's series strip), and only games still to come.
  const next = useMemo(() => {
    // a series' later games are on its card's strip, so they aren't "up next" too
    const shown = new Set(sections.flatMap((s) => s.data.flatMap((g) => [g.key, ...((g.series?.games ?? g.event?.games)?.map((x) => `${g.league}:${x.id}`) ?? [])])));
    return upNext.filter((n) => !shown.has(n.key) && n.startsAt > now - 3600_000 && (!filter.league || n.league === filter.league));
  }, [upNext, sections, filter.league, now]);

  const { leagueInfo } = useStore();
  const leagueName = (id: string) => leagueInfo(id)?.name ?? id.toUpperCase();
  // All games: live by league, then upcoming by league (the server sends them in that order). A game you
  // track comes from the socket-fed store, which is ahead of the 15s read; one that has ended since drops off.
  const everyGame = useMemo(() => oneCardPerSeries(allGames
    .map((g) => games.get(g.key) ?? g))
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
      return [{ title: t('scores.section.in'), data: liveF1 }, { title: t('scores.section.post'), data: f1Games.filter((g) => g.state === 'post') }].filter((x) => x.data.length);
    }
    // The weekend's sessions still to come, but practice: a card once the tab has it, else a row.
    const ahead = weekend?.sessions.filter((x) => x.state === 'pre' && !/^practice/i.test(x.name))
      .map((x): GameCard | SessionAhead => f1Games.find((g) => g.key === x.key) ?? { kind: 'session', key: x.key, name: x.name, at: x.at, eventId: weekend.event.id })
      ?? f1Games.filter((g) => g.state === 'pre');
    return ahead.length ? [{ title: weekend?.event.shortName ?? t('scores.comingUp'), data: ahead }] : [];
  }, [f1Mode, liveF1, f1Games, weekend, t]);

  // Under a sprint or race in Upcoming races: its full grid once ESPN has set it, else what sets it.
  const gridUnder = (key: string) => {
    const s = weekend?.sessions.find((x) => x.key === key), g = weekend?.grid;
    if (g && (g.key ? g.key === key : g.session === s?.name)) return <F1Grid grid={g} />;
    if (!s || !['Sprint', 'Race'].includes(s.name)) return null;
    return <Text style={styles.gridNote}>{t(s.name === 'Sprint' ? 'scores.gridAfterSprint' : 'scores.gridAfterQuali')}</Text>;
  };

  const listed: { title: string; data: (GameCard | NextGame | SessionAhead)[]; upNext?: boolean; kind?: string; upcoming?: boolean }[] = f1Only ? f1Sections
    : mode === 'events' ? eventSections
    : mode === 'all' ? allSections
    : next.length ? [...sections, { title: t('scores.section.upNext'), data: next, upNext: true }] : sections;
  // Card grid (web): a race's grid sits under its card, so F1 stays one to a row.
  const { cols } = useWebLayout();
  const rowCols = f1Only ? 1 : cols;
  const rows = chunkSections(listed, () => rowCols);

  // The newest alert from each game (the feed is newest first).
  const latest = useMemo(() => {
    const m = new Map<string, (typeof feed)[number]>();
    for (const f of feed) if (f.gameId && !m.has(f.gameId)) m.set(f.gameId, f);
    return m;
  }, [feed]);

  const word = eventsWord(filter.league);
  const specialWord = !filter.league ? 'events' : leagueUi(filter.league).special;
  const leagueWhat = filter.league ? t('scores.leagueWord', { league: leagueName(filter.league), word: wordT(t, word) }) : wordT(t, word);
  const tracked = [...follows.values()];
  const f1 = filter.league === 'f1' || (!filter.league && tracked.length > 0 && tracked.every((t) => t.league === 'f1'));
  const ufcOnly = filter.league === 'ufc';
  const view: Mode = ufcOnly && mode === 'events' ? 'all' : mode; // the UFC has no special events: its switch is My / All

  const onRefresh = async () => { setRefreshing(true); await Promise.all([refreshScores(), readAllGames(), readUpcoming(), ...(ufcOnly ? [readUfc()] : [])]).catch(() => {}); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.filters}>
        {f1Only ? (
          <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel={t('scores.whichRaces')}>
            {F1_MODES.map((id) => {
              const label = t(id === 'live' ? 'scores.f1.live' : 'scores.f1.upcoming');
              const on = f1Mode === id;
              return (
                <Pressable key={id} onPress={() => setF1Pick(id)} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                  <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{id === 'live' && liveF1.length ? `${label} · ${liveF1.length}` : label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel={t('scores.whichGames')}>
          {MODES.filter((id) => id !== 'events' || (!ufcOnly && eventSections.length > 0)).map((id) => {
            const on = view === id;
            const label = id === 'events' ? phrase(t, 'scores.special', specialWord) : phrase(t, id === 'all' ? 'scores.all' : 'scores.mine', word);
            return (
              <Pressable key={id} onPress={() => setMode(id)} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={id === 'events' ? label : id === 'all' ? `${label}${t('scores.allA11y')}` : t('scores.mineA11y', { Word: wordT(t, word)[0].toUpperCase() + wordT(t, word).slice(1) })}>
                <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>{label}</Text>
              </Pressable>
            );
          })}
        </View>}
        <FilterBar filter={filter} onChange={setFilter} kinds={false} />
      </View>
      {ufcOnly ? <UfcScores cards={ufc} failed={ufcFailed} mode={view} onAll={() => setMode('all')} refreshing={refreshing} onRefresh={onRefresh} /> : <SectionList<(GameCard | NextGame | SessionAhead)[], { title: string; upNext?: boolean; kind?: string; upcoming?: boolean }>
        sections={rows}
        keyExtractor={(row, i) => `${row.map((g) => g.key).join('|')}:${i}`}
        // A day with no games for this filter: say so above what's next (unless what's next is today: a
        // game tonight can be in "Up next" before ESPN's scoreboard turns over to today).
        ListHeaderComponent={f1Only ? (f1Mode === 'upcoming' && weekend ? (
          <Pressable onPress={() => router.push(`/f1/${weekend.event.id}`)} style={({ pressed }) => [styles.preview, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Text style={styles.previewText}>{t('scores.previewWeekend')}</Text>
          </Pressable>
        ) : null) : mode === 'mine' && !sections.length && next.length && !upNextWhen(next[0].startsAt, true, now).isToday ? (
          <Text style={styles.none}>{t('scores.noneDot', { what: leagueWhat })}</Text>
        ) : null}
        renderSectionHeader={({ section }) => !section.title ? null : <SectionHeader>{section.title} · {section.data.reduce((n, r) => n + r.length, 0)}{section.kind ? ` ${t(`scores.kind.${section.kind}` as never)}` : ''}</SectionHeader>}
        renderItem={({ item: row, section }) => <GridRow row={row} cols={rowCols} render={(item) => (section.upNext
          ? <UpNextRow game={item as NextGame} now={now} />
          : 'kind' in item && item.kind === 'session' ? <>{<SessionAheadRow session={item} />}{f1Only ? gridUnder(item.key) : null}</>
          : section.upcoming ? (() => { const u = upcomingByGame.get(item.key); return u ? <UpcomingCard item={u} now={now} failed={voteFailed === u.voteKey} onVote={(team) => vote(u, team)} onAlert={(on) => setEventAlert(u, on)} /> : null; })()
          : mode === 'events' ? (() => { const g = item as GameCard, u = g.event?.seriesKey && voteCard.get(g.event.seriesKey) === g ? startedBySeries.get(g.event.seriesKey) : undefined; return <EventBanner game={g} now={now} vote={u ? { item: u, failed: voteFailed === u.voteKey, onVote: (team) => vote(u, team), onAlert: (on) => setEventAlert(u, on) } : undefined} />; })()
          : <>{<GameCardView game={item as GameCard} latest={latest.get((item as GameCard).id)} now={now} />}{f1Only && f1Mode === 'upcoming' ? gridUnder(item.key) : null}</>)} />}
        stickySectionHeadersEnabled={false}
        ListFooterComponent={mode === 'events' && eventSections.length ? <Text style={styles.footnote}>{t('event.footer')}</Text> : null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.hate} />}
        contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }}
        ListEmptyComponent={f1Only && f1Mode === 'live' ? (
          <Empty emoji="🏁" title={t('scores.noRace')} body={(() => {
            const soon = weekend?.sessions.find((x) => x.state === 'pre' && !/^practice/i.test(x.name));
            return soon ? t('scores.nextSession', { name: soon.name, when: new Date(soon.at).toLocaleString(currentLocale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' }) }) : '';
          })()} />
        ) : f1Only ? (
          <F1Empty next={nextF1} tracking={tracked.some((t) => t.league === 'f1')} now={now} />
        ) : mode === 'all' ? (
          <Empty emoji="📺" title={t('scores.none', { what: leagueWhat })}
            body={t('scores.every', { one: wordT(t, word.slice(0, -1)) })} />
        ) : follows.size === 0 ? (
          <Empty emoji="😈" title={t('scores.nobody')} body={t('scores.nobodyBody')} action={<PrimaryButton label={t('common.findSomeone')} onPress={() => router.navigate('/search')} />} />
        ) : f1 ? (
          <F1Empty next={nextF1} tracking={tracked.some((t) => t.league === 'f1')} now={now} />
        ) : (
          <Empty emoji="🏟️" title={t('scores.none', { what: leagueWhat })}
            body={t('scores.noneBody')} />
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
  const t = useT();
  const { follows } = useStore();
  const open = (c: UfcCard, fight?: string) => router.push(fight ? `/ufc/${c.event.id}?fight=${encodeURIComponent(fight)}` : `/ufc/${c.event.id}`);
  const [next, after] = cards ?? [];
  // Your fighters' fights, by card and segment ("Allen vs. Duncan · Main card · Sat, Oct 10, 8:00 PM").
  const mine = (cards ?? []).flatMap((c) => c.segments.map((s) => ({ c, s, bouts: s.bouts.filter((b) => b.corners.some((x) => follows.has(x.key))) }))).filter((x) => x.bouts.length);
  const tracking = [...follows.values()].some((t) => t.league === 'ufc');
  const where = (c: UfcCard) => [cardDate(c.event.startsAt), c.event.venue].filter(Boolean).join(' · ');

  const body = !cards ? (failed
    ? <Empty emoji="🥊" title={t('scores.ufc.failed')} body={t('scores.ufc.failedBody')} />
    : <View style={{ paddingTop: space(10) }}><ActivityIndicator color={colors.hate} /></View>)
    : !next ? <Empty emoji="🥊" title={t('scores.ufc.none')} body={t('scores.ufc.noneBody')} />
    : mode === 'all' ? (
      <>
        <Pressable onPress={() => open(next)} style={({ pressed }) => [styles.preview, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={styles.previewText}>{t('scores.previewCard')}</Text>
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
            <SectionHeader>{t('scores.comingUp')}</SectionHeader>
            <Pressable onPress={() => open(after)} style={({ pressed }) => [styles.ahead, pressed && { backgroundColor: colors.surfaceHi }]}
              accessibilityRole="button" accessibilityLabel={t('scores.ufc.opensPreview', { name: after.event.name, date: cardDate(after.event.startsAt) })}>
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
      <Empty emoji="🥊" title={t('scores.ufc.noFighters')} body={t('scores.ufc.noFightersBody')}
        action={<PrimaryButton label={t('common.findSomeone')} onPress={() => router.navigate('/search')} />} />
    ) : (
      <Empty emoji="🥊" title={t(after ? 'scores.ufc.noneTwo' : 'scores.ufc.noneOne')} body={`${t('scores.ufc.next', { name: next.event.name, date: cardDate(next.event.startsAt) })}${after ? ` ${t('scores.ufc.then', { name: after.event.name, date: cardDate(after.event.startsAt) })}` : ''}`}
        action={<PrimaryButton label={t('scores.ufc.seeAll')} onPress={onAll} />} />
    );
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: space(10), flexGrow: 1 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.hate} />}>
      {body}
    </ScrollView>
  );
}

/** A session of the weekend ahead that isn't on the tab yet: its name and when; it opens the weekend's preview. */
function SessionAheadRow({ session }: { session: SessionAhead }) {
  const t = useT();
  const when = new Date(session.at).toLocaleString(currentLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <Pressable onPress={() => router.push(`/f1/${session.eventId}`)} style={({ pressed }) => [styles.ahead, pressed && { backgroundColor: colors.surfaceHi }]}
      accessibilityRole="button" accessibilityLabel={t('scores.opensWeekend', { name: session.name, when })}>
      <Text style={styles.aheadName}>{session.name}</Text>
      <Text style={styles.aheadWhen}>{when}</Text>
    </Pressable>
  );
}

/** F1 with nothing on the tab. Practice isn't shown, so it says when the next race weekend is. */
function F1Empty({ next, tracking, now }: { next: F1Weekend | null; tracking: boolean; now: number }) {
  const t = useT();
  const when = next && (next.startsAt <= now
    ? t('scores.f1.thisWeekend', { name: next.name })
    : t('scores.f1.nextWeekend', { name: next.name, dates: weekendDates(next.startsAt, next.endsAt) }));
  const how = tracking
    ? t('scores.f1.howTracking')
    : t('scores.f1.howNot');
  // The weekend ahead has a page of its own (newer servers send its event): where, when, the championship.
  const preview = next?.eventId ? <PrimaryButton label={t('scores.f1.preview')} onPress={() => router.push(`/f1/${next.eventId}`)} /> : null;
  return (
    <Empty emoji="🏁" title={t('scores.f1.none')} body={when ? `${when}\n\n${how}` : how}
      action={tracking ? preview : <View style={{ gap: space(2) }}>{preview}<PrimaryButton label={t('common.findSomeone')} onPress={() => router.navigate('/search')} /></View>} />
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
  footnote: { color: colors.textFaint, fontSize: 12, lineHeight: 18, textAlign: 'center', marginHorizontal: space(4), marginTop: space(2) },
  gridNote: { color: colors.textFaint, fontSize: 13, marginHorizontal: space(4), marginTop: -space(1), marginBottom: space(3) },
  filters: { paddingTop: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  // The same two-way switch as the Feed's Everything / Teams / Players (FilterBar).
  segment: { flexDirection: 'row', marginHorizontal: space(3), marginBottom: space(2), padding: 3, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space(2), borderRadius: radius.sm },
  segOn: { backgroundColor: colors.surfaceHi },
  segText: { color: colors.textDim, fontWeight: '700', fontSize: 14 },
  segTextOn: { color: colors.text },
});
