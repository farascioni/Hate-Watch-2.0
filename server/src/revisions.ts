import { createHash } from 'node:crypto';
import { catalog } from './catalog.ts';
import { BASKETBALL, TEAMS_ONLY, teamKey } from './leagues.ts';
import { PLAYER_DETECTORS, bundleByPlay, nflDriveEvents, observePlay, ruled, scoreLine, unobservePlay, wipedOutLine, type Detected, type GameCtx, type NPlay } from './detectors.ts';

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
 *
 * Basketball (the NBA and the WNBA) uses the same ledger for the same reason: ESPN posts a play half-finished and edits
 * it (October 11 2026's three preseason games: 35%, 49% and 39% of their plays). A shot is first typed "No Shot
 * (Default Shot)" and typed minutes later; a free throw comes with no shooter, then with one, or as "misses" and is
 * flipped to "makes"; a block names the wrong shooter for 4 seconds; a foul, shot or turnover is taken out and
 * re-posted under a new id. So a changed play is judged again on its latest version: a player's alert the play no
 * longer has gets a line (no push), the right player's alert goes out, a re-post is the same play, and a play ESPN
 * took out has its alerts taken back. A play with no shooter yet alerts nothing until ESPN names one. Fouls are
 * recounted with each version (`unobservePlay`, `observePlay`), so fouling out stays right.
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
/** Basketball: fouling out replaces the foul's alert and can't be judged twice (the foul is counted by then): never taken back. */
const FOULED_OUT = /\.fouled_out$/;
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
export function samePlay(a: NPlay, b: NPlay, basketball = false): boolean {
  const [x, y] = [startOf(a), startOf(b)];
  if (a.periodNum !== b.periodNum || x == null || y == null || Math.abs(x - y) > 10) return false;
  if (basketball) {
    // The same player (the first ESPN lists: the shooter, the fouler, the one who turned it over) doing the same kind of
    // thing: the foul at 6:06 posted again at 6:06, the three at 11:24 and 11:26 whose distance and type ESPN fixed.
    const [who, other] = [a.participants[0]?.id, b.participants[0]?.id];
    return (who ? who === other : !other) && playKind(a) === playKind(b) && (!!who || a.type === b.type);
  }
  const who = actorOf(a);
  return who ? who === actorOf(b) : !actorOf(b) && a.type === b.type;
}
/** What a basketball play is, for telling a re-post from another play at the same moment (the 3 free throws of a trip share a clock). */
const playKind = (p: NPlay) => /free throw/i.test(p.type) ? `ft ${p.type}` : p.shooting ? 'shot' : /turnover|traveling/i.test(p.type) ? 'turnover' : /foul/i.test(p.type) ? 'foul' : p.type;

const REVIEW = /\bunder (?:automatic )?review\b|\breplay official\b|\b(?:call )?(?:overturned|reversed)\b/i;
/** Alerts about a flag (a player's, a college team's): what changes is the flag, not the play. */
const FLAG = /^(?:nfl\.penalty|cfb\.team\.penalty)$/;
/** Why a play's alert no longer holds, from the play as it is now (none: ESPN took it out). */
export function changeLine(g: Pick<GameCtx, 'league' | 'homeId' | 'awayId'>, now: NPlay | null): string {
  if (!now) return BASKETBALL.has(g.league) ? 'ESPN has since taken this play out.' : 'ESPN has since taken this play back.';
  if (/\bno play\b/i.test(ruled(now.text))) return wipedOutLine(g, ruled(now.text));
  if (REVIEW.test(now.text)) return 'Overturned on review.';
  if (BASKETBALL.has(g.league)) return 'ESPN has since changed this play.';
  return now.type ? `ESPN has since changed this play to ${plainType(now.type)}.` : 'ESPN has since changed this play.';
}

/** ESPN's football play types in plain words ("a fumble recovery (own)" read like a database field). */
const PLAIN: [RegExp, string][] = [
  [/^Fumble Recovery \(Own\)/i, 'a fumble its own team recovered'],
  [/^Fumble Recovery \(Opp/i, 'a fumble the other team recovered'],
  [/^Sack Opp/i, 'a strip-sack the defense recovered'],
  [/^Sack/i, 'a sack'],
  [/^(?:Pass )?Interception/i, 'an interception'],
  [/^Muffed Punt Recovery \(Opp/i, 'a muffed punt the kicking team recovered'],
  [/^Pass Reception/i, 'a catch'],
  [/^Pass Incompletion/i, 'an incompletion'],
  [/^Rush(?:ing)?$/i, 'a run'],
  [/^Rushing Touchdown/i, 'a rushing touchdown'],
  [/^Passing Touchdown/i, 'a passing touchdown'],
  [/^Punt$/i, 'a punt'],
  [/^Kickoff/i, 'a kickoff'],
  [/^Penalty$/i, 'a penalty'],
];
export function plainType(type: string): string {
  return PLAIN.find(([re]) => re.test(type))?.[1] ?? `${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${type.toLowerCase()}`;
}

/** A name's last word, for matching "M.Crosby", "Mi.Wilson", "C.Van Lanen" with "Maxx Crosby", "Mack Wilson Sr.". */
const surname = (s: string) => s.replace(/\b(?:jr|sr|ii|iii|iv)\b\.?/gi, '').replace(/[^\p{L}' -]/gu, '').trim().split(/\s+/).at(-1)?.toLowerCase();
const letters = (s: string) => s.replace(/[^\p{L}]/gu, '').toLowerCase();
/** ESPN's "M.Crosby" / "Mi.Wilson" / "C.Van Lanen" is the player: his first name starts with the initial(s) and his last name is the surname. */
function isNamed(playerKey: string, espnName: string): boolean {
  const name = catalog.player(playerKey)?.name;
  if (!name) return false;
  const initial = letters(espnName.split('.')[0]), last = surname(espnName.replace(/^[^.]*\./, ''));
  return !!last && last === surname(name) && letters(name.split(/\s+/)[0]).startsWith(initial);
}
/**
 * The player's flag is still in the call that stands (the text after a "REVERSED."; "PENALTY on LV-M.Crosby,
 * Unnecessary Roughness, 15 yards, enforced between downs."; ESPN writes a declined one "Penalty on …, declined"). ESPN
 * drops or relabels the flagged player in the play's data a read later (Crosby became "other", Patterson was dropped)
 * while the text keeps the flag: it stands.
 */
function flagStands(p: NPlay, playerKey: string): boolean {
  return [...ruled(p.text).matchAll(/PENALTY on [A-Z]{2,3}-([^,]+),([^]*?)(?=PENALTY on |$)/g)].some((m) => !/declined/i.test(m[2]) && isNamed(playerKey, m[1]));
}
/** ESPN now calls this player's flag declined ("Penalty on DEN-Q.Robinson, Defensive Offside, declined."). */
function flagDeclined(p: NPlay, playerKey: string): boolean {
  return [...ruled(p.text).matchAll(/Penalty on [A-Z]{2,3}-([^,]+),([^]*?)(?=Penalty on |PENALTY on |$)/g)].some((m) => /declined/i.test(m[2]) && isNamed(playerKey, m[1]));
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
   * A line's id is its alert's id and its own words (hashed), the same in every tracker: a counter started over with a
   * new tracker (a game followed again) and could reuse a stored id, dropping a new line. The same words on the same
   * alert are the same fact, and a feed row shows a line once anyway (addLateLine).
   */
  linesOn(es: Detected[], line: string, alt?: string): Detected[] {
    const key = createHash('sha256').update(line).digest('base64url').slice(0, 10);
    return es.filter((e) => e.moment).map((e) => ({ id: `${e.id}:changed:${key}`, type: e.type, ...(e.aliases ? { aliases: e.aliases } : {}), targetKey: e.targetKey,
      title: line, body: e.body, at: e.at, meta: { ...e.meta, changed: true }, moment: e.moment, fold: line, foldOnly: true, ...(alt ? { alt } : {}) }));
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
      if (x.missingSince == null || x.header || now - x.missingSince > REVISE_MS || !samePlay(x.play, p, BASKETBALL.has(this.g.league))) continue;
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
   * The line on an alert (not a flag's) the play no longer has, when the play being what it is says more than
   * `changeLine`: a lost fumble that turns out recovered by its own team ("ESPN has since corrected it: the Browns kept
   * the ball.", Browns at Jets, October 11 2026), a quarterback's delay of game that was the punt or field goal team's.
   */
  private goneLine(e: Detected, p: NPlay, want: Map<string, Detected>): string | undefined {
    if (BASKETBALL.has(this.g.league)) return this.basketballLine(e, p, want);
    if (/^(?:nfl|cfb\.team)\.fumble_lost$/.test(e.type) && [...want.values()].some((f) => f.targetKey === e.targetKey && /^(?:nfl|cfb\.team)\.fumble$/.test(f.type))) {
      const team = e.targetKey.startsWith('player:') ? catalog.player(e.targetKey)?.teamKey : e.targetKey;
      const name = team ? catalog.team(team)?.shortName : undefined;
      const who = name ? (TEAMS_ONLY.has(this.g.league) ? name : `the ${name}`) : 'they';
      return REVIEW.test(p.text) ? `Overturned on review: ${who} kept the ball.` : `ESPN has since corrected it: ${who} kept the ball.`;
    }
    if (e.type === 'nfl.qb.delay_of_game') {
      const unit = /\(Punt formation\)/i.test(p.text) ? 'punt team' : /\(Field Goal formation\)/i.test(p.text) ? 'field goal unit' : undefined;
      if (unit) return `ESPN has since put this on the ${unit}.`;
    }
    return undefined;
  }

  /**
   * Basketball: why a player's alert no longer holds, from what the play's alerts are now: the free throw was made, the
   * shot was blocked, it's another player's, or nobody's (a team turnover).
   */
  private basketballLine(e: Detected, p: NPlay, want: Map<string, Detected>): string | undefined {
    const kind = e.type.replace(/^w?nba\./, '');
    const now = [...want.values()];
    const other = now.find((f) => f.type === e.type && f.targetKey !== e.targetKey);
    if (other) return `ESPN has since credited this play to ${catalog.player(other.targetKey)?.name ?? 'another player'}.`;
    if (kind === 'missed_free_throw' && /\bmakes\b/i.test(p.text)) return 'ESPN has since changed this: the free throw was made.';
    if (kind === 'missed_shot' && now.some((f) => /got_blocked$/.test(f.type))) return 'ESPN has since changed this: the shot was blocked.';
    if (kind === 'missed_shot' && /\bmakes\b/i.test(p.text)) return 'ESPN has since changed this: the shot went in.';
    if (kind === 'turnover' && !p.participants.length) return 'ESPN has since made this a team turnover.';
    return undefined;
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
    const stale = x.history || now - x.firstAt > REVISE_MS;
    // Basketball: the fouls, recounted around the judgment. The old version's foul stops counting first (a foul re-posted
    // under a new id is not a 6th), the new version is judged (its 6th foul is judged before it is counted), then counted.
    const basketball = BASKETBALL.has(this.g.league);
    if (basketball) unobservePlay(this.g, was);
    const want = stale ? new Map<string, Detected>() : byKind(bundleByPlay(p ? this.detect(p) : []));
    if (basketball && p) observePlay(this.g, p);
    if (stale) return { fresh: [], lines: [] };
    const why = changeLine(this.g, p), lines: Detected[] = [], fresh: Detected[] = [], again: Detected[] = [], gone: Detected[] = [];
    for (const [k, e] of x.alerts) {
      if (want.has(k) || ONCE.test(e.type) || FOULED_OUT.test(e.type)) continue;
      if (p && e.type === 'nfl.penalty' && flagStands(p, e.targetKey)) continue; // ESPN dropped his role, the flag stands
      x.alerts.delete(k);
      x.dropped.set(k, e);
      gone.push(e);
    }
    for (const [k, e] of want) {
      if (x.alerts.has(k)) continue;
      // Basketball: a foul whose 6th replaced it with "fouled out" is not sent again as a foul.
      if (/\.foul$/.test(e.type) && [...x.alerts.values()].some((f) => FOULED_OUT.test(f.type) && f.targetKey === e.targetKey)) continue;
      const sent = x.dropped.get(k);
      if (sent) { x.dropped.delete(k); x.alerts.set(k, sent); again.push(sent); } else { x.alerts.set(k, e); fresh.push(e); }
    }
    // A flag's alert taken back while its play stands: the flag moved to another player (a false start charged to
    // Hainsey 4 minutes after Van Lanen) or came off (a face mask picked up with the replay assist 12 s later: Eagles at
    // Jaguars, October 11 2026). Not the play's "Wiped out by a penalty" or "changed to a pass reception". A device with
    // the first player's alert gets the move as its line, not the new flag as a second one (`alt`: publish keeps one).
    const flags = [...want.values()].filter((e) => e.type === 'nfl.penalty');
    for (const e of gone) {
      if (!p || !FLAG.test(e.type)) { lines.push(...this.linesOn([e], p ? this.goneLine(e, p, want) ?? why : why)); continue; }
      // The flag became an ejection on the same play (a disqualification, a targeting call): the ejection's own line says so.
      if ([...want.values()].some((f) => f.targetKey === e.targetKey && /^(?:player\.ejected|cfb\.team\.ejection)$/.test(f.type))) continue;
      const to = e.type === 'nfl.penalty' ? flags.filter((f) => f.targetKey !== e.targetKey) : [];
      if (!to.length) { lines.push(...this.linesOn([e], REVIEW.test(p.text) ? 'Overturned on review.' : e.type === 'nfl.penalty' && flagDeclined(p, e.targetKey) ? 'ESPN has since declined this flag.' : 'ESPN has since taken the flag off.')); continue; }
      const alt = `flag-moved:${p.id}`;
      for (const f of to) f.alt = alt;
      lines.push(...this.linesOn([e], `ESPN has since charged this flag to ${to.map((f) => catalog.player(f.targetKey)?.name ?? 'another player').join(' and ')}.`, alt));
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
