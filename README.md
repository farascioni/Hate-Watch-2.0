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
| `com.hatewatch.app.tip.small` | $1.99 |
| `com.hatewatch.app.tip.medium` | $4.99 |
| `com.hatewatch.app.tip.large` | $9.99 |

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

Teams and rosters come from the ESPN endpoints documented in [pseudo-r/Public-ESPN-API](https://github.com/pseudo-r/Public-ESPN-API): `site.api.espn.com/.../teams` and `/teams/{id}/roster`. They cover the **NBA, MLB, NFL and NHL**. The NHL is included because several of the requested alerts are hockey alerts.

Last ingest (2026-10-03): **124 teams, 5,033 players**.

| | Teams | Players | Verified headshots | Logo fallback |
|---|---|---|---|---|
| NBA | 30 | 603 | 546 | 57 |
| MLB | 30 | 1,067 | 1,024 | 43 |
| NFL | 32 | 2,544 | 2,541 | 3 |
| NHL | 32 | 819 | 785 | 34 |

- **No duplicates.** Players are deduped on ESPN athlete ID, with a second pass on normalized name + birth date. Teams are deduped on ID and abbreviation. The ingest throws rather than commit a duplicate key, and the database primary keys enforce it again.
- **Every team and player has an image.** The ingest won't commit a row without one.
- **Images are accurate.** Each headshot URL must be keyed by that athlete's own ESPN ID, and ESPN's alt text must match the player's name (0 mismatches). Every image is fetched (PNG header via HTTP Range) to confirm it exists and to record its true pixel size.
- **No wrong faces.** ESPN has no photo for 137 players (practice squad, call-ups; every one re-checked as a real 404). They show their **team logo plus a jersey-number badge**.
- **Images are scaled properly.** The app asks ESPN's image combiner for exactly the pixels it draws (points × screen density) at the image's native aspect ratio. That matters because sizes vary: 4,894 headshots are 600×436, 2 are square, and one logo is 4096×4096. Headshots use cover + top anchoring so faces aren't cropped. Logos use contain, with ESPN's dark-mode variant when it exists.
- Rosters refresh every 6 hours. If a refresh fails, the previous catalog stays.

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

## Notifications (39 types, all user-controllable)

| | |
|---|---|
| MLB | strikeout, grounded into DP, any out (off by default), pitcher gives up runs, gives up a HR, walk/HBP (off by default), fielding error, caught stealing or picked off (one toggle; see note) |
| NFL | interception (incl. pick-six), sacked, incompletion (off by default), fumble lost, any fumble (off by default), missed FG/XP or blocked kick, penalty, delay of game (QB), gives up a safety (see note) |
| NFL delay of game / safety | **Delay of game** is charged to the team ("PENALTY on PIT, Delay of Game", with no player), so it goes to the offense's quarterback in the game: the latest passer the roster lists as a QB. It's skipped for punt and field-goal formations, declined flags, and flags on the defense. Play text uses NFL team codes (ARZ, BLT, CLV, HST, LA, WAS), which are mapped to ESPN's. **Safety** alerts both the team ("49ers gave up a safety", replacing "opponent scored") and the player responsible: the flagged player on a penalty safety, the sacked QB, or the ball carrier. These replace that player's generic penalty or sack alert. Overturned safeties ("SAFETY NULLIFIED") are ignored. |
| NBA | missed shot, missed FT, got blocked, turnover, foul (off by default), technical/ejection |
| NHL | goalie allows a goal, shot missed, shot blocked (off by default), shot saved (off by default), giveaway (off by default), penalty |
| Any player | injured / injury status downgraded |
| Teams | lost, opponent scored, fell behind, dropped in standings, losing streak ≥3, eliminated from playoffs, a player injured |
| Scored on + fell behind | A team can only fall behind because the opponent just scored, so these two always coincide. The fell-behind alert carries both ("Bears scored 7 to take the lead over the Eagles", or "…gave up a safety and fell behind…"), and that play's scored-on alert is `unless: team.fell_behind`. Each user gets one: the combined alert if "Falls behind" is on, otherwise the plain scored-on alert. |
| MLB caught stealing / picked off | "caught stealing second" means the runner came from first; "picked off first" means the runner was on first; "picked off and caught stealing second" means the runner came from first. ESPN lists only the pitcher on these plays. The runner is whoever was on that base, from the tracked base state, cross-checked against the last name in the play text. ESPN reports each one twice; both copies share one notification ID. |
| MLB NOBLETIGER | **N**o **O**uts, **B**ases **L**oaded, **E**nding with **T**eam **I**ncapable of **G**etting **E**asy **R**un: the bases get loaded with nobody out, and no run scores from that point to the end of the half-inning. A run scored on the play that loaded the bases doesn't count. Uses the outs and bases ESPN records after each at-bat result. **No duplicates:** that inning's stranded-runners alert is marked `unless: mlb.team.nobletiger`, so each user gets the NOBLETIGER if it's on, otherwise the stranded alert if that's on, never both (`shouldDeliver` in `fanout.ts`). Find real ones with `node test/find-nobletiger.ts [maxGames]`. |
| MLB teams | strands runners in scoring position: the half-inning ends with a runner on 2nd and/or 3rd ("left the bases loaded" when full). Uses the base state ESPN records after the inning's final out, including the game's last half-inning. |

Settings let users control:

- push on/off
- sound
- quiet hours in their own timezone (alerts still reach the feed)
- each league on/off
- every alert type, with "all on/off" per group
- per-target 🔕 on the Tracking tab: turns off push for that player or team, while their alerts still land in the feed
- reset to defaults
- clear feed

A homer counts as "gives up runs" too, so turning off "gives up a HR" alone won't hide the runs.

## Tests

```bash
cd server
npm test                      # prefs, quiet hours, aliases, scoring, standings parsing
node test/replay.ts           # replays real finished games; asserts tracked score == final score
node test/core-vs-site.ts     # both ESPN sources produce identical detections
HW_DEV=1 npm start & node test/smoke.ts   # end-to-end: search, follow, ws delivery, prefs, mute, unfollow, auth
```

## Known limits

- ESPN's API is undocumented and unofficial. Field names can change; the replay tests are the canary.
- Goalie-on-ice for NHL goals is inferred from the last save each goalie made. Empty-net goals are skipped.
- MLB "gives up runs" credits the pitcher on the mound, not official earned-run or inherited-runner accounting.
- Standings and injury alerts fire on change. The first snapshot after a fresh install is a silent baseline.
