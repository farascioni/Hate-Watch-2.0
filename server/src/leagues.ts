export type League = 'nba' | 'mlb' | 'nfl' | 'nhl';

export const LEAGUES: Record<League, { sport: string; name: string }> = {
  nba: { sport: 'basketball', name: 'NBA' },
  mlb: { sport: 'baseball', name: 'MLB' },
  nfl: { sport: 'football', name: 'NFL' },
  nhl: { sport: 'hockey', name: 'NHL' },
};

export const LEAGUE_IDS = Object.keys(LEAGUES) as League[];

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports';

export const urls = {
  teams: (lg: League) => `${SITE}/${LEAGUES[lg].sport}/${lg}/teams?limit=100`,
  roster: (lg: League, teamId: string) => `${SITE}/${LEAGUES[lg].sport}/${lg}/teams/${teamId}/roster`,
  scoreboard: (lg: League, yyyymmdd?: string) =>
    `${SITE}/${LEAGUES[lg].sport}/${lg}/scoreboard${yyyymmdd ? `?dates=${yyyymmdd}` : ''}`,
  summary: (lg: League, eventId: string) => `${SITE}/${LEAGUES[lg].sport}/${lg}/summary?event=${eventId}`,
  // NFL site-API plays carry no participants; the core API does (passer, fumbler, kicker...).
  corePlays: (lg: League, eventId: string) =>
    `${CORE}/${LEAGUES[lg].sport}/leagues/${lg}/events/${eventId}/competitions/${eventId}/plays?limit=1000`,
  standings: (lg: League) => `https://site.api.espn.com/apis/v2/sports/${LEAGUES[lg].sport}/${lg}/standings`,
  injuries: (lg: League) => `${SITE}/${LEAGUES[lg].sport}/${lg}/injuries`,
  headshot: (lg: League, athleteId: string) => `https://a.espncdn.com/i/headshots/${lg}/players/full/${athleteId}.png`,
};

export const playerKey = (lg: League, id: string) => `player:${lg}:${id}`;
export const teamKey = (lg: League, id: string) => `team:${lg}:${id}`;
