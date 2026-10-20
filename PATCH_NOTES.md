# Hate Watch patch notes

One section per TestFlight build: what changed since the build before it, server updates included.
Each section's text is pasted into TestFlight's "What to Test" as it is, so it stays under 4,000
characters and uses no emoji. New changes go under "Next build" as they ship; when a build goes to
TestFlight, that heading becomes its build number and a new "Next build" starts above it.

## Next build

- Hate Watch Plus: star an alert (on its card or its screen) to save it; the Feed's Saved chip lists them. This phone only; if the subscription lapses the list is kept, hidden, and returns on resubscribing. (Update)
- Hate Watch Plus: tracking profiles group what you track (Playoff teams) to narrow the Feed and Tracking tab; notifications are unchanged. Alert presets (save one, edit it, or build one from scratch) set a target's alert choices in one tap. Kept on this phone; hidden, not deleted, on a lapse. (Update)
- Tabs: quick swaps no longer leave a blank screen, and the Feed no longer freezes (no scrolling or taps) after a switch from another tab. (Update)
- Lock screen scoreboard: a game not yet started shows its start time in your time zone, not dashes; the clock and quarter sit between the two teams; Hero shows it big. (Update)
- Guide: the drawings now move, replaying on each page. The web guide's page background is dark.
- Motion: alerts drop in, counts roll, hearts pop, live dots pulse, a loss glints gold, the F1 order slides, scores swell, tabs settle in, and more. Off under Reduce Motion. (Update)
- Server: bad requests get a 400 or 413, new devices are limited per address, share links use our own address.
- Server: saving alert settings rejects a malformed body and keeps the old settings; one failing device no longer stops the others' alerts.
- Server: pushes check Expo's delivery receipts 15 minutes after sending, so deleted apps stop getting them.
- Server: shared alert pages are noindex and link to the rival-alerts page.
- Scores: a new "Special Events" view between My and All lists postseason games (ALCS, World Series, Super Bowl, MLB wild card): both teams and scores, the series line ("Series tied 2 - 2") and each game's winner.
- Scores: under those games, "Coming up" lists playoff games and series starting in the next 7 days with "Who do you want to lose?". Vote for either team, see each team's share, change yours until the first game starts. The view is named for the league.
- Scores: under your vote, an "Alert me about (team) losses" switch, off by default. On, the team you voted to lose is tracked for you and shows in Tracking. A series ends it once won; a one-off game covers that game only.
- Scores: a playoff series is the same ledger card (with the vote) in My, All and Special Events, one per series, so a doubleheader or yesterday's final no longer shows twice. The strip under it shows the series line, a cell per game (tap a played one for its box score) and the next game's time. A favorite's win is gold even when you track the other team (Update; the strip needs the server update.)
- Server: cards carry the event, the series and each game's result from ESPN's postseason schedule; regular-season MLB cards carry `series` from the home team's schedule. Finished games keep their box scores until 3 days after the series. Until the server update, Special Events stays hidden.
- Server: the MLB "Opponent has runners in scoring position" alert sends a second alert in the same half-inning when a runner steals third after the first one went out.
- Tracking: press and hold a bell to snooze a player or team for 1 day, 3 days or a week; a snoozed target counts as muted until it ends. (Update, after the server deploy.)
- App: a server that keeps answering 401 no longer loops the app: it re-registers once and keeps your follows and settings if that fails. A live frame that is not JSON is ignored, not a crash.
- Game screen: "4 hate-watching now" counts other people who would get an alert for either team; hidden at 0. (Update, after the server update.)
- Settings: "Reset alerts to defaults" now resets every alert setting and asks first; tracked teams and your tally stay. (Update, after the server update)
- Settings: "Share your season" shares a picture of your whole run (over the air, after the server update).
- Server: a season card, a picture of a device's run with its own link (POST /me/share/season).

## Build 20 (October 18, 2026)

FEED AND SCORES
- Opening the app now checks for an update by itself (and when you return after a minute away), downloads it and restarts into it, so no force-quit is needed. Tap LIVE (top of Feed and Scores) to check on demand. (Update)
- When a newer build is out, the app shows "Update available" with Update (opens TestFlight or the App Store) and Later, once per build. (Update)
- The red X on the Tracking tab is now shown only to Hate Watch Plus subscribers. (Update)
- The Tracking tab's classic cards keep all four icons (X, bell, gear, minus) on one line. (Update)
- English filter labels are capitalized the same way as the rest of the Scores switch: Live Races and Upcoming Races (F1), Most Hated (Tracking), By Division (Search), and the Box Score and Recent Misery tabs. (Update)
- A favorite team's game now shows under My games on Scores, not only in Up next, and its live score updates there. Up next lists each favorite team's next game too. (Update)
- Colors: a favorite team's alerts, game cards and Up next rows are edged gold, a most hated team's red, everywhere (Feed, My games, All games). Most hated is now a red X in place of the star; unfollow is a minus. (Update)
- Hate Watch Plus: favorite an F1 constructor (the heart on its page). Its drivers are gold with a heart in the race results, grid and tables; a most hated constructor's are red, and red wins if it is both. With the gold accent, tracked drivers are a neutral grey highlight. (Update) Saving the heart needs the next server update.
- Hate Watch Plus: a favorite team's alerts now include the other side's errors ("Commits an error" for the opposing team, MLB), pushed like the player version. Teams you track get their own team's error alert too.
- Hate Watch now has a web version: the same app in a browser, without push or Plus. Wide windows get a sidebar and layouts.
- Hate Watch now runs natively on iPad: any orientation, and a wide window gets the sidebar and the Card grid, One column and Panes layouts (buttons at the bottom of the sidebar). Split View and Slide Over keep the phone layout. Needs this build; it does not arrive as an update.
- The app now speaks Spanish (Latin America), French (Canada), Portuguese (Brazil), German and Japanese on every screen: it follows your phone's language, or pick one in Settings under Language (EN, ES, FR, PT, DE, JA chips that wrap on small screens and big text sizes). Alert text still arrives in English for now.

LOCK SCREEN SCOREBOARD
- An eye on each game card (Scores) adds the game to the lock screen scoreboard or takes it off. (Update)
- The scoreboard is now on by default and starts by itself when a game of a team you track or favorite is live or starts within the hour, while the app is open (checked once a minute); with the app closed it cannot start yet, but a board that is up keeps updating. Settings, Delivery, turns it off. While it is on, the app sends your most hated list and picked games to Hate Watch.
- Each team has its own color on all four layouts: favorite gold with a heart, most hated red with a red X, others white. (Update)
- Dynamic Island pills no longer cut the score short when another app shares the island: stacked, away over home, in each team's color. (Update)
- Tracking tab: a "Most hated" chip shows only your starred ones (Plus). (Update)

## Build 19 (October 17, 2026)

LOCK SCREEN SCOREBOARD
- New in Settings, Delivery: Lock screen scoreboard (off until you switch it on). A live scoreboard on the lock screen lists the live games of your teams: favorites first, then most hated, then the rest. Finals stay for 10 minutes. F1 and the UFC are not on it yet.
- A game's line says more: baseball shows outs and count ("Bot 8th · 1 out · 3-2"), football the down and distance.
- Scoreboard layout (Settings, once it is on): Compact, one line a game, four games. Detailed, two lines a game with the runners on base, the count and pitcher, down and distance or shots, and each team's win chance as a bar; three games. Grid, four games as cells two across. Hero, the top game big with its clock, bases and count in the middle, then the others as lines.
- To sort by most hated, the app sends that list to Hate Watch while the scoreboard is on. Switching it off, a lapsed Plus and "Delete all my data" remove it.

HATE WATCH PLUS
- Favorite teams: tap the heart on a team in Search or on its page (Plus only). While your favorite plays, its opponent's alerts land in your Feed and push to your phone, and stop when the game ends. If you already track the team it plays, your settings for that team win. Settings, under Support Hate Watch, lists your favorites: a push switch, a gear for which alerts, an X to remove.
- The league you pick in the filter lights up gold for subscribers. (Update)
- On the Scores tab, a game's card gets a gold border while a team (or a player's team, or an F1 driver or constructor) on your most hated list is playing. (Update)
- Plus that is cancelled or not renewed ends everything it gave: favorites removed, most hated emptied, gold back to red. Checked each time you return to the app. (Update)

STARTUP GUIDE
- Hate Watch Plus has a page before "You're all set", explaining gold accents, the gold app icon, most hated and favorite teams. (Update)
- The Tracking page shows the new team and athlete card and explains the star, bell, gear and Unfollow.

TRACKING TAB
- A Layout button in the top right: Classic (the default; anyone who picked a look keeps it), Colour bar, Banner game, Tiles (two per row) or Scoreboard. The other four show the record, winning or losing streak and live, next or last game. Kept on your phone. (Update)
- College football teams show their record, streak and conference standing ("3-0 in conference, T-1st"). NBA teams and players show record and streak, preseason included. F1 constructors and drivers show their championship place and points. (Update)
- Teams and athletes are cards with a banner in the team's color: the league on the left, how many people hate them on the right, the logo or photo over the banner's edge, a thin border, long names wrapped, buttons along the bottom with Unfollow on the right. Classic is about 40% shorter. A team names its division after the city ("Cleveland · AL Central"). (Update)

## Build 15 (October 17, 2026)

HATE WATCH PLUS
- Hate Watch Plus ($5/month, in Settings) replaces the donation buttons. Subscribers get gold accents and a gold app icon, and can star their most hated players and teams (Tracking tab) for a gold border in the Feed.

SHARING
- Share offers looks (ticket stub, void stamp, boarding pass, parking ticket, scratch-off, torn ticket); the link previews as it. (Update)

SERVER
- The database is backed up continuously; the owner is alerted if backup or polling stops.

RECENT MISERY
- Recent misery on a player's or team's page is one list for everyone, untracked teams too: 30 days of losses and the worst of the rest (ejection, injury, pulled QB or goalie, red card, DNF); a player's page adds their team's losses.
- A soccer loss by 3+ goals keeps its score on the list.

MLB
- A strikeout on a challenged pitch waits 30 seconds (45 if ESPN names it); one that becomes a walk is not sent. One ESPN rewrites gets a line.
- A pickoff error is no "got picked off".
- A lost challenge ESPN adds later is sent once it holds. A corrected homer distance or error fielder is a line.
- A run is the pitcher's whose runner scores, as in the box score; a wild-pitch or balk run is "gave up" for him.
- A third out a review overturns gets a line. A strikeout ESPN never posts comes from the third strike.

HOCKEY
- A goalie is not shown pulled for a play ESPN took out; a real pull counts his goals against.
- A goal ESPN first posted as a shot, and any shot it changes or removes, gets a line, no push.
- An empty-net goal first posted as even-strength is not charged to him.
- Hockey waits for ESPN: a shot 20 seconds, an unnamed penalty up to 10 minutes, a goal with no scorer 90 seconds. A penalty says what it was, not "Penalty Shot Infraction".
- A shot posted minutes late no longer alerts; a play posted again within 45 minutes is one alert. A repeat shot waits a minute.
- A shootout game ends as a win and a loss, not a tie: "Lost to Dallas in a shootout. Final DAL 3, COL 2."
- A goal ESPN takes out after it pushed gets "Goal taken off the board". A play reused for a new shooter is a line.
- Corrected assists and a penalty's "against" are lines. A shot deleted before the final gets a "taken out" line.

FOOTBALL
- A sack on a failed two-point try reads "sacked on the two-point try".
- A score that ties the game says so ("Rams tied the game, 34-34."), a line, no push.
- An NFL team's flags reach trackers' feeds, no player named, never pushed.
- College football: a flag no longer replaces a score or a three-and-out, and an alert shows ESPN's corrected words and score.
- A safety is pushed as a safety, also when ESPN first posted a sack.
- College football: a blocked or missed extra point is an alert; the setting is now "Misses a kick".
- College football: a flag a review took back is no flag; a sack typed as a fumble is a sack; a repeated flag is a line on the first card.
- A touchdown ESPN words as a loss of yards waits up to a minute. A last score missing from ESPN's plays comes from the final.
- Kneel-downs are no "turned it over on downs". A touchdown given a two-point try becomes "scored 8".

NBA AND WNBA
- A technical's free throw is no "picked up a technical"; traveling is a turnover; an offensive charge is a foul.
- A play is corrected for 45 minutes; changed shots get a silent line.
- A missed shot waits up to 15 seconds for ESPN to name it; a basket with no scorer up to 20, so one ESPN takes back is never "took the lead"; a later one gets a line.
- A late play shows the score now; a 3-seconds call is no technical push.
- A turnover or foul ESPN posts twice is one alert; an offensive foul, its turnover and a retyped foul are one alert with lines.
- A flagrant is titled one, not a technical. A "No Turnover" shows its real words. A play stamped far back waits 3 minutes.
- A play or change 2+ minutes late is feed-only; a box score player on no roster joins the catalog. Preseason: no "team lost" for players who sat out.

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
