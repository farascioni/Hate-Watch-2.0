# Duplicate alert protection

## Index

**Summary:** how Hate Watch keeps one thing happening down to one alert: one feed row and at most one push per device, through re-polls, ESPN's edits, two play feeds, overlapping detectors, server restarts and the app reconnecting. Six layers do it: ids built from what happened, the database storing each id once, the game tracker's memory, moments that fold several targets' alerts into one, revisions for ESPN's edits, and the app merging its feed by id. A restart keeps the database and forgets the memory. Read this file in full before every change to alert code: the docs hook makes you.

- [The short version](#the-short-version): the six layers in one line each, and the hook that makes agents read this file.
- [Layer 1: deterministic alert ids](#layer-1-deterministic-alert-ids): the rules for an id, every kind of id with a real example, and the MLB ids keyed on a play's text.
- [Layer 2: the database stores an id once](#layer-2-the-database-stores-an-id-once): what `publish()` does in order, why nothing after the insert can repeat, and the only ways to change an alert after it went out.
- [Layer 3: the game tracker judges each play once](#layer-3-the-game-tracker-judges-each-play-once): everything `GameTracker` remembers so a re-poll makes no alerts, and the baselines kept in `kv`.
- [Layer 4: one moment, one alert per device](#layer-4-one-moment-one-alert-per-device): `moment`, `fold`, `foldOnly`, `alt`, `unless`, `aliases`, `firstFollowed`, `list`, `lateOn`, late facts, and two worked examples (a homer with a fold and an alt, a loss and its facts).
- [Layer 5: ESPN's edits are revisions, not new alerts](#layer-5-espns-edits-are-revisions-not-new-alerts): the football and basketball ledger, MLB's held and logged changes, F1 corrections, clips, and a worked football revision from the tests.
- [Layer 6: the app keeps one copy of each id](#layer-6-the-app-keeps-one-copy-of-each-id): `mergeFeed`, live frames and reconnects.
- [What survives a restart](#what-survives-a-restart): what the database keeps and memory forgets, a restart step by step, and what can be lost.
- [Known gaps](#known-gaps): what nothing catches today.
- [How to change alerts safely](#how-to-change-alerts-safely): the checklist, and the tests to run.
- [Files this covers](#files-this-covers): the files whose edits need this file read first (the hook's list).

## The short version

**Read this before changing any alert code** (CLAUDE.md "Read the docs first"). The docs hook
(`.claude/hooks/require-docs.mjs`) blocks an edit to an alert file until this file has been read in full since the
latest user message, every time, not just once a session. The files it covers are listed under
[Files this covers](#files-this-covers). The Obsidian vault has the same text as "Duplicate alert protection".

There are six layers. A change to alerts has to keep every one of them working:

1. **The alert's id** is built from what happened, never from when it was seen. The same thing seen twice makes
   the same id ([Layer 1](#layer-1-deterministic-alert-ids)).
2. **The database stores an id once.** `publish()` inserts the alert with `ON CONFLICT(id) DO NOTHING`. If nothing
   was inserted, it stops there: no feed rows, no live frame, no push. This is the backstop for everything else
   ([Layer 2](#layer-2-the-database-stores-an-id-once)).
3. **The game tracker judges each play once** and remembers what it has announced (`seen`, `announced`,
   `onceDone`, and others), so a re-poll doesn't even produce the alert again
   ([Layer 3](#layer-3-the-game-tracker-judges-each-play-once)).
4. **One moment is one alert per device.** Alerts about the same moment to different targets (a player and his
   team, the loss and its facts) become one alert, with the others as lines on it
   ([Layer 4](#layer-4-one-moment-one-alert-per-device)).
5. **ESPN's edits are revisions, not new alerts.** A changed, re-posted or removed play changes the alert it
   sent (a line, no push). It never sends a second notification about the same play
   ([Layer 5](#layer-5-espns-edits-are-revisions-not-new-alerts)).
6. **The app keeps one copy of each id.** The feed is merged by alert id, so a frame that arrives twice
   replaces the copy rather than adding a row ([Layer 6](#layer-6-the-app-keeps-one-copy-of-each-id)).

Layers 1 and 2 together are what make a restart safe: the tracker's memory (Layer 3) is gone after one, but the
ids it makes again are the ones the database already has. Layers 3 to 5 keep the work and the noise down, and
decide which of several true alerts a device gets.

## Layer 1: deterministic alert ids

**Rules:**

- **Build an id from facts that don't change:** the game (or session, fight, article), ESPN's play id, the alert
  type and who it's about. Never `Date.now()`, a random value or a counter that restarts with the server. An id
  with `${day}` or `${year}` in it means "once a day" or "once a season", on purpose.
- **Put the type in it.** Two different alerts on one play about one target need two ids: the database keeps only
  the first of an id, and silently drops the second.
- **The same thing seen under a new id is not new.** Football plays re-posted under new ids are found by place
  (Layer 5); an ABS challenge's pitch that gets a new id is held by its place (`absSlot`).
- **Don't re-run detectors on a changed MLB result.** Some MLB ids are built from the play's text, and a rewrite
  would make a new id. `GameTracker.poll` logs the change instead. The exceptions are narrow and each has an id that
  cannot go out twice: a crew chief review, a home run's distance, an error moved to another fielder, a result that
  became a scoring play, and a replay challenge's sentence written in later (`revisedResult`; below).
- **Changing an id's shape re-sends.** A deploy that changes how an id is built sends every alert made again with
  the new shape as new: the last 5 minutes of each game in progress (a deploy is a restart: `atBoot`), and F1 results for sessions that started in
  the last 8 hours, which are read again after a restart.

Every alert (`Detected` in `server/src/detectors.ts`) has an `id`, the "deterministic dedupe key". It's the primary
key of the `events` table (`server/src/db.ts`). It must be the same every time the same thing is detected, from
either play feed, on any poll, before or after a restart, and different for anything that is genuinely new.

The usual shape is `game:play:type:who`. `mk()` in `detectors.ts` builds a player's play alert that way, and most
team alerts follow it. Every kind in use, with an example from real games where there is one (the
`401…` numbers are ESPN's game, play and athlete ids; examples from the development database, October 2026, and
from the tests):

| Alert | Id | Example |
|---|---|---|
| A player's play alert (`mk`) | `${gameId}:${playId}:${type}:${athleteId}` | `401907994:4019079941102990057:mlb.batter.strikeout:32801`, "Jose Ramirez struck out looking" |
| A team's play alert | `${gameId}:${playId}:${type}:${teamId}` | `401858481:401858481541:cfb.team.interception:158`, "Nebraska threw an interception" (Indiana at Nebraska, October 10 2026) |
| A team's play alert, other form | `${gameId}:${playId}:${type}:team-${teamId}` (the safety, a lost ABS challenge) | `401907994:4019079940401020090:mlb.challenge_lost:team-5`, "Guardians lost an ABS challenge" |
| A team's flag (NFL, `teamFlags`: one per team per play, its penalties joined) | `${gameId}:${playId}:nfl.penalty:team-${teamId}` | `401872994:4018729944019:nfl.penalty:team-2`, "Bills were flagged: False Start" |
| A scoring play against a team (`teamScoreEvents`) | `${gameId}:${playId}:team.opponent_scored:${teamId}`, `…:team.fell_behind:…`, `…:team.blew_lead:…` | `401810230:40181023024:team.fell_behind:10`, "Pelicans scored 3 to take the lead over the Rockets" |
| A team's loss (`gameLostEvent`) | `${gameId}:final:team.lost:${loserId}` | `401815054:final:team.lost:19`, "Successful Hate Watch! Dodgers lost to the Giants" |
| A loss's facts, sent as alerts (`lossFacts`) | `${gameId}:final:${type}:${loserId}` | `401815054:final:team.lost_as_favorite:19`, "…Dodgers lost to the Giants as 64% favorites" |
| Soccer's 3+ goal loss | `${gameId}:final:${league}.team.heavy_loss:${loserId}` | |
| A player's final (their team lost, a bad night) | `${gameId}:final:${type}:${athleteId}` | `401815054:final:player.team_lost:39832`, "Shohei Ohtani and the Dodgers lost to the Giants" |
| A half-inning (MLB) | `${gameId}:${halfKey}:${type}:${teamId}` | `401907994:Bottom1:mlb.team.down_in_order:5`, "Guardians went down in order"; NOBLETIGER is `…:mlb.team.nobletiger:…` |
| Scoreless at the half (NBA, WNBA) | `${gameId}:half:${league}.scoreless_half:${athleteId}` | (a player's alert, by athlete) |
| Once a game (MLB) | `${gameId}:mlb.team.position_player_pitching:${teamId}` | |
| A finished drive (football, `nflDriveEvents`) | `${gameId}:drive:${driveId}:${type}` | `401858481:drive:40185848117:cfb.team.three_and_out`, "Indiana went three-and-out" |
| MLB, keyed on text | caught stealing `${gameId}:cs:${half}:${text}:${runner}`; out on the bases `${gameId}:bases:${halfKey}:${text}:${who}`; a gift run and its runs `${gameId}:${type}:${halfKey}:${text}:${pitcher}`; the same for the pitcher's run alert and the fielder's error on a runner's play with no batter (a pickoff error: `${gameId}:mlb.pitcher.runs_allowed:${halfKey}:${text}:${pitcher}`, one for each pitcher charged; `…:mlb.fielder.error:…:${fielder}`); a lost replay challenge `${gameId}:challenge:${key}:${text}:${loserId}` (the text normalized, spaces as dashes) | |
| F1 (`f1.ts`) | `${compId}:f1.finish:${driverId}` (one finish alert per driver per session, its facts merged), `${compId}:f1.quali:${driverId}`, `${compId}:f1.driver.dnf:${driverId}`, `${compId}:f1.team.double_dnf:${teamKey}`, `${compId}:f1.team.no_points:${teamKey}`, `${compId}:f1.pit:${driverId}:${stop}`, `${compId}:f1.lapped:${driverId}`, `${compId}:f1.places:${driverId}`, `${compId}:f1.driver.back_of_grid:${driverId}`, `${compId}:f1.driver.session_start:${driverId}`, `${compId}:team.game_start:${teamKey}` | `401839115:f1.finish:5498`, "Charles Leclerc finished P3: behind teammate Lewis Hamilton (P2)"; `401839115:team.game_start:team:f1:106842`, "Hate Watch Starting: Ferrari" |
| UFC (`ufc.ts`) | `${fightId}:${type}:${loserId}`, `${fightId}:ufc.knocked_down:${athleteId}:${n}`, `${fightId}:ufc.fight_start:${athleteId}` | `401863575:ufc.lost:4350812`, "Successful Hate Watch! Ilia Topuria got knocked out by Justin Gaethje (KO/TKO R4 5:00)" |
| News (`news.ts`) | `news:${league}:${articleId}:${targetKey}` (one per article and target) | |
| Injuries, a player | `inj:${league}:${athleteId}:${status}:${day}` | |
| Injuries, a team's single change | the player's id plus `:team` | `inj:nhl:5149191:Out:2026-10-10:team`, "Flames: Samuel Honzek is injured (Out)" |
| Injuries, a team's batch | `inj:${league}:team:${teamEspnId}:${day}:${set}`, `set` the first 12 characters of a base64url SHA-256 of the sorted `athleteId:status` changes | |
| Standings drop | `standings:${league}:${teamId}:${day}:${from}->${to}`, or `…:${day}:${division}:${from}->${to}` for a drop in the division | `standings:mlb:26:2026-10-08:2->3`, "Giants dropped to 3rd in the NL" |
| Losing streak | `streak:${league}:${teamId}:${day}:${streak}` | `streak:nhl:3:2026-10-09:L4`, "Flames have lost 4 straight" |
| Eliminated, rival clinched, relegation zone | `elim:${league}:${teamId}:${year}`, `clinch:${league}:${rivalId}:${year}:${teamId}`, `releg:${league}:${teamId}:${day}` | `elim:mlb:26:2026`, "Giants are ELIMINATED"; `clinch:mlb:19:2026:26`, "The Dodgers clinched the NL West" |
| F1 championship drop | `f1st:${targetKey}:${day}:${from}->${to}`, made twice for one race: when the results go out (`projectStandings`) and when ESPN's table changes (`scanF1Standings`), the same id, so the second stores nothing | `f1st:player:f1:5498:2026-10-11:4->5`, "Charles Leclerc dropped to 5th in the drivers' championship" |
| AP poll (`cfb-poll.ts`) | `cfbap:${week}:${type}:${teamId}` | |
| Weekly recap (`recap.ts`) | `recap:${first 16 characters of a base64url SHA-256 of the device id}:${week}` | `recap:Vf3jywfTfArsGwqS:2026-10-05` |
| Developer notice (`notices.ts`) | `notice:${time sent, in ms}` | |
| A test alert (`POST /dev/simulate`, `api.ts`) | `sim:${random uuid}`: new every time on purpose, so each test sends | |
| A revision's line (`linesOn` in `revisions.ts`) | `${the alert's id}:changed:${hash}`, `hash` the first 10 characters of a base64url SHA-256 of the line's words: the same line on the same alert is the same id in any tracker | `401858481:401858481541:cfb.team.interception:158:changed:` and the hash of "Wiped out by a penalty on Indiana: Roughing The Passer." |

**Ids keyed on text.** A few MLB alerts are keyed on the play's text instead of its id: caught stealing, out on the
bases, a run handed over on a wild pitch or a balk (and the runs it counts as), a lost replay challenge, and, on a
runner's play with no batter (a pickoff error), the pitcher's run alert and the fielder's error. ESPN
posts these plays twice under different ids (a "Wild Pitch" play and a "Play Result" with the same text, the
runner's play and the at-bat's: "ESPN twin plays collapse to one", commit 2bfbef7; `challenges.test.ts`), and the
text is what stays the same, so both copies make one id and one alert. The flip side is that if ESPN rewrote the
text, the id would change. So `GameTracker.poll` (`server/src/live.ts`) keeps each at-bat result's text and runner
roles as last seen (`resultSigs`) and logs a rewrite ("result … changed after it was posted"), never judging it
again. The exceptions: a crew chief review written into a result later ("Volpe homered…" rewritten as "Volpe
doubled… Umpire review: HR call on the field was overturned…"), checked for that alone (`umpireReviewLost`, `resultTexts`,
`crew-chief-review.test.ts`), and only when the review is what's new; and `revisedResult`, which compares the new version
with the last one (`resultPlays`) and reaches only these: a home run's distance and an error moved to another fielder
(a line, no push, on the alerts the play made, which `sent` remembers, or a new fielder's alert), a result that
became a scoring play (the pitcher's run alert), and a replay challenge's sentence added to it (`challengeWatch`: believed
after it has held 45 seconds, never from one version). The detectors are run on a copy of the game's state for this, and
only the alert types named are kept.

**The same thing under a new id.** ESPN re-posts football plays under new ids when a review changes them (one
touchdown came under three ids at Missouri), and `PlayLedger.repost` matches them by place (Layer 5). An ABS
challenge's pitch gets a new id when the call is overturned: its id is the game, half-inning, batter and pitch, then
a 4-digit type that changes from "Confirmed" to "Overturned" (`pitchSlot`), so the lost challenge is held by
`absSlot`, the id without those digits, until the review settles.

## Layer 2: the database stores an id once

**Rules:**

- **Every alert that reaches a feed, a socket or a phone goes through `publish` or `publishTo`**, which store it
  first. The one exception is a developer notice (`notices.ts`), which stores itself, writes every device's feed
  row directly with `ON CONFLICT DO NOTHING`, and never pushes.
- **Nothing after the insert may run when the insert changed nothing.** That's what makes a re-poll, a restart,
  two feeds and two detectors harmless.
- **Change an alert that already went out only with `addLateLine`, `eventChanged` or `reviseEvent`.** They send an
  `eventUpdate` frame and **never push**.

`publish(events, league)` in `server/src/fanout.ts`, for each alert in the list, in order:

1. **Who it can reach** (`recipients`): the devices tracking its target, plus, for a team's alert, the devices
   tracking one of the team's players with "Get their team's alerts" on, once per device. With nobody, the alert
   isn't stored at all: its id stays free, so if someone follows the target later and the same thing is detected
   again (it rarely is: Layer 3), it can still go out.
2. **The insert:** into `events` with `ON CONFLICT(id) DO NOTHING`. **If the insert changed nothing, the alert was
   already published** (a re-poll, a restart, two detectors or two feeds producing it), and `publish` moves on to the
   next alert: no feed rows, no live frame, no push. Everything after this point happens once per id.
3. **The counter:** a Successful Hate Watch is recorded for each of those devices in `hate_watches` (primary key
   `device_id, event_id`, `ON CONFLICT DO NOTHING`), before any alert setting is checked, and the device's open
   sockets get the new tally. A player's "their team lost" is recorded under the team loss's own id
   (`hateWatchOf`), so a device tracking the team and a player counts the loss once.
4. **Each device's copy:** settings (`shouldDeliver`), then the moment rules (Layer 4), decide whether the device
   gets this alert, a line on another, or nothing.
5. **The feed row:** into `feed` with `ON CONFLICT DO NOTHING` (primary key `device_id, event_id`), with `pushed`
   and the folded lines (`extra`). A device can't get two rows for one alert.
6. **The live frame and the push:** an `event` frame to each of the device's open sockets, and a push if its
   settings allow (README "Notifications", "How a push is decided"). Pushes are sent once, after every alert in the
   publish has been planned (`pushSender(bundled(pushes))`).

`publishTo(deviceId, e, league)` (one device's weekly recap, `recap.ts`) does the same for one device: it returns
`false`, and sends nothing, if the id was stored before.

**Recent misery is beside this, not in it** (`misery.ts`, docs/recent-misery.md). `publish()` hands each alert to `recordMisery()` before step 1 drops the ones nobody tracks, so the global list has losses nobody tracks. It writes only to its own `misery` table, which no alert code reads, and it never throws, so it changes no id, delivery, feed row or push. A changed alert (`reviseEvent`) is passed on to it as well, so a withdrawn one leaves the list.

`reviseEvent(id, …)` changes a stored alert in place (an F1 result a penalty changed): its type, title, body and
facts become the new ones, each feed that has it gets an `eventUpdate` frame, nothing is pushed, and an alert that
no longer stands (`withdrawn`) comes off every device's Successful Hate Watch tally. `eventChanged(id)` sends an
alert again to every feed that has it (a clip came), with no push. `addLateLine(deviceId, eventId, line)` adds one
line to one device's feed row (not if the row is gone, nor if it already has that line) and sends it, with no push.

## Layer 3: the game tracker judges each play once

**Rules:**

- **A play goes to the detectors once**, on its first sighting (`seen`). Don't call detectors for plays the tracker
  has already seen; a change to a seen play is a revision (Layer 5) or a logged change (MLB), never a fresh judgment.
- **The first read of anything is a baseline**, not news: plays older than 90 seconds when the tracker attaches (5
  minutes for a game live when the server started: below), the box score's pitchers, finished drives, standings,
  injuries, news.
- **Once-a-game facts are marked done** (`onceDone`, `pitching`) when sent or baselined.

`GameTracker` (`server/src/live.ts`), one per live game, polls ESPN every 2 seconds (the core plays and the site
summary in parallel). Most re-polls produce no alerts at all, because the tracker remembers:

- **`seen`:** play ids already judged. A play is passed to the detectors (`PLAYER_DETECTORS[league]`) only on its
  first sighting, then `observePlay` updates the game's state (bases, goalies, the half-inning). An MLB result
  posted before its batter is on it waits (`waitForBatter`, `noBatter`, up to `HW_HALF_END_WAIT_MS`, 20 seconds) and
  is judged once, when it's ready. So does a strikeout on a challenged last pitch (`HW_ABS_SETTLE_MS`) and a result that
  says "Official Scorer Ruling Pending" (`HW_RULING_WAIT_MS`, 45 seconds; `settling`, `settleSince`): the version that
  settles is the one judged, and the plays after it are not judged until it is, so the state they build (bases, whose
  runner is whose) stays in order. An "End Inning" play two reads in a row lack, with the half not over, is forgotten
  (`reopenedHalves`, `endInnings`): removed from `seen` and from the half's judged state, so the same id coming back is a
  new end.
- **History on attach:** when the tracker first attaches to a game (a new follow, or a server restart), plays whose
  time (ESPN's wallclock) is older than `BACKFILL_WINDOW_MS` (90 seconds) update its state and its score but are
  never alerted. A game attached on the server's first scoreboard read of its league (`atBoot`: it was live when the
  server started, so this is a restart) takes `BOOT_BACKFILL_MS` (5 minutes, `HW_BOOT_BACKFILL_MS`) instead: a play
  the old server never read is still news, and the ones it did send stop at the insert (Layer 2;
  `restart-backfill.test.ts`). A game first seen already under way never gets "Hate Watch Starting": the start alert needs the
  tracker to have seen the game before it started (`sawPre`). The box score's pitcher alerts (a blown save, no
  quality start), finished drives and scoreless halves are baselined on the first read, not sent.
- **`announced`:** the score each side's team alerts have gone out for. The score is re-derived from every play on
  every poll (ESPN edits plays), and a team alert goes out once per score a side reaches. A goal flagged as scoring
  late still alerts then ("late score" in the log). A goal taken back lowers `announced` ("score went down" in the
  log), so that team's next goal is news again. Football takes a score back only when the plays and the header agree
  (Layer 5).
- **`onceDone`, `pitching`:** once-a-game facts (a position player pitching, scoreless at the half, a goalie
  pulled) and each pitcher's alerts already sent (a blown save, no quality start, the loss), or baselined.
- **`fouls`** (soccer fouls, by play id, from the touch feed or the commentary: whichever has a foul first judges it, and
  the penalty written onto it a moment later is judged once more), **`halfEnds`** (MLB: a half-inning is judged once, on a read with its third out), **`absHeld`** (a lost ABS
  challenge is held until the review settles, then sent once or dropped), **`heldFinal`** (MLB: the scoreboard's final
  waits for plays that are behind it, 20 seconds at most; the loss is stored once, after the last out's alert).
- **Soccer's touch feed** (`touches`, `touchItems`, `touchSigs`, `keyTexts`, `cardMoments`; `refreshTouches`, `judgeTouches`,
  `reviseKeyText`, `linkFoulsToCards`): the feed as ESPN sent it, held by position and cut to ESPN's count after a removal; each
  judged pair's makeup and alert ids; each key event's text and when it was first seen; each card alert's moment by player and
  minute. The play ids in them are the alerts' ids, so a goal, card, substitution or foul that the touch feed has before the
  summary does is judged once (`seen`, `fouls`) and the summary's copy is the same play.
- **`resultSigs`, `resultTexts`, `resultPlays`:** each MLB at-bat result as last seen, to log a rewrite rather than judge it
  again (Layer 1), and to tell what it changed (`revisedResult`).
- **`sent`, `sentById`:** the alerts each MLB play made, after `bundleByPlay` (they have their moment), for the lines a rewrite
  puts on them. A text-keyed alert made twice by ESPN's twin plays is one alert, so both plays are given the first, the one
  the devices hold. **`halfJudged`:** the last result of each half whose end was judged, which its alerts hang on, for the
  line when the end is taken back.
- **`challengeWatch`:** replay challenge sentences ESPN added to a posted result, with when they last changed.
  **`strikeThrees`:** strike-three pitches of at-bats ESPN gave no result for, and the result made from the pitch
  (`withStrikeThrees`). **`ctx.owner`** (`observePlay`): the pitcher each runner on base reached against, whose run his is.
- **`mergePlays`:** ESPN's core and site feeds are merged by play id before detection, so a play in both is one
  play (README "Real-time": "Two sources per game"). College football's drive plays (`fromDrivePlays`) skip a play
  listed in two drives.
- **The football, basketball and hockey ledger** (`PlayLedger`, `revisions.ts`): what each play and drive sent, for 15 minutes (basketball 45; Layer 5).
- **The pregame facts in `kv`** (`pregame:${league}:${gameId}`: odds, records, the series), so the facts of a loss
  are the same after a restart.

Outside the game tracker:

- **F1** (`server/src/f1.ts`): a live race's `memo.sent` (ids sent this session), `preSeen` (only a start seen
  before lights out is news) and `resultsSeen` (a result is read again only after a change holds for a second scan; qualifying "complete" is first believed on its second scan), `holding` (a race's results wait one scan while a car reads on track) and the standings table frozen when a race or sprint went live (kv `standings:f1:pre:${compId}`, which `projectStandings` reads and never changes).
  Results are announced only for sessions that started in the last 8 hours.
- **Baselines in `kv`:** the first read of something is a baseline, not news. That covers the AP poll's week
  (`cfb:ap:week`), standings (`standings:${league}`), injury reports (`injuries:${league}`), the news cut-off
  (`news_since:${league}`: what's in a feed the first time is history), the latest developer notice
  (`notices:latest`), and a losing streak a loss alert already gave (`streak-told:${league}:${teamId}`, so the
  standings scan doesn't say it again).

## Layer 4: one moment, one alert per device

**Rules:**

- **Alerts about one thing happening share a `moment`.** A device gets the first alert of a moment it wants; put the
  most specific or most important alert first in the list `publish` gets.
- **A later alert of the moment needs a `fold`** (the sentence it adds) to show at all; without one it's dropped as
  the same news about another target.
- **Alternatives share an `alt`**: a device gets at most one alert or line from each group.
- **A fact that can come a poll later needs a `fold` and the moment of the alert it belongs to**, so it becomes a
  line on that alert (no push) rather than an alert of its own.
- **Don't push twice for one moment.** A device's alert is pushed once if anything it carries would be; its folded
  facts add lines, never pushes.

Several alerts can be about one thing happening: a player's error and his team's, a loss and "lost as favorites",
a team falling behind and blowing its lead on the same play. `Detected` has fields for this, and `publish` applies
them per device, in the order the alerts are listed:

- **`moment`:** alerts with the same moment are one thing. A device gets only the first of them it wants.
  `bundleByPlay` (called on each poll's alerts before `publish`) gives every play alert without a moment of its own
  the moment `${gameId}:play:${playId}:${team}` (`playMoment`; a player's alert takes his team's key), and its title
  as its fold (`asLine`: "Aaron Judge struck out swinging."), so a device tracking a player and his team gets one
  alert for that play. A loss's alerts share `${gameId}:final:lost` (`lossMoment`).
- **`fold`:** a fact the first alert doesn't say. It becomes a line on that alert ("Lost as 78% favorites."), put in
  front of the alert's body. Without a `fold`, the later alert is the same news about another target and is dropped.
  The same fold sentence is added only once.
- **`foldOnly`:** only ever a line on another alert of its moment, never an alert of its own (a blown lead, at the
  final; every revision line). It's held until that alert exists in the same publish, or goes on the one sent in an
  earlier publish.
- **`alt`:** alternatives within a moment. A device gets at most one alert or line from each group (blowing a lead,
  falling behind and being scored on, all on one play, are the group `scored-on`).
- **`unless: X`:** dropped for a device that wants X for the same target, which covers the same moment more
  specifically (stranded runners vs. NOBLETIGER; "opponent scores" vs. "falls behind" on the play that put them
  behind).
- **`aliases`:** other settings that also cover this alert (a homer is "Gives up a home run" and "Gives up runs").
  It's still one alert, delivered if any of them is on.
- **`firstFollowed`:** of a moment's alerts, a device gets the one about the target it followed first, by follow
  time (tracking Cole and then Judge, a Yankees loss is Cole's). One whose alert is switched off is passed over.
- **`list`:** a moment's alerts named in one line ("Yours: Alpine, George Russell.", five names, then "and N more").
  F1's start is one alert per device, not one per constructor and driver.
- **`lateOn`:** a line on the device's latest alert about a target since a time, of some types (or one of a team's
  loss alerts, `loss`), instead of an alert of its own, when the device has one; otherwise an alert as usual (a
  standings drop within 6 hours of a loss is a line on the loss; in basketball a team falling behind again within 2
  minutes, `FELL_AGAIN_MS`, is a line on its earlier "falls behind"). It reads the feed in the database
  (`latestAbout`), so it works after a restart.
- **Late facts:** a fact that comes a poll later (an NFL drive's result after its last play, a game misconduct after
  the instigator penalty, a half-inning's end after its last out) goes on the moment's alert as a line with no push.
  `delivered` remembers each moment's alert per device for `LATE_FOLD_MS` (6 hours), in memory.
- **A soccer card and the foul behind it** (`linkFoulsToCards`): a foul by the player carded in the same minute takes the
  card's moment, with no `fold`, when the card is in the same publish or already published: a device that gets the card
  doesn't get the foul, and one with cards off still does. A foul that came first never gets a later card's moment: the card
  would become a line on a feed-only foul and lose its push.
- **`afterOthers`, a weak alert** (a team's NFL flag, `teamFlags`): published after the rest of its poll's alerts (`live.ts`
  sorts `events` stably), with the play's moment for its team and no `fold`, so on a moment it shares with a score alert, a
  player's flag or a touchdown wiped out the device's alert is the other one and the flag is dropped. It never pushes
  (`noPush`), and a `noPush` alert that took a moment would silence the pushes folded into it, which is why it goes last.
  In `publish`, a device whose holder of the moment is a weak alert (`delivered`'s `weak`) gives the moment up to any later
  alert but its own lines: a pushed drive result is an alert of its own, not a silent line on the flag. The one exception is the same
  flag with its player named a poll later when that wouldn't push (`sameFlag`: its bell, or `noPush` after the final), which is
  a line on the team's row. A line about an alert the device doesn't hold (`afterOthers` lines, copied by `linesOn`) does
  not land on whatever holds the moment.
- **`recipients()`:** a team's alert goes to its trackers and to trackers of its players with "Get their team's
  alerts" on, once per device.
- **A push per device per alert.** The device's alert is pushed if anything it carries would be. Its folded facts
  add lines, never more pushes. F1 alerts from one session in one publish are one notification (`bundled`: "Singapore
  GP · Sprint: 7 alerts").

### Worked example: a homer, a fold and an alt

From `test/bundling.test.ts`. Rays at Yankees, tied 1-1 in the top of the 6th. Junior Caminero homers off Gerrit
Cole: "Caminero homered to left (402 feet)." The play's id is `hr1` in game `G1`. One poll makes three alerts, in
this order (player detectors first, then the team's score alerts), and `bundleByPlay` gives the first its moment:

1. Cole's `mlb.pitcher.home_run_allowed`, id `G1:hr1:mlb.pitcher.home_run_allowed:32081`, "Gerrit Cole gave up a
   402-foot solo homer", aliases `mlb.pitcher.runs_allowed`, moment `G1:play:hr1:team:mlb:10` (Cole's team, the
   Yankees), fold "Gerrit Cole gave up a 402-foot solo homer.".
2. The Yankees' `team.fell_behind`, id `G1:hr1:team.fell_behind:10`, "Rays took the lead over the Yankees on
   Caminero's 402-foot solo homer", the same moment, alt `scored-on`, fold "Rays took the lead.".
3. The Yankees' `team.opponent_scored`, id `G1:hr1:team.opponent_scored:10`, the same moment, alt `scored-on`,
   `unless: team.fell_behind`, fold "Rays scored 1 run.".

What four devices get (all with default settings, except the last):

| Device tracks | Gets | Why |
|---|---|---|
| The Yankees and Cole | "Gerrit Cole gave up a 402-foot solo homer", with "Rays took the lead." in front of its body; one push | Cole's alert is the moment's first. The fall behind folds into it. "Opponent scores" is dropped by its `unless` (the device wants "Falls behind"), and would have been by its `alt` anyway. The homer pushes, so the alert does. |
| Only the Yankees | "Rays took the lead over the Yankees on Caminero's 402-foot solo homer"; no push | Cole's alert doesn't reach it. "Falls behind" is its first; "Opponent scores" is dropped by `unless`. "Falls behind" is feed only by default. |
| Only Cole | "Gerrit Cole gave up a 402-foot solo homer" | The team alerts don't reach it. |
| The Yankees and Cole, "Falls behind" off | Cole's alert with "Rays scored 1 run." in front | "Falls behind" isn't wanted, so `unless` doesn't drop "Opponent scores", which folds in instead: one of the two, never both. |

The next test in that file is a late fact. A device tracks the Yankees and Aaron Judge. Judge strikes out for the
third out of a 1-2-3 inning, and the device gets "Aaron Judge struck out swinging". The "End Inning" play comes a
poll later, with "Yankees went down in order", which has the play's moment (the strikeout's). That publish finds
the moment in `delivered`, so the device gets "Yankees went down in order." as a line on the strikeout alert,
through an `eventUpdate` frame, with no second push. A device tracking only the Yankees gets "Yankees went down in
order" as an alert of its own. If the device had cleared its feed in between, the line is dropped (`addLateLine`
finds no row), not sent as a new alert.

### Worked example: a loss and its facts

From the development database, the Giants beating the Dodgers 3-0 (game 401815054). At the final, the tracker
publishes the loss and its facts with one moment, `401815054:final:lost`: `team.lost` first
(`401815054:final:team.lost:19`), then `team.lost_as_favorite` (fold "Lost as 64% favorites."), `team.shut_out`
("Shut out.") and `team.lost_to_worse` ("Lost to the 10-13 Giants."), then Shohei Ohtani's `player.team_lost`. Two
devices' feed rows:

- A device with every alert on has one row, `401815054:final:team.lost:19`, "Successful Hate Watch! Dodgers lost to
  the Giants", with the lines "Lost as 64% favorites.", "Shut out.", "Lost to the 10-13 Giants.".
- A device with "Loses a game" off has one row too, `401815054:final:team.lost_as_favorite:19`, "Successful Hate
  Watch! Dodgers lost to the Giants as 64% favorites", with "Shut out." and "Lost to the 10-13 Giants.": the first
  of the moment it wants is the alert, and the rest are its lines.

Either way the Dodgers' loss counts once on each device's Successful Hate Watch tally, and "N other hate watchers"
counts everyone who got any of the moment's loss alerts.

## Layer 5: ESPN's edits are revisions, not new alerts

**Rules:**

- **An alert goes out the moment a play is first seen.** Nothing waits for a review (except a lost ABS challenge, a
  strikeout on a challenged pitch and a result waiting for the official scorer, held by design).
- **What ESPN changes afterwards is a revision of the alert that went out:** a line with no push on the alerts that
  no longer hold, and the alerts the play has now and didn't before sent as new. Never a second notification about
  the same play.
- **A revision line is `foldOnly` with the alert's own moment**, so it reaches only devices that got that alert
  (as their alert or a line on another).

ESPN changes plays after posting them. On October 10 2026's twelve noon college games it edited 49 plays in place
(about 30 gained a flag; an interception became roughing the passer), took out or re-posted 31 (touchdowns and
turnovers overturned on review, one touchdown posted under three ids), and changed drives' results after they ended
(the header comment of `revisions.ts`).

- **Basketball** (the NBA and the WNBA) goes through the same ledger, from a read that has the core feed. ESPN posts a
  basketball play half-finished and edits it (35 to 49% of the plays in three October 11 2026 preseason games): a shot
  "No Shot (Default Shot)" typed minutes later, a free throw with no shooter or flipped from "misses" to "makes", a block
  naming the wrong shooter for seconds, a foul or shot taken out and re-posted. So a changed play is judged again on its
  latest version (a play with no player alerts nothing until named): the alert it no longer has gets a line, no push
  ("ESPN has since credited this play to Paolo Banchero.", "ESPN has since changed this: the free throw was made.",
  "…the shot was blocked.", "ESPN has since taken this play out."), the right player's alert goes out (for 45 minutes after the
  play is first seen, `BASKETBALL_REVISE_MS`; a block that becomes a plain miss for the same shooter sends no "missed" alert or line
  after "ESPN has since changed this play.", because "got sent back" already covers a miss), and a re-post
  (`samePlay(…, true)`: the same period, the clock within 10 seconds, the same first participant and kind of play) is one
  alert. A missed shot ESPN describes differently later keeps its alert and gets a silent line only when the new words contradict
  the old (`shotDisagrees`: a three that is not one, 2 feet or more), measured against the alert as sent, with "changed back" when ESPN returns to it; a play
  posted more than 60 seconds of game time late (`LATE_PLAY_SECS`) shows the game's score now in its body (`GameCtx.latest`); an
  offensive charge is a foul (`FOUL_TYPE`), one with its turnover. Fouls are recounted with each version (`unobservePlay`, `observePlay`, `g.foulPlays`), so a foul re-posted under
  a new id isn't a 6th, and "fouled out" is never taken back. Details: docs/alerts.md, "Revisions: ESPN changes a
  basketball play after its alert".
- **Hockey** goes through the same ledger, from a read that has the core feed. ESPN posts a hockey play half-finished (EDM at LA,
  2026-10-13: every goal first a missed or saved shot, 6 of 7 penalties as "Penalty Shot Infraction", the empty-netter as an
  even-strength goal, 6 plays taken out). A changed play is judged again: a line with no push on the alert it no longer has
  ("ESPN has since changed this: Leon Draisaitl scored."), the alert it has now goes out, a late empty-netter or short-handed
  goal sends the team's alert with no `alt` so it folds into the "scored on" alert as a line, a penalty's call is a line.
  `nhl.goalie.pulled` is in `ONCE`. A goalie's shots faced and goals allowed are recounted with each version of a play
  (`g.goalieSeen`, `observePlay`, `unobservePlay`). Details: docs/alerts.md, "Revisions: ESPN changes a hockey play after its alert".
- **Football** (`server/src/revisions.ts`, `PlayLedger`, used by `GameTracker.poll` for college football and the
  NFL): for `REVISE_MS` (15 minutes) after it's first seen, each play and drive keeps the alerts it sent, by kind
  (type and target). Each read compares them with the play as ESPN has it now (`changed`, when the play's text, type,
  score, teams or participants differ):
  - An alert the play no longer has gets a line, with no push. The line says why (`changeLine`): "Wiped out by a
    penalty on Indiana: Roughing The Passer." (the play now ends in "NO PLAY"), "Overturned on review.", "ESPN has
    since changed this play to a rush.", or, for a play gone from the feed, "ESPN has since taken this play back.".
  - An alert it has now and didn't before goes out: a flag added later (feed only, as flags are), an incompletion
    that became an interception.
  - An alert taken back that the play has again (a flag overturned on review, a play back in the feed) gets a line
    ("Overturned on review: it stands.", "ESPN has since put this play back.", "ESPN has since changed this play
    back."), never a second alert.
  - A flag's alert taken back while its play stands says what became of the flag: "ESPN has since charged this flag
    to Robert Hainsey." or "ESPN has since taken the flag off." A device that had the first player's alert gets that
    line, not the new player's flag as a second alert (they share an `alt`, `flag-moved:${playId}`).
  - A team's flag (`nfl.penalty` on the team, `teamFlags`) is judged from the call's text, not from the participants, so it stays
    when a flag moves from one of its players to another (no line for the team; the moved-flag check looks at player flags
    only), and is taken back ("ESPN has since taken the flag off.") only when the team has none on the play.
  - A flag that still stands in the call's text (ESPN dropped or relabeled the flagged player in the data) is kept: no
    line. One ESPN now calls declined says so; one that became an ejection gets no flag line, the ejection's own
    follows; a lost fumble that is now the offense's own recovery says "ESPN has since corrected it: the Browns kept
    the ball."; a quarterback's delay of game that is the punt team's says so. Details: docs/alerts.md, "Revisions".
  - A football game's plays and drives are read for 3 more minutes after the final (`correctionsAfterFinal`), so a
    correction after END GAME is a revision too (a sack that was a run, a flag named late). What it finds goes to
    the feed and never pushes (`noPush`: ESPN's data can still flip back). That reading is in memory only.
  - A play re-posted under a new id at the same spot (`samePlay`: the same period, a start within 10 seconds, the
    same player, or naming none, the same type) is that play, revised (`repost`), not a new one. One touchdown posted
    under three ids is one alert.
  - A play missing for `GONE_MS` (30 seconds) has its alerts taken back (`sweep`). One short read doesn't count.
  - A score is taken back only when ESPN's plays, the score the latest plays carry and the header agree, two reads
    running. If the same side then scores on that drive within 10 minutes, the alert gets a line ("Then Wake Forest
    scored on the same drive: WAKE 16, NCSU 14."), not a second alert. A score the running total counted wrongly
    gets "ESPN has since corrected the score: …" (`takeBack`, `carry`).
  - A score that levels the game says so, with no push: "Rams tied the game, 34-34." (`tiedLine`), a line on the
    scored-on side's alerts for that score. The extra point or two-point try that levels it is an edit to the
    touchdown's play (or a play of its own), so `footballScore` puts the line on the touchdown's alerts, which the ledger
    kept (`scores`; the side's latest, `lastScored`, when the kick is on another play). A field goal, or a touchdown with
    its kick in the text, that levels the game puts the same line in the publish of its own alerts. The scored-on alert's
    fold has the same words, so a device with a player on the play too gets it once. A touchdown still waiting for its
    kick isn't said to tie.
  - A finished drive's result is revised the same way (`drivesRead`): "ESPN has since changed how the drive ended:
    End of Half."
  - `ONCE` alerts (the starting quarterback pulled) are counted as they come and never re-run on a new version.
  - The NFL's core plays go through the same code. A play wiped out by a penalty ("- No Play.") alerts only its
    flags, though ESPN often keeps its type (73 times in 734 in the 2026 season's first five weeks).
- **Soccer** (`reviseKeyText`, `judgeTouches`): ESPN posts a card, goal or substitution in a short form and rewrites it 9 to 69
  seconds later (14 of 17 in Man City 3-0 Liverpool, 2026-10-11). Each alert of the play takes the longer text on its feed rows
  within 5 minutes of the first sighting, through `reviseEvent` (no push); the detectors aren't run again, since a red card's
  "down to N men" counts as it goes. A touch ESPN retypes (11 type changes in that match) or removes is judged again as a
  pair for 6 minutes: an alert it newly makes goes out, one already out takes the new words, one it no longer makes stays and
  is logged. Details: docs/alerts.md, "EPL how" and "Soccer passes and dribbles".
- **MLB:** a changed at-bat result is logged, not judged again, but for the narrow cases of Layer 1 (`revisedResult`): a home
  run's distance becomes a line ("ESPN corrected the distance: 436 feet."), an error moved to another fielder a line on the
  first one's alert ("ESPN moved this error to Freddie Freeman.") and an alert for the new one, a taken-back third out a line on
  the half's early alert ("A replay review overturned the third out; the inning went on."). A lost ABS challenge waits for the review
  (`holdAbs`): it goes out once a later play exists and `HW_ABS_SETTLE_MS` (30 seconds) have passed (at the final, at
  once), and only if the pitch still reads Confirmed and, on an at-bat's last pitch, the result doesn't say the call
  was overturned. A pitch missing from one read isn't taken back, because ESPN serves stale copies that drop the
  latest plays for a read (six times in ALDS Game 5, October 10 2026): it takes two reads in a row
  (`abs-settle.test.ts`).
- **F1:** a result a penalty changes is corrected in place (`reviseEvent`: what changed, no push). What's new is
  sent, and what no longer holds is withdrawn ("Correction: …", off the Successful Hate Watch tally).
- **Clips:** a clip that comes later goes on the alert it belongs to (`eventChanged`), sent again live, no push.

### Worked example: an interception wiped out by a penalty

From `test/play-revisions.test.ts`, "an interception wiped out by a penalty after it went out", with Indiana at
Nebraska's own plays (game 401858481, October 10 2026). One device tracks Nebraska, one Indiana.

1. **First read.** The tracker attaches with Nebraska up 17-13. The old field goal is history: no alert.
2. **The pick.** A read has play 401858481541, "(11:09) No Huddle-Shotgun #10 A.Colandrea pass intercepted by #6
   P.Zachman at IND43, End Of Play". It's new (`seen`), so the detectors run: `cfb.team.interception` for Nebraska,
   id `401858481:401858481541:cfb.team.interception:158`, moment `401858481:play:401858481541:team:cfb:158`. The ledger
   records it under the kind `cfb.team.interception|team:cfb:158`. `publish` stores it, puts it in the Nebraska
   device's feed and pushes "Nebraska threw an interception" at once. `delivered` remembers the moment for that
   device.
3. **The edit.** A later read has the same play id with its type now "Penalty" and its text ending "PENALTY IND
   Roughing The Passer (#95 T.Tucker) 15 yards from NEB16 to NEB31, 1ST DOWN. NO PLAY". The play is already `seen`,
   so the detectors don't run; its signature changed, so the ledger revises it (`changed` → `revise`). The new
   version's alerts are Indiana's flag, `cfb.team.penalty` for Indiana. The interception is gone from them.
4. **The line.** The interception's kind is dropped, and `changeLine` reads "NO PLAY" in the ruling: "Wiped out by a
   penalty on Indiana: Roughing The Passer." `linesOn` makes a `foldOnly` alert with the interception's moment, id
   `…:cfb.team.interception:158:changed:<hash of the line>`, and `poll` publishes it on its own. `publish` finds the moment in
   `delivered` for the Nebraska device and calls `addLateLine`: the interception's feed row gets the line, the app
   gets an `eventUpdate` frame, and nothing is pushed.
5. **The flag.** Indiana's penalty is new, so it goes out as an alert: "Indiana was flagged: Roughing The Passer",
   in the Indiana device's feed with no push ("Gets flagged" is feed only by default).
6. **The result.** Nebraska's feed: one row, "Nebraska threw an interception", with "Wiped out by a penalty on
   Indiana: Roughing The Passer.". Pushes: one, Nebraska's, sent before the edit. Indiana: one feed row, no push.

The same file covers the rest: a touchdown overturned on review and scored again on the same drive is one alert with
two lines, "Overturned on review." and "Then Wake Forest scored on the same drive: WAKE 16, NCSU 14." (Wake Forest at
NC State); the same touchdown re-posted under new ids is one alert (Texas A&M at Missouri); a scoring play gone for
one short read is nothing, gone for good is a line; an NFL flag moved to another player says so on the first
player's alert (Eagles at Jaguars).

## Layer 6: the app keeps one copy of each id

**Rules:**

- **The app's feed is a map by alert id.** Anything that adds to it goes through `mergeFeed`.
- **An update is a whole alert, not a delta**: an `eventUpdate` frame carries the alert as it is now.

`app/src/lib/store.tsx`: `mergeFeed` puts the current feed and the new items in a `Map` by alert id, the newer copy
winning, and sorts by when it happened (`occurredAt`, ESPN's time for the play), then by when it was detected. So:

- An `event` frame for an id the feed already has replaces it (only `event` frames count as unseen and buzz the
  phone; `eventUpdate` frames don't).
- An `eventUpdate` frame (a late line, a clip, a revision, a correction) replaces it too.
- Every time the WebSocket connects or reconnects, the app reloads its feed (`refreshFeed`) to close any gap, and
  what comes back merges by id with what it has: reconnects and repeated frames never show two rows.

## What survives a restart

**Rules:**

- **Deploy when nothing is live** (the decision "No production restarts during live games"): a restart forgets
  the tracker's memory, so late facts and revisions from before it are lost.
- **Anything that must hold across a restart goes in the database** (`events`, `feed`, or a `kv` baseline), never
  only in memory.

A deploy restarts the server. This is what keeps a restart from re-sending alerts, and what it forgets:

| Kept (database) | Forgotten (memory) |
|---|---|
| `events` (ids), `feed` (with each device's lines), `hate_watches` | `seen`, `announced`, `onceDone`, `pitching`, `fouls`, `halfEnds`, `absHeld`, `heldFinal`, `noBatter`, `settleSince`, `resultSigs`, `resultTexts`, `resultPlays`, `sent`, `sentById`, `challengeWatch`, `endInnings`, `halfJudged`, `strikeThrees`, `ctx.owner` (rebuilt from the history the tracker reads on attaching), soccer's touch feed, `touchSigs`, `keyTexts`, `cardMoments` |
| `kv` baselines: standings (and their season type, `standings-season:${league}`), injuries, news, AP poll, notices, `streak-told`, the pregame facts, the one-time settings migrations | `delivered` (late facts), the football, basketball and hockey revisions ledger |
| | F1's `memo.sent`, `preSeen`, `resultsSeen`; football's `lastScored` (the side's latest score alerts, for a tying line when the kick is on another play) |

A restart, step by step:

1. **Shutdown.** Fly sends SIGTERM; the server stops and closes the database cleanly (README "Deploy"). Everything
   in memory is gone.
2. **Boot.** `fanout.ts` loads; its one-time settings migrations find their `kv` keys and do nothing. Nothing has
   been sent yet.
3. **Trackers attach as new.** The scoreboard scan finds each live game in which someone tracks a team and starts a `GameTracker` for it, with an
   empty `seen` and the pregame facts read back from `kv`.
4. **The first read.** Each game live at boot is attached `atBoot`, so plays more than 5 minutes old are history: they rebuild the score, `announced`, the bases,
   the goalies and the half-inning, and send nothing. A play from the last 5 minutes is detected again with the
   same id, which the database already has, so `publish` stops at the insert, and one the old server never read
   goes out as news. The box score's pitchers, finished
   drives and scoreless halves are baselines. The game was first seen already under way, so no "Hate Watch Starting".
5. **Off-game scans.** Standings, injuries and news compare with their `kv` baselines and find nothing new. F1
   reads the results of sessions from the last 8 hours again; their ids are stored, so nothing goes out
   (`f1-merges.test.ts`, "a restart").
6. **From the next read on**, the tracker works as before: new plays are new.

The tests for this: `game-start.test.ts` ("a game first seen already under way never gets a late 'starting'
alert"), `ufc.test.ts` ("attached mid-card (a restart)"), `f1-merges.test.ts` ("a restart: the stored results read
again change nothing") and `crew-chief-review.test.ts` (a review from an hour before the restart is history).

What is lost:

- **Late facts.** A fact that comes after a restart for a moment alerted before it has no `delivered` entry. If it
  has no `lateOn`, it can go out as an alert of its own rather than a line, and a `foldOnly` one is never shown.
- **Revisions.** A football, basketball or hockey play edited after a restart can't be compared with what it sent before: the
  ledger is empty, and a revision line has no `delivered` entry to land on.
- **MLB holds.** A lost ABS challenge held at the restart, or an at-bat waiting for its batter, a strikeout under an
  ABS review or a result waiting for the official scorer, from before the 90-second window is history. A line a rewrite would
  put on an alert (a distance, a moved error, a taken-back third out) after a restart has no `sent` record to land on and is
  not made.
- **Plays nobody read** (fixed October 11, 2026). The 90-second window counts from the play's own time (ESPN's
  wallclock), and ESPN posts plays well after that time: in production during ALDS Game 5, 10.9 to 92.7 seconds after it
  (median 23.9; README "Real-time", "What production measures"), plus the seconds the server is down for the deploy.
  With 90 seconds, a play the old server hadn't read yet could already be history for the new one. Games live at boot
  now take 5 minutes (`atBoot`, Layer 3), which covers it; a game followed later keeps 90 seconds, since its older
  plays went to nobody.

This is one reason for the decision **"No production restarts during live games"**: deploy when nothing is live.

## Known gaps

- **Pushes have no collapse id.** Only the database rows keep a push single. A second `publish` of an id sends
  nothing, but code that pushed without going through `publish` would not be caught by anything.
- **Text-keyed MLB ids** depend on ESPN's text staying the same. A re-judged rewritten result would make a new id,
  which is why changed results are logged, not judged again.
- **A rewrite that is not one of `revisedResult`'s** is still only logged. NLCS Game 2's squeeze bunt sentence flipped three
  times and went out as ESPN first wrote it ("Edman to first … Edman to second."); there is no general "ESPN rewrote this"
  line, because a sentence ESPN is still working on would write a line each time.
- **A fold sentence is compared as text.** Two wordings of the same fact are two lines.
- **A basketball play ESPN removes or changes after 45 minutes** keeps its alert with no line (`BASKETBALL_REVISE_MS`; it was 15 minutes until October 14, 2026, when a turnover ESPN moved to another player 20 minutes later showed that was too short; the slowest change seen is 42 minutes, a rebound). Franz Wagner's block alert in Magic at Cavaliers, removed 24 minutes later, would get its line now. A first alert on a play that ESPN fixes within seconds still goes out first (a free throw posted as "misses" that is flipped to "makes" a minute later): only its line corrects it.
- **A soccer foul that ESPN later marks "Penalty conceded"** is judged again (`fouls` in `GameTracker`), and the
  penalty's alerts have their own ids and moment (`soccerFoul`), so a device can get the foul (feed only) and then
  the penalty (pushed) as two alerts about one foul. Not changed by the Man City at Liverpool review's fixes (F1 to F5 don't
  cover it), and likelier now that a foul alerts from the touch feed first: only the commentary says "Penalty conceded".
- **Fixed on October 11, 2026:** revision lines' ids used a counter (`${id}:changed:${n}`) that started over with every
  tracker, so a game followed again could give a new line a stored id and lose it; they're now the line's own words
  hashed (Layer 1). And the 90-second window could skip a play the old server never read at a restart; games live at
  boot now take 5 minutes ("Plays nobody read").
- **A team's flag and a player's flag for the same flag** can be two rows for a device that tracks both, when ESPN names the
  player a poll after it posted the flag for the team and the player's flag pushes for that device (an install that kept flags
  pushed): the push is kept, so the team's row stays beside it (8 of 34 added flags in the replays; the unpushed ones are one
  row with the player as a line). A weak flag's own "taken off" line is dropped when a pushed alert has since become the
  device's holder of the moment, so that row can stay as it was.
- **A shot ESPN rewrites twice keeps the first correction.** Jrue Holiday's "missed a 26-foot three" got "it was a layup." when ESPN made it a layup, and ESPN's final word, a driving bank floater, adds no second line (it doesn't contradict the layup), so the device ends told "layup" (Trail Blazers at Kings, October 13 2026). A drift of a foot never gets a line.
- **The same revision line twice on one alert** (a play taken back, put back, then taken back again) has the same id,
  so the second "taken back" is dropped at the insert. The alert's row already shows that line once.

## How to change alerts safely

1. Read this file, the README's "Notifications" and "Real-time" sections, and the module's header comment.
2. **A new alert:** give it a deterministic id (Layer 1) with its type in it. Decide its `moment` and `fold` if it
   can coincide with another alert (Layer 4), and where it goes in the list (the first a device wants is its
   alert). Publish it through `publish`.
3. **A change to what an alert says or when it fires:** check whether its id changes. A changed id makes an alert
   that already went out go out again, for every game in progress when it deploys.
4. **ESPN changing data after it's posted:** handle it as a revision (Layer 5): a line with no push, never a second
   alert.
5. **State that must survive a restart** goes in the database or `kv` (What survives a restart).
6. **Test it.** Run a re-poll of the same feed (nothing new), a restart in the middle of a game (nothing new), the play
   in both feeds (one alert), and a player and his team tracked together (one alert). The tests that cover this:
   `bundling.test.ts`, `play-revisions.test.ts`, `live-score.test.ts`, `challenges.test.ts`, `crew-chief-review.test.ts`,
   `f1-merges.test.ts`, `hate-watches.test.ts`, `logic.test.ts`, `sport-alerts.test.ts`, `clips.test.ts` and
   `restart-backfill.test.ts` (a restart's 5 minutes, revision lines' ids). Replay a
   recorded game (`server/data/recordings/`) and compare the alert count.

## Files this covers

The docs hook asks for this file again before an edit to any of these, by the edit tools or a shell command that
writes to them:

- `server/src/`: `detectors.ts`, `live.ts`, `fanout.ts`, `revisions.ts`, `event-types.ts`, `push.ts`, `f1.ts`,
  `ufc.ts`, `news.ts`, `recap.ts`, `cfb-poll.ts`, `hate-watches.ts`, `notices.ts`, `clips.ts`, `misery.ts`, `db.ts`, `api.ts`
  (every file that builds, publishes or changes an alert; `grep -lE "publish\(|publishTo\(|reviseEvent\(|eventChanged\(|addLateLine\(|\bDetected\b" server/src/*.ts`
  should list nothing outside these. A new one goes in this list and in `ALERT_CODE` in the hook, the same.)
- `server/test/`: any test file (the tests are mostly alert tests)
- `app/src/lib/store.tsx` (the feed's merge)
