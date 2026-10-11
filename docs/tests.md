# Tests

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** `npm test` in `server/` runs every `test/*.test.ts` file with Node's own test runner: 320 tests in 50 files, offline, in about 4 seconds, all passing on October 11, 2026. Next to them are scripts that read live ESPN (replays of finished games, the two-feed check, an F1 replay, a catalog audit) and an end-to-end smoke test against a running server. On the Mac, recordings of live games under `server/data/recordings/` (not in git) are replayed through the real game tracker and checked against what production sent.

**Sections:**
- **Tests**: `npm test` in `server/` runs every `test/*.test.ts` file with Node's own test runner: 320 tests in 50 files, offline, in about 4 seconds, all passing on October 11, 2026.

The README's "Tests" has the summary; this is the full detail. Read this index first, then only the part you need.

## Tests

**In short:** `npm test` in `server/` runs every `test/*.test.ts` file with Node's own test runner: 320 tests in 50 files, offline, in about 4 seconds, all passing on October 11, 2026. Next to them are scripts that read live ESPN (replays of finished games, the two-feed check, an F1 replay, a catalog audit) and an end-to-end smoke test against a running server. On the Mac, recordings of live games under `server/data/recordings/` (not in git) are replayed through the real game tracker and checked against what production sent.

```bash
cd server
npm ci                        # once, on a fresh clone (not npm install: it can rewrite the lockfile)
npm test                      # every test/*.test.ts: 320 tests, offline, ~4s
node --test test/notices.test.ts   # one file
npm run typecheck             # tsc --noEmit
node test/replay.ts           # replays real finished games; asserts tracked score == final score
node test/core-vs-site.ts     # both ESPN sources produce identical detections
HW_DEV=1 npm start & node test/smoke.ts   # end-to-end: search, follow, ws delivery, prefs, mute, unfollow, auth
node test/f1-replay.ts        # F1 alert logic on the real, current race weekend vs ESPN's classification
node test/verify-catalog.ts   # audits the ingested catalog: duplicates, images, logo fallbacks
node test/find-nobletiger.ts  # finds real NOBLETIGERs in recent MLB games
```

**How the unit tests run.** `npm test` is `node --disable-warning=ExperimentalWarning --test test/*.test.ts`. Node 22.18 or later (`engines` in `package.json`) runs the TypeScript files as they are, with no build step. Every test file sets `process.env.HW_DB = ':memory:'` before it imports server code (`db.ts` opens its file on import), so the tests never touch `server/data/hatewatch.db`; `share.test.ts` also builds a throwaway database in the system's temp folder to test the share-code migration, and deletes it. ESPN is faked through seams the live code reads from (`liveDeps.getJson` in `live.ts`, `f1Deps` in `f1.ts`), and the play shapes and wording are ESPN's own from real games, named in each file's header comment. One fixture is checked in: `test/fixtures/alds-game5-401907994.json`, the plays of ALDS Game 5 trimmed from the live recording.

**Every test file and what it checks:**

| File | What it checks |
|---|---|
| `abs-settle.test.ts` | A lost ABS challenge waits for the review to settle, with ESPN's real plays and ids from October 7, 2026 (Rays @ Yankees, CLE @ CHW), when three alerts went out for challenges that were won |
| `alds-game5.test.ts` | White Sox at Guardians, ALDS Game 5 (October 10, 2026), from the fixture: the bases loaded as its own alert; a half-inning judged from its plays as they stand; "C. Montgomery" found among two Montgomerys; the loss's lines at the final; ELIMINATED on "their team lost"; no quality start; a lost ABS challenge surviving a stale read; a slow scoreboard still eliminating; a failed read logged |
| `box-score.test.ts` | The game screen's box score (`boxscore.ts`): a table per stat group, away team first, the bad numbers marked for red |
| `bundling.test.ts` | One alert per play per device (`bundleByPlay`): the team's and its players' alerts become one with lines; `alt` gives one line; a later fact goes on the alert already sent, without a push |
| `catalog-injured.test.ts` | Players on an injured list but off the roster (MLB's 60-day IL) still join their team |
| `cfb.test.ts` | College football: its URLs, catalog, plays from drives, the college alert types, cards with top-25 ranks, the AP poll, an upset by an unranked team, a bowl game not being an elimination |
| `challenges.test.ts` | MLB "Loses a challenge", ABS and replay, from ATL @ LAD (2026-10-04) and CHW @ CLE (2026-10-05), one alert per device per challenge |
| `clips.test.ts` | ESPN's clips: a play's clip goes onto its alerts later without a push; a loss gets the winning play's clip or the recap; the `clips.*` switches take them out |
| `crew-chief-review.test.ts` | Crew chief reviews that overturn a call: Volpe's home run taken away for fan interference (Rays @ Yankees, 2026-10-07) and the season's other overturned reviews |
| `divisions.test.ts` | Search's "By division": each team's division, named the way fans say it |
| `eliminated.test.ts` | A playoff knockout as that game's one Successful Hate Watch, from the scoreboard's series or an NFL playoff loss, including TB @ NYY (ALDS Game 3) through the live scoreboard scan |
| `epl.test.ts` | The EPL from key events (goals, own goals, cards, penalties, subs) and the score counted from the goals, on four September 2026 matches |
| `f1-live.test.ts` | A simulated race weekend through the real F1 engine (scan, live status, chequered flag, re-scan), and what lands in a follower's feed at each step |
| `f1-merges.test.ts` | F1 alerts merged so a busy device isn't flooded (Singapore's sprint, October 10 2026: 33 notifications with everyone tracked): one start alert, a double DNF and no points taking in their drivers', one notification per session publish, penalties correcting results in place, a championship drop as a line |
| `f1-preview.test.ts` | An F1 weekend's preview (`f1-preview.ts`): grids set and not, a weekend two weeks out, a live card's state, standings failing |
| `f1-stats.test.ts` | F1's stats pages (`f1-stats.ts`): a race called off, retirements and non-starters, a team swap, look-alike race names |
| `f1-timing.test.ts` | A running race's timing through the real engine: the running order with gaps, and a followed driver's pit stop, getting lapped and places lost (not for a pit cycle) |
| `game-start.test.ts` | "Hate Watch Starting" on the pre-game to live flip, through a real `GameTracker`; never for a game first seen under way; the loss wording |
| `half-end-wait.test.ts` | A half-inning's end waits for a read with its third out, but only `HW_HALF_END_WAIT_MS` (the bottom of the 8th of ALDS Game 5, whose third out never came) |
| `hate-watches.test.ts` | The Settings counter: every Successful Hate Watch per device, whatever its alert settings, surviving a cleared feed, and counted for losses from before it existed |
| `highlights.test.ts` | The game screen's Highlights (`highlights.ts`): ESPN's clips newest first while they're up, and the key plays |
| `images.test.ts` | The `images.*` switches: photos and logos taken out of responses and live frames, leaving the `badge://` every build draws |
| `injuries.test.ts` | One team alert per injury report update, NFL game-day "Active" never alerting, and iOS stacking a team's notifications in one thread |
| `leaderboard.test.ts` | The top 100 of every filter, against a brute-force ranking of a few thousand random follows |
| `live-score.test.ts` | Team scoring alerts when ESPN edits plays: a goal marked as scoring later, one taken back, one seen only through the next, through a real `GameTracker` (WPG @ PIT, 2026-10-05) |
| `logic.test.ts` | The core rules: type and league switches, mute (feed, no push), aliases, quiet hours across midnight, scores never going backwards, standings by seed, the two feeds' merge keeping play order, stranded runners, down in order, caught stealing, delay of game and safeties, NOBLETIGER, scoring position, scored on and fell behind as one alert, F1 results, per-target choices, the per-alert bell, an onside kick (TEN @ BAL) |
| `loss-facts.test.ts` | A loss's facts (a walk-off, losing as the favorite, a shutout, a sweep) as lines on one loss alert, on real games |
| `mlb-outs.test.ts` | A hitter's outs by kind, double and triple plays, and a hit with a runner thrown out not being his out |
| `new-alerts.test.ts` | Blowing a big lead live, a division rival clinching, ejections, the weekly misery recap, each one alert per device |
| `news.test.ts` | Off-field trouble and fines or suspensions from ESPN's league news (NBA 2026-09-30, MLB 2026-10-04, NFL 2026-10-06) |
| `notices.test.ts` | Developer notices: every feed, never pushed, drawn as from Hate Watch; urgent; dry run and the text checks; left out of the recap; live to open apps; withdrawn |
| `pitchers.test.ts` | Blown saves, no quality starts and losses from the box score (NYY @ TB live, 2026-10-06; finals from 2026-09-20 and 2026-10-04) |
| `play-revisions.test.ts` | Football plays ESPN changes after posting them, with October 10 2026's noon college games' own plays: a pick wiped out by a penalty, an incompletion turned interception, a flag added later, a touchdown overturned and scored on the same drive, one touchdown under three ids, the header ahead of lagging drives, a stray "End of Game", drives whose result changed |
| `restart-backfill.test.ts` | A restart and the plays nobody read: a game live at boot takes 5 minutes of plays as news (a 3-minute-old strikeout alerts, a 10-minute-old one is history), a game followed later keeps 90 seconds, a second restart sends nothing twice; a follow during a scoreboard scan runs it again right after (`every`); a revision line has the same id from a new tracker. |
| `player-team.test.ts` | A tracked player's team: its games on the Scores tab (on by default) and its own alerts (off by default) |
| `positions.test.ts` | Which alerts fit a player by the positions they've played, and the order on a player's settings screen |
| `quiet-defaults.test.ts` | New installs' defaults (push, feed only, off) and older installs keeping what they had (`keepOldDefaults`) |
| `scores.test.ts` | The Scores tab: cards from scoreboard events, scores that never go backwards mid-game, live pushes only to devices tracking a side, each device's games, F1 running order, play-by-play |
| `sections.test.ts` | The alerts' order under section headings in Settings and on a target's screen |
| `share.test.ts` | Share links: the `/a/<code>` page, its preview picture, the iPhone redirect to the App Store, codes for old alerts |
| `soccer.test.ts` | Fouls and dives, penalties conceded, losing the ball, passes given away, and a 3+ goal loss (Coventry 0-5 Brighton, Fulham 1-1 Man United) |
| `sport-alerts.test.ts` | The sport-by-sport alerts of October 2026 in ESPN's wording, each kept to one alert per device |
| `stats.test.ts` | Stats pages for players and teams (Aaron Judge, Gerrit Cole, Trae Young, the Yankees, the EPL table) |
| `team-lost.test.ts` | "Their team loses": one alert per device per loss, through a real `GameTracker`'s final and `publish()` |
| `trackers.test.ts` | Hater counts on every follow and back from following or unfollowing, over real HTTP |
| `ufc-classes.test.ts` | The UFC's weight classes and who heads each, and `/ufc/weight-classes` |
| `ufc-preview.test.ts` | A UFC card's preview, before (Allen vs. Duncan, October 10 2026) and after (UFC 332), the calendar, the routes |
| `ufc.test.ts` | The UFC: fighters as players, a card watched poll by poll, and what a fighter's haters get (UFC 332 and a Fight Night, 2026-10-03 and 09-26) |
| `upnext.test.ts` | "Up next" from each tracked team's ESPN schedule, including "If Necessary" games and a season that's over |
| `wnba.test.ts` | The WNBA: every NBA alert under its own switches, from the same detectors (NY @ ATL, 2026-10-04) |

**Scripts that read live ESPN.** These aren't run by `npm test`, and they need the network:

- `test/replay.ts [league:eventId …]`: replays finished games through the detectors as the live tracker would (default: `mlb:401907973`, `nfl:401872963`, `nhl:401891781`, `nba:401811026`). For each it prints PASS or FAIL for lead changes merged into one alert and for the tracked score against ESPN's final, the alerts by type, and how many same-id detections collapsed into one, as `publish()` would. Exit status 1 on any FAIL. This is the canary for ESPN changing its fields.
- `test/core-vs-site.ts`: the three games above (not the NFL) through core plays, site plays and the merge; PASS only if all three give the same alerts in the same order.
- `test/smoke.ts`: against a running server (`HW_URL`, default `http://localhost:8787`) started with `HW_DEV=1` (it uses `POST /dev/simulate`). It registers a device, searches, follows Bryce Harper and the Eagles, and checks WebSocket delivery (it prints the measured milliseconds), a type switched off, a per-player choice beating the global one, a muted target still reaching the feed, unfollowing, a bad token getting 401, `/privacy` and `/support`, and "Delete all my data" closing the socket (4401) and voiding the token. On a fresh database the server ingests rosters for about 30 seconds before it serves, so start it, wait for `[boot] catalog` in its output, then run the script.
- `test/f1-replay.ts [eventId]`: the F1 results logic on a real weekend (the current or latest by default), against ESPN's classification.
- `test/verify-catalog.ts`: audits the ingested catalog: unique players and teams, an image for every row, image sizes, and every logo fallback a real 404 from ESPN.
- `test/find-nobletiger.ts [maxGames=40] [YYYYMMDD]`: runs the detector over recent finished MLB games until it finds NOBLETIGERs, and prints near-misses too.

**Recordings and replays** (`server/data/recordings/`). `server/data/` is in `.gitignore`, so this folder exists only on the Mac that made it; nothing in it reaches GitHub or the other machine. It holds recordings of live games read from ESPN exactly as the server reads them (cache-busted, the same URLs; MLB, NBA and EPL games every 5 seconds, college football every 15, F1 and UFC every 10), the scripts that make and replay them, and the scripts that check a replay:

- **Recorders** (`record-mlb.ts`, `record-mlb-sb.ts`, `record-nba.ts`, `record-epl.ts`, `record-cfb.ts`, `record-f1.ts`, `record-ufc.ts`, `record-ufc-fc.ts`). Each writes a `.jsonl` with a line per change: every play the first time it's seen and again whole each time ESPN edits it (`core`/`core-edit`, `site`/`site-edit`), plays that vanish (`core-gone`), and the header on change; the NBA and EPL recorders also log reads slower than the tracker's 4s timeout (`slow`). Full summaries go to `<out>-summaries.jsonl.gz`, the final summary and core plays to `<out>-final-summary.json` and `-final-core.json`, and the NBA and EPL recorders also save the standings before the game and 2, 15 and 30 minutes after it (`standings-after.ts` does it for MLB).
- **The registry** (`recorders.py`, `recorders.jsonl`): one line per recorder that should be running, and `recorders.py --restart` relaunches any that died (the Claude app restarting stops what a session started in the background; so does a crash or a reboot).
- **Replays** through the real `GameTracker` with virtual timers: `replay-mlb.ts` (ALDS Game 5, 401907994; `SRC=<server/src> FINAL=sb|fallback UNTIL=<iso> node replay-mlb.ts <out.json>`, many devices tracking single targets and combinations), `replay-cfb-noon.ts` (the twelve noon college games of October 10, 2026, three devices a game), and `replay-epl.ts` (Manchester City at Liverpool, 401879264, October 11, 2026).
- **The checks** on a replay: `check-mlb.py <out.json>` (an independent tally, by regex over the final plays, of what should have alerted), `vs-prod.py <out.json>` (the replay's alerts against production's `[event]` log lines for the game), `edits-mlb.py` (ESPN's edits to the game's plays after posting them, and the recorder's gaps between reads), and `prod-read.js` (read-only: what production sent for the game, how many feeds and pushes, no device ids or tokens).
- **The post game recording report** (every recording, any sport): when a recorded game ends, its session replays the recording through the real tracker, compares the replay with what production sent (read-only, and only when the user allows it) and with an independent count of the plays, and publishes the result as a private claude.ai Artifact called a post game recording report. It is one page for every sport: the score table (a line score by period, a results table for F1 or UFC, or none), the facts, then one card per finding with its severity, the alerts as they went out drawn as phone banners (Eastern time, who got each, pushed or feed only), what is wrong, the proposed change and the alert's text before and after, and then "What looked right" and "How this was checked". The user marks each finding Approve, Change or Skip, with a note. The choices are saved in the page's own database (collection `decisions`, one document per finding id: F1, F2 and so on), and only approved findings are built, in a worktree, with tests made from the game's plays. These reports are the bug list that recordings produce, so they are how bugs are found and tracked across leagues. The first was the ALDS Game 5 report (13 findings, all approved and shipped as 214e7c0). The page template, a builder that checks a report's data, a blank data file and the ALDS data as a worked example are on the Mac in the Obsidian vault, in `60 Testing/Post game recording report template/` (not in git).
- **On disk as of October 11, 2026:** ALDS Game 5 (MLB 401907994, with production's log), the October 10 noon college games, the F1 weekend of October 10 (600057445), the UFC card of October 10 (600061541), Manchester City at Liverpool (EPL 401879264), and recordings of October 11 NBA and MLB games.

A change to alerts is checked by replaying the recorded game it's about and comparing the alert count before and after ([docs/duplicate-alerts.md](duplicate-alerts.md), "How to change alerts safely").
