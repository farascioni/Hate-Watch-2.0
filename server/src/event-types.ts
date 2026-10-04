import type { League } from './leagues.ts';

export interface EventTypeDef {
  id: string;
  scope: 'player' | 'team';
  leagues: League[];
  label: string;
  description: string;
  defaultOn: boolean;
  emoji: string;
}

// The single source of truth for every notification Hate Watch can send.
// The app renders its Settings screen from this list (GET /catalog/event-types).
export const EVENT_TYPES: EventTypeDef[] = [
  // ── MLB players
  { id: 'mlb.batter.strikeout', scope: 'player', leagues: ['mlb'], label: 'Strikes out', description: 'Tracked hitter strikes out (swinging or looking).', defaultOn: true, emoji: '🌀' },
  { id: 'mlb.batter.double_play', scope: 'player', leagues: ['mlb'], label: 'Grounds into a double play', description: 'Tracked hitter hits into a double play.', defaultOn: true, emoji: '✌️' },
  { id: 'mlb.batter.popout', scope: 'player', leagues: ['mlb'], label: 'Makes an out', description: 'Any other out by a tracked hitter (fly, ground, line, pop out).', defaultOn: false, emoji: '🙄' },
  { id: 'mlb.pitcher.runs_allowed', scope: 'player', leagues: ['mlb'], label: 'Gives up runs', description: 'Tracked pitcher allows a run to score.', defaultOn: true, emoji: '🩸' },
  { id: 'mlb.pitcher.home_run_allowed', scope: 'player', leagues: ['mlb'], label: 'Gives up a home run', description: 'Tracked pitcher serves up a homer.', defaultOn: true, emoji: '💣' },
  { id: 'mlb.pitcher.walk', scope: 'player', leagues: ['mlb'], label: 'Issues a walk / HBP', description: 'Tracked pitcher walks or hits a batter.', defaultOn: false, emoji: '🚶' },
  { id: 'mlb.runner.caught_stealing', scope: 'player', leagues: ['mlb'], label: 'Gets caught stealing', description: 'Tracked player is thrown out trying to steal a base.', defaultOn: true, emoji: '🚔' },
  { id: 'mlb.fielder.error', scope: 'player', leagues: ['mlb'], label: 'Commits an error', description: 'Tracked player is charged with a fielding error.', defaultOn: true, emoji: '🧤' },

  // ── NFL players
  { id: 'nfl.qb.interception', scope: 'player', leagues: ['nfl'], label: 'Throws an interception', description: 'Tracked passer is picked off.', defaultOn: true, emoji: '🙅' },
  { id: 'nfl.qb.sacked', scope: 'player', leagues: ['nfl'], label: 'Gets sacked', description: 'Tracked passer is sacked.', defaultOn: true, emoji: '💥' },
  { id: 'nfl.qb.incompletion', scope: 'player', leagues: ['nfl'], label: 'Throws an incompletion', description: 'Tracked passer throws incomplete.', defaultOn: false, emoji: '🗑️' },
  { id: 'nfl.fumble_lost', scope: 'player', leagues: ['nfl'], label: 'Loses a fumble', description: 'Tracked player fumbles and the defense recovers.', defaultOn: true, emoji: '🏈' },
  { id: 'nfl.fumble', scope: 'player', leagues: ['nfl'], label: 'Fumbles (any)', description: 'Tracked player fumbles, even if their team recovers.', defaultOn: false, emoji: '🤲' },
  { id: 'nfl.kicker.miss', scope: 'player', leagues: ['nfl'], label: 'Misses a kick', description: 'Tracked kicker misses or has a field goal / extra point blocked.', defaultOn: true, emoji: '🦵' },
  { id: 'nfl.penalty', scope: 'player', leagues: ['nfl'], label: 'Commits a penalty', description: 'Tracked player is flagged.', defaultOn: true, emoji: '🚩' },

  // ── NBA players
  { id: 'nba.missed_shot', scope: 'player', leagues: ['nba'], label: 'Misses a shot', description: 'Tracked player misses a field goal attempt.', defaultOn: true, emoji: '🧱' },
  { id: 'nba.missed_free_throw', scope: 'player', leagues: ['nba'], label: 'Misses a free throw', description: 'Tracked player bricks a free throw.', defaultOn: true, emoji: '😬' },
  { id: 'nba.got_blocked', scope: 'player', leagues: ['nba'], label: 'Gets blocked', description: 'Tracked player has a shot blocked.', defaultOn: true, emoji: '✋' },
  { id: 'nba.turnover', scope: 'player', leagues: ['nba'], label: 'Turns it over', description: 'Tracked player commits a turnover.', defaultOn: true, emoji: '🔄' },
  { id: 'nba.foul', scope: 'player', leagues: ['nba'], label: 'Commits a foul', description: 'Tracked player is called for a personal / shooting / offensive foul.', defaultOn: false, emoji: '😤' },
  { id: 'nba.technical', scope: 'player', leagues: ['nba'], label: 'Technical foul / ejection', description: 'Tracked player gets a technical or is ejected.', defaultOn: true, emoji: '🤬' },

  // ── NHL players
  { id: 'nhl.goalie.goal_allowed', scope: 'player', leagues: ['nhl'], label: 'Goalie allows a goal', description: 'Tracked goalie is in net when the opponent scores.', defaultOn: true, emoji: '🥅' },
  { id: 'nhl.shot_missed', scope: 'player', leagues: ['nhl'], label: 'Shoots and misses', description: 'Tracked skater misses the net.', defaultOn: true, emoji: '🎯' },
  { id: 'nhl.shot_blocked', scope: 'player', leagues: ['nhl'], label: 'Gets a shot blocked', description: 'Tracked skater has a shot blocked.', defaultOn: false, emoji: '🧱' },
  { id: 'nhl.shot_saved', scope: 'player', leagues: ['nhl'], label: 'Shot gets saved', description: 'Tracked skater is stopped by the goalie.', defaultOn: false, emoji: '🧤' },
  { id: 'nhl.giveaway', scope: 'player', leagues: ['nhl'], label: 'Gives the puck away', description: 'Tracked player is charged with a giveaway.', defaultOn: false, emoji: '🎁' },
  { id: 'nhl.penalty', scope: 'player', leagues: ['nhl'], label: 'Takes a penalty', description: 'Tracked player goes to the box.', defaultOn: true, emoji: '⛓️' },

  // ── Any player
  { id: 'player.injured', scope: 'player', leagues: ['nba', 'mlb', 'nfl', 'nhl'], label: 'Gets injured', description: 'Tracked player appears on the injury report or their status worsens.', defaultOn: true, emoji: '🤕' },

  // ── Teams
  { id: 'team.lost', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], label: 'Loses a game', description: 'Final whistle and your tracked team lost.', defaultOn: true, emoji: '🪦' },
  { id: 'mlb.team.stranded_risp', scope: 'team', leagues: ['mlb'], label: 'Strands runners in scoring position', description: 'Tracked team ends an inning with a runner left on second or third (or the bases loaded).', defaultOn: true, emoji: '🏝️' },
  { id: 'team.opponent_scored', scope: 'team', leagues: ['mlb', 'nfl', 'nhl'], label: 'Opponent scores', description: 'The other team puts points on the board.', defaultOn: true, emoji: '📉' },
  { id: 'team.fell_behind', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], label: 'Falls behind', description: 'Tracked team goes from tied/leading to trailing.', defaultOn: true, emoji: '⬇️' },
  { id: 'team.standings_drop', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], label: 'Drops in standings', description: 'Tracked team slides down the conference/league standings.', defaultOn: true, emoji: '📊' },
  { id: 'team.losing_streak', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], label: 'Losing streak', description: 'Tracked team extends a losing streak to 3 or more.', defaultOn: true, emoji: '🧊' },
  { id: 'team.eliminated', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], label: 'Eliminated from playoffs', description: 'Tracked team is mathematically eliminated from playoff contention.', defaultOn: true, emoji: '⚰️' },
  { id: 'team.player_injured', scope: 'team', leagues: ['nba', 'mlb', 'nfl', 'nhl'], label: 'A player gets injured', description: 'Anyone on the tracked team lands on the injury report.', defaultOn: true, emoji: '🚑' },
];

export const EVENT_TYPE_BY_ID = new Map(EVENT_TYPES.map((t) => [t.id, t]));
