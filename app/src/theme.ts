export const colors = {
  bg: '#0B0B0D',
  surface: '#16161A',
  surfaceHi: '#1F1F25',
  border: '#2A2A31',
  text: '#F4F4F5',
  textDim: '#A1A1AA',
  textFaint: '#71717A',
  hate: '#E5232B',       // brand red
  hateDim: '#5A1014',
  live: '#22C55E',
  warn: '#F59E0B',
};

export const leagueColors: Record<string, string> = {
  nba: '#C9082A',
  wnba: '#E8590C', // WNBA orange
  mlb: '#1D6FD8',
  nfl: '#2E7D32',
  nhl: '#9CA3AF',
  f1: '#E10600',
  epl: '#7B2FBE', // Premier League purple, lifted to read on the dark background
};

export const space = (n: number) => n * 4;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
