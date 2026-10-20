# Startup guide

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** On a device's first launch the app opens a ten-page guide over the Feed (`app/src/app/guide.tsx`, a full-screen modal): what the app does, tracking, the Feed and sharing, the Scores tab, the leaderboard, alert settings, the counter, the Tracking tab's controls, Hate Watch Plus, and "You're all set". It shows once per install (`hatewatch.guideSeen` in AsyncStorage) and can be watched again from Settings → About → Show the guide. The notification permission prompt waits until the guide is closed.

**Sections:**
- **Startup guide**: On a device's first launch the app opens a ten-page guide over the Feed (`app/src/app/guide.tsx`, a full-screen modal): what the app does, tracking, the Feed and sharing, the Scores tab, the leaderboard, alert settings, the counter, the Tracking tab's controls, Hate Watch Plus, and "You're all set".

The README's "Startup guide" has the summary; this is the full detail. Read this index first, then only the part you need.

## Startup guide

**In short:** On a device's first launch the app opens a ten-page guide over the Feed (`app/src/app/guide.tsx`, a full-screen modal): what the app does, tracking, the Feed and sharing, the Scores tab, the leaderboard, alert settings, the counter, the Tracking tab's controls, Hate Watch Plus, and "You're all set". It shows once per install (`hatewatch.guideSeen` in AsyncStorage) and can be watched again from Settings → About → Show the guide. The notification permission prompt waits until the guide is closed.

**The pages,** in order (`PAGES`). Each has an icon (the first a large devil face), where in the app it is, a title, a sentence or two, and on most a drawing of the real control:

1. "Welcome to Hate Watch": track the players and teams you can't stand, and know within seconds when something goes wrong for them.
2. Search tab, "Pick who to hate": type a player or team and tap Track; it names the NBA, MLB, NFL, NHL, F1, Premier League and WNBA, and says you can track as many as you like.
3. Feed tab, "Every bad moment, live": alerts land in the feed newest first and arrive as notifications; a Successful Hate Watch shows how many other hate watchers got it ("23 other hate watchers"); the share icon sends one to a friend.
4. Scores tab, "Every game, live": the score, how badly it's going for them, who has the ball or who's pitching, the chance they lose; finals stay for a day; tap one for the play-by-play.
5. Top left of every tab, "See who's most hated": the leaderboard ranks athletes and teams by how many people hate them, filtered like the feed (drivers in F1, fighters in the UFC).
6. Settings tab, "Choose your alerts": each kind of alert on or off for every league, and the bell that decides between a notification and the feed only.
7. Settings tab, "Keep score": the Successful Hate Watch counter at the top of Settings, every time a team you track loses or the team of a player you track; "+3 more" shows every team.
8. Tracking tab, "Fine-tune one player or team": a drawing of Daniel Jones' card (a banner in the team's colour with the league and "214 haters", the avatar over its edge, the name, then the red X, bell, gear and Unfollow buttons along the bottom), then what each is: the hater count ("How many people hate them, you included."), the red X (with Hate Watch Plus, marks your most hated; their alerts get a red border in the Feed), the bell (no notifications about just them; their alerts still reach the feed), the gear (pick exactly which alerts you get about them, which beats the global settings) and Unfollow (stop tracking them entirely).
9. Settings tab, "Hate Watch Plus" (a gold-bordered drawing, `GOLD` from `app/src/theme.ts`): a monthly subscription that keeps the servers running and the app ad free, with the seven extras under Support Hate Watch in Settings: gold accents, gold app icon, most hated (the red X on the Tracking tab; red border in the Feed and on Scores game cards) and favorite teams (the heart on Search; while it plays, its opponent's alerts for that game reach you with a gold border in the Feed, and its next game shows in Up next, edged gold, or red for a most hated team), the alert vault (a gold star on each alert and its screen saves it to the Feed's Saved list, on this phone only), tracking profiles (groups of what you track that narrow the Feed and Tracking tab, not your notifications) and alert presets (one target's alert choices applied to another). It names no price: the store shows it.
10. "You're all set" (the last page): you can watch the guide again any time from Settings. On the first run it adds "Next, your phone will ask to send you notifications. Allow them so alerts reach you even when the app is closed."

**Moving through it:** swipe sideways (pages snap), or tap Next at the bottom. From the second page a Back link at the top left goes to the previous one. Skip at the top right closes it from any page but the last. Dots under the pages show where you are. The last page's button is "Find someone to hate" on the first run (it closes the guide and opens Search) and "Done" when rewatched (back to Settings). The pictures are drawings of the real controls, not live ones, so nothing in the guide changes settings.

**Motion:** the drawings move the way the marketing guide video does, but it is still a paged guide you tap or swipe through, not a video. The app and the web version share `guide.tsx`, so both get it, and it is JavaScript only (React Native's `Animated` with the JS driver, so the width and colour animations work on the web too), which is why it can go out as an over-the-air update.
- **Replays on every visit:** each page has its own clock (`p`, 0 to 3,000 ms) that restarts whenever the page becomes the current one, so going Back or Next plays that page's scene again. A page you leave finishes its entrance, so a swipe never shows a half-drawn page. The page's text (title, body) stays still; only the drawing and the icon move.
- **What moves:** the icon pops in with a pulse ring; the demo card slides and pops in (`Pop`) and its lines fade in (`Fade`). Search types a name, the card appears and the Track pill flips to Tracking. The Feed card flashes its border, counts "other hate watchers" up and bumps the share icon. Scores counts 17 to 24 and 78%, pops the "Down 7" pill and fills the chance bar. The leaderboard rows slide in while their haters count up. Alert settings flips the switches and the bell (the second row's bell goes from on to off). Keep score counts to 12 and shows the team chips. The Tracking controls card is ringed one control at a time, every 1.5 seconds, while its matching line stays bright and the others dim. Plus pulses a gold glow. The dots become a red pill that grows into place, and the last page's button pulses.
- **Reduce Motion:** with the system setting on (`AccessibilityInfo.isReduceMotionEnabled`, and it follows a change while the guide is open) every page's clock is set to its end at once, so each page shows finished and nothing moves.
- **Strings:** no new text; the motion reuses the existing `guide.*` and `ui.*` keys in all six languages.

**Once per install** (`app/src/lib/guide.ts`):

- On launch the root layout (`app/src/app/_layout.tsx`) asks `needsGuide()`, once the navigator is ready. If `hatewatch.guideSeen` isn't in AsyncStorage, it opens `/guide?first=1`; otherwise it settles the guide at once. A storage error counts as seen: better no guide than a stuck one.
- The guide marks itself seen (the time) as soon as it opens, so quitting the app halfway through doesn't bring it back next launch.
- Deleting the app clears AsyncStorage, so a reinstall shows it again.
- It's a full-screen modal with a fade, and it can't be swiped down; Skip, Done or the last button close it.

**Rewatch:** Settings → About → "Show the guide" ("How tracking and alerts work") opens `/guide` without `first=1`: no notification line on the last page, and the last button says Done and returns to Settings.

**Notification permission waits for it:** `guideSettled` is a promise that resolves when the guide closes (finished or skipped), or at once on a launch that doesn't show it. The store awaits it before `registerForPush()`, so on first launch the system prompt comes right after the guide instead of covering it. The last page warns that the prompt is coming.

**Small screens:** each page scrolls vertically on its own if it doesn't fit (small phones, large text sizes). It's checked on iPhone SE (375×667) and 390×844.
