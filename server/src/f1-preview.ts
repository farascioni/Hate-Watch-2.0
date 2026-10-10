// An F1 weekend's preview, as other sports' previews come before a game: the game screen of a session
// that hasn't started, and the Scores tab's next weekend. Where and when (the circuit, each session's time
// and state, a live card's state over the season scoreboard's), the grid of the next sprint or race once
// it's set (ESPN lists a session's cars only then: after the shootout for a sprint, after qualifying for
// the race), and the championship with each driver's last three races (f1-stats.ts). ESPN has no F1 odds.
// Each part stands alone: the standings failing still leaves the schedule and the grid.
import { getJson as espnGetJson } from './espn.ts';
import { catalog } from './catalog.ts';
import { urls, playerKey, teamKey } from './leagues.ts';
import { getGame, sessionName } from './scores.ts';
import { f1Season, place, teamNamed } from './f1-stats.ts';

/** Seam for tests (test/f1-preview.test.ts). */
export const f1PreviewDeps = { getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number }) => Promise<any>, now: () => Date.now() };
const get = (url: string) => f1PreviewDeps.getJson(url, { timeoutMs: 8000 });
const BOARD_TTL_MS = 10 * 60_000, GRID_TTL_MS = 60_000, FORM = 3;

type State = 'pre' | 'in' | 'post';
export interface F1Preview {
  /** `startsAt`, `endsAt`: its first and last sessions' starts. */
  event: { id: string; name: string; shortName: string; circuit: string | null; place: string | null; startsAt: number; endsAt: number };
  /** Every session of the weekend, practice too; `key` is its Scores card's (the game screen). */
  sessions: { key: string; name: string; at: number; state: State }[];
  /** The next sprint or race's grid once it's set (`key`: that session's); else `gridAfter`: what sets it ("Qualifying"). */
  grid: { key: string; session: string; cars: { key: string; name: string; teamKey: string | null; grid: number }[] } | null;
  gridAfter?: string;
  /** The championship (empty if ESPN's standings didn't load), each driver with their last races, latest first ("P4", "DNF"). */
  drivers: { key: string; name: string; teamKey: string | null; rank: number; points: number; form: string[] }[];
  constructors: { key: string; name: string; rank: number; points: number }[];
}

/** Reads kept `ttl` ms (a failed one isn't). */
function cached<T>(ttl: number) {
  const m = new Map<string, { at: number; value: Promise<T> }>();
  const read = (key: string, fetch: () => Promise<T>) => {
    const hit = m.get(key);
    if (hit && f1PreviewDeps.now() - hit.at < ttl) return hit.value;
    const value = fetch();
    m.set(key, { at: f1PreviewDeps.now(), value });
    value.catch(() => m.delete(key));
    return value;
  };
  return Object.assign(read, { clear: () => m.clear() });
}
const boards = cached<any>(BOARD_TTL_MS), grids = cached<F1Preview['grid']>(GRID_TTL_MS);
/** For tests: forget what was read. */
export const forgetF1Preview = () => { boards.clear(); grids.clear(); };

/** The season's events (its scoreboard, every weekend with its sessions' times), this year's and, near the turn of the year, next. */
async function findEvent(eventId: string): Promise<any | null> {
  const year = new Date(f1PreviewDeps.now()).getUTCFullYear();
  for (const y of [year, year + 1]) {
    const board = await boards(String(y), () => get(urls.scoreboard('f1', String(y))));
    const ev = board?.events?.find((e: any) => String(e.id) === eventId);
    if (ev) return ev;
  }
  return null;
}

/** A session's grid, if ESPN has set it: its cars by starting place. */
async function gridOf(eventId: string, comp: any): Promise<F1Preview['grid']> {
  return grids(String(comp.id), async () => {
    const list = await get(urls.f1Competitors(eventId, String(comp.id)));
    const cars = (list?.items ?? []).filter((c: any) => Number(c.startOrder) > 0).map((c: any) => {
      const id = String(c.id), p = catalog.playerByEspn('f1', id);
      return { key: playerKey('f1', id), name: p?.name ?? '?', teamKey: teamNamed(String(c.vehicle?.manufacturer ?? '')) ?? p?.teamKey ?? null, grid: Number(c.startOrder) };
    }).sort((a: { grid: number }, b: { grid: number }) => a.grid - b.grid);
    return cars.length ? { key: `f1:${comp.id}`, session: sessionName(comp), cars } : null;
  });
}

/** An F1 weekend's preview, or null for an event ESPN doesn't have. */
export async function f1Preview(eventId: string): Promise<F1Preview | null> {
  const ev = await findEvent(eventId);
  if (!ev) return null;
  const comps: any[] = [...(ev.competitions ?? [])].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const sessions = comps.map((c) => {
    const key = `f1:${c.id}`, board = c.status?.type?.state;
    return { key, name: sessionName(c), at: Date.parse(c.date) || 0, state: (getGame(key)?.state ?? (['pre', 'in', 'post'].includes(board) ? board : 'pre')) as State };
  });
  // The next sprint or race not over: its grid if it's set, else what sets it.
  const next = comps.find((c, i) => ['SR', 'Race'].includes(c.type?.abbreviation) && sessions[i].state !== 'post');
  const grid = next ? await gridOf(String(ev.id), next).catch(() => null) : null;
  const gridAfter = next && !grid ? (next.type?.abbreviation === 'SR' ? 'Sprint Shootout' : 'Qualifying') : undefined;

  let drivers: F1Preview['drivers'] = [], constructors: F1Preview['constructors'] = [];
  try {
    const s = await f1Season();
    drivers = [...s.drivers].sort((a, b) => a.rank - b.rank).map((d) => {
      const raced = s.races.map((r) => ({ r, car: r.cars.find((c) => c.driverId === d.id) })).filter((x) => x.car);
      return {
        key: playerKey('f1', d.id), name: catalog.playerByEspn('f1', d.id)?.name ?? '?', teamKey: raced.at(-1)?.car?.teamKey ?? catalog.playerByEspn('f1', d.id)?.teamKey ?? null,
        rank: d.rank, points: d.points, form: raced.slice(-FORM).reverse().map(({ car }) => place(car!)),
      };
    });
    constructors = [...s.constructors].sort((a, b) => a.rank - b.rank).map((t) => ({ key: teamKey('f1', t.id), name: catalog.team(teamKey('f1', t.id))?.name ?? '?', rank: t.rank, points: t.points }));
  } catch { /* the schedule and the grid stand without it */ }

  const at = sessions.map((x) => x.at).filter(Boolean);
  return {
    event: {
      id: String(ev.id), name: String(ev.name), shortName: String(ev.shortName ?? ev.name), circuit: ev.circuit?.fullName ?? null,
      place: [...new Set([ev.circuit?.address?.city, ev.circuit?.address?.country].filter(Boolean))].join(', ') || null, startsAt: Math.min(...at), endsAt: Math.max(...at), // "Singapore", not "Singapore, Singapore"
    },
    sessions, grid, ...(gridAfter ? { gridAfter } : {}), drivers, constructors,
  };
}
