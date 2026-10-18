# Releasing Hate Watch on Google Play (without owning an Android phone)

## Index

**Summary:** the path from nothing to Hate Watch on Google Play, written for someone who builds on Windows and has no Android phone. It costs $25 once and takes about three weeks, almost all of it Google's 14-day closed test with at least 12 testers. A borrowed Android phone is needed for about five minutes, once. The app itself needs no Android rewrite: EAS builds it in the cloud, and `app/app.json` and `app/eas.json` already have what Android needs, except the Play Console upload settings and the FCM key upload (see "Where the repo stands today"). The steps run in order. Steps 2 to 7 can be done while Google reviews your identity, and the phone check (step 9) can be done any time before applying for production.

**Sections:**
- **Before you start: what this takes**: the $25 fee, the borrowed phone, the 12 testers for 14 days, the three weeks, and how an organization account skips the phone and the testers.
- **Where the repo stands today**: what `app.json`, `eas.json` and the code already set up for Android, and what is still missing.
- **Step 1: Create the Google Play developer account**: a personal account, the fee, identity verification.
- **Step 2: Set up Android push notifications (Firebase)**: a Firebase project, `google-services.json` in `app/`, and the FCM service-account key uploaded to EAS.
- **Step 3: Build the Android app with EAS**: an installable `.apk` from the `preview` profile, then the store `.aab` from `production`, and the keystore EAS creates on the first build.
- **Step 4: Test it without a phone (Android emulator)**: Android Studio's emulator with a Google Play system image, and what to check.
- **Step 5: Create the app and store listing in Play Console**: the listing's text and images, and the App content questionnaires with answers that fit Hate Watch.
- **Step 6: Let EAS upload to Play Console for you (service account)**: a Google Cloud service account with Play Console permissions, and its key uploaded to EAS.
- **Step 7: Internal testing (just you)**: submitting a build, installing it from the Play Store on the emulator, the pre-launch report, and the Hate Watch Plus subscription.
- **Step 8: Closed testing: 12 testers for 14 days**: the track, the testers, the opt-in link, and why testers have to actually use the app.
- **Step 9: Verify you have access to an Android phone (borrowed)**: the five-minute device check in the Play Console app.
- **Step 10: Apply for production and launch**: the production application, the first release and its review.
- **After launch**: updates in one command, Android share links, and folding this into the README.
- **Sources**: the Expo and Google pages this guide is based on.

This is the full path from nothing to Hate Watch live on the Google Play Store, written for someone who builds on Windows and doesn't own an Android device. The app needs no code rewrite for Android: it's an Expo app, EAS builds it in the cloud, and `app.json` already has the Android package name (`com.hatewatch.app`), icons and notification channel.

Steps marked **Claude can do this** are things you can hand to Claude in a session. Everything else needs you: a Google account, a payment, identity checks, a borrowed phone, and the testers.

## Before you start: what this takes

| | |
|---|---|
| **Money** | $25 one-time Google Play developer fee. Everything else here is free (EAS's free plan builds Android too). |
| **A real Android phone, for about 5 minutes** | Google makes new *personal* developer accounts verify they have access to a physical Android phone (Android 10 or newer, not rooted) through the Play Console app. An emulator doesn't count. Borrow a friend's or family member's phone; you sign in to the Play Console app, tap Verify, and sign out. (Step 9.) |
| **12 testers for 14 days** | New personal accounts must run a closed test with at least 12 people who opt in, for 14 days in a row, before Google unlocks the production release. If the count drops below 12, the 14 days start over, and Google checks that testers actually used the app. (Step 8.) |
| **Time** | About 3 weeks end to end, almost all of it the 14-day test. |

> **Skipping the phone and the 12 testers:** both rules apply to *personal* accounts. An *organization* developer account (for a registered business such as an LLC, with a D-U-N-S number) is exempt from both. If you already have a business, consider signing up as one. Otherwise, the personal route below works.

## Where the repo stands today

What is already in place (checked against the files on October 11, 2026):

- **The package name** is `com.hatewatch.app` (`android.package` in `app/app.json`), the same as the iOS bundle id.
- **The icons:** an adaptive icon with foreground, background and monochrome layers (`app/assets/android-icon-*.png`) on `#0B0B0D`, generated with the rest by `app/scripts/build-icons.mjs` (`npm run icons` in `app/`). Android's notification icon (`app/assets/notification-icon.png`, tinted `#E5232B`) is set in the `expo-notifications` plugin.
- **The notification channel:** alerts go to the channel `hate-events` (`defaultChannel` in the `expo-notifications` plugin).
- **Predictive back is off** (`predictiveBackGestureEnabled: false`).
- **Firebase for push:** `app/google-services.json` (project `hate-watch-7a930`, package `com.hatewatch.app`, public identifiers only) is committed, and `android.googleServicesFile` in `app/app.json` points at it. It does not change the iOS fingerprint (checked October 18, 2026: same hash before and after), so iOS over-the-air updates still reach every build. The FCM service-account key is not in the repo: it is uploaded to EAS (step 2, item 5).
- **The build profiles** (`app/eas.json`): `preview` builds an installable `.apk` (`android.buildType: "apk"`, added in b249331) against the production API, and `production` builds the `.aab` Google Play takes. `autoIncrement` gives each production build a new version code, and EAS keeps the count (`appVersionSource: "remote"`). Both profiles have an update channel (`preview`, `production`) for over-the-air updates.
- **Hate Watch Plus:** `app/src/lib/plus.ts` holds the subscription's product id (`com.hatewatch.app.plus.monthly`). `expo-iap` is in the plugins. The comment in `plus.ts` says to create the same id in Play Console as a subscription with one monthly base plan.
- **The privacy policy and the data deletion** that Play Console asks about are on the server: `https://hate-watch-api.fly.dev/privacy`, and Settings → "Delete all my data" (`DELETE /me`).

What is not there yet:

- **The FCM key is only in EAS if you uploaded it** (step 2, item 5). Without it, Android builds get no push notifications.
- **No Android submit settings** in `eas.json`. `submit.production` has only `ios.ascAppId`, so `--auto-submit` can't send an Android build to Play Console until step 6 adds them.
- **No Android App Links:** the server serves `/.well-known/apple-app-site-association` for iOS share links, but no `assetlinks.json` (see "After launch").

---

## Step 1: Create the Google Play developer account

1. Go to [play.google.com/console](https://play.google.com/console) and sign in with the Google account you want to own the app (it can't be transferred to another account later without a support request).
2. Choose **Yourself** (personal account) unless you're registering a business.
3. Pay the $25 fee and complete identity verification (a government ID and your legal name and address). Google reviews this, usually within a few days.
4. Verify your contact email and phone number when prompted.

You can do steps 2 through 7 while Google reviews your identity.

## Step 2: Set up Android push notifications (Firebase)

On Android, Expo's push notifications are delivered through Google's Firebase Cloud Messaging (FCM). Without this step the app runs, but Android users never get alerts.

1. Go to the [Firebase console](https://console.firebase.google.com) and create a project (any name, such as "Hate Watch"). Google Analytics is optional; you can turn it off.
2. In the project, click **Add app** → **Android**. Enter the package name exactly: `com.hatewatch.app`. Register it.
3. Download **`google-services.json`** and put it in the `app/` folder of this repo. It only holds public identifiers, so it's fine to commit.
4. In Firebase, open **Project settings** → **Service accounts** → **Generate new private key** → **Generate key**. This downloads a JSON key file. **Keep this one private: never commit it.**
5. Upload that private key to EAS. From the `app/` folder, run:
   ```bash
   npx eas-cli@latest credentials --platform android
   ```
   Choose **production** → **Google Service Account** → **Manage your Google Service Account Key for Push Notifications (FCM V1)** → **Set up a Google Service Account Key for Push Notifications (FCM V1)** → **Upload a new service account key**, and pick the file from step 4. After uploading, you can delete your local copy.

Done in the repo: `google-services.json` is in `app/` and `app.json` has `"googleServicesFile": "./google-services.json"` under `android`. Only the key upload (item 5) is yours, because it puts a private key into EAS.

## Step 3: Build the Android app with EAS

EAS builds Android in the cloud, so you don't need Android Studio for this step.

1. From the `app/` folder, build a test version you can install directly (an APK):
   ```bash
   npx eas-cli@latest build --platform android --profile preview
   ```
   The first Android build asks whether to **generate a new Android Keystore**. Answer **yes**. EAS creates the app's upload key and stores it for you; don't lose access to your Expo account, because that key is what lets you publish updates.
2. When it finishes, EAS gives you a link to the `.apk`. The `preview` profile sets `EXPO_PUBLIC_API_URL` to `https://hate-watch-api.fly.dev`, so this build talks to the production server and shows real alerts.
3. Then build the store version (an `.aab`, the format Google Play requires):
   ```bash
   npx eas-cli@latest build --platform android --profile production
   ```
   `eas.json` already auto-increments the version code for each production build.

**Claude can do this:** after the first interactive build has created the keystore, later builds run from here without you, like the iOS builds.

## Step 4: Test it without a phone (Android emulator)

1. Install [Android Studio](https://developer.android.com/studio) on your PC (free). You only need it for its emulator.
2. Open **Device Manager** → **Create device** → pick a recent phone (for example a Pixel 8) → choose a system image **with Google Play** (it has the Play Store icon). This matters, because push notifications and in-app purchases need Google Play services.
3. Start the emulator, then drag the `.apk` from step 3 onto its window to install it.
4. Go through the app: the startup guide, tracking a team, the Feed, the Scores tab, Settings, the leaderboard. Allow notifications when asked, and check that alerts arrive while a tracked game is live.

The emulator can't do Google's device verification (step 9), but it's enough for testing.

## Step 5: Create the app and store listing in Play Console

1. In Play Console, click **Create app**. Name: **Hate Watch**. Default language: English (United States). App or game: **App**. Free or paid: **Free** (the Hate Watch Plus subscription is an in-app purchase, which free apps can have). Accept the declarations.
2. **Store listing** (Grow → Store presence → Main store listing). You need:
   - **Short description** (up to 80 characters), for example: *Real-time alerts when the teams and players you hate mess up.*
   - **Full description** (up to 4,000 characters). The App Store description can be reused.
   - **App icon:** 512 × 512 PNG.
   - **Feature graphic:** 1024 × 500 PNG or JPG. Required.
   - **Phone screenshots:** at least 2, and up to 8. Each side must be 320–3,840 px, and the long side can be at most twice the short side. The iPhone App Store screenshots are too tall for that rule, so they need re-rendering at 1080 × 1920.
   - **Category:** Sports. **Contact email:** your support email.
   - **Privacy policy URL:** `https://hate-watch-api.fly.dev/privacy` (the server already serves it).
3. Fill in **App content** (Policy → App content). Each one is a short questionnaire. Answers that fit Hate Watch:
   - **App access:** all functionality is available without special access (there's no login).
   - **Ads:** no ads.
   - **Content rating:** complete the IARC questionnaire honestly: no user content sharing, no age-restricted or gambling promotion (the Scores screen shows odds lines, but nothing can be bet in the app), no location sharing, no cash rewards, not a browser; **Yes** to online content (alerts, scores and clips come from the server after install) and **Yes** to purchasing digital goods (the Hate Watch Plus subscription). It should still come out at a low rating.
   - **Target audience:** 18 and over. That keeps the app out of the stricter children's-app rules.
   - **Data safety:** the app collects **device or other IDs** (an app-generated device ID and the push token) and **app interactions** (which teams and players are tracked, alert settings) for **app functionality**, both required and linked to the device, matching the App Store privacy label (`docs/deploy.md`). "Does your app allow users to create an account" is answered with *My app does not allow users to create an account*. It's not shared with third parties, it's encrypted in transit (HTTPS), and users can delete it (Settings → Delete all my data). It collects no name, email, location, contacts or photos. (Settings → Give feedback opens the person's own mail app with a `mailto:` link: their mail app sends it, and the app never sees the address. That's why this answer leaves email out; check it against Play's current Data safety form. The privacy page says an email they choose to send reaches us, and the README's App Store answers make the same choice.) In-app purchases are processed by Google Play, and Hate Watch doesn't store payment details.
   - **News app:** no. **Government app:** no. **Financial features:** none. **Health:** none.

Done in the repo: `node app-store/build-play-images.mjs` renders the 512 px icon, the 1024 × 500 feature graphic and six 1080 × 1920 phone screenshots into `app-store/play/` (same screens and captions as the App Store set, from `app-store/raw/`), and `app-store/play-listing.md` has the short and full descriptions to paste. Google wants real Android screenshots to be representative: these show the app's own screens in a plain frame, so re-capture from the emulator (step 4) if Play objects.

## Step 6: Let EAS upload to Play Console for you (service account)

EAS Submit uploads builds to Play Console using a Google Cloud service account.

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project (or reuse the Firebase one).
2. Go to **IAM & Admin** → **Service Accounts** → **Create service account**. Give it a name such as "eas-submit", click **Create and close**, and copy its email address.
3. On that service account, open **Manage keys** → **Add key** → **Create new key** → **JSON** → **Create**. A JSON file downloads. **Keep it private.**
4. Open the [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) page and click **Enable**.
5. In Play Console, go to **Users and permissions** → **Invite new users**. Paste the service account's email. Under **App permissions**, add Hate Watch and grant: *View app information*, *Edit and delete draft apps*, *Release to production, exclude devices, and use Play App Signing*, *Release apps to testing tracks*, *Manage testing tracks and edit tester lists*, and *Manage store presence*. Click **Invite user**.
6. Upload the key to EAS: run `npx eas-cli@latest credentials --platform android` → **production** → **Google Service Account** → upload it as the key for **EAS Submit**. You can then delete your local copy.

**Claude can do this:** add the Android submit settings to `eas.json` (`"submit": { "production": { "android": { "track": "internal" } } }`) so builds can go to Play Console with `--auto-submit`, the same way iOS goes to TestFlight.

## Step 7: Internal testing (just you)

Internal testing is Google's TestFlight: up to 100 testers, available within minutes, and no review wait.

1. Submit the production build from step 3:
   ```bash
   npx eas-cli@latest submit --platform android --profile production
   ```
   (Or build and submit in one go with `eas build --platform android --profile production --auto-submit`.)
   What the flags mean (`eas submit --help`): `--profile` names the submit profile in `eas.json` (it defaults to `production` when there is one). That profile has no `android` settings until step 6 adds them. `--latest` submits the newest Android build on EAS, `--id <buildId>` a particular one, and `--path` a local `.aab` file.
2. In Play Console, open **Testing** → **Internal testing** → **Testers**. Create an email list with your Google account and add a short release note.
3. Use the **opt-in link** on that page. Open it in the emulator's browser while signed in to the same Google account, and install Hate Watch from the Play Store. This is the version that can test Hate Watch Plus, because in-app purchases only work for an app installed from Google Play.
4. Check the **pre-launch report** a few hours later (under Testing, or in Quality). Google installs every testing-track build on real phones in its test lab, then shows crashes, screenshots and accessibility warnings. It's the closest thing to owning a few Android phones.

### Hate Watch Plus (the subscription)

1. In Play Console, set up a **payments profile** (Settings → Payments profile). Google asks for this before you can create products.
2. Go to **Monetize** → **Products** → **Subscriptions**, and create one subscription with the exact ID `com.hatewatch.app.plus.monthly`. Give it a name, then add one **base plan**: auto-renewing, billing period 1 month, price $5.00 (set per country), and activate it. The app buys through the base plan's offer token, so it needs exactly one active base plan with no required offers.
3. Under **Settings** → **License testing**, add your Google account, so your test purchases aren't charged.

## Step 8: Closed testing: 12 testers for 14 days

Production stays locked until this passes.

1. Open **Testing** → **Closed testing** → create a track (or use **Alpha**). Promote the build you tested internally to it.
2. Under **Testers**, add an email list with at least **12 people who have Android phones**: friends, family, coworkers, a sports group chat. Fifteen to twenty is safer, because if the count dips below 12 on any day, the 14 days start over.
3. Send them the **opt-in link**. Each tester must accept on the web with their Google account, then install from the Play Store link.
4. Ask them to actually use it: track a few teams they hate, open it during games, and leave feedback. Google checks engagement, and rejects production applications where testers installed the app but barely opened it.
5. Ship an update or two during the 14 days if anything comes up. Each update goes out to them automatically.

## Step 9: Verify you have access to an Android phone (borrowed)

Do this with a borrowed phone any time before you apply for production. It takes about five minutes.

1. In Play Console (on your PC), find the task **"Verify that you have access to an Android mobile device"** and click **View details**.
2. On the borrowed phone (Android 10 or newer, not rooted), scan the QR code. It opens or installs the **Play Console** app.
3. Sign in **as the developer account owner**, select your developer account, tap **Verify**, and follow the prompts.
4. Sign out of the Play Console app and hand the phone back.

## Step 10: Apply for production and launch

1. When the 14 days are up, Play Console shows **Apply for production** on the dashboard. Answer the questions about your closed test: who tested, what feedback you got, what you changed. Google typically replies within about a week.
2. Once approved, open **Production** → **Create new release**, choose the build (or promote it from closed testing), add release notes, and **send it for review**. The first review can take several days; later updates are usually quicker.
3. When it's approved, Hate Watch is on Google Play.

## After launch

- **Updates:** one command builds and uploads (switch `track` to `production` in `eas.json` once you're live):
  ```bash
  npx eas-cli@latest build --platform android --profile production --auto-submit
  ```
- **Claude can do this: share links on Android.** Today only an iPhone, iPad or iPod is sent to the App Store (`server/src/share.ts` checks the browser's user agent); on an Android phone a shared alert opens the server's card page (the alert's picture and a download button that points to the App Store). Once the Play listing is live, I can send Android visitors to the Play Store instead, and set up Android App Links (an `assetlinks.json` on the server, plus intent filters in `app.json`) so share links open the app directly when it's installed, like iOS universal links. That needs the app-signing SHA-256 fingerprint from Play Console → Setup → App signing.
- **Claude can do this: the README.** Once you've been through this once, I can fold the parts that turned out to matter into the README's Deploy section.

## Sources

- Expo: [Submit to the Google Play Store](https://docs.expo.dev/submit/android/), [Creating a Google Service Account key](https://github.com/expo/fyi/blob/main/creating-google-service-account.md), [FCM credentials for push notifications](https://docs.expo.dev/push-notifications/fcm-credentials/)
- Google Play Console Help: [Device verification for new developer accounts](https://support.google.com/googleplay/android-developer/answer/14316361)
- The 12-tester, 14-day closed testing rule and the 2026 engagement checks: [Extendsclass: Google Play's closed testing requirement in 2026](https://extendsclass.com/blog/google-plays-closed-testing-requirement-what-developers-need-to-know-in-2026), [Testers Community: closed testing requirements 2026](https://www.testerscommunity.com/blog/google-play-closed-testing-requirements-2026)

Google changes Play Console menus and policies often. If a menu name here doesn't match what you see, search the Play Console help for the step's name.
