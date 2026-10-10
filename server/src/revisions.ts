import { catalog } from './catalog.ts';
import { TEAMS_ONLY, teamKey } from './leagues.ts';
import { PLAYER_DETECTORS, bundleByPlay, nflDriveEvents, ruled, scoreLine, wipedOutLine, type Detected, type GameCtx, type NPlay } from './detectors.ts';

/**
 * Football: ESPN changes a play after it first posts it, and the game tracker sends a play's alerts the moment it
 * first sees it (they stay that fast: nothing waits for a review). October 10 2026's twelve noon college games had
 * 49 plays edited in place (about 30 gained a flag; an interception became roughing the passer, a lost fumble a face
 * mask, an incompletion an interception), 31 taken out or re-posted under a new id (touchdowns, a fumble and an
 * interception overturned on review; the same touchdown posted three times), and drives whose result changed after
 * they ended. So for REVISE_MS each play keeps the alerts it sent, and each read compares them with the play now:
 *  - an alert the play no longer has gets a line on it, with no push ("Wiped out by a penalty on Indiana: Roughing
 *    The Passer."), never a second notification;
 *  - an alert it has now and didn't goes out (the flag added later, the incompletion that became an interception);
 *  - a play re-posted under a new id at the same spot (period, start, player) is that play, revised, not a new one;
 *  - a play gone from the feed for GONE_MS (one read can come back short) has its alerts taken back;
 *  - a finished drive's result the same way (three-and-out, turned over on downs, the red zone).
 * Scores are the tracker's (live.ts): it takes one back only when ESPN's plays and header agree it's gone, and asks
 * this which plays' score alerts that was (`takeBack`).
 */

/** How long after we first see a play or a drive's result ESPN's changes to it are news. */
export const REVISE_MS = 15 * 60_000;
/** A play missing from the feed this long is gone. */
export const GONE_MS = 30_000;

type Side = 'home' | 'away';
/** An alert's kind: its type and who it's about. An edit's alerts keep their ids; a re-post's have new ones, the same kinds. */
const kindOf = (e: Detected) => `${e.type}|${e.targetKey}`;
/** Alerts by kind, the first of each (a play with two flags on a team is that team's first: publish keeps the first of an id). */
const byKind = (es: Detected[]) => { const m = new Map<string, Detected>(); for (const e of es) if (!m.has(kindOf(e))) m.set(kindOf(e), e); return m; };
/** Counted as the plays come in, so never re-run on a new version nor taken back: the starting quarterback pulled. */
const ONCE = /qb[._]pulled$/;
/** What a play says, for noticing that ESPN changed it. */
const sigOf = (p: NPlay) => JSON.stringify([p.type, p.text, p.scoring, p.home, p.away, p.teamId, p.endTeamId, p.participants]);
/** When in the period a play started: the "(12:21)" its text opens with, else its clock. */
const startOf = (p: NPlay) => { const m = p.text.match(/^\((\d+):(\d+)\)/); return m ? Number(m[1]) * 60 + Number(m[2]) : p.clockSec; };
/** The player a play is about: the first its text names ("#3 G.Lopez", "P.Mahomes"). */
const actorOf = (p: NPlay) => p.text.replace(/^\(\d+:\d+\)\s*/, '').match(/(?:#\d+ )?\b([A-Z][A-Za-z]{0,2}\.\s?[A-Z][\w'.-]+)/)?.[1];

/**
 * The same play, re-posted: the same period, a start within 10 seconds, the same player (or, naming none, the same
 * type). A touchdown overturned on review comes back as "(12:21) … #3 G.Lopez pass complete … for 18 yards to the
 * NCSU08 … The previous play is under automatic review"; one re-posted as is, "(00:01) #20 J.Roberts rush … TOUCHDOWN"
 * then "#20 J.Roberts rush … TOUCHDOWN, clock 00:00 … kick attempt good".
 */
export function samePlay(a: NPlay, b: NPlay): boolean {
  const [x, y] = [startOf(a), startOf(b)];
  if (a.periodNum !== b.periodNum || x == null || y == null || Math.abs(x - y) > 10) return false;
  const who = actorOf(a);
  return who ? who === actorOf(b) : !actorOf(b) && a.type === b.type;
}

const REVIEW = /\bunder (?:automatic )?review\b|\breplay official\b|\b(?:call )?(?:overturned|reversed)\b/i;
/** Why a play's alert no longer holds, from the play as it is now (none: ESPN took it out). */
export function changeLine(g: Pick<GameCtx, 'league' | 'homeId' | 'awayId'>, now: NPlay | null): string {
  if (!now) return 'ESPN has since taken this play back.';
  if (/\bno play\b/i.test(ruled(now.text))) return wipedOutLine(g, ruled(now.text));
  if (REVIEW.test(now.text)) return 'Overturned on review.';
  return now.type ? `ESPN has since changed this play to ${/^[aeiou]/i.test(now.type) ? 'an' : 'a'} ${now.type.toLowerCase()}.` : 'ESPN has since changed this play.';
}

/** The line on a score's alerts taken back when the side scores on that drive after all (`p`: that play). */
export function againLine(g: GameCtx, side: 'home' | 'away', p: Pick<NPlay, 'home' | 'away'>): string {
  const name = catalog.teamByEspn(g.league, side === 'home' ? g.homeId : g.awayId)?.shortName ?? 'They';
  return `Then ${TEAMS_ONLY.has(g.league) || name === 'They' ? name : `the ${name}`} scored on the same drive: ${scoreLine(g, p)}.`;
}

interface PlayEntry {
  play: NPlay;            // as last read (a re-post's version once it has one)
  sig: string;
  firstAt: number;
  history: boolean;       // seen when the tracker attached: never alerted, never revised
  header?: boolean;       // the header's score before the play was posted (live.ts): no play to read
  alerts: Map<string, Detected>; // its play alerts still standing, by kind
  dropped: Map<string, Detected>; // its play alerts taken back (a line said so), by kind
  scores: Detected[];     // its score alerts still standing (teamScoreEvents)
  points: Partial<Record<Side, number>>; // each side's score its score alerts announced
  missingSince?: number;
  gone?: boolean;
  back?: boolean;         // gone, and in the feed again (as it was or re-posted): read again
}

export interface Revision { fresh: Detected[]; lines: Detected[] }

export class PlayLedger {
  private plays = new Map<string, PlayEntry>(); // by the play's id now (a re-post moves it)
  private drives = new Map<string, { sig: string; firstAt: number; history: boolean; alerts: Map<string, Detected> }>();
  private n = 0;
  private readonly g: GameCtx;
  private readonly log: (msg: string) => void;

  constructor(g: GameCtx, log: (msg: string) => void) { this.g = g; this.log = log; }

  /** The detectors that only read the play, on a version of it (the quarterback pulled counts passes: never again). */
  private detect(p: NPlay): Detected[] {
    return PLAYER_DETECTORS[this.g.league]({ ...this.g, qbPulled: new Set([this.g.homeId, this.g.awayId]) }, p).filter((e) => !ONCE.test(e.type));
  }

  /**
   * Lines on alerts that went out, for the devices that got them (as their alert or a line on another of their
   * moment's), with no push: publish() adds a moment's `foldOnly` fact to the alert each device already has for it.
   * (Every football alert has a moment: bundleByPlay. One without would go out as an alert of its own: none.)
   */
  linesOn(es: Detected[], line: string): Detected[] {
    return es.filter((e) => e.moment).map((e) => ({ id: `${e.id}:changed:${++this.n}`, type: e.type, ...(e.aliases ? { aliases: e.aliases } : {}), targetKey: e.targetKey,
      title: line, body: e.body, at: e.at, meta: { ...e.meta, changed: true }, moment: e.moment, fold: line, foldOnly: true }));
  }

  /** A play seen for the first time, and the alerts it sent. */
  add(p: NPlay, alerts: Detected[], o: { history: boolean; header?: boolean }, now: number) {
    this.plays.set(p.id, { play: p, sig: sigOf(p), firstAt: now, history: o.history, ...(o.header ? { header: true } : {}), alerts: byKind(bundleByPlay(alerts)), dropped: new Map(), scores: [], points: {} });
  }

  get(id: string) { return this.plays.get(id); }

  /** A play's score alerts (live.ts takes them back with the score: takeBack). */
  addScores(playId: string, events: Detected[]) {
    const x = this.plays.get(playId);
    if (!x) return;
    for (const e of bundleByPlay(events)) {
      const side = this.scorer(e);
      x.scores.push(e);
      x.points[side] = Math.max(x.points[side] ?? 0, x.play[side]);
    }
  }

  /** Before a read's plays are gone through: which of the plays we know it doesn't have. One gone that's back is read again. */
  read(ids: Set<string>, now: number) {
    for (const [id, x] of this.plays) {
      if (x.header) continue;
      if (!ids.has(id)) { x.missingSince ??= now; continue; }
      if (x.gone) { x.back = true; x.sig = ''; }
      x.missingSince = undefined;
      x.gone = false;
    }
  }

  /**
   * A play seen for the first time that is one ESPN took out of the feed and re-posted under a new id: its entry,
   * moved to the new id, to revise with this version (`revise`). Undefined: a new play.
   */
  repost(p: NPlay, now: number): PlayEntry | undefined {
    let best: [string, PlayEntry] | undefined;
    for (const [id, x] of this.plays) {
      if (x.missingSince == null || x.header || now - x.missingSince > REVISE_MS || !samePlay(x.play, p)) continue;
      if (!best || Math.abs(startOf(x.play)! - startOf(p)!) < Math.abs(startOf(best[1].play)! - startOf(p)!)) best = [id, x];
    }
    if (!best) return undefined;
    const [id, x] = best;
    this.plays.delete(id);
    this.plays.set(p.id, x);
    if (x.gone) x.back = true;
    x.missingSince = undefined;
    x.gone = false;
    if (!x.history) x.firstAt = now; // posted again: its changes are news for REVISE_MS from now
    this.log(`play ${id} re-posted as ${p.id}`);
    return x;
  }

  /**
   * A play's alerts against a new version of it (null: ESPN took it out): the ones it no longer has get a line
   * (`lines`), the ones it has now go out (`fresh`). One taken back that it has again gets a line, never a second
   * alert (an interception wiped out by pass interference, then not: the flag overturned on review, Browns at
   * Steelers, 2026; a play gone a while, or re-posted). Nothing for history, or once REVISE_MS have passed.
   */
  revise(x: PlayEntry, p: NPlay | null, now: number): Revision {
    const was = x.play, back = x.back;
    x.back = false;
    if (p) { x.play = p; x.sig = sigOf(p); }
    if (x.history || now - x.firstAt > REVISE_MS) return { fresh: [], lines: [] };
    const want = byKind(bundleByPlay(p ? this.detect(p) : []));
    const why = changeLine(this.g, p), lines: Detected[] = [], fresh: Detected[] = [], again: Detected[] = [];
    for (const [k, e] of x.alerts) {
      if (want.has(k) || ONCE.test(e.type)) continue;
      x.alerts.delete(k);
      x.dropped.set(k, e);
      lines.push(...this.linesOn([e], why));
    }
    for (const [k, e] of want) {
      if (x.alerts.has(k)) continue;
      const sent = x.dropped.get(k);
      if (sent) { x.dropped.delete(k); x.alerts.set(k, sent); again.push(sent); } else { x.alerts.set(k, e); fresh.push(e); }
    }
    const restoredLine = back ? 'ESPN has since put this play back.' : p && REVIEW.test(p.text) ? 'Overturned on review: it stands.' : 'ESPN has since changed this play back.';
    if (lines.length || fresh.length || again.length) {
      const what = [...lines.map((e) => `took back ${e.type} → ${e.targetKey}`), ...fresh.map((e) => `new ${e.type} → ${e.targetKey}`), ...again.map((e) => `${e.type} → ${e.targetKey} stands again`)].join(', ');
      this.log(`play ${was.id}${p && p.id !== was.id ? ` (now ${p.id})` : ''} changed: ${what}${lines.length ? ` (${why})` : ''}${again.length ? ` (${restoredLine})` : ''}`);
    }
    lines.push(...this.linesOn(again, restoredLine));
    return { fresh, lines };
  }

  /** A play already seen, as read now: revised if ESPN changed it. */
  changed(p: NPlay, now: number): Revision | null {
    const x = this.plays.get(p.id);
    if (!x || x.sig === sigOf(p)) return null;
    return this.revise(x, p, now);
  }

  /** After a read: a play missing for GONE_MS is gone (unless it's re-posted later), its alerts taken back. */
  sweep(now: number): Detected[] {
    const lines: Detected[] = [];
    for (const x of this.plays.values()) {
      if (x.missingSince == null || x.gone || now - x.missingSince < GONE_MS) continue;
      x.gone = true;
      lines.push(...this.revise(x, null, now).lines);
    }
    return lines;
  }

  /** A play's points still on the board at `to`: it's in the feed and still scores them (or it's the header's). */
  private stands(x: PlayEntry, side: Side, to: number) { return x.play[side] <= to && (x.header || (x.missingSince == null && x.play.scoring)); }
  /** The team a side's score alerts are about: the one it scored on. */
  private scoredOn(side: Side) { return teamKey(this.g.league, side === 'home' ? this.g.awayId : this.g.homeId); }
  /** The side that scored, from a score alert (it's about the team scored on). */
  scorer(e: Detected): Side { return e.targetKey === teamKey(this.g.league, this.g.homeId) ? 'away' : 'home'; }
  /** A play with `side`'s score alerts that has gone missing but isn't gone yet: wait for it (a re-post says why). */
  pending(side: Side, to: number): boolean {
    return [...this.plays.values()].some((x) => !x.gone && x.missingSince != null && !this.stands(x, side, to) && x.scores.some((e) => e.targetKey === this.scoredOn(side)));
  }

  /**
   * `side`'s score went back down to `to`: the score alerts of the plays that no longer have their points (not in the
   * feed, not a scoring play now, or above `to`) get a line. Returns the lines, the alerts, and where the score was
   * (its drive and period), for a score again on that drive (live.ts).
   */
  takeBack(side: Side, to: number): { lines: Detected[]; alerts: Detected[]; drive?: string; period?: number } {
    const on = this.scoredOn(side); // the team it was scored on
    const out: { lines: Detected[]; alerts: Detected[]; drive?: string; period?: number } = { lines: [], alerts: [] };
    for (const x of this.plays.values()) {
      const mine = x.scores.filter((e) => e.targetKey === on);
      if (!mine.length) continue;
      if (this.stands(x, side, to)) {
        // Its points were over: ESPN counted a touchdown called back in the running score for a while ("Northwestern
        // scored 12", 38 to 50, then 45: Ball State at Northwestern, October 10 2026).
        if ((x.points[side] ?? 0) > x.play[side]) {
          const line = `ESPN has since corrected the score: ${scoreLine(this.g, x.play)}.`;
          x.points[side] = x.play[side];
          out.lines.push(...this.linesOn(mine, line));
          this.log(`score corrected: ${mine.map((e) => e.title).join('; ')} (${line})`);
        }
        continue;
      }
      x.scores = x.scores.filter((e) => e.targetKey !== on);
      const why = x.header ? 'ESPN has since taken this score back.' : changeLine(this.g, x.missingSince != null ? null : x.play);
      out.lines.push(...this.linesOn(mine, why));
      out.alerts.push(...mine);
      Object.assign(out, { drive: x.play.driveId, period: x.play.periodNum });
      this.log(`score taken back: ${mine.map((e) => e.title).join('; ')} (${why})`);
    }
    return out;
  }

  /**
   * `side`'s score still `to` on the board, but the play its alerts are on doesn't have it any more: a touchdown
   * overturned at the 1 and scored on the next snap, the header never down in between (South Carolina at Florida,
   * October 10 2026). When a later scoring play on that drive has those points, the alerts get a line ("Overturned on
   * review. Then South Carolina scored on the same drive: SC 30, FLA 13.") and are that play's now.
   */
  carry(side: Side, to: number): Detected[] {
    const on = this.scoredOn(side), out: Detected[] = [];
    for (const x of this.plays.values()) {
      const mine = x.scores.filter((e) => e.targetKey === on);
      if (!mine.length || this.stands(x, side, to) || (x.missingSince != null && !x.gone)) continue;
      const pts = x.points[side] ?? Infinity;
      const y = [...this.plays.values()].find((z) => z !== x && !z.header && z.missingSince == null && z.play.scoring
        && z.play[side] >= pts && z.play[side] <= to && !z.scores.some((e) => e.targetKey === on)
        && (x.play.driveId && z.play.driveId ? x.play.driveId === z.play.driveId : x.play.periodNum === z.play.periodNum));
      if (!y) continue;
      x.scores = x.scores.filter((e) => e.targetKey !== on);
      y.scores.push(...mine);
      y.points[side] = Math.max(y.points[side] ?? 0, y.play[side]);
      const line = `${changeLine(this.g, x.missingSince != null ? null : x.play)} ${againLine(this.g, side, y.play)}`;
      out.push(...this.linesOn(mine, line));
      this.log(`score moved from play ${x.play.id} to ${y.play.id} on its drive: ${line}`);
    }
    return out;
  }

  /**
   * The summary's finished drives as read now. A new one's alerts go out (not on the first read: those drives are
   * history); one whose result, length or plays changed within REVISE_MS is revised like a play.
   */
  drivesRead(previous: any[], first: boolean, now: number): Revision {
    const fresh: Detected[] = [], lines: Detected[] = [];
    for (const d of previous) {
      if (!d?.result) continue;
      const id = String(d.id), sig = JSON.stringify([d.result, d.offensivePlays, d.yards, (d.plays ?? []).length]);
      const x = this.drives.get(id);
      if (!x) {
        const es = first ? [] : bundleByPlay(nflDriveEvents(this.g, d));
        this.drives.set(id, { sig, firstAt: now, history: first, alerts: byKind(es) });
        fresh.push(...es);
        continue;
      }
      if (x.sig === sig) continue;
      x.sig = sig;
      if (x.history || now - x.firstAt > REVISE_MS) continue;
      const want = byKind(bundleByPlay(nflDriveEvents(this.g, d)));
      const why = `ESPN has since changed how the drive ended: ${d.displayResult ?? d.result}.`;
      const off = [...x.alerts].filter(([k]) => !want.has(k)), on = [...want].filter(([k]) => !x.alerts.has(k));
      for (const [k, e] of off) { x.alerts.delete(k); lines.push(...this.linesOn([e], why)); }
      for (const [k, e] of on) { x.alerts.set(k, e); fresh.push(e); }
      if (off.length || on.length) this.log(`drive ${id} changed (${d.result}): ${[...off.map(([, e]) => `took back ${e.type}`), ...on.map(([, e]) => `new ${e.type}`)].join(', ')}`);
    }
    return { fresh, lines };
  }
}
