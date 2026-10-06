import { athleteIdFromRef, teamIdFromRef } from './espn.ts';
import { catalog, normalize } from './catalog.ts';
import { playerKey, teamKey, type League } from './leagues.ts';

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
}

export interface GameCtx {
  league: League;
  gameId: string;
  homeId: string;
  awayId: string;
  /** NHL: who is in net for each team right now (teamId -> athleteId). Updated as plays stream in. */
  goalies: Map<string, string>;
  /** MLB: the latest at-bat result. Its onFirst/onSecond/onThird roles are the bases AFTER that play. */
  lastResult?: NPlay;
  /** MLB: who is on each base right now (role -> athleteId), from the latest full base-state snapshot. */
  bases?: Partial<Record<'onFirst' | 'onSecond' | 'onThird', string>>;
  /**
   * MLB: the current half-inning, for NOBLETIGER (bases loaded, nobody out, then no runs) and for
   * "opponent has runners in scoring position" (`risp`: the batting team has had one this half).
   */
  half?: { key: string; loadedNoOuts: boolean; scoredSince: boolean; risp: boolean };
  /** NFL: each team's quarterback in the game right now (teamId -> athleteId), from the latest pass/sack. */
  qbs?: Record<string, string>;
  /** MLB: the latest pitch's call went to an ABS challenge (so the at-bat result's "challenged" text is that one). */
  lastPitchAbs?: boolean;
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
    ...mlbFields(p),
  };
}

function mlbFields(p: any): Pick<NPlay, 'outs' | 'period'> {
  return {
    outs: p.outs != null ? Number(p.outs) : undefined,
    period: p.period?.type ? { type: String(p.period.type), number: Number(p.period.number ?? 0) } : undefined,
  };
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
    ...mlbFields(p),
  };
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
    if (saver && p.teamId) g.goalies.set(p.teamId === g.homeId ? g.awayId : g.homeId, saver);
  }
  if (g.league === 'nfl' && p.teamId) {
    // Core plays' team is the offense. A trick-play pass by a non-QB doesn't change who is under center.
    const qb = p.participants.find((x) => x.role === 'passer')?.id;
    const position = qb && catalog.playerByEspn('nfl', qb)?.position;
    if (qb && (!position || position === 'QB')) (g.qbs ??= {})[p.teamId] = qb;
  }
  if (g.league === 'mlb') {
    trackHalfInning(g, p);
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

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/**
 * Team alert: the half-inning just ended with runners on second and/or third.
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
  if (g.half?.key !== key) g.half = { key, loadedNoOuts: false, scoredSince: false, risp: false };
  // Checked before this play can load the bases: a run that scores on the loading play doesn't count.
  if (g.half.loadedNoOuts && p.scoring) g.half.scoredSince = true;
  if (p.typeSlug === 'play-result' && p.outs === 0 && p.participants.some((x) => x.role === 'batter')) {
    const on = (base: string) => p.participants.some((x) => x.role === base);
    if (on('onFirst') && on('onSecond') && on('onThird')) g.half.loadedNoOuts = true;
  }
  if (inScoringPosition(basesAfter(p))) g.half.risp = true;
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
  return out;
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

// ─── MLB challenges ───────────────────────────────────────────────────────────────────────────
const PITCH = /^Pitch \d+\s*:/i;
/** ESPN's pitch type after an ABS review: the call that stands, and whether the challenge failed ("Confirmed"). */
const ABS_PITCH = /^(ball|strike looking) - (confirmed|overturned)$/i;
/** A failed challenge in an at-bat result: "Chicago White Sox challenged: call on the field was upheld." */
const CHALLENGE_LOST = /\bchallenged\b[^.]*?\bcall on the field (?:was )?(?:upheld|confirmed|stands|stood)\b/i;

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
 */
function challengeLost(g: GameCtx, p: NPlay): Detected[] {
  const key = halfKey(p);
  if (!key) return [];
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
    const out: Detected[] = [];
    if (strike && batter) out.push(mk(g, p, 'mlb.challenge_lost', batter, `${batterName} lost an ABS challenge`, { body: body(`challenged ${call}, and the call stands`), moment }));
    if (!strike && pitcher) out.push(mk(g, p, 'mlb.challenge_lost', pitcher, `ABS challenge on ${nameOf('mlb', pitcher)}'s pitch failed`, { body: body(`${call} to ${batterName} stands`), moment }));
    out.push({
      id: `${g.gameId}:${p.id}:mlb.challenge_lost:team-${loserId}`, type: 'mlb.challenge_lost', targetKey: teamKey('mlb', loserId),
      title: `${teamName('mlb', loserId)} lost an ABS challenge`,
      body: body(strike ? `${batterName} challenged ${call}, and the call stands` : `${call} to ${batterName} stands${pitcher ? ` (${nameOf('mlb', pitcher)} pitching)` : ''}`),
      at: p.at, meta: { gameId: g.gameId, playId: p.id }, moment,
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
    title: `${teamName('mlb', loserId)} lost a replay challenge`, body: `${p.text} — ${scoreLine(g, p)}`,
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

const PITCHER_ORDER = ['mlb.pitcher.blown_save', 'mlb.pitcher.no_quality_start', 'mlb.pitcher.loss'];
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
    const facts = PITCHER_ORDER.filter((t, i) => [bs, noQs, loss][i] && !done.has(`${t}:${p.id}`));
    if (!facts.length) continue;
    for (const t of facts) done.add(`${t}:${p.id}`);
    const has = (t: string) => facts.includes(`mlb.pitcher.${t}`);
    const name = nameOf('mlb', p.id);
    const after = (n?: string) => n?.split(',')[1]?.trim(); // "B, 3" → "3", "L, 0-1" → "0-1"
    const title = has('blown_save') && has('loss') ? `${name} blew the save and took the loss`
      : has('no_quality_start') && has('loss') ? `${name} took the loss without a quality start`
      : has('blown_save') ? `${name} blew the save`
      : has('loss') ? `${name} took the loss`
      : `No quality start for ${name}: ${p.er >= 4 ? `${p.er} earned runs in ${innings(p)}` : `${p.active ? 'went' : 'pulled after'} ${innings(p)}`}`;
    const extra = [
      has('blown_save') && Number(after(bs)) ? `${ordinal(Number(after(bs)))} blown save this season` : '',
      has('loss') && after(loss) ? `now ${after(loss)}` : '',
    ].filter(Boolean);
    out.push({
      id: `${g.gameId}:${facts[0]}:${p.id}`, type: facts[0], ...(facts.length > 1 ? { aliases: facts.slice(1) } : {}),
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
    if (/struck out/i.test(t)) out.push(mk(g, p, 'mlb.batter.strikeout', batter, `${nameOf('mlb', batter)} struck out ${/looking/i.test(t) ? 'looking 👀' : 'swinging'}`));
    else if (/double play/i.test(t)) out.push(mk(g, p, 'mlb.batter.double_play', batter, `${nameOf('mlb', batter)} grounded into a double play`));
    else if (/\b(flied|grounded|lined|popped|fouled|bunted) out\b|\bout at\b|fielder'?s choice/i.test(t))
      out.push(mk(g, p, 'mlb.batter.popout', batter, `${nameOf('mlb', batter)} made an out`));
  }
  if (pitcher) {
    const runs = p.scoring ? Math.max(p.scoreValue, 1) : 0;
    if (/homered/i.test(t)) {
      const label = runs >= 4 ? 'a grand slam' : runs > 1 ? `a ${runs}-run homer` : 'a solo homer';
      out.push(mk(g, p, 'mlb.pitcher.home_run_allowed', pitcher, `${nameOf('mlb', pitcher)} gave up ${label}`, { aliases: ['mlb.pitcher.runs_allowed'] }));
    } else if (runs) {
      out.push(mk(g, p, 'mlb.pitcher.runs_allowed', pitcher, `${nameOf('mlb', pitcher)} gave up ${runs} run${runs > 1 ? 's' : ''}`));
    }
    if (isResult && /\b(walked|hit by pitch)\b/i.test(t)) out.push(mk(g, p, 'mlb.pitcher.walk', pitcher, `${nameOf('mlb', pitcher)} ${/hit by pitch/i.test(t) ? 'plunked a batter' : 'issued a walk'}`));
  }
  const runner = runnerOut(g, p);
  if (runner) out.push(runner);
  out.push(...opponentRisp(g, p));
  out.push(...challengeLost(g, p));
  const err = t.match(/error by (?:\w+ )?(?:baseman |fielder |stop )?([A-Z][\w'.-]+(?: (?:Jr\.|Sr\.|II|III))?)/);
  if (err && p.teamId) {
    const fieldingTeam = p.teamId === g.homeId ? g.awayId : g.homeId;
    const who = byLastName(g, fieldingTeam, err[1]);
    if (who) out.push(mk(g, p, 'mlb.fielder.error', who, `${nameOf('mlb', who)} committed an error`));
  }
  return out;
}

function nfl(g: GameCtx, p: NPlay): Detected[] {
  const out: Detected[] = [];
  const [passer] = role(p, 'passer');
  const ty = p.type;
  if (passer && /Interception/i.test(ty)) out.push(mk(g, p, 'nfl.qb.interception', passer, `${nameOf('nfl', passer)} threw an interception${/Touchdown/i.test(ty) ? ' — returned for a TD 🙃' : ''}`));
  if (passer && /^Sack/i.test(ty)) out.push(mk(g, p, 'nfl.qb.sacked', passer, `${nameOf('nfl', passer)} got sacked`));
  if (passer && /Pass Incompletion/i.test(ty)) out.push(mk(g, p, 'nfl.qb.incompletion', passer, `${nameOf('nfl', passer)} threw incomplete`));
  for (const f of role(p, 'fumbler')) {
    const lost = /Opponent|Fumble Return/i.test(ty);
    out.push(lost
      ? mk(g, p, 'nfl.fumble_lost', f, `${nameOf('nfl', f)} lost a fumble`, { aliases: ['nfl.fumble'] })
      : mk(g, p, 'nfl.fumble', f, `${nameOf('nfl', f)} fumbled`));
  }
  const kickMiss = /Field Goal Missed|Blocked Field Goal|Blocked PAT|Missed PAT/i.test(ty) || /extra point is no good|kick is blocked/i.test(p.text);
  if (kickMiss) for (const k of [...role(p, 'kicker'), ...role(p, 'patScorer')].slice(0, 1))
    out.push(mk(g, p, 'nfl.kicker.miss', k, `${nameOf('nfl', k)} ${/blocked/i.test(ty + p.text) ? 'got a kick blocked' : /extra point/i.test(p.text) ? 'missed the extra point' : 'missed a field goal'}`));
  for (const x of role(p, 'penalized')) out.push(mk(g, p, 'nfl.penalty', x, `${nameOf('nfl', x)} was flagged${/declined/i.test(p.text) ? ' (declined)' : ''}`));

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
  if (victim) replace(mk(g, p, 'nfl.safety', victim.id, `${nameOf('nfl', victim.id)} ${victim.how}`), victim.covers);
  const dog = delayOfGameQb(g, p);
  if (dog) replace(mk(g, p, 'nfl.qb.delay_of_game', dog.qb, `${nameOf('nfl', dog.qb)} took a delay of game penalty`), dog.named ? 'nfl.penalty' : undefined);
  const onside = onsideRecovered(g, p);
  if (onside) out.push(onside);
  return out;
}

/**
 * Team alert for the RECEIVING team: the other side kicked onside and kept the ball. Real kickoffs read
 * "J.Slye kicks onside 9 yards from TEN 35 to TEN 44. M.Starks (didn't try to advance) to TEN 44 for no
 * gain." That one failed: the play starts with the kicking team (TEN) and ends with the receivers (BAL).
 * A success ends with the kicking team still holding it ("… RECOVERED by TEN-…" names them too, used if
 * ESPN leaves the end team out). A kick wiped out by a penalty ("… - No Play.") doesn't count.
 */
function onsideRecovered(g: GameCtx, p: NPlay): Detected | null {
  if (!/\bkicks onside\b/i.test(p.text) || /\bNo Play\b|NULLIFIED/i.test(p.text)) return null;
  const kicking = p.teamId;
  const receiving = kicking === g.homeId ? g.awayId : kicking === g.awayId ? g.homeId : undefined;
  if (!kicking || !receiving) return null;
  const recoveredBy = [...p.text.matchAll(/RECOVERED by ([A-Z]{2,3})-/gi)].at(-1)?.[1].toUpperCase();
  const kept = p.endTeamId ? p.endTeamId === kicking : !!recoveredBy && (NFL_CODE[recoveredBy] ?? recoveredBy) === teamAbbrev('nfl', kicking);
  if (!kept) return null;
  return {
    id: `${g.gameId}:${p.id}:nfl.team.onside_recovered:${receiving}`,
    type: 'nfl.team.onside_recovered',
    targetKey: teamKey('nfl', receiving),
    title: `${teamName('nfl', kicking)} recovered an onside kick against the ${teamName('nfl', receiving)}`,
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
  const offense = p.teamId ? catalog.teamByEspn('nfl', p.teamId)?.abbrev : undefined;
  if (!offense || (NFL_CODE[m[1]] ?? m[1]) !== offense) return;
  const named = role(p, 'penalized').find((id) => catalog.playerByEspn('nfl', id)?.position === 'QB');
  const qb = named ?? g.qbs?.[p.teamId!];
  return qb ? { qb, named: !!named } : undefined;
}

function nba(g: GameCtx, p: NPlay): Detected[] {
  const out: Detected[] = [];
  const t = p.text;
  const actor = onTeam(g, p, p.teamId) ?? p.participants[0]?.id;
  if (!actor && !/technical/i.test(p.type)) return out;
  if (p.shooting && !p.scoring) {
    if (/blocks/i.test(t)) {
      const shooter = onTeam(g, p, p.teamId) ?? p.participants[1]?.id;
      if (shooter) out.push(mk(g, p, 'nba.got_blocked', shooter, `${nameOf('nba', shooter)} got sent back ✋`, { aliases: ['nba.missed_shot'] }));
    } else if (/free throw/i.test(t + p.type) && /miss/i.test(t)) {
      out.push(mk(g, p, 'nba.missed_free_throw', actor!, `${nameOf('nba', actor!)} missed a free throw`));
    } else if (/miss/i.test(t)) {
      const three = /three point/i.test(t);
      out.push(mk(g, p, 'nba.missed_shot', actor!, `${nameOf('nba', actor!)} missed ${three ? 'a three' : 'a shot'}`));
    }
  } else if (/turnover/i.test(p.type) && actor && p.participants.length) {
    out.push(mk(g, p, 'nba.turnover', actor, `${nameOf('nba', actor)} turned it over`));
  } else if (/technical|flagrant/i.test(p.type) || /ejected/i.test(t)) {
    for (const x of p.participants.slice(0, /double/i.test(p.type) ? 2 : 1)) out.push(mk(g, p, 'nba.technical', x.id, `${nameOf('nba', x.id)} ${/ejected/i.test(t) ? 'got ejected 🚪' : 'picked up a technical'}`));
  } else if (/foul/i.test(p.type) && actor) {
    out.push(mk(g, p, 'nba.foul', actor, `${nameOf('nba', actor)} committed a foul`));
  }
  return out;
}

function nhl(g: GameCtx, p: NPlay): Detected[] {
  const out: Detected[] = [];
  const slug = p.typeSlug;
  const [shooter] = role(p, 'shooter');
  const other = (id?: string) => (id === g.homeId ? g.awayId : g.homeId);
  // g.goalies is kept current by observePlay().

  if (slug === 'goal' || p.type === 'Goal') {
    const goalie = g.goalies.get(other(p.teamId));
    if (goalie && !/empty net/i.test(p.text)) out.push(mk(g, p, 'nhl.goalie.goal_allowed', goalie, `${nameOf('nhl', goalie)} let one in 🥅`));
  } else if (shooter && (slug === 'shot-missed' || p.type === 'Missed')) {
    out.push(mk(g, p, 'nhl.shot_missed', shooter, `${nameOf('nhl', shooter)} shot and missed${/post|crossbar/i.test(p.text) ? ' (rang iron)' : ''}`));
  } else if (shooter && (slug === 'shot-blocked' || p.type === 'Blocked')) {
    out.push(mk(g, p, 'nhl.shot_blocked', shooter, `${nameOf('nhl', shooter)} got a shot blocked`));
  } else if (shooter && (slug === 'shot-on-goal' || p.type === 'Shot')) {
    out.push(mk(g, p, 'nhl.shot_saved', shooter, `${nameOf('nhl', shooter)} got stoned`));
  } else if (/giveaway/i.test(p.type) && p.participants[0]) {
    out.push(mk(g, p, 'nhl.giveaway', p.participants[0].id, `${nameOf('nhl', p.participants[0].id)} gave the puck away`));
  } else if (p.penaltyMinutes && p.participants[0]) {
    out.push(mk(g, p, 'nhl.penalty', p.participants[0].id, `${nameOf('nhl', p.participants[0].id)} went to the box (${p.penaltyMinutes} min, ${p.type})`));
  }
  return out;
}

// F1 has no play-by-play; its alerts come from session results (f1.ts).
export const PLAYER_DETECTORS: Record<League, (g: GameCtx, p: NPlay) => Detected[]> = { mlb, nfl, nba, nhl, f1: () => [] };

// ─── Team in-game detectors (score-delta based, so they work identically for every league) ───
/**
 * Only scoring plays move the score. ESPN back-fills the running score onto neighbouring
 * non-scoring plays (timeouts, "X pitches to Y"), which would misattribute the event.
 */
export function nextScore(prev: { home: number; away: number }, p: NPlay) {
  if (!p.scoring) return prev;
  return { home: Math.max(prev.home, p.home), away: Math.max(prev.away, p.away) };
}

export const START_WORD: Record<League, string> = { nfl: 'Kickoff', nba: 'Tip-off', nhl: 'Puck drop', mlb: 'First pitch', f1: 'Lights out' };

/** "Hate Watch Starting" for both teams, each from its own side ("Eagles vs Bears" / "Bears vs Eagles"). */
export function gameStartEvents(g: Pick<GameCtx, 'league' | 'gameId' | 'homeId' | 'awayId'>, info: { venue?: string; tv?: string }, at: number): Detected[] {
  const body = [`${START_WORD[g.league]}${info.venue ? ` at ${info.venue}` : ''}`, info.tv].filter(Boolean).join(' · ');
  return [[g.homeId, g.awayId], [g.awayId, g.homeId]].map(([teamId, oppId]) => ({
    id: `${g.gameId}:team.game_start:${teamId}`,
    type: 'team.game_start',
    targetKey: teamKey(g.league, teamId),
    title: `Hate Watch Starting: ${teamName(g.league, teamId)} vs ${teamName(g.league, oppId)}`,
    body,
    at,
    meta: { gameId: g.gameId },
  }));
}

/** The loser's final-whistle alert. Ties (NFL, NHL preseason) are miserable for everyone, but not a loss. */
export function gameLostEvent(g: Pick<GameCtx, 'league' | 'gameId' | 'homeId' | 'awayId'>, final: { home: number; away: number }, at: number): Detected | null {
  if (final.home === final.away) return null;
  const [loserId, winnerId] = final.home < final.away ? [g.homeId, g.awayId] : [g.awayId, g.homeId];
  return {
    id: `${g.gameId}:final:team.lost:${loserId}`,
    type: 'team.lost',
    targetKey: teamKey(g.league, loserId),
    title: `Successful Hate Watch! ${teamName(g.league, loserId)} lost to the ${teamName(g.league, winnerId)}`,
    body: `Final Score: ${Math.max(final.home, final.away)} to ${Math.min(final.home, final.away)}`,
    at,
    meta: { gameId: g.gameId },
  };
}

export function teamScoreEvents(g: GameCtx, prev: { home: number; away: number }, p: NPlay): Detected[] {
  const out: Detected[] = [];
  for (const side of ['home', 'away'] as const) {
    const teamId = side === 'home' ? g.homeId : g.awayId;
    const oppId = side === 'home' ? g.awayId : g.homeId;
    const opp = side === 'home' ? 'away' : 'home';
    const delta = p[opp] - prev[opp];
    const base = { targetKey: teamKey(g.league, teamId), at: p.at, body: `${p.text} — ${scoreLine(g, p)}`, meta: { gameId: g.gameId, playId: p.id } };
    const [team, oppName] = [teamName(g.league, teamId), teamName(g.league, oppId)];
    const what = g.league === 'nhl' ? 'scored' : g.league === 'mlb' ? `scored ${delta} run${delta > 1 ? 's' : ''}` : `scored ${delta}`;
    const safety = delta === 2 && g.league === 'nfl' && isSafety(p);
    // Falling behind can only happen because the opponent just scored, so the two alerts always
    // coincide. The fell-behind alert carries both facts; the scored-on alert for this play is
    // then `unless` it: each user gets one (the combined one if they want "falls behind").
    const fellBehind = prev[side] - prev[opp] >= 0 && p[side] - p[opp] < 0;
    const unlessBehind = fellBehind ? { unless: 'team.fell_behind' } : {};
    if (safety) {
      // Replaces "opponent scored 2" for this play, and counts as that toggle too.
      out.push({ id: `${g.gameId}:${p.id}:nfl.safety:team-${teamId}`, type: 'nfl.safety', aliases: ['team.opponent_scored'], title: `${team} gave up a safety`, ...base, ...unlessBehind });
    } else if (delta > 0 && g.league !== 'nba') {
      out.push({ id: `${g.gameId}:${p.id}:team.opponent_scored:${teamId}`, type: 'team.opponent_scored', title: `${oppName} ${what} on the ${team}`, ...base, ...unlessBehind });
    }
    if (fellBehind) {
      out.push({
        id: `${g.gameId}:${p.id}:team.fell_behind:${teamId}`, type: 'team.fell_behind',
        title: safety ? `${team} gave up a safety and fell behind the ${oppName}` : `${oppName} ${what} to take the lead over the ${team}`,
        ...base,
      });
    }
  }
  return out;
}
