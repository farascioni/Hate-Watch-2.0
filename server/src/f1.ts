// Formula 1. Unlike the game leagues there is no play-by-play: a race weekend is one ESPN event whose
// sessions (FP1..Qual..Race) are competitions, each with per-driver results and statuses.
//   start: lights out → one "Hate Watch Starting" for a device, naming its constructors and drivers in it
//   live:  while a race/sprint runs, poll the status of followed drivers → DNF alerts the moment they retire
//   flag:  when a race/sprint is over (ESPN's "session complete", not the final up to 40 minutes later) and
//          qualifying is final → finishing-position / qualifying alerts; a change after (a penalty) corrects them
//   table: championship standings → drivers' and constructors' drops (a line on that day's alert, when there is one)
// A team's alert and its drivers' saying the same thing share a moment (fanout.ts): a device tracking both gets
// the team's. Several alerts for a device in one publish are one notification (fanout.ts `bundled`).
import { getJson as espnGetJson, mapLimit } from './espn.ts';
import { db, kvGet, kvSet } from './db.ts';
import { catalog } from './catalog.ts';
import { urls, playerKey, teamKey } from './leagues.ts';
import { START_WORD, ordinal, type Detected } from './detectors.ts';
import { publish, reviseEvent } from './fanout.ts';
import { raceCard, sessionName, setF1Calendar, upsertGame } from './scores.ts';

const F1_SCAN_MS = Number(process.env.HW_F1_SCAN_MS ?? 30_000);     // scoreboard: sessions going live / finishing
const F1_STATUS_MS = Number(process.env.HW_F1_STATUS_MS ?? 15_000); // followed drivers' race status
const F1_STANDINGS_MS = Number(process.env.HW_STANDINGS_MS ?? 60_000);
/** Results are only announced (and corrected) for sessions that started recently (never re-announce an old race after a deploy). */
const RECENT_MS = 8 * 3600_000;
/** A championship drop is a line on the device's result alert about them from this long ago, if it has one. */
const DROP_ON_MS = 12 * 3600_000;
/** A session's result alerts (not its start or back of the grid), as a feed row's type. */
const RESULT_TYPES = ['f1.driver.dnf', 'f1.driver.out_of_points', 'f1.driver.lost_places', 'f1.driver.beaten_by_teammate', 'f1.driver.lapped',
  'f1.driver.quali_knockout', 'f1.driver.outqualified', 'f1.team.double_dnf', 'f1.team.no_points'];

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
/**
 * The sessions with alerts. ESPN names one by its abbreviation alone: "Race", "SR" (the sprint), "Qual";
 * not "SS" (the sprint shootout) or practice. A name of its own ("Sprint"), where a feed has one, also counts.
 */
export function sessionKind(comp: any): Session | null {
  const a = String(comp?.type?.abbreviation ?? ''), t = String(comp?.type?.text ?? '');
  if (/^race$/i.test(a) || /^race$/i.test(t)) return 'race';
  if (/^(SR|sprint)$/i.test(a) || (/sprint/i.test(t) && !/qual|shootout/i.test(t))) return 'sprint';
  if (/^qual/i.test(a) || /^qual/i.test(t)) return 'qual';
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
  lapsDown?: number;   // a classified finisher this many laps behind the winner (ESPN's behindLaps)
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

/**
 * An alert's facts (meta.facts): what a later read of the results is compared on (settleResults), not its
 * words, so the same result said another way isn't a correction.
 */
export function dnfEvent(meta: SessionMeta, r: F1Row): Detected {
  const title = `${driverName(r.id)} ${outVerb(r)}`;
  return {
    id: `${meta.compId}:f1.driver.dnf:${r.id}`,
    type: 'f1.driver.dnf',
    targetKey: playerKey('f1', r.id),
    title,
    body: meta.label,
    at: meta.at,
    meta: { compId: meta.compId, athleteId: r.id, label: meta.label, facts: 'out' },
  };
}

/** Out first, by the lap they went (then by id): "Sergio Pérez retired on lap 1; Valtteri Bottas retired on lap 6". */
const byLapOut = (a: F1Row, b: F1Row) => (a.lap ?? 0) - (b.lap ?? 0) || a.id.localeCompare(b.id);

export function doubleDnfEvent(meta: SessionMeta, team: string, rows: F1Row[]): Detected {
  return {
    id: `${meta.compId}:f1.team.double_dnf:${team}`,
    type: 'f1.team.double_dnf',
    aliases: ['f1.team.no_points'], // a double DNF is also a pointless weekend: one alert covers both
    targetKey: team,
    title: `${constructorName(team)}: double DNF`,
    body: `${meta.label}: ${[...rows].sort(byLapOut).map((r) => `${driverName(r.id)} ${outVerb(r)}`).join('; ')}`,
    at: meta.at,
    meta: { compId: meta.compId, label: meta.label, facts: `double_dnf:${rows.map((r) => r.id).sort().join(',')}` },
  };
}

/** Lights out with a driver on the last row of the grid (the last two places): "Lance Stroll starts from the back of the grid (P22)". */
export function backOfGrid(meta: SessionMeta, rows: F1Row[]): Detected[] {
  const n = rows.length;
  return rows.filter((r) => r.grid > 0 && n >= 10 && r.grid >= n - 1).map((r) => ({
    id: `${meta.compId}:f1.driver.back_of_grid:${r.id}`, type: 'f1.driver.back_of_grid', targetKey: playerKey('f1', r.id),
    title: `${driverName(r.id)} starts from the back of the grid (P${r.grid})`, body: meta.label, at: meta.at, meta: { compId: meta.compId, athleteId: r.id, label: meta.label },
  }));
}

/**
 * Lights out: "Hate Watch Starting" for each constructor and each driver in the session (only followed ones are
 * stored), one alert for a device: they share a moment, and each is a name on one line of it. "Hate Watch
 * Starting: Singapore GP · Sprint. Yours: Alpine, George Russell. Valtteri Bottas starts from the back of the
 * grid (P21). Lights out." The back of the grid's alerts are lines on it (alerts of their own for a device with
 * the start alerts off). Constructors first (by name), then drivers in grid order. `rows`: the session's cars;
 * none (ESPN's list didn't load): every constructor, no drivers. No single opponent in F1.
 */
export function startEvents(meta: SessionMeta, rows: F1Row[]): Detected[] {
  const moment = `${meta.compId}:start`;
  const common = { title: `Hate Watch Starting: ${meta.label}`, body: `${START_WORD.f1}.`, at: meta.at, moment, meta: { compId: meta.compId, label: meta.label } };
  const teams = rows.length ? [...new Set(rows.map((r) => r.teamKey).filter((k): k is string => !!k))] : catalog.allTeams().filter((t) => t.league === 'f1').map((t) => t.key);
  return [
    ...teams.sort((a, b) => constructorName(a).localeCompare(constructorName(b))).map((key): Detected => ({
      ...common, id: `${meta.compId}:team.game_start:${key}`, type: 'team.game_start', targetKey: key, list: { label: 'Yours', item: constructorName(key) },
    })),
    ...[...rows].sort((a, b) => (a.grid || 99) - (b.grid || 99)).map((r): Detected => ({
      ...common, id: `${meta.compId}:f1.driver.session_start:${r.id}`, type: 'f1.driver.session_start', targetKey: playerKey('f1', r.id), list: { label: 'Yours', item: driverName(r.id) },
    })),
    ...backOfGrid(meta, rows).map((e) => ({ ...e, moment, fold: `${e.title}.` })),
  ];
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
    // Out-qualified by the teammate is part of the same alert (aliases): one per driver.
    const cut = Math.max(0, Math.floor((rows.length - 10) / 2));
    for (const r of rows) {
      const mate = rows.find((m) => m.id !== r.id && m.teamKey && m.teamKey === r.teamKey && m.order > 0);
      const knocked = r.order > 10, behind = !!mate && r.order > 0 && mate.order < r.order;
      const types = [knocked && 'f1.driver.quali_knockout', behind && 'f1.driver.outqualified'].filter(Boolean) as string[];
      if (!types.length) continue;
      const stage = r.order > 10 + cut ? 'Q1' : 'Q2';
      out.push({
        id: `${meta.compId}:f1.quali:${r.id}`, type: types[0], ...(types.length > 1 ? { aliases: types.slice(1) } : {}), targetKey: playerKey('f1', r.id),
        title: knocked ? `${driverName(r.id)} was knocked out in ${stage} (P${r.order})${behind ? `, behind teammate ${driverName(mate!.id)} (P${mate!.order})` : ''}`
          : `${driverName(r.id)} was out-qualified by teammate ${driverName(mate!.id)} (P${r.order} to P${mate!.order})`,
        body: meta.label, at: meta.at, meta: { compId: meta.compId, athleteId: r.id, label: meta.label },
      });
      out.at(-1)!.meta!.facts = out.at(-1)!.title;
    }
    return out;
  }

  const cutoff = POINTS_CUTOFF[meta.kind];
  const byTeam = new Map<string, F1Row[]>();
  for (const r of rows) if (r.teamKey) byTeam.set(r.teamKey, [...(byTeam.get(r.teamKey) ?? []), r]);

  // The teams' alerts first: a double DNF, or no points. Each is a moment with its drivers' alerts that say
  // nothing more (their DNF, their "no points"), so a device tracking the team and a driver gets the team's.
  const teams: Detected[] = [], absorbed = new Map<string, string>(); // driver id → their team's moment
  for (const [team, cars] of byTeam) {
    const moment = `${meta.compId}:team:${team}`;
    if (cars.length >= 2 && cars.every((c) => c.out)) teams.push({ ...doubleDnfEvent(meta, team, cars), moment });
    else if (cars.every((c) => c.out || c.order > cutoff)) {
      const sorted = [...cars].sort((a, b) => (a.out ? 99 : a.order) - (b.out ? 99 : b.order) || byLapOut(a, b));
      teams.push({
        id: `${meta.compId}:f1.team.no_points:${team}`, type: 'f1.team.no_points', targetKey: team, moment,
        title: `Successful Hate Watch! ${constructorName(team)} finished outside the points`,
        body: `${meta.label}: ${sorted.map((c) => [catalog.playerByEspn('f1', c.id)?.name, c.out ? 'DNF' : `P${c.order}`].filter(Boolean).join(' ')).join(', ')}`, at: meta.at,
        meta: { compId: meta.compId, label: meta.label, facts: `no_points:${[...cars].sort((a, b) => a.id.localeCompare(b.id)).map((c) => `${c.id}:${c.out ? 'out' : c.order}`).join(',')}` },
      });
    } else continue;
    for (const c of cars) absorbed.set(c.id, moment);
  }

  const drivers: Detected[] = [];
  for (const r of rows) {
    if (r.out) {
      const e = dnfEvent(meta, r), moment = absorbed.get(r.id);
      drivers.push(moment ? { ...e, moment } : e);
      continue;
    }
    const mate = (byTeam.get(r.teamKey ?? '') ?? []).filter((m) => m.id !== r.id && !m.out).sort((a, b) => a.order - b.order)[0];
    const noPoints = r.order > cutoff;
    const lost = r.grid > 0 && r.order - r.grid >= 3;
    const behind = !!mate && mate.order < r.order;
    const lapped = (r.lapsDown ?? 0) >= 1;
    const types = [noPoints && 'f1.driver.out_of_points', lost && 'f1.driver.lost_places', behind && 'f1.driver.beaten_by_teammate', lapped && 'f1.driver.lapped'].filter(Boolean) as string[];
    if (!types.length) continue;
    const details = [noPoints && 'no points', lapped && (r.lapsDown === 1 ? 'lapped' : `${r.lapsDown} laps down`), behind && `behind teammate ${driverName(mate!.id)} (P${mate!.order})`].filter(Boolean);
    const title = `${driverName(r.id)} finished P${r.order}${lost ? ` from P${r.grid} on the grid` : ''}${details.length ? `: ${details.join(', ')}` : ''}`;
    // Only "no points": the team's alert says it ("Pierre Gasly P9"). Anything more is an alert of its own.
    const moment = types.length === 1 && noPoints ? absorbed.get(r.id) : undefined;
    drivers.push({
      id: `${meta.compId}:f1.finish:${r.id}`, type: types[0], aliases: types.length > 1 ? types.slice(1) : undefined,
      targetKey: playerKey('f1', r.id), title, body: meta.label, at: meta.at, ...(moment ? { moment } : {}),
      meta: { compId: meta.compId, athleteId: r.id, label: meta.label, facts: title },
    });
  }
  return [...teams, ...drivers];
}

// ─── Reading ESPN ─────────────────────────────────────────────────────────────────────────────
/** A car's constructor: the one ESPN has it entered for in this session (drivers swap seats mid-season), else the catalog's. */
const teamOf = (athleteId: string, vehicle?: any) =>
  catalog.allTeams().find((t) => t.league === 'f1' && t.name.toLowerCase() === String(vehicle?.manufacturer ?? '').toLowerCase())?.key
  ?? catalog.playerByEspn('f1', athleteId)?.teamKey;

/** A session's cars. `order`: each car's place from the scoreboard (the order results are read on), over the competitor list's. */
export async function fetchSessionRows(eventId: string, compId: string, withStatus: boolean, order?: Map<string, number>): Promise<F1Row[]> {
  const list = await getJson(urls.f1Competitors(eventId, compId), { bust: true });
  const comps = await mapLimit<any, any>(list.items ?? [], 8, (it: any) => getJson(it.$ref, { bust: true }));
  return mapLimit(comps, 8, async (c: any): Promise<F1Row> => {
    const st = withStatus && c.status?.$ref ? await getJson(c.status.$ref, { bust: true }).catch(() => null) : null;
    const name = String(st?.type?.name ?? '');
    // Laps down, for a classified finisher (a retired car's laps behind aren't news: it's out). Not one still on
    // track when the session's over (read at "session complete"): its laps behind may not have caught up yet.
    const classified = !isOut(name) && !/ON_TRACK|IN_PROGRESS|RUNNING/i.test(name);
    const stats = withStatus && classified && c.statistics?.$ref ? await getJson(c.statistics.$ref, { bust: true }).catch(() => null) : null;
    const behind = stats?.splits?.categories?.flatMap((x: any) => x.stats ?? []).find((x: any) => x.name === 'behindLaps')?.value;
    return {
      id: String(c.id), order: order?.get(String(c.id)) ?? Number(c.order ?? 0), grid: Number(c.startOrder ?? 0),
      out: isOut(name), outLabel: String(st?.type?.description ?? ''), lap: st?.period ? Number(st.period) : null,
      teamKey: teamOf(String(c.id), c.vehicle), ...(Number(behind) > 0 ? { lapsDown: Number(behind) } : {}),
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

const sessionLabel = (ev: any, comp: any) => `${ev.shortName ?? ev.name} · ${sessionName(comp)}`;

// ─── Live: one watcher per running race/sprint ────────────────────────────────────────────────
class RaceWatch {
  private status = new Map<string, F1Row>();
  /** Each car's constructor in this session (read once): a double DNF is the two cars of a team that day. */
  private teams?: Map<string, string>;
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
    this.teams ??= await getJson(urls.f1Competitors(this.eventId, this.meta.compId), { timeoutMs: 5000 })
      .then((list) => new Map<string, string>((list.items ?? []).flatMap((c: any) => { const t = teamOf(String(c.id), c.vehicle); return t ? [[String(c.id), t]] : []; })))
      .catch(() => undefined);
    const fresh = await mapLimit(ids, 6, async (id) => {
      const st = await getJson(urls.f1Status(this.eventId, this.meta.compId, id), { bust: true, timeoutMs: 5000 }).catch(() => null);
      if (!st?.type) return null; // not entered in this session
      return { id, order: 0, grid: 0, out: isOut(String(st.type.name)), outLabel: String(st.type.description ?? ''), lap: st.period ? Number(st.period) : null, teamKey: this.teams?.get(id) ?? teamOf(id) } as F1Row;
    });
    const events: Detected[] = [];
    const at = Date.now();
    for (const r of fresh) {
      if (!r) continue;
      const was = this.status.get(r.id);
      this.status.set(r.id, r);
      // First poll is a silent baseline: we may have attached mid-race (the final results catch up later).
      if (this.first || !r.out || was?.out) continue;
      const dnf = dnfEvent({ ...this.meta, at }, r);
      const mates = [...this.status.values()].filter((m) => m.teamKey && m.teamKey === r.teamKey);
      // The second car out: the team's double DNF, which says it, and the driver's DNF a moment with it
      // (a device tracking the team and the driver gets the team's; one tracking just the driver, theirs).
      if (mates.length >= 2 && mates.every((m) => m.out)) {
        const moment = `${this.meta.compId}:team:${r.teamKey}`;
        events.push({ ...doubleDnfEvent({ ...this.meta, at }, r.teamKey!, mates), moment }, { ...dnf, moment });
      } else events.push(dnf);
    }
    this.first = false;
    if (events.length) publish(events, 'f1');
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────────────────────────
export const races = new Map<string, RaceWatch>();
/** Races/sprints seen before lights out: only their start is news (not one found already running after a restart). */
const preSeen = new Set<string>();
/**
 * Each session's results as last read: the scoreboard's order and status they were read on (`done`), and a
 * different one seen once since (`pending`): a change is read again once it holds for a second scan.
 */
const resultsSeen = new Map<string, { done: string; pending?: string }>();
/** The result alerts of a session (not its start, back of the grid): what a later read is compared with. */
const RESULT_ID = /^[^:]+:(f1\.finish|f1\.driver\.dnf|f1\.team\.no_points|f1\.team\.double_dnf|f1\.quali):(.+)$/;
const CORRECTED = 'the result changed after this alert';

/**
 * A session's results, read again: an alert whose facts changed is corrected in place (no push); one now true
 * is sent; one no longer true says what the result is now ("Correction: Pierre Gasly finished P8"), and isn't a
 * Successful Hate Watch any more. Compared with what's stored, so a restart corrects too, and alerts stored
 * before they had facts are left as they are. Returns the alerts to send.
 */
export function settleResults(meta: SessionMeta, events: Detected[], rows: F1Row[]): { fresh: Detected[]; revised: number; withdrawn: number } {
  const stored = new Map((db.prepare('SELECT id, type, title, body, meta FROM events WHERE id LIKE ?').all(`${meta.compId}:%`) as { id: string; type: string; title: string; body: string; meta: string | null }[])
    .filter((r) => RESULT_ID.test(r.id)).map((r) => [r.id, { ...r, meta: (r.meta ? JSON.parse(r.meta) : {}) as Record<string, any> }]));
  const fresh: Detected[] = [];
  let revised = 0, withdrawn = 0;
  for (const e of events) {
    const was = stored.get(e.id);
    stored.delete(e.id);
    if (!was) fresh.push(e);
    else if (was.meta.facts && (was.meta.facts !== e.meta?.facts || was.meta.withdrawn)) { reviseEvent(e.id, e); revised++; }
  }
  for (const [id, was] of stored) {
    if (!was.meta.facts || was.meta.withdrawn) continue;
    const [, kind, who] = id.match(RESULT_ID)!;
    const r = rows.find((x) => x.id === who), cars = rows.filter((x) => x.teamKey === who);
    const now = kind.startsWith('f1.team.') ? `${constructorName(who)} finished ${cars.sort((a, b) => (a.out ? 99 : a.order) - (b.out ? 99 : b.order)).map((c) => (c.out ? 'DNF' : `P${c.order}`)).join(', ') || 'differently'}`
      : !r ? `${driverName(who)}'s result changed` : r.out ? `${driverName(who)} ${outVerb(r)}` : `${driverName(who)} ${kind === 'f1.quali' ? 'qualified' : 'finished'} P${r.order}`;
    reviseEvent(id, { type: was.type, aliases: was.meta.aliases, title: `Correction: ${now}`, body: `${meta.label}: ${CORRECTED}.`, meta: { facts: `withdrawn:${was.meta.facts}` }, withdrawn: true });
    withdrawn++;
  }
  return { fresh, revised, withdrawn };
}

/**
 * A finished session's results. A race or sprint is read when ESPN says it's over ("session complete", minutes
 * after the flag), not when it's final (up to 40 minutes later), on the scoreboard's order (its own list lags);
 * qualifying when it's final (ESPN's "complete" there may be between Q1, Q2 and Q3). Then read again when the
 * order or status changes and holds (the final, a penalty), to correct what went out.
 */
async function settleSession(ev: any, comp: any, meta: Omit<SessionMeta, 'at'>) {
  const order = new Map<string, number>((comp.competitors ?? []).map((c: any) => [String(c.id), Number(c.order) || 0]));
  if ([...order.values()].some((n) => n <= 0)) order.clear(); // not a whole order: the competitor list's instead
  const sig = `${comp.status?.type?.name}|${[...order].sort(([, a], [, b]) => a - b).map(([id, n]) => `${id}:${n}`).join(' ')}`;
  const seen = resultsSeen.get(meta.compId);
  if (seen?.done === sig) { if (seen.pending) resultsSeen.set(meta.compId, { done: sig }); return; }
  if (seen && seen.pending !== sig) { resultsSeen.set(meta.compId, { ...seen, pending: sig }); return; }
  const rows = await fetchSessionRows(String(ev.id), meta.compId, meta.kind !== 'qual', order.size ? order : undefined);
  const events = f1SessionResults({ ...meta, at: Date.now() }, rows);
  const { fresh, revised, withdrawn } = settleResults({ ...meta, at: Date.now() }, events, rows);
  resultsSeen.set(meta.compId, { done: sig });
  log(`${meta.label} ${seen ? 'results changed' : 'finished'}: ${fresh.length} new alert(s)${seen ? `, ${revised} corrected, ${withdrawn} withdrawn` : ''}`);
  if (fresh.length) publish(fresh, 'f1');
}

export async function scanF1() {
  if (!watchedF1Drivers().size) { for (const w of races.values()) w.stop(); races.clear(); return; }
  const sb = await getJson(urls.scoreboard('f1'), { bust: true, timeoutMs: 8000 });
  setF1Calendar(sb.leagues?.[0]?.calendar); // between weekends the scoreboard still shows the last one
  for (const ev of sb.events ?? []) {
    for (const comp of ev.competitions ?? []) {
      const kind = sessionKind(comp);
      if (!kind) continue;
      const state = comp.status?.type?.state;
      const meta = { compId: String(comp.id), kind, label: sessionLabel(ev, comp) };
      upsertGame(raceCard(ev, comp)); // the Scores tab (the running order is on the scoreboard)
      if (kind !== 'qual' && state === 'pre') preSeen.add(meta.compId);
      if (kind !== 'qual' && state === 'in' && !races.has(meta.compId)) {
        if (preSeen.delete(meta.compId)) {
          // The start and the back of the grid in one publish (one alert for a device): the session's cars,
          // else the scoreboard's (no grid then).
          const at = Date.now();
          const fallback = (comp.competitors ?? []).map((c: any): F1Row => ({ id: String(c.id), order: 0, grid: 0, out: false, outLabel: '', lap: null, teamKey: teamOf(String(c.id)) }));
          void fetchSessionRows(String(ev.id), meta.compId, false).catch(() => fallback)
            .then((rows) => publish(startEvents({ ...meta, at }, rows.length ? rows : fallback), 'f1'));
        }
        const w = new RaceWatch(String(ev.id), meta);
        races.set(meta.compId, w);
        log(`watching ${meta.label}`);
        w.start();
      }
      if (state === 'post') { races.get(meta.compId)?.stop(); races.delete(meta.compId); preSeen.delete(meta.compId); }
      const recent = Date.now() - Date.parse(comp.date) < RECENT_MS;
      const over = !!comp.status?.type?.completed || (kind !== 'qual' && /SESSION_COMPLETE/i.test(String(comp.status?.type?.name ?? '')));
      if (over && recent) await settleSession(ev, comp, meta).catch((e) => log(`${meta.label} results error`, String(e)));
    }
  }
}

/** Drivers' and constructors' championship drops. The first snapshot is a silent baseline. */
export async function scanF1Standings() {
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
      // A line on that day's race or sprint alert about them, when the device has one.
      lateOn: { targetKey: key, since: Date.now() - DROP_ON_MS, types: RESULT_TYPES, line: `Down to ${ordinal(cur.rank)} in the ${driver ? "drivers'" : "constructors'"} championship (${cur.pts} pts).` },
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
