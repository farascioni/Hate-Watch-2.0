import { getJson, athleteIdFromRef } from './espn.ts';
import { db, kvGet, kvSet } from './db.ts';
import { catalog } from './catalog.ts';
import { LEAGUE_IDS, urls, teamKey, playerKey, type League } from './leagues.ts';
import {
  PLAYER_DETECTORS, fromCorePlay, fromSitePlay, mergePlays, mlbFinalHalfInning, nextScore, observePlay, ordinal, scoreLine, teamScoreEvents,
  type Detected, type GameCtx, type NPlay,
} from './detectors.ts';
import { publish } from './fanout.ts';

const LIVE_POLL_MS = Number(process.env.HW_LIVE_POLL_MS ?? 2000);      // per live game
const SCOREBOARD_MS = Number(process.env.HW_SCOREBOARD_MS ?? 10000);   // discovers games going live / final
const STANDINGS_MS = Number(process.env.HW_STANDINGS_MS ?? 60000);
const INJURIES_MS = Number(process.env.HW_INJURIES_MS ?? 30000);
/** Plays older than this when we first attach to a game are treated as history, not news. */
const BACKFILL_WINDOW_MS = 90_000;
const BLOWOUT: Record<League, number> = { nba: 20, nfl: 21, mlb: 7, nhl: 4 };

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

// ─── One live game ────────────────────────────────────────────────────────────────────────────
class GameTracker {
  readonly ctx: GameCtx;
  private seen = new Set<string>();
  private score = { home: 0, away: 0 };
  private first = true;
  private stopped = false;
  finished = false;
  lastPollMs = 0;

  constructor(league: League, gameId: string, homeId: string, awayId: string) {
    this.ctx = { league, gameId, homeId, awayId, goalies: new Map() };
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
   */
  private async poll() {
    const { league, gameId } = this.ctx;
    const [core, summary] = await Promise.allSettled([
      getJson(urls.corePlays(league, gameId), { bust: true, timeoutMs: 4000 }),
      getJson(urls.summary(league, gameId), { bust: true, timeoutMs: 4000 }),
    ]);
    if (core.status === 'rejected' && summary.status === 'rejected') throw core.reason;

    const corePlays: NPlay[] = core.status === 'fulfilled' ? (core.value.items ?? []).map(fromCorePlay) : [];
    // NFL summary has no flat plays list (drives only, without participants); core covers it.
    const sitePlays: NPlay[] = summary.status === 'fulfilled' && league !== 'nfl' ? (summary.value.plays ?? []).map(fromSitePlay) : [];
    const plays = mergePlays(corePlays, sitePlays);

    let final: { home: number; away: number } | null = null;
    if (summary.status === 'fulfilled') {
      const s = summary.value;
      if (this.first && league === 'nhl') this.seedGoalies(s);
      const comp = s.header?.competitions?.[0];
      if (comp?.status?.type?.completed) {
        const c = (side: string) => Number(comp.competitors.find((x: any) => x.homeAway === side)?.score ?? 0);
        final = { home: c('home'), away: c('away') };
      }
    }
    if (!final && plays.some((p) => /^End (of )?Game$/i.test(p.type))) {
      final = { home: Math.max(...plays.map((p) => p.home)), away: Math.max(...plays.map((p) => p.away)) };
    }

    const cutoff = Date.now() - BACKFILL_WINDOW_MS;
    const events: Detected[] = [];
    for (const p of plays) {
      if (this.seen.has(p.id)) continue;
      this.seen.add(p.id);
      const prev = this.score;
      this.score = nextScore(prev, p);
      // History from before we attached updates state but is never notified.
      if (!(this.first && p.at < cutoff)) {
        events.push(...PLAYER_DETECTORS[league](this.ctx, p));
        if (this.score.home !== prev.home || this.score.away !== prev.away) events.push(...teamScoreEvents(this.ctx, prev, p));
      }
      observePlay(this.ctx, p);
    }
    this.first = false;
    if (events.length) publish(events, league);
    if (final) this.finish(final);
  }

  private seedGoalies(s: any) {
    for (const t of s.boxscore?.players ?? []) {
      const g = t.statistics?.find((x: any) => x.name === 'goalies')?.athletes?.[0]?.athlete?.id;
      if (g) this.ctx.goalies.set(String(t.team.id), String(g));
    }
  }

  finish(final: { home: number; away: number }) {
    if (this.finished) return;
    this.finished = true;
    const lastHalf = mlbFinalHalfInning(this.ctx); // the final half-inning gets no "End Inning" play
    if (lastHalf.length) publish(lastHalf, this.ctx.league);
    if (final.home === final.away) return; // ties are miserable for everyone, but not a loss
    const loserId = final.home < final.away ? this.ctx.homeId : this.ctx.awayId;
    const winnerId = loserId === this.ctx.homeId ? this.ctx.awayId : this.ctx.homeId;
    const loser = catalog.teamByEspn(this.ctx.league, loserId);
    const winner = catalog.teamByEspn(this.ctx.league, winnerId);
    const margin = Math.abs(final.home - final.away);
    publish([{
      id: `${this.ctx.gameId}:final:team.lost:${loserId}`,
      type: 'team.lost',
      targetKey: teamKey(this.ctx.league, loserId),
      title: `${loser?.shortName ?? 'Your team'} LOST to the ${winner?.shortName ?? 'opponent'}${margin >= BLOWOUT[this.ctx.league] ? ' — blowout 🔥' : ''}`,
      body: `Final: ${scoreLine(this.ctx, final)}`,
      at: Date.now(),
      meta: { gameId: this.ctx.gameId },
    }], this.ctx.league);
    engine.onGameFinal(this.ctx.league);
  }
}

// ─── Engine: scoreboards → trackers, plus standings + injuries ─────────────────────────────────
class LiveEngine {
  private trackers = new Map<string, GameTracker>();
  private kickers: Partial<Record<League, () => void>> = {};
  private standingsKick: Partial<Record<League, () => void>> = {};

  start() {
    for (const lg of LEAGUE_IDS) {
      this.kickers[lg] = every(SCOREBOARD_MS, () => this.scanScoreboard(lg));
      this.standingsKick[lg] = every(STANDINGS_MS, () => scanStandings(lg));
      every(INJURIES_MS, () => scanInjuries(lg));
    }
  }

  /** Called when someone follows something, so a game already in progress starts tracking immediately. */
  kick() { invalidateWatched(); for (const k of Object.values(this.kickers)) k?.(); }

  onGameFinal(lg: League) { setTimeout(() => this.standingsKick[lg]?.(), 15_000); }

  status() {
    return [...this.trackers.values()].map((t) => ({ league: t.ctx.league, gameId: t.ctx.gameId, finished: t.finished, lastPollMs: t.lastPollMs }));
  }

  private async scanScoreboard(lg: League) {
    const sb = await getJson(urls.scoreboard(lg), { timeoutMs: 6000, bust: true });
    const watched = watchedTeamKeys();
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

      if (relevant && !tr && (state === 'in' || (state === 'pre' && startsIn < 3 * 60_000))) {
        tr = new GameTracker(lg, ev.id, home.id, away.id);
        this.trackers.set(key, tr);
        log(`[${lg}] tracking ${ev.shortName ?? ev.name} (${ev.id})`);
        tr.start();
      }
      if (state === 'post' && ev.status?.type?.completed) {
        // Scoreboard is the backstop for finals (NFL, or a restart right after the buzzer).
        if (!tr && relevant && Date.now() - Date.parse(ev.date) < 6 * 3600_000) {
          tr = new GameTracker(lg, ev.id, home.id, away.id);
          this.trackers.set(key, tr);
        }
        tr?.finish({ home: Number(home.score), away: Number(away.score) });
        tr?.stop();
      }
      if (tr && !relevant && !tr.finished) { tr.stop(); this.trackers.delete(key); }
    }
    for (const [k, t] of this.trackers) if (t.finished && !(sb.events ?? []).some((e: any) => `${lg}:${e.id}` === k) && k.startsWith(lg)) this.trackers.delete(k);
  }
}

export const engine = new LiveEngine();

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
interface StandingSnap { rank: number; group: string; clincher: string; streak: string }

export function parseStandings(res: any): Map<string, StandingSnap> {
  const out = new Map<string, StandingSnap>();
  const walk = (node: any) => {
    if (node.standings?.entries?.length) {
      const stat = (e: any, n: string) => e.stats?.find((s: any) => s.name === n || s.type === n);
      const entries = [...node.standings.entries].sort((a, b) =>
        (Number(stat(a, 'playoffSeed')?.value) || 99) - (Number(stat(b, 'playoffSeed')?.value) || 99)
        || Number(stat(b, 'winPercent')?.value ?? 0) - Number(stat(a, 'winPercent')?.value ?? 0));
      entries.forEach((e, i) => out.set(String(e.team.id), {
        rank: Number(stat(e, 'playoffSeed')?.value) || i + 1,
        group: node.abbreviation ?? node.name ?? '',
        clincher: String(stat(e, 'clincher')?.displayValue ?? ''),
        streak: String(stat(e, 'streak')?.displayValue ?? ''),
      }));
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(res);
  return out;
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
      events.push({ ...base, id: `standings:${lg}:${teamId}:${day}:${was.rank}->${cur.rank}`, type: 'team.standings_drop', title: `${team.shortName} dropped to ${ordinal(cur.rank)} in the ${cur.group}`, body: `Down from ${ordinal(was.rank)}. Streak: ${cur.streak || '—'}` });
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

async function scanInjuries(lg: League) {
  const res = await getJson(urls.injuries(lg), { conditional: true, timeoutMs: 8000 });
  const now: Record<string, { status: string; teamId: string; detail: string }> = {};
  for (const team of res.injuries ?? []) {
    for (const inj of team.injuries ?? []) {
      const a = inj.athlete ?? {};
      const id = a.id ?? athleteIdFromRef(a.$ref) ?? a.links?.map((l: any) => l.href?.match(/\/id\/(\d+)/)?.[1]).find(Boolean);
      if (id) now[id] = { status: String(inj.status ?? inj.type?.description ?? 'Injured'), teamId: String(team.id), detail: String(inj.shortComment ?? inj.details?.type ?? '') };
    }
  }
  const prev = kvGet<typeof now>(`injuries:${lg}`);
  kvSet(`injuries:${lg}`, now);
  if (!prev) return;
  const events: Detected[] = [];
  for (const [athleteId, cur] of Object.entries(now)) {
    const was = prev[athleteId];
    if (was && severity(cur.status) <= severity(was.status)) continue;
    const player = catalog.playerByEspn(lg, athleteId);
    const team = catalog.teamByEspn(lg, cur.teamId);
    const name = player?.name ?? 'A player';
    const title = was ? `${name} downgraded to ${cur.status}` : `${name} is injured (${cur.status})`;
    const id = `inj:${lg}:${athleteId}:${cur.status}:${new Date().toISOString().slice(0, 10)}`;
    const body = cur.detail || `${team?.shortName ?? ''} injury report`;
    events.push({ id, type: 'player.injured', targetKey: playerKey(lg, athleteId), title, body, at: Date.now(), meta: { athleteId } });
    if (team) events.push({ id: `${id}:team`, type: 'team.player_injured', targetKey: team.key, title: `${team.shortName}: ${title}`, body, at: Date.now(), meta: { athleteId } });
  }
  if (events.length) publish(events, lg);
}
