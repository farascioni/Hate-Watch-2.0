import { createHash } from 'node:crypto';
import { getJson, athleteIdFromRef } from './espn.ts';
import { db, kvGet, kvSet } from './db.ts';
import { addBoxPlayers, catalog } from './catalog.ts';
import { BASKETBALL, FOOTBALL, GAME_LEAGUES, LEAGUE_IDS, SOCCER, TEAMS_ONLY, urls, teamKey, playerKey, type League } from './leagues.ts';
import { scanNews } from './news.ts';
import { staleUpNext, startUpNext } from './upnext.ts';
import { startF1, f1Status } from './f1.ts';
import { startUfc, ufcStatus } from './ufc.ts';
import { POLL_MS as CFB_POLL_MS, scanCfbPoll } from './cfb-poll.ts';
import {
  PLAYER_DETECTORS, playerTeamLostEvents, eliminationOf, boxPitchers, fromCommentary, fromCorePlay, fromDrivePlays, have, are, fromKeyEvents, fromTouchKeyPlay, fromTouchFoul, fromSitePlay, gameLostEvent, shootoutLossBody, gameTiedEvents, heavyLossEvent, keepers, soccerFoul, soccerTouch, gameStartEvents, isSafety, clockSeconds, mergePlays, mlbFinalHalfInning, nextScore, observePlay, absCall, isPitch, pitchSlot, ordinal, pitcherEvents, teamScoreEvents, umpireReviewLost,
  bundleByPlay, boxHits, boxPlayerFacts, leadStory, lossFacts, playerFinalEvents, scoreLine, scorelessAtHalf, seriesSpot, soccerCommentaryEvents, sentOffTitle, type Detected, type GameCtx, type NPlay, type Pregame,
  awaitingBatter, awaitingHockey, awaitingScorer, awaitingShotType, goalNamesScorer, goalOffBoard, goalWords, endedHalf, finalHalfOnLoss, halfFromPlays, mlbHalfInningEnd, playerLossLines, summaryEvent, playsBehindFinal, roundLabel, seriesStanding, strikeoutUnderReview, RULING_PENDING, challengeOutcome, tiedLine, kickPending,
} from './detectors.ts';
import { eventChanged, publish, reviseEvent } from './fanout.ts';
import { BASKETBALL_REVISE_MS, PlayLedger, againLine } from './revisions.ts';
import { attachClips, clipFromVideo, isRecap, playIdsIn } from './clips.ts';
import { flagOn } from './flags.ts';
import type { Clip } from './highlights.ts';
import { soccerType } from './event-types.ts';
import { boxGoalies, boxPassers, boxPitchCounts, competitorScore, gameCard, getGame, oddsChance, patchGame, pruneGames, upsertGame, winProb } from './scores.ts';
import { divisionsOf } from './divisions.ts';
import { weeklyRecaps } from './recap.ts';
import { recordFinalOnBoard } from './misery.ts';

// Basketball ghosts (CHA at BOS, October 14 2026): a non-scoring play first seen more than GHOST_AGE_MS after its wall clock is held for
// GHOST_HOLD_MS before it is judged, since ESPN stamps a play that never happened at a quarter's start and deletes it minutes later
// (`holdGhost`, `ghosts`). A preseason loss skips players the box score lists as did not play, or does not list.
// Hockey (MTL at WSH, DAL at COL, October 14 2026): a goal with no scorer waits 90 s and a repeat of a shot 60 s (`HOCKEY_WAIT_MS`); a shootout game finishes only on the
// scoreboard's Final, not the End Game play; the read that ends the game counts a missing play as gone (`ledger.sweep(now, atFinal)`), and `goneGoals()` sends `goalOffBoard`.

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
const TEAMS_ONLY_POLL_MS = Number(process.env.HW_TEAMS_ONLY_POLL_MS ?? 5000); // per live college football game
// ESPN's clips (clips.ts): new clips read from the clip API a few per poll; after the final, the summary every
// minute for an hour, for the last plays' clips (up to ~10 minutes later) and the recap (20 to 50 minutes).
const CLIP_READS = 4;
const CLIP_TRIES = 3; // a clip whose record won't load is skipped after this many reads
const CLIPS_POLL_MS = 60_000;
const CLIPS_AFTER_FINAL_MS = 60 * 60_000;
/**
 * ESPN corrects football plays after posting END GAME: a lost fumble became the offense's own recovery 24 s after it, and
 * an overtime's last play a sack 36 s after (Browns at Jets, Giants at Commanders, October 11 2026; 4 of 12 games had
 * a change that matters within two minutes). The play ledger revises them, so the tracker goes on reading for this long.
 */
const FINAL_CORRECTIONS_MS = Number(process.env.HW_FINAL_CORRECTIONS_MS ?? 3 * 60_000);
const FINAL_CORRECTIONS_POLL_MS = Number(process.env.HW_FINAL_CORRECTIONS_POLL_MS ?? 10_000);
const CLIP_LEAGUES = new Set<League>(['mlb', 'nba', 'wnba', 'nhl']); // the leagues ESPN has clips for (none for the NFL or soccer in October 2026)
const SCOREBOARD_MS = Number(process.env.HW_SCOREBOARD_MS ?? 10000);   // discovers games going live / final
const STANDINGS_MS = Number(process.env.HW_STANDINGS_MS ?? 60000);
const TEAMS_ONLY_SCOREBOARD_MS = Number(process.env.HW_TEAMS_ONLY_SCOREBOARD_MS ?? 20_000); // college football: every FBS game, a big read
const TEAMS_ONLY_STANDINGS_MS = 10 * 60_000;
/** How long after a loss a drop in the standings is a line on its alert (scanStandings), not an alert of its own. */
const DROP_ON_LOSS_MS = 6 * 3600_000;
const TEAMS_ONLY_QUIET_MS = 5 * 60_000; // college football's scoreboard with no game near
const INJURIES_MS = Number(process.env.HW_INJURIES_MS ?? 30000);
const YESTERDAY_MS = Number(process.env.HW_YESTERDAY_MS ?? 10 * 60_000); // yesterday's finals, for the Scores tab
const NEWS_MS = Number(process.env.HW_NEWS_MS ?? 3 * 60_000); // off-field trouble, fines and suspensions (news.ts)
/** Plays older than this when we first attach to a game are treated as history, not news. */
const BACKFILL_WINDOW_MS = 90_000;
/**
 * A game attached on the server's first scoreboard read of its league (a restart, a deploy): plays this old are still
 * news. ESPN posts plays 80-105 s after they happen, so with 90 s a play the old server never read could already be
 * history. Safe because everything the old server did send is in the database, and the same ids stop at the insert
 * (docs/duplicate-alerts.md, "What survives a restart"). A game followed later keeps 90 s: its old plays went to nobody.
 */
const BOOT_BACKFILL_MS = Number(process.env.HW_BOOT_BACKFILL_MS ?? 5 * 60_000);
/** MLB: after the final, how often and how many times to look for the pitching decisions (W/L), which can trail the last out. */
const DECISION_RETRY_MS = Number(process.env.HW_DECISION_RETRY_MS ?? 15_000);
const DECISION_TRIES = 20;
/** Soccer: how often the touch-by-touch feed is read deep (TOUCH_DEEP touches back; the newest page is read every poll). */
const TOUCH_MS = Number(process.env.HW_TOUCH_MS ?? 10_000);
const TOUCH_PAGE = 100;
/** Soccer: every poll reads the touches back this far (new ones, and ESPN's quick changes to the last few), every TOUCH_MS this far (its retyping of a touch, and taking one out, over a minute or two). */
const TOUCH_SHALLOW = 40;
const TOUCH_DEEP = 250;
/** Soccer: a touch pair is judged again, when either touch changed, for this long after the first of them happened. */
const TOUCH_REJUDGE_MS = 6 * 60_000;
/** A playoff final waits for the scoreboard (the series: is this the end of their season?), but not forever. */
const PLAYOFF_FINAL_WAIT_MS = Number(process.env.HW_PLAYOFF_FINAL_WAIT_MS ?? 120_000);
/**
 * How long a lost ABS challenge waits for ESPN to say it was overturned after all (holdAbs). 30 s: ESPN has swapped in the
 * "Overturned" pitch within 10 to 15 s every time it was timed (six reversals, ALDS Game 5 and NLCS Game 1, October 2026).
 */
export const ABS_SETTLE_MS = Number(process.env.HW_ABS_SETTLE_MS ?? 30_000);
/**
 * MLB: how long a result that says "Official Scorer Ruling Pending" waits for the ruling before it is judged without that
 * sentence (settling): 34 s in NLCS Game 2, October 12 2026. And how long a challenge sentence ESPN adds to a posted result
 * must hold, unchanged, before it is believed (challengeSettled): ESPN wrote "upheld" three times in 100 s on a review that
 * ended "overturned" (ALCS Game 1).
 */
export const RULING_WAIT_MS = Number(process.env.HW_RULING_WAIT_MS ?? 45_000);
export const CHALLENGE_SETTLE_MS = Number(process.env.HW_CHALLENGE_SETTLE_MS ?? 45_000);
/** MLB: the alerts a half-inning's end makes (reopenedHalves puts a line on them when the end is taken back). */
const HALF_END_TYPES = new Set(['mlb.team.stranded_risp', 'mlb.team.down_in_order', 'mlb.team.nobletiger']);
/** MLB: how long a half-inning's end waits for a read with its third out (halfInningEnds), and an at-bat's result for its batter. */
const HALF_END_WAIT_MS = Number(process.env.HW_HALF_END_WAIT_MS ?? 20_000);
/** Basketball: how long a missed shot ESPN hasn't typed yet waits for its type before it's judged as it is (waitForShotType). ESPN typed 55 of 57 within 30 s, 44 within 10 (GS vs LAL, 2026-10-13). */
const SHOT_WAIT_MS = Number(process.env.HW_SHOT_WAIT_MS ?? 15_000);
/** Basketball: how long a basket ESPN posted with no scorer named waits for him (waitForScorer); the team's score alert goes out when it is named. ESPN named 1 of 2 within 4 s, the other was a miss at 14 s (IND at OKC, 2026-10-13). */
const SCORER_WAIT_MS = Number(process.env.HW_SCORER_WAIT_MS ?? 20_000);
/**
 * Hockey: how long ESPN gets to finish a play before its first alert (waitForHockey, awaitingHockey). It posts a shot, then retypes it or makes it a goal 10 to 30
 * seconds later (4 of 9 goals were first a shot), names a penalty 10 to 185 seconds after "Penalty Shot Infraction" (a placeholder ESPN never names is a play it takes out: COL at DAL,
 * the 2 placeholders still unnamed after 2 minutes were gone within 6), and fills in a goal's scorer within a minute (TOR at UTA, 2026-10-13). Past the wait the play is judged
 * as it is, and what ESPN changes after is a line or a rewrite.
 */
const HOCKEY_WAIT_MS = {
  shot: Number(process.env.HW_NHL_SHOT_WAIT_MS ?? 20_000),
  penalty: Number(process.env.HW_NHL_PENALTY_WAIT_MS ?? 600_000),
  goal: Number(process.env.HW_NHL_GOAL_WAIT_MS ?? 90_000),
  /** A shot that copies one already alerted (same shooter and result, within 30 game seconds; ESPN deletes the copy minutes later): feed only unless it is still in ESPN's feed this long after it was first read. */
  copy: Number(process.env.HW_NHL_COPY_WAIT_MS ?? 60_000),
};
/** Hockey: a shot first seen this long after it happened is ESPN back-filling (COL at DAL: shots posted 8 to 31 minutes late), not news: it updates the game's state and alerts nobody. */
const HOCKEY_STALE_SHOT_MS = Number(process.env.HW_NHL_STALE_SHOT_MS ?? 180_000);
/** Soccer: ESPN rewrites a card's or goal's short first text within a minute or two; its alerts take the new words for this long (reviseKeyText). */
const KEY_REVISE_MS = 5 * 60_000;
/** Basketball: a play first read this long after its own wall clock goes to the feed with no push. */
const LATE_POST_MS = 2 * 60_000;
/**
 * Basketball: ESPN posts plays that do not exist, stamped at a quarter's start, and deletes them minutes later (CHA at BOS: a Tatum turnover and an
 * Anderson miss stamped 29 minutes back, gone 4 minutes on; the same turnover for real arrived 2 minutes after). A non-scoring play first seen more
 * than GHOST_AGE_MS after its own wall clock is judged only once it has stood GHOST_HOLD_MS (holdGhost). Every real late post that night was under 4 minutes late.
 */
const GHOST_AGE_MS = Number(process.env.HW_GHOST_AGE_MS ?? 10 * 60_000);
const GHOST_HOLD_MS = Number(process.env.HW_GHOST_HOLD_MS ?? 3 * 60_000);
/** A read of ESPN slower than this is logged, with which feed (poll). */
const SLOW_READ_MS = 3000;
/** How often to check for weekly recaps to send (Monday 9 am in each device's time zone, recap.ts). */
const RECAP_MS = Number(process.env.HW_RECAP_MS ?? 15 * 60_000);
/** Football: after a score is taken back, the same side scoring on that drive within this long is that score (a line on its alert), not another. */
const RESCORE_MS = 10 * 60_000;
/** Football: the summary's header ahead of the plays by the same score this long, and the score alert goes out without its play. */
const HEADER_AHEAD_MS = 60_000;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);
/** Each side's biggest lead so far, given the score now. */
const bump = (led: { home: number; away: number }, s: { home: number; away: number }) => {
  led.home = Math.max(led.home, s.home - s.away);
  led.away = Math.max(led.away, s.away - s.home);
};

/** Football: the summary header's score while the game is on, and its game clock (period, seconds left). */
type Header = { home: number; away: number; period: number; clock?: number };

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
  /** A postseason game's round and game, as the scoreboard's note has it ("NLCS - Game 1"): the start alert's body (roundLabel). */
  note?: string;
  /** Attached on the server's first scoreboard read of its league (a restart): plays up to BOOT_BACKFILL_MS old are news. */
  atBoot?: boolean;
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
  private absHeld = new Map<string, { events: Detected[]; since: number; missing?: number; reversed?: boolean }>();
  /**
   * MLB: half-innings whose "End Inning" play has come, waiting for a read with their third out (halfInningEnds): the
   * play, when it came, and what the old way (each play as first seen) made of the half then, for the log.
   */
  private halfEnds = new Map<string, { playId: string; since: number; seen: string }>();
  /** MLB: at-bat results ESPN posted without their batter, not judged until he's on them (or HALF_END_WAIT_MS passes). */
  private noBatter = new Map<string, number>();
  /** Basketball: missed shots ESPN hasn't typed yet, since when they've waited (waitForShotType). */
  private noShotType = new Map<string, number>();
  /** Basketball: plays first seen long after their wall clock, since when they've been held (holdGhost). */
  private ghosts = new Map<string, number>();
  /** Basketball: baskets ESPN posted with no scorer named, since when they've waited (waitForScorer). */
  private noScorer = new Map<string, number>();
  /** Basketball: box score players already checked against the catalog (addMissingPlayers). */
  private boxChecked = new Set<string>();
  /** Hockey: plays ESPN is still filling in (awaitingHockey), since when they've waited (waitForHockey). */
  private noHockeyPlay = new Map<string, number>();
  /** MLB: results waiting to be judged since when: for the official scorer's ruling (RULING_WAIT_MS), or a strikeout's ABS review (ABS_SETTLE_MS): settling. */
  private settleSince = new Map<string, number>();
  /** MLB: each at-bat result's text and roles as last seen, to log ESPN's changes to a result after posting it. */
  private resultSigs = new Map<string, string>();
  /** MLB: each at-bat result's text as last seen, to catch a crew chief review ESPN writes into it later. */
  private resultTexts = new Map<string, string>();
  /** MLB: each at-bat result as last seen, to compare a rewrite with it (revisedResult). */
  private resultPlays = new Map<string, NPlay>();
  /** MLB: the alerts each play made (after bundleByPlay, so each has its moment), for the lines a rewrite puts on them (revisedResult, linesOnPlay). In memory only. */
  private sent = new Map<string, Detected[]>();
  private sentById = new Map<string, Detected>();
  /** MLB: each "End Inning" play seen, with its half and the reads in a row that have lacked it (reopenedHalves), and the last result of each half whose end was judged (what its alerts hang on). */
  private endInnings = new Map<string, { key: string; missing: number }>();
  private halfJudged = new Map<string, string>();
  /** MLB: strike-three pitches that ended an at-bat ESPN gave no result for, since when, and the result made from the pitch (withStrikeThrees). */
  private strikeThrees = new Map<string, { since: number; made?: NPlay }>();
  /** MLB: a replay challenge's sentence ESPN added to a posted result, until it has held for CHALLENGE_SETTLE_MS (challengeSettled). */
  private challengeWatch = new Map<string, { outcome: 'upheld' | 'overturned' | null; since: number; abs: boolean }>();
  /** Soccer: the touch-by-touch feed so far (by position; earlier pages skipped when we attach late), and the next touch to judge. */
  private touches: (NPlay | undefined)[] = [];
  /** Soccer: the same feed as ESPN sent it, by the same positions (fromTouchKeyPlay and fromTouchFoul read these). */
  private touchItems: any[] = [];
  /** Soccer: the first position held (earlier pages were never read: history). */
  private touchBase = 0;
  private touchNext = 0;
  /** Soccer: each judged pair, by its first touch's position: what it was made of, and the alerts it made (judgeTouches). */
  private touchSigs = new Map<number, { sig: string; ids: string[] }>();
  private touchesAt = 0;
  private touchesFrom = 0; // touches before this (less a margin) are history
  private playersAt = 0;
  private hasPlayers = false;
  /** Soccer: each key event's text as first seen (then as last rewritten) and when, to carry ESPN's rewrite onto its alerts (reviseKeyText). */
  private keyTexts = new Map<string, { text: string; at: number }>();
  /** Soccer: each card alert's moment, by player and minute ("274632@62'"), so the foul behind it is that moment's (linkFoulsToCards). */
  private cardMoments = new Map<string, string>();
  /** A postseason game (ESPN season type 3): its final waits for the scoreboard's series (see finish). */
  private postseason = false;
  private finalSeenAt = 0;
  /**
   * MLB: a final reported while this tracker's plays were still behind it (playsBehindFinal): held for a read that
   * catches up, HALF_END_WAIT_MS at most, so the last half-inning is judged and the last out goes out before the loss.
   */
  private heldFinal: { final: { home: number; away: number }; ev?: any; since: number } | null = null;
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
  /** When the poll loop last started a pass: `GET /health/deep` flags a tracker whose loop stopped turning (health.ts). */
  loopAt = Date.now();
  // Football: ESPN's changes to plays and drives after it posts them (revisions.ts), and the score's: reads in a row
  // that had a side's score lower than announced, the score each side had taken back (and where, for 10 minutes: the
  // same side scoring on that drive is that score again), the header's score ahead of the plays (since when, and the
  // game clock then), and the header scores not to trust ahead of the plays (taken back, or the plays went past them).
  private ledger: PlayLedger;
  private downReads = { home: 0, away: 0 };
  private takenBack: Partial<Record<'home' | 'away', { drive?: string; period?: number; until: number; alerts: Detected[] }>> = {};
  /** Each side's latest score alerts (against the other team), for the tying line when its point after is on another play (footballScore). */
  private lastScored: Partial<Record<'home' | 'away', Detected[]>> = {};
  private ahead: Partial<Record<'home' | 'away', { value: number; since: number; period: number; clock?: number }>> = {};
  private noHeader = { home: 0, away: 0 };

  constructor(league: League, gameId: string, homeId: string, awayId: string, info: GameInfo = {}) {
    this.ctx = { league, gameId, homeId, awayId, goalies: new Map() };
    this.info = info;
    this.sawPre = !!info.sawPre;
    this.pre = kvGet<Pregame>(this.preKey) ?? {};
    this.ledger = new PlayLedger(this.ctx, (msg) => log(`[${league} ${gameId}] ${msg}`));
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
    // College football: each side's top-25 ranking going in.
    const rank = (side: string) => { const r = Number(comp?.competitors?.find((c: any) => c.homeAway === side)?.rank); return r >= 1 && r <= 25 ? r : undefined; };
    this.savePre({
      records: { home: rec('home'), away: rec('away') },
      streak: { home: standings[homeId]?.streak ?? '', away: standings[awayId]?.streak ?? '' },
      seasonType: Number(s.header?.season?.type) || undefined,
      ...(TEAMS_ONLY.has(league) ? { ranks: { home: rank('home'), away: rank('away') } } : {}),
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

  /** Football, after the final: the plays and drives again for FINAL_CORRECTIONS_MS, for ESPN's corrections (revisions.ts). */
  private async correctionsAfterFinal() {
    for (let reads = Math.ceil(FINAL_CORRECTIONS_MS / FINAL_CORRECTIONS_POLL_MS); reads > 0; reads--) {
      await new Promise((r) => setTimeout(r, FINAL_CORRECTIONS_POLL_MS).unref());
      try { await this.poll(); } catch (e) { log(`[${this.ctx.league} ${this.ctx.gameId}] read after the final failed`, String(e)); }
    }
  }

  private async loop() {
    while (!this.stopped && !this.finished) {
      const t0 = Date.now();
      this.loopAt = t0;
      try { await this.poll(); } catch (e) { log(`[${this.ctx.league} ${this.ctx.gameId}] poll error`, String(e)); }
      this.lastPollMs = Date.now() - t0;
      // Next poll starts LIVE_POLL_MS after the previous one *started* (never overlapping); a teams-only league's
      // (college football: its summary is big, and a Saturday has dozens of games) every TEAMS_ONLY_POLL_MS.
      await new Promise((r) => setTimeout(r, Math.max(250, (TEAMS_ONLY.has(this.ctx.league) ? TEAMS_ONLY_POLL_MS : LIVE_POLL_MS) - this.lastPollMs)));
    }
  }

  /**
   * Polls BOTH ESPN sources in parallel and merges by play id (ids are identical across them).
   * Measured live: the core API publishes plays ~15-20s before the site summary does, while the
   * summary carries game status, boxscore goalies, and is a fallback if core hiccups.
   * Soccer: the summary's key events are the plays, and the touch feed (every touch, thousands a match; read a page at a time:
   * refreshTouches) has its goals, cards, substitutions and fouls a few seconds before the summary does (touchKeyPlays).
   */
  /**
   * Lost ABS challenges wait until the review is over. ESPN posts a challenged pitch as its call
   * "- Confirmed" right away and, if the call is overturned, swaps in an "- Overturned" pitch in the same
   * place under a new id (Lombard Jr.'s strike 2 became ball 4, Rays @ Yankees, 2026-10-07: three alerts
   * that night were challenges won). So a loss goes out once the game has moved past that pitch and
   * ABS_SETTLE_MS have passed (at the final, at once), and only if the pitch still reads Confirmed and,
   * on an at-bat's last pitch, the result doesn't say it was overturned. Returns what to send now.
   * A pitch missing from one read isn't taken back: ESPN serves stale copies that drop the latest plays for a read
   * (six times in ALDS Game 5, October 10 2026), so it takes two reads in a row without it. How long ESPN took to
   * post an overturn is logged (10 and 15 seconds in that game), to settle on a shorter wait.
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
      held.missing = versions.length ? 0 : (held.missing ?? 0) + 1;
      if (!held.reversed && versions.some((p) => absCall(p) === 'overturned')) {
        held.reversed = true;
        log(`[mlb ${this.ctx.gameId}] ABS challenge at ${slot} overturned ${Math.round((Date.now() - held.since) / 1000)}s after ESPN posted it confirmed`);
      }
      const latest = versions.length ? plays.lastIndexOf(versions[versions.length - 1]) : -1;
      if (!over && (latest === plays.length - 1 || Date.now() - held.since < ABS_SETTLE_MS)) continue;
      if (!over && held.missing === 1) continue; // gone from one read: a stale copy, or taken back? the next read says
      this.absHeld.delete(slot);
      const atBat = slot.slice(0, -2), pitchNo = slot.slice(-2);
      const inAtBat = (p: NPlay) => pitchSlot(p.id).length === slot.length && pitchSlot(p.id).startsWith(atBat);
      const lastPitch = !plays.some((p) => inAtBat(p) && isPitch(p) && pitchSlot(p.id).slice(-2) > pitchNo);
      const result = plays.find((p) => inAtBat(p) && p.typeSlug === 'play-result' && p.participants.some((x) => x.role === 'batter'));
      const why = held.missing >= 2 ? 'was taken back'
        : versions.some((p) => absCall(p) === 'overturned') ? 'was overturned'
        : lastPitch && result && /\bchallenged:? call on the field (?:was )?overturned\b/i.test(result.text) ? "was overturned (the at-bat's result says so)"
        : null;
      if (why) { log(`[mlb ${this.ctx.gameId}] ABS challenge at ${slot} ${why} after ESPN first posted it confirmed: no alert`); continue; }
      send.push(...held.events);
    }
    return send;
  }

  /**
   * MLB: whether a result is still under review and must wait before it is judged. A strikeout on a challenged last pitch
   * waits ABS_SETTLE_MS (ESPN posts the challenged call "Confirmed" and can overturn it into a walk: Betts, NLCS Game 2,
   * October 12 2026), and a result that says "Official Scorer Ruling Pending" waits RULING_WAIT_MS for the ruling, then is
   * judged without that sentence. The settled version is the one judged. Nothing waits at the final.
   */
  private settling(p: NPlay, now: number, final: boolean): boolean {
    if (final) return false;
    const pending = RULING_PENDING.test(p.text);
    if (!pending && !strikeoutUnderReview(this.ctx, p)) return false; // the ruling came, or the strikeout was rewritten: judged as it reads now
    const since = this.settleSince.get(p.id) ?? now;
    if (!this.settleSince.has(p.id)) {
      this.settleSince.set(p.id, now);
      log(`[mlb ${this.ctx.gameId}] result ${p.id} ${pending ? 'is waiting for the official scorer' : 'is a strikeout under an ABS review'}: waiting ("${p.text}")`);
    }
    const wait = pending ? RULING_WAIT_MS : ABS_SETTLE_MS;
    if (now - since < wait) return true;
    if (pending && RULING_PENDING.test(p.text)) {
      log(`[mlb ${this.ctx.gameId}] result ${p.id} still has no ruling after ${wait / 1000}s: judged without it`);
      p.text = p.text.replace(RULING_PENDING, '').trim();
    }
    return false;
  }

  /**
   * MLB: remember the alerts a poll published under the plays that made them. ESPN's twin plays (a Pick Off and a Play Result
   * with one text) make one alert id twice and only the first is stored and delivered, so both plays are given that first one,
   * the one whose moment the devices hold, for the lines a rewrite puts on it.
   */
  private rememberSent(out: Detected[]) {
    for (const e of out) {
      const playId = e.meta?.playId;
      if (typeof playId !== 'string') continue;
      const kept = this.sentById.get(e.id) ?? (this.sentById.set(e.id, e), e);
      const list = this.sent.get(playId) ?? this.sent.set(playId, []).get(playId)!;
      if (!list.includes(kept)) list.push(kept);
    }
  }

  /** The alerts a play made, with a line on each (no push): `line` goes on every device's copy that got the alert or a line on it. */
  private linesOnPlay(playId: string, line: string, only?: (e: Detected) => boolean): Detected[] {
    return this.ledger.linesOn((this.sent.get(playId) ?? []).filter((e) => !only || only(e)), line);
  }

  /**
   * MLB: what ESPN's rewrite of a posted at-bat result means for the alerts that went out on it. The detectors aren't run
   * again on a rewritten result (Layer 1: text-keyed ids), so only these, each with an id that cannot go out twice:
   * a home run's distance changed (a line on its alerts), an error moved to another fielder (a line on the first fielder's
   * alert, the new fielder's alert), a result that became a scoring play (the pitcher's run alert: the team's came from the
   * score), and a replay challenge's sentence added to it (watched until it holds: challengeSettled).
   */
  private revisedResult(prev: NPlay, p: NPlay, plays: NPlay[], now: number, events: Detected[], changed: Detected[]) {
    const feet = (t: string) => t.match(/\((\d+) feet\)/)?.[1];
    if (feet(prev.text) && feet(p.text) && feet(prev.text) !== feet(p.text)) {
      changed.push(...this.linesOnPlay(p.id, `ESPN corrected the distance: ${feet(p.text)} feet.`));
      log(`[mlb ${this.ctx.gameId}] result ${p.id}: the homer's distance went from ${feet(prev.text)} to ${feet(p.text)} feet: a line on its alerts`);
    }
    const again = PLAYER_DETECTORS.mlb({ ...this.ctx }, p); // on a copy of the game's state: a rewrite changes none of it
    if (!prev.scoring && p.scoring) events.push(...again.filter((e) => e.type === 'mlb.pitcher.runs_allowed' || e.type === 'mlb.pitcher.home_run_allowed'));
    const errors = (this.sent.get(p.id) ?? []).filter((e) => e.type === 'mlb.fielder.error'), now2 = again.filter((e) => e.type === 'mlb.fielder.error');
    if (errors.length && now2.length && !now2.some((e) => errors.some((x) => x.targetKey === e.targetKey))) {
      const to = catalog.player(now2[0].targetKey)?.name ?? 'another fielder';
      changed.push(...this.ledger.linesOn(errors, `ESPN moved this error to ${to}.`));
      events.push(...now2);
      log(`[mlb ${this.ctx.gameId}] result ${p.id}: the error moved to ${to}`);
    }
    const outcome = challengeOutcome(p.text);
    if (outcome && !challengeOutcome(prev.text)) {
      const lastPitch = plays.filter((x) => isPitch(x) && x.id.slice(0, -6) === p.id.slice(0, -6)).pop();
      this.challengeWatch.set(p.id, { outcome, since: now, abs: !!lastPitch && absCall(lastPitch) !== null });
      log(`[mlb ${this.ctx.gameId}] result ${p.id} was given a challenge sentence after it was posted (${outcome}): watching it`);
    }
  }

  /**
   * MLB: a replay challenge's sentence added to a posted result is believed once it has held, unchanged, for
   * CHALLENGE_SETTLE_MS and the game is past that at-bat (a later at-bat's play, not an End Inning play, which can be taken
   * out), or 3 times as long: ALCS Game 1's review wrote "upheld" three times in 100 s, never for more than 35 s at a time, and ended "overturned". Then the lost challenge goes out
   * (challengeLost's own id, from the text). A version without the sentence starts the wait over; "overturned" ends it.
   * At the final it goes at once.
   */
  private challengeSettled(plays: NPlay[], now: number, final: boolean): Detected[] {
    const out: Detected[] = [];
    for (const [id, w] of this.challengeWatch) {
      const i = plays.findIndex((p) => p.id === id);
      if (i < 0) continue; // a stale read, or taken out: waits
      const p = plays[i], outcome = challengeOutcome(p.text);
      if (outcome !== w.outcome) { w.outcome = outcome; w.since = now; }
      if (outcome === 'overturned') { this.challengeWatch.delete(id); log(`[mlb ${this.ctx.gameId}] result ${id}: the challenge was overturned: no alert`); continue; }
      if (outcome !== 'upheld') continue;
      const past = plays.slice(i + 1).some((x) => x.typeSlug !== 'end-inning' && x.id.slice(0, -6) !== id.slice(0, -6));
      if (!final && (now - w.since < CHALLENGE_SETTLE_MS || (!past && now - w.since < 3 * CHALLENGE_SETTLE_MS))) continue; // the next at-bat can be minutes away (a break between innings): 3 times as long is enough alone
      this.challengeWatch.delete(id);
      out.push(...PLAYER_DETECTORS.mlb({ ...this.ctx, lastPitchAbs: w.abs }, p).filter((e) => e.type === 'mlb.challenge_lost'));
    }
    return out;
  }

  /** Basketball: whether to keep waiting for ESPN to type a missed shot (awaitingShotType), SHOT_WAIT_MS at most, so the alert names the shot (or the block). */
  private waitForShotType(p: NPlay, now: number): boolean {
    const since = this.noShotType.get(p.id) ?? (this.noShotType.set(p.id, now), now);
    return now - since < SHOT_WAIT_MS;
  }

  /** Basketball: whether a play first seen long after it happened (GHOST_AGE_MS) is still held, GHOST_HOLD_MS at most: a ghost ESPN deletes in that time is never judged. */
  private holdGhost(p: NPlay, now: number): boolean {
    const since = this.ghosts.get(p.id) ?? (this.ghosts.set(p.id, now), now);
    return now - since < GHOST_HOLD_MS;
  }

  /** Basketball: whether to keep waiting for ESPN to name who scored (awaitingScorer), SCORER_WAIT_MS at most: the play, and the score alert past it, wait. */
  private waitForScorer(p: NPlay, now: number): boolean {
    const since = this.noScorer.get(p.id) ?? (this.noScorer.set(p.id, now), now);
    return now - since < SCORER_WAIT_MS;
  }

  /** Hockey: whether to keep waiting for ESPN to finish a play (awaitingHockey), HOCKEY_WAIT_MS at most for its kind. */
  private waitForHockey(p: NPlay, kind: keyof typeof HOCKEY_WAIT_MS, now: number): boolean {
    const since = this.noHockeyPlay.get(p.id) ?? (this.noHockeyPlay.set(p.id, now), now);
    return now - since < HOCKEY_WAIT_MS[kind];
  }

  /** MLB: whether to keep waiting for the batter on an at-bat's result (awaitingBatter), HALF_END_WAIT_MS at most. */
  private waitForBatter(p: NPlay, now: number): boolean {
    const since = this.noBatter.get(p.id);
    if (since === undefined) { this.noBatter.set(p.id, now); log(`[mlb ${this.ctx.gameId}] result ${p.id} posted without its batter: waiting ("${p.text}")`); return true; }
    if (now - since < HALF_END_WAIT_MS) return true;
    log(`[mlb ${this.ctx.gameId}] result ${p.id} still has no batter after ${HALF_END_WAIT_MS / 1000}s: judged as it is`);
    return false;
  }

  /**
   * MLB: a strikeout ESPN never posts a result for. ALCS Game 1, October 12 2026: Bailey's at-bat ended on "Strike
   * Looking - Overturned: Strike 3 Looking" and the third out, and neither ESPN feed ever had "Bailey struck out looking."
   * (the box score has the strikeout). A strike-three pitch that is the last play of its at-bat, with no result after
   * HALF_END_WAIT_MS, is given the result it would have had: the pitch's place plus 990057, the same id, so a result that
   * comes later is the same play and cannot alert twice. It is part of the plays from then on (the game's state, the half
   * inning's end, a final waiting for the last out all read it).
   */
  private withStrikeThrees(plays: NPlay[], now: number): NPlay[] {
    const have = new Set(plays.map((p) => p.id));
    const add = new Map<number, NPlay>();
    plays.forEach((p, i) => {
      if (!isPitch(p) || !/^Pitch \d+\s*:\s*Strike 3 (?:Looking|Swinging)\b/i.test(p.text) || !/^\d{12,}$/.test(p.id)) return;
      const resultId = `${p.id.slice(0, -6)}990057`, batter = p.participants.find((x) => x.role === 'batter')?.id;
      const over = plays.slice(i + 1).some((x) => x.id.slice(0, -6) !== p.id.slice(0, -6)); // something else has started
      if (have.has(resultId) || !batter || !over) { if (have.has(resultId)) this.strikeThrees.delete(p.id); return; }
      const rec = this.strikeThrees.get(p.id) ?? { since: now };
      this.strikeThrees.set(p.id, rec);
      if (!rec.made) {
        if (now - rec.since < HALF_END_WAIT_MS) return;
        const last = (catalog.playerByEspn('mlb', batter)?.name ?? 'The batter').split(' ').slice(1).join(' ') || 'The batter';
        rec.made = { ...p, id: resultId, type: 'Play Result', typeSlug: 'play-result', text: `${last} struck out ${/looking/i.test(p.text) ? 'looking' : 'swinging'}.`, scoring: false, scoreValue: 0 };
        log(`[mlb ${this.ctx.gameId}] ${p.id} was the third strike of an at-bat ESPN gave no result for after ${HALF_END_WAIT_MS / 1000}s: "${rec.made.text}" made from the pitch`);
      }
      add.set(i, rec.made);
    });
    return add.size ? plays.flatMap((p, i) => (add.has(i) ? [p, add.get(i)!] : [p])) : plays;
  }

  /**
   * MLB: a half-inning ESPN reopens. An "End Inning" play that two reads in a row lack, while the plays say the half isn't
   * over (a replay review overturned the third out: ALCS Game 1, October 12 2026, Ramírez's play in the top of the 9th), is
   * forgotten: the id coming back is a new end, so the real end is judged when it comes (the tracker had seen the id, and
   * judged the half once, on the out that was taken back). The alerts that first judgment sent get a line, no push.
   */
  private reopenedHalves(plays: NPlay[], changed: Detected[]) {
    for (const [id, w] of this.endInnings) {
      if (plays.some((p) => p.id === id)) { w.missing = 0; continue; }
      if (++w.missing < 2) continue;
      if (halfFromPlays(this.ctx, plays, w.key).done) continue; // the half is over without that play: not a reopening
      // What was judged must still be there, with fewer than 3 outs (the review took the out back). A read that lacks it too
      // is a stale copy that dropped the latest plays, and waits.
      const last = this.halfJudged.get(w.key), judged = last ? plays.find((p) => p.id === last) : undefined;
      if (last && (!judged || (judged.outs ?? 0) >= 3)) continue;
      this.endInnings.delete(id);
      this.seen.delete(id);
      this.halfEnds.delete(w.key);
      this.halfJudged.delete(w.key);
      const review = plays.some((p) => `${p.period?.type}${p.period?.number}` === w.key && /\bchallenged\b|\breview\b/i.test(p.text));
      if (last) changed.push(...this.linesOnPlay(last, review ? 'A replay review overturned the third out; the inning went on.' : 'ESPN took back the third out; the inning went on.', (e) => HALF_END_TYPES.has(e.type)));
      log(`[mlb ${this.ctx.gameId}] ${w.key}: the End Inning play ${id} is gone and the plays say the half isn't over: its end will be judged again${last ? '; a line on what was sent' : ''}`);
    }
  }

  /**
   * MLB: each half-inning whose "End Inning" play has come, judged from its plays as this read has them, once a read has
   * its third out (mlbHalfInningEnd): usually the read the "End Inning" play came in, so its alerts bundle with that
   * out's. A read without the "End Inning" play is a stale copy, and waits. After HALF_END_WAIT_MS it's judged as it
   * stands. The log says when the plays as first seen would have made something else of it.
   */
  private halfInningEnds(plays: NPlay[], now: number): Detected[] {
    const out: Detected[] = [];
    for (const [key, w] of this.halfEnds) {
      const late = now - w.since >= HALF_END_WAIT_MS;
      if (!late && !plays.some((p) => p.id === w.playId)) continue;
      const es = mlbHalfInningEnd(this.ctx, plays, key, late);
      if (!es) continue;
      this.halfEnds.delete(key);
      const { last, half } = halfFromPlays(this.ctx, plays, key);
      if (last) this.halfJudged.set(key, last.id);
      const stands = `${last?.id} pas=${half?.pas.length ?? 0} reached=${!!half?.reached}`;
      if (stands !== w.seen || late) log(`[mlb ${this.ctx.gameId}] ${key} over: ${es.map((e) => e.type).join(', ') || 'nothing'} (as the plays stand: ${stands}; as first seen: ${w.seen}${late ? `; no third out after ${HALF_END_WAIT_MS / 1000}s` : ''})`);
      out.push(...es);
    }
    return out;
  }

  /**
   * Football: a play's score alerts, less what's been said. A re-posted play's points went out with the play it
   * re-posts (revisions.ts), and an edit's with the play; an extra point or two-point try (a point or two over what
   * was said, not a safety) with its touchdown, whichever play ESPN puts it on: nothing again. A side whose score
   * was taken back scoring on that drive within RESCORE_MS (a touchdown overturned at the 1, scored on the next
   * snap) is that score: a line on its alerts ("Then Wake Forest scored on the same drive: WAKE 16, NCSU 14."), no
   * new alert. A score that levels the game says so, on the scored-on side's alerts: "Rams tied the game, 34-34." (tiedLine),
   * a line with no push, whether the touchdown itself levelled it or its extra point did, 24 seconds later (Bills at Rams,
   * October 12 2026: 34-33 on the touchdown, 34-34 once the kick was good, 5 seconds left in the 4th). `said`: the score
   * announced before this play. The rest are this play's.
   */
  private footballScore(es: Detected[], p: NPlay, said: { home: number; away: number }, now: number, changed: Detected[]): Detected[] {
    const before = new Set(this.ledger.get(p.id)?.scores.map((e) => this.ledger.scorer(e)));
    const quiet = new Set<'home' | 'away'>(), rescored = new Set<'home' | 'away'>();
    for (const s of ['home', 'away'] as const) {
      if (p[s] <= said[s]) continue;
      if (before.has(s) || (p[s] - said[s] <= 2 && !isSafety(p))) { quiet.add(s); continue; }
      const back = this.takenBack[s];
      if (!back || now > back.until || (back.drive && p.driveId ? back.drive !== p.driveId : back.period !== p.periodNum)) continue;
      delete this.takenBack[s];
      quiet.add(s);
      rescored.add(s);
      const line = againLine(this.ctx, s, p);
      changed.push(...this.ledger.linesOn(back.alerts, line));
      this.ledger.addScores(p.id, back.alerts); // taken back again, they get another line
      log(`[${this.ctx.league} ${this.ctx.gameId}] the ${s} side scored on the drive its score was taken back on (play ${p.id}): ${line}`);
    }
    const out = es.filter((e) => !quiet.has(this.ledger.scorer(e)));
    // The side that was behind scored and it's level now: the scored-on side's alerts say so. A touchdown's alerts are on
    // this play (its extra point is an edit to it) or, when ESPN puts the kick on a play of its own, the side's latest.
    const level = p.home === p.away && said.home !== said.away, tier = said.home < said.away ? 'home' as const : 'away' as const;
    let tie: Detected[] = [];
    if (level && p[tier] > said[tier] && !rescored.has(tier)) {
      const line = tiedLine(this.ctx, tier === 'home' ? this.ctx.homeId : this.ctx.awayId, p), is = (e: Detected) => this.ledger.scorer(e) === tier;
      if (quiet.has(tier)) { // the kick: a line on the touchdown's alerts, already sent (published on its own, before the poll's new alerts)
        const sent = this.ledger.get(p.id)?.scores.filter(is);
        changed.push(...this.ledger.linesOn(sent?.length ? sent : this.lastScored[tier] ?? [], line));
      } else if (!kickPending(p)) {
        // The score itself, with its alerts in their publish (a line waits for its alert): a field goal, or a touchdown whose kick is
        // already in its text. A touchdown still waiting for its kick isn't said to tie yet (kickPending): the line comes with the
        // kick if it does level the game.
        tie = this.ledger.linesOn(out.filter(is), line);
      }
    }
    for (const s of ['home', 'away'] as const) { const mine = out.filter((e) => this.ledger.scorer(e) === s); if (mine.length) this.lastScored[s] = mine; }
    this.ledger.addScores(p.id, out);
    return [...out, ...tie];
  }

  /**
   * Football: a side's score is taken back (a touchdown overturned, a scoring play gone) only once ESPN's plays and
   * header agree, two reads running: the plays' score, the score its latest plays carry (ESPN can take a touchdown out
   * to re-post it while the plays after it keep its points), and the header's. The plays that had those points get a
   * line on their alerts (revisions.ts takeBack); the next score is news again, but for one on the same drive (footballScore).
   */
  private footballTakeBack(score: { home: number; away: number }, plays: NPlay[], header: Header | undefined, now: number): Detected[] {
    const out: Detected[] = [], tail = plays.slice(-3);
    for (const s of ['home', 'away'] as const) {
      const keep = Math.max(score[s], ...tail.map((p) => p[s]), header?.[s] ?? 0);
      if (keep >= this.announced[s]) { this.downReads[s] = 0; out.push(...this.ledger.carry(s, this.announced[s])); continue; }
      if (++this.downReads[s] < 2 || this.ledger.pending(s, keep)) continue; // a play that had them is missing: gone, or re-posted?
      this.downReads[s] = 0;
      log(`[${this.ctx.league} ${this.ctx.gameId}] the ${s} side's score was taken back: ${this.announced[s]} to ${keep}`);
      this.noHeader[s] = Math.max(this.noHeader[s], this.announced[s]);
      this.announced[s] = keep;
      const back = this.ledger.takeBack(s, keep);
      out.push(...back.lines);
      if (back.alerts.length) this.takenBack[s] = { drive: back.drive, period: back.period, until: now + RESCORE_MS, alerts: back.alerts };
    }
    return out;
  }

  /**
   * Football: the summary's header ahead of the plays by the same score for HEADER_AHEAD_MS while the plays trail the
   * game clock it had then (ESPN's drives can be minutes behind: Missouri's last touchdown against Texas A&M, October
   * 10 2026, never reached them), and that score's alert goes out without its play, once; the play, when it comes,
   * is said. Not when plays from that time on come without it (a punt return touchdown called back: Ball State at
   * Northwestern), nor at or under a score taken back (the header can be slow to drop it), nor by a point or two
   * (an extra point ESPN adds to its touchdown's play later; a safety's play comes). `led`: each side's biggest lead so far.
   */
  private headerAhead(score: { home: number; away: number }, plays: NPlay[], header: Header | undefined, led: { home: number; away: number }, now: number): Detected[] {
    if (!header) { this.ahead = {}; return []; }
    const out: Detected[] = [];
    for (const s of ['home', 'away'] as const) {
      const v = header[s], was = this.ahead[s];
      if (v - Math.max(this.announced[s], score[s]) < 3 || v <= this.noHeader[s]) { delete this.ahead[s]; continue; }
      if (was?.value !== v) { this.ahead[s] = { value: v, since: now, period: header.period, clock: header.clock }; continue; }
      const past = plays.find((p) => p[s] < v && p.clockSec != null && (p.periodNum ?? 0) > 0 && !/^End\b/i.test(p.type)
        && ((p.periodNum ?? 0) > was.period || (p.periodNum === was.period && was.clock != null && p.clockSec <= was.clock)));
      if (past) {
        this.noHeader[s] = Math.max(this.noHeader[s], v);
        delete this.ahead[s];
        log(`[${this.ctx.league} ${this.ctx.gameId}] the header's ${s} score (${v}) isn't on play ${past.id}, from after it: not a score`);
        continue;
      }
      if (now - was.since < HEADER_AHEAD_MS) continue;
      delete this.ahead[s];
      const from = { ...this.announced }, to = { ...this.announced, [s]: v };
      const p: NPlay = { id: `header-${s}-${v}`, type: 'Score', typeSlug: '', text: "ESPN's play-by-play doesn't have this play yet", participants: [],
        scoring: true, scoreValue: v - from[s], home: to.home, away: to.away, at: now, shooting: false };
      const es = teamScoreEvents(this.ctx, from, p, { ...led });
      this.announced[s] = v;
      this.ledger.add(p, [], { history: false, header: true }, now);
      this.ledger.addScores(p.id, es);
      log(`[${this.ctx.league} ${this.ctx.gameId}] the header's ${s} score (${v}) has been ahead of the plays (${score[s]}) for ${HEADER_AHEAD_MS / 1000}s: its alert, without the play`);
      out.push(...es);
    }
    return out;
  }

  async poll() {
    const { league, gameId, homeId, awayId } = this.ctx;
    const soccer = SOCCER.has(league), teamsOnly = TEAMS_ONLY.has(league);
    // Each read's failure, and a read over SLOW_READ_MS, is logged with its feed: one feed failing is otherwise silent
    // (ALDS Game 5: an alert 26 seconds late with nothing in the log, and 8 polls with both feeds over 4 s).
    const read = async (feed: string, url: string) => {
      const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
      try {
        const r = await liveDeps.getJson(url, { bust: true, timeoutMs: 4000 });
        if (ms() > SLOW_READ_MS) log(`[${league} ${gameId}] ${feed} read took ${ms()} ms`);
        return r;
      } catch (e) { log(`[${league} ${gameId}] ${feed} read failed after ${ms()} ms: ${String(e)}`); throw e; }
    };
    // Soccer's plays are its summary's key events; a teams-only league's (college football) its drives': one read.
    // Soccer also reads its touch feed (refreshTouches: the newest page each poll, never a reason for the poll to fail).
    const [core, summary] = await Promise.allSettled([
      soccer || teamsOnly ? Promise.resolve({ items: [] }) : read('plays', urls.corePlays(league, gameId)),
      read('summary', urls.summary(league, gameId)),
      soccer ? this.refreshTouches() : Promise.resolve(),
    ]);
    if (summary.status === 'rejected' && (soccer || teamsOnly || core.status === 'rejected')) throw summary.reason;

    const corePlays: NPlay[] = core.status === 'fulfilled' ? (core.value.items ?? []).map(fromCorePlay) : [];
    // NFL summary has no flat plays list (drives only, without participants); core covers it.
    const sitePlays: NPlay[] = summary.status !== 'fulfilled' || league === 'nfl' ? []
      : teamsOnly ? fromDrivePlays(summary.value)
      : soccer ? fromKeyEvents(summary.value, homeId, awayId) : (summary.value.plays ?? []).map(fromSitePlay);
    // Soccer: the touch feed has a goal, card or substitution before the summary's key events do (the same play id): the summary's
    // version is the play once it is there, the touch feed's until then.
    const touchPlays = soccer ? this.touchKeyPlays() : [];
    const merged = mergePlays(corePlays, soccer ? mergePlays(sitePlays, touchPlays) : sitePlays, league === 'nhl');
    const plays = league === 'mlb' ? this.withStrikeThrees(merged, Date.now()) : merged;
    if (plays.length) this.plays = plays;
    if (soccer) this.reviseKeyText([...sitePlays, ...touchPlays], Date.now());
    if (league === 'nhl') this.reviseKeyText(plays, Date.now());

    const events: Detected[] = [];
    const now = Date.now();
    // Football: ESPN's changes to the plays since the last read (revisions.ts), when this read has them all (the
    // summary's drives for college, the core feed for the NFL). `changed`: lines on alerts already sent, no push.
    const football = FOOTBALL.has(league) && plays.length > 0 && (teamsOnly ? summary.status === 'fulfilled' : core.status === 'fulfilled');
    const changed: Detected[] = [];
    // Basketball: the same ledger, from a read that has the core feed (revisions.ts): ESPN posts its plays half-finished
    // and edits them (35 to 49% of October 11 2026's preseason plays), so a changed play is judged again.
    // Hockey too (EDM at LA, 2026-10-13): every goal was posted as a missed or saved shot first, a penalty as "Penalty Shot Infraction", a goal
    // as even strength before its empty net, and 6 plays were taken out; and a goalie's shots and goals follow the plays' latest versions.
    const ledgered = football || ((BASKETBALL.has(league) || league === 'nhl') && plays.length > 0 && core.status === 'fulfilled');
    if (ledgered) this.ledger.read(new Set(plays.map((p) => p.id)), now);
    let header: Header | undefined; // football: the summary header's score while the game is on
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
      if (BASKETBALL.has(league)) this.addMissingPlayers(s);
      const comp = s.header?.competitions?.[0];
      const detail = String(comp?.status?.type?.detail ?? '');
      if (league === 'nhl' && /\/(OT|SO)\b/.test(detail)) this.overtime = /SO/.test(detail) ? 'so' : 'ot';
      // "Hate Watch Starting" goes out once, on the pre → in flip. A game first seen already under
      // way (a follow in the 3rd quarter, a server restart) never gets a late "starting" alert.
      const state = comp?.status?.type?.state;
      if (state === 'pre') this.sawPre = true;
      else if (state === 'in' && this.sawPre && !this.started) {
        this.started = true;
        // A postseason game says its round and game ("NLCS Game 1 · First pitch at …"), from the summary's note, else the scoreboard's.
        const round = this.postseason ? roundLabel(s.header?.gameNote ?? comp?.notes?.[0]?.headline ?? this.info.note) : undefined;
        events.push(...gameStartEvents(this.ctx, { ...this.info, round }, Date.now()));
      }
      const c = (side: string) => competitorScore(league, comp.competitors.find((x: any) => x.homeAway === side));
      if (comp?.status?.type?.completed) final = { home: c('home'), away: c('away') };
      else if (state === 'in' && FOOTBALL.has(league) && comp?.competitors) {
        header = { home: c('home'), away: c('away'), period: Number(comp.status?.period ?? 0), clock: clockSeconds({ displayValue: comp.status?.displayClock }) };
      }
    }
    // The play-by-play's end of the game, ahead of the summary's final. Football's only after a 4th-quarter play: ESPN
    // once put "End of Game" ("End of 4th quarter.") after the 3rd quarter's last play, then took it out (Texas A&M
    // at Missouri, October 10 2026), which would have ended the game there.
    // Hockey: a shootout's End Game play carries the shootout's tally (DAL 2, COL 1), not the game's score, so the scoreboard's final (the winner's extra goal) finishes it (DAL at COL, 2026-10-14).
    const end = plays.findIndex((p) => /^End (of )?Game$/i.test(p.type));
    if (!final && end >= 0 && !(league === 'nhl' && plays.some((p) => /start of shootout/i.test(p.text))) && (!FOOTBALL.has(league) || plays.slice(0, end).some((p) => (p.periodNum ?? 0) >= 4 && !/^End\b/i.test(p.type)))) {
      final = { home: Math.max(...plays.map((p) => p.home)), away: Math.max(...plays.map((p) => p.away)) };
    }

    const cutoff = Date.now() - (this.info.atBoot ? BOOT_BACKFILL_MS : BACKFILL_WINDOW_MS);
    // The score is re-derived from every play on every poll, not kept as a running total, because
    // ESPN edits plays after publishing them: a goal can be marked as scoring only later, and a
    // disallowed goal is taken back. A running total would miss the first and, after the second,
    // the team's next goal. `announced` is the score each side's alerts have gone out for.
    let score = { home: 0, away: 0 };
    const led = { home: 0, away: 0 }; // each side's biggest lead before this play ("blew a big lead")
    let held = false; // MLB: a result ahead of this play is settling
    let goalHeld = false; // hockey, basketball: a goal or basket ahead of this play (or this one) has no scorer yet: no score is announced past it
    for (const p of plays) {
      bump(led, score);
      const prev = score;
      score = nextScore(prev, p);
      // History from before we attached updates state but is never notified. Hockey: so is a shot ESPN back-fills long after it happened.
      const stale = league === 'nhl' && !this.first && !final && !this.seen.has(p.id) && p.at > 0 && now - p.at > HOCKEY_STALE_SHOT_MS && awaitingHockey(this.ctx, p) === 'shot';
      if (stale) log(`[nhl ${gameId}] shot ${p.id} first seen ${Math.round((now - p.at) / 1000)}s after it happened: not alerted`);
      const history = (this.first && p.at < cutoff) || stale;
      // Hockey: a shot, a penalty still typed as the placeholder and a goal with no scorer in its text wait for ESPN to finish them (HOCKEY_WAIT_MS).
      const wait = league === 'nhl' && !history && !final && !this.seen.has(p.id) ? awaitingHockey(this.ctx, p) : undefined;
      // A shot that copies one already alerted waits longer: ESPN deletes most copies within minutes (MTL at WSH: 2 of 4 repeats, 44 s and 4 minutes on).
      const hockeyWait = !!wait && this.waitForHockey(p, wait === 'shot' && this.ledger.shotCopy(p) ? 'copy' : wait, now);
      if (hockeyWait && wait === 'goal') goalHeld = true;
      // MLB: an at-bat's result ESPN posts before its batter is on it isn't judged until he is (HALF_END_WAIT_MS at most).
      // Basketball: a basket posted with no scorer is judged, and its score announced, once ESPN names him (or SCORER_WAIT_MS passes).
      const scorerWait = BASKETBALL.has(league) && !history && !final && !this.seen.has(p.id) && awaitingScorer(p) && this.waitForScorer(p, now);
      if (scorerWait) goalHeld = true;
      const ghost = BASKETBALL.has(league) && !history && !final && !this.seen.has(p.id) && !p.scoring && p.at > 0 && now - p.at > GHOST_AGE_MS && this.holdGhost(p, now);
      const waiting = hockeyWait || scorerWait || ghost || (league === 'mlb' && !history && !this.seen.has(p.id) && awaitingBatter(p) && this.waitForBatter(p, now))
        || (BASKETBALL.has(league) && !history && !final && !this.seen.has(p.id) && awaitingShotType(p) && this.waitForShotType(p, now));
      // MLB: a result still under review (a challenged strikeout, a ruling pending) is judged once it settles, and the plays
      // after it wait their turn, so the game's state (bases, who is on) is built in order.
      const settle = league === 'mlb' && !history && !waiting && !held && !this.seen.has(p.id) && this.settling(p, now, !!final);
      if (settle) held = true;
      const fresh = !waiting && !settle && !(held && !this.seen.has(p.id)) && !this.seen.has(p.id);
      if (fresh) {
        this.seen.add(p.id);
        // A play ESPN took out and re-posted under a new id is that play again, revised (already counted).
        const was = ledgered && !history ? this.ledger.repost(p, now) : undefined;
        // Basketball: a copy of a turnover or foul still in the feed (twin) is counted, not alerted: the entry takes it over if ESPN deletes its own.
        const twin = !was && ledgered && !history && this.ledger.twin(p);
        // College football: a standalone flag row that copies a flag a play just sent is a line on that card, not a second card.
        const copy = !was && !twin && ledgered && !history ? this.ledger.flagCopy(p, now) : undefined;
        if (twin || copy) {
          if (copy) changed.push(...copy);
          observePlay(this.ctx, p);
        } else if (was) {
          const r = this.ledger.revise(was, p, now);
          events.push(...r.fresh);
          changed.push(...r.lines);
          this.retext(r.retext);
        } else {
          const es = history ? [] : PLAYER_DETECTORS[league](this.ctx, p);
          // Basketball: a play ESPN posts minutes after it happened is news for the feed, not the phone (a turnover 4 and another 15 minutes late, NY at TOR, October 13 2026).
          if (BASKETBALL.has(league)) for (const e of es) if (now - p.at > LATE_POST_MS) e.noPush = true;
          events.push(...es);
          // MLB: a half-inning's end is judged from its plays, on a read with its third out (halfInningEnds).
          const ended = league === 'mlb' && !history ? endedHalf(p) : undefined;
          if (ended) {
            this.endInnings.set(p.id, { key: ended, missing: 0 });
            const h = this.ctx.half, r = this.ctx.lastResult; // what the plays as first seen made of it, for the log
            this.halfEnds.set(ended, { playId: p.id, since: now, seen: `${r?.id} pas=${h?.key === ended ? h.pas.length : 0} reached=${h?.key === ended && h.reached}` });
          }
          const net = league === 'nhl' ? [this.ctx.goalies.get(this.ctx.homeId), this.ctx.goalies.get(this.ctx.awayId)] : [];
          observePlay(this.ctx, p);
          if (league === 'nhl' && (net[0] !== this.ctx.goalies.get(this.ctx.homeId) || net[1] !== this.ctx.goalies.get(this.ctx.awayId))) {
            log(`[nhl ${gameId}] goalie in net changed on play ${p.id} (${p.periodNum}P ${p.clockSec}s in): home ${net[0]} → ${this.ctx.goalies.get(this.ctx.homeId)}, away ${net[1]} → ${this.ctx.goalies.get(this.ctx.awayId)}`);
          }
          if (ledgered) this.ledger.add(p, es, { history }, now);
        }
      } else if (ledgered) {
        const r = this.ledger.changed(p, now);
        if (r) { events.push(...r.fresh); changed.push(...r.lines); this.retext(r.retext); }
      }
      // A crew chief review can be added to an at-bat's result after it was posted ("Volpe homered…"
      // rewritten as "Volpe doubled, Lombard Jr. scored. Umpire review: HR call on the field was
      // overturned…"). Detectors see a play once, so a rewritten result is checked for a review alone,
      // and only when the review is what's new (a result that had one when we attached is history).
      if (league === 'mlb' && p.typeSlug === 'play-result' && this.seen.has(p.id)) {
        const was = this.resultTexts.get(p.id);
        this.resultTexts.set(p.id, p.text);
        if (!fresh && !history && was !== undefined && was !== p.text && !/\bumpire review:/i.test(was)) events.push(...umpireReviewLost(this.ctx, p));
        // Any other change to a result after it was posted is logged, not judged again: alerts keyed on a play's text
        // (caught stealing, out on the bases, a gift run) would go out a second time, and a strikeout's count move. What
        // the change means for the alerts already sent is revisedResult's.
        const sig = `${p.text} [${p.participants.map((x) => x.role).sort().join(' ')}]`, before = this.resultSigs.get(p.id);
        this.resultSigs.set(p.id, sig);
        const prev = this.resultPlays.get(p.id);
        this.resultPlays.set(p.id, p);
        if (before !== undefined && before !== sig && !history) log(`[mlb ${gameId}] result ${p.id} changed after it was posted: "${before}" → "${sig}"`);
        if (prev && !fresh && !history && (before !== sig || prev.scoring !== p.scoring)) this.revisedResult(prev, p, plays, now, events, changed);
      }
      const up = (s: 'home' | 'away') => score[s] > this.announced[s];
      if (!goalHeld && (up('home') || up('away'))) {
        // A side already announced at this score (its goal was counted from a later play first)
        // doesn't move on this play, so it gets no second alert.
        const from = { home: up('home') ? prev.home : score.home, away: up('away') ? prev.away : score.away };
        const said = this.announced;
        this.announced = { home: Math.max(this.announced.home, score.home), away: Math.max(this.announced.away, score.away) };
        if (history) continue;
        const es = teamScoreEvents(this.ctx, from, p, { ...led });
        events.push(...(football ? this.footballScore(es, p, said, now, changed) : es));
        if (BASKETBALL.has(league)) this.ledger.addScores(p.id, es); // so a basket ESPN takes back gets a line on its alerts (takeBack)
        if (!fresh && !waiting) {
          // Football: an extra point or two-point try ESPN adds to a touchdown's play is no late score (WKU at SHSU, play 70).
          const kick = football && !isSafety(p) && score.home - said.home + score.away - said.away <= 2;
          if (!kick) log(`[${league} ${gameId}] late score: play ${p.id} became a scoring play after it was first published (${p.away}-${p.home})`);
          if (league === 'nhl') events.push(...PLAYER_DETECTORS.nhl(this.ctx, p).filter((e) => e.type === 'nhl.goalie.goal_allowed'));
        }
      }
    }
    if (football) {
      bump(led, score);
      changed.push(...this.ledger.sweep(now), ...this.footballTakeBack(score, plays, header, now));
      events.push(...this.headerAhead(score, plays, header, led, now));
    } else if (ledgered) {
      changed.push(...this.ledger.sweep(now, !!final)); // plays ESPN took out
      if (league === 'nhl') for (const g of this.ledger.goneGoals()) {
        const off = goalOffBoard(this.ctx, g, score, now);
        if (off) { events.push(off); log(`[nhl ${gameId}] goal ${g.id} (${g.text}) is off the board`); }
      }
    }
    if (!FOOTBALL.has(league) && (score.home < this.announced.home || score.away < this.announced.away)) {
      if (BASKETBALL.has(league) && ledgered) for (const s of ['home', 'away'] as const) if (score[s] < this.announced[s]) changed.push(...this.ledger.takeBack(s, score[s]).lines);
      log(`[${league} ${gameId}] score went down to ${score.away}-${score.home} (a goal taken back?); the next one is news again`);
      this.announced = { home: Math.min(this.announced.home, score.home), away: Math.min(this.announced.away, score.away) };
    }
    this.score = score;
    if (league === 'mlb') this.reopenedHalves(plays, changed);
    if (league === 'mlb') events.push(...this.halfInningEnds(plays, now));
    if (soccer) {
      // Fouls, handballs and penalties conceded: from the touch feed as soon as it has the foul, and from the commentary (whose
      // line has no play until ESPN attaches it). A foul's penalty can be written a moment later.
      const fouls = [...this.touchFouls(), ...(summary.status === 'fulfilled' ? fromCommentary(summary.value, score) : [])];
      for (const p of fouls) {
        const was = this.fouls.get(p.id);
        if (was === p.typeSlug || was === 'penalty-conceded') continue;
        this.fouls.set(p.id, p.typeSlug);
        if (!(this.first && p.at < cutoff)) events.push(...(p.typeSlug === 'woodwork' || p.typeSlug === 'var-no-goal' ? soccerCommentaryEvents(this.ctx, p) : soccerFoul(this.ctx, p)));
      }
      // Passes and dribbles, from the touch-by-touch feed, if anyone tracks a player in the match.
      if (this.touchesFrom && this.tracksPlayers()) {
        const judged = this.judgeTouches(now);
        events.push(...judged.fresh);
        // A pair judged again because a touch changed: a new alert is sent; one already sent takes the new words.
        for (const e of judged.again) {
          const row = db.prepare('SELECT type, title, body, meta FROM events WHERE id = ?').get(e.id) as { type: string; title: string; body: string; meta: string | null } | undefined;
          if (!row) events.push(e);
          else if (row.title !== e.title || row.body !== e.body) reviseEvent(e.id, { type: row.type, aliases: row.meta ? JSON.parse(row.meta).aliases : undefined, title: e.title, body: e.body, meta: {} });
        }
      }
    }
    // MLB pitchers' lines: a blown save, no quality start. The loss waits for the final (finalPitching).
    if (league === 'mlb' && summary.status === 'fulfilled') {
      const pitchers = boxPitchers(summary.value);
      const es = [...pitcherEvents(this.ctx, pitchers, { final: false, score: this.score, at: Date.now() }, this.pitching), ...this.positionPlayerPitching(pitchers)];
      if (!this.first) events.push(...es); // attaching mid-game: what already happened is history
    }
    // Football: each finished drive's alerts (three-and-out, on downs, an empty red-zone trip); the first read is a
    // baseline. ESPN can change a drive's result after it ends (a fumble overturned into a turnover on downs): revised.
    if (FOOTBALL.has(league) && summary.status === 'fulfilled') {
      const r = this.ledger.drivesRead(summary.value.drives?.previous ?? [], this.first, now);
      events.push(...r.fresh);
      changed.push(...r.lines);
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
    if (league === 'mlb') events.push(...this.challengeSettled(plays, now, !!final));
    if (league === 'mlb') events.splice(0, events.length, ...this.holdAbs(events, plays, !!final));
    if (changed.length) publish(changed, league); // on their own: a line waits for no other alert of its moment
    // After the final ESPN's data can still flip back (a drive FUMBLE, DOWNS, FUMBLE in 36 s: Browns at Jets): what the reads then find goes to the feed, never a push.
    if (this.finished) for (const e of events) e.noPush = true;
    // A team's NFL flags last (afterOthers): on a moment shared with a score alert the first alert a device wants is its alert,
    // and a flag, which never pushes, must not take it from a pushed one (the stable sort keeps every other alert's order).
    if (events.some((e) => e.afterOthers)) events.sort((a, b) => Number(!!a.afterOthers) - Number(!!b.afterOthers));
    if (events.length) {
      const out = soccer ? this.linkFoulsToCards(bundleByPlay(events)) : bundleByPlay(events);
      publish(out, league);
      if (league === 'mlb') this.rememberSent(out);
      this.newAlerts = true;
    }
    if (CLIP_LEAGUES.has(league) && summary.status === 'fulfilled') void this.readClips(summary.value).catch((e) => log(`[${league} ${gameId}] clips`, String(e)));
    // The Scores tab: this play-by-play is ahead of the scoreboard, and the summary has win probability.
    const wp = summary.status === 'fulfilled' ? summary.value.winprobability?.at?.(-1) : undefined;
    patchGame(`${league}:${gameId}`, {
      home: this.score.home, away: this.score.away, winProb: wp?.homeWinPercentage != null ? winProb(wp) : undefined,
      pitchCounts: league === 'mlb' && summary.status === 'fulfilled' ? boxPitchCounts(summary.value) : undefined,
      goalies: league === 'nhl' && summary.status === 'fulfilled' ? boxGoalies(summary.value, this.ctx.goalies) : undefined,
      passers: FOOTBALL.has(league) && summary.status === 'fulfilled' ? boxPassers(summary.value, league) : undefined,
    });
    // Hockey: the header can trail the plays at the final (EDM 3 for five minutes after an empty-netter made it 4-1): a goal is only ever added.
    if (final && league === 'nhl') final = { home: Math.max(final.home, score.home), away: Math.max(final.away, score.away) };
    if (this.heldFinal) this.finishWhenCurrent(this.heldFinal.final); // the scoreboard's final waits for a read that catches up: has this one?
    else if (final && this.postseason) {
      // The scoreboard's read (every 10s) finishes it with the series; this is the fallback.
      this.finalSeenAt ||= Date.now();
      // Without it, the summary's own series says whether it's the end of their season (summaryEvent).
      if (Date.now() - this.finalSeenAt >= PLAYOFF_FINAL_WAIT_MS) { log(`[${league} ${gameId}] playoff final without the scoreboard's series after ${PLAYOFF_FINAL_WAIT_MS / 1000}s: the summary's`); this.finishWhenCurrent(final, summaryEvent(this.box)); }
    } else if (final) this.finishWhenCurrent(final);
  }

  /**
   * Finish the game, but not on plays that are still behind its final (playsBehindFinal): hold it for a read that catches
   * up, HALF_END_WAIT_MS at most, so the last half-inning is judged and the last out's alert goes out before the loss.
   * The held final is tried again at the end of every poll and by the scoreboard's next scans; it is in memory only.
   * Only an MLB tracker that has plays; every other game, and a tracker that never started (the scoreboard's backstop for a
   * final nobody tracked), finishes at once. `ev`: the scoreboard's event, which a held final keeps over the summary's.
   */
  finishWhenCurrent(final: { home: number; away: number }, ev?: any) {
    if (this.finished) return;
    const why = this.ctx.league === 'mlb' ? playsBehindFinal(this.plays, this.score, final) : null;
    if (why) {
      if (!this.heldFinal) { this.heldFinal = { final, ev, since: Date.now() }; log(`[mlb ${this.ctx.gameId}] final held for a read that catches up (${why}), ${HALF_END_WAIT_MS / 1000}s at most`); }
      else this.heldFinal.ev ??= ev;
      if (Date.now() - this.heldFinal.since < HALF_END_WAIT_MS) return;
      log(`[mlb ${this.ctx.gameId}] final released after ${HALF_END_WAIT_MS / 1000}s without catching up (${why}): finished as the plays stand`);
    } else if (this.heldFinal) log(`[mlb ${this.ctx.gameId}] final released after ${Math.round((Date.now() - this.heldFinal.since) / 1000)}s: the plays caught up`);
    this.finish(this.heldFinal?.final ?? final, this.heldFinal?.ev ?? ev);
  }

  /** The scoreboard's final, with the series (a playoff loss can end a season): finished now, or held (finishWhenCurrent) and stopped once it is. */
  finishFromScoreboard(final: { home: number; away: number }, ev: any) {
    // Hockey: the plays can be ahead of the scoreboard (a goal is only ever added; see poll).
    if (this.ctx.league === 'nhl') final = { home: Math.max(final.home, this.score.home), away: Math.max(final.away, this.score.away) };
    this.finishWhenCurrent(final, ev);
    if (this.finished) this.stop();
  }

  /**
   * Soccer: ESPN posts a card, goal or substitution in a short form ("Erling Haaland (Manchester City) Goal at 65'") and
   * rewrites it a minute or less later ("Goal! … left footed shot … Assisted by …", "Second yellow card to …"). The alerts
   * were made from the first words; each takes the rewrite on its feed rows, with no second push, when the new text is
   * longer than the last (it never goes back to a shorter one) and within KEY_REVISE_MS of first seeing the play. The body
   * is the text plus the score, so only the text changes; a sent-off title gains "(second yellow)". The detectors are not
   * run again: they count (a red card's men left) as they go.
   */
  private reviseKeyText(plays: NPlay[], now: number) {
    const { league, gameId } = this.ctx;
    for (const p of plays) {
      if (!p.text) continue;
      // Hockey: a goal's alerts take its text once it names its scorer (goalNamesScorer), and any change counts (ESPN takes an assist away, credits another scorer), for as long as the ledger watches the play. A penalty's take a longer text that starts with the old one ("... Interference" gets "against Boone Jenner").
      const hockey = league === 'nhl';
      const penalty = hockey && !p.scoring && !!p.penaltyMinutes;
      if (hockey && !p.scoring && !penalty) continue;
      const was = this.keyTexts.get(p.id);
      if (!was) { this.keyTexts.set(p.id, { text: p.text, at: now }); continue; }
      const within = penalty || !hockey ? KEY_REVISE_MS : BASKETBALL_REVISE_MS;
      if (penalty && p.text !== was.text && !p.text.startsWith(was.text)) { this.keyTexts.set(p.id, { text: p.text, at: was.at }); continue; } // ESPN named the call: that is the text to extend
      if (p.text === was.text || (penalty ? !p.text.startsWith(was.text) : hockey ? !goalNamesScorer(p.text) : p.text.length <= was.text.length) || now - was.at > within) continue;
      const shown = hockey ? goalWords(league, { scoring: p.scoring, text: was.text }) : was.text; // an unnamed goal went out as GOAL_UNNAMED
      const prefix = `${gameId}:${p.id}:`;
      const rows = db.prepare('SELECT id, type, title, body, meta FROM events WHERE id >= ? AND id < ?').all(prefix, `${prefix}\uffff`) as { id: string; type: string; title: string; body: string; meta: string | null }[];
      for (const r of rows) {
        if (!r.body.startsWith(`${shown} — `)) continue;
        // Hockey: the goal's own alerts only: the shot alert from before it was a goal keeps its words (it has a line), and so does a revision's line.
        if (hockey && (/^nhl\.shot_/.test(r.type) || r.id.includes(':changed:'))) continue;
        const meta = r.meta ? JSON.parse(r.meta) : {};
        const title = r.type === soccerType(league, 'red_card') && / was sent off/.test(r.title) ? sentOffTitle(r.title.replace(/ was sent off.*$/, ''), p.text) : r.title;
        reviseEvent(r.id, { type: r.type, aliases: meta.aliases, title, body: `${p.text}${r.body.slice(shown.length)}`, meta: {} });
        log(`[${league} ${gameId}] ${r.id} takes ESPN's rewrite of play ${p.id}: "${was.text}" → "${p.text}"`);
      }
      this.keyTexts.set(p.id, { text: p.text, at: was.at });
    }
  }

  /** Football: a play's alerts take ESPN's rewrite of the play (revisions.ts `retext`) on their rows and in the feed, with no push. */
  private retext(rows: { id: string; body: string }[] | undefined) {
    for (const { id, body } of rows ?? []) {
      const row = db.prepare('SELECT type, title, body, meta FROM events WHERE id = ?').get(id) as { type: string; title: string; body: string; meta: string | null } | undefined;
      if (!row || row.body === body) continue; // nobody tracked it, or the row already says it
      reviseEvent(id, { type: row.type, aliases: row.meta ? JSON.parse(row.meta).aliases : undefined, title: row.title, body, meta: {} });
      log(`[${this.ctx.league} ${this.ctx.gameId}] ${id} takes ESPN's rewrite of its play: "${row.body}" → "${body}"`);
    }
  }

  /**
   * Soccer: a card and the foul behind it (the same player, the same minute) are one thing happening. A foul that comes
   * with its card in a poll, or after it, takes the card's moment: a device that gets the card doesn't get the foul too,
   * and one that has cards off still gets the foul. A foul that came first stays its own alert (the card, which pushes by
   * default, must never become a line on a feed-only foul), and the card goes before the fouls that joined it.
   */
  private linkFoulsToCards(events: Detected[]): Detected[] {
    const key = (e: Detected) => (e.meta?.athleteId && e.meta?.clock ? `${e.meta.athleteId}@${e.meta.clock}` : '');
    for (const e of events) if (/\.(yellow|red)_card$/.test(e.type) && e.targetKey.startsWith('player:') && e.moment && key(e)) this.cardMoments.set(key(e), e.moment);
    const joins = (e: Detected) => /\.foul$/.test(e.type) && !!key(e) && this.cardMoments.has(key(e));
    // No line of its own on the card's alert either: the card says what happened. (bundleByPlay has already given it its play's moment and line.)
    return [...events.filter((e) => !joins(e)), ...events.filter(joins).map((e) => ({ ...e, moment: this.cardMoments.get(key(e))!, fold: undefined }))];
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
   * Soccer: bring the touch feed up to date, a page of 100 at a time, held by position. The first read starts at the newest page
   * (what came before is history). Each poll after reads back TOUCH_SHALLOW touches; every TOUCH_MS, TOUCH_DEEP: ESPN retypes a
   * touch, and takes one out, for a minute or two after posting it. Read through the last page, the feed is cut to ESPN's count,
   * so a touch it took out leaves no stale one at the end. A failed read is logged and leaves what is held.
   */
  private async refreshTouches() {
    const { league, gameId } = this.ctx;
    const get = (page: number) => liveDeps.getJson(urls.corePlays(league, gameId, { limit: TOUCH_PAGE, page }), { bust: true, timeoutMs: 6000 });
    try {
      const now = Date.now();
      let page: number, res: any;
      if (!this.touchesFrom) {
        page = 1;
        res = await get(page);
        this.touchesFrom = now;
        this.touchesAt = now;
        const last = Math.max(1, Math.ceil(Number(res.count ?? 0) / TOUCH_PAGE));
        if (last > page) {
          page = last;
          this.touchBase = (last - 1) * TOUCH_PAGE;
          this.touches.length = this.touchItems.length = this.touchNext = this.touchBase;
          res = await get(page);
        }
      } else {
        const deep = now - this.touchesAt >= TOUCH_MS;
        if (deep) this.touchesAt = now;
        page = Math.floor(Math.max(this.touchBase, this.touches.length - (deep ? TOUCH_DEEP : TOUCH_SHALLOW)) / TOUCH_PAGE) + 1;
        res = await get(page);
      }
      let count = Number(res.count ?? 0);
      for (let reads = 0; reads < 20; reads++) {
        (res.items ?? []).forEach((it: any, i: number) => { const at = (page - 1) * TOUCH_PAGE + i; this.touchItems[at] = it; this.touches[at] = fromCorePlay(it); });
        count = Number(res.count ?? count);
        if (!(res.items ?? []).length || page >= Number(res.pageCount ?? 1)) break;
        res = await get(++page);
      }
      if (page >= Number(res.pageCount ?? 1) && count >= this.touchBase && count < this.touches.length) {
        log(`[${league} ${gameId}] the touch feed is ${this.touches.length - count} shorter: ESPN took a touch out`);
        this.touches.length = this.touchItems.length = count;
      }
    } catch (e) { log(`[${league} ${gameId}] touches`, String(e)); }
  }

  /** Soccer: the goals, cards and substitutions in the newest touches, as plays (fromTouchKeyPlay). */
  private touchKeyPlays(): NPlay[] {
    const { homeId, awayId } = this.ctx, out: NPlay[] = [];
    for (let i = Math.max(this.touchBase, this.touchItems.length - 2 * TOUCH_DEEP); i < this.touchItems.length; i++) {
      const p = this.touchItems[i] ? fromTouchKeyPlay(this.touchItems[i], homeId, awayId) : undefined;
      if (p) out.push(p);
    }
    return out;
  }

  /** Soccer: the fouls and handballs in the newest touches, as plays (fromTouchFoul). */
  private touchFouls(): NPlay[] {
    const out: NPlay[] = [];
    for (let i = Math.max(this.touchBase, this.touchItems.length - 2 * TOUCH_DEEP); i < this.touchItems.length; i++) {
      const p = this.touchItems[i] ? fromTouchFoul(this.ctx.league, this.touchItems[i]) : undefined;
      if (p) out.push(p);
    }
    return out;
  }

  /**
   * Soccer: passes and dribbles from the touches, each pair judged once the next touch is in (soccerTouch), so the latest touch
   * waits for the next read. A pair is judged again, while its first touch is under TOUCH_REJUDGE_MS old, when either touch has
   * since changed (its type, team or player, or a different touch beside it): `again` holds those alerts, to be sent if new or
   * to take the new words if already out. One that no longer holds can't be unsent, so it is logged.
   */
  private judgeTouches(now: number): { fresh: Detected[]; again: Detected[] } {
    const { league, gameId } = this.ctx;
    const fresh: Detected[] = [], again: Detected[] = [], before = new Set<string>(), cutoff = this.touchesFrom - BACKFILL_WINDOW_MS;
    const sig = (p: NPlay, next: NPlay) => [p, next].map((x) => `${x.id}/${x.typeSlug}/${x.teamId}/${x.participants[0]?.id}`).join('>');
    for (let i = Math.min(this.touchNext, Math.max(this.touchBase, this.touches.length - TOUCH_DEEP)); i < this.touches.length - 1; i++) {
      const p = this.touches[i], next = this.touches[i + 1];
      if (!p || !next || p.at < cutoff) continue;
      const s = sig(p, next), was = this.touchSigs.get(i);
      if (i >= this.touchNext) {
        const es = soccerTouch(this.ctx, p, next);
        fresh.push(...es);
        this.touchSigs.set(i, { sig: s, ids: es.map((e) => e.id) });
      } else if (was && was.sig !== s && now - p.at < TOUCH_REJUDGE_MS) {
        const es = soccerTouch(this.ctx, p, next);
        again.push(...es);
        for (const id of was.ids) before.add(id);
        this.touchSigs.set(i, { sig: s, ids: es.map((e) => e.id) });
      }
    }
    // A touch ESPN took out moves every pair after it one place: an alert only no longer holds if no pair makes it now.
    for (const id of before) if (!again.some((e) => e.id === id) && !fresh.some((e) => e.id === id)) log(`[${league} ${gameId}] alert ${id} no longer holds: the touches beside its play changed after it went out`);
    this.touchNext = Math.max(this.touchNext, this.touches.length - 1);
    return { fresh, again };
  }

  /** Basketball: players the box score lists that the catalog lacks are added once each (addBoxPlayers), so their alerts name them and they can be followed. */
  private addMissingPlayers(s: any) {
    const league = this.ctx.league;
    for (const t of s.boxscore?.players ?? []) {
      const missing = (t.statistics?.[0]?.athletes ?? []).map((x: any) => x?.athlete)
        .filter((a: any) => a?.id && !this.boxChecked.has(String(a.id)) && !catalog.playerByEspn(league, String(a.id)));
      for (const a of missing) this.boxChecked.add(String(a.id));
      if (!missing.length) continue;
      addBoxPlayers(league, String(t.team?.id), missing)
        .then((added) => { if (added.length) log(`[${league} ${this.ctx.gameId}] box score players not in the catalog, added: ${added.map((p) => `${p.name} (${p.espnId})`).join(', ')}`); })
        .catch((e) => log(`[${league} ${this.ctx.gameId}] adding box score players failed: ${e}`));
    }
  }

  private seedGoalies(s: any) {
    for (const t of s.boxscore?.players ?? []) {
      const goalies = t.statistics?.find((x: any) => x.name === 'goalies')?.athletes ?? [];
      const g = goalies[0]?.athlete?.id;
      if (g) this.ctx.goalies.set(String(t.team.id), String(g));
      // Every goalie the box score lists, with his team: a save by one is never read as the other side's goalie coming on.
      for (const a of goalies) if (a?.athlete?.id) (this.ctx.goalieTeam ??= new Map()).set(String(a.athlete.id), String(t.team.id));
    }
  }

  /** `ev`: the scoreboard's event, when it's the scoreboard that saw the final (a playoff loss can end a season: eliminationOf). */
  finish(final: { home: number; away: number }, ev?: any) {
    if (this.finished) return;
    this.finished = true;
    for (const id of [this.ctx.homeId, this.ctx.awayId]) staleUpNext(teamKey(this.ctx.league, id)); // their next game is another one now
    // The final half-inning gets no "End Inning" play: judged here, from every play. Its alerts about the team that lost
    // are lines on the loss (finalHalfOnLoss); any others go out like any half-inning's, on the last out's alert.
    const lastHalf = this.ctx.league === 'mlb' ? mlbFinalHalfInning(this.ctx, this.plays) : [];
    const out = ev ? eliminationOf(this.ctx.league, ev) : null;
    const lost = gameLostEvent(this.ctx, final, Date.now(), out, ev && !out ? seriesStanding(ev) : null);
    const half = lost ? finalHalfOnLoss(this.ctx, lastHalf, lost) : { lines: [], rest: lastHalf };
    if (half.rest.length) publish(bundleByPlay(half.rest), this.ctx.league);
    if (this.ctx.league === 'mlb') void this.finalPitching(final);
    db.prepare('DELETE FROM kv WHERE key = ?').run(this.preKey); // the game is over: its pregame is spent (this.pre has it)
    // Each player's bad night from the box score (not the preseason's): lines on their team's loss, or their own alerts after a win.
    const seasonType = Number(this.box?.header?.season?.type ?? this.pre.seasonType ?? 2);
    const players = this.box && seasonType !== 1 ? playerFinalEvents(this.ctx, boxPlayerFacts(this.ctx.league, this.box), final, Date.now(), lost) : [];
    if (CLIP_LEAGUES.has(this.ctx.league)) void this.clipsAfterFinal();
    if (FOOTBALL.has(this.ctx.league)) void this.correctionsAfterFinal();
    if (!lost) { // a tie: the NFL's says so, feed only
      const tied = [...gameTiedEvents(this.ctx, final, Date.now()), ...players];
      if (tied.length) publish(tied, this.ctx.league);
      return;
    }
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
    if (overtime === 'so') lost.body = shootoutLossBody(this.ctx, final); // every alert of the loss copies it
    const facts = lossFacts(this.ctx, lost, final, { plays: this.plays, pre: this.pre, overtime, postseason, box: seasonType !== 1 ? this.box : undefined });
    // Its lines (the facts, the last half-inning) reach those who track only a player on the team too, on "their team lost".
    // Preseason basketball: a player the box score doesn't list, or lists as "did not play", never played (the starters sat: 8 of 21 in NY at TOR, October 13 2026; 6 Suns, 4 Nuggets and 5 Pelicans were listed DNP, October 14), so no "their team lost" for him. Only the explicit flag drops a listed player: an entry with no stats is kept.
    const dressed = BASKETBALL.has(this.ctx.league) && seasonType === 1
      ? new Set<string>((this.box?.boxscore?.players ?? []).flatMap((t: any) => (t.statistics?.[0]?.athletes ?? []).filter((a: any) => !a?.didNotPlay).map((a: any) => String(a?.athlete?.id)))) : null;
    const tracked = trackedPlayersOn(lost.targetKey).filter((p) => !dressed?.size || dressed.has(p.espnId));
    const loss = [...(heavy ? [heavy] : []), lost, ...facts, ...half.lines, ...playerTeamLostEvents(this.ctx, lost, tracked), ...playerLossLines([...facts, ...half.lines], tracked), ...players];
    // The loss's alerts get the winning play's clip (the play that put the winner ahead for good), else the recap (clips.ts).
    const winning = leadStory(this.plays, lost.meta?.winnerId === this.ctx.homeId ? 'home' : 'away').goAhead?.id;
    // A preseason game's loss is recorded like any other but not rated (loss-rating.ts: a 53-point preseason blowout is no disaster).
    const preseason = seasonType === 1 || ev?.season?.type === 1;
    for (const e of loss) if (e.moment === lost.moment) e.meta = { ...e.meta, lossClip: true, ...(winning ? { clipPlayId: winning } : {}), ...(preseason ? { preseason: true } : {}) };
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
  /** Leagues whose scoreboard has been read since the server started: a game attached before that was live at boot. */
  private scanned = new Set<League>();
  private kickers: Partial<Record<League, () => void>> = {};
  private standingsKick: Partial<Record<League, () => void>> = {};
  private upNextKick?: () => void;

  start() {
    for (const lg of GAME_LEAGUES) {
      // A teams-only league (college football): its scoreboard (every FBS game) less often, its standings every
      // 10 minutes (they move after games), and no injuries or news (player and off-field alerts it doesn't have).
      const teamsOnly = TEAMS_ONLY.has(lg);
      this.kickers[lg] = every(teamsOnly ? TEAMS_ONLY_SCOREBOARD_MS : SCOREBOARD_MS, () => this.scanScoreboard(lg));
      this.standingsKick[lg] = every(teamsOnly ? TEAMS_ONLY_STANDINGS_MS : STANDINGS_MS, () => scanStandings(lg));
      if (!teamsOnly) every(INJURIES_MS, () => scanInjuries(lg));
      every(YESTERDAY_MS, () => scanYesterday(lg));
    }
    this.kickers.f1 = startF1(every); // races, not games: see f1.ts
    this.kickers.ufc = startUfc(every); // fight cards, not games: see ufc.ts
    every(CFB_POLL_MS, () => scanCfbPoll()); // college football's AP Top 25: see cfb-poll.ts
    every(RECAP_MS, async () => weeklyRecaps());
    for (const lg of LEAGUE_IDS) if (!TEAMS_ONLY.has(lg)) every(NEWS_MS, () => scanNews(lg));
    this.upNextKick = startUpNext(watchedTeamKeys); // the Scores tab's "Up next"
  }

  /** Called when someone follows something, so a game already in progress starts tracking immediately. */
  kick() { invalidateWatched(); for (const k of Object.values(this.kickers)) k?.(); this.upNextKick?.(); }

  onGameFinal(lg: League) { setTimeout(() => this.standingsKick[lg]?.(), 15_000).unref(); }

  status() {
    return [
      ...[...this.trackers.values()].map((t) => ({ league: t.ctx.league, gameId: t.ctx.gameId, finished: t.finished, lastPollMs: t.lastPollMs, loopAt: t.loopAt })),
      ...f1Status(),
      ...ufcStatus(),
    ];
  }

  /** A teams-only league's scoreboard is read every TEAMS_ONLY_SCOREBOARD_MS only around games: else once in TEAMS_ONLY_QUIET_MS. */
  private quietUntil: Partial<Record<League, number>> = {};

  private async scanScoreboard(lg: League) {
    if (Date.now() < (this.quietUntil[lg] ?? 0)) return;
    const sb = await liveDeps.getJson(urls.scoreboard(lg), { timeoutMs: 6000, bust: true });
    // College football with no game live or starting within 20 minutes: quiet (a game's tracker reads its own final).
    if (TEAMS_ONLY.has(lg)) {
      const near = (sb.events ?? []).some((ev: any) => ev.status?.type?.state === 'in' || (ev.status?.type?.state === 'pre' && Date.parse(ev.date) - Date.now() < 20 * 60_000));
      this.quietUntil[lg] = near ? 0 : Date.now() + TEAMS_ONLY_QUIET_MS;
    }
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
        tr = new GameTracker(lg, ev.id, home.id, away.id, { sawPre: this.preSeen.delete(key), venue: comp.venue?.fullName, tv, note: ev.season?.type === 3 ? comp.notes?.[0]?.headline : undefined, atBoot: !this.scanned.has(lg) });
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
        tr?.finishFromScoreboard({ home: competitorScore(lg, home), away: competitorScore(lg, away) }, ev); // with the series: a playoff loss can end their season
        if (!tr) recordFinalOnBoard(lg, ev); // nobody tracks either team: Recent misery still has the loss (misery.ts), from this scoreboard read
      }
      if (tr && !relevant && !tr.finished) {
        tr.stop(); this.trackers.delete(key);
        log(`[${lg}] stopped tracking ${ev.shortName ?? ev.name} (${ev.id}): nobody tracks either team now`);
      }
    }
    for (const [k, t] of this.trackers) if (t.finished && !(sb.events ?? []).some((e: any) => `${lg}:${e.id}` === k) && k.startsWith(lg)) this.trackers.delete(k);
    this.scanned.add(lg); // games attached from now on are new follows: 90 s of history (BOOT_BACKFILL_MS)
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
    recordFinalOnBoard(lg, ev, now); // a final from before a restart (misery.ts: a tracked game's own row wins)
  }
}

/**
 * Runs `fn` now and then `ms` after each run ends, never two at once. The function it returns runs it at once (a new
 * follow: LiveEngine.kick). A kick that comes while a run is under way runs it again as soon as that one ends: that run
 * may have read the follows before the new one, and waiting for the next turn left a game untracked for up to `ms`.
 */
export function every(ms: number, fn: () => Promise<void>, opts: { unref?: boolean } = {}): () => void {
  let running = false, again = false;
  let timer: NodeJS.Timeout;
  const run = async () => {
    clearTimeout(timer);
    if (running) { again = true; return; }
    running = true;
    again = false;
    try { await fn(); } catch (e) { log('loop error', String(e)); }
    running = false;
    timer = setTimeout(run, again ? 0 : ms);
    if (opts.unref) timer.unref?.(); // a test's loop, so the test can end (the server's keep the process up, as recorders need)
  };
  void run();
  return () => void run();
}

// ─── Standings: drops, losing streaks, elimination ────────────────────────────────────────────
/** `note`: the zone a table position is in, where ESPN marks it (EPL: "Champions League", "Relegation"). */
/** `division`: its place in its division (DIVISION_STANDINGS), when the standings were read by division. */
interface StandingSnap { rank: number; group: string; clincher: string; streak: string; note?: string; division?: { name: string; rank: number } }

/** ESPN's season type for a table (1 preseason, 2 regular season, 3 postseason): the first group's `standings.seasonType`. */
const PRESEASON = 1;
export function standingsSeasonType(res: any): number | undefined {
  let found: number | undefined;
  const walk = (node: any) => {
    if (found != null || !node) return;
    const t = Number(node.standings?.seasonType);
    if (t) { found = t; return; }
    for (const c of node.children ?? []) walk(c);
  };
  walk(res);
  return found;
}

/** Leagues whose divisions decide the playoffs: their standings are read by division, and a drop names it ("2nd in the AL Central"). */
const DIVISION_STANDINGS = new Set<League>(['mlb', 'nfl', 'nhl']);
/** A division's name as fans say it: MLB "AL Central" (ESPN's short "AL Cent"), the NFL's "AFC East", the NHL's "Atlantic". */
const divisionName = (node: any) => String(node.shortName ?? node.name ?? '').replace(/\bCent\b/, 'Central').replace(/ Division$/, '');

/**
 * Each team's place: its seed (soccer: table position) in its group. `byDivision`: read at ESPN's division level
 * (?level=3), where a league holds its divisions: the group is the league or conference above ("AL", "AFC", "East"),
 * the seed still its own across it, and each team also gets its place in its division, by that seed.
 */
export function parseStandings(res: any, byDivision = false): Map<string, StandingSnap> {
  const out = new Map<string, StandingSnap>();
  const walk = (node: any, parent?: any, depth = 0) => {
    if (node.standings?.entries?.length) {
      const stat = (e: any, n: string) => e.stats?.find((s: any) => s.name === n || s.type === n);
      // Soccer tables have no playoff seed; their "rank" is the table position.
      const seed = (e: any) => Number(stat(e, 'playoffSeed')?.value) || Number(stat(e, 'rank')?.value) || 0;
      const entries = [...node.standings.entries].sort((a, b) =>
        (seed(a) || 99) - (seed(b) || 99)
        || Number(stat(b, 'winPercent')?.value ?? 0) - Number(stat(a, 'winPercent')?.value ?? 0));
      // The EPL's one group is named for the season ("2026-2027"); the league's own name reads better.
      // College football's are slugs ("big10", "sec"): its short name ("Big Ten", "SEC") instead.
      const name = (/^[a-z0-9]+$/.test(String(node.abbreviation ?? '')) ? node.shortName ?? node.name : node.abbreviation ?? node.name) ?? '';
      const division = byDivision && depth >= 2 && parent ? divisionName(node) : null; // the league, a league or conference, its divisions
      const group = division ? String(parent.abbreviation ?? parent.name ?? '') : /^\d{4}-\d{2,4}$/.test(name) && parent ? parent.abbreviation ?? parent.name ?? name : name;
      entries.forEach((e, i) => out.set(String(e.team.id), {
        rank: seed(e) || i + 1,
        group,
        clincher: String(stat(e, 'clincher')?.displayValue ?? ''),
        streak: String(stat(e, 'streak')?.displayValue ?? ''),
        ...(e.note?.description ? { note: String(e.note.description) } : {}),
        ...(division ? { division: { name: division, rank: i + 1 } } : {}),
      }));
    }
    for (const c of node.children ?? []) walk(c, node, depth + 1);
  };
  walk(res);
  return out;
}

/** "Down from 16th. Into the relegation zone 🪂 Streak: L3" (the parts ESPN has); `from` and `also` for a division's drop ("Down from 1st. 6th in the AL."). */
export function dropBody(was: StandingSnap, cur: StandingSnap, from = was.rank, also?: string | null) {
  const relegation = (x: StandingSnap) => /relegation/i.test(x.note ?? '');
  return [`Down from ${ordinal(from)}.`, also && `${also}.`, relegation(cur) && !relegation(was) && 'Into the relegation zone 🪂', cur.streak && `Streak: ${cur.streak}`].filter(Boolean).join(' ');
}

/** ESPN's clincher marks that mean a division title: y, and the ones that include it (z: the conference or league's best, *: home field, p: Presidents' Trophy). */
const DIVISION_TITLE = new Set(['y', 'z', '*', 'p']);
/**
 * The WNBA has no divisions, and its playoffs are seeded league-wide, so ESPN marks no conference title (2026's final
 * standings: the East's 1st had only "x"). Its clinch is ESPN's "*", the league's best record, for the conference rivals.
 */
const WNBA_TOP_SEED = new Set(['*']);

/**
 * Standings news, one alert per team per read: being eliminated, a division rival clinching the division,
 * dropping in the standings, a losing streak. They share a moment, in that order, and each one after the
 * first a device wants is a line on it ("Down to 4th in the AL East. Officially out of playoff contention.").
 * A streak the loss alert already gave (lossFacts, `streak-told`) isn't said again. Being eliminated, the drop and
 * soccer's relegation zone that follow a loss are lines on the device's loss alert instead (`lateOn`), one alert:
 * "Successful Hate Watch! Nebraska lost to Indiana", "Down from 2nd to 8th in the Big Ten. Final Score: 20 to 17".
 */
export async function scanStandings(lg: League) {
  const byDivision = DIVISION_STANDINGS.has(lg);
  const res = await liveDeps.getJson(byDivision ? `${urls.standings(lg)}?level=3` : urls.standings(lg), { timeoutMs: 8000 });
  const now = parseStandings(res, byDivision);
  if (!now.size) return;
  const prev = new Map(Object.entries(kvGet<Record<string, StandingSnap>>(`standings:${lg}`) ?? {}));
  kvSet(`standings:${lg}`, Object.fromEntries(now));
  if (!prev.size) return; // first snapshot is the baseline
  // The preseason's table counts its games as wins and losses (the Magic went from 4th to 10th in the East on one
  // October 11 2026 game): no standings news until the regular season, and a table of another season type than the
  // last is a new baseline (its order starts over). Not soccer: ESPN calls the Premier League's regular season type 1.
  // Only the preseason's end: the regular season's own end (the playoffs) is where eliminations and clinches land.
  if (!SOCCER.has(lg)) {
    const season = standingsSeasonType(res), was = kvGet<number>(`standings-season:${lg}`);
    if (season != null) kvSet(`standings-season:${lg}`, season);
    if (season === PRESEASON || (was === PRESEASON && season != null)) return;
  }
  const day = new Date().toISOString().slice(0, 10), year = new Date().getFullYear(), at = Date.now();
  const onLoss = (key: string, line: string) => ({ lateOn: { targetKey: key, since: at - DROP_ON_LOSS_MS, types: [], loss: true, line } });
  // Division rivals that just won the division (MLB, NFL, NBA, NHL: the leagues with divisions); in the WNBA, a
  // conference rival that just clinched the league's best record (divisionsOf gives the WNBA's conferences).
  const titles = lg === 'wnba' ? WNBA_TOP_SEED : DIVISION_TITLE;
  const clinched = [...now].filter(([id, cur]) => titles.has(cur.clincher) && !titles.has(prev.get(id)?.clincher ?? ''));
  const divisions = clinched.length && ['mlb', 'nfl', 'nba', 'nhl', 'wnba'].includes(lg) ? await divisionsOf(lg).catch(() => new Map()) : new Map();
  const events: Detected[] = [];
  for (const [teamId, cur] of now) {
    const was = prev.get(teamId);
    const team = catalog.teamByEspn(lg, teamId);
    if (!was || !team) continue;
    const base = { targetKey: team.key, at, meta: { teamId }, moment: `standings:${lg}:${teamId}:${at}` };
    if (/e/i.test(cur.clincher) && !/e/i.test(was.clincher)) {
      events.push({ ...base, id: `elim:${lg}:${teamId}:${year}`, type: 'team.eliminated', title: `${team.shortName} ${are(lg)} ELIMINATED ⚰️`, body: `Officially out of playoff contention. See you next year.`, fold: 'Officially out of playoff contention.',
        ...onLoss(team.key, 'Officially out of playoff contention.') });
    }
    for (const [rivalId] of clinched) {
      const div = divisions.get(teamId)?.name;
      if (rivalId === teamId || !div || divisions.get(rivalId)?.name !== div) continue;
      const rival = catalog.teamByEspn(lg, rivalId)?.shortName ?? 'A rival';
      const won = lg === 'wnba' ? "the WNBA's best record" : `the ${div}`;
      events.push({ ...base, id: `clinch:${lg}:${rivalId}:${year}:${teamId}`, type: 'team.rival_clinched', title: `The ${rival} clinched ${won}`,
        body: lg === 'wnba' ? `${team.shortName} won't be the top seed.` : `${team.shortName} won't win the division.`, fold: `The ${rival} clinched ${won}.`, meta: { teamId, rivalId } });
    }
    // Soccer: into the relegation zone (ESPN's table note), before the drop that put them there.
    const relegation = (x: StandingSnap) => /relegation/i.test(x.note ?? '');
    if (SOCCER.has(lg) && relegation(cur) && !relegation(was)) {
      events.push({ ...base, id: `releg:${lg}:${teamId}:${day}`, type: soccerType(lg, 'team.relegation_zone'), title: `${team.shortName} dropped into the relegation zone`, body: dropBody(was, cur), fold: 'Into the relegation zone.', ...onLoss(team.key, 'Into the relegation zone.') });
    }
    // A drop in the division (DIVISION_STANDINGS) names it: "Guardians dropped to 2nd in the AL Central", its seed in
    // the league too if that dropped; a drop in the seeding alone says where they stand in the division.
    const div = cur.division, wasDiv = was.division;
    const divDrop = !!div && !!wasDiv && div.name === wasDiv.name && div.rank > wasDiv.rank;
    const seedDrop = cur.group === was.group && cur.rank > was.rank;
    if (divDrop || seedDrop) {
      const where = divDrop ? `${ordinal(div!.rank)} in the ${div!.name}` : `${ordinal(cur.rank)} in the ${cur.group}`;
      const from = divDrop ? wasDiv!.rank : was.rank;
      const also = divDrop ? (seedDrop ? `${ordinal(cur.rank)} in the ${cur.group}` : null) : div ? `${ordinal(div.rank)} in the ${div.name}` : null;
      events.push({ ...base, id: `standings:${lg}:${teamId}:${day}:${divDrop ? `${div!.name}:${wasDiv!.rank}->${div!.rank}` : `${was.rank}->${cur.rank}`}`, type: 'team.standings_drop',
        title: `${team.shortName} dropped to ${where}`, body: dropBody(was, cur, from, also), fold: `Down to ${where}.`,
        ...onLoss(team.key, `Down from ${ordinal(from)} to ${where}${also ? ` (${also})` : ''}.`) });
    }
    const m = cur.streak.match(/^L(\d+)$/);
    if (m && Number(m[1]) >= 3 && cur.streak !== was.streak && kvGet(`streak-told:${lg}:${teamId}`) !== cur.streak) {
      events.push({ ...base, id: `streak:${lg}:${teamId}:${day}:${cur.streak}`, type: 'team.losing_streak', title: `${team.shortName} ${have(lg)} lost ${m[1]} straight`, body: `Current streak: ${cur.streak}`, fold: `Lost ${m[1]} straight.` });
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
    events.push({ id, type: 'player.injured', targetKey: playerKey(lg, athleteId), title, body, at, meta: { athleteId, status: cur.status } });
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
