# Officials

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** referees and umpires can be tracked like a player or a team. They have no team of their own, only a heading in search ("MLB Umpires", "NBA Officials"). Six alert types fire for whoever tracks one: a ball/strike call overturned by an ABS challenge, a replay that overturns a call, a coach's challenge won against the crew, a call overturned on review, an NFL call reversed on replay, and a game the crew works starting (first pitch, tip-off, kickoff). Every alert but the ABS one names the crew, not one person.

**Sections:**
- [Officials](#officials): what they are, which leagues, how to find one, the six alerts, what is not built.
- [How it works](#how-it-works): where the names come from, the key, the wording rule, one alert per moment, the settle waits.
- [Settings and defaults](#settings-and-defaults): on, feed only; what Settings and the WNBA ignore.
- [Limits](#limits): attribution, when an official becomes searchable, restarts, the leagues left out.
- [Tests](#tests): the test file and the tests it changed.

The README's "Officials" has the summary; this is the full detail. Read this index first, then only the part you need.

## Officials

**In short:** an official is a target, like a player or team, with the key `official:<league>:<slug>` (`official:mlb:angel-hernandez`). Track one from search and their alerts come to your feed. There is no official page, no photo (the app draws initials on the league colour), no stats and no leaderboard, by design: the group heading ("MLB Umpires") is only how search lists them, and cannot be tracked.

- **Leagues:** NBA, MLB and NFL (`OFFICIAL_LEAGUES` in `server/src/leagues.ts`). ESPN lists no officials for the EPL or college football. The NHL, WNBA, UFC and F1 are not covered.
- **Finding one:** officials count as athletes. Search's Athletes filter lists them after the players, under their group heading, and there is no Officials filter. `GET /search?kind=player&officials=1` returns them as `{kind: 'official', key, league, name, group, initials}`; without `officials=1` search never returns one, so builds up to 12 never meet a team-less target. `PUT /me/follows/:key` accepts an official key (`team/player/official` in its 404). A key starting `official:` resolves through `targetDto` like any other.
- **The six alerts** (title is `<Name>'s crew <what>`, or `<Name> <what>` where one person is meant):
  - `mlb.ump.abs_overturned` (Overturned, "Ball/strike overturned"): "had a ball/strike call overturned by an ABS challenge". Names the home plate umpire only.
  - `mlb.ump.review_overturned` (Overturned, "Replay overturns a call"): a replay review overturned a call. From the crew chief's review and from a team's replay challenge that ESPN reports overturned.
  - `nba.ref.challenge_won` (Challenges and reviews, "Coach's challenge won"): the crew "lost a coach's challenge".
  - `nba.ref.review_overturned` (Challenges and reviews, "Call overturned on review"): a ref-initiated review overturned the call.
  - `nfl.ref.reversed` (Overturned, "Call reversed on replay"): the play was REVERSED.
  - `mlb.ump.game_start`, `nba.ref.game_start`, `nfl.ref.game_start` (Game, "Game starts"): "Hate Watch Starting: <Name>'s crew works <away> at <home>", body "<Tip-off | First pitch | Kickoff> at <venue> · <TV>" (with the round for a playoff game). `officialStartEvents` in `server/src/detectors.ts`, called next to `gameStartEvents` in `server/src/live.ts`. Fires once, when the tracker that saw the game before it started sees it begin; a game first seen already under way, or whose crew ESPN names only after it starts, gets none. Id `<gameId>:<type>:ump-<slug>`, the moment `<gameId>:start` shared with the teams' start, so a device that tracks a team and an official of the game gets one alert, and the official's "<Name>'s crew works it." is a line on it (a device tracking only the official gets the alert itself).
- **Not built:** NHL officials, blown-call alerts beyond what ESPN labels as overturned, per-official stats, a leaderboard, an official page.

## How it works

- **Where the names come from.** ESPN's game summary has `gameInfo.officials` (a name and a position, no id, no photo). `readOfficials` in `server/src/live.ts` runs for a game in `OFFICIAL_LEAGUES`: it reads `fullName ?? displayName` and `position.displayName ?? position.name`, adds each to the catalog (`addOfficials` in `server/src/catalog.ts`, the `officials` table, the in-memory map and the search index; the log says "new official in the catalog"), and sets the game's crew (`ctx.crew`). A summary with no officials leaves the last crew alone.
- **The key.** `officialSlug(name)` lower-cases, strips diacritics and `jr/sr/ii/iii/iv`, and turns anything else into `-`. `officialKey(league, name)` is `official:<league>:<slug>`. Two officials with the same name in one league merge into one, which is accepted.
- **The wording rule.** `crewAlerts` in `server/src/detectors.ts` makes one alert per official in the crew, each with the id `<gameId>:<playId>:<type>:ump-<slug>` and that official's key as the target. Nothing says which official made a call except a home plate ABS ruling, so the title says "<Name>'s crew" for every official; the `only` position pattern (`/home plate/i` for ABS) is what switches to the plain name. An empty crew makes no alert.
- **One alert per moment.** `bundleByPlay` has nothing to fold a teamless key into, so every official alert carries an explicit moment (`<gameId>:<playId>:abs`, `:review` or `:official`). A device tracking two of the crew gets the first; a device tracking a team of the same moment gets the team's alert.
- **The settle waits.** An overturn can flip back. ESPN flipped an overturn twice in ALCS game 1. So the ABS overturn waits `ABS_SETTLE_MS` (30 s, `HW_ABS_SETTLE_MS`) and goes only if the overturn stood (`holdAbs` is inverted for these: it holds back the ones that were taken back, not the ones that stood), and a replay overturn waits `CHALLENGE_SETTLE_MS` (45 s, `HW_CHALLENGE_SETTLE_MS`) through `challengeSettled`, which now handles any outcome, not only "confirmed". The NBA and NFL alerts have no wait.
- **Scoping.** Official alerts never reach the hate watch counter, loss or misery types, or the leaderboard; `recipients()` gives a key that is not a team or player only its own followers; `/targets/:key/stats` is a 404 for an official; favorites reject an official. Details of the id and the moment: `docs/duplicate-alerts.md` "Layer 1".

## Settings and defaults

- All six are `scope: 'official'`, `defaultOn: true`, `defaultPush: false`: on, in the feed, no push. They only reach someone who tracks an official, so on is harmless, and a push is the person's choice. This is not in `LOSS_PUSH`.
- The six are in `quiet-defaults` as added-since: an install from before gets them on, feed only.
- Settings lists alerts by league and by player/team scope. An `official` scope type is in neither: the app's Settings must skip `scope === 'official'` in its league groups, and the Tracking screen lists them under "Officials" for a tracked official.
- They are not cloned for the WNBA (`OFFICIAL_TYPES` is added after the NBA types are copied).

## Limits

- **Attribution.** Only the ABS overturn names a person (the home plate umpire). Everything else says "the crew", because ESPN does not say who made a call. Nothing is a stat on one official.
- **Searchable late.** An official is added to the catalog when the server first sees a started game's summary naming the crew. Before that they cannot be found. Pre-game indexing is not built.
- **Empty crew.** The crew is empty until a started game's summary names it, and after a server restart. An alert in that gap is skipped, not sent without a crew.
- **NBA crew.** ESPN's NBA list can include alternates (the order-0 entries may not all be floor officials). "Supported" is read as the call standing; not confirmed.
- **Savings switch.** `savings.summary-on-demand` stops the summary reads officials depend on; with it on, the crew stays empty.
- **Game start.** Feed only, like the other five, while a team's start now pushes by default: someone who tracks only an official sees the start in the feed and gets no notification unless they turn the bell on. A crew ESPN names only after the game starts gets no start alert.
- **Leagues.** No NHL, WNBA, UFC or F1 officials.

## Tests

`server/test/officials.test.ts` (13 tests): the slug, the catalog and search, the DTO and group, each of the five call detectors on real ESPN play shapes, the game start (all three sports), the crew wording, an empty crew, the ABS settle (standing and taken back), the replay overturn, following an official, and the one-alert-per-moment rule.

Changed: `sections.test.ts` (Settings' groups leave out official-scope types), `wnba.test.ts` (the twin test leaves them out), `quiet-defaults.test.ts` (the five ids are feed-only and added-since).
