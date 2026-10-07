import { db, tx, kvSet } from './db.ts';
import { getJson, probePng, mapLimit } from './espn.ts';
import { LEAGUE_IDS, LEAGUES, urls, playerKey, teamKey, type League } from './leagues.ts';

export interface Team {
  key: string; league: League; espnId: string; name: string; shortName: string; abbrev: string; location: string | null;
  color: string | null; altColor: string | null; logo: string; logoDark: string | null; logoW: number; logoH: number;
}
export interface Player {
  key: string; league: League; espnId: string; name: string; shortName: string | null; position: string | null; jersey: string | null;
  teamKey: string; image: string; imageW: number; imageH: number; imageKind: 'headshot' | 'team_logo';
}

/** Bump when what ingest() collects changes (2: injured lists), so the next boot rebuilds the catalog instead of waiting. */
export const INGEST_VERSION = 2;
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
      teamKey: r.team_key, image: r.image, imageW: r.image_w, imageH: r.image_h, imageKind: r.image_kind,
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

  for (const lg of LEAGUE_IDS) {
    const stats: IngestReport['leagues'][string] = { teams: 0, players: 0, duplicateIdsRemoved: 0, duplicateNamesRemoved: 0, headshotsVerified: 0, headshotFallbackToLogo: 0, headshotAltMismatch: 0 };
    report.leagues[lg] = stats;

    if (lg === 'f1') {
      const f1 = await ingestF1(stats, report);
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
        position: a.position?.abbreviation ?? null, jersey: a.jersey ?? null, teamKey: team.key,
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
    const insP = db.prepare(`INSERT INTO players (key, league, espn_id, name, short_name, position, jersey, team_key, image, image_w, image_h, image_kind, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const p of newPlayers) insP.run(p.key, p.league, p.espnId, p.name, p.shortName, p.position, p.jersey, p.teamKey, p.image, p.imageW, p.imageH, p.imageKind, now);
  });
  kvSet('ingest:report', report);
  loadCatalog();
  return report;
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
  const latest = [...(ev?.competitions ?? [])].reverse().find((c: any) => c.competitors?.length);
  if (ev && latest) {
    const list = await getJson(urls.f1Competitors(String(ev.id), String(latest.id)));
    for (const c of await mapLimit<any, any>(list.items ?? [], 8, (it: any) => getJson(it.$ref))) {
      if (c.vehicle?.manufacturer) entered.set(String(c.id), { team: c.vehicle.manufacturer, number: String(c.vehicle.number ?? '') });
    }
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
      position: null, jersey: vehicle?.number ?? null, teamKey: team.key,
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

// ─── Search ───────────────────────────────────────────────────────────────────────────────────
interface Indexed { key: string; kind: 'team' | 'player'; league: League; text: string; tokens: string[]; boost: number }
let index: Indexed[] = [];

function buildSearchIndex() {
  index = [];
  for (const t of teams.values()) {
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
