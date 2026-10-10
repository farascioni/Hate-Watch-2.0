import { createHash } from 'node:crypto';
import { getJson, athleteIdFromRef } from './espn.ts';
import { db, kvGet, kvSet } from './db.ts';
import { catalog } from './catalog.ts';
import { GAME_LEAGUES, LEAGUE_IDS, SOCCER, urls, teamKey, playerKey, type League } from './leagues.ts';
import { scanNews } from './news.ts';
import { staleUpNext, startUpNext } from './upnext.ts';
import { startF1, f1Status } from './f1.ts';
import { startUfc, ufcStatus } from './ufc.ts';
import {
  PLAYER_DETECTORS, playerTeamLostEvents, eliminationOf, boxPitchers, fromCommentary, fromCorePlay, fromKeyEvents, fromSitePlay, gameLostEvent, heavyLossEvent, keepers, soccerFoul, soccerTouch, gameStartEvents, mergePlays, mlbFinalHalfInning, nextScore, observePlay, absCall, isPitch, pitchSlot, ordinal, pitcherEvents, teamScoreEvents, umpireReviewLost,
  bundleByPlay, boxHits, boxPlayerFacts, leadStory, lossFacts, nflDriveEvents, playerFinalEvents, scoreLine, scorelessAtHalf, seriesSpot, soccerCommentaryEvents, type Detected, type GameCtx, type NPlay, type Pregame,
} from './detectors.ts';
import { eventChanged, publish } from './fanout.ts';
import { attachClips, clipFromVideo, isRecap, playIdsIn } from './clips.ts';
import { flagOn } from './flags.ts';
import type { Clip } from './highlights.ts';
import { soccerType } from './event-types.ts';
import { boxGoalies, boxPassers, boxPitchCounts, gameCard, getGame, oddsChance, patchGame, pruneGames, upsertGame, winProb } from './scores.ts';
import { divisionsOf } from './divisions.ts';
import { weeklyRecaps } from './recap.ts';

/** Seam for tests (test/game-start.test.ts feeds a game fake ESPN responses). Production never changes it. */
export const liveDeps = {
  getJson: getJson as (url: string, opts?: { timeoutMs?: number; bust?: boolean }) => Promise<any>,
  /** A clip's record from ESPN's clip API, as text: its play ids are too long for JSON numbers (clips.ts). */
  getText: async (url: string): Promise<string> => {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.text();
  },
};

const LIVE_POLL_MS = Number(process.env.HW_LIVE_POLL_MS ?? 2000);      // per live game
// ESPN's clips (clips.ts): new clips read from the clip API a few per poll; after the final, the summary every
// minute for an hour, for the last plays' clips (up to ~10 minutes later) and the recap (20 to 50 minutes).
const CLIP_READS = 4;
const CLIP_TRIES = 3; // a clip whose record won't load is skipped after this many reads
const CLIPS_POLL_MS = 60_000;
const CLIPS_AFTER_FINAL_MS = 60 * 60_000;
const CLIP_LEAGUES = new Set<League>(['mlb', 'nba', 'wnba', 'nhl']); // the leagues ESPN has clips for (none for the NFL or soccer in October 2026)
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
/** How often to check for weekly recaps to send (Monday 9 am in each device's time zone, recap.ts). */
const RECAP_MS = Number(process.env.HW_RECAP_MS ?? 15 * 60_000);

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);
/** Each side's biggest lead so far, given the score now. */
const bump = (led: { home: number; away: number }, s: { home: number; away: number }) => {
  led.home = Math.max(led.home, s.home - s.away);
  led.away = Math.max(led.away, s.away - s.home);
};

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
  /** Every play as of the last poll, for the facts of a loss (how it ended, the biggest leads: lossFacts). */
  private plays: NPlay[] = [];
  /** What we knew before the game (odds, records, streaks, the series), kept in kv for restarts: lossFacts. */
  private pre: Pregame;
  /** NHL: the game went to overtime or a shootout (the summary's "Final/OT", "Final/SO"). */
  private overtime: 'ot' | 'so' | null = null;
  /** The last game summary read (its box score: the final's box-score facts, position players pitching). */
  private box: any = null;
  /** Once-a-game facts already sent or baselined (position player pitching, scoreless halves, goalies pulled…). */
  private onceDone = new Set<string>();
  finished = false;
  // ESPN's clips of this game (clips.ts): each play's by play id, the recap, which clips' records were read,
  // and whether alerts went out since clips were last put on alerts.
  private clipByPlay = new Map<string, Clip>();
  private recap: Clip | null = null;
  private clipsRead = new Set<string>();
  private clipTries = new Map<string, number>();
  private newAlerts = false;
  private clipsBusy = false;
  lastPollMs = 0;

  constructor(league: League, gameId: string, homeId: string, awayId: string, info: GameInfo = {}) {
    this.ctx = { league, gameId, homeId, awayId, goalies: new Map() };
    this.info = info;
    this.sawPre = !!info.sawPre;
    this.pre = kvGet<Pregame>(this.preKey) ?? {};
  }

  private get preKey() { return `pregame:${this.ctx.league}:${this.ctx.gameId}`; }
  private savePre(patch: Pregame) {
    const next = { ...this.pre, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.pre)) return;
    this.pre = next;
    kvSet(this.preKey, next);
  }

  /**
   * Before or during the game, what the facts of a loss need from before it: the line (a summary keeps
   * it after the final, in `pickcenter`), and while the game isn't over, both records and ESPN's streaks
   * (the standings as last read: they move only after the final).
   */
  private readPregame(s: any) {
    const { league, homeId, awayId } = this.ctx;
    const chance = oddsChance(league, s.pickcenter?.[0] ?? s.odds?.[0]);
    if (chance && !this.pre.chance) this.savePre({ chance: { home: chance.home, away: chance.away } });
    const comp = s.header?.competitions?.[0];
    if (!['pre', 'in'].includes(comp?.status?.type?.state) || this.pre.records) return;
    const rec = (side: string) => comp?.competitors?.find((c: any) => c.homeAway === side)?.record?.find((r: any) => r.type === 'total')?.summary;
    const standings = kvGet<Record<string, { streak?: string }>>(`standings:${league}`) ?? {};
    this.savePre({
      records: { home: rec('home'), away: rec('away') },
      streak: { home: standings[homeId]?.streak ?? '', away: standings[awayId]?.streak ?? '' },
      seasonType: Number(s.header?.season?.type) || undefined,
    });
  }

  /**
   * MLB: a position player on the mound for a team (a blowout's white flag), once a game. A pitcher is one the
   * catalog lists at P, SP or RP, or with SP among their positions (two-way players). The first read is a baseline.
   */
  private positionPlayerPitching(pitchers: ReturnType<typeof boxPitchers>): Detected[] {
    const out: Detected[] = [];
    for (const p of pitchers) {
      const key = `ppp:${p.teamId}`;
      const pl = catalog.playerByEspn('mlb', p.id);
      const pitcher = !pl || /^(P|SP|RP)$/.test(pl.position ?? '') || (pl.positions ?? []).includes('SP');
      if (!p.active || pitcher || this.onceDone.has(key)) continue;
      this.onceDone.add(key);
      const team = catalog.teamByEspn('mlb', p.teamId);
      if (!team) continue;
      out.push({ id: `${this.ctx.gameId}:mlb.team.position_player_pitching:${p.teamId}`, type: 'mlb.team.position_player_pitching', targetKey: team.key,
        title: `${team.shortName} have a position player pitching`, body: `${pl.name} (${pl.position}) is on the mound — ${scoreLine(this.ctx, this.score)}`, at: Date.now(), meta: { gameId: this.ctx.gameId, athleteId: p.id } });
    }
    return out;
  }

  /** Regular season: each side's place among its meetings with the other (sweeps). Read once, at the start. */
  private async readSeries() {
    const { league, gameId, homeId, awayId } = this.ctx;
    if (this.pre.series || SOCCER.has(league)) return;
    const spot = async (teamId: string) => seriesSpot(league, await liveDeps.getJson(`${urls.teamSchedule(league, teamId)}?seasontype=2`, { timeoutMs: 8000 }), gameId, teamId);
    const [home, away] = await Promise.all([spot(homeId).catch(() => undefined), spot(awayId).catch(() => undefined)]);
    if (home || away) this.savePre({ series: { home, away } });
  }

  start() { void this.readSeries(); void this.loop(); }
  stop() { this.stopped = true; }

  /**
   * The summary's new clips: a play's onto the alerts about it (its record read once from the clip API,
   * a few per read), the recap kept for the loss. Their feeds get the alert again, with the clip. One read
   * at a time, and the poll doesn't wait for it: a slow clip API never holds up an alert.
   */
  async readClips(summary: any) {
    if (this.clipsBusy || (!flagOn('clips.feed') && !flagOn('clips.loss'))) return;
    this.clipsBusy = true;
    try {
      const fresh = (summary?.videos ?? []).filter((v: any) => v?.id != null && !this.clipsRead.has(String(v.id))).slice(0, CLIP_READS);
      for (const v of fresh) {
        const id = String(v.id), clip = clipFromVideo(v);
        if (clip && isRecap(clip)) this.recap = clip;
        else if (clip && v.links?.api?.self?.href) {
          const raw = await liveDeps.getText(v.links.api.self.href).catch(() => null);
          if (raw == null) {
            // Read it again next time, but not forever: a record that won't load mustn't keep newer clips waiting.
            const tries = (this.clipTries.get(id) ?? 0) + 1;
            this.clipTries.set(id, tries);
            if (tries < CLIP_TRIES) continue;
          } else for (const playId of playIdsIn(raw)) this.clipByPlay.set(playId, clip);
        }
        this.clipsRead.add(id);
      }
      if (!fresh.length && !this.newAlerts) return;
      this.newAlerts = false;
      for (const id of attachClips(this.ctx.gameId, this.clipByPlay, this.recap)) eventChanged(id);
    } finally { this.clipsBusy = false; }
  }

  /** Clips of the last plays, and the recap, come after the final: the summary every minute for an hour. */
  private async clipsAfterFinal() {
    for (const end = Date.now() + CLIPS_AFTER_FINAL_MS; !this.stopped && Date.now() < end;) {
      await new Promise((r) => setTimeout(r, CLIPS_POLL_MS).unref());
      if (!flagOn('clips.feed') && !flagOn('clips.loss')) continue; // switched off: nothing to read for
      const s = await liveDeps.getJson(urls.summary(this.ctx.league, this.ctx.gameId), { bust: true, timeoutMs: 6000 }).catch(() => null);
      if (s) await this.readClips(s).catch((e) => log(`[${this.ctx.league} ${this.ctx.gameId}] clips`, String(e)));
    }
  }

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
    if (plays.length) this.plays = plays;

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
      this.readPregame(s);
      this.box = s;
      const comp = s.header?.competitions?.[0];
      const detail = String(comp?.status?.type?.detail ?? '');
      if (league === 'nhl' && /\/(OT|SO)\b/.test(detail)) this.overtime = /SO/.test(detail) ? 'so' : 'ot';
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
    const led = { home: 0, away: 0 }; // each side's biggest lead before this play ("blew a big lead")
    for (const p of plays) {
      bump(led, score);
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
        events.push(...teamScoreEvents(this.ctx, from, p, { ...led }));
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
        if (!(this.first && p.at < cutoff)) events.push(...(p.typeSlug === 'woodwork' || p.typeSlug === 'var-no-goal' ? soccerCommentaryEvents(this.ctx, p) : soccerFoul(this.ctx, p)));
      }
      // Passes and dribbles, from the touch-by-touch feed, if anyone tracks a player in the match.
      if (Date.now() - this.touchesAt >= TOUCH_MS && this.tracksPlayers()) {
        this.touchesAt = Date.now();
        events.push(...await this.readTouches().catch((e) => { log(`[${league} ${gameId}] touches`, String(e)); return [] as Detected[]; }));
      }
    }
    // MLB pitchers' lines: a blown save, no quality start. The loss waits for the final (finalPitching).
    if (league === 'mlb' && summary.status === 'fulfilled') {
      const pitchers = boxPitchers(summary.value);
      const es = [...pitcherEvents(this.ctx, pitchers, { final: false, score: this.score, at: Date.now() }, this.pitching), ...this.positionPlayerPitching(pitchers)];
      if (!this.first) events.push(...es); // attaching mid-game: what already happened is history
    }
    // NFL: each finished drive's alerts (three-and-out, on downs, an empty red-zone trip), once; the first read is a baseline.
    if (league === 'nfl' && summary.status === 'fulfilled') {
      for (const d of summary.value.drives?.previous ?? []) {
        if (!d?.result || this.onceDone.has(`drive:${d.id}`)) continue;
        this.onceDone.add(`drive:${d.id}`);
        if (!this.first) events.push(...nflDriveEvents(this.ctx, d));
      }
    }
    // NBA, WNBA: scoreless at the half, from the box score once the 3rd quarter's plays start (not if we attached after).
    if ((league === 'nba' || league === 'wnba') && summary.status === 'fulfilled' && !this.onceDone.has('half') && plays.some((p) => (p.periodNum ?? 0) >= 3)) {
      this.onceDone.add('half');
      if (!this.first) events.push(...scorelessAtHalf(this.ctx, summary.value));
    }
    // "Being no-hit through 6" comes from the core feed's hit count: the box score has to agree (0), or it waits.
    if (league === 'mlb') {
      const hits = summary.status === 'fulfilled' ? boxHits(summary.value) : undefined;
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e.type === 'mlb.team.no_hit' && hits?.[e.targetKey.split(':')[2]] !== 0) {
          events.splice(i, 1);
          this.ctx.noHit?.delete(e.targetKey.split(':')[2]);
          log(`[mlb ${gameId}] no-hit watch for ${e.targetKey} held: the box score says ${hits?.[e.targetKey.split(':')[2]] ?? 'nothing'}`);
        }
      }
    }
    this.first = false;
    if (league === 'mlb') events.splice(0, events.length, ...this.holdAbs(events, plays, !!final));
    if (events.length) { publish(bundleByPlay(events), league); this.newAlerts = true; }
    if (CLIP_LEAGUES.has(league) && summary.status === 'fulfilled') void this.readClips(summary.value).catch((e) => log(`[${league} ${gameId}] clips`, String(e)));
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
    if (lastHalf.length) publish(bundleByPlay(lastHalf), this.ctx.league); // on the last out's alert, like any other half-inning
    if (this.ctx.league === 'mlb') void this.finalPitching(final);
    const lost = gameLostEvent(this.ctx, final, Date.now(), ev ? eliminationOf(this.ctx.league, ev) : null);
    db.prepare('DELETE FROM kv WHERE key = ?').run(this.preKey); // the game is over: its pregame is spent (this.pre has it)
    // Each player's bad night from the box score (not the preseason's): lines on their team's loss, or their own alerts after a win.
    const seasonType = Number(this.box?.header?.season?.type ?? this.pre.seasonType ?? 2);
    const players = this.box && seasonType !== 1 ? playerFinalEvents(this.ctx, boxPlayerFacts(this.ctx.league, this.box), final, Date.now(), lost) : [];
    if (CLIP_LEAGUES.has(this.ctx.league)) void this.clipsAfterFinal();
    if (!lost) { if (players.length) publish(players, this.ctx.league); return; } // a tie
    // One alert per device for a loss (they share a moment), each the first it wants: soccer's "thrashed"
    // (3+ goals), then the team's loss, then its facts (a walk-off, losing as the favorite…: each a line on
    // the loss, or the alert itself for a device with the loss off), then "their team lost" for its players.
    const heavy = heavyLossEvent(this.ctx, lost, final);
    const postseason = this.postseason || ev?.season?.type === 3;
    // NHL overtime: the summary's "Final/OT" (poll), else the scoreboard's, else the periods played (4 is OT;
    // a regular-season 5th is the shootout).
    const detail = String(ev?.status?.type?.detail ?? '');
    const periods = Math.max(0, ...this.plays.map((p) => p.periodNum ?? 0));
    const overtime = this.ctx.league !== 'nhl' ? null : this.overtime ?? (/\/SO\b/.test(detail) ? 'so' : /\/\d*OT\b/.test(detail) ? 'ot' : periods >= 5 && !postseason ? 'so' : periods >= 4 ? 'ot' : null);
    const facts = lossFacts(this.ctx, lost, final, { plays: this.plays, pre: this.pre, overtime, postseason, box: seasonType !== 1 ? this.box : undefined });
    const loss = [...(heavy ? [heavy] : []), lost, ...facts, ...playerTeamLostEvents(this.ctx, lost, trackedPlayersOn(lost.targetKey)), ...players];
    // The loss's alerts get the winning play's clip (the play that put the winner ahead for good), else the recap (clips.ts).
    const winning = leadStory(this.plays, lost.meta?.winnerId === this.ctx.homeId ? 'home' : 'away').goAhead?.id;
    for (const e of loss) if (e.moment === lost.moment) e.meta = { ...e.meta, lossClip: true, ...(winning ? { clipPlayId: winning } : {}) };
    publish(loss, this.ctx.league);
    this.newAlerts = true;
    if (CLIP_LEAGUES.has(this.ctx.league)) void this.readClips(this.box).catch(() => {}); // the winning play's clip may be out already
    // The standings will say the same streak in a minute (scanStandings): it's been said.
    const streak = facts.find((f) => f.type === 'team.losing_streak');
    if (streak) kvSet(`streak-told:${this.ctx.league}:${lost.targetKey.split(':')[2]}`, `L${streak.meta?.streak}`);
    engine.onGameFinal(this.ctx.league);
  }

  /** MLB: the loss (and whatever else the final box score settles), once ESPN posts the decisions. */
  async finalPitching(final: { home: number; away: number }) {
    for (let i = 0; i < DECISION_TRIES; i++) {
      const s = await liveDeps.getJson(urls.summary('mlb', this.ctx.gameId), { bust: true, timeoutMs: 4000 }).catch(() => null);
      const pitchers = s ? boxPitchers(s) : [];
      if (pitchers.some((p) => p.notes.some((n) => /^[WL]\b/.test(n)))) {
        const es = pitcherEvents(this.ctx, pitchers, { final: true, score: final, at: Date.now() }, this.pitching);
        if (es.length) publish(bundleByPlay(es), 'mlb');
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
    this.kickers.ufc = startUfc(every); // fight cards, not games: see ufc.ts
    every(RECAP_MS, async () => weeklyRecaps());
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
      ...ufcStatus(),
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

/** ESPN's clincher marks that mean a division title: y, and the ones that include it (z: the conference or league's best, *: home field, p: Presidents' Trophy). */
const DIVISION_TITLE = new Set(['y', 'z', '*', 'p']);

/**
 * Standings news, one alert per team per read: being eliminated, a division rival clinching the division,
 * dropping in the standings, a losing streak. They share a moment, in that order, and each one after the
 * first a device wants is a line on it ("Down to 4th in the AL East. Officially out of playoff contention.").
 * A streak the loss alert already gave (lossFacts, `streak-told`) isn't said again.
 */
export async function scanStandings(lg: League) {
  const now = parseStandings(await liveDeps.getJson(urls.standings(lg), { timeoutMs: 8000 }));
  if (!now.size) return;
  const prev = new Map(Object.entries(kvGet<Record<string, StandingSnap>>(`standings:${lg}`) ?? {}));
  kvSet(`standings:${lg}`, Object.fromEntries(now));
  if (!prev.size) return; // first snapshot is the baseline
  const day = new Date().toISOString().slice(0, 10), year = new Date().getFullYear(), at = Date.now();
  // Division rivals that just won the division (MLB, NFL, NBA, NHL: the leagues with divisions).
  const clinched = [...now].filter(([id, cur]) => DIVISION_TITLE.has(cur.clincher) && !DIVISION_TITLE.has(prev.get(id)?.clincher ?? ''));
  const divisions = clinched.length && ['mlb', 'nfl', 'nba', 'nhl'].includes(lg) ? await divisionsOf(lg).catch(() => new Map()) : new Map();
  const events: Detected[] = [];
  for (const [teamId, cur] of now) {
    const was = prev.get(teamId);
    const team = catalog.teamByEspn(lg, teamId);
    if (!was || !team) continue;
    const base = { targetKey: team.key, at, meta: { teamId }, moment: `standings:${lg}:${teamId}:${at}` };
    if (/e/i.test(cur.clincher) && !/e/i.test(was.clincher)) {
      events.push({ ...base, id: `elim:${lg}:${teamId}:${year}`, type: 'team.eliminated', title: `${team.shortName} are ELIMINATED ⚰️`, body: `Officially out of playoff contention. See you next year.`, fold: 'Officially out of playoff contention.' });
    }
    for (const [rivalId] of clinched) {
      const div = divisions.get(teamId)?.name;
      if (rivalId === teamId || !div || divisions.get(rivalId)?.name !== div) continue;
      const rival = catalog.teamByEspn(lg, rivalId)?.shortName ?? 'A rival';
      events.push({ ...base, id: `clinch:${lg}:${rivalId}:${year}:${teamId}`, type: 'team.rival_clinched', title: `The ${rival} clinched the ${div}`, body: `${team.shortName} won't win the division.`, fold: `The ${rival} clinched the ${div}.`, meta: { teamId, rivalId } });
    }
    // Soccer: into the relegation zone (ESPN's table note), before the drop that put them there.
    const relegation = (x: StandingSnap) => /relegation/i.test(x.note ?? '');
    if (SOCCER.has(lg) && relegation(cur) && !relegation(was)) {
      events.push({ ...base, id: `releg:${lg}:${teamId}:${day}`, type: soccerType(lg, 'team.relegation_zone'), title: `${team.shortName} dropped into the relegation zone`, body: dropBody(was, cur), fold: 'Into the relegation zone.' });
    }
    if (cur.group === was.group && cur.rank > was.rank) {
      events.push({ ...base, id: `standings:${lg}:${teamId}:${day}:${was.rank}->${cur.rank}`, type: 'team.standings_drop', title: `${team.shortName} dropped to ${ordinal(cur.rank)} in the ${cur.group}`, body: dropBody(was, cur), fold: `Down to ${ordinal(cur.rank)} in the ${cur.group}.` });
    }
    const m = cur.streak.match(/^L(\d+)$/);
    if (m && Number(m[1]) >= 3 && cur.streak !== was.streak && kvGet(`streak-told:${lg}:${teamId}`) !== cur.streak) {
      events.push({ ...base, id: `streak:${lg}:${teamId}:${day}:${cur.streak}`, type: 'team.losing_streak', title: `${team.shortName} have lost ${m[1]} straight`, body: `Current streak: ${cur.streak}`, fold: `Lost ${m[1]} straight.` });
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
