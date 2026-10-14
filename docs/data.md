# Data: rosters, duplicates, and images

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** Every team and player comes from ESPN's public API. The server reads it all again every 6 hours (`ingest()` in `server/src/catalog.ts`), and right away when what the read collects changes (`INGEST_VERSION`, now 5). Players are deduplicated twice: on ESPN athlete id, then on normalized name plus birth date. Nothing is committed with a duplicate key or a player without an image, and every photo and game-league logo is fetched to check it exists. A player ESPN has no photo for shows their team's logo with their jersey number, never someone else's face. F1 constructors, which have no logos on ESPN, get a drawn badge instead.

**Sections:**
- **Data: rosters, duplicates, and images**: Every team and player comes from ESPN's public API.

The README's "Data: rosters, duplicates, and images" has the summary; this is the full detail. Read this index first, then only the part you need.

## Data: rosters, duplicates, and images

**In short:** Every team and player comes from ESPN's public API. The server reads it all again every 6 hours (`ingest()` in `server/src/catalog.ts`), and right away when what the read collects changes (`INGEST_VERSION`, now 5). Players are deduplicated twice: on ESPN athlete id, then on normalized name plus birth date. Nothing is committed with a duplicate key or a player without an image, and every photo and game-league logo is fetched to check it exists. A player ESPN has no photo for shows their team's logo with their jersey number, never someone else's face. F1 constructors, which have no logos on ESPN, get a drawn badge instead.

Teams and rosters come from the ESPN endpoints documented in [pseudo-r/Public-ESPN-API](https://github.com/pseudo-r/Public-ESPN-API): `site.api.espn.com/apis/site/v2/sports/<sport>/<league>/teams?limit=100` and `/teams/{id}/roster` (`urls` in `server/src/leagues.ts`). They cover the **NBA, WNBA, MLB, NFL, NHL, Formula 1 and the Premier League (EPL)**. The UFC and college football are read their own way (below). The NHL is included because several of the requested alerts are hockey alerts. ESPN files soccer leagues under a code rather than a name: the EPL is `soccer/eng.1`, and college football is `football/college-football`. That code is kept as `slug` in `LEAGUES`, and every ESPN URL goes through it (`path()` in `leagues.ts`). The catalog's keys are `team:<league>:<espnId>` and `player:<league>:<espnId>` (`teamKey`, `playerKey`), so the same ESPN id in two leagues is never one row.

**The latest full ingest** was on the development database on 2026-10-11 at 18:01 UTC, with `INGEST_VERSION` 5. Its report is the `ingest:report` row in `kv`, which `GET /catalog/report` serves. It has **309 teams and 6,980 players**, 203 of them added from injured lists. It noted no problems. These are the development database's counts; production's aren't checked here. The README's previous count, from the ingest of 2026-10-06, was 150 teams and 5,505 players (seven leagues then).

| | Teams | Players | Verified headshots | Logo fallback |
|---|---|---|---|---|
| NBA | 30 | 618 | 603 | 15 |
| WNBA | 15 | 221 | 200 | 21 |
| MLB | 30 | 1,303 (182 injured) | 1,257 | 46 |
| NFL | 32 | 2,554 | 2,551 | 3 |
| NHL | 32 | 840 (21 injured) | 822 | 18 |
| F1 | 11 constructors | 23 drivers | 15 | 8 (team badge) |
| EPL | 20 | 585 | 38 | 547 (club crest) |
| UFC | 1 (a placeholder, never shown) | 836 fighters | 829 | 7 (UFC badge) |
| College football | 138 FBS teams | none (teams only) | | |

**How an ingest runs, step by step** (`ingest()` in `catalog.ts`). The leagues go one at a time, in `LEAGUE_IDS` order:

1. **Teams.** It reads the league's team list and drops inactive teams (`isActive: false`) and All-Star teams (`isAllStar`). It dedupes teams on ESPN id, then on abbreviation as a second guard, noting `<league>: duplicate team <name> dropped`.
   - The logo is ESPN's `default` logo (not its dark one). If there isn't one, it's `a.espncdn.com/i/teamlogos/<league>/500/<abbrev>.png`.
   - The dark-mode logo (`logoDark`) is ESPN's `dark` one, when it has one; 296 of the 309 teams do.
   - The team colour and second colour come as hex with a `#` added: the Houston Astros are `#002d62` and `#eb6e1f`.
   - Every logo is fetched, eight at a time (`mapLimit(…, 8)`), to confirm it exists and record its size. A team without a logo stops the whole ingest ("refusing to ingest a team without an image"), so the old catalog stays.
2. **Rosters,** six teams at a time. MLB, NFL and NHL rosters group players by position (`{ position, items }`), and the NBA's is a flat list. Both are flattened.
3. **Injured lists.** It reads the league's injury report and adds anyone on it who isn't on a roster (`injuredOffRoster`), under the team the report lists them with. A player's id comes from the report's athlete, or from the `/id/<n>` in their player-card link. A report group whose team isn't in the league's catalog is skipped. If the report fails to load, the ingest carries on with the rosters alone.
4. **Dedupe** on ESPN id, then on normalized name plus birth date (details below).
5. **Players,** 24 at a time. Each gets a key, name, short name, main position, every position (`positionsOf`), jersey and team. Then its image is checked (details below).
6. **Checks before anything is written.** Every team and player key must be unique across all leagues ("duplicate key after dedupe"), and every player must have an image with a width ("player without image"). Either failure throws, and nothing is written.
7. **One transaction.** Teams are upserted (`ON CONFLICT(key) DO UPDATE`), so a team is never deleted. Players are replaced: `DELETE FROM players`, then every player is inserted again. A player who has left every roster leaves the catalog. Their follows are kept, so they come back if they're signed again.
8. **Afterwards.** It saves the report to `kv` as `ingest:report`, along with the UFC's weight classes and belts (`ufc:weight-classes`, `ufc:belts`) and college football's conferences (`cfb:conferences`). Then it reloads the in-memory catalog and the search index (`loadCatalog()`).

The log line for each league reads, for example, `[ingest] MLB: 30 teams, 1303 players (182 from injured lists, 1257 headshots, 46 logo fallbacks, 0 dupes removed)`.

- **EPL players mostly show their club crest.** ESPN has photos for only a few Premier League players (38 of 585), so the rest get the crest. That's the same accuracy-first fallback as call-ups elsewhere. Soccer headshots are all in one folder, whatever the league (`a.espncdn.com/i/headshots/soccer/players/full/<id>.png`). The EPL's injury report added nobody (0 in the 2026-10-11 ingest), so EPL rosters are ESPN's rosters alone.
- **Every position played.** A roster entry has its main position and `positions`, every one ESPN lists them at this season. Shohei Ohtani is DH, P and SP. Miguel Rojas, who has pitched mop-up innings, is 2B, RP, P, 1B, 3B, SS, DH and PH. `positionsOf` in `catalog.ts` puts the main position first and drops repeats, and returns null when ESPN lists none. The list is stored comma-separated as `players.positions` (`"DH,P,SP"`). It decides which alerts fit a player: a pitcher's alert settings have no hitting alerts, and a skater's no goalie alerts (`server/test/positions.test.ts`). `INGEST_VERSION` 3 rebuilt the catalog to read it.
- **Injured lists too.** A player on MLB's 60-day IL comes off the 40-man roster ESPN serves, and NHL players on long-term injured reserve are left off too. So Carlos Correa wasn't on the Astros. The ingest also reads each league's injury report and adds anyone on it who isn't on a roster to the team it lists them under (`injuredOffRoster` in `catalog.ts`), with the same duplicate checks and headshot verification. A player on the 10-day IL, like Cristian Javier, is still on the 40-man roster and isn't added twice (`server/test/catalog-injured.test.ts`). NBA and NFL rosters already include their injured players: the first real run added 189 MLB players, 25 NHL players and none for the NBA or NFL (commit d7c1087, 2026-10-06).
- **Box score players too (basketball).** A live game's box score can list players no roster does: preseason rosters leave out two-way and camp players (Rienk Mast, 20 minutes, and Keba Keita, 10, for the Pacers at Thunder, October 13 2026). `GameTracker` adds each one it reads to the catalog (`addBoxPlayers`, on the box score's team: ESPN's headshot if it has one, else the team's logo, position blank when ESPN says "Not Available"), so he can be searched, followed and named in alerts. The next ingest keeps them for 30 days (`catalog:box-added` in `kv`, `BOX_KEEP_MS`) unless a roster lists them by then.
- **Refreshes every 6 hours, counted from the last one** (`INGEST_EVERY_MS`, `nextIngestIn`). Deploys restart the server, and a timer that started over on each restart kept putting refreshes off. Now the server reads when the last ingest ran and waits only what's left. In the test, a deploy at 16:00 UTC after an ingest at 12:50 waits 2 hours 50 minutes, keeping the 18:50 refresh. An overdue refresh runs at once. After that first refresh, one runs every 6 hours (`setInterval` in `index.ts`).
- **`INGEST_VERSION` rebuilds right away.** A change to what the ingest collects bumps `INGEST_VERSION`. A report from an older version (or from before versions existed) makes the next boot rebuild in the background at once. The versions so far:
  - 2: injured lists (commit 8292ab3, 2026-10-06)
  - 3: every position played (967a823, 2026-10-07)
  - 4: UFC weight classes (7443305, 2026-10-10)
  - 5: college football (9fca8a2, 2026-10-10)
- **A failed refresh keeps the old catalog.** The server logs `[ingest] refresh failed, keeping previous catalog`, and nothing is written, because the write happens only after every league has been read. F1, the UFC and college football are read in steps of their own. If one of them fails, that league keeps the rows it already has and the failure becomes a note in the report, without stopping the other leagues. This came after a deploy on 2026-10-10 at 15:06 UTC: ESPN's F1 entry list was a 404 before the grid was out, the whole refresh failed, and the new college football teams didn't arrive (commit f970f7b). Any other league's failure, such as a team list that won't load or a missing logo, still stops the whole refresh.
- **A missing league is read on boot.** If any league in `LEAGUE_IDS` has no teams in the catalog, the server starts a full ingest in the background right away. That's how F1 arrived on the existing server, and later the WNBA, the UFC and college football. An empty catalog is read before the server listens (see Run it).
- **No duplicates.**
  - Players are deduped on ESPN athlete id first. The first entry is kept, and the rest are noted: `<league>: <name> (<id>) listed on HOU and …; kept first`.
  - Then a second pass catches one person under two ESPN ids: the same normalized name and the same birth date (`dateOfBirth`). It applies only when ESPN gives a birth date. `normalize()` removes accents, lowercases, and turns anything that isn't a letter, digit or space into a space, so "José Ramírez" and "Jose Ramirez" match.
  - Teams are deduped on id and abbreviation.
  - The ingest throws rather than commit a duplicate key, and the database primary keys (`teams.key`, `players.key`) enforce it again.
- **Every team and player has an image.** The ingest won't commit a player without one ("player without image"), or an NBA, WNBA, MLB, NFL, NHL or EPL team without a logo it has fetched. College football's logos aren't fetched (they're all 500×500 on ESPN), and the UFC's and F1's teams use drawn badges.
- **Images are checked for accuracy.** A headshot is ESPN's own URL from the roster, or `a.espncdn.com/i/headshots/<league>/players/full/<id>.png`. Two checks are logged as problems in the report, but neither stops the ingest. A headshot URL must contain that athlete's own ESPN id (`/<id>.png`), and ESPN's alt text must match the player's name after `normalize()`; the mismatches are counted in `headshotAltMismatch`, and there were 0 in every league. Every image is fetched to confirm it exists and to record its true pixel size (`probePng` in `server/src/espn.ts`).
  - It asks for only the first 32 bytes (`Range: bytes=0-31`), checks the PNG signature, and reads the width and height from the IHDR header (bytes 16 and 20).
  - A 404, or a response that isn't an image, means no photo. Other failures are tried 3 times, 8 seconds each, with waits of 0.3, 0.6 and 1.2 seconds. After that the image counts as missing too, which is why the audit below checks every fallback again.
- **No wrong faces.** When ESPN has no photo for a player (practice squads and call-ups, mostly), the player gets their team's logo, never a guess (`imageKind: 'team_logo'`). In the 2026-10-11 ingest that was 103 players across the NBA, WNBA, MLB, NFL and NHL. The app draws them as the **team logo plus a jersey-number badge** in the team's colour (`app/src/components/Avatar.tsx`).
- **Images are scaled properly.** The app asks ESPN's image combiner (`a.espncdn.com/combiner/i?img=…&w=…&h=…`) for exactly the pixels it draws: the size in points times the screen density (`PixelRatio`), at the image's native aspect ratio, and never larger than the source (`sizedImage` in `app/src/lib/images.ts`). That matters because sizes vary. In the 2026-10-11 catalog, 6,313 headshots are 600×436, 2 are 600×600, and one NFL logo is 4096×4096. Every other ESPN logo in the catalog is 500×500. Headshots use cover with top anchoring, so faces aren't cropped. Logos use contain, so the whole mark shows, with ESPN's dark-mode variant when it exists. Only ESPN images go through the combiner. A `badge://` image is drawn by the app.
- **Search** comes from the same catalog (`search()` in `catalog.ts`). Names are normalized the same way. An exact match scores 100, a prefix 80, every word matching the start of a word 60, and a match anywhere else 30. Teams get 5 points more, so a team comes before a player with the same score. Teams that aren't listed (the UFC's placeholder) are left out.
- **The image switches** (`images.headshots`, `images.logos`) take ESPN's photos and logos out of everything the server sends, without a build. A team or player then gets a `badge://hidden` image, which the app draws as a badge in the team's colour with its code, and a player's jersey number (`withoutImages` in `server/src/images.ts`; CLAUDE.md has the commands). The catalog itself keeps its images.
- **The UFC** (ESPN's `mma`) has no rosters. Its fighters come from the UFC cards on ESPN's scoreboard, read a month at a time, from 24 months back to 3 months ahead (`ingestUfc`). Each fighter's weight class is the one from their latest fight, and the Contender Series is left out. Fighters need a team, so they all belong to one placeholder, "Ultimate Fighting Championship" (`UFC_TEAM`), which no list or search shows. Its logo is a UFC badge in the UFC's red (`badge://ufc`). A fighter who already has a checked photo keeps it; only new fighters, and those still without a photo, are checked again. The details are in `server/src/ufc.ts` and `ufc-classes.ts`.
- **College football** is teams only: the FBS (ESPN group 80), read from its conferences, with no rosters and no logo checks (ESPN's are all 500×500), in about 24 reads (`ingestCfb`). A read that finds fewer than 100 teams is treated as a bad read, and the teams already in the catalog are kept. Its season starts in July (`cfbSeason`). The details are in `server/src/cfb-poll.ts`.

**Formula 1 is different** (ESPN sport `racing`, league `f1`):

- **Drivers** are the ones who actually raced this season: the championship standings plus this weekend's entry list. The season's athlete list also includes reserves.
- **Team and car number** come from this weekend's entry list. ESPN's athlete records can be stale after a team move: Lindblad's record says "Red Bull #36", but he races the Racing Bulls #41. The record is only the fallback, for a driver who isn't entered (e.g. Tsunoda, replaced mid-season).
- **Which entry list:** the latest session of the weekend whose entry list ESPN serves. A race's list is a 404 until its grid is out (the evening after qualifying), even though the scoreboard already lists its cars. If no session's list loads, the athlete records alone decide (`ingestF1` in `catalog.ts`).
- **A driver whose team matches no constructor** is skipped and noted in the report ("matches no constructor; skipped"), rather than put on the wrong team.
- **Constructors have no logos on ESPN** (404, `logos: null`). Rather than use trademarked logos from elsewhere, the app draws a badge in the team's official ESPN colour with a code, with black or white text for contrast. The colour falls back to grey (`#888888`) when ESPN has none. The image is `badge://f1` (`F1_BADGE`), and the codes are `F1_CODES`: ALP, AMR, AUD, CAD, FER, HAA, MCL, MER, RB, RBR, WIL. The text colour is whichever reads better on the team's colour (`readableOn` in `Avatar.tsx`): dark on Alpine's yellow (`#FFF500`) and Williams' white, white on Ferrari's red. Drivers without an ESPN headshot (8, all re-checked as 404) get that badge plus their car number. In the 2026-10-11 ingest they were Antonelli (12), Bearman (87), Bortoleto (5), Colapinto (43), Hadjar (6), Lawson (30), Lindblad (41) and Piastri (81).

Audit it yourself: `cd server && node test/verify-catalog.ts`.

It reads the database at `HW_DB` (by default `server/data/hatewatch.db`) and prints:

- duplicate player keys, and duplicate ESPN ids within a league
- players with the same name on the same team
- players without an image, and teams without a logo
- every headshot size and logo size, with how many of each
- headshots whose URL isn't keyed by the player's own id
- every logo fallback checked again against ESPN with a `HEAD` request, as a tally of status codes. Every one should be a real 404, not a network failure.

It opens the database through `db.ts`, as the server does, so an older database gets any missing tables and columns added, the same as on a server start.
