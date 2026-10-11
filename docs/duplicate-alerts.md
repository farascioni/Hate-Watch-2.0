# Duplicate alert protection

How Hate Watch makes sure one thing happening is one alert: one feed row and at most one push per device, through
re-polls, ESPN's edits, two play feeds, overlapping detectors, server restarts and the app reconnecting.

**Read this before changing any alert code** (CLAUDE.md "Read the docs first"). The docs hook
(`.claude/hooks/require-docs.mjs`) blocks an edit to an alert file until this file has been read since the latest
user message, every time, not just once a session. The files it covers are listed under
[Files this covers](#files-this-covers). The Obsidian vault has the same text as "Duplicate alert protection".

## The short version

There are six layers. A change to alerts has to keep every one of them working:

1. **The alert's id** is built from what happened, never from when it was seen. The same thing seen twice makes
   the same id ([Layer 1](#layer-1-deterministic-alert-ids)).
2. **The database stores an id once.** `publish()` inserts the alert with `ON CONFLICT(id) DO NOTHING`. If nothing
   was inserted, it stops there: no feed rows, no live frame, no push. This is the backstop for everything else
   ([Layer 2](#layer-2-the-database-stores-an-id-once)).
3. **The game tracker judges each play once** and remembers what it has announced (`seen`, `announced`,
   `onceDone`, and others), so a re-poll doesn't even produce the alert again
   ([Layer 3](#layer-3-the-game-tracker-judges-each-play-once)).
4. **One moment is one alert per device.** Alerts about the same moment to different targets (a player and his
   team, the loss and its facts) become one alert, with the others as lines on it
   ([Layer 4](#layer-4-one-moment-one-alert-per-device)).
5. **ESPN's edits are revisions, not new alerts.** A changed, re-posted or removed play changes the alert it
   sent (a line, no push). It never sends a second notification about the same play
   ([Layer 5](#layer-5-espns-edits-are-revisions-not-new-alerts)).
6. **The app keeps one copy of each id.** The feed is merged by alert id, so a frame that arrives twice
   replaces the copy rather than adding a row ([Layer 6](#layer-6-the-app-keeps-one-copy-of-each-id)).

## Layer 1: deterministic alert ids

Every alert (`Detected` in `server/src/detectors.ts`) has an `id`, the "deterministic dedupe key". It's the primary
key of the `events` table (`server/src/db.ts`). It must be the same every time the same thing is detected, from
either play feed, on any poll, before or after a restart, and different for anything that is genuinely new.

The usual shape is `game:play:type:who`:

| Alert | Id |
|---|---|
| A player's play alert | `${gameId}:${playId}:${type}:${athleteId}` |
| A team's play alert | `${gameId}:${playId}:${type}:${teamId}` (or `team-${teamId}`) |
| A team's loss | `${gameId}:final:team.lost:${loserId}` |
| A half-inning's alerts (MLB) | `${gameId}:${halfKey}:mlb.team.nobletiger:${teamId}` and the like |
| A scoreless half | `${gameId}:half:${league}.scoreless_half:${teamId}` |
| A finished drive (football) | `${gameId}:drive:${driveId}:${type}` |
| F1 | `${compId}:f1.finish:${driverId}`, `${compId}:f1.pit:${driverId}:${stop}`, `${compId}:f1.lapped:${driverId}` |
| UFC | `${fightId}:${type}:${loserId}`, `${fightId}:ufc.knocked_down:${athleteId}:${n}` |
| News | `news:${league}:${articleId}:${targetKey}` |
| Injuries (a player) | `inj:${league}:${athleteId}:${status}:${day}` |
| Injuries (a team's batch) | `inj:${league}:team:${teamId}:${day}:${hash of the exact set of changes}` |
| Standings drop | `standings:${league}:${teamId}:${day}:${from}->${to}` (by division where there is one) |
| Losing streak | `streak:${league}:${teamId}:${day}:${streak}` |
| Eliminated / rival clinched / relegation zone | `elim:${league}:${teamId}:${year}`, `clinch:…:${year}:…`, `releg:${league}:${teamId}:${day}` |
| F1 championship drop | `f1st:${key}:${day}:${from}->${to}` |
| Weekly recap | `recap:${hash of the device}:${week}` |
| Developer notice | `notice:${time sent}` |
| A test alert (`POST /dev/simulate`, `api.ts`) | `sim:${random uuid}`: new every time on purpose, so each test sends |

Rules for a new id:

- **Build it from facts that don't change**, such as the game, ESPN's play id, the type and who it's about. Never use
  `Date.now()` or a counter that restarts with the server. Ids by the day (`${day}`) mean "once a day" on purpose.
- **Put the type in it.** Two different alerts on the same play about the same target need different ids. The
  database keeps only the first of an id.
- **A few MLB alerts are keyed on the play's text instead of its id:** caught stealing
  (`${gameId}:cs:${half}:${text}:${runner}`), out on the bases (`${gameId}:bases:…`) and a lost replay
  challenge (`${gameId}:challenge:…`). ESPN posts these plays twice under different ids ("ESPN twin plays collapse
  to one", commit 2bfbef7; `challenges.test.ts`), and the text is what stays the same. The flip
  side is that if ESPN rewrote the text, the id would change. So `GameTracker.poll` (`server/src/live.ts`) logs a
  rewritten at-bat result and does not judge it again, with one exception: a crew chief review written into a result
  later is checked for that alone (`umpireReviewLost`). Don't re-run detectors on changed MLB results.
- **The same thing seen under a new id is not new.** ESPN re-posts football plays under new ids (see Layer 5). An
  ABS challenge's pitch gets a new id when the call is overturned, so its hold is keyed on `absSlot`, the pitch's
  place without the type digits.

## Layer 2: the database stores an id once

`publish(events, league)` in `server/src/fanout.ts`:

1. Skips an alert nobody tracks. It isn't stored, so its id is still free if someone follows the target later.
2. Inserts it into `events` with `ON CONFLICT(id) DO NOTHING`. **If the insert changed nothing, the alert was
   already published** (a re-poll, a restart, two detectors or two feeds producing it), and `publish` moves on:
   no feed rows, no live frame, no push. Everything after this point happens once per id.
3. Inserts each device's feed row with `ON CONFLICT DO NOTHING` (primary key `device_id, event_id`), so a device
   can't get two rows for one alert.
4. Records a Successful Hate Watch in `hate_watches` (primary key `device_id, event_id`, `ON CONFLICT DO NOTHING`).
   The counter can't go up twice for one loss, and a withdrawn alert comes off it (`reviseEvent`).

`publishTo` (one device's weekly recap) does the same: `false` if the id was stored before. Developer notices
(`server/src/notices.ts`) insert feed rows with `ON CONFLICT DO NOTHING`.

**Never bypass this.** Code that sends a push or a live `event` frame must go through `publish` or `publishTo`, after
the insert. The one exception is a developer notice (`notices.ts`), which stores itself and writes every device's feed
row directly, with `ON CONFLICT DO NOTHING`, and never pushes. Changes to an alert that already went out use `addLateLine`, `eventChanged` or `reviseEvent`, which send
an `eventUpdate` frame and **never push**.

## Layer 3: the game tracker judges each play once

`GameTracker` (`server/src/live.ts`), one per live game, polls ESPN every 2 seconds. Most re-polls produce no alerts
at all, because the tracker remembers:

- **`seen`:** play ids already judged. A play is passed to the detectors only on its first sighting. An MLB result
  posted before its batter is on it waits (`waitForBatter`) and is judged once, when it is ready.
- **History on attach:** when the tracker first attaches to a game (a new follow, or a server restart), plays older
  than `BACKFILL_WINDOW_MS` (90 seconds) update its state but are never alerted. A game first seen already under
  way never gets "Hate Watch Starting". Box-score alerts (pitchers' lines, scoreless at the half) are skipped on the
  first read.
- **`announced`:** the score each side's team alerts have gone out for. The score is re-derived from every play on
  every poll (ESPN edits plays), and a team alert goes out once per score a side reaches. A goal flagged as scoring
  late still alerts then. A goal taken back lowers `announced`, so that team's next goal is news again.
- **`onceDone`, `pitching`:** once-a-game facts (position player pitching, scoreless halves, a blown save, no
  quality start) already sent or baselined.
- **`fouls`** (soccer commentary, by play id), **`halfEnds`** (MLB: a half-inning is judged once, on a read with its
  third out), **`absHeld`** (a lost ABS challenge is held until the review settles, then sent once or dropped).
- **`mergePlays`:** ESPN's core and site feeds are merged by play id before detection, so a play in both is one
  play. College football's drive plays (`fromDrivePlays`) skip a play listed in two drives.
- **F1** (`server/src/f1.ts`): a live race's `memo.sent` (ids sent this session), `preSeen` (only a start seen
  before lights out is news) and `resultsSeen` (a result is read again only after a change holds for a second scan).
- **Baselines in `kv`:** the first read of something is a baseline, not news. That covers the AP poll's week
  (`cfb:ap:week`), standings (`standings:${league}`), injury reports (`injuries:${league}`), the news cut-off
  (`news_since:${league}`), the latest developer notice, and a streak a loss alert already gave
  (`streak-told:${league}:${teamId}`).

## Layer 4: one moment, one alert per device

Several alerts can be about one thing happening. A player's error and his team's, a loss and "lost as favorites",
a team falling behind and blowing its lead on the same play. `Detected` has fields for this, and `publish` applies
them per device:

- **`moment`:** alerts with the same moment are one thing. A device gets only the first of them it wants.
  `bundleByPlay` gives every play alert without one the moment `${gameId}:play:${playId}:${team}`, so a device
  tracking a player and his team gets one alert for that play.
- **`fold`:** a fact the first alert doesn't say. It becomes a line on that alert ("Lost as 78% favorites.").
  Without a `fold`, the later alert is the same news about another target and is dropped. The same fold sentence is
  added only once.
- **`foldOnly`:** only ever a line on another alert of its moment, never an alert of its own (a blown lead, at the
  final). It's held until that alert exists.
- **`alt`:** alternatives within a moment. A device gets at most one alert or line from each group (blowing a lead,
  falling behind and being scored on, all on one play).
- **`unless: X`:** dropped for a device that wants X, which covers the same moment more specifically (stranded
  runners vs. NOBLETIGER).
- **`aliases`:** other settings that also cover this alert. It is still one alert.
- **`firstFollowed`:** of a moment's alerts, a device gets the one about the target it followed first (tracking Cole
  and then Judge, a Yankees loss is Cole's).
- **`list`:** a moment's alerts named in one line ("Yours: Alpine, George Russell."). F1's start is one alert per
  device, not one per driver.
- **`lateOn`:** a line on the device's latest alert about a target instead of an alert of its own (a standings drop
  after a loss is a line on the loss). It reads the feed in the database, so it works after a restart.
- **Late facts:** a fact that comes a poll later (an NFL drive's result after its last play) goes on the moment's
  alert as a line with no push. `delivered` remembers each moment's alert per device for `LATE_FOLD_MS` (6 hours).
- **`recipients()`:** a team's alert goes to its trackers and to trackers of its players with "Get their team's
  alerts" on, once per device.
- **A push per device per alert.** The device's alert is pushed if anything it carries would be. Its folded facts
  add lines, never more pushes. F1 alerts from one session in one publish are one notification (`bundled`).

## Layer 5: ESPN's edits are revisions, not new alerts

ESPN changes plays after posting them. Alerts go out the moment a play is first seen, and what changes later is
handled as a revision of that alert:

- **Football** (`server/src/revisions.ts`, `PlayLedger`): for `REVISE_MS` (15 minutes) each play and drive keeps
  the alerts it sent. Each read compares them with the play now:
  - An alert the play no longer has gets a line, with no push ("Wiped out by a penalty…").
  - An alert it has now and didn't before goes out.
  - A play re-posted under a new id at the same spot (`samePlay`: the same period, a start within 10 seconds, the
    same player) is that play, revised (`repost`), not a new one. One touchdown posted under three ids is one alert.
  - A play missing for `GONE_MS` (30 seconds) has its alerts taken back. One short read doesn't count.
  - A score is taken back only when ESPN's plays and header agree. If the side then scores on that drive, the
    alert gets a line ("Then they scored on the same drive"), not a second alert.
  - `ONCE` alerts (the starting QB pulled) are counted as they come and never re-run.
- **MLB:** a changed at-bat result is logged, not judged again (Layer 1). A lost ABS challenge waits for the review
  (`holdAbs`). A pitch missing from one read isn't taken back, because ESPN serves stale copies that drop the
  latest plays for a read.
- **F1:** a result a penalty changes is corrected in place (`reviseEvent`: what changed, no push). What's new is
  sent, and what no longer holds is withdrawn.
- **Clips:** a clip that comes later goes on the alert it belongs to (`eventChanged`), sent again live, no push.

## Layer 6: the app keeps one copy of each id

`app/src/lib/store.tsx`: `mergeFeed` keys the feed by alert id. An `event` frame for an id the feed already has
replaces it, and an `eventUpdate` frame (a late line, a clip, a revision) replaces it too, so reconnects and repeated
frames never show two rows. The feed is ordered by when it happened (`occurredAt`), not by arrival.

## What survives a restart

A deploy restarts the server. This is what keeps a restart from re-sending alerts, and what it forgets:

| Kept (database) | Forgotten (memory) |
|---|---|
| `events` (ids), `feed`, `hate_watches` | `seen`, `announced`, `onceDone`, `pitching`, `fouls`, `halfEnds`, `absHeld` |
| `kv` baselines: standings, injuries, news, AP poll, notices, `streak-told`, the pregame facts | `delivered` (late facts), the football revisions ledger |
| | F1's `memo.sent`, `preSeen`, `resultsSeen` |

After a restart, a live game's tracker attaches as new. Plays older than 90 seconds are history, and anything in
the last 90 seconds is detected again with the same ids, which the database already has. So nothing is sent twice.
What is lost:

- **Late facts.** A fact that comes after a restart for a moment alerted before it has no `delivered` entry. If it
  has no `lateOn`, it can go out as an alert of its own rather than a line.
- **Revisions.** A football play edited after a restart can't be compared with what it sent before.
- **MLB holds.** A lost ABS challenge held at the restart, or an at-bat waiting for its batter, from before the
  90-second window is history.

This is one reason for the decision **"No production restarts during live games"**: deploy when nothing is live.

## Known gaps

- **Pushes have no collapse id.** Only the database rows keep a push single. A second `publish` of an id sends
  nothing, but code that pushed without going through `publish` would not be caught by anything.
- **Text-keyed MLB ids** depend on ESPN's text staying the same. A re-judged rewritten result would make a new id,
  which is why changed results are logged, not judged again.
- **A fold sentence is compared as text.** Two wordings of the same fact are two lines.

## How to change alerts safely

1. Read this file, the README's "Notifications" and "Real-time" sections, and the module's header comment.
2. **A new alert:** give it a deterministic id (Layer 1) with its type in it. Decide its `moment` and `fold` if it
   can coincide with another alert (Layer 4). Publish it through `publish`.
3. **A change to what an alert says or when it fires:** check whether its id changes. A changed id makes an alert
   that already went out go out again, for every game in progress when it deploys.
4. **ESPN changing data after it's posted:** handle it as a revision (Layer 5): a line with no push, never a second
   alert.
5. **Test it.** Run a re-poll of the same feed (nothing new), a restart in the middle of a game (nothing new), the play
   in both feeds (one alert), and a player and his team tracked together (one alert). The tests that cover this:
   `bundling.test.ts`, `play-revisions.test.ts`, `live-score.test.ts`, `challenges.test.ts`, `crew-chief-review.test.ts`,
   `f1-merges.test.ts`, `hate-watches.test.ts`, `logic.test.ts`, `sport-alerts.test.ts` and `clips.test.ts`. Replay a
   recorded game (`server/data/recordings/`) and compare the alert count.

## Files this covers

The docs hook asks for this file again before an edit to any of these, by the edit tools or a shell command that
writes to them:

- `server/src/`: `detectors.ts`, `live.ts`, `fanout.ts`, `revisions.ts`, `event-types.ts`, `push.ts`, `f1.ts`,
  `ufc.ts`, `news.ts`, `recap.ts`, `cfb-poll.ts`, `hate-watches.ts`, `notices.ts`, `clips.ts`, `db.ts`, `api.ts`
  (every file that builds, publishes or changes an alert; `grep -lE "publish\(|publishTo\(|reviseEvent\(|eventChanged\(|addLateLine\(|\bDetected\b" server/src/*.ts`
  should list nothing outside these. A new one goes in this list and in `ALERT_CODE` in the hook, the same.)
- `server/test/`: any test file (the tests are mostly alert tests)
- `app/src/lib/store.tsx` (the feed's merge)
