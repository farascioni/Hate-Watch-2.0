# Deploy

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** Hate Watch reaches people in three ways. Each has its own command, and none of them needs the other machine. **The server** (`server/`) runs on Fly.io as the app `hate-watch-api`: one machine, with SQLite on a volume. A server deploy reaches every installed build within seconds. **The app** (`app/`) is built in the cloud by EAS (Expo Application Services) and sent to TestFlight and the App Store, and later Google Play. **Over-the-air updates** (EAS Update) send JavaScript and asset changes to builds after build 12 without a new build. The day-to-day release rules (ask first, the exact commands, backups, server switches, developer notices, patch notes) are in `CLAUDE.md` under "Release flow". This section covers first-time setup and how each piece is configured.

**Sections:**
- **Deploy**: Hate Watch reaches people in three ways.
  - **Server → Fly.io**: the server is one Docker image (`server/Dockerfile`, Node 24 running the TypeScript directly) on one always-on Fly.io machine named `hate-watch-api` in `iad` (US East).
  - **iOS / Android → EAS**: EAS builds the app in the cloud from `app/`, using one of three profiles in `app/eas.json`: `development`, `preview` and `production`.
  - **App Store Connect answers**: these are the answers given in App Store Connect's privacy and app information forms.
  - **Donations (in-app tips)**: Settings → **Support Hate Watch** has a Donate button that offers three tip sizes, sold as **consumable in-app purchases** through [`expo-iap`](https://openiap.dev/docs/setup/expo) (`app/src/lib/tips.ts`, `app/src/components/TipJar.tsx`, `TipJarStore.tsx`).
  - **Icons and splash**: The artwork is an angry eye: a red iris with a black pupil and a white glint in a white eye, under a tapered red brow that bears down toward it, on a near-black background with a dark red glow.

The README's "Deploy" has the summary; this is the full detail. Read this index first, then only the part you need.

## Deploy

**In short:** Hate Watch reaches people in three ways. Each has its own command, and none of them needs the other machine. **The server** (`server/`) runs on Fly.io as the app `hate-watch-api`: one machine, with SQLite on a volume. A server deploy reaches every installed build within seconds. **The app** (`app/`) is built in the cloud by EAS (Expo Application Services) and sent to TestFlight and the App Store, and later Google Play. **Over-the-air updates** (EAS Update) send JavaScript and asset changes to builds after build 12 without a new build. The day-to-day release rules (ask first, the exact commands, backups, server switches, developer notices, patch notes) are in `CLAUDE.md` under "Release flow". This section covers first-time setup and how each piece is configured.

**Google Play (Android):** step-by-step guide in [docs/android-release.md](android-release.md), written for releasing without owning an Android phone.

**Which one a change needs:**

| The change | How it goes out | Who gets it |
|---|---|---|
| Anything in `server/` (alerts, wording the server writes, how each league is shown) | `fly deploy --remote-only` from `server/` | Every install, every build, within seconds |
| Turning off ESPN's clips or images | A server switch (`server/src/flag-cli.ts`), no deploy | Every install, within seconds; a clip already in a feed goes at its next feed load |
| Turning on a way to read ESPN less (`savings.*`, off until turned on) | The same `flag-cli.ts`, no deploy | The server, within seconds; docs/real-time.md, "Reading ESPN less" |
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

`--remote-only` builds on Fly's builder (flyctl's default). The image is `node:24-slim` with `npm ci --omit=dev` and `src/` copied in. `server/.dockerignore` leaves out `node_modules`, `data` (the local dev database and game recordings), `test`, `*.log`, `fly.toml` and `.gitignore`. The image runs `node --disable-warning=ExperimentalWarning src/index.ts`. Node 24 strips the TypeScript types itself and has `node:sqlite` built in, so there is no build step. It runs as root on purpose, because Fly mounts volumes root-owned and a non-root user couldn't write to `/data`.

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

**Secrets and switches on the running app:** `fly secrets set -a hate-watch-api NAME=value` sets a secret and restarts the app. `HW_FLAGS_OFF` (a comma-separated list) keeps server switches off for good, and `HW_SAVINGS_ON` keeps the `savings.*` ones on for good. A switch flipped live with `flag-cli.ts` needs no restart (`CLAUDE.md`, "Release flow").

**Backups:** before anything that changes production data, the database is copied with SQLite's `VACUUM INTO` into a new file under `/data` (`CLAUDE.md`, "Release flow", which shows one way to run it).

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

**What the app config sets for builds** (`app/app.json`): bundle id and Android package `com.hatewatch.app`, version `1.0.0`, iPhone only (`supportsTablet: false`, so no iPad screenshots or iPad review), dark interface, and the scheme `hatewatch`. For iOS it also sets time-sensitive notifications, the `remote-notification` background mode, associated domains for share links, and `ITSAppUsesNonExemptEncryption: false` (it declares no non-exempt encryption). Android uses an adaptive icon with a monochrome layer and the notification channel `hate-events`. The plugins include `expo-notifications`, `expo-iap` (tips) and `expo-video` (clips). Adding a native plugin or an entitlement changes the native code, so it needs a new build, and over-the-air updates published after it reach only that build and later ones.

**Over-the-air updates** (`expo-updates`): `runtimeVersion` uses the `fingerprint` policy, and `updates` checks `ON_LOAD` with `fallbackToCacheTimeout: 0`. `npm run update -- --message "…"` publishes to the `production` channel with the production API URL set; `preview` builds need the same command with `--channel preview --environment preview` (not a script: a new `package.json` script changes the fingerprint). The update script, rollback and what testers see are in `CLAUDE.md`, "Release flow".

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
- **Tips** are bought through Apple and Google, and the server never sees the payment ("Donations (in-app tips)" below), so they aren't collected data.
- **Feedback emails: no Contact Info row, on purpose.** Settings → Give feedback only opens a `mailto:` link (`app/src/lib/feedback.ts`) in the person's own mail app, which sends it; the app and the server never see the address or the message. That's why these answers (and the Android guide's Data safety answer) leave email out. Whether a store counts an email sent this way is the publisher's call against its current questionnaire; check it there. The privacy page tells people that an email they choose to send reaches us with their address (`pages.ts`).

The contact email on those pages comes from `HW_CONTACT_EMAIL` in `server/fly.toml`. Double-check these answers against the current App Store Connect questionnaire. The answers are your responsibility as the publisher.

### Donations (in-app tips)

**In short:** Settings → **Support Hate Watch** has a Donate button that offers three tip sizes, sold as **consumable in-app purchases** through [`expo-iap`](https://openiap.dev/docs/setup/expo) (`app/src/lib/tips.ts`, `app/src/components/TipJar.tsx`, `TipJarStore.tsx`). Tips unlock nothing, can be bought again, and never touch our server: Apple and Google handle the payment. They work only in development and store builds; in Expo Go and on web the button explains that instead. Before they work, App Store Connect and Google Play need the agreements and the three products below.

Apple allows "tipping the developer" through in-app purchase in every country (guideline 3.1.1); external payment links would only be allowed on the US App Store.

**What you see** (`DonateCard`): a card under the "Support Hate Watch" heading with a red "Donate" button (with a heart) and under it "Servers cost money and I'd like to keep the app ad free!" (a non-breaking space keeps "ad free!" together).

**In a store or development build** (`TipJarStore`, used when `iapAvailable`):

1. When the store connection is up, the app asks it for the three products (`fetchProducts`, type `in-app`).
2. Tapping Donate swaps the button for one button per product the store returned, each with its emoji (coffee, pizza, trophy) and the store's localized price (`displayPrice`), and "Maybe later" under them, which puts the Donate button back.
   - If no product came back: "Donations aren't available right now. Please try again later." when the store is connected, or "Can't reach the App Store right now. Please try again in a moment." when it isn't.
3. Tapping a price starts the purchase (`requestPurchase`: `apple: { sku }`, `google: { skus: [sku] }`). That button shows a spinner and the others fade and can't be tapped until it's over.
4. On success (`onPurchaseSuccess`, for these three product ids only) the app finishes the transaction as consumable (`finishTransaction({ isConsumable: true })`), which lets the same tip be bought again and stops Android's automatic refund after 3 days for an unacknowledged purchase. Then a success haptic and "Thank you!", "You just helped keep Hate Watch running, and ad free." The same callback fires on launch for a tip that was paid but never finished (the app was killed mid-purchase), so it gets finished then.
5. Cancelling says nothing. Any other failure: "Donation didn't go through" with the store's message, or "Please try again."

**In Expo Go and on web** (`TipJar`): there's no store to pay through, and importing `expo-iap` without its native module crashes the app, so `iapAvailable` (`Platform.OS !== 'web'` and `requireOptionalNativeModule('ExpoIap')` present) decides first, and `TipJarStore` is only `require`d when it's true. Otherwise the Donate button shows "Donations work in the App Store and Google Play versions of Hate Watch." (a system alert, or the browser's).

**Setup in the app:** `expo-iap` is a dependency (`^5.8.2` in `app/package.json`) and a config plugin in `app/app.json`.

The product IDs are defined in `app/src/lib/tips.ts` (`TIPS`, in this order on screen):

| Product ID | Suggested price | Shown as |
|---|---|---|
| `com.hatewatch.app.tip.coffee` | $1.99 | coffee |
| `com.hatewatch.app.tip.pizza` | $4.99 | pizza |
| `com.hatewatch.app.tip.trophy` | $9.99 | trophy |

The prices are set in App Store Connect and Google Play, not in the app; the app always shows the store's localized price.

(`tip.small`, `tip.medium` and `tip.large` are burned: they were created as Non-Consumable, and App Store Connect can't change a product's type or reuse a product ID.)

**Before tips work:**

1. **App Store Connect:** accept the **Paid Apps Agreement** and fill in tax and banking (Business → Agreements). Apple requires this even for free apps that sell in-app purchases.
2. **App Store Connect → your app → In-App Purchases:** create three products of type **Consumable** with exactly the IDs above. Each needs a display name, a price, and a review screenshot (a screenshot of Settings is fine).
3. **Your first in-app purchases must be submitted for review together with an app version.** On the version page, under "In-App Purchases and Subscriptions", add all three before submitting.
4. **Google Play Console:** set up a payments profile, upload a build (the billing permission is added automatically), then create the same three IDs under **Monetize → Products → In-app products** and activate them.
5. **Test with sandbox accounts.** On iOS, add a Sandbox tester in App Store Connect and buy through TestFlight. On Android, add a license tester.

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
