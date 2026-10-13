# Recent misery

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** The second tab on every player and team page lists the priority things that happened to them in the last 30 days: every loss (with how it happened as lines on it) and the worst of the rest (an ejection, a serious injury, a pulled quarterback or goalie, a red card, a DNF, a UFC loss). It is the same list for every user: not your feed, not shaped by your alert settings, and filled in for teams and players nobody tracks. The server writes it into its own table (`misery`, `server/src/misery.ts`) from the alerts it already makes and the scoreboard it already reads, and serves it publicly at `GET /targets/:key/misery`. It adds no ESPN calls.

**Sections:**
- **Recent misery**: what the tab shows, where its rows come from, what counts as priority, how a loss becomes one row, what a player's page adds, the endpoint, the app, and what isn't covered.

The README's "Recent misery" has the summary; this is the full detail. Read this index first, then only the part you need.

## Recent misery

**In short:** The second tab on every player and team page lists the priority things that happened to them in the last 30 days: every loss (with how it happened as lines on it) and the worst of the rest (an ejection, a serious injury, a pulled quarterback or goalie, a red card, a DNF, a UFC loss). It is the same list for every user: not your feed, not shaped by your alert settings, and filled in for teams and players nobody tracks. The server writes it into its own table (`misery`, `server/src/misery.ts`) from the alerts it already makes and the scoreboard it already reads, and serves it publicly at `GET /targets/:key/misery`. It adds no ESPN calls.

**What the tab shows** (`app/src/app/target/[key].tsx`). "Last 30 days", then up to 30 cards, newest first, drawn like feed cards (`FeedCard`): the title, three lines of the text, the alert's emoji and name ("Loses a game", "Fouls out"), when, and a share button; a tap opens the alert on its own screen. Under the list: "The same for everyone: losses and the worst of what happens to them, whoever tracks them." Empty: "No misery in the last 30 days. Give it time." If the server doesn't answer: "Couldn't load the misery." with "Try again". The tab loads when the page opens, again when the tab is tapped, and every 60 seconds while it's open, so a loss that ends while you look shows up. A server without the endpoint (a build ahead of its server) is answered with this device's own last day of alerts about them (`GET /me/feed?target=…`), which is what the tab was before.

**Where a row comes from** (`misery.ts`; nothing else writes the table):

1. **`publish()`** (`fanout.ts`) hands every alert it is given to `recordMisery()` first, before it drops the ones nobody tracks. So a loss, an ejection or an injury is a row whether or not anyone follows the team or player. `recordMisery` only keeps priority types, never throws (a failure here must not cost anyone an alert) and never changes whether, when or to whom an alert is sent: it writes only to `misery`, which no alert code reads (`docs/duplicate-alerts.md`).
2. **The scoreboard** (`live.ts`): when its scan sees a completed game that no tracker covers, `recordFinalOnBoard()` records the loser's loss from the scoreboard event the loop already read, worded exactly as a tracker would (`gameLostEvent`, `heavyLossEvent`, with the playoff series line or elimination from `seriesStanding` and `eliminationOf`). It runs for every league the scoreboard loop reads (the NBA, MLB, NFL, NHL, college football, WNBA and EPL), once per game per server start, and for yesterday's finals after a restart (`scanYesterday`). The scoreboard has no end time, so the loss's time is the game's start plus 3.5 hours, or now if that hasn't passed. A tie has no loser and records nothing.
3. **A one-time backfill** on the first start after this shipped (`kv` `misery_backfilled`): the loss and priority alerts already in `events` from the last 60 days. Their facts weren't kept with them, so those rows have no lines.

**"Successful Hate Watch!" is for people who track the team.** The list is the same for everyone, so a loss is stored and served without that wording ("Bulls lost to the Nuggets"). Each served loss carries `loss: true`, and the app puts "Successful Hate Watch! " back in front of the title when the viewer tracks the row's team (or fighter) or the player whose page it is (`withHateWatch` in `target/[key].tsx`, `isFollowing`). The same card opened on its own screen keeps whichever title it was shown with.

**One loss, one row.** The detectors make a loss as several alerts sharing a moment (`docs/duplicate-alerts.md`, Layer 4): the team's `team.lost`, soccer's `<league>.team.heavy_loss`, facts that carry `meta.lostId` and a `fold` sentence, and each player's `player.team_lost`. Here the loss is one row, with the loss's own id (`${gameId}:final:team.lost:${teamId}`):

- The facts' `fold` sentences are the row's **lines**, in front of its body, the way a feed card shows them: "Lost as 77% favorites. Blew a 15-point lead. Final Score: 133 to 128". A fact only attaches to a row that exists (the loss comes first in a publish), and the same sentence is added once.
- Soccer's heavy loss gives the row its title and type ("Man United were thrashed 4-1 by Ipswich", "Loses by 3+ goals"), whichever comes first.
- `player.team_lost`, and the copies of a loss's facts addressed to a player, are not stored: a player's page finds their team's losses itself (below).
- A row's `source` is `tracker`, `board` or `backfill`. The tracker's row (the facts, the series line) replaces a scoreboard row, never the other way, so the scoreboard's is a floor, not a competitor. Recording the same alert again (a restart, a re-poll) changes nothing and doesn't double a line.
- An alert withdrawn or changed after it went out (`reviseEvent`, an F1 result a penalty changed) is revised the same way (`reviseMisery`): the new words, or the row is deleted if the alert no longer stands.

**What counts as priority** (`PRIORITY`, `LOSSES`, `isMisery` in `misery.ts`; extend there only). Losses and bad turns, not bad plays: no strikeouts, missed shots, fouls, turnovers or incompletions (those are what Alerts are for).

| Kind | Types |
|---|---|
| A loss | `team.lost`, `<soccer league>.team.heavy_loss`, `ufc.lost`, `f1.team.no_points`, `f1.team.double_dnf`, and a loss's facts as lines (walk-off, overtime, blew a lead, lost as the favorite, lost to a worse team, shut out, a losing streak, a ranked team losing to an unranked one) |
| Teams | eliminated, swept, falls below .500, a losing streak, off-field trouble, fined or suspended, gets no-hit (MLB), a safety (NFL, college), drops in or out of the AP poll, pulls its quarterback or has a player ejected (college), a red card and the relegation zone (soccer) |
| Players | ejected, off-field trouble, fined or suspended, a serious injury (Out, injured reserve, out for the season, suspension; not Questionable or Day-to-Day), blows a save, takes the loss, gets chased (MLB), quarterback pulled (NFL), goalie pulled (NHL), technical or ejection, fouls out (NBA, WNBA), a red card, an own goal, a missed penalty (soccer) |
| F1 drivers | doesn't finish, finishes outside the points, loses places from the grid, finishes behind the teammate, lapped, knocked out in qualifying |
| UFC fighters | the loss (with how and when) and its facts: a lost title fight, losing as the favorite, a losing streak |

**Teams and players.** A team's page lists the team's rows. A player's, fighter's or driver's page lists their own rows and, mixed in by time, their team's losses (`miseryRows`: rows whose target is the player, or `kind = 'loss'` rows of `players.team_key`): "Bulls lost to the Nuggets" and Josh Giddey's own "fouled out" together. A team's loss is therefore one row however many players it has, never one per player. A UFC fighter's loss is the fighter's own row (the UFC's placeholder team has no page). A team's injuries aren't on its page, only the player's.

**The endpoint.** `GET /targets/:key/misery` (public, no device token; `server/src/api.ts`) → `{ items: FeedItem[], days: 30 }`, the same item the feed carries (`feedItem`: emoji, type name, title, body with the lines, time, the team or player, share link) without anything per device (no "N others got this", no clip). 404 for a key the catalog doesn't know. At most `MISERY_LIMIT` (30) from the last `MISERY_DAYS` (30) days, newest first; rows older than 60 days are deleted. A share link for a row nobody was sent opens it too (`miseryByCode` in `share.ts`).

**What the tab looks like, in every sport.** These are demonstration rows, not real incidents: seeded into a scratch database copy and then served by the real endpoint to the real app, so the wording, lines, emoji and layout are exactly what the code produces, while the games and events are made up (a team's opponent is whichever team the catalog id gave). The Bulls' 133-128 loss to the Nuggets, its 15-point blown lead, and the Dodgers-Brewers NLCS Game 1 loss ("Down 0-1 in the NLCS. Final Score: 2 to 1") are real games, checked in `server/test/misery.test.ts` and `server/test/nlcs-game1.test.ts`.

- NBA, Bulls: "Bulls lost to the Nuggets" ("Successful Hate Watch! Bulls lost to the Nuggets" if you track the Bulls), "Blew a 15-point lead. Lost as 77% favorites. Final Score: 133 to 128", then "Bulls fell below .500". On Josh Giddey's page, the same losses plus "Josh Giddey got ejected (second technical)" and "Josh Giddey fouled out".
- MLB, Yankees: "Yankees lost to the Rays", "Lost as 66% favorites. Lost 3 straight. Down 0-1 in the ALDS. Final Score: 5 to 2"; on Gerrit Cole's page also "Gerrit Cole took the loss" and "got chased in the 6th".
- NFL, Steelers: "got BLOWN OUT by the Bengals" (a 28-point blowout); on Aaron Rodgers's page also "got pulled: Mason Rudolph is in at quarterback".
- NHL, Stars: "lost to the Flames", "Lost in overtime. Lost 4 straight."; on Jake Oettinger's page "got pulled after allowing 4 goals on 15 shots".
- College football, Nebraska: "Lost to unranked Indiana as the No. 19 team", "fell from 19th to 24th in the AP poll".
- EPL, Man United: "were thrashed 4-1 by Ipswich", "dropped into the relegation zone"; on Marcus Rashford's page "was sent off (second yellow)" and "scored an own goal".
- WNBA, Fever: "lost to the Storm", "Blew a 12-point lead."; on Caitlin Clark's page "fouled out".
- F1, Ferrari: "Ferrari: double DNF"; on Charles Leclerc's page also "retired on lap 31" and "finished behind teammate Lewis Hamilton".
- UFC, Ilia Topuria: "got knocked out by Justin Gaethje (KO/TKO R4 5:00)", "Lost as a 4-to-1 favorite."

**What isn't covered.** The list is only as complete as what the server reads, and it adds no ESPN call to read more (the call count is being measured, README "Real-time"):

- The scoreboard leagues (above): every final the scoreboard shows, tracked or not. A final the server never saw (it was down through the whole game and the next day) has no row, though the game's tracker rows from before the outage remain.
- **F1:** the race, sprint and qualifying results are read for every driver and constructor whenever anyone tracks any F1 driver or constructor (`scanF1`); with nobody tracking any, nothing is read and nothing is recorded.
- **The UFC:** a card is read only for fights with a tracked fighter on them (`poll` in `ufc.ts`), so an untracked fighter in an untracked fight has no row.
- **Injuries** come from each league's injury report, read for every team (`scanInjuries`), so they cover everyone.
- Nothing before the first start with this change, except the 60-day backfill from alerts already stored.
- Preseason and exhibition games are recorded like any other: the trackers alert on them.
- **A future call-reduction setting would cut it.** Anything that slows or skips the scoreboard or injury scans (the held `savings.*` switches) reduces what is recorded by the same amount, because Recent misery rides on those reads and adds none of its own. Weigh that when those switches are evaluated.

**Tests:** `server/test/misery.test.ts` (9 tests): a loss nobody tracks becomes one row (titled without "Successful Hate Watch!") with its fact as a line and sends nothing, and again is the same row; a player's page has the team's loss, never a copy per player; only priority alerts and serious injuries are kept; a soccer heavy loss wins the title in either order; a withdrawn alert comes off; the scoreboard's loss is worded as the tracker's and a tracker's row replaces it; an alert judged by its aliases too (a pitcher's loss folded under "no quality start"); the last 30 days and 30 rows; the public endpoint and a share link for a row nobody was sent. `nlcs-game1.test.ts` checks the real Dodgers-Brewers game through a real tracker: one row, the series line, one for the team however many devices got it, none stored per player.
