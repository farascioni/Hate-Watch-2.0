# Run it

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** Start the server with `cd server && npm ci && npm start`. It listens on port 8787 and keeps its development database in `server/data/hatewatch.db`. On the very first start, that database is empty, so the server reads every league from ESPN before it starts listening. Start the app with `cd app && npm ci && npx expo start`. A development build talks to `http://localhost:8787` unless `EXPO_PUBLIC_API_URL` says otherwise. Push needs a physical phone and a development build. `HW_DEV=1` adds a route for sending yourself a test alert.

**Sections:**
- **Run it**: Start the server with `cd server && npm ci && npm start`.
- **Request limits**: what the server accepts from a caller: a JSON body of at most 64 KB (400 / 413), numeric query values clamped to their route's range, a known platform and a string-or-null push token on devices, at most 30 new devices an hour per address (429), and a share link's host that is one of ours.

The README's "Run it" has the summary; this is the full detail. Read this index first, then only the part you need.

## Run it

**In short:** Start the server with `cd server && npm ci && npm start`. It listens on port 8787 and keeps its development database in `server/data/hatewatch.db`. On the very first start, that database is empty, so the server reads every league from ESPN before it starts listening. Start the app with `cd app && npm ci && npx expo start`. A development build talks to `http://localhost:8787` unless `EXPO_PUBLIC_API_URL` says otherwise. Push needs a physical phone and a development build. `HW_DEV=1` adds a route for sending yourself a test alert.

```bash
cd server && npm ci && npm start          # first start: reads every league from ESPN, then serves :8787
cd app && npm ci && npx expo start        # press i / a, or w for web
```

Install with `npm ci`, not `npm install`. `npm ci` installs exactly what `package-lock.json` says and never rewrites it. A rewritten lockfile has broken an EAS build before (see CLAUDE.md). Don't run `npx expo lint` in `app/` either: ESLint isn't set up, so it installs ESLint and rewrites the lockfile.

**The server, step by step** (`server/src/index.ts`, `db.ts`):

1. `npm start` runs `node --disable-warning=ExperimentalWarning src/index.ts`. Node runs the TypeScript directly, with no build step. That needs Node 22.18 or later (`engines` in `server/package.json`).
2. `db.ts` opens the SQLite database at `HW_DB`, which defaults to `data/hatewatch.db`. The path is relative to the folder you start in, so start the server from `server/`. The folder is created if it's missing (`mkdirSync`). The database runs in WAL mode, with foreign keys on, and its tables are created if they don't exist: `teams`, `players`, `devices`, `follows`, `events`, `feed`, `hate_watches` and `kv`. Columns added after launch are added to an older database on start: `events.share_code`, `players.positions`, `events.clip` and `feed.extra`. `server/data/` is in `server/.gitignore`, so each machine has its own development database.
3. `loadCatalog()` reads the teams and players into memory.
   - **If the catalog is empty** (a new machine, or a deleted database), the server logs `[boot] catalog empty; ingesting rosters from ESPN…` and reads every league before it listens. Fly's health check gives a first boot 120 seconds (`grace_period` in `server/fly.toml`), whose comment estimates 30 to 60 seconds. The latest full read of the development database, on 2026-10-11, came to 309 teams and 6,980 players.
   - **If a league is missing** from a catalog that isn't empty (a deploy that adds a league, as F1, the WNBA, the UFC and college football each were), the server logs `[boot] catalog missing …; ingesting in the background` and serves at once. The read it then starts covers every league, not just the missing one.
4. It logs `[boot] catalog { teams, players }` and `[boot] next roster refresh in N min`, then schedules the 6-hour refresh (see Data).
5. It starts the API on `PORT` (default 8787; production uses 8080, set in `fly.toml`), the live-game engine (`engine.start()`), and the watcher that sends developer notices to open apps (`watchNotices()`).
6. On `SIGTERM` or `SIGINT` (Ctrl-C, or a deploy), it closes the HTTP server and the database and exits.

To check it's up, run `curl localhost:8787/health`. It answers `{ ok: true, catalog: { teams, players }, live: …, calls: … }`: `calls` is every request the server has sent to ESPN since it started, by league and kind of read (docs/real-time.md, "Counting the calls to ESPN"). `GET /catalog/report` returns the last ingest's report, with each league's counts and every problem it noted.

**Server scripts** (`server/package.json`):

| Script | What it runs | What it's for |
|---|---|---|
| `npm start` | `src/index.ts` | The server. |
| `npm run ingest` | `src/ingest-cli.ts` | One full catalog read into the database, outside the server. It prints each league's counts as JSON, the first 50 of its notes, and the time it took. It doesn't load the existing catalog first, so if the F1, UFC or college football step fails here, that league's rows aren't kept (players are replaced), and every UFC photo is checked again. |
| `npm test` | `node --test test/*.test.ts` | Every test. Tests set `HW_DB=':memory:'`, so they never touch the development database. |
| `npm run typecheck` | `tsc --noEmit` | Type check. |

**Server environment variables.** None is needed to run locally; the defaults suit development. Production sets `PORT`, `HW_DB=/data/hatewatch.db` and `HW_CONTACT_EMAIL` in `fly.toml`.

| Variable | Default | What it does (file) |
|---|---|---|
| `PORT` | 8787 | The HTTP and WebSocket port (`index.ts`). |
| `HW_DB` | `data/hatewatch.db` | The SQLite file (`db.ts`). `flag-cli.ts` and `notice-cli.ts` use `/data/hatewatch.db` when it exists, otherwise `data/hatewatch.db`. |
| `HW_DEV` | unset | `1` adds `POST /dev/simulate` (below). It must stay unset in production (`fly.toml`). |
| `EXPO_ACCESS_TOKEN` | unset | Sent as a Bearer token with every push, for Expo's enhanced push security (`push.ts`). |
| `HW_FLAGS_OFF` | unset | A comma-separated list of server switches to keep off, such as `clips.feed` (`flags.ts`, CLAUDE.md). |
| `HW_PUBLIC_URL` | `https://hate-watch-api.fly.dev` | Where share links point (`fanout.ts`). |
| `HW_CONTACT_EMAIL` | `hatewatchfeedback@gmail.com` | The address on `/privacy` and `/support` (`pages.ts`). Set in `fly.toml`'s `[env]` too, the same address. |
| `HW_APP_STORE_URL` | `https://apps.apple.com/app/id6819054268` | The App Store link on share pages (`share.ts`). |
| `HW_IOS_APP_ID` | `G9V9266QK5.com.hatewatch.app` | The app allowed to open share links, served in `/.well-known/apple-app-site-association` (`share.ts`). |
| `HW_LIVE_POLL_MS` | 2000 | How often each live game is read (`live.ts`). |
| `HW_BOOT_BACKFILL_MS` | 300000 | How old a play can be and still be news for a game that was live when the server started (`BOOT_BACKFILL_MS` in `live.ts`; a game followed later uses 90 s). |
| `HW_TEAMS_ONLY_POLL_MS` | 5000 | How often each live college football game is read. |
| `HW_SCOREBOARD_MS` | 10000 | The scoreboard: games going live or final. |
| `HW_TEAMS_ONLY_SCOREBOARD_MS` | 20000 | College football's scoreboard around game time. |
| `HW_STANDINGS_MS` | 60000 | Standings, including F1's (`live.ts`, `f1.ts`). |
| `HW_INJURIES_MS` | 30000 | Injury reports. |
| `HW_YESTERDAY_MS` | 600000 | Yesterday's finals, for the Scores tab. |
| `HW_NEWS_MS` | 180000 | League news: off-field trouble, fines and suspensions. |
| `HW_DECISION_RETRY_MS` | 15000 | MLB: how often to look again for the winning and losing pitchers after a final, up to 20 times. |
| `HW_TOUCH_MS` | 10000 | Soccer: the touch-by-touch feed, read only while someone tracks a player in the match. |
| `HW_PLAYOFF_FINAL_WAIT_MS` | 120000 | How long a playoff final waits for the scoreboard to say whether the season is over. |
| `HW_ABS_SETTLE_MS` | 30000 | How long a lost ABS challenge, and a strikeout on a challenged last pitch (1.5 times this when its result carries the challenge sentence), wait in case ESPN overturns the call. |
| `HW_RULING_WAIT_MS` | 45000 | MLB: how long a result that says "Official Scorer Ruling Pending" waits for the ruling before it is judged without that sentence. |
| `HW_CHALLENGE_SETTLE_MS` | 45000 | MLB: how long a replay challenge's sentence ESPN adds to a posted result must hold, unchanged, before it is believed (three times as long if the game hasn't moved on to the next at-bat). |
| `HW_HALF_END_WAIT_MS` | 20000 | MLB: how long the end of a half-inning waits for a read that has its third out, a final for plays that are behind it (the last out), and a strike three for the result ESPN may still post. |
| `HW_RECAP_MS` | 900000 | How often to check for weekly recaps to send. |
| `HW_F1_SCAN_MS` | 30000 | F1's scoreboard: sessions starting and finishing (`f1.ts`). |
| `HW_F1_STATUS_MS` | 15000 | F1: tracked drivers' race status. |
| `HW_F1_BOARD_MS` | 30000 | F1: every car's timing during a race or sprint. |
| `HW_NOTICE_POLL_MS` | 5000 | How often the server looks for a new developer notice to send to open apps (`notices.ts`). |
| `HW_UPNEXT_REFRESH_MS` | 10800000 | How often Up Next is refreshed (`upnext.ts`). |

**The app** (`app/package.json`):

| Script | What it runs |
|---|---|
| `npm start` / `npx expo start` | The Expo dev server. Press `i` for the iOS simulator, `a` for Android, `w` for the web. |
| `npm run ios` / `npm run android` / `npm run web` | `expo start` with that platform opened. |
| `npm run typecheck` | `tsc --noEmit`, the type check CLAUDE.md asks for before a build or an update (with the lockfile check). |
| `npm run icons` | Rebuilds the icons and splash from `scripts/build-icons.mjs`. |
| `npm run update` | Publishes an over-the-air update **to production** (`EXPO_PUBLIC_API_URL=https://hate-watch-api.fly.dev`, channel `production`). It's not for development; ask before running it (CLAUDE.md). |
| (no script) | `preview` builds (internal, ad hoc) use the `preview` channel, which `npm run update` doesn't reach. To update them, run `EXPO_PUBLIC_API_URL=https://hate-watch-api.fly.dev npx eas-cli@latest update --channel preview --environment preview --message "…"` from `app/`, and ask first. It isn't a `package.json` script on purpose: the scripts are part of the build fingerprint (`runtimeVersion`), so adding one would stop updates reaching every build already out. |

**Trying Hate Watch Plus without a store:** Plus is the store's answer on the device, so the server has no subscriber to set. In a development build with no store (web, Expo Go), `EXPO_PUBLIC_PLUS_DEV=1 npx expo start` makes the device read as subscribed (`devPlus` in `app/src/lib/plus.ts`; release builds ignore it), so Settings shows the gold switches and the Tracking tab's stars work. In a development build Settings also has a "🧪 Hate Watch Plus (dev)" switch (kept on the device, `hw.devPlus`) that does the same without restarting; with `HW_DEV=1` on the server, "🧪 Send a test event" also exercises a favorite team (`docs/favorites.md`).

**Which server the app uses** (`app/src/lib/api.ts`): `EXPO_PUBLIC_API_URL` when it's set. Otherwise a development build (`__DEV__`) uses `http://localhost:8787`, and a release build uses production's `https://hate-watch-api.fly.dev`, never localhost. The `preview` and `production` profiles in `eas.json` set `EXPO_PUBLIC_API_URL` to production too. On a physical phone, `localhost` is the phone itself, so point the app at your computer's address on the network:

```bash
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8787 npx expo start
```

**For Claude Code's preview,** `.claude/launch.json` defines three configurations. `hate-watch-web` runs `npx --prefix app expo start --web --port 8081`, the app on the web at port 8081. `hate-watch-web-export` runs `wrangler dev` on `app/dist` (run `npx expo export --platform web` in `app/` first), the site as Cloudflare serves it (`docs/deploy.md`, "Web → Cloudflare"). `hate-watch-server` runs `npm --prefix server start`, the server on port 8787.

**Push notifications** need a development build on a physical device. The app asks for a push token only on a real phone. On the web it reports "Push is not supported on web", and on a simulator "Push needs a physical device" (`registerForPush` in `app/src/lib/push.ts`). The token is requested with the EAS project id, which this repository already has in `app/app.json` (`extra.eas.projectId`). A fork with its own EAS project sets it with `eas init`. Remote push doesn't work in Expo Go on Android.

```bash
cd app && npx eas-cli@latest init                       # writes extra.eas.projectId into app.json (only for a new EAS project)
npx eas-cli@latest build --profile development --platform all
```

The `development` profile in `eas.json` is a development client (`developmentClient: true`) for internal distribution. Set `EXPO_ACCESS_TOKEN` on the server if you turn on enhanced push security in Expo.

**Dev mode: a test alert.** Starting the server with `HW_DEV=1 npm start` adds `POST /dev/simulate` (`server/src/api.ts`). The route needs a device's token, like the app's own requests. It takes an optional `targetKey` and `type` in the body. Without them, it picks one of the device's follows at random, and an alert type at random that fits it (a player or team alert for that league). It then publishes the alert through the normal path, so it reaches the feed, the WebSocket and push. The alert's title reads `[TEST] <name>: <alert label>`, its body "Simulated event from /dev/simulate", and its id is `sim:<uuid>`. A device that follows nothing gets 400 "follow something first". In the app, Settings shows a "Send a test event (dev)" button in every development build (`__DEV__`). That button calls this route, so against a server started without `HW_DEV=1` it fails with "Simulate failed" (404, "no route").

## Request limits

Nothing in a request is trusted (`server/src/api.ts`, header comment; `server/test/request-hardening.test.ts`). A request that breaks a limit gets its own status, never a 500 and never a silently wrong answer:

| Limit | Answer | Where |
|---|---|---|
| **A body is JSON of at most 64 KB** (`MAX_BODY`, `readBody`; every POST and PUT, an empty body is `{}`). | Not JSON: 400 `bad json`. Over the cap: 413 `body too large`. A `Content-Length` over the cap is refused at once; an upload with none (chunked) is read to its end and dropped, because abandoning the stream would reset the connection before the 413 arrived. | `readBody` |
| **A number in a query** (`intParam`): `/me/feed` `limit` (1 to 200, default 50), `before` (default none) and `after` (default 0), and `/search` `limit` (1 to 100, default 40). | Missing, empty or not a finite number: the default. Out of range: clamped to the nearest end. Decimals are cut. `limit=abc` and `before=abc` on the feed are the same list as no value; `/search?limit=-1` no longer drops the last result. `/leaderboard` has always clamped its own `limit` (`leaderboard()`, top 100). | `intParam` |
| **A push token is a string, or null / absent for none** (`PUT /me/push-token` and `POST /devices`). | Anything else (an object, a number): 400 `pushToken is a string or null`. | `pushTokenOf` |
| **A device registers with `platform` ios, android or web** (`PLATFORMS`: what `Platform.OS` is in the app's `ensureToken`). | Missing or anything else: 400, checked before the cap, so a bad request costs nothing. | `POST /devices` |
| **30 new devices an hour per address** (`DEVICES_PER_HOUR`). A device costs a feed row on every developer notice (`notices.ts`), so a script registering thousands would bloat the database. | The 31st: 429 `too many new devices from this address, try again later`, until the hour (a fixed window from the address's first device) ends. | `overDeviceCap` |
| **A share link's host is one of ours** (`origin`; `docs/sharing.md`). | Any other `Host` header: `HW_PUBLIC_URL`. | `origin` |

**The address** (`clientIp`) is Fly's `fly-client-ip` header ("the IP address of the client from the perspective of Fly Proxy", docs.fly.io/networking/request-headers). Fly's docs don't say whether the proxy replaces a `fly-client-ip` a caller sends, and this was not tested, so the cap stops a careless script, not a determined one. Without the header (development) it is the first address of `x-forwarded-for`, which is whatever the caller sent, then the socket's.

**What the cap doesn't do:** it lives in the server's memory (`newDevices`, a Map that drops expired windows as it goes), so a restart clears it, and it counts one machine, which is what production is (`docs/known-limits.md`). Addresses behind one network (a school, a mobile carrier's shared address) share a count; 30 an hour is far above what real installs do. Raising it is the one number `DEVICES_PER_HOUR`.
