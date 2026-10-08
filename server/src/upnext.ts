// "Up next" on the Scores tab: each tracked team's next scheduled game, from ESPN's team schedules. The
// Scores tab only has today's scoreboard; this is what comes after (the Falcons' Sunday night game, the
// Yankees' "Game 4 if necessary", Liverpool on Saturday). Kept per team, not per device: every few
// hours, right after the team's game ends, and soon after someone starts tracking it.
import { getJson as espnGetJson, mapLimit } from './espn.ts';
import { catalog, teamDto } from './catalog.ts';
import { SOCCER, teamKey, urls, type League } from './leagues.ts';

/** Seam for tests (test/upnext.test.ts). Production never changes it. */
export const upNextDeps = { getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number }) => Promise<any> };

const REFRESH_MS = Number(process.env.HW_UPNEXT_REFRESH_MS ?? 3 * 3600_000);
const TICK_MS = 60_000;

type TeamDto = ReturnType<typeof teamDto>;
export interface NextGame {
  key: string;            // `${league}:${ESPN event id}`, as a Scores-tab card's (the app hides one already on the tab)
  league: League;
  id: string;
  teamKey: string;        // the tracked team it's the next game of
  startsAt: number;
  timeValid: boolean;     // false: ESPN hasn't set the time yet (the date stands)
  home: TeamDto;
  away: TeamDto;
  tv?: string;            // "NBC", "TBS"
  note?: string;          // "ALDS Game 4 · if necessary", "Preseason"
}

/** A schedule's team as a team: the catalog's, or what the schedule says (an exhibition opponent). */
function side(lg: League, c: any): TeamDto {
  const t = catalog.teamByEspn(lg, String(c.id));
  if (t) return teamDto(t);
  const st = c.team ?? {};
  return {
    kind: 'team', key: teamKey(lg, String(c.id)), league: lg, espnId: String(c.id), name: st.displayName ?? '?', shortName: st.shortDisplayName ?? st.displayName ?? '?',
    abbrev: st.abbreviation ?? '?', location: st.location ?? null, color: st.color ? `#${st.color}` : null, altColor: null,
    logo: st.logos?.[0]?.href ?? '', logoDark: null, logoW: 500, logoH: 500,
  };
}

/** The team's next game that hasn't started, from its ESPN schedule. Pure, for tests on real payloads. */
export function nextFromSchedule(lg: League, teamId: string, res: any, now = Date.now()): NextGame | null {
  const ev = (res?.events ?? [])
    .filter((e: any) => e.competitions?.[0]?.status?.type?.state === 'pre' && Date.parse(e.date) > now - 3600_000)
    .sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date))[0];
  const c = ev?.competitions?.[0];
  const home = c?.competitors?.find((x: any) => x.homeAway === 'home'), away = c?.competitors?.find((x: any) => x.homeAway === 'away');
  if (!home || !away) return null;
  // "ALDS - Game 4 If Necessary" → "ALDS Game 4 · if necessary"; preseason says so.
  const headline = String(c.notes?.[0]?.headline ?? '');
  const ifNecessary = /\bif necessary\b/i.test(headline);
  const round = headline.replace(/\s*if necessary\s*/i, '').replace(/\s+-\s+/, ' ').trim();
  const note = [round, ifNecessary && 'if necessary'].filter(Boolean).join(' · ') || (ev.seasonType?.type === 1 ? 'Preseason' : '');
  const tv = (c.broadcasts ?? []).find((b: any) => b.market?.type === 'National')?.media?.shortName ?? c.broadcasts?.[0]?.media?.shortName;
  return {
    key: `${lg}:${ev.id}`, league: lg, id: String(ev.id), teamKey: teamKey(lg, teamId),
    startsAt: Date.parse(ev.date), timeValid: ev.timeValid !== false && c.timeValid !== false,
    home: side(lg, home), away: side(lg, away),
    ...(tv ? { tv: String(tv) } : {}), ...(note ? { note } : {}),
  };
}

/**
 * One team's next game. A schedule shows its season part (preseason, regular season, postseason); when
 * that part has nothing left (the last preseason game is played), the next part's schedule has it.
 * Soccer schedules list results unless asked for fixtures.
 */
async function fetchNext(lg: League, teamId: string, at = Date.now()): Promise<NextGame | null> {
  const get = (q = '') => upNextDeps.getJson(`${urls.teamSchedule(lg, teamId)}${q}`, { timeoutMs: 10_000 });
  if (SOCCER.has(lg)) return nextFromSchedule(lg, teamId, await get('?fixture=true'), at);
  const current = await get();
  const found = nextFromSchedule(lg, teamId, current, at);
  if (found) return found;
  const part = Number(current?.requestedSeason?.type ?? 0);
  for (const type of [2, 3].filter((t) => t > part)) {
    const later = nextFromSchedule(lg, teamId, await get(`?seasontype=${type}`), at);
    if (later) return later;
  }
  return null;
}

// ─── The live set ─────────────────────────────────────────────────────────────────────────────
const known = new Map<string, { at: number; next: NextGame | null }>(); // teamKey → its next game (null: none scheduled)
let running = false;

/** Refresh the teams that are due: never read, read a while ago, or whose game just ended (stale). */
export async function refreshUpNext(teamKeys: Iterable<string>, now = Date.now()) {
  if (running) return;
  running = true;
  try {
    const due = [...teamKeys].filter((k) => !k.includes(':f1:') && (!known.has(k) || now - known.get(k)!.at >= REFRESH_MS));
    await mapLimit(due, 4, async (key) => {
      const [, lg, id] = key.split(':') as [string, League, string];
      try { known.set(key, { at: Date.now(), next: await fetchNext(lg, id, now) }); } catch { /* try again next tick */ }
    });
  } finally { running = false; }
}

/** A team's next game for its stats page: the one we have, or read now if nobody tracks the team. */
export async function nextGameOf(key: string): Promise<NextGame | null> {
  const have = known.get(key);
  if (have && Date.now() - have.at < REFRESH_MS) return have.next;
  const [, lg, id] = key.split(':') as [string, League, string];
  const next = await fetchNext(lg, id);
  known.set(key, { at: Date.now(), next });
  return next;
}

/** After a team's game ends, its next game is a different one: read it again on the next tick. */
export const staleUpNext = (key: string) => known.delete(key);

/** A device's teams' next games, soonest first; two tracked teams playing each other are one game. */
export function upNextFor(teams: Iterable<string>): NextGame[] {
  const out = new Map<string, NextGame>();
  for (const k of teams) { const n = known.get(k)?.next; if (n && !out.has(n.key)) out.set(n.key, n); }
  return [...out.values()].sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * Every minute: the tracked teams that are due (teamKeys is live.ts's watchedTeamKeys). Returns a kick for
 * a new follow; one that comes during a read gets another read right after it (follows come in bursts).
 */
export function startUpNext(teamKeys: () => Set<string>) {
  let timer: NodeJS.Timeout, busy = false, again = false;
  const tick = async () => {
    if (busy) { again = true; return; }
    busy = true;
    clearTimeout(timer);
    try { do { again = false; await refreshUpNext(teamKeys()).catch(() => {}); } while (again); } finally { busy = false; timer = setTimeout(tick, TICK_MS); }
  };
  void tick();
  return () => void tick();
}
