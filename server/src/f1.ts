// Formula 1. Unlike the game leagues there is no play-by-play: a race weekend is one ESPN event whose
// sessions (FP1..Qual..Race) are competitions, each with per-driver results and statuses.
//   live:  while a race/sprint runs, poll the status of followed drivers → DNF alerts the moment they retire
//   flag:  when a session completes → finishing-position / qualifying alerts
//   table: championship standings → drivers' and constructors' drops
import { getJson as espnGetJson, mapLimit } from './espn.ts';
import { db, kvGet, kvSet } from './db.ts';
import { catalog } from './catalog.ts';
import { urls, playerKey, teamKey } from './leagues.ts';
import { ordinal, type Detected } from './detectors.ts';
import { publish } from './fanout.ts';

const F1_SCAN_MS = Number(process.env.HW_F1_SCAN_MS ?? 30_000);     // scoreboard: sessions going live / finishing
const F1_STATUS_MS = Number(process.env.HW_F1_STATUS_MS ?? 15_000); // followed drivers' race status
const F1_STANDINGS_MS = Number(process.env.HW_STANDINGS_MS ?? 60_000);
/** Results are only announced for sessions that started recently (never re-announce an old race after a deploy). */
const RECENT_MS = 8 * 3600_000;

/**
 * Seams for tests (test/f1-live.test.ts drives a whole simulated race through the real engine with
 * fake ESPN responses). Production never changes these.
 */
export const f1Deps = {
  getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number; bust?: boolean }) => Promise<any>,
  setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
};
const getJson = (url: string, opts?: { timeoutMs?: number; bust?: boolean }) => f1Deps.getJson(url, opts);

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), '[f1]', ...a);

export type Session = 'race' | 'sprint' | 'qual';
export function sessionKind(comp: any): Session | null {
  const t = String(comp?.type?.abbreviation ?? comp?.type?.text ?? '');
  if (/^race$/i.test(t)) return 'race';
  if (/sprint/i.test(t) && !/qual|shootout/i.test(t)) return 'sprint';
  if (/^qual/i.test(t)) return 'qual';
  return null; // practice sessions don't generate alerts
}
const POINTS_CUTOFF: Record<'race' | 'sprint', number> = { race: 10, sprint: 8 };

/** ESPN status names for a car that didn't finish (STATUS_RETIRED, …DSQ, …DNS, …NOT_CLASSIFIED). */
export const isOut = (statusName: string) => /RETIRED|DNF|DSQ|DISQ|DNS|DID_NOT|ACCIDENT|NOT_CLASSIFIED/i.test(statusName);

export interface F1Row {
  id: string;          // ESPN athlete id
  order: number;       // classified / finishing position
  grid: number;        // starting position (0 = unknown)
  out: boolean;        // didn't finish
  outLabel: string;    // ESPN status description, e.g. "Retired", "Disqualified"
  lap: number | null;  // lap the status applies to (retirement lap)
  teamKey?: string;
}
export interface SessionMeta { compId: string; kind: Session; label: string; at: number }

const driverName = (id: string) => catalog.playerByEspn('f1', id)?.name ?? 'Your tracked driver';
const constructorName = (key: string) => catalog.team(key)?.name ?? 'Your tracked team';

function outVerb(r: F1Row) {
  if (/disq/i.test(r.outLabel)) return 'was disqualified';
  if (/not start/i.test(r.outLabel)) return "didn't start";
  if (/retire|accident|dnf/i.test(r.outLabel)) return r.lap ? `retired on lap ${r.lap}` : 'retired';
  return r.outLabel ? r.outLabel.toLowerCase() : "didn't finish";
}

export function dnfEvent(meta: SessionMeta, r: F1Row): Detected {
  return {
    id: `${meta.compId}:f1.driver.dnf:${r.id}`,
    type: 'f1.driver.dnf',
    targetKey: playerKey('f1', r.id),
    title: `${driverName(r.id)} ${outVerb(r)}`,
    body: meta.label,
    at: meta.at,
    meta: { compId: meta.compId, athleteId: r.id },
  };
}

export function doubleDnfEvent(meta: SessionMeta, team: string, rows: F1Row[]): Detected {
  return {
    id: `${meta.compId}:f1.team.double_dnf:${team}`,
    type: 'f1.team.double_dnf',
    aliases: ['f1.team.no_points'], // a double DNF is also a pointless weekend: one alert covers both
    targetKey: team,
    title: `${constructorName(team)}: double DNF`,
    body: `${meta.label}: ${rows.map((r) => `${driverName(r.id)} ${outVerb(r)}`).join('; ')}`,
    at: meta.at,
    meta: { compId: meta.compId },
  };
}

/**
 * Every alert a finished session produces. Pure (results in, alerts out) so it can be tested on real data.
 * One alert per driver per session: the facts that apply are merged into one title, and its `aliases`
 * make it count for each matching toggle (no flood of 3 notifications for one bad afternoon).
 */
export function f1SessionResults(meta: SessionMeta, rows: F1Row[]): Detected[] {
  const out: Detected[] = [];
  if (meta.kind === 'qual') {
    // Q3 is the top 10; the rest are split evenly between Q2 and Q1 knockouts (22 cars: P11-16 / P17-22).
    const cut = Math.max(0, Math.floor((rows.length - 10) / 2));
    for (const r of rows) {
      if (r.order <= 10) continue;
      const stage = r.order > 10 + cut ? 'Q1' : 'Q2';
      out.push({
        id: `${meta.compId}:f1.quali:${r.id}`, type: 'f1.driver.quali_knockout', targetKey: playerKey('f1', r.id),
        title: `${driverName(r.id)} was knocked out in ${stage} (P${r.order})`, body: meta.label, at: meta.at,
        meta: { compId: meta.compId, athleteId: r.id },
      });
    }
    return out;
  }

  const cutoff = POINTS_CUTOFF[meta.kind];
  const byTeam = new Map<string, F1Row[]>();
  for (const r of rows) if (r.teamKey) byTeam.set(r.teamKey, [...(byTeam.get(r.teamKey) ?? []), r]);

  for (const r of rows) {
    if (r.out) { out.push(dnfEvent(meta, r)); continue; }
    const mate = (byTeam.get(r.teamKey ?? '') ?? []).filter((m) => m.id !== r.id && !m.out).sort((a, b) => a.order - b.order)[0];
    const noPoints = r.order > cutoff;
    const lost = r.grid > 0 && r.order - r.grid >= 3;
    const behind = !!mate && mate.order < r.order;
    const types = [noPoints && 'f1.driver.out_of_points', lost && 'f1.driver.lost_places', behind && 'f1.driver.beaten_by_teammate'].filter(Boolean) as string[];
    if (!types.length) continue;
    const details = [noPoints && 'no points', behind && `behind teammate ${driverName(mate!.id)} (P${mate!.order})`].filter(Boolean);
    out.push({
      id: `${meta.compId}:f1.finish:${r.id}`, type: types[0], aliases: types.length > 1 ? types.slice(1) : undefined,
      targetKey: playerKey('f1', r.id),
      title: `${driverName(r.id)} finished P${r.order}${lost ? ` from P${r.grid} on the grid` : ''}${details.length ? `: ${details.join(', ')}` : ''}`,
      body: meta.label, at: meta.at, meta: { compId: meta.compId, athleteId: r.id },
    });
  }

  for (const [team, cars] of byTeam) {
    if (cars.length >= 2 && cars.every((c) => c.out)) out.push(doubleDnfEvent(meta, team, cars));
    else if (cars.every((c) => c.out || c.order > cutoff)) {
      const how = cars.slice().sort((a, b) => a.order - b.order).map((c) => (c.out ? 'DNF' : `P${c.order}`)).join(', ');
      out.push({
        id: `${meta.compId}:f1.team.no_points:${team}`, type: 'f1.team.no_points', targetKey: team,
        title: `${constructorName(team)} scored no points (${how})`, body: meta.label, at: meta.at, meta: { compId: meta.compId },
      });
    }
  }
  return out;
}

// ─── Reading ESPN ─────────────────────────────────────────────────────────────────────────────
const teamOf = (athleteId: string, vehicle?: any) =>
  catalog.playerByEspn('f1', athleteId)?.teamKey
  ?? catalog.allTeams().find((t) => t.league === 'f1' && t.name.toLowerCase() === String(vehicle?.manufacturer ?? '').toLowerCase())?.key;

export async function fetchSessionRows(eventId: string, compId: string, withStatus: boolean): Promise<F1Row[]> {
  const list = await getJson(urls.f1Competitors(eventId, compId), { bust: true });
  const comps = await mapLimit<any, any>(list.items ?? [], 8, (it: any) => getJson(it.$ref, { bust: true }));
  return mapLimit(comps, 8, async (c: any): Promise<F1Row> => {
    const st = withStatus && c.status?.$ref ? await getJson(c.status.$ref, { bust: true }).catch(() => null) : null;
    const name = String(st?.type?.name ?? '');
    return {
      id: String(c.id), order: Number(c.order ?? 0), grid: Number(c.startOrder ?? 0),
      out: isOut(name), outLabel: String(st?.type?.description ?? ''), lap: st?.period ? Number(st.period) : null,
      teamKey: teamOf(String(c.id), c.vehicle),
    };
  });
}

/** Driver ids anyone cares about: followed drivers plus both drivers of every followed constructor. */
export function watchedF1Drivers(): Set<string> {
  const ids = new Set<string>();
  for (const { target_key } of db.prepare("SELECT DISTINCT target_key FROM follows WHERE target_key LIKE '%:f1:%'").all() as { target_key: string }[]) {
    if (target_key.startsWith('player:')) ids.add(target_key.split(':')[2]);
    else for (const p of catalog.roster(target_key)) ids.add(p.espnId);
  }
  return ids;
}

const sessionLabel = (ev: any, comp: any) => `${ev.shortName ?? ev.name} · ${comp.type?.text ?? comp.type?.abbreviation ?? 'Session'}`;

// ─── Live: one watcher per running race/sprint ────────────────────────────────────────────────
class RaceWatch {
  private status = new Map<string, F1Row>();
  private first = true;
  private timer?: unknown;
  readonly eventId: string;
  readonly meta: Omit<SessionMeta, 'at'>;
  constructor(eventId: string, meta: Omit<SessionMeta, 'at'>) { this.eventId = eventId; this.meta = meta; }

  start() { void this.tick(); }
  private stopped = false;
  stop() { this.stopped = true; clearTimeout(this.timer as NodeJS.Timeout); }

  private async tick() {
    try { await this.poll(); } catch (e) { log(`race ${this.meta.compId} poll error`, String(e)); }
    if (!this.stopped) this.timer = f1Deps.setTimeout(() => this.tick(), F1_STATUS_MS);
  }

  async poll() {
    const watched = watchedF1Drivers();
    if (!watched.size) return;
    const ids = [...watched];
    const fresh = await mapLimit(ids, 6, async (id) => {
      const st = await getJson(urls.f1Status(this.eventId, this.meta.compId, id), { bust: true, timeoutMs: 5000 }).catch(() => null);
      if (!st?.type) return null; // not entered in this session
      return { id, order: 0, grid: 0, out: isOut(String(st.type.name)), outLabel: String(st.type.description ?? ''), lap: st.period ? Number(st.period) : null, teamKey: teamOf(id) } as F1Row;
    });
    const events: Detected[] = [];
    const at = Date.now();
    for (const r of fresh) {
      if (!r) continue;
      const was = this.status.get(r.id);
      this.status.set(r.id, r);
      // First poll is a silent baseline: we may have attached mid-race (the final results catch up later).
      if (this.first || !r.out || was?.out) continue;
      events.push(dnfEvent({ ...this.meta, at }, r));
      const mates = [...this.status.values()].filter((m) => m.teamKey && m.teamKey === r.teamKey);
      if (mates.length >= 2 && mates.every((m) => m.out)) events.push(doubleDnfEvent({ ...this.meta, at }, r.teamKey!, mates));
    }
    this.first = false;
    if (events.length) publish(events, 'f1');
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────────────────────────
export const races = new Map<string, RaceWatch>();
const finalized = new Set<string>();

export async function scanF1() {
  if (!watchedF1Drivers().size) { for (const w of races.values()) w.stop(); races.clear(); return; }
  const sb = await getJson(urls.scoreboard('f1'), { bust: true, timeoutMs: 8000 });
  for (const ev of sb.events ?? []) {
    for (const comp of ev.competitions ?? []) {
      const kind = sessionKind(comp);
      if (!kind) continue;
      const state = comp.status?.type?.state;
      const meta = { compId: String(comp.id), kind, label: sessionLabel(ev, comp) };
      if (kind !== 'qual' && state === 'in' && !races.has(meta.compId)) {
        const w = new RaceWatch(String(ev.id), meta);
        races.set(meta.compId, w);
        log(`watching ${meta.label}`);
        w.start();
      }
      if (state === 'post') { races.get(meta.compId)?.stop(); races.delete(meta.compId); }
      const recent = Date.now() - Date.parse(comp.date) < RECENT_MS;
      if (comp.status?.type?.completed && recent && !finalized.has(meta.compId)) {
        finalized.add(meta.compId);
        const rows = await fetchSessionRows(String(ev.id), meta.compId, kind !== 'qual');
        const events = f1SessionResults({ ...meta, at: Date.now() }, rows);
        log(`${meta.label} finished: ${events.length} alert(s)`);
        if (events.length) publish(events, 'f1');
      }
    }
  }
}

/** Drivers' and constructors' championship drops. The first snapshot is a silent baseline. */
async function scanF1Standings() {
  const res = await getJson(urls.standings('f1'), { timeoutMs: 8000 });
  const now: Record<string, { rank: number; pts: string }> = {};
  for (const child of res.children ?? []) {
    const isDrivers = /driver/i.test(child.name);
    for (const e of child.standings?.entries ?? []) {
      const rank = Number(e.stats?.find((s: any) => s.name === 'rank')?.value ?? 0);
      const pts = String(e.stats?.find((s: any) => s.type === 'points')?.displayValue ?? '');
      const key = isDrivers ? playerKey('f1', String(e.athlete?.id)) : teamKey('f1', String(e.team?.id));
      if (rank) now[key] = { rank, pts };
    }
  }
  if (!Object.keys(now).length) return;
  const prev = kvGet<typeof now>('standings:f1');
  kvSet('standings:f1', now);
  if (!prev) return;
  const day = new Date().toISOString().slice(0, 10);
  const events: Detected[] = [];
  for (const [key, cur] of Object.entries(now)) {
    const was = prev[key];
    if (!was || cur.rank <= was.rank) continue;
    const driver = key.startsWith('player:');
    const name = driver ? driverName(key.split(':')[2]) : constructorName(key);
    events.push({
      id: `f1st:${key}:${day}:${was.rank}->${cur.rank}`,
      type: driver ? 'f1.driver.standings_drop' : 'team.standings_drop',
      targetKey: key,
      title: `${name} dropped to ${ordinal(cur.rank)} in the ${driver ? "drivers'" : "constructors'"} championship`,
      body: `Down from ${ordinal(was.rank)} · ${cur.pts} pts`,
      at: Date.now(),
    });
  }
  if (events.length) publish(events, 'f1');
}

/** Wired up by the live engine, which owns the scheduling helper. Returns a function that rescans now. */
export function startF1(every: (ms: number, fn: () => Promise<void>) => () => void) {
  const kick = every(F1_SCAN_MS, scanF1);
  every(F1_STANDINGS_MS, scanF1Standings);
  return kick;
}

export function f1Status() {
  return [...races.values()].map((w) => ({ league: 'f1', session: w.meta.label }));
}
