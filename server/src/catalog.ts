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

export interface IngestReport {
  at: string;
  leagues: Record<string, {
    teams: number; players: number;
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

export async function ingest(log: (m: string) => void = console.log): Promise<IngestReport> {
  const report: IngestReport = { at: new Date().toISOString(), leagues: {}, problems: [] };
  const newTeams: Team[] = [];
  const newPlayers: Player[] = [];

  for (const lg of LEAGUE_IDS) {
    const stats = { teams: 0, players: 0, duplicateIdsRemoved: 0, duplicateNamesRemoved: 0, headshotsVerified: 0, headshotFallbackToLogo: 0, headshotAltMismatch: 0 };
    report.leagues[lg] = stats;

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

    const byId = new Map<string, { a: any; team: Team }>();
    for (const entry of rosters.flat()) {
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
    log(`[ingest] ${LEAGUES[lg].name}: ${stats.teams} teams, ${stats.players} players (${stats.headshotsVerified} headshots, ${stats.headshotFallbackToLogo} logo fallbacks, ${stats.duplicateIdsRemoved + stats.duplicateNamesRemoved} dupes removed)`);
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
