import { athleteIdFromRef, teamIdFromRef } from './espn.ts';
import { catalog, normalize } from './catalog.ts';
import { playerKey, teamKey, type League } from './leagues.ts';

/** League-agnostic view of one play. */
export interface NPlay {
  id: string;              // identical across the site and core APIs
  seq: number;             // ESPN sequenceNumber, for ordering merged sources
  type: string;            // ESPN type text, e.g. "Pass Interception Return", "Missed"
  typeSlug: string;        // ESPN type.type / abbreviation when present ("play-result", "shot-missed")
  text: string;
  teamId?: string;         // team credited with the play (batting team, shooting team, offense...)
  participants: { id: string; role?: string }[];
  scoring: boolean;
  scoreValue: number;
  home: number;
  away: number;
  at: number;              // epoch ms the play happened (ESPN wallclock), falls back to detection time
  shooting: boolean;
  penaltyMinutes?: number;
}

export interface GameCtx {
  league: League;
  gameId: string;
  homeId: string;
  awayId: string;
  /** NHL: who is in net for each team right now (teamId -> athleteId). Updated as plays stream in. */
  goalies: Map<string, string>;
}

export interface Detected {
  id: string;              // deterministic dedupe key
  type: string;
  aliases?: string[];      // other pref toggles that also cover this event (HR allowed ⊂ runs allowed)
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
    seq: Number(p.sequenceNumber ?? 0),
    type: String(p.type?.text ?? '').replace(/\n/g, ' '),
    typeSlug: String(p.type?.type ?? p.type?.abbreviation ?? ''),
    text: String(p.text ?? '').replace(/\n/g, ' '),
    teamId: p.team?.id,
    participants: (p.participants ?? []).map((x: any) => ({ id: String(x.athlete?.id), role: x.type })).filter((x: any) => x.id !== 'undefined'),
    scoring: !!p.scoringPlay,
    scoreValue: Number(p.scoreValue ?? 0),
    home: Number(p.homeScore ?? 0),
    away: Number(p.awayScore ?? 0),
    at: p.wallclock ? Date.parse(p.wallclock) : Date.now(),
    shooting: !!p.shootingPlay,
    penaltyMinutes: p.type?.penaltyMinutes ? Number(p.type.penaltyMinutes) : undefined,
  };
}

export function fromCorePlay(p: any): NPlay {
  return {
    id: String(p.id),
    seq: Number(p.sequenceNumber ?? 0),
    type: String(p.type?.text ?? ''),
    typeSlug: String(p.type?.type ?? p.type?.abbreviation ?? ''),
    text: String(p.text ?? '').replace(/\n/g, ' '),
    teamId: teamIdFromRef(p.start?.team?.$ref ?? p.team?.$ref),
    participants: (p.participants ?? []).map((x: any) => ({ id: athleteIdFromRef(x.athlete?.$ref) ?? '', role: x.type })).filter((x: any) => x.id),
    scoring: !!p.scoringPlay,
    scoreValue: Number(p.scoreValue ?? 0),
    home: Number(p.homeScore ?? 0),
    away: Number(p.awayScore ?? 0),
    at: p.wallclock ? Date.parse(p.wallclock) : Date.now(),
    shooting: !!p.shootingPlay,
    penaltyMinutes: p.type?.penaltyMinutes ? Number(p.type.penaltyMinutes) : p.penalty?.minutes ? Number(p.penalty.minutes) : undefined,
  };
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

// ─── Per-league player detectors ──────────────────────────────────────────────────────────────
function mlb(g: GameCtx, p: NPlay): Detected[] {
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
  return out;
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
  const [saver] = role(p, 'saver');
  const other = (id?: string) => (id === g.homeId ? g.awayId : g.homeId);
  if (saver && p.teamId) g.goalies.set(other(p.teamId), saver);

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

export const PLAYER_DETECTORS: Record<League, (g: GameCtx, p: NPlay) => Detected[]> = { mlb, nfl, nba, nhl };

// ─── Team in-game detectors (score-delta based, so they work identically for every league) ───
/**
 * Only scoring plays move the score. ESPN back-fills the running score onto neighbouring
 * non-scoring plays (timeouts, "X pitches to Y"), which would misattribute the event.
 */
export function nextScore(prev: { home: number; away: number }, p: NPlay) {
  if (!p.scoring) return prev;
  return { home: Math.max(prev.home, p.home), away: Math.max(prev.away, p.away) };
}

export function teamScoreEvents(g: GameCtx, prev: { home: number; away: number }, p: NPlay): Detected[] {
  const out: Detected[] = [];
  for (const side of ['home', 'away'] as const) {
    const teamId = side === 'home' ? g.homeId : g.awayId;
    const oppId = side === 'home' ? g.awayId : g.homeId;
    const opp = side === 'home' ? 'away' : 'home';
    const delta = p[opp] - prev[opp];
    const base = { targetKey: teamKey(g.league, teamId), at: p.at, body: `${p.text} — ${scoreLine(g, p)}`, meta: { gameId: g.gameId, playId: p.id } };
    if (delta > 0 && g.league !== 'nba') {
      const what = g.league === 'nhl' ? 'scored' : g.league === 'mlb' ? `scored ${delta} run${delta > 1 ? 's' : ''}` : `scored ${delta}`;
      out.push({ id: `${g.gameId}:${p.id}:team.opponent_scored:${teamId}`, type: 'team.opponent_scored', title: `${teamName(g.league, oppId)} ${what} on the ${teamName(g.league, teamId)}`, ...base });
    }
    const was = prev[side] - prev[opp];
    const now = p[side] - p[opp];
    if (was >= 0 && now < 0) {
      out.push({ id: `${g.gameId}:${p.id}:team.fell_behind:${teamId}`, type: 'team.fell_behind', title: `${teamName(g.league, teamId)} fell behind ${teamName(g.league, oppId)}`, ...base });
    }
  }
  return out;
}
