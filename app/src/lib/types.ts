export type League = 'nba' | 'mlb' | 'nfl' | 'nhl' | 'f1';

export interface Team {
  kind: 'team'; key: string; league: League; espnId: string; name: string; shortName: string; abbrev: string;
  location: string | null; color: string | null; altColor: string | null;
  logo: string; logoDark: string | null; logoW: number; logoH: number;
}

export interface Player {
  kind: 'player'; key: string; league: League; espnId: string; name: string; shortName: string | null;
  position: string | null; jersey: string | null; teamKey: string;
  image: string; imageW: number; imageH: number; imageKind: 'headshot' | 'team_logo';
  teamName: string | null; teamAbbrev: string | null; teamColor: string | null; teamLogo: string | null;
}

export type Target = Team | Player;

export interface FeedItem {
  id: string; type: string; emoji: string; typeLabel: string; league: League;
  title: string; body: string; occurredAt: number; detectedAt: number; target: Target;
  /** A link whose preview is a picture of this alert; tapping it opens the App Store. */
  shareUrl?: string;
  /** The game (F1: session) it happened in, if any: links the alert to the Scores tab's game screen. */
  gameId?: string | null;
}

/** One game on the Scores tab (server/src/scores.ts). F1 sessions have `session` + `order` instead of sides. */
export interface GameSide { team: Team; score: number | null; winner?: boolean }
export interface GameCard {
  key: string; league: League; id: string;
  state: 'pre' | 'in' | 'post'; startsAt: number; detail: string;
  home?: GameSide; away?: GameSide;
  possession?: string; downDistance?: string; redZone?: boolean;
  bases?: { first: boolean; second: boolean; third: boolean; outs: number };
  batting?: string;
  winProb?: { home: number; away: number };
  session?: string;
  order?: { athleteId: string; key: string; name: string; position: number | null; teamKey?: string }[];
}
export interface PlayLine { id: string; text: string; when: string; scoring: boolean }
export interface GameDetail { game: GameCard; alerts: FeedItem[]; plays: PlayLine[] }

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
