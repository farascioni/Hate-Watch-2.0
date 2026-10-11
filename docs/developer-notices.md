# Developer notices

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** A developer notice is a message from Hate Watch itself that goes into every install's feed and is never pushed, for an emergency (an outage, alerts that went out wrong) or news of what's coming. It's sent from a shell on the server with `server/src/notice-cli.ts`, which writes it straight into the database (the work is in `server/src/notices.ts`), and the running server shows it in open apps within about 5 seconds. The same command lists notices and withdraws one; nothing in Settings turns them off, and only the user decides when one goes out (CLAUDE.md, "Release flow").

**Sections:**
- **Developer notices**: A developer notice is a message from Hate Watch itself that goes into every install's feed and is never pushed, for an emergency (an outage, alerts that went out wrong) or news of what's coming.

The README's "Developer notices" has the summary; this is the full detail. Read this index first, then only the part you need.

## Developer notices

**In short:** A developer notice is a message from Hate Watch itself that goes into every install's feed and is never pushed, for an emergency (an outage, alerts that went out wrong) or news of what's coming. It's sent from a shell on the server with `server/src/notice-cli.ts`, which writes it straight into the database (the work is in `server/src/notices.ts`), and the running server shows it in open apps within about 5 seconds. The same command lists notices and withdraws one; nothing in Settings turns them off, and only the user decides when one goes out (CLAUDE.md, "Release flow").

**What sending one does** (`sendNotice` in `notices.ts`), in one database transaction:

- One row in `events`: id `notice:<the time sent, in ms since 1970>`, type `app.notice` (`NOTICE_TYPE` in `fanout.ts`), league `news` (no league's, so it shows under All), target `app:hatewatch`, the title and body trimmed, `meta` `{"urgent":true}` or `{}`, and a share code like any alert.
- A feed row for **every device there is at that moment**, `pushed` 0 (`INSERT … SELECT … FROM devices`). A device registered later doesn't get it.
- `notices:latest` in `kv`: the id and time, for the running server to pass to open apps.
- No push, ever. A notice doesn't go through `publish()`, so prefs, mutes, quiet hours and the alert bells never apply to it, and nothing calls the push sender (`test/notices.test.ts` checks that no push is sent). It's the one exception to "every alert goes through `publish`" in [docs/duplicate-alerts.md](duplicate-alerts.md), Layer 2: its feed rows still use `ON CONFLICT DO NOTHING`.

**How it reaches open apps.** `watchNotices()`, started at boot in `index.ts`, checks `notices:latest` every 5 seconds (`HW_NOTICE_POLL_MS`). When it changes, the server sends an `event` frame, the same shape as a live alert (`feedItem`), to every connected device whose feed has the notice, and logs `[notice] <id> sent live to the open apps of <n> devices: <title>`. Everyone else sees it the next time the app loads its feed (opening the app, reconnecting, pull to refresh). Two limits follow from watching only the latest:

- Two notices sent within 5 seconds of each other: only the second goes out live; the first appears on the next feed load.
- A notice sent while the server is down, or just before a restart, isn't sent live: the server starts from whatever `notices:latest` says at boot.

**How it looks** (`FeedCard.tsx`, `alert/[id].tsx`, `isNotice` in `app/src/lib/alerts.ts`):

- **Builds from the next one:** the app's icon (`AppAvatar`), the title, three lines of the body, and the label "From Hate Watch" with a megaphone emoji, the card edged in red (`colors.hateDim`). An urgent notice reads "Important: from Hate Watch" with a warning-sign emoji, edged in amber (`colors.warn`). The emoji and labels come from the server (`noticeLook` in `fanout.ts`). There's no league tag and no Share button, and the icon opens no page. Tapping it opens all of it on its own screen, from "Hate Watch, From the developer", again without Share.
- **Builds before:** the sender is team-shaped (`NOTICE_SENDER` in `fanout.ts`: a team called Hate Watch, abbreviation HW, colour `#E5232B`, logo `badge://hatewatch`), so every build draws it as a red "HW" badge, as it does F1's constructors, and nothing crashes on it; it carries a NEWS tag (its league) and the same label. Build 12 opens an empty page when it's tapped.
- **Where it doesn't count:** the weekly recap leaves notices out (`recap.ts`), and they're never a Successful Hate Watch. Settings → Clear feed deletes them with the rest of the feed, and "Delete all my data" removes them with the device.

**The command** (`notice-cli.ts`), run on the server's machine:

```bash
fly ssh console -a hate-watch-api -C "node /app/src/notice-cli.ts"                                    # the latest 20, newest first
fly ssh console -a hate-watch-api -C "node /app/src/notice-cli.ts send 'Title' 'Body' --dry-run"       # how many it would reach; sends nothing
fly ssh console -a hate-watch-api -C "node /app/src/notice-cli.ts send 'Title' 'Body'"                 # send it (--urgent: marked important)
fly ssh console -a hate-watch-api -C "node /app/src/notice-cli.ts send --b64 <base64 JSON>"            # the same, for text with quotes in it
fly ssh console -a hate-watch-api -C "node /app/src/notice-cli.ts withdraw notice:<ms>"                  # take one back out of every feed
```

- **Which database.** `HW_DB` if set, else `/data/hatewatch.db` when it exists (the Fly volume), else `data/hatewatch.db`. It prints `database /data/hatewatch.db (<n> devices)` first, so a wrong database shows at once.
- **`send "Title" "Body"`.** Prints `sent notice:<ms> to <n> devices, feed only` and then the notice as sent (`urgent "Title": Body` when urgent). `--dry-run` prints `would reach <n> devices (nothing sent)` and writes nothing. `--urgent` and `--dry-run` can go anywhere after `send`.
- **`send --b64 <base64>`.** The base64 of `{"title","body","urgent"}` in UTF-8. `fly ssh console -C` passes one word whole, and base64 keeps quotes, apostrophes and emoji intact. It's urgent if the JSON says so or `--urgent` is given. Make it with `printf '%s' '<json>' | base64 | tr -d '\n'` (GNU base64 wraps long lines; the `tr` removes the breaks). For example, `{"title":"Live scores are delayed","body":"ESPN is slow tonight; alerts may come a minute late.","urgent":false}` is `eyJ0aXRsZSI6IkxpdmUgc2NvcmVzIGFyZSBkZWxheWVkIiwiYm9keSI6IkVTUE4gaXMgc2xvdyB0b25pZ2h0OyBhbGVydHMgbWF5IGNvbWUgYSBtaW51dGUgbGF0ZS4iLCJ1cmdlbnQiOmZhbHNlfQ==`.
- **Its checks** (`noticeProblem`): a title and a body that aren't blank, and a title of 120 characters at most ("the title is 131 characters; keep it to 120 (the rest goes in the body)"). The body has no limit, but the feed card shows three lines of it. A notice that fails a check prints the problem and the usage line and exits with status 1, sending nothing.
- **The list** (no command): the latest 20 notices, newest first, each as `<id>  <time, UTC>Z  <n> feeds[ URGENT]  "<title>": <body>`, where feeds is how many feeds still have it. With none: `no notices sent yet`.
- **`withdraw <id>`.** Deletes the notice's feed rows and its event, and prints `withdrew <id> from <n> feeds`. It only touches notices: any other id, or one already withdrawn, prints `no notice <id>`. An app that has it on screen keeps it until it next loads its feed. There's no live frame for a withdrawal.
- Any other command prints the usage line and exits with status 1.

**Before sending one** (CLAUDE.md): only when the user asks, with its exact title and body, and whether it's urgent, confirmed first, since it goes to everyone. Check the reach with `--dry-run`, then send it with `--b64`. A deploy that includes `notice-cli.ts` has to be live first.

**Tests** (`test/notices.test.ts`): a notice goes into every feed, never pushed, drawn as from Hate Watch (team-shaped with a `badge://` logo, league `news`); an urgent one says so; a dry run reaches no one, and the title and body checks; the weekly recap doesn't count notices; open apps get a new notice within seconds, and only those whose feed has it (a socket for a device created after it gets nothing); a notice is withdrawn from every feed, and `withdraw` refuses an id that isn't a notice.
