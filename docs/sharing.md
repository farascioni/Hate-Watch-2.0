# Sharing an alert

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** Sharing an alert sends a link, `https://hate-watch-api.fly.dev/a/<code>`, not text. In Messages, WhatsApp, Discord, X and Slack the link previews as a 1200×630 picture of the alert that the server draws from its own data, so it looks like a screenshot. On an iPhone with Hate Watch installed, tapping it opens the app on that alert (a universal link); without the app it goes to the App Store; anywhere else it's a web page with the card and a download button. The code is the first 11 characters of a SHA-256 of the alert's id (`shareCode()` in `server/src/db.ts`), and the server side is `server/src/share.ts`. An alert that has other looks (a ticket stub, a boarding pass, a parking ticket, a scratch-off, a torn ticket, a void stamp) asks which one to share first; each look is its own link, `/a/<code>?s=<style>`, and its own picture (`server/src/share-styles.ts`). Settings' tally card also has "Share your season": a card of the device's whole run so far, with the same kind of link (`server/src/season.ts`, "The season card" below).

**Sections:**
- **Sharing an alert**: Sharing an alert sends a link, `https://hate-watch-api.fly.dev/a/<code>`, not text.
- **The season card**: "Share your season" in Settings makes a picture of the device's whole run so far (its Successful Hate Watches, alerts, low point and most-alerted team) and shares its link; it is not an alert.

The README's "Sharing an alert" has the summary; this is the full detail. Read this index first, then only the part you need.

## Sharing an alert

**In short:** Sharing an alert sends a link, `https://hate-watch-api.fly.dev/a/<code>`, not text. In Messages, WhatsApp, Discord, X and Slack the link previews as a 1200×630 picture of the alert that the server draws from its own data, so it looks like a screenshot. On an iPhone with Hate Watch installed, tapping it opens the app on that alert (a universal link); without the app it goes to the App Store; anywhere else it's a web page with the card and a download button. The code is the first 11 characters of a SHA-256 of the alert's id (`shareCode()` in `server/src/db.ts`), and the server side is `server/src/share.ts`. An alert that has other looks (a ticket stub, a boarding pass, a parking ticket, a scratch-off, a torn ticket, a void stamp) asks which one to share first; each look is its own link, `/a/<code>?s=<style>`, and its own picture (`server/src/share-styles.ts`). Settings' tally card also has "Share your season": a card of the device's whole run so far, with the same kind of link (`server/src/season.ts`, "The season card" below).

**Sharing, step by step** (`app/src/lib/share.ts`):

1. Tap the share icon on an alert card (`FeedCard`), or "Share this alert" on the alert's own screen. Developer notices have no share button. An alert with one look shares straight away; one with several first opens the "Share as" sheet (below), and the share continues with the link of the look picked.
2. Every feed item carries `shareUrl` (and, when it has other looks, `shareStyles`, below) (`feedItem` in `server/src/fanout.ts`: `HW_PUBLIC_URL`, default `https://hate-watch-api.fly.dev`, plus `/a/<code>`).
3. On iOS (and in a browser with a share sheet) the share sheet gets just the URL, so Messages shows one bubble: the card. Android's share sheet only takes text, so it gets "<emoji> <title>", a new line, and the link. If an alert has no `shareUrl` (an old server), it shares the text instead: the emoji and title, the body, and "via Hate Watch" with the app's devil emoji.
4. The sheet is titled "Share this alert", with the alert's title as the subject (email).
5. A browser with no share sheet copies the text to the clipboard instead, and the button says "Copied" for 2 seconds. Cancelling a share does nothing.

**The code** (`shareCode()`): the first 11 characters of the base64url SHA-256 of the alert's id, so the same alert always has the same link. It's stored in `events.share_code` and indexed (`events_share`). Alerts from before share links got theirs when the server started (`db.ts` fills in any missing ones at boot). A developer notice gets one too.

**`GET /a/<code>`** (`shareLink`):

- **An iPhone, iPad or iPod** (by user agent) that isn't a link-preview bot gets a 302 to the App Store (`HW_APP_STORE_URL`, default `https://apps.apple.com/app/id6819054268`), whether or not the code exists, uncached and varying on user agent. With the app installed iOS never asks the server: it opens the app (below).
- **Everyone else, including link-preview fetchers**, gets an HTML page (`sharePage` in `server/src/pages.ts`). Messages fetches previews as "facebookexternalhit … Twitterbot" and must never get the redirect, so anything whose user agent matches bot, crawl, spider, facebookexternalhit, preview, slack, discord, whatsapp, telegram or embed gets the page. The page has:
  - Open Graph tags (`og:title` the alert's title, `og:description` its body, `og:url`, `og:site_name` "Hate Watch", and `og:image` the card at `/a/<code>/card.png` with its type, 1200×630 size and alt text) and Twitter's (`summary_large_image`, `twitter:title`, `twitter:image`), so the preview is the card at full width.
  - Apple's Smart App Banner (`apple-itunes-app`, the app id taken from the store link).
  - The card as an image, a "Download Hate Watch on the App Store" button, and one sentence about the app.
  - Cached 5 minutes. A `HEAD` request is answered like `GET`, for preview fetchers that check first. Page and card URLs use the host the request came to (and `x-forwarded-proto`).
- **An unknown code** gets the same page with status 404, the title "This alert isn't available" and no image (or the App Store, on an iPhone).
- **Not indexed, but linked to the site.** The page carries `<meta name="robots" content="noindex, follow">` (`sharePage` in `server/src/pages.ts`): each is one thin page about one alert, and thousands of them would dilute hatewatch.dev's standing in search (`docs/seo-plan.md`, Phase 3). Below the download button a line links to `https://hatewatch.dev/about/`, "See how rival alerts work", so a visitor who isn't on an iPhone can reach the site.

**`GET /a/<code>/card.png`** (`shareCard`): the card, drawn on the server from our own alert data with `satori` (layout to SVG) and `@resvg/resvg-js` (SVG to PNG). No user uploads, so no user-generated content to moderate.

- 1200×630, the size link previews show large. A near-black background with a red glow at the top.
- Top: a red dot and "HATE WATCH" on the left; the league ("NFL", "EPL") in a pill on the right ("NEWS" for a developer notice).
- Middle: a 168-pixel circle in the team's colour (a player's team colour; dark grey without one) with the team's code or the player's initials ("FF" for Freddie Freeman; Jr., Sr., II, III and IV are skipped), its text black or white, whichever reads on that colour. Team colours and initials, not ESPN logos or headshots: their images aren't ours to spread around. Next to it the title (cut to 110 characters, in one of three sizes by length) and the body (cut to 120, grey; a score like "LAD 0" doesn't break across lines).
- Bottom: the alert type's emoji and name, as in Settings, and a red "Get Hate Watch on the App Store" button.
- Text is Inter (500, 800 and 900 weights, from `@fontsource/inter`), with the Latin Extended subset so names like Dončić and Jokić draw. Emoji are Twemoji SVGs (16.0.1) fetched from jsDelivr, with a 3-second timeout and a blank space if one fails.
- Alerts never change, so cards are cached in memory (up to 300) and by HTTP for a day (`public, max-age=86400`). 404 for an unknown code.

**Share looks** (`server/src/share-styles.ts`, `app/src/components/ShareStyleSheet.tsx`):

- `shareStyles(row)` says which looks an alert can be shared in, "classic" (the card above) always first. Each look has a builder that returns its card, or nothing when the alert lacks something the card prints, so a look applies only if its card can be drawn. Nothing is stored: looks are worked out from the alert's `type`, `meta`, `title` and `body` when asked, so old alerts and Recent misery rows have them too.

| Look (`?s=`) | Label | Applies to | Needs |
|---|---|---|---|
| `ticket` | Ticket stub | a team's loss: `team.lost`, `team.lost_as_favorite`, `team.lost_to_worse`, `team.shut_out`, `team.last_second_loss`, `team.blew_lead` | a team target and a final score in the body ("Final Score: 3 to 0") |
| `void` | Void | `team.eliminated` | a team target |
| `boarding` | Boarding pass | `f1.driver.lost_places` | a player target and "P<n> from P<m>" in the title |
| `citation` | Parking ticket | `player.ejected`, `nba.technical`, `nfl.penalty`, `cfb.team.penalty` | a player or team target, and for `nfl.penalty`/`cfb.team.penalty` the violation after "was flagged:" in the title (`player.ejected` and `nba.technical` have a default) |
| `scratch` | Scratch-off | `team.lost_as_favorite` | the win chance, the score, and both teams (`meta.winnerId`) |
| `torn` | Torn in half | `team.blew_lead` (a team's, live or final) | a team target and `meta.led` (the score is optional: without one it says "lead gone") |

- **Feed item:** `feedItem` adds `shareStyles: [{ id, label, url, image }]` when an alert has more than one look (never for a developer notice, and absent when only classic applies). `url` is `shareUrl` plus `?s=<id>` (classic: `shareUrl` alone) and `image` is `<shareUrl>/card.png?s=<id>` (the picture the sheet shows). A build that doesn't know the field ignores it, so the app side ships over the air.
- **The link:** `GET /a/<code>?s=<id>` serves the page with `og:image` and `twitter:image` pointing at `card.png?s=<id>`, so the preview in Messages or X is that look. `GET /a/<code>/card.png?s=<id>` draws it. The universal link `/a/*` ignores the query, so the app opens the alert as ever.
- **`?s=` is untrusted:** it comes from whoever built the link. A style that is unknown, or doesn't apply to that alert, is the classic card, never an error or a 404. The card cache is keyed by code and look (`code:style`, 300 at most).
- **The sheet:** `useShare(item)` (`ShareStyleSheet.tsx`) is the share button's logic for `FeedCard` and the alert screen. With `shareStyles` it opens "Share as", the looks as small previews of the server's cards, two to a row; tapping one closes the sheet and shares (on iOS 350 ms later, since it can't present its share sheet while a Modal is still leaving) that look's link (`shareAlert(item, url)`). Cancel or a tap outside closes it. A first card is drawn on demand, so a preview can take a moment (up to 3 seconds when an emoji has to be fetched); later ones come from the cache.
- **Not built:** a "rain check" look for delays and postponements, since no such alert exists.

**Opening the app (iOS universal links):**

- The app lists `applinks:hate-watch-api.fly.dev` in `ios.associatedDomains` (`app/app.json`), and the server's `/.well-known/apple-app-site-association` says app `G9V9266QK5.com.hatewatch.app` (`HW_IOS_APP_ID`: Apple Team ID plus bundle id) opens `/a/*` ("Shared alerts").
- iOS reads the association file (through Apple's CDN) when the app is installed or updated. If someone long-presses a link and picks "Open in Safari", iOS remembers that for the domain until they pick "Open in Hate Watch".
- Expo Router drops the domain and routes the path to `app/src/app/a/[code].tsx`. It fetches `GET /shared/<code>` (public: `{ item }`, the alert as a feed item, or 404) and shows the alert card, then "Get alerts like this about Freddie Freeman" with a Track button. A code that's gone says "This alert isn't available anymore." with "Go to your feed".
- The root layout's `unstable_settings.anchor = '(tabs)'` puts the tabs underneath, so Back works even on a cold start from a link.
- Android App Links aren't set up yet; they need `assetlinks.json` with the Play signing key fingerprint.

**Settings:** `HW_APP_STORE_URL` overrides the store link and `HW_PUBLIC_URL` the link's host. The App Store link only works once the app is released.

**Checked** in `server/test/share.test.ts`: feed items carry their link; an iPhone goes straight to the App Store; link previews get the page with the card as its image, a noindex tag and a link to the site; the card is a 1200×630 PNG for teams and players, emoji and accents included; a developer notice shared from a build that still shows Share gets its page and card from Hate Watch; the association file names `/a/*` and the app can fetch the alert; and alerts from before share links get codes when the server starts. The looks are checked in `server/test/share-styles.test.ts`: which looks each kind of alert gets and which it doesn't (no winner, no final score, a player-form blown lead, no places, no violation), that every look draws a 1200×630 PNG, that unknown looks (`nope`, `__proto__`) draw the classic card, that the link's `og:image` carries the look, and that the feed item lists its looks only when there is a choice.

## The season card

**In short:** "Share your season", the button at the bottom of the tally card in Settings (`HateWatchCounter`), shares one picture of a device's whole run so far: its Successful Hate Watches with the top three teams, its alerts, its low point and the team that gave it the most alerts. It is the weekly recap's counting over a longer range (`miserySpan` in `server/src/recap.ts`), kept as an `events` row so that it has a share code and a link like an alert's, but it is **not an alert**: no feed row, no push, no `publish()`. The loss rating is never printed on it.

**The route** (`POST /me/share/season`, signed in; `seasonCard` in `server/src/season.ts`): answers `{ url }`, `https://hate-watch-api.fly.dev/a/<code>` (`HW_PUBLIC_URL`, as for an alert). A device with no alerts and no Successful Hate Watch yet gets `400` and `{ "error": "No alerts yet" }`; the app shows "No alerts yet, so there is no season to share."

**What it counts.** From the device's first feed row or first Successful Hate Watch, whichever is earlier, to now, in the device's time zone (the one its quiet hours send, Eastern until set):

- **Successful Hate Watches:** the `hate_watches` rows in the range, with the top three teams by count (ties: the most recent loss first), the same table the Settings counter reads. So clearing the feed keeps them.
- **Alerts:** the device's feed rows in the range, without recaps and developer notices. "Clear feed" removes feed rows, so a card made after clearing counts fewer alerts, while its Successful Hate Watches stay.
- **Low point:** the worst loss, picked the way the recap picks it (an elimination first, then the biggest margin; "Successful Hate Watch! " dropped from the title).
- **Most alerts from:** the team or player (whoever the alert is about) with the most feed rows, recaps and notices not counted; someone who tracks only a player gets that player's name.

**The code and the row.** The id is `season:<hash16>:<day>:<alerts>-<watches>`: a hash of the device id (events outlive a device that deletes its data), the device's local day, and the two tallies. `seasonCard` does `INSERT OR IGNORE` and the share code is `shareCode(id)`, so asking again the same day with nothing new gives the same link, and a new tally is a new card; old links keep the card they showed. The row is type `app.season_card` (`SEASON_TYPE`, `server/src/share-styles.ts`), with the title "My season in misery: 7 Successful Hate Watches", a body that reads "Dodgers 3, Yankees 2, Giants 1. 20 alerts, Sep 15, 2026 to Oct 19, 2026. Low point: …" (the preview text) and `meta` `{ range, watches, alerts, teams, most, low }`. It lives in the same `events` table as alerts and uses the same index (`events_share`); nothing else reads that type (it is not in the alert catalog, and Recent misery keeps only the types it lists). No job prunes `events`, so a link lasts until the device deletes its data. "Delete all my data" removes the device's season cards, and their links stop working (`forgetSeasonCards`, called from `DELETE /me`).

**The page and the picture.** `GET /a/<code>`, `/a/<code>/card.png` and `GET /shared/<code>` serve it through the same code as an alert: the same Open Graph and Twitter tags, `noindex, follow`, the App Store redirect for an iPhone, 5 minutes of cache for the page and a day for the picture, 404 for an unknown code. The page's label is "Season in misery" (`sharedAlert` in `server/src/share.ts`). Its one look (`seasonSheet` in `share-styles.ts`; `?s=` is ignored, and the card is not in `STYLES`, so it has no "Share as" sheet) is the card's usual frame with:

- a red line, "MY SEASON IN MISERY · SEP 15, 2026 TO OCT 19, 2026";
- two big numbers, the Successful Hate Watches in red and the alerts in white, each with its label;
- up to three team chips (colour badge, name, count);
- "LOW POINT" with the worst loss, when there is one;
- "MOST ALERTS FROM <TEAM>" at the bottom.

**In the app** (`HateWatchCounter.tsx`, `shareSeason` in `app/src/lib/share.ts`, `api.shareSeason` in `app/src/lib/api.ts`): tapping "Share your season" asks the server for the link, then opens the native share sheet with the link on iOS and in browsers, or "My season in misery, via Hate Watch" with the app's devil emoji, a new line and the link on Android (the same split as an alert's share, step 3 above). A browser with no share sheet copies the text and the note under the button says "Copied". While it works the button is dimmed and ignores taps; a failure says "Couldn't make your season card. Try again." (`counter.share`, `counter.shareNone`, `counter.shareFailed`, `counter.shareMessage` in all six language files.) **Opened in the app.** On an iPhone with Hate Watch installed the link opens the shared-alert screen (`app/src/app/a/[code].tsx`, "Opening the app" above), which fetches `/shared/<code>` and draws the card as a feed card: the devil emoji, the label "Season in misery", the title and the body, then "Get alerts like this about <top team>" with a Track button. `FeedCard` reads only the item (never the alert catalog), so a type it doesn't list is not a problem; this was checked by reading the code, not on a phone.

The app part is JavaScript only, so it reaches phones as an over-the-air update, and only after the server is deployed: before that, the button gets a 404 and shows the failure line.

**Checked** in `server/test/season.test.ts`: a device with no alerts gets a 400 and the message; a season of losses and alerts gets a link whose page has the Open Graph tags and `noindex`, whose picture is a 1200×630 PNG, whose `/shared/` item is labelled "Season in misery" and nothing on the page or in the item mentions a rating, that adds no feed row or Successful Hate Watch, and that makes a new card when the tally changes and the same one when it doesn't; "Delete all my data" takes the cards with it; alerts without a loss make a card without a low point.
