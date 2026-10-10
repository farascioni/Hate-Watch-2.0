export type League = 'nba' | 'wnba' | 'mlb' | 'nfl' | 'nhl' | 'f1' | 'epl' | 'ufc' | 'cfb';
/** Basketball leagues share detectors (the WNBA's play-by-play is the NBA's shape). */
export const BASKETBALL = new Set<League>(['nba', 'wnba']);
/**
 * Soccer leagues: matches come as key events (goals, cards, penalties, subs), commentary (fouls) and a
 * touch-by-touch feed (passes, dribbles), not a play-by-play. To add one (La Liga is ESPN's "esp.1"):
 * add it to League and LEAGUES with its slug, and here. Its alerts, detectors, scores and catalog follow.
 */
export const SOCCER = new Set<League>(['epl']);
/** Football leagues share detectors, drives and the box score (college games are the NFL's shape). */
export const FOOTBALL = new Set<League>(['nfl', 'cfb']);
/**
 * Leagues of teams only, no players (college football, FBS): no rosters read, so no player alerts, pages or
 * search; a game is read from its summary alone (plays from its drives), not the play-by-play with players too.
 */
export const TEAMS_ONLY = new Set<League>(['cfb']);
/** A football league's own alert type: the NFL's "nfl.team.three_and_out", college football's "cfb.team.three_and_out". */
export const footballType = (lg: League, key: string) => `${lg === 'cfb' ? 'cfb' : 'nfl'}.${key}`;
/** College football: the FBS, ESPN's group 80 (FCS is 81). */
export const FBS_GROUP = '80';

/**
 * How the app shows a league (builds from October 2026 on read it; earlier ones have their own): so a league's
 * look and filters change with a server deploy, not an app build.
 * `color`: its chip and tag. `kinds`: what its filter offers (teams, players or both). `players`: what its people are
 * called ("drivers"). `groupPlayers`: lists of its people grouped (the UFC's by weight class). `game`, `events`: what
 * one of its events is and what the Scores tab's switch says ("race", "fights"). `football`: its cards' down and
 * distance, possession and timeouts. `divisions`: Search can sort its teams by division.
 */
export interface LeagueUi {
  color?: string; kinds: ('team' | 'player')[]; players: string; groupPlayers?: 'weightClass';
  game: string; events: string; football?: boolean; divisions: boolean;
}
const UI = (x: Partial<LeagueUi> = {}): LeagueUi => ({ kinds: ['team', 'player'], players: 'players', game: 'game', events: 'games', divisions: true, ...x });

/**
 * `slug`: ESPN's id for the league in its URLs, when it isn't ours (soccer leagues are codes: the EPL is "eng.1").
 * `fullName`: ESPN's own name for it, where it splits a player's stats by competition (soccer).
 */
export const LEAGUES: Record<League, { sport: string; name: string; slug?: string; fullName?: string; ui: LeagueUi }> = {
  nba: { sport: 'basketball', name: 'NBA', ui: UI({ color: '#C9082A' }) },
  mlb: { sport: 'baseball', name: 'MLB', ui: UI({ color: '#1D6FD8' }) },
  nfl: { sport: 'football', name: 'NFL', ui: UI({ color: '#2E7D32', football: true }) },
  nhl: { sport: 'hockey', name: 'NHL', ui: UI({ color: '#9CA3AF' }) },
  f1: { sport: 'racing', name: 'F1', ui: UI({ color: '#E10600', players: 'drivers', game: 'race', events: 'races', divisions: false }) },
  epl: { sport: 'soccer', name: 'EPL', slug: 'eng.1', fullName: 'English Premier League', ui: UI({ color: '#7B2FBE' }) },
  // The app lists leagues in this order (filter chips, Settings): the WNBA farthest right of the first row of
  // chips, then the UFC and college football, added after it, on a second row (eight fit a phone's row), so no chip moves.
  wnba: { sport: 'basketball', name: 'WNBA', ui: UI({ color: '#E8590C' }) },
  ufc: { sport: 'mma', name: 'UFC', ui: UI({ kinds: ['player'], players: 'fighters', groupPlayers: 'weightClass', game: 'fight', events: 'fights', divisions: false }) },
  cfb: { sport: 'football', name: 'CFB', slug: 'college-football', fullName: 'College Football', ui: UI({ color: '#B45309', kinds: ['team'], football: true }) },
};

export const LEAGUE_IDS = Object.keys(LEAGUES) as League[];
/**
 * Leagues made of games with play-by-play, and teams: the Scores tab, standings, Up Next. Not F1 (races and
 * sessions, f1.ts) or the UFC (fight cards between fighters, ufc.ts): a build drawing every game as two teams
 * must never get one of theirs.
 */
export const GAME_LEAGUES = LEAGUE_IDS.filter((lg) => lg !== 'f1' && lg !== 'ufc');

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports';
/** "basketball/nba", "soccer/eng.1". */
const path = (lg: League) => `${LEAGUES[lg].sport}/${LEAGUES[lg].slug ?? lg}`;

export const urls = {
  teams: (lg: League) => `${SITE}/${path(lg)}/teams?limit=100`,
  roster: (lg: League, teamId: string) => `${SITE}/${path(lg)}/teams/${teamId}/roster`,
  team: (lg: League, teamId: string) => `${SITE}/${path(lg)}/teams/${teamId}`,
  teamStats: (lg: League, teamId: string) => `${SITE}/${path(lg)}/teams/${teamId}/statistics`,
  /** A player's season, postseason and career lines (the stats ESPN picks for their position), last games and next game. */
  athleteOverview: (lg: League, athleteId: string) => `https://site.web.api.espn.com/apis/common/v3/sports/${path(lg)}/athletes/${athleteId}/overview`,
  /** Every season, by category (MLB hitters' season rows are only here). */
  athleteStats: (lg: League, athleteId: string) => `https://site.web.api.espn.com/apis/common/v3/sports/${path(lg)}/athletes/${athleteId}/stats`,
  /** A team's games this season part (preseason / regular / postseason; ?seasontype=N for another; soccer: ?fixture=true for what's to come). */
  teamSchedule: (lg: League, teamId: string) => `${SITE}/${path(lg)}/teams/${teamId}/schedule`,
  // College football: every FBS game (the default is ESPN's 20 or so featured ones).
  scoreboard: (lg: League, yyyymmdd?: string) =>
    `${SITE}/${path(lg)}/scoreboard${[yyyymmdd && `dates=${yyyymmdd}`, lg === 'cfb' && `groups=${FBS_GROUP}&limit=300`].filter(Boolean).map((q, i) => `${i ? '&' : '?'}${q}`).join('')}`,
  summary: (lg: League, eventId: string) => `${SITE}/${path(lg)}/summary?event=${eventId}`,
  // NFL site-API plays carry no participants; the core API does (passer, fumbler, kicker...). Soccer's is
  // every touch (1,500 a match), read a page at a time (`page`: 1-based, of `limit`).
  corePlays: (lg: League, eventId: string, page?: { limit: number; page: number }) =>
    `${CORE}/${LEAGUES[lg].sport}/leagues/${LEAGUES[lg].slug ?? lg}/events/${eventId}/competitions/${eventId}/plays?limit=${page?.limit ?? 1000}${page ? `&page=${page.page}` : ''}`,
  standings: (lg: League) => `https://site.api.espn.com/apis/v2/sports/${path(lg)}/standings`,
  injuries: (lg: League) => `${SITE}/${path(lg)}/injuries`,
  /** ESPN's league news: the latest ~50 articles, tagged with the athletes and teams they're about. */
  news: (lg: League) => `${SITE}/${path(lg)}/news?limit=50`,
  // F1 (ESPN "racing"): drivers are athletes, constructors are teams, a race weekend is one event
  // whose sessions (FP1..Race) are competitions.
  f1Athletes: (season: number) => `${CORE}/racing/leagues/f1/seasons/${season}/athletes?limit=200`,
  f1Competitors: (eventId: string, compId: string) => `${CORE}/racing/leagues/f1/events/${eventId}/competitions/${compId}/competitors?limit=50`,
  f1Status: (eventId: string, compId: string, athleteId: string) =>
    `${CORE}/racing/leagues/f1/events/${eventId}/competitions/${compId}/competitors/${athleteId}/status`,
  // Soccer's are all in one folder, whatever the league.
  headshot: (lg: League, athleteId: string) => `https://a.espncdn.com/i/headshots/${SOCCER.has(lg) ? 'soccer' : lg === 'ufc' ? 'mma' : lg}/players/full/${athleteId}.png`,
  /** The UFC (ESPN's MMA): a fight's record on the core API (status and result, fighters' stats, odds), a fighter's (record, fight log), and the rankings. */
  ufcFight: (eventId: string, fightId: string) => `${CORE}/mma/leagues/ufc/events/${eventId}/competitions/${fightId}`,
  mmaAthlete: (athleteId: string) => `${CORE}/mma/athletes/${athleteId}`,
  ufcRankings: () => `${CORE}/mma/leagues/ufc/rankings`,
  /** A UFC card's fight center, and a fighter's page: ESPN's latest MMA videos, each tagged with the fighters in it. */
  ufcFightCenter: (eventId: string) => `https://site.api.espn.com/apis/common/v3/sports/mma/ufc/fightcenter/${eventId}`,
  mmaAthletePage: (athleteId: string) => `https://site.api.espn.com/apis/common/v3/sports/mma/ufc/athletes/${athleteId}`,
  /** College football: the FBS's conferences (this season's regular season), one conference's teams, every school (one list), the polls. */
  cfbConferences: (season: number) => `${CORE}/football/leagues/college-football/seasons/${season}/types/2/groups/${FBS_GROUP}/children?limit=50`,
  cfbGroup: (season: number, groupId: string) => `${CORE}/football/leagues/college-football/seasons/${season}/types/2/groups/${groupId}`,
  cfbConferenceTeams: (season: number, groupId: string) => `${CORE}/football/leagues/college-football/seasons/${season}/types/2/groups/${groupId}/teams?limit=100`,
  cfbAllTeams: () => `${SITE}/football/college-football/teams?limit=1000`,
  cfbRankings: () => `${SITE}/football/college-football/rankings`,
};

export const playerKey = (lg: League, id: string) => `player:${lg}:${id}`;
export const teamKey = (lg: League, id: string) => `team:${lg}:${id}`;
