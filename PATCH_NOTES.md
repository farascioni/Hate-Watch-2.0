# Hate Watch patch notes

One section per TestFlight build: what changed since the build before it, server updates included.
Each section's text is pasted into TestFlight's "What to Test" as it is, so it stays under 4,000
characters and uses no emoji. New changes go under "Next build" as they ship; when a build goes to
TestFlight, that heading becomes its build number and a new "Next build" starts above it.

## Next build (changes since build 11)

Changes since build 11. Server updates already work on every build.

SCORES
- All games: a new switch at the top of the Scores tab shows every game live right now, then every game starting in the next 24 hours, whether you track a team in it or not, grouped by league. The league chips filter it, and the switch shows how many games are live. Tap any game to open it.
- Upcoming games show a preview: each team's chance to win (from the betting line), its record, MLB probable pitchers with their record and ERA, NHL probable goalies, the line and over/under, soccer form and draw chance, and the playoff series. A team you track shows its chance to lose.
- Tap a team's logo or name on a game card, or at the top of a game's screen, to open that team's page, the same one Search opens. Tapping anywhere else on the card still opens the game.

PLAYER AND TEAM PAGES
- Stats and Recent misery tabs: a player's or team's page opens on their stats (the season line, last five games and next game) right on the page, no separate Stats button. Recent misery lists every alert about them from the last 24 hours, not just the latest. F1 drivers and teams show Recent misery only, as they have no stats yet.

PLAYER ALERT SETTINGS
- Their team: a player's alert settings have two new switches. Show their team's games (on by default) decides whether the team's games appear on the Scores tab, and Get their team's alerts (off by default) sends the team's own alerts too, as if you tracked the team.

NEW ALERTS, STILL ONE ALERT AT A TIME
- How they lost comes on the loss alert, as lines: a walk-off or last-second loss (a buzzer-beater, overtime or a shootout, a stoppage-time winner), blowing a big lead, losing as the betting favorite, a shutout, a sweep, losing to a much worse team, falling below .500, the losing streak. Each has its own switch under Team alerts. With "Loses a game" off, the first one you have on is the alert (if you'd turned it off before, these start off too). (Server)
- Blows a big lead: live, when a team falls behind after leading big (NBA 18 points, MLB 5 runs, NFL 17, NHL 3 goals), in place of that play's "Falls behind". Once a game. (Server)
- Rival clinches the division (feed only to start). Standings news that lands together (eliminated, a rival clinching, a drop, a streak) is one alert. (Server)
- Gets ejected: an NFL disqualification or an NHL game misconduct, in place of that penalty alert. (Server)
- Your Hate Watch streak: on a loss, how many in a row you've watched ("Lost 5 straight, every one on your Hate Watch"). (Server)
- Weekly misery recap, Mondays at 9 am: last week's Successful Hate Watches by team, how many alerts, and the low point. (Server)
- A team's or player's own alert settings no longer list the streak and recap switches, which are about you, not one team, and a team's Recent misery leaves out the recap.

MLB ALERTS
- Crew chief reviews count as lost challenges: when the umpires review a call themselves and overturn it, the team the call went for gets "lost a crew chief review", and a batter whose home run is overturned gets "home run was overturned" (Volpe's, for fan interference, Rays @ Yankees on October 7). An upheld review sends nothing, as no team asked for it. (Server)

FIXES
- ABS challenge alerts wait until the review is over. ESPN first posts every challenged pitch as confirmed and corrects it if the call is overturned, which sent "lost an ABS challenge" alerts for challenges that were won. A lost challenge now goes out about a minute later, once ESPN has settled it. (Server)
- A called third strike or ball four whose challenge was upheld is labeled an ABS challenge, not a replay challenge. (Server)

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
