# An alert on its own screen

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** A card in a list shows three lines of an alert's text; tapping it opens the alert on its own screen (`app/src/app/alert/[id].tsx`) with all of its text, its clip, how many other hate watchers got it, when it happened, who it's about and a Share button. The screen shows the feed's copy when there is one, so a line added later appears live, and otherwise the copy that was tapped. A developer notice opens the same way, from Hate Watch, with no page to open and nothing to share. Tapping a push notification opens its alert's screen too.

**Sections:**
- **An alert on its own screen**: A card in a list shows three lines of an alert's text; tapping it opens the alert on its own screen (`app/src/app/alert/[id].tsx`) with all of its text, its clip, how many other hate watchers got it, when it happened, who it's about and a Share button.
- **The alert vault**: a Hate Watch Plus star on the card and a Save button here keep an alert on this device; the Feed's Saved chip lists them.

The README's "An alert on its own screen" has the summary; this is the full detail. Read this index first, then only the part you need.

## An alert on its own screen

**In short:** A card in a list shows three lines of an alert's text; tapping it opens the alert on its own screen (`app/src/app/alert/[id].tsx`) with all of its text, its clip, how many other hate watchers got it, when it happened, who it's about and a Share button. The screen shows the feed's copy when there is one, so a line added later appears live, and otherwise the copy that was tapped. A developer notice opens the same way, from Hate Watch, with no page to open and nothing to share. Tapping a push notification opens its alert's screen too.

**Where it opens from:** any alert card (`FeedCard`): the Feed, a game's "Your alerts from this game", a player's or team's "Recent Misery", and a shared alert's screen. The card shows the title and three lines of the body; tapping it calls `openAlert` (`app/src/lib/alerts.ts`), which remembers the tapped alert in memory and opens `/alert/<id>` (the id URL-encoded, and decoded again on the screen, as is if it can't be). **A push notification** opens it too: `NotificationRouter` in `app/src/app/_layout.tsx` reads `Notifications.useLastNotificationResponse()` and, for a default tap whose `data.eventId` is a string, pushes `/alert/<eventId>` (cold start included), then clears the response (`clearLastNotificationResponse`) so a remount or reload doesn't open it again. The screen waits for the feed if it hasn't loaded, and shows "This alert isn't in your feed anymore." if the alert is gone.

**What's on it, top to bottom:**

- The header "Alert", with Back.
- **Who it's about:** a row with their photo or logo, name and subtitle and a chevron, which opens their player or team page, as the card's photo does. A target that has left the catalog has no row. A developer notice shows the app's icon, "Hate Watch" and "From the developer" instead, and doesn't open anything.
- **The title** with the alert's emoji, and **the whole body**, every line of it, including lines added after it went out. Both can be selected and copied.
- **"N other hate watchers"** on a Successful Hate Watch (see the counter section).
- **When:** the league tag (not on a notice), the alert type's name, and the date and time ("Sat, Oct 11, 4:05 PM"), with "(2h ago)" when it's less than a day old.
- **Its clip**, when it has one (`AlertClip`).
- **"Share this alert"** (not on a notice): the same share as the card's button (see Sharing an alert). Where the link can only be copied (a browser without a share sheet) it says "Copied" with a check for 2 seconds.

**Which copy it shows:** the feed's copy of that alert when the feed has it, so a fact that comes later (an `eventUpdate` frame that adds a line) shows up live on the open screen; otherwise the one that was tapped (`openedAlert`), which covers alerts from a game screen, a player's page or a share link that aren't in the loaded feed. An alert in neither (a link to an alert that was cleared, after the app restarted) says "This alert isn't in your feed anymore." with "Go to your feed"; while the app is still loading it shows a spinner instead.

## The alert vault

**In short:** a Hate Watch Plus subscriber can save an alert with the star on its feed card (`FeedCard`) or the Save button at the bottom of its screen, and list them with the **Saved** chip at the top of the Feed. Kept on the device only.

- **Where:** `app/src/lib/savedAlerts.ts` (the store: AsyncStorage key `hw.savedAlerts`, a Map of whole `FeedItem`s, oldest saved first), the star in `app/src/components/FeedCard.tsx`, the Save button next to Share in `app/src/app/alert/[id].tsx`, the Saved chip and vault view in `app/src/app/(tabs)/index.tsx`.
- **Who sees it:** only a subscriber: the star, the Save button and the Saved chip are drawn for no one else. A lapse hides them but keeps the saved list on the device, and it is back on subscribing again. A developer notice has no star.
- **Why a snapshot:** the alert is kept whole so it stays after the server's feed has paged past it. Its `clip` is dropped, so the server's `clips.*` switches (`server/src/flags.ts`) still govern video. The alert's screen finds it with `feed`, then `openedAlert`, then the vault.
- **The Saved chip:** swaps the Feed for the saved alerts, newest first, still filtered by the league and Teams/Players bar and grouped by day. The feed's own copy of a saved alert wins while the feed still has it (a fact added later shows). The feed stops paging in vault mode; pull to refresh still refreshes the feed. Empty: "Nothing saved yet".
- **Limits:** at most 300 (the oldest saved is dropped); not restored on a new phone; a retracted alert stays saved. Only "Delete all my data" (`deleteAllData` in `app/src/lib/store.tsx`) clears it; a lapse (`lapsePlus`) does not. The vault does not touch the feed merge (`mergeFeed`), so `docs/duplicate-alerts.md` is unaffected.
