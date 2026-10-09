// The game screen's Highlights tab: ESPN's video clips for the game, and the key plays, the moments that
// matter from the play-by-play (scoring plays, lead changes, turnovers, cards and ejections), newest first.
import { SOCCER, BASKETBALL, type League } from './leagues.ts';
import type { GameCard, PlayLine } from './scores.ts';
import { clipFromVideo } from './clips.ts';

/** A clip: HLS for phones, MP4 for the web (no HLS in most browsers). ESPN takes clips down after about 2 days (`expires`). */
export interface Clip { id: string; title: string; seconds: number; thumb: string | null; hls: string | null; mp4: string | null; at: number; expires: number | null }
/**
 * A key play, with the score after it and why it's one when the text doesn't say ("Lead change").
 * `alerted`: it sent this device an alert (forDevice).
 */
export interface KeyPlay extends PlayLine { score?: string; tag?: string; alerted?: boolean }
/** A play with its place in the game, so key plays and alerted plays merge in order; `ids`: ESPN's duplicates of it. */
type Placed = KeyPlay & { seq: number; ids?: string[] };
/** The key plays, newest first, and the other plays that sent someone an alert, by play id. */
export interface Highlights { keyPlays: Placed[]; alerted: Map<string, Placed> }

export function clipsOf(summary: any, now = Date.now()): Clip[] {
  return (summary?.videos ?? []).map((v: any) => clipFromVideo(v, now)).filter((c: Clip | null): c is Clip => !!c).sort((a: Clip, b: Clip) => b.at - a.at);
}

const KEY_MAX = 60;

/** ESPN's play time, as on the play-by-play: "Bot 9th", "Q4 2:14", "P2 12:03", "88'". */
type When = (lg: League, p: any) => string;

/**
 * The key plays (newest first) and, of `alertIds` (the plays any device got an alert for), the ones that
 * aren't key plays, to add for the devices they alerted (forDevice).
 */
export function highlights(g: Pick<GameCard, 'league' | 'home' | 'away'>, summary: any, when: When, alertIds: Set<string> = new Set()): Highlights {
  const lg = g.league;
  const [away, home] = [g.away?.team.abbrev ?? 'Away', g.home?.team.abbrev ?? 'Home'];
  const score = (p: any) => (p.awayScore != null && p.homeScore != null ? `${away} ${p.awayScore}, ${home} ${p.homeScore}` : undefined);
  let seq = 0;
  const line = (p: any, x: Partial<KeyPlay> = {}): Placed => ({ id: String(p.id), text: String(p.text ?? ''), when: when(lg, p), scoring: !!p.scoringPlay, score: score(p), ...x, seq });
  const type = (p: any) => String(p.type?.text ?? '');
  const out: Placed[] = [];
  const alerted = new Map<string, Placed>();
  const bySig = new Map<string, Placed>();
  const sigOf = (k: KeyPlay) => `${k.text}|${k.score ?? ''}`;
  const add = (k: Placed) => {
    // ESPN can post a run twice (a wild pitch's "Wild Pitch" and "Play Result", same text and score): one line, both ids.
    const same = bySig.get(sigOf(k));
    if (same) { if (same.id !== k.id) (same.ids ??= []).push(k.id); return; }
    if (!k.text) return;
    bySig.set(sigOf(k), k);
    out.push(k);
  };
  /** Each play in game order: its place, and if it sent an alert, its line in case it's no key play. */
  const visit = (p: any) => {
    seq++;
    if (alertIds.has(String(p.id))) alerted.set(String(p.id), line(p));
  };

  if (lg === 'mlb') {
    for (const p of summary?.plays ?? []) { visit(p); if (p.scoringPlay || /\bejected\b/i.test(p.text ?? '')) add(line(p, /\bejected\b/i.test(p.text ?? '') ? { tag: 'Ejection' } : {})); }
  } else if (BASKETBALL.has(lg)) {
    // Lead changes (the lead going from one side to the other, ties in between or not), flagrants and
    // ejections, and each quarter's end with the score.
    let leader: 'home' | 'away' | null = null;
    for (const p of summary?.plays ?? []) {
      visit(p);
      const d = Number(p.homeScore ?? 0) - Number(p.awayScore ?? 0);
      const now = d > 0 ? 'home' : d < 0 ? 'away' : null;
      if (p.scoringPlay && now && leader && now !== leader) add(line(p, { tag: 'Lead change' }));
      if (now) leader = now;
      if (/flagrant/i.test(type(p)) || /\bejected\b/i.test(p.text ?? '')) add(line(p, { tag: /\bejected\b/i.test(p.text ?? '') ? 'Ejection' : 'Flagrant' }));
      if (/^End Period$/i.test(type(p))) add(line(p)); // not "End Game": the score card says Final
    }
  } else if (lg === 'nhl') {
    // Goals, fights and majors (5 minutes or more), misconducts, and each period's end. In a shootout, every
    // attempt, without a score: its plays carry the shootout's tally, not the game's.
    let shootout = false;
    for (const p of summary?.plays ?? []) {
      visit(p);
      const minutes = Number(p.type?.penaltyMinutes ?? 0);
      if (/start of shootout/i.test(p.text ?? '')) shootout = true;
      if (shootout && /^(Goal|Shot|Missed)$/.test(type(p))) add({ ...line(p, { tag: 'Shootout' }), score: undefined });
      else if (p.scoringPlay) add(line(p));
      else if (type(p) === 'Penalty' && (minutes >= 5 || /fighting|misconduct|match/i.test(p.text ?? ''))) add(line(p, { tag: /fighting/i.test(p.text ?? '') ? 'Fight' : 'Penalty' }));
      else if (/^Period End$/i.test(type(p)) && !shootout) add(line(p));
    }
  } else if (lg === 'nfl') {
    // Scores and turnovers: picks, lost fumbles, missed and blocked kicks, safeties.
    const plays = [...(summary?.drives?.previous ?? []).flatMap((d: any) => d.plays ?? []), ...(summary?.drives?.current?.plays ?? [])];
    for (const p of plays) {
      visit(p);
      const t = type(p);
      const turnover = /Interception|Fumble Recovery \(Opponent\)|Fumble Return|Blocked|Field Goal Missed|Missed PAT|Safety/i.test(t);
      if (p.scoringPlay || turnover) add(line(p, !p.scoringPlay ? { tag: /Interception/i.test(t) ? 'Interception' : /Fumble/i.test(t) ? 'Fumble' : /Blocked/i.test(t) ? 'Blocked' : /Safety/i.test(t) ? 'Safety' : 'Missed kick' } : {}));
    }
  } else if (SOCCER.has(lg)) {
    // The key events but the substitutions: goals, cards, penalties. The score is counted from the goals.
    const goals: Record<string, number> = {};
    const awayId = g.away?.team.espnId, homeId = g.home?.team.espnId;
    for (const k of summary?.keyEvents ?? []) {
      visit(k);
      const t = String(k.type?.type ?? '');
      if (/substitution|delay|kickoff|halftime|end|start/i.test(t) && !k.scoringPlay) continue;
      if (k.scoringPlay && k.team?.id) goals[String(k.team.id)] = (goals[String(k.team.id)] ?? 0) + 1;
      const s = k.scoringPlay ? `${away} ${goals[String(awayId)] ?? 0}, ${home} ${goals[String(homeId)] ?? 0}` : undefined;
      add({ id: String(k.id), text: String(k.text ?? k.type?.text ?? ''), when: when(lg, k), scoring: !!k.scoringPlay, score: s, seq });
    }
  }
  for (const [id, a] of alerted) {
    const key = bySig.get(sigOf(a));
    if (key) { alerted.delete(id); if (key.id !== id && !key.ids?.includes(id)) (key.ids ??= []).push(id); }
  }
  return { keyPlays: out.reverse().slice(0, KEY_MAX), alerted };
}

/**
 * One device's key plays: the ones that sent it an alert say so, and its other alerted plays join them in
 * game order, newest first ("Judge struck out swinging" isn't a key play, but it is to someone tracking him).
 */
export function forDevice(h: Highlights, mine: Set<string>): KeyPlay[] {
  const extra = [...mine].map((id) => h.alerted.get(id)).filter((x): x is Placed => !!x);
  return [...h.keyPlays, ...extra].sort((a, b) => b.seq - a.seq)
    .map(({ seq: _seq, ids, ...k }) => ([k.id, ...(ids ?? [])].some((id) => mine.has(id)) ? { ...k, alerted: true } : k));
}
