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
  { key: 'goal_disallowed', scope: 'player', positions: OUTFIELD, alsoScope: 'team', section: 'Attack', label: 'Has a goal ruled out by VAR', description: 'Tracked player scores and VAR rules it out. For teams: the tracked team does. Tracking both: one alert.', defaultOn: true, emoji: '📺' },
  { key: 'hit_woodwork', scope: 'player', positions: OUTFIELD, section: 'Attack', label: 'Hits the woodwork', description: 'Tracked player hits the post or the bar.', defaultOn: true, defaultPush: false, emoji: '🪵' },
  { key: 'lost_ball', scope: 'player', positions: OUTFIELD, section: 'Attack', label: 'Loses the ball', description: 'Tracked player tries to dribble past someone and is tackled, or is dispossessed: the other team has it. Off by default: it can be several a match.', defaultOn: false, emoji: '🙈' },
  { key: 'pass_given_away', scope: 'player', section: 'Attack', label: 'Gives the ball away', description: "Tracked player's pass goes to the other team: intercepted, blocked, cleared or straight to an opponent. Off by default: it can be several a match.", defaultOn: false, emoji: '🎁' },
  { key: 'own_goal', scope: 'player', section: 'Defense', label: 'Scores an own goal', description: 'Tracked player puts it in their own net.', defaultOn: true, emoji: '🤡' },
  { key: 'penalty_conceded', scope: 'player', alsoScope: 'team', section: 'Defense', label: 'Gives away a penalty', description: 'Tracked player concedes a penalty (it counts as their foul too). For teams: the tracked team gives one away.', defaultOn: true, emoji: '🤦' },
  { key: 'red_card', scope: 'team', alsoScope: 'player', section: 'Cards & fouls', label: 'Sent off', description: 'The tracked team has a player sent off (a straight red or a second yellow), or a tracked player is.', defaultOn: true, emoji: '🟥' },
  { key: 'yellow_card', scope: 'player', section: 'Cards & fouls', label: 'Gets booked', description: 'Tracked player is shown a yellow card.', defaultOn: true, emoji: '🟨' },
  { key: 'foul', scope: 'player', section: 'Cards & fouls', label: 'Commits a foul', description: 'Tracked player is penalized for a foul or a handball.', defaultOn: true, defaultPush: false, emoji: '😤' },
  { key: 'goal_conceded', scope: 'player', positions: GOALIES, section: 'Goalkeeping', label: 'Keeper concedes a goal', description: 'Tracked goalkeeper is in goal when the other team scores (own goals too).', defaultOn: true, emoji: '🥅' },
  { key: 'subbed_off_early', scope: 'player', section: 'Lineup', label: 'Taken off early', description: 'Tracked player is substituted by halftime, not for an injury.', defaultOn: true, emoji: '🪝' },
  { key: 'team.heavy_loss', scope: 'team', section: 'Team', label: 'Loses by 3+ goals', description: 'Tracked team loses by three goals or more: a Successful Hate Watch, sent instead of "Loses a game" when both are on.', defaultOn: true, emoji: '🔨' },
  { key: 'team.late_goal', scope: 'team', section: 'Team', label: 'Concedes a late goal', description: 'The other team goes ahead or equalizes against the tracked team from the 85th minute on. In place of that goal\'s "Falls behind" or "Opponent scores".', defaultOn: true, emoji: '⌛' },
  { key: 'team.relegation_zone', scope: 'team', section: 'Team', label: 'Drops into the relegation zone', description: 'Tracked team falls into the relegation places. With other standings news for them, one alert; after a loss, a line on it.', defaultOn: true, emoji: '🪂' },
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
  { id: 'mlb.batter.multi_strikeout', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Strikes out 3+ times', description: 'Tracked hitter\'s 3rd strikeout of a game (a hat trick), 4th (a golden sombrero) or 5th, in place of that strikeout\'s alert.', defaultOn: true, emoji: '🎩' },
  { id: 'mlb.batter.double_play', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Hits into a double or triple play', description: 'Tracked hitter grounds, lines or flies into a double play, or a triple play. It counts as "Makes an out" too.', defaultOn: true, emoji: '✌️' },
  { id: 'mlb.runner.caught_stealing', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Gets caught stealing or picked off', description: 'Tracked player is thrown out trying to steal, or picked off a base.', defaultOn: true, emoji: '🚔' },
  { id: 'mlb.runner.out_on_bases', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Gets thrown out on the bases', description: 'Tracked player is thrown out stretching a hit, doubled off, or thrown out at home.', defaultOn: true, emoji: '🏃' },
  { id: 'mlb.team.down_in_order', scope: 'team', leagues: ['mlb'], section: 'Offense', label: 'Goes down in order', description: 'Tracked team goes 1-2-3: three up, three down, nobody on base. "Struck out in order" when all three strike out.', defaultOn: true, defaultPush: false, emoji: '😴' },
  { id: 'mlb.batter.hitless', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Goes hitless', description: 'Tracked hitter goes 0-for-4 or worse. At the final: a line on their team\'s loss, or its own alert (feed only) after a win.', defaultOn: true, defaultPush: false, emoji: '🕳️' },
  { id: 'mlb.batter.popout', scope: 'player', positions: HITTERS, leagues: ['mlb'], section: 'Offense', label: 'Makes an out', description: 'Any out by a tracked hitter other than a strikeout: "grounded out", "flied out", and double and triple plays, which say so.', defaultOn: false, emoji: '🙄' },
  { id: 'mlb.fielder.error', scope: 'player', leagues: ['mlb'], section: 'Defense', label: 'Commits an error', description: 'Tracked player is charged with a fielding error.', defaultOn: true, emoji: '🧤' },
  { id: 'mlb.catcher.passed_ball', scope: 'player', positions: { only: ['C'] }, leagues: ['mlb'], section: 'Defense', label: 'Lets a run score on a passed ball', description: 'Tracked catcher\'s passed ball brings a run home.', defaultOn: true, emoji: '🫳' },
  { id: 'mlb.pitcher.blown_save', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Blows a save', description: 'Tracked pitcher is charged with a blown save: the lead they came in to protect is gone.', defaultOn: true, emoji: '🫠' },
  { id: 'mlb.pitcher.loss', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Takes the loss', description: 'Tracked pitcher is charged with the loss when the game ends.', defaultOn: true, emoji: '👎' },
  { id: 'mlb.pitcher.home_run_allowed', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Gives up a home run', description: 'Tracked pitcher serves up a homer. Each one is an alert; back-to-back ones say so (and back-to-back-to-back).', defaultOn: true, emoji: '💣' },
  { id: 'mlb.pitcher.chased', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Gets chased early', description: 'Tracked starter leaves before getting 9 outs. It counts as "No quality start": if that came first, this is a line on it.', defaultOn: true, emoji: '🪝' },
  { id: 'mlb.pitcher.gift_run', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Hands over a run', description: 'Tracked pitcher walks or hits a batter with the bases loaded, or lets a run score on a wild pitch or a balk. In place of that run\'s alert.', defaultOn: true, emoji: '🎁' },
  { id: 'mlb.pitcher.no_quality_start', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'No quality start', description: 'Tracked starter won\'t get a quality start (6+ innings, 3 or fewer earned runs). Sent the moment it\'s settled: a 4th earned run, or leaving before 6 innings.', defaultOn: true, defaultPush: false, emoji: '🥀' },
  { id: 'mlb.pitcher.runs_allowed', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Gives up runs', description: 'Tracked pitcher allows a run to score.', defaultOn: true, defaultPush: false, emoji: '🩸' },
  { id: 'mlb.pitcher.walk', scope: 'player', positions: PITCHERS, leagues: ['mlb'], section: 'Pitching', label: 'Issues a walk / HBP', description: 'Tracked pitcher walks or hits a batter.', defaultOn: false, emoji: '🚶' },
  { id: 'mlb.challenge_lost', scope: 'team', alsoScope: 'player', leagues: ['mlb'], section: 'Challenges', label: 'Loses a challenge', description: 'Tracked team loses an ABS (ball/strike) or replay challenge, or a crew chief review overturns a call that went their way. For players: a tracked batter loses an ABS challenge on a called strike or has a home run overturned by a crew chief review, or an ABS challenge on a tracked pitcher\'s pitch fails.', defaultOn: true, defaultPush: false, emoji: '🙅' },
  { id: 'mlb.team.no_hit', scope: 'team', leagues: ['mlb'], section: 'Team', label: 'Gets no-hit', description: 'Tracked team has no hits through 6 innings (once a game), and a line on the loss if they\'re no-hit.', defaultOn: true, emoji: '🚫' },
  { id: 'mlb.team.nobletiger', scope: 'team', leagues: ['mlb'], section: 'Team', label: 'NOBLETIGER', description: 'No Outs, Bases Loaded, Ending with Team Incapable of Getting Easy Run: tracked team loads the bases with nobody out and fails to score. Replaces that inning\'s stranded-runners alert.', defaultOn: true, emoji: '🐯' },
  { id: 'mlb.team.stranded_risp', scope: 'team', leagues: ['mlb'], section: 'Team', label: 'Strands runners in scoring position', description: 'Tracked team ends an inning with a runner left on second or third (or the bases loaded).', defaultOn: true, defaultPush: false, emoji: '🏝️' },
  { id: 'mlb.team.position_player_pitching', scope: 'team', leagues: ['mlb'], section: 'Team', label: 'Has a position player pitching', description: 'A position player takes the mound for the tracked team: the white flag of a blowout.', defaultOn: true, defaultPush: false, emoji: '🏳️' },
  { id: 'mlb.team.opponent_risp', scope: 'team', leagues: ['mlb'], section: 'Team', label: 'Opponent has runners in scoring position', description: 'The other team gets a runner to second or third against the tracked team. Once per half-inning; if a run scores on that same play, "Opponent scores" covers it. Off by default: it can be several a game.', defaultOn: false, emoji: '😰' },

  // ── NFL
  { id: 'nfl.qb.interception', scope: 'player', positions: QBS, leagues: ['nfl'], section: 'Offense', label: 'Throws an interception', description: 'Tracked passer is picked off.', defaultOn: true, emoji: '🙅' },
  { id: 'nfl.fumble_lost', scope: 'player', positions: BALL_CARRIERS, leagues: ['nfl'], section: 'Offense', label: 'Loses a fumble', description: 'Tracked player fumbles and the defense recovers.', defaultOn: true, emoji: '🏈' },
  { id: 'nfl.safety', scope: 'team', alsoScope: 'player', positions: OFFENSE, leagues: ['nfl'], section: 'Offense', label: 'Gives up a safety', description: 'Tracked team gives up a safety, or a tracked player is tackled, sacked or flagged in their own end zone for one.', defaultOn: true, emoji: '😵' },
  { id: 'nfl.qb.delay_of_game', scope: 'player', positions: QBS, leagues: ['nfl'], section: 'Offense', label: 'Delay of game', description: "Tracked quarterback's offense is flagged for delay of game (not on punts or field goals).", defaultOn: true, emoji: '⏱️' },
  { id: 'nfl.qb.pulled', scope: 'player', positions: QBS, leagues: ['nfl'], section: 'Offense', label: 'Gets pulled', description: 'Another QB takes over from the tracked starter in the first three quarters (benched or hurt: ESPN doesn\'t say which).', defaultOn: true, emoji: '🪑' },
  { id: 'nfl.qb.sacked', scope: 'player', positions: QBS, leagues: ['nfl'], section: 'Offense', label: 'Gets sacked', description: 'Tracked passer is sacked.', defaultOn: true, defaultPush: false, emoji: '💥' },
  { id: 'nfl.qb.incompletion', scope: 'player', positions: QBS, leagues: ['nfl'], section: 'Offense', label: 'Throws an incompletion', description: 'Tracked passer throws incomplete.', defaultOn: false, emoji: '🗑️' },
  { id: 'nfl.fumble', scope: 'player', positions: BALL_CARRIERS, leagues: ['nfl'], section: 'Offense', label: 'Fumbles (any)', description: 'Tracked player fumbles, even if their team recovers.', defaultOn: false, emoji: '🤲' },
  { id: 'nfl.penalty', scope: 'player', leagues: ['nfl'], section: 'Penalties', label: 'Commits a penalty', description: 'Tracked player is flagged.', defaultOn: true, emoji: '🚩' },
  { id: 'nfl.td_wiped_out', scope: 'team', alsoScope: 'player', leagues: ['nfl'], section: 'Penalties', label: 'Touchdown wiped out by a penalty', description: 'Tracked team has a touchdown called back for its own penalty. For players: the flag was theirs (in place of their penalty alert).', defaultOn: true, emoji: '🚫' },
  { id: 'nfl.kicker.miss', scope: 'player', positions: { only: ['PK'] }, leagues: ['nfl'], section: 'Special teams', label: 'Misses a kick', description: 'Tracked kicker misses or has a field goal / extra point blocked.', defaultOn: true, emoji: '🦵' },
  { id: 'nfl.team.onside_recovered', scope: 'team', leagues: ['nfl'], section: 'Special teams', label: 'Opponent recovers an onside kick', description: 'The other team kicks onside against the tracked team and gets the ball back.', defaultOn: true, emoji: '😱' },
  { id: 'nfl.team.turnover_on_downs', scope: 'team', leagues: ['nfl'], section: 'Team', label: 'Turns it over on downs', description: 'Tracked team goes for it on 4th down and doesn\'t make it.', defaultOn: true, emoji: '🛑' },
  { id: 'nfl.team.red_zone_empty', scope: 'team', leagues: ['nfl'], section: 'Team', label: 'Comes away empty from the red zone', description: 'Tracked team gets inside the 20 and scores nothing: a turnover, on downs, a missed field goal. A line on the turnover\'s alert if you track that player too.', defaultOn: true, emoji: '🫙' },
  { id: 'nfl.team.three_and_out', scope: 'team', leagues: ['nfl'], section: 'Team', label: 'Goes three-and-out', description: 'Tracked team punts after three plays or fewer without a first down.', defaultOn: true, defaultPush: false, emoji: '3️⃣' },
  // College football (teams only): the NFL's alerts as the team's own, so each league's Settings keep theirs. Sections as
  // the NFL's; in each, the ones that push, then feed-only, then off.
  { id: 'cfb.team.interception', scope: 'team', leagues: ['cfb'], section: 'Offense', label: 'Throws an interception', description: 'Tracked team throws an interception (a pick-six says so).', defaultOn: true, emoji: '🎯' },
  { id: 'cfb.team.fumble_lost', scope: 'team', leagues: ['cfb'], section: 'Offense', label: 'Loses a fumble', description: 'Tracked team fumbles and the other side recovers. Counts as "Fumbles (any)" too.', defaultOn: true, emoji: '🏈' },
  { id: 'cfb.team.qb_pulled', scope: 'team', leagues: ['cfb'], section: 'Offense', label: 'Pulls its quarterback', description: 'Another quarterback takes over from the starter in the first three quarters (benched or hurt: ESPN doesn\'t say).', defaultOn: true, emoji: '🪑' },
  { id: 'cfb.team.sacked', scope: 'team', leagues: ['cfb'], section: 'Offense', label: 'Gets sacked', description: 'Tracked team\'s quarterback is sacked.', defaultOn: true, defaultPush: false, emoji: '💥' },
  { id: 'cfb.team.fumble', scope: 'team', leagues: ['cfb'], section: 'Offense', label: 'Fumbles (any)', description: 'Tracked team fumbles, even if it recovers.', defaultOn: false, emoji: '🫳' },
  { id: 'cfb.team.incompletion', scope: 'team', leagues: ['cfb'], section: 'Offense', label: 'Throws an incompletion', description: 'Tracked team throws an incomplete pass.', defaultOn: false, emoji: '🙅' },
  { id: 'cfb.td_wiped_out', scope: 'team', leagues: ['cfb'], section: 'Penalties', label: 'Touchdown wiped out by a penalty', description: 'Tracked team has a touchdown called back for its own penalty.', defaultOn: true, emoji: '🚫' },
  { id: 'cfb.team.ejection', scope: 'team', leagues: ['cfb'], section: 'Penalties', label: 'Has a player ejected', description: 'A player on the tracked team is disqualified (targeting). Counts as a flag too.', defaultOn: true, emoji: '🟥' },
  { id: 'cfb.team.penalty', scope: 'team', leagues: ['cfb'], section: 'Penalties', label: 'Gets flagged', description: 'Tracked team is called for a penalty.', defaultOn: true, defaultPush: false, emoji: '🚩' },
  { id: 'cfb.team.kick_missed', scope: 'team', leagues: ['cfb'], section: 'Special teams', label: 'Misses a field goal', description: 'Tracked team misses a field goal or has one blocked.', defaultOn: true, emoji: '🥅' },
  { id: 'cfb.team.onside_recovered', scope: 'team', leagues: ['cfb'], section: 'Special teams', label: 'Opponent recovers an onside kick', description: 'The other team kicks onside against the tracked team and gets the ball back.', defaultOn: true, emoji: '😱' },
  { id: 'cfb.team.turnover_on_downs', scope: 'team', leagues: ['cfb'], section: 'Team', label: 'Turns it over on downs', description: 'Tracked team goes for it on 4th down and doesn\'t make it.', defaultOn: true, emoji: '🛑' },
  { id: 'cfb.team.red_zone_empty', scope: 'team', leagues: ['cfb'], section: 'Team', label: 'Comes away empty from the red zone', description: 'Tracked team gets inside the 20 and scores nothing: a turnover, on downs, a missed field goal.', defaultOn: true, emoji: '🫙' },
  { id: 'cfb.safety', scope: 'team', leagues: ['cfb'], section: 'Team', label: 'Gives up a safety', description: 'Tracked team gives up a safety.', defaultOn: true, emoji: '😵' },
  { id: 'cfb.upset_loss', scope: 'team', leagues: ['cfb'], section: 'Team', label: 'Loses to an unranked team', description: 'A top-25 team you track loses to an unranked one: a line on its loss (the ranking going in).', defaultOn: true, emoji: '😱' },
  { id: 'cfb.team.three_and_out', scope: 'team', leagues: ['cfb'], section: 'Team', label: 'Goes three-and-out', description: 'Tracked team punts after three plays or fewer without a first down.', defaultOn: true, defaultPush: false, emoji: '3️⃣' },
  { id: 'cfb.poll_drop', scope: 'team', leagues: ['cfb'], section: 'AP poll', label: 'Falls in the AP poll', description: 'Tracked team drops in the AP Top 25 when the new poll comes out.', defaultOn: true, emoji: '📉' },
  { id: 'cfb.poll_out', scope: 'team', leagues: ['cfb'], section: 'AP poll', label: 'Drops out of the AP Top 25', description: 'Tracked team falls out of the AP Top 25 when the new poll comes out.', defaultOn: true, emoji: '🚪' },

  // ── NBA (the WNBA gets a copy of each)
  { id: 'nba.got_blocked', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Gets blocked', description: 'Tracked player has a shot blocked.', defaultOn: true, emoji: '✋' },
  { id: 'nba.missed_free_throw', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Misses a free throw', description: 'Tracked player bricks a free throw.', defaultOn: true, defaultPush: false, emoji: '😬' },
  { id: 'nba.turnover', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Turns it over', description: 'Tracked player commits a turnover.', defaultOn: true, defaultPush: false, emoji: '🔄' },
  { id: 'nba.brick_night', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Has a brick night', description: 'Tracked player shoots 30% or worse on 12+ shots, or 0-for-6 or worse from three. At the final: a line on their team\'s loss, or its own alert (feed only) after a win.', defaultOn: true, defaultPush: false, emoji: '🧱' },
  { id: 'nba.scoreless_half', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Scoreless at the half', description: 'Tracked player has played 10+ minutes of the first half without a point.', defaultOn: true, defaultPush: false, emoji: '🥶' },
  { id: 'nba.missed_shot', scope: 'player', leagues: ['nba'], section: 'Offense', label: 'Misses a shot', description: 'Tracked player misses a field goal attempt. Off by default: it can be ten a game.', defaultOn: false, emoji: '🧱' },
  { id: 'nba.technical', scope: 'player', leagues: ['nba'], section: 'Fouls', label: 'Technical foul / ejection', description: 'Tracked player gets a technical or is ejected.', defaultOn: true, emoji: '🤬' },
  { id: 'nba.fouled_out', scope: 'player', leagues: ['nba'], section: 'Fouls', label: 'Fouls out', description: 'Tracked player\'s 6th personal foul, in place of that foul\'s alert.', defaultOn: true, emoji: '🚷' },
  { id: 'nba.foul', scope: 'player', leagues: ['nba'], section: 'Fouls', label: 'Commits a foul', description: 'Tracked player is called for a personal / shooting / offensive foul.', defaultOn: false, emoji: '😤' },
  { id: 'nba.team.star_went_off', scope: 'team', leagues: ['nba'], section: 'Team', label: 'Opponent\'s star goes off', description: 'The winner\'s top scorer puts up 40+ (WNBA: 30+) in a loss: a line on the loss alert.', defaultOn: true, emoji: '🔥' },
  { id: 'nba.team.opponent_run', scope: 'team', leagues: ['nba'], section: 'Team', label: 'Opponent goes on a run', description: 'The other team scores 14 straight (WNBA: 12). A line on that play\'s alert when there is one.', defaultOn: true, defaultPush: false, emoji: '🏃' },

  // ── NHL
  { id: 'nhl.shootout_miss', scope: 'player', positions: SKATERS, leagues: ['nhl'], section: 'Offense', label: 'Misses in the shootout', description: 'Tracked skater misses or is stopped in a shootout, in place of that shot\'s alert.', defaultOn: true, emoji: '🥶' },
  { id: 'nhl.shot_missed', scope: 'player', positions: SKATERS, leagues: ['nhl'], section: 'Offense', label: 'Shoots and misses', description: 'Tracked skater misses the net.', defaultOn: true, defaultPush: false, emoji: '🎯' },
  { id: 'nhl.minus', scope: 'player', positions: SKATERS, leagues: ['nhl'], section: 'Offense', label: 'Finishes -3 or worse', description: 'Tracked skater ends the game -3 or worse. At the final: a line on their team\'s loss, or its own alert (feed only) after a win.', defaultOn: true, defaultPush: false, emoji: '➖' },
  { id: 'nhl.shot_blocked', scope: 'player', positions: SKATERS, leagues: ['nhl'], section: 'Offense', label: 'Gets a shot blocked', description: 'Tracked skater has a shot blocked.', defaultOn: false, emoji: '🧱' },
  { id: 'nhl.shot_saved', scope: 'player', positions: SKATERS, leagues: ['nhl'], section: 'Offense', label: 'Shot gets saved', description: 'Tracked skater is stopped by the goalie.', defaultOn: false, emoji: '🧤' },
  { id: 'nhl.giveaway', scope: 'player', leagues: ['nhl'], section: 'Offense', label: 'Gives the puck away', description: 'Tracked player is charged with a giveaway.', defaultOn: false, emoji: '🎁' },
  { id: 'nhl.penalty', scope: 'player', leagues: ['nhl'], section: 'Penalties', label: 'Takes a penalty', description: 'Tracked player goes to the box.', defaultOn: true, emoji: '⛓️' },
  { id: 'nhl.fight', scope: 'player', leagues: ['nhl'], section: 'Penalties', label: 'Drops the gloves', description: 'Tracked player gets a fighting major, in place of that penalty\'s alert.', defaultOn: true, emoji: '🥊' },
  { id: 'nhl.goalie.goal_allowed', scope: 'player', positions: GOALIES, leagues: ['nhl'], section: 'Goaltending', label: 'Goalie allows a goal', description: 'Tracked goalie is in net when the opponent scores.', defaultOn: true, emoji: '🥅' },
  { id: 'nhl.goalie.pulled', scope: 'player', positions: GOALIES, leagues: ['nhl'], section: 'Goaltending', label: 'Gets pulled', description: 'Tracked goalie is replaced during regulation (not for an extra attacker).', defaultOn: true, emoji: '🪝' },
  { id: 'nhl.team.power_play_fail', scope: 'team', leagues: ['nhl'], section: 'Team', label: 'Power play goes 0-for-4+', description: 'Tracked team loses with no goal on 4 or more power plays: a line on the loss alert.', defaultOn: true, emoji: '🔌' },
  { id: 'nhl.team.empty_net_goal', scope: 'team', leagues: ['nhl'], section: 'Team', label: 'Gives up an empty-netter', description: 'The other team scores into the tracked team\'s empty net. In place of that goal\'s "Opponent scores".', defaultOn: true, defaultPush: false, emoji: '🥅' },
  { id: 'nhl.team.shorthanded_goal', scope: 'team', leagues: ['nhl'], section: 'Team', label: 'Gives up a short-handed goal', description: 'The other team scores while a man down, on the tracked team\'s power play. In place of that goal\'s "Opponent scores".', defaultOn: true, defaultPush: false, emoji: '🙃' },

  // ── Soccer: every soccer league's own copy (SOCCER_ALERTS)
  ...soccerAlerts(),

  // ── F1 (one finish alert per driver per session: the facts that apply are merged)
  { id: 'f1.driver.dnf', scope: 'player', leagues: ['f1'], section: 'Race', label: "Doesn't finish", description: 'Tracked driver retires, is disqualified, or doesn\'t start a race or sprint. Sent live.', defaultOn: true, emoji: '🛑' },
  { id: 'f1.driver.out_of_points', scope: 'player', leagues: ['f1'], section: 'Race', label: 'Finishes outside the points', description: 'Tracked driver finishes outside the top 10 (top 8 in a sprint).', defaultOn: true, emoji: '0️⃣' },
  { id: 'f1.driver.lost_places', scope: 'player', leagues: ['f1'], section: 'Race', label: 'Loses places from the grid', description: 'Tracked driver finishes 3 or more places lower than they started.', defaultOn: true, emoji: '🔻' },
  { id: 'f1.driver.beaten_by_teammate', scope: 'player', leagues: ['f1'], section: 'Race', label: 'Finishes behind teammate', description: 'Tracked driver is beaten by the other car in the same team.', defaultOn: true, emoji: '🥈' },
  { id: 'f1.driver.lapped', scope: 'player', leagues: ['f1'], section: 'Race', label: 'Gets lapped', description: 'Tracked driver finishes a lap or more down on the winner: part of their finish alert.', defaultOn: true, emoji: '🐌' },
  { id: 'f1.driver.session_start', scope: 'player', leagues: ['f1'], section: 'Race', label: 'Race starts', description: 'Hate Watch Starting: a race or sprint the tracked driver is in gets underway. One alert for all of yours in it.', defaultOn: true, emoji: '🍿' },
  { id: 'f1.driver.back_of_grid', scope: 'player', leagues: ['f1'], section: 'Race', label: 'Starts from the back', description: 'Tracked driver lines up on the last row of the grid for a race or sprint.', defaultOn: true, emoji: '🔙' },
  { id: 'f1.driver.quali_knockout', scope: 'player', leagues: ['f1'], section: 'Qualifying', label: 'Knocked out in qualifying', description: 'Tracked driver fails to reach Q3 (knocked out in Q1 or Q2).', defaultOn: true, emoji: '🚫' },
  { id: 'f1.driver.outqualified', scope: 'player', leagues: ['f1'], section: 'Qualifying', label: 'Out-qualified by teammate', description: 'Tracked driver qualifies behind the other car in the team: part of their qualifying alert.', defaultOn: true, emoji: '🥈' },
  { id: 'f1.driver.standings_drop', scope: 'player', leagues: ['f1'], section: 'Championship', label: "Drops in the drivers' championship", description: "Tracked driver slides down the drivers' standings.", defaultOn: true, defaultPush: false, emoji: '📊' },
  { id: 'f1.team.double_dnf', scope: 'team', leagues: ['f1'], section: 'Team', label: 'Double DNF', description: 'Both of the tracked team\'s cars fail to finish. Sent live. Also covers "Scores no points".', defaultOn: true, emoji: '☠️' },
  { id: 'f1.team.no_points', scope: 'team', leagues: ['f1'], section: 'Team', label: 'Scores no points', description: 'Neither of the tracked team\'s cars finishes in the points.', defaultOn: true, emoji: '🕳️' },

  // ── UFC (fighters only: no teams). A loss's facts are lines on the loss, each with its switch (ufc.ts)
  { id: 'ufc.lost', scope: 'player', leagues: ['ufc'], section: 'Fight', label: 'Loses a fight', description: 'Tracked fighter loses: a Successful Hate Watch, saying how (knocked out, tapped out, the judges\' scorecards).', defaultOn: true, emoji: '🥊' },
  { id: 'ufc.knocked_down', scope: 'player', leagues: ['ufc'], section: 'Fight', label: 'Gets knocked down', description: 'Tracked fighter is knocked down, sent live. When the fight ends on it, it\'s a line on the loss instead.', defaultOn: true, emoji: '💫' },
  { id: 'ufc.fight_start', scope: 'player', leagues: ['ufc'], section: 'Fight', label: 'Fight starts', description: 'Hate Watch Starting: the tracked fighter\'s fight gets underway.', defaultOn: true, emoji: '🍿' },
  { id: 'ufc.lost_title', scope: 'player', leagues: ['ufc'], section: 'Fight', label: 'Loses a title fight', description: 'A line on the loss: it was for a belt, theirs to lose ("lost the Lightweight title") or one they were after.', defaultOn: true, emoji: '👑' },
  { id: 'ufc.lost_as_favorite', scope: 'player', leagues: ['ufc'], section: 'Fight', label: 'Loses as the favorite', description: 'A line on the loss: they were the betting favorite (60% or more).', defaultOn: true, emoji: '💸' },
  { id: 'ufc.losing_streak', scope: 'player', leagues: ['ufc'], section: 'Fight', label: 'Losing streak', description: 'A line on the loss: two or more losses in a row.', defaultOn: true, emoji: '📉' },

  // ── Every player
  { id: 'player.team_lost', scope: 'player', leagues: ['nba', 'mlb', 'nfl', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Their team loses', description: "A tracked player's team loses a game: a Successful Hate Watch, counted for their team. If you also track the team (or another of its players), that loss is one alert, not two.", defaultOn: true, emoji: '🪦' },
  { id: 'player.ejected', scope: 'player', leagues: ['nfl', 'nhl'], section: 'Game', label: 'Gets ejected', description: 'Thrown out of the game: an NFL disqualification, an NHL game misconduct or match penalty. It counts as their penalty alert too, so it\'s one alert. (NBA ejections are under Technical foul / ejection, soccer\'s under Sent off; ESPN doesn\'t report MLB ejections.)', defaultOn: true, emoji: '🚪' },
  { id: 'player.injured', scope: 'player', leagues: ['nba', 'mlb', 'nfl', 'nhl'], section: 'Injuries & news', label: 'Gets injured', description: 'Tracked player appears on the injury report or their status worsens.', defaultOn: true, emoji: '🤕' },
  // id kept from when this was caught-stealing only, so existing users' on/off choice carries over.
  { id: 'off_field', scope: 'player', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES, 'ufc'], section: 'Injuries & news', label: 'Off-field trouble', description: 'A tracked player is in legal or off-field trouble: an arrest, charges, a lawsuit, allegations or an investigation (from ESPN\'s news).', defaultOn: true, emoji: '🚨' },
  { id: 'fine_suspension', scope: 'player', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES, 'ufc'], section: 'Injuries & news', label: 'Fined or suspended', description: 'A tracked player is fined, suspended or banned (from ESPN\'s news). A suspension for off-field trouble counts as both.', defaultOn: true, emoji: '🚫' },

  // ── Every team
  { id: 'team.lost', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Loses a game', description: 'Final whistle and your tracked team lost. How they lost (the alerts below that you have on) comes on it as lines: one alert.', defaultOn: true, emoji: '🪦' },
  // A loss's facts (lossFacts): each a line on the loss alert, or the alert itself with "Loses a game" off.
  { id: 'team.last_second_loss', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Loses at the last second', description: 'A walk-off (MLB), the winner going ahead with 10 seconds left (NBA) or 30 (NFL), overtime or a shootout (NHL, NFL OT), a stoppage-time winner (soccer). A line on the loss alert.', defaultOn: true, emoji: '⏱️' },
  { id: 'team.blew_lead', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Blows a big lead', description: 'Live: they fall behind after leading by 5 runs (MLB), 18 points (NBA; WNBA 15), 17 (NFL), 3 goals (NHL) or 2 (soccer), once a game, instead of that play\'s "Falls behind". At the final: a line on the loss if they ever led by 3 runs, 15 points (WNBA 12), 14 (NFL), 2 goals.', defaultOn: true, emoji: '🫠' },
  { id: 'team.lost_as_favorite', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Loses as the favorite', description: 'They lose as big favorites by the betting line: 62% or more (MLB), 65% (NHL), 75% (NBA, WNBA, NFL), 60% (soccer). A line on the loss alert.', defaultOn: true, emoji: '🎰' },
  { id: 'team.shut_out', scope: 'team', leagues: ['mlb', 'nfl', 'cfb', 'nhl'], section: 'Game', label: 'Gets shut out', description: 'They lose without scoring. A line on the loss alert.', defaultOn: true, emoji: '🥚' },
  { id: 'team.swept', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], section: 'Game', label: 'Gets swept', description: 'They lose every game of a series (MLB, 3 games or more) or every meeting of the season with a team (3 or more; NFL division rivals, 2). Regular season: a playoff sweep is in the elimination alert. A line on the loss alert.', defaultOn: true, emoji: '🧹' },
  { id: 'team.lost_to_worse', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl'], section: 'Game', label: 'Loses to a worse team', description: 'They lose to a team with a much worse record (.150 lower in MLB and the NHL, .200 in the NBA, WNBA and NFL), a few weeks into the season. A line on the loss alert.', defaultOn: true, emoji: '🤡' },
  { id: 'team.below_500', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl'], section: 'Game', label: 'Falls below .500', description: 'A loss drops them under .500, a few weeks into the season. A line on the loss alert.', defaultOn: true, emoji: '⚖️' },
  { id: 'team.game_start', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Game', label: 'Game starts', description: 'Hate Watch Starting: the tracked team\'s game gets underway (F1: a race or sprint).', defaultOn: true, emoji: '🍿' },
  { id: 'team.fell_behind', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Falls behind', description: "Tracked team goes from tied/leading to trailing. Replaces that play's \"Opponent scores\" alert, so you get one alert, not two.", defaultOn: true, defaultPush: false, emoji: '⬇️' },
  { id: 'team.opponent_scored', scope: 'team', leagues: ['mlb', 'nfl', 'cfb', 'nhl', ...SOCCER_LEAGUES], section: 'Game', label: 'Opponent scores', description: 'The other team puts points on the board (a goal, in soccer).', defaultOn: true, defaultPush: false, emoji: '📉' },
  { id: 'team.eliminated', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl'], section: 'Season', label: 'Eliminated from playoffs', description: 'Tracked team is mathematically eliminated from playoff contention, or knocked out of the playoffs. A knockout comes in that game\'s Successful Hate Watch, one alert (a sweep says so), and so does a regular-season elimination right after a loss.', defaultOn: true, emoji: '⚰️' },
  { id: 'team.losing_streak', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl'], section: 'Season', label: 'Losing streak', description: 'Tracked team extends a losing streak to 3 or more: a line on that loss\'s alert, said once.', defaultOn: true, defaultPush: false, emoji: '🧊' },
  { id: 'team.rival_clinched', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], section: 'Season', label: 'Rival clinches the division', description: 'A team in their division clinches it. With other standings news for them at the same time, one alert.', defaultOn: true, defaultPush: false, emoji: '👑' },
  { id: 'team.standings_drop', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Season', label: 'Drops in standings', description: "Tracked team slides down the conference/league standings (F1: the constructors' championship; EPL: the table). After a loss (F1: a race), a line on that alert.", defaultOn: true, defaultPush: false, emoji: '📊' },
  { id: 'team.off_field', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Injuries & news', label: 'Off-field trouble', description: 'A tracked team, or one of its players, is in legal or off-field trouble: an arrest, charges, a lawsuit, allegations or an investigation (from ESPN\'s news).', defaultOn: true, emoji: '🚨' },
  { id: 'team.fine_suspension', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Injuries & news', label: 'Fined or suspended', description: 'A tracked team, or one of its players, is fined, suspended or banned (from ESPN\'s news). A suspension for off-field trouble counts as both.', defaultOn: true, emoji: '🚫' },
  { id: 'team.player_injured', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], section: 'Injuries & news', label: 'A player gets injured', description: 'Anyone on the tracked team lands on the injury report.', defaultOn: true, defaultPush: false, emoji: '🚑' },

  // ── Your Hate Watch (about you, not one team: the app lists them in Settings only)
  { id: 'team.hate_watch_streak', scope: 'team', alsoScope: 'player', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl', ...SOCCER_LEAGUES], section: 'Your Hate Watch', label: 'Your Hate Watch streak', description: 'On a loss, how many in a row you\'ve watched, from 3: "Lost 5 straight, every one on your Hate Watch." A line on the loss alert.', defaultOn: true, emoji: '🔥' },
  { id: 'app.weekly_recap', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'cfb', 'nhl', 'f1', ...SOCCER_LEAGUES], section: 'Your Hate Watch', label: 'Weekly misery recap', description: 'Monday at 9 am: last week\'s Successful Hate Watches by team, how many alerts you got, and the low point. In your quiet hours\' time zone (US Eastern until you turn them on).', defaultOn: true, emoji: '🗓️' },
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
