# Automatic posts to X

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** When an NBA team loses, the server can post the Successful Hate Watch to X from Hate Watch's own account: the alert as the app's share sheet words it, the share card as the picture, and the team's @handle. A standalone post: no link, reply or quote. Built as a pilot, NBA only, behind two switches that are both off until turned on (`social.nba.dryrun`, `social.nba.live`), with the kill switch `social`. Nothing is retried, 15 posts a day at most, and the handles, the media endpoint's sign-in and the @mention's risk are unverified until one supervised real post.

**Sections:**
- **Automatic posts to X**: what is posted, when, the switches, the limits, turning it on, and what is unverified.

The README's "Automatic posts to X" has the summary; this is the full detail. Read this index first, then only the part you need.

## Automatic posts to X

**In short:** When an NBA team loses, the server can post the Successful Hate Watch to X from Hate Watch's own account: the alert as the app's share sheet words it, the share card as the picture, and the team's @handle. A standalone post: no link, reply or quote. Built as a pilot, NBA only, behind two switches that are both off until turned on, with the kill switch `social`. Nothing is retried, 15 posts a day at most, and the handles, the media endpoint's sign-in and the @mention's risk are unverified until one supervised real post.

**What a post is** (`postText` in `server/src/social.ts`):

```
🪦 Successful Hate Watch! Bulls lost to the Nuggets
Final Score: 133 to 128

@chicagobulls
```

The emoji, title and body are the loss alert's (`gameLostEvent` in `detectors.ts`, read back from its `misery` row, whose title is stored without "Successful Hate Watch! ", so it is put back). The picture is `shareCard()` (`share.ts`) for the row's share code, the same 1200x630 card a link preview shows. The handle comes from `NBA_HANDLES`, keyed by team (`team:nba:<espnId>`); a team with none posts without the last line. There is no link on purpose: X blocks API replies to accounts that haven't engaged with the app, and a post with a link costs 13 times as much.

**Which losses** (`socialLoss`, called by `record()` in `misery.ts` for a loss that is new to the list: a loss whose row already exists is never offered again):

- league `nba`, type `team.lost` only. Not a player's loss, not a preseason game (`meta.preseason`), not the launch `backfill` (source `tracker` or `board` only).
- a game that ended at most 3 hours ago.
- a switch on: `social.nba.live` (posts) wins over `social.nba.dryrun` (logs only). Both off, or the `social` kill switch off, claims nothing.

**Once only.** The loss is claimed the moment it is seen, in either mode, by inserting `social:<misery row id>` into `kv` (`INSERT OR IGNORE`, one change means ours). A restart, the board seeing the same final, or an ESPN revision never claims it twice, and turning live on later does not post the evening's earlier games: their rows are already on the list, so `record()` does not offer them (a loss recorded while both switches were off is never posted). The id is the misery row's, which is `lostId ?? e.id`, so it is the same one `duplicate-alerts.md` describes for a loss.

**When** (`postLoss`): one minute after the claim (`HW_SOCIAL_DELAY_MS`), a `setTimeout` in memory. It re-reads the misery row then, because the row can be revised or removed in the wait. The kv value ends as one of: `dryrun` (with the text), `posted` (with X's answer), `gone` (the row was removed), `capped` (15 live posts in the last 24 hours, `social:recent` in `kv`), `no-card` (the card could not be drawn), `no-credentials`, or `error` (the first 300 characters of the failure). A live post is counted toward the cap before X is called, because a post that errors may still have gone out.

**To X** (`postToX`): the card is uploaded to `POST https://api.x.com/2/media/upload` (multipart, `media_category=tweet_image`), then `POST https://api.x.com/2/tweets` with the text and the media id. Both are signed with OAuth 1.0a (`oauthHeader`), from four secrets: `HW_X_API_KEY`, `HW_X_API_SECRET`, `HW_X_ACCESS_TOKEN`, `HW_X_ACCESS_SECRET`. They are the owner's to set (`fly secrets set`, which restarts the app); nothing here prints them.

**Switches** (`SOCIAL` in `flags.ts`; the `flag-cli.ts` command lists and flips them, live within seconds, like the savings):

```bash
fly ssh console -a hate-watch-api -C "node /app/src/flag-cli.ts social.nba.dryrun on"
```

That logs "[social] dry run, would post ..." for each NBA loss. `social.nba.live on` posts instead, and `social off` stops both at once. `HW_SOCIAL_ON=social.nba.dryrun` (a secret) turns one on for good. Turn it on only when the owner asks, dry run first, and read the dry-run text and handles for a night before going live.

**Tests:** `server/test/social.test.ts` (9): the text and the 30 handles, the OAuth header, nothing claimed while off, the claim filters and the once-only rule, an earlier game never claimed after live is switched on, a dry run through `publish()`, a row that is gone, the live post against a stand-in for X (secrets, the cap, the two calls, no link, the cap counting) and an X failure being recorded, not thrown.

**Not verified, and the risks:**

- **The handles are from memory.** Check all 30 against X before going live. A wrong one tags a stranger.
- **The media upload's sign-in.** X documents an OAuth 2.0 user token with `media.write` for `/2/media/upload`; the code signs with OAuth 1.0a, which the older upload accepted. The first live post must be watched; if X answers 401 or 403 on the upload, the sign-in has to change.
- **The @mention can get the account limited or suspended.** X's automation rules forbid unsolicited automated interaction. If X returns a 403 on the post, drop the handle (empty `NBA_HANDLES`) and post without it.
- **Upload billing is unknown;** a post costs about $0.015 to $0.02.
- **A pending post is lost on a restart** (the one-minute timer is in memory); its claim stays, so it is never posted late. No alt text on the picture.
- **The score line has no team names.** "Final Score: 133 to 128" is the share sheet's wording, and in a post with no link it does not say whose score is whose. Faithful to the app; the owner's call.
- **NBA only.** Other leagues are one more entry in the filter and a handle map.
