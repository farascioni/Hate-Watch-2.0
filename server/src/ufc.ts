// The UFC, from ESPN's MMA data: fighters are players (catalog.ts, on a placeholder team), and a card is
// watched while one of them is on it. Every 10 seconds the card (each fight's status) and, for a fight in
// progress, both fighters' knockdown counts; when a fight ends, its result (how, when). A fighter you track:
//   - a fight starting;
//   - a knockdown (ESPN's knockdown events name nobody, so it's a fighter's count going up: their opponent went
//     down). Held 30 seconds: if the fight ends on it, it's a line on the loss instead (a KO is one alert);
//   - a loss, the Successful Hate Watch, saying how ("got knocked out", "tapped out", the judges' cards) and when
//     ("KO/TKO R1 1:20"), with lines of their own switches: a title fight (theirs to lose, or one they were
//     after), as the favorite, a losing streak.
// A loss gets ESPN's clip of the fight when there is one (the bigger fights: main events, title fights), the
// way a game's loss gets its winning play's (clips.ts): looked for every few minutes for three hours after,
// under its own switch, clips.loss.ufc (flags.ts).
// Nothing is sent for what already happened when a fight was first read (a restart mid-card, a fighter tracked
// mid-fight). A title fight is ESPN's word on the fight itself (its `types`), and who held the belt is from the
// title fights before it (ufc-classes.ts). Not ESPN's UFC rankings: they're years out of date (October 2026:
// Figueiredo as flyweight champion), so no "dropped in the rankings".
import { getJson } from './espn.ts';
import { db, kvGet } from './db.ts';
import { catalog } from './catalog.ts';
import { playerKey, urls } from './leagues.ts';
import { titleOf, weightName, type Belts } from './ufc-classes.ts';
import { eventChanged, publish } from './fanout.ts';
import { attachClips, clipFromVideo } from './clips.ts';
import { flagOn } from './flags.ts';
import type { Clip } from './highlights.ts';
import { lineChances } from './scores.ts';
import { ordinal, type Detected } from './detectors.ts';
import type { GameLine, StatsPage, StatTile } from './stats.ts';

/** Seams for tests. `watchClip`: looking for a lost fight's clip, after its loss went out. */
export const ufcDeps = {
  getJson: getJson as (url: string, opts?: { timeoutMs?: number; bust?: boolean }) => Promise<any>, now: () => Date.now(),
  watchClip: (job: ClipJob) => { void watchFightClip(job); },
};
const log = (...a: unknown[]) => console.log('[ufc]', ...a);

const CARD_MS = 10_000;                // a card being watched
const SCAN_MS = 5 * 60_000;            // looking for a card to watch
const CARD_MAX_MS = 12 * 3600_000;     // a card is watched this long at most, whatever ESPN says
const KD_HOLD_MS = 30_000;             // a knockdown waits this long in case the fight ends on it
const RESULT_WAIT_MS = 3 * 60_000;     // a fight over without ESPN's result yet: how long to wait for it
const FAVORITE = 60;                   // "lost as the favorite": the line gave them this much (percent) or more
const ATTACH_BEFORE_MS = 60 * 60_000;  // a card is watched from an hour before its start
const CLIP_EVERY_MS = 2 * 60_000;      // a lost fight's clip: looked for this often
const CLIP_WAIT_MS = 3 * 3600_000;     // for this long after the result
const CLIP_EARLY_MS = 2 * 60_000;      // a clip out this much before we saw the result is still the fight's (ESPN's result can lead ours)

const get = (url: string) => ufcDeps.getJson(url, { timeoutMs: 8000, bust: true });
const fighterName = (id: string, fallback = 'Their opponent') => catalog.playerByEspn('ufc', id)?.name ?? fallback;
/** The fighters someone tracks (ESPN ids). */
export function trackedFighters(): Set<string> {
  const rows = db.prepare("SELECT DISTINCT target_key FROM follows WHERE target_key LIKE 'player:ufc:%'").all() as { target_key: string }[];
  return new Set(rows.map((r) => r.target_key.split(':')[2]));
}

// ─── A fight, as the card has it ──────────────────────────────────────────────────────────────
export interface Fighter { id: string; name: string; winner: boolean | null; cards: number[] }
/** `status`: ESPN's ("STATUS_FINAL", "STATUS_CANCELED"…); `state`: pre, in or post. */
export interface Fight { eventId: string; eventName: string; id: string; weight: string | null; rounds: number | null; state: string; status: string; period: number; clock: string; fighters: Fighter[] }

/** A fight from the site scoreboard: who, its weight class, its status, and each judge's card (the totals). */
export function fightOf(ev: any, c: any): Fight {
  return {
    eventId: String(ev.id), eventName: String(ev.name ?? ev.shortName ?? 'UFC'), id: String(c.id), weight: weightName(c.type?.abbreviation),
    rounds: Number(c.format?.regulation?.periods) || null, state: String(c.status?.type?.state ?? 'pre'), status: String(c.status?.type?.name ?? ''), period: Number(c.status?.period) || 0, clock: String(c.status?.displayClock ?? ''),
    fighters: (c.competitors ?? []).map((x: any) => ({
      id: String(x.id), name: x.athlete?.displayName ?? fighterName(String(x.id), '?'), winner: typeof x.winner === 'boolean' ? x.winner : null,
      cards: (x.linescores?.[0]?.linescores ?? []).map((j: any) => Number(j.value)).filter((n: number) => Number.isFinite(n)),
    })),
  };
}

/** ESPN's result for a finished fight (core status): "kotko" / "submission" / "decision---split"…, what with, where, when. */
export interface FightResult { name: string; display: string; desc?: string; target?: string; period: number; clock: string }
export const resultOf = (status: any): FightResult | null => (status?.result?.name ? {
  name: String(status.result.name), display: String(status.result.displayName ?? status.result.name), desc: status.result.description ?? undefined,
  target: status.result.target?.description ?? undefined, period: Number(status.period) || 0, clock: String(status.displayClock ?? ''),
} : null);

// ─── What the alerts say ──────────────────────────────────────────────────────────────────────
const lower = (s?: string) => (s ? s.toLowerCase() : '');
/**
 * How they lost, from the loser's side: the title's verb, the body's sentence, and a finish's how and when for
 * the end of the title ("KO/TKO R1 1:20": the time is into the round, as the UFC says it). ESPN has one result
 * for a knockout and a referee's stoppage, so it's "KO/TKO", never one or the other.
 */
function howLost(r: FightResult | null, f: Fight, winner: Fighter, loser: Fighter): { verb: string; how: string; when?: string } {
  const at = r ? ` at ${r.clock} of round ${r.period}` : '';
  const when = (what: string) => (r?.period && r.clock ? `${what} R${r.period} ${r.clock}` : what);
  if (r?.name === 'kotko') {
    const what = [lower(r.desc), r.target ? `to the ${lower(r.target)}` : ''].filter(Boolean).join(' ');
    return { verb: `got knocked out by ${winner.name}`, how: `KO/TKO${what ? ` (${what})` : ''}${at}.`, when: when('KO/TKO') };
  }
  if (r?.name === 'submission') return { verb: `tapped out to ${winner.name}`, how: `Submission${r.desc ? ` (${lower(r.desc)})` : ''}${at}.`, when: when('Submission') };
  const kind = r?.name.match(/^decision-+(\w+)/)?.[1];
  if (kind) {
    const cards = winner.cards.length === loser.cards.length && winner.cards.length ? ` (${winner.cards.map((w, i) => `${w}-${loser.cards[i]}`).join(', ')})` : '';
    return { verb: `lost a ${kind} decision to ${winner.name}`, how: `${kind[0].toUpperCase()}${kind.slice(1)} decision after ${r!.period || f.rounds} rounds${cards}.` };
  }
  if (r && (r.name === 'dq' || /disqualif/i.test(r.name + r.display))) return { verb: `lost by disqualification to ${winner.name}`, how: `Disqualified${at}.`, when: when('DQ') };
  return { verb: `lost to ${winner.name}`, how: r ? `${r.display}${at}.` : '' };
}

export interface LossFacts {
  /** A title fight: its belt (ESPN's), and whether the loser held it. */
  title?: { weight: string; interim: boolean; held: boolean };
  /** The loser's chance from the line before the fight (percent). */
  chance?: number;
  /** Losses in a row, this one included. */
  streak?: number;
  /** Knockdowns of the loser in the finish (each the fight's nth, in its round), as lines. */
  knockdowns?: { n: number; round: number }[];
}

/**
 * A fight's loss: the Successful Hate Watch for the loser, and its facts, each its own type (a line on the
 * loss for those who want them both, or the alert itself for those with the loss off), sharing its moment.
 * Nothing for a draw or a no contest.
 */
export function lossAlerts(f: Fight, r: FightResult | null, x: LossFacts = {}, at = ufcDeps.now()): Detected[] {
  const loser = f.fighters.find((p) => p.winner === false), winner = f.fighters.find((p) => p.winner === true);
  if (!loser || !winner) return [];
  const { verb, how, when } = howLost(r, f, winner, loser);
  const key = playerKey('ufc', loser.id), id = `${f.id}:ufc.lost:${loser.id}`, moment = `${f.id}:ufc:lost:${loser.id}`;
  const body = [how, `${f.weight ? `${f.weight}, ` : ''}${f.eventName}.`].filter(Boolean).join(' ');
  const meta = { gameId: f.id, athleteId: loser.id, winnerId: winner.id, lossClip: true, clipFlag: 'clips.loss.ufc' }; // the fight's clip goes on it, under its own switch
  const out: Detected[] = [{ id, type: 'ufc.lost', targetKey: key, title: `Successful Hate Watch! ${loser.name} ${verb}${when ? ` (${when})` : ''}`, body, at, meta, moment }];
  // Each fact is the alert itself for someone with the loss off: the finish ends its title too.
  const fact = (type: string, title: string, fold: string) => out.push({
    id: `${f.id}:${type}:${loser.id}`, type, targetKey: key, title: `Successful Hate Watch! ${loser.name} ${title}${when ? ` (${when})` : ''}`, body, at,
    meta: { ...meta, lostId: id, teamKey: key }, moment, fold,
  });
  if (x.title) {
    const belt = `${x.title.interim ? 'interim ' : ''}${x.title.weight} title`, a = x.title.interim ? 'an' : 'a';
    if (x.title.held) fact('ufc.lost_title', `lost the ${belt} to ${winner.name}`, `Lost the ${belt}.`);
    else fact('ufc.lost_title', `lost ${a} ${belt} fight to ${winner.name}`, `Lost ${a} ${belt} fight.`);
  }
  if (x.chance != null && x.chance >= FAVORITE) fact('ufc.lost_as_favorite', `lost to ${winner.name} as a ${x.chance}% favorite`, `Lost as a ${x.chance}% favorite.`);
  if ((x.streak ?? 0) >= 2) fact('ufc.losing_streak', `has lost ${x.streak} straight`, `Lost ${x.streak} straight.`);
  // The knockdowns on the way to it: lines on the loss, only ever (a KO is one alert).
  for (const k of x.knockdowns ?? []) out.push({
    id: `${f.id}:ufc.knocked_down:${loser.id}:${k.n}`, type: 'ufc.knocked_down', targetKey: key, title: `${loser.name} got knocked down by ${winner.name}`, body, at,
    meta, moment, fold: knockdownLine(k.round, k.n), foldOnly: true,
  });
  return out;
}

/** A knockdown as a line on the loss: "Knocked down in round 3.", "Knocked down in round 3 (2nd time)." (each its own line). */
export const knockdownLine = (round: number, n: number) => `Knocked down in round ${round}${n > 1 ? ` (${ordinal(n)} time)` : ''}.`;

/** A knockdown, live: `athleteId` went down for the `n`th time this fight. */
export function knockdownAlert(f: Fight, athleteId: string, n: number, round: number, at = ufcDeps.now()): Detected {
  const me = f.fighters.find((p) => p.id === athleteId), them = f.fighters.find((p) => p.id !== athleteId);
  return {
    id: `${f.id}:ufc.knocked_down:${athleteId}:${n}`, type: 'ufc.knocked_down', targetKey: playerKey('ufc', athleteId),
    title: `${me?.name ?? fighterName(athleteId, 'Your fighter')} got knocked down by ${them?.name ?? 'their opponent'}${round ? ` in round ${round}` : ''}`,
    body: `${n > 1 ? `Knocked down ${n} times now. ` : ''}${f.weight ? `${f.weight}, ` : ''}${f.eventName}.`, at,
    meta: { gameId: f.id, athleteId }, moment: `${f.id}:ufc:kd:${athleteId}:${n}`,
  };
}

/** A fight starting, for each of its fighters. */
export function fightStartAlerts(f: Fight, at = ufcDeps.now()): Detected[] {
  return f.fighters.map((me) => {
    const them = f.fighters.find((p) => p.id !== me.id);
    return {
      id: `${f.id}:ufc.fight_start:${me.id}`, type: 'ufc.fight_start', targetKey: playerKey('ufc', me.id),
      title: `Hate Watch Starting: ${me.name} vs ${them?.name ?? '?'}`, body: `${f.weight ? `${f.weight}${f.rounds ? `, ${f.rounds} rounds` : ''}. ` : ''}${f.eventName}.`, at,
      meta: { gameId: f.id, athleteId: me.id },
    };
  });
}

// ─── Watching a card ──────────────────────────────────────────────────────────────────────────
interface Held { athleteId: string; n: number; round: number; at: number }
/** `tail`: reads left after the result, for knockdowns ESPN's stats count late (the loser's: lines on the loss). */
interface FightWatch { state: string; kd: Map<string, number> | null; held: Held[]; done: boolean; overAt: number | null; tail: number; loserId?: string; chances?: Map<string, number> }
const TAIL_READS = 6;

/** The card's date as ESPN's scoreboard files it (US Eastern). */
export const cardDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso)).replace(/-/g, '');

export class CardWatch {
  private fights = new Map<string, FightWatch>();
  private first = true;
  private readonly startedAt = ufcDeps.now();
  stopped = false;
  readonly eventId: string;
  readonly day: string;
  readonly name: string;
  constructor(eventId: string, day: string, name: string) { this.eventId = eventId; this.day = day; this.name = name; }

  /** Each fighter's knockdowns so far (their stats on the core API). */
  private async knockdowns(f: Fight): Promise<Map<string, number> | null> {
    const fight = await get(urls.ufcFight(f.eventId, f.id)).catch(() => null);
    if (!fight?.competitors) return null;
    const counts = new Map<string, number>();
    for (const cp of fight.competitors) {
      const s = cp.statistics?.$ref ? await get(cp.statistics.$ref).catch(() => null) : null;
      const kd = s?.splits?.categories?.flatMap((k: any) => k.stats ?? []).find((x: any) => x.name === 'knockDowns')?.value;
      if (typeof kd !== 'number') return null; // all or nothing: a missing count isn't a zero
      counts.set(String(cp.id), kd);
    }
    return counts;
  }

  /** A title fight (ESPN's `types`: "UFC Lightweight Title"), and whether `loserId` held that belt, by the catalog's last refresh. */
  private async title(f: Fight, loserId: string): Promise<LossFacts['title']> {
    const fight = await get(urls.ufcFight(f.eventId, f.id)).catch(() => null);
    const t = (fight?.types ?? []).map((x: any) => titleOf(x?.text)).find(Boolean);
    if (!t) return undefined;
    const belt = kvGet<Belts>('ufc:belts')?.[t.weight];
    return { ...t, held: (t.interim ? belt?.interim : belt?.champion) === loserId };
  }

  /** The line's chances for each fighter (percent), once a fight. */
  private async chances(f: Fight): Promise<Map<string, number>> {
    const odds = await get(`${urls.ufcFight(f.eventId, f.id)}/odds`).catch(() => null);
    const o = odds?.items?.[0], idOf = (s: any) => String(s?.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1];
    const c = o ? lineChances(o.homeAthleteOdds?.moneyLine, o.awayAthleteOdds?.moneyLine) : undefined;
    const out = new Map<string, number>();
    if (c && idOf(o.homeAthleteOdds)) out.set(idOf(o.homeAthleteOdds)!, c.home);
    if (c && idOf(o.awayAthleteOdds)) out.set(idOf(o.awayAthleteOdds)!, c.away);
    return out;
  }

  async poll(tracked: Set<string>) {
    const sb = await get(urls.scoreboard('ufc', this.day));
    const ev = (sb.events ?? []).find((e: any) => String(e.id) === this.eventId);
    if (!ev) return;
    const now = ufcDeps.now(), out: Detected[] = [], clipJobs: ClipJob[] = [];
    for (const c of ev.competitions ?? []) {
      const f = fightOf(ev, c);
      if (!f.fighters.some((p) => tracked.has(p.id))) continue;
      // A fight first read now (the card's first read, or a fighter tracked mid-card) starts where it is: nothing late.
      const w: FightWatch = this.fights.get(f.id) ?? { state: f.state, kd: null, held: [], done: f.state === 'post', overAt: null, tail: 0 };
      this.fights.set(f.id, w);
      if (/cancel|postpon/i.test(f.status)) { Object.assign(w, { done: true, tail: 0, held: [], state: f.state }); continue; } // called off: nothing to wait for
      if (!w.chances && f.state === 'pre') w.chances = await this.chances(f);
      if (f.state === 'in' && w.state === 'pre' && !this.first) out.push(...fightStartAlerts(f, now));
      // Knockdowns: a fighter's count going up is their opponent going down (the opponent's nth).
      const late: Held[] = [];
      if (!w.done ? f.state === 'in' || f.state === 'post' : w.tail > 0) {
        if (w.done) w.tail--;
        const kd = await this.knockdowns(f);
        if (kd && w.kd) for (const [id, n] of kd) {
          const down = f.fighters.find((p) => p.id !== id)?.id;
          for (let k = (w.kd.get(id) ?? 0) + 1; down && k <= n; k++) (w.done ? late : w.held).push({ athleteId: down, n: k, round: f.period, at: now });
        }
        if (kd) w.kd = kd;
      }
      // Counted after the result: the loser's are lines on the loss (late, no push), the winner's their own alerts.
      for (const h of late) {
        if (h.athleteId === w.loserId) out.push({ ...knockdownAlert(f, h.athleteId, h.n, h.round, now), moment: `${f.id}:ufc:lost:${h.athleteId}`, fold: knockdownLine(h.round, h.n), foldOnly: true });
        else out.push(knockdownAlert(f, h.athleteId, h.n, h.round, now));
      }
      if (f.state === 'post' && !w.done) {
        w.overAt ??= now;
        const status = await get(`${urls.ufcFight(f.eventId, f.id)}/status`).catch(() => null);
        const r = resultOf(status);
        // Over once ESPN has its result (a draw or no contest too: no loser, no alert), or a few minutes after.
        if (r || now - w.overAt >= RESULT_WAIT_MS) {
          w.done = true;
          w.tail = TAIL_READS;
          const loser = f.fighters.find((p) => p.winner === false);
          w.loserId = loser?.id;
          if (!this.first) {
            const facts: LossFacts = {
              title: loser ? await this.title(f, loser.id) : undefined,
              chance: loser ? (w.chances ?? await this.chances(f)).get(loser.id) : undefined,
              streak: loser ? await losingStreak(loser.id, f.id).catch(() => undefined) : undefined,
              knockdowns: w.held.filter((h) => h.athleteId === loser?.id).map((h) => ({ n: h.n, round: h.round })),
            };
            const lost = lossAlerts(f, r, facts, now), winner = f.fighters.find((p) => p.winner === true);
            out.push(...lost);
            if (lost.length && loser && winner) clipJobs.push({ eventId: f.eventId, fightId: f.id, loserId: loser.id, winnerId: winner.id, since: w.overAt });
            // The winner went down on the way to winning: still a knockdown, for whoever tracks them.
            for (const h of w.held.filter((x) => x.athleteId !== loser?.id)) out.push(knockdownAlert(f, h.athleteId, h.n, h.round, now));
          }
          w.held = [];
        }
      }
      // Knockdowns whose fight went on: their own alerts.
      for (const h of w.held.filter((x) => now - x.at >= KD_HOLD_MS && f.state === 'in')) out.push(knockdownAlert(f, h.athleteId, h.n, h.round, now));
      w.held = w.held.filter((x) => !(now - x.at >= KD_HOLD_MS && f.state === 'in'));
      w.state = f.state;
    }
    this.first = false;
    if (out.length) publish(out, 'ufc');
    for (const job of clipJobs) ufcDeps.watchClip(job);
    // A fight taken off the card isn't waited for; the card is over when every fight is over or cancelled.
    const onCard = new Set((ev.competitions ?? []).map((c: any) => String(c.id)));
    for (const id of [...this.fights.keys()]) if (!onCard.has(id)) this.fights.delete(id);
    const over = (c: any) => c.status?.type?.state === 'post' || /cancel|postpon/i.test(String(c.status?.type?.name ?? ''));
    if ((ev.competitions ?? []).every(over) && [...this.fights.values()].every((w) => w.done && w.tail <= 0)) this.stopped = true;
    if (now - this.startedAt >= CARD_MAX_MS) this.stopped = true;
  }
}

// ─── A lost fight's clip ──────────────────────────────────────────────────────────────────────
/** A fight that's over, to look for its clip: who lost to whom, and when we saw the result. */
export interface ClipJob { eventId: string; fightId: string; loserId: string; winnerId: string; since: number }

/**
 * A fight's clip, from ESPN's videos: the first tagged with both fighters that came out after the result (their
 * stare-down and walk-outs are tagged with both too, but come before it), while ESPN still has it up.
 */
export function fightClip(videos: any[], loserId: string, winnerId: string, since: number, now = ufcDeps.now()): Clip | null {
  const both = (v: any) => { const ids = new Set((v?.categories ?? []).map((c: any) => String(c?.athleteId ?? ''))); return ids.has(loserId) && ids.has(winnerId); };
  const out = (v: any) => Date.parse(v?.originalPublishDate ?? '') || 0;
  for (const v of videos.filter((v) => both(v) && out(v) >= since - CLIP_EARLY_MS).sort((a, b) => out(a) - out(b))) {
    const clip = clipFromVideo(v, now);
    if (clip) return clip;
  }
  return null;
}

/**
 * One look for a lost fight's clip, on the card's fight center and the loser's page (each ESPN's latest few):
 * if it's out, it goes on the loss's alerts and their feeds get them again (no push). True once it's found.
 */
export async function checkFightClip(job: ClipJob): Promise<boolean> {
  if (!flagOn('clips.loss.ufc')) return false;
  const [card, page] = await Promise.all([get(urls.ufcFightCenter(job.eventId)).catch(() => null), get(urls.mmaAthletePage(job.loserId)).catch(() => null)]);
  const clip = fightClip([...(card?.videos ?? []), ...(page?.videos ?? [])], job.loserId, job.winnerId, job.since);
  if (!clip) return false;
  for (const id of attachClips(job.fightId, new Map(), clip)) eventChanged(id);
  return true;
}

/** Every few minutes for three hours after the result, until the clip's found. */
async function watchFightClip(job: ClipJob) {
  for (const end = ufcDeps.now() + CLIP_WAIT_MS; ufcDeps.now() < end;) {
    await new Promise((r) => setTimeout(r, CLIP_EVERY_MS).unref());
    try { if (await checkFightClip(job)) return; } catch (e) { log('clip', String(e)); }
  }
}

/** Losses in a row, this one included, from the fighter's fight log (newest first; ESPN may not have this fight in it yet). */
async function losingStreak(athleteId: string, fightId: string): Promise<number> {
  const log = await get(`${urls.mmaAthlete(athleteId)}/eventlog`);
  const items: any[] = (log.events?.items ?? []).filter((x: any) => x.played !== false).slice(0, 6);
  let n = items.some((x) => String(x.competition?.$ref ?? '').includes(`/competitions/${fightId}`)) ? 0 : 1;
  for (const it of items) {
    const cp = it.competitor?.$ref ? await get(it.competitor.$ref).catch(() => null) : null;
    if (cp?.winner !== false) break;
    n++;
  }
  return n;
}

// ─── Finding cards ────────────────────────────────────────────────────────────────────────────
const cards = new Map<string, CardWatch>();

async function scanUfc() {
  const tracked = trackedFighters();
  if (!tracked.size) return;
  const sb = await get(urls.scoreboard('ufc'));
  const now = ufcDeps.now();
  for (const ev of sb.events ?? []) {
    const id = String(ev.id);
    if (cards.has(id) || /contender series/i.test(String(ev.name ?? ''))) continue;
    const starts = Date.parse(ev.date ?? ''), over = (ev.competitions ?? []).length && (ev.competitions ?? []).every((c: any) => c.status?.type?.completed);
    const onIt = (ev.competitions ?? []).some((c: any) => (c.competitors ?? []).some((x: any) => tracked.has(String(x.id))));
    if (!onIt || over || !(starts - now <= ATTACH_BEFORE_MS)) continue;
    const w = new CardWatch(id, cardDay(ev.date), String(ev.name ?? 'UFC'));
    cards.set(id, w);
    log(`watching ${w.name}`);
    void (async () => {
      while (!w.stopped) {
        try { await w.poll(trackedFighters()); } catch (e) { log(`${w.name} poll error`, String(e)); }
        await new Promise((r) => setTimeout(r, CARD_MS).unref());
      }
      log(`${w.name} over`);
      cards.delete(id);
    })();
  }
}

// ─── A fighter's page (the Stats tab: their record and last fights) ─────────────────────────────
/** A fighter's record, wins and losses by how, and their last five fights. */
export async function fighterPage(athleteId: string): Promise<StatsPage> {
  const key = playerKey('ufc', athleteId);
  const [records, overview] = await Promise.all([
    get(`${urls.mmaAthlete(athleteId)}/records`).catch(() => null),
    get(urls.athleteOverview('ufc', athleteId)).catch(() => null),
  ]);
  const r = records?.items?.find((x: any) => x.name === 'overall') ?? records?.items?.[0];
  const v = (n: string) => Number(r?.stats?.find((s: any) => s.name === n)?.value ?? 0);
  const wins = v('wins'), losses = v('losses');
  const tile = (label: string, name: string, value: number, bad = false): StatTile => ({ label, name, value: String(value), ...(bad && value > 0 ? { bad } : {}) });
  const tiles: StatTile[] = r ? [
    tile('W', 'Wins', wins), tile('L', 'Losses', losses, true),
    tile('KO W', 'Wins by KO/TKO', v('tkos')), tile('SUB W', 'Wins by submission', v('submissions')),
    tile('KO L', 'Knocked out', v('tkoLosses'), true), tile('SUB L', 'Submitted', v('submissionLosses'), true),
  ] : [];
  // The last five fights: ESPN's ids ("s:3301~l:3321~e:600061182~c:401907089"), each read for who and how.
  const ids: [string, string][] = (overview?.fightHistory ?? []).slice(0, 5).map((u: string) => [u.match(/~e:(\d+)/)?.[1], u.match(/~c:(\d+)/)?.[1]]).filter(([e, c]: any) => e && c);
  const recent = (await Promise.all(ids.map(async ([e, c]): Promise<GameLine | null> => {
    const fight = await get(urls.ufcFight(e, c)).catch(() => null);
    if (!fight?.competitors) return null;
    const me = fight.competitors.find((x: any) => String(x.id) === athleteId), them = fight.competitors.find((x: any) => String(x.id) !== athleteId);
    const status = await get(`${urls.ufcFight(e, c)}/status`).catch(() => null);
    const res = resultOf(status);
    const opp = them ? (catalog.playerByEspn('ufc', String(them.id))?.name ?? (await get(them.athlete?.$ref).catch(() => null))?.displayName ?? '?') : '?';
    return {
      id: c, date: Date.parse(fight.date ?? '') || 0, home: true, opponent: opp, result: me?.winner === true ? 'W' : me?.winner === false ? 'L' : 'D',
      score: res ? `${status?.result?.shortDisplayName ?? res.display}${/decision/.test(res.name) ? '' : ` R${res.period}`}` : '',
      ...(res?.desc ? { line: res.desc } : {}),
    };
  }))).filter((g): g is GameLine => !!g);
  return { key, kind: 'player', league: 'ufc', ...(r ? { record: { overall: String(r.summary ?? `${wins}-${losses}`), splits: [] } } : {}), groups: tiles.length ? [{ title: 'Record', tiles }] : [], recent, next: null };
}

// ─── Running ──────────────────────────────────────────────────────────────────────────────────
export function startUfc(every: (ms: number, fn: () => Promise<void>) => () => void) {
  return every(SCAN_MS, scanUfc);
}

export const ufcStatus = () => [...cards.values()].map((w) => ({ league: 'ufc', card: w.name }));
