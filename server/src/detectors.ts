import { athleteIdFromRef, teamIdFromRef } from './espn.ts';
import { catalog, normalize } from './catalog.ts';
import { BASKETBALL, FOOTBALL, LEAGUE_IDS, SOCCER, TEAMS_ONLY, footballType, playerKey, teamKey, type League } from './leagues.ts';

/** League-agnostic view of one play. */
export interface NPlay {
  id: string;              // identical across the site and core APIs
  type: string;            // ESPN type text, e.g. "Pass Interception Return", "Missed"
  typeSlug: string;        // ESPN type.type / abbreviation when present ("play-result", "shot-missed")
  text: string;
  teamId?: string;         // team credited with the play (batting team, shooting team, offense...)
  endTeamId?: string;      // team with the ball when the play ended (NFL: who recovered a kickoff)
  participants: { id: string; role?: string }[];
  scoring: boolean;
  scoreValue: number;
  home: number;
  away: number;
  at: number;              // epoch ms the play happened (ESPN wallclock), falls back to detection time
  shooting: boolean;
  penaltyMinutes?: number;
  outs?: number;           // MLB: outs in the half-inning after this play
  period?: { type: string; number: number }; // MLB: { type: 'Top' | 'Bottom' | 'Mid' | 'End', number }
  clock?: string;          // soccer: the minute, "57'" or "90'+4'"
  periodNum?: number;      // quarter, period or inning number (every league; MLB's half is in `period`)
  clockSec?: number;       // seconds left in the period (NBA, WNBA, NFL, NHL), from ESPN's game clock
  hits?: { home: number; away: number }; // MLB: each team's hits so far (the core feed only: the summary's plays don't say)
  strength?: string;       // NHL goals: "Even Strength", "Power Play", "Shorthanded", "Empty Net", "Penalty Shot"
  driveId?: string;        // football: the drive it's in (a score taken back and scored again on that drive is one score: live.ts)
}

export interface GameCtx {
  league: League;
  gameId: string;
  homeId: string;
  awayId: string;
  /** NHL and soccer: who is in goal for each team right now (teamId -> athleteId). Updated as plays stream in. */
  goalies: Map<string, string>;
  /** Soccer: red cards so far per team (teamId -> count), for "down to 10 men". */
  sentOff?: Record<string, number>;
  /** MLB: the latest at-bat result. Its onFirst/onSecond/onThird roles are the bases AFTER that play. */
  lastResult?: NPlay;
  /** MLB: the latest homer's at-bat, and how many in a row one pitcher had given up with it (2: back-to-back). */
  homerRun?: { id: string; n: number };
  /** MLB: who is on each base right now (role -> athleteId), from the latest full base-state snapshot. */
  bases?: Partial<Record<'onFirst' | 'onSecond' | 'onThird', string>>;
  /**
   * MLB: the current half-inning, for NOBLETIGER (bases loaded, nobody out, then no runs) and for
   * "opponent has runners in scoring position" (`risp`: the batting team has had one this half, first on
   * `rispPlay`; `loadedTold`: the bases loading since went on that alert), and "goes down in order" (`pas`:
   * each plate appearance's result; `reached`: anyone got on or scored).
   */
  half?: { key: string; loadedNoOuts: boolean; scoredSince: boolean; risp: boolean; rispPlay?: string; loadedTold?: boolean; pas: { id: string; text: string }[]; reached: boolean };
  /** NFL: each team's quarterback in the game right now (teamId -> athleteId), from the latest pass/sack. */
  qbs?: Record<string, string>;
  /** MLB: the latest pitch's call went to an ABS challenge (so the at-bat result's "challenged" text is that one). */
  lastPitchAbs?: boolean;
  /** Teams that have had their "blew a big lead" alert this game (teamScoreEvents): once each. */
  blewLead?: Set<string>;
  /** MLB: each batter's strikeouts so far this game (observePlay), for "struck out for the 3rd time". */
  ks?: Record<string, number>;
  /** MLB: each team's hits so far, from the core feed's plays (never guessed: unknown until one says). */
  hits?: { home: number; away: number };
  /** MLB: teams that have had their "being no-hit" alert this game. */
  noHit?: Set<string>;
  /** NBA, WNBA: each player's personal fouls so far (observePlay), for fouling out. */
  fouls?: Record<string, number>;
  foulKeys?: Set<string>; // basketball: each personal foul counted once (personalFoul)
  /** NBA, WNBA: points scored in a row against each side, for "on a 14-0 run" (teamScoreEvents). */
  run?: { home: number; away: number };
  /** NHL: each goalie's shots faced and goals allowed so far (observePlay), and the ones pulled. */
  goalieLine?: Record<string, { sa: number; ga: number }>;
  pulled?: Set<string>;
  /** NHL: the shootout has started. */
  shootout?: boolean;
  /** NFL: each team's starting QB, their pass attempts, and passes in a row by another QB (for a QB pulled). */
  qbStart?: Record<string, string>;
  qbAtt?: Record<string, number>;
  qbOther?: Record<string, { id: string; n: number }>;
  qbPulled?: Set<string>;
}

export interface Detected {
  id: string;              // deterministic dedupe key
  type: string;
  aliases?: string[];      // other pref toggles that also cover this event (HR allowed ⊂ runs allowed)
  /**
   * Skip this event for users who want this OTHER type: it describes the same moment more
   * specifically (a stranded-runners alert is `unless` the NOBLETIGER that covers that inning).
   */
  unless?: string;
  /**
   * Events with the same moment are one thing happening, alerted to different targets (a batter's
   * failed ABS challenge, and the batter's team's). Each device gets only the first of them it wants.
   */
  moment?: string;
  /**
   * Among a moment's alerts marked this way, a device gets the one about the target it followed first,
   * not the first in the list: tracking Gerrit Cole and then Aaron Judge, a Yankees loss is Cole's.
   */
  firstFollowed?: boolean;
  /**
   * A fact to add to another alert of the same moment instead of sending this one too: a device that
   * gets one of the moment's alerts first gets this sentence on it ("Lost as 78% favorites."). Alerts
   * without one are the same news about another target (a player's "their team lost"), and are dropped.
   */
  fold?: string;
  /** Only ever a line on another alert of its moment, never an alert of its own (a blown lead, at the final). */
  foldOnly?: boolean;
  /**
   * Alternatives within a moment: a device gets at most one alert or line from each group, the first it
   * wants. A team blowing a lead, falling behind and being scored on, on one play, are one group.
   */
  alt?: string;
  /**
   * A name for one line of a moment's alert, with the others of its kind: a device's alerts of the moment
   * marked this way (the one it gets, and those folded into it) are one line, "Yours: Alpine, George Russell."
   * (F1's start: one per constructor and driver in the session, one alert for a device.)
   */
  list?: { label: string; item: string };
  /**
   * A line on the device's latest alert about `targetKey` since `since` (of one of `types`)
   * instead of an alert of its own, when it has one; no push ("Down to 6th in the championship." on that
   * day's race alert). Without one, it's an alert as usual. `loss`: or the latest of team `targetKey`'s loss
   * alerts, whichever one the device got (LOSS_ABOUT: a standings drop after a loss is a line on it).
   */
  lateOn?: { targetKey: string; since: number; types: string[]; line: string; loss?: boolean };
  /**
   * MLB: a lost ABS challenge, held by the game tracker until the review is settled (holdAbs in live.ts):
   * the pitch's place in the game, its ESPN id without the 4-digit type that changes when a call is overturned.
   */
  absSlot?: string;
  targetKey: string;
  title: string;
  body: string;
  at: number;
  meta?: Record<string, unknown>;
}

// ─── Adapters ─────────────────────────────────────────────────────────────────────────────────
export function fromSitePlay(p: any): NPlay {
  return {
    id: String(p.id),
    type: String(p.type?.text ?? '').replace(/\n/g, ' '),
    typeSlug: String(p.type?.type ?? p.type?.abbreviation ?? ''),
    text: String(p.text ?? '').replace(/\n/g, ' '),
    teamId: p.team?.id,
    endTeamId: p.end?.team?.id != null ? String(p.end.team.id) : undefined,
    participants: (p.participants ?? []).map((x: any) => ({ id: String(x.athlete?.id), role: x.type })).filter((x: any) => x.id !== 'undefined'),
    scoring: !!p.scoringPlay,
    scoreValue: Number(p.scoreValue ?? 0),
    home: Number(p.homeScore ?? 0),
    away: Number(p.awayScore ?? 0),
    at: p.wallclock ? Date.parse(p.wallclock) : Date.now(),
    shooting: !!p.shootingPlay,
    penaltyMinutes: p.type?.penaltyMinutes ? Number(p.type.penaltyMinutes) : undefined,
    ...(p.strength?.text ? { strength: String(p.strength.text) } : {}),
    ...periodFields(p),
  };
}

/**
 * College football (TEAMS_ONLY): a game's plays from its summary's drives, in order, each once (a finished
 * drive's plays and the one under way, which can be in both as it ends), end-of-period markers last in their drive. A drive play's team is under `start`
 * (the side with the ball as it begins), where it ends under `end`; it names no players.
 */
export function fromDrivePlays(summary: any): NPlay[] {
  const seen = new Set<string>(), out: NPlay[] = [];
  // ESPN can list a drive's end-of-period marker first ("End of Game" at the top of the overtime drive that won
  // it, October 3 2026, South Carolina at Kentucky): it goes last, after the plays it ends.
  const marker = (p: any) => /^End (of )?(Game|Half|Period|Quarter|Regulation)$|^End of (\d|OT)/i.test(String(p?.type?.text ?? ''));
  for (const d of [...(summary?.drives?.previous ?? []), ...(summary?.drives?.current ? [summary.drives.current] : [])]) {
    const plays: any[] = d?.plays ?? [];
    for (const p of [...plays.filter((x) => !marker(x)), ...plays.filter(marker)]) {
      if (p?.id == null || seen.has(String(p.id))) continue;
      seen.add(String(p.id));
      out.push({ ...fromSitePlay({ ...p, team: p.start?.team ?? p.team, participants: [] }), ...(d?.id != null ? { driveId: String(d.id) } : {}) });
    }
  }
  return out;
}

function periodFields(p: any): Pick<NPlay, 'outs' | 'period' | 'periodNum' | 'clockSec'> {
  return {
    outs: p.outs != null ? Number(p.outs) : undefined,
    period: p.period?.type ? { type: String(p.period.type), number: Number(p.period.number ?? 0) } : undefined,
    periodNum: p.period?.number != null ? Number(p.period.number) : undefined,
    clockSec: clockSeconds(p.clock),
  };
}

/** Seconds left from ESPN's clock: the core API's `value`, or the display ("0:02.1", "1.0", "14:01"). */
export function clockSeconds(clock: any): number | undefined {
  if (typeof clock?.value === 'number') return clock.value;
  const m = String(clock?.displayValue ?? '').match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : undefined;
}

export function fromCorePlay(p: any): NPlay {
  return {
    id: String(p.id),
    type: String(p.type?.text ?? ''),
    typeSlug: String(p.type?.type ?? p.type?.abbreviation ?? ''),
    text: String(p.text ?? '').replace(/\n/g, ' '),
    teamId: teamIdFromRef(p.start?.team?.$ref ?? p.team?.$ref),
    endTeamId: teamIdFromRef(p.end?.team?.$ref),
    participants: (p.participants ?? []).map((x: any) => ({ id: athleteIdFromRef(x.athlete?.$ref) ?? '', role: x.type })).filter((x: any) => x.id),
    scoring: !!p.scoringPlay,
    scoreValue: Number(p.scoreValue ?? 0),
    home: Number(p.homeScore ?? 0),
    away: Number(p.awayScore ?? 0),
    at: p.wallclock ? Date.parse(p.wallclock) : Date.now(),
    shooting: !!p.shootingPlay,
    penaltyMinutes: p.type?.penaltyMinutes ? Number(p.type.penaltyMinutes) : p.penalty?.minutes ? Number(p.penalty.minutes) : undefined,
    ...(p.awayHits != null && p.homeHits != null ? { hits: { home: Number(p.homeHits), away: Number(p.awayHits) } } : {}),
    ...(p.strength?.text ? { strength: String(p.strength.text) } : {}),
    ...periodFields(p),
    ...(p.clock?.displayValue ? { clock: String(p.clock.displayValue) } : {}),
    ...driveOf(p.drive?.$ref),
  };
}
/** Football: the drive a core-API play is in, from its ref ("…/drives/40167178901"), when it has one. */
const driveOf = (ref: unknown) => { const id = String(ref ?? '').match(/\/drives\/(\d+)/)?.[1]; return id ? { driveId: id } : {}; };

/**
 * Soccer: the summary's key events (goals, cards, penalties, substitutions) as plays. ESPN leaves the
 * score off them, so it's counted here from the goals: each is the credited team's, and an own goal is
 * credited to the team it counts for. The text gets the minute in front ("57' Alexander Isak (Liverpool)
 * right footed shot…") and loses ESPN's "Goal! Bournemouth 0, Liverpool 1." (alerts add the score).
 * Roles: a goal's scorer then the assist, a substitution's player coming on then the one going off.
 */
export function fromKeyEvents(summary: any, homeId: string, awayId: string): NPlay[] {
  const score = { home: 0, away: 0 };
  return (summary?.keyEvents ?? []).map((k: any): NPlay => {
    const teamId = k.team?.id != null ? String(k.team.id) : undefined;
    const scoring = !!k.scoringPlay && !k.shootout;
    if (scoring && teamId === homeId) score.home++;
    if (scoring && teamId === awayId) score.away++;
    const type = String(k.type?.text ?? ''), slug = String(k.type?.type ?? '');
    const roles = slug === 'substitution' ? ['on', 'off'] : scoring ? ['scorer', 'assist'] : [];
    let said = String(k.text ?? '');
    if (/^Goal!/.test(said)) said = said.replace(/^Goal!\s.*?\d+,\s.*?\d+\.\s*/, '');
    if (/^own goal/i.test(type)) said = said.replace(/\s+[^.]*?\s\d+,\s[^.]*?\s\d+\.$/, ''); // "… Fulham 1, Manchester United 0."
    return {
      id: String(k.id), type, typeSlug: slug,
      text: [k.clock?.displayValue, said].filter(Boolean).join(' '),
      teamId,
      participants: (k.participants ?? []).map((x: any, i: number) => ({ id: String(x.athlete?.id), ...(roles[i] ? { role: roles[i] } : {}) }))
        .filter((x: { id: string }) => x.id !== 'undefined'),
      scoring,
      scoreValue: scoring ? 1 : 0,
      home: score.home,
      away: score.away,
      at: k.wallclock ? Date.parse(k.wallclock) : Date.now(),
      shooting: false,
      ...(k.clock?.displayValue ? { clock: String(k.clock.displayValue) } : {}),
    };
  });
}

/**
 * Soccer: fouls, handballs, penalties conceded and dives, from the summary's commentary. ESPN writes
 * each foul twice under one play id ("Foul by Kobbie Mainoo (Manchester United)." and "Josh King (Fulham)
 * wins a free kick…"); a foul in the box adds "Penalty conceded by …" / "… draws a foul in the penalty
 * area". The fouler is the one the text names, matched to the line-ups (commentary spells some names its
 * own way: "Abdul Fatawu" is "Fatawu Issahaku" there), because the play's participants can be stale: on
 * 2026-09-13 one said Maxim De Cuyper for "Foul by Chema Andrés", and ESPN's stats charged Andrés. A dive
 * ("… has gone down, but the referee deems it simulation.") has no play, and ESPN counts it as a foul.
 * Checked against ESPN's foulsCommitted for every player in five September 2026 matches.
 * `score` is the score now (commentary doesn't carry it).
 */
export function fromCommentary(summary: any, score: { home: number; away: number }): NPlay[] {
  const squad = (summary?.rosters ?? []).flatMap((r: any) => (r.roster ?? []).filter((x: any) => x.athlete?.id != null).map((x: any) => ({
    id: String(x.athlete.id), name: String(x.athlete.displayName ?? ''), teamId: String(r.team?.id), team: clubName(r.team?.displayName),
  })));
  /** "Abdul Fatawu", "Ipswich Town" → the player in the line-ups: same name, or the one on that team who shares part of it. */
  const find = (name?: string, team?: string) => {
    if (!name) return undefined;
    const n = normalize(name), words = n.split(' ').filter((w) => w.length >= 3);
    const side = squad.filter((x: any) => !team || x.team === clubName(team));
    const exact = side.filter((x: any) => normalize(x.name) === n);
    if (exact.length === 1) return exact[0];
    const near = side.filter((x: any) => normalize(x.name).split(' ').some((w) => words.includes(w)));
    return near.length === 1 ? near[0] : undefined;
  };
  const named = (t: string, lead: RegExp) => { const m = t.match(lead); return m ? find(m[1], m[2]) : undefined; };
  const BY = /^(?:foul|handball|hand ball|penalty conceded) by (.+?) \((.+?)\)/i;

  const plays = new Map<string, any[]>(), out: NPlay[] = [], order = new Map<string, number>(); // id → ESPN's commentary sequence
  let lastAt = 0;
  const push = (id: string, slug: string, type: string, said: string, clock: string, at: number, fouler?: { id: string; teamId: string }, fouled?: { id: string }) => out.push({
    id, type, typeSlug: slug, text: [clock, said].filter(Boolean).join(' '), teamId: fouler?.teamId,
    participants: [...(fouler ? [{ id: fouler.id, role: 'fouler' }] : []), ...(fouled ? [{ id: fouled.id, role: 'fouled' }] : [])],
    scoring: false, scoreValue: 0, home: score.home, away: score.away, at, shooting: false, ...(clock ? { clock } : {}),
  });
  for (const c of summary?.commentary ?? []) {
    if (c.play?.wallclock) lastAt = Date.parse(c.play.wallclock);
    const seq = Number(c.sequence ?? order.size);
    const dive = String(c.text ?? '').match(/^(.+?) \((.+?)\) has gone down, but the referee deems it simulation/i);
    if (dive) {
      const who = find(dive[1], dive[2]);
      const id = `dive:${c.time?.value ?? c.time?.displayValue}:${normalize(dive[1]).replace(/ /g, '-')}`;
      order.set(id, seq);
      push(id, 'simulation', 'Simulation', String(c.text), String(c.time?.displayValue ?? ''), lastAt || Date.now(), who);
      continue;
    }
    // A shot off the woodwork, and a goal ruled out by VAR, as their own plays (soccerCommentaryEvents).
    const said = String(c.text ?? ''), clock = String(c.time?.displayValue ?? '');
    const wood = /woodwork/i.test(String(c.play?.type?.text ?? '')) ? said.match(/^(.+?) \((.+?)\) hits the/) : null;
    const ruledOut = said.match(/^GOAL OVERTURNED BY VAR: (.+?) \((.+?)\) scores but the goal is ruled out/i);
    if ((wood || ruledOut) && c.play?.id != null) {
      const [, name, team] = (wood ?? ruledOut)!, who = find(name, team);
      const id = `${wood ? 'wood' : 'var'}:${c.play.id}`;
      order.set(id, seq);
      if (who) out.push({ id, type: wood ? 'Woodwork' : 'VAR No Goal', typeSlug: wood ? 'woodwork' : 'var-no-goal', text: [clock, said].filter(Boolean).join(' '), teamId: who.teamId,
        participants: [{ id: who.id, role: 'player' }], scoring: false, scoreValue: 0, home: score.home, away: score.away, at: c.play.wallclock ? Date.parse(c.play.wallclock) : lastAt || Date.now(), shooting: false, ...(clock ? { clock } : {}) });
      continue;
    }
    const slug = c.play?.type?.type;
    if (c.play?.id == null || (slug !== 'foul' && slug !== 'handball')) continue;
    plays.set(String(c.play.id), [...(plays.get(String(c.play.id)) ?? []), c]);
    if (!order.has(String(c.play.id))) order.set(String(c.play.id), seq);
  }
  for (const [id, lines] of plays) {
    const p = lines[0].play;
    const texts: string[] = lines.map((l: any) => String(l.text ?? ''));
    const [first, second] = (p.participants ?? []).map((x: any) => find(x.athlete?.displayName));
    const said = texts.find((t) => BY.test(t)) ?? texts[0];
    const fouler = named(said, BY) ?? first;
    const penalty = texts.some((t) => /\bpenalty conceded by\b|\bdraws a foul in the penalty area\b/i.test(t));
    const kind = penalty ? 'penalty-conceded' : String(p.type?.type ?? 'foul');
    push(id, kind, penalty ? 'Penalty Conceded' : kind === 'handball' ? 'Handball' : 'Foul', said, String(lines[0].time?.displayValue ?? p.clock?.displayValue ?? ''),
      p.wallclock ? Date.parse(p.wallclock) : Date.now(), fouler, second && second.id !== fouler?.id ? second : undefined);
  }
  return out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}
/** "Brighton and Hove Albion" and "Brighton & Hove Albion" are one club. */
const clubName = (name?: string) => normalize(String(name ?? '').replace(/&/g, ' and '));

/** Soccer: each side's goalkeeper on the pitch, from the summary's line-ups (teamId -> athleteId), once they're out. */
export function keepers(summary: any): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of summary?.rosters ?? []) {
    const gks = (r.roster ?? []).filter((x: any) => x.position?.abbreviation === 'G' && !x.subbedOut);
    const gk = gks.find((x: any) => x.subbedIn) ?? gks.find((x: any) => x.starter);
    if (gk?.athlete?.id != null && r.team?.id != null) out.set(String(r.team.id), String(gk.athlete.id));
  }
  return out;
}

/**
 * Merge two chronologically ordered play lists by id, keeping play order. Plays only in
 * `secondary` are placed right after the play that preceded them there. (ESPN's sequenceNumber
 * restarts every MLB at-bat, so sorting by it scrambles a baseball game.)
 */
export function mergePlays(primary: NPlay[], secondary: NPlay[]): NPlay[] {
  const out = [...primary];
  const ids = new Set(out.map((p) => p.id));
  let anchor = -1;
  for (const p of secondary) {
    if (ids.has(p.id)) {
      let j = anchor + 1;
      while (j < out.length && out[j].id !== p.id) j++;
      anchor = j < out.length ? j : out.findIndex((q) => q.id === p.id);
      continue;
    }
    out.splice(anchor + 1, 0, p);
    anchor++;
    ids.add(p.id);
  }
  return out;
}

/**
 * Passive game state that later plays depend on. Runs for EVERY play, including history
 * from before we attached to the game (which is never notified), so state is right from the start.
 */
export function observePlay(g: GameCtx, p: NPlay) {
  if (g.league === 'nhl') {
    const [saver] = p.participants.filter((x) => x.role === 'saver').map((x) => x.id);
    const conceding = p.teamId === g.homeId ? g.awayId : g.homeId;
    // Shots faced and goals allowed by whoever is in net (an empty-net goal is nobody's).
    const inNet = saver ?? (p.scoring && p.strength !== 'Empty Net' ? g.goalies.get(conceding) : undefined);
    if (inNet && p.teamId && (saver || p.scoring) && !g.shootout) {
      const line = ((g.goalieLine ??= {})[inNet] ??= { sa: 0, ga: 0 });
      line.sa++;
      if (p.scoring) line.ga++;
    }
    if (saver && p.teamId) g.goalies.set(conceding, saver);
    if (/start of shootout/i.test(p.text)) g.shootout = true;
  }
  if (BASKETBALL.has(g.league) && personalFoul(p)) {
    const actor = onTeam(g, p, p.teamId) ?? p.participants[0]?.id, key = `${actor}:${personalFoul(p)}`;
    if (actor && !g.foulKeys?.has(key)) { (g.foulKeys ??= new Set()).add(key); (g.fouls ??= {})[actor] = (g.fouls[actor] ?? 0) + 1; }
  }
  if (SOCCER.has(g.league) && p.teamId) {
    // Keepers start from the line-ups (keepers()); then a keeper comes on, or the one in goal is sent off.
    const [on] = role(p, 'on');
    if (p.typeSlug === 'substitution' && on && catalog.playerByEspn(g.league, on)?.position === 'G') g.goalies.set(p.teamId, on);
    if (/^red card/i.test(p.type)) {
      (g.sentOff ??= {})[p.teamId] = (g.sentOff[p.teamId] ?? 0) + 1;
      if (p.participants[0] && g.goalies.get(p.teamId) === p.participants[0].id) g.goalies.delete(p.teamId);
    }
  }
  // College football names no players: its passer is the play's text's ("#14 G.Stockton pass complete…").
  if (TEAMS_ONLY.has(g.league) && p.teamId && PASS_PLAY.test(p.type)) {
    const qb = passerIn(p.text);
    if (qb) {
      const start = ((g.qbStart ??= {})[p.teamId] ??= qb);
      (g.qbAtt ??= {})[qb] = (g.qbAtt[qb] ?? 0) + 1;
      const other = (g.qbOther ??= {})[p.teamId];
      g.qbOther[p.teamId] = qb === start ? { id: '', n: 0 } : { id: qb, n: other?.id === qb ? other.n + 1 : 1 };
    }
  }
  if (FOOTBALL.has(g.league) && p.teamId) {
    // Core plays' team is the offense. A trick-play pass by a non-QB doesn't change who is under center.
    const qb = p.participants.find((x) => x.role === 'passer')?.id;
    const position = qb && catalog.playerByEspn(g.league, qb)?.position;
    if (qb && (!position || position === 'QB')) {
      (g.qbs ??= {})[p.teamId] = qb;
      const start = ((g.qbStart ??= {})[p.teamId] ??= qb);
      (g.qbAtt ??= {})[qb] = (g.qbAtt[qb] ?? 0) + 1;
      const other = (g.qbOther ??= {})[p.teamId];
      g.qbOther[p.teamId] = qb === start ? { id: '', n: 0 } : { id: qb, n: other?.id === qb ? other.n + 1 : 1 };
    }
  }
  if (g.league === 'mlb') {
    trackHalfInning(g, p);
    if (p.hits) g.hits = p.hits;
    const [batter] = role(p, 'batter');
    if (p.typeSlug === 'play-result' && batter && /struck out/i.test(p.text)) (g.ks ??= {})[batter] = (g.ks[batter] ?? 0) + 1;
    if (p.typeSlug === 'play-result') g.lastResult = p;
    if (PITCH.test(p.text)) g.lastPitchAbs = ABS_PITCH.test(p.type);
    // Pitches and at-bat results list the batter plus every runner: a full snapshot of the bases.
    // Runner events (steals, pickoffs) list only the pitcher, so they must not clear the bases.
    if (p.participants.some((x) => x.role === 'batter')) {
      const at = (base: 'onFirst' | 'onSecond' | 'onThird') => p.participants.find((x) => x.role === base)?.id;
      g.bases = { onFirst: at('onFirst'), onSecond: at('onSecond'), onThird: at('onThird') };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────
const role = (p: NPlay, r: string) => p.participants.filter((x) => x.role === r).map((x) => x.id);
const nameOf = (lg: League, id: string) => catalog.playerByEspn(lg, id)?.name ?? 'Your tracked player';
const teamName = (lg: League, id: string) => catalog.teamByEspn(lg, id)?.shortName ?? 'Opponent';
const teamAbbrev = (lg: League, id: string) => catalog.teamByEspn(lg, id)?.abbrev ?? '???';
const playerTeamId = (lg: League, athleteId: string) => catalog.playerByEspn(lg, athleteId)?.teamKey.split(':')[2];

export function scoreLine(g: GameCtx, p: Pick<NPlay, 'home' | 'away'>) {
  return `${teamAbbrev(g.league, g.awayId)} ${p.away}, ${teamAbbrev(g.league, g.homeId)} ${p.home}`;
}

/** Participant whose catalog team matches the given team (NBA participants are unlabelled). */
function onTeam(g: GameCtx, p: NPlay, teamId: string | undefined) {
  return p.participants.find((x) => playerTeamId(g.league, x.id) === teamId)?.id;
}

/** Resolve "error by shortstop Smith" style text to an athlete on a given team by last name. */
function byLastName(g: GameCtx, teamId: string, lastName: string) {
  const target = normalize(lastName);
  const roster = catalog.roster(teamKey(g.league, teamId));
  const hits = roster.filter((pl) => normalize(pl.name).split(' ').slice(1).join(' ').endsWith(target));
  return hits.length === 1 ? hits[0].espnId : undefined;
}

function mk(g: GameCtx, p: NPlay, type: string, athleteId: string, title: string, extra: Partial<Detected> = {}): Detected {
  return {
    id: `${g.gameId}:${p.id}:${type}:${athleteId}`,
    type,
    targetKey: playerKey(g.league, athleteId),
    title,
    body: `${p.text} — ${scoreLine(g, p)}`,
    at: p.at,
    meta: { gameId: g.gameId, playId: p.id, athleteId },
    ...extra,
  };
}

/** One play's moment for one team: its alerts and its players' alerts are one alert for a device (bundleByPlay). */
export const playMoment = (gameId: string, playId: string, team: string) => `${gameId}:play:${playId}:${team}`;
/** An alert's title as a line on another alert: "Aaron Judge struck out swinging." (a closing emoji dropped). */
export const asLine = (title: string) => `${title.replace(/\s*(?:\p{Extended_Pictographic}\uFE0F?)+\s*$/u, '').replace(/[.!?]$/, '')}.`;

/**
 * A play's alerts about one team, and about that team's players, are one alert for a device that tracks
 * more than one of them: "Gerrit Cole gave up a solo homer", with "Rays scored 1 run to take the lead
 * over the Yankees." as a line, not two pushes. Alerts with a play and no moment of their own get that
 * play's moment for their team, and their title as the line. (Called on each poll's alerts before publish.)
 */
export function bundleByPlay(events: Detected[]): Detected[] {
  return events.map((e) => {
    const gameId = e.meta?.gameId, playId = e.meta?.playId;
    if (e.moment || typeof gameId !== 'string' || typeof playId !== 'string') return e;
    const team = e.targetKey.startsWith('team:') ? e.targetKey : catalog.player(e.targetKey)?.teamKey;
    return team ? { ...e, moment: playMoment(gameId, playId, team), fold: e.fold ?? asLine(e.title) } : e;
  });
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * Team alert: the half-inning just ended with runners on second and/or third. A runner left on first
 * is in it too: "stranded runners on first and second".
 * Uses the half-inning's last at-bat result, whose runner roles are the bases after the third out.
 */
function strandedRisp(g: GameCtx): Detected[] {
  const r = g.lastResult;
  if (!r?.teamId) return [];
  const on = (base: string) => r.participants.some((x) => x.role === base);
  const [first, second, third] = [on('onFirst'), on('onSecond'), on('onThird')];
  const risp = Number(second) + Number(third);
  if (!risp) return [];
  const what = first && second && third ? 'left the bases loaded 🤦'
    : risp === 2 ? 'stranded 2 runners in scoring position'
    : first ? `stranded runners on first and ${third ? 'third' : 'second'}`
    : `stranded a runner on ${third ? 'third' : 'second'}`;
  return [{
    id: `${g.gameId}:${r.id}:mlb.team.stranded_risp:${r.teamId}`,
    type: 'mlb.team.stranded_risp',
    targetKey: teamKey('mlb', r.teamId), // play-result team = batting team
    title: `${teamName('mlb', r.teamId)} ${what}`,
    body: `${halfLabel(r)}: ${r.text} — ${scoreLine(g, r)}`,
    at: r.at,
    meta: { gameId: g.gameId, playId: r.id, runnersInScoringPosition: risp },
  }];
}

const halfKey = (p: NPlay) => (p.period?.type === 'Top' || p.period?.type === 'Bottom' ? `${p.period.type}${p.period.number}` : undefined);
const halfLabel = (p: NPlay) => (p.period ? `${p.period.type === 'Top' ? 'Top' : 'Bottom'} ${ordinal(p.period.number)}` : 'Inning over');

/**
 * NOBLETIGER bookkeeping (No Outs, Bases Loaded, Ending with Team Incapable of Getting Easy Run).
 * Only at-bat results that list the batter carry reliable outs + bases after the play; ESPN stamps
 * pitches and runner events with the at-bat's final outs instead.
 */
function trackHalfInning(g: GameCtx, p: NPlay) {
  const key = halfKey(p);
  if (!key) return; // "End Inning" / "Mid" / "End" markers
  if (g.half?.key !== key) g.half = { key, loadedNoOuts: false, scoredSince: false, risp: false, pas: [], reached: false };
  // Checked before this play can load the bases: a run that scores on the loading play doesn't count.
  if (g.half.loadedNoOuts && p.scoring) g.half.scoredSince = true;
  if (p.typeSlug === 'play-result' && p.outs === 0 && p.participants.some((x) => x.role === 'batter')) {
    const on = (base: string) => p.participants.some((x) => x.role === base);
    if (on('onFirst') && on('onSecond') && on('onThird')) g.half.loadedNoOuts = true;
  }
  if (inScoringPosition(basesAfter(p)) && !g.half.risp) { g.half.risp = true; g.half.rispPlay = p.id; }
  // An at-bat result lists the runners after it: anyone on (a hit, a walk, an error, extra innings' runner
  // on second) or a run (a solo homer leaves the bases empty) means it wasn't 1-2-3.
  if (p.typeSlug === 'play-result' && p.participants.some((x) => x.role === 'batter') && !g.half.pas.some((x) => x.id === p.id)) {
    g.half.pas.push({ id: p.id, text: p.text });
    if (p.scoring || p.participants.some((x) => x.role === 'onFirst' || x.role === 'onSecond' || x.role === 'onThird')) g.half.reached = true;
  }
}

/**
 * Bases occupied after this play, when the play says: pitches and at-bat results list the batter plus
 * every runner (a full snapshot). Runner plays between pitches name the base taken: "Acuña Jr. stole
 * second.", "Machado to second on wild pitch by Henderson." (also passed balls, balks, errors). Runner
 * outs are skipped ("caught stealing second, catcher to second" is not a runner on second); anything
 * unreadable is caught up by the next pitch's snapshot.
 */
function basesAfter(p: NPlay): string[] | null {
  if (p.participants.some((x) => x.role === 'batter')) {
    return ([['onFirst', 'first'], ['onSecond', 'second'], ['onThird', 'third']] as const)
      .filter(([r]) => p.participants.some((x) => x.role === r)).map(([, base]) => base);
  }
  if (/caught stealing|picked off/i.test(p.text)) return null;
  const taken = [...p.text.matchAll(/\b(?:stole (second|third)|to (second|third) on)\b/gi)].map((m) => (m[1] ?? m[2]).toLowerCase());
  return taken.length ? ['second', 'third'].filter((b) => taken.includes(b)) : null;
}
const inScoringPosition = (bases: string[] | null) => !!bases && (bases.includes('second') || bases.includes('third'));

/**
 * Team alert for the FIELDING team: the opponent just got a runner to second or third. Once per
 * half-inning, the first time it happens; a threat already on base when we attached never fires late
 * (observePlay marks it for history plays too). If a run scores on the same play, the opponent-scored
 * alert says more, so this one is `unless` it.
 */
function opponentRisp(g: GameCtx, p: NPlay): Detected[] {
  const key = halfKey(p);
  const bases = basesAfter(p);
  if (!key || !inScoringPosition(bases) || (g.half?.key === key && g.half.risp)) return [];
  const [battingId, fieldingId] = key.startsWith('Top') ? [g.awayId, g.homeId] : [g.homeId, g.awayId];
  const where = bases!.length === 3 ? 'the bases loaded' : bases!.length === 1 ? `a runner on ${bases![0]}` : `runners on ${bases![0]} and ${bases![1]}`;
  // An at-bat result or a steal explains how they got there; a pitch's text ("Ball 2") doesn't.
  const says = p.typeSlug === 'play-result' || !p.participants.some((x) => x.role === 'batter');
  return [{
    id: `${g.gameId}:${key}:mlb.team.opponent_risp:${fieldingId}`,
    type: 'mlb.team.opponent_risp',
    ...(p.scoring ? { unless: 'team.opponent_scored' } : {}),
    targetKey: teamKey('mlb', fieldingId),
    title: `${teamName('mlb', battingId)} have ${where} against the ${teamName('mlb', fieldingId)}`,
    body: `${halfLabel(p)}${says ? `: ${p.text}` : ''} — ${scoreLine(g, p)}`,
    at: p.at,
    meta: { gameId: g.gameId, playId: p.id },
  }];
}

/**
 * The bases loading after that alert, in the same half-inning (once): a line on it ("Bases loaded now, 1
 * out."), never an alert of its own. It shares the alert's moment (its play's), so the alert already sent
 * gets the line, without a push (publish's late lines); it's that alert's type, so only those who want it.
 * From an at-bat result, the one play that both loads the bases and says how (a walk, a hit, an error).
 */
function basesLoadedLater(g: GameCtx, p: NPlay): Detected[] {
  const key = halfKey(p), h = g.half, b = g.bases;
  const wasLoaded = !!(b?.onFirst && b.onSecond && b.onThird); // the bases before this play (observePlay updates them after)
  if (!key || h?.key !== key || !h.rispPlay || h.rispPlay === p.id || h.loadedTold || wasLoaded) return [];
  if (p.typeSlug !== 'play-result' || basesAfter(p)?.length !== 3) return [];
  h.loadedTold = true;
  const [battingId, fieldingId] = key.startsWith('Top') ? [g.awayId, g.homeId] : [g.homeId, g.awayId];
  const outs = p.outs ?? 0;
  return [{
    id: `${g.gameId}:${key}:mlb.team.opponent_risp:loaded:${fieldingId}`, type: 'mlb.team.opponent_risp', targetKey: teamKey('mlb', fieldingId),
    title: `${teamName('mlb', battingId)} have the bases loaded against the ${teamName('mlb', fieldingId)}`,
    body: `${halfLabel(p)}: ${p.text} — ${scoreLine(g, p)}`, at: p.at, meta: { gameId: g.gameId, playId: p.id },
    moment: playMoment(g.gameId, h.rispPlay, teamKey('mlb', fieldingId)),
    fold: `Bases loaded now, ${outs ? outs : 'nobody'} out${outs > 1 ? 's' : ''}.`, foldOnly: true,
  }];
}

/**
 * Everything that fires when a half-inning ends. If it was a NOBLETIGER, that alert is sent and the
 * stranded-runners alert for the same inning becomes `unless` it: each user gets exactly one of them
 * (the NOBLETIGER if they want it, otherwise the stranded alert if they want that).
 */
function halfInningEnded(g: GameCtx): Detected[] {
  const r = g.lastResult;
  if (!r?.teamId) return [];
  const key = halfKey(r);
  const noble = !!key && g.half?.key === key && g.half.loadedNoOuts && !g.half.scoredSince;
  const out: Detected[] = [];
  if (noble) out.push({
    id: `${g.gameId}:${key}:mlb.team.nobletiger:${r.teamId}`,
    type: 'mlb.team.nobletiger',
    targetKey: teamKey('mlb', r.teamId),
    title: `${teamName('mlb', r.teamId)} pulled a NOBLETIGER`,
    body: `Bases loaded with nobody out… and not one run. ${halfLabel(r)}: ${r.text} — ${scoreLine(g, r)}`,
    at: r.at,
    meta: { gameId: g.gameId, playId: r.id },
  });
  for (const s of strandedRisp(g)) out.push(noble ? { ...s, unless: 'mlb.team.nobletiger' } : s);
  out.push(...downInOrder(g, r, key));
  out.push(...noHitWatch(g, r));
  return out;
}

/**
 * Team alert: six innings in and no hits (once a game). Only from a hit count the core feed gave (g.hits,
 * never a guess), and the game tracker checks it against the box score before it goes out (live.ts).
 */
function noHitWatch(g: GameCtx, r: NPlay): Detected[] {
  const n = r.period?.number ?? 0, side = r.teamId === g.homeId ? 'home' : 'away';
  if (n < 6 || !r.teamId || !g.hits || g.hits[side] !== 0 || g.noHit?.has(r.teamId)) return [];
  (g.noHit ??= new Set()).add(r.teamId);
  return [{
    id: `${g.gameId}:mlb.team.no_hit:${r.teamId}`, type: 'mlb.team.no_hit', targetKey: teamKey('mlb', r.teamId),
    title: `${teamName('mlb', r.teamId)} are being no-hit through ${n}`, body: `${halfLabel(r)}: ${r.text} — ${scoreLine(g, r)}`,
    at: r.at, meta: { gameId: g.gameId, playId: r.id, side },
  }];
}

/** Team alert: three up, three down, nobody on. "Struck out in order" when all three struck out. */
function downInOrder(g: GameCtx, r: NPlay, key: string | undefined): Detected[] {
  const h = g.half;
  if (!key || h?.key !== key || h.reached || h.pas.length !== 3) return [];
  const ks = h.pas.filter((x) => /struck out/i.test(x.text)).length;
  const team = teamName('mlb', r.teamId!);
  return [{
    id: `${g.gameId}:${key}:mlb.team.down_in_order:${r.teamId}`,
    type: 'mlb.team.down_in_order',
    targetKey: teamKey('mlb', r.teamId!),
    title: ks === 3 ? `${team} struck out in order 🌀` : `${team} went down in order`,
    // An ABS challenge's sentence rides along in the play's text ("Milwaukee Brewers challenged: call on the field was overturned.").
    body: `${halfLabel(r)}: ${h.pas.map((x) => x.text.replace(/\s*[^.]*\bchallenged:[^.]*\.?/g, '')).join(' ')} — ${scoreLine(g, r)}`,
    at: r.at,
    meta: { gameId: g.gameId, playId: r.id, strikeouts: ks },
  }];
}

/** The game's final half-inning has no "End Inning" play; the tracker calls this at the final. */
export function mlbFinalHalfInning(g: GameCtx): Detected[] {
  return g.league === 'mlb' && g.lastResult?.outs === 3 ? halfInningEnded(g) : []; // walk-offs end with < 3 outs
}

type Base = 'onFirst' | 'onSecond' | 'onThird';
/** Stealing a base means the runner left the one before it. */
const STOLEN_FROM: Record<string, Base> = { second: 'onFirst', third: 'onSecond', home: 'onThird' };
/** Picked off a base means the runner was standing on it. */
const PICKED_AT: Record<string, Base> = { first: 'onFirst', second: 'onSecond', third: 'onThird' };
const NAME = String.raw`([A-Z][\p{L}'.-]+(?: (?:Jr\.|Sr\.|II|III|IV))?)`;
const PICKED_OFF = new RegExp(`${NAME} picked off (?:and caught stealing (second|third|home)|(first|second|third))`, 'u');
const CAUGHT_STEALING = new RegExp(`${NAME} caught stealing (second|third|home)`, 'u');

/**
 * Player alert: a runner thrown out stealing OR picked off (one notification type, one toggle).
 *   "Butler caught stealing second, catcher to second."   → runner came from first
 *   "Bolte picked off first."                              → runner was on first
 *   "X picked off and caught stealing second."             → runner came from first
 * ESPN lists only the pitcher on these plays, so the runner is whoever was on that base (g.bases),
 * cross-checked against the last name in the text, with a roster name match as fallback.
 * ESPN emits each one twice (a "Caught Stealing"/"Pick Off" play and a "Play Result" with the same
 * text); the id is built from the text, not the play id, so both collapse into one notification.
 */
function runnerOut(g: GameCtx, p: NPlay): Detected | null {
  let lastName: string, from: Base, what: string;
  const po = p.text.match(PICKED_OFF);
  const cs = po ? null : p.text.match(CAUGHT_STEALING); // check pickoffs first: "picked off and caught stealing"
  if (po) {
    const [, name, stealing, at] = po;
    [lastName, from, what] = stealing ? [name, STOLEN_FROM[stealing], `got picked off (caught stealing ${stealing})`] : [name, PICKED_AT[at], `got picked off ${at}`];
  } else if (cs) {
    const [, name, stealing] = cs;
    [lastName, from, what] = [name, STOLEN_FROM[stealing], `got caught stealing ${stealing}`];
  } else return null;

  const fullName = (id: string) => catalog.playerByEspn('mlb', id)?.name;
  const matches = (id: string) => normalize(fullName(id) ?? '').endsWith(normalize(lastName));
  let runner = g.bases?.[from];
  if (!runner || (fullName(runner) && !matches(runner))) {
    runner = p.teamId ? byLastName(g, p.teamId, lastName) : undefined; // play team = batting team
  }
  if (!runner) return null;
  const half = p.period ? `${p.period.type}${p.period.number}` : '';
  return {
    id: `${g.gameId}:cs:${half}:${normalize(p.text).replace(/ /g, '-')}:${runner}`,
    type: 'mlb.runner.caught_stealing',
    targetKey: playerKey('mlb', runner),
    title: `${nameOf('mlb', runner)} ${what}`,
    body: `${p.text} — ${scoreLine(g, p)}`,
    at: p.at,
    meta: { gameId: g.gameId, playId: p.id, athleteId: runner },
  };
}

/** A run that scored on a wild pitch, a passed ball or a balk: "Mitchell scored on Burke wild pitch.", "Outman scored on a balk." */
const GIFT_RUN = /\bscored on (?:an? )?(?:[A-Z][\p{L}'.-]+ )?(wild pitch|passed ball|balk)\b/iu;
/** Thrown out on the bases in an at-bat's result: "Contreras out stretching at third.", "Manzardo doubled off first.", "Goodman thrown out at home." */
const BASE_OUT = new RegExp(`${NAME} (out stretching at (?:second|third|home)|doubled off (?:first|second|third)|(?:thrown )?out at home)`, 'gu');

/**
 * Player alert: thrown out on the bases (caught stealing and pickoffs are runnerOut's). The batter's own
 * ("Contreras doubled to left, Contreras out stretching at third") or a runner's, found by last name on the
 * batting team. Its id comes from the text, like runnerOut's, for ESPN's double posts.
 */
function outOnBases(g: GameCtx, p: NPlay): Detected[] {
  if (p.typeSlug !== 'play-result' || !p.teamId || /caught stealing|picked off/i.test(p.text)) return [];
  const [batter] = role(p, 'batter');
  const out: Detected[] = [];
  for (const [, name, how] of p.text.matchAll(BASE_OUT)) {
    const who = batter && normalize(catalog.playerByEspn('mlb', batter)?.name ?? '').endsWith(normalize(name)) ? batter : byLastName(g, p.teamId, name);
    if (!who) continue;
    const what = how.replace(/^thrown out/, 'out').replace(/^out stretching/, 'thrown out stretching').replace(/^out at home/, 'thrown out at home').replace(/^doubled off/, 'doubled off');
    out.push({ ...mk(g, p, 'mlb.runner.out_on_bases', who, `${nameOf('mlb', who)} got ${what}`), id: `${g.gameId}:bases:${halfKey(p) ?? ''}:${normalize(p.text).replace(/ /g, '-')}:${who}` });
  }
  return out;
}

// ─── MLB challenges ───────────────────────────────────────────────────────────────────────────
const PITCH = /^Pitch \d+\s*:/i;
/** ESPN's pitch type after an ABS review: the call that stands, and whether the challenge failed ("Confirmed"). */
const ABS_PITCH = /^(ball|strike looking) - (confirmed|overturned)$/i;
export const isPitch = (p: Pick<NPlay, 'text'>) => PITCH.test(p.text);
/** An ABS-reviewed pitch's outcome: "confirmed" (the challenge failed), "overturned", or null for any other play. */
export const absCall = (p: Pick<NPlay, 'type'>) => (p.type.match(ABS_PITCH)?.[2]?.toLowerCase() as 'confirmed' | 'overturned' | undefined) ?? null;
/**
 * A play's place in the game: ESPN's id is the game, half-inning, batter and pitch, then a 4-digit type
 * (4019079871102060092: Bottom 6th, 2nd batter, 6th play, "Strike Looking - Confirmed"; "...0089" once
 * overturned to "Ball - Overturned"). Other ids are their own place.
 */
export const pitchSlot = (id: string) => (/^\d{9,}$/.test(id) ? id.slice(0, -4) : id);
/** A failed challenge in an at-bat result: "Chicago White Sox challenged: call on the field was upheld." */
const CHALLENGE_LOST = /\bchallenged\b[^.]*?\bcall on the field (?:was )?(?:upheld|confirmed|stands|stood)\b/i;
/**
 * A crew chief review (the umpires review a call themselves, no team challenged it), in an at-bat result:
 * "Umpire review: call on the field was overturned." and, Rays @ Yankees 2026-10-07, "Umpire review: HR call
 * on the field was overturned due to fan interference." Groups: the call ("HR"), the outcome, and the reason.
 */
const UMPIRE_REVIEW = /\s*\bumpire review:\s*(?:(.+?)\s+)?call on the field (?:was )?(overturned|upheld|confirmed|stands|stood)\b(?:\s+due to ([^.]+))?\.?/i;
/** Outs in an at-bat result: after an overturned review, the call that was taken away was a safe one. */
const RESULT_OUT = /\bout\b|\bcaught stealing\b|\bpicked off\b|\bdouble play\b|\btriple play\b/i;

/**
 * A crew chief review that overturned a call: the team the call had gone for lost it, as if it had lost a
 * challenge. ESPN's result is what stands after the review and only sometimes names the call ("HR call"):
 * - A home run call overturned: the batting team lost it, and the batter lost the home run (Volpe, fan interference).
 * - Otherwise, a result with an out in it: a runner or the batter was safe, now he's out, so the batting team
 *   lost it (Meckler's fielder's choice, Peraza out at second). Anything else (a hit, a home run, a runner safe,
 *   interference): an out became something better, so the fielding team lost it. A result with both an out and
 *   a run counts as the out, and a hit after an overturn as the hit (it may have been a home run taken back).
 * An upheld review is no alert: nobody asked for it, so nobody lost it. The ids come from the play, not its text,
 * which ESPN can rewrite (the review sentence is added to a result posted before it, see live.ts).
 */
export function umpireReviewLost(g: GameCtx, p: NPlay): Detected[] {
  const key = halfKey(p), m = p.text.match(UMPIRE_REVIEW);
  if (!key || !m || !/^overturned$/i.test(m[2])) return [];
  const [battingId, fieldingId] = key.startsWith('Top') ? [g.awayId, g.homeId] : [g.homeId, g.awayId];
  const homer = !!m[1] && /^(?:hr|home run)$/i.test(m[1].trim());
  const result = p.text.replace(UMPIRE_REVIEW, '').trim();
  const loserId = homer || RESULT_OUT.test(result) ? battingId : fieldingId;
  const [batter] = role(p, 'batter');
  const why = m[3] ? ` (${m[3].trim()})` : '';
  const body = (what: string) => `${halfLabel(p)}: ${what} ${result} — ${scoreLine(g, p)}`;
  const moment = `${g.gameId}:${p.id}:review`;
  const out: Detected[] = [];
  if (homer && batter) {
    out.push(mk(g, p, 'mlb.challenge_lost', batter, `${nameOf('mlb', batter)}'s home run was overturned`, { body: body(`a crew chief review took it away${why}.`), moment }));
  }
  out.push({
    id: `${g.gameId}:${p.id}:mlb.challenge_lost:review-${loserId}`, type: 'mlb.challenge_lost', targetKey: teamKey('mlb', loserId),
    title: `${teamName('mlb', loserId)} lost a crew chief review`,
    body: body(homer ? `${batter ? `${nameOf('mlb', batter)}'s` : 'a'} home run was overturned${why}.` : `the call on the field was overturned${why}.`),
    at: p.at, meta: { gameId: g.gameId, playId: p.id }, moment,
  });
  return out;
}

/**
 * A team lost a challenge (one type, `mlb.challenge_lost`, for teams and players).
 * - ABS (the automated ball-strike system): a pitch whose call was confirmed after a challenge. Only
 *   the batter can challenge a called strike, so the batting team lost and the batter gets the player alert. A ball
 *   is challenged by the pitcher or the catcher (ESPN doesn't say which): the fielding team lost, and
 *   the pitcher's alert says the challenge on that pitch failed.
 * - Replay: "<Team> challenged: call on the field was upheld" in a result. The manager challenges, so
 *   it's a team alert only.
 * No duplicates: an ABS challenge on an at-bat's last pitch is in the result's text too, so a result
 * right after an ABS-reviewed pitch isn't read as a replay challenge (`g.lastPitchAbs`). The player and
 * team alerts for one ABS challenge share a `moment`, so tracking the batter and the batter's team gets you one.
 * ESPN sends runner plays twice with the same text (see runnerOut), so the replay id is built from it.
 * - Crew chief review: the umpires overturned a call (umpireReviewLost).
 */
function challengeLost(g: GameCtx, p: NPlay): Detected[] {
  const key = halfKey(p);
  if (!key) return [];
  if (UMPIRE_REVIEW.test(p.text)) return umpireReviewLost(g, p);
  const [battingId, fieldingId] = key.startsWith('Top') ? [g.awayId, g.homeId] : [g.homeId, g.awayId];
  const abs = p.type.match(ABS_PITCH);
  if (abs) {
    if (!/^confirmed$/i.test(abs[2])) return []; // overturned: they won it
    const strike = /^strike/i.test(abs[1]);
    const [batter] = role(p, 'batter'), [pitcher] = role(p, 'pitcher');
    const loserId = strike ? battingId : fieldingId;
    const call = PITCH.test(p.text) ? p.text.replace(PITCH, '').trim().toLowerCase() : strike ? 'a called strike' : 'a ball'; // "strike 3 looking", "ball 2"
    const batterName = batter ? nameOf('mlb', batter) : 'the batter';
    const body = (what: string) => `${halfLabel(p)}: ${what} — ${scoreLine(g, p)}`;
    const moment = `${g.gameId}:${p.id}:abs`;
    // ESPN posts every challenged pitch as "Confirmed" first and changes it if the call is overturned:
    // these wait in the game tracker until the review is over (absSlot).
    const absSlot = pitchSlot(p.id);
    const out: Detected[] = [];
    if (strike && batter) out.push(mk(g, p, 'mlb.challenge_lost', batter, `${batterName} lost an ABS challenge`, { body: body(`challenged ${call}, and the call stands`), moment, absSlot }));
    if (!strike && pitcher) out.push(mk(g, p, 'mlb.challenge_lost', pitcher, `ABS challenge on ${nameOf('mlb', pitcher)}'s pitch failed`, { body: body(`${call} to ${batterName} stands`), moment, absSlot }));
    out.push({
      id: `${g.gameId}:${p.id}:mlb.challenge_lost:team-${loserId}`, type: 'mlb.challenge_lost', targetKey: teamKey('mlb', loserId),
      title: `${teamName('mlb', loserId)} lost an ABS challenge`,
      body: body(strike ? `${batterName} challenged ${call}, and the call stands` : `${call} to ${batterName} stands${pitcher ? ` (${nameOf('mlb', pitcher)} pitching)` : ''}`),
      at: p.at, meta: { gameId: g.gameId, playId: p.id }, moment, absSlot,
    });
    return out;
  }
  if (g.lastPitchAbs || !CHALLENGE_LOST.test(p.text)) return [];
  const said = normalize(p.text);
  const loserId = [battingId, fieldingId].find((id) => {
    const t = catalog.teamByEspn('mlb', id);
    return !!t && [t.name, t.shortName].some((n) => n && said.includes(`${normalize(n)} challenged`));
  });
  if (!loserId) return [];
  return [{
    id: `${g.gameId}:challenge:${key}:${said.replace(/ /g, '-')}:${loserId}`, type: 'mlb.challenge_lost', targetKey: teamKey('mlb', loserId),
    title: `${teamName('mlb', loserId)} lost ${/\b(?:struck out looking|walked)\b/i.test(p.text) ? 'an ABS' : 'a replay'} challenge`, body: `${p.text} — ${scoreLine(g, p)}`,
    at: p.at, meta: { gameId: g.gameId, playId: p.id },
  }];
}

// ─── MLB pitchers' nights: blown saves, no quality starts, losses (from the box score) ─────────
export interface BoxPitcher { id: string; teamId: string; starter: boolean; active: boolean; ip: string; outs: number; er: number; line: string; notes: string[] }

/** Each pitcher's line and decision notes ("W, 2-0", "L, 0-1", "S, 2", "H, 1", and "B, 3" for a blown save) from a summary's box score. */
export function boxPitchers(summary: any): BoxPitcher[] {
  const out: BoxPitcher[] = [];
  for (const t of summary?.boxscore?.players ?? []) {
    const st = t.statistics?.find((x: any) => x.type === 'pitching' || x.name === 'pitching');
    const labels: string[] = st?.labels ?? [];
    for (const a of st?.athletes ?? []) {
      if (a.athlete?.id == null) continue;
      const v = (l: string) => a.stats?.[labels.indexOf(l)] ?? '0';
      const ip = String(v('IP'));
      const [full, part] = ip.split('.').map(Number);
      out.push({
        id: String(a.athlete.id), teamId: String(t.team?.id), starter: !!a.starter, active: !!a.active,
        ip, outs: (full || 0) * 3 + (part || 0), er: Number(v('ER')) || 0,
        line: `${ip} IP, ${v('H')} H, ${v('ER')} ER, ${v('BB')} BB, ${v('K')} K`,
        notes: (a.notes ?? []).filter((n: any) => n.type === 'pitchingDecision').map((n: any) => String(n.text)),
      });
    }
  }
  return out;
}

const PITCHER_ORDER = ['mlb.pitcher.blown_save', 'mlb.pitcher.chased', 'mlb.pitcher.no_quality_start', 'mlb.pitcher.loss'];
/** A starter out of the game before this many outs (3 innings) got chased: 10.5% of 410 starts in 2026. */
export const CHASED_OUTS = 9;
const innings = (p: BoxPitcher) => { const ip = p.ip.replace(/\.0$/, ''); return `${ip} inning${ip === '1' ? '' : 's'}`; };

/**
 * Tracked pitchers' bad nights, from the box score the game tracker reads every poll. Each fires once
 * per game and pitcher (`done` remembers; ids are per game and pitcher too):
 * - Blown save: ESPN's decision note "B, 3" (the 3rd this season), whenever ESPN posts it.
 * - No quality start (6+ innings with 3 or fewer earned runs): for a starter, the moment it can't
 *   happen anymore. That's a 4th earned run, leaving before 6 innings, or a final in fewer (a short
 *   complete game).
 * - The loss ("L, 0-1"): only with `final`, since ESPN posts no decisions during a game.
 * Facts that land in the same read for one pitcher (a blown save posted at the final with the loss)
 * are one alert, under the first type with the others as aliases, so it counts as each toggle.
 */
export function pitcherEvents(g: GameCtx, pitchers: BoxPitcher[], o: { final: boolean; score: { home: number; away: number }; at: number }, done: Set<string>): Detected[] {
  const out: Detected[] = [];
  for (const p of pitchers) {
    const note = (re: RegExp) => p.notes.find((n) => re.test(n));
    const bs = note(/^BS?\b/), loss = o.final ? note(/^L\b/) : undefined;
    const noQs = p.starter && (p.er >= 4 || ((!p.active || o.final) && p.outs < 18));
    const chased = p.starter && !p.active && !o.final && p.outs < CHASED_OUTS;
    const facts = PITCHER_ORDER.filter((t, i) => [bs, chased, noQs, loss][i] && !done.has(`${t}:${p.id}`));
    if (!facts.length) continue;
    for (const t of facts) done.add(`${t}:${p.id}`);
    const has = (t: string) => facts.includes(`mlb.pitcher.${t}`);
    const name = nameOf('mlb', p.id);
    const after = (n?: string) => n?.split(',')[1]?.trim(); // "B, 3" → "3", "L, 0-1" → "0-1"
    const title = has('blown_save') && has('loss') ? `${name} blew the save and took the loss`
      : has('no_quality_start') && has('loss') ? `${name} took the loss without a quality start`
      : has('blown_save') ? `${name} blew the save`
      : has('loss') ? `${name} took the loss`
      : has('chased') ? `${name} got chased after ${innings(p)}${p.er ? ` (${p.er} earned run${p.er === 1 ? '' : 's'})` : ''}`
      : `No quality start for ${name}: ${p.er >= 4 ? `${p.er} earned runs in ${innings(p)}` : `${p.active ? 'went' : 'pulled after'} ${innings(p)}`}`;
    const extra = [
      has('blown_save') && Number(after(bs)) ? `${ordinal(Number(after(bs)))} blown save this season` : '',
      has('loss') && after(loss) ? `now ${after(loss)}` : '',
    ].filter(Boolean);
    // His start's two facts can come at different times (a 4th earned run, then the hook): one moment, so the
    // later one is a line on the alert he already had.
    const start = facts.every((t) => t === 'mlb.pitcher.chased' || t === 'mlb.pitcher.no_quality_start')
      ? { moment: `${g.gameId}:start:${p.id}`, fold: has('chased') ? `Chased after ${innings(p)}.` : asLine(title) } : {};
    out.push({
      id: `${g.gameId}:${facts[0]}:${p.id}`, type: facts[0], ...(facts.length > 1 ? { aliases: facts.slice(1) } : {}), ...start,
      targetKey: playerKey('mlb', p.id), title,
      body: `${p.line}${extra.length ? ` · ${extra.join(' · ')}` : ''} — ${o.final ? 'Final: ' : ''}${scoreLine(g, o.score)}`,
      at: o.at, meta: { gameId: g.gameId, athleteId: p.id },
    });
  }
  return out;
}

// ─── Per-league player detectors ──────────────────────────────────────────────────────────────
function mlb(g: GameCtx, p: NPlay): Detected[] {
  // ESPN marks every half-inning except the game's last with an "End Inning" play.
  if (p.typeSlug === 'end-inning') return halfInningEnded(g);
  const out: Detected[] = [];
  const [batter] = role(p, 'batter');
  const [pitcher] = role(p, 'pitcher');
  const t = p.text;
  const isResult = p.typeSlug === 'play-result' || p.scoring;

  if (isResult && batter) {
    if (/struck out/i.test(t)) {
      // The 3rd, 4th, 5th strikeout of a game is its own alert, in place of the strikeout's (and counting as it).
      const n = (g.ks?.[batter] ?? 0) + 1; // observePlay counts this one after the detectors
      const how = /looking/i.test(t) ? 'looking 👀' : 'swinging';
      out.push(n >= 3
        ? mk(g, p, 'mlb.batter.multi_strikeout', batter, `${nameOf('mlb', batter)} struck out for the ${ordinal(n)} time: ${n === 3 ? 'a hat trick 🎩' : n === 4 ? 'a golden sombrero' : 'a platinum sombrero'}`, { aliases: ['mlb.batter.strikeout'] })
        : mk(g, p, 'mlb.batter.strikeout', batter, `${nameOf('mlb', batter)} struck out ${how}`));
    } else if (/\b(double|triple) play\b/i.test(t)) {
      // "Busch grounded into double play, …", "Pham flied into double play, …", a triple play the same way.
      // It's an out too: someone with only "Makes an out" on gets this one (aliases), and nobody gets two.
      const [, how = 'hit', kind] = t.match(/\b(grounded|lined|flied|popped|bunted|fouled|hit) into (?:a )?(double|triple) play\b/i) ?? [, 'hit', /triple play/i.test(t) ? 'triple' : 'double'];
      const play = /^triple$/i.test(kind ?? '') ? 'a TRIPLE PLAY 😱' : 'a double play';
      out.push(mk(g, p, 'mlb.batter.double_play', batter, `${nameOf('mlb', batter)} ${how.toLowerCase()} into ${play}`, { aliases: ['mlb.batter.popout'] }));
    } else if (/\b(flied|grounded|lined|popped|fouled|bunted) out\b|,\s*(?:thrown )?out at\b|fielder'?s choice/i.test(t)) {
      // How: "grounded out", "flied out", "grounded into a fielder's choice" (an at-bat, no hit). Out on the
      // bases counts only when it's the batter's own: "doubled to left, out at third", not "singled to
      // right, Shaw to second, Conforto thrown out at home" (a hit; a runner was out).
      const how = t.match(/\b(flied|grounded|lined|popped|fouled|bunted) out\b/i)?.[1]?.toLowerCase();
      const fc = t.match(/\b(grounded|popped|lined|flied|bunted|hit) into (?:a )?fielder'?s choice/i)?.[1]?.toLowerCase();
      const what = how ? `${how} out` : fc ? `${fc} into a fielder's choice` : /fielder'?s choice/i.test(t) ? "hit into a fielder's choice" : 'made an out';
      out.push(mk(g, p, 'mlb.batter.popout', batter, `${nameOf('mlb', batter)} ${what}`));
    }
  }
  if (pitcher) {
    const runs = p.scoring ? Math.max(p.scoreValue, 1) : 0;
    const pn = nameOf('mlb', pitcher);
    // A run handed over: a wild pitch, a balk, a passed ball, or a walk or hit batter with the bases loaded.
    // ESPN posts a runner's run twice (a "Wild Pitch" play and a "Play Result", same text), so these ids
    // come from the half-inning and the text: one alert.
    const gift = p.scoring ? t.match(GIFT_RUN) : null;
    const pushedIn = p.scoring && isResult && /\b(walked|hit by pitch)\b/i.test(t) && !/\b(singled|doubled|tripled|homered)\b/i.test(t);
    const textId = (type: string, who: string) => `${g.gameId}:${type}:${halfKey(p) ?? ''}:${normalize(t).replace(/ /g, '-')}:${who}`;
    if (/homered/i.test(t)) {
      const label = runs >= 4 ? 'a grand slam' : runs > 1 ? `a ${runs}-run homer` : 'a solo homer';
      // Every homer is its own alert. The batter before homered off him too, this half-inning: it says how many in a
      // row ("gave up back-to-back homers", the third "back-to-back-to-back").
      const before = g.lastResult;
      const after = !!before && /homered/i.test(before.text) && halfKey(before) === halfKey(p) && role(before, 'pitcher')[0] === pitcher;
      const n = after ? (g.homerRun?.id === before!.id ? g.homerRun.n : 1) + 1 : 1;
      g.homerRun = { id: p.id, n };
      const what = n > 1 ? `${Array(n).fill('back').join('-to-')} homers` : label;
      out.push(mk(g, p, 'mlb.pitcher.home_run_allowed', pitcher, `${pn} gave up ${what}`, { aliases: ['mlb.pitcher.runs_allowed'] }));
    } else if (gift && !/passed ball/i.test(gift[1])) {
      out.push({ ...mk(g, p, 'mlb.pitcher.gift_run', pitcher, `${pn} ${/balk/i.test(gift[1]) ? 'balked in a run' : 'let a run score on a wild pitch'}`, { aliases: ['mlb.pitcher.runs_allowed'] }), id: textId('mlb.pitcher.gift_run', pitcher) });
    } else if (pushedIn) {
      out.push(mk(g, p, 'mlb.pitcher.gift_run', pitcher, `${pn} ${/hit by pitch/i.test(t) ? 'hit a batter' : 'walked'} in a run`, { aliases: ['mlb.pitcher.runs_allowed', 'mlb.pitcher.walk'] }));
    } else if (runs) {
      out.push({ ...mk(g, p, 'mlb.pitcher.runs_allowed', pitcher, `${pn} gave up ${runs} run${runs > 1 ? 's' : ''}`), ...(gift ? { id: textId('mlb.pitcher.runs_allowed', pitcher) } : {}) });
    }
    if (isResult && /\b(walked|hit by pitch)\b/i.test(t) && !pushedIn) out.push(mk(g, p, 'mlb.pitcher.walk', pitcher, `${pn} ${/hit by pitch/i.test(t) ? 'plunked a batter' : 'issued a walk'}`));
    // A passed ball that scores a run is the catcher's ("…on a passed ball by Langeliers").
    const catcherName = gift && /passed ball/i.test(gift[1]) ? t.match(/passed ball by ([A-Z][\p{L}'.-]+(?: (?:Jr\.|Sr\.|II|III))?)/u)?.[1] : undefined;
    const catcher = catcherName && p.teamId ? byLastName(g, p.teamId === g.homeId ? g.awayId : g.homeId, catcherName) : undefined;
    if (catcher) out.push({ ...mk(g, p, 'mlb.catcher.passed_ball', catcher, `${nameOf('mlb', catcher)} let a run score on a passed ball`), id: textId('mlb.catcher.passed_ball', catcher) });
  }
  out.push(...outOnBases(g, p));
  const runner = runnerOut(g, p);
  if (runner) out.push(runner);
  out.push(...opponentRisp(g, p));
  out.push(...basesLoadedLater(g, p));
  out.push(...challengeLost(g, p));
  const err = t.match(/error by (?:\w+ )?(?:baseman |fielder |stop )?([A-Z][\w'.-]+(?: (?:Jr\.|Sr\.|II|III))?)/);
  if (err && p.teamId) {
    const fieldingTeam = p.teamId === g.homeId ? g.awayId : g.homeId;
    const who = byLastName(g, fieldingTeam, err[1]);
    if (who) out.push(mk(g, p, 'mlb.fielder.error', who, `${nameOf('mlb', who)} committed an error`));
  }
  return out;
}

/**
 * What an NFL play's text says stands: after a review that reversed the call, the part after it. ESPN keeps the call
 * overturned in front: "(Shotgun) D.Watson pass … INTERCEPTED by R.Spears-Jennings … PENALTY on PIT-D.Everette,
 * Defensive Pass Interference, 42 yards, enforced at CLV 35 - No Play.The Replay Official reviewed the pass was not
 * tipped ruling, and the play was REVERSED.(Shotgun) D.Watson pass … INTERCEPTED by R.Spears-Jennings …".
 */
export const ruled = (text: string) => text.split(/\bthe play was REVERSED\.?/i).at(-1)!;

function nfl(g: GameCtx, p: NPlay): Detected[] {
  const out: Detected[] = [];
  const [passer] = role(p, 'passer');
  const ty = p.type;
  // A play wiped out by a penalty ("… enforced at WAS 35 - No Play.") is only its flags. ESPN often leaves its type
  // and players as they were: 73 of 734 in the 2026 season's first five weeks (sacks wiped out by defensive holding,
  // incompletions by pass interference), and a play it edits live starts out as the play it was. After a review that
  // reversed it, what stands is the call after "REVERSED." (wiped out, then not: an interception, Browns at Steelers).
  const wiped = /\bNo Play\b/i.test(ruled(p.text));
  if (passer && !wiped && /Interception/i.test(ty)) out.push(mk(g, p, 'nfl.qb.interception', passer, `${nameOf(g.league, passer)} threw an interception${/Touchdown/i.test(ty) ? ' — returned for a TD 🙃' : ''}`));
  if (passer && !wiped && /^Sack/i.test(ty)) out.push(mk(g, p, 'nfl.qb.sacked', passer, `${nameOf(g.league, passer)} got sacked`));
  if (passer && !wiped && /Pass Incompletion/i.test(ty)) out.push(mk(g, p, 'nfl.qb.incompletion', passer, `${nameOf(g.league, passer)} threw incomplete`));
  // A fumble is lost when a team not the fumbler's took the ball: "RECOVERED by NE-E.Ponder" (capitals: the ball has
  // changed hands since the snap; "recovered by" and "and recovers" are the side's own), else when the type says so. A
  // strip-sack the defense recovers is "Sack Opp Fumble Recovery" (21 in the 2026 season's first five weeks), a kick
  // returner's fumble the kicking team recovers just "Kickoff" (6): both were "fumbled", off by default. ESPN can name
  // the defender who forced a strip-sack as its fumbler and leave out the quarterback (Barmore on Rodgers's, Steelers
  // at Patriots): nobody forces his own fumble, and "… sacked at PIT 21 for -9 yards (C.Barmore). FUMBLES" is the
  // quarterback's. His lost fumble heads the sack, which is its line.
  const said = ruled(p.text), recovered = said.search(/RECOVERED by/);
  const took = [...said.matchAll(/RECOVERED by ([A-Z]{2,3})-/g)].map((m) => NFL_CODE[m[1]] ?? m[1]);
  const forced = role(p, 'forcedBy'), fumblers = wiped ? [] : role(p, 'fumbler').filter((f) => !forced.includes(f));
  if (!wiped && passer && !fumblers.includes(passer) && /\bsacked\b[^)]*?(?:\([^)]*\))?\.\s*FUMBLES\b/.test(said)) fumblers.unshift(passer);
  for (const f of fumblers) {
    const team = playerTeamId(g.league, f), code = team ? catalog.teamByEspn(g.league, team)?.abbrev : undefined;
    const lost = code && took.length ? took.some((t) => t !== code) : /Opponent|Opp Fumble|Fumble Return/i.test(ty);
    const td = /Touchdown/i.test(ty) || (p.scoring && recovered >= 0 && /\bTOUCHDOWN\b/.test(said.slice(recovered)));
    if (!lost) { out.push(mk(g, p, 'nfl.fumble', f, `${nameOf(g.league, f)} fumbled`)); continue; }
    const sack = out.findIndex((x) => x.type === 'nfl.qb.sacked' && x.targetKey === playerKey(g.league, f));
    out.splice(sack >= 0 ? sack : out.length, 0, mk(g, p, 'nfl.fumble_lost', f, `${nameOf(g.league, f)} lost a fumble${td ? ' — returned for a TD 🙃' : ''}`, { aliases: ['nfl.fumble'] }));
  }
  const kickMiss = !wiped && (/Field Goal Missed|Blocked Field Goal|Blocked PAT|Missed PAT/i.test(ty) || /extra point is no good|kick is blocked/i.test(ruled(p.text)));
  if (kickMiss) for (const k of [...role(p, 'kicker'), ...role(p, 'patScorer')].slice(0, 1))
    out.push(mk(g, p, 'nfl.kicker.miss', k, `${nameOf(g.league, k)} ${/blocked/i.test(ty + p.text) ? 'got a kick blocked' : /extra point/i.test(p.text) ? 'missed the extra point' : 'missed a field goal'}`));
  for (const x of role(p, 'penalized')) out.push(mk(g, p, 'nfl.penalty', x, `${nameOf(g.league, x)} was flagged${/declined/i.test(p.text) ? ' (declined)' : ''}`));

  // A more specific alert replaces the generic one for the same player on the same play, and
  // counts as that generic toggle too (aliases), so nobody gets two notifications for one play.
  const replace = (e: Detected, generic?: string) => {
    if (generic) {
      const i = out.findIndex((x) => x.type === generic && x.targetKey === e.targetKey);
      if (i >= 0) out.splice(i, 1);
      e.aliases = [generic];
    }
    out.push(e);
  };
  const victim = isSafety(p) ? safetyVictim(p) : undefined;
  if (victim) replace(mk(g, p, 'nfl.safety', victim.id, `${nameOf(g.league, victim.id)} ${victim.how}`), victim.covers);
  const dog = delayOfGameQb(g, p);
  if (dog) replace(mk(g, p, 'nfl.qb.delay_of_game', dog.qb, `${nameOf(g.league, dog.qb)} took a delay of game penalty`), dog.named ? 'nfl.penalty' : undefined);
  const onside = onsideRecovered(g, p);
  if (onside) out.push(onside);
  const tossed = disqualified(g, p);
  if (tossed) replace(mk(g, p, 'player.ejected', tossed, `${nameOf(g.league, tossed)} got ejected`), 'nfl.penalty');
  // A touchdown taken off the board by a penalty: the flagged player's (in place of his penalty alert) and
  // his team's, the team whose touchdown it was ("TOUCHDOWN NULLIFIED by Penalty. PENALTY on GB-A.Belton, …").
  // College (no players): "… TOUCHDOWN nullified by penalty, … PENALTY USC Personal Foul … NO PLAY". Its penalty
  // codes aren't the teams' ("USC" for South Carolina), so whose touchdown it was is the play's: the offense's,
  // or on a kickoff or punt, the side receiving it.
  if (TEAMS_ONLY.has(g.league) && /TOUCHDOWN nullified by penalty/i.test(p.text) && /\bNO PLAY\b/i.test(p.text) && p.teamId) {
    const kick = /kickoff|punt/i.test(p.type), teamId = kick ? (p.teamId === g.homeId ? g.awayId : p.teamId === g.awayId ? g.homeId : undefined) : p.teamId;
    if (teamId === g.homeId || teamId === g.awayId) out.push({ id: `${g.gameId}:${p.id}:cfb.td_wiped_out:team-${teamId}`, type: footballType(g.league, 'td_wiped_out'), targetKey: teamKey(g.league, teamId!),
      title: `${teamName(g.league, teamId!)} had a touchdown wiped out by a penalty`, body: `${p.text} — ${scoreLine(g, p)}`, at: p.at, meta: { gameId: g.gameId, playId: p.id } });
  }
  if (/TOUCHDOWN NULLIFIED/.test(ruled(p.text))) {
    const flagged = flaggedFor(g, p);
    const teamId = flagged ? playerTeamId(g.league, flagged) : undefined;
    if (flagged) replace(mk(g, p, 'nfl.td_wiped_out', flagged, `${nameOf(g.league, flagged)}'s penalty wiped out a touchdown`), 'nfl.penalty');
    if (teamId) out.push({ id: `${g.gameId}:${p.id}:nfl.td_wiped_out:team-${teamId}`, type: 'nfl.td_wiped_out', targetKey: teamKey(g.league, teamId),
      title: `${teamName(g.league, teamId)} had a touchdown wiped out by a penalty`, body: `${p.text} — ${scoreLine(g, p)}`, at: p.at, meta: { gameId: g.gameId, playId: p.id } });
  }
  out.push(...qbPulled(g, p));
  return out;
}

// ─── College football: the NFL's player alerts as the team's ─────────────────────────────────
/** A pass, thrown or not (a sack is one too). */
const PASS_PLAY = /^(Pass |Passing Touchdown|Sack|Interception|Pass Interception)/i;
/** The passer a college play's text names: "#14 G.Stockton pass…", "#1 K.Taylor sacked…" ("G.Stockton"). */
export const passerIn = (text: string) => text.match(/#\d+ ([A-Z][\w'-]*\.[\w.'-]+(?: (?:Jr\.|Sr\.|II|III|IV))?) (?:pass|sacked)\b/)?.[1];
/**
 * The team a college penalty's code is ("PENALTY Bama Holding"): ESPN's codes are often not the abbreviation
 * ("Bama", "State", "USC" for South Carolina), so a code is one of the game's two schools when it matches
 * just one of them: its abbreviation, either way round; the start of a word of its location or short name ("Sac",
 * "Jax", "State"); the end of a word of its full name ("Bama", "Noles" for the Seminoles). Not the middle of a word
 * ("NTU" isn't Kentucky), the start of a mascot ("MOU" isn't the Mountaineers) or the end of a short name that's an
 * abbreviation ("TSU" isn't MTSU). A code of more words ("Sac St",
 * "San Jose St", "GA Southern") is a school whose location's or short name's words, from the first, each start with
 * the code's. A code neither school matches that way may be one's initials, with or without a U ("WF" for Wake
 * Forest, "BSU" Ball State, "OSU" Oklahoma State): never one that already matched ("OSU" is Ohio State's
 * abbreviation, so not Oregon State's initials against it). None: not said.
 */
export function cfbCodeTeam(g: Pick<GameCtx, 'league' | 'homeId' | 'awayId'>, code: string): string | undefined {
  const c = code.toLowerCase(), parts = /\s/.test(code.trim()) ? normalize(code).split(' ') : undefined;
  const hits = [g.homeId, g.awayId].filter((id) => {
    const t = catalog.teamByEspn(g.league, id);
    if (!t) return false;
    if (parts) return [t.location, t.shortName].some((n) => { const ws = normalize(n ?? '').split(' '); return parts.length <= ws.length && parts.every((w, i) => ws[i].startsWith(w)); });
    const abbr = t.abbrev.toLowerCase();
    if (abbr === c || abbr.startsWith(c) || c.startsWith(abbr)) return true;
    const w = plainWords(code)[0] ?? '';
    return w.length >= 3 && (plainWords(`${t.location ?? ''} ${t.shortName}`).some((x) => x.startsWith(w)) || plainWords(t.name).some((x) => x.endsWith(w)));
  });
  if (hits.length || parts) return hits.length === 1 ? hits[0] : undefined;
  const initials = [g.homeId, g.awayId].filter((id) => {
    const t = catalog.teamByEspn(g.league, id), i = normalize(t?.location ?? t?.shortName ?? '').split(' ').map((w) => w[0]).join('');
    return i.length >= 2 && (c === i || c === `${i}u`);
  });
  return initials.length === 1 ? initials[0] : undefined;
}
/** A name's words, lowercase without accents, "&" kept ("Texas A&M" → ["texas", "a&m"], "Miami (OH)" → ["miami", "oh"]). */
const plainWords = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[\s()/-]+/).filter(Boolean);

/**
 * A college flag in a play's text: its code's first word, the rest (the code's other words, if any, then what it was:
 * `cfbFlag`), and whether it was declined ("PENALTY VAN Holding declined", "PENALTY SC  Delay Of Game  5 yards").
 */
const CFB_FLAG = /PENALTY +(\S+) +(\p{L}[\p{L} :'/&-]*?)(?= \(| \d| declined| offsetting|\.|,|$)( declined)?/gu;

/**
 * A college flag's team and what it was, from its code's first word and the rest ("Sac", "St UNS: Unsportsmanlike
 * Conduct"): the code is the longest run of up to three words that's one of the game's two schools ("Sac St"), else
 * the first, and the foul is what's left, without ESPN's "UNS: " or "UNR: " ("Unsportsmanlike Conduct").
 */
function cfbFlag(g: Pick<GameCtx, 'league' | 'homeId' | 'awayId'>, code: string, rest: string): { teamId?: string; what: string } {
  const words = rest.trim().split(/\s+/), codeOf = (n: number) => [code, ...words.slice(0, n)].join(' ');
  const n = [2, 1].find((k) => k < words.length && cfbCodeTeam(g, codeOf(k))) ?? 0;
  return { teamId: cfbCodeTeam(g, codeOf(n)), what: words.slice(n).join(' ').replace(/^(UNS|UNR): /, '') };
}

/**
 * The line on an alert whose play a penalty wiped out after it went out: the flag that did it is the play's last one
 * not declined. College: "… PENALTY IND Roughing The Passer (#95 T.Tucker) 15 yards from NEB16 to NEB31, 1ST DOWN.
 * NO PLAY" → "Wiped out by a penalty on Indiana: Roughing The Passer." The NFL: "PENALTY on IND-T.Tucker, Roughing
 * the Passer, 15 yards, enforced at NE 31 - No Play." The team only when the code is one of the game's two.
 */
export function wipedOutLine(g: Pick<GameCtx, 'league' | 'homeId' | 'awayId'>, text: string): string {
  let teamId: string | undefined, what: string | undefined;
  if (TEAMS_ONLY.has(g.league)) {
    const m = [...text.matchAll(CFB_FLAG)].filter((x) => !x[3]).at(-1);
    if (m) ({ teamId, what } = cfbFlag(g, m[1], m[2]));
  } else {
    // The flag before "No Play": one enforced between downs can follow it ("… enforced at NE 16 - No Play.PENALTY on
    // NE, Unsportsmanlike Conduct, 5 yards, enforced between downs."). Offsetting ones are "Penalty on", none taken.
    const cut = text.search(/\bNo Play\b/i);
    const flags = [...text.matchAll(/PENALTY on ([A-Z]{2,3})(?:-[^,]+)?, ([^,]+)/g)].filter((x) => !/declined/i.test(x[2]));
    const m = flags.filter((x) => cut < 0 || x.index < cut).at(-1) ?? flags.at(-1);
    if (m) [teamId, what] = [[g.homeId, g.awayId].find((id) => teamAbbrev(g.league, id) === (NFL_CODE[m[1]] ?? m[1])), m[2].trim()];
    else if (/\boffsetting\b/i.test(text)) return 'Wiped out by offsetting penalties.';
  }
  if (!what) return 'Wiped out by a penalty.';
  return teamId ? `Wiped out by a penalty on ${the(g.league, teamName(g.league, teamId))}: ${what}.` : `Wiped out by a penalty: ${what}.`;
}

/**
 * College football's play alerts for a team (it has no players): an interception thrown, a fumble lost (or any
 * fumble), a sack, an incompletion, a field goal missed or blocked, a flag, a player disqualified (targeting), the
 * starting quarterback pulled. The team is the play's: the offense (`start`), and for a lost ball whichever side
 * didn't end with it (`end`: a muffed punt is the receiving side's). Nothing on a play wiped out ("NO PLAY").
 */
function cfbTeamPlays(g: GameCtx, p: NPlay): Detected[] {
  const sides = [g.homeId, g.awayId];
  const ours = (id?: string) => (id && sides.includes(id) ? id : undefined);
  const other = (id: string) => (id === g.homeId ? g.awayId : g.homeId);
  const out: Detected[] = [];
  const team = (type: string, teamId: string | undefined, title: (name: string) => string, x: Partial<Detected> = {}) => {
    if (!teamId) return;
    out.push({ id: `${g.gameId}:${p.id}:${type}:${teamId}`, type, targetKey: teamKey(g.league, teamId), title: title(teamName(g.league, teamId)),
      body: `${p.text} — ${scoreLine(g, p)}`, at: p.at, meta: { gameId: g.gameId, playId: p.id }, ...x });
  };
  const ty = p.type, wiped = /\bNO PLAY\b/i.test(p.text);
  const offense = ours(p.teamId), ended = ours(p.endTeamId);
  if (!wiped && /Interception/i.test(ty)) team('cfb.team.interception', offense, (n) => `${n} threw an interception${/Touchdown/i.test(ty) ? ' — returned for a TD 🙃' : ''}`);
  if (!wiped && /Fumble Recovery \(Opponent\)|Fumble Return Touchdown/i.test(ty)) {
    team('cfb.team.fumble_lost', ended ? other(ended) : offense, (n) => `${n} lost a fumble${/Touchdown/i.test(ty) ? ' — returned for a TD 🙃' : ''}`, { aliases: ['cfb.team.fumble'] });
  } else if (!wiped && /^Fumble( Recovery \(Own\))?$/i.test(ty)) team('cfb.team.fumble', ended ?? offense, (n) => `${n} fumbled`);
  if (!wiped && /^Sack$/i.test(ty)) { const qb = passerIn(p.text); team('cfb.team.sacked', offense, (n) => `${n} got sacked${qb ? ` (${qb})` : ''}`); }
  if (!wiped && /^Pass Incompletion$/i.test(ty)) team('cfb.team.incompletion', offense, (n) => `${n} threw incomplete`);
  if (!wiped && /^(Field Goal Missed|Blocked Field Goal)$/i.test(ty)) {
    const yards = p.text.match(/field goal attempt from (\d+) yards/i)?.[1];
    team('cfb.team.kick_missed', offense, (n) => (/Blocked/i.test(ty) ? `${n} had a ${yards ? `${yards}-yard ` : ''}field goal blocked` : `${n} missed a ${yards ? `${yards}-yard ` : ''}field goal`));
  }
  // A player disqualified ("PENALTY CAL Targeting (#20 C.Sidney)… California #20 C.Sidney has been disqualified"): the
  // team's alert for that flag (it counts as a flag too), first, so it's the alert and not a line on another.
  const dq = p.text.match(/PENALTY (\S+) ([^(]*?) \((#\d+ [^)]+)\)[^]*?has been disqualified/);
  if (dq) team('cfb.team.ejection', cfbFlag(g, dq[1], dq[2]).teamId, (n) => `${n} had a player ejected: ${dq[3].replace(/^#\d+ /, '')}${/targeting/i.test(dq[2]) ? ' (targeting)' : ''}`, { aliases: ['cfb.team.penalty'] });
  // Each other flag the play has: "PENALTY Bama Delay Of Game", "PENALTY VAN Holding declined", "PENALTY Sac St Offside".
  for (const m of p.text.matchAll(CFB_FLAG)) {
    if (dq && m.index === dq.index) continue; // the ejection's flag: said
    const { teamId, what } = cfbFlag(g, m[1], m[2]);
    team('cfb.team.penalty', teamId, (n) => `${n} was flagged: ${what}${m[3] ? ' (declined)' : ''}`);
  }
  // The starting quarterback pulled, once a game per team (the NFL's rule): in the first three quarters, after
  // his 5th pass, another passer throws twice in a row (one throw is a trick play). ESPN doesn't say why.
  const qb = PASS_PLAY.test(ty) ? passerIn(p.text) : undefined;
  if (qb && offense && (p.periodNum ?? 0) <= 3 && !g.qbPulled?.has(offense)) {
    const start = g.qbStart?.[offense], prev = g.qbOther?.[offense];
    if (start && qb !== start && (g.qbAtt?.[start] ?? 0) >= 5 && (prev?.id === qb ? prev.n : 0) + 1 >= 2) {
      (g.qbPulled ??= new Set()).add(offense);
      team('cfb.team.qb_pulled', offense, (n) => `${n} pulled ${start}: ${qb} is in at quarterback`, { body: `Benched or hurt: ESPN doesn't say. ${p.text} — ${scoreLine(g, p)}` });
    }
  }
  return out;
}

/** The player whose flag it was: the first "PENALTY on XXX-F.Last" the play names, among its penalized players. */
function flaggedFor(g: GameCtx, p: NPlay): string | undefined {
  const penalized = role(p, 'penalized');
  if (penalized.length <= 1) return penalized[0];
  const m = p.text.match(/PENALTY on [A-Z]{2,3}-([A-Z][\w.'-]*\.[\w'-]+)/i);
  if (!m) return penalized[0];
  const [initial, last] = [m[1][0].toLowerCase(), normalize(m[1].split('.').slice(1).join('.'))];
  return penalized.find((id) => { const n = normalize(catalog.playerByEspn(g.league, id)?.name ?? ''); return n.startsWith(initial) && n.endsWith(last); }) ?? penalized[0];
}

/**
 * NFL: the starting QB pulled for another one (benched or hurt), once a game per team: in the first three
 * quarters, after the starter's 5th pass, another QB throws twice in a row (one throw is a package play).
 * ESPN doesn't say why, so the alert says both.
 */
function qbPulled(g: GameCtx, p: NPlay): Detected[] {
  const [qb] = role(p, 'passer'), team = p.teamId;
  if (!qb || !team || catalog.playerByEspn(g.league, qb)?.position !== 'QB' || (p.periodNum ?? 0) > 3 || g.qbPulled?.has(team)) return [];
  const start = g.qbStart?.[team], other = g.qbOther?.[team];
  if (!start || qb === start || (g.qbAtt?.[start] ?? 0) < 5) return [];
  if ((other?.id === qb ? other.n : 0) + 1 < 2) return []; // observePlay counts this pass after the detectors
  (g.qbPulled ??= new Set()).add(team);
  return [{ ...mk(g, p, 'nfl.qb.pulled', start, `${nameOf(g.league, start)} got pulled: ${nameOf(g.league, qb)} is in at quarterback`), body: `Benched or hurt: ESPN doesn't say. ${p.text} — ${scoreLine(g, p)}` }];
}

/**
 * NFL: a player thrown out ("PENALTY on WAS-D.Payne, Disqualification"), from the penalized players the
 * play names: the one ESPN abbreviates that way, or the only one. Not when it's wiped out ("No Play" is
 * about the down, not the ejection, so that one counts).
 */
function disqualified(g: GameCtx, p: NPlay): string | undefined {
  const m = p.text.match(/PENALTY on ([A-Z]{2,3})-([A-Z][\w.'-]*\.[\w'-]+(?: [\w'-]+)?), Disqualification/i);
  if (!m) return;
  const penalized = role(p, 'penalized');
  const [initial, last] = [m[2][0].toLowerCase(), normalize(m[2].split('.').slice(1).join('.'))];
  const named = (name: string) => { const n = normalize(name); return n.startsWith(initial) && n.endsWith(last); };
  if (penalized.length === 1) return penalized[0];
  const hits = penalized.filter((id) => named(catalog.playerByEspn(g.league, id)?.name ?? ''));
  if (hits.length === 1) return hits[0];
  // Offsetting flags can leave ESPN's penalized players out (TEN-M.Brown, 2025): find them on their team.
  const teamId = [g.homeId, g.awayId].find((id) => teamAbbrev(g.league, id) === (NFL_CODE[m[1]] ?? m[1]));
  const roster = teamId ? catalog.roster(teamKey(g.league, teamId)).filter((pl) => named(pl.name)) : [];
  return roster.length === 1 ? roster[0].espnId : undefined;
}

/**
 * Team alert for the RECEIVING team: the other side kicked onside and kept the ball. Real kickoffs read
 * "J.Slye kicks onside 9 yards from TEN 35 to TEN 44. M.Starks (didn't try to advance) to TEN 44 for no
 * gain." That one failed: the play starts with the kicking team (TEN) and ends with the receivers (BAL).
 * A success ends with the kicking team still holding it ("… RECOVERED by TEN-…" names them too, used if
 * ESPN leaves the end team out). A kick wiped out by a penalty ("… - No Play.") doesn't count.
 */
function onsideRecovered(g: GameCtx, p: NPlay): Detected | null {
  // NFL: "kicks onside"; college: "onside kickoff".
  if (!/\bkicks onside\b|\bonside kickoff\b/i.test(p.text) || /\bNo Play\b|NULLIFIED/i.test(p.text)) return null;
  const kicking = p.teamId;
  const receiving = kicking === g.homeId ? g.awayId : kicking === g.awayId ? g.homeId : undefined;
  if (!kicking || !receiving) return null;
  const recoveredBy = [...p.text.matchAll(/RECOVERED by ([A-Z]{2,3})-/gi)].at(-1)?.[1].toUpperCase();
  const kept = p.endTeamId ? p.endTeamId === kicking : !!recoveredBy && (NFL_CODE[recoveredBy] ?? recoveredBy) === teamAbbrev(g.league, kicking);
  if (!kept) return null;
  return {
    id: `${g.gameId}:${p.id}:${footballType(g.league, 'team.onside_recovered')}:${receiving}`,
    type: footballType(g.league, 'team.onside_recovered'),
    targetKey: teamKey(g.league, receiving),
    title: `${teamName(g.league, kicking)} recovered an onside kick against ${the(g.league, teamName(g.league, receiving))}`,
    body: `${p.text} — ${scoreLine(g, p)}`,
    at: p.at,
    meta: { gameId: g.gameId, playId: p.id },
  };
}

/** A safety that actually counted: a scoring play that says so and wasn't wiped out by a penalty. */
export function isSafety(p: NPlay) {
  return p.scoring && (/^Safety$/i.test(p.type) || /\bSAFETY\b/.test(p.text)) && !/NULLIFIED/i.test(p.text);
}

/**
 * Who on the conceding team is to blame. Real examples:
 *   "…PENALTY on SF-D.Puni, Offensive Holding, … enforced in End Zone, SAFETY - No Play." → penalized
 *   "Kaevon Merriweather Safety" (names the defender; the ball carrier is the 'rusher')  → rusher
 */
function safetyVictim(p: NPlay): { id: string; how: string; covers?: string } | undefined {
  const penalized = /PENALTY on/i.test(p.text) ? role(p, 'penalized')[0] : undefined;
  if (penalized) return { id: penalized, how: 'got flagged in the end zone for a safety', covers: 'nfl.penalty' };
  const sacked = /sack/i.test(p.type) || /\bsacked\b/i.test(p.text) ? role(p, 'passer')[0] : undefined;
  if (sacked) return { id: sacked, how: 'got sacked in the end zone for a safety', covers: 'nfl.qb.sacked' };
  const carrier = [...role(p, 'rusher'), ...role(p, 'receiver'), ...role(p, 'returner'), ...role(p, 'fumbler'), ...role(p, 'passer')][0];
  // Neutral wording: includes punters running out of the end zone on purpose (intentional safeties).
  return carrier ? { id: carrier, how: 'gave up a safety' } : undefined;
}

/** NFL play text uses gamebook team codes; these are the ones that differ from ESPN's. */
const NFL_CODE: Record<string, string> = { ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU', LA: 'LAR', WAS: 'WSH', JAC: 'JAX' };

/**
 * Delay of game is charged to the team ("PENALTY on PIT, Delay of Game, 5 yards…" with no player),
 * so it goes to the offense's quarterback in the game. Skipped for punts/field goals (not the QB's
 * snap), declined/offsetting flags, and flags on the defense.
 */
function delayOfGameQb(g: GameCtx, p: NPlay): { qb: string; named: boolean } | undefined {
  const m = p.text.match(/PENALTY on ([A-Z]{2,3})(?:-[^,]+)?, Delay of Game/);
  if (!m || /declined|offsetting/i.test(p.text) || /\([^)]*(?:punt|field goal|kick)[^)]*\)/i.test(p.text)) return;
  const offense = p.teamId ? catalog.teamByEspn(g.league, p.teamId)?.abbrev : undefined;
  if (!offense || (NFL_CODE[m[1]] ?? m[1]) !== offense) return;
  const named = role(p, 'penalized').find((id) => catalog.playerByEspn(g.league, id)?.position === 'QB');
  const qb = named ?? g.qbs?.[p.teamId!];
  return qb ? { qb, named: !!named } : undefined;
}

/** NBA and WNBA (same play-by-play): alerts are `nba.*` or `wnba.*`, each league with its own switches. */
function nba(g: GameCtx, p: NPlay): Detected[] {
  const out: Detected[] = [];
  const lg = g.league, t = p.text;
  const actor = onTeam(g, p, p.teamId) ?? p.participants[0]?.id;
  if (!actor && !/technical/i.test(p.type)) return out;
  if (p.shooting && !p.scoring) {
    if (/blocks/i.test(t)) {
      const shooter = onTeam(g, p, p.teamId) ?? p.participants[1]?.id;
      if (shooter) out.push(mk(g, p, `${lg}.got_blocked`, shooter, `${nameOf(lg, shooter)} got sent back ✋`, { aliases: [`${lg}.missed_shot`] }));
    } else if (/free throw/i.test(t + p.type) && /miss/i.test(t)) {
      out.push(mk(g, p, `${lg}.missed_free_throw`, actor!, `${nameOf(lg, actor!)} missed a free throw`));
    } else if (/miss/i.test(t)) {
      const three = /three point/i.test(t);
      out.push(mk(g, p, `${lg}.missed_shot`, actor!, `${nameOf(lg, actor!)} missed ${three ? 'a three' : 'a shot'}`));
    }
  } else if (/turnover/i.test(p.type) && actor && p.participants.length) {
    out.push(mk(g, p, `${lg}.turnover`, actor, `${nameOf(lg, actor)} turned it over`));
  } else if (/technical|flagrant/i.test(p.type) || /ejected/i.test(t)) {
    for (const x of p.participants.slice(0, /double/i.test(p.type) ? 2 : 1)) out.push(mk(g, p, `${lg}.technical`, x.id, `${nameOf(lg, x.id)} ${/ejected/i.test(t) ? 'got ejected 🚪' : 'picked up a technical'}`));
  } else if (/foul/i.test(p.type) && actor) {
    out.push(mk(g, p, `${lg}.foul`, actor, `${nameOf(lg, actor)} committed a foul`));
  }
  // The 6th personal foul (technicals don't count): fouled out, in place of that foul's alert. First, so that
  // on an offensive foul's turnover play it's the alert and "turned it over" a line on it (bundleByPlay).
  const foul = personalFoul(p);
  if (actor && foul && !g.foulKeys?.has(`${actor}:${foul}`) && (g.fouls?.[actor] ?? 0) + 1 === 6) {
    const i = out.findIndex((e) => e.type === `${lg}.foul` && e.targetKey === playerKey(lg, actor));
    if (i >= 0) out.splice(i, 1);
    out.unshift(mk(g, p, `${lg}.fouled_out`, actor, `${nameOf(lg, actor)} fouled out`, { aliases: [`${lg}.foul`] }));
  }
  return out;
}

/**
 * Basketball: a personal foul (technicals don't count toward fouling out), as a key that's the same for
 * an offensive foul and the turnover ESPN logs for it at that moment ("Offensive Foul", then "Offensive
 * Foul Turnover", one foul in the box score). The turnover is sometimes the only play for it.
 */
function personalFoul(p: NPlay): string | undefined {
  if (!/foul/i.test(p.type) || /technical/i.test(p.type)) return undefined;
  return /offensive/i.test(p.type) ? `offensive:${p.periodNum ?? ''}:${p.clockSec ?? p.id}` : p.id;
}

function nhl(g: GameCtx, p: NPlay): Detected[] {
  const out: Detected[] = [];
  const slug = p.typeSlug;
  const [shooter] = role(p, 'shooter');
  const other = (id?: string) => (id === g.homeId ? g.awayId : g.homeId);
  // g.goalies is kept current by observePlay().

  // A new goalie making a save in regulation: the one before was pulled, if he'd faced shots (the box score's
  // first goalie at the first read can be the backup: then this is the starter's first save, not a pull).
  const [saver] = role(p, 'saver'), was = g.goalies.get(other(p.teamId));
  const line = was ? g.goalieLine?.[was] : undefined;
  if (saver && was && saver !== was && (p.periodNum ?? 0) <= 3 && line && line.sa > 0 && !g.pulled?.has(was)) {
    (g.pulled ??= new Set()).add(was);
    out.push(mk(g, p, 'nhl.goalie.pulled', was, `${nameOf('nhl', was)} got pulled after allowing ${line.ga} goal${line.ga === 1 ? '' : 's'} on ${line.sa} shot${line.sa === 1 ? '' : 's'}`, { body: `${nameOf('nhl', saver)} is in net — ${scoreLine(g, p)}` }));
  }
  if (g.shootout && shooter && /^(Missed|Shot)$/.test(p.type)) {
    // The shootout: a miss or a save is its own alert, in place of the shot's.
    const kind = p.type === 'Missed' ? 'nhl.shot_missed' : 'nhl.shot_saved';
    // No score: a shootout play's isn't the game's, and finished games show the shootout's final tally on all of them.
    out.push(mk(g, p, 'nhl.shootout_miss', shooter, `${nameOf('nhl', shooter)} ${p.type === 'Missed' ? 'missed' : 'got stopped'} in the shootout`, { aliases: [kind], body: `Shootout: ${p.text}` }));
    return out;
  }
  if (slug === 'goal' || p.type === 'Goal') {
    const goalie = g.goalies.get(other(p.teamId));
    if (goalie && !/empty net/i.test(p.text) && p.strength !== 'Empty Net' && !g.shootout) out.push(mk(g, p, 'nhl.goalie.goal_allowed', goalie, `${nameOf('nhl', goalie)} let one in 🥅`));
  } else if (shooter && (slug === 'shot-missed' || p.type === 'Missed')) {
    out.push(mk(g, p, 'nhl.shot_missed', shooter, `${nameOf('nhl', shooter)} shot and missed${/post|crossbar/i.test(p.text) ? ' (rang iron)' : ''}`));
  } else if (shooter && (slug === 'shot-blocked' || p.type === 'Blocked')) {
    out.push(mk(g, p, 'nhl.shot_blocked', shooter, `${nameOf('nhl', shooter)} got a shot blocked`));
  } else if (shooter && (slug === 'shot-on-goal' || p.type === 'Shot')) {
    out.push(mk(g, p, 'nhl.shot_saved', shooter, `${nameOf('nhl', shooter)} got stoned`));
  } else if (/giveaway/i.test(p.type) && p.participants[0]) {
    out.push(mk(g, p, 'nhl.giveaway', p.participants[0].id, `${nameOf('nhl', p.participants[0].id)} gave the puck away`));
  } else if (p.penaltyMinutes && p.participants[0]) {
    const who = p.participants[0].id;
    // Thrown out: a game misconduct or a match penalty (a plain misconduct is 10 minutes, then back). It's
    // their penalty alert too (aliases): one alert. An instigator's misconduct and game misconduct come as
    // two plays at the same moment (Olivier, 14:27 of the 3rd): one moment, the ejection a line on the first.
    const ejected = /game misconduct|match penalty|^match$/i.test(p.type);
    const moment = { moment: `${g.gameId}:penalty:${who}:${p.periodNum ?? ''}:${p.clockSec ?? p.id}` };
    // A fight ("Mathieu Olivier Fighting against Arber Xhekaj"): its own alert, counting as the penalty.
    const fight = /\bfighting\b/i.test(p.text) ? p.text.match(/fighting against (.+?)$/i)?.[1] ?? '' : null;
    out.push(ejected
      ? mk(g, p, 'player.ejected', who, `${nameOf('nhl', who)} got ejected (${p.type.toLowerCase()})`, { aliases: ['nhl.penalty'], fold: `Ejected (${p.type.toLowerCase()}).`, ...moment })
      : fight !== null
        ? mk(g, p, 'nhl.fight', who, `${nameOf('nhl', who)} dropped the gloves${fight ? ` with ${fight}` : ''}`, { aliases: ['nhl.penalty'], fold: 'A fight.', ...moment })
        : mk(g, p, 'nhl.penalty', who, `${nameOf('nhl', who)} went to the box (${p.penaltyMinutes} min, ${p.type})`, { fold: `${p.penaltyMinutes} minutes in the box.`, ...moment }));
  }
  return out;
}

/**
 * Soccer, from the key events (fromKeyEvents). Alerts are `<league>.*` (the EPL's are `epl.*`), so another
 * league can share these the way the WNBA shares the NBA's. g.goalies and g.sentOff are kept by observePlay().
 * A red card or a missed penalty is one alert type for the player and their team: the two share a moment,
 * so tracking both gets you one.
 */
function soccer(g: GameCtx, p: NPlay): Detected[] {
  const lg = g.league, out: Detected[] = [];
  const who = p.participants[0]?.id;
  const other = (id?: string) => (id === g.homeId ? g.awayId : id === g.awayId ? g.homeId : undefined);
  const forTeam = (type: string, title: string, moment: string): Detected => ({
    id: `${g.gameId}:${p.id}:${type}:team-${p.teamId}`, type, targetKey: teamKey(lg, p.teamId!), title,
    body: `${p.text} — ${scoreLine(g, p)}`, at: p.at, meta: { gameId: g.gameId, playId: p.id }, moment,
  });
  if (p.scoring) {
    // An own goal is credited to the team it counts for, so either way the other side conceded.
    const conceding = other(p.teamId);
    const keeper = conceding ? g.goalies.get(conceding) : undefined;
    const own = /^own goal/i.test(p.type) ? who : undefined;
    if (own) out.push(mk(g, p, `${lg}.own_goal`, own, `${nameOf(lg, own)} scored an own goal 🤡`, own === keeper ? { aliases: [`${lg}.goal_conceded`] } : {}));
    if (keeper && keeper !== own) out.push(mk(g, p, `${lg}.goal_conceded`, keeper, `${nameOf(lg, keeper)} conceded a goal 🥅`));
  } else if (who && p.teamId && /^penalty\b/i.test(p.type)) { // "Penalty - Saved", "Penalty - Missed"
    const what = /saved/i.test(p.type) ? 'had a penalty saved' : 'missed a penalty';
    const type = `${lg}.penalty_missed`, moment = `${g.gameId}:${p.id}:penalty`;
    out.push(mk(g, p, type, who, `${nameOf(lg, who)} ${what} 😬`, { moment }));
    out.push(forTeam(type, `${teamName(lg, p.teamId)} ${what} 😬`, moment));
  } else if (who && /^yellow card/i.test(p.type)) {
    out.push(mk(g, p, `${lg}.yellow_card`, who, `${nameOf(lg, who)} was booked 🟨`));
  } else if (p.typeSlug === 'substitution') {
    out.push(...earlySub(g, p));
  } else if (who && p.teamId && /^red card/i.test(p.type)) {
    const type = `${lg}.red_card`, moment = `${g.gameId}:${p.id}:red`;
    const left = 11 - ((g.sentOff?.[p.teamId] ?? 0) + 1); // observePlay counts this one after the detectors run
    out.push(mk(g, p, type, who, `${nameOf(lg, who)} was sent off${/second yellow/i.test(p.text) ? ' (second yellow)' : ''} 🟥`, { moment }));
    out.push(forTeam(type, `${teamName(lg, p.teamId)} are down to ${left} men 🟥`, moment));
  }
  return out;
}

/**
 * Soccer fouls (fromCommentary): the fouler's alert, and for a penalty conceded the fouler's and their
 * team's, sharing a moment (one alert for someone tracking both). A penalty conceded counts as the
 * player's foul too (aliases), so it's never two alerts for one foul.
 */
export function soccerFoul(g: GameCtx, p: NPlay): Detected[] {
  const lg = g.league, [fouler] = role(p, 'fouler');
  if (!fouler || !p.teamId) return [];
  const body = `${p.text} — ${scoreLine(g, p)}`;
  if (p.typeSlug === 'penalty-conceded') {
    const type = `${lg}.penalty_conceded`, moment = `${g.gameId}:${p.id}:penalty-conceded`;
    return [
      mk(g, p, type, fouler, `${nameOf(lg, fouler)} gave away a penalty 🤦`, { moment, aliases: [`${lg}.foul`] }),
      { id: `${g.gameId}:${p.id}:${type}:team-${p.teamId}`, type, targetKey: teamKey(lg, p.teamId), title: `${teamName(lg, p.teamId)} gave away a penalty 🤦`, body, at: p.at, meta: { gameId: g.gameId, playId: p.id }, moment },
    ];
  }
  const what = p.typeSlug === 'handball' ? 'was called for a handball' : p.typeSlug === 'simulation' ? 'went down, and the referee called it a dive 🤿' : 'committed a foul';
  return [mk(g, p, `${lg}.foul`, fouler, `${nameOf(lg, fouler)} ${what}`)];
}

/** Whoever made a play: the catalog's name, or the one in its text ("Lisandro Martínez (Manchester United) Interception at 2'"). */
const whoDid = (lg: League, p: NPlay) => {
  const id = p.participants[0]?.id;
  return (id && catalog.playerByEspn(lg, id)?.name) || p.text.match(/^(.+?) \(/)?.[1] || 'an opponent';
};
/** The other team's play that took the ball off a pass: how it went wrong. */
const PASS_LOST: Record<string, string> = { interception: 'intercepted by', 'blocked-pass': 'blocked by', clear: 'cleared by', pass: 'straight to', 'take-on': 'straight to', cross: 'straight to', 'ball-recovery': 'picked up by' };

/**
 * Soccer touches, from the full play-by-play (the core feed: every pass, dribble and tackle). ESPN
 * doesn't say whether a pass or a dribble worked, so it's judged from the next touch:
 * - a dribble ("Take On") straight into the other team's tackle lost the ball; so does being
 *   "Dispossessed" (always followed by the tackle that did it);
 * - a pass whose next touch is the other team's (intercepted, blocked, cleared, or played on by them) was
 *   given away. Their foul, a failed tackle or a header duel is not.
 * Checked against Fulham 1-1 Man United (2026-09-20): 14 of 29 take-ons ended in the other team's tackle.
 */
export function soccerTouch(g: GameCtx, p: NPlay, next: NPlay): Detected[] {
  const lg = g.league, who = p.participants[0]?.id;
  if (!who || !p.teamId || !next.teamId || next.teamId === p.teamId) return [];
  const body = (what: string) => `${[p.clock, what].filter(Boolean).join(' ')} — ${scoreLine(g, p)}`;
  if ((p.typeSlug === 'take-on' || p.typeSlug === 'dispossessed') && next.typeSlug === 'tackle') {
    const how = p.typeSlug === 'take-on' ? `Tackled trying to get past ${whoDid(lg, next)}` : `Dispossessed by ${whoDid(lg, next)}`;
    return [mk(g, p, `${lg}.lost_ball`, who, `${nameOf(lg, who)} lost the ball`, { body: body(how) })];
  }
  if (p.typeSlug === 'pass' && PASS_LOST[next.typeSlug]) {
    return [mk(g, p, `${lg}.pass_given_away`, who, `${nameOf(lg, who)} gave the ball away`, { body: body(`Pass ${PASS_LOST[next.typeSlug]} ${whoDid(lg, next)}`) })];
  }
  return [];
}

// F1 has no play-by-play; its alerts come from session results (f1.ts). Every soccer league uses the soccer detectors.
type Detector = (g: GameCtx, p: NPlay) => Detected[];
const OTHER_DETECTORS: Partial<Record<League, Detector>> = { mlb, nfl, cfb: (g, p) => [...nfl(g, p), ...cfbTeamPlays(g, p)], nba, wnba: nba, nhl, f1: () => [] };
export const PLAYER_DETECTORS = Object.fromEntries(LEAGUE_IDS.map((lg) => [lg, SOCCER.has(lg) ? soccer : OTHER_DETECTORS[lg]])) as Record<League, Detector>;

// ─── Team in-game detectors (score-delta based, so they work identically for every league) ───
/**
 * Only scoring plays move the score. ESPN back-fills the running score onto neighbouring
 * non-scoring plays (timeouts, "X pitches to Y"), which would misattribute the event.
 */
export function nextScore(prev: { home: number; away: number }, p: NPlay) {
  if (!p.scoring) return prev;
  return { home: Math.max(prev.home, p.home), away: Math.max(prev.away, p.away) };
}

export const START_WORD = { nfl: 'Kickoff', cfb: 'Kickoff', nba: 'Tip-off', wnba: 'Tip-off', nhl: 'Puck drop', mlb: 'First pitch', f1: 'Lights out', ...Object.fromEntries([...SOCCER].map((lg) => [lg, 'Kickoff'])) } as Record<League, string>;
/** "the Falcons", but plain "Liverpool": clubs don't take "the". */
/** A team's verb: "the Yankees have", but a school's singular ("Nebraska has"). */
export const have = (lg: League) => (TEAMS_ONLY.has(lg) ? 'has' : 'have');
export const are = (lg: League) => (TEAMS_ONLY.has(lg) ? 'is' : 'are');
/** "the Rays"; a soccer club or a school is just its name ("Arsenal", "Nebraska"). */
const the = (lg: League, team: string) => (SOCCER.has(lg) || TEAMS_ONLY.has(lg) ? team : `the ${team}`);

/**
 * "Hate Watch Starting" for both teams, each from its own side ("Eagles vs Bears" / "Bears vs Eagles"). One game is one
 * start for a device tracking both teams: they share a moment, and it gets the one about the team it followed first.
 */
export function gameStartEvents(g: Pick<GameCtx, 'league' | 'gameId' | 'homeId' | 'awayId'>, info: { venue?: string; tv?: string }, at: number): Detected[] {
  const body = [`${START_WORD[g.league]}${info.venue ? ` at ${info.venue}` : ''}`, info.tv].filter(Boolean).join(' · ');
  return [[g.homeId, g.awayId], [g.awayId, g.homeId]].map(([teamId, oppId]) => ({
    id: `${g.gameId}:team.game_start:${teamId}`,
    type: 'team.game_start',
    targetKey: teamKey(g.league, teamId),
    title: `Hate Watch Starting: ${teamName(g.league, teamId)} vs ${teamName(g.league, oppId)}`,
    body,
    at,
    moment: `${g.gameId}:start`,
    firstFollowed: true,
    meta: { gameId: g.gameId },
  }));
}

/** ESPN's short names for rounds that aren't household words. */
const ROUND_NAMES: Record<string, string> = { ALWC: 'AL Wild Card Series', NLWC: 'NL Wild Card Series' };

/** A playoff loss that ends a team's season: who, whether it was a sweep, and the line that says so. */
export interface Elimination { loserId: string; winnerId: string; sweep: boolean; line: string }

/**
 * Knocked out of the playoffs, from the final on the scoreboard. MLB, the NBA, the WNBA and the NHL play
 * series, with each side's wins on the scoreboard ("NYY win series 2-0"): the side with fewer is out when
 * ESPN marks the series completed, or when this game is the one that wins it (the scoreboard can show a
 * final before it counts it: the wins add up to one less than "Game 3"). In the NFL every postseason
 * game is a knockout. The standings never mark these teams eliminated (they keep the "x"/"y" they
 * clinched with). A series lost without a win is a sweep: "Swept 3-0 by the Rays in the ALDS".
 */
export function eliminationOf(lg: League, ev: any): Elimination | null {
  const c = ev?.competitions?.[0];
  if (ev?.season?.type !== 3 || !ev.status?.type?.completed || !c) return null;
  const headline = String(c.notes?.[0]?.headline ?? '');
  const said = headline.replace(/\s*-\s*Game \d+$/i, '').trim(); // "ALDS - Game 3" → "ALDS"
  const round = ROUND_NAMES[said] ?? said;
  const [x, y] = c.competitors ?? [];
  if (!x || !y || Number(x.score) === Number(y.score)) return null;
  const gameWinner = String(Number(x.score) > Number(y.score) ? x.id : y.id);
  if (c.series?.type === 'playoff') {
    const sides: { id: string; wins: number }[] = (c.series.competitors ?? []).map((t: any) => ({ id: String(t.id), wins: Number(t.wins) || 0 }));
    if (sides.length !== 2) return null;
    const game = Number(headline.match(/\bGame (\d+)$/i)?.[1]);
    const counted = !game || sides[0].wins + sides[1].wins >= game;
    if (!counted) { const w = sides.find((t) => t.id === gameWinner); if (w) w.wins++; }
    const need = Math.floor(Number(c.series.totalCompetitions) / 2) + 1;
    const [lose, win] = sides[0].wins < sides[1].wins ? [sides[0], sides[1]] : [sides[1], sides[0]];
    if (lose.wins === win.wins || (!c.series.completed && win.wins < need)) return null;
    const winner = the(lg, teamName(lg, win.id)), score = `${win.wins}-${lose.wins}`, sweep = lose.wins === 0;
    return { loserId: lose.id, winnerId: win.id, sweep, line: sweep ? `Swept ${score} by ${winner}${round ? ` in the ${round}` : ''}` : `Lost the ${round || 'series'} ${score} to ${winner}` };
  }
  if (!FOOTBALL.has(lg)) return null;
  // College: a bowl game isn't an elimination; the College Football Playoff is.
  if (TEAMS_ONLY.has(lg) && !/playoff/i.test(headline)) return null;
  const loserId = String(gameWinner === String(x.id) ? y.id : x.id), winner = the(lg, teamName(lg, gameWinner));
  return { loserId, winnerId: gameWinner, sweep: false, line: /super bowl/i.test(round) ? `Lost ${round} to ${winner}` : `Lost to ${winner}${round ? ` in the ${round}` : ''}` };
}

/**
 * Losing by this much is a blowout, and the loss alert says so ("Yankees got BLOWN OUT by the Rays",
 * "A 10-run blowout."). Set so about 1 in 8 losses qualifies, from full 2025-26 seasons of four teams a
 * league: MLB 7+ runs is 12% of losses (6+ is 20%), NFL 21+ points (three scores) 14%, NBA 25+ 14% (20+
 * is 26%), WNBA 20+ 11%, NHL 4+ goals 19% (5+ is only 7%), soccer 3+ goals 12% (its "thrashed").
 */
/** "an 8-run", "an 11-point", "an 18-point", "a 15-point". */
export const aOrAn = (n: number) => (n === 11 || n === 18 || String(n).startsWith('8') ? 'an' : 'a');

export const BLOWOUT_MARGIN: Partial<Record<League, number>> = { mlb: 7, nfl: 21, cfb: 42, nba: 25, wnba: 20, nhl: 4, ...Object.fromEntries([...SOCCER].map((lg) => [lg, 3])) };
const MARGIN_UNIT: Partial<Record<League, string>> = { mlb: 'run', nhl: 'goal' };
export const isBlowout = (lg: League, margin: number) => BLOWOUT_MARGIN[lg] != null && margin >= BLOWOUT_MARGIN[lg]!;

/**
 * The loser's final-whistle alert. Ties (NFL, NHL preseason) are miserable for everyone, but not a loss.
 * Its moment is shared with the "their team lost" alerts for the loser's players (playerTeamLostEvents).
 * A playoff loss that ends their season (`out`, from eliminationOf) says so, in the same alert:
 * "Successful Hate Watch! Yankees got SWEPT 🧹 and are ELIMINATED ⚰️", "Swept 3-0 by the Rays in the
 * ALDS. Final Score: 5 to 2". It counts for "Loses a game" and for "Eliminated from playoffs" (aliases):
 * one alert, for anyone who wants either.
 */
export function gameLostEvent(g: Pick<GameCtx, 'league' | 'gameId' | 'homeId' | 'awayId'>, final: { home: number; away: number }, at: number, out?: Elimination | null): Detected | null {
  if (final.home === final.away) return null;
  const [loserId, winnerId] = final.home < final.away ? [g.homeId, g.awayId] : [g.awayId, g.homeId];
  const [w, l] = [Math.max(final.home, final.away), Math.min(final.home, final.away)];
  const team = teamName(g.league, loserId), winner = the(g.league, teamName(g.league, winnerId));
  const elim = out?.loserId === loserId ? out : null;
  const blowout = isBlowout(g.league, w - l);
  // "Final Score: 12 to 2. A 10-run blowout." (soccer's "thrashed" title says it already).
  const by = w - l, an = aOrAn(by) === 'an' ? 'An' : 'A'; // "An 8-run", "An 11-point"
  const score = `Final Score: ${w} to ${l}${blowout && !SOCCER.has(g.league) ? `. ${an} ${by}-${MARGIN_UNIT[g.league] ?? 'point'} blowout.` : ''}`;
  const what = elim ? (elim.sweep ? `${team} got SWEPT 🧹 and are ELIMINATED ⚰️` : `${team} ${are(g.league)} ELIMINATED ⚰️`)
    : blowout ? (SOCCER.has(g.league) ? `${team} were thrashed ${w}-${l} by ${winner}` : `${team} got BLOWN OUT by ${winner}`)
    : `${team} lost to ${winner}`;
  return {
    id: `${g.gameId}:final:team.lost:${loserId}`,
    type: 'team.lost',
    targetKey: teamKey(g.league, loserId),
    title: `Successful Hate Watch! ${what}`,
    body: elim ? `${elim.line}. ${score}` : score,
    at,
    meta: { gameId: g.gameId, winnerId, margin: w - l, score: `${w}-${l}`, ...(blowout ? { blowout: true } : {}), ...(elim ? { eliminated: true, sweep: elim.sweep } : {}) },
    ...(elim ? { aliases: ['team.eliminated'] } : {}),
    moment: `${g.gameId}:final:lost`,
  };
}

/**
 * Soccer: "Successful Hate Watch! Coventry were thrashed 5-0 by Brighton", a loss by three goals or more.
 * It has the loss's moment and goes out first, so anyone with it on gets it instead of the plain loss;
 * it's the same Successful Hate Watch (`lostId`: counted once, see hateWatchOf).
 */
export function heavyLossEvent(g: Pick<GameCtx, 'league' | 'gameId'>, lost: Detected, final: { home: number; away: number }): Detected | null {
  const [w, l] = [Math.max(final.home, final.away), Math.min(final.home, final.away)];
  if (!SOCCER.has(g.league) || !isBlowout(g.league, w - l)) return null;
  const loserId = lost.targetKey.split(':')[2], winnerId = String(lost.meta?.winnerId ?? '');
  return {
    id: `${g.gameId}:final:${g.league}.team.heavy_loss:${loserId}`,
    type: `${g.league}.team.heavy_loss`,
    targetKey: lost.targetKey,
    title: `Successful Hate Watch! ${teamName(g.league, loserId)} were thrashed ${w}-${l} by ${the(g.league, teamName(g.league, winnerId))}`,
    body: lost.body,
    at: lost.at,
    meta: { gameId: g.gameId, winnerId, lostId: lost.id, teamKey: lost.targetKey },
    moment: lost.moment,
  };
}

/**
 * "Successful Hate Watch! Freddie Freeman and the Dodgers lost to the Giants", for people who track a
 * player on the losing team (`players`: the ones anyone tracks). Every one shares the loss's moment, and
 * publish() sends a device one of them, so tracking the player and the team, or two players on it, is one
 * alert. Publish the team's loss first (it wins), then these: of those, a device gets the player it
 * started tracking first (firstFollowed), by name when it followed them in the same moment. Each counts as a
 * Successful Hate Watch for the team (`lostId`, `teamKey`: see hateWatchOf), once per device.
 */
export function playerTeamLostEvents(g: Pick<GameCtx, 'league' | 'gameId'>, lost: Detected, players: { key: string; espnId: string; name: string }[]): Detected[] {
  const loserId = lost.targetKey.split(':')[2];
  const winnerId = (lost.meta?.winnerId as string | undefined) ?? '';
  const team = teamName(g.league, loserId), winner = teamName(g.league, winnerId);
  // A blowout says so here too ("got BLOWN OUT by"); an elimination's own line is in the body.
  const how = lost.meta?.blowout && !lost.meta?.eliminated ? (SOCCER.has(g.league) ? `were thrashed ${lost.meta.score} by` : 'got BLOWN OUT by') : 'lost to';
  return [...players].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({
    id: `${g.gameId}:final:player.team_lost:${p.espnId}`,
    type: 'player.team_lost',
    targetKey: p.key,
    title: `Successful Hate Watch! ${p.name} and ${the(g.league, team)} ${how} ${the(g.league, winner)}`,
    body: lost.body,
    at: lost.at,
    meta: { gameId: g.gameId, athleteId: p.espnId, lostId: lost.id, teamKey: lost.targetKey },
    moment: lost.moment,
    firstFollowed: true,
  }));
}

/**
 * A team's alerts for a play that scored on them. They're one moment per team: blowing a big lead (`led`:
 * each side's biggest lead before this play, live.ts), falling behind, and being scored on are one alert
 * for a device, the first it wants of those three. A team blows a lead once a game (`g.blewLead`).
 */
export function teamScoreEvents(g: GameCtx, prev: { home: number; away: number }, p: NPlay, led?: { home: number; away: number }): Detected[] {
  const out: Detected[] = [];
  // Basketball: points scored against each side in a row, for "on a 14-0 run".
  const runBefore = { ...(g.run ?? { home: 0, away: 0 }) };
  if (BASKETBALL.has(g.league)) {
    const dh = p.home - prev.home, da = p.away - prev.away;
    g.run = { home: dh > 0 ? 0 : runBefore.home + Math.max(0, da), away: da > 0 ? 0 : runBefore.away + Math.max(0, dh) };
  }
  for (const side of ['home', 'away'] as const) {
    const teamId = side === 'home' ? g.homeId : g.awayId;
    const oppId = side === 'home' ? g.awayId : g.homeId;
    const opp = side === 'home' ? 'away' : 'home';
    const delta = p[opp] - prev[opp];
    const base = { targetKey: teamKey(g.league, teamId), at: p.at, body: `${p.text} — ${scoreLine(g, p)}`, meta: { gameId: g.gameId, playId: p.id } };
    const [team, oppName] = [teamName(g.league, teamId), teamName(g.league, oppId)];
    const what = g.league === 'nhl' || SOCCER.has(g.league) ? 'scored' : g.league === 'mlb' ? `scored ${delta} run${delta > 1 ? 's' : ''}` : `scored ${delta}`;
    const safety = delta === 2 && FOOTBALL.has(g.league) && isSafety(p);
    // Falling behind can only happen because the opponent just scored, so the two alerts always
    // coincide. The fell-behind alert carries both facts; the scored-on alert for this play is
    // then `unless` it: each user gets one (the combined one if they want "falls behind").
    const fellBehind = prev[side] - prev[opp] >= 0 && p[side] - p[opp] < 0;
    const unlessBehind = fellBehind ? { unless: 'team.fell_behind' } : {};
    // The play's moment for this team (shared with its players' alerts: bundleByPlay); the three are alternatives.
    const moment = { moment: playMoment(g.gameId, p.id, teamKey(g.league, teamId)), alt: 'scored-on' };
    const lead = led?.[side] ?? 0;
    if (fellBehind && lead >= (BLEW_LEAD_LIVE[g.league] ?? Infinity) && !g.blewLead?.has(teamId)) {
      (g.blewLead ??= new Set()).add(teamId);
      const unit = MARGIN_UNIT[g.league] ?? (SOCCER.has(g.league) ? 'goal' : 'point');
      out.push({ id: `${g.gameId}:${p.id}:team.blew_lead:${teamId}`, type: 'team.blew_lead', title: `${team} blew ${aOrAn(lead)} ${lead}-${unit} lead to ${the(g.league, oppName)}`, ...base, meta: { ...base.meta, led: lead }, ...moment,
        fold: `${team} blew ${aOrAn(lead)} ${lead}-${unit} lead.` });
    }
    // Soccer: a goal against in the last minutes that takes away a lead or a draw (late_goal), before "falls behind".
    const minute = soccerMinute(p.clock);
    const equalized = prev[side] - prev[opp] > 0 && p[side] === p[opp];
    if (SOCCER.has(g.league) && delta > 0 && minute >= LATE_MINUTE && (fellBehind || equalized)) {
      const when = /\+/.test(p.clock ?? '') ? `stoppage time (${p.clock})` : `the ${ordinal(minute)} minute`;
      out.push({ id: `${g.gameId}:${p.id}:${g.league}.team.late_goal:${teamId}`, type: `${g.league}.team.late_goal`, aliases: [fellBehind ? 'team.fell_behind' : 'team.opponent_scored'],
        title: fellBehind ? `${oppName} took the lead against ${team} in ${when}` : `${oppName} equalized against ${team} in ${when}`,
        ...base, ...moment, fold: fellBehind ? `A go-ahead goal in ${when}.` : `An equalizer in ${when}.` });
    }
    if (fellBehind) {
      out.push({
        id: `${g.gameId}:${p.id}:team.fell_behind:${teamId}`, type: 'team.fell_behind',
        title: safety ? `${team} gave up a safety and fell behind the ${oppName}` : `${oppName} ${what} to take the lead over ${the(g.league, team)}`,
        ...base, ...moment, fold: safety ? `${team} gave up a safety and fell behind.` : `${oppName} took the lead.`,
      });
    }
    // NHL: an empty-net goal or a short-handed one against them (they were on the power play), counting as "opponent scores".
    if (g.league === 'nhl' && delta > 0 && (p.strength === 'Empty Net' || p.strength === 'Shorthanded')) {
      const en = p.strength === 'Empty Net';
      out.push({ id: `${g.gameId}:${p.id}:nhl.team.${en ? 'empty_net_goal' : 'shorthanded_goal'}:${teamId}`, type: en ? 'nhl.team.empty_net_goal' : 'nhl.team.shorthanded_goal', aliases: ['team.opponent_scored'],
        title: en ? `${team} gave up an empty-netter to the ${oppName}` : `${team} gave up a short-handed goal to the ${oppName}`, ...base, ...moment,
        fold: en ? 'Into an empty net.' : 'A short-handed goal, on their own power play.' });
    }
    if (safety) {
      // Replaces "opponent scored 2" for this play, and counts as that toggle too.
      out.push({ id: `${g.gameId}:${p.id}:${footballType(g.league, 'safety')}:team-${teamId}`, type: footballType(g.league, 'safety'), aliases: ['team.opponent_scored'], title: `${team} gave up a safety`, ...base, ...unlessBehind, ...moment, fold: `${team} gave up a safety.` });
    } else if (delta > 0 && !BASKETBALL.has(g.league)) {
      out.push({ id: `${g.gameId}:${p.id}:team.opponent_scored:${teamId}`, type: 'team.opponent_scored', title: SOCCER.has(g.league) ? `${oppName} scored against ${team}` : `${oppName} ${what} on ${the(g.league, team)}`, ...base, ...unlessBehind, ...moment,
        fold: `${oppName} ${what}.` });
    }
    // Basketball: the other side's run reached RUN_POINTS on this play (once a run). A line on that play's
    // alert, not an alternative to it: "Knicks took the lead." and "It's a 14-0 Knicks run."
    const run = g.run?.[side] ?? 0, need = RUN_POINTS[g.league as 'nba' | 'wnba'];
    if (BASKETBALL.has(g.league) && need && runBefore[side] < need && run >= need) {
      out.push({ id: `${g.gameId}:${p.id}:${g.league}.team.opponent_run:${teamId}`, type: `${g.league}.team.opponent_run`, title: `${oppName} are on ${aOrAn(run)} ${run}-0 run against the ${team}`,
        ...base, moment: moment.moment, fold: `It's ${aOrAn(run)} ${run}-0 ${oppName} run.` });
    }
  }
  return out;
}

// ─── A loss's facts: one alert per device, with every fact it wants (publish, Detected.fold) ────────
/**
 * What the game tracker knew before the game, for the facts of a loss (live.ts keeps it in kv, so a
 * restart mid-game still has it). Every part is optional: a fact without its input is left out.
 */
export interface Pregame {
  /** Each side's chance to win from the betting line (lineChances), in percents. */
  chance?: { home: number; away: number };
  /** Records before the game: "45-37", NHL "40-30-12" (W-L-OTL), NFL "8-8-1" (W-L-T). */
  records?: { home?: string; away?: string };
  /** ESPN's standings streak before the game: "L3", "W2". */
  streak?: { home?: string; away?: string };
  /** Regular season: this game's place among the meetings with this opponent (seriesSpot). */
  series?: { home?: SeriesSpot; away?: SeriesSpot };
  /** ESPN's season type: 1 preseason, 2 regular season, 3 postseason. Streaks count in the regular season only. */
  seasonType?: number;
  /** College football: each side's top-25 ranking going in (none: unranked). */
  ranks?: { home?: number; away?: number };
}
/**
 * MLB: the games just before this one against the same opponent (its series), and whether this one ends
 * it. Everyone else: the season's other meetings (a season series), and whether this is the last.
 */
export interface SeriesSpot { kind: 'series' | 'season'; before: number; lostBefore: number; last: boolean }

/** Basketball: points in a row against a team for "on a run" (NBA 14-0: 10% of team-games; WNBA 12-0: 18%). */
export const RUN_POINTS = { nba: 14, wnba: 12 };
/** Soccer: a goal against from this minute on, taking a lead or a draw away, is a late goal. */
export const LATE_MINUTE = 85;
/** A soccer clock's minute: "57'" → 57, "90'+4'" → 94. */
export const soccerMinute = (clock?: string) => { const m = String(clock ?? '').match(/^(\d+)'(?:\s*\+\s*(\d+))?/); return m ? Number(m[1]) + Number(m[2] ?? 0) : 0; };

/*
 * The thresholds, each set so the fact is news, from 1,807 decided regular-season games (2025-26 NBA, NHL,
 * NFL and EPL, 2026 MLB and WNBA) and every team's 2025-26 schedule. Share of losses each one fires on:
 *   lost as favorite   MLB 62%+: 5%   NBA 75%+: 6%   WNBA 75%+: 5%   NFL 75%+: 8%   NHL 65%+: 5%   EPL 60%+: 4%
 *   blew a lead, lost  MLB 3: 9%   NBA 15: 8%   WNBA 12: 11%   NFL 14: 5%   NHL 2: 10%   EPL 2: 1%
 *   live, of games     MLB 5: 2%   NBA 18: 7%   WNBA 15: 6%   NFL 17: 3%   NHL 3: 2%    EPL 2: 1%  (a push)
 *   last seconds       MLB walk-off 7%   NBA/WNBA 10s: 4%   NFL 30s in the 4th: 13%, OT 5%   NHL OT/SO 28%   EPL 90'+: 12%
 *   shut out           MLB 14%   NHL 8%   NFL 2%   (EPL 51%: not news, left out)
 *   worse team         MLB .15: 6%   NBA .20: 9%   WNBA .20: 7%   NFL .20: 12%   NHL .15: 8%
 *   below .500         MLB 3.6%   NBA 1.1%   WNBA 2.7%   NFL 6.3%   NHL 2.7%
 */
/** The loser's chance to win before the game, at least (percent). */
export const FAVORITE_CHANCE: Partial<Record<League, number>> = { mlb: 62, nba: 75, wnba: 75, nfl: 75, cfb: 80, nhl: 65, ...Object.fromEntries([...SOCCER].map((lg) => [lg, 60])) };
/** The loser's biggest lead, at least (points, runs or goals), for the line on the loss. */
export const BLEW_LEAD: Partial<Record<League, number>> = { mlb: 3, nba: 15, wnba: 12, nfl: 14, cfb: 17, nhl: 2, ...Object.fromEntries([...SOCCER].map((lg) => [lg, 2])) };
/** The same, live: losing a lead this big is an alert of its own (a push), so it takes more. */
export const BLEW_LEAD_LIVE: Partial<Record<League, number>> = { mlb: 5, nba: 18, wnba: 15, nfl: 17, cfb: 21, nhl: 3, ...Object.fromEntries([...SOCCER].map((lg) => [lg, 2])) };
/** The winner's go-ahead score with this many seconds left or fewer (NBA and WNBA in the 4th or OT, NFL in the 4th). */
export const LAST_SECONDS: Partial<Record<League, number>> = { nba: 10, wnba: 10, nfl: 30, cfb: 30 };
/** "Lost to a worse team": the winner's win percentage at least this far below the loser's, both MIN_GAMES in. */
export const WORSE_GAP: Partial<Record<League, number>> = { mlb: 0.15, nba: 0.2, wnba: 0.2, nfl: 0.2, cfb: 0.25, nhl: 0.15 };
export const MIN_GAMES: Partial<Record<League, number>> = { mlb: 20, nba: 10, wnba: 8, nfl: 4, cfb: 4, nhl: 10 };
/** The winner's top scorer, at least, for "their star went off" (NBA, WNBA). */
export const STAR_POINTS = { nba: 40, wnba: 30 };
/** A power play with no goal on at least this many chances (NHL). */
export const PP_FAIL = 4;
/** A sweep takes this many games: an MLB series of 3+, a season series of 3+ (NFL division rivals meet twice). */
export const SWEEP_GAMES: Partial<Record<League, number>> = { mlb: 3, nba: 3, wnba: 3, nfl: 2, nhl: 3 };

/** Wins, losses and the rest from a record ("40-30-12"): NHL's third is OT losses, the NFL's ties. */
export function parseRecord(rec: string | undefined): { w: number; l: number; x: number } | null {
  const m = String(rec ?? '').match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  return m ? { w: Number(m[1]), l: Number(m[2]), x: Number(m[3] ?? 0) } : null;
}
/** Win percentage: NHL points percentage, the NFL with ties as half. */
function winPct(lg: League, r: { w: number; l: number; x: number }) {
  const gp = r.w + r.l + r.x;
  if (!gp) return 0;
  return lg === 'nhl' ? (2 * r.w + r.x) / (2 * gp) : (r.w + (FOOTBALL.has(lg) ? r.x / 2 : 0)) / gp;
}

/** The play on which the winner went ahead for good, and each side's biggest lead, from every play of the game. */
export function leadStory(plays: NPlay[], winner: 'home' | 'away') {
  let score = { home: 0, away: 0 }, goAhead: NPlay | undefined;
  const led = { home: 0, away: 0 };
  for (const p of plays) {
    const prev = score;
    score = nextScore(prev, p);
    const lead = (s: 'home' | 'away', x: typeof score) => x[s] - x[s === 'home' ? 'away' : 'home'];
    if (lead(winner, prev) <= 0 && lead(winner, score) > 0) goAhead = p;
    led.home = Math.max(led.home, lead('home', score));
    led.away = Math.max(led.away, lead('away', score));
  }
  return { goAhead, led };
}

/** "2.1 seconds", "1 second", "0:24": how much was left on the clock. */
const clockLeft = (lg: League, sec: number) => (FOOTBALL.has(lg) ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : `${Number(sec.toFixed(1))} second${sec === 1 ? '' : 's'}`);

/**
 * A loss's facts, each its own alert type: a walk-off or a last-second loss, a blown lead, losing as the
 * favorite, a shutout, a sweep, losing to a worse team, falling below .500, a losing streak. They share
 * the loss's moment and go out after it: a device that gets the loss gets each fact it wants as a line on
 * it ("Walk-off in the 10th. Lost as 78% favorites. Final Score: 4 to 3"), and one that has the loss off
 * gets the first fact it wants instead, saying the loss too ("Successful Hate Watch! Yankees lost to the
 * Rays as 78% favorites"), with the others on it. `lostId` makes each count as the loss (isLossAlert).
 * Playoff losses skip the regular-season facts (records, sweeps: a playoff sweep is in the loss's title).
 */
export function lossFacts(g: Pick<GameCtx, 'league' | 'gameId' | 'homeId' | 'awayId'>, lost: Detected, final: { home: number; away: number },
  facts: { plays?: NPlay[]; pre?: Pregame; overtime?: 'ot' | 'so' | null; postseason?: boolean; box?: any }): Detected[] {
  const lg = g.league;
  const loserSide: 'home' | 'away' = lost.targetKey === teamKey(lg, g.homeId) ? 'home' : 'away';
  const winnerSide = loserSide === 'home' ? 'away' : 'home';
  const loserId = loserSide === 'home' ? g.homeId : g.awayId, winnerId = loserSide === 'home' ? g.awayId : g.homeId;
  const team = teamName(lg, loserId), winner = teamName(lg, winnerId);
  const unit = MARGIN_UNIT[lg] ?? (SOCCER.has(lg) ? 'goal' : 'point');
  const out: Detected[] = [];
  const fact = (type: string, title: string, fold: string, meta: Record<string, unknown> = {}, foldOnly?: boolean) => out.push({
    id: `${g.gameId}:final:${type}:${loserId}`, type, targetKey: lost.targetKey, title: `Successful Hate Watch! ${title}`, body: lost.body, at: lost.at,
    meta: { gameId: g.gameId, winnerId, lostId: lost.id, teamKey: lost.targetKey, ...meta }, moment: lost.moment, fold, ...(foldOnly ? { foldOnly } : {}),
  });

  // How it ended: the winner's go-ahead in the last seconds, a walk-off, overtime, a stoppage-time winner.
  const story = facts.plays?.length ? leadStory(facts.plays, winnerSide) : null;
  const ga = story?.goAhead;
  if (lg === 'mlb' && winnerSide === 'home' && ga?.period?.type === 'Bottom' && ga.period.number >= 9) {
    fact('team.last_second_loss', `${winner} walked off ${the(lg, team)}${ga.period.number > 9 ? ` in the ${ordinal(ga.period.number)}` : ''}`, `Walk-off loss in the ${ordinal(ga.period.number)}.`);
  } else if (BASKETBALL.has(lg) && ga && (ga.periodNum ?? 0) >= 4 && ga.clockSec != null && ga.clockSec <= LAST_SECONDS[lg]!) {
    const left = ga.clockSec === 0 ? 'at the buzzer' : `with ${clockLeft(lg, ga.clockSec)} left`;
    fact('team.last_second_loss', `${winner} beat ${the(lg, team)} ${left}`, `Beaten ${left}.`);
  } else if (FOOTBALL.has(lg) && ga && ((ga.periodNum ?? 0) >= 5 || ((ga.periodNum ?? 0) === 4 && ga.clockSec != null && ga.clockSec <= LAST_SECONDS[lg]!))) {
    const ot = (ga.periodNum ?? 0) >= 5, left = ga.clockSec === 0 ? 'as time expired' : `with ${clockLeft(lg, ga.clockSec!)} left`;
    fact('team.last_second_loss', ot ? `${team} lost to ${the(lg, winner)} in overtime` : `${winner} beat ${the(lg, team)} ${left}`, ot ? 'Lost in overtime.' : `Beaten ${left}.`);
  } else if (lg === 'nhl' && facts.overtime) {
    const so = facts.overtime === 'so';
    fact('team.last_second_loss', `${team} lost to ${the(lg, winner)} in ${so ? 'a shootout' : 'overtime'}`, `Lost in ${so ? 'a shootout' : 'overtime'}.`);
  } else if (SOCCER.has(lg) && ga?.clock && /^9\d'\s*\+/.test(ga.clock)) {
    fact('team.last_second_loss', `${team} conceded a stoppage-time winner to ${winner}`, `Conceded a stoppage-time winner (${ga.clock}).`);
  }

  // A blown lead: the loser was ahead by this much. Only a line on the loss: its switch is the live alert's
  // too, and with the loss off, a blown lead isn't a reason to hear about the loss.
  const led = story?.led[loserSide] ?? 0;
  if (led >= BLEW_LEAD[lg]!) fact('team.blew_lead', `${team} blew ${aOrAn(led)} ${led}-${unit} lead and lost to ${the(lg, winner)}`, `Blew ${aOrAn(led)} ${led}-${unit} lead.`, { led }, true);

  // Losing as the favorite, from the line before the game.
  const chance = facts.pre?.chance?.[loserSide];
  if (chance != null && chance >= FAVORITE_CHANCE[lg]!) fact('team.lost_as_favorite', `${team} lost to ${the(lg, winner)} as ${chance}% favorites`, `Lost as ${chance}% favorites.`, { chance });

  // College: a ranked team beaten by an unranked one (the ranking going in, ESPN's: the AP's, the playoff committee's late in the season).
  const rank = facts.pre?.ranks?.[loserSide];
  if (TEAMS_ONLY.has(lg) && rank && facts.pre?.ranks && !facts.pre.ranks[winnerSide]) {
    fact('cfb.upset_loss', `No. ${rank} ${team} lost to unranked ${winner}`, `Lost to unranked ${winner} as the No. ${rank} team.`, { rank });
  }

  // A shutout (basketball has none, and in soccer half of all losses are one).
  if (final[loserSide] === 0 && !BASKETBALL.has(lg) && !SOCCER.has(lg)) {
    const [title, fold] = FOOTBALL.has(lg) ? [`${team} ${TEAMS_ONLY.has(lg) ? 'was' : 'were'} held scoreless by ${the(lg, winner)}`, 'Held scoreless.'] : [`${team} were shut out by the ${winner}`, 'Shut out.'];
    fact('team.shut_out', title, fold);
  }

  // From the final box score, each only a line on the loss (with the loss off, they aren't a reason to hear of it):
  // no-hit (MLB), the winner's star going off (NBA 40, WNBA 30: 10% and 13% of losses), a dead power play (NHL 0-for-4+: 13%).
  if (facts.box) {
    const hits = lg === 'mlb' ? boxHits(facts.box) : undefined;
    if (hits?.[loserId] === 0) fact('mlb.team.no_hit', `${team} were no-hit by the ${winner}`, 'No-hit.', {}, true);
    const star = BASKETBALL.has(lg) ? boxTopScorer(facts.box, winnerId) : undefined;
    if (star && star.pts >= STAR_POINTS[lg as 'nba' | 'wnba']) fact(`${lg}.team.star_went_off`, `${nameOf(lg, star.id)} scored ${star.pts} on ${the(lg, team)}`, `${nameOf(lg, star.id)} scored ${star.pts} on them.`, { athleteId: star.id }, true);
    const pp = lg === 'nhl' ? boxPowerPlay(facts.box, loserId) : undefined;
    if (pp && pp.goals === 0 && pp.chances >= PP_FAIL) fact('nhl.team.power_play_fail', `${team} went 0-for-${pp.chances} on the power play and lost`, `0-for-${pp.chances} on the power play.`, {}, true);
  }

  if (!facts.postseason) {
    // A sweep: every game of the series (MLB), or every meeting of the season, lost.
    const spot = facts.pre?.series?.[loserSide];
    if (spot?.last && spot.before + 1 >= (SWEEP_GAMES[lg] ?? Infinity) && spot.lostBefore === spot.before) {
      const n = spot.before + 1;
      fact('team.swept', `${team} got swept by ${the(lg, winner)}`, spot.kind === 'series' ? `Swept in the series, 0-${n}.` : `Swept in the season series, 0-${n}.`, { games: n });
    }
    // Losing to a worse team, and falling below .500, from the records before the game.
    const mine = parseRecord(facts.pre?.records?.[loserSide]), theirs = parseRecord(facts.pre?.records?.[winnerSide]);
    const enough = (r: { w: number; l: number; x: number }) => r.w + r.l + r.x >= (MIN_GAMES[lg] ?? Infinity);
    if (mine && theirs && enough(mine) && enough(theirs) && winPct(lg, mine) - winPct(lg, theirs) >= (WORSE_GAP[lg] ?? Infinity)) {
      const rec = facts.pre!.records![winnerSide]!;
      fact('team.lost_to_worse', `${team} lost to ${the(lg, `${rec} ${winner}`)}`, `Lost to ${the(lg, `${rec} ${winner}`)}.`, { winnerRecord: rec });
    }
    // Below .500 (W < L: in the NHL an overtime loss doesn't count against it, and in the NFL a tie is half each way).
    if (mine && !SOCCER.has(lg) && mine.w === mine.l && !(lg === 'nhl' && facts.overtime) && mine.w + mine.l + mine.x + 1 >= (MIN_GAMES[lg] ?? Infinity)) {
      const now = `${mine.w}-${mine.l + 1}${lg === 'nhl' || (FOOTBALL.has(lg) && mine.x) ? `-${mine.x}` : ''}`;
      fact('team.below_500', `${team} lost to ${the(lg, winner)} and fell below .500`, `Now ${now}, below .500.`, { record: now });
    }
  }

  // The losing streak this makes (ESPN's streak before the game, plus this one). The regular season only:
  // in the playoffs and the preseason, the standings still show the regular season's last streak. And only
  // if the record has the losses for it (a new season's 0-0 next to last season's "L4" doesn't).
  const before = facts.pre?.streak?.[loserSide], rec = parseRecord(facts.pre?.records?.[loserSide]);
  if (before != null && facts.pre?.seasonType === 2 && !facts.postseason) {
    const n = (/^L(\d+)$/.exec(before) ? Number(/^L(\d+)$/.exec(before)![1]) : 0) + 1;
    if (n >= 3 && rec && rec.l + rec.x >= n - 1) {
      out.push({
        id: `${g.gameId}:final:team.losing_streak:${loserId}`, type: 'team.losing_streak', targetKey: lost.targetKey,
        title: `Successful Hate Watch! ${team} ${have(lg)} lost ${n} straight`, body: lost.body, at: lost.at,
        meta: { gameId: g.gameId, winnerId, lostId: lost.id, teamKey: lost.targetKey, streak: n }, moment: lost.moment, fold: `Lost ${n} straight.`,
      });
    }
  }
  return out;
}

/**
 * Where a game stands among a team's meetings with this opponent, from the team's regular-season schedule
 * (ESPN's teams/{id}/schedule): MLB, the games just before it against them (its series) and whether the
 * next game is someone else's; everyone else, the season's other meetings and whether any are left.
 */
export function seriesSpot(lg: League, schedule: any, gameId: string, teamId: string): SeriesSpot | undefined {
  const games = [...(schedule?.events ?? [])].sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date)).map((e: any) => {
    const c = e.competitions?.[0];
    const me = c?.competitors?.find((x: any) => String(x.id ?? x.team?.id) === teamId);
    const them = c?.competitors?.find((x: any) => String(x.id ?? x.team?.id) !== teamId);
    return { id: String(e.id), opp: String(them?.id ?? them?.team?.id ?? ''), done: !!c?.status?.type?.completed, won: me?.winner === true };
  });
  const at = games.findIndex((x) => x.id === gameId);
  if (at < 0) return undefined;
  const opp = games[at].opp;
  if (lg === 'mlb') {
    let i = at;
    while (i > 0 && games[i - 1].opp === opp) i--;
    const before = games.slice(i, at);
    return { kind: 'series', before: before.length, lostBefore: before.filter((x) => x.done && !x.won).length, last: games[at + 1]?.opp !== opp };
  }
  const meetings = games.filter((x) => x.opp === opp);
  const before = meetings.slice(0, meetings.findIndex((x) => x.id === gameId));
  return { kind: 'season', before: before.length, lostBefore: before.filter((x) => x.done && !x.won).length, last: meetings.at(-1)?.id === gameId };
}

// ─── Box-score facts at the final ─────────────────────────────────────────────────────────────
/** Each team's box-score rows (players), by the stat group's labels: { teamId, labels, athletes }. */
function boxGroups(summary: any) {
  return (summary?.boxscore?.players ?? []).flatMap((t: any) => (t.statistics ?? []).map((st: any) => ({
    teamId: String(t.team?.id), kind: String(st.type ?? st.name ?? ''), labels: (st.labels ?? []) as string[], athletes: (st.athletes ?? []) as any[],
  })));
}
const statOf = (labels: string[], a: any) => (l: string) => String(a.stats?.[labels.indexOf(l)] ?? '');

/** MLB: each team's hits, from the box score's batting lines (teamId → hits), when it has them. */
export function boxHits(summary: any): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const gr of boxGroups(summary).filter((x: any) => x.kind === 'batting' && x.labels.includes('H'))) {
    out[gr.teamId] = (out[gr.teamId] ?? 0) + gr.athletes.reduce((n: number, a: any) => n + (Number(statOf(gr.labels, a)('H')) || 0), 0);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Basketball: a team's top scorer in the box score. */
export function boxTopScorer(summary: any, teamId: string): { id: string; pts: number } | undefined {
  let best: { id: string; pts: number } | undefined;
  for (const gr of boxGroups(summary).filter((x: any) => x.teamId === teamId && x.labels.includes('PTS'))) {
    for (const a of gr.athletes) { const pts = Number(statOf(gr.labels, a)('PTS')) || 0; if (a.athlete?.id != null && (!best || pts > best.pts)) best = { id: String(a.athlete.id), pts }; }
  }
  return best;
}

/** NHL: a team's power play from the box score's team stats: goals and chances. */
export function boxPowerPlay(summary: any, teamId: string): { goals: number; chances: number } | undefined {
  const t = (summary?.boxscore?.teams ?? []).find((x: any) => String(x.team?.id) === teamId);
  const v = (n: string) => t?.statistics?.find((s: any) => s.name === n)?.displayValue;
  return v('powerPlayOpportunities') != null ? { goals: Number(v('powerPlayGoals')) || 0, chances: Number(v('powerPlayOpportunities')) || 0 } : undefined;
}

/*
 * A player's bad night from the final box score, each its own alert type. Share of player games (2025-26):
 *   MLB 0-for-4 or worse: 16.6% of starters' games (0-for-5: 1.9%), so on its own it's feed-only by default
 *   NBA/WNBA a brick night, 30% or worse on 12+ shots or 0-for-6+ from three: 3.8% / 3.3% of 20-minute games
 *   NHL -3 or worse: 1.9% of skater games
 */
export const BRICK = { shots: 12, pct: 0.3, threes: 6 };
export const NHL_MINUS = -3;
export interface PlayerFact { athleteId: string; teamId: string; type: string; title: string; line: string }

/** The box score's bad nights (above), for every player in it (only the tracked ones are stored: publish). */
export function boxPlayerFacts(lg: League, summary: any): PlayerFact[] {
  const out: PlayerFact[] = [];
  for (const gr of boxGroups(summary)) {
    for (const a of gr.athletes) {
      if (a.athlete?.id == null) continue;
      const v = statOf(gr.labels, a), id = String(a.athlete.id), name = nameOf(lg, id);
      if (lg === 'mlb' && gr.kind === 'batting') {
        const ab = Number(v('AB')) || 0, h = Number(v('H')) || 0, k = Number(v('K')) || 0;
        if (ab >= 4 && h === 0) out.push({ athleteId: id, teamId: gr.teamId, type: 'mlb.batter.hitless', title: `${name} went 0-for-${ab}${k >= 2 ? ` with ${k} strikeouts` : ''}`, line: `${v('H-AB')}${k ? `, ${k} K` : ''}` });
      } else if (BASKETBALL.has(lg) && gr.labels.includes('FG')) {
        const [fgm, fga] = v('FG').split('-').map(Number), [tpm, tpa] = v('3PT').split('-').map(Number);
        const bricks = fga >= BRICK.shots && fgm / fga <= BRICK.pct, threes = tpa >= BRICK.threes && tpm === 0;
        if (bricks || threes) {
          out.push({ athleteId: id, teamId: gr.teamId, type: `${lg}.brick_night`, title: bricks ? `${name} shot ${fgm}-for-${fga}${threes ? `, 0-for-${tpa} from three` : ''}` : `${name} went 0-for-${tpa} from three`,
            line: `${v('PTS')} PTS, ${v('FG')} FG, ${v('3PT')} 3PT` });
        }
      } else if (lg === 'nhl' && gr.labels.includes('+/-') && gr.kind !== 'goalies') {
        const pm = Number(v('+/-'));
        if (Number.isFinite(pm) && pm <= NHL_MINUS) out.push({ athleteId: id, teamId: gr.teamId, type: 'nhl.minus', title: `${name} finished ${pm}`, line: `${v('G') || 0} G, ${v('A') || 0} A, ${v('TOI')} TOI` });
      }
    }
  }
  return out;
}

/**
 * The box score's bad nights as alerts at the final. On the losing side they share the loss's moment, so a
 * device gets them as lines on its loss alert ("Aaron Judge went 0-for-4."); on the winning side each
 * player's are one alert of their own.
 */
export function playerFinalEvents(g: Pick<GameCtx, 'league' | 'gameId' | 'homeId' | 'awayId'>, facts: PlayerFact[], final: { home: number; away: number }, at: number, lost?: Detected | null): Detected[] {
  const loserId = lost?.targetKey.split(':')[2];
  return facts.map((f) => ({
    id: `${g.gameId}:final:${f.type}:${f.athleteId}`, type: f.type, targetKey: playerKey(g.league, f.athleteId), title: f.title,
    body: `${f.line} — Final: ${scoreLine(g as GameCtx, final)}`, at, meta: { gameId: g.gameId, athleteId: f.athleteId },
    moment: f.teamId === loserId ? lost!.moment : `${g.gameId}:final:player:${f.athleteId}`, fold: asLine(f.title),
  }));
}

// ─── NFL drives ───────────────────────────────────────────────────────────────────────────────
/**
 * A finished drive's alerts for the offense, from the summary's drives (result, offensive plays, yards, and
 * each play's yards to the end zone): a three-and-out (a punt after 3 plays or fewer and under 10 yards), a
 * turnover on downs, and a red-zone trip with no points. They're on the drive's last play, so a device that
 * tracks the QB whose pick ended it gets one alert (bundleByPlay), and the drive's result can come a poll
 * after that play (the late-fold rule).
 */
export function nflDriveEvents(g: GameCtx, d: any): Detected[] {
  // The drive's deciding play: its last that isn't a timeout or a period's end (a turnover is often followed by
  // one in the drive), so its alert is a moment with that play's own (an interception and the red zone: one alert).
  const team = String(d?.team?.id ?? ''), result = String(d?.result ?? '').toUpperCase(), plays: any[] = d?.plays ?? [];
  const last = [...plays].reverse().find((p) => !/^(Timeout|End Period|End of\b|End Of\b|Two-Minute Warning)/i.test(String(p?.type?.text ?? ''))) ?? plays.at(-1);
  if ((team !== g.homeId && team !== g.awayId) || !result || !last) return [];
  const name = teamName(g.league, team);
  const score = { home: Number(last.homeScore ?? 0), away: Number(last.awayScore ?? 0) };
  const base = (type: string, title: string, fold: string): Detected => ({
    id: `${g.gameId}:drive:${d.id}:${type}`, type, targetKey: teamKey(g.league, team), title, fold,
    body: `${d.description ?? ''}${d.displayResult ? `, ${String(d.displayResult).toLowerCase()}` : ''} — ${scoreLine(g, score)}`,
    at: last.wallclock ? Date.parse(last.wallclock) : Date.now(), meta: { gameId: g.gameId, playId: String(last.id) },
  });
  const out: Detected[] = [];
  if (result === 'PUNT' && Number(d.offensivePlays) <= 3 && Number(d.yards) < 10) out.push(base(footballType(g.league, 'team.three_and_out'), `${name} went three-and-out`, 'Three-and-out.'));
  if (result === 'DOWNS') out.push(base(footballType(g.league, 'team.turnover_on_downs'), `${name} turned it over on downs`, 'Turned it over on downs.'));
  // A snap inside the other side's 20, from the down and distance ("1st & 10 at NYG 13"): ESPN's yardsToEndzone
  // is 0 on timeouts and wrong on punts (a punt from your own 36 says 36). A field code is the team's
  // abbreviation or a shorter or longer one (college: "AF" for Air Force's AFA, "BUF" for Buffalo's BUFF).
  const abbr = String(d.team?.abbreviation ?? teamAbbrev(g.league, team));
  const mine = (code: string) => code === abbr || abbr.startsWith(code) || code.startsWith(abbr);
  const redZone = plays.some((p: any) => {
    const at = String(p.start?.downDistanceText ?? '').match(/ at ([A-Z]{2,5}) (\d+)$/);
    return String(p.start?.team?.id) === team && !!at && !mine(at[1]) && Number(at[2]) <= 20 && !/timeout|punt|kickoff/i.test(String(p.type?.text ?? p.text ?? ''));
  });
  if (redZone && !['TD', 'FG', 'END OF GAME'].includes(result)) {
    const how = String(d.displayResult ?? result).toLowerCase();
    out.push(base(footballType(g.league, 'team.red_zone_empty'), `${name} came away empty from the red zone (${how})`, `No points from the red zone (${how}).`));
  }
  return out;
}

// ─── Soccer: substitutions, the woodwork, VAR ─────────────────────────────────────────────────
/**
 * A player taken off by halftime, not for an injury ("Callum Wilson replaces Niclas Füllkrug." at 45',
 * but not "… because of an injury"). 51 of 513 EPL substitutions in 60 matches came by 46', most injuries.
 */
export function earlySub(g: GameCtx, p: NPlay): Detected[] {
  // The minute before any stoppage time: a sub at 45'+2' is still the first half's.
  const [off] = role(p, 'off'), minute = parseInt(String(p.clock ?? ''), 10) || 0;
  if (p.typeSlug !== 'substitution' || !off || !minute || minute > 46 || /injur/i.test(p.text)) return [];
  return [mk(g, p, `${g.league}.subbed_off_early`, off, `${nameOf(g.league, off)} was taken off ${minute >= 45 ? 'at halftime' : `in the ${ordinal(minute)} minute`}`)];
}

/**
 * From the commentary (fromCommentary): a shot off the woodwork ("Antoine Semenyo (Bournemouth) hits the bar
 * with a left footed shot…"), and a goal ruled out ("GOAL OVERTURNED BY VAR: Niclas Füllkrug (West Ham
 * United) scores but the goal is ruled out after a VAR review.": only that wording, never "VAR Decision:
 * Goal", which is a goal given). The VAR one is the scorer's and his team's: one alert for both (bundleByPlay).
 */
export function soccerCommentaryEvents(g: GameCtx, p: NPlay): Detected[] {
  const lg = g.league, [who] = role(p, 'player');
  if (!who) return [];
  if (p.typeSlug === 'woodwork') {
    const what = p.text.match(/hits the (left post|right post|post|bar|crossbar)/i)?.[1]?.replace(/^(left|right) /, '') ?? 'woodwork';
    return [mk(g, p, `${lg}.hit_woodwork`, who, `${nameOf(lg, who)} hit the ${what === 'crossbar' ? 'bar' : what}`)];
  }
  if (p.typeSlug === 'var-no-goal' && p.teamId) {
    return [
      mk(g, p, `${lg}.goal_disallowed`, who, `${nameOf(lg, who)} had a goal ruled out by VAR`),
      { id: `${g.gameId}:${p.id}:${lg}.goal_disallowed:team-${p.teamId}`, type: `${lg}.goal_disallowed`, targetKey: teamKey(lg, p.teamId), title: `${teamName(lg, p.teamId)} had a goal ruled out by VAR`,
        body: `${p.text} — ${scoreLine(g, p)}`, at: p.at, meta: { gameId: g.gameId, playId: p.id } },
    ];
  }
  return [];
}

/**
 * NBA, WNBA: players who played 10 minutes or more of the first half without a point, from the box score at
 * halftime ("Jayson Tatum is scoreless at the half: 0-for-6").
 */
export function scorelessAtHalf(g: GameCtx, summary: any): Detected[] {
  const out: Detected[] = [];
  for (const gr of boxGroups(summary).filter((x: any) => x.labels.includes('PTS') && x.labels.includes('MIN'))) {
    for (const a of gr.athletes) {
      const v = statOf(gr.labels, a), id = a.athlete?.id != null ? String(a.athlete.id) : '';
      if (!id || (Number(v('MIN')) || 0) < 10 || v('PTS') !== '0') continue;
      out.push({ id: `${g.gameId}:half:${g.league}.scoreless_half:${id}`, type: `${g.league}.scoreless_half`, targetKey: playerKey(g.league, id),
        title: `${nameOf(g.league, id)} is scoreless at the half${v('FG') ? `: ${v('FG')} from the field` : ''}`, body: `${v('MIN')} minutes, ${v('FG')} FG, ${v('3PT')} 3PT`, at: Date.now(), meta: { gameId: g.gameId, athleteId: id } });
    }
  }
  return out;
}
