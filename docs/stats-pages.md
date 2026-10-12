# Stats pages

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** Every player and team page opens on a **Stats** tab (next to "Recent misery"): a player's season line, postseason and career, their last five games and their team's next game; a team's record and standing, its season line (the EPL's league table instead), its last five results and its next game; F1 drivers and constructors their championship season, and UFC fighters their record. The numbers worth gloating about (strikeouts, interceptions, errors, cards) are in red when there are any, and in a team's form an L is the green one. The server builds each page from ESPN at `GET /targets/:key/stats` (`server/src/stats.ts`) and keeps it for 10 minutes.

**Sections:**
- **Stats pages**: Every player and team page opens on a **Stats** tab (next to "Recent misery"): a player's season line, postseason and career, their last five games and their team's next game; a team's record and standing, its season line (the EPL's league table instead), its last five results and its next game; F1 drivers and constructors their championship season, and UFC fighters their record.

The README's "Stats pages" has the summary; this is the full detail. Read this index first, then only the part you need.

## Stats pages

**In short:** Every player and team page opens on a **Stats** tab (next to "Recent misery"): a player's season line, postseason and career, their last five games and their team's next game; a team's record and standing, its season line (the EPL's league table instead), its last five results and its next game; F1 drivers and constructors their championship season, and UFC fighters their record. The numbers worth gloating about (strikeouts, interceptions, errors, cards) are in red when there are any, and in a team's form an L is the green one. The server builds each page from ESPN at `GET /targets/:key/stats` (`server/src/stats.ts`) and keeps it for 10 minutes.

**Where it shows.** A player's or team's page (`app/src/app/target/[key].tsx`, opened from Search, the Tracking tab, a roster, the leaderboard, a game card's team or an alert) has two tabs under the name, the hater count and the Track button: **Stats**, which opens first, and **Recent misery** (your alerts about them from the last 24 hours). The stats are fetched alongside the page. If ESPN doesn't answer, the tab says "Couldn't load the stats. ESPN didn't answer." with "Try again". A team's roster, with its position chips, follows under both tabs. The same stats also have a screen of their own, `app/src/app/stats/[key].tsx` (titled "NYY stats"), kept for links that still open it; nothing in the app links there now. Both draw `StatsView` (`app/src/components/StatsView.tsx`).

**What's on a page, top to bottom:**

- **Record** (teams, and UFC fighters): the overall record, large ("93-68"), ESPN's standing summary under it ("2nd in AL East"), and the splits ESPN has ("Home 46-34 · Road 47-34"; "Away" where ESPN calls it that).
- **Stat groups**, each a heading and a grid of tiles. A tile is the number, ESPN's short label ("SO"), and what it means ("Strikeouts"). A tile marked bad is drawn in red with a red-tinted frame.
- **"Last 5 games"** ("Last 5 races" in F1, "Last 5 fights" in the UFC; "Last 3 games" when there are only three). A team's section starts with its form, oldest to newest, as round chips: an L is green (a Successful Hate Watch), a W plain, a tie or draw grey. Then one row per game: the date ("Oct 6"), "vs" or "@", the opponent's logo and code, and the result and score ("L 2-5"), the L in green. A player's row adds their line in that game under it.
- **"Live now"** (teams, and players through their team; not F1 or the UFC): while their team is in a game, the Scores tab's live card for it (score, inning or clock, the bases, the latest play; tap it for the game screen) sits above "Next game". `useLiveGame` (`app/src/lib/liveGame.ts`) takes the game from the store when you track the team (socket-fed, so it ticks live), otherwise reads `GET /me/scores/all` every 15 seconds while the page is open. It goes when the game ends. No server change; it works on the page's cached stats because the score never comes from them.
- **"Next game"** ("Next race", "Next fight"): the same row as the Scores tab's Up next ("Yankees vs Rays · ALDS Game 3 · TBS", the day and time), which opens the team's page.
- A footer: "Stats from ESPN, updated every 10 minutes. In red: the numbers worth gloating about." A page with no record, groups or games says "No stats yet", "ESPN doesn't have numbers for them this season."

**Players** (`playerPage`), from ESPN's athlete overview (`site.web.api.espn.com/apis/common/v3/sports/<sport>/<league>/athletes/{id}/overview`):

- **The season line ESPN picks for their position:** a hitter's average and strikeouts, a pitcher's innings and earned runs, a quarterback's yards and interceptions; a goalie's save percentage; a soccer player's goals, cards and fouls. The group is the overview's "Regular Season" split, titled "Regular season". Soccer splits a player's stats by competition, so it's the league's own one, matched by its full name in `leagues.ts` ("2026-27 English Premier League"), or else the first split that isn't career or projected.
- **MLB hitters:** the overview has only their career line, so the season row comes from the athlete stats endpoint (`…/athletes/{id}/stats`): the latest season of its first category, titled "2026 season". That second read happens only when the overview has no regular-season split, and never for soccer.
- **Postseason** and **Career**, when ESPN has them, with the same columns.
- **The last five games**, from the overview's game log: date, home or away, opponent and logo, W/L/T/D, score, and the player's line in that game. The line is up to 10 of their numbers, and zeros after the first are left out, as are words like "Started": Aaron Judge's 2-0 win over the Mets reads "3 AB · 3 SO", his 8-3 win at Minnesota "4 AB · 1 R · 1 H · 1 HR · 3 RBI · 2 SO".
- **Next game:** their team's (`nextGameOf` in `server/src/upnext.ts`: the Up next entry if the server has a fresh one, else a read of the team's schedule now).
- **In red** (`BAD` and `badFor` in `server/src/stats.ts`), only when there are some (`some`: 0 isn't red):
  - MLB hitters: strikeouts, caught stealing, grounded into double plays.
  - MLB pitchers (positions P, SP, RP): earned runs, homers allowed, walks, losses, blown saves. A pitcher's strikeouts are his good number, so they stay white.
  - NFL quarterbacks: interceptions, sacks, fumbles, fumbles lost. Other NFL players: fumbles and fumbles lost.
  - NBA and WNBA: turnovers, fouls (totals and per game), technical and flagrant fouls.
  - NHL skaters: penalty minutes, giveaways. Goalies: goals against, goals against average, losses, overtime losses.
  - Soccer: fouls committed, yellow and red cards, own goals, offsides, goals conceded.
- Real example (`server/test/stats.test.ts`): Aaron Judge's page is "2026 season: GP 66 · HR 18 · SO 85 · CS 0 · AVG .241" with the 85 strikeouts red and 0 caught stealing not, then "Career: GP 1211 · AB 4342 · H 1262 · HR 386 · SO 1454". Gerrit Cole's "Regular season: IP 127.0 · ER 51 · HR 22 · K 131" has ER and HR red and his 131 strikeouts white.

**Teams** (`teamPage`), from ESPN's team (`/teams/{id}`), team statistics (`/teams/{id}/statistics`), standings and schedule endpoints, read in parallel:

- **Record and standing:** the team's total record, `standingSummary`, and its home and road splits.
- **The season line, picked per league** (`TEAM_STATS`), each tile ESPN's code on top and our words under it (where our words are the code itself, "ERA", ESPN's own: "Earned Run Average"):
  - MLB: batting average, runs, home runs, OPS, strikeouts (red), ERA, WHIP, errors (red).
  - NFL and college football (whose statistics use the NFL's names): points per game, yards per game, interceptions thrown (red), giveaways (red), turnover margin, sacks taken (red), penalties (red), 3rd down %.
  - NBA and WNBA: points, FG%, 3P%, rebounds, assists, turnovers (red) and fouls (red), the counting ones per game.
  - NHL: goals, goals against (red), save %, shooting %, power play goals, penalty minutes (red), +/-.
  - It's titled with the part of the season ESPN has: "2026 Postseason" or "2026 regular season". A real example: the Yankees in the 2026 postseason, "Batting avg .246 · Strikeouts 33 · ERA 1.32 · Errors 0", with the 33 strikeouts red and no errors not.
- **Soccer:** ESPN has no team stat line, so the EPL's is its table (`tableGroup`, from the standings), "League table": POS, PTS, P, W-D-L, GF, GA (red when any) and GD. Example: "POS 6th · PTS 9 · P 5 · W-D-L 2-3-0 · GF 7 · GA 4 · GD +3".
- **The last five results** (`recentFromSchedule`): the schedule's finished games, newest first ("@ TB L 2-5", "@ TB L 0-1", "vs TB W 9-0"). A game without a score (postponed) is skipped; a level score is T, or D in soccer, whose plain schedule is its results.
- **Next game:** `nextGameOf`, as above.

**F1** (`server/src/f1-stats.ts`): a driver's page is their points and place in the championship, wins, podiums, poles, DNFs, average finish and races ahead of their teammate (the other car that day), then their last five races ("Oct 4 · Monaco GP · DNF", a DNF or no points drawn like a loss). A constructor's is the same for both cars, with one-twos and double DNFs. DNFs and losing to the teammate are the red ones. It reads the championship standings, the season scoreboard (every session's finishing order) and each finished race's cars once (kept in `kv`). F1 rows have no "vs" or "@" and no form chips.

**The UFC** (`fighterPage` in `server/src/ufc.ts`): the fighter's record ("Record": W, L in red, KO W, SUB W, KO L and SUB L in red, from ESPN's records), and their last five fights from the overview's fight history, each with the opponent, W or L, how it ended (with the round, except for a decision), and ESPN's description. No next fight. The UFC's placeholder team has no page.

**API:** `GET /targets/:key/stats` (public, no device token) → `{ key, kind, league, record?, groups: [{ title, tiles: [{ label, name, value, bad? }] }], recent: [{ id, date, home, opponent, opponentLogo?, result, score, line? }], next }`. 404 for a key the catalog doesn't know, a league that doesn't exist, or the UFC's placeholder team (`statsFor`). Each page is cached for 10 minutes (`TTL_MS`), so a busy page is one set of ESPN reads every 10 minutes; up to 500 pages are kept, and a failed read isn't kept, so the next request tries again. ESPN reads time out after 8 to 10 seconds; a failed statistics or schedule read leaves that part out rather than failing the page.
