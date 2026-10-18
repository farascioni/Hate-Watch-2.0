# Deploy

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** Hate Watch reaches people in three ways. Each has its own command, and none of them needs the other machine. **The server** (`server/`) runs on Fly.io as the app `hate-watch-api`: one machine, with SQLite on a volume. A server deploy reaches every installed build within seconds. **The app** (`app/`) is built in the cloud by EAS (Expo Application Services) and sent to TestFlight and the App Store, and later Google Play. **Over-the-air updates** (EAS Update) send JavaScript and asset changes to builds after build 12 without a new build. The day-to-day release rules (ask first, the exact commands, backups, server switches, developer notices, patch notes) are in `CLAUDE.md` under "Release flow". This section covers first-time setup and how each piece is configured.

**Sections:**
- **Deploy**: Hate Watch reaches people in three ways.
  - **Server → Fly.io**: the server is one Docker image (`server/Dockerfile`, Node 24 running the TypeScript directly) on one always-on Fly.io machine named `hate-watch-api` in `iad` (US East).
  - **iOS / Android → EAS**: EAS builds the app in the cloud from `app/`, using one of three profiles in `app/eas.json`: `development`, `preview` and `production`.
  - **App Store Connect answers**: these are the answers given in App Store Connect's privacy and app information forms.
  - **Hate Watch Plus (the $5/month subscription)**: Settings → **Support Hate Watch** has a $5/month auto-renewing subscription through [`expo-iap`](https://openiap.dev/docs/setup/expo) (`app/src/lib/plus.ts`, `app/src/components/PlusStore.tsx`, `Plus.tsx`); a subscriber can switch the red accents and the app icon to gold, star their most hated players and teams, and favorite teams (`docs/favorites.md`).
  - **Icons and splash**: The artwork is an angry eye: a red iris with a black pupil and a white glint in a white eye, under a tapered red brow that bears down toward it, on a near-black background with a dark red glow.
  - **App Store page images**: the custom Header (21:9) and Search Results (3:2) images and every screenshot set are made from the app's real screens by `app-store/capture-screens.mjs` then `app-store/build-store-images.mjs`; the screenshots are in `app-store/screenshots*/`, one folder per size.

The README's "Deploy" has the summary; this is the full detail. Read this index first, then only the part you need.

## Deploy

**In short:** Hate Watch reaches people in three ways. Each has its own command, and none of them needs the other machine. **The server** (`server/`) runs on Fly.io as the app `hate-watch-api`: one machine, with SQLite on a volume. A server deploy reaches every installed build within seconds. **The app** (`app/`) is built in the cloud by EAS (Expo Application Services) and sent to TestFlight and the App Store, and later Google Play. **Over-the-air updates** (EAS Update) send JavaScript and asset changes to builds after build 12 without a new build. The day-to-day release rules (ask first, the exact commands, backups, server switches, developer notices, patch notes) are in `CLAUDE.md` under "Release flow". This section covers first-time setup and how each piece is configured.

**Google Play (Android):** step-by-step guide in [docs/android-release.md](android-release.md), written for releasing without owning an Android phone.

**Which one a change needs:**

| The change | How it goes out | Who gets it |
|---|---|---|
| Anything in `server/` (alerts, wording the server writes, how each league is shown) | `fly deploy --remote-only` from `server/` | Every install, every build, within seconds |
| Turning off ESPN's clips or images | A server switch (`server/src/flag-cli.ts`), no deploy | Every install, within seconds; a clip already in a feed goes at its next feed load |
| A message to everyone | A developer notice (`server/src/notice-cli.ts`) | Every install's feed, never pushed |
| JavaScript or assets in `app/` (screens, wording, styles) | `npm run update` from `app/` | Builds after build 12 with the same native code, from their next launch |
| Native code (a new native module, permissions, entitlements, an SDK upgrade) | A new EAS build, then TestFlight or the stores | Whoever installs the new build |

### Server → Fly.io

**In short:** the server is one Docker image (`server/Dockerfile`, Node 24 running the TypeScript directly) on one always-on Fly.io machine named `hate-watch-api` in `iad` (US East). Its SQLite database is at `/data/hatewatch.db`, on a 1 GB volume. Setting it up the first time takes six commands: log in, create the app, create the volume, an optional secret, the first deploy, and a health check. After that, a deploy is `fly deploy --remote-only` from `server/` (`CLAUDE.md`, "Release flow"). A deploy replaces the machine in place, with a few seconds of downtime, and the server shuts down cleanly on SIGTERM. It costs a few US dollars a month.

**What you need:** a [Fly.io](https://fly.io) account with a card on file, and `flyctl` installed (`pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"` on Windows). Docker isn't needed locally, because Fly builds the image on a remote builder.

**First-time setup**, from `server/`:

```bash
fly auth login
fly launch --copy-config --no-deploy        # creates the app from fly.toml; rename it if "hate-watch-api" is taken
fly volumes create hatewatch_data --region iad --size 1 --count 1
fly secrets set EXPO_ACCESS_TOKEN=...       # optional: only if Expo push security is enabled
fly deploy --ha=false
curl https://hate-watch-api.fly.dev/health  # → {"ok":true,"catalog":{"teams":309,"players":6982},...} (production, October 11, 2026)
```

What each step does:

1. `fly auth login` signs this machine in to Fly. It's needed once per machine.
2. `fly launch --copy-config --no-deploy` creates the app on Fly from `fly.toml` as it is, without prompting for its settings (`--copy-config`) and without deploying yet (`--no-deploy`). App names are global on Fly. If `hate-watch-api` is taken, change `app` in `fly.toml`, and also the URL in `app/eas.json` (see "If you rename the Fly app" below).
3. `fly volumes create hatewatch_data --region iad --size 1 --count 1` creates one 1 GB volume in `iad`. Its name has to match `source` under `[[mounts]]` in `fly.toml`, which mounts it at `/data`.
4. `fly secrets set EXPO_ACCESS_TOKEN=...` is only needed if enhanced push security is turned on in Expo. `server/src/push.ts` then sends it as a bearer token with every push request. Without it, pushes go out with no token.
5. `fly deploy --ha=false` builds and starts the server. flyctl creates spare machines by default (`--ha`, default true). `--ha=false` keeps it to exactly one, which this server needs (below).
6. `curl https://hate-watch-api.fly.dev/health` checks that it's up. `/health` returns `ok`, the catalog's size (`{"teams":…,"players":…}`) and `live`: the games, F1 sessions and UFC cards being tracked right now, and `calls`: every request sent to ESPN since the server started, by league and kind of read (docs/real-time.md, "Counting the calls to ESPN"). The counts in the comment above are from the first setup. The catalog has grown since (see "Data" below).

**The first boot:** with an empty database, the server ingests every league's teams and rosters from ESPN before it starts listening (`server/src/index.ts`, `[boot] catalog empty; ingesting rosters from ESPN…`). `fly.toml` gives the health check a 120 s grace period for that. After that, rosters refresh in the background every 6 hours. A deploy with an existing database serves at once, and a newly added league is ingested in the background.

**Deploying after that** (`CLAUDE.md`, "Release flow", where asking first and backing up first are also covered):

```bash
cd server && fly deploy --remote-only
```

`--remote-only` builds on Fly's builder (flyctl's default). The image is `node:24-slim` with `npm ci --omit=dev` and `src/` copied in. `server/.dockerignore` leaves out `node_modules`, `data` (the local dev database and game recordings), `test`, `*.log`, `fly.toml` and `.gitignore`. The image also carries Litestream 0.5.17 (docs/redundancy.md), and runs `server/start.sh`, which restores the database from the replica when the volume is empty, starts Litestream if `LITESTREAM_REPLICA_URL` is set, and then `exec`s `node --disable-warning=ExperimentalWarning src/index.ts`. Node 24 strips the TypeScript types itself and has `node:sqlite` built in, so there is no build step. It runs as root on purpose, because Fly mounts volumes root-owned and a non-root user couldn't write to `/data`.

What a deploy looks like: Fly sends SIGTERM to the running machine. The server logs `[shutdown] SIGTERM`, closes the HTTP server, closes SQLite cleanly and exits. With `strategy = "immediate"`, the machine is replaced in place, and open apps lose their WebSocket for a few seconds and reconnect.

Why it's configured the way it is (`fly.toml`):

- **Exactly one machine, never auto-stopped.** The live poller and all WebSockets live in one process, so it must never be stopped for idleness, and there must be exactly one machine (`fly.toml`'s own comment). `auto_stop_machines = "off"`, `auto_start_machines = true` and `min_machines_running = 1`.
- **SQLite on a 1 GB volume** at `/data`. `HW_DB = "/data/hatewatch.db"` in `[env]`, and the `hatewatch_data` mount with `initial_size = "1gb"`.
- **A 120 s health-check grace period** for the first-boot roster ingest. How long that takes depends on the machine and on ESPN: 16 s measured locally, and about 30 to 60 s on Fly's small machine with every image verified (`fly.toml`'s comment); 120 s covers both. The check is `GET /health` every 30 s with a 5 s timeout.
- **`HW_DEV` unset**, so `/dev/simulate` returns 404. `server/src/api.ts` only adds that route when `HW_DEV` is `1`.
- **Clean shutdown on deploy.** The server stops on SIGTERM and closes the database cleanly.
- **HTTPS only**, on internal port 8080 (`PORT = "8080"`, `force_https = true`).
- **Connections, not requests, are what's counted** (`type = "connections"`, soft limit 2,000, hard limit 2,500), because each open app holds one WebSocket.
- **One `shared-cpu-1x` VM with 512 MB** in `iad` (US East), the region closest to ESPN's API and most US users.
- **The contact email** on `/privacy` and `/support` is `HW_CONTACT_EMAIL` in `[env]` (`hatewatchfeedback@gmail.com`). `server/src/pages.ts` falls back to the same address when it's unset (it was `support@example.com` before October 11, 2026), so a local server's pages are right too.

**Secrets and switches on the running app:** `fly secrets set -a hate-watch-api NAME=value` sets a secret and restarts the app. `HW_FLAGS_OFF` (a comma-separated list) keeps server switches off for good. A switch flipped live with `flag-cli.ts` needs no restart (`CLAUDE.md`, "Release flow").

**Backups:** before anything that changes production data, the database is copied with SQLite's `VACUUM INTO` into a new file under `/data` (`CLAUDE.md`, "Release flow", which shows one way to run it). That copy stays on the same volume, so it does not help if the volume is lost. **Replication:** with `LITESTREAM_REPLICA_URL` set, Litestream also streams the database to a Tigris bucket every second or so, and an empty volume restores from it on boot; setup, the monitor on `GET /health/deep` and the runbooks are in [docs/redundancy.md](redundancy.md). The image with Litestream is live (release v81, October 13, 2026); it has replicated to Tigris since October 13, 2026.

Cost is roughly a few US dollars a month for one shared-cpu-1x machine with 512 MB plus a 1 GB volume. Check Fly's current pricing.

### iOS / Android → EAS

**In short:** EAS builds the app in the cloud from `app/`, using one of three profiles in `app/eas.json`: `development`, `preview` and `production`. The two release profiles compile in the production API URL, `https://hate-watch-api.fly.dev`. iOS builds go to TestFlight with one non-interactive command, because EAS stores the certificates, profile and App Store Connect API key, and `eas.json` has the App Store Connect app id (`6819054268`). The production profile bumps the build number on EAS's side. Production and preview builds also listen on an EAS Update channel of the same name, so builds after build 12 take JavaScript-only changes over the air. The first build of each platform is interactive (an Apple login for iOS, a new keystore for Android), and so is any build that adds an entitlement.

`app/eas.json` has three profiles:

| Profile | For | API | Other settings |
|---|---|---|---|
| `development` | dev client on your phone | `EXPO_PUBLIC_API_URL` from your shell (e.g. your LAN IP) | `developmentClient: true`, internal distribution |
| `preview` | internal / TestFlight-style testing | `https://hate-watch-api.fly.dev` | Internal distribution; Android builds an installable `.apk`; update channel `preview` |
| `production` | App Store / Play Store; build number auto-increments | `https://hate-watch-api.fly.dev` | `autoIncrement: true`; update channel `production` |

The `cli` block asks for eas-cli 24.0.0 or newer and sets `"appVersionSource": "remote"`. EAS keeps the build number, so it doesn't depend on which machine starts the build. The `submit.production.ios.ascAppId` (`6819054268`) tells `eas submit`, and `--auto-submit`, which App Store Connect app to upload to.

**If you rename the Fly app:** update the URL in both `preview` and `production`. The URL is compiled into the app at build time. The same host is also in `app/package.json`'s `update` script, in `app/src/lib/api.ts` (a release build's fallback when `EXPO_PUBLIC_API_URL` isn't set), and in `app/app.json`'s `associatedDomains` (`applinks:hate-watch-api.fly.dev`, for share links). On the server, share links and the share card are built from `HW_PUBLIC_URL` (`PUBLIC_URL` in `server/src/fanout.ts`, default `https://hate-watch-api.fly.dev`): set it, or change that default. `server/fly.toml`'s header lists the same places.

**First-time setup**, from `app/`:

```bash
npx eas-cli@latest login
npx eas-cli@latest init                                         # sets extra.eas.projectId in app.json
npx eas-cli@latest build --platform ios --profile production    # Apple ID login; EAS creates certs + push key
npx eas-cli@latest submit --platform ios --latest               # uploads to App Store Connect / TestFlight
```

1. `login` signs this machine in to the Expo account. The project belongs to the `hate-watch` owner in `app.json`.
2. `init` links the folder to an EAS project and writes its id into `app.json` (`extra.eas.projectId`, now `28903ce8-7d00-47e3-8886-c2044b93ea98`). The same id is in `updates.url` (`https://u.expo.dev/<id>`).
3. The first iOS build asks for an Apple ID login. EAS creates the distribution certificate, the provisioning profile and the push key, and keeps them.
4. `submit --latest` uploads the latest iOS build to App Store Connect, for TestFlight.

**Every TestFlight build after that** is one command that needs no Apple login (`CLAUDE.md`, "Release flow", which says when to send one and what to check first):

```bash
cd app && npx eas-cli@latest build --platform ios --profile production --auto-submit --non-interactive --no-wait
```

- `--auto-submit` submits the finished build with the submit profile of the same name, `--non-interactive` runs without prompts, and `--no-wait` returns without waiting for the build (from `eas build --help`, eas-cli 24.12.1).
- Before it: a clean git tree (EAS uploads uncommitted changes too), `npx tsc --noEmit`, and the npm 10 lockfile check (`CLAUDE.md`, "Don't run `npx expo lint` in app/"). The lockfile check exists because `npx expo lint` once rewrote the lockfile and iOS build 3 failed on it.
- Progress: `npx eas-cli@latest build:view <id> --json` and `npx eas-cli@latest status --json`. On the free tier a submission can queue for about 2 hours. If Apple answers "Creating Build Upload" with a 500, the build is resubmitted with `npx eas-cli@latest submit --platform ios --id <buildId>`, not rebuilt.
- After a build goes out, `PATCH_NOTES.md`'s "Next build" heading becomes that build's number and date (`CLAUDE.md`, "Patch notes").

**What the app config sets for builds** (`app/app.json`): bundle id and Android package `com.hatewatch.app`, version `1.0.0`, iPhone only (`supportsTablet: false`, so no iPad screenshots or iPad review), dark interface, and the scheme `hatewatch`. For iOS it also sets time-sensitive notifications, the `remote-notification` background mode, associated domains for share links, and `ITSAppUsesNonExemptEncryption: false` (it declares no non-exempt encryption). Android uses an adaptive icon with a monochrome layer and the notification channel `hate-events`. The plugins include `expo-notifications`, `expo-iap` (Hate Watch Plus), `expo-alternate-app-icons` (its gold icon) and `expo-video` (clips). Adding a native plugin or an entitlement changes the native code, so it needs a new build, and over-the-air updates published after it reach only that build and later ones.

**Over-the-air updates** (`expo-updates`): `runtimeVersion` uses the `fingerprint` policy, and `updates` checks `ON_LOAD` with `fallbackToCacheTimeout: 0`. `npm run update -- --message "…"` publishes to the `production` channel with the production API URL set; `preview` builds need the same command with `--channel preview --environment preview` (not a script: a new `package.json` script changes the fingerprint). The update script, rollback and what testers see are in `CLAUDE.md`, "Release flow". The app also syncs by itself in JavaScript (`useAutoUpdate` in `app/src/lib/updates.ts`, called by the root layout): on a cold start and whenever it comes back to the foreground after at least a minute, it runs `syncUpdate`, which downloads a waiting update and restarts into it at once instead of on the next launch (no native config changed, so this needs no build; `fallbackToCacheTimeout` stays 0, so launch never waits). A failed check (offline) is ignored and retried at the next open. Tapping the LIVE badge in the Feed and Scores headers (`LiveBadge`, `tapSync` in `app/src/components/ui.tsx`) runs the same `syncUpdate` on demand: `checkForUpdateAsync`, then `fetchUpdateAsync` and `reloadAsync` when one is waiting, else an "Up to date" alert; development builds and web, where `Updates.isEnabled` is false, say so instead.

**Android:** the `preview` profile builds an installable `.apk`, and `production` builds the `.aab` Google Play needs. Firebase push, the keystore and Play Console are in [docs/android-release.md](android-release.md).

### App Store Connect answers

**In short:** these are the answers given in App Store Connect's privacy and app information forms. Hate Watch collects a random device id and what each install tracks, links both to that install, uses them only to make the app work, and tracks no one. The privacy policy and support pages are served by the server itself, and an install deletes all its data from Settings. The answers have to match what the server stores. When that changes, they are checked again against Apple's current questionnaire.

| Field | Value |
|---|---|
| Privacy Policy URL | https://hate-watch-api.fly.dev/privacy |
| Support URL | https://hate-watch-api.fly.dev/support |
| Data collection | **Yes** |
| Identifiers → Device ID | App Functionality · linked to the user · not used for tracking |
| Usage Data → Product Interaction (tracked teams/players, alert settings) | App Functionality · linked to the user · not used for tracking |
| Tracking | **No** |
| Account deletion | In-app: Settings → Delete all my data (`DELETE /me`) |

Where each answer comes from:

- **The two URLs** are pages the server renders itself (`GET /privacy` and `GET /support` in `server/src/api.ts`, their HTML in `server/src/pages.ts`). A server deploy changes them, with no app build needed.
- **Device ID:** the app creates a random device id (not Apple's or Google's advertising id) and a secret key on first launch. The server stores the id with the platform and, if notifications are allowed, the push token. The privacy page lists these.
- **Product Interaction:** the teams and players an install tracks, and its notification settings (alert types, leagues, mutes, quiet hours and their time zone), decide which alerts it gets. Its alert feed is kept to show its history.
- **Tracking: No.** There are no ads, no advertising ids, and no analytics or tracking SDKs. Shared alert links carry nothing about the device that shared them.
- **Account deletion:** Settings → "Delete all my data" asks first ("Delete everything"), then calls `DELETE /me`. That deletes the device's row, and with it its follows and feed (foreign keys in `server/src/db.ts`), forgets the device in memory and updates the live engine. There's no account to sign up for, so there's no other place to delete one.
- **Hate Watch Plus** is bought through Apple and Google, and the server never sees the payment or who subscribed ("Hate Watch Plus" below), so it isn't collected data.
- **Feedback emails: no Contact Info row, on purpose.** Settings → Give feedback only opens a `mailto:` link (`app/src/lib/feedback.ts`) in the person's own mail app, which sends it; the app and the server never see the address or the message. That's why these answers (and the Android guide's Data safety answer) leave email out. Whether a store counts an email sent this way is the publisher's call against its current questionnaire; check it there. The privacy page tells people that an email they choose to send reaches us with their address (`pages.ts`).

The contact email on those pages comes from `HW_CONTACT_EMAIL` in `server/fly.toml`. Double-check these answers against the current App Store Connect questionnaire. The answers are your responsibility as the publisher.

### Hate Watch Plus (the $5/month subscription)

**In short:** Settings → **Support Hate Watch** has a **Hate Watch Plus** card: a $5/month auto-renewing subscription sold through [`expo-iap`](https://openiap.dev/docs/setup/expo) (`app/src/lib/plus.ts`, `app/src/components/PlusStore.tsx`, `Plus.tsx`). Its perks are a **Gold accents** switch that replaces the red in the app's visuals with gold, a gold app icon, **Most hated** (a star on the Tracking tab; below) and **Favorite teams** (a heart on Search and a team's page; its opponent's alerts for that game reach the feed and push; `docs/favorites.md`; the server cannot check Plus). It replaced the three consumable tips (the donation buttons are gone). Apple and Google handle the payment; our server never sees it, and the app's own record is only what the store says on that device. It works only in development and store builds; in Expo Go and on web the card explains that instead. Before it works, App Store Connect and Google Play need the agreements and the product below.

**What you see** (`Plus`): a card with "Hate Watch Plus", "Servers cost money and I'd like to keep the app ad free! Subscribing unlocks gold accents, a gold app icon, the ability to add teams and athletes to your most hated list, and favorite teams: root for a team and get its opponent's alerts for that game.", then:
- **Not subscribed:** a "Subscribe  $4.99 / month" button (the store's localized `displayPrice`), the renewal disclosure Apple requires (price, monthly renewal, cancel at least 24 hours before the period ends in the store's subscription settings), and the links Restore Purchases, Privacy (`/privacy` on the server) and Terms (Apple's standard licence agreement, `EULA_URL`).
- **Subscribed:** the "Gold accents" and "Gold app icon" switches (`SettingRow`s) in place of the button, and Manage Subscription (App Store or Google Play subscription settings, `MANAGE_URL`) among the links.
- **Gold (colours or icon) saved but the store can't be asked** (offline at launch): the switches stay, so they can still be turned off.

**How gold works** (`app/src/theme.ts`): every style in the app is built once when the JavaScript loads, so the colour can't change live. `theme.ts` reads the choice synchronously at launch from `SecureStore` (key `hw.goldAccent`, value `1`, absent for red) and sets `colors.hate` (`#E0A800` instead of `#E5232B`), `colors.hateDim`, `colors.hateText` (its light tint, for text on `hateDim`), `colors.hateTint` (the faintest wash behind a tile) and `colors.onHate` (the text on a hate-coloured fill: near-black on gold, white on red; white on gold fails contrast). Flipping the switch calls `applyGold` (`lib/plus.ts`), which saves the choice and restarts the JavaScript (`Updates.reloadAsync()`, or React Native's `DevSettings.reload()` in a development build), so the switch's description says it restarts the app. Not gold: the splash screen and the push notifications' accent, which are native files and stay red.

**The gold app icon** (`goldIconSupported`, `goldIconOn`, `setGoldIcon` in `lib/plus.ts`): the `expo-alternate-app-icons` config plugin in `app/app.json` declares one alternate icon, `Gold`, from `app/assets/icon-gold.png` (iOS) and `app/assets/android-icon-gold-foreground.png` (Android adaptive foreground, on the background colour `#0B0B0D`). They are the red `icon.png` and `android-icon-foreground.png` with the hue shifted to the gold of `colors.hate`. The "Gold app icon" switch calls `setAlternateAppIcon('Gold')`, or `null` for the default. It is native, so it needs a new build, and over-the-air updates published from this change on reach only builds made from it (the fingerprint changed); the native module is loaded with `requireOptionalNativeModule('ExpoAlternateAppIcons')`, so an older build, Expo Go and web show no icon switch and nothing breaks. iOS shows its own "You have changed the icon" alert; Android closes the app when the icon changes. No restart of ours is needed. A definite lapse (below) puts the icon back to red. On Android the icon's launcher alias copies only the intent filters from `app.json`'s `intentFilters` (none), not the `hatewatch` scheme filter, so a `hatewatch://` link wouldn't open the app through the gold icon; nothing links that way today (Android App Links aren't set up, `docs/sharing.md`).

**Most hated** (`app/src/lib/mostHated.ts`, the star in `following.tsx`, the border in `FeedCard.tsx`): on the Tracking tab every player and team row has, for a subscriber, a ❌ (the red X emoji dimmed when off, full with a red ring when on, so it never reads as the − that unfollows in the compact layouts) before the 🔕 and ⚙️. Tapping it adds or removes that target from the device's most hated; a marked row's button gets a red (`HATE_RED`) ring. A starred target's alerts on the Feed tab get a red border (`HATE_RED`, `#E5232B`, 2 px, fixed: it does not turn gold with the gold accent), and a favorite team's alerts (`FeedItem.fav`, docs/favorites.md) a gold one (`GOLD`, `#E0A800`, 2 px), the colors of the lock screen scoreboard; only on the Feed tab: the same card on a game, a player's or team's page or a shared alert stays plain. On the Scores tab the game's card gets the same red border (`HATE_RED`) for as long as a starred team is in the game, a starred player's team is, or (F1) a starred driver or constructor is in the session (`gameTargetKeys` in `app/src/lib/scores.ts`, `useAnyMostHated`); the game screen's big header stays plain. It matches on the alert's own target, so a team's alert is bordered when the team is starred and a player's when the player is. The list is a set of target keys in AsyncStorage (`hw.mostHated`), kept on this device; it is sent to the server only while the lock screen scoreboard is on, to sort the board (docs/live-activity.md, Privacy), and otherwise isn't. It doesn't change which alerts or pushes arrive, and isn't restored on a new phone. The ❌ and the hint's sentence about it are drawn only for a subscriber (or a device that still has a saved list while the store can't be asked: `starAllowed` in `following.tsx`); anyone else sees no ❌ at all, so there is no upsell there (Settings carries Plus). A definite lapse (below) and "Delete all my data" empty it. It is JavaScript only, so it can reach builds over the air once their fingerprint matches.

**The store connection** (`PlusStore`, mounted in `app/src/app/_layout.tsx` only when `iapAvailable`; the one owner of `useIAP`):

1. When the connection is up it fetches the product (`fetchProducts`, type `subs`) and asks the store whether the subscription is active (`hasActiveSubscriptions([PLUS_SKU])`), once per launch.
2. **Lapsing:** if that answer is a definite "no" (asked at launch and each time the app returns to the foreground), the most-hated list and the favorite teams are emptied, and if gold was on it is turned off (and the app restarts) and a gold icon goes back to the red one (`lapsePlus`). An error or being offline never does this, so a subscriber isn't switched back to red by a bad connection.
3. Subscribing calls `requestPurchase` with `type: 'subs'` (`apple: { sku }`; `google: { skus, subscriptionOffers }`, where Android needs the base plan's `offerTokenAndroid` from the fetched product). The button shows a spinner meanwhile.
4. On success (`onPurchaseSuccess`, for the product id) the transaction is finished as not consumable (`finishTransaction({ isConsumable: false })`, which acknowledges it and stops Android's automatic refund after 3 days), a success haptic plays and "Welcome to Hate Watch Plus" shows. The same callback fires on launch for a purchase paid but never finished. A leftover tip purchase (`LEGACY_TIP_SKUS`) is finished as consumable and nothing else happens.
5. Cancelling says nothing. Any other failure: "Subscription didn't go through" with the store's message.
6. **Restore Purchases** (`restorePurchases`, then the same active check) says "Hate Watch Plus is back on." or "No active Hate Watch Plus subscription was found on this account."

**In Expo Go and on web:** importing `expo-iap` without its native module crashes the app, so `iapAvailable` (`Platform.OS !== 'web'` and `requireOptionalNativeModule('ExpoIap')` present) decides first, and `PlusStore` is only `require`d when it's true. Otherwise the card shows "Plus works in the App Store and Google Play versions of Hate Watch."; with no subscription there, no gold.

**Setup in the app:** `expo-iap` is a dependency (`^5.8.2` in `app/package.json`) and a config plugin in `app/app.json`.

| Product ID | Type | Price |
|---|---|---|
| `com.hatewatch.app.plus.monthly` | Auto-renewable subscription, 1 month | $5/month in intent (Apple's price points are fixed, so the closest tier, probably $4.99, is what App Store Connect offers) |

The price is set in App Store Connect and Google Play, not in the app; the app always shows the store's localized price. The old tip products (`tip.coffee`, `tip.pizza`, `tip.trophy`) can be left in the stores unsold; `tip.small`, `tip.medium` and `tip.large` are burned: they were created as Non-Consumable, and App Store Connect can't change a product's type or reuse a product ID.

**Before Plus works:**

1. **App Store Connect:** accept the **Paid Apps Agreement** and fill in tax and banking (Business → Agreements). Apple requires this even for free apps that sell in-app purchases.
2. **App Store Connect → your app → Monetization → Subscriptions:** create the group and the subscription with these values (limits from Apple's In-App Purchase reference: display name 2 to 30 characters, description up to 45, no emoji or markup):

   | Field | Value |
   |---|---|
   | Group reference name / group display name | `Hate Watch Plus` (app name shown above it) |
   | Subscription reference name | `Hate Watch Plus Monthly` |
   | Product ID | `com.hatewatch.app.plus.monthly` (exactly `PLUS_SKU`; can't be changed or reused) |
   | Duration | 1 month (can't change after review) |
   | Price | the $4.99 tier, the closest Apple offers to $5; every country |
   | Display name (English) | `Hate Watch Plus` |
   | Description (English, 45 characters) | `Gold accents, gold app icon, most hated stars` |
   | Family Sharing | off |
   | Review screenshot | Settings with the Plus card in view (iPhone 6.5-inch size, like `app-store/screenshots-6.5in/`) |
   | Review notes | the supporter-subscription paragraph of `app-store/app-review-notes.md` |

   Then take the old tip products (`com.hatewatch.app.tip.*`) off sale.
3. **Your first subscription must be submitted for review together with an app version.** On the version page, under "In-App Purchases and Subscriptions", add it before submitting. The card and the gold theme are JavaScript only, but the gold icon's plugin changed the native code, so they reach people in a new build, not over the air; the product still needs this review before anyone can subscribe.
4. **The App Store description needs a Terms of Use (EULA) link** (or a custom EULA in App Store Connect) and the Privacy Policy link, since the app sells an auto-renewing subscription (guideline 3.1.2).
5. **Google Play Console:** set up a payments profile, upload a build (the billing permission is added automatically), then create the subscription under **Monetize → Products → Subscriptions** with the same ID and one monthly base plan, and activate it ([android-release.md](android-release.md)).
6. **Test with sandbox accounts.** On iOS, add a Sandbox tester in App Store Connect and buy through TestFlight (sandbox subscriptions renew every few minutes and stop after a few renewals). On Android, add a license tester.

**Review risk:** guideline 3.1.2(a) asks that a subscription give ongoing value; a purely cosmetic one (the gold colour) may be questioned. The review notes (`app-store/app-review-notes.md`) describe it as a supporter subscription with an optional colour theme; every feature stays free.

Apple and Google keep 15% under their small-business programs. Privacy label: purchases aren't collected by us, because Apple and Google handle them.

### Icons and splash

**In short:** The artwork is an angry eye: a red iris with a black pupil and a white glint in a white eye, under a tapered red brow that bears down toward it, on a near-black background with a dark red glow. Every icon and the splash image are drawn from that one vector mark by [`app/scripts/build-icons.mjs`](../app/scripts/build-icons.mjs), which renders SVG to PNG with `@resvg/resvg-js` into `app/assets/`. After editing the script, regenerate with `cd app && npm run icons`.

**The mark** (`mark()`): drawn centred on (0, 0) about 690 units wide, so it fits a 1024 canvas at scale 1, and shifted down a little (`47 × scale`) so the brow and eye together look centred. The colours: background `#0B0B0D`, red `#E5232B`, eye white `#F4F4F5`, the iris ringed in dark red `#7A0D12`. The brow is thin at the outer end and thick where it meets the eye, which makes the scowl. The full-colour background is a radial gradient from `#3B0D12` through `#170A0C` to `#0B0B0D`. The one-colour version (`mono`) is white on transparent, with the iris cut out of the eye and the pupil left, for places that only use the shape.

**What it writes** (each line `render(file, options, pixels)`; the script prints each file and its size):

| File | Size | What it is | Used by (`app/app.json`) |
|---|---|---|---|
| `icon.png` | 1024×1024 | full colour on the gradient, opaque and full bleed, as Apple requires (iOS applies its own mask) | `icon` |
| `android-icon-background.png` | 1024×1024 | the gradient alone | `android.adaptiveIcon.backgroundImage` (with `backgroundColor` `#0B0B0D`) |
| `android-icon-foreground.png` | 1024×1024 | the mark at 0.8 scale on transparent, inside the adaptive icon's safe zone (the inner 66%) | `android.adaptiveIcon.foregroundImage` |
| `android-icon-monochrome.png` | 1024×1024 | the one-colour mark at 0.8 scale: Android 13's themed icon | `android.adaptiveIcon.monochromeImage` |
| `splash-icon.png` | 1024×1024 | the mark at 1.2 scale on transparent | the `expo-splash-screen` plugin: `imageWidth` 220, `resizeMode` contain, on `#0B0B0D` |
| `favicon.png` | 48×48 | full colour on the gradient | `web.favicon` |
| `notification-icon.png` | 96×96 | the one-colour mark at 1.35 scale: white on transparent for Android's status bar | the `expo-notifications` plugin's `icon`, tinted `#E5232B`, channel `hate-events` |

### App Store page images

**In short:** App Store Connect's Product Page Information has a "Header and Search Results" tab (a custom Header and a custom Search Results image) and an "App Previews and Screenshots" tab. Both are uploaded by hand; nothing here ships with a build.

- **Retake the screens** when the app's look changes (the images are the app's own screens, so they go stale): start the web app (`hate-watch-web` in `.claude/launch.json`) and the dev server, then `HW_TOKEN=<token> HW_PLAYER=player:nba:4065648 node app-store/capture-screens.mjs`. It opens the web app at iPhone size and 3x with Playwright's Chromium and writes `app-store/raw/{feed,search,scores,tracking,player-alerts,settings}.jpg` (1290×2796). `HW_TOKEN` is the `hatewatch.token` in localStorage of a dev web session that tracks teams and athletes in several leagues (the screens show that device's follows and feed); `HW_PLAYER` is one of its tracked athletes. Check the raw images for stale or empty data before building.
- **Build the images**: `node app-store/build-store-images.mjs` (needs `app/node_modules`; `sips` scales). It writes the Header and Search Results to `app-store/header-search/` (`header-3840x1646.png` 21:9, `search-results-3840x2560.png` 3:2, drawn with the icon's eye mark and palette; the search image bleeds the Feed screen off the bottom) and six captioned, framed screenshots (feed, search, scores, tracking, player alerts, settings) into `app-store/screenshots/` (1320×2868, 6.9-inch), `screenshots-6.5in/` (1284×2778) and `screenshots-6.3in/` (1206×2622), clearing those folders first. The captions are the `SHOTS` list in the script. Apple's rules (Creative assets specifications): opaque, no prices or URLs, 4+ suitable; the Header and the search card crop differently per device, so keep everything central and check both in App Store Connect's preview. No video versions are made. Uploaded by hand; the Scores screen shows DraftKings odds lines, so swap it if App Review objects.
- iPhone only (`supportsTablet: false`), so no iPad sizes. All shots are the red look; there are no gold or Plus screenshots.
