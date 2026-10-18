# Favorite teams

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** a Hate Watch Plus subscriber can favorite a team (the heart on Search and a team's page). A favorite is not tracked (a favorite's games are on My games, though): while it plays, the alerts about its opponent in that game reach the device's feed and push, with the favorite's own alert choices and push switch, and once the game is over nothing more about that opponent does. Favorites are listed in Settings under Support Hate Watch.

**Sections:**
- **Favorite teams**: what a favorite does, where it's added and listed, and the settings per favorite.
- **How it works**: the game registry, the routing in `publish()`, what a favorite is not (a hate watch, a follow), the server routes and the database.
- **Trying it**: the developer switch for Plus and the test event.
- **Limits**: what it does not do.

The README's "Favorite teams" has the summary; this is the full detail. Read this index first, then only the part you need.

## Favorite teams

**In short:** rooting for the Tampa Bay Rays, tonight's Cleveland Guardians alerts (a score against them, a loss, a flag, anything a team's alert says) land in your feed and push to your phone; when the game is over the Guardians' alerts stop. Only the opponent team's own alerts route, not its players'.

- **Adding:** the heart on a team's row in Search and on a team's own page (`FavoriteButton`, `app/src/components/FavoriteButton.tsx`), nowhere else. Teams in leagues with games, and F1 constructors (a constructor's page): not the UFC. An F1 constructor favorite has no alerts of its own: no bell and no ⚙️ in Settings, only the ✕; it colors the constructor's drivers gold in the F1 tables (below). Without Plus the heart is hidden, until the subscription is found active again. There is no limit on how many.
- **Listing:** Settings, under Support Hate Watch, a "Favorite teams" card (`Favorites`, `app/src/components/Favorites.tsx`): each favorite's logo, name and league, its **push bell** (the Tracking tab's), a ⚙️ and an ✕ that removes it. A subscriber with none sees a hint; a non-subscriber always sees the card locked (a lock, "A Hate Watch Plus perk", no buttons), whatever the server still holds.
- **Choosing alerts per favorite:** the ⚙️ opens the alerts screen in favorite mode (`/alerts/<team key>?fav=1`, `app/src/app/alerts/[key].tsx`): the same switches and bells as a tracked team's, but for the opponent's alerts in this team's games. A choice here beats the global setting for those alerts only; "Use global setting" removes it. The push switch off keeps the alerts in the feed without a push for that favorite.
- **Lapsing:** when the store says there is no active subscription (a cancelled or unrenewed one: `lapsePlus`, checked at launch and each time the app returns to the foreground), every favorite is removed, with the most hated list: the server's (`DELETE /me/favorites`, retried at the next check if it fails offline) and the app's copy (`onLapse` in `lib/plus.ts`, read by `lib/store.tsx`). The hearts and the working card stay hidden until the store reports a subscription again; the favorites are not restored. An error or being offline never lapses.

## How it works

- **Registry (`server/src/favorites.ts`):** `publish()` knows an alert's team and game id, not who the team played, so each `GameTracker` registers its game's two sides when it starts (`registerGame`, in memory, dropped after 36 hours; a restarted tracker registers again when it attaches). `opponentOf(league, gameId, team)` gives the side to look for. Matching on the game id is what ends it: the opponent's alerts in another game match nobody, and the loss, published as the game finishes, still matches.
- **Routing (`recipients()` in `fanout.ts`):** a team alert's recipients are its trackers, the trackers of its players with "Get their team's alerts" on, and now the devices that favorite the game's other side (`favoriters`). Tracking the team wins: such a device gets the ordinary alert, once. The game id is the alert's `meta.gameId`, or the first part of its id.
- **The favorite's choices (`favoritePrefs`):** the device's settings with the team's alert choices and push switch replaced by the favorite's (`types`, `push_types`, `push`); quiet hours, sound and the rest still apply.
- **Not a hate watch:** a favorite roots against the opponent, so its feed row is marked `feed.fav = 1`: no Successful Hate Watch is recorded for it, no hate watch streak line, and it is left out of "N other hate watchers" (`RECIPIENTS`) and the tally (`hateWatchTally`).
- **Scanning:** `scanScoreboard` also attaches a tracker to a game of a favorite team (`favoriteTeamKeys`, cached 3 seconds), so a game nobody tracks is still read. It is not in `watchedTeamKeys()`. A favorite's game is a card on "My games" all the same: `deviceTeams` (`scores.ts`) keeps the favorites in a set of their own, `favs`, that only `involves` reads (for `gamesFor` and the WebSocket push), while `teams` stays the tracked teams, which the lock screen board and Up next use (a favorite's next game is a row in "Up next": `startUpNext` reads both sets, and `GET /me/scores` lists `upNextFor` the device's teams and favorites). Adding or removing a favorite drops the device's cached answer (`forgetDeviceTeams`), so the card appears at once. A favorite F1 constructor brings every F1 session, as a follow does (`mine.f1`).
- **Game starts:** a favorite gets "Hate Watch Starting" once per game: it is the opponent's start alert (the title names the opponent first), kept under the favorite's own "Game starts" choice. It needs the tracker to see the game before it begins, which the scan does within 3 minutes of the start (`docs/alerts.md`, Game starts).
- **F1 constructors in gold and red:** a favorited constructor's drivers are drawn with a gold left edge, a gold tint, a gold name and a ♥, and a most hated constructor's with the red edge, tint, name and ❌ (`useF1Tone`, `app/src/lib/f1Tone.ts`; red wins when both, as on every card, feed row and the lock screen; a driver you track keeps the red tint). It applies to the race results and running order (`RaceOrder`), the starting grid (`F1PreviewView`, `F1Grid`) and the drivers' and constructors' championship tables (`F1Preview.tsx`), where a marked constructor's rows are always listed. A favorite constructor brings no alerts (a race has no single opponent, so `opponentOf` finds none; `favorites.test.ts`), only these colors and its race on My games (`deviceTeams` adds its session to `f1`).
- **Errors:** the fielding team's `mlb.fielder.error` alert ("Cleveland Guardians committed an error", id `${gameId}:${playId}:mlb.fielder.error:team-${teamId}`, or the text-keyed id on a runner's play with no batter) goes to the trackers of that team and, through `recipients()`, to the favorites of the other side, under their own "Commits an error" choice (Defense). It is made whenever the play is an error, even if the fielder can't be matched to a player, shares the play's moment with the fielder's own alert (a device that tracks both gets one alert) and is not revised when ESPN moves the error to another fielder (`revisedResult` looks at player alerts only). Trackers of the team get it too, with the type's defaults (on, push).
- **Up next's gold edge:** an Up next row whose game has a favorite on either side is edged gold (2 px, `UpNextRow.tsx`), red if a most hated team is in it too.
- **The feed's gold edge:** a favorite's feed row carries `fav` (`feedItem` in `fanout.ts`, from `feed.fav`; on the live frame and every feed read), and the Feed tab draws that card with a gold border (`GOLD`, 2 px, `FeedCard.tsx`; only on the Feed tab, like the most hated border). A most hated target's alert stays red if both apply (the lock screen's colors: favorite gold, most hated red).
- **Database:** `favorites` (`device_id`, `team_key`, `created_at`, `push`, `types`, `push_types`; primary key device and team) and `feed.fav` (`server/src/db.ts`).
- **Routes (`server/src/api.ts`):** `GET /me/favorites`; `PUT /me/favorites/:key` (a team in a league with games, or an F1 constructor; 404 otherwise); `PUT /me/favorites/:key/settings` with `{push?, types?, pushTypes?}` (a `null` removes a choice); `DELETE /me/favorites/:key`; `DELETE /me/favorites`. "Delete all my data" removes them with the device.
- **App:** `store.tsx` keeps `favorites` (loaded with the rest, empty on a server from before), `addFavorite`, `removeFavorite` (rolled back on an error) and `updateFavorite` (optimistic).

## Trying it

In a development build, Settings has "🧪 Hate Watch Plus (dev): on/off" beside the test event (`useDevPlus` in `app/src/lib/plus.ts`, kept in `AsyncStorage` as `hw.devPlus`, `__DEV__` only): on, the device reads as subscribed everywhere. Run the server with `HW_DEV=1` (`docs/run-it.md`). "🧪 Send a test event" then picks at random among what the device follows and its favorites; for a favorite it registers a made-up game (`sim-game-<uuid>`) against another team of its league and publishes one of that team's alerts, which reaches the favorite's feed. Tests: `server/test/favorites.test.ts`.

## Limits

- Plus is checked on the device only (`expo-iap`); the server stores a favorite from any device that sends one (`docs/known-limits.md`).
- The game registry is in memory: a restart forgets it until each tracker attaches again and registers (within a scan).
- Only the opponent team's own alerts route, not its players', and no news, injury or standings alert (they have no game).
- Lapsing clears the server's favorites, but the app's list stays until the next launch (the UI is hidden without Plus).
- A favorite who also tracks the opponent gets the ordinary alert (and its hate watch), not a second copy, and the tracked team's own settings (its ⚙️ choices and bell) decide it, not the favorite's (`test/favorites.test.ts`).
