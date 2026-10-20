# Successful Hate Watch counter

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** The top of Settings counts the device's Successful Hate Watches, each time a team it tracks loses (or the team of a player it tracks), or a UFC fighter it tracks loses, with the teams and fighters that gave it the most. The server counts them in `publish()` (`server/src/hate-watches.ts`) for every device the loss is addressed to, whatever its alert settings, once per device and loss, and sends the new tally over the WebSocket. Every Successful Hate Watch alert also says how many other people got it ("23 other hate watchers"). Clearing the feed keeps the count; "Delete all my data" removes it. A "Share your season" button at the bottom of the card shares the device's whole run as a picture (`docs/sharing.md`, "The season card").

**Sections:**
- **Successful Hate Watch counter**: The top of Settings counts the device's Successful Hate Watches, each time a team it tracks loses (or the team of a player it tracks), or a UFC fighter it tracks loses, with the teams and fighters that gave it the most.

The README's "Successful Hate Watch counter" has the summary; this is the full detail. Read this index first, then only the part you need.

## Successful Hate Watch counter

**In short:** The top of Settings counts the device's Successful Hate Watches, each time a team it tracks loses (or the team of a player it tracks), or a UFC fighter it tracks loses, with the teams and fighters that gave it the most. The server counts them in `publish()` (`server/src/hate-watches.ts`) for every device the loss is addressed to, whatever its alert settings, once per device and loss, and sends the new tally over the WebSocket. Every Successful Hate Watch alert also says how many other people got it ("23 other hate watchers"). Clearing the feed keeps the count; "Delete all my data" removes it. A "Share your season" button at the bottom of the card shares the device's whole run as a picture (`docs/sharing.md`, "The season card").

**What you see** (`app/src/components/HateWatchCounter.tsx`, the first card in Settings):

- The total, large and red, then "Successful Hate Watch" or "Successful Hate Watches", and under it "Each time a team or fighter you track lost." (or, at 0, "Your first one lands when a team or fighter you track loses."). While it's loading the number is "–".
- Up to three chips for the teams that gave it the most, each with the logo, the short name and the count: "Falcons 4 · Hawks 3 · Guardians 2". F1 constructors show their full names there, since ESPN's F1 short names are junk (Ferrari is "JK").
- With more than three teams, a "+2 more" chip. Tapping it expands the card into every team it has hate watched, most first, one row each with the logo, full name, league tag and count; "Show less" folds it back. The change animates.
- **"Share your season"**, a button at the bottom of the card: asks the server for the link to the device's season card (`api.shareSeason`, `POST /me/share/season`) and opens the share sheet with it (`shareSeason` in `app/src/lib/share.ts`). The button dims while it works. A browser with no share sheet copies the text and the note under the button says "Copied"; a device with no alerts yet gets "No alerts yet, so there is no season to share."; any other failure says "Couldn't make your season card. Try again." The card, its counting and its page are in `docs/sharing.md`, "The season card".

**What counts** (`HATE_WATCH_TYPES` and `isHateWatch`):

- `team.lost`: a team you track loses ("Successful Hate Watch! Eagles lost to the Bears"). That includes an elimination and a blowout, which are the loss with other words; an alert that counts as a loss through its aliases counts too.
- `player.team_lost`: the team of a player you track loses ("Successful Hate Watch! Freddie Freeman and the Dodgers lost to the Giants") In a preseason NBA or WNBA game a player the box score doesn't list gets no such alert, so it adds nothing to the count for someone who tracks only him (Knicks at Raptors, October 13 2026: 8 of 21; `docs/alerts.md`, "Their team loses").
- `<soccer league>.team.heavy_loss`: a 3+ goal loss ("Coventry were thrashed 5-0 by Brighton"), sent instead of the plain loss to those who want it.
- `f1.team.no_points`: your constructor finishes outside the points, and `f1.team.double_dnf` (a double DNF), which is also a no-points finish.
- `ufc.lost`: a fighter you track loses. A fighter has no team, so this one counts under the fighter (`player:ufc:<id>`), and the fighter gets a chip and a row in the list like a team does. That's on purpose: the counter is every loss you hate watched, teams and fighters.
- Draws and ties send no loss, so they never count.

**Counted under the team, once per loss** (`hateWatchOf`). A player's "their team lost" and soccer's 3+ goal loss carry the team loss's own event id (`meta.lostId`) and the team's key (`meta.teamKey`), and are recorded under those. (The loss's other facts sent in its place, like "lost as 78% favorites" from `lossFacts`, carry `lostId` too but aren't recorded themselves; the loss alongside them already counted for every tracker.) So tracking Freddie Freeman puts the Dodgers on the list, never Freeman, and tracking the Dodgers and Freeman (or Freeman and Mookie Betts) counts one loss once. The table `hate_watches` has one row per device and event id (`ON CONFLICT DO NOTHING`), so re-polls and restarts never count twice. The UFC is the exception: `ufc.lost` is about the fighter, so a fighter you track appears on the list under their own name.

**When it's counted** (`publish()` in `server/src/fanout.ts`). Right after a new alert is stored, for every device it's addressed to (everyone tracking its target, plus, for a team's alert, anyone tracking one of its players with "Get their team's alerts" on), a Successful Hate Watch adds a row, before the device's alert settings are checked. So turning "Loses a game" or "Their team loses" off doesn't stop the count, and neither does the type's league switch. Each device whose count went up gets `{ kind: 'hateWatches', tally }` on its open sockets at once. A device that tracks nobody involved isn't counted.

**Taken back.** When an alert's facts change after it went out (an F1 result a penalty changed, `reviseEvent`), and it's withdrawn or no longer a Successful Hate Watch, its rows are deleted and each device that had one gets its new tally.

**Kept and reset.** Settings → Clear feed doesn't touch the count (the rows aren't feed rows). "Delete all my data" (`DELETE /me`) does: `hate_watches` rows cascade with the device.

**"23 other hate watchers."** Every Successful Hate Watch alert says how many other people got it in their feed: on the Feed card, on the alert's own screen, and on the game's final on the Scores tab ("1 other hate watcher", "0 other hate watchers"; `AlsoGot` in `app/src/components/ui.tsx`).

- It's `alsoGot` on the feed item (`feedItem` in `fanout.ts`): the alert's recipients minus you, only for a loss alert (`isLossAlert`: a Successful Hate Watch type, or an alert carrying `lostId`; not one that was withdrawn).
- Read from the database, it's the `RECIPIENTS` column: for a loss with a game, the number of different devices that got any loss alert from that game and league, the team's or a player's (each device gets one); otherwise the alert's own feed rows (indexed by `feed_event`).
- It's settled when the alert goes out: `publish()` works out who gets each alert before sending any, and adds up a loss moment's deliveries across its alerts, so the live alert carries the number too.
- On the Scores tab, `withHateWatch` adds `hateWatch: { alsoGot }` to this device's copy of a final that gave it a Successful Hate Watch, and the app keeps it on the card when everyone's score frames update the game.
- People with the loss alert off don't get the alert, so they don't count in it and don't see a number (though their counter still went up).
- Example (`server/test/hate-watches.test.ts`): three devices track an NFL team and one has "Loses a game" off. The loss counts for all three; the two that got it each see "1 other hate watcher"; the one with it off sees no number on the final.

**Losses from before the counter.** On the first start with it, the server counted the `team.lost`, `f1.team.no_points` and `f1.team.double_dnf` alerts already in each feed, plus the ones that happened while a device tracked the team (followed before the loss was detected) but never reached its feed because the alert was off. A `kv` flag (`hate_watches_backfilled`) makes this run once. Players' "their team lost" came later and is only counted as it happens.

**API:** `GET /me/hate-watches` → `{ total, teams: [{ target, count }] }`, most first (ties: the most recent loss first). The app reads it every time its socket connects, and takes each `hateWatches` frame as it comes.

**Checked** in `server/test/hate-watches.test.ts`: losses from before the counter (in a feed, and with the alert off; not one from before the device tracked the team), a loss counting for every tracker with the alert on or off, once, with one `hateWatches` frame; the winners not counting; the "others" count live, from the feed, and on the Scores tab; clearing the feed keeping the count; an F1 constructor out of the points and a double DNF counting while a game start doesn't; and "Delete all my data" taking the count with it.
