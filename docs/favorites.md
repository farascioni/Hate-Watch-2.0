# Favorite teams

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** a Hate Watch Plus subscriber can favorite a team (the heart on Search and a team's page). A favorite is not tracked: while it plays, the alerts about its opponent in that game reach the device's feed and push, with the favorite's own alert choices and push switch, and once the game is over nothing more about that opponent does. Favorites are listed in Settings under Support Hate Watch.

**Sections:**
- **Favorite teams**: what a favorite does, where it's added and listed, and the settings per favorite.
- **How it works**: the game registry, the routing in `publish()`, what a favorite is not (a hate watch, a follow), the server routes and the database.
- **Trying it**: the developer switch for Plus and the test event.
- **Limits**: what it does not do.

The README's "Favorite teams" has the summary; this is the full detail. Read this index first, then only the part you need.

## Favorite teams

**In short:** rooting for the Tampa Bay Rays, tonight's Cleveland Guardians alerts (a score against them, a loss, a flag, anything a team's alert says) land in your feed and push to your phone; when the game is over the Guardians' alerts stop. Only the opponent team's own alerts route, not its players'.

- **Adding:** the heart on a team's row in Search and on a team's own page (`FavoriteButton`, `app/src/components/FavoriteButton.tsx`), nowhere else. Teams in leagues with games only: not F1 or the UFC. Without Plus the heart is hidden, until the subscription is found active again. There is no limit on how many.
- **Listing:** Settings, under Support Hate Watch, a "Favorite teams" card (`Favorites`, `app/src/components/Favorites.tsx`): each favorite's logo, name and league, its **push bell** (the Tracking tab's), a ⚙️ and an ✕ that removes it. A subscriber with none sees a hint; a non-subscriber always sees the card locked (a lock, "A Hate Watch Plus perk", no buttons), whatever the server still holds.
- **Choosing alerts per favorite:** the ⚙️ opens the alerts screen in favorite mode (`/alerts/<team key>?fav=1`, `app/src/app/alerts/[key].tsx`): the same switches and bells as a tracked team's, but for the opponent's alerts in this team's games. A choice here beats the global setting for those alerts only; "Use global setting" removes it. The push switch off keeps the alerts in the feed without a push for that favorite.
- **Lapsing:** when the store says there is no active subscription (a cancelled or unrenewed one: `lapsePlus`, checked at launch and each time the app returns to the foreground), every favorite is removed, with the most hated list: the server's (`DELETE /me/favorites`, retried at the next check if it fails offline) and the app's copy (`onLapse` in `lib/plus.ts`, read by `lib/store.tsx`). The hearts and the working card stay hidden until the store reports a subscription again; the favorites are not restored. An error or being offline never lapses.

## How it works

- **Registry (`server/src/favorites.ts`):** `publish()` knows an alert's team and game id, not who the team played, so each `GameTracker` registers its game's two sides when it starts (`registerGame`, in memory, dropped after 36 hours; a restarted tracker registers again when it attaches). `opponentOf(league, gameId, team)` gives the side to look for. Matching on the game id is what ends it: the opponent's alerts in another game match nobody, and the loss, published as the game finishes, still matches.
- **Routing (`recipients()` in `fanout.ts`):** a team alert's recipients are its trackers, the trackers of its players with "Get their team's alerts" on, and now the devices that favorite the game's other side (`favoriters`). Tracking the team wins: such a device gets the ordinary alert, once. The game id is the alert's `meta.gameId`, or the first part of its id.
- **The favorite's choices (`favoritePrefs`):** the device's settings with the team's alert choices and push switch replaced by the favorite's (`types`, `push_types`, `push`); quiet hours, sound and the rest still apply.
- **Not a hate watch:** a favorite roots against the opponent, so its feed row is marked `feed.fav = 1`: no Successful Hate Watch is recorded for it, no hate watch streak line, and it is left out of "N other hate watchers" (`RECIPIENTS`) and the tally (`hateWatchTally`).
- **Scanning:** `scanScoreboard` also attaches a tracker to a game of a favorite team (`favoriteTeamKeys`, cached 3 seconds), so a game nobody tracks is still read. It is not in `watchedTeamKeys()`, which also feeds the Scores tab, so a favorite's game is no card on "My games"; the Scores tab's "Up next" adds the favorites on top (`startUpNext` reads both sets, and `GET /me/scores` lists `upNextFor` the device's teams and favorites), so a favorite's next game is a row there like a tracked team's.
- **Game starts:** a favorite gets "Hate Watch Starting" once per game: it is the opponent's start alert (the title names the opponent first), kept under the favorite's own "Game starts" choice. It needs the tracker to see the game before it begins, which the scan does within 3 minutes of the start (`docs/alerts.md`, Game starts).
- **Up next's gold edge:** an Up next row whose game has a favorite on either side is edged gold (2 px, `UpNextRow.tsx`), red if a most hated team is in it too.
- **The feed's gold edge:** a favorite's feed row carries `fav` (`feedItem` in `fanout.ts`, from `feed.fav`; on the live frame and every feed read), and the Feed tab draws that card with a gold border (`GOLD`, 2 px, `FeedCard.tsx`; only on the Feed tab, like the most hated border). A most hated target's alert stays red if both apply (the lock screen's colors: favorite gold, most hated red).
- **Database:** `favorites` (`device_id`, `team_key`, `created_at`, `push`, `types`, `push_types`; primary key device and team) and `feed.fav` (`server/src/db.ts`).
- **Routes (`server/src/api.ts`):** `GET /me/favorites`; `PUT /me/favorites/:key` (a team in a league with games, 404 otherwise); `PUT /me/favorites/:key/settings` with `{push?, types?, pushTypes?}` (a `null` removes a choice); `DELETE /me/favorites/:key`; `DELETE /me/favorites`. "Delete all my data" removes them with the device.
- **App:** `store.tsx` keeps `favorites` (loaded with the rest, empty on a server from before), `addFavorite`, `removeFavorite` (rolled back on an error) and `updateFavorite` (optimistic).

## Trying it

In a development build, Settings has "🧪 Hate Watch Plus (dev): on/off" beside the test event (`useDevPlus` in `app/src/lib/plus.ts`, kept in `AsyncStorage` as `hw.devPlus`, `__DEV__` only): on, the device reads as subscribed everywhere. Run the server with `HW_DEV=1` (`docs/run-it.md`). "🧪 Send a test event" then picks at random among what the device follows and its favorites; for a favorite it registers a made-up game (`sim-game-<uuid>`) against another team of its league and publishes one of that team's alerts, which reaches the favorite's feed. Tests: `server/test/favorites.test.ts`.

## Limits

- Plus is checked on the device only (`expo-iap`); the server stores a favorite from any device that sends one (`docs/known-limits.md`).
- The game registry is in memory: a restart forgets it until each tracker attaches again and registers (within a scan).
- Only the opponent team's own alerts route, not its players', and no news, injury or standings alert (they have no game).
- Lapsing clears the server's favorites, but the app's list stays until the next launch (the UI is hidden without Plus).
- A favorite who also tracks the opponent gets the ordinary alert (and its hate watch), not a second copy, and the tracked team's own settings (its ⚙️ choices and bell) decide it, not the favorite's (`test/favorites.test.ts`).
