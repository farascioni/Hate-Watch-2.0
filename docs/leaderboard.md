# Leaderboard

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** The podium button at the top left of every tab opens the most hated athletes and teams, ranked by how many people (devices) track them, filtered like the Feed: Everything, Teams or Players, in every sport or one league. Each filter is the top 100 ranked on the server within that filter, with 🥇🥈🥉 for the top three, ties shown as "T-2" with no gaps after them, and a note when the list is cut. It comes from `GET /leaderboard` (`server/src/leaderboard.ts`), public because it's only counts, never who.

**Sections:**
- **Leaderboard**: The podium button at the top left of every tab opens the most hated athletes and teams, ranked by how many people (devices) track them, filtered like the Feed: Everything, Teams or Players, in every sport or one league.

The README's "Leaderboard" has the summary; this is the full detail. Read this index first, then only the part you need.

## Leaderboard

**In short:** The podium button at the top left of every tab opens the most hated athletes and teams, ranked by how many people (devices) track them, filtered like the Feed: Everything, Teams or Players, in every sport or one league. Each filter is the top 100 ranked on the server within that filter, with 🥇🥈🥉 for the top three, ties shown as "T-2" with no gaps after them, and a note when the list is cut. It comes from `GET /leaderboard` (`server/src/leaderboard.ts`), public because it's only counts, never who.

**Opening it.** Every tab's header has a podium icon at the top left (`app/src/app/(tabs)/_layout.tsx`), instead of a sixth tab. It pushes `app/src/app/leaderboard.tsx`, titled "Leaderboard", with a Back button.

**The filter** (`FilterBar`, the same as the Feed and Tracking tabs, in the same words):

- **Everything / Teams / Players.** The third reads "Athletes" with All, "Players" in a league, "Drivers" in F1 and "Fighters" in the UFC (`playersTitle`, from each league's `ui.players`). The UFC has only fighters and college football only teams (`ui.kinds` in `server/src/leagues.ts`), so with those chips there's no choice to make.
- **The league chips:** All, then the leagues you track, then More (every league, by sport). "All" is the global board: Everything with All is every athlete and team in every sport, Teams with All is every team in every league.
- **Ranks count only what the filter shows**, so with MLB players picked the most hated MLB player is 1st, even if he's 40th overall.

**A row:** the rank, the photo or logo, the name with "Tracking" if you track them, the league tag and their subtitle, and the count on the right ("12 haters", "1 hater"). Tapping a row opens their page. Above the list: "Ranked by how many people track them on Hate Watch."

**Ranks and ties** (`leaderboard()`):

- Sorted by haters, most first; ties are listed by name (alphabetically).
- Ties share a rank, and the next count is the next rank with no gap: 1, T-2, T-2, 3 (the 3rd most hated count, not the 4th entry).
- The top three ranks get 🥇🥈🥉 instead of a number; a tie there shows "T-2" under the medal.
- The server flags a tie (`tied`) over the whole filtered list, not just the 100 it sends, so the 100th entry still reads as tied when the other half of the tie didn't fit.

**The top 100.** Each filter shows at most 100 entries, whatever a client asks for (`LEADERBOARD_MAX`; `limit` is clamped to 1–100). When there are more, the list ends with "Showing the top 100 of 224." If the 100th place falls inside a tie, it adds how many tied with it didn't fit: "124 more are also tied for 13th with 1 hater." Ties are listed by name, so that cut is alphabetical.

**Accuracy.** Each filter is ranked on the server from its own list, never by filtering the global top 100, so a league's board reaches its 100th entry even when the global board stops sooner. `server/test/leaderboard.test.ts` checks every filter (3 kinds × every league and All) against a brute-force count of a few thousand random follows, and that no request gets more than 100. On 2026-10-07 every filter on production matched a fresh count from its database. Switching filters quickly can't leave the wrong board up: each load is numbered and only the latest request's reply is shown, and the list clears while the new one loads.

**When it loads:** each time the screen is opened or comes back into view (so follows made elsewhere show), on every filter change, and on pull to refresh.

**Empty and failed:** "Nobody hates any NBA players yet", "Track someone and they'll show up here.", with "Show everything" when a filter is on (else "Find someone to hate", which opens Search). If the server doesn't answer: "Couldn't load the leaderboard" with "Try again".

**API:** `GET /leaderboard?kind=team|player&league=nfl&limit=100` → `{ entries: [{ rank, tied, haters, target }], total, moreTied }`. `total` is everyone in the filtered list; `moreTied` is how many tied with the last entry shown were left out. A `kind` other than `team` or `player`, or an unknown league, is a 400. It's counted live from `follows` with one grouped query: target keys are `kind:league:id`, so each filter is a key prefix (`team:nfl:%`, or `team:%` and `player:%` for Everything). A follow shows at once. A target that has left the catalog is dropped.
