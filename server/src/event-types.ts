import { SOCCER, type League } from './leagues.ts';

export interface EventTypeDef {
  id: string;
  scope: 'player' | 'team';
  /** The heading it's listed under in the app ("Offense", "Pitching", "Team"…): see the order of BASE. */
  section: string;
  /**
   * Which players it's about, by ESPN position (in its league's codes): `only` these, or any but `not` these.
   * A player's ⚙️ screen shows it if any position they've played this season fits (Ohtani is P, DH and SP,
   * so he gets the hitting and the pitching alerts); with no position known, it's shown. Missing: everyone.
   */
  positions?: { only?: string[]; not?: string[] };
  /** Also sent to the other kind of target (NFL safety: the team AND the player responsible). */
  alsoScope?: 'player' | 'team';
  leagues: League[];
  label: string;
  description: string;
  defaultOn: boolean;
  /** false: on by default but feed only, no push, until its 🔔 is tapped. Missing means pushed. */
  defaultPush?: boolean;
  emoji: string;
}

const SOCCER_LEAGUES = [...SOCCER];

// Positions, in ESPN's codes (each league's own: an NFL "G" is a guard, an NHL or soccer "G" a goalie).
const MLB_PITCHERS = ['SP', 'RP', 'P'];
const HITTERS = { not: MLB_PITCHERS }, PITCHERS = { only: MLB_PITCHERS };
const QBS = { only: ['QB'] };
/** Linemen, kickers and long snappers don't carry the ball (a punter can drop a snap). */
const BALL_CARRIERS = { not: ['OT', 'G', 'C', 'OL', 'DE', 'DT', 'PK', 'LS'] };
/** A safety is given up by the offense: whoever is tackled, sacked or flagged in their own end zone. */
const OFFENSE = { not: ['DE', 'DT', 'LB', 'CB', 'S', 'DB', 'PK', 'LS'] };
const GOALIES = { only: ['G'] }, SKATERS = { not: ['G'] }, OUTFIELD = { not: ['G'] };

/**
 * Soccer alerts, once for every soccer league (SOCCER in leagues.ts): each league gets its own copy,
 * `<league>.<key>` (the EPL's are `epl.own_goal` and so on), under "<League> alerts" with its own
 * switches, fed by the same soccer detectors. A new soccer league gets all of them.
 */
const SOCCER_ALERTS: (Omit<EventTypeDef, 'id' | 'leagues'> & { key: string })[] = [
  { key: 'penalty_missed', scope: 'player', positions: OUTFIELD, alsoScope: 'team', section: 'Attack', label: 'Misses a penalty', description: 'Tracked player misses a penalty or has it saved. For teams: the tracked team misses one.', defaultOn: true, emoji: '😬' },
  { key: 'lost_ball', scope: 'player', positions: OUTFIELD, section: 'Attack', label: 'Loses the ball', description: 'Tracked player tries to dribble past someone and is tackled, or is dispossessed: the other team has it. Off by default: it can be several a match.', defaultOn: false, emoji: '🙈' },
  { key: 'pass_given_away', scope: 'player', section: 'Attack', label: 'Gives the ball away', description: "Tracked player's pass goes to the other team: intercepted, blocked, cleared or straight to an opponent. Off by default: it can be several a match.", defaultOn: false, emoji: '🎁' },
  { key: 'own_goal', scope: 'player', section: 'Defense', label: 'Scores an own goal', description: 'Tracked player puts it in their own net.', defaultOn: true, emoji: '🤡' },
  { key: 'penalty_conceded', scope: 'player', alsoScope: 'team', section: 'Defense', label: 'Gives away a penalty', description: 'Tracked player concedes a penalty (it counts as their foul too). For teams: the tracked team gives one away.', defaultOn: true, emoji: '🤦' },
  { key: 'red_card', scope: 'team', alsoScope: 'player', section: 'Cards & fouls', label: 'Sent off', description: 'The tracked team has a player sent off (a straight red or a second yellow), or a tracked player is.', defaultOn: true, emoji: '🟥' },
  { key: 'yellow_card', scope: 'player', section: 'Cards & fouls', label: 'Gets booked', description: 'Tracked player is shown a yellow card.', defaultOn: true, emoji: '🟨' },
  { key: 'foul', scope: 'player', section: 'Cards & fouls', label: 'Commits a foul', description: 'Tracked player is penalized for a foul or a handball.', defaultOn: true, defaultPush: false, emoji: '😤' },
  { key: 'goal_conceded', scope: 'player', positions: GOALIES, section: 'Goalkeeping', label: 'Keeper concedes a goal', description: 'Tracked goalkeeper is in goal when the other team scores (own goals too).', defaultOn: true, emoji: '🥅' },
  { key: 'team.heavy_loss', scope: 'team', section: 'Team', label: 'Loses by 3+ goals', description: 'Tracked team loses by three goals or more: a Successful Hate Watch, sent instead of "Loses a game" when both are on.', defaultOn: true, emoji: '🔨' },
];
const soccerAlerts = (): EventTypeDef[] => SOCCER_LEAGUES.flatMap((lg) => SOCCER_ALERTS.map(({ key, ...t }) => ({ ...t, id: `${lg}.${key}`, leagues: [lg] })));
/** A soccer alert's id in a league: soccerType('epl', 'foul') is 'epl.foul'. */
export const soccerType = (lg: League, key: (typeof SOCCER_ALERTS)[number]['key']) => `${lg}.${key}`;
export const SOCCER_ALERT_KEYS = SOCCER_ALERTS.map((t) => t.key);

// The single source of truth for every notification Hate Watch can send.
// The app renders its Settings screen from this list (GET /catalog/event-types).
// The order is the app's: Settings and each player or team's ⚙️ screen list alerts in this order, under
// their `section` (offense, defense, pitching or goaltending, then the team's), the headline ones first
// in each, then the feed-only ones, then the ones off by default.
const BASE: EventTypeDef[] = [
  // ── MLB
  { id: 'mlb.batter.strikeout', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Strikes out', description: 'Tracked hitter strikes out (swinging or looking).', defaultOn: true, emoji: '🌀' },
  { id: 'mlb.batter.double_play', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Hits into a double or triple play', description: 'Tracked hitter grounds, lines or flies into a double play, or a triple play. It counts as "Makes an out" too.', defaultOn: true, emoji: '✌️' },
  { id: 'mlb.runner.caught_stealing', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Gets caught stealing or picked off', description: 'Tracked player is thrown out trying to steal, or picked off a base.', defaultOn: true, emoji: '🚔' },
  { id: 'mlb.team.down_in_order', scope: 'team', leagues: ['mlb'], section: 'Offense', label: 'Goes down in order', description: 'Tracked team goes 1-2-3: three up, three down, nobody on base. "Struck out in order" when all three strike out.', defaultOn: true, defaultPush: false, emoji: '😴' },
  { id: 'mlb.batter.popout', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Makes an out', description: 'Any out by a tracked hitter other than a strikeout: "grounded out", "flied out", and double and triple plays, which say so.', defaultOn: false, emoji: '🙄' },
  { id: 'mlb.fielder.error', scope: 'player', leagues: ['mlb'], section: 'Defense', label: 'Commits an error', description: 'Tracked player is charged with a fielding error.', defaultOn: true, emoji: '🧤' },
  { id: 'mlb.pitcher.blown_save', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Blows a save', description: 'Tracked pitcher is charged with a blown save: the lead they came in to protect is gone.', defaultOn: true, emoji: '🫠' },
  { id: 'mlb.pitcher.loss', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Takes the loss', description: 'Tracked pitcher is charged with the loss when the game ends.', defaultOn: true, emoji: '👎' },
  { id: 'mlb.pitcher.home_run_allowed', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Gives up a home run', description: 'Tracked pitcher serves up a homer.', defaultOn: true, emoji: '💣' },
  { id: 'mlb.pitcher.no_quality_start', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'No quality start', description: 'Tracked starter won\'t get a quality start (6+ innings, 3 or fewer earned runs). Sent the moment it\'s settled: a 4th earned run, or leaving before 6 innings.', defaultOn: true, defaultPush: false, emoji: '🥀' },
  { id: 'mlb.pitcher.runs_allowed', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Gives up runs', description: 'Tracked pitcher allows a run to score.', defaultOn: true, defaultPush: false, emoji: '🩸' },
  { id: 'mlb.pitcher.walk', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Issues a walk / HBP', description: 'Tracked pitcher walks or hits a batter.', defaultOn: false, emoji: '🚶' },
  { id: 'mlb.challenge_lost', scope: 'team', alsoScope: 'player', leagues: ['mlb'], section: 'Challenges', label: 'Loses a challenge', description: 'Tracked team loses an ABS (ball/strike) or replay challenge. For players: a tracked batter loses an ABS challenge on a called strike, or one on a tracked pitcher\'s pitch fails.', defaultOn: true, defaultPush: false, emoji: '🙅' },
  { id: 'mlb.team.nobletiger', scope: 'team', leagues: ['mlb'], section: 'Team', label: 'NOBLETIGER', description: 'No Outs, Bases Loaded, Ending with Team Incapable of Getting Easy Run: tracked team loads the bases with nobody out and fails to score. Replaces that inning\'s stranded-runners alert.', defaultOn: true, emoji: '🐯' },
  { id: 'mlb.team.stranded_risp', scope: 'team', leagues: ['mlb'], section: 'Team', label: 'Strands runners in scoring position', description: 'Tracked team ends an inning with a runner left on second or third (or the bases loaded).', defaultOn: true, defaultPush: false, emoji: '🏝️' },
  { id: 'mlb.team.opponent_risp', scope: 'team', leagues: ['mlb'], section: 'Team', label: 'Opponent has runners in scoring position', description: 'The other team gets a runner to second or third against the tracked team. Once per half-inning; if a run scores on that same play, "Opponent scores" covers it. Off by default: it can be several a game.', defaultOn: false, emoji: '😰' },

  // ── NFL
  { id: 'nfl.qb.interception', scope: 'player', positions: QBS, leagues: ['nfl'], section: 'Offense', label: 'Throws an interception', description: 'Tracked passer is picked off.', defaultOn: true, emoji: '🙅' },
  { id: 'nfl.fumble_lost', scope: 'player', positions: BALL_CARRIERS, leagues: ['nfl'], section: 'Offense', label: 'Loses a fumble', description: 'Tracked player fumbles and the defense recovers.', defaultOn: true, emoji: '🏈' },
  { id: 'nfl.safety', scope: 'team', alsoScope: 'player', positions: OFFENSE, leagues: ['nfl'], section: 'Offense', label: 'Gives up a safety', description: 'Tracked team gives up a safety, or a tracked player is tackled, sacked or flagged in their own end zone for one.', defaultOn: true, emoji: '😵' },
  { id: 'nfl.qb.delay_of_game', scope: 'player', positions: QBS, leagues: ['nfl'], section: 'Offense', label: 'Delay of game', description: "Tracked quarterback's offense is flagged for delay of game (not on punts or field goals).", defaultOn: true, emoji: '⏱️' },
  { id: 'nfl.qb.sacked', scope: 'player', positions: QBS, leagues: ['nfl'], section: 'Offense', label: 'Gets sacked', description: 'Tracked passer is sacked.', defaultOn: true, defaultPush: false, emoji: '💥' },
  { id: 'nfl.qb.incompletion', scope: 'player', positions: QBS, leagues: ['nfl'], section: 'Offense', label: 'Throws an incompletion', description: 'Tracked passer throws incomplete.', defaultOn: false, emoji: '🗑️' },
  { id: 'nfl.fumble', scope: 'player', positions: BALL_CARRIERS, leagues: ['nfl'], section: 'Offense', label: 'Fumbles (any)', description: 'Tracked player fumbles, even if their team recovers.', defaultOn: false, emoji: '🤲' },
  { id: 'nfl.penalty', scope: 'player', leagues: ['nfl'], section: 'Penalties', label: 'Commits a penalty', description: 'Tracked player is flagged.', defaultOn: true, emoji: '🚩' },
  { id: 'nfl.kicker.miss', scope: 'player', positions: { only: ['PK'] }, leagues: ['nfl'], section: 'Special teams', label: 'Misses a kick', description: 'Tracked kicker misses or has a field goal / extra point blocked.', defaultOn: true, emoji: '🦵' },
  { id: 'nfl.team.onside_recovered', scope: 'team', leagues: ['nfl'], section: 'Special teams', label: 'Opponent recovers an onside kick', description: 'The other team kicks onside against the tracked team and gets the ball back.', defaultOn: true, emoji: '😱' },

  // ── NBA (the WNBA gets a copy of each)
  { id: 'nba.got_blocked', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Gets blocked', description: 'Tracked player has a shot blocked.', defaultOn: true, emoji: '✋' },
  { id: 'nba.missed_free_throw', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Misses a free throw', description: 'Tracked player bricks a free throw.', defaultOn: true, defaultPush: false, emoji: '😬' },
  { id: 'nba.turnover', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Turns it over', description: 'Tracked player commits a turnover.', defaultOn: true, defaultPush: false, emoji: '🔄' },
  { id: 'nba.missed_shot', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Misses a shot', description: 'Tracked player misses a field goal attempt. Off by default: it can be ten a game.', defaultOn: false, emoji: '🧱' },
  { id: 'nba.technical', scope: 'player', leagues: ['nba'], section: 'Fouls', label: 'Technical foul / ejection', description: 'Tracked player gets a technical or is ejected.', defaultOn: true, emoji: '🤬' },
  { id: 'nba.foul', scope: 'player', leagues: ['nba'], section: 'Fouls', label: 'Commits a foul', description: 'Tracked player is called for a personal / shooting / offensive foul.', defaultOn: false, emoji: '😤' },

  // ── NHL
  { id: 'nhl.shot_missed', scope: 'player', positions: SKATERS, leagues: ['nhl'], section: 'Offense', label: 'Shoots and misses', description: 'Tracked skater misses the net.', defaultOn: true, defaultPush: false, emoji: '🎯' },
  { id: 'nhl.shot_blocked', scope: 'player', positions: SKATERS, leagues: ['nhl'], section: 'Offense', label: 'Gets a shot blocked', description: 'Tracked skater has a shot blocked.', defaultOn: false, emoji: '🧱' },
  { id: 'nhl.shot_saved', scope: 'player', positions: SKATERS, leagues: ['nhl'], section: 'Offense', label: 'Shot gets saved', description: 'Tracked skater is stopped by the goalie.', defaultOn: false, emoji: '🧤' },
  { id: 'nhl.giveaway', scope: 'player', leagues: ['nhl'], section: 'Offense', label: 'Gives the puck away', description: 'Tracked player is charged with a giveaway.', defaultOn: false, emoji: '🎁' },
  { id: 'nhl.penalty', scope: 'player', leagues: ['nhl'], section: 'Penalties', label: 'Takes a penalty', description: 'Tracked player goes to the box.', defaultOn: true, emoji: '⛓️' },
  { id: 'nhl.goalie.goal_allowed', scope: 'player', positions: GOALIES, leagues: ['nhl'], section: 'Goaltending', label: 'Goalie allows a goal', description: 'Tracked goalie is in net when the opponent scores.', defaultOn: true, emoji: '🥅' },

  // ── Soccer: every soccer league's own copy (SOCCER_ALERTS)
  ...soccerAlerts(),

  // ── F1 (one finish alert per driver per session: the facts that apply are merged)
  { id: 'f1.driver.dnf', scope: 'player', leagues: ['f1'], section: 'Race', label: "Doesn't finish", description: 'Tracked driver retires, is disqualified, or doesn\'t start a race or sprint. Sent live.', defaultOn: true, emoji: '🛑' },
  { id: 'f1.driver.out_of_points', scope: 'player', leagues: ['f1'], section: 'Race', label: 'Finishes outside the points', description: 'Tracked driver finishes outside the top 10 (top 8 in a sprint).', defaultOn: true, emoji: '0️⃣' },
  { id: 'f1.driver.lost_places', scope: 'player', leagues: ['f1'], section: 'Race', label: 'Loses places from the grid', description: 'Tracked driver finishes 3 or more places lower than they started.', defaultOn: true, emoji: '🔻' },
  { id: 'f1.driver.beaten_by_teammate', scope: 'player', leagues: ['f1'], section: 'Race', label: 'Finishes behind teammate', description: 'Tracked driver is beaten by the other car in the same team.', defaultOn: true, emoji: '🥈' },
  { id: 'f1.driver.quali_knockout', scope: 'player', leagues: ['f1'], section: 'Qualifying', label: 'Knocked out in qualifying', description: 'Tracked driver fails to reach Q3 (knocked out in Q1 or Q2).', defaultOn: true, emoji: '🚫' },
  { id: 'f1.driver.standings_drop', scope: 'player', leagues: ['f1'], section: 'Championship', label: "Drops in the drivers' championship", description: "Tracked driver slides down the drivers' standings.", defaultOn: true, defaultPush: false, emoji: '📊' },
  { id: 'f1.team.double_dnf', scope: 'team', leagues: ['f1'], section: 'Team', label: 'Double DNF', description: 'Both of the tracked team\'s cars fail to finish. Sent live. Also covers "Scores no points".', defaultOn: true, emoji: '☠️' },
  { id: 'f1.team.no_points', scope: 'team', leagues: ['f1'], section: 'Team', label: 'Scores no points', description: 'Neither of the tracked team\'s cars finishes in the points.', defaultOn: true, emoji: '🕳️' },

  // ── Every player
  { id: 'player.team_lost', scope: 'player', leagues: ['nba', 'mlb', 'nfl', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Their team loses', description: "A tracked player's team loses a game: a Successful Hate Watch, counted for their team. If you also track the team (or another of its players), that loss is one alert, not two.", defaultOn: true, emoji: '🪦' },
  { id: 'player.injured', scope: 'player', leagues: ['nba', 'mlb', 'nfl', 'nhl'], section: 'Injuries & news', label: 'Gets injured', description: 'Tracked player appears on the injury report or their status worsens.', defaultOn: true, emoji: '🤕' },
  // id kept from when this was caught-stealing only, so existing users' on/off choice carries over.
  { id: 'off_field', scope: 'player', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Injuries & news', label: 'Off-field trouble', description: 'A tracked player is in legal or off-field trouble: an arrest, charges, a lawsuit, allegations or an investigation (from ESPN\'s news).', defaultOn: true, emoji: '🚨' },
  { id: 'fine_suspension', scope: 'player', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Injuries & news', label: 'Fined or suspended', description: 'A tracked player is fined, suspended or banned (from ESPN\'s news). A suspension for off-field trouble counts as both.', defaultOn: true, emoji: '🚫' },

  // ── Every team
  { id: 'team.lost', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Loses a game', description: 'Final whistle and your tracked team lost.', defaultOn: true, emoji: '🪦' },
  { id: 'team.game_start', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Game', label: 'Game starts', description: 'Hate Watch Starting: the tracked team\'s game gets underway (F1: a race or sprint).', defaultOn: true, emoji: '🍿' },
  { id: 'team.fell_behind', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Falls behind', description: "Tracked team goes from tied/leading to trailing. Replaces that play's \"Opponent scores\" alert, so you get one alert, not two.", defaultOn: true, defaultPush: false, emoji: '⬇️' },
  { id: 'team.opponent_scored', scope: 'team', leagues: ['mlb', 'nfl', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Opponent scores', description: 'The other team puts points on the board (a goal, in soccer).', defaultOn: true, defaultPush: false, emoji: '📉' },
  { id: 'team.eliminated', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], section: 'Season', label: 'Eliminated from playoffs', description: 'Tracked team is mathematically eliminated from playoff contention, or knocked out of the playoffs. A knockout comes in that game\'s Successful Hate Watch, one alert (a sweep says so).', defaultOn: true, emoji: '⚰️' },
  { id: 'team.losing_streak', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], section: 'Season', label: 'Losing streak', description: 'Tracked team extends a losing streak to 3 or more.', defaultOn: true, defaultPush: false, emoji: '🧊' },
  { id: 'team.standings_drop', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Season', label: 'Drops in standings', description: "Tracked team slides down the conference/league standings (F1: the constructors' championship; EPL: the table).", defaultOn: true, defaultPush: false, emoji: '📊' },
  { id: 'team.off_field', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Injuries & news', label: 'Off-field trouble', description: 'A tracked team, or one of its players, is in legal or off-field trouble: an arrest, charges, a lawsuit, allegations or an investigation (from ESPN\'s news).', defaultOn: true, emoji: '🚨' },
  { id: 'team.fine_suspension', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Injuries & news', label: 'Fined or suspended', description: 'A tracked team, or one of its players, is fined, suspended or banned (from ESPN\'s news). A suspension for off-field trouble counts as both.', defaultOn: true, emoji: '🚫' },
  { id: 'team.player_injured', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], section: 'Injuries & news', label: 'A player gets injured', description: 'Anyone on the tracked team lands on the injury report.', defaultOn: true, defaultPush: false, emoji: '🚑' },
];

/**
 * The WNBA gets every alert the NBA has: a copy of each NBA-only alert (wnba.*, with its own switches
 * under "WNBA alerts", fed by the same basketball detectors), and every multi-league alert the NBA is in.
 */
const withWnba = (lgs: League[]): League[] => lgs.flatMap((lg) => (lg === 'nba' ? ['nba', 'wnba'] as League[] : [lg]));
export const EVENT_TYPES: EventTypeDef[] = [
  ...BASE.map((t) => (t.leagues.length > 1 && t.leagues.includes('nba') ? { ...t, leagues: withWnba(t.leagues) } : t)),
  ...BASE.filter((t) => t.leagues.length === 1 && t.leagues[0] === 'nba').map((t) => ({ ...t, id: t.id.replace(/^nba\./, 'wnba.'), leagues: ['wnba'] as League[] })),
];

export const EVENT_TYPE_BY_ID = new Map(EVENT_TYPES.map((t) => [t.id, t]));
