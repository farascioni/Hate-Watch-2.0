# Hate Watch patch notes

One section per TestFlight build: what changed since the build before it, server updates included.
Each section's text is pasted into TestFlight's "What to Test" as it is, so it stays under 4,000
characters and uses no emoji. New changes go under "Next build" as they ship; when a build goes to
TestFlight, that heading becomes its build number and a new "Next build" starts above it.

## Next build

SERVER
- Behind the scenes: the server can now copy its database off its machine continuously and restore it onto a replacement, and it has a new check that tells the owner when its database, its ESPN reads, a game's polling or that backup has stopped. Nothing changes in the app.

RECENT MISERY
- The Recent misery tab on a player's or team's page is now the same list for everyone: the last 30 days of losses, with how they happened (a blown lead, overtime, a walk-off, losing as the favorite), and the worst of the rest, such as an ejection, a serious injury, a pulled quarterback or goalie, a red card, a DNF or a UFC loss.
- It no longer depends on what you track or your alert settings, and it works for teams and players nobody tracks.
- A player's page also shows their team's losses.
- A loss says "Successful Hate Watch!" only if you track that team or player.
- A soccer loss by 3 or more goals keeps its score and margin on the list (it was dropped before), and a corrected final score refreshes them.

MLB
- A strikeout on a challenged pitch waits 30 seconds, so one ESPN turns into a walk is never sent.
- A pickoff error is no "got picked off", and its pitcher alerts come once.
- A lost replay challenge ESPN adds later is sent once it holds; "Official Scorer Ruling Pending" is waited out.
- A homer's corrected distance and an error ESPN moves to another fielder become lines on the alerts sent.
- A run is the pitcher's whose runner scores, as in the box score; a run a review gives back alerts the pitcher too.
- A third out a review overturns gets a line, and the inning's real end is judged.
- A strikeout ESPN never posts is made from the third strike.

HOCKEY
- A goalie is no longer shown as pulled when a play ESPN took out a few seconds later had him replaced, and a real pull now counts the goals against him ("3 goals on 7 shots").
- A goal ESPN first posted as a missed or saved shot puts a line on the scorer's alert ("Leon Draisaitl scored"), and other shots ESPN changes or takes out get a line too, with no extra push.
- An empty-net goal ESPN first posted as an even-strength one is no longer charged to the goalie: the goalie's alert says nobody was in net, and the team's says "Into an empty net."
- A penalty ESPN first posted as "Penalty Shot Infraction" gets its real call as a line.
- Hockey alerts now wait for ESPN to finish the play: a shot 20 seconds, a penalty ESPN has not named up to 10 minutes, a goal with no scorer in its text 20 seconds. A goal that was first a shot no longer gets a wrong shot alert, a penalty says what it was (slashing, hooking) instead of "Penalty Shot Infraction", and fights are no longer hidden behind it.
- A shot ESPN posts minutes late no longer alerts and shows the score now, and a play it takes out and posts again within 45 minutes is one alert. A fight title drops "served by". Still twice: a copy of a shot posted while the first is there.
- A goal's alerts take ESPN's later text on the feed (a different scorer, an assist taken away): the Maple Leafs' short-handed goal was first Barrett Hayton's and is Mikhail Sergachev's.
- The final score of a game is the higher of ESPN's score and its period scores, so a trailing header never gives a loss "3 to 1" when it ended 4-1.

FOOTBALL
- A score that ties the game says so ("Rams tied the game, 34-34."), as a line on the alert with no push; when the extra point is what ties it, the line comes a few seconds after the touchdown.
- A sack on a failed two-point try reads "got sacked on the two-point try".
- Track an NFL team and its flags reach your feed too, even when no player is named: "Bills were flagged: Illegal Shift". It is the same "Commits a penalty" setting (now on a team's page as well), and a team's flags never push.
- College football: a flag no longer takes the place of a score or a three-and-out (it is its own feed row, never a push), and an alert shows ESPN's corrected words and score (a sack's yards, an extra point).

## Build 13 (October 12, 2026)

Changes since build 12. Server updates already work on every build.

SCORES
- Before a game, its Box score previews leaders, last five games, injuries, the predictor.
- A game's screen puts your alerts, minimizable, after the box score.
- A team's page (and its players') shows the live score card above "Next game" while they are playing.

UFC
- Track UFC fighters: a loss says how and when (KO/TKO R1 1:20), a lost title, losing as favorite or a streak; also live knockdowns and the walk-out.
- UFC chip on Scores: the next card (All fights with odds, or My fights) with each fight's odds, tale of the tape and last five; results as fights end. Search lists each weight class's top five.
- A loss gets ESPN's clip of the fight, if any.

F1
- Sprints get alerts; a driver's teammate is whoever drove the other car that weekend.
- Lights out is one alert naming yours; a double DNF or no points takes in its drivers' alerts.
- Race, sprint and qualifying results come as the session ends; a later penalty corrects them.
- Championship drops come with the result, not 20 minutes later.
- Drivers and constructors have a Stats tab; Search lists constructors A to Z, drivers by constructor.
- Before an F1 session, its screen previews the weekend; Scores has Live and Upcoming races.
- A live race shows the lap, any flag but green, each car's gap, places from the grid and stops; its card, yours.
- Live: your driver lapped or 3+ places down from the grid; pit stops in the feed.

FOOTBALL
- A CFB chip: the FBS's 138 teams by conference, with games, scores, box scores, standings and Top-25 ranks.
- Alerts: interceptions, lost fumbles, missed field goals, ejections, the QB pulled, turnovers on downs, the red zone, Top 25 moves; sacks and flags in the feed.
- A football play or flag ESPN changes, even after the final, gets a line, no second alert; the new play alerts.
- More teams' flags go out, with the team and foul named right.
- NFL: a wiped-out play alerts only its flag; every sack, strip-sack and muffed punt counts; ties and new installs' flags are feed only.

MLB
- A homer says how far it went, and back-to-back; team alerts name the RBI ("on Kwan's RBI double").
- Bases loaded against your team: an alert, pushed. Innings ending in order or stranding runners are caught better.
- Playoff exits say ELIMINATED on players' alerts too; the loss's facts and losing pitcher are lines.
- No quality start needs 2+ earned runs when pulled early; errors by "C. Montgomery" reach Colson.
- Lost ABS challenges alert in 30 seconds. A slow ESPN no longer loses the last inning.

NBA AND WNBA
- Misses name the shot and distance, not heaves. WNBA: rival gets the top seed.
- A play ESPN changes after posting is judged again: a line, no push, and the right player's alert.
- A shot not yet typed reads "missed a 29-foot three"; a block never goes to the blocker.
- Falling behind again within 2 minutes is a line on the earlier alert.
- The free throw a technical gives is no "picked up a technical" for its shooter; a traveling turnover is a turnover.
- A play is corrected for 45 minutes (was 15), so a turnover ESPN moves to another player late still is; a block that becomes a plain miss only says the play changed.
- An offensive charge is a foul: it alerts, counts toward fouling out, and "fouled out" no longer comes a foul late.
- A play ESPN posts minutes late shows the game's score now, not an old one.
- A defensive 3-seconds call reads "called for defensive 3 seconds" and no longer pushes as a technical.
- A missed shot ESPN later calls something else (a three that was a two, 2+ feet off) gets a silent line saying so.
- A missed shot waits up to 15 seconds for ESPN to name it, so the alert says "missed a driving layup" (or "got sent back") instead of "missed a shot".
- An offensive foul and its turnover are one alert, with the other as a line.

EVERYWHERE
- Soccer goals, cards, fouls come sooner, in ESPN's fuller words.
- Tracking both sides: one start alert.
- A tying run says so; playoff starts name the round, losses the series score.
- Standings drops name the division in MLB, the NFL and the NHL.
- Card names and titles wrap at large text; buttons center their labels.
- After a loss (F1: a race), a standings drop or elimination is a line on it.
- Filters say Athletes with All on, else Players (F1: Drivers, UFC: Fighters); the Scores switch says events, games or fights.
- League filters show yours, then More by sport; the WNBA is last everywhere.
- Clips play only when you press play; an alert opens in full, its photo opens their page.
- No alert repeats a line or loses one; after a deploy, the minutes before still alert, once.
- Following a team mid-game starts tracking it at once.
- Notices from Hate Watch come in the feed, never pushed.
- Settings has no Leagues section; the guide lists every league; the counter says team or fighter.

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
- A team's alert and its players' alerts on one play are one alert: "Gerrit Cole gave up a solo homer", with "Rays took the lead." in it.
- A fact that comes a moment later (the inning ending on that strikeout, how the drive ended) is added to the alert you already have, with no second notification. This build updates the alert on screen right away; older builds show it after a refresh.

HOW THEY LOST
- Lines on the loss alert, each with its own switch under Team alerts: a walk-off or last-second loss, blowing a big lead, losing as the favorite, a shutout, a sweep, losing to a much worse team, falling below .500, the losing streak, being no-hit, the other team's star going off (NBA 40 points, WNBA 30), a dead power play (NHL 0-for-4). With "Loses a game" off, the first one you have on is the alert.
- Blows a big lead, live, in place of "Falls behind". Gets ejected. Rival clinches the division.
- Your Hate Watch streak on a loss, and a weekly misery recap, Mondays at 9 am.

NEW ALERTS
- MLB: strikes out 3 or 4 times, hands over a run (wild pitch, balk, passed ball, bases-loaded walk), back-to-back homers allowed, thrown out on the bases, a starter chased in under 3 innings, no-hit through 6, 0-for-4 or worse, a position player pitching. Crew chief reviews count as lost challenges, and an overturned home run says so. Runners in scoring position adds "Bases loaded now" when the bases load.
- NFL: the starting QB pulled, a touchdown wiped out by a penalty, a three-and-out, turned over on downs, empty from the red zone.
- NBA and WNBA: fouls out, scoreless at the half, a brick night, an opponent's 14-0 run (WNBA 12-0).
- NHL: goalie pulled, a shootout miss, a fight, giving up an empty-netter or a short-handed goal, finishing -3 or worse.
- Premier League: a late goal against (from the 85th minute), a goal ruled out by VAR, hitting the woodwork, taken off by halftime, dropping into the relegation zone.
- F1: lapped, starting from the back of the grid, out-qualified by a teammate.
- Some start in your feed only, with no notification: each alert's bell in Settings changes that.

FIXES
- ABS challenge alerts wait until the review is over, so a won challenge no longer sends "lost an ABS challenge".
- A called third strike or ball four whose challenge was upheld is labeled an ABS challenge, not a replay challenge.
- A team's or player's alert settings no longer list the streak and recap switches, and a team's Recent misery leaves out the recap.

## Build 11 (October 7, 2026)

Changes since build 10. Server updates already work on every build.

FEWER NOTIFICATIONS BY DEFAULT
- New installs start with quieter alerts: results and big failures notify you, the play-by-play goes to your feed, and the noisiest alerts start off. About 88% fewer notifications. Existing installs keep their settings.
- "Reset alerts to defaults" also resets each alert's notify-or-feed bell.

NEW AND BETTER ALERTS
- Blowout losses say so: "Bears got BLOWN OUT by the Eagles." About 1 in 8 losses: MLB 7+ runs, NFL 21+, NBA 25+, WNBA 20+, NHL 4+ goals, soccer 3+.
- MLB: new "Goes down in order" when your team goes 1-2-3, and "Struck out in order" when all three strike out. Feed only.
- MLB outs say what kind: grounded out, flied out, fielder's choice. Double and triple plays say so (triple plays are new). A runner thrown out on a hit isn't the batter's out.
- MLB stranded runners include the runner on first: "Brewers stranded runners on first and second."

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
- Playoff eliminations: a playoff knockout now sends the alert inside that game's Successful Hate Watch, and sweeps say so.
- "Their team loses" for tracked players: a Successful Hate Watch named for them when their team loses, counted for the team. One alert per loss. Every league but F1.
- More soccer alerts: commits a foul, gives away a penalty, loses the ball, gives the ball away, and teams losing by 3+ goals.

SCORES AND STATS
- "Up next" on the Scores tab: each tracked team's next game, with the channel and the kind of game. It fills the screen on days with no games.
- Stats pages: a Stats button on every player and team page (not F1) with season and career lines, the last five games and the next game. The bad numbers are in red.

SETTINGS AND PAGES
- Alert groups in Settings fold up and show how many alerts are on. Reset turns every league back on.
- A player or team page's "Recent misery" shows the last 24 hours, folded to the latest alert.

LEADERBOARD
- Each filter ranks its own top 100, with a footer for the rest, and ties no longer leave gaps (1, T-2, T-2, 3).
