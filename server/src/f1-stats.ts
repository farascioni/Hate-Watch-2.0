// F1's stats pages (the Stats tab), for drivers and constructors, from ESPN's season: the championship
// standings (rank, points, each weekend's points), the season scoreboard (every session's finishing order,
// one read), and each finished race's cars (a read of its competitors: who drove for which team that day,
// where they started; and each car's status, for a retirement, which the order doesn't show: a car can be
// classified P20 and have retired on lap 46). A finished race's cars are kept (kv), so each is read once.
//   Drivers: points and place in the championship, wins, podiums, poles, DNFs, average finish, races ahead
//            of their teammate (the other car that day), and their last five races.
//   Constructors: the same for both cars: wins, podiums, one-twos, poles, DNFs, double DNFs, last five races.
// The numbers a hater wants (DNFs, losing to the teammate) are marked `bad`, as on every stats page.
import { getJson as espnGetJson, mapLimit } from './espn.ts';
import { kvGet, kvSet } from './db.ts';
import { catalog } from './catalog.ts';
import { ordinal } from './detectors.ts';
import { urls, teamKey } from './leagues.ts';
import type { GameLine, StatsPage, StatTile } from './stats.ts';

/** Seam for tests (test/f1-stats.test.ts). */
export const f1StatsDeps = { getJson: espnGetJson as (url: string, opts?: { timeoutMs?: number }) => Promise<any> };
const get = (url: string) => f1StatsDeps.getJson(url, { timeoutMs: 10_000 });
const SEASON_TTL_MS = 10 * 60_000;
const RECENT = 5;

/** One car in a finished race. `out`: ESPN's word for why it didn't finish ("Retired", "Disqualified"), '' if it did. */
export interface Car { driverId: string; teamKey: string | null; order: number; grid: number; out: string; lap: number | null }
/** `name`: ESPN's short one ("Monaco GP"); `fullName` names its standings column ("Monaco Grand Prix"). `quali`: qualifying order by driver. */
export interface Race { eventId: string; compId: string; name: string; fullName: string; date: number; cars: Car[]; quali: Record<string, number> }
interface Standing { id: string; rank: number; points: number; weekends: Map<string, number> }
export interface Season { year: number; drivers: Standing[]; constructors: Standing[]; races: Race[] }

const num = (v: unknown) => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : 0; };
/** "Did not start" isn't a race started; any other way out (retired, disqualified, not classified) is a DNF. */
const dns = (c: Car) => /not start|dns/i.test(c.out);
const lastName = (id: string) => (catalog.playerByEspn('f1', id)?.name ?? '?').split(' ').at(-1)!;
/** A constructor by ESPN's name for it ("Red Bull", "Racing Bulls"), as the catalog has it. */
export const teamNamed = (name: string) => catalog.allTeams().find((t) => t.league === 'f1' && t.name.toLowerCase() === name.toLowerCase())?.key ?? null;

/** The standings: each driver's or constructor's rank, points, and points each weekend, by the race's full name. */
export function standingsOf(res: any): { year: number; drivers: Standing[]; constructors: Standing[] } {
  const table = (re: RegExp) => res?.children?.find((c: any) => re.test(String(c.name ?? '')))?.standings;
  const rows = (t: any, idOf: (e: any) => string | undefined): Standing[] => (t?.entries ?? []).map((e: any) => {
    const stat = (n: string) => e.stats?.find((s: any) => s.name === n);
    // Each weekend's column is named for the race in full: matched exactly ("Gulf Air Bahrain Grand Prix" isn't "…in Malaysia").
    const weekends = new Map<string, number>((e.stats ?? []).filter((s: any) => s.displayName && s.abbreviation && !['rank', 'points', 'championshipPts'].includes(s.name)).map((s: any) => [String(s.displayName), num(s.displayValue)]));
    return { id: String(idOf(e) ?? ''), rank: num(stat('rank')?.value ?? stat('rank')?.displayValue), points: num((stat('championshipPts') ?? stat('points'))?.displayValue), weekends };
  }).filter((s: Standing) => s.id);
  const drivers = table(/driver/i), constructors = table(/constructor/i);
  return { year: num(drivers?.season ?? constructors?.season) || new Date().getUTCFullYear(), drivers: rows(drivers, (e) => e.athlete?.id), constructors: rows(constructors, (e) => e.team?.id) };
}

/** A finished race's cars: its competitors (team, finish, grid) and each one's status, kept once read in full. */
async function carsOf(eventId: string, compId: string): Promise<Car[]> {
  const kept = kvGet<Car[]>(`f1:race:${compId}`);
  if (kept) return kept;
  const list = await get(urls.f1Competitors(eventId, compId));
  let whole = true;
  const cars = await mapLimit<any, Car>(list?.items ?? [], 8, async (c: any) => {
    const st = c.status?.$ref ? await get(c.status.$ref).catch(() => { whole = false; return null; }) : null;
    const name = String(st?.type?.name ?? '');
    const out = /RETIRED|DNF|DSQ|DISQ|DNS|DID_NOT|ACCIDENT|NOT_CLASSIFIED/i.test(name) ? String(st?.type?.description || 'Retired') : '';
    return { driverId: String(c.id), teamKey: teamNamed(String(c.vehicle?.manufacturer ?? '')), order: num(c.order), grid: num(c.startOrder), out, lap: out && num(st?.period) ? num(st.period) : null };
  });
  if (whole && cars.length) kvSet(`f1:race:${compId}`, cars); // a status that didn't load is read again next time
  return cars;
}

/** The season: standings, and every race run so far (cancelled ones aren't), oldest first. */
export async function readSeason(): Promise<Season> {
  const standings = standingsOf(await get(urls.standings('f1')));
  const board = await get(urls.scoreboard('f1', String(standings.year)));
  const done = (board?.events ?? []).flatMap((ev: any) => {
    const race = (ev.competitions ?? []).find((c: any) => c.type?.abbreviation === 'Race');
    if (!race?.status?.type?.completed || /cancel|postpon/i.test(String(race.status.type.name ?? ''))) return []; // called off: not a race
    const qual = (ev.competitions ?? []).find((c: any) => c.type?.abbreviation === 'Qual'); // not the sprint shootout
    const quali = Object.fromEntries((qual?.competitors ?? []).map((c: any) => [String(c.id), num(c.order)]));
    return [{ ev, race, quali }];
  });
  const races = await mapLimit(done, 3, async ({ ev, race, quali }: any): Promise<Race> => ({
    eventId: String(ev.id), compId: String(race.id), name: String(ev.shortName ?? ev.name), fullName: String(ev.name), date: Date.parse(race.date ?? ev.date) || 0,
    cars: await carsOf(String(ev.id), String(race.id)), quali,
  }));
  return { ...standings, races: races.sort((a, b) => a.date - b.date) };
}

let season: { at: number; value: Promise<Season> } | null = null;
/** The season, read again every 10 minutes (a finished race's cars only once). */
export function f1Season(): Promise<Season> {
  if (season && Date.now() - season.at < SEASON_TTL_MS) return season.value;
  const value = readSeason();
  season = { at: Date.now(), value };
  value.catch(() => { season = null; });
  return value;
}
/** For tests: forget the season read. */
export const forgetF1Season = () => { season = null; };

/** "1st in the Drivers' Championship, 84 pts clear of Russell" (or "level on points with Russell") / "4th …, 106 pts behind Antonelli". */
function standingLine(rows: Standing[], me: Standing, title: string, nameOf: (id: string) => string): string {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const leader = sorted[0], second = sorted[1];
  const level = (them: Standing) => (me.points === them.points ? `, level on points with ${nameOf(them.id)}` : '');
  const gap = me.id === leader.id ? (second ? level(second) || `, ${me.points - second.points} pts clear of ${nameOf(second.id)}` : '')
    : level(leader) || `, ${leader.points - me.points} pts behind ${nameOf(leader.id)}`;
  return `${ordinal(me.rank)} in the ${title}${gap}`;
}
const weekendPoints = (s: Standing | undefined, race: Race) => s?.weekends.get(race.fullName) ?? 0;
const pts = (n: number) => `${n} pt${n === 1 ? '' : 's'}`;
export const place = (c: Car) => (c.out ? (/disq/i.test(c.out) ? 'DSQ' : dns(c) ? 'DNS' : 'DNF') : `P${c.order}`);
const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '–');
const tile = (label: string, name: string, value: string | number, bad = false): StatTile => ({ label, name, value: String(value), ...(bad ? { bad: true } : {}) });

/** A driver's page. */
export function driverPage(s: Season, driverId: string, key: string): StatsPage {
  const me = s.drivers.find((d) => d.id === driverId);
  const mine = s.races.map((r) => ({ r, car: r.cars.find((c) => c.driverId === driverId) })).filter((x): x is { r: Race; car: Car } => !!x.car);
  const started = mine.filter(({ car }) => !dns(car));
  const finished = started.filter(({ car }) => !car.out);
  // Against the other car of their team that day: who finished ahead (a DNF is behind anyone who finished).
  let ahead = 0, behind = 0;
  for (const { r, car } of started) {
    const mate = r.cars.find((c) => c.driverId !== driverId && c.teamKey && c.teamKey === car.teamKey && !dns(c));
    if (!mate || (car.out && mate.out)) continue;
    if (!car.out && (mate.out || car.order < mate.order)) ahead++; else behind++;
  }
  const dnfs = started.filter(({ car }) => car.out).length;
  const recent: GameLine[] = mine.slice(-RECENT).reverse().map(({ r, car }) => {
    const won = weekendPoints(me, r);
    return {
      id: r.compId, date: r.date, home: true, opponent: r.name,
      result: !car.out && car.order === 1 ? 'W' : car.out || car.order > 10 ? 'L' : '', score: place(car),
      line: [car.out ? `${car.out}${car.lap ? ` on lap ${car.lap}` : ''}` : '', car.grid && !dns(car) ? `started P${car.grid}` : '', won ? `${pts(won)} this weekend` : 'no points'].filter(Boolean).join(' · ').replace(/^./, (c) => c.toUpperCase()),
    };
  });
  return {
    key, kind: 'player', league: 'f1',
    ...(me ? { record: { overall: pts(me.points), standing: standingLine(s.drivers, me, "Drivers' Championship", lastName), splits: [] } } : {}),
    groups: mine.length ? [{ title: `${s.year} season, ${started.length} race${started.length === 1 ? '' : 's'}`, tiles: [
      tile('W', 'Wins', finished.filter(({ car }) => car.order === 1).length),
      tile('POD', 'Podiums', finished.filter(({ car }) => car.order <= 3).length),
      tile('POLE', 'Poles', mine.filter(({ r }) => r.quali[driverId] === 1).length),
      tile('DNF', 'Did not finish', dnfs, dnfs > 0),
      tile('AVG', 'Average finish', avg(finished.map(({ car }) => car.order))),
      tile('VS TM', 'Ahead-behind teammate', `${ahead}-${behind}`, behind > ahead),
    ] }] : [],
    recent, next: null,
  };
}

/** A constructor's page: both cars, whoever drove them that day. */
export function constructorPage(s: Season, teamId: string, key: string): StatsPage {
  const me = s.constructors.find((t) => t.id === teamId);
  const races = s.races.map((r) => ({ r, cars: r.cars.filter((c) => c.teamKey === key && !dns(c)).sort((a, b) => (a.out ? 99 : a.order) - (b.out ? 99 : b.order)) })).filter((x) => x.cars.length);
  const cars = races.flatMap(({ cars }) => cars), finished = cars.filter((c) => !c.out);
  const dnfs = cars.filter((c) => c.out).length, doubles = races.filter(({ cars }) => cars.length > 1 && cars.every((c) => c.out)).length;
  // The weekend's points: its drivers' that day (ESPN's constructor column for a weekend can miss its sprint).
  const weekend = (r: Race, cs: Car[]) => cs.reduce((n, c) => n + weekendPoints(s.drivers.find((d) => d.id === c.driverId), r), 0);
  const recent: GameLine[] = races.slice(-RECENT).reverse().map(({ r, cars: cs }) => {
    const won = weekend(r, cs);
    return {
      id: r.compId, date: r.date, home: true, opponent: r.name,
      result: cs.some((c) => !c.out && c.order === 1) ? 'W' : cs.every((c) => c.out || c.order > 10) ? 'L' : '', score: cs.map(place).join(', '),
      line: [...cs.map((c) => `${lastName(c.driverId)} ${place(c)}`), won ? `${pts(won)} this weekend` : 'no points'].join(' · '),
    };
  });
  return {
    key, kind: 'team', league: 'f1',
    ...(me ? { record: { overall: pts(me.points), standing: standingLine(s.constructors, me, "Constructors' Championship", (id) => catalog.team(teamKey('f1', id))?.name ?? '?'), splits: [] } } : {}),
    groups: races.length ? [{ title: `${s.year} season, ${races.length} race${races.length === 1 ? '' : 's'}`, tiles: [
      tile('W', 'Wins', finished.filter((c) => c.order === 1).length),
      tile('POD', 'Podium finishes', finished.filter((c) => c.order <= 3).length),
      tile('1-2', 'One-twos', races.filter(({ cars: cs }) => cs.filter((c) => !c.out && c.order <= 2).length === 2).length),
      tile('POLE', 'Poles', races.filter(({ r }) => Object.entries(r.quali).some(([id, q]) => q === 1 && r.cars.find((c) => c.driverId === id)?.teamKey === key)).length),
      tile('DNF', 'Cars that didn\'t finish', dnfs, dnfs > 0),
      tile('2 DNF', 'Both cars out', doubles, doubles > 0),
    ] }] : [],
    recent, next: null,
  };
}

/** A driver's or constructor's stats page (`id`: ESPN's). */
export async function f1Page(kind: 'team' | 'player', id: string, key: string): Promise<StatsPage> {
  const s = await f1Season();
  return kind === 'team' ? constructorPage(s, id, key) : driverPage(s, id, key);
}
