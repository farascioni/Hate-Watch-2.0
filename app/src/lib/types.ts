/**
 * The leagues this build knows by name. The server sends the full list (with each one's name and sport),
 * and screens draw from that, so a league added on the server (another soccer league) works without an
 * app update; it just has no colour of its own until one is added to theme.ts.
 */
export type League = 'nba' | 'wnba' | 'mlb' | 'nfl' | 'nhl' | 'f1' | 'epl';
export interface LeagueInfo { id: League; name: string; sport?: string }

export interface Team {
  kind: 'team'; key: string; league: League; espnId: string; name: string; shortName: string; abbrev: string;
  location: string | null; color: string | null; altColor: string | null;
  logo: string; logoDark: string | null; logoW: number; logoH: number;
  /** How many people track them, where the server includes it (Search, team lists, rosters, their page). */
  haters?: number;
}

export interface Player {
  kind: 'player'; key: string; league: League; espnId: string; name: string; shortName: string | null;
  position: string | null; jersey: string | null; teamKey: string;
  image: string; imageW: number; imageH: number; imageKind: 'headshot' | 'team_logo';
  teamName: string | null; teamAbbrev: string | null; teamColor: string | null; teamLogo: string | null;
  /** How many people track them, where the server includes it (Search, rosters, their page). */
  haters?: number;
}

export type Target = Team | Player;

export interface FeedItem {
  id: string; type: string; emoji: string; typeLabel: string; league: League;
  title: string; body: string; occurredAt: number; detectedAt: number; target: Target;
  /** A link whose preview is a picture of this alert; tapping it opens the App Store. */
  shareUrl?: string;
  /** The game (F1: session) it happened in, if any: links the alert to the Scores tab's game screen. */
  gameId?: string | null;
  /** A Successful Hate Watch: how many other people got this alert too. */
  alsoGot?: number;
}

/** One game on the Scores tab (server/src/scores.ts). F1 sessions have `session` + `order` instead of sides. */
export interface GameSide { team: Team; score: number | null; winner?: boolean }
export interface LivePlayer { id: string; key: string; name: string; line?: string; pitches?: number }
export interface GameCard {
  key: string; league: League; id: string;
  state: 'pre' | 'in' | 'post'; startsAt: number; detail: string;
  /** Finals: when it ended (the tab keeps it for a day after). */
  endedAt?: number;
  /** Doubleheaders: "Game 1" / "Game 2". */
  note?: string;
  /** Finals that gave you a Successful Hate Watch: how many other people got it too (your copy of the card only). */
  hateWatch?: { alsoGot: number };
  home?: GameSide; away?: GameSide;
  possession?: string; downDistance?: string; redZone?: boolean;
  bases?: { first: boolean; second: boolean; third: boolean; outs: number };
  batting?: string;
  /** MLB at-bat. Pitcher `pitches` = thrown today; `line` is ESPN's (pitcher "4.1 IP, 0 ER, 5 K", batter "0-2"). */
  count?: { balls: number; strikes: number };
  pitcher?: LivePlayer;
  batter?: LivePlayer;
  winProb?: { home: number; away: number };
  /** NBA/NFL/NHL: ESPN's text for the latest play. */
  lastPlay?: string;
  /** NBA: each side's top scorer ("10 pts"); NFL: each side's passer ("18/25, 256 YDS, 1 TD"). */
  leaders?: { home?: LivePlayer; away?: LivePlayer };
  timeouts?: { home: number; away: number }; // NFL
  shots?: { home: number; away: number };    // NHL: shots on goal (soccer: shots on target)
  redCards?: { home: number; away: number }; // soccer, once anyone has been sent off
  goalies?: { home?: LivePlayer; away?: LivePlayer }; // NHL: in net, line "9 saves on 10"
  session?: string;
  order?: { athleteId: string; key: string; name: string; position: number | null; teamKey?: string }[];
}
/** An F1 race weekend from ESPN's calendar (name includes the sponsor, as ESPN has it): from first practice to the race's end. */
export interface F1Weekend { name: string; startsAt: number; endsAt: number }
export interface PlayLine { id: string; text: string; when: string; scoring: boolean }
export interface GameDetail { game: GameCard; alerts: FeedItem[]; plays: PlayLine[] }

/** Settings counter: each time a team you track lost (F1: your constructor scored no points), and per team (most first). */
export interface HateWatchTally { total: number; teams: { target: Target; count: number }[] }

/** The leaderboard: a player or team and how many people track them. `rank` is within the filter; ties share it (`tied`: shown "T-2"). */
export interface LeaderboardEntry { rank: number; tied?: boolean; haters: number; target: Target }
/** The top 100 in a filter. `total`: everyone in it; `moreTied`: tied with the last one shown but past the cut. Missing from older servers. */
export interface Leaderboard { entries: LeaderboardEntry[]; total?: number; moreTied?: number }

export interface EventType {
  id: string; scope: 'player' | 'team'; alsoScope?: 'player' | 'team'; leagues: League[]; label: string; description: string; defaultOn: boolean; emoji: string;
}

export interface Prefs {
  pushEnabled: boolean;
  sound: boolean;
  leagues: Partial<Record<League, boolean>>;
  types: Record<string, boolean>;
  muted: string[];
  quietHours: { enabled: boolean; start: string; end: string; tz: string };
  /** Per-player/team alert choices (⚙️ on the Tracking tab). They beat the global settings for that target. */
  targetTypes: Record<string, Record<string, boolean>>;
  /** An alert's 🔔 in Settings: typeId → false keeps it in the feed without a notification. Missing = notify. */
  pushTypes?: Record<string, boolean>;
  /** The 🔔 on an alert for one player or team (⚙️ screen). Beats pushTypes for that target. */
  targetPushTypes?: Record<string, Record<string, boolean>>;
}

/** A prefs update. In targetTypes and targetPushTypes, null means "back to the global setting" for that alert. */
export type PrefsPatch = Partial<Omit<Prefs, 'targetTypes' | 'targetPushTypes'>> & {
  targetTypes?: Record<string, Record<string, boolean | null>>;
  targetPushTypes?: Record<string, Record<string, boolean | null>>;
};
