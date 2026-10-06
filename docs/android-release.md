# Releasing Hate Watch on Google Play (without owning an Android phone)

This is the full path from nothing to Hate Watch live on the Google Play Store, written for someone who builds on Windows and doesn't own an Android device. The app needs no code rewrite for Android: it's an Expo app, EAS builds it in the cloud, and `app.json` already has the Android package name (`com.hatewatch.app`), icons and notification channel.

Steps marked **🤖 Claude can do this** are things you can hand to me in a session.

## Before you start: what this takes

| | |
|---|---|
| **Money** | $25 one-time Google Play developer fee. Everything else here is free (EAS's free plan builds Android too). |
| **A real Android phone, for about 5 minutes** | Google makes new *personal* developer accounts verify they have access to a physical Android phone (Android 10 or newer, not rooted) through the Play Console app. An emulator doesn't count. Borrow a friend's or family member's phone; you sign in to the Play Console app, tap Verify, and sign out. (Step 9.) |
| **12 testers for 14 days** | New personal accounts must run a closed test with at least 12 people who opt in, for 14 days in a row, before Google unlocks the production release. If the count drops below 12, the 14 days start over, and Google checks that testers actually used the app. (Step 8.) |
| **Time** | About 3 weeks end to end, almost all of it the 14-day test. |

> **Skipping the phone and the 12 testers:** both rules apply to *personal* accounts. An *organization* developer account (for a registered business such as an LLC, with a D-U-N-S number) is exempt from both. If you already have a business, consider signing up as one. Otherwise, the personal route below works.

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

**🤖 Claude can do this:** once `google-services.json` is in `app/`, I add `"googleServicesFile": "./google-services.json"` under `android` in `app.json` and commit it.

## Step 3: Build the Android app with EAS

EAS builds Android in the cloud, so you don't need Android Studio for this step.

1. From the `app/` folder, build a test version you can install directly (an APK):
   ```bash
   npx eas-cli@latest build --platform android --profile preview
   ```
   The first Android build asks whether to **generate a new Android Keystore**. Answer **yes**. EAS creates the app's upload key and stores it for you; don't lose access to your Expo account, because that key is what lets you publish updates.
2. When it finishes, EAS gives you a link to the `.apk`.
3. Then build the store version (an `.aab`, the format Google Play requires):
   ```bash
   npx eas-cli@latest build --platform android --profile production
   ```
   `eas.json` already auto-increments the version code for each production build.

**🤖 Claude can do this:** after the first interactive build has created the keystore, later builds run from here without you, like the iOS builds.

## Step 4: Test it without a phone (Android emulator)

1. Install [Android Studio](https://developer.android.com/studio) on your PC (free). You only need it for its emulator.
2. Open **Device Manager** → **Create device** → pick a recent phone (for example a Pixel 8) → choose a system image **with Google Play** (it has the Play Store icon). This matters, because push notifications and in-app purchases need Google Play services.
3. Start the emulator, then drag the `.apk` from step 3 onto its window to install it.
4. Go through the app: the startup guide, tracking a team, the Feed, the Scores tab, Settings, the leaderboard. Allow notifications when asked, and check that alerts arrive while a tracked game is live.

The emulator can't do Google's device verification (step 9), but it's enough for testing.

## Step 5: Create the app and store listing in Play Console

1. In Play Console, click **Create app**. Name: **Hate Watch**. Default language: English (United States). App or game: **App**. Free or paid: **Free** (tips are in-app purchases, which free apps can have). Accept the declarations.
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
   - **Content rating:** complete the IARC questionnaire honestly (no violence, no user-generated content, no gambling, no location sharing). It should come out at the lowest rating.
   - **Target audience:** 18 and over. That keeps the app out of the stricter children's-app rules.
   - **Data safety:** the app collects **device or other IDs** (an app-generated device ID and the push token) for **app functionality**. It's not shared with third parties, it's encrypted in transit (HTTPS), and users can delete it (Settings → Delete all my data). It collects no name, email, location, contacts or photos. In-app purchases are processed by Google Play, and Hate Watch doesn't store payment details.
   - **News app:** no. **Government app:** no. **Financial features:** none. **Health:** none.

**🤖 Claude can do this:** render the 512 px icon, the 1024 × 500 feature graphic and 1080 × 1920 phone screenshots with the same tooling as the App Store screenshots, and draft both descriptions.

## Step 6: Let EAS upload to Play Console for you (service account)

EAS Submit uploads builds to Play Console using a Google Cloud service account.

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project (or reuse the Firebase one).
2. Go to **IAM & Admin** → **Service Accounts** → **Create service account**. Give it a name such as "eas-submit", click **Create and close**, and copy its email address.
3. On that service account, open **Manage keys** → **Add key** → **Create new key** → **JSON** → **Create**. A JSON file downloads. **Keep it private.**
4. Open the [Google Play Android Developer API](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) page and click **Enable**.
5. In Play Console, go to **Users and permissions** → **Invite new users**. Paste the service account's email. Under **App permissions**, add Hate Watch and grant: *View app information*, *Edit and delete draft apps*, *Release to production, exclude devices, and use Play App Signing*, *Release apps to testing tracks*, *Manage testing tracks and edit tester lists*, and *Manage store presence*. Click **Invite user**.
6. Upload the key to EAS: run `npx eas-cli@latest credentials --platform android` → **production** → **Google Service Account** → upload it as the key for **EAS Submit**. You can then delete your local copy.

**🤖 Claude can do this:** add the Android submit settings to `eas.json` (`"submit": { "production": { "android": { "track": "internal" } } }`) so builds can go to Play Console with `--auto-submit`, the same way iOS goes to TestFlight.

## Step 7: Internal testing (just you)

Internal testing is Google's TestFlight: up to 100 testers, available within minutes, and no review wait.

1. Submit the production build from step 3:
   ```bash
   npx eas-cli@latest submit --platform android --profile production
   ```
   (Or build and submit in one go with `eas build --platform android --profile production --auto-submit`.)
2. In Play Console, open **Testing** → **Internal testing** → **Testers**. Create an email list with your Google account and add a short release note.
3. Use the **opt-in link** on that page. Open it in the emulator's browser while signed in to the same Google account, and install Hate Watch from the Play Store. This is the version that can test the tips, because in-app purchases only work for an app installed from Google Play.
4. Check the **pre-launch report** a few hours later (under Testing, or in Quality). Google installs every testing-track build on real phones in its test lab, then shows crashes, screenshots and accessibility warnings. It's the closest thing to owning a few Android phones.

### The tips (in-app purchases)

1. In Play Console, set up a **payments profile** (Settings → Payments profile). Google asks for this before you can create products.
2. Go to **Monetize** → **Products** → **In-app products** (one-time products), and create the same three products the app already uses, with these exact IDs:
   - `com.hatewatch.app.tip.coffee`
   - `com.hatewatch.app.tip.pizza`
   - `com.hatewatch.app.tip.trophy`

   Give them names and prices (the iOS ones are $1.99, $4.99 and $9.99), then activate them. The app already treats them as consumable, so people can tip more than once.
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
- **🤖 Claude can do this: share links on Android.** Today a shared alert opens the App Store page. Once the Play listing is live, I can send Android visitors to the Play Store instead, and set up Android App Links (an `assetlinks.json` on the server, plus intent filters in `app.json`) so share links open the app directly when it's installed, like iOS universal links. That needs the app-signing SHA-256 fingerprint from Play Console → Setup → App signing.
- **🤖 Claude can do this: the README.** Once you've been through this once, I can fold the parts that turned out to matter into the README's Deploy section.

## Sources

- Expo: [Submit to the Google Play Store](https://docs.expo.dev/submit/android/), [Creating a Google Service Account key](https://github.com/expo/fyi/blob/main/creating-google-service-account.md), [FCM credentials for push notifications](https://docs.expo.dev/push-notifications/fcm-credentials/)
- Google Play Console Help: [Device verification for new developer accounts](https://support.google.com/googleplay/android-developer/answer/14316361)
- The 12-tester, 14-day closed testing rule and the 2026 engagement checks: [Extendsclass: Google Play's closed testing requirement in 2026](https://extendsclass.com/blog/google-plays-closed-testing-requirement-what-developers-need-to-know-in-2026), [Testers Community: closed testing requirements 2026](https://www.testerscommunity.com/blog/google-play-closed-testing-requirements-2026)

Google changes Play Console menus and policies often. If a menu name here doesn't match what you see, search the Play Console help for the step's name.
