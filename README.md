# Hate Watch 😈

**In short:** Hate Watch is a phone app for following the athletes and teams you can't stand, and getting a push the moment something bad happens to them. It is two programs in one repository: an Expo app in `app/` and a Node server in `server/` that reads ESPN, spots bad plays in live games and sends them to the people who track them. Production is one Fly.io machine (`hate-watch-api`) with a SQLite database, and app builds come from EAS.

The rest of this README is the map of how everything works: each section is a short summary that links to its full detail in `docs/`. **Run it** starts the app and the server on your own machine. **Deploy** covers the server on Fly.io, the iOS and Android builds on EAS, App Store Connect, donations and the icons. **Data** explains where teams, players and images come from and how the catalog stays free of duplicates and wrong faces. **Real-time** covers how fast an alert arrives and how football plays that ESPN rewrites are handled. **Notifications** lists every alert type, the defaults for new installs and every setting. Then the app's screens and features: the **Scores tab**, the **Stats pages**, the **Successful Hate Watch counter**, the **Leaderboard**, the **Startup guide**, **An alert on its own screen**, **Developer notices** and **Sharing an alert**. **Tests** says how the code is checked, and **Known limits** what isn't covered or can't be. The UFC and college football are described in `PATCH_NOTES.md` and in the header comments of `server/src/ufc.ts` and `server/src/cfb-poll.ts`. Releasing is in `CLAUDE.md`, and the Google Play release in `docs/android-release.md`.

Track the athletes and teams you can't stand. Get a push the moment something bad happens to them.

- **`app/`**: the iOS and Android app, built with Expo SDK 57 (`expo` ~57.0.26), React Native 0.86 and Expo Router. It also runs on the web, for development. It talks to the server over REST and a WebSocket. The server's address is `EXPO_PUBLIC_API_URL`, or `http://localhost:8787` in a development build and `https://hate-watch-api.fly.dev` in a release build (`app/src/lib/api.ts`, `API_URL`). The WebSocket is the same address with `ws` in place of `http`, at `/ws` (`WS_URL`).
- **`server/`**: the Node backend. Node runs its TypeScript sources directly (`"engines": { "node": ">=22.18" }`, and Node 24 in the Docker image), with SQLite from `node:sqlite`. It has three jobs:
  - It builds a catalog of every team and player from ESPN (`server/src/catalog.ts`, see Data below).
  - It watches live games and detects bad plays (`live.ts`, `detectors.ts`).
  - It sends each alert to the feed, to the open apps over the WebSocket, and to phones as a push through Expo Push, which hands it to APNs (iOS) or FCM (Android) (`fanout.ts`, `push.ts`).
- **Nine leagues**, in the order the app lists them (`LEAGUE_IDS` in `server/src/leagues.ts`): the NBA, MLB, NFL, NHL, Formula 1, the Premier League (EPL), the UFC, college football (FBS teams only, no players) and the WNBA. The WNBA always goes last, wherever a league is added in `LEAGUES`. Each league's look in the app (its chip colour, its filter, what its people and events are called) is set by `ui` in `LEAGUES`, so it changes with a server deploy rather than an app build.

```
ESPN (core plays + site summary, polled in parallel every 2s per live game; college football: summary drives, every 5s)
   │
   ▼
GameTracker ─► league detectors ─► publish() ─┬─► events table (deduped by deterministic id)
scoreboard (10s) / standings (60s) /           ├─► per-follower prefs filter (type, league); push also skips muted + quiet hours
injuries (30s)                                 ├─► feed rows ─► WebSocket frame to open apps (≈ms)
college football: scoreboard (20s, 5 min       └─► Expo Push ─► APNs / FCM (app closed)
  when no game is near) / standings (10 min),
  no injuries or news
```

How to read the diagram, checked against `server/src/live.ts` and `fanout.ts`:

- **Each live game is read every 2 seconds** (`HW_LIVE_POLL_MS`, default 2000). Each read fetches ESPN's core play-by-play and the site summary at the same time (`Promise.allSettled`) and merges their plays (`mergePlays`). Soccer reads the summary and the touch-by-touch feed (its newest page each poll); college football reads the summary alone. A college football game is read every 5 seconds (`HW_TEAMS_ONLY_POLL_MS`).
- **Slower loops:** the scoreboard every 10 seconds (`HW_SCOREBOARD_MS`), to find games going live or final. Standings every 60 seconds (`HW_STANDINGS_MS`). Injury reports every 30 seconds (`HW_INJURIES_MS`).
- **`publish()` stores each alert once** in the `events` table. Its primary key is a deterministic id built from what happened (for example game, play, type and athlete), so reading the same play again never alerts twice.
- **Each follower's settings decide what they get.** An alert type or league they switched off is skipped, unless they set that target's alerts on their own (a per-target setting beats the global switches, `typeEnabledFor`). Push also skips a target they muted (it still reaches their feed) and their quiet hours (default off, 23:00 to 08:00 America/New_York, `DEFAULT_PREFS` in `fanout.ts`).
- **Open apps** get the alert as a WebSocket frame within milliseconds. **A closed app** gets it as a push.

## Index

**Summary:** this README is the map of how Hate Watch works. Each section below is a short summary ("**In short:**") and a link to its full detail in `docs/`; each of those docs opens with its own index, so read the index, then only the part you need.

**Sections:**
- **Run it** ([docs/run-it.md](docs/run-it.md)): Start the server with `cd server && npm ci && npm start`.
- **Deploy** ([docs/deploy.md](docs/deploy.md)): Hate Watch reaches people in three ways.
- **Data: rosters, duplicates, and images** ([docs/data.md](docs/data.md)): Every team and player comes from ESPN's public API.
- **Real-time: how fast is it?** ([docs/real-time.md](docs/real-time.md)): An alert reaches an open app within milliseconds of the server seeing the play, and a closed phone typically 1-3 seconds later through Expo's push service.
- **Notifications (every alert type, all user-controllable)** ([docs/notifications.md](docs/notifications.md)): every alert type a user can switch is one entry in `EVENT_TYPES` (`server/src/event-types.ts`): 152 types today, 99 of them pushed by default, 37 feed only (on, in the feed, no notification) and 16 off.
- **Scores tab** ([docs/scores-tab.md](docs/scores-tab.md)): The Scores tab lists games.
- **Stats pages** ([docs/stats-pages.md](docs/stats-pages.md)): Every player and team page opens on a **Stats** tab (next to "Recent misery"): a player's season line, postseason and career, their last five games and their team's next game; a team's record and standing, its season line (the EPL's league table instead), its last five results and its next game; F1 drivers and constructors their championship season, and UFC fighters their record.
- **Redundancy: when the server fails** ([docs/redundancy.md](docs/redundancy.md)): the server is one Fly machine with SQLite on one volume; Litestream copies the database off it every second or so, and `/health/deep` tells an outside monitor when something has stopped.
- **Recent misery** ([docs/recent-misery.md](docs/recent-misery.md)): the second tab on every player and team page lists the priority things that happened to them in the last 30 days: every loss (with how it happened as lines on it) and the worst of the rest (an ejection, a serious injury, a pulled quarterback or goalie, a red card, a DNF, a UFC loss).
- **Successful Hate Watch counter** ([docs/hate-watch-counter.md](docs/hate-watch-counter.md)): The top of Settings counts the device's Successful Hate Watches, each time a team it tracks loses (or the team of a player it tracks), or a UFC fighter it tracks loses, with the teams and fighters that gave it the most.
- **Leaderboard** ([docs/leaderboard.md](docs/leaderboard.md)): The podium button at the top left of every tab opens the most hated athletes and teams, ranked by how many people (devices) track them, filtered like the Feed: Everything, Teams or Players, in every sport or one league.
- **Startup guide** ([docs/startup-guide.md](docs/startup-guide.md)): On a device's first launch the app opens a nine-page guide over the Feed (`app/src/app/guide.tsx`, a full-screen modal): what the app does, tracking, the Feed and sharing, the Scores tab, the leaderboard, alert settings, the counter, the Tracking tab's controls, and "You're all set".
- **An alert on its own screen** ([docs/alert-screen.md](docs/alert-screen.md)): A card in a list shows three lines of an alert's text; tapping it opens the alert on its own screen (`app/src/app/alert/[id].tsx`) with all of its text, its clip, how many other hate watchers got it, when it happened, who it's about and a Share button.
- **Developer notices** ([docs/developer-notices.md](docs/developer-notices.md)): A developer notice is a message from Hate Watch itself that goes into every install's feed and is never pushed, for an emergency (an outage, alerts that went out wrong) or news of what's coming.
- **Sharing an alert** ([docs/sharing.md](docs/sharing.md)): Sharing an alert sends a link, `https://hate-watch-api.fly.dev/a/<code>`, not text.
- **Tests** ([docs/tests.md](docs/tests.md)): `npm test` in `server/` runs every `test/*.test.ts` file with Node's own test runner: 433 tests in 61 files, offline, in about 4 seconds, all passing on October 13, 2026.
- **Known limits** ([docs/known-limits.md](docs/known-limits.md)): Everything rests on ESPN's unofficial, undocumented API, so its delay is our floor and a change to its fields can break a league until the code catches up; the replays are the early warning.

The other docs: [docs/alerts.md](docs/alerts.md) (every alert in detail), [docs/duplicate-alerts.md](docs/duplicate-alerts.md), [docs/android-release.md](docs/android-release.md), and [docs/working-in-this-repo.md](docs/working-in-this-repo.md) (the explanations behind CLAUDE.md's rules).

## Run it

**In short:** Start the server with `cd server && npm ci && npm start`. It listens on port 8787 and keeps its development database in `server/data/hatewatch.db`. On the very first start, that database is empty, so the server reads every league from ESPN before it starts listening. Start the app with `cd app && npm ci && npx expo start`. A development build talks to `http://localhost:8787` unless `EXPO_PUBLIC_API_URL` says otherwise. Push needs a physical phone and a development build. `HW_DEV=1` adds a route for sending yourself a test alert.

The full detail: [docs/run-it.md](docs/run-it.md).

## Deploy

**In short:** Hate Watch reaches people in three ways. Each has its own command, and none of them needs the other machine. **The server** (`server/`) runs on Fly.io as the app `hate-watch-api`: one machine, with SQLite on a volume. A server deploy reaches every installed build within seconds. **The app** (`app/`) is built in the cloud by EAS (Expo Application Services) and sent to TestFlight and the App Store, and later Google Play. **Over-the-air updates** (EAS Update) send JavaScript and asset changes to builds after build 12 without a new build. The day-to-day release rules (ask first, the exact commands, backups, server switches, developer notices, patch notes) are in `CLAUDE.md` under "Release flow". This section covers first-time setup and how each piece is configured.

The full detail: [docs/deploy.md](docs/deploy.md).

## Data: rosters, duplicates, and images

**In short:** Every team and player comes from ESPN's public API. The server reads it all again every 6 hours (`ingest()` in `server/src/catalog.ts`), and right away when what the read collects changes (`INGEST_VERSION`, now 5). Players are deduplicated twice: on ESPN athlete id, then on normalized name plus birth date. Nothing is committed with a duplicate key or a player without an image, and every photo and game-league logo is fetched to check it exists. A player ESPN has no photo for shows their team's logo with their jersey number, never someone else's face. F1 constructors, which have no logos on ESPN, get a drawn badge instead.

The full detail: [docs/data.md](docs/data.md).

## Real-time: how fast is it?

**In short:** An alert reaches an open app within milliseconds of the server seeing the play, and a closed phone typically 1-3 seconds later through Expo's push service. Nearly all the delay before that is ESPN's: it posts a play well after it happens, so each live game's feeds are read every 2 seconds with ESPN's CDN cache bypassed. A few alerts wait on purpose, for ESPN to finish a review or a half-inning, and football and basketball alerts are revised when ESPN changes a play after posting it. The tables below give every stage and every deliberate wait, with the constant and environment variable behind each.

The full detail: [docs/real-time.md](docs/real-time.md).

## Notifications (every alert type, all user-controllable)

**In short:** every alert type a user can switch is one entry in `EVENT_TYPES` (`server/src/event-types.ts`): 152 types today, 99 of them pushed by default, 37 feed only (on, in the feed, no notification) and 16 off. The table below says what each league's alerts are and how they're detected. Under the table: the defaults new installs get, what older installs kept, and every control in Settings, on a player's or team's own alert screen and on the Tracking tab. A game, news or standings alert goes through `publish()` in `server/src/fanout.ts` (the weekly recap through `publishTo`; developer notices, which are never pushed, through neither). It is stored once by its id. If it's a loss, it counts on the Successful Hate Watch tally. It reaches the feed of each device that tracks its target (or one of the team's players, with "Get their team's alerts" on) and has the alert switched on, as one alert per thing that happened. It's pushed only when push is on, the target isn't muted, it isn't quiet hours in the device's stored time zone, and the bell of the alert (or of a fact folded into it) says notify. "How a push is decided", below, goes through it step by step; [docs/duplicate-alerts.md](docs/duplicate-alerts.md) covers how one thing happening stays one alert.

The full detail: [docs/notifications.md](docs/notifications.md).

## Scores tab

**In short:** The Scores tab lists games. "My games" is today's games for the teams you track and the teams of the players you track (live first, then later today, then finals, each kept for 24 hours after it ends), followed by "Up next", each tracked team's next game. "All games" is every game live now or starting in the next 24 hours, whether you track anyone in it or not. The cards come from the server's ESPN scoreboard reads every 10 seconds, with scores and details patched in sooner by the 2-second game tracker, and every change is pushed over the WebSocket to the devices that track a side; tapping a card opens its game screen, with the live card, the box score and highlights, and your alerts from that game.

The full detail: [docs/scores-tab.md](docs/scores-tab.md).

## Stats pages

**In short:** Every player and team page opens on a **Stats** tab (next to "Recent misery"): a player's season line, postseason and career, their last five games and their team's next game; a team's record and standing, its season line (the EPL's league table instead), its last five results and its next game; F1 drivers and constructors their championship season, and UFC fighters their record. The numbers worth gloating about (strikeouts, interceptions, errors, cards) are in red when there are any, and in a team's form an L is the green one. The server builds each page from ESPN at `GET /targets/:key/stats` (`server/src/stats.ts`) and keeps it for 10 minutes.

The full detail: [docs/stats-pages.md](docs/stats-pages.md).

## Redundancy: when the server fails

**In short:** the server is one Fly machine with SQLite on one volume, so its failures are the volume's, the host's and the region's. **Litestream** streams the database to object storage (Tigris) every second or so, so a lost volume loses about a second of data instead of up to a day, and a machine started on an empty volume restores itself before it serves. **`GET /health/deep`** answers 503 when the database, the ESPN reads, a game's poll loop or the replication has stopped, for an outside monitor to message the owner; Fly's own check stays on `/health`. Both are built and tested offline and do nothing until the setup steps are done. A warm standby in a second region is designed, not built.

The full detail, with the runbooks: [docs/redundancy.md](docs/redundancy.md).

## Recent misery

**In short:** The second tab on every player and team page lists the priority things that happened to them in the last 30 days: every loss (with how it happened as lines on it) and the worst of the rest (an ejection, a serious injury, a pulled quarterback or goalie, a red card, a DNF, a UFC loss). It is the same list for every user: not your feed, not shaped by your alert settings, and filled in for teams and players nobody tracks. The server writes it into its own table (`misery`, `server/src/misery.ts`) from the alerts it already makes and the scoreboard it already reads, and serves it publicly at `GET /targets/:key/misery`. It adds no ESPN calls.

The full detail: [docs/recent-misery.md](docs/recent-misery.md).

## Successful Hate Watch counter

**In short:** The top of Settings counts the device's Successful Hate Watches, each time a team it tracks loses (or the team of a player it tracks), or a UFC fighter it tracks loses, with the teams and fighters that gave it the most. The server counts them in `publish()` (`server/src/hate-watches.ts`) for every device the loss is addressed to, whatever its alert settings, once per device and loss, and sends the new tally over the WebSocket. Every Successful Hate Watch alert also says how many other people got it ("23 other hate watchers"). Clearing the feed keeps the count; "Delete all my data" removes it.

The full detail: [docs/hate-watch-counter.md](docs/hate-watch-counter.md).

## Leaderboard

**In short:** The podium button at the top left of every tab opens the most hated athletes and teams, ranked by how many people (devices) track them, filtered like the Feed: Everything, Teams or Players, in every sport or one league. Each filter is the top 100 ranked on the server within that filter, with 🥇🥈🥉 for the top three, ties shown as "T-2" with no gaps after them, and a note when the list is cut. It comes from `GET /leaderboard` (`server/src/leaderboard.ts`), public because it's only counts, never who.

The full detail: [docs/leaderboard.md](docs/leaderboard.md).

## Startup guide

**In short:** On a device's first launch the app opens a nine-page guide over the Feed (`app/src/app/guide.tsx`, a full-screen modal): what the app does, tracking, the Feed and sharing, the Scores tab, the leaderboard, alert settings, the counter, the Tracking tab's controls, and "You're all set". It shows once per install (`hatewatch.guideSeen` in AsyncStorage) and can be watched again from Settings → About → Show the guide. The notification permission prompt waits until the guide is closed.

The full detail: [docs/startup-guide.md](docs/startup-guide.md).

## An alert on its own screen

**In short:** A card in a list shows three lines of an alert's text; tapping it opens the alert on its own screen (`app/src/app/alert/[id].tsx`) with all of its text, its clip, how many other hate watchers got it, when it happened, who it's about and a Share button. The screen shows the feed's copy when there is one, so a line added later appears live, and otherwise the copy that was tapped. A developer notice opens the same way, from Hate Watch, with no page to open and nothing to share.

The full detail: [docs/alert-screen.md](docs/alert-screen.md).

## Developer notices

**In short:** A developer notice is a message from Hate Watch itself that goes into every install's feed and is never pushed, for an emergency (an outage, alerts that went out wrong) or news of what's coming. It's sent from a shell on the server with `server/src/notice-cli.ts`, which writes it straight into the database (the work is in `server/src/notices.ts`), and the running server shows it in open apps within about 5 seconds. The same command lists notices and withdraws one; nothing in Settings turns them off, and only the user decides when one goes out (CLAUDE.md, "Release flow").

The full detail: [docs/developer-notices.md](docs/developer-notices.md).

## Sharing an alert

**In short:** Sharing an alert sends a link, `https://hate-watch-api.fly.dev/a/<code>`, not text. In Messages, WhatsApp, Discord, X and Slack the link previews as a 1200×630 picture of the alert that the server draws from its own data, so it looks like a screenshot. On an iPhone with Hate Watch installed, tapping it opens the app on that alert (a universal link); without the app it goes to the App Store; anywhere else it's a web page with the card and a download button. The code is the first 11 characters of a SHA-256 of the alert's id (`shareCode()` in `server/src/db.ts`), and the server side is `server/src/share.ts`.

The full detail: [docs/sharing.md](docs/sharing.md).

## Tests

**In short:** `npm test` in `server/` runs every `test/*.test.ts` file with Node's own test runner: 433 tests in 61 files, offline, in about 4 seconds, all passing on October 13, 2026. Next to them are scripts that read live ESPN (replays of finished games, the two-feed check, an F1 replay, a catalog audit) and an end-to-end smoke test against a running server. On the Mac, recordings of live games under `server/data/recordings/` (not in git) are replayed through the real game tracker and checked against what production sent.

The full detail: [docs/tests.md](docs/tests.md).

## Known limits

**In short:** Everything rests on ESPN's unofficial, undocumented API, so its delay is our floor and a change to its fields can break a league until the code catches up; the replays are the early warning. Some alerts are inferred rather than read (the NHL goalie in net, MLB runs charged to whoever is pitching), some leagues lack data ESPN doesn't publish (soccer injuries and streaks, F1 injuries), and some paths have only been tested on simulations or recordings. Each limit below says why it exists and what to do about it, where there's anything.

The full detail: [docs/known-limits.md](docs/known-limits.md).

