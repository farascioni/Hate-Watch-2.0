import { createHash } from 'node:crypto';
import { getJson, athleteIdFromRef } from './espn.ts';
import { db, kvGet, kvSet } from './db.ts';
import { catalog } from './catalog.ts';
import { GAME_LEAGUES, LEAGUE_IDS, SOCCER, urls, teamKey, playerKey, type League } from './leagues.ts';
import { scanNews } from './news.ts';
import { staleUpNext, startUpNext } from './upnext.ts';
import { startF1, f1Status } from './f1.ts';
import {
  PLAYER_DETECTORS, playerTeamLostEvents, eliminationOf, boxPitchers, fromCommentary, fromCorePlay, fromKeyEvents, fromSitePlay, gameLostEvent, heavyLossEvent, keepers, soccerFoul, soccerTouch, gameStartEvents, mergePlays, mlbFinalHalfInning, nextScore, observePlay, absCall, isPitch, pitchSlot, ordinal, pitcherEvents, teamScoreEvents, umpireReviewLost,
  type Detected, type GameCtx, type NPlay,
} from './detectors.ts';
import { publish } from './fanout.ts';
import { boxGoalies, boxPassers, boxPitchCounts, gameCard, getGame, patchGame, pruneGames, upsertGame, winProb } from './scores.ts';

/** Seam for tests (test/game-start.test.ts feeds a game fake ESPN responses). Production never changes it. */
export const liveDeps = {
  getJson: getJson as (url: string, opts?: { timeoutMs?: number; bust?: boolean }) => Promise<any>,
};

const LIVE_POLL_MS = Number(process.env.HW_LIVE_POLL_MS ?? 2000);      // per live game
const SCOREBOARD_MS = Number(process.env.HW_SCOREBOARD_MS ?? 10000);   // discovers games going live / final
const STANDINGS_MS = Number(process.env.HW_STANDINGS_MS ?? 60000);
const INJURIES_MS = Number(process.env.HW_INJURIES_MS ?? 30000);
const YESTERDAY_MS = Number(process.env.HW_YESTERDAY_MS ?? 10 * 60_000); // yesterday's finals, for the Scores tab
const NEWS_MS = Number(process.env.HW_NEWS_MS ?? 3 * 60_000); // off-field trouble, fines and suspensions (news.ts)
/** Plays older than this when we first attach to a game are treated as history, not news. */
const BACKFILL_WINDOW_MS = 90_000;
/** MLB: after the final, how often and how many times to look for the pitching decisions (W/L), which can trail the last out. */
const DECISION_RETRY_MS = Number(process.env.HW_DECISION_RETRY_MS ?? 15_000);
const DECISION_TRIES = 20;
/** Soccer: how often to read the touch-by-touch feed (passes, dribbles), only while someone tracks a player in the match. */
const TOUCH_MS = Number(process.env.HW_TOUCH_MS ?? 10_000);
const TOUCH_PAGE = 100;
/** A playoff final waits for the scoreboard (the series: is this the end of their season?), but not forever. */
const PLAYOFF_FINAL_WAIT_MS = Number(process.env.HW_PLAYOFF_FINAL_WAIT_MS ?? 120_000);
/** How long a lost ABS challenge waits for ESPN to say it was overturned after all (holdAbs). */
const ABS_SETTLE_MS = Number(process.env.HW_ABS_SETTLE_MS ?? 60_000);

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

// ─── Which teams does anyone care about? ──────────────────────────────────────────────────────
let watchedCache = { at: 0, teams: new Set<string>() };
export function watchedTeamKeys(): Set<string> {
  if (Date.now() - watchedCache.at < 3000) return watchedCache.teams;
  const teams = new Set<string>();
  for (const { target_key } of db.prepare('SELECT DISTINCT target_key FROM follows').all() as { target_key: string }[]) {
    if (target_key.startsWith('team:')) teams.add(target_key);
    else { const p = catalog.player(target_key); if (p) teams.add(p.teamKey); }
  }
  watchedCache = { at: Date.now(), teams };
  return teams;
}
export function invalidateWatched() { watchedCache.at = 0; }

/** The players on a team that anyone tracks (for "their team lost"). */
export function trackedPlayersOn(teamKey: string) {
  const lg = teamKey.split(':')[1];
  return (db.prepare('SELECT DISTINCT target_key FROM follows WHERE target_key LIKE ?').all(`player:${lg}:%`) as { target_key: string }[])
    .map((r) => catalog.player(r.target_key))
    .filter((p): p is NonNullable<typeof p> => p?.teamKey === teamKey);
}

// ─── One live game ────────────────────────────────────────────────────────────────────────────
export interface GameInfo {
  /** We saw this game before it began, so its start is news (attaching mid-game it isn't). */
  sawPre?: boolean;
  venue?: string;
  tv?: string;
}

export class GameTracker {
  readonly ctx: GameCtx;
  private seen = new Set<string>();
  private score = { home: 0, away: 0 };
  /** The score each side's team alerts have gone out for (see poll). */
  private announced = { home: 0, away: 0 };
  private first = true;
  private stopped = false;
  private sawPre: boolean;
  private started = false;
  /** MLB pitcher alerts this game has already had (pitcherEvents): blown saves, no quality starts, losses. */
  private pitching = new Set<string>();
  /** Soccer: teams whose keeper came from the line-ups. Only once: after that, subs and red cards say (observePlay). */
  private keepersSeeded = new Set<string>();
  /** Soccer: commentary fouls already alerted (play id → 'foul' / 'penalty-conceded'). */
  private fouls = new Map<string, string>();
  /** Lost ABS challenges waiting for the review to settle, by pitch (holdAbs). */
  private absHeld = new Map<string, { events: Detected[]; since: number }>();
  /** MLB: each at-bat result's text as last seen, to catch a crew chief review ESPN writes into it later. */
  private resultTexts = new Map<string, string>();
  /** Soccer: the touch-by-touch feed so far (by position; earlier pages skipped when we attach late), and the next touch to judge. */
  private touches: (NPlay | undefined)[] = [];
  private touchNext = 0;
  private touchesAt = 0;
  private touchesFrom = 0; // touches before this (less a margin) are history
  private playersAt = 0;
  private hasPlayers = false;
  /** A postseason game (ESPN season type 3): its final waits for the scoreboard's series (see finish). */
  private postseason = false;
  private finalSeenAt = 0;
  private readonly info: GameInfo;
  finished = false;
  lastPollMs = 0;

  constructor(league: League, gameId: string, homeId: string, awayId: string, info: GameInfo = {}) {
    this.ctx = { league, gameId, homeId, awayId, goalies: new Map() };
    this.info = info;
    this.sawPre = !!info.sawPre;
  }

  start() { void this.loop(); }
  stop() { this.stopped = true; }

  private async loop() {
    while (!this.stopped && !this.finished) {
      const t0 = Date.now();
      try { await this.poll(); } catch (e) { log(`[${this.ctx.league} ${this.ctx.gameId}] poll error`, String(e)); }
      this.lastPollMs = Date.now() - t0;
      // Next poll starts LIVE_POLL_MS after the previous one *started* (never overlapping).
      await new Promise((r) => setTimeout(r, Math.max(250, LIVE_POLL_MS - this.lastPollMs)));
    }
  }

  /**
   * Polls BOTH ESPN sources in parallel and merges by play id (ids are identical across them).
   * Measured live: the core API publishes plays ~15-20s before the site summary does, while the
   * summary carries game status, boxscore goalies, and is a fallback if core hiccups.
   * Soccer is the summary alone: its key events are the plays (the core API has every touch, thousands a match).
   */
  /**
   * Lost ABS challenges wait until the review is over. ESPN posts a challenged pitch as its call
   * "- Confirmed" right away and, if the call is overturned, swaps in an "- Overturned" pitch in the same
   * place under a new id (Lombard Jr.'s strike 2 became ball 4, Rays @ Yankees, 2026-10-07: three alerts
   * that night were challenges won). So a loss goes out once the game has moved past that pitch and
   * ABS_SETTLE_MS have passed (at the final, at once), and only if the pitch still reads Confirmed and,
   * on an at-bat's last pitch, the result doesn't say it was overturned. Returns what to send now.
   */
  private holdAbs(events: Detected[], plays: NPlay[], over: boolean): Detected[] {
    const send: Detected[] = [];
    for (const e of events) {
      if (!e.absSlot) { send.push(e); continue; }
      const held = this.absHeld.get(e.absSlot) ?? { events: [], since: Date.now() };
      held.events.push(e);
      this.absHeld.set(e.absSlot, held);
    }
    for (const [slot, held] of this.absHeld) {
      const versions = plays.filter((p) => pitchSlot(p.id) === slot);
      const latest = versions.length ? plays.lastIndexOf(versions[versions.length - 1]) : -1;
      if (!over && (latest === plays.length - 1 || Date.now() - held.since < ABS_SETTLE_MS)) continue;
      this.absHeld.delete(slot);
      const atBat = slot.slice(0, -2), pitchNo = slot.slice(-2);
      const inAtBat = (p: NPlay) => pitchSlot(p.id).length === slot.length && pitchSlot(p.id).startsWith(atBat);
      const lastPitch = !plays.some((p) => inAtBat(p) && isPitch(p) && pitchSlot(p.id).slice(-2) > pitchNo);
      const result = plays.find((p) => inAtBat(p) && p.typeSlug === 'play-result' && p.participants.some((x) => x.role === 'batter'));
      const why = !versions.length ? 'was taken back'
        : versions.some((p) => absCall(p) === 'overturned') ? 'was overturned'
        : lastPitch && result && /\bchallenged:? call on the field (?:was )?overturned\b/i.test(result.text) ? "was overturned (the at-bat's result says so)"
        : null;
      if (why) { log(`[mlb ${this.ctx.gameId}] ABS challenge at ${slot} ${why} after ESPN first posted it confirmed: no alert`); continue; }
      send.push(...held.events);
    }
    return send;
  }

  async poll() {
    const { league, gameId, homeId, awayId } = this.ctx;
    const soccer = SOCCER.has(league);
    const [core, summary] = await Promise.allSettled([
      soccer ? Promise.resolve({ items: [] }) : liveDeps.getJson(urls.corePlays(league, gameId), { bust: true, timeoutMs: 4000 }),
      liveDeps.getJson(urls.summary(league, gameId), { bust: true, timeoutMs: 4000 }),
    ]);
    if (summary.status === 'rejected' && (soccer || core.status === 'rejected')) throw summary.reason;

    const corePlays: NPlay[] = core.status === 'fulfilled' ? (core.value.items ?? []).map(fromCorePlay) : [];
    // NFL summary has no flat plays list (drives only, without participants); core covers it.
    const sitePlays: NPlay[] = summary.status !== 'fulfilled' || league === 'nfl' ? []
      : soccer ? fromKeyEvents(summary.value, homeId, awayId) : (summary.value.plays ?? []).map(fromSitePlay);
    const plays = mergePlays(corePlays, sitePlays);

    const events: Detected[] = [];
    let final: { home: number; away: number } | null = null;
    if (summary.status === 'fulfilled') {
      const s = summary.value;
      if (this.first && league === 'nhl') this.seedGoalies(s);
      if (soccer) {
        for (const [teamId, gk] of keepers(s)) {
          if (!this.keepersSeeded.has(teamId)) { this.keepersSeeded.add(teamId); this.ctx.goalies.set(teamId, gk); }
        }
      }
      if (s.header?.season?.type === 3) this.postseason = true;
      const comp = s.header?.competitions?.[0];
      // "Hate Watch Starting" goes out once, on the pre → in flip. A game first seen already under
      // way (a follow in the 3rd quarter, a server restart) never gets a late "starting" alert.
      const state = comp?.status?.type?.state;
      if (state === 'pre') this.sawPre = true;
      else if (state === 'in' && this.sawPre && !this.started) {
        this.started = true;
        events.push(...gameStartEvents(this.ctx, this.info, Date.now()));
      }
      if (comp?.status?.type?.completed) {
        const c = (side: string) => Number(comp.competitors.find((x: any) => x.homeAway === side)?.score ?? 0);
        final = { home: c('home'), away: c('away') };
      }
    }
    if (!final && plays.some((p) => /^End (of )?Game$/i.test(p.type))) {
      final = { home: Math.max(...plays.map((p) => p.home)), away: Math.max(...plays.map((p) => p.away)) };
    }

    const cutoff = Date.now() - BACKFILL_WINDOW_MS;
    // The score is re-derived from every play on every poll, not kept as a running total, because
    // ESPN edits plays after publishing them: a goal can be marked as scoring only later, and a
    // disallowed goal is taken back. A running total would miss the first and, after the second,
    // the team's next goal. `announced` is the score each side's alerts have gone out for.
    let score = { home: 0, away: 0 };
    for (const p of plays) {
      const prev = score;
      score = nextScore(prev, p);
      // History from before we attached updates state but is never notified.
      const history = this.first && p.at < cutoff;
      const fresh = !this.seen.has(p.id);
      if (fresh) {
        this.seen.add(p.id);
        if (!history) events.push(...PLAYER_DETECTORS[league](this.ctx, p));
        observePlay(this.ctx, p);
      }
      // A crew chief review can be added to an at-bat's result after it was posted ("Volpe homered…"
      // rewritten as "Volpe doubled, Lombard Jr. scored. Umpire review: HR call on the field was
      // overturned…"). Detectors see a play once, so a rewritten result is checked for a review alone,
      // and only when the review is what's new (a result that had one when we attached is history).
      if (league === 'mlb' && p.typeSlug === 'play-result') {
        const was = this.resultTexts.get(p.id);
        this.resultTexts.set(p.id, p.text);
        if (!fresh && !history && was !== undefined && was !== p.text && !/\bumpire review:/i.test(was)) events.push(...umpireReviewLost(this.ctx, p));
      }
      const up = (s: 'home' | 'away') => score[s] > this.announced[s];
      if (up('home') || up('away')) {
        // A side already announced at this score (its goal was counted from a later play first)
        // doesn't move on this play, so it gets no second alert.
        const from = { home: up('home') ? prev.home : score.home, away: up('away') ? prev.away : score.away };
        this.announced = { home: Math.max(this.announced.home, score.home), away: Math.max(this.announced.away, score.away) };
        if (history) continue;
        events.push(...teamScoreEvents(this.ctx, from, p));
        if (!fresh) {
          log(`[${league} ${gameId}] late score: play ${p.id} became a scoring play after it was first published (${p.away}-${p.home})`);
          if (league === 'nhl') events.push(...PLAYER_DETECTORS.nhl(this.ctx, p).filter((e) => e.type === 'nhl.goalie.goal_allowed'));
        }
      }
    }
    if (score.home < this.announced.home || score.away < this.announced.away) {
      log(`[${league} ${gameId}] score went down to ${score.away}-${score.home} (a goal taken back?); the next one is news again`);
      this.announced = { home: Math.min(this.announced.home, score.home), away: Math.min(this.announced.away, score.away) };
    }
    this.score = score;
    if (soccer && summary.status === 'fulfilled') {
      // Fouls and penalties conceded, from the commentary. A foul's penalty can be written a moment later.
      for (const p of fromCommentary(summary.value, score)) {
        const was = this.fouls.get(p.id);
        if (was === p.typeSlug || was === 'penalty-conceded') continue;
        this.fouls.set(p.id, p.typeSlug);
        if (!(this.first && p.at < cutoff)) events.push(...soccerFoul(this.ctx, p));
      }
      // Passes and dribbles, from the touch-by-touch feed, if anyone tracks a player in the match.
      if (Date.now() - this.touchesAt >= TOUCH_MS && this.tracksPlayers()) {
        this.touchesAt = Date.now();
        events.push(...await this.readTouches().catch((e) => { log(`[${league} ${gameId}] touches`, String(e)); return [] as Detected[]; }));
      }
    }
    // MLB pitchers' lines: a blown save, no quality start. The loss waits for the final (finalPitching).
    if (league === 'mlb' && summary.status === 'fulfilled') {
      const es = pitcherEvents(this.ctx, boxPitchers(summary.value), { final: false, score: this.score, at: Date.now() }, this.pitching);
      if (!this.first) events.push(...es); // attaching mid-game: what already happened is history
    }
    this.first = false;
    if (league === 'mlb') events.splice(0, events.length, ...this.holdAbs(events, plays, !!final));
    if (events.length) publish(events, league);
    // The Scores tab: this play-by-play is ahead of the scoreboard, and the summary has win probability.
    const wp = summary.status === 'fulfilled' ? summary.value.winprobability?.at?.(-1) : undefined;
    patchGame(`${league}:${gameId}`, {
      home: this.score.home, away: this.score.away, winProb: wp?.homeWinPercentage != null ? winProb(wp) : undefined,
      pitchCounts: league === 'mlb' && summary.status === 'fulfilled' ? boxPitchCounts(summary.value) : undefined,
      goalies: league === 'nhl' && summary.status === 'fulfilled' ? boxGoalies(summary.value, this.ctx.goalies) : undefined,
      passers: league === 'nfl' && summary.status === 'fulfilled' ? boxPassers(summary.value) : undefined,
    });
    if (final && this.postseason) {
      // The scoreboard's read (every 10s) finishes it with the series; this is the fallback.
      this.finalSeenAt ||= Date.now();
      if (Date.now() - this.finalSeenAt >= PLAYOFF_FINAL_WAIT_MS) { log(`[${league} ${gameId}] playoff final without the scoreboard's series after ${PLAYOFF_FINAL_WAIT_MS / 1000}s`); this.finish(final); }
    } else if (final) this.finish(final);
  }

  /** Soccer: someone tracks a player on either side (checked every 30s). */
  private tracksPlayers() {
    if (Date.now() - this.playersAt > 30_000) {
      this.playersAt = Date.now();
      this.hasPlayers = [this.ctx.homeId, this.ctx.awayId].some((id) => trackedPlayersOn(teamKey(this.ctx.league, id)).length > 0);
    }
    return this.hasPlayers;
  }

  /**
   * Soccer: the touches since the last read, a page of 100 at a time from the one we stopped in. The
   * first read starts at the newest page (what came before is history). A touch is judged once the
   * next one is in (soccerTouch), so the latest waits for the next read.
   */
  async readTouches(): Promise<Detected[]> {
    const { league, gameId } = this.ctx;
    const get = (page: number) => liveDeps.getJson(urls.corePlays(league, gameId, { limit: TOUCH_PAGE, page }), { bust: true, timeoutMs: 6000 });
    let page = Math.floor(this.touches.length / TOUCH_PAGE) + 1;
    let res = await get(page);
    if (!this.touchesFrom) {
      this.touchesFrom = Date.now();
      const last = Math.max(1, Math.ceil(Number(res.count ?? 0) / TOUCH_PAGE));
      if (last > page) { page = last; this.touches.length = this.touchNext = (last - 1) * TOUCH_PAGE; res = await get(page); }
    }
    for (let reads = 0; reads < 20; reads++) {
      (res.items ?? []).forEach((it: any, i: number) => { this.touches[(page - 1) * TOUCH_PAGE + i] = fromCorePlay(it); });
      if (!(res.items ?? []).length || page >= Number(res.pageCount ?? 1)) break;
      res = await get(++page);
    }
    const out: Detected[] = [], cutoff = this.touchesFrom - BACKFILL_WINDOW_MS;
    for (; this.touchNext < this.touches.length - 1; this.touchNext++) {
      const p = this.touches[this.touchNext], next = this.touches[this.touchNext + 1];
      if (p && next && p.at >= cutoff) out.push(...soccerTouch(this.ctx, p, next));
    }
    return out;
  }

  private seedGoalies(s: any) {
    for (const t of s.boxscore?.players ?? []) {
      const g = t.statistics?.find((x: any) => x.name === 'goalies')?.athletes?.[0]?.athlete?.id;
      if (g) this.ctx.goalies.set(String(t.team.id), String(g));
    }
  }

  /** `ev`: the scoreboard's event, when it's the scoreboard that saw the final (a playoff loss can end a season: eliminationOf). */
  finish(final: { home: number; away: number }, ev?: any) {
    if (this.finished) return;
    this.finished = true;
    for (const id of [this.ctx.homeId, this.ctx.awayId]) staleUpNext(teamKey(this.ctx.league, id)); // their next game is another one now
    const lastHalf = mlbFinalHalfInning(this.ctx); // the final half-inning gets no "End Inning" play
    if (lastHalf.length) publish(lastHalf, this.ctx.league);
    if (this.ctx.league === 'mlb') void this.finalPitching(final);
    const lost = gameLostEvent(this.ctx, final, Date.now(), ev ? eliminationOf(this.ctx.league, ev) : null);
    if (!lost) return; // a tie
    // One alert per device for a loss (they share a moment), each the first it wants: soccer's "thrashed"
    // (3+ goals), then the team's loss, then "their team lost" for its tracked players.
    const heavy = heavyLossEvent(this.ctx, lost, final);
    publish([...(heavy ? [heavy] : []), lost, ...playerTeamLostEvents(this.ctx, lost, trackedPlayersOn(lost.targetKey))], this.ctx.league);
    engine.onGameFinal(this.ctx.league);
  }

  /** MLB: the loss (and whatever else the final box score settles), once ESPN posts the decisions. */
  async finalPitching(final: { home: number; away: number }) {
    for (let i = 0; i < DECISION_TRIES; i++) {
      const s = await liveDeps.getJson(urls.summary('mlb', this.ctx.gameId), { bust: true, timeoutMs: 4000 }).catch(() => null);
      const pitchers = s ? boxPitchers(s) : [];
      if (pitchers.some((p) => p.notes.some((n) => /^[WL]\b/.test(n)))) {
        const es = pitcherEvents(this.ctx, pitchers, { final: true, score: final, at: Date.now() }, this.pitching);
        if (es.length) publish(es, 'mlb');
        return;
      }
      await new Promise((r) => setTimeout(r, DECISION_RETRY_MS));
    }
    log(`[mlb ${this.ctx.gameId}] no pitching decisions ${Math.round((DECISION_TRIES * DECISION_RETRY_MS) / 60000)} min after the final`);
  }
}

// ─── Engine: scoreboards → trackers, plus standings + injuries ─────────────────────────────────
class LiveEngine {
  private trackers = new Map<string, GameTracker>();
  /** Watched games seen before their start but not tracked yet (a tracker attaches 3 min out; a doubleheader nightcap can start early). */
  private preSeen = new Set<string>();
  private kickers: Partial<Record<League, () => void>> = {};
  private standingsKick: Partial<Record<League, () => void>> = {};
  private upNextKick?: () => void;

  start() {
    for (const lg of GAME_LEAGUES) {
      this.kickers[lg] = every(SCOREBOARD_MS, () => this.scanScoreboard(lg));
      this.standingsKick[lg] = every(STANDINGS_MS, () => scanStandings(lg));
      every(INJURIES_MS, () => scanInjuries(lg));
      every(YESTERDAY_MS, () => scanYesterday(lg));
    }
    this.kickers.f1 = startF1(every); // races, not games: see f1.ts
    for (const lg of LEAGUE_IDS) every(NEWS_MS, () => scanNews(lg));
    this.upNextKick = startUpNext(watchedTeamKeys); // the Scores tab's "Up next"
  }

  /** Called when someone follows something, so a game already in progress starts tracking immediately. */
  kick() { invalidateWatched(); for (const k of Object.values(this.kickers)) k?.(); this.upNextKick?.(); }

  onGameFinal(lg: League) { setTimeout(() => this.standingsKick[lg]?.(), 15_000).unref(); }

  status() {
    return [
      ...[...this.trackers.values()].map((t) => ({ league: t.ctx.league, gameId: t.ctx.gameId, finished: t.finished, lastPollMs: t.lastPollMs })),
      ...f1Status(),
    ];
  }

  private async scanScoreboard(lg: League) {
    const sb = await liveDeps.getJson(urls.scoreboard(lg), { timeoutMs: 6000, bust: true });
    const watched = watchedTeamKeys();
    // Every game on the board gets a Scores-tab card (they're pushed only to devices that track a side).
    const seen = new Set<string>();
    for (const ev of sb.events ?? []) {
      const card = gameCard(lg, ev);
      if (card) { upsertGame(card); seen.add(card.key); }
    }
    pruneGames(lg, seen);
    for (const ev of sb.events ?? []) {
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      if (!home || !away) continue;
      const state = ev.status?.type?.state;
      const startsIn = Date.parse(ev.date) - Date.now();
      const relevant = watched.has(teamKey(lg, home.id)) || watched.has(teamKey(lg, away.id));
      const key = `${lg}:${ev.id}`;
      let tr = this.trackers.get(key);
      if (relevant && state === 'pre') this.preSeen.add(key);
      else if (!relevant) this.preSeen.delete(key);

      if (relevant && !tr && (state === 'in' || (state === 'pre' && startsIn < 3 * 60_000))) {
        const tv = comp.broadcasts?.find((b: any) => b.market === 'national')?.names?.[0] ?? comp.broadcasts?.[0]?.names?.[0];
        tr = new GameTracker(lg, ev.id, home.id, away.id, { sawPre: this.preSeen.delete(key), venue: comp.venue?.fullName, tv });
        this.trackers.set(key, tr);
        log(`[${lg}] tracking ${ev.shortName ?? ev.name} (${ev.id})`);
        tr.start();
      }
      if (state === 'post') this.preSeen.delete(key); // e.g. postponed before it ever started
      if (state === 'post' && ev.status?.type?.completed) {
        // Scoreboard is the backstop for finals (NFL, or a restart right after the buzzer).
        if (!tr && relevant && Date.now() - Date.parse(ev.date) < 6 * 3600_000) {
          tr = new GameTracker(lg, ev.id, home.id, away.id);
          this.trackers.set(key, tr);
        }
        tr?.finish({ home: Number(home.score), away: Number(away.score) }, ev); // with the series: a playoff loss can end their season
        tr?.stop();
      }
      if (tr && !relevant && !tr.finished) {
        tr.stop(); this.trackers.delete(key);
        log(`[${lg}] stopped tracking ${ev.shortName ?? ev.name} (${ev.id}): nobody tracks either team now`);
      }
    }
    for (const [k, t] of this.trackers) if (t.finished && !(sb.events ?? []).some((e: any) => `${lg}:${e.id}` === k) && k.startsWith(lg)) this.trackers.delete(k);
  }
}

export const engine = new LiveEngine();

/**
 * The Scores tab keeps a final for a day after it ends, but ESPN's scoreboard rolls over to the new day,
 * and a restart forgets the games we'd seen. Yesterday's finals (ESPN's date, US Eastern) come from
 * yesterday's scoreboard. Games we already have are left to today's scoreboard and their trackers.
 */
export async function scanYesterday(lg: League, now = Date.now()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now - 86400_000).replaceAll('-', '');
  const sb = await liveDeps.getJson(urls.scoreboard(lg, day), { timeoutMs: 8000 });
  for (const ev of sb.events ?? []) {
    if (ev.status?.type?.state !== 'post') continue;
    const card = gameCard(lg, ev);
    if (card && !getGame(card.key)) upsertGame(card);
  }
}

function every(ms: number, fn: () => Promise<void>): () => void {
  let running = false;
  let timer: NodeJS.Timeout;
  const run = async () => {
    clearTimeout(timer);
    if (running) return;
    running = true;
    try { await fn(); } catch (e) { log('loop error', String(e)); }
    running = false;
    timer = setTimeout(run, ms);
  };
  void run();
  return () => void run();
}

// ─── Standings: drops, losing streaks, elimination ────────────────────────────────────────────
/** `note`: the zone a table position is in, where ESPN marks it (EPL: "Champions League", "Relegation"). */
interface StandingSnap { rank: number; group: string; clincher: string; streak: string; note?: string }

export function parseStandings(res: any): Map<string, StandingSnap> {
  const out = new Map<string, StandingSnap>();
  const walk = (node: any, parent?: any) => {
    if (node.standings?.entries?.length) {
      const stat = (e: any, n: string) => e.stats?.find((s: any) => s.name === n || s.type === n);
      // Soccer tables have no playoff seed; their "rank" is the table position.
      const seed = (e: any) => Number(stat(e, 'playoffSeed')?.value) || Number(stat(e, 'rank')?.value) || 0;
      const entries = [...node.standings.entries].sort((a, b) =>
        (seed(a) || 99) - (seed(b) || 99)
        || Number(stat(b, 'winPercent')?.value ?? 0) - Number(stat(a, 'winPercent')?.value ?? 0));
      // The EPL's one group is named for the season ("2026-2027"); the league's own name reads better.
      const name = node.abbreviation ?? node.name ?? '';
      const group = /^\d{4}-\d{2,4}$/.test(name) && parent ? parent.abbreviation ?? parent.name ?? name : name;
      entries.forEach((e, i) => out.set(String(e.team.id), {
        rank: seed(e) || i + 1,
        group,
        clincher: String(stat(e, 'clincher')?.displayValue ?? ''),
        streak: String(stat(e, 'streak')?.displayValue ?? ''),
        ...(e.note?.description ? { note: String(e.note.description) } : {}),
      }));
    }
    for (const c of node.children ?? []) walk(c, node);
  };
  walk(res);
  return out;
}

/** "Down from 16th. Into the relegation zone 🪂 Streak: L3" (the parts ESPN has). */
export function dropBody(was: StandingSnap, cur: StandingSnap) {
  const relegation = (x: StandingSnap) => /relegation/i.test(x.note ?? '');
  return [`Down from ${ordinal(was.rank)}.`, relegation(cur) && !relegation(was) && 'Into the relegation zone 🪂', cur.streak && `Streak: ${cur.streak}`].filter(Boolean).join(' ');
}

async function scanStandings(lg: League) {
  const now = parseStandings(await getJson(urls.standings(lg), { timeoutMs: 8000 }));
  if (!now.size) return;
  const prev = new Map(Object.entries(kvGet<Record<string, StandingSnap>>(`standings:${lg}`) ?? {}));
  kvSet(`standings:${lg}`, Object.fromEntries(now));
  if (!prev.size) return; // first snapshot is the baseline
  const day = new Date().toISOString().slice(0, 10);
  const events: Detected[] = [];
  for (const [teamId, cur] of now) {
    const was = prev.get(teamId);
    const team = catalog.teamByEspn(lg, teamId);
    if (!was || !team) continue;
    const base = { targetKey: team.key, at: Date.now(), meta: { teamId } };
    if (cur.group === was.group && cur.rank > was.rank) {
      events.push({ ...base, id: `standings:${lg}:${teamId}:${day}:${was.rank}->${cur.rank}`, type: 'team.standings_drop', title: `${team.shortName} dropped to ${ordinal(cur.rank)} in the ${cur.group}`, body: dropBody(was, cur) });
    }
    if (/e/i.test(cur.clincher) && !/e/i.test(was.clincher)) {
      events.push({ ...base, id: `elim:${lg}:${teamId}:${new Date().getFullYear()}`, type: 'team.eliminated', title: `${team.shortName} are ELIMINATED ⚰️`, body: `Officially out of playoff contention. See you next year.` });
    }
    const m = cur.streak.match(/^L(\d+)$/);
    if (m && Number(m[1]) >= 3 && cur.streak !== was.streak) {
      events.push({ ...base, id: `streak:${lg}:${teamId}:${day}:${cur.streak}`, type: 'team.losing_streak', title: `${team.shortName} have lost ${m[1]} straight`, body: `Current streak: ${cur.streak}` });
    }
  }
  if (events.length) publish(events, lg);
}

// ─── Injuries ─────────────────────────────────────────────────────────────────────────────────
const SEVERITY: [RegExp, number][] = [[/injured reserve|^ir|60-day|season/i, 4], [/out|suspension/i, 3], [/doubtful/i, 2], [/questionable|day-to-day|probable/i, 1]];
const severity = (s: string) => SEVERITY.find(([re]) => re.test(s))?.[1] ?? 1;

/** On ESPN's injury reports but not hurt: NFL game-day "Active" (cleared to play), MLB paternity/bereavement leave. */
const NOT_INJURED = /^(active|paternity|bereavement)\b/i;

export type InjuryReport = Record<string, { status: string; teamId: string; detail: string }>;

/** athleteId → status, team and note from ESPN's injuries endpoint, leaving out players who aren't injured. */
export function parseInjuryReport(res: any): InjuryReport {
  const now: InjuryReport = {};
  for (const team of res.injuries ?? []) {
    for (const inj of team.injuries ?? []) {
      const a = inj.athlete ?? {};
      const id = a.id ?? athleteIdFromRef(a.$ref) ?? a.links?.map((l: any) => l.href?.match(/\/id\/(\d+)/)?.[1]).find(Boolean);
      const status = String(inj.status ?? inj.type?.description ?? 'Injured');
      if (id && !NOT_INJURED.test(status)) now[id] = { status, teamId: String(team.id), detail: String(inj.shortComment ?? inj.details?.type ?? '') };
    }
  }
  return now;
}

/**
 * Alerts for what got worse between two injury reports. Every player gets their own alert; every team
 * gets ONE per report update, listing everyone (a game-day inactive list can rule six Falcons out in
 * the same second: "Falcons: 6 players downgraded to Out", not six alerts).
 */
export function injuryEvents(lg: League, prev: InjuryReport, now: InjuryReport, day: string, at = Date.now()): Detected[] {
  const events: Detected[] = [];
  const byTeam = new Map<string, { athleteId: string; name: string; status: string; downgrade: boolean; title: string; body: string; id: string }[]>();
  for (const [athleteId, cur] of Object.entries(now)) {
    const was = prev[athleteId];
    if (was && severity(cur.status) <= severity(was.status)) continue;
    const name = catalog.playerByEspn(lg, athleteId)?.name ?? 'A player';
    const team = catalog.teamByEspn(lg, cur.teamId);
    const title = was ? `${name} downgraded to ${cur.status}` : `${name} is injured (${cur.status})`;
    const id = `inj:${lg}:${athleteId}:${cur.status}:${day}`;
    const body = cur.detail || `${team?.shortName ?? ''} injury report`;
    events.push({ id, type: 'player.injured', targetKey: playerKey(lg, athleteId), title, body, at, meta: { athleteId } });
    if (team) byTeam.set(team.key, [...(byTeam.get(team.key) ?? []), { athleteId, name, status: cur.status, downgrade: !!was, title, body, id }]);
  }
  for (const [key, changes] of byTeam) {
    const team = catalog.team(key)!;
    if (changes.length === 1) { // one player: the same alert (and id) as always
      const c = changes[0];
      events.push({ id: `${c.id}:team`, type: 'team.player_injured', targetKey: key, title: `${team.shortName}: ${c.title}`, body: c.body, at, meta: { athleteId: c.athleteId } });
      continue;
    }
    changes.sort((a, b) => severity(b.status) - severity(a.status) || a.name.localeCompare(b.name));
    const counts = new Map<string, number>();
    for (const c of changes) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    const one = counts.size === 1 ? changes[0].status : null;
    const title = one && changes.every((c) => c.downgrade)
      ? `${team.shortName}: ${changes.length} players downgraded to ${one}`
      : `${team.shortName}: ${changes.length} players on the injury report (${[...counts].map(([st, n]) => `${n} ${st}`).join(', ')})`;
    const names = changes.slice(0, 3).map((c) => (one ? c.name : `${c.name} (${c.status})`));
    const body = `${names.join(', ')}${changes.length > 3 ? ` and ${changes.length - 3} more` : ''}`;
    // The id is the exact set of changes, so a re-scan or restart never sends the same batch twice.
    const set = createHash('sha256').update(changes.map((c) => `${c.athleteId}:${c.status}`).sort().join(',')).digest('base64url').slice(0, 12);
    events.push({ id: `inj:${lg}:team:${team.espnId}:${day}:${set}`, type: 'team.player_injured', targetKey: key, title, body, at, meta: { athleteIds: changes.map((c) => c.athleteId) } });
  }
  return events;
}

async function scanInjuries(lg: League) {
  const now = parseInjuryReport(await getJson(urls.injuries(lg), { conditional: true, timeoutMs: 8000 }));
  const prev = kvGet<InjuryReport>(`injuries:${lg}`);
  kvSet(`injuries:${lg}`, now);
  if (!prev) return;
  const events = injuryEvents(lg, prev, now, new Date().toISOString().slice(0, 10));
  if (events.length) publish(events, lg);
}
