# Every alert, in detail

The long form of the README's "Notifications" table: one section per row of that table, in the same order and under the same label, then four sections for what the table has no row for. Each section says which alert types it covers, what in ESPN's data triggers them, step by step, the thresholds and timing, the default (push, feed only, or off), the exact title and body with real examples from the code and the tests, how it combines with other alerts, ESPN's later edits and other edge cases, the files and functions that do it, and the tests that cover it.

Everything here was read from the code (`server/src/`) and the tests (`server/test/`) as of this commit, except figures and examples marked as the README's (measurements from real games, and a few examples from README rows), which were carried over and not re-checked. Where the code and this file disagree, the code is right and this file is out of date. Before changing alert code, read [docs/duplicate-alerts.md](duplicate-alerts.md) too.

## Index

**Summary.** Hate Watch has 152 alert types (`EVENT_TYPES` in `server/src/event-types.ts`: the base list, a copy of each NBA-only type for the WNBA, and a copy of each soccer type for every soccer league). Each has a scope (a player or a team, some both), a section in the app's Settings, and a default in one of three tiers: **push**, **feed only** (on, no notification until its bell is tapped), or **off**. Live games are read by one game tracker per game every 2 seconds (`server/src/live.ts`), and each play goes through its league's detector once (`server/src/detectors.ts`). Losses and their facts are worked out at the final, standings every 60 seconds, injury reports every 30, news every 3 minutes, F1 and the UFC by their own watchers (`f1.ts`, `ufc.ts`). Every alert then goes through `publish()` (`server/src/fanout.ts`), which stores it once, decides per device whether it's wanted and whether it pushes, and makes alerts about one moment into one alert with lines. Each section starts with a table of its types (generated from `event-types.ts`): the type id, its label in Settings, who it's about (with the positions it fits, in ESPN's codes), its Settings section, and its default for a new install.

**Sections:**

- [MLB](#mlb): a batter's strikeouts (and 3+), outs, double and triple plays, being thrown out on the bases, going hitless; a fielder's error; a catcher's passed ball; a pitcher's homers (back-to-back too), runs, walks and handed-over runs.
- [NFL](#nfl): interceptions, sacks, incompletions, fumbles, missed kicks, flags, a touchdown wiped out, a quarterback pulled, ejections; three-and-outs, turnovers on downs, empty red-zone trips; a tied game; how ESPN's later edits to football plays become lines, not new alerts.
- [NFL delay of game / safety](#nfl-delay-of-game--safety): a team's delay of game given to its quarterback; a safety for the team and the player responsible.
- [NFL onside kick](#nfl-onside-kick): the receiving team's alert when the other side kicks onside and keeps the ball (NFL and college).
- [NBA](#nba): blocks, missed free throws, missed shots (named, with the distance, late and close; an untyped shot as an unknown one), turnovers, technicals and ejections, fouls and fouling out, scoreless at the half, brick nights, the other team's star, a 14-0 run, a lead that changes hands again within 2 minutes, and how ESPN's edits to a basketball play are handled (judged again, a line, no push).
- [WNBA](#wnba): how the WNBA gets a copy of every NBA alert, its own thresholds, and its rival-clinch alert (the league's best record: it has no divisions).
- [Soccer (EPL)](#soccer-epl): every soccer alert: goals against a keeper, own goals, missed penalties, cards, VAR, the woodwork, early subs, late goals, the relegation zone, and the shared team alerts in soccer.
- [EPL how](#epl-how): how a match is read: key events for plays, the touch feed first for goals, cards and substitutions, ESPN's rewrites of them, the score counted from goals, the keeper in goal tracked through subs and red cards.
- [Soccer fouls and penalties conceded](#soccer-fouls-and-penalties-conceded): fouls, handballs and dives from the touch feed and the commentary, the fouler from the text, a penalty conceded for the player and the team, a card and its foul as one alert.
- [Soccer passes and dribbles](#soccer-passes-and-dribbles): losing the ball and giving it away, judged from the next touch in ESPN's touch-by-touch feed, and again when ESPN retypes or removes a touch.
- [Soccer: 3+ goal loss](#soccer-3-goal-loss): "thrashed" in place of the plain loss, one Successful Hate Watch either way.
- [Adding a soccer league](#adding-a-soccer-league): how a new soccer league gets every soccer alert without new alert code.
- [NHL](#nhl): goals against a goalie, a goalie pulled, shots missed, blocked or saved, shootout misses, giveaways, penalties, fights and ejections, finishing -3, empty-netters and short-handed goals against, a dead power play.
- [F1 drivers](#f1-drivers): DNFs (live), one finish alert per session (no points, places lost, behind teammate, lapped), live places lost, lapped and pit stops, the start and the back of the grid, qualifying, championship drops.
- [F1 constructors](#f1-constructors): double DNFs (live), no points (F1's Successful Hate Watch), championship drops, the start.
- [F1 how](#f1-how): how a race weekend is read: the scoreboard, live statuses and timing, results and their corrections, one notification per session.
- [Any player](#any-player): the alerts every player can get in every league, and which leagues have which.
- [Their team loses](#their-team-loses): a tracked player's "their team lost", one alert per loss with the team's, counted for the team.
- [Injury reports](#injury-reports): read every 30 seconds, a player alert when someone is added or gets worse, and one team alert per report update.
- [iOS notification stacks](#ios-notification-stacks): the thread each push has, and everything else a push carries.
- [Teams](#teams): standings drops (by division in MLB, the NFL, the NHL), losing streaks, a rival clinching the division, one alert per standings read, and MLB's "on Kwan's RBI double".
- [Eliminated from playoffs](#eliminated-from-playoffs): from the standings in the regular season, from the final in the postseason, and in the loss's own alert.
- [Game starts](#game-starts): "Hate Watch Starting", once, only for a game seen before it began; F1 and UFC starts.
- [Successful Hate Watch](#successful-hate-watch): the loss alert, and the loss's facts (last-second, blown lead, favorite, shut out, swept, worse team, below .500, streak) as lines or in its place.
- [Blowout losses](#blowout-losses): the margins per league and the words.
- [Scored on + fell behind](#scored-on--fell-behind): opponent scores, falls behind, blows a big lead live, and how one scoring play is one alert.
- [MLB caught stealing / picked off](#mlb-caught-stealing--picked-off): who the runner was when ESPN names only the pitcher, and ESPN's two copies of each play.
- [MLB NOBLETIGER](#mlb-nobletiger): bases loaded with nobody out and no run, in place of that inning's stranded runners.
- [MLB goes down in order](#mlb-goes-down-in-order): 1-2-3 innings, and how a half-inning's end is judged from a read that has its third out.
- [MLB teams](#mlb-teams): stranded runners, being no-hit through 6 (and at the final), a position player pitching.
- [Off-field trouble / Fined or suspended (every league, players and teams)](#off-field-trouble--fined-or-suspended-every-league-players-and-teams): ESPN's news, what counts, who it's about, one alert per story.
- [MLB pitchers: blown save, no quality start, loss](#mlb-pitchers-blown-save-no-quality-start-loss): from the box score: blown saves, no quality start, chased early, the loss as a line on the team's loss.
- [MLB loses a challenge](#mlb-loses-a-challenge): ABS challenges (held until the review settles), replay challenges, crew chief reviews.
- [MLB opponent in scoring position](#mlb-opponent-in-scoring-position): a runner on second or third against the tracked team, once a half-inning.
- [MLB opponent loads the bases](#mlb-opponent-loads-the-bases): the bases loaded against the tracked team, pushed, with the pitcher's walk as a line.
- [College football](#college-football) (no table row): the NFL's alerts as a team's own `cfb.*` types, college flags, the AP poll, losing to an unranked team.
- [UFC](#ufc) (no table row): fight starts, knockdowns, losses saying how and when, title fights, losing as the favorite, losing streaks.
- [Your Hate Watch: the streak and the weekly recap](#your-hate-watch-the-streak-and-the-weekly-recap) (no table row): the device's own streak on a loss, and Monday's recap.
- [How every alert is delivered](#how-every-alert-is-delivered): the rules in `publish()` every alert above goes through: who gets it, settings, moments and lines, late facts, pushes, defaults.

## MLB

The MLB player alerts that come from a single play: strikeouts, outs, double plays, errors, a catcher's passed ball, and a pitcher's home runs, runs, walks and handed-over runs. Other MLB alerts have their own sections: [MLB caught stealing / picked off](#mlb-caught-stealing--picked-off), [MLB pitchers: blown save, no quality start, loss](#mlb-pitchers-blown-save-no-quality-start-loss) (with getting chased), [MLB loses a challenge](#mlb-loses-a-challenge), and the team alerts in [MLB NOBLETIGER](#mlb-nobletiger), [MLB goes down in order](#mlb-goes-down-in-order), [MLB teams](#mlb-teams), [MLB opponent in scoring position](#mlb-opponent-in-scoring-position) and [MLB opponent loads the bases](#mlb-opponent-loads-the-bases).

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `mlb.batter.strikeout` | Strikes out | player, not SP, RP, P | Offense | push |
| `mlb.batter.multi_strikeout` | Strikes out 3+ times | player, not SP, RP, P | Offense | push |
| `mlb.batter.double_play` | Hits into a double or triple play | player, not SP, RP, P | Offense | push |
| `mlb.batter.popout` | Makes an out | player, not SP, RP, P | Offense | off |
| `mlb.runner.out_on_bases` | Gets thrown out on the bases | player, not SP, RP, P | Offense | push |
| `mlb.batter.hitless` | Goes hitless | player, not SP, RP, P | Offense | feed only |
| `mlb.fielder.error` | Commits an error | player and team | Defense | push |
| `mlb.catcher.passed_ball` | Lets a run score on a passed ball | player, only C | Defense | push |
| `mlb.pitcher.home_run_allowed` | Gives up a home run | player, only SP, RP, P | Pitching | push |
| `mlb.pitcher.gift_run` | Hands over a run | player, only SP, RP, P | Pitching | push |
| `mlb.pitcher.runs_allowed` | Gives up runs | player, only SP, RP, P | Pitching | feed only |
| `mlb.pitcher.walk` | Issues a walk / HBP | player, only SP, RP, P | Pitching | off |

**Where the plays come from.** One `GameTracker` per live game (`server/src/live.ts`) reads ESPN's core plays feed and the site summary every 2 seconds (`LIVE_POLL_MS`, `HW_LIVE_POLL_MS`), turns each play into an `NPlay` (`fromCorePlay`, `fromSitePlay` in `server/src/detectors.ts`) and merges the two lists by play id (`mergePlays`). A play is passed to the detectors once, on its first sighting (`seen`). The MLB detector is `mlb()` in `detectors.ts`. Every play also goes through `observePlay()`, which keeps the game's state: each batter's strikeouts so far (`ks`), the latest at-bat result (`lastResult`), who is on each base (`bases`, from the batter and runner roles on pitches and results), the current half-inning (`trackHalfInning`) and each team's hits from the core feed (`hits`).

**Which plays count.** The batter alerts need a play that is an at-bat result (`typeSlug` `play-result`) or a scoring play, with a participant in the `batter` role. An "End Inning" play is skipped here: a half-inning's end is judged separately ([MLB goes down in order](#mlb-goes-down-in-order)). An at-bat result ESPN posts before its batter is on it (`awaitingBatter`: the play id's pitch number is `99` and no batter role) is held until he is, for up to 20 seconds (`waitForBatter`, `HALF_END_WAIT_MS`), and then judged as it stands. A result ESPN rewrites after posting is logged, not judged again, because several MLB alert ids are built from the play's text (`resultSigs` in `GameTracker.poll`). What a rewrite does reach (`revisedResult`, with the previous version kept in `resultPlays`): a crew chief review written in later ([MLB loses a challenge](#mlb-loses-a-challenge)); a replay challenge's sentence written in later, once it has held ([Replay challenges](#replay-challenges)); a home run's new distance and an error moved to another fielder (a line on the alerts already sent, below); and a result that became a scoring play (the pitcher's run alert: the team's came from the score); and a strikeout rewritten (a line on the batter's alert, below). A result still under review is not judged yet (`settling`): a strikeout on a challenged last pitch waits `HW_ABS_SETTLE_MS`, one that says "Official Scorer Ruling Pending" waits up to `HW_RULING_WAIT_MS` (45 s) and is then judged without that sentence, and the plays after it wait their turn so the game's state is built in order. A strike three that ended an at-bat ESPN gave no result for gets one after 20 seconds ([Strikes out](#strikes-out-and-strikes-out-3-times)).

**The body.** Every play alert here has the same body: ESPN's text for the play, a dash, then the score as `AWAY n, HOME n` with ESPN's abbreviations (`mk()` and `scoreLine()` in `detectors.ts`). For example "Judge struck out swinging. — TB 1, NYY 1" (`test/bundling.test.ts`).

### Strikes out, and strikes out 3+ times

- **Trigger:** an at-bat result whose text matches `struck out`. Looking or swinging comes from the text: "looking" anywhere gives "struck out looking 👀", anything else "struck out swinging".
- **Title:** "Aaron Judge struck out swinging" (`test/bundling.test.ts`, `test/images.test.ts`), "Travis Bazzana struck out swinging" (`test/alds-game5.test.ts`).
- **The 3rd, 4th and 5th strikeout of a game** are `mlb.batter.multi_strikeout` instead, counted per batter in `g.ks` (the count is taken before `observePlay` adds this one, so the detector adds 1). Titles: "Aaron Judge struck out for the 3rd time: a hat trick 🎩" (`test/sport-alerts.test.ts`), then "…for the 4th time: a golden sombrero", and from the 5th "…a platinum sombrero". It carries `aliases: ['mlb.batter.strikeout']`, so a device with only "Strikes out" on still gets it, and nobody gets both for one at-bat.
- **A strikeout that reaches base** ("Mitchell struck out swinging, reached first on wild pitch.") is still a strikeout alert. It does put a runner on, so it breaks a 1-2-3 inning ([MLB goes down in order](#mlb-goes-down-in-order)).
- **A strikeout on a challenged last pitch waits** (`strikeoutUnderReview`, `settling`): when the last pitch still reads "Strike Looking - Confirmed", or the result carries the challenge's sentence, the result is not judged for `ABS_SETTLE_MS` (30 s), or 1.5 times that (45 s) when the result carries the challenge's sentence (ESPN rewrote Smith's "looking ... upheld" strikeout to "swinging" 3 s after a 30 s wait ended, NLCS Game 3, October 14 2026; the line `revisedResult` adds is the backstop); at the final, no wait. NLCS Game 2 (October 12 2026): "Betts struck out looking. Los Angeles Dodgers challenged: call on the field was upheld." went out and ESPN then overturned the call into a walk (the same play now reads "Betts walked."). The settled version is the one judged, so the walk is a walk and `g.ks` never counts the strikeout. Only challenged strikeouts wait.
- **A strikeout ESPN rewrites after its alert went out** (NLCS Game 3, October 14 2026, Will Smith: "struck out looking. Los Angeles Dodgers challenged: call on the field was upheld." at pitch 4, then "struck out swinging." at pitch 5 once the review overturned a pitch): the alert keeps its words and gets a line, no push (`revisedResult`, `linesOnPlay`): "ESPN changed this to a strikeout swinging, and the challenge no longer reads upheld.", or "ESPN: the challenge no longer reads upheld." when only the sentence went, or "ESPN now has this at-bat as: <ESPN's first sentence>" when it is no longer a strikeout. The 30 second wait cannot catch it when ESPN rewrites later than that. The same words on the same alert are one line.
- **A strikeout ESPN never posts a result for** (`withStrikeThrees` in `live.ts`): ALCS Game 1 (October 12 2026), Bailey's third strike was "Strike Looking - Overturned: Strike 3 Looking", the third out of the 8th, and neither ESPN feed ever had "Bailey struck out looking." A strike-three pitch that is the last play of its at-bat (something else has started) with no result after `HALF_END_WAIT_MS` (20 s) is given one: the id the result would have (the pitch's id without its last 6 digits, then `990057`, true of all 85 strikeouts in four recorded games), "<last name> struck out looking|swinging.", and the pitch's batter, pitcher, outs and score. It joins the plays from then on (`observePlay`, the half-inning's end and the final's check read it), and a result that comes later is the same play.
- **Ids:** `${gameId}:${playId}:mlb.batter.strikeout:${athleteId}` (or `mlb.batter.multi_strikeout`).

### Hits into a double or triple play

- **Trigger:** an at-bat result (not a strikeout) whose text has "double play" or "triple play". How it was hit is read from "grounded|lined|flied|popped|bunted|fouled|hit into (a) double/triple play"; with no verb it says "hit".
- **Title:** "Michael Busch grounded into a TRIPLE PLAY 😱" (`test/mlb-outs.test.ts`), "Austin Wells lined into a double play" (`test/sport-alerts.test.ts`), "Michael Busch flied into a double play".
- **Counts as an out too:** `aliases: ['mlb.batter.popout']`. A device with only "Makes an out" on gets it, and one with both gets one alert.
- **The runner doubled off** on the same play ("Wells lined into double play, pitcher to first, Volpe doubled off first.") gets his own [thrown out on the bases](#gets-thrown-out-on-the-bases) alert: "Anthony Volpe got doubled off first".

### Makes an out (off by default)

- **Trigger:** an at-bat result, not a strikeout or double play, whose text has "flied|grounded|lined|popped|fouled|bunted out", ", (thrown) out at", or "fielder's choice".
- **Title says what kind:** "grounded out", "flied out", "lined out", "popped out", "fouled out", "bunted out"; "grounded into a fielder's choice" (also "popped/lined/flied/bunted/hit into a fielder's choice"); "hit into a fielder's choice" when ESPN gives no verb; and "made an out" when none of those words is there. Examples from `test/mlb-outs.test.ts`: "Busch grounded into fielder's choice to shortstop, Hoerner out at second." is "Michael Busch grounded into a fielder's choice"; "Busch doubled to left, out at third." is "Michael Busch made an out" (thrown out stretching, his own out).
- **Only the batter's own out:** "Busch singled to right, Shaw to second, Conforto thrown out at home." sends nothing to Busch (he got a hit; a runner was out). The regex for ", out at" requires the out to follow directly, without another runner's name in front.
- Off by default since the first defaults (`defaultOn: false`).

### Gets thrown out on the bases

- **Trigger:** an at-bat result (`outOnBases`) whose text has `<Name> out stretching at second|third|home`, `<Name> doubled off first|second|third`, or `<Name> (thrown) out at home`, with an optional first initial ("C. Montgomery"). Caught stealing and pickoffs are excluded (they are [their own alert](#mlb-caught-stealing--picked-off)).
- **Who:** the batter, when the name matches him (last name, and the initial if there is one), or else the player on the batting team with that last name (`byLastName`, which uses the initial to pick between two teammates with the same surname).
- **Title:** "Aaron Judge got thrown out stretching at third" ("Judge doubled to left, Judge out stretching at third.", `test/sport-alerts.test.ts`), "Anthony Volpe got doubled off first", "<Name> got thrown out at home".
- **Id from the text:** `${gameId}:bases:${halfKey}:${normalized text}:${athleteId}`. ESPN posts runner plays twice under different ids with the same text, so both copies make one id ([docs/duplicate-alerts.md](duplicate-alerts.md), Layer 1).

### Goes hitless (feed only by default)

- **Trigger:** at the final, from the box score (`boxPlayerFacts` in `detectors.ts`): a batting line with 4 or more at-bats and no hits.
- **Title:** "<Name> went 0-for-4", with " with N strikeouts" added when he struck out twice or more. **Body:** his "H-AB" line, the strikeouts ("0-4, 3 K"), then " — Final: " and the score.
- **On the losing side** it shares the loss's moment (`playerFinalEvents`): a device that gets the loss gets "Aaron Judge went 0-for-4." as a line on it. **On the winning side** it is an alert of its own (moment `${gameId}:final:player:${athleteId}`), feed only by default.
- **Not in the preseason:** `GameTracker.finish` skips box-score facts when the season type is 1.
- Id: `${gameId}:final:mlb.batter.hitless:${athleteId}`.

### Commits an error

- **Trigger:** any MLB play whose text matches `error by (position )?(baseman |fielder |stop )?(X. )?Lastname`, for example "fielding error by shortstop Dubón" or "error by shortstop C. Montgomery". The fielder is looked up on the fielding team (the side that isn't the play's batting team) by last name (`byLastName`); when two teammates share it, ESPN writes the first initial ("C. Montgomery": Colson and Braden, White Sox, October 2026) and the initial picks one. No match, or two matches with no initial, means no alert.
- **Title:** "<Name> committed an error".
- **A runner's play is posted twice** (a "Pick Off" and a "Play Result" with one text and no batter on either: `twin` in `mlb()`), so the fielder's error and the pitcher's run alert for it take their ids from the half-inning and the text (`textId`), like the gift runs: one alert each, not two. At-bat results keep play-id ids.
- **ESPN moves an error** (NLCS Game 2, October 12 2026: a pickoff error went from pitcher Stewart to first baseman Freeman six minutes later): the first fielder's alert gets a line, no push, "ESPN moved this error to Freddie Freeman.", and the new fielder's alert goes out (`revisedResult`; its id has the new fielder in it).
- Tests: `test/mlb-oct12-review.test.ts` (the twin plays, the move).

### Lets a run score on a passed ball (catchers only)

- **Trigger:** a scoring play whose text matches "scored on a passed ball" (`GIFT_RUN`), with "passed ball by (X. )Lastname" naming the catcher, looked up on the fielding team.
- **Title:** "Austin Wells let a run score on a passed ball" (from "Caminero scored on a passed ball by Wells, Diaz to second on passed ball by Wells.", `test/sport-alerts.test.ts`).
- **Id from the text** (`${gameId}:mlb.catcher.passed_ball:${half}:${text}:${catcher}`): ESPN posts a runner's run twice ("Passed Ball" and "Play Result", same text).
- A passed ball is the catcher's, so the pitcher gets no "handed over a run" alert for it; he still gets "Gives up runs" for the run when that's on.

### Gives up a home run

- **Trigger:** a play with a pitcher role whose text has "homered". Runs = the play's `scoreValue` (at least 1).
- **Title:** "Gerrit Cole gave up a 371-foot 2-run homer", "Tommy Kahnle gave up a 390-foot solo homer", "Tommy Kahnle gave up a 412-foot grand slam" (4 runs), and without a distance "Tommy Kahnle gave up a solo homer" (`test/sport-alerts.test.ts`). The distance is ESPN's "(348 feet)" in the text.
- **Back-to-back:** when the previous at-bat result (`g.lastResult`) was also a homer, in the same half-inning, off the same pitcher, the count goes up (`g.homerRun`): "Gerrit Cole gave up back-to-back homers (380 feet)", then "back-to-back-to-back homers (410 feet)" and "back-to-back-to-back-to-back homers (399 feet)" (`test/sport-alerts.test.ts`). The feet are the latest homer's.
- **Every homer is its own alert,** with `aliases: ['mlb.pitcher.runs_allowed']`. So a homer counts as "Gives up runs" too: with "Gives up a home run" off and "Gives up runs" on, the homer still arrives (as that type's push decision: see [How every alert is delivered](#how-every-alert-is-delivered)). README's note under Settings says the same.
- **With the team tracked too,** the pitcher's homer and the team's scored-on alert share the play's moment (`bundleByPlay`): "Gerrit Cole gave up a 402-foot solo homer" with "Rays took the lead." as a line (`test/bundling.test.ts`).
- **ESPN changes the distance** (NLCS Game 2, October 12 2026: 388 feet, rewritten to 436 five minutes later): every alert the homer made gets a line, no push, "ESPN corrected the distance: 436 feet." (`revisedResult`; a `foldOnly` alert on the alert's moment, its id the alert's with the line's words hashed).
- **The runners on base came against others:** the homer is the pitcher on the mound's, and their runs are their own pitchers' [Gives up runs](#gives-up-runs-feed-only-by-default) alerts.

### Hands over a run

- **Trigger, three ways** (only on a scoring play, with a pitcher role):
  - a wild pitch or a balk: the text matches `scored on (a(n)) (Name )wild pitch|balk` (`GIFT_RUN`). Title "Gerrit Cole let a run score on a wild pitch" ("Diaz scored on Cole wild pitch.") or "Gerrit Cole balked in a run" ("Diaz scored on a balk.").
  - a walk or hit batter with the bases loaded: an at-bat result with "walked" or "hit by pitch" and no hit in it. Title "Gerrit Cole walked in a run" or "<Name> hit a batter in a run".
  - a passed ball is the catcher's ([above](#lets-a-run-score-on-a-passed-ball-catchers-only)), not this.
- **Aliases:** wild pitch and balk count as `mlb.pitcher.runs_allowed`; a walk or hit batter counts as `mlb.pitcher.runs_allowed` and `mlb.pitcher.walk`. It goes out in place of that run's "Gives up runs" alert, never next to it.
- **A runner who came against an earlier pitcher** (NLCS Game 3, October 14 2026: Turang walked against Sasaki, scored on Wrobleski's wild pitch): the gift run is the pitcher on the mound's, and the pitcher the runner reached against (`chargedRuns`) gets the usual "Gives up runs" alert, "Roki Sasaki gave up 1 run", keyed on the text like the gift run. A passed ball is the catcher's, so no pitcher gets this.
- **Ids:** wild pitches and balks are keyed on the half-inning and the text (`textId`), because ESPN posts the runner's run twice. A bases-loaded walk uses the play id.

### Gives up runs (feed only by default)

- **Trigger:** any scoring play with a pitcher role that isn't a homer or a handed-over run. Each run is the pitcher's who put the runner on (`chargedRuns`), as the box score charges it, not the one on the mound: ALCS Game 1 (October 12 2026), Lowe's single against Seymour scored Ramírez and DeLauter, who reached against Wells, and the alert read "Ian Seymour gave up 2 runs"; in the 9th "Kevin Kelly gave up 2 runs" for Sulser's runners (NLCS Game 2's Dustin May was the first). `observePlay` keeps the pitcher each runner reached against (`g.owner`: the pitcher on the play that put him on base; a pinch runner takes the one he ran for), rebuilt from history after a restart. The scorers are the batter and everyone on base for a homer, else the names the text says "scored"; they must be on base and add up to the play's runs, or the pitcher on the play gets all of them, as before. One alert for each pitcher charged. Earned runs are not told apart (docs/known-limits.md).
- **A result that becomes a scoring play after it was posted** (a replay review gave the run back: Ramírez's play in the top of the 9th, ALCS Game 1): the team's alerts come from the score; the pitcher's is made when the rewrite arrives (`revisedResult`), for the pitcher the play names, since the bases have moved on.
- **Title:** "Gerrit Cole gave up 1 run", "…gave up 2 runs".
- A run that scores on a passed ball keeps its "Gives up runs" alert for the pitcher, keyed on the text like the gift runs.

### Issues a walk / HBP (off by default)

- **Trigger:** an at-bat result with "walked" or "hit by pitch" that isn't a bases-loaded walk-in (that one is "Hands over a run").
- **Title:** "<Name> issued a walk" or "<Name> plunked a batter".
- **With the bases loaded on that play:** the team's [Opponent loads the bases](#mlb-opponent-loads-the-bases) alert comes first in the play's list, so a device tracking the team and the pitcher gets one alert with "Gavin Williams issued a walk." as a line (`test/alds-game5.test.ts`).

### How these combine

- Every play alert without a moment of its own gets the play's moment for its team (`bundleByPlay`), with its title as its line (`asLine`). A device that tracks a player and his team, or two players on one team, gets one alert per play: the first in the list it wants, and the rest as lines. "Aaron Judge struck out swinging" with "Yankees went down in order." as a line is one alert (`test/bundling.test.ts`).
- The order on a play: the batter's alert, then "Opponent loads the bases", then the pitcher's, then the catcher's, out on the bases, caught stealing, the scoring-position alert, challenges, errors (`mlb()`).
- The team's scored-on or fell-behind alert for the same play is in the same moment ([Scored on + fell behind](#scored-on--fell-behind)).

**Tests:** `test/sport-alerts.test.ts` (homers, gift runs, passed balls, multi-strikeouts, out on the bases), `test/mlb-outs.test.ts` (outs, double and triple plays), `test/logic.test.ts`, `test/bundling.test.ts` (one alert per play), `test/positions.test.ts` (which of these show for a pitcher or a hitter).

## NFL

The NFL's player alerts from single plays (interceptions, sacks, incompletions, fumbles, missed kicks, flags, a touchdown wiped out, a quarterback pulled, an ejection) and the team's drive alerts (three-and-out, on downs, the red zone), and a game that ends tied ([A tied game](#a-tied-game)). Delay of game and safeties are in [NFL delay of game / safety](#nfl-delay-of-game--safety), onside kicks in [NFL onside kick](#nfl-onside-kick), college football's team versions in [College football](#college-football).

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `nfl.qb.interception` | Throws an interception | player, only QB | Offense | push |
| `nfl.fumble_lost` | Loses a fumble | player, not OT, G, C, OL, DE, DT, PK, LS | Offense | push |
| `nfl.qb.pulled` | Gets pulled | player, only QB | Offense | push |
| `nfl.qb.sacked` | Gets sacked | player, only QB | Offense | feed only |
| `nfl.qb.incompletion` | Throws an incompletion | player, only QB | Offense | off |
| `nfl.fumble` | Fumbles (any) | player, not OT, G, C, OL, DE, DT, PK, LS | Offense | off |
| `nfl.td_wiped_out` | Touchdown wiped out by a penalty | team and player | Penalties | push |
| `nfl.penalty` | Commits a penalty | player and team | Penalties | feed only |
| `nfl.kicker.miss` | Misses a kick | player, only PK | Special teams | push |
| `nfl.team.turnover_on_downs` | Turns it over on downs | team | Team | push |
| `nfl.team.red_zone_empty` | Comes away empty from the red zone | team | Team | push |
| `nfl.team.three_and_out` | Goes three-and-out | team | Team | feed only |
| `nfl.team.tied` | Ties a game | team | Team | feed only |
| `player.ejected` | Gets ejected | player | Game | push |

**Where the plays come from.** The NFL's plays come from ESPN's core plays feed only: the site summary has drives without participants, so `GameTracker.poll` leaves its plays out for the NFL (`sitePlays` is empty for `nfl`). The summary is still read every 2 seconds, for the status, the header's score and the drives. The detector is `nfl()` in `detectors.ts`.

**What stands on a play.** `ruled(text)` keeps only what follows "the play was REVERSED." when a review reversed the call, because ESPN keeps the overturned call in front. A play is `wiped` when what stands says "No Play" (a penalty wiped it out). A wiped-out play sends only its flags: no interception, sack, incompletion, fumble or missed kick. Over the first five weeks of 2026, 73 of 734 wiped-out plays kept their original type (sacks wiped out by defensive holding, incompletions by pass interference), which is why the type alone isn't trusted.

### Throws an interception

- **Trigger:** a play with a `passer`, not wiped out, whose type has "Interception".
- **Title:** "Patrick Mahomes threw an interception" (`test/play-revisions.test.ts`), with " — returned for a TD 🙃" when the type has "Touchdown" (a pick-six).
- Quarterbacks only on a player's settings screen (`positions: only QB`).

### Gets sacked (feed only by default)

- **Trigger:** a passer on a play that isn't wiped out, whose type starts with "Sack" or whose text (as it stands) has "sacked". The text matters: a sack where the offense recovers its own fumble is typed "Fumble Recovery (Own)" (Lawrence twice, Eagles at Jaguars, October 11 2026; 12 of 281 sacks in weeks 1 to 5 weren't typed "Sack").
- **Title:** "Aaron Rodgers got sacked", "Patrick Mahomes got sacked".
- **On a two-point try** ("… TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. M.Stafford is sacked. ATTEMPT FAILS.", Rams, October 12 2026) it isn't a down, and the box score counts no sack. The down is the text before the try: a sack there is a sack as always. One in the try is **"Matthew Stafford got sacked on the two-point try"**, with the try as its body: "The Rams' two-point try failed: M.Stafford is sacked. ATTEMPT FAILS. — BUF 19, LAR 20". ESPN adds the try to its touchdown's text some seconds after posting it, so the alert comes as a revision. Test `test/bills-rams.test.ts`.
- Feed only by default since October 2026; installs from before kept it pushed (`WERE_PUSHED` in `fanout.ts`).

### Throws an incompletion (off by default)

- **Trigger:** a passer, not wiped out, type "Pass Incompletion". **Title:** "<Name> threw incomplete".

### Loses a fumble, and fumbles (any)

- **Who fumbled:** the play's `fumbler` participants, less anyone listed as `forcedBy` (ESPN can name the defender who forced a strip-sack as its fumbler and leave the quarterback out: Barmore on Rodgers, Steelers at Patriots). When the text says "…sacked … . FUMBLES" and the passer isn't listed, the passer is added as the fumbler.
- **Lost or kept:** the text's "RECOVERED by XXX-" codes (capitals: the ball changed hands) are mapped to ESPN's abbreviations (`NFL_CODE`: ARZ→ARI, BLT→BAL, CLV→CLE, HST→HOU, LA→LAR, WAS→WSH, JAC→JAX). Lost when any recovering team isn't the fumbler's. With no such code, the type decides: "Opponent", "Opp Fumble" or "Fumble Return" means lost. So a strip-sack the defense recovers ("Sack Opp Fumble Recovery", 21 in weeks 1 to 5) and a kick returner's fumble the kicking team recovers (typed just "Kickoff", 6) count as lost.
- **Titles:** "Chimere Dike lost a fumble", "Aaron Rodgers lost a fumble — returned for a TD 🙃" (a touchdown on the return: the type says Touchdown, or "TOUCHDOWN" follows the recovery in the text), "Bijan Robinson fumbled" (kept; `test/sport-alerts.test.ts`).
- **A muffed catch the other team recovers:** "J.Cowing MUFFS catch, RECOVERED by SEA-E.Saubert" is typed "Muffed Punt Recovery (Opponent)" and lists Cowing as the `returner`, not a `fumbler`, so the `returner` of a play whose text says MUFFS counts as the fumbler when a capitalized "RECOVERED by" names another team (49ers at Seahawks, October 11 2026; five such muffs in the season's finished games, none alerted before). A muff the returner recovers himself ("and recovers") sends nothing. College football's version already read it from the side that ended with the ball (`cfb.team.fumble_lost`).
- **A lost fumble counts as "Fumbles (any)"** (`aliases: ['nfl.fumble']`). On a strip-sack the lost fumble goes in front of the quarterback's sack alert, so a device gets "lost a fumble" with the sack as its line.
- Ball carriers only on a player's screen (not OT, G, C, OL, DE, DT, PK, LS).

### Misses a kick (kickers only)

- **Trigger:** not wiped out, and the type is "Field Goal Missed", "Blocked Field Goal", "Blocked PAT" or "Missed PAT", or the text says "extra point is no good" or "kick is blocked". The kicker is the first `kicker` or `patScorer` participant.
- **Title:** "<Name> got a kick blocked", "<Name> missed the extra point", or "<Name> missed a field goal".

### Commits a penalty (feed only by default for installs from October 11, 2026)

- **Trigger:** every participant ESPN lists as `penalized` on the play, wiped out or not. **Title:** "Robert Hainsey was flagged", with " (declined)" when the text says declined.
- **A team's flags** (`teamFlags` in `detectors.ts`; the same setting, listed on a team's page too, `alsoScope: 'team'`, so no new alert type): every flag against a team, whether or not ESPN names a player, is one alert for the team's trackers: "Bills were flagged: Illegal Shift" (no player named), "Bills were flagged: Offensive Holding, Unnecessary Roughness" (two on one play), "Rams were flagged: Defensive Offside (declined)"; offsetting flags flag each team. Id `${gameId}:${playId}:nfl.penalty:team-${teamId}`. A flag with no player alerted nobody before: the player alerts go to the player's trackers only (Bills at Rams, October 12 2026: a tracker of the team alone got none of that game's flags, 22 flag plays with a player named and the Bills' Illegal Shift with none).
  - **Always feed only** (`noPush`): installs from before have `pushTypes['nfl.penalty'] = true` (for players' flags), and every flag on a tracked team would be the 14 pushes for 19 flags again. The 🔔 of "Commits a penalty" on a team's page does nothing for the team's flags.
  - **A weak alert**: it takes the play's moment for that team with no fold and is published after the poll's other alerts (`afterOthers`), so a device that has the player's flag, a touchdown wiped out, a safety, a score alert or a drive's result gets that alert and nothing extra, and the flag never takes the moment from a pushed one. A pushed alert that comes after it (a drive's result a poll later: `turnover_on_downs`, `red_zone_empty`) is an alert of its own and keeps its push (`weak` in `publish`), and a line about an alert the device doesn't hold doesn't land on it. The one thing it holds is the same flag with its player named a poll later (ESPN posts a flag for the team and adds the penalized player: the Dolphins' kickoff, 96 seconds on), when that wouldn't push: "Anton Harrison was flagged." is a line on the team's row. A player's flag that pushes (installs that keep flags pushed) keeps its own row beside it.
  - **Checked** by replaying the 12 October 11 NFL games, Sunday night and Monday night with team-only devices (438 team flags gained, no alert, push or line lost) and with a team and every player (no alert lost; 34 gained: 10 as a line on the player's row, 8 beside a pushed player flag, the rest flags with no player alert), and the October 10 college games (unchanged). `test/bills-rams.test.ts`.
- **Replaced by something more specific** on the same play for the same player (the `replace()` helper in `nfl()`): a safety from a flag in the end zone, the quarterback's own delay of game, an ejection, a touchdown his flag wiped out. The specific alert carries `aliases: ['nfl.penalty']`. (A team's flag is not replaced: it is the team tracker's alert, a line at most for anyone else.)
- **Default:** feed only for installs from October 11, 2026 (the Jaguars, team and players, got 14 pushes for flags of 19 in London). Installs from before keep flags pushed: `keepFlagsPushed()` in `fanout.ts` wrote `pushTypes['nfl.penalty'] = true` into every existing device once (kv `prefs:nfl-flags-feed`).
- **Revisions:** a flag ESPN moves to another player, or takes off, is a line on the alert that went out: "ESPN has since charged this flag to Robert Hainsey." or "ESPN has since taken the flag off." (Eagles at Jaguars, October 11 2026, `test/play-revisions.test.ts`); a flag it declines, "ESPN has since declined this flag."; one that stands and one that became an ejection get no "taken off" line (below). See [Revisions](#revisions-espn-changes-a-football-play-after-its-alert).

### Touchdown wiped out by a penalty

- **Trigger:** what stands of the play says "TOUCHDOWN NULLIFIED" ("TOUCHDOWN NULLIFIED by Penalty. PENALTY on GB-A.Belton, …").
- **Two alerts:** the flagged player's (`flaggedFor`: the penalized player whose name matches the first "PENALTY on XXX-F.Last"), "<Name>'s penalty wiped out a touchdown", in place of his penalty alert; and his team's, "Packers had a touchdown wiped out by a penalty" (`test/sport-alerts.test.ts`), id `${gameId}:${playId}:nfl.td_wiped_out:team-${teamId}`.
- It still pushes for new installs (unlike plain flags).

### A tied game (feed only)

- **Trigger:** the NFL's final with equal scores (overtime can end level: Giants at Commanders, 27-27, October 11 2026). It's no loss, so no Successful Hate Watch and no loss facts (`gameTiedEvents` in `detectors.ts`, published from `GameTracker.finish`).
- **Title:** "Giants tied the Commanders, 27-27", one alert per team, body "Final Score: 27 to 27. Nobody won.". Both teams share the moment `${gameId}:final:tied`; a device tracking both gets the one it followed first (`firstFollowed`). Id `${gameId}:final:nfl.team.tied:${teamId}`.
- **Test:** `test/play-revisions.test.ts`.

### Gets pulled (quarterbacks)

- **Trigger** (`qbPulled`): the starting quarterback is the first QB to throw for a team (`observePlay` records `qbStart`, counts passes `qbAtt`, and counts passes in a row by another QB `qbOther`). In the first three quarters, after the starter's 5th pass, another QB throws twice in a row: the starter has been pulled. Once a game per team (`qbPulled`). One pass by someone else is a package play, not a change.
- **Title:** "Jordan Love got pulled: Malik Willis is in at quarterback". **Body:** "Benched or hurt: ESPN doesn't say. " then the play and score.
- Never re-run on a revised play (`ONCE` in `revisions.ts`).

### Gets ejected (NFL)

- **Trigger** (`disqualified`): the text has "PENALTY on XXX-F.Last, Disqualification". The player is the only `penalized` one, or the one whose name matches, or (when offsetting flags leave ESPN's penalized list out: TEN-M.Brown, 2025) the one player on that team's roster with that initial and last name. It counts even on a wiped-out play.
- **Title:** "Daron Payne got ejected", "Mike Brown got ejected", "Aaron Banks got ejected" (`test/new-alerts.test.ts`, `test/sport-alerts.test.ts`). It replaces his penalty alert (`aliases: ['nfl.penalty']`).
- The type `player.ejected` is shared with the NHL ([NHL](#nhl)). NBA ejections are under its technical-foul alert and soccer's under "Sent off"; ESPN doesn't report MLB ejections (the type's own description in `event-types.ts`).

### Drives: three-and-out, turned over on downs, empty from the red zone

From the summary's finished drives (`nflDriveEvents` in `detectors.ts`), read every poll through `PlayLedger.drivesRead` (`server/src/revisions.ts`). The first read's drives are history.

- **Three-and-out (feed only by default):** the drive's result is PUNT, with 3 or fewer offensive plays and under 10 yards. Title "<Team> went three-and-out", fold "Three-and-out.".
- **Turned over on downs:** result DOWNS. Title "Packers turned it over on downs" (`test/sport-alerts.test.ts`), fold "Turned it over on downs.".
- **Came away empty from the red zone:** the offense snapped the ball inside the other side's 20 (read from each play's down and distance, "1st & 10 at NYG 13", since ESPN's `yardsToEndzone` is 0 on timeouts and wrong on punts; timeouts, punts and kickoffs don't count) and the drive ended in anything but TD, FG or END OF GAME. Title "Packers came away empty from the red zone (downs)", fold "No points from the red zone (downs).".
- **Body:** ESPN's drive description and its result, lowercased, then the score: "<description>, <result> — <score>".
- **The drive's deciding play:** its last play that isn't a timeout, period end or two-minute warning. The drive alerts take that play's id, so they share its moment: a device tracking the quarterback whose interception ended it gets one alert, the interception, with "No points from the red zone (interception)." as a line. The drive's result often comes a poll after its last play; it is then a late line on the alert the device already has ([How every alert is delivered](#how-every-alert-is-delivered)).
- **Ids:** `${gameId}:drive:${driveId}:${type}`.

### Revisions: ESPN changes a football play after its alert

Alerts go out the moment a play is first seen; nothing waits for a review. ESPN then edits plays in place, takes them out, re-posts them under new ids and changes how drives ended. `PlayLedger` in `server/src/revisions.ts` keeps each play's alerts for 15 minutes (`REVISE_MS`; basketball 45, `BASKETBALL_REVISE_MS`) and compares them with the play on every read (basketball uses the same ledger: [Revisions: ESPN changes a basketball play after its alert](#revisions-espn-changes-a-basketball-play-after-its-alert)):

- **An alert the play no longer has** gets a line on it, no push (`changeLine`): "Wiped out by a penalty on Indiana: Roughing The Passer." (`wipedOutLine`: the last flag before "No Play" that wasn't declined; "Wiped out by offsetting penalties." when they offset), "Overturned on review." (the text mentions a review), "ESPN has since changed this play to a <ESPN's new type, lowercased>.", or "ESPN has since taken this play back." when it is gone.
- **An alert the play has now and didn't before** goes out then: an incompletion that became an interception, a flag added later (feed only, like any flag).
- **An alert the play still has, when ESPN rewrites the play's words or score** takes them on its row, with no push and no line (`retext` in `revisions.ts`, `GameTracker.retext`, `reviseEvent`): a sack first read as "loss of 0 yards" becomes "loss of 7 yards to the Jax ST20", a touchdown first read at 6 points gets "kick attempt good" and the level score (FIU at Jax State, October 13 2026: both sacks, and five of the six touchdowns, whose extra point arrives 15 seconds to 2.5 minutes later). It is the row's body (ESPN's words and "— FIU 17, JXST 17") that changes, and only a body that is exactly the play's old words and score, so a quarterback-pulled alert's own sentence is left alone; the title does not change ("FIU scored 6 on Jax State" stays, with "FIU tied the game, 17-17." as its line), and an alert the play no longer has keeps its words and its "wiped out" line.
- **An alert taken back that the play has again** gets a line, never a second alert: "Overturned on review: it stands.", "ESPN has since put this play back.", or "ESPN has since changed this play back.".
- **A flag that moved or came off** while its play stands: "ESPN has since charged this flag to Robert Hainsey." or "ESPN has since taken the flag off.". A device that had the first player's flag gets that line, not the new player's flag as a second alert (`alt` group `flag-moved:<playId>`).
- **A flag that still stands** is kept (`flagStands` in `revisions.ts`): ESPN drops the flagged player from the play's data, or relabels him "other", a read later while the text keeps "PENALTY on LV-M.Crosby, Unnecessary Roughness, 15 yards, enforced between downs." (the call that stands, by surname; a declined flag is written "Penalty on …, declined"). "Taken the flag off" was true for 1 of the 5 flags that got it in the October 11 2026 games (Raiders at Patriots, Bengals at Dolphins, Broncos at Chargers, 49ers at Seahawks).
- **A flag ESPN declines** after posting it (Que Robinson's offside, Broncos at Chargers): "ESPN has since declined this flag." (NFL).
- **A flag that became an ejection** (Dre Greenlaw's unnecessary roughness became a disqualification): the ejection alert replaces the flag alert, so the flag says nothing of its own and the ejection's line follows ("Dre Greenlaw got ejected.").
- **A quarterback's delay of game** that turns out to be the punt or field goal team's ("(Punt formation)" added 12 seconds later, C.J. Stroud, Texans at Titans): "ESPN has since put this on the punt team." ("the field goal unit").
- **A lost fumble the play no longer has but still shows as a fumble** (the offense recovered it): "ESPN has since corrected it: the Browns kept the ball." (`goneLine`; college football's team version the same).
- **ESPN's play types in plain words** in "ESPN has since changed this play to …" (`plainType`): "a fumble its own team recovered", "a strip-sack the defense recovered", "an interception", "a catch", "a run", "a punt", "a kickoff"; any other type is ESPN's own, lowercased.
- **After the final** the tracker goes on reading a football game's plays and drives for 3 minutes (`correctionsAfterFinal` in `live.ts`, every 10 seconds; `HW_FINAL_CORRECTIONS_MS`, `HW_FINAL_CORRECTIONS_POLL_MS`), so ESPN's corrections after END GAME are revisions like any other: an overtime's last play that became a Jayden Daniels sack 36 seconds after the final (Giants at Commanders) is now an alert, a flag named late goes out. ESPN can change a play more than once in that time (Browns at Jets: a lost fumble became the offense's own recovery at 24 seconds, and at 60 seconds the same play showed a second fumble the Jets recovered); each change is a line, in order (`test/final-corrections.test.ts`). What the reads after the final find goes to the feed and never pushes (`noPush` on the alert), because ESPN's data can still flip back: the Browns' drive ended FUMBLE, DOWNS, FUMBLE inside 36 seconds, which would have pushed a false "turned it over on downs". Not kept across a restart.

- **A re-post** under a new id at the same spot (`samePlay`: the same period, a start within 10 seconds by the "(12:21)" its text opens with, the same player) is that play, revised.
- **A play gone** from the feed for 30 seconds (`GONE_MS`) has its alerts taken back; a single short read doesn't count.
- **A flag ESPN posts again as a play of its own** (college football, `PlayLedger.flagCopy`): a "Penalty" row with only the flag and "NO PLAY", at the same period and clock as an earlier play that already sent that flag (first seen within 5 minutes, `FLAG_COPY_MS`), is no second card: the first card gets the line "ESPN posted this flag again as a play of its own: 15 yards from WKU30 to WKU45, 1ST DOWN." (Sam Houston's unnecessary roughness, WKU at SHSU, October 14 2026: plays 731 and 748, 2 minutes 15 seconds apart at 4:08). `test/play-revisions.test.ts`.
- **An overturned review's quoted original** (college football): "CALL OVERTURNED. (Original Play: … PENALTY SAM Targeting …)" is the play that stands plus the call that didn't, so the detectors read only the text before "(Original Play:" (`standing` in `detectors.ts`): no "Sam Houston was flagged: Targeting" (WKU at SHSU, play 375).
- **A drive whose result changed** gets "ESPN has since changed how the drive ended: <result>." on its alerts, and its new alerts go out.
- **Scores** are taken back only when the plays, the score the latest plays carry and the header agree, two reads running (`footballTakeBack` in `live.ts`); the same side scoring again on that drive within 10 minutes (`RESCORE_MS`) is a line ("Then Wake Forest scored on the same drive: WAKE 16, NCSU 14.", `againLine`), not another alert. When ESPN's running score was wrong for a while, the line is "ESPN has since corrected the score: …".
- **When the plays lag the score** (Missouri's last touchdown against Texas A&M never reached the drives), the header's score held 3 or more points ahead for 60 seconds (`HEADER_AHEAD_MS`), while no play from that game clock on has it, sends the score alert without its play ("ESPN's play-by-play doesn't have this play yet", `headerAhead`). The same alert goes out from the final score in `finish()` when the final is 3 or more ahead of what was announced (Missouri State's winning field goal never reached ESPN's plays), and the later polls never take it back. It is feed only (a finished game pushes only its loss); the play, when ESPN adds it later, is that alert's play, not a second alert.
- **A football touchdown whose words aren't one** ("for 54 yards loss to the MSU00 TOUCHDOWN": ESPN posted Kennesaw State's phantom touchdown for 15 seconds) waits up to 60 seconds (`SCORE_WORDS_WAIT_MS`, `impossibleTouchdown` in `detectors.ts`) for ESPN's rewrite; its score alert and the header's go out only when the words are real or the wait ends.
- **A drive that ends in kneel-downs** (ESPN labels the run-out DOWNS) is no "turned it over on downs" and no "came away empty from the red zone" (`nflDriveEvents`).
- **An extra point or two-point try** never alerts on its own: a side's score going up by 1 or 2 without a safety is said with its touchdown (`footballScore`).
- **A score that levels the game says so** ("Rams tied the game, 34-34.", `tiedLine` in `detectors.ts`): a line, with no push, on the scored-on side's alerts for that score. The Rams' touchdown at 34-33 with 5 seconds left in the 4th became 34-34 when ESPN added the extra point 24 seconds later, and the Bills' trackers had only "Rams scored 6 on the Bills" (Bills at Rams, October 12 2026). So when the kick (or a two-point try) is what levels the score, `footballScore` puts the line on the touchdown's alerts (on its play, or, when ESPN puts the kick on a play of its own, the side's latest scoring alerts, `lastScored`, in memory). A field goal, or a touchdown whose kick is already in its text, that levels the game says it with its alert, in the same publish. A touchdown still waiting for its kick (`kickPending`: "TOUCHDOWN" with no extra point, "kick attempt" or two-point try in its text) isn't said to tie: the kick usually makes it a lead (Rams 6-6 then 7-6, 13-13 then 14-13 in that game), and a tie the kick then misses is not said (a gap). The fold of the scored-on alert has the same words, so a device that tracks a player on the play too gets the line once; for a touchdown still waiting for its kick the fold says "<Opponent> scored 6." (it said "tied the game." before). **College football gets the same**, since the tracker is shared: "Army tied the game, 17-17." on Tulane's alert (checked by replaying the October 10 noon games and the October 11 and 12 NFL games with the old and the new code: no alert, push or title changed, only lines were added). Test `test/bills-rams.test.ts`.
- **"End of Game"** ends a football game only after a 4th-quarter play (ESPN once put one after the 3rd quarter at Missouri).
- Lines reach a device through the alert it got for that play, kept in memory for 6 hours (`LATE_FOLD_MS`), not across a restart.

**Tests:** `test/play-revisions.test.ts` (recorded college and NFL games, poll by poll), `test/sport-alerts.test.ts`, `test/logic.test.ts`, `test/new-alerts.test.ts`, `test/positions.test.ts`.

## NFL delay of game / safety

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `nfl.qb.delay_of_game` | Delay of game | player, only QB | Offense | push |
| `nfl.safety` | Gives up a safety | team and player, not DE, DT, LB, CB, S, DB, PK, LS | Offense | push |

### Delay of game

- **ESPN charges it to the team:** "PENALTY on PIT, Delay of Game, 5 yards, enforced at …", with no player. `delayOfGameQb()` in `detectors.ts` gives it to the offense's quarterback.
- **Skipped when:** the flag is declined or offsetting (anywhere in the text), the formation in brackets is a punt, field goal or kick ("(Punt formation)", "(Field Goal formation)"), or the flagged team isn't the offense (the play's team, compared after mapping NFL codes with `NFL_CODE`: ARZ, BLT, CLV, HST, LA, WAS, JAC to ARI, BAL, CLE, HOU, LAR, WSH, JAX).
- **The quarterback:** a penalized participant who is a QB, when ESPN names one; otherwise the offense's quarterback in the game right now (`g.qbs`, the latest passer the roster lists as a QB, set by `observePlay`; a trick-play pass by a non-QB doesn't change it).
- **Title:** "Jordan Love took a delay of game penalty" (`test/sport-alerts.test.ts`). When ESPN named him as penalized, it replaces his "Commits a penalty" alert (`aliases: ['nfl.penalty']`); when he was only inferred, there was no penalty alert for him to replace.
- Still pushed by default for new installs (README "Defaults").

### Gives up a safety

- **What counts** (`isSafety`): a scoring play whose type is "Safety" or whose text says "SAFETY", and not "NULLIFIED" (overturned safeties are ignored).
- **The team's alert** comes from the score change (`teamScoreEvents`): a 2-point score by the other side in football that is a safety. Title "49ers gave up a safety". It replaces "Opponent scores" for that play and counts as it (`aliases: ['team.opponent_scored']`). When the safety also puts them behind, the safety alert says so itself ("<Team> gave up a safety and fell behind the <Opponent>", "…fell behind MTSU" for a school) and "Falls behind" yields to it (`unless` the safety's type), so a default device gets one pushed alert, the safety; a device with the safety off still gets "Falls behind" ([Scored on + fell behind](#scored-on--fell-behind)). Before October 14, 2026 it was the other way round and the default push was lost (Delaware at Middle Tennessee, a safety that put Delaware behind 5-3). A play ESPN first posted as a sack and made a safety after its sack alert went out is the same: the sack's alert is taken back (its line says "ESPN has since changed this play to a safety.") and gives up the play's moment (`releases`), so the safety goes out as an alert of its own, pushed.
- **The player responsible** (`safetyVictim`): the penalized player when the text has "PENALTY on" ("…PENALTY on SF-D.Puni, Offensive Holding, … enforced in End Zone, SAFETY - No Play.": "<Name> got flagged in the end zone for a safety", replacing his penalty alert); the passer on a sack ("<Name> got sacked in the end zone for a safety", replacing his sack alert); otherwise the first rusher, receiver, returner, fumbler or passer ("<Name> gave up a safety", neutral wording so a punter running out of the end zone on purpose fits).
- **One type, both scopes:** `nfl.safety` is a team type with `alsoScope: 'player'`, under "Offense", for offensive players only on a player's screen (not DE, DT, LB, CB, S, DB, PK, LS).
- **Ids:** the team's `${gameId}:${playId}:nfl.safety:team-${teamId}`, the player's `${gameId}:${playId}:nfl.safety:${athleteId}`. The two share the play's moment for that team (`bundleByPlay`), so a device tracking both gets one.

**Tests:** `test/logic.test.ts` (both), `node test/replay.ts` on recorded games.

## NFL onside kick

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `nfl.team.onside_recovered` | Opponent recovers an onside kick | team | Special teams | push |
| `cfb.team.onside_recovered` | Opponent recovers an onside kick | team | Special teams | push |

- **Trigger** (`onsideRecovered()` in `detectors.ts`): a play whose text has "kicks onside" (NFL: "J.Slye kicks onside 9 yards from TEN 35 to TEN 44. …") or "onside kickoff" (college), and doesn't have "No Play" or "NULLIFIED".
- **Kicking and receiving:** the kicking team is the play's team (`start.team`, `teamId`); the receiving team is the other side of the game.
- **Recovered:** the kicking team still has the ball at the end (`end.team`, `endTeamId`, on every kickoff in the core feed). If ESPN leaves the end team out, the last "RECOVERED by XXX-" in the text decides (NFL codes mapped with `NFL_CODE`, so BLT is BAL).
- **Who gets it:** the receiving team, the one that let it happen. Title "Titans recovered an onside kick against the Ravens" (`test/logic.test.ts`); college "California recovered an onside kick against UNLV" (`test/cfb.test.ts`: schools don't get "the"). Body: the play's text and score.
- **Type by league:** `footballType(lg, 'team.onside_recovered')` gives `nfl.team.onside_recovered` or `cfb.team.onside_recovered`. Id `${gameId}:${playId}:<type>:${receivingId}`.
- **Real data:** the README row records the four real onside attempts in 2026 weeks 3 and 4, all recovered by the receivers, so no alerts.

## NBA

The NBA's player alerts from plays, the box score at halftime and at the final, and the team alerts that are basketball's own. The WNBA has a copy of each ([WNBA](#wnba)).

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `nba.got_blocked` | Gets blocked | player | Offense | push |
| `nba.missed_free_throw` | Misses a free throw | player | Offense | feed only |
| `nba.turnover` | Turns it over | player | Offense | feed only |
| `nba.brick_night` | Has a brick night | player | Offense | feed only |
| `nba.scoreless_half` | Scoreless at the half | player | Offense | feed only |
| `nba.missed_shot` | Misses a shot | player | Offense | off |
| `nba.technical` | Technical foul / ejection | player | Fouls | push |
| `nba.fouled_out` | Fouls out | player | Fouls | push |
| `nba.foul` | Commits a foul | player | Fouls | off |
| `nba.team.star_went_off` | Opponent's star goes off | team | Team | push |
| `nba.team.opponent_run` | Opponent goes on a run | team | Team | feed only |

**Where the plays come from.** Both ESPN feeds every 2 seconds, merged by id. The detector is `nba()` in `detectors.ts`, shared by the WNBA. The core feed labels its participants (shooter, blocker, fouler, offense, defender); the summary's plays don't. So the player is the participant whose catalog team is the play's team (`onTeam`), else the first participant. ESPN posts these plays half-finished and edits them: see [Revisions: ESPN changes a basketball play after its alert](#revisions-espn-changes-a-basketball-play-after-its-alert).

### Gets blocked

- **Trigger:** a shooting play that didn't score, whose text has "blocks". The shooter is the participant on the play's team, else the one ESPN labels the shooter (`role(p, 'shooter')`). Never "the second player listed", who is the blocker: when the shooter wasn't in the catalog the blocker got his alert (Reed Sheppard, for Cooper Flagg's blocked layup, in Dallas at Houston, October 11 2026). A play without roles and without a shooter on its team alerts nothing.
- **Title:** "<Name> got sent back ✋". It counts as a missed shot too (`aliases: ['nba.missed_shot']`), so nobody gets both.

### Misses a free throw (feed only by default)

- **Trigger:** a shooting play that didn't score, with "free throw" in the text or type and "miss" in the text. **Title:** "<Name> missed a free throw".

### Misses a shot (off by default)

- **Trigger:** a shooting play that didn't score, with "miss" in the text, not a free throw or a block. `missedShot()` says it as a fan would.
- **The shot's name:** ESPN's type mapped through `SHOT_NAME` ("Pullup Jump Shot" → "pull-up jumper", "Driving Floating Jump Shot" → "driving floater", "Driving Layup Shot" → "driving layup", "Tip Shot" → "tip-in", …); any other type is ESPN's own, lowercased, without "shot". A three keeps a jump shot's move ("step-back three", "pull-up three"); anything else ESPN calls a three is just "three".
- **The distance:** ESPN's "27-foot" in the text, else measured from where the shot was taken (ESPN's court coordinates, the rim at 25,1; within a foot of ESPN's 94% of the time over 616 shots, October 2026). No distance under 5 feet.
- **A shot ESPN hasn't typed yet:** ESPN posts every shot as "No Shot (Default Shot)" ("misses shot") and types it 85 seconds to 23 minutes later (`UNKNOWN_SHOT`). A missed one waits up to 15 seconds for its type (`SHOT_WAIT_MS`, `HW_SHOT_WAIT_MS`; `awaitingShotType`, not at the final, not for a play already a block), so the alert names the shot: in Warriors vs Lakers (October 13 2026) ESPN typed 44 of 57 within 10 seconds and 55 within 30, and three blocks that were first posted as misses went out as "got sent back" at once. One still untyped after 15 seconds is an unknown shot, with the distance and "three" it has: "Donovan Mitchell missed a 29-foot three", "…a 9-foot shot", "…a shot". Before October 12, 2026, 37% of the missed-shot alerts in the three preseason games read "missed a no shot (default shot)" (production pushed 6 of its 13 in Bulls at Nuggets).
- **No alert for a heave:** ESPN's type says heave, or the shot was 40 feet or more out.
- **Late and close** (`lateAndClose`): in the last 30 seconds of the 4th quarter or overtime, when the shot would have tied it or given them the lead: " to tie it with 0.4 seconds left", " for the lead with 2 seconds left". Not on a shot ESPN has not typed whose clock reads 0.0, which is its first guess: Keba Keita's putback with 2.0 seconds left said "0.0 seconds left" for 25 seconds (Pacers at Thunder, October 13 2026).
- **Titles** (`test/sport-alerts.test.ts`, `test/wnba.test.ts`): "Caleb Wilson missed a 26-foot step-back three", "…for the lead with 2 seconds left", "…to tie it with 0.4 seconds left", "Kevin Durant missed a 12-foot driving floater", "Chris Cenac Jr. missed a driving layup", "Jayson Tatum missed a 25-foot pull-up three", "Peyton Watson missed an 8-foot jumper" ("an" before 8, 11, 18 and 80-something), "Allisha Gray missed a 5-foot pull-up jumper". Without ESPN's shot type: "missed a three" or "missed a shot".
- Off by default since October 2026 (about ten a game); installs from before kept it on (`WERE_ON`).

### Turns it over (feed only by default)

- **Trigger:** a play whose type or text has "turnover", with a participant. **Title:** "<Name> turned it over". A traveling turnover is typed just "Traveling" by ESPN, with "traveling turnover" in the text (1 of 28 turnovers in Cavaliers at Magic, October 13 2026; it alerted nothing before).
- An offensive foul is logged by ESPN as a foul and a turnover at the same moment; it is counted as one personal foul (`personalFoul` keys an offensive foul by period and clock). The two plays are one moment (`${gameId}:foul:${key}`, each alert's title the other's fold): a device that wants both gets the one that came first, with the other as a line and no second push ("Stephen Curry committed a foul" with "Stephen Curry turned it over."); a device that wants one gets it as before.

### Technical foul / ejection

- **Trigger:** a play whose type has "technical" or "flagrant", or whose text has "ejected". One participant, or two for a double technical. Not the free throw the call gives (type "Free Throw - Technical", its shooter is the one fouled): Malaki Branham's made technical free throw was pushed as "picked up a technical" in Cavaliers at Magic, October 13 2026, after Thomas Bryant's call. A missed technical free throw is a missed free throw, as any other.
- **Title:** "<Name> picked up a technical", or "<Name> got ejected 🚪" when the text says ejected, or "<Name> committed a flagrant foul" when the type says flagrant (a flagrant is not a technical: Tolu Smith's, DET at MIN, October 14 2026). A personal or shooting foul ESPN retypes as a flagrant puts "ESPN has since called this a flagrant foul." on the foul's alert; the flagrant alert shares the foul's moment, so a device gets one row with both lines (David Jones Garcia, PHX at SA).
- **A defensive 3-seconds call** (type "Defensive 3-Seconds Technical") is ESPN's technical but a routine violation the rules charge to the team: "Donovan Clingan was called for defensive 3 seconds", feed only (`noPush`), with ESPN's trailing space trimmed from the body ("Donovan Clingan defensive 3-seconds (technical foul) — POR 21, SAC 10"). It had gone out as a push in Trail Blazers at Kings, October 13 2026, the game's only technical.

### Fouls out, and commits a foul (off by default)

- **Commits a foul:** a play whose type has "foul" or "charge" (not a technical): ESPN types an offensive charge "Offensive Charge", with no "foul" in it (`FOUL_TYPE`). Title "<Name> committed a foul". A charge had been ignored: Mogbo's 5th foul in Trail Blazers at Kings never alerted and the count stayed at 4, so his 6th would have been read as his 5th and no "fouled out" would have gone out (four more charges went unalerted in the three October 11 games: Strawther, Murray, Swain, Turner).
- **Fouls out:** each player's personal fouls are counted in `observePlay` (`g.fouls`, each foul once by `personalFoul`'s key; technicals don't count). The 6th is "Jayson Tatum fouled out" (`test/sport-alerts.test.ts`), in place of that foul's alert and counting as it (`aliases: ['nba.foul']`). It goes first in the play's list, so on an offensive foul's turnover play it is the alert and "turned it over" a line on it.

### Scoreless at the half (feed only by default)

- **Trigger** (`scorelessAtHalf`): once a game, on the first read with a 3rd-quarter play, from the box score: any player with 10 or more minutes and 0 points. Not when the tracker attached after the half (`this.first`).
- **Title:** "Jayson Tatum is scoreless at the half: 0-6 from the field" (`test/sport-alerts.test.ts`). **Body:** "N minutes, FG, 3PT".
- Id `${gameId}:half:nba.scoreless_half:${athleteId}`.

### Has a brick night (feed only by default)

- **Trigger:** at the final, from the box score (`boxPlayerFacts`, `BRICK`): 12 or more field-goal attempts at 30% or worse, or 0-for-6 or worse from three.
- **Title:** "<Name> shot <made>-for-<attempts>", with ", 0-for-<N> from three" when both apply, or "<Name> went 0-for-<N> from three". **Body:** "PTS, FG, 3PT — Final: …".
- **On the losing side** it is a line on the loss; **on the winning side** its own alert (`playerFinalEvents`). About 3.8% of NBA and 3.3% of WNBA 20-minute games (the comment in `detectors.ts`).

### Opponent's star goes off (a line on the loss)

- **Trigger:** at the final, the winner's top scorer in the box score (`boxTopScorer`) has 40 or more (WNBA 30, `STAR_POINTS`).
- **Only ever a line on the loss** (`foldOnly`): "Jalen Brunson scored 41 on them." (`test/sport-alerts.test.ts`). With the loss off, it isn't a reason to hear about the loss. About 10% (NBA) and 13% (WNBA) of losses.

### Opponent goes on a run (feed only by default)

- **Trigger** (`teamScoreEvents`): points scored in a row against a team (`g.run`, reset when the team scores) reach 14 (WNBA 12, `RUN_POINTS`), once a run.
- **Title:** "Knicks are on a 14-0 run against the Celtics" (`test/sport-alerts.test.ts`). **Fold:** "It's a 14-0 Knicks run.".
- **A line on that play's alert** when the device gets one (the play's moment, no `alt`): "Knicks took the lead." and "It's a 14-0 Knicks run." can both be lines. NBA 14-0 happens in about 10% of team-games, WNBA 12-0 in 18%.

### Revisions: ESPN changes a basketball play after its alert

ESPN posts a basketball play before it has settled and edits it: in the October 11 2026 preseason games 35% (Magic at Cavaliers), 49% (Bucks at Hornets) and 39% (Bulls at Nuggets) of the plays changed after posting. A shot is posted as "No Shot (Default Shot)" and typed minutes later; a free throw comes with no shooter and no team, then with them 15 to 195 seconds later, or as "misses" and is flipped to "makes"; a block names the wrong shooter for a few seconds; a foul, shot or turnover is taken out and re-posted under a new id at the same moment. The football ledger (`PlayLedger` in `revisions.ts`, [Revisions: ESPN changes a football play after its alert](#revisions-espn-changes-a-football-play-after-its-alert)) judges basketball plays too, from a read that has the core feed (`ledgered` in `GameTracker.poll`; with the core feed down, plays aren't compared):

- **A changed play is judged again** on its latest version, for 45 minutes after it was first seen (`BASKETBALL_REVISE_MS`; football and hockey keep `REVISE_MS`, 15). It was 15 until Cavaliers at Magic (October 13 2026), where ESPN moved a turnover from Donovan Mitchell to Evan Mobley 20 minutes after posting it (the slowest of that game's changes to a player or result: 42 minutes). The alert it no longer has gets a line, with no push; the alert it has now goes out.
- **A play with no player yet alerts nothing** (`nba()` needs the player): a free throw posted with no shooter alerts when ESPN names him, at that moment.
- **The lines** (`basketballLine`, `changeLine`): "ESPN has since credited this play to Paolo Banchero." (the same kind of alert, another player: Desmond Bane's "missed a 29-foot three" became Banchero's miss; Banchero's alert goes out), "ESPN has since changed this: the free throw was made.", "ESPN has since changed this: the shot was blocked." (the shooter's "got sent back" goes out; a device that had the "missed" alert gets that as a line on it, the moment's rule), "ESPN has since changed this: the shot went in.", "ESPN has since made this a team turnover.", "ESPN has since changed this play." and, for a play gone from the feed, "ESPN has since taken this play out." (football says "taken this play back"). A wording change alone (the shot typed later) changes nothing: the alert's kind is the same. **A block that becomes a plain miss for the same shooter** (Franz Wagner's, Cavaliers at Magic: Evan Mobley's block, a miss four minutes later, Jarrett Allen's block 17 minutes after that) gets only "ESPN has since changed this: the shot was not blocked." and, when it is a block again, "ESPN has since changed this play back.": "got sent back" already covers a miss (`aliases`), so no "missed a …" alert or line follows it (`revise`, `PlayLedger`). The body still names the first blocker; nothing rewrites it.
- **A shot ESPN describes differently later** (the alert keeps the words it went out with, its id being the play's) gets a line when the new description contradicts them (`shotDisagrees` in `revisions.ts`): a three that is not one, or the other way round (unless the alert only said "a shot"), or a distance 2 feet or more different. "ESPN has since changed this: it was a driving bank floater." (Jrue Holiday's "missed a 26-foot three", Trail Blazers at Kings, which ESPN rewrote as a layup and then a two point shot), "…it was an 11-foot jumper." A foot's shift (9 feet became 10, 14 of 96 shots) and "a shot" typed later get none. Silent, like every line. It is measured against the alert as sent, and not again for what a line already said (a layup that became a bank floater); when ESPN comes back to words that fit the alert, the line is "ESPN has since changed this play back." (Tyler Herro's "26-foot three", Bucks at Hornets: a 22-foot jumper, then a 27-foot three).
- **A play ESPN posts late** (its game time is more than 60 seconds behind the furthest play seen, `LATE_PLAY_SECS`, `GameCtx.latest`) shows the game's score now in its alert's body, not the score of its moment: Nique Clifford's turnover from 4Q 10:27, posted when 6:59 was on the clock, said "POR 97, SAC 69" at 102-78; Plowden's free throw from 9:13 said "100-72" at 102-77 (Trail Blazers at Kings, October 13 2026). A play a few seconds out of order keeps its own. The alert itself still goes out when the play appears.
- **A change that comes 2 minutes or more after the play** (`LATE_REVISION_MS`, 5 minutes until October 15 2026, compared with the play's wall clock as first read, not as ESPN rewrites it later: AJ Johnson's free throw, NO at DAL, was named 55 seconds after it was posted, with its wall clock moved 4 minutes back, and was judged 5 and a half minutes late; it matches `LATE_POST_MS` below, since CHI at MIL had a blocked-shot alert pushed 2 to 5 minutes late) makes its new alert for the feed only: no push, and the body starts with where in the game the play was ("1st quarter, 1:11.", "overtime, 0:04.", `whereLabel` in `revisions.ts`). Kevin McCullar Jr.'s block of Allen Graves's tip-in was added 12 minutes after the play (NY at TOR, October 13 2026): "Allen Graves got sent back ✋" had pushed, with the score of 12 minutes before in its body; now it reads "1st quarter, 1:11. Kevin McCullar Jr. blocks Allen Graves's tip shot" in the feed. Within 2 minutes a revision's alert pushes as before, and "fouled out" always does. The same rule applies to a flagrant foul ESPN types 2 minutes after the play (DET at MIN: no push, quarter and clock first). Lines never push either way.
- **A play ESPN first posts more than 2 minutes after its own wall clock** (`LATE_POST_MS` in `live.ts`) goes to the feed with no push, with the game's score now in its body as above: a turnover posted 4 minutes late, another 15 (Drew Eubanks's, NY at TOR, October 13 2026), both feed only anyway, but a pushed kind (a block, a technical) posted that late would have buzzed for something 2 minutes or more old. A play posted within 2 minutes pushes as before.
- **A re-post** under a new id is that play (`samePlay(a, b, true)`): the same period, the clock within 10 seconds (15 for a foul: Jay Huff's foul posted at 8:15 came back at 8:26), the same first participant, the same kind of play (a free throw's "1 of 2" and "2 of 2" are two plays). One alert, no line: Tristan da Silva's foul, posted at 11:35 and again at 11:35 under a new id, is one "committed a foul". This works once the old play has left the feed; ESPN sometimes posts the corrected play first and removes the old one a minute or so later (Banchero's three and Cain's tip-in, Magic at Cavaliers), and then both alert, the first with "ESPN has since taken this play out." on it.
- **A play gone** for 30 seconds (`GONE_MS`) has its alerts taken back with a line; a short read isn't. A play ESPN removes after the 45 minutes keeps its alert (Franz Wagner's block alert, removed 24 minutes later, would now get its line).
- **Fouls are recounted** with each version, so fouling out stays right: `observePlay` counts a foul once per play that vouches for it (`g.foulPlays`), `unobservePlay` takes a play's foul back before the new version is judged (a foul re-posted under a new id is not a 6th; an offensive foul and its turnover are one foul, counted until neither stands). A 6th foul whose fouler ESPN names later is "fouled out" then. "Fouled out" is never taken back (`FOULED_OUT`).
- **A basket posted with no scorer named waits for him**, 20 seconds at most (`awaitingScorer`, `waitForScorer`, `noScorer`, `SCORER_WAIT_MS`, `HW_SCORER_WAIT_MS`), and the team's score alert waits with it (`goalHeld`, as in hockey): at 10:33 pm in overtime of Pacers at Thunder ESPN posted "makes 24-foot shot" with no player (103-102), then "Braden Smith misses shot" 10 seconds later, and "Pacers scored 3 to take the lead over the Thunder" had gone to every Thunder follower with nothing to correct it. 2 of the game's 86 baskets came with no scorer (named after 4 seconds, and a miss after 14). The wait is not for history, not at the final.
- **A basket ESPN takes back** (a named basket whose play stops scoring, the score going back down) puts a line on the team alerts it made: "ESPN has since changed this: the shot did not go in." (or "…the free throw did not go in."), "ESPN has since taken this play out." for a play gone for good. The ledger keeps each basketball play's score alerts (`addScores`) and `takeBack` writes the line; a play that is missing but not gone yet waits (a short read is not a take-back). No push.
- **Box score players the rosters lack** (`addBoxPlayers` in `catalog.ts`, called by `GameTracker.addMissingPlayers` on each summary read, once per player): preseason rosters leave out two-way and camp players (Rienk Mast played 20 minutes and Keba Keita 10 for the Pacers, on none of ESPN's lists). They are added to the catalog on the box score's team (ESPN's headshot if it has one, else the team's logo), so they can be searched and followed and their alerts have a name; the next 6-hourly ingest keeps them for 30 days (`catalog:box-added` in `kv`) unless a roster lists them. Basketball only.
- **The seven October 14 2026 games** (CHI at MIL, CHA at BOS, BKN at MIA, PHX at SA, DET at MIN, NO at DAL, DEN at LAC; `test/nba-oct14-review.test.ts`):
  - **A copy of a turnover or foul is no alert of its own** (`PlayLedger.twin`): ESPN posts one turnover under two ids for minutes (Jericho Sims, CHI at MIL; Joan Beringer, DET at MIN) and a foul as a personal foul and then a shooting foul (Carter Bryant, PHX at SA). A play with the same period, first player and kind as one still in the feed, a turnover within 1 game second (`TWIN_S`) and a foul on the very same clock, is counted (`observePlay`) and kept on the entry as a twin; when ESPN deletes the entry's own id and the copy stays, the copy becomes the entry, with no "taken out" line. Never for a technical, flagrant or ejection. Two fouls by one player on the same clock second count once (`foulOf` keys a foul by actor, period and clock).
  - **A foul is one moment whatever its type**: an offensive foul, its turnover and a personal foul ESPN retypes share `${gameId}:foul:${key}`, each title the others' fold (DET at MIN: a foul, a flagrant and a technical, one row).
  - **A re-post matches earlier versions** (`PlayEntry.earlier`, at most 6): a turnover credited to one player for a while and then to another, re-posted under a new id, is still one alert.
  - **Turnovers ESPN types later**: a turnover first posted as "No Turnover" and typed minutes on takes the typed words in its body ("Duncan Robinson out of bounds lost ball turnover"), with no line and no push (`retext`). Its text is cut at "turnover".
  - **A block credited to another player** gets "ESPN has since credited the block to Evan Mobley." A block that becomes a plain miss says what it was: "ESPN has since changed this: the shot was not blocked, it was a missed 5-foot hook." (`WHERE_PREFIX` in `revisions.ts`); a made shot or free throw ESPN flips to a miss is a feed row without a push.
  - **ESPN's ghosts**: a play that was never played, stamped at a quarter's start (CHA at BOS: a Tatum turnover and an Anderson miss stamped 29 minutes back, gone 4 minutes later), is held. A non-scoring basketball play first seen more than 10 minutes after its wall clock (`GHOST_AGE_MS`, `HW_GHOST_AGE_MS`) is judged only once it has stood 3 minutes (`GHOST_HOLD_MS`, `HW_GHOST_HOLD_MS`; `holdGhost`, `GameTracker.ghosts`). Every real late post that night was under 4 minutes.
  - **Preseason "their team lost"** skips a player the box score lists as "did not play" (`didNotPlay` is the only flag; an entry with no stats is kept): 6 Suns, 4 Nuggets and 5 Pelicans were listed that way, as well as those it did not list.
  - **Wording**: "missed a running reverse layup" (`SHOT_NAME`).
- **What it fixed**, replayed on the three recordings (`server/data/recordings/nba-report-tools/`): 26 of 42 real free-throw misses had never alerted (the shooter was named after the play was judged), 10 alerts were for made free throws, blocked shots and misses reached the wrong player, 2 alerts repeated when ESPN re-posted a foul, and 9 in Magic at Cavaliers were about plays ESPN removed. After: every free-throw miss alerts, and the false, wrong-player and removed-play ones carry a line (except plays removed after the window, 15 minutes when this was built, 45 since October 14, 2026).
- **Tests:** `test/nba-oct14-review.test.ts` (twins, foul moments, earlier versions, retyped turnovers, block credits, a flagrant retype, a made shot flipped to a miss, ghosts), `test/nba-revisions.test.ts` (also a block added 12 minutes late is feed only with its quarter and clock, one added 1 minute late still pushes; a play first posted 3 minutes late is feed only; a player fouling out named 7 minutes late is pushed), `test/ind-okc-review.test.ts` (the scorer wait, a basket taken back, box score players, a foul re-posted 11 seconds off, the 0.0 clock).

**Basketball and the team alerts.** "Opponent scores" isn't sent in basketball (`team.opponent_scored` has no NBA or WNBA; every basket would be one). "Falls behind" is: "Liberty scored 2 to take the lead over the Dream" (`test/wnba.test.ts`). **A lead that changes hands again** within 2 minutes (`FELL_AGAIN_MS`) of the team's last "falls behind" is a line on it for a device that got that one (`lateOn` on `team.fell_behind`, no push): "Cavaliers took the lead again: ORL 3, CLE 4." Bulls at Nuggets had 19 in a night, five in four minutes. A device that didn't get the earlier one (it was off, or older than 2 minutes) gets the new one as an alert.

**Tests:** `test/sport-alerts.test.ts`, `test/wnba.test.ts`, `test/new-alerts.test.ts`, `test/quiet-defaults.test.ts`.

## WNBA

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `wnba.got_blocked` | Gets blocked | player | Offense | push |
| `wnba.missed_free_throw` | Misses a free throw | player | Offense | feed only |
| `wnba.turnover` | Turns it over | player | Offense | feed only |
| `wnba.brick_night` | Has a brick night | player | Offense | feed only |
| `wnba.scoreless_half` | Scoreless at the half | player | Offense | feed only |
| `wnba.missed_shot` | Misses a shot | player | Offense | off |
| `wnba.technical` | Technical foul / ejection | player | Fouls | push |
| `wnba.fouled_out` | Fouls out | player | Fouls | push |
| `wnba.foul` | Commits a foul | player | Fouls | off |
| `wnba.team.star_went_off` | Opponent's star goes off | team | Team | push |
| `wnba.team.opponent_run` | Opponent goes on a run | team | Team | feed only |

- **The copies are derived, not written:** `EVENT_TYPES` in `server/src/event-types.ts` takes every NBA-only type and adds a `wnba.*` copy with `leagues: ['wnba']`, and adds `wnba` to every shared type that has `nba` (`withWnba`). So the WNBA's list can't drift from the NBA's: same labels, sections, defaults and positions.
- **Same detectors:** `PLAYER_DETECTORS.wnba` is `nba()`. Its alert types are built as `${lg}.got_blocked` and so on, so a WNBA play makes `wnba.*` alerts.
- **Its own numbers** where the WNBA differs (`detectors.ts`): a run of 12-0 (`RUN_POINTS.wnba`), a star's 30 (`STAR_POINTS.wnba`), a blowout at 20 (`BLOWOUT_MARGIN.wnba`), a blown lead of 15 live and 12 at the final (`BLEW_LEAD_LIVE`, `BLEW_LEAD`), a worse team .200 below after 8 games (`WORSE_GAP`, `MIN_GAMES`).
- **Shared alerts it gets:** losses and their facts, lead changes, game starts, injuries, standings drops, losing streaks, elimination, off-field news, their team losing, the Hate Watch streak and the weekly recap.
- **Rival clinches the division:** the WNBA has no divisions and seeds its playoffs league-wide, so ESPN marks no conference title (its final 2026 standings: the East's 1st had only "x"). For the WNBA, `scanStandings` sends this alert when a conference rival clinches the league's best record (ESPN's "*", `WNBA_TOP_SEED`): "The Lynx clinched the WNBA's best record", body "Valkyries won't be the top seed." (`test/new-alerts.test.ts`). A playoff spot ("x") isn't a clinch.
- **Checked:** the README row records NY @ ATL (WNBA playoffs, 2026-10-04) through the live tracker. `test/wnba.test.ts` checks a missed shot ("Allisha Gray missed a 5-foot pull-up jumper") and a lead change ("Liberty scored 2 to take the lead over the Dream").
- **In the app:** the WNBA is the last league everywhere (`LEAGUE_IDS`, README "Notifications").

## Soccer (EPL)

Every soccer alert, for every soccer league. The EPL is the only one today (`SOCCER` in `server/src/leagues.ts`), so its types are `epl.*`. How the match is read is in [EPL how](#epl-how); fouls in [Soccer fouls and penalties conceded](#soccer-fouls-and-penalties-conceded); passes and dribbles in [Soccer passes and dribbles](#soccer-passes-and-dribbles); the 3+ goal loss in [Soccer: 3+ goal loss](#soccer-3-goal-loss).

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `epl.penalty_missed` | Misses a penalty | player and team, not G | Attack | push |
| `epl.goal_disallowed` | Has a goal ruled out by VAR | player and team, not G | Attack | push |
| `epl.hit_woodwork` | Hits the woodwork | player, not G | Attack | feed only |
| `epl.lost_ball` | Loses the ball | player, not G | Attack | off |
| `epl.pass_given_away` | Gives the ball away | player | Attack | off |
| `epl.own_goal` | Scores an own goal | player | Defense | push |
| `epl.penalty_conceded` | Gives away a penalty | player and team | Defense | push |
| `epl.red_card` | Sent off | team and player | Cards & fouls | push |
| `epl.yellow_card` | Gets booked | player | Cards & fouls | push |
| `epl.foul` | Commits a foul | player | Cards & fouls | feed only |
| `epl.goal_conceded` | Keeper concedes a goal | player, only G | Goalkeeping | push |
| `epl.subbed_off_early` | Taken off early | player | Lineup | push |
| `epl.team.heavy_loss` | Loses by 3+ goals | team | Team | push |
| `epl.team.late_goal` | Concedes a late goal | team | Team | push |
| `epl.team.relegation_zone` | Drops into the relegation zone | team | Team | push |

The detector for key events is `soccer()` in `server/src/detectors.ts`; the commentary's are `soccerFoul()` and `soccerCommentaryEvents()`; the touch feed's `soccerTouch()`; the late goal is in `teamScoreEvents()`; the relegation zone in `scanStandings()` (`server/src/live.ts`). Every play alert's body is the event's text with its minute in front, a dash and the score (`fromKeyEvents` puts the minute in front, "57' Alexander Isak (Liverpool) right footed shot…", and drops ESPN's own "Goal! Bournemouth 0, Liverpool 1." from the text; the score is added as `AWAY n, HOME n`).

### Keeper concedes a goal (goalkeepers only)

- **Trigger:** a scoring key event (a goal or an own goal, not a shootout kick). The side that conceded is the one the goal isn't credited to (an own goal is credited to the team it counts for, so either way the other side conceded). Its keeper is `g.goalies` for that team ([EPL how](#epl-how) explains how the keeper in goal is tracked).
- **Title:** "Senne Lammens conceded a goal 🥅" (`test/epl.test.ts`).
- **A keeper's own goal** is the own-goal alert, with `aliases` for "Keeper concedes a goal", so it's one alert.

### Scores an own goal

- **Trigger:** a scoring key event whose type starts with "Own Goal". The player is its first participant.
- **Title:** "<Name> scored an own goal 🤡".

### Misses a penalty (players and teams)

- **Trigger:** a key event whose type starts with "Penalty" and isn't a goal: "Penalty - Saved" or "Penalty - Missed".
- **Two alerts, one moment** (`${gameId}:${playId}:penalty`): the taker's, "Yoane Wissa had a penalty saved 😬" or "<Name> missed a penalty 😬", and the team's, "Newcastle had a penalty saved 😬" (`test/epl.test.ts`). One type (`epl.penalty_missed`, `alsoScope: 'team'`) covers both, so tracking Wissa and Newcastle gets one alert.

### Gets booked

- **Trigger:** a key event whose type starts with "Yellow Card". **Title:** "Abdul Fatawu was booked 🟨" (`test/epl.test.ts`).

### Sent off (teams and players)

- **Trigger:** a key event whose type starts with "Red Card" (a straight red, or a second yellow, which ESPN writes as a red card with "second yellow" in the text).
- **Two alerts, one moment** (`${gameId}:${playId}:red`): the player's, "Taiwo Awoniyi was sent off 🟥" or "Abdul Fatawu was sent off (second yellow) 🟥", and the team's, "Ipswich are down to 10 men 🟥", then "Ipswich are down to 9 men 🟥" for a second (`test/epl.test.ts`). The count is 11 less the team's red cards so far (`g.sentOff`, counted in `observePlay` after the detectors, so the detector adds this one).
- **A keeper sent off** is out of goal: `observePlay` drops him from `g.goalies`, so the next goal has no keeper alert until a keeper comes on.
- The type is a team type with `alsoScope: 'player'`.

### Has a goal ruled out by VAR

- **Trigger:** a commentary line "GOAL OVERTURNED BY VAR: Niclas Füllkrug (West Ham United) scores but the goal is ruled out…" (`fromCommentary` makes it a play, type `var-no-goal`). Only that wording: "VAR Decision: Goal" is a goal given.
- **Two alerts:** the scorer's, "<Name> had a goal ruled out by VAR", and his team's, "West Ham had a goal ruled out by VAR" (`test/sport-alerts.test.ts`). They share the play's moment through `bundleByPlay`, so tracking both is one alert.

### Hits the woodwork (feed only by default)

- **Trigger:** a commentary line whose play type is woodwork and whose text is "<Name> (<Club>) hits the left post|right post|post|bar|crossbar…". **Title:** "<Name> hit the post", "…hit the bar" (left and right are dropped, the crossbar is "the bar"), or "…hit the woodwork".

### Taken off early

- **Trigger** (`earlySub`): a substitution key event whose player going off (the `off` role) left by the 46th minute (the minute before any stoppage time: 45'+2' is still the first half), and whose text doesn't mention an injury.
- **Title:** "<Name> was taken off at halftime" (minute 45 or later) or "<Name> was taken off in the 30th minute". 51 of 513 EPL substitutions in 60 matches came by 46', most of them injuries (the comment in `detectors.ts`).
- Its section in the app is "Lineup" (`event-types.ts`), a heading the README's list of soccer sections doesn't name.

### Concedes a late goal

- **Trigger** (`teamScoreEvents`): the other side scores from the 85th minute on (`LATE_MINUTE`, read from the key event's clock: "90'+4'" is minute 94) and it takes the lead or equalizes against the tracked team.
- **Title:** "Fulham took the lead against Man United in stoppage time (90'+3')" or "Man United equalized against Fulham in the 89th minute" (`test/epl.test.ts`). **Fold:** "A go-ahead goal in stoppage time (90'+3')." or "An equalizer in the 89th minute.".
- **In place of** that goal's "Falls behind" or "Opponent scores": it counts as the one it replaces (`aliases`), and it's in the same `alt` group (`scored-on`) on the play's moment, ahead of them, so a device gets one of the three.

### Drops into the relegation zone

- **Trigger** (`scanStandings`): the standings are read every 60 seconds (`STANDINGS_MS`); ESPN's table note for a position is "Relegation", and a team that wasn't in that zone before now is.
- **Title:** "<Team> dropped into the relegation zone". **Body:** `dropBody`: "Down from 16th. Into the relegation zone 🪂", then "Streak: …" if ESPN has one (`test/sport-alerts.test.ts`).
- **One alert with other standings news:** it shares the read's moment with that team's standings drop (it goes first), so a device gets one of them with the other as a line ("Into the relegation zone.").
- **After a loss:** within 6 hours of a loss alert the device got for that team (`DROP_ON_LOSS_MS`, `lateOn` with `loss: true`), it is the line "Into the relegation zone." on the loss instead of an alert.
- Id `releg:${league}:${teamId}:${day}`.

### The shared team alerts in soccer

Soccer teams get the shared alerts too: "Game starts" ("Kickoff at Emirates Stadium"), "Loses a game", "Opponent scores" ("Liverpool scored against Bournemouth", "Fulham scored against Man United": clubs don't get "the"), "Falls behind" ("Fulham scored to take the lead over Man United"), "Drops in standings" (the table), off-field trouble, fined or suspended. Of a loss's facts, soccer has the last-second loss ("Burnley conceded a stoppage-time winner to Man United", `test/loss-facts.test.ts`: the winner's go-ahead goal was at 90'+), a blown 2-goal lead, and losing as a 60% favorite. Not: injuries (ESPN's EPL injury report is empty), losing streaks (the table has none), elimination, a shutout (half of all soccer losses are one), sweeps, losing to a worse team or falling below .500 (README "Known limits"; `team.*` leagues in `event-types.ts`).

**Tests:** `test/epl.test.ts` (five real September 2026 matches: an own goal, a saved penalty, a second yellow, a straight red, a 5-0), `test/soccer.test.ts`, `test/sport-alerts.test.ts`.

## EPL how

How a soccer match is read, which every soccer alert depends on. The plays are the summary's key events. ESPN's core play-by-play for soccer has every touch (about 1,500 a match), so it is read a page at a time for the newest touches only (below); the summary stays the source of the wording and the cross-check.

- **Key events, every 2 seconds:** the summary's `keyEvents` (goals, own goals, penalties, cards, substitutions) become plays (`fromKeyEvents` in `detectors.ts`). Shootout kicks aren't scoring plays.
- **The score is counted from the goals:** key events carry no score, so each scoring event adds one to its credited team (an own goal is credited to the team it counts for). Every poll re-counts from all of them, like every league (`GameTracker.poll`: "score went down" lowers what was announced, so a goal taken back makes the next one news again).
- **Roles:** a goal's participants are the scorer then the assist; a substitution's are the player coming on then the one going off.
- **The keeper in goal:** from the line-ups first (`keepers()`: the player listed at G who wasn't subbed out, the one subbed in if any, else the starter), once per team (`keepersSeeded`). Then `observePlay` follows the match: a substitution bringing on a player the catalog lists at G puts him in goal; a red card to the keeper in goal takes him out.
- **One alert for the player and the team:** a penalty miss and a red card are one type each for both scopes, sharing a moment, so tracking both gets one.
- **A keeper's own goal** is the own-goal alert, counting as "concedes" too.
- **A draw isn't a loss:** `gameLostEvent` returns nothing when the final is level, so no "Successful Hate Watch".
- **Commentary, every 2 seconds too:** from the same summary read, for fouls, penalties conceded, dives, the woodwork and VAR ([Soccer fouls and penalties conceded](#soccer-fouls-and-penalties-conceded)).
- **The touch feed, every poll** (`refreshTouches` in `live.ts`): the newest page of 100 on every poll (40 touches back), and every 10 seconds (`TOUCH_MS`, `HW_TOUCH_MS`) 250 touches back, because ESPN retypes a touch and takes one out for a minute or two. It is held by position and cut to ESPN's count after a removal (a touch taken out moves every touch after it). The first read starts at the newest page; what came before is history. A failed read is logged and never fails the poll. Every soccer tracker reads it, with or without a tracked player. What it makes: goals, cards and substitutions (below), fouls ([Soccer fouls and penalties conceded](#soccer-fouls-and-penalties-conceded)), and, while someone tracks a player in the match, passes and dribbles ([Soccer passes and dribbles](#soccer-passes-and-dribbles)).
- **Goals, cards and substitutions from the touch feed first** (`fromTouchKeyPlay`, `touchKeyPlays`): the feed has them under the same play id 5 to 20 seconds before the summary does (median 10; Man City 3-0 Liverpool, 2026-10-11). The touch becomes the same play the summary will have (the same wording and roles: scorer then assister, subbed-in then subbed-out, carded; the score is the touch's own, which is the score after a goal), and the summary's copy is that play again (`seen`), so nothing is sent twice. Left to the summary: a goal still typed "Temp Goal" (not a scoring play yet; Doku's became a goal 15 seconds later), own goals and penalties (their team and roles aren't checked against the feed), shootouts, and a touch whose player isn't on it yet (a card needs its carded player, a substitution both): a play is judged once, so it must not be seen before it can alert. The play lists merge as `mergePlays(sitePlays, touchPlays)`: the summary's version wins once it has the play.
- **ESPN rewrites each key event within a minute** (`reviseKeyText`): it posts "Erling Haaland (Manchester City) Goal at 65'" or "Red Card at 62'" and rewrites it 9 to 69 seconds later ("Goal! … left footed shot … Assisted by …", "Second yellow card to …"); 14 of 17 in Man City 3-0 Liverpool. The alerts are made from the first words, so each alert of the play (`${gameId}:${playId}:…`) takes the new words on its feed rows when the new text is longer than the last and within 5 minutes (`KEY_REVISE_MS`) of first seeing the play, through `reviseEvent`: no second push. The body is the text and the score, so only the text is swapped; a sent-off player's title gains "(second yellow)" (`sentOffTitle`). The detectors are not run again, because they count as they go (a red card's men left).
- **Checked:** the README row records five real September 2026 matches replayed, every counted score matching ESPN's final.

## Soccer fouls and penalties conceded

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `epl.foul` | Commits a foul | player | Cards & fouls | feed only |
| `epl.penalty_conceded` | Gives away a penalty | player and team | Defense | push |

- **Source, the touch feed first** (`fromTouchFoul`): a foul or handball touch has the fouler (`fouler`, then `fouled`; a handball names only its player) and the fouler's team, 12 to 27 seconds before the commentary line gets its play id (the commentary line appears without its `play` and ESPN attaches it 9 to 35 seconds later; the tracker skips a line without one). The play is written as the commentary's: "<minute> Foul by <Name> (<Club>).", from the touch's own text when it says so. A foul already alerted from either is skipped from the other (`fouls` in `GameTracker`).
- **Source, the commentary** (`fromCommentary` in `detectors.ts`): the summary's commentary, already read every 2 seconds. ESPN writes each foul twice under one play id ("Foul by Kobbie Mainoo (Manchester United)." and "Josh King (Fulham) wins a free kick…"); they are grouped by play id, so a foul is one play.
- **The fouler is the one the text names:** "Foul by|Handball by|Penalty conceded by <Name> (<Club>)" matched to the line-ups (`find`: the exact name, else the one player on that club who shares a word of it, 3 letters or more). The play's own participant list can be stale: one said Maxim De Cuyper for "Foul by Chema Andrés", and ESPN's stats charged Andrés (2026-09-13). Commentary spells some names its own way ("Abdul Fatawu" is "Fatawu Issahaku").
- **Handballs and dives count,** as ESPN's stats count them: a handball's type is `handball`; a dive is a commentary line "<Name> (<Club>) has gone down, but the referee deems it simulation" with no play of its own (its id is built from the time and the name).
- **Titles** (`soccerFoul`, `test/soccer.test.ts`): "<Name> committed a foul", "Charalambos Kostoulas was called for a handball", "Frank Onyeka went down, and the referee called it a dive 🤿".
- **A foul in the box:** when any of the foul's lines says "Penalty conceded by …" or "… draws a foul in the penalty area", it's a penalty conceded: the fouler's "Bobby Thomas gave away a penalty 🤦" and the team's "Coventry gave away a penalty 🤦", one moment (`${gameId}:${playId}:penalty-conceded`), so tracking both is one alert. The player's counts as his foul too (`aliases: ['epl.foul']`): never two alerts for one foul.
- **A penalty written a moment later:** the tracker remembers each foul's kind (`fouls` in `GameTracker`); a foul seen first as a plain foul and then as a penalty conceded is judged again as the penalty, once, and the penalty alerts go out then (the foul's alert, already sent, stays). Nothing is judged again after it's a penalty. Only the commentary says "Penalty conceded", so with the foul now alerting from the touch feed first, the plain foul usually goes out before the penalty is written: still two alerts about one foul ([duplicate-alerts.md](duplicate-alerts.md), "Known gaps").
- **A card and the foul behind it are one alert** (`linkFoulsToCards`): a foul by the player carded in the same minute (the alerts carry the player and the minute: `withClock`) takes the card's moment, with no line of its own, when the card comes in the same poll or earlier; a device that gets the card doesn't get the foul too, and one with cards off still gets the foul. A foul that came first stays its own alert, because a card that joined it would become a line on a feed-only foul and lose its push. Five of the six cards in Man City 3-0 Liverpool had a foul; three arrived together (O'Reilly, Bouaddi, Gravenberch's red card).
- **Default:** "Commits a foul" is feed only by default (installs from before October 2026 kept it pushed, `WERE_PUSHED`); "Gives away a penalty" pushes.
- **Checked:** against ESPN's own foulsCommitted for every player in five EPL and three La Liga matches: 159 fouls, every player's count matched (the README row; `fromCommentary`'s comment says five September 2026 matches).

## Soccer passes and dribbles

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `epl.lost_ball` | Loses the ball | player, not G | Attack | off |
| `epl.pass_given_away` | Gives the ball away | player | Attack | off |

- **Source:** ESPN's touch-by-touch feed (the core plays API for the match: every pass, dribble and tackle). It says what happened, not whether it worked, so each touch is judged by the next one (`soccerTouch` in `detectors.ts`).
- **Judged only when it matters:** the feed is read on every poll ([EPL how](#epl-how)), but pairs are judged only while someone tracks a player on either side (`tracksPlayers`, checked every 30 seconds; `judgeTouches`). The first read jumps to the newest page, so touches before it are history (and touches older than 90 seconds before the first read too). The latest touch waits for the next one.
- **Judged again when ESPN changes a touch:** ESPN retypes a touch for a minute or two (11 type changes in Man City 3-0 Liverpool: a "Dispossessed" became a "Take On" 30 seconds later, a "Take On" became a "Tackle" two minutes later). Each judged pair keeps what it was made of (the ids, types, teams and first players of both touches, by position); while its first touch is under 6 minutes old (`TOUCH_REJUDGE_MS`), a pair whose touches changed, or a touch removed beside it, is judged again. An alert the pair now makes that wasn't sent goes out; one already sent takes the new words (`reviseEvent`, no push); one it no longer makes can't be unsent and is logged. Alert ids come from the play id, so nothing is sent twice. Judging the settled feed gave 70 passes and 25 lost balls where the live reads gave 69 and 24.
- **Loses the ball:** a dribble ("Take On") whose next touch is the other team's tackle, or being "Dispossessed" (always followed by the tackle that did it). An "Attempted tackle" means they got past. Title "<Name> lost the ball", body "<minute> Tackled trying to get past <Opponent>" or "<minute> Dispossessed by <Opponent>" and the score. 14 of 29 take-ons ended in a tackle in Fulham 1-1 Man United (2026-09-20).
- **Gives the ball away:** a pass whose next touch is the other team's: an interception ("intercepted by"), a blocked pass ("blocked by"), a clearance ("cleared by"), a ball recovery ("picked up by"), or their pass, take-on or cross ("straight to"). Their foul, a failed tackle or a header duel doesn't count. Title "<Name> gave the ball away", body "<minute> Pass intercepted by <Opponent>".
- **The opponent's name:** the catalog's, or the name at the start of the touch's text.
- **Off by default:** about 8 to 10% of passes go astray, several a match for a busy midfielder. "Loses the ball" was on by default before October 2026; installs from before kept it on (`WERE_ON`).
- **Run live:** Man City 3-0 Liverpool, 2026-10-11 (`test/city-liverpool-review.test.ts`, `test/city-liverpool-touch-reads.test.ts`): 69 of 70 passes and 24 of 25 lost balls matched the settled feed; the rest are the retyped touches above.

## Soccer: 3+ goal loss

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `epl.team.heavy_loss` | Loses by 3+ goals | team | Team | push |

- **Trigger** (`heavyLossEvent` in `detectors.ts`, called from `GameTracker.finish`): a soccer loss by 3 goals or more (`BLOWOUT_MARGIN` 3 for every soccer league).
- **Title:** "Successful Hate Watch! Coventry were thrashed 5-0 by Brighton" (`test/soccer.test.ts`). **Body:** the loss's ("Final Score: 5 to 0"; soccer's blowout line is left out because the title says it).
- **Instead of the plain loss:** it shares the loss's moment and is published first (`finish` puts it ahead of `team.lost`), so a device with it on gets "thrashed", and one with it off gets the plain loss (which for soccer also says "were thrashed": `gameLostEvent` uses the soccer blowout wording, so the two differ only in their switch).
- **One Successful Hate Watch:** it's in `HATE_WATCH_TYPES` and carries `lostId`, the loss's id, so the counter goes up once, under the team (`hateWatchOf` in `server/src/hate-watches.ts`), and "N other hate watchers" counts both.
- **Tracked players** get "Successful Hate Watch! Jack Rudoni and Coventry were thrashed 5-0 by Brighton" (`playerTeamLostEvents`, `test/soccer.test.ts`).
- Id `${gameId}:final:epl.team.heavy_loss:${loserId}`. Its meta carries the loss's `margin` and `score` too (with `gameId`, `winnerId`, `lostId`, `teamKey`): its Recent misery row replaces the plain loss's, so the row would have lost the margin without them.

## Adding a soccer league

How the soccer alerts follow a new league without new alert code.

- **The alerts are a template:** `SOCCER_ALERTS` in `server/src/event-types.ts` lists each soccer alert once with a `key`, and `soccerAlerts()` makes one copy per league in `SOCCER`: `${league}.${key}` (`soccerType(lg, key)`), with its own switches under "<League> alerts". La Liga's would be `esp.own_goal` and so on, by our league id (ESPN's code goes in `slug`).
- **The detectors build types from the league:** `soccer()`, `soccerFoul()`, `soccerTouch()`, `soccerCommentaryEvents()`, `earlySub()` and the late goal all use `${g.league}.<key>`, and `PLAYER_DETECTORS` gives every league in `SOCCER` the soccer detector.
- **Shared numbers per league:** `BLOWOUT_MARGIN`, `FAVORITE_CHANCE`, `BLEW_LEAD` and `BLEW_LEAD_LIVE` are filled for every soccer league from `SOCCER`; `START_WORD` is "Kickoff" for each.
- **The shared alerts list soccer leagues by spreading `SOCCER`** (`...SOCCER_LEAGUES` in `event-types.ts`), so the loss, game start, scoring, standings and news types include a new league.
- **Old installs:** `WERE_ON` and `WERE_PUSHED` in `fanout.ts` include each soccer league's `lost_ball` and `foul`, but `keepOldDefaults()` ran once (kv `prefs:quiet-defaults`), so a league added later starts on the new defaults for everyone.
- The README row has the rest (the league's `slug`, its filter chip and Settings group coming from the server) and the La Liga trial.

## NHL

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `nhl.shootout_miss` | Misses in the shootout | player, not G | Offense | push |
| `nhl.shot_missed` | Shoots and misses | player, not G | Offense | feed only |
| `nhl.minus` | Finishes -3 or worse | player, not G | Offense | feed only |
| `nhl.shot_blocked` | Gets a shot blocked | player, not G | Offense | off |
| `nhl.shot_saved` | Shot gets saved | player, not G | Offense | off |
| `nhl.giveaway` | Gives the puck away | player | Offense | off |
| `nhl.penalty` | Takes a penalty | player | Penalties | push |
| `nhl.fight` | Drops the gloves | player | Penalties | push |
| `nhl.goalie.goal_allowed` | Goalie allows a goal | player, only G | Goaltending | push |
| `nhl.goalie.pulled` | Gets pulled | player, only G | Goaltending | push |
| `nhl.team.power_play_fail` | Power play goes 0-for-4+ | team | Team | push |
| `nhl.team.empty_net_goal` | Gives up an empty-netter | team | Team | feed only |
| `nhl.team.shorthanded_goal` | Gives up a short-handed goal | team | Team | feed only |
| `player.ejected` | Gets ejected | player | Game | push |

**Where the plays come from.** Both ESPN feeds every 2 seconds, merged by id. The detector is `nhl()` in `detectors.ts`. Roles: `shooter` and `saver`. The play's `strength` is ESPN's ("Even Strength", "Power Play", "Shorthanded", "Empty Net", "Penalty Shot").

**Who is in net.** On the first read the tracker seeds each side's goalie from the box score's goalies (`seedGoalies`: the first listed). From then on `observePlay` follows the saves: a save by a goalie puts him in net for that side. Each goalie's shots faced and goals allowed are counted (`g.goalieLine`; an empty-net goal is nobody's). The goalie on the ice for a goal is inferred from the last save each goalie made; README "Known limits" says so. Three guards (EDM at LA, October 13, 2026): a play with no team moves nobody (ESPN posts a save with no team and no shooter, and takes it out seconds later; the core copy of a play lacks its team 16% of the time, so `mergePlays(…, true)` takes it from the summary's copy); a goalie the box score lists for the other side is not put in net (`g.goalieTeam`, from every goalie in the box score); and a play counts as a shot faced or a goal allowed once, whatever versions ESPN posts (`g.goalieSeen`, undone by `unobservePlay` when the play is replaced or taken out). The tracker logs "goalie in net changed on play …" whenever the goalie moves.

### Goalie allows a goal (goalies only)

- **Trigger:** a goal (type "Goal" or slug `goal`) not into an empty net (neither "empty net" in the text nor `strength` Empty Net) and not in a shootout. The goalie is the conceding side's in `g.goalies`.
- **Title:** "<Name> let one in 🥅".
- **Needs the play's team:** with none, there is no goalie to name (the other side of an unknown team is a guess); the ledger judges the play again when ESPN names the team.
- **A late goal:** when a play becomes a scoring play after it was first published, the ledger judges it again and the goalie's alert goes out (the tracker logs "late score"; without the core feed it runs just this alert for the play, `GameTracker.poll`). Every goal in EDM at LA went this way: each was a missed or saved shot first.
- **An empty-netter ESPN first posts as an even-strength goal** (its strength changed 10 to 20 seconds later): the goalie's alert gets the line "ESPN has since marked this an empty-net goal: nobody was in net.", and the team gets `nhl.team.empty_net_goal` as a line on its "scored on" alert ("Into an empty net."), or as an alert for a device that wanted only that one (it carries no `alt`, so it can fold into the alert the device already holds).

### Gets pulled (goalies)

- **Trigger:** a save in regulation (period 3 or earlier), on a play that names its team and its shooter, by a different goalie from the one the tracker had in net for that side, when the one before had faced at least one shot, once per goalie (`g.pulled`). A goal first posted as a missed shot counts as a shot and a goal against once ESPN makes it a goal, so the body's numbers are the box score's (Kuemper: "3 goals on 7 shots"). The first read's goalie can be the backup in the box score: then the starter's first save isn't a pull, because the backup faced no shots.
- **Title:** "Tristan Jarry got pulled after allowing 2 goals on 3 shots". **Body:** "Alex Nedeljkovic is in net — NYR 2, PIT 0" (`test/sport-alerts.test.ts`).
- Not for an extra attacker: that leaves the net empty, and the next save is the same goalie's.

### Shots: misses, blocked, saved

- **Shoots and misses (feed only by default):** a shot with slug `shot-missed` or type "Missed": "<Name> shot and missed", with " (rang iron)" when the text mentions the post or crossbar.
- **Gets a shot blocked (off by default):** slug `shot-blocked` or type "Blocked": "<Name> got a shot blocked".
- **Shot gets saved (off by default):** slug `shot-on-goal` or type "Shot": "<Name> got stoned".
- Skaters only on a player's screen (not G).

### Misses in the shootout

- **Trigger:** after a play with "start of shootout" in its text (`g.shootout`), a shooter's play of type "Missed" or "Shot".
- **Title:** "Evgeni Malkin missed in the shootout" or "Evgeni Malkin got stopped in the shootout" (`test/sport-alerts.test.ts`). **Body:** "Shootout: " and the play's text, with no score (a shootout play's score isn't the game's, and finished games show the shootout's tally on all of them).
- **In place of** that shot's alert, counting as it (`aliases`: `nhl.shot_missed` or `nhl.shot_saved`).

### Gives the puck away (off by default)

- **Trigger:** a play whose type has "giveaway". **Title:** "<Name> gave the puck away".
- **It runs late.** ESPN posts a giveaway a median 132 seconds after it happened (54 to 224 seconds, 34 giveaways, EDM at LA), against 27 seconds for shots and 33 to 42 for goals. It is off by default and stays so; measure on more games before saying more.

### Penalties, fights and ejections

- **Trigger:** a play with penalty minutes (`penaltyMinutes`, from the type or the core feed's `penalty.minutes`) and a participant.
- **Takes a penalty:** "<Name> went to the box (<minutes> min, <ESPN's penalty type>)", fold "<minutes> minutes in the box.". A penalty ESPN has not named yet waits for its call ([Revisions: ESPN changes a hockey play after its alert](#revisions-espn-changes-a-hockey-play-after-its-alert)).
- **Drops the gloves:** the text has "fighting" ("Mathieu Olivier Fighting against Arber Xhekaj"): "Evgeni Malkin dropped the gloves with Artemi Panarin" (`test/sport-alerts.test.ts`), fold "A fight.", counting as the penalty (`aliases: ['nhl.penalty']`).
- **Gets ejected:** the type is a game misconduct or a match penalty: "Evgeni Malkin got ejected (game misconduct)" (`test/new-alerts.test.ts`), fold "Ejected (game misconduct).", type `player.ejected` counting as the penalty. A plain misconduct (10 minutes, then back) isn't an ejection.
- **ESPN names the call a few seconds later.** A penalty first posted as "Penalty Shot Infraction" with the text "<Name> Minor" (6 of 7 in EDM at LA, rewritten within 10 to 40 seconds) goes out as posted, and the call is a line with no push: "ESPN has since called it tripping against Kasperi Kapanen." (`revisions.ts`).
- **One moment for one player's penalties at one moment:** `${gameId}:penalty:${athleteId}:${period}:${clock}`. An instigator's misconduct and a game misconduct come as two plays at the same moment (Olivier, 14:27 of the 3rd); the device gets the first, with the other as its line. A fact a poll later is a late line.

### Finishes -3 or worse (feed only by default)

- **Trigger:** at the final, a skater's +/- in the box score at -3 or worse (`NHL_MINUS`, `boxPlayerFacts`). **Title:** "Evgeni Malkin finished -3". **Body:** "G, A, TOI — Final: …".
- A line on the loss for the losing side ("Evgeni Malkin finished -3."), its own alert on the winning side. About 1.9% of skater games.

### Team: empty-netter and short-handed goal against (feed only by default)

- **Trigger** (`teamScoreEvents`): the other side scores with `strength` "Empty Net" or "Shorthanded" (on the tracked team's own power play).
- **Titles:** "<Team> gave up an empty-netter to the <Opponent>", "<Team> gave up a short-handed goal to the <Opponent>". **Folds:** "Into an empty net.", "A short-handed goal, on their own power play.".
- **In place of** that goal's "Opponent scores" (`aliases: ['team.opponent_scored']`, same `alt` group): one of them per device. When the goal puts them behind, "Falls behind" comes first.

### Team: power play goes 0-for-4+ (a line on the loss)

- **Trigger:** at the final, the loser's power play in the box score's team stats (`boxPowerPlay`): no goals on 4 or more chances (`PP_FAIL`).
- **Only a line on the loss** (`foldOnly`): "0-for-<chances> on the power play.". Title, for the record: "<Team> went 0-for-<chances> on the power play and lost". About 13% of losses.

### Revisions: ESPN changes a hockey play after its alert

ESPN posts a hockey play before it has settled and edits it. In EDM at LA (314 plays) all 5 goals were first posted as a missed or saved shot, 6 of 7 penalties as "Penalty Shot Infraction", the empty-netter as an even-strength goal, 6 plays were taken out, and 27 of the 157 shot, giveaway and penalty alerts disagreed with ESPN's final play (the 6 placeholder penalties included). Hockey goes through the same ledger as basketball (`PlayLedger`, `revisions.ts`, from a read with the core feed): a changed play is judged again on its latest version for 45 minutes (15 until COL at DAL: ESPN posted a shot again 28 minutes after taking it out, and made a giveaway a takeaway 26 minutes on); the alert it no longer has gets a line with no push, the alert it has now goes out, a play gone for 30 seconds has its alerts taken back with a line.

- **The lines** (`hockeyLine`): "ESPN has since changed this: Leon Draisaitl scored." (a shot that became a goal), "…the shot was blocked / saved / missed.", "ESPN has since credited this play to Erik Haula.", "ESPN has since marked this an empty-net goal: nobody was in net.", "ESPN has since taken this play out.". A retyped shot's line and the new kind's alert for the same shooter share an `alt` (`shot-retyped:…`), so a device gets one of them.
- **Goalie lines are recounted** with each version (`observePlay` replaces a play's count, `unobservePlay` takes it back): a goal that was a missed shot is a shot faced and a goal against.
- **A goalie coming on is judged once**, as the play comes in (`nhl.goalie.pulled` is in `ONCE`): a revised save never pulls anyone, and the ledger judges on a copy of the game's state that marks every goalie in net as already pulled.
- **A re-post** under a new id is that play (`samePlay(…, true)`: the same period, the clock within 10 seconds (15 for a foul: Jay Huff's foul posted at 8:15 came back at 8:26), the same first participant, the same kind of play).
- **An empty-netter or short-handed goal** that was a goal already: the team's alert for it is sent as a late alert (`strengthGoal`: `teamScoreEvents` filtered to `nhl.team.*`, with no `alt`).
- **Plays ESPN is still filling in wait** (TOR at UTA, October 13, 2026: 34 of 147 player alerts disagreed with the plays ESPN kept, 5 of 9 goal alerts had another scorer or other assists, 5 of 8 penalties said "Penalty Shot Infraction"; `awaitingHockey`, `GameTracker.waitForHockey`, `HOCKEY_WAIT_MS`). Past the wait a play is judged as it stands, and the lines above cover what ESPN changes after.
  - **A shot** (missed, blocked, saved) waits 20 seconds (`HW_NHL_SHOT_WAIT_MS`), so one that is a goal by then sends no shot alert, one ESPN retypes names the right kind, and the placeholder "Missed Shot" text is filled in. Shot alerts are feed only or off by default, so nothing pushes later.
  - **A penalty** still typed "Penalty Shot Infraction" (text "<Player> Minor") waits up to 10 minutes (`HW_NHL_PENALTY_WAIT_MS`; ESPN named them 10 to 185 seconds later, and the two it never named, in COL at DAL, were taken out within 6 minutes: with a 2-minute wait both went out as "minor" pushes for players who took no penalty), so the alert names the call, the other player and a fight or ejection. Never named after the wait, it says "went to the box (2 min, minor)" (5 minutes: "major") and the call comes as a line. A penalty ESPN flips back to the placeholder for seconds writes no line.
  - **A goal with no scorer in its text** (it starts with a comma: ", assists: Logan Cooley (6), Dylan Guenther (4)") waits up to 90 seconds (`HW_NHL_GOAL_WAIT_MS`; 20 until MTL at WSH and DAL at COL, October 14, 2026: ESPN named scorers 40 to 55 seconds late and three goals went out as ", assists: none"). Past the wait it is "Goal, scorer to be named" (`GOAL_UNNAMED`, `goalWords` in `detectors.ts`), never text starting with a comma, and the goal's alerts take the words once ESPN names him. The goalie's alert is held with it, and so are the team's score alerts: no score is announced past it (`goalHeld`), so the goals after it come out in order, once, and a device that tracks the team and the goalie keeps the goalie's push.
  - **A repeat of a shot** (`PlayLedger.shotCopy`: the same shooter and the same result in the same period, within 30 seconds of the clock of one already alerted) waits 60 seconds (`HW_NHL_COPY_WAIT_MS`) instead of 20, and goes out only if ESPN still has it: MTL at WSH, ESPN posted copies (Tom Wilson 3:32 and 3:34, Chychrun 13:40 and 13:59) and deleted them 44 seconds and 4 minutes on. A real repeat (Texier 2:44 and 2:45) is a minute later; shot alerts are feed only by default.
  - **Never held:** a shootout play (the shootout miss pushes), a save by a goalie who isn't the one in net on a known team (the pull goes out at once and the goalie in net is right for the goal after it), history, and anything at the final.
  - **Mostly fixed: a late copy of a shot** ESPN posts while the original is still in the feed (the repeat hold above covers one the same shooter shoots within 30 clock-seconds; a copy under another shooter or further apart still alerts twice after its wait) (TOR at UTA: Jack McBain's 1510 and 0810, Dylan Guenther's 1520 and 4020, Barrett Hayton's 4520 and 4530 beside 5710). ESPN takes some out a minute later (a line, "ESPN has since taken this play out."), the rest stay. A re-post of a play ESPN took out, up to 45 minutes later, is that play (one alert), and a shot posted 3 minutes or more late alerts nobody; what is left is a copy posted soon after, while the original is still there. `samePlay` is not widened to plays still in the feed: Guenther's 6090 (missed) and 6100 (blocked), four seconds apart, are two real shots, and a rebound looks the same as a copy. In TOR at UTA, 28 of 161 player alerts still differ from ESPN's final play (13 plays removed, 15 retyped after the wait; 36 of 164 before), each with its line.
- **A pulled goalie's shots faced** can miss the saves of the last 20 seconds (a held save is counted when it is judged): "after allowing 3 goals on 7 shots" can say 6.
- **A goal's alerts take ESPN's later text** (`reviseKeyText`, the soccer rewrite, within 5 minutes of first seeing the goal, `reviseEvent`, no push): the goalie's alert, the team's "scored on" / "falls behind" and the short-handed or empty-net alert, any change counting (an assist ESPN took away, a different scorer: the short-handed goal was first Barrett Hayton's, then Mikhail Sergachev's), but never to a text with no scorer (an unnamed goal went out as "Goal, scorer to be named"). The shot alert from before the goal and a revision's line keep their words.
- **MTL at WSH and DAL at COL, October 14, 2026** (`test/nhl-oct14-review.test.ts`; both recordings replayed, old code against new, 253 events to 242 and 249 to 296 with the shootout's final alerts):
  - **A shootout decides the game.** ESPN posts the End Game play with the shootout's tally (DAL 2, COL 1) a few seconds before the scoreboard says Final/SO, so the tracker finished a 3-2 shootout win as a 2-2 tie and sent no loss. A game with a "start of shootout" play is no longer finished from End Game alone: the scoreboard's final decides (`live.ts`; no fallback if it never reports one), and the loss alerts read as any shootout loss ("Avalanche lost to the Stars", body "Lost to Dallas in a shootout. Final DAL 3, COL 2." from `shootoutLossBody`, line "Lost in a shootout.").
  - **A goal ESPN took out after it pushed** (Schwartz, 3 minutes on; Landeskog, 4) pushes "Goal taken off the board" / "Colorado's goal was disallowed. Still DAL 0, COL 0." to the followers of the team it was scored on (`PlayLedger.goneGoals`, `goalOffBoard`; the alert is `team.opponent_scored`, so it follows that setting; id `<game>:<play>:team.opponent_scored:off:<team>`; remembered in memory only, so a restart in between forgets it).
  - **A play id ESPN recycles** (id 4520 rewritten five times, a different shooter each time: three shot alerts for one shot) sends one alert; its later versions are lines only ("ESPN has since credited this play to X"), whoever the shooter is; a shootout attempt on a recycled id still pushes. A line never carries a bare type ("Blocked Shot — DAL 0, COL 0"): it carries the alert's own words (`BARE_TYPE`).
  - **A goal's assists corrected long after** (Texier became Dobson, 38 minutes on) is the line "ESPN has since changed the assists." and the feed rows take ESPN's words for as long as the ledger watches the play (45 minutes); a list filling in ("none", then one name, then two) is lag, not a change: only a name that drops out counts. A penalty's words follow ESPN's longer text ("… Interference" becomes "… Interference against Boone Jenner"), silently.
  - **A shot deleted just before the final** gets its "taken out" line (it used to keep its alert silently, the tracker stopping before the 30-second gone check): the read that ends the game counts a play it lacks as gone at once (`sweep(now, atFinal)`), unless it is newer than every play that read has (a short read drops the newest plays; judged by the plays' first-seen clocks, a heuristic).
- **COL at DAL, October 13, 2026** (the first game replayed through the code above; 30 of 159 shot, giveaway, penalty, fight and goal-allowed alerts still differed from ESPN's final play, 10 for plays ESPN took out): a shot ESPN first sees more than 3 minutes after it happened is back-fill and alerts nobody (`HOCKEY_STALE_SHOT_MS`, `HW_NHL_STALE_SHOT_MS`; the tracker logs "shot … first seen 1151s after it happened: not alerted"): ESPN posted six shots 4 to 31 minutes late with sequence numbers far below the game's, one of them a second alert for a shot it had taken out. A play posted late by the game clock (60 seconds or more behind the latest play, `lateScore`; hockey's clock counts up, so a period is 0 to 1200 seconds and an overtime has no check) shows the score now, not the score of its moment; a goal keeps its own. A fight's title leaves out "served by …" ("Fedor Svechkov dropped the gloves with Radek Faksa"). A penalty play whose text starts with the call ("Instigator against Radek Faksa", one participant, the player attacked) alerts nobody until ESPN names the player who took it. `test/col-dal-review.test.ts`.
- **Replayed** TOR at UTA, EDM at LA and COL at DAL, old code against new: nothing new appears; the shot alerts for shots that became goals, their lines and the penalty-call lines go (TOR 247 events to 235, EDM 298 to 280, COL 258 to 237); goal bodies match ESPN's final text on all 10 TOR goals (4 before); the 5 TOR penalties are named; COL's fights, hidden behind the placeholder, push (3 to 9 deliveries).
- **Tests:** `test/edm-la-review.test.ts`, `test/tor-uta-review.test.ts`.

**The final score.** ESPN's header and scoreboard can trail the plays: for at least five minutes after the Final they had Edmonton on 3 while its periods (3, 0, 1) and the plays said 4, and the Recent misery list recorded "Final Score: 3 to 1" for a game nobody tracked. The final is the higher of the header's score and the plays' last score, and every scoreboard score is the higher of ESPN's score and the sum of the period scores (`competitorScore` in `scores.ts`, used by the tracker, the Scores tab's cards and the Recent misery list); not with a fifth entry, which a shootout's doesn't add up.

### NHL and the shared team alerts

"Opponent scores" ("Jets scored on the Penguins"), "Falls behind" ("Penguins scored to take the lead over the Jets", `test/live-score.test.ts`), "Blows a big lead" live at 3 goals, a loss in overtime or a shootout as a fact ("Flames lost to the Senators in a shootout", `test/loss-facts.test.ts`; from the summary's "Final/OT" or "Final/SO", else the scoreboard's, else the periods played), a 4-goal blowout, and standings drops by division.

**Tests:** `test/sport-alerts.test.ts`, `test/new-alerts.test.ts`, `test/live-score.test.ts`, `test/loss-facts.test.ts`, `test/quiet-defaults.test.ts`.

## F1 drivers

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `f1.driver.dnf` | Doesn't finish | player | Race | push |
| `f1.driver.out_of_points` | Finishes outside the points | player | Race | push |
| `f1.driver.lost_places` | Loses places from the grid | player | Race | push |
| `f1.driver.beaten_by_teammate` | Finishes behind teammate | player | Race | push |
| `f1.driver.lapped` | Gets lapped | player | Race | push |
| `f1.driver.session_start` | Race starts | player | Race | push |
| `f1.driver.back_of_grid` | Starts from the back | player | Race | push |
| `f1.driver.pit_stop` | Pits | player | Race | feed only |
| `f1.driver.quali_knockout` | Knocked out in qualifying | player | Qualifying | push |
| `f1.driver.outqualified` | Out-qualified by teammate | player | Qualifying | push |
| `f1.driver.standings_drop` | Drops in the drivers' championship | player | Championship | feed only |

All of these come from `server/src/f1.ts`. How a race is read is in [F1 how](#f1-how).

### Doesn't finish (live)

- **Live** (`RaceWatch.poll`): while a race or sprint runs, each followed driver's status is read every 15 seconds (`F1_STATUS_MS`). A driver whose status turns to out (`isOut`: RETIRED, DNF, DSQ, DISQ, DNS, DID_NOT, ACCIDENT, NOT_CLASSIFIED) gets the alert then. The first read is a baseline (we may have attached mid-race).
- **Title** (`dnfEvent`, `outVerb`): "Sergio Pérez retired on lap 1", "<Name> retired", "<Name> was disqualified", "<Name> didn't start", or ESPN's status lowercased. **Body:** the session ("Singapore GP · Race").
- **At the finish** the classification includes it too; an alert already sent isn't sent again (the same id, `${compId}:f1.driver.dnf:${driverId}`).
- **The second car of a team out** is the team's double DNF ([F1 constructors](#f1-constructors)); the driver's DNF shares its moment, so a device tracking the team and the driver gets the team's.

### Finishes outside the points, loses places, behind teammate, lapped: one finish alert

When a race or sprint ends, each driver gets **one** alert with every fact that applies (`f1SessionResults`), under the first type that applies and the rest as `aliases`, so it counts for each switch.

- **Outside the points:** finished below 10th in a race, 8th in a sprint (`POINTS_CUTOFF`).
- **Lost places:** finished 3 or more places below the grid slot (`LOST_PLACES`).
- **Behind teammate:** the other car of the same constructor that day finished ahead (the teammate is whoever drove the other car that weekend, from the session's entry list).
- **Lapped:** a classified finisher with ESPN's `behindLaps` of 1 or more (not a retired car, and not one still on track when the session's over).
- **Title:** "<Name> finished P16 from P9 on the grid: no points, behind teammate Franco Colapinto (P13)" (README); "Charles Leclerc finished P12 from P2 on the grid: no points, behind teammate Lewis Hamilton (P3)" (`test/f1-timing.test.ts`); "Lance Stroll finished P20: no points, 2 laps down, behind teammate Fernando Alonso (P9)" (`test/sport-alerts.test.ts`). The "from P_ on the grid" part appears whenever they lost 3+ places; "lapped" or "N laps down" whenever lapped.
- **Live facts aren't counted twice:** a driver already told live that they were lapped or 3+ places down (`liveSent`: the stored `f1.lapped` and `f1.places` ids) keeps "lapped" in the finish title, but the finish alert doesn't count those types again, and leaves "from P3 on the grid" out (the live alert said it: Lewis Hamilton, 2026 Singapore GP, "finished P6: behind teammate Charles Leclerc (P2)" after "is down to P6 from P3 on the grid").
- **Only "no points"** with the team's no-points alert: the driver's alert shares the team's moment and the team's alert names the driver, so a device tracking both gets the team's.
- Id `${compId}:f1.finish:${driverId}`.

### Loses places from the grid (live)

- **Trigger** (`boardAlerts`, from the timing read every 30 seconds): a followed driver 3 or more places below their grid slot, counting only real places (`placesLost`: a car that started behind and is ahead counts only if it has stopped as often, and a car that started ahead and is behind counts against it only if out or stopped no more often, so a pit cycle isn't a loss), held for three reads in a row with no stop of theirs, and not on the last lap. Not for a car that has stopped on track (below). Once a session.
- **Title:** "Charles Leclerc is down to P5 from P2 on the grid" (`test/f1-timing.test.ts`), "Lando Norris is down to P9 from P4 on the grid". **Body:** "<session>: lap N".
- Id `${compId}:f1.places:${driverId}`.

### Gets lapped (live)

- **Trigger:** a followed driver's `lapsBehind` 1 or more for two reads in a row (`LAPPED_READS`), after lap 1 and not on the last lap (when a car the leader has finished ahead of looks a lap down until it crosses the line itself). Once a session.
- **Not for a car that has stopped:** a car whose laps completed (`lapsCompleted`) haven't gone up for 5 reads in a row (2.5 minutes, `STILL_READS`) is parked, and ESPN calls it out minutes later (Gabriel Bortoleto stopped on lap 7 and was marked retired seven minutes later, 2026 Singapore GP). It gets no lapped or places-lost alert; if it moves again they can still come, once. The DNF alert is ESPN's status, whenever that turns.
- **Title:** "Charles Leclerc was lapped by Max Verstappen" (the leader in the timing, else "the leader"). **Body:** "<session>: lap N, running P_".
- Id `${compId}:f1.lapped:${driverId}`.

### Pits (live, feed only by default)

- **Trigger:** a followed driver's pit stop count goes up between two timing reads; the alert goes out a read later, with where they came out. Not when the count went up for 75% or more of the cars still running in that one read (`FIELD_PITS`, at least 6 cars): that is a stoppage or ESPN counting the field, not stops (the 2026 Singapore GP sprint: every car's count went 1, 2, 3 on laps 3 to 5, 35 alerts for a 20-lap sprint).
- **Title:** "Charles Leclerc pitted and dropped from P3 to P5", "<Name> pitted and came out P4, up from P6", or "Lance Stroll pitted and held P6". **Body:** "Test GP · Race: lap 11, 1st stop" (`test/f1-timing.test.ts`).
- Id `${compId}:f1.pit:${driverId}:${stop}`.

### Race starts, and starts from the back

- **Race starts:** at lights out of a race or sprint seen before it started (`preSeen`), "Hate Watch Starting: <session>" for every constructor and driver in it (`startEvents`). They share one moment, and each is a name on one line of it (`list`), so a device gets one alert: "Hate Watch Starting: Singapore GP · Sprint" with "Yours: Alpine, George Russell." and "Lights out.". Constructors first by name, then drivers in grid order; five names, then "and N more" (`listLines` in `fanout.ts`).
- **Starts from the back:** a driver on the last two places of a grid of 10 or more (`backOfGrid`): "Lance Stroll starts from the back of the grid (P22)". At lights out it's a line on the start ("Valtteri Bottas starts from the back of the grid (P11)." in `test/f1-merges.test.ts`), and its own alert for a device with the start alerts off.
- **One notification:** the start and its back-of-grid lines go out in one publish, and F1 alerts from one session in one publish are one push per device (`bundled`).

### Knocked out in qualifying, out-qualified by teammate

- **When:** at ESPN's "session complete", once the order has held for a second scan (60 seconds); the final changes nothing. ESPN marked the 2026 Singapore GP's qualifying complete once, at the end of Q3, 33 minutes before the final; the second scan guards against a "complete" between Q1, Q2 and Q3.
- **Knockout stages:** the top 10 reach Q3; the rest split evenly between Q2 and Q1 (`cut = floor((cars - 10) / 2)`; with 22 cars, P11-16 are out in Q2 and P17-22 in Q1).
- **One alert per driver:** "<Name> was knocked out in Q1 (P<place>)", with ", behind teammate <Name> (P<place>)" when the teammate was ahead, or "<Name> was out-qualified by teammate <Name> (P<theirs> to P<teammate's>)", counting for both switches when both apply. Id `${compId}:f1.quali:${driverId}`.

### Drops in the drivers' championship (feed only by default)

- **Trigger** (`scanF1Standings`, every 60 seconds): a driver's rank in the drivers' standings is lower than the last read (kv `standings:f1`; the first read is a baseline).
- **Title:** "Alexander Albon dropped to 16th in the drivers' championship" (`test/f1-merges.test.ts`). **Body:** "Down from <old rank> · <points> pts".
- **A line on that day's result:** within 12 hours of a result alert the device got about that driver (`DROP_ON_MS`, `lateOn` with the result types), it's the line "Down to 16th in the drivers' championship (<points> pts)." on it instead (`test/f1-merges.test.ts`: Norris's drop is a line, Albon's, with no alert that day, is its own).
- Id `f1st:${key}:${day}:${from}->${to}`.
- **Told with the result, before ESPN's table** (`projectStandings`): ESPN's tables change minutes after a race or sprint is final (10:13 am for the 2026 Singapore GP, the flag at 9:51), so when the results go out the drops are worked out from the table as it was when the session went live (`freezeStandings`: kv `standings:f1:pre:<session id>`, kept across a restart) plus the points for the classification (25-18-15-12-10-8-6-4-2-1 in a race, 8 to 1 in a sprint, none for a car out, no fastest-lap point) and sent with the same id; ESPN's table later makes the same id and sends nothing. Not projected once ESPN's table has moved from that frozen one (it has the points), so a later re-read of the results (the final, a penalty) adds nothing. Ties are not drops. A result a penalty changes after the projection can leave the first drop standing and add the changed one under another id. Constructors the same way, from both cars.

**Tests:** `test/f1-live.test.ts` (a simulated race through the real engine), `test/f1-timing.test.ts`, `test/f1-singapore.test.ts`, `test/f1-merges.test.ts`, `test/logic.test.ts`, `test/sport-alerts.test.ts`, `node test/f1-replay.ts` (the real current weekend against ESPN's classification).

## F1 constructors

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `f1.team.double_dnf` | Double DNF | team | Team | push |
| `f1.team.no_points` | Scores no points | team | Team | push |
| `team.standings_drop` | Drops in standings | team | Season | feed only |
| `team.game_start` | Game starts | team | Game | push |

- **Double DNF (live):** the second car of a constructor out in a race or sprint (`RaceWatch.poll`): "Cadillac: double DNF" (`test/f1-merges.test.ts`), body "<session>: Sergio Pérez retired on lap 1; Valtteri Bottas retired on lap 6" (out first, by lap). It counts as "Scores no points" too (`aliases: ['f1.team.no_points']`), and it's a Successful Hate Watch (`HATE_WATCH_TYPES`). At the finish the classification makes the same alert (same id, `${compId}:f1.team.double_dnf:${team}`), so it isn't sent twice.
- **Scores no points:** at the finish, every car of the constructor out or below the points: "Successful Hate Watch! Ferrari finished outside the points" with the body "<session>: <driver> P12, <driver> DNF" (each car with its driver's name, best first). It's F1's Successful Hate Watch: the counter goes up under the constructor.
- **The team's alert takes in its drivers':** a driver whose own alert says nothing more than the team's (their DNF in a double DNF, or just "no points") shares the team's moment, so a device tracking both gets the team's alert.
- **Drops in the constructors' championship:** the shared "Drops in standings" switch (`team.standings_drop`, feed only by default): "<Constructor> dropped to <rank> in the constructors' championship", body "Down from <old rank> · <points> pts", a line on that day's result alert when there is one.
- **Race starts:** the constructor's "Hate Watch Starting" is `team.game_start` ([F1 drivers](#race-starts-and-starts-from-the-back): one alert per device naming its constructors and drivers).
- **Names:** constructors are named by the catalog's full name (`constructorName`), since ESPN's F1 short names are junk.

## F1 how

How a race weekend becomes alerts (`server/src/f1.ts`; its header comment is the summary).

- **No play-by-play:** a race weekend is one ESPN event whose sessions (practice, qualifying, sprint, race) are competitions. Only qualifying ("Qual"), the sprint ("SR" or "Sprint") and the race have alerts (`sessionKind`); practice and the sprint shootout don't.
- **The scoreboard every 30 seconds** (`scanF1`, `F1_SCAN_MS`), only while anyone tracks an F1 driver or constructor (`watchedF1Drivers`: followed drivers and both cars of a followed constructor). It finds sessions going live and finishing, and fills the Scores tab.
- **While a race or sprint runs** (`RaceWatch`): the followed drivers' statuses every 15 seconds (DNFs and double DNFs live), and every 30 seconds every car's timing from ESPN's core API (`readBoard`, about 45 small requests: place, gap, laps down, pit stops, status, plus the session's lap and flag). The timing fills the race's card (`withBoard`) and makes the live alerts (`boardAlerts`) against the read before; the first read is a baseline. Nothing live once the flag has fallen: the finish alerts say it.
- **Results** (`settleSession`): a race or sprint is read when ESPN says the session is complete (minutes after the flag, before ESPN calls it final, up to 40 minutes later), on the scoreboard's order, after one scan's wait if a car still reads on track in ESPN's status (its laps down may not be in yet); qualifying when it's final. Then read again when the order or status changes and the change holds for a second scan: a penalty, or the final order. A re-read corrects what went out (`settleResults`): an alert whose facts changed is rewritten in place with no push (`reviseEvent`); one now true goes out; one no longer true becomes "Correction: Pierre Gasly finished P8" (body "<session>: the result changed after this alert.") and stops being a Successful Hate Watch ("Correction: Alpine finished P8, P10" for a team, `test/f1-merges.test.ts`).
- **Only recent sessions:** results are announced and corrected only for sessions that started in the last 8 hours (`RECENT_MS`), so a deploy never re-announces an old race.
- **One alert per driver per session,** facts merged, counting for each switch ([F1 drivers](#f1-drivers)).
- **One notification per session:** a device's F1 alerts from one session in one publish are one push, "🏁 Singapore GP · Sprint: 7 alerts", each alert's title a line of it, in the thread `f1:<session id>` (`bundled` in `fanout.ts`). Each is still its own feed row.
- **Starts:** only a race or sprint seen before lights out (`preSeen`) gets a start; one found already running after a restart doesn't.
- **Standings:** `scanF1Standings` every 60 seconds; drops are lines on that day's result alerts when there are some.
- **Checked:** the README's Known limits say the live path is tested with a simulated race (`test/f1-live.test.ts`) and the timing the same way (`test/f1-timing.test.ts`), read from ESPN during the 2026 Singapore GP's last laps.

## Any player

The alerts every tracked player can get, whatever the league: getting injured, getting ejected (NFL, NHL), their team losing, and the off-field news. Each has its own section; this one says which leagues have which.

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `player.team_lost` | Their team loses | player | Game | push |
| `player.ejected` | Gets ejected | player | Game | push |
| `player.injured` | Gets injured | player | Injuries & news | push |
| `off_field` | Off-field trouble | player | Injuries & news | push |
| `fine_suspension` | Fined or suspended | player | Injuries & news | push |

- **Gets injured** (`player.injured`): NBA, WNBA, MLB, NFL, NHL. From the injury reports read every 30 seconds ([Injury reports](#injury-reports)): "Cooper Rush is injured (Out)", or "Cooper Rush downgraded to Out" when a player already listed gets worse. ESPN's EPL injury report is empty, F1 and the UFC have none, and college football isn't scanned (no players).
- **Gets ejected** (`player.ejected`): the NFL ("Daron Payne got ejected") and the NHL ("Evgeni Malkin got ejected (game misconduct)"). It counts as the player's penalty alert too, so it's one alert. NBA ejections are its technical-foul alert ("got ejected 🚪"), soccer's "Sent off"; ESPN doesn't report MLB ejections. Details: [NFL](#gets-ejected-nfl), [NHL](#penalties-fights-and-ejections).
- **Their team loses** (`player.team_lost`): NBA, WNBA, MLB, NFL, NHL and soccer. Not college football (no players), F1 (a constructor's no-points is its own alert) or the UFC (a fighter's loss is their own alert). Details: [Their team loses](#their-team-loses).
- **Off-field trouble, Fined or suspended** (`off_field`, `fine_suspension`): every league with players, F1 and the UFC included. Details: [Off-field trouble / Fined or suspended](#off-field-trouble--fined-or-suspended-every-league-players-and-teams).
- **The Hate Watch streak** (`team.hate_watch_streak`) is a team type with `alsoScope: 'player'`, a line on "their team lost" too ([Your Hate Watch](#your-hate-watch-the-streak-and-the-weekly-recap)).
- **Which ones a player's settings screen shows:** each type's `positions` in `event-types.ts` against every position the player has played this season (`fitsPosition` in `app/src/lib/positions.ts`); these five have no position limits.

## Their team loses

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `player.team_lost` | Their team loses | player | Game | push |

- **Trigger:** a team's loss (`GameTracker.finish` in `live.ts`), for every player on the losing team that anyone tracks (`trackedPlayersOn`: followed players whose catalog team is the loser). Built by `playerTeamLostEvents()` in `detectors.ts`, one per player, sorted by name.
- **Title:** "Successful Hate Watch! Freddie Freeman and the Dodgers lost to the Giants"; soccer "…Alexander Isak and Liverpool lost to Bournemouth"; a blowout "Caleb Williams and the Bears got BLOWN OUT by the Eagles" (`test/game-start.test.ts`); soccer's 3+ goals "Jack Rudoni and Coventry were thrashed 5-0 by Brighton" (`test/soccer.test.ts`); an elimination "Munetaka Murakami and the White Sox are ELIMINATED ⚰️" (`test/alds-game5.test.ts`) or "Aaron Judge and the Yankees got SWEPT 🧹 and are ELIMINATED ⚰️".
- **Body:** the team loss's body: "Final Score: 27 to 13" ("Bijan Robinson and the Falcons lost to the Saints", `test/team-lost.test.ts`), with the elimination's line when there is one ("Swept 3-0 by the Rays in the ALDS. Final Score: 5 to 2").
- **One alert per loss:** the team's loss and its players' alerts share the loss's moment (`lossMoment`: `${gameId}:final:lost`). The team's goes first, then its facts, then these. A device that tracks the team and wants "Loses a game" gets the team's alert; the player ones have no `fold`, so they're dropped as the same news. A device that tracks only players, or has team losses off, gets the alert for the player it started tracking first (`firstFollowed`: the earliest `follows.created_at` among the ones it wants; a player whose "Their team loses" is off is passed over).
- **The loss's facts reach player trackers too:** `playerLossLines()` copies every fact with a `fold` (shut out, walk-off, lost as favorites, the last half-inning's lines…) onto each tracked player, `foldOnly`, so a device tracking only Ohtani gets "Successful Hate Watch! Shohei Ohtani and the Dodgers lost to the Giants" with "Lost as 64% favorites. Shut out. Lost to the 10-13 Giants. Lost 5 straight. Final Score: 3 to 0" (`test/loss-facts.test.ts`). Each copy is the fact's own type, so the device's switch for that fact decides.
- **The losing pitcher's "took the loss"** shares the same moment, so it's a line on whichever loss alert the device got ([MLB pitchers](#mlb-pitchers-blown-save-no-quality-start-loss)).
- **Counted for the team:** each one carries `lostId` (the team loss's id) and `teamKey`, so the Successful Hate Watch counter goes up under the team, once per device, never under the player (`hateWatchOf`, `recordHateWatch` in `hate-watches.ts`), and whether or not the device's alert is on.
- **On by default,** pushed. One switch in Settings → All player alerts, and on each player's gear screen.
- **Preseason basketball: only players who dressed.** In a preseason NBA or WNBA game (`seasonType === 1`) a tracked player the box score doesn't list gets no "their team lost" (`dressed` in `GameTracker.finish`): the starters sat, and 8 of the 21 Knicks players with one in Knicks at Raptors (October 13 2026, 148-98) weren't in the box score at all (Brunson, Towns, Bridges, Hart, Anunoby, Clarkson, Shamet, Drummond). A player listed with a DNP is skipped since October 14 (`didNotPlay`). Everyone gets it in the regular season, played or not. Without a box score every tracked player gets it.
- **Ids:** `${gameId}:final:player.team_lost:${athleteId}`.
- **Draws and ties aren't losses:** `gameLostEvent` returns nothing for a level final, so nothing here either.

**Tests:** `test/team-lost.test.ts`, `test/loss-facts.test.ts`, `test/eliminated.test.ts`, `test/soccer.test.ts`, `test/new-alerts.test.ts`, `test/hate-watches.test.ts`.

## Injury reports

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `player.injured` | Gets injured | player | Injuries & news | push |
| `team.player_injured` | A player gets injured | team | Injuries & news | feed only |

- **Read:** every 30 seconds per league (`scanInjuries` in `live.ts`, `INJURIES_MS`, `HW_INJURIES_MS`), for every game league but college football (`GAME_LEAGUES` less `TEAMS_ONLY`), with a conditional request. The report is saved in kv (`injuries:${league}`); the first read is a baseline, so nothing is sent for what was already on it.
- **Who isn't injured:** ESPN lists NFL players cleared for the game as "Active" (hundreds every game day) and MLB leave as "paternity" or "bereavement"; those are dropped before the comparison (`NOT_INJURED` in `parseInjuryReport`).
- **What counts as worse** (`severity`): injured reserve, IR, 60-day or season (4); out or suspension (3); doubtful (2); questionable, day-to-day or probable (1); anything else (1). A player alerts when they're new on the report or their status is more severe than before. A recovery or the same status sends nothing.
- **The player's alert:** "Cooper Rush is injured (Out)" when new, "Cooper Rush downgraded to Out" when worse (`test/injuries.test.ts`). **Body:** ESPN's short comment, else the details type, else "<Team> injury report". Id `inj:${league}:${athleteId}:${status}:${day}`: once a day per status.
- **The team's alert, one per report update:** every player on a team who changed in that read is one `team.player_injured` alert for the team, not one per player.
  - One player: "Falcons: Cooper Rush downgraded to Out", the same alert and id as before batching (`${playerId}:team`).
  - Several, all downgraded to one status: "Falcons: 6 players downgraded to Out".
  - Otherwise: "Falcons: 3 players on the injury report (2 Out, 1 Questionable)", or "Falcons: 6 players on the injury report (6 Out)" when they're new names with one status.
  - **Body:** the first three by severity, then name ("Cooper Rush (Out), Jared Ivey (Out), Robert Longerbeam (Questionable)"; without statuses when they all share one), and "and 3 more".
  - **Id:** `inj:${league}:team:${espnId}:${day}:${hash}`, the hash being of the exact set of changes, so a re-scan or a restart never sends the same batch again.
- **Player and team alerts are separate:** they have no shared moment, so a device tracking Cooper Rush and the Falcons gets both his alert and the team's.
- **Defaults:** "Gets injured" pushes; "A player gets injured" (the team's) is feed only by default (installs from before October 2026 kept it pushed, `WERE_PUSHED`).
- **One stack on the lock screen:** the team's alerts and its players' all have the team's thread id ("one iOS stack for the Falcons", `test/injuries.test.ts`; [iOS notification stacks](#ios-notification-stacks)).
- **Real numbers:** the README row records one NFL game day's report: 800 entries, 207 injuries, 30 team alerts where it used to be 104.

## iOS notification stacks

How pushes group on an iPhone, and what every push carries (`publish()` in `server/src/fanout.ts`).

- **The thread:** every push has a `threadId` from `pushThread(targetKey)`: the team's key for a team's alert ("team:nfl:1"), and for a player's alert the key of the team the catalog has them on. iOS stacks a thread's notifications together on the lock screen and in Notification Center, so a team's alerts and its players' are one stack. A target not in the catalog uses its own key.
- **F1 sessions:** a device's F1 alerts from one session in one publish are one notification, "🏁 <session>: N alerts", each alert's title a line of it, with the thread `f1:<session id>` (`bundled`).
- **The weekly recap** has the thread `recap` and the interruption level `active` (`publishTo`).
- **Every other push:** the title is the alert type's emoji, a space, and the alert's title ("🤕 Cooper Rush is injured (Out)", `test/injuries.test.ts`); the body is the alert's body with the device's folded lines in front; sound "default" unless the device turned sound off; priority high; Android channel `hate-events`; iOS interruption level `time-sensitive`; data `{ eventId, targetKey, type }`.
- **Which devices:** see [How every alert is delivered](#how-every-alert-is-delivered): the device must have a push token, push on, the target not muted (its bell-off switch on the Tracking tab), outside quiet hours, and the alert type's bell on.

## Teams

The team alerts every league shares, and the standings alerts. The loss and its facts are in [Successful Hate Watch](#successful-hate-watch), scoring in [Scored on + fell behind](#scored-on--fell-behind), starts in [Game starts](#game-starts), elimination in [Eliminated from playoffs](#eliminated-from-playoffs).

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `team.lost` | Loses a game | team | Game | push |
| `team.game_start` | Game starts | team | Game | push |
| `team.fell_behind` | Falls behind | team | Game | feed only |
| `team.opponent_scored` | Opponent scores | team | Game | feed only |
| `team.eliminated` | Eliminated from playoffs | team | Season | push |
| `team.losing_streak` | Losing streak | team | Season | feed only |
| `team.rival_clinched` | Rival clinches the division | team | Season | feed only |
| `team.standings_drop` | Drops in standings | team | Season | feed only |
| `team.off_field` | Off-field trouble | team | Injuries & news | push |
| `team.fine_suspension` | Fined or suspended | team | Injuries & news | push |
| `team.player_injured` | A player gets injured | team | Injuries & news | feed only |

### Drops in standings (feed only by default)

- **Read:** every 60 seconds per league (`scanStandings` in `live.ts`, `STANDINGS_MS`, `HW_STANDINGS_MS`), and 15 seconds after any final (`onGameFinal`); college football every 10 minutes. Saved in kv (`standings:${league}`); the first read is a baseline.
- **Not in the preseason:** ESPN's table counts preseason games as wins and losses (the Magic went from 4th to 10th in the East on one game, October 11 2026, and the Bulls' "Streak: L2" was two preseason games), so while the table's season type is 1 (`standingsSeasonType`: `standings.seasonType` on its first group) no standings news goes out in the NBA, WNBA, MLB, NFL, NHL or college football: no drop, no clinch, no elimination, no losing streak, and no standings line on the loss. The table is still saved, and the first table after the preseason (`standings-season:${league}` in kv held 1, the new one doesn't) is a new baseline, so the regular season's first table, which starts over, makes no drops. The regular season ending (the playoffs) is no reset: that is where eliminations and clinches land. Not soccer: ESPN calls the Premier League's regular season type 1.
- **By division** in MLB, the NFL and the NHL (`DIVISION_STANDINGS`: ESPN's `?level=3`): each team has its seed in its league or conference and its place in its division. A drop in the division names it: "White Sox dropped to 2nd in the AL Central", body "Down from 1st. 6th in the AL."; a drop in the seeding alone says the division too: "Rangers dropped to 4th in the East", body "Down from 3rd. 2nd in the Metropolitan.". Division names as fans say them ("AL Cent" becomes "AL Central", " Division" dropped).
- **Elsewhere** the group: the NBA and WNBA by conference, the EPL as its table ("the Premier League", its group named for the league, not the season), college football by conference ("Big Ten", "SEC").
- **Body** (`dropBody`): "Down from 16th.", the other place, "Into the relegation zone 🪂" (soccer, when it's new), and "Streak: L3" when ESPN has a streak.
- **A line on the loss:** a drop within 6 hours of a loss alert the device got for that team (`DROP_ON_LOSS_MS`, `lateOn` with `loss: true`, which finds the team's loss whichever alert the device got: the team's, a fact in its place, or a player's "their team lost") is a line on it instead: "Down from 2nd to 8th in the Big Ten." on "Successful Hate Watch! Nebraska lost to Indiana". It reads the feed in the database, so it works after a restart.
- **Id:** `standings:${league}:${teamId}:${day}:${from}->${to}` (with the division's name when it's a division drop): once a day per move.
- F1's constructors use the same switch for the constructors' championship ([F1 constructors](#f1-constructors)).

### Losing streak (feed only by default)

- **At the loss** (a fact, `lossFacts`): ESPN's standings streak before the game ("L4", saved with the pregame facts in kv `pregame:${league}:${gameId}`) plus this loss, when it reaches 3, in the regular season only (ESPN's season type 2; the playoffs and preseason show the regular season's last streak), and only when the record has the losses for it (a new season's 0-0 next to last season's "L4" doesn't count). Title "Successful Hate Watch! Dodgers have lost 5 straight", fold "Lost 5 straight." (`test/loss-facts.test.ts`). A line on the loss; colleges say "has lost".
- **From the standings:** a team whose ESPN streak is L3 or longer and changed since the last read: "<Team> have lost 4 straight", body "Current streak: L4". Not when the loss alert already said that streak (kv `streak-told:${league}:${teamId}`, written by `GameTracker.finish`).
- With the Hate Watch streak on, the two make one line ([Your Hate Watch](#your-hate-watch-the-streak-and-the-weekly-recap)).

### Rival clinches the division (feed only by default)

- **Trigger:** in MLB, the NFL, the NBA or the NHL, a team whose standings clincher becomes a division title (`DIVISION_TITLE`: "y", or "z", "*", "p", which include it). Every other team in that division (`divisionsOf`, from `server/src/divisions.ts`) gets the alert. The WNBA has no divisions: there, a team getting ESPN's "*" (the league's best record, `WNBA_TOP_SEED`) is the clinch, for the rest of its conference: "The Lynx clinched the WNBA's best record", body "Valkyries won't be the top seed.".
- **Title:** "The <Rival> clinched the <division>", body "<Team> won't win the division.", fold "The <Rival> clinched the <division>.". Id `clinch:${league}:${rivalId}:${year}:${teamId}`.

### One alert per team per standings read

Each read's standings news for a team shares one moment (`standings:${league}:${teamId}:${time}`), in this order: eliminated, rival clinched, into the relegation zone, the drop, the losing streak. A device gets the first it wants, with the others as lines: "Down to 4th in the AL East. Officially out of playoff contention.".

### MLB: the play that batted the runs in

MLB's scored-on, fell-behind and blew-a-lead titles name the play that batted the runs in (`rbiPlay` in `detectors.ts`), for the team scored on: "Guardians took the lead over the White Sox on Ramírez's 348-foot 2-run homer", "Rays tied the Yankees on Diaz's RBI single", "Rays scored on Diaz's 2-run double against the Yankees", "Rays scored on Diaz's 380-foot 2-run homer against the Yankees" (`test/sport-alerts.test.ts`), "White Sox scored on Antonacci's sacrifice fly against the Guardians", "…on a bases-loaded walk to Murakami". The kinds: homer (with ESPN's distance; "grand slam" for 4), single (infield and bunt singles too), double, ground-rule double, triple, sacrifice fly, squeeze bunt, groundout, fielder's choice, a bases-loaded walk or hit-by-pitch. "RBI" for one run, "2-run" for more. A name ending in s takes an apostrophe alone ("Pages' 2-run single"). A run nobody batted in (a wild pitch, a balk, an error, a double play) says the runs as before: "Rays scored 1 run on the Yankees".

## Eliminated from playoffs

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `team.eliminated` | Eliminated from playoffs | team | Season | push |

Two ways out.

- **Regular season, from the standings** (`scanStandings`): ESPN's clincher gains an "e" ("Officially out of playoff contention"). Title "<Team> are ELIMINATED ⚰️" ("is" for a school), body "Officially out of playoff contention. See you next year.". Id `elim:${league}:${teamId}:${year}`: once a season. Within 6 hours of a loss alert the device got for that team, it's the line "Officially out of playoff contention." on the loss instead (`lateOn` with `loss: true`), one alert.
- **Postseason, from the final** (`eliminationOf` in `detectors.ts`): the standings never mark these teams (they keep the "x" or "y" they clinched with), so the scoreboard's final decides, for a postseason game (ESPN season type 3):
  - **A series** (MLB, NBA, WNBA, NHL): the side with fewer wins is out when ESPN marks the series completed, or when this game is the one that wins it. The scoreboard can show a final before it counts it: when the wins add up to less than the game's number ("Game 3"), the game's winner gets one more. Needed to win: half the series' games, rounded down, plus one.
  - **The NFL:** every postseason loss is a knockout.
  - **College football:** only the College Football Playoff (its note says "playoff"); a bowl game isn't an elimination.
  - **Lines** (from ESPN's note, "ALDS - Game 3" becoming "ALDS"; "ALWC" and "NLWC" spelled out): "Swept 3-0 by the Rays in the ALDS", "Lost the NL Wild Card Series 2-1 to the Braves", "Lost the West 1st Round 4-2 to the Wild", "Lost Super Bowl LX to the Seahawks", "Lost to <winner> in the <round>" (`test/eliminated.test.ts`).
- **One alert: the loss itself.** A knockout is that game's Successful Hate Watch with the elimination in it (`gameLostEvent`): "Successful Hate Watch! Yankees got SWEPT 🧹 and are ELIMINATED ⚰️", body "Swept 3-0 by the Rays in the ALDS. Final Score: 5 to 2"; otherwise "Successful Hate Watch! Patriots are ELIMINATED ⚰️". It counts for "Loses a game" and "Eliminated from playoffs" (`aliases: ['team.eliminated']`), so either switch gets it. A blowout adds its sentence to the body ("…Final Score: 9 to 2. A 7-run blowout.").
- **Players:** "their team lost" says it too: "Successful Hate Watch! Munetaka Murakami and the White Sox are ELIMINATED ⚰️", with the same line.
- **Waiting for the series:** a postseason final waits for the scoreboard's next read (every 10 seconds), which finishes the game with the event, series included. If that hasn't happened in 2 minutes (`PLAYOFF_FINAL_WAIT_MS`, `HW_PLAYOFF_FINAL_WAIT_MS`), the loss goes out with the series from the game's own summary (`summaryEvent`: the summary lists series, the playoff one is used, and the round is its `gameNote`).
- **Regular-season facts are skipped** on a playoff loss (records, sweeps): a playoff sweep is in the title.
- **A series game that ends nothing says where the series stands for its loser** (`seriesStanding`, read like `eliminationOf` from the same event, including the game the scoreboard hasn't counted yet): a line in front of the score in the loss's body, so "their team lost" and a loss-fact alert carry it too. "Down 0-1 in the NLCS. Final Score: 2 to 1" (Dodgers at Brewers, NLCS Game 1, October 11 2026), "Series tied 2-2.", "Still up 2-1 in the ALDS." (the loser still ahead). Nothing for the game that ends the series (that is the elimination), for the NFL, or in the regular season (`test/nlcs-game1.test.ts`).
- **Checked:** the README row records every 2026 playoff final available (the MLB Wild Card round, an NHL first round, the NFL playoffs, the WNBA first round). `test/alds-game5.test.ts` replays ALDS Game 5 (White Sox at Guardians, October 10 2026): "Successful Hate Watch! White Sox are ELIMINATED ⚰️" with "Shut out. Struck out in order in the 9th. Lost the ALDS 3-2 to the Guardians. Final Score: 2 to 0".

## Game starts

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `team.game_start` | Game starts | team | Game | push |
| `f1.driver.session_start` | Race starts | player | Race | push |
| `ufc.fight_start` | Fight starts | player | Fight | push |

- **Trigger:** the game's tracker sees ESPN's status go from "pre" to "in" (`GameTracker.poll` in `live.ts`, polled every 2 seconds; college football every 5). Once (`started`).
- **Only for a game seen before it started** (`sawPre`): the scoreboard (every 10 seconds) noted it as "pre" while someone tracked a side (`preSeen` in `LiveEngine`), or the tracker itself read it as "pre". A tracker is created for a tracked game that's live or starts within 3 minutes. A game that's already under way when someone follows the team, or when the server restarts, never gets a late "starting" alert.
- **Title, each team from its own side** (`gameStartEvents` in `detectors.ts`): "Hate Watch Starting: Eagles vs Bears" for the Eagles' trackers, "Hate Watch Starting: Bears vs Eagles" for the Bears' (`test/game-start.test.ts`).
- **Body:** the league's start word, the venue, and the TV channel: "Kickoff at Lincoln Financial Field · FOX". A postseason game puts its round and game first (`roundLabel`, from the summary's `gameNote`, else the scoreboard's note): "NLCS Game 1 · First pitch at American Family Field · Fox", "Super Bowl LX · Kickoff at …"; nothing in the regular season, or for a note over 40 characters (a long sponsored bowl name) (`test/nlcs-game1.test.ts`). Start words (`START_WORD`): Kickoff (NFL, college football, soccer), Tip-off (NBA, WNBA), Puck drop (NHL), First pitch (MLB). The channel is the national broadcast when there is one, else the first listed.
- **Tracking both teams:** the two alerts share the moment `${gameId}:start` and are `firstFollowed`, so a device tracking both sides gets one, about the team it followed first.
- **Through a player:** a device tracking a player with "Get their team's alerts" on gets the team's start too (`recipients` in `fanout.ts`).
- **Favorite teams:** a device that favorites a team gets the start of its game, even when nobody tracks either side: the scan attaches a tracker to a favorite's game (`favoriteTeamKeys`), and the favorite receives the opponent's start alert ("Hate Watch Starting: Packers vs Lions" for a Lions favorite), once, with the favorite's own "Game starts" choice and push switch (`favoritePrefs`). Favoriting both sides gives one alert (`test/favorites.test.ts`, `test/game-start.test.ts`).
- **F1:** at lights out of a race or sprint, one "Hate Watch Starting: <session>" per device, naming its constructors and drivers in it ("Yours: Alpine, George Russell."), with "Lights out." ([F1 drivers](#race-starts-and-starts-from-the-back)). The constructors' is `team.game_start`, the drivers' `f1.driver.session_start`.
- **The UFC:** "Hate Watch Starting: Eric Nolan vs Court McGee" at the walk-outs ([UFC](#ufc)).
- **Ids:** `${gameId}:team.game_start:${teamId}`.

## Successful Hate Watch

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `team.lost` | Loses a game | team | Game | push |
| `team.last_second_loss` | Loses at the last second | team | Game | push |
| `team.blew_lead` | Blows a big lead | team | Game | push |
| `team.lost_as_favorite` | Loses as the favorite | team | Game | push |
| `team.shut_out` | Gets shut out | team | Game | push |
| `team.swept` | Gets swept | team | Game | push |
| `team.lost_to_worse` | Loses to a worse team | team | Game | push |
| `team.below_500` | Falls below .500 | team | Game | push |
| `f1.team.no_points` | Scores no points | team | Team | push |

### The loss

- **When a game is final:** the summary says completed, or (ahead of it) the play-by-play has an "End of Game" play (football only after a 4th-quarter play); or the scoreboard (every 10 seconds) sees the final, which is the backstop for a tracker that missed it (a restart right after the buzzer: a final less than 6 hours after the start makes a tracker just to finish it). `GameTracker.finish` runs once.
- **Title** (`gameLostEvent` in `detectors.ts`): "Successful Hate Watch! Eagles lost to the Bears"; a blowout "Successful Hate Watch! Bears got BLOWN OUT by the Eagles" ([Blowout losses](#blowout-losses)); soccer's 3+ goals "…Coventry were thrashed 5-0 by Brighton"; a knockout "…Yankees got SWEPT 🧹 and are ELIMINATED ⚰️" ([Eliminated from playoffs](#eliminated-from-playoffs)). Clubs and schools don't get "the" ("Man United lost to Fulham", "Georgia lost to Vanderbilt").
- **Body:** "Final Score: 24 to 17", the winner's score first. A playoff series game that ends nothing puts the series line first: "Down 0-1 in the NLCS. Final Score: 2 to 1" ([Eliminated from playoffs](#eliminated-from-playoffs)).
- **Ties send nothing** (`final.home === final.away`).
- **A Successful Hate Watch is counted** for every device tracking the team or one of its players, before alert settings are checked (`recordHateWatch` in `publish`), and the alert says how many others got it ("23 other hate watchers": the README's counter section).
- **The loss gets a clip:** the winning play's (the play that put the winner ahead for good, `leadStory`), else the recap (`lossClip` in its meta; MLB, NBA, WNBA, NHL; `server/src/clips.ts`).
- **Id:** `${gameId}:final:team.lost:${loserId}`, moment `${gameId}:final:lost`.
- **Its meta** (never the words): `gameId`, `winnerId`, `margin` (the winner's score minus the loser's), `score` ("45-17"), `blowout`, `eliminated` and `sweep`, and `preseason: true` when the game is a preseason game (ESPN's season type 1, from the tracker's summary or the scoreboard event: `live.ts` `finish`, `misery.ts` `board`). Recent misery keeps the margin for its internal severity score (`docs/recent-misery.md`, "How bad a loss was": shown nowhere) and a preseason loss is never scored. No new alert, id or push.

### How they lost: the loss's facts

Each fact is its own alert type with its own switch under Team alerts (`lossFacts` in `detectors.ts`). They share the loss's moment and go out after it:

- a device that gets the loss gets each fact it wants as a line on it: "Walk-off loss in the 10th. Lost as 78% favorites. Final Score: 4 to 3";
- a device with the loss off gets the first fact it wants as the alert, titled as a loss ("Successful Hate Watch! Rockets lost to the Pelicans as 77% favorites"), with the other facts it wants as lines ("Blew a 25-point lead. Lost to the 5-22 Pelicans. Final Score: 133 to 128", `test/loss-facts.test.ts`). It carries `lostId`, so it counts as the loss.
- Some facts are only ever lines (`foldOnly`): a blown lead at the final, no-hit, the other team's star, a dead power play. With the loss off, they aren't a reason to hear about it.

The facts, in the order they're added:

- **Loses at the last second** (`team.last_second_loss`), by the play that put the winner ahead for good (`leadStory`):
  - MLB walk-off: the home team went ahead in the bottom of the 9th or later. "Successful Hate Watch! Phillies walked off the Nationals in the 10th" (extra innings named), fold "Walk-off loss in the 10th.".
  - NBA, WNBA: the winner went ahead in the 4th or overtime with 10 seconds or fewer left (`LAST_SECONDS`): "Magic beat the Trail Blazers with 2.1 seconds left" or "…at the buzzer", fold "Beaten with 2.1 seconds left.".
  - NFL, college: in overtime ("<Team> lost to the <Winner> in overtime", fold "Lost in overtime."), or in the 4th with 30 seconds or fewer left ("Falcons beat the Saints as time expired", "…with 0:24 left").
  - NHL: overtime or a shootout ("Flames lost to the Senators in a shootout", fold "Lost in a shootout.").
  - Soccer: the winner's go-ahead goal in stoppage time at the end ("Burnley conceded a stoppage-time winner to Man United", fold "Conceded a stoppage-time winner (90'+3').").
- **Blows a big lead** (`team.blew_lead`, a line only at the final): the loser's biggest lead was at least MLB 3 runs, NBA 15, WNBA 12, NFL 14, college 17, NHL 2 goals, soccer 2 (`BLEW_LEAD`). "Blew a 25-point lead." ("Rockets blew a 25-point lead and lost to the Pelicans"; "Nationals blew a 4-run lead and lost to the Phillies"). The live alert with the same switch is in [Scored on + fell behind](#scored-on--fell-behind).
- **Loses as the favorite** (`team.lost_as_favorite`): the loser's chance from the betting line before the game (the moneyline with the margin taken out, `oddsChance` in `scores.ts`, saved with the pregame facts) was at least MLB 62%, NHL 65%, NBA, WNBA and NFL 75%, college 80%, soccer 60% (`FAVORITE_CHANCE`). "Dodgers lost to the Giants as 64% favorites", fold "Lost as 64% favorites.".
- **Loses to an unranked team** (college only, [College football](#college-football)).
- **Gets shut out** (`team.shut_out`): the loser scored 0, not in basketball or soccer. "Dodgers were shut out by the Giants", fold "Shut out."; football "…were held scoreless by…" ("was" for a school), fold "Held scoreless.".
- **No-hit, the star, the power play** (from the final box score, lines only): "No-hit." (MLB), "Jalen Brunson scored 41 on them." (NBA 40+, WNBA 30+), "0-for-<chances> on the power play." (NHL, 4+ chances). See [MLB teams](#mlb-teams), [NBA](#nba), [NHL](#nhl).
- **Regular season only** (not on a playoff loss):
  - **Gets swept** (`team.swept`): from the team's regular-season schedule, read once at the start (`seriesSpot`): MLB, this game ends a series with this opponent of 3 games or more, all lost; everyone else, this is the season's last meeting with them, of 3 or more (NFL 2: division rivals meet twice), all lost (`SWEEP_GAMES`; none for soccer or college). "Dodgers got swept by the Giants", fold "Swept in the series, 0-3." or "Swept in the season series, 0-2.".
  - **Loses to a worse team** (`team.lost_to_worse`): both records before the game at least MLB 20 games, NBA and NHL 10, WNBA 8, NFL and college 4 (`MIN_GAMES`), and the winner's win percentage at least .150 below the loser's in MLB and the NHL, .200 in the NBA, WNBA and NFL, .250 in college (`WORSE_GAP`). NHL percentages are points percentages; NFL ties count half. "Dodgers lost to the 10-13 Giants", fold "Lost to the 10-13 Giants.".
  - **Falls below .500** (`team.below_500`): the record before was exactly .500 (wins equal losses), enough games in, and not an NHL overtime loss (it doesn't count against .500). "Dodgers lost to the Giants and fell below .500", fold "Now 12-13, below .500." (the NHL and an NFL record with ties keep the third number).
- **Losing streak** ([Teams](#losing-streak-feed-only-by-default)): "Lost 5 straight.".

The records, streaks, odds and series are read before the game (`readPregame`, `readSeries`) and kept in kv (`pregame:${league}:${gameId}`), so a restart mid-game still has them; they're deleted at the final.

**Turning the loss off turned the facts off once:** when the facts were added (October 2026), every device that had "Loses a game" off (in Settings or for one team) got the six facts with their own switches (last second, favorite, shut out, swept, worse team, below .500) turned off too, once (`lossFactsFollowLoss` in `fanout.ts`, kv `prefs:loss-facts`), so a loss they'd silenced didn't come back as one of its facts.

### F1's Successful Hate Watch

A constructor finishing a race or sprint with no car in the points: "Successful Hate Watch! Ferrari finished outside the points", body "<session>: <driver> P12, <driver> DNF" ([F1 constructors](#f1-constructors)). A double DNF keeps its own live alert, which counts for this switch too. Both count on the Successful Hate Watch counter (`HATE_WATCH_TYPES` in `hate-watches.ts`).

**Tests:** `test/loss-facts.test.ts`, `test/game-start.test.ts`, `test/new-alerts.test.ts`, `test/hate-watches.test.ts`, `test/team-lost.test.ts`, `test/alds-game5.test.ts`, `test/clips.test.ts`.

## Blowout losses

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `team.lost` | Loses a game | team | Game | push |
| `player.team_lost` | Their team loses | player | Game | push |
| `epl.team.heavy_loss` | Loses by 3+ goals | team | Team | push |

- **The margins** (`BLOWOUT_MARGIN` in `detectors.ts`), set so about 1 in 8 losses qualifies (from full 2025-26 seasons of four teams a league): MLB 7 runs (12% of losses; 6 would be 20%), NFL 21 points (three scores, 14%), NBA 25 (14%; 20 is 26%), WNBA 20 (11%), NHL 4 goals (19%; 5 is only 7%), soccer 3 goals (12%), and college football 42 points (`cfb: 42`).
- **Same alert, new words:** it's the "Loses a game" alert and switch. Title "Successful Hate Watch! Bears got BLOWN OUT by the Eagles" (`test/game-start.test.ts`), body "Final Score: 31 to 10. A 21-point blowout." (`MARGIN_UNIT`: "run" in MLB, "goal" in the NHL, "point" elsewhere; "An" before 8, 11, 18 and 80-something: "An 8-run blowout.").
- **Soccer** says it in the title only: "Coventry were thrashed 5-0 by Brighton", no blowout sentence in the body. Its own switch, "Loses by 3+ goals", is [Soccer: 3+ goal loss](#soccer-3-goal-loss).
- **Players:** "Caleb Williams and the Bears got BLOWN OUT by the Eagles".
- **With an elimination,** the title says eliminated and the body keeps the blowout sentence: "…Final Score: 9 to 2. A 7-run blowout.".
- **The weekly recap's low point** prefers an elimination, then the biggest margin (`meta.margin`).

## Scored on + fell behind

What a team gets when the other side scores (`teamScoreEvents` in `detectors.ts`). The score is re-derived from every play on every poll (ESPN edits plays), and a team's alerts go out once per score the other side reaches (`announced` in `GameTracker.poll`).

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `team.opponent_scored` | Opponent scores | team | Game | feed only |
| `team.fell_behind` | Falls behind | team | Game | feed only |
| `team.blew_lead` | Blows a big lead | team | Game | push |
| `epl.team.late_goal` | Concedes a late goal | team | Team | push |
| `nhl.team.empty_net_goal` | Gives up an empty-netter | team | Team | feed only |
| `nhl.team.shorthanded_goal` | Gives up a short-handed goal | team | Team | feed only |
| `nfl.safety` | Gives up a safety | team and player, not DE, DT, LB, CB, S, DB, PK, LS | Offense | push |
| `cfb.safety` | Gives up a safety | team | Team | push |

- **Opponent scores (feed only by default)** (`team.opponent_scored`, every league but basketball): "Penguins scored on the Jets", "Vanderbilt scored 7 on Georgia", "Rays scored 1 run on the Yankees", soccer "Liverpool scored against Bournemouth", MLB with the play that batted it in ("Rays scored on Diaz's 2-run double against the Yankees", "Rays tied the Yankees on Diaz's RBI single"). Fold "<Opponent> scored." (MLB "scored N runs.", football "scored 7."), or "<Opponent> tied the game." when the score is level after it (soccer "equalized."; football carries the score, "Rams tied the game, 34-34.", and says it as a late line when the extra point is what levels it: see the NFL "Revisions"), as a go-ahead run's is "took the lead." (a pitcher's homer alert with the Brewers tying the Dodgers: "Brewers tied the game.", `test/nlcs-game1.test.ts`).
- **Falls behind (feed only by default)** (`team.fell_behind`, every league): the team was tied or ahead before the play and is behind after it. "Rays scored 1 run to take the lead over the Yankees", "Penguins scored to take the lead over the Jets", "Liberty scored 2 to take the lead over the Dream", MLB "Guardians took the lead over the White Sox on Ramírez's 348-foot 2-run homer", a safety "<Team> gave up a safety and fell behind the <Opponent>" (only for a device that has the safety alert off: otherwise that is the safety's own alert). Fold "Rays took the lead.".
- **Always together:** a team can only fall behind because the other side just scored, so on that play the scored-on alert is `unless: 'team.fell_behind'`: a device that wants "Falls behind" gets that one, carrying both facts, and one that doesn't gets the plain scored-on alert. A football safety is the other way round: "Falls behind" is `unless` the safety's type.
- **Blows a big lead (live)** (`team.blew_lead`): falling behind after leading by at least MLB 5 runs, NBA 18, WNBA 15, NFL 17, college 21, NHL 3 goals, soccer 2 (`BLEW_LEAD_LIVE`; each side's biggest lead before the play, `led` in `poll`), once a game per team (`g.blewLead`). "<Team> blew a <N>-point lead to the <Opponent>" (runs in MLB, goals in the NHL and soccer), MLB with the play that batted the runs in ("… on <batter>'s 2-run homer"). Fold "<Team> blew a <N>-point lead.". About 2-7% of games, depending on the league (the comment in `detectors.ts`).
- **One alert per device for these:** blowing a lead, a soccer late goal, falling behind, an NHL empty-netter or short-handed goal, a football safety and being scored on are all in one `alt` group (`scored-on`) on the play's moment, in that order. A device gets the first it wants; the others in the group aren't added as lines.
- **With players on the play:** the team's alerts and its players' share the play's moment (`playMoment`), so the pitcher's "gave up a solo homer" with "Rays took the lead." is one alert for someone tracking both (`test/bundling.test.ts`).
- **Basketball:** no "Opponent scores" (every basket would be one); a run of 14-0 (WNBA 12-0) is a line on the play's alert, not part of the group ([NBA](#opponent-goes-on-a-run-feed-only-by-default)).
- **Late scores and taken-back scores:** a goal ESPN marks as scoring only later still alerts then ("late score" in the log); a goal taken back ("score went down") lowers what was announced, so the next goal is news again. A goal only visible through the next one (a 2-1 play right after 1-0) alerts for both teams, once. Football has its own rules for taken-back scores and extra points ([NFL revisions](#revisions-espn-changes-a-football-play-after-its-alert)).
- **History isn't news:** plays older than 90 seconds when the tracker first attaches (`BACKFILL_WINDOW_MS`) set the score without alerts.
- **Ids:** `${gameId}:${playId}:<type>:${teamId}`.

**Tests:** `test/live-score.test.ts`, `test/sport-alerts.test.ts`, `test/bundling.test.ts`, `test/epl.test.ts`, `test/wnba.test.ts`, `test/new-alerts.test.ts`, `node test/replay.ts` (replays real finished games; the tracked score must equal the final).

## MLB caught stealing / picked off

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `mlb.runner.caught_stealing` | Gets caught stealing or picked off | player, not SP, RP, P | Offense | push |

One alert type, one switch, for a runner thrown out stealing or picked off (`runnerOut()` in `detectors.ts`). 
- **The plays, as ESPN writes them** (`PICKED_OFF` and `CAUGHT_STEALING` regexes, checked in that order because "picked off and caught stealing" has both):
  - "Butler caught stealing second, catcher to second." The runner came from first (stealing second means leaving first: `STOLEN_FROM`). Title "<Name> got caught stealing second".
  - "Bolte picked off first." The runner was on first (`PICKED_AT`). Title "<Name> got picked off first".
  - "Bolte picked off and caught stealing second, pitcher to shortstop." The runner came from first. Title "<Name> got picked off (caught stealing second)".
  - A first initial in front ("C. Montgomery caught stealing…") is read too.
- **Who:** ESPN lists only the pitcher on these plays. The runner is whoever the tracker has on that base (`g.bases`, the full snapshot from the last pitch or at-bat result; runner plays list only the pitcher, so they don't clear it), cross-checked against the last name (and initial) in the text. If the base is empty in the snapshot or the names don't match, the player on the batting team with that last name (`byLastName`). No match: no alert.
- **Body:** the play's text and score.
- **Not when the text says "error":** "Edman scored on pickoff error by pitcher Henderson, Betts picked off second." is a pickoff error, not an out: Betts stayed on second and the inning ended with him there (NLCS Game 2, October 12 2026: "Mookie Betts got picked off second" was pushed). A play whose text has the word "error" makes no runner-out alert.
- **Twice from ESPN, one alert:** ESPN reports each one twice (a "Caught Stealing" or "Pick Off" play and a "Play Result" with the same text). The id is built from the text, not the play id: `${gameId}:cs:${half}:${normalized text}:${runnerId}`, so both copies are one alert ([docs/duplicate-alerts.md](duplicate-alerts.md)). That's also why a result ESPN rewrites later isn't judged again.
- **On a strikeout:** "Smith struck out swinging and Acuña Jr. caught stealing second, catcher to shortstop." is Smith's strikeout and Acuña Jr.'s caught stealing (`test/logic.test.ts`).
- **Not an alert:** "Bolte to second on pickoff error by pitcher." (`test/logic.test.ts`).
- **Hitters only** on a player's settings screen (pitchers don't run the bases). Pushed by default.

**Tests:** `test/logic.test.ts`, `node test/replay.ts`.

## MLB NOBLETIGER

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `mlb.team.nobletiger` | NOBLETIGER | team | Team | push |
| `mlb.team.stranded_risp` | Strands runners in scoring position | team | Team | feed only |

**N**o **O**uts, **B**ases **L**oaded, **E**nding with **T**eam **I**ncapable of **G**etting **E**asy **R**un.

- **Trigger:** in a half-inning, an at-bat result (with its batter) leaves the bases loaded with 0 outs (`trackHalfInning`: `loadedNoOuts`), and from then to the end of the half-inning no run scores (`scoredSince`). A run that scores on the play that loaded the bases doesn't count (it's checked before that play can set `loadedNoOuts`).
- **Judged at the half-inning's end** with the other end-of-inning alerts ([MLB goes down in order](#mlb-goes-down-in-order) explains how a half's end is read), from the outs and bases ESPN records after each at-bat result. Pitches and runner events are stamped with the at-bat's final outs, so only at-bat results that list the batter are trusted.
- **Title:** "<Team> pulled a NOBLETIGER". **Body:** "Bases loaded with nobody out… and not one run. " then the half ("Bottom 6th: ") and the last result and score.
- **No duplicates:** that half-inning's stranded-runners alert is marked `unless: 'mlb.team.nobletiger'`. A device that wants the NOBLETIGER gets it; one with it off gets the stranded alert if that's on; never both (`shouldDeliver` in `fanout.ts`, which uses the per-target answer too).
- **The game's last half-inning** has no "End Inning" play; it's judged at the final, and when the losing team made the last outs, a NOBLETIGER there is a line on the loss ("Pulled a NOBLETIGER in the 9th.", `finalHalfOnLoss`).
- **Id:** `${gameId}:${halfKey}:mlb.team.nobletiger:${teamId}` (`halfKey` like "Bottom6").
- **Find real ones:** `node test/find-nobletiger.ts [maxGames]` scans finished games.

**Tests:** `test/logic.test.ts`.

## MLB goes down in order

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `mlb.team.down_in_order` | Goes down in order | team | Offense | feed only |

- **Trigger** (`downInOrder` in `detectors.ts`): the half-inning had exactly three at-bat results (with their batter), and none left a runner on base or scored (`trackHalfInning`: `pas` and `reached`). So a solo homer counts as reaching (it scores), as does a single later erased by a double play, a strikeout that reaches on a wild pitch, a walk, an error, and extra innings' runner on second (the result lists him on base).
- **Title:** "Brewers went down in order", or "Brewers struck out in order 🌀" when all three struck out. **Body:** the half and the three results, then the score: "Bottom 1st: Chourio grounded out to third. Turang grounded out to third. Bauers grounded out to shortstop. — SD 1, MIL 0" (README); "Bottom 2nd: Adell fouled out to first. Lowe grounded out to second. Bazzana struck out swinging. — CHW 0, CLE 0" (`test/alds-game5.test.ts`). An ABS challenge's sentence in a result ("Milwaukee Brewers challenged: call on the field was overturned.") is left out of the body.
- **When:** at the half-inning's end, judged from its plays as that read has them (`halfFromPlays`, `mlbHalfInningEnd`), not from each play as first seen:
  1. The "End Inning" play (ESPN's "Middle of the 6th" closes the top, "End of the 8th" the bottom: `endedHalf`) puts the half on a waiting list (`halfEnds`).
  2. On the first read that has that play **and** the half's third out on its last result, with its batter on it, the half is judged from scratch over its plays.
  3. A read missing the "End Inning" play is a stale copy and waits. After 20 seconds (`HALF_END_WAIT_MS`, `HW_HALF_END_WAIT_MS`) it's judged as it stands.
  4. An at-bat result posted before its batter is on it isn't judged until he is (up to the same 20 seconds).
  5. The log says when the plays as first seen would have made something else of the half.
  6. An "End Inning" play that two reads in a row lack, while the plays say the half isn't over, was taken back: a replay review overturned the third out (ALCS Game 1, the top of the 9th, October 12 2026: "Guardians stranded a runner on second" was pushed for an inning that went on to score 3 more runs, and the real end, Adell on second, was never judged, because the End Inning play came back under the id the tracker had seen). The tracker forgets the play's id and that the half was judged (`reopenedHalves`), puts a line on what the first judgment sent ("A replay review overturned the third out; the inning went on.", or "ESPN took back the third out; the inning went on." when no play of the half mentions a review), and judges the half again when the End Inning play returns. The out that was judged must still be in the plays with fewer than 3 outs: a stale read that drops the latest plays, End Inning play and all, is not a reopening. Down-in-order and NOBLETIGER ids are per half, so a half that was 1-2-3 until the overturn cannot be told as one twice, which is right: the real end has a runner on.
  Judging each play as first seen is what lost three end-of-inning alerts on the two live servers in ALDS Game 5 (October 10 2026, at different innings); a replay of the same plays sent all of them, and judging the half from a read with its third out is the fix.
- **The game's last half-inning** has no "End Inning" play: `mlbFinalHalfInning` judges it at the final, from every play (a walk-off ends with fewer than 3 outs, so it isn't judged). When it's about the team that lost, it's a line on the loss, "Struck out in order in the 9th." (`finalHalfOnLoss`; ALDS Game 5: "Successful Hate Watch! White Sox are ELIMINATED ⚰️" with "Shut out. Struck out in order in the 9th. …"), and its own alert only for a device with the loss off. **The final waits for the plays to catch up** (`playsBehindFinal`, `finishWhenCurrent`): the scoreboard can report it while ESPN reads are timing out, and a list that ends short of three outs reads like a walk-off. NLCS Game 1 (Dodgers at Brewers, October 11 2026): production's reads timed out for 80 seconds around Betts's fly-out, the final came first, the Dodgers' 9th was never judged and the last out followed the loss. A game ends short of three outs only on a walk-off (the home team winning in the bottom half) and the visitors' win ends in the bottom half, so a list that ends otherwise, or whose score isn't the final's, is behind: the final is held for a read that has it, `HW_HALF_END_WAIT_MS` (20 seconds) at most, then finished as the plays stand. The last out goes out first, then the loss with its line. Logged when held and when released. Every final goes through this: the scoreboard's, the tracker's own and the 2-minute playoff fallback; a tracker that never read a play (the scoreboard's backstop for a final nobody tracked) finishes at once.
- **With players:** it's on the half's last result, so it shares that play's moment: "Aaron Judge struck out swinging" with "Yankees went down in order." as a line (`test/bundling.test.ts`).
- **Feed only by default.** The README row counts 41 of the 108 half-innings in six October 2026 playoff games, 2 of them all strikeouts.
- **Id:** `${gameId}:${halfKey}:mlb.team.down_in_order:${teamId}`.
- A hit with the batter thrown out stretching leaves nobody on base and scores nothing, so it still counts toward a 1-2-3 inning. That is intended, not a bug.

**Tests:** `test/alds-game5.test.ts`, `test/half-end-wait.test.ts`, `test/logic.test.ts`, `test/bundling.test.ts`.

## MLB teams

The other MLB team alerts: stranded runners, being no-hit, and a position player pitching. NOBLETIGER, going down in order, the opponent in scoring position and the bases loaded have their own sections.

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `mlb.team.stranded_risp` | Strands runners in scoring position | team | Team | feed only |
| `mlb.team.no_hit` | Gets no-hit | team | Team | push |
| `mlb.team.position_player_pitching` | Has a position player pitching | team | Team | feed only |

### Strands runners in scoring position (feed only by default)

- **Trigger** (`strandedRisp`): at a half-inning's end (judged as in [MLB goes down in order](#mlb-goes-down-in-order)), the half's last at-bat result lists a runner on second and/or third after the third out (its runner roles are the bases after the play).
- **Title, by what was left:** "Guardians left the bases loaded 🤦" (all three; `test/alds-game5.test.ts`), "<Team> stranded 2 runners in scoring position" (second and third), "Brewers stranded runners on first and second", "Rays stranded runners on first and third", "Yankees stranded a runner on second" (`test/bundling.test.ts`), "<Team> stranded a runner on third". A runner left on first is named alongside a runner in scoring position; first alone isn't an alert.
- **Body:** the half and the last result: "Bottom 8th: Adell grounded out to third. — CHW 0, CLE 2".
- **Replaced by NOBLETIGER** for the same half when that fires and the device wants it (`unless`).
- **The game's last half-inning:** a line on the loss for the losing team ("Left the bases loaded in the 9th."), as with going down in order.
- **Id:** `${gameId}:${lastPlayId}:mlb.team.stranded_risp:${teamId}`.

### Gets no-hit

- **Through 6:** at the end of a half-inning in the 6th or later (`noHitWatch`), when the batting team's hit count from the core feed (`g.hits`, never guessed: unknown until a play says) is 0, once a game. Before it goes out, the game tracker checks the box score's hits for that team (`boxHits`): if the box doesn't say 0, it's held and checked again later ("no-hit watch … held" in the log).
- **Title:** "<Team> are being no-hit through 6". **Body:** the half and the last result.
- **At the final:** "No-hit." is a line on the loss when the box score has the loser with 0 hits (`lossFacts`), only a line. The through-6 alert stays its own, even in the last half-inning.
- **Ids:** `${gameId}:mlb.team.no_hit:${teamId}` (live), `${gameId}:final:mlb.team.no_hit:${teamId}` (the line).

### Has a position player pitching (feed only by default)

- **Trigger** (`positionPlayerPitching` in `live.ts`): on a read of the box score, an active pitcher whom the catalog doesn't list at P, SP or RP and who hasn't played SP this season (two-way players count as pitchers). Once a game per team. The first read is a baseline.
- **Title:** "<Team> have a position player pitching". **Body:** "<Name> (<position>) is on the mound — <score>".
- Id `${gameId}:mlb.team.position_player_pitching:${teamId}`.

## Off-field trouble / Fined or suspended (every league, players and teams)

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `off_field` | Off-field trouble | player | Injuries & news | push |
| `fine_suspension` | Fined or suspended | player | Injuries & news | push |
| `team.off_field` | Off-field trouble | team | Injuries & news | push |
| `team.fine_suspension` | Fined or suspended | team | Injuries & news | push |

All from ESPN's league news (`server/src/news.ts`).

- **Read:** each league's news feed every 3 minutes (`scanNews`, `NEWS_MS`, `HW_NEWS_MS`), for every league but college football (F1 and the UFC included). Only items published since the first read (kv `news_since:${league}`: what was already in each feed then is history) and in the last 24 hours.
- **Only news items:** ESPN's type `HeadlineNews`, with a headline; not the videos and columns about the same story.
- **What it is** (`classify`, on the headline and description):
  - **Fined or suspended:** fined, fines of/for, "fines Knicks $25K", a dollar amount and "fine", suspended or suspension, banned for/from/by, a lifetime or N-game ban, the commissioner's exempt list. "Francisco Rivero, Raudi Perez suspended for positive drug tests", "NBA fines Knicks $25K for violating injury reporting rules".
  - **Off-field trouble:** arrests, "charged with", charges filed, indictments, lawsuits, allegations, accusations, investigations and probes, DUI or DWI, domestic violence, sexual assault, assault, warrants, pleas, sentencing, jail, prison, felonies, court appearances, altercations, gambling probes, the personal conduct policy, being placed on leave. "Suns' Dillon Brooks charged with DUI from March arrest".
  - **Both:** a suspension for off-field conduct is one alert under "Fined or suspended" that also counts as "Off-field trouble" (`aliases`).
  - **Skipped:** good news (reinstated, a suspension lifted, overturned, reduced or rescinded, charges dropped, cleared, acquitted, a lawsuit dismissed: "Charges dropped against Bills LB", `test/news.test.ts`), a game suspended by rain or darkness, opinions and maybes ("should be banned", "calls for a suspension", "possible ban": removed before checking for a ruling), and one person running another down ("accused ex-boss Erik ten Hag of being…", "accuses referee of bias").
- **Who it's about** (`affected`):
  - A **tagged athlete** whose full or last name is in the headline or description, and not only as the one something happened to ("a hit on Bengals QB Joe Burrow", "a collision with Franco Colapinto": "on", "toward", "involving", "vs", "collision with" and the like just before the name). Their team counts too.
  - A **tagged team** that's named, unless as a former team ("Ex-Bears LB…") or as the game something happened after ("after Man United draw"). When the headline names a team, teams named only further down don't count ("FA charges Fulham boss … after Man United draw" is about Fulham).
  - A team that's the **only tag**, with no athlete tagged (minor leaguers aren't tagged: "Nationals: Francisco Rivero, Raudi Perez suspended…").
- **Title:** the headline, or "<Name>: <headline>" when the headline doesn't name them (a player by last name, a team by its short name): "Nationals: Francisco Rivero, Raudi Perez suspended for positive drug tests" (`test/news.test.ts`). **Body:** the item's description (or "ESPN" when it has none or repeats the headline). The item's web link is in the alert's meta.
- **Players and teams have separate switches:** the player alerts are `off_field` and `fine_suspension` (All player alerts), the team ones `team.off_field` and `team.fine_suspension` (Team alerts, for a team or one of its players).
- **One alert per item for a device:** every alert from one item shares the moment `news:${league}:${articleId}`, players first, so tracking Dillon Brooks and the Suns gets one alert: his, or the Suns' if his switch is off.
- **Ids:** `news:${league}:${articleId}:${targetKey}`: re-reads never resend.
- **Real data:** the README row records a dry run over the 83 items in the five feeds on 2026-10-06 that found three stories and nothing else.

**Tests:** `test/news.test.ts`.

## MLB pitchers: blown save, no quality start, loss

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `mlb.pitcher.blown_save` | Blows a save | player, only SP, RP, P | Pitching | push |
| `mlb.pitcher.chased` | Gets chased early | player, only SP, RP, P | Pitching | push |
| `mlb.pitcher.no_quality_start` | No quality start | player, only SP, RP, P | Pitching | feed only |
| `mlb.pitcher.loss` | Takes the loss | player, only SP, RP, P | Pitching | push |

All four come from the box score in the summary the game tracker already reads every 2 seconds (`boxPitchers` and `pitcherEvents` in `detectors.ts`), so they cost no extra requests while a game is on. Each pitcher's line is "IP, H, ER, BB, K" and his decision notes ("W, 2-0", "L, 0-1", "S, 2", "H, 1", "B, 3").

- **Blows a save:** ESPN's decision note "B, 3" (or "BS"), whenever ESPN posts it. Title "Erik Tolman blew the save", body "0.2 IP, 1 H, 1 ER, 0 BB, 0 K · 3rd blown save this season — <score>" (README). Test: "Rays Closer blew the save" (`test/pitchers.test.ts`).
- **No quality start (feed only by default):** for the starter (`starter: true` in the box; an opener counts as the starter), the moment a quality start (6+ innings, 3 or fewer earned runs) can't happen anymore:
  - a 4th earned run: "No quality start for Cam Schlittler: 4 earned runs in 3.1 innings";
  - pulled before 6 innings (18 outs) with 2 or more earned runs (the box's `active` moves to the reliever): "No quality start for <Name>: pulled after 4.2 innings";
  - or a final in fewer innings with 2 or more earned runs ("…went 5 innings").
  Pulled early with 0 or 1 earned runs isn't one: Gavin Williams left ALDS Game 5 after 5.2 scoreless innings and 12 strikeouts (October 10 2026), and the alert said nothing a hater wants.
- **Gets chased early:** the starter is out of the game (not active), before the final, with fewer than 9 outs (`CHASED_OUTS`: 3 innings; 10.5% of 410 starts in 2026). Title "Gerrit Cole got chased after 2.1 innings (6 earned runs)" (`test/sport-alerts.test.ts`); with no earned runs, no brackets.
- **Takes the loss:** "L, 0-1", which ESPN posts only after the game. When a game ends, `finalPitching` reads the summary every 15 seconds (`DECISION_RETRY_MS`, `HW_DECISION_RETRY_MS`) up to 20 times (5 minutes) until a W or L appears, then publishes. Title "Kris Bubic took the loss", body "… · now 0-1 — Final: ATL 3, LAD 2" (README; "Final: " before the score). Logged when no decisions come in 5 minutes.
- **One alert for facts that land together:** facts in the same read for one pitcher are one alert, under the first in the order blown save, chased, no quality start, loss (`PITCHER_ORDER`), with the others as `aliases`: "Rays Closer blew the save and took the loss", "Freddy Peralta took the loss without a quality start" (`test/pitchers.test.ts`), "<Name> took the loss".
- **One moment per start:** chased and no quality start can come at different times (a 4th earned run, then the hook). They share the moment `${gameId}:start:${pitcherId}`, so the later one is a line on the alert he already had ("Chased after 2.1 innings.", or the no-quality-start title as a line). Being chased counts as no quality start (its description in `event-types.ts`).
- **The loss is a line on the team's loss:** it has the loss's moment (`lossMoment`) and the fold "Sean Burke took the loss: 5.0 IP, 4 H, 2 ER, now 1-1.", so a device that got the team's loss (or "their team lost") a few seconds before gets it as a line, without a push, and its own alert only with that off. In ALDS Game 5 anyone tracking the losing pitcher had two pushes 30 seconds apart before this.
- **Once each:** the tracker remembers what each game has said (`pitching`: `${type}:${pitcherId}`), and the ids are per game and pitcher (`${gameId}:${type}:${pitcherId}`). Attaching mid-game (a restart, a new follow) treats what's already in the box as history: the first read's facts are marked done but not sent (`this.first`). "Peralta was already out when we attached: history" (`test/pitchers.test.ts`).
- **Pitchers only** on a player's settings screen (`positions: only SP, RP, P`).
- **Checked:** the README row records real finals (2026-09-20 and 2026-10-04) and NYY @ TB live matching ESPN's box scores.

**Tests:** `test/pitchers.test.ts`, `test/alds-game5.test.ts`, `test/sport-alerts.test.ts`.

## MLB loses a challenge

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `mlb.challenge_lost` | Loses a challenge | team and player | Challenges | feed only |

One type (`mlb.challenge_lost`, "Loses a challenge") for teams and players (`alsoScope: 'player'`), feed only by default (installs from before October 2026 kept it pushed). Settable globally or per target on its gear screen. Built by `challengeLost()` and `umpireReviewLost()` in `detectors.ts`.

### ABS (the automated ball-strike system)

- **What ESPN posts:** a challenged pitch's type is its call and the outcome: "Ball - Confirmed", "Strike Looking - Confirmed" when the call stands (the challenge failed), "… - Overturned" when it won (no alert).
- **A called strike** can only be challenged by the batter: the batting team lost it, and the batter. Titles "Will Smith lost an ABS challenge" and "Dodgers lost an ABS challenge" (`test/challenges.test.ts`). Bodies: the batter's "Bottom 8th: challenged strike 3 looking, and the call stands", the team's "Bottom 2nd: Austin Wells challenged strike 2 looking, and the call stands" (`test/abs-settle.test.ts`).
- **A ball** is challenged by the pitcher or the catcher (ESPN doesn't say which): the fielding team lost it, "Guardians lost an ABS challenge" with "Bottom 9th: ball 1 to Sam Antonacci stands (Cade Smith pitching)" (`test/abs-settle.test.ts`), and the pitcher gets "ABS challenge on <Name>'s pitch failed". A tracked catcher gets no player alert.
- **One alert for player and team:** they share the moment `${gameId}:${playId}:abs`, so someone tracking Smith and the Dodgers gets one: Smith's, or the Dodgers' if Smith's switch is off.
- **Held until the review is over** (`holdAbs` in `live.ts`): ESPN posts every challenged pitch as "- Confirmed" at once and, if the call is overturned, swaps in an "- Overturned" pitch in the same place under a new id. The id is the game, half-inning, batter and pitch, then a 4-digit type (`pitchSlot` strips the type; the held alert's `absSlot`). On October 7, 2026 this sent three alerts for challenges that were won (Lombard Jr.'s strike 2 became ball 4). So a lost challenge is held and sent once a later play exists and 30 seconds have passed (`ABS_SETTLE_MS`, `HW_ABS_SETTLE_MS`; at the final, at once) and the at-bat's result is no longer settling (a challenged strikeout waits 45 seconds, so the strikeout and the lost challenge go out together), and only if:
  - no version of the pitch now reads "Overturned";
  - on an at-bat's last pitch, the at-bat's result doesn't say "challenged: call on the field was overturned";
  - the pitch is still in the feed. A pitch missing from one read isn't taken back (ESPN serves stale copies that drop the latest plays: six times in ALDS Game 5); missing from two reads in a row, it is.
  How long each overturn took to appear is logged. The wait was 60 seconds until October 12, 2026; no reversal timed since took longer than 15 seconds (10 and 15 in ALDS Game 5, 10 and 10 in NLCS Game 1, and two more swapped before a 5-second read saw the Confirmed pitch), so it is 30 now: a lost challenge reaches a phone about 55 seconds after the pitch, not 86 to 97.

### Replay challenges

- **Trigger:** an at-bat result with "<Team> challenged: call on the field was upheld" (also "confirmed", "stands", "stood"), not right after an ABS-reviewed pitch (`g.lastPitchAbs`: an ABS challenge on the at-bat's last pitch is repeated in the result: "Smith struck out looking. Los Angeles Dodgers challenged: …upheld"). The team is the side whose full or short name is in "<name> challenged".
- **Title:** "White Sox lost a replay challenge" ("Pham flied into double play, … Chicago White Sox challenged: call on the field was upheld.", `test/challenges.test.ts`). A called third strike or ball four whose challenge was upheld ("struck out looking", "walked" in the text) is called an ABS challenge even when ESPN didn't mark the pitch: "Braves lost an ABS challenge" ("Baldwin struck out looking. Atlanta Braves challenged: call on the field was upheld.", `test/abs-settle.test.ts`).
- **The manager challenges,** so it's a team alert only.
- **Written in later:** ESPN adds the sentence to a result after posting it (NLCS Game 2, 25 seconds after Freeman's sacrifice fly), and during a review flips it: ALCS Game 1's wrote "upheld", took it off, wrote "upheld" again, and "overturned" 100 seconds after the play, for a challenge the Guardians won. So a sentence added to a posted result is watched (`challengeWatch`, `challengeSettled`): it is believed once it has held, unchanged, for `HW_CHALLENGE_SETTLE_MS` (45 s) with the game past that at-bat (a later at-bat's play; an End Inning play doesn't count, it can be taken out), or three times as long alone; a version without it starts the wait over, "overturned" drops it, and at the final it goes at once. Then `challengeLost` runs on the result as it stands, with the ABS flag the at-bat had.
- **Id from the text:** `${gameId}:challenge:${half}:${normalized text}:${teamId}` (ESPN sends runner plays twice).

### Crew chief reviews

- **Trigger** (`umpireReviewLost`): an at-bat result with "Umpire review: (call) call on the field was overturned (due to …)". The umpires reviewed a call themselves; whoever the call had gone for lost it, as if it had lost a challenge. An upheld review is no alert (nobody asked for it).
- **Who lost it:** a home run call overturned ("HR call"): the batting team, and the batter lost the home run. Otherwise, a result with an out in it (an out, caught stealing, picked off, a double or triple play): a runner or the batter was safe and is now out, so the batting team lost it. Anything else (a hit, a home run, a runner safe): an out became something better, so the fielding team lost it.
- **Titles:** "Yankees lost a crew chief review" with the body "<half>: Anthony Volpe's home run was overturned (fan interference). Volpe doubled, Lombard Jr. scored. — <score>", and the batter's "Anthony Volpe's home run was overturned" (body "<half>: a crew chief review took it away (fan interference). Volpe doubled, Lombard Jr. scored. — <score>"). Others: "Marlins lost a crew chief review", "Red Sox lost a crew chief review", "Angels lost a crew chief review" (`test/crew-chief-review.test.ts`, from "Meckler grounded into fielder's choice to second, Peraza out at second. Umpire review: call on the field was overturned.").
- **Written in later:** ESPN can add the review sentence to a result after posting it ("Volpe homered…" rewritten as "Volpe doubled, Lombard Jr. scored. Umpire review: HR call on the field was overturned due to fan interference."). Detectors see a play once, so a rewritten result is checked for a review alone, only when the review is what's new (`resultTexts` in `GameTracker.poll`). These ids come from the play, not its text.
- **One moment:** the batter's and the team's share `${gameId}:${playId}:review`.

**Real numbers:** the README row records six real games (2026-10-03/04): 10 failed ABS challenges and 2 failed replay challenges, about 2 per game.

**Tests:** `test/challenges.test.ts`, `test/abs-settle.test.ts`, `test/crew-chief-review.test.ts`, `test/alds-game5.test.ts` ("Tristan Peters lost an ABS challenge").

## MLB opponent in scoring position

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `mlb.team.opponent_risp` | Opponent has runners in scoring position | team | Team | off |

- **Who gets it:** the **fielding** team, the moment the other team gets a runner to second or third against it (`opponentRisp()` in `detectors.ts`).
- **The bases:** from the snapshot on every pitch and at-bat result (they list the batter and every runner), plus runner plays between pitches that name the base taken: "Acuña Jr. stole second.", "Machado to second on wild pitch by Henderson." (passed balls, balks and errors too). Caught-stealing and pickoff text is ignored ("caught stealing second, catcher to second" isn't a runner on second); anything unreadable is caught up by the next pitch (`basesAfter`).
- **Once per half-inning,** the first time (`g.half.risp`). A threat already on base when tracking started never fires late: `observePlay` marks it for history plays too.
- **Title:** "Rays have a runner on second against the Yankees", "Rays have runners on first and second against the Yankees" (`test/bundling.test.ts`), "Braves have runners on first and second against the Dodgers", "<Team> have the bases loaded against the <Team>".
- **Body:** the half, and when the play says how they got there (an at-bat result or a runner play; a pitch's "Ball 2" doesn't), its text: "Top 4th: Caminero doubled to left. — TB 1, NYY 1".
- **Not twice with a better alert:** if a run scores on the same play it's `unless: 'team.opponent_scored'` (the scored-on alert says more); on the at-bat result that loads the bases, `unless: 'mlb.team.bases_loaded'`.
- **Off by default** (several a game: about 4 per tracked team per game in real games). Installs from before October 2026 kept it on (`WERE_ON`).
- **Id:** `${gameId}:${halfKey}:mlb.team.opponent_risp:${fieldingTeamId}`.

**Tests:** `test/bundling.test.ts`, `test/logic.test.ts`.

## MLB opponent loads the bases

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `mlb.team.bases_loaded` | Opponent loads the bases | team | Team | push |

- **Trigger** (`basesLoaded()` in `detectors.ts`): an at-bat result after which the bases are loaded (`basesAfter` has three), when they weren't loaded before it (`g.bases`, which `observePlay` updates after the detectors). Once per half-inning (`loadedTold`).
- **Who gets it:** the **fielding** team.
- **Title:** "White Sox loaded the bases against the Guardians", "Rays loaded the bases against the Yankees". **Body:** the half and the outs, then the play: "Top 6th, 2 outs: Vargas walked, Teel to second, C. Montgomery to third. — CHW 0, CLE 2" (`test/alds-game5.test.ts`), "Top 7th, nobody out: Lowe walked, Diaz to second, Caminero to third. — TB 1, NYY 1" (`test/bundling.test.ts`).
- **Ahead of the pitcher's alerts on that play** (`mlb()` pushes it before them), so a device tracking the pitcher too gets one alert, this one, with "Gavin Williams issued a walk." as a line.
- **On and pushed by default.** Before October 11, 2026 it was only a silent line on the scoring-position alert, which is off by default, and Guardians fans heard nothing when Vargas loaded the bases with two out in ALDS Game 5.
- **The scoring-position alert** on the same play is `unless` this one.
- **Id:** `${gameId}:${halfKey}:mlb.team.bases_loaded:${fieldingTeamId}`.

**Tests:** `test/logic.test.ts`, `test/alds-game5.test.ts`, `test/bundling.test.ts`.

## College football

College football (FBS, ESPN's group 80) has teams only, no players (`TEAMS_ONLY` in `leagues.ts`), so the NFL's player alerts are the team's own `cfb.*` types, in its own "CFB alerts" group with the same sections. The table has no row for it; its notes are in `PATCH_NOTES.md` and the header comments of `server/src/cfb-poll.ts` and `revisions.ts`.

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `cfb.team.interception` | Throws an interception | team | Offense | push |
| `cfb.team.fumble_lost` | Loses a fumble | team | Offense | push |
| `cfb.team.qb_pulled` | Pulls its quarterback | team | Offense | push |
| `cfb.team.sacked` | Gets sacked | team | Offense | feed only |
| `cfb.team.fumble` | Fumbles (any) | team | Offense | off |
| `cfb.team.incompletion` | Throws an incompletion | team | Offense | off |
| `cfb.td_wiped_out` | Touchdown wiped out by a penalty | team | Penalties | push |
| `cfb.team.ejection` | Has a player ejected | team | Penalties | push |
| `cfb.team.penalty` | Gets flagged | team | Penalties | feed only |
| `cfb.team.kick_missed` | Misses a kick | team | Special teams | push |
| `cfb.team.onside_recovered` | Opponent recovers an onside kick | team | Special teams | push |
| `cfb.team.turnover_on_downs` | Turns it over on downs | team | Team | push |
| `cfb.team.red_zone_empty` | Comes away empty from the red zone | team | Team | push |
| `cfb.safety` | Gives up a safety | team | Team | push |
| `cfb.upset_loss` | Loses to an unranked team | team | Team | push |
| `cfb.team.three_and_out` | Goes three-and-out | team | Team | feed only |
| `cfb.poll_drop` | Falls in the AP poll | team | AP poll | push |
| `cfb.poll_out` | Drops out of the AP Top 25 | team | AP poll | push |

- **How a game is read:** the summary alone, every 5 seconds (`TEAMS_ONLY_POLL_MS`), its plays taken from the drives (`fromDrivePlays`: each play once, a drive's end-of-period marker last). A drive play's team is the side with the ball as it begins; no players are named. The scoreboard (every FBS game) every 20 seconds around games, once in 5 minutes otherwise; standings every 10 minutes; no injury reports or news.
- **The detector:** `nfl()` and then `cfbTeamPlays()` in `detectors.ts`. Nothing on a play wiped out ("NO PLAY"). It reads only the words ESPN stands behind: the text before an overturned review's "(Original Play:" quote (`standing`). A sack is a "Sack" play, or a fumble ("Fumble", "Fumble Recovery (Own)") whose text says "sacked for loss": "Western KY got sacked (B.Glenn)" from a sack and fumble the offense recovered (WKU at SHSU, play 731).
- **Titles** (`test/cfb.test.ts`): "Vanderbilt threw an interception", "…— returned for a TD 🙃"; "Mississippi State lost a fumble" (counting as "Fumbles (any)"; whichever side didn't end with the ball, so a muffed punt is the receiving side's); "<Team> fumbled"; "Georgia got sacked (G.Stockton)" (the passer from the text, "#14 G.Stockton pass…"); "<Team> threw incomplete"; "Vanderbilt missed a 50-yard field goal", "Vanderbilt had a 58-yard field goal blocked".
- **A flag is a weak alert**, as the NFL's team flag (`afterOthers`, `noPush`, the play's moment for that team, no fold): published after the play's other alerts, never a push (it was feed only by default; it no longer can be turned to push), so a score on the play, a three-and-out, a red-zone drive or a sack is the device's alert and the flag is dropped, or its own feed row when it came first. In FIU at Jax State a declined flag had taken the place of the tying touchdown ("Jax State was flagged: Offside (declined)" on Jax State's device) and of the go-ahead field goal ("FIU was flagged: Running Into The Kicker (declined)" on FIU's), and a flag on a punt the place of the three-and-out. A flag's words stay in the play's text in the body.
- **Flags:** every flag on a play, "PENALTY Bama Delay Of Game": "Alabama was flagged: Delay Of Game", "Mississippi State was flagged: Holding (declined)", "Sacramento St was flagged: Unsportsmanlike Conduct" (ESPN's "UNS: " dropped). College penalty codes often aren't the abbreviation ("Bama", "State", "USC" for South Carolina), so `cfbCodeTeam` matches a code to one of the game's two schools by abbreviation, the start of a word of its location or short name, the end of a word of its full name, the words of a multi-word code ("Sac St", "GA Southern"), or its initials with or without a U ("WF", "BSU"). No match, no alert.
- **Ejections:** "California had a player ejected: C.Sidney (targeting)", from "PENALTY CAL Targeting (#20 C.Sidney)… has been disqualified"; it counts as the flag too (`aliases: ['cfb.team.penalty']`).
- **Touchdown wiped out:** "South Carolina had a touchdown wiped out by a penalty", from "TOUCHDOWN nullified by penalty … NO PLAY"; on a kickoff or punt, the receiving side's touchdown.
- **Extra points:** a blocked or missed extra point is the kicking team's `cfb.team.kick_missed` ("Delaware had an extra point blocked", "Vanderbilt missed an extra point"), from a kick the touchdown's own text says failed ("kick attempt failed ( blocked by #94 J.Williams)", "extra point is no good", "kick is blocked") or a "Blocked PAT" / "Missed PAT" play. ESPN adds the kick to the touchdown's play a poll or so after the play (30 to 45 seconds in the recording), so the alert comes then, as an alert the play has now and didn't before. A good kick is no alert. The kicking team is the one that scored: the side with the ball at the end of the play (a pick-six is the intercepting side's), the offense for a play of its own. Delaware at Middle Tennessee, October 13, 2026; the October 10 noon games' Rice at East Carolina has one too.
- **Quarterback pulled:** "Georgia pulled G.Stockton: R.Puglisi is in at quarterback", the NFL's rule on the names in the text (after the starter's 5th pass, another throws twice in a row, in the first three quarters, once a game).
- **Drives, onside kicks, safeties, revisions:** as the NFL's ([NFL](#nfl), [NFL onside kick](#nfl-onside-kick), [NFL delay of game / safety](#nfl-delay-of-game--safety)). Revisions came from October 10 2026's twelve noon college games, where ESPN edited 49 plays in place and took out or re-posted 31 ([revisions](#revisions-espn-changes-a-football-play-after-its-alert)).
- **Losses:** "Successful Hate Watch! Georgia lost to Vanderbilt"; a blowout at 42 points; "Held scoreless."; elimination only in the College Football Playoff.
- **Loses to an unranked team** (`cfb.upset_loss`): a team ranked in the top 25 going in (`readPregame`: the rank on each competitor in the game summary's header, ESPN's, which is the AP's and later the playoff committee's) loses to an unranked one. "Successful Hate Watch! No. 2 Georgia lost to unranked Vanderbilt", fold "Lost to unranked Vanderbilt as the No. 2 team.".
- **The AP poll** (`server/src/cfb-poll.ts`, every 30 minutes, `POLL_MS`): when a new AP Top 25 comes out, a tracked team lower than last week, "<Team> fell to No. <rank> in the AP poll" (body "Down from No. <old rank> · <ESPN's name for the poll week>"), or out of it, "<Team> dropped out of the AP Top 25" (body "Was No. <old rank> · <week>"). The week last seen (kv `cfb:ap:week`) keeps a restart from announcing a poll already out; the first read is a baseline. Ids `cfbap:${week}:${type}:${teamId}`.
- **Scoring:** "Vanderbilt scored 7 on Georgia", "Vanderbilt scored 7 to take the lead over Georgia" (schools take "has", "is" and no "the").
- **Game starts:** "Hate Watch Starting: Georgia vs Vanderbilt".

**Tests:** `test/cfb.test.ts`, `test/play-revisions.test.ts`, `test/fiu-jxst.test.ts`.

## UFC

Fighters only, no teams (`server/src/ufc.ts`; its header comment is the summary). The table has no row for it; its notes are in `PATCH_NOTES.md`.

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `ufc.lost` | Loses a fight | player | Fight | push |
| `ufc.knocked_down` | Gets knocked down | player | Fight | push |
| `ufc.fight_start` | Fight starts | player | Fight | push |
| `ufc.lost_title` | Loses a title fight | player | Fight | push |
| `ufc.lost_as_favorite` | Loses as the favorite | player | Fight | push |
| `ufc.losing_streak` | Losing streak | player | Fight | push |

- **Watching a card:** a card with a tracked fighter is watched from an hour before it starts (`ATTACH_BEFORE_MS`), read every 10 seconds (`CARD_MS`), for 12 hours at most; cards are looked for every 5 minutes. Nothing is sent for what already happened when a fight is first read (a restart mid-card, a fighter tracked mid-fight).
- **Fight starts:** at the walk-outs (ESPN's status leaves "Pre-fight", about 6 minutes before the bell): "Hate Watch Starting: Eric Nolan vs Court McGee", each fighter from their own side, body "Walking out now. Welterweight, 3 rounds. <event>." Tracking both fighters, one alert (shared moment, `firstFollowed`).
- **Gets knocked down (live):** ESPN's knockdown events name nobody, so it's a fighter's knockdown count going up (their opponent went down). Held 30 seconds (`KD_HOLD_MS`), and for as long as ESPN has the fight stopped: if the fight ends on it, it's a line on the loss instead ("Knocked down in round 3.", "Knocked down in round 3 (2nd time)."), one alert for a KO. Otherwise "Eric Nolan got knocked down by Court McGee in round 2" (`test/ufc.test.ts`), body "Knocked down 2 times now. …" from the second.
- **Loses a fight:** the Successful Hate Watch, saying how and when (`lossAlerts`, `howLost`): "Successful Hate Watch! Court McGee got knocked out by Eric Nolan (KO/TKO R2 2:39)", "…got stopped by Eric Nolan (KO/TKO R1 5:00)" (no strike named: a retirement, a doctor's stoppage), "…tapped out to Eric Nolan (Submission R2 4:07)", "…lost a split decision to Eric Nolan", "…lost by disqualification to Eric Nolan (DQ R1 2:19)" (`test/ufc.test.ts`). ESPN has one result for a knockout and a referee's stoppage, so it's "KO/TKO". The time is into the round, as the UFC says it (`finishClock` turns ESPN's flipping clock around). Body: how ("KO/TKO (punches to the head) at 2:39 of round 2.", "Split decision after 3 rounds (29-28, 28-29, 29-28).") and the weight class and event. Nothing for a draw or no contest.
- **The loss's facts,** each its own switch, lines on the loss (or the alert itself with the loss off): a title fight, "Lost the Welterweight title." ("…lost the Welterweight title to Eric Nolan (KO/TKO R3 3:26)") or "Lost a <class> title fight."; as the favorite, the line gave them 60% or more (`FAVORITE`), "Lost as a 72% favorite."; a losing streak of 2 or more, "Lost 3 straight.".
- **A clip:** a loss gets ESPN's clip of the fight when there is one (main events, title fights), looked for every 2 minutes for 6 hours, under its own server switch `clips.loss.ufc`.
- **Counted:** a UFC loss is in `HATE_WATCH_TYPES` (`hate-watches.ts`).
- **No rankings alerts:** ESPN's UFC rankings are years out of date (October 2026: Figueiredo as flyweight champion).

**Tests:** `test/ufc.test.ts`, `test/ufc-classes.test.ts`, `test/ufc-preview.test.ts`.

## Your Hate Watch: the streak and the weekly recap

Two alerts about the device, not one team. The app lists them in Settings only. The table has no row for them.

| Type id | Label in Settings | About | Section | Default |
|---|---|---|---|---|
| `team.hate_watch_streak` | Your Hate Watch streak | team and player | Your Hate Watch | push |
| `app.weekly_recap` | Weekly misery recap | team | Your Hate Watch | push |

### Your Hate Watch streak

- **When:** on a loss alert, when the team's losing streak (the loss's `team.losing_streak` fact) is 3 or more and the device saw at least 3 of those losses on its Hate Watch (`watchedOfLast` in `hate-watches.ts`: its Successful Hate Watches for that team among the last N losses). Built per device in `streakLines()` in `fanout.ts`.
- **One line with the team's streak:** "Lost 5 straight, every one on your Hate Watch." or "Lost 9 straight, 5 on your Hate Watch."; with only the Hate Watch streak on, "Your Hate Watch streak: 5 straight losses."; on the streak fact's own alert (the loss off), "Every one on your Hate Watch.".
- A team type with `alsoScope: 'player'`, so it's a line on "their team lost" too.

### Weekly misery recap

- **When:** checked every 15 minutes (`RECAP_MS`, `HW_RECAP_MS`); sent once it's Monday 9 am or later in the device's time zone (its quiet hours' zone, US Eastern until they're turned on), for every device that tracks something and has the recap on (`weeklyRecaps` in `server/src/recap.ts`).
- **What:** the week that ended at midnight: "Your week in misery: 4 Successful Hate Watches", body "Yankees 2, Jets 1, Lakers 1. 37 alerts in all. Low point: Jets got BLOWN OUT by the Bills." (the header comment's example). Five teams at most, "and more". With no Successful Hate Watch: "Your week in misery: 37 alerts". The low point is the worst loss the device got: an elimination first, then the biggest margin.
- **A quiet week gets none:** no Successful Hate Watch and fewer than 5 alerts (`MIN_ALERTS`).
- **One device only** (`publishTo` in `fanout.ts`): stored once per device and week (id `recap:${hash of the device}:${week}`), pushed if the device's push is on, outside quiet hours and the type's bell is on, with the thread `recap`. Developer notices and recaps don't count as alerts in it.

## How every alert is delivered

The rules every alert above goes through, in `publish()` in `server/src/fanout.ts`. [docs/duplicate-alerts.md](duplicate-alerts.md) has the six layers that keep one thing one alert.

- **The alert:** a `Detected` (`detectors.ts`): a deterministic `id`, a `type`, a `targetKey` (`player:<league>:<espnId>` or `team:<league>:<espnId>`), a `title`, a `body`, when it happened (`at`), and optional fields: `aliases`, `unless`, `moment`, `fold`, `foldOnly`, `alt`, `firstFollowed`, `list`, `lateOn`, `absSlot`, `meta`.
- **Who gets it:** everyone tracking the target, and for a team's alert, everyone tracking one of its players with "Get their team's alerts" on, once per device (`recipients`). An alert nobody tracks isn't stored.
- **Stored once:** `INSERT … ON CONFLICT(id) DO NOTHING` into `events`. If nothing was inserted, it was already published: no feed rows, no frames, no push.
- **Does the device want it** (`shouldDeliver`): the alert's type or one of its `aliases` is on for that target (`wants`: a per-target choice on the gear screen wins, else the league switch and then the type's switch, else the type's `defaultOn`); and if it's `unless: X`, the device doesn't want X for that target.
- **A Successful Hate Watch is counted first,** before the settings, for every recipient (`recordHateWatch`).
- **Moments:** alerts with the same `moment` are one thing happening. A device gets the first in the list it wants. A later one it wants adds its `fold` sentence as a line on that alert (once per sentence, and once per `alt` group), or is dropped when it has no `fold` (the same news about another target). A `foldOnly` alert is only ever a line, held until its moment's alert exists. `firstFollowed`: of a moment's alerts marked so, a device gets the one about the target it followed first. `list`: names on one line ("Yours: Alpine, George Russell.").
- **Late facts:** a fact for a moment a device already got in an earlier publish becomes a line on that alert, with no push, sent live as an `eventUpdate` frame (`addLateLine`). The memory of who got which moment lasts 6 hours (`LATE_FOLD_MS`) and not across a restart.
- **`lateOn`:** a line on the device's latest alert about a target since a time (a standings drop after a loss, an F1 championship drop after that day's result), read from the feed in the database, so it works after a restart. With no such alert, it's an alert of its own.
- **Feed row:** one per device and alert (`ON CONFLICT DO NOTHING`), with its lines, and a live `event` frame to each open app.
- **Push** if the device has a push token, push is on, the target isn't muted (its bell-off switch; through a player, that player's too), it's outside quiet hours (`pushAllowed`), and the alert's type wants a push (`pushWanted`). The type that decides is the most specific one the device has on: the alert's own type if on, else the first alias that's on. Its bell: the target's own bell (`targetPushTypes`), else the Settings bell (`pushTypes`), else the type's default (`defaultPush: false` means feed only), else push. A device's alert is pushed if anything it carries would be; its lines never add a push.
- **Defaults:** each type's `defaultOn` and `defaultPush` in `event-types.ts`, in three tiers (push, feed only, off), shown in each section's table. Installs from before the October 2026 quieter defaults kept the old ones wherever they hadn't chosen (`keepOldDefaults`: `WERE_ON` and `WERE_PUSHED`, once, kv `prefs:quiet-defaults`); before October 11, 2026 NFL flags stay pushed (`keepFlagsPushed`). `GET` and `PUT /me/prefs` fill in each feed-only type's bell as off (`prefsDto`).
- **Changes after the fact:** `addLateLine`, `eventChanged` (a clip came) and `reviseEvent` (an F1 result changed) send an `eventUpdate` frame and never push.
- **A clip** of the play goes on its alert when ESPN posts one (MLB, NBA, WNBA, NHL), with no second notification (`readClips` in `live.ts`, `server/src/clips.ts`), and can be switched off on the server (`clips.*` in `server/src/flags.ts`).
