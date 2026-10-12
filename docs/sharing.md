# Sharing an alert

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** Sharing an alert sends a link, `https://hate-watch-api.fly.dev/a/<code>`, not text. In Messages, WhatsApp, Discord, X and Slack the link previews as a 1200×630 picture of the alert that the server draws from its own data, so it looks like a screenshot. On an iPhone with Hate Watch installed, tapping it opens the app on that alert (a universal link); without the app it goes to the App Store; anywhere else it's a web page with the card and a download button. The code is the first 11 characters of a SHA-256 of the alert's id (`shareCode()` in `server/src/db.ts`), and the server side is `server/src/share.ts`.

**Sections:**
- **Sharing an alert**: Sharing an alert sends a link, `https://hate-watch-api.fly.dev/a/<code>`, not text.

The README's "Sharing an alert" has the summary; this is the full detail. Read this index first, then only the part you need.

## Sharing an alert

**In short:** Sharing an alert sends a link, `https://hate-watch-api.fly.dev/a/<code>`, not text. In Messages, WhatsApp, Discord, X and Slack the link previews as a 1200×630 picture of the alert that the server draws from its own data, so it looks like a screenshot. On an iPhone with Hate Watch installed, tapping it opens the app on that alert (a universal link); without the app it goes to the App Store; anywhere else it's a web page with the card and a download button. The code is the first 11 characters of a SHA-256 of the alert's id (`shareCode()` in `server/src/db.ts`), and the server side is `server/src/share.ts`.

**Sharing, step by step** (`app/src/lib/share.ts`):

1. Tap the share icon on an alert card (`FeedCard`), or "Share this alert" on the alert's own screen. Developer notices have no share button.
2. Every feed item carries `shareUrl` (`feedItem` in `server/src/fanout.ts`: `HW_PUBLIC_URL`, default `https://hate-watch-api.fly.dev`, plus `/a/<code>`).
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

**`GET /a/<code>/card.png`** (`shareCard`): the card, drawn on the server from our own alert data with `satori` (layout to SVG) and `@resvg/resvg-js` (SVG to PNG). No user uploads, so no user-generated content to moderate.

- 1200×630, the size link previews show large. A near-black background with a red glow at the top.
- Top: a red dot and "HATE WATCH" on the left; the league ("NFL", "EPL") in a pill on the right ("NEWS" for a developer notice).
- Middle: a 168-pixel circle in the team's colour (a player's team colour; dark grey without one) with the team's code or the player's initials ("FF" for Freddie Freeman; Jr., Sr., II, III and IV are skipped), its text black or white, whichever reads on that colour. Team colours and initials, not ESPN logos or headshots: their images aren't ours to spread around. Next to it the title (cut to 110 characters, in one of three sizes by length) and the body (cut to 120, grey; a score like "LAD 0" doesn't break across lines).
- Bottom: the alert type's emoji and name, as in Settings, and a red "Get Hate Watch on the App Store" button.
- Text is Inter (500, 800 and 900 weights, from `@fontsource/inter`), with the Latin Extended subset so names like Dončić and Jokić draw. Emoji are Twemoji SVGs (16.0.1) fetched from jsDelivr, with a 3-second timeout and a blank space if one fails.
- Alerts never change, so cards are cached in memory (up to 300) and by HTTP for a day (`public, max-age=86400`). 404 for an unknown code.

**Opening the app (iOS universal links):**

- The app lists `applinks:hate-watch-api.fly.dev` in `ios.associatedDomains` (`app/app.json`), and the server's `/.well-known/apple-app-site-association` says app `G9V9266QK5.com.hatewatch.app` (`HW_IOS_APP_ID`: Apple Team ID plus bundle id) opens `/a/*` ("Shared alerts").
- iOS reads the association file (through Apple's CDN) when the app is installed or updated. If someone long-presses a link and picks "Open in Safari", iOS remembers that for the domain until they pick "Open in Hate Watch".
- Expo Router drops the domain and routes the path to `app/src/app/a/[code].tsx`. It fetches `GET /shared/<code>` (public: `{ item }`, the alert as a feed item, or 404) and shows the alert card, then "Get alerts like this about Freddie Freeman" with a Track button. A code that's gone says "This alert isn't available anymore." with "Go to your feed".
- The root layout's `unstable_settings.anchor = '(tabs)'` puts the tabs underneath, so Back works even on a cold start from a link.
- Android App Links aren't set up yet; they need `assetlinks.json` with the Play signing key fingerprint.

**Settings:** `HW_APP_STORE_URL` overrides the store link and `HW_PUBLIC_URL` the link's host. The App Store link only works once the app is released.

**Checked** in `server/test/share.test.ts`: feed items carry their link; an iPhone goes straight to the App Store; link previews get the page with the card as its image; the card is a 1200×630 PNG for teams and players, emoji and accents included; a developer notice shared from a build that still shows Share gets its page and card from Hate Watch; the association file names `/a/*` and the app can fetch the alert; and alerts from before share links get codes when the server starts.
