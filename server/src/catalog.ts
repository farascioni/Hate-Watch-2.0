import { db, tx, kvGet, kvSet } from './db.ts';
import { fiveRoundFights, rankFighters, titleOf, type Belts, type WeightClass } from './ufc-classes.ts';
import { getJson, probePng, mapLimit } from './espn.ts';
import { LEAGUE_IDS, LEAGUES, urls, playerKey, teamKey, type League } from './leagues.ts';

export interface Team {
  key: string; league: League; espnId: string; name: string; shortName: string; abbrev: string; location: string | null;
  color: string | null; altColor: string | null; logo: string; logoDark: string | null; logoW: number; logoH: number;
}
export interface Player {
  key: string; league: League; espnId: string; name: string; shortName: string | null; position: string | null; jersey: string | null;
  /** Every position ESPN lists them at this season (Ohtani: P, DH, SP), for which alerts fit them; null when it lists none. */
  positions: string[] | null;
  teamKey: string; image: string; imageW: number; imageH: number; imageKind: 'headshot' | 'team_logo';
}

/** Bump when what ingest() collects changes (2: injured lists, 3: every position played, 4: UFC weight classes), so the next boot rebuilds the catalog instead of waiting. */
export const INGEST_VERSION = 5;
export const INGEST_EVERY_MS = 6 * 3600_000;

/**
 * When the next catalog refresh is due: 6 hours after the last one, not after boot (deploys restart
 * the server, and a timer that starts over each time keeps putting it off), and right away when there
 * has been none or the ingest itself changed.
 */
export function nextIngestIn(last: Pick<IngestReport, 'at' | 'version'> | undefined, now = Date.now()) {
  const at = Date.parse(last?.at ?? '');
  if (!last || !Number.isFinite(at) || last.version !== INGEST_VERSION) return 0;
  return Math.max(0, at + INGEST_EVERY_MS - now);
}

export interface IngestReport {
  at: string;
  /** INGEST_VERSION when it ran. */
  version?: number;
  leagues: Record<string, {
    teams: number; players: number;
    /** Players on an injured list but off their team's roster (MLB's 60-day IL), added from the injury report. */
    injuredAdded?: number;
    duplicateIdsRemoved: number; duplicateNamesRemoved: number;
    headshotsVerified: number; headshotFallbackToLogo: number; headshotAltMismatch: number;
  }>;
  problems: string[];
}

// ─── In-memory index (hot path for search and live-event matching) ───────────────────────────
const teams = new Map<string, Team>();
const players = new Map<string, Player>();
const rosterByTeam = new Map<string, Player[]>();

export const catalog = {
  team: (key: string) => teams.get(key),
  player: (key: string) => players.get(key),
  teamByEspn: (lg: League, id: string) => teams.get(teamKey(lg, id)),
  playerByEspn: (lg: League, id: string) => players.get(playerKey(lg, id)),
  roster: (key: string) => rosterByTeam.get(key) ?? [],
  allTeams: () => [...teams.values()],
  size: () => ({ teams: teams.size, players: players.size }),
};

export function loadCatalog() {
  teams.clear(); players.clear(); rosterByTeam.clear();
  for (const r of db.prepare('SELECT * FROM teams').all() as any[]) {
    teams.set(r.key, {
      key: r.key, league: r.league, espnId: r.espn_id, name: r.name, shortName: r.short_name, abbrev: r.abbrev,
      location: r.location, color: r.color, altColor: r.alt_color, logo: r.logo, logoDark: r.logo_dark, logoW: r.logo_w, logoH: r.logo_h,
    });
  }
  for (const r of db.prepare('SELECT * FROM players ORDER BY name').all() as any[]) {
    const p: Player = {
      key: r.key, league: r.league, espnId: r.espn_id, name: r.name, shortName: r.short_name, position: r.position, jersey: r.jersey,
      positions: r.positions ? String(r.positions).split(',') : null, teamKey: r.team_key, image: r.image, imageW: r.image_w, imageH: r.image_h, imageKind: r.image_kind,
    };
    players.set(p.key, p);
    if (!rosterByTeam.has(p.teamKey)) rosterByTeam.set(p.teamKey, []);
    rosterByTeam.get(p.teamKey)!.push(p);
  }
  buildSearchIndex();
}

// ─── Ingest from ESPN ─────────────────────────────────────────────────────────────────────────
export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function pickLogo(t: any, rel: string): string | undefined {
  return t.logos?.find((l: any) => l.rel?.includes(rel) && !l.rel?.includes('dark'))?.href
    ?? (rel === 'dark' ? t.logos?.find((l: any) => l.rel?.includes('dark'))?.href : undefined);
}

/** Every position a roster entry lists (`positions`: "P", "DH", "SP" for Ohtani), its main one if that's all. */
export function positionsOf(a: any): string[] | null {
  const all = [a.position, ...(a.positions ?? [])].map((p: any) => p?.abbreviation).filter((p: unknown): p is string => typeof p === 'string' && !!p);
  return all.length ? [...new Set(all)] : null;
}

/**
 * Everyone on a league's injury report who isn't on a roster, each under the team the report lists
 * them with. The report's athletes have what a roster entry needs: name, position, headshot.
 */
export function injuredOffRoster(report: any, teams: Team[], onRoster: Set<string>): { a: any; team: Team }[] {
  const byId = new Map(teams.map((t) => [t.espnId, t]));
  const out: { a: any; team: Team }[] = [];
  for (const group of report?.injuries ?? []) {
    const team = byId.get(String(group.id));
    if (!team) continue;
    for (const inj of group.injuries ?? []) {
      const a = inj.athlete ?? {};
      const id = a.id ?? a.links?.map((l: any) => l.href?.match(/\/id\/(\d+)/)?.[1]).find(Boolean);
      if (!id || onRoster.has(String(id))) continue;
      onRoster.add(String(id));
      out.push({ a: { ...a, id: String(id) }, team });
    }
  }
  return out;
}

export async function ingest(log: (m: string) => void = console.log): Promise<IngestReport> {
  const report: IngestReport = { at: new Date().toISOString(), version: INGEST_VERSION, leagues: {}, problems: [] };
  const newTeams: Team[] = [];
  const newPlayers: Player[] = [];
  let ufcClasses: { classes: WeightClass[]; belts: Belts } | undefined; // each weight class's top fighters (Search) and belts (ufc-classes.ts)
  let cfbConferences: Record<string, string> | undefined; // each FBS team's conference (standings)

  for (const lg of LEAGUE_IDS) {
    const stats: IngestReport['leagues'][string] = { teams: 0, players: 0, duplicateIdsRemoved: 0, duplicateNamesRemoved: 0, headshotsVerified: 0, headshotFallbackToLogo: 0, headshotAltMismatch: 0 };
    report.leagues[lg] = stats;

    if (lg === 'ufc') {
      // Its own step: ESPN's MMA data failing keeps the fighters we have, and never stops the other leagues' refresh.
      const ufc = await ingestUfc(stats, report).catch((e) => {
        report.problems.push(`ufc: ${String(e)}; kept the fighters already in the catalog`);
        return { teams: [UFC_TEAM], players: [...players.values()].filter((p) => p.league === 'ufc') };
      });
      newTeams.push(...ufc.teams);
      newPlayers.push(...ufc.players);
      if ('classes' in ufc) ufcClasses = { classes: ufc.classes!, belts: ufc.belts! };
      log(`[ingest] UFC: ${ufc.players.length} fighters (${stats.headshotsVerified} photos checked, ${stats.headshotFallbackToLogo} badges)`);
      continue;
    }

    if (lg === 'cfb') {
      // College football is teams only (no rosters): ESPN failing keeps the schools we have.
      const cfb = await ingestCfb(stats).catch((e) => {
        report.problems.push(`cfb: ${String(e)}; kept the teams already in the catalog`);
        return { teams: [...teams.values()].filter((t) => t.league === 'cfb'), conferences: undefined };
      });
      newTeams.push(...cfb.teams);
      if (cfb.conferences) cfbConferences = cfb.conferences;
      log(`[ingest] CFB: ${cfb.teams.length} FBS teams`);
      continue;
    }

    if (lg === 'f1') {
      // ESPN's F1 data failing keeps the constructors and drivers we have, and never stops the other leagues' refresh.
      const f1 = await ingestF1(stats, report).catch((e) => {
        report.problems.push(`f1: ${String(e)}; kept the constructors and drivers already in the catalog`);
        return { teams: [...teams.values()].filter((t) => t.league === 'f1'), players: [...players.values()].filter((p) => p.league === 'f1') };
      });
      newTeams.push(...f1.teams);
      newPlayers.push(...f1.players);
      log(`[ingest] F1: ${stats.teams} constructors, ${stats.players} drivers (${stats.headshotsVerified} headshots, ${stats.headshotFallbackToLogo} badge fallbacks)`);
      continue;
    }

    const res = await getJson(urls.teams(lg));
    const rawTeams: any[] = res.sports[0].leagues[0].teams.map((x: any) => x.team).filter((t: any) => t.isActive !== false && !t.isAllStar);

    // Teams: dedupe on ESPN id, then on abbreviation as a second guard.
    const seenTeam = new Set<string>();
    const lgTeams: Team[] = [];
    for (const t of rawTeams) {
      if (seenTeam.has(t.id) || seenTeam.has(`abbr:${t.abbreviation}`)) { report.problems.push(`${lg}: duplicate team ${t.displayName} dropped`); continue; }
      seenTeam.add(t.id); seenTeam.add(`abbr:${t.abbreviation}`);
      const logo = pickLogo(t, 'default') ?? `https://a.espncdn.com/i/teamlogos/${lg}/500/${t.abbreviation.toLowerCase()}.png`;
      lgTeams.push({
        key: teamKey(lg, t.id), league: lg, espnId: t.id, name: t.displayName, shortName: t.shortDisplayName ?? t.name, abbrev: t.abbreviation,
        location: t.location ?? null, color: t.color ? `#${t.color}` : null, altColor: t.alternateColor ? `#${t.alternateColor}` : null,
        logo, logoDark: pickLogo(t, 'dark') ?? null, logoW: 0, logoH: 0,
      });
    }
    await mapLimit(lgTeams, 8, async (team) => {
      const dims = await probePng(team.logo);
      if (!dims) throw new Error(`${lg}: logo missing for ${team.name} (${team.logo}) — refusing to ingest a team without an image`);
      team.logoW = dims.width; team.logoH = dims.height;
    });
    stats.teams = lgTeams.length;
    newTeams.push(...lgTeams);

    // Rosters. MLB/NFL/NHL group athletes by position ({position, items}); NBA returns a flat list.
    const rosters = await mapLimit(lgTeams, 6, async (team) => {
      const r = await getJson(urls.roster(lg, team.espnId));
      const athletes: any[] = (r.athletes ?? []).flatMap((a: any) => (Array.isArray(a.items) ? a.items : [a]));
      return athletes.map((a) => ({ a, team }));
    });
    // Injured lists: a player on MLB's 60-day IL comes off the 40-man roster ESPN gives us (Carlos
    // Correa on the Astros), but the league's injury report still lists him under his team.
    const injuryReport = await getJson(urls.injuries(lg)).catch(() => null); // without it, just the rosters
    const injured = injuredOffRoster(injuryReport, lgTeams, new Set(rosters.flat().map((e) => String(e.a.id))));
    stats.injuredAdded = injured.length;

    const byId = new Map<string, { a: any; team: Team }>();
    for (const entry of [...rosters.flat(), ...injured]) {
      if (byId.has(entry.a.id)) {
        stats.duplicateIdsRemoved++;
        report.problems.push(`${lg}: ${entry.a.displayName} (${entry.a.id}) listed on ${byId.get(entry.a.id)!.team.abbrev} and ${entry.team.abbrev}; kept first`);
        continue;
      }
      byId.set(entry.a.id, entry);
    }
    // Second-pass dedupe: same person under two ESPN ids (same normalized name + birth date).
    const byPerson = new Map<string, string>();
    for (const [id, { a }] of [...byId]) {
      const k = `${normalize(a.displayName)}|${a.dateOfBirth ?? ''}`;
      if (a.dateOfBirth && byPerson.has(k)) {
        stats.duplicateNamesRemoved++;
        report.problems.push(`${lg}: ${a.displayName} appears under ids ${byPerson.get(k)} and ${id}; kept ${byPerson.get(k)}`);
        byId.delete(id);
      } else byPerson.set(k, id);
    }

    const lgPlayers = await mapLimit([...byId.values()], 24, async ({ a, team }) => {
      const p: Player = {
        key: playerKey(lg, a.id), league: lg, espnId: a.id, name: a.displayName ?? a.fullName, shortName: a.shortName ?? null,
        position: a.position?.abbreviation ?? null, jersey: a.jersey ?? null, positions: positionsOf(a), teamKey: team.key,
        image: '', imageW: 0, imageH: 0, imageKind: 'headshot',
      };
      // Accuracy: the headshot URL must be keyed by this athlete's own id; ESPN's alt text should name them.
      const candidate: string = a.headshot?.href ?? urls.headshot(lg, a.id);
      if (!candidate.includes(`/${a.id}.png`)) report.problems.push(`${lg}: headshot URL for ${p.name} not keyed by id (${candidate})`);
      if (a.headshot?.alt && normalize(a.headshot.alt) !== normalize(p.name)) {
        stats.headshotAltMismatch++;
        report.problems.push(`${lg}: headshot alt "${a.headshot.alt}" ≠ "${p.name}"`);
      }
      const dims = await probePng(candidate);
      if (dims) {
        Object.assign(p, { image: candidate, imageW: dims.width, imageH: dims.height, imageKind: 'headshot' });
        stats.headshotsVerified++;
      } else {
        // No ESPN photo exists (common for call-ups / practice squad). Use their team logo rather than a wrong face.
        Object.assign(p, { image: team.logo, imageW: team.logoW, imageH: team.logoH, imageKind: 'team_logo' });
        stats.headshotFallbackToLogo++;
      }
      return p;
    });
    stats.players = lgPlayers.length;
    newPlayers.push(...lgPlayers);
    log(`[ingest] ${LEAGUES[lg].name}: ${stats.teams} teams, ${stats.players} players (${stats.injuredAdded} from injured lists, ${stats.headshotsVerified} headshots, ${stats.headshotFallbackToLogo} logo fallbacks, ${stats.duplicateIdsRemoved + stats.duplicateNamesRemoved} dupes removed)`);
  }

  // Invariants before we commit anything.
  const keys = new Set<string>();
  for (const x of [...newTeams, ...newPlayers]) {
    if (keys.has(x.key)) throw new Error(`duplicate key after dedupe: ${x.key}`);
    keys.add(x.key);
  }
  for (const p of newPlayers) if (!p.image || !p.imageW) throw new Error(`player without image: ${p.key}`);

  const now = Date.now();
  tx(() => {
    const upTeam = db.prepare(`INSERT INTO teams (key, league, espn_id, name, short_name, abbrev, location, color, alt_color, logo, logo_dark, logo_w, logo_h, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, abbrev=excluded.abbrev,
      location=excluded.location, color=excluded.color, alt_color=excluded.alt_color, logo=excluded.logo, logo_dark=excluded.logo_dark,
      logo_w=excluded.logo_w, logo_h=excluded.logo_h, updated_at=excluded.updated_at`);
    for (const t of newTeams) upTeam.run(t.key, t.league, t.espnId, t.name, t.shortName, t.abbrev, t.location, t.color, t.altColor, t.logo, t.logoDark, t.logoW, t.logoH, now);
    // Players who left every roster are removed from the catalog (follows are kept so they reappear if re-signed).
    db.prepare('DELETE FROM players').run();
    const insP = db.prepare(`INSERT INTO players (key, league, espn_id, name, short_name, position, positions, jersey, team_key, image, image_w, image_h, image_kind, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const p of newPlayers) insP.run(p.key, p.league, p.espnId, p.name, p.shortName, p.position, p.positions?.join(',') ?? null, p.jersey, p.teamKey, p.image, p.imageW, p.imageH, p.imageKind, now);
  });
  kvSet('ingest:report', report);
  if (ufcClasses) { kvSet('ufc:weight-classes', ufcClasses.classes); kvSet('ufc:belts', ufcClasses.belts); }
  if (cfbConferences) kvSet('cfb:conferences', cfbConferences);
  loadCatalog();
  return report;
}

// ─── College football: the FBS's teams ─────────────────────────────────────────────────────────
/** The college season a date is in, by the year it starts: August to January is one season (realignment takes effect July 1). */
export const cfbSeason = (now = new Date()) => (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);

/**
 * The FBS's teams, no players: each of its conferences (a name and a list of team ids) and ESPN's list of every
 * school (its name, "Nebraska" for the short one, colors and logos): about 24 reads, no logo checks (ESPN's are
 * all 500×500). Fewer than 100 teams found is a bad read, not the FBS.
 */
export async function ingestCfb(stats: IngestReport['leagues'][string]): Promise<{ teams: Team[]; conferences: Record<string, string> }> {
  const season = cfbSeason();
  const groups: string[] = ((await getJson(urls.cfbConferences(season))).items ?? []).map((x: any) => String(x.$ref ?? '').match(/groups\/(\d+)/)?.[1]).filter(Boolean);
  const conferences: Record<string, string> = {}; // ESPN team id → its conference ("Big Ten")
  await mapLimit(groups, 4, async (id) => {
    const [g, list] = await Promise.all([getJson(urls.cfbGroup(season, id)), getJson(urls.cfbConferenceTeams(season, id))]);
    for (const t of list.items ?? []) {
      const teamId = String(t.$ref ?? '').match(/teams\/(\d+)/)?.[1];
      if (teamId) conferences[teamId] = String(g.shortName ?? g.name ?? '');
    }
  });
  if (Object.keys(conferences).length < 100) throw new Error(`only ${Object.keys(conferences).length} FBS teams in ${groups.length} conferences`);
  const all: any[] = (await getJson(urls.cfbAllTeams())).sports?.[0]?.leagues?.[0]?.teams?.map((x: any) => x.team) ?? [];
  const teams = all.filter((t) => conferences[String(t.id)]).map((t): Team => ({
    key: teamKey('cfb', String(t.id)), league: 'cfb', espnId: String(t.id), name: t.displayName, shortName: t.shortDisplayName ?? t.location ?? t.name, abbrev: t.abbreviation,
    location: t.location ?? null, color: t.color ? `#${t.color}` : null, altColor: t.alternateColor ? `#${t.alternateColor}` : null,
    logo: pickLogo(t, 'default') ?? `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png`, logoDark: pickLogo(t, 'dark') ?? null, logoW: 500, logoH: 500,
  }));
  if (teams.length < 100) throw new Error(`only ${teams.length} of ${Object.keys(conferences).length} FBS teams in ESPN's list of schools`);
  stats.teams = teams.length;
  return { teams, conferences };
}

// ─── Formula 1 ────────────────────────────────────────────────────────────────────────────────
/**
 * ESPN has no constructor logos (404, `logos: null`), so constructors get a badge the app draws
 * natively: a circle in the team's official ESPN colour with this code. Clearly not a fake logo.
 */
export const F1_BADGE = 'badge://f1';
const F1_CODES: Record<string, string> = {
  alpine: 'ALP', 'aston martin': 'AMR', audi: 'AUD', cadillac: 'CAD', ferrari: 'FER', haas: 'HAA',
  mclaren: 'MCL', mercedes: 'MER', 'racing bulls': 'RB', 'red bull': 'RBR', williams: 'WIL',
};

async function ingestF1(stats: IngestReport['leagues'][string], report: IngestReport): Promise<{ teams: Team[]; players: Player[] }> {
  const res = await getJson(urls.teams('f1'));
  const teams: Team[] = res.sports[0].leagues[0].teams.map((x: any) => x.team).filter((t: any) => t.isActive !== false).map((t: any) => {
    const n = normalize(t.displayName);
    return {
      key: teamKey('f1', t.id), league: 'f1', espnId: t.id, name: t.displayName, shortName: t.shortDisplayName ?? t.displayName,
      abbrev: F1_CODES[n] ?? t.displayName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(),
      location: null, color: t.color ? `#${t.color}` : '#888888', altColor: t.alternateColor ? `#${t.alternateColor}` : null,
      logo: F1_BADGE, logoDark: null, logoW: 512, logoH: 512,
    } satisfies Team;
  });
  const byName = new Map(teams.map((t) => [normalize(t.name), t]));
  stats.teams = teams.length;

  // Drivers who actually raced this season: championship standings + this weekend's entry list.
  // (The season athlete list also has reserves and test drivers.)
  const [standings, sb] = await Promise.all([getJson(urls.standings('f1')), getJson(urls.scoreboard('f1'))]);
  const season = Number(sb.season?.year ?? new Date().getFullYear());
  const racing = new Set<string>();
  for (const e of standings.children?.find((c: any) => /driver/i.test(c.name))?.standings?.entries ?? []) racing.add(String(e.athlete.id));
  for (const ev of sb.events ?? []) for (const c of ev.competitions ?? []) for (const x of c.competitors ?? []) racing.add(String(x.id));

  // A driver's athlete record can be stale after a team move (Lindblad: record says "Red Bull #36",
  // but he raced the Racing Bulls #41). This weekend's entry list is authoritative for current
  // team and car number; the athlete record is only the fallback (e.g. a driver replaced mid-season).
  const entered = new Map<string, { team: string; number: string }>();
  const ev = sb.events?.[0];
  // The latest session whose entry list ESPN gives: a race's is a 404 until its grid is out (the evening after
  // qualifying, October 10 2026), though the scoreboard lists its cars. None: the athlete records alone.
  for (const comp of [...(ev?.competitions ?? [])].reverse().filter((c: any) => c.competitors?.length)) {
    const list = await getJson(urls.f1Competitors(String(ev.id), String(comp.id))).catch(() => null);
    if (!list?.items?.length) continue;
    for (const c of await mapLimit<any, any>(list.items, 8, (it: any) => getJson(it.$ref))) {
      if (c.vehicle?.manufacturer) entered.set(String(c.id), { team: c.vehicle.manufacturer, number: String(c.vehicle.number ?? '') });
    }
    break;
  }

  const list = await getJson(urls.f1Athletes(season));
  const athletes = (await mapLimit(list.items ?? [], 8, (it: any) => getJson(it.$ref))).filter((a: any) => racing.has(String(a.id)));
  const seen = new Set<string>();
  const players = (await mapLimit(athletes, 8, async (a: any) => {
    if (seen.has(a.id)) { stats.duplicateIdsRemoved++; return null; }
    seen.add(a.id);
    const record = a.vehicles?.find((v: any) => String(v.season?.$ref ?? '').includes(`/seasons/${season}`)) ?? a.vehicles?.[0];
    const now = entered.get(String(a.id));
    const vehicle = now ? { team: now.team, manufacturer: now.team, number: now.number } : record;
    const team = byName.get(normalize(vehicle?.team ?? '')) ?? byName.get(normalize(vehicle?.manufacturer ?? ''));
    if (!team) { report.problems.push(`f1: ${a.displayName} (${a.id}) drives for "${vehicle?.team}", which matches no constructor; skipped`); return null; }
    const p: Player = {
      key: playerKey('f1', a.id), league: 'f1', espnId: String(a.id), name: a.displayName, shortName: a.shortName ?? null,
      position: null, positions: null, jersey: vehicle?.number ?? null, teamKey: team.key,
      image: '', imageW: 0, imageH: 0, imageKind: 'headshot',
    };
    const candidate: string = a.headshot?.href ?? urls.headshot('f1', a.id);
    if (!candidate.includes(`/${a.id}.png`)) report.problems.push(`f1: headshot URL for ${p.name} not keyed by id (${candidate})`);
    if (a.headshot?.alt && normalize(a.headshot.alt) !== normalize(p.name)) { stats.headshotAltMismatch++; report.problems.push(`f1: headshot alt "${a.headshot.alt}" ≠ "${p.name}"`); }
    const dims = await probePng(candidate);
    if (dims) { Object.assign(p, { image: candidate, imageW: dims.width, imageH: dims.height }); stats.headshotsVerified++; }
    else { Object.assign(p, { image: team.logo, imageW: team.logoW, imageH: team.logoH, imageKind: 'team_logo' }); stats.headshotFallbackToLogo++; }
    return p;
  })).filter((p): p is Player => !!p);
  stats.players = players.length;
  return { teams, players };
}

// ─── UFC ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Fighters have no team, and a player needs one: they're all on this placeholder, which no list or search
 * shows (`listed`). Its "logo" is a badge in the UFC's red with "UFC", for a fighter with no ESPN photo; its
 * full name reads like a team's on a fighter's page ("Ultimate Fighting Championship · UFC · Welterweight").
 */
export const UFC_TEAM: Team = {
  key: teamKey('ufc', 'ufc'), league: 'ufc', espnId: 'ufc', name: 'Ultimate Fighting Championship', shortName: 'UFC', abbrev: 'UFC',
  location: null, color: '#D20A0A', altColor: null, logo: 'badge://ufc', logoDark: null, logoW: 512, logoH: 512,
};
/** Teams anyone can see (and track): not the UFC's placeholder. */
export const listed = (t: Pick<Team, 'key'>) => t.key !== UFC_TEAM.key;
// Two years back: a top fighter out a year (injured, between title shots) is still one to hate. Not ESPN's
// rankings, which are years out of date (in October 2026 they had Figueiredo as flyweight champion).
const UFC_MONTHS_BACK = 24, UFC_MONTHS_AHEAD = 3;

/**
 * The fighters on UFC cards from two years back to three months ahead, by ESPN's scoreboard a month at a time,
 * each with the weight class of their latest fight. Not the Contender Series: its fighters aren't signed.
 * A fighter already in the catalog keeps their checked photo; only new ones are checked (and those still
 * without one, in case ESPN has added it).
 */
async function ingestUfc(stats: IngestReport['leagues'][string], report: IngestReport): Promise<{ teams: Team[]; players: Player[]; classes?: WeightClass[]; belts?: Belts }> {
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const months = Array.from({ length: UFC_MONTHS_BACK + UFC_MONTHS_AHEAD + 1 }, (_, i) => {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - UFC_MONTHS_BACK + i, 1));
    return `${ymd(first)}-${ymd(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)))}`;
  });
  const boards = await mapLimit(months, 4, (m) => getJson(urls.scoreboard('ufc', m)));
  // Which fights were for a belt, for each class's champion. Failing, the classes are ranked without them.
  const titles = await ufcTitles(boards).catch((e) => { report.problems.push(`ufc titles: ${String(e)}; weight classes ranked without champions`); return {}; });
  const { fighters, classes, belts } = rankFighters(boards, titles, Date.now(), (id) => playerKey('ufc', id));
  if (!fighters.size) throw new Error('no fighters on any UFC card');
  const out = await mapLimit([...fighters], 8, async ([id, f]): Promise<Player> => {
    const key = playerKey('ufc', id), known = players.get(key);
    const p: Player = {
      key, league: 'ufc', espnId: id, name: f.name, shortName: f.short, position: f.weight, positions: null, jersey: null, teamKey: UFC_TEAM.key,
      image: UFC_TEAM.logo, imageW: UFC_TEAM.logoW, imageH: UFC_TEAM.logoH, imageKind: 'team_logo',
    };
    if (known?.imageKind === 'headshot') return { ...p, image: known.image, imageW: known.imageW, imageH: known.imageH, imageKind: 'headshot' };
    const dims = await probePng(urls.headshot('ufc', id));
    if (dims) { stats.headshotsVerified++; return { ...p, image: urls.headshot('ufc', id), imageW: dims.width, imageH: dims.height, imageKind: 'headshot' }; }
    stats.headshotFallbackToLogo++;
    return p;
  });
  stats.teams = 1; stats.players = out.length;
  return { teams: [UFC_TEAM], players: out, classes, belts };
}

/**
 * Each five-round fight's title, if it was for one ("UFC Lightweight Title"), by fight id: ESPN's core record
 * of each. A finished fight's is kept (kv `ufc:titles`), so a refresh reads only new and upcoming ones.
 */
async function ufcTitles(boards: any[]): Promise<Record<string, string | null>> {
  const known = kvGet<Record<string, string | null>>('ufc:titles') ?? {};
  const fights = fiveRoundFights(boards);
  const read = await mapLimit(fights.filter((f) => !f.done || !(f.fightId in known)), 8, async (f) => {
    const c = await getJson(urls.ufcFight(f.eventId, f.fightId)).catch(() => null);
    return [f, c ? ((c.types ?? []).map((t: any) => String(t.text ?? '')).find((t: string) => titleOf(t)) ?? null) : undefined] as const;
  });
  const titles = { ...known };
  for (const [f, title] of read) if (title !== undefined) titles[f.fightId] = title;
  kvSet('ufc:titles', Object.fromEntries(fights.filter((f) => f.done && f.fightId in titles).map((f) => [f.fightId, titles[f.fightId]])));
  return titles;
}

// ─── Search ───────────────────────────────────────────────────────────────────────────────────
interface Indexed { key: string; kind: 'team' | 'player'; league: League; text: string; tokens: string[]; boost: number }
let index: Indexed[] = [];

function buildSearchIndex() {
  index = [];
  for (const t of teams.values()) {
    if (!listed(t)) continue;
    const text = normalize(`${t.name} ${t.abbrev} ${t.shortName}`);
    index.push({ key: t.key, kind: 'team', league: t.league, text, tokens: text.split(' '), boost: 5 });
  }
  for (const p of players.values()) {
    const text = normalize(p.name);
    index.push({ key: p.key, kind: 'player', league: p.league, text, tokens: text.split(' '), boost: 0 });
  }
}

export function search(q: string, opts: { league?: League; kind?: 'team' | 'player'; limit?: number } = {}) {
  const nq = normalize(q);
  if (!nq) return [];
  const qTokens = nq.split(' ');
  const scored: { item: Indexed; score: number }[] = [];
  for (const item of index) {
    if (opts.league && item.league !== opts.league) continue;
    if (opts.kind && item.kind !== opts.kind) continue;
    let score = 0;
    if (item.text === nq) score = 100;
    else if (item.text.startsWith(nq)) score = 80;
    else if (qTokens.every((qt) => item.tokens.some((t) => t.startsWith(qt)))) score = 60;
    else if (item.text.includes(nq)) score = 30;
    if (score) scored.push({ item, score: score + item.boost });
  }
  scored.sort((a, b) => b.score - a.score || a.item.text.localeCompare(b.item.text));
  return scored.slice(0, opts.limit ?? 40).map(({ item }) => (item.kind === 'team' ? teamDto(teams.get(item.key)!) : playerDto(players.get(item.key)!)));
}

export const teamDto = (t: Team) => ({ kind: 'team' as const, ...t });
export const playerDto = (p: Player) => {
  const t = teams.get(p.teamKey);
  return { kind: 'player' as const, ...p, teamName: t?.name ?? null, teamAbbrev: t?.abbrev ?? null, teamColor: t?.color ?? null, teamLogo: t?.logo ?? null };
};
export const targetDto = (key: string) => {
  if (key.startsWith('team:')) { const t = teams.get(key); return t ? teamDto(t) : null; }
  const p = players.get(key); return p ? playerDto(p) : null;
};
