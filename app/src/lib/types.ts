/**
 * The leagues this build knows by name. The server sends the full list (with each one's name and sport),
 * and screens draw from that, so a league added on the server (another soccer league) works without an
 * app update; it just has no colour of its own until one is added to theme.ts.
 */
export type League = 'nba' | 'wnba' | 'mlb' | 'nfl' | 'nhl' | 'f1' | 'epl' | 'ufc';
export interface LeagueInfo { id: League; name: string; sport?: string }

export interface Team {
  kind: 'team'; key: string; league: League; espnId: string; name: string; shortName: string; abbrev: string;
  location: string | null; color: string | null; altColor: string | null;
  logo: string; logoDark: string | null; logoW: number; logoH: number;
  /** In a team list sorted by division: "AL East", "East · Atlantic" ("Constructors" in F1), and ESPN's order of them. */
  division?: string;
  divisionOrder?: number;
  /** How many people track them, where the server includes it (Search, team lists, rosters, their page). */
  haters?: number;
}

export interface Player {
  kind: 'player'; key: string; league: League; espnId: string; name: string; shortName: string | null;
  position: string | null; jersey: string | null; teamKey: string;
  /** Every position they've played this season (Ohtani: DH, P, SP). Missing from older servers. */
  positions?: string[] | null;
  image: string; imageW: number; imageH: number; imageKind: 'headshot' | 'team_logo';
  teamName: string | null; teamAbbrev: string | null; teamColor: string | null; teamLogo: string | null;
  /** How many people track them, where the server includes it (Search, rosters, their page). */
  haters?: number;
}

export type Target = Team | Player;

/** A UFC weight class with its champion and top fighters, for Search (GET /ufc/weight-classes). */
export interface WeightClass { name: string; fighters: Player[] }

export interface FeedItem {
  id: string; type: string; emoji: string; typeLabel: string; league: League;
  title: string; body: string; occurredAt: number; detectedAt: number; target: Target;
  /** A link whose preview is a picture of this alert; tapping it opens the App Store. */
  shareUrl?: string;
  /** The game (F1: session) it happened in, if any: links the alert to the Scores tab's game screen. */
  gameId?: string | null;
  /** A Successful Hate Watch: how many other people got this alert too. */
  alsoGot?: number;
  /** ESPN's clip of its play (a loss: of the winning play, or the recap), once it's out, while the server's switch is on. */
  clip?: Clip;
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
  /** F1: the race weekend, for its preview (newer servers). */
  eventId?: string;
  order?: { athleteId: string; key: string; name: string; position: number | null; teamKey?: string }[];
  /** Before the start (from ESPN's scoreboard). Missing from older servers. */
  preview?: GamePreview;
}
/** A game that hasn't started: chances from the betting line, records, probable starters, form, series. */
export interface GamePreview {
  /** Whole percents adding up to 100, from the moneyline with the bookmaker's margin taken out (soccer: and the draw). */
  chance?: { home: number; away: number; draw?: number };
  /** "CLE -115", the over/under, and whose line it is ("DraftKings"). */
  line?: string; total?: number; source?: string;
  /** Overall records, with the home side's at home and the away side's on the road. */
  records?: { home?: string; away?: string; homeSplit?: string; awaySplit?: string };
  /** MLB probable pitchers ("0-1, 4.15 ERA"), NHL probable goalies. */
  starters?: { label: string; home?: LivePlayer; away?: LivePlayer };
  /** Soccer: recent results ("LWWWW"). */
  form?: { home?: string; away?: string };
  /** Playoffs: "CHW lead series 2-1". */
  series?: string;
}
/** An F1 race weekend from ESPN's calendar (name includes the sponsor, as ESPN has it): from first practice to the race's end. */
export interface F1Weekend { name: string; startsAt: number; endsAt: number; eventId?: string }

/** An F1 weekend's preview (GET /f1/events/:id/preview): where, when, the next grid once it's set, the championship. */
export interface F1Preview {
  event: { id: string; name: string; shortName: string; circuit: string | null; place: string | null; startsAt: number; endsAt: number };
  sessions: { key: string; name: string; at: number; state: 'pre' | 'in' | 'post' }[];
  /** `key`: the session it's the grid of (newer servers). */
  grid: { key?: string; session: string; cars: { key: string; name: string; teamKey: string | null; grid: number }[] } | null;
  /** The session that sets the next grid, when it isn't set yet ("Qualifying"). */
  gridAfter?: string;
  /** Each driver's last races, latest first ("P4", "DNF"). Empty when ESPN's standings didn't load. */
  drivers: { key: string; name: string; teamKey: string | null; rank: number; points: number; form: string[] }[];
  constructors: { key: string; name: string; rank: number; points: number }[];
}

/** A UFC card (server's ufc-preview.ts): the Scores tab's UFC chip and a card's own screen. */
export interface UfcCorner {
  key: string; name: string; last: string;
  /** The catalog has them: their page opens. */
  linked: boolean;
  record: string | null;
  /** Null until the fight's over. */
  winner: boolean | null;
  belt?: 'champion' | 'interim';
  /** DraftKings' American odds: to win, and to win by KO/TKO, by submission, on the cards. */
  odds?: { win?: string; ko?: string; sub?: string; decision?: string };
  /** Their chance to win (percent), the moneyline's; both sides' add up to 100. */
  chance?: number;
}
/** A tale-of-the-tape row; `edge`: the side ahead on a more-is-better number. */
export interface TapeRow { label: string; values: [string | null, string | null]; edge?: 0 | 1 }
export interface UfcBout {
  id: string; weight: string | null; rounds: number;
  /** "Women's Flyweight title". */
  title: string | null;
  /** "Main event", "Co-main event". */
  billing: string | null;
  state: 'pre' | 'in' | 'post'; canceled: boolean;
  round?: number;
  /** "KO/TKO R1 2:09", with "Punches to the head". */
  result?: { line: string; detail?: string };
  corners: [UfcCorner, UfcCorner];
  tape: TapeRow[];
  oddsBy: string | null;
}
export interface UfcSegment { id: string; name: string; startsAt: number; broadcast: string | null; bouts: UfcBout[] }
export interface UfcCard { event: { id: string; name: string; startsAt: number; venue: string | null; place: string | null }; segments: UfcSegment[] }
/** A stats page (GET /targets/:key/stats): ESPN's numbers, with the ones a hater wants to see marked `bad`. */
export interface StatTile { label: string; name: string; value: string; bad?: boolean }
export interface StatGroup { title: string; tiles: StatTile[] }
export interface GameLine { id: string; date: number; home: boolean; opponent: string; opponentLogo?: string; result: 'W' | 'L' | 'T' | 'D' | ''; score: string; line?: string }
export interface StatsPage {
  key: string; kind: 'team' | 'player'; league: League;
  record?: { overall: string; standing?: string; splits: { label: string; value: string }[] };
  groups: StatGroup[];
  recent: GameLine[];
  next: NextGame | null;
}
/** A tracked team's next game, for the Scores tab's "Up next" (the server reads each team's ESPN schedule). */
export interface NextGame {
  key: string; league: League; id: string;
  /** The tracked team it's the next game of. */
  teamKey: string;
  startsAt: number;
  /** false: the date is set, the time isn't yet. */
  timeValid: boolean;
  home: Team; away: Team;
  tv?: string;
  /** "ALDS Game 4 · if necessary", "Preseason". */
  note?: string;
}
export interface PlayLine { id: string; text: string; when: string; scoring: boolean }
/**
 * A game's box score, away team first: a table per stat group, the columns picked by the server. `bad` are
 * the columns to show in red; `link` means the player has a page.
 */
export interface BoxRow { key: string; name: string; detail?: string; sub?: boolean; link: boolean; stats: string[]; bad?: number[] }
export interface BoxGroup { title: string; columns: string[]; rows: BoxRow[]; totals?: string[]; note?: string }
export interface BoxTeam { key: string; abbrev: string; logo: string | null; groups: BoxGroup[] }
export interface BoxScore { teams: BoxTeam[] }
/** A game's video clip from ESPN: HLS for phones, MP4 for the web. */
export interface Clip { id: string; title: string; seconds: number; thumb: string | null; hls: string | null; mp4: string | null; at: number; expires?: number | null }
/**
 * A key play (a score, a lead change, a turnover, a card), the score after it, and why it's one when the
 * text doesn't say. `alerted`: it sent you an alert (those are key plays too, whatever they were).
 */
export interface KeyPlay extends PlayLine { score?: string; tag?: string; alerted?: boolean }
export interface GameDetail { game: GameCard; alerts: FeedItem[]; plays: PlayLine[]; box?: BoxScore | null; clips?: Clip[]; keyPlays?: KeyPlay[] }

/** Settings counter: each time a team you track lost (F1: your constructor scored no points), and per team (most first). */
export interface HateWatchTally { total: number; teams: { target: Target; count: number }[] }

/** The leaderboard: a player or team and how many people track them. `rank` is within the filter; ties share it (`tied`: shown "T-2"). */
export interface LeaderboardEntry { rank: number; tied?: boolean; haters: number; target: Target }
/** The top 100 in a filter. `total`: everyone in it; `moreTied`: tied with the last one shown but past the cut. Missing from older servers. */
export interface Leaderboard { entries: LeaderboardEntry[]; total?: number; moreTied?: number }

export interface EventType {
  id: string; scope: 'player' | 'team'; alsoScope?: 'player' | 'team'; leagues: League[]; label: string; description: string; defaultOn: boolean;
  /** false: on by default but feed only (no push) until its 🔔 is tapped. Missing means pushed. */
  defaultPush?: boolean; emoji: string;
  /** The heading it's listed under ("Offense", "Pitching", "Team"…). The server lists alerts in section order. Missing from older servers. */
  section?: string;
  /** Which players it's about, by position: `only` these, or any but `not` these (see lib/positions.ts). Missing: everyone. */
  positions?: { only?: string[]; not?: string[] };
}

/** Alerts under their section headings, in the order they come (the server's: offense, defense, pitching, team…). */
export function bySection(types: EventType[]): { section: string; types: EventType[] }[] {
  const out: { section: string; types: EventType[] }[] = [];
  for (const t of types) {
    const s = t.section ?? '';
    const into = out.find((g) => g.section === s);
    if (into) into.types.push(t); else out.push({ section: s, types: [t] });
  }
  return out;
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
  /** A tracked player's team (their ⚙️ screen): `scores` false keeps its games off the Scores tab; `alerts` true sends its alerts too. Missing from older servers. */
  playerTeams?: Record<string, { scores?: boolean; alerts?: boolean }>;
}

/** A prefs update. In targetTypes and targetPushTypes, null means "back to the global setting" for that alert. */
export type PrefsPatch = Partial<Omit<Prefs, 'targetTypes' | 'targetPushTypes' | 'playerTeams'>> & {
  targetTypes?: Record<string, Record<string, boolean | null>>;
  targetPushTypes?: Record<string, Record<string, boolean | null>>;
  /** null: back to the default (games shown, alerts off). */
  playerTeams?: Record<string, { scores?: boolean | null; alerts?: boolean | null }>;
};
