# Hate Watch 😈

Track the athletes and teams you can't stand. Get a push the moment something bad happens to them.

- **`app/`**: iOS + Android app (Expo SDK 57, React Native, Expo Router). Also runs on web for development.
- **`server/`**: Node backend. It ingests rosters from ESPN, watches live games, detects negative plays, and fans them out to the feed, a WebSocket, and push notifications (APNs/FCM via Expo Push).

```
ESPN (core plays + site summary, polled in parallel every 2s per live game)
   │
   ▼
GameTracker ─► league detectors ─► publish() ─┬─► events table (deduped by deterministic id)
scoreboard (10s) / standings (60s) /           ├─► per-follower prefs filter (type, league); push also skips muted + quiet hours
injuries (30s)                                 ├─► feed rows ─► WebSocket frame to open apps (≈ms)
                                               └─► Expo Push ─► APNs / FCM (app closed)
```

## Run it

```bash
cd server && npm install && npm start          # ingests ~5,000 players on first boot (~30s), serves :8787
cd app && npm install && npx expo start        # press i / a, or w for web
```

On a physical phone, point the app at your machine: `EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8787 npx expo start`.

**Push notifications** need an EAS project and a development build. Remote push doesn't work in Expo Go on Android.

```bash
cd app && npx eas-cli@latest init                       # writes extra.eas.projectId into app.json
npx eas-cli@latest build --profile development --platform all
```

Set `EXPO_ACCESS_TOKEN` on the server if you enable enhanced push security in Expo.

Dev mode (`HW_DEV=1 npm start`) adds `POST /dev/simulate` and a "Send a test event" button in Settings.

## Deploy

### Server → Fly.io

You need a [Fly.io](https://fly.io) account with a card on file, and `flyctl` installed (`pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"` on Windows). From `server/`:

```bash
fly auth login
fly launch --copy-config --no-deploy        # creates the app from fly.toml; rename it if "hate-watch-api" is taken
fly volumes create hatewatch_data --region iad --size 1 --count 1
fly secrets set EXPO_ACCESS_TOKEN=...       # optional: only if Expo push security is enabled
fly deploy --ha=false
curl https://hate-watch-api.fly.dev/health  # → {"ok":true,"catalog":{"teams":124,"players":5033},...}
```

Why it's configured the way it is (`fly.toml`):

- **Exactly one machine, never auto-stopped.** The live poller and all WebSockets live in one process.
- **SQLite on a 1 GB volume** at `/data`.
- **A 120 s health-check grace period** for the first-boot roster ingest (measured locally at 16 s).
- **`HW_DEV` unset**, so `/dev/simulate` returns 404.
- **Clean shutdown on deploy.** The server stops on SIGTERM and closes the database cleanly.

Cost is roughly a few US dollars a month for one shared-cpu-1x machine with 512 MB plus a 1 GB volume. Check Fly's current pricing.

### iOS / Android → EAS

`app/eas.json` has three profiles:

| Profile | For | API |
|---|---|---|
| `development` | dev client on your phone | `EXPO_PUBLIC_API_URL` from your shell (e.g. your LAN IP) |
| `preview` | internal / TestFlight-style testing | `https://hate-watch-api.fly.dev` |
| `production` | App Store / Play Store; build number auto-increments | `https://hate-watch-api.fly.dev` |

If you renamed the Fly app, update the URL in both `preview` and `production`. The URL is compiled into the app at build time. From `app/`:

```bash
npx eas-cli@latest login
npx eas-cli@latest init                                         # sets extra.eas.projectId in app.json
npx eas-cli@latest build --platform ios --profile production    # Apple ID login; EAS creates certs + push key
npx eas-cli@latest submit --platform ios --latest               # uploads to App Store Connect / TestFlight
```

### App Store Connect answers

| Field | Value |
|---|---|
| Privacy Policy URL | https://hate-watch-api.fly.dev/privacy |
| Support URL | https://hate-watch-api.fly.dev/support |
| Data collection | **Yes** |
| Identifiers → Device ID | App Functionality · linked to the user · not used for tracking |
| Usage Data → Product Interaction (tracked teams/players, alert settings) | App Functionality · linked to the user · not used for tracking |
| Tracking | **No** |
| Account deletion | In-app: Settings → Delete all my data (`DELETE /me`) |

The contact email on those pages comes from `HW_CONTACT_EMAIL` in `server/fly.toml`. Double-check these answers against the current App Store Connect questionnaire. The answers are your responsibility as the publisher.

### Donations (in-app tips)

Settings → **Support Hate Watch** has a Donate button that offers three tip sizes. Tips are **consumable in-app purchases** via [`expo-iap`](https://openiap.dev/docs/setup/expo). Apple allows "tipping the developer" through in-app purchase in every country (guideline 3.1.1); external payment links would only be allowed on the US App Store. Tips unlock nothing, and our server never sees the payment.

The product IDs are defined in `app/src/lib/tips.ts`:

| Product ID | Suggested price |
|---|---|
| `com.hatewatch.app.tip.coffee` | $1.99 |
| `com.hatewatch.app.tip.pizza` | $4.99 |
| `com.hatewatch.app.tip.trophy` | $9.99 |

(`tip.small`, `tip.medium` and `tip.large` are burned: they were created as Non-Consumable, and App Store Connect can't change a product's type or reuse a product ID.)

**Before tips work:**

1. **App Store Connect:** accept the **Paid Apps Agreement** and fill in tax and banking (Business → Agreements). Apple requires this even for free apps that sell in-app purchases.
2. **App Store Connect → your app → In-App Purchases:** create three products of type **Consumable** with exactly the IDs above. Each needs a display name, a price, and a review screenshot (a screenshot of Settings is fine).
3. **Your first in-app purchases must be submitted for review together with an app version.** On the version page, under "In-App Purchases and Subscriptions", add all three before submitting.
4. **Google Play Console:** set up a payments profile, upload a build (the billing permission is added automatically), then create the same three IDs under **Monetize → Products → In-app products** and activate them.
5. **Test with sandbox accounts.** On iOS, add a Sandbox tester in App Store Connect and buy through TestFlight. On Android, add a license tester.

The Donate button needs a development or store build. In Expo Go and on web there's no store to pay through, so the button explains that instead. Apple and Google keep 15% under their small-business programs. Privacy label: purchases aren't collected by us, because Apple and Google handle them.

### Icons and splash

The artwork is an angry eye. Every icon is generated from vector source in [`app/scripts/build-icons.mjs`](app/scripts/build-icons.mjs):

- the iOS 1024 px icon (opaque, as Apple requires)
- the Android adaptive foreground, background and monochrome layers
- the Android notification icon
- the splash image
- the web favicon

After editing the script, regenerate with `cd app && npm run icons`.

## Data: rosters, duplicates, and images

Teams and rosters come from the ESPN endpoints documented in [pseudo-r/Public-ESPN-API](https://github.com/pseudo-r/Public-ESPN-API): `site.api.espn.com/.../teams` and `/teams/{id}/roster`. They cover the **NBA, MLB, NFL, NHL and Formula 1**. The NHL is included because several of the requested alerts are hockey alerts.

Last ingest (2026-10-04): **135 teams, 5,074 players**.

| | Teams | Players | Verified headshots | Logo fallback |
|---|---|---|---|---|
| NBA | 30 | 605 | 546 | 59 |
| MLB | 30 | 1,080 | 1,037 | 43 |
| NFL | 32 | 2,544 | 2,541 | 3 |
| NHL | 32 | 822 | 789 | 33 |
| F1 | 11 constructors | 23 drivers | 15 | 8 (team badge) |

- **No duplicates.** Players are deduped on ESPN athlete ID, with a second pass on normalized name + birth date. Teams are deduped on ID and abbreviation. The ingest throws rather than commit a duplicate key, and the database primary keys enforce it again.
- **Every team and player has an image.** The ingest won't commit a row without one.
- **Images are accurate.** Each headshot URL must be keyed by that athlete's own ESPN ID, and ESPN's alt text must match the player's name (0 mismatches). Every image is fetched (PNG header via HTTP Range) to confirm it exists and to record its true pixel size.
- **No wrong faces.** ESPN has no photo for 137 players (practice squad, call-ups; every one re-checked as a real 404). They show their **team logo plus a jersey-number badge**.
- **Images are scaled properly.** The app asks ESPN's image combiner for exactly the pixels it draws (points × screen density) at the image's native aspect ratio. That matters because sizes vary: 4,894 headshots are 600×436, 2 are square, and one logo is 4096×4096. Headshots use cover + top anchoring so faces aren't cropped. Logos use contain, with ESPN's dark-mode variant when it exists.
- Rosters refresh every 6 hours. If a refresh fails, the previous catalog stays. On boot, the server also imports if any league is missing from its catalog (that's how F1 arrived on the existing server).

**Formula 1 is different** (ESPN sport `racing`, league `f1`):

- **Drivers** are the ones who actually raced this season: the championship standings plus this weekend's entry list. The season's athlete list also includes reserves.
- **Team and car number** come from this weekend's entry list. ESPN's athlete records can be stale after a team move: Lindblad's record says "Red Bull #36", but he races the Racing Bulls #41. The record is only the fallback, for a driver who isn't entered (e.g. Tsunoda, replaced mid-season).
- **Constructors have no logos on ESPN** (404, `logos: null`). Rather than use trademarked logos from elsewhere, the app draws a badge in the team's official ESPN colour with a code (FER, MCL, RBR…), with black or white text for contrast. Drivers without an ESPN headshot (8, all re-checked as 404) get that badge plus their car number.

Audit it yourself: `cd server && node test/verify-catalog.ts`.

## Real-time: how fast is it?

| Stage | Latency |
|---|---|
| ESPN publishes the play (measured live, MLB) | **~80–105s after it happens** (upstream; not ours) |
| Our poll interval | ≤2s (`HW_LIVE_POLL_MS`) |
| Detection + fan-out + WebSocket | <10 ms (WebSocket delivery measured at 1 ms locally) |
| Push via Expo → APNs/FCM | typically 1–3s |

Ways the delay is kept down:

- **Two sources per game.** Each live game polls ESPN's *core* plays endpoint and the *site* summary in parallel and merges by play ID (identical across both). Measured live, core publishes plays **~18s sooner** than the summary. The detectors give identical results on both sources (`test/core-vs-site.ts`).
- **The CDN cache is bypassed.** ESPN's CDN caches these endpoints for up to 10s. Live polls add a unique query parameter, and measured live, that surfaced every new play **4–10s sooner (avg 6.7s)**.
- **Polls don't wait on each other.** Polls start every 2s, never overlap, and have a 4s timeout.
- **Following starts tracking immediately.** Following a team or player mid-game rescans scoreboards immediately, so tracking starts within ~1s.
- **No duplicates or stale floods.** Each event has a deterministic ID (`game:play:type:athlete`), so re-polls, restarts and overlapping sources never double-notify. Plays from before the server attached to a game aren't announced.
- **Feed order is by when it happened.** The feed is ordered by ESPN's wallclock time for the play, not by arrival time.

**The remaining floor is ESPN's own delay.** To go faster you need a lower-latency feed per league: MLB StatsAPI (`statsapi.mlb.com/api/v1.1/game/{pk}/feed/live`), NHL (`api-web.nhle.com`), NBA (`cdn.nba.com/static/json/liveData`), or a paid provider such as Sportradar. Any of these can feed the same detector interface (`NPlay`); you'd map ESPN athlete IDs to league IDs by name + team.

## Notifications (50 types, all user-controllable)

| | |
|---|---|
| MLB | strikeout, grounded into DP, any out (off by default), pitcher gives up runs, gives up a HR, walk/HBP (off by default), fielding error, caught stealing or picked off (one toggle; see note) |
| NFL | interception (incl. pick-six), sacked, incompletion (off by default), fumble lost, any fumble (off by default), missed FG/XP or blocked kick, penalty, delay of game (QB), gives up a safety (see note), opponent recovers an onside kick (team; see note) |
| NFL delay of game / safety | **Delay of game** is charged to the team ("PENALTY on PIT, Delay of Game", with no player), so it goes to the offense's quarterback in the game: the latest passer the roster lists as a QB. It's skipped for punt and field-goal formations, declined flags, and flags on the defense. Play text uses NFL team codes (ARZ, BLT, CLV, HST, LA, WAS), which are mapped to ESPN's. **Safety** alerts both the team ("49ers gave up a safety", replacing "opponent scored") and the player responsible: the flagged player on a penalty safety, the sacked QB, or the ball carrier. These replace that player's generic penalty or sack alert. Overturned safeties ("SAFETY NULLIFIED") are ignored. |
| NFL onside kick | Sent to the **receiving** team when the other side kicks onside and keeps the ball: "Titans recovered an onside kick against the Ravens", with the play. ESPN writes these kickoffs as "J.Slye kicks onside 9 yards from TEN 35 to TEN 44. …"; the kick starts with the kicking team (`start.team`), and it's a success when the kicking team still has the ball at the end (`end.team`, on every kickoff in the core feed). If ESPN ever leaves the end team out, the last "RECOVERED by TEN-…" in the text decides (NFL codes like BLT map to ESPN's BAL). Kicks wiped out by a penalty ("- No Play", "NULLIFIED") don't count. Checked against the four real onside attempts in 2026 weeks 3–4 (all recovered by the receivers, so no alerts). |
| NBA | missed shot, missed FT, got blocked, turnover, foul (off by default), technical/ejection |
| NHL | goalie allows a goal, shot missed, shot blocked (off by default), shot saved (off by default), giveaway (off by default), penalty |
| F1 drivers | doesn't finish (retired / DSQ / DNS, **live**), outside the points, lost 3+ places from the grid, behind teammate, knocked out in Q1/Q2, drops in the drivers' championship |
| F1 constructors | double DNF (**live**), no points, drops in the constructors' championship (the shared "Drops in standings" toggle) |
| F1 how | There's no play-by-play: a race weekend is one ESPN event whose sessions (FP1…Qualifying…Race) are competitions. While a race or sprint runs, the server polls the status of **only the followed drivers** every 15s (including both cars of a followed constructor), so DNFs and double DNFs arrive live. When a session completes, it reads the classification once. Each driver gets **one** alert per session with the facts merged ("Pierre Gasly finished P16 from P9 on the grid: no points, behind teammate Franco Colapinto (P13)"), counting for each matching toggle. Qualifying knockouts use classification position: the top 10 reach Q3, and the rest split evenly between Q2 and Q1 (22 cars: P11–16 / P17–22). Results are only announced for sessions that started in the last 8 hours, so a deploy never re-announces an old race. |
| Any player | injured / injury status downgraded |
| Teams | game starts, lost, opponent scored, fell behind, dropped in standings, losing streak ≥3, eliminated from playoffs, a player injured |
| Game starts | "Hate Watch Starting: Eagles vs Bears", each team from its own side, with "Kickoff at Lincoln Financial Field · FOX" (Tip-off / Puck drop / First pitch). Sent once, when the game's tracker sees ESPN flip it from pre-game to live (polled every 2s). It only fires for a game seen *before* it started: a game that's already under way when someone follows the team, or when the server restarts, never gets a late "starting" alert. F1 constructors get "Hate Watch Starting: Ferrari" when a race or sprint starts (detected by the 30s scoreboard scan). |
| Successful Hate Watch | A loss reads "Successful Hate Watch! Eagles lost to the Bears" with "Final Score: 24 to 17" (winner's score first). Ties send nothing. In F1 the equivalent is the constructor scoring no points: "Successful Hate Watch! Ferrari finished outside the points" with the session and both cars' results ("Singapore GP · Race: P12, DNF"). A double DNF keeps its own live alert, which also counts for this toggle. |
| Scored on + fell behind | A team can only fall behind because the opponent just scored, so these two always coincide. The fell-behind alert carries both ("Bears scored 7 to take the lead over the Eagles", or "…gave up a safety and fell behind…"), and that play's scored-on alert is `unless: team.fell_behind`. Each user gets one: the combined alert if "Falls behind" is on, otherwise the plain scored-on alert. |
| MLB caught stealing / picked off | "caught stealing second" means the runner came from first; "picked off first" means the runner was on first; "picked off and caught stealing second" means the runner came from first. ESPN lists only the pitcher on these plays. The runner is whoever was on that base, from the tracked base state, cross-checked against the last name in the play text. ESPN reports each one twice; both copies share one notification ID. |
| MLB NOBLETIGER | **N**o **O**uts, **B**ases **L**oaded, **E**nding with **T**eam **I**ncapable of **G**etting **E**asy **R**un: the bases get loaded with nobody out, and no run scores from that point to the end of the half-inning. A run scored on the play that loaded the bases doesn't count. Uses the outs and bases ESPN records after each at-bat result. **No duplicates:** that inning's stranded-runners alert is marked `unless: mlb.team.nobletiger`, so each user gets the NOBLETIGER if it's on, otherwise the stranded alert if that's on, never both (`shouldDeliver` in `fanout.ts`). Find real ones with `node test/find-nobletiger.ts [maxGames]`. |
| MLB teams | strands runners in scoring position: the half-inning ends with a runner on 2nd and/or 3rd ("left the bases loaded" when full). Uses the base state ESPN records after the inning's final out, including the game's last half-inning. |
| MLB opponent in scoring position | Sent to the **fielding** team the moment the other team gets a runner to 2nd or 3rd: "Braves have runners on first and second against the Dodgers", with the play ("Top 4th: Baldwin walked, Murphy to second."). Once per half-inning (the first time), about 4 per tracked team per game in real games. Bases come from the snapshot on every pitch and at-bat result, plus runner plays between pitches ("stole second", "to third on wild pitch"); caught-stealing and pickoff text is ignored. A threat already on base when tracking starts never fires late. If a run scores on the same play it's `unless: team.opponent_scored`, so users get the scored-on alert instead of both. |

Settings let users control:

- push on/off
- sound
- quiet hours in their own timezone (alerts still reach the feed)
- each league on/off
- every alert type, with "all on/off" per group
- **a 🔔 on every alert type: notify me, or feed only.** Off keeps that alert in the feed without a push ("Feed only: no notification" under it). The switch still decides whether the alert arrives at all; the bell is greyed out while the switch is off. Stored as `pushTypes` (typeId → false) in prefs; missing means push, so existing users and older app builds behave exactly as before. The same bell is on every row of a player or team's ⚙️ screen, stored as `targetPushTypes` (targetKey → typeId → push), and it beats the Settings bell for that target. "Custom for …", "Use global setting" and "Reset all" cover it too, and the Tracking tab's gear turns red for it.
- **How a push is decided** (`publish()` in `fanout.ts`): the alert must be delivered (`shouldDeliver`), then `pushAllowed` (master push switch, the target's 🔕, quiet hours) and `pushWanted` (the alert type's bell) must both say yes. An alert that counts for several types follows the most specific one the user has switched on: with "Gives up a home run" feed-only and "Gives up runs" pushed, a homer arrives quietly; with home runs switched off entirely, it arrives as a run and pushes.
- per-target 🔕 on the Tracking tab: turns off push for that player or team, while their alerts still land in the feed
- **per-target ⚙️ on the Tracking tab: choose exactly which alerts you get for one player or team.** These choices beat every global alert setting for that target, including the type and league switches. For example, interceptions stay on globally but are off for Daniel Jones alone, or a league is off globally but one player's alert is explicitly on. Each switch shows "Custom for …" with "Use global setting", and there's "Reset all". The gear turns red when a target has custom choices. The screen lists only the alerts that can fire for that kind of target in that league. Stored as `targetTypes` (targetKey → typeId → on/off) in prefs; a `null` in a PUT resets one back to global. The "one alert, not two" rules (NOBLETIGER vs stranded, lead changes) use the same per-target answer.
- reset to defaults
- clear feed

A homer counts as "gives up runs" too, so turning off "gives up a HR" alone won't hide the runs.

## Scores tab

The second tab lists today's games for the teams you track and the teams of players you track. Live games come first, then later today, then finals from the last 16 hours. Each card shows the score, clock or inning, the NFL down and distance, MLB bases and outs, and a status pill from the hater's side:

- **"Down 7" (red):** good news.
- **"Threatening" (amber):** the team you hate is in a spot to score (NFL red zone, or a runner in scoring position while they bat).
- **"Up 3" / "Tied" (grey).**
- **"Successful Hate Watch!" (finals).**

Where ESPN publishes win probability (NFL, MLB), a bar shows the chance they lose. The newest alert from the game sits underneath. F1 race, sprint and qualifying sessions show your drivers' (or your constructor's cars') running order. Tapping a card opens `app/src/app/game/[key].tsx`: the live card, your alerts from that game, and the latest 25 plays (MLB at-bat results only; F1, the full running order).

- **Where the data comes from** (`server/src/scores.ts`): the live engine already reads every league's ESPN scoreboard every 10s, and F1's every 30s. Each read upserts a card per game (`gameCard` / `raceCard`). The 2s game tracker patches in scores from the play-by-play, which runs ahead of the scoreboard, and win probability from the summary (`patchGame`). While a game is live, each side's score only goes up, so a stale scoreboard read can't undo a run the feed already announced. The final read is exact.
- **Live:** any change is pushed as `{ kind: 'score', game }` over the existing WebSocket, only to connected devices that track a side (`deviceTeams`: teams plus followed players' teams, cached 5s and reset on follow/unfollow). The first sighting of a game (e.g. after a restart) is a baseline, not a push.
- **API:** `GET /me/scores` lists the device's games. `GET /me/games/<league:id>` adds the device's alerts from that game (`events.game_id`; F1 alerts now store their session id there) and the play-by-play from ESPN's summary, cached 8s while live and 5 min after. Feed items carry `gameId`, so the app links alerts to their game.
- Checked live against CHW @ CLE on 2026-10-05: the card, the losing chance (Guardians 25% to lose), a pushed update at the top of the 6th, and the game screen's play-by-play.

## Startup guide

On a device's first launch the app opens a seven-page guide over the Feed (`app/src/app/guide.tsx`, a full-screen modal): welcome, tracking from Search, the Feed and sharing, the Scores tab, global alert settings, and the per-target 🔔 and ⚙️ on the Tracking tab, then "You're all set". Swipe or tap Next. Skip (top right) ends it from any page. The last page's "Find someone to hate" goes to Search. The pictures are drawings of the real controls, so nothing in the guide changes settings.

- **Once per install:** `hatewatch.guideSeen` in AsyncStorage, set as soon as the guide opens (`app/src/lib/guide.ts`). Deleting the app shows it again.
- **Rewatch:** Settings → About → Show the guide opens it without the first-run extras. The last button says Done and returns to Settings.
- **Notification permission waits for it:** the store awaits `guideSettled` before `registerForPush()`, so on first launch the system prompt comes right after the guide instead of covering it. The last page warns that the prompt is coming.
- Each page scrolls vertically if it doesn't fit (small phones, large text sizes). It's checked on iPhone SE (375×667) and 390×844.

## Sharing an alert

The share button on a feed alert sends a link, `https://hate-watch-api.fly.dev/a/<code>`, not text. In Messages, WhatsApp, Discord, X and Slack the link previews as a picture of the alert, so it looks like a screenshot. Tapping it on an iPhone opens Hate Watch on that alert if it's installed, and the App Store if not.

- **Opening the app (iOS universal links):** the app lists `applinks:hate-watch-api.fly.dev` in `ios.associatedDomains`, and the server's `/.well-known/apple-app-site-association` says app `G9V9266QK5.com.hatewatch.app` (`HW_IOS_APP_ID`) opens `/a/*`. With the app installed, iOS opens it without asking the server. Expo Router drops the domain and routes the path to `app/src/app/a/[code].tsx`, which fetches `GET /shared/<code>` and shows the alert plus a Track button. The root layout's `unstable_settings.anchor = '(tabs)'` puts the tabs underneath, so Back works even on a cold start from a link. iOS reads the association file (through Apple's CDN) when the app is installed or updated. If someone long-presses a link and picks "Open in Safari", iOS remembers that for the domain until they pick "Open in Hate Watch". Android App Links aren't set up yet; they need `assetlinks.json` with the Play signing key fingerprint.

- **The code** is the first 11 characters of a SHA-256 of the alert's id (`shareCode()` in `db.ts`), stored in `events.share_code` and indexed. Alerts from before share links got theirs when the server started. Every feed item carries `shareUrl`.
- **`GET /a/<code>`** (`share.ts`): an iPhone, iPad or iPod gets a 302 to the App Store. Everyone else, including link-preview fetchers (Messages sends `facebookexternalhit … Twitterbot`, which never gets the redirect), gets a page with Open Graph and Twitter card tags, Apple's Smart App Banner, the card and a download button. Unknown codes get a 404 page, or the App Store on an iPhone.
- **`GET /a/<code>/card.png`**: the 1200×630 card, drawn on the server from our own alert data with `satori` (layout to SVG) and `@resvg/resvg-js` (SVG to PNG), in Inter from `@fontsource/inter`, with emoji as Twemoji images from jsDelivr. No user uploads, so no user-generated content to moderate. The card shows team colours and initials, not ESPN logos or headshots. Cached in memory and for a day by HTTP, since alerts never change.
- **The app** (`app/src/lib/share.ts`) shares just the URL on iOS, so Messages shows one bubble, the card. On Android the link goes at the end of the text.
- `HW_APP_STORE_URL` overrides the store link (default `https://apps.apple.com/app/id6819054268`) and `HW_PUBLIC_URL` the link's host. The App Store link only works once the app is released.

## Tests

```bash
cd server
npm test                      # prefs, quiet hours, aliases, scoring, standings, F1 results, a simulated F1 race, game starts, share links
node test/replay.ts           # replays real finished games; asserts tracked score == final score
node test/core-vs-site.ts     # both ESPN sources produce identical detections
HW_DEV=1 npm start & node test/smoke.ts   # end-to-end: search, follow, ws delivery, prefs, mute, unfollow, auth
node test/f1-replay.ts        # F1 alert logic on the real, current race weekend vs ESPN's classification
```

## Known limits

- ESPN's API is undocumented and unofficial. Field names can change; the replay tests are the canary.
- Goalie-on-ice for NHL goals is inferred from the last save each goalie made. Empty-net goals are skipped.
- MLB "gives up runs" credits the pitcher on the mound, not official earned-run or inherited-runner accounting.
- Standings and injury alerts fire on change. The first snapshot after a fresh install is a silent baseline.
- F1's live path (in-race DNFs and double DNFs) is tested with a simulated race through the real engine (`test/f1-live.test.ts`). Its first run against a real live race is the next race weekend after this was added.
- F1 sprint qualifying sessions don't generate alerts (only Qualifying, Sprint and Race do). F1 has no injury report on ESPN.
