# Hate Watch patch notes

One section per TestFlight build: what changed since the build before it, server updates included.
Each section's text is pasted into TestFlight's "What to Test" as it is, so it stays under 4,000
characters and uses no emoji. New changes go under "Next build" as they ship; when a build goes to
TestFlight, that heading becomes its build number and a new "Next build" starts above it.

## Next build (changes since build 12)

Changes since build 12. Server updates already work on every build.

## Build 12 (October 9, 2026)

Changes since build 11. Server updates already work on every build.

SCORES
- All games: a switch at the top of Scores shows every game live now or in the next 24 hours, tracked or not.
- Upcoming games show a preview: each team's chance to win, records, probable pitchers and goalies, the line and the playoff series.
- Tap a team's logo or name on a game card or a game's screen to open its page.
- Box scores: a game's screen has Box score and Highlights tabs. The box score shows each team's players, live, opening on the team you track: yours highlighted, the ugly numbers in red, a name opens that player.
- Highlights, in place of the play-by-play: ESPN's video clips, playing right in the app, and the key plays (scores, lead changes, turnovers, cards, ejections, the plays that sent you alerts).
- Clips on alerts: when ESPN posts a clip of the play, minutes later, it shows on that alert, ready to play, with no second notification. A loss alert gets the winning play's clip. MLB, NBA, WNBA and NHL.

PLAYER AND TEAM PAGES
- Stats and Recent misery tabs: pages open on stats (season line, last five games, next game). Recent misery lists every alert about them from the last 24 hours.
- A player's alert settings: Show their team's games (on) and Get their team's alerts (off).
- Search opens on Teams (no Everything filter) and its box says what it searches ("Search F1 drivers"). Teams come before Players in every filter.

ONE ALERT AT A TIME
- A team's alert and its players' alerts on one play are one alert: "Gerrit Cole gave up a solo homer", with "Rays took the lead." in it. (Server)
- A fact that comes a moment later (the inning ending on that strikeout, how the drive ended) is added to the alert you already have, with no second notification. (Server) This build updates the alert on screen right away; older builds show it after a refresh.

HOW THEY LOST (Server)
- Lines on the loss alert, each with its own switch under Team alerts: a walk-off or last-second loss, blowing a big lead, losing as the favorite, a shutout, a sweep, losing to a much worse team, falling below .500, the losing streak, being no-hit, the other team's star going off (NBA 40 points, WNBA 30), a dead power play (NHL 0-for-4). With "Loses a game" off, the first one you have on is the alert.
- Blows a big lead, live, in place of "Falls behind". Gets ejected. Rival clinches the division.
- Your Hate Watch streak on a loss, and a weekly misery recap, Mondays at 9 am.

NEW ALERTS (Server)
- MLB: strikes out 3 or 4 times, hands over a run (wild pitch, balk, passed ball, bases-loaded walk), back-to-back homers allowed, thrown out on the bases, a starter chased in under 3 innings, no-hit through 6, 0-for-4 or worse, a position player pitching. Crew chief reviews count as lost challenges, and an overturned home run says so. Runners in scoring position adds "Bases loaded now" when the bases load.
- NFL: the starting QB pulled, a touchdown wiped out by a penalty, a three-and-out, turned over on downs, empty from the red zone.
- NBA and WNBA: fouls out, scoreless at the half, a brick night, an opponent's 14-0 run (WNBA 12-0).
- NHL: goalie pulled, a shootout miss, a fight, giving up an empty-netter or a short-handed goal, finishing -3 or worse.
- Premier League: a late goal against (from the 85th minute), a goal ruled out by VAR, hitting the woodwork, taken off by halftime, dropping into the relegation zone.
- F1: lapped, starting from the back of the grid, out-qualified by a teammate.
- Some start in your feed only, with no notification: each alert's bell in Settings changes that.

FIXES
- ABS challenge alerts wait until the review is over, so a won challenge no longer sends "lost an ABS challenge". (Server)
- A called third strike or ball four whose challenge was upheld is labeled an ABS challenge, not a replay challenge. (Server)
- A team's or player's alert settings no longer list the streak and recap switches, and a team's Recent misery leaves out the recap.

## Build 11 (October 7, 2026)

Changes since build 10. Server updates already work on every build.

FEWER NOTIFICATIONS BY DEFAULT
- New installs start with quieter alerts: results and big failures notify you, the play-by-play goes to your feed, and the noisiest alerts start off. About 88% fewer notifications. Existing installs keep their settings. (Server)
- "Reset alerts to defaults" also resets each alert's notify-or-feed bell.

NEW AND BETTER ALERTS
- Blowout losses say so: "Bears got BLOWN OUT by the Eagles." About 1 in 8 losses: MLB 7+ runs, NFL 21+, NBA 25+, WNBA 20+, NHL 4+ goals, soccer 3+. (Server)
- MLB: new "Goes down in order" when your team goes 1-2-3, and "Struck out in order" when all three strike out. Feed only. (Server)
- MLB outs say what kind: grounded out, flied out, fielder's choice. Double and triple plays say so (triple plays are new). A runner thrown out on a hit isn't the batter's out. (Server)
- MLB stranded runners include the runner on first: "Brewers stranded runners on first and second." (Server)

SETTINGS
- Alerts are grouped under headings: offense, defense, pitching or goaltending, then the team's, with the alerts that notify you first. No more explanation text under each alert.
- A player's alert settings fit their position: no hitting alerts for pitchers or pitching alerts for hitters (two-way players get both), passing alerts for QBs, goals against for goalies.

TEAM PAGES AND SEARCH
- Filter a team's roster by position: Starters, Relievers, Catchers, Infield, Outfield and DH for MLB, and position groups in every other league.
- Sort Search's team list A-Z or by division: AL East, AFC South and so on.

RELIABILITY
- The app recovers from a bad connection at launch: no more empty filters or Settings after opening with no signal. A search that fails says so.

## Build 10 (October 7, 2026)

Changes since build 9. Server updates already work on every build.

NEW LEAGUE
- The Premier League: track clubs and players, live alerts from every match, table drops (and the relegation zone), and EPL games on the Scores tab.

NEW AND BETTER ALERTS
- Playoff eliminations: a playoff knockout now sends the alert inside that game's Successful Hate Watch, and sweeps say so. (Server)
- "Their team loses" for tracked players: a Successful Hate Watch named for them when their team loses, counted for the team. One alert per loss. Every league but F1. (Server)
- More soccer alerts: commits a foul, gives away a penalty, loses the ball, gives the ball away, and teams losing by 3+ goals. (Server)

SCORES AND STATS
- "Up next" on the Scores tab: each tracked team's next game, with the channel and the kind of game. It fills the screen on days with no games.
- Stats pages: a Stats button on every player and team page (not F1) with season and career lines, the last five games and the next game. The bad numbers are in red.

SETTINGS AND PAGES
- Alert groups in Settings fold up and show how many alerts are on. Reset turns every league back on.
- A player or team page's "Recent misery" shows the last 24 hours, folded to the latest alert.

LEADERBOARD
- Each filter ranks its own top 100, with a footer for the rest, and ties no longer leave gaps (1, T-2, T-2, 3).
