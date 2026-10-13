# Redundancy: when the server fails

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** the server is one Fly machine with SQLite on one volume, so its failures are the volume's, the host's and the region's. Two things are in place against them. **Litestream** streams the database to object storage (Tigris) every second or so, so a lost volume loses about a second of data instead of up to a day, and a machine started on an empty volume restores itself before it serves. **`GET /health/deep`** answers 503 when the database, the ESPN reads, a game's poll loop or the replication has stopped, for an outside monitor to message the owner (Fly's own check stays on `/health`). Both are deployed and running since October 13, 2026 (release v81, replication on from 19:12 UTC); a restore from the bucket was tried and matched the live database. Nothing yet calls `/health/deep` from outside, and the warm standby is not built. A warm standby in a second region, and independence from the fly.dev address, are designed but not built.

**Sections:**
- **Redundancy: when the server fails**: the failures, what each costs today, and what is in place.
  - **What can fail, and what it costs**: every failure, how long it lasts and what is lost.
  - **What is in place**: Litestream and `/health/deep`, how they work and why they are built this way.
  - **Setting it up (once)**: the first deploy, the bucket, the secret and the checks.
  - **Monitoring**: the outside check, and what each failing check means.
  - **Runbooks**: a stopped server, a bad deploy, a lost volume, a restore to an earlier moment, a broken backup.
  - **Not built yet**: the warm standby and the fallback address, with what they need.
  - **Known gaps**: what the built parts do not cover.
  - **What was tested**: what ran, and what only the first deploy can show.

## Redundancy: when the server fails

**In short:** the server is one Fly machine with SQLite on one volume, so its failures are the volume's, the host's and the region's. Two things are in place against them. **Litestream** streams the database to object storage (Tigris) every second or so, so a lost volume loses about a second of data instead of up to a day, and a machine started on an empty volume restores itself before it serves. **`GET /health/deep`** answers 503 when the database, the ESPN reads, a game's poll loop or the replication has stopped, for an outside monitor to message the owner (Fly's own check stays on `/health`). Both are deployed and running since October 13, 2026 (release v81, replication on from 19:12 UTC); a restore from the bucket was tried and matched the live database. Nothing yet calls `/health/deep` from outside, and the warm standby is not built. A warm standby in a second region, and independence from the fly.dev address, are designed but not built.

Why one machine at all: the live poller, every WebSocket and the database are one process, and "one alert per id" holds because `publish()` inserts into one database (docs/duplicate-alerts.md, Layer 2). Two machines with a database each would both publish and both push. Everything here keeps one writer.

### What can fail, and what it costs

| Failure | What happens |
|---|---|
| The process crashes, or a deploy replaces it | A few seconds. Apps reconnect with backoff up to 15 s and reload the feed (`app/src/lib/store.tsx`). The 5-minute boot window re-reads recent plays and `publish()` drops the ids it has (docs/duplicate-alerts.md, "What survives a restart"). Late facts and revisions from before it are lost. |
| The host under the machine fails | A Fly volume lives on one host, so the machine cannot simply start elsewhere. Recovery is the lost-volume runbook below: minutes, by hand. |
| The volume is lost or corrupted | Without replication: everything since Fly's last volume snapshot (kept 5 days by default, per `fly volumes create --help`; whether daily snapshots are on for this volume is not checked, see `fly volumes snapshots list <volume id>`), which means every device registration, follow and feed row since. With Litestream: about a second. |
| The region (`iad`) or Fly itself is down | Total outage, and no way to post a notice. Only a standby in another region would help (Not built yet). |
| A bad deploy | `fly releases`, then redeploy the previous image (Runbooks). |
| ESPN is down or changes its shapes | Out of scope here. docs/known-limits.md, and `espn-alternatives-research` in the vault. |
| Expo's push service is down | Open apps still get alerts over the WebSocket. Closed phones get nothing until it returns. |

A restore from the replica looks to the alert code like a restart with a slightly old database. The only extra exposure is the replication lag: an alert stored in the last second before the failure may be missing from the restored copy, and would be sent again if its play is still inside the boot window.

### What is in place

**Litestream** (`server/litestream.yml`, `server/start.sh`, `server/Dockerfile`). The image carries Litestream 0.5.17, pinned by digest, next to the server. `start.sh` is the container's entrypoint:

1. With `LITESTREAM_REPLICA_URL` unset, it only starts the server (the log line `[boot] LITESTREAM_REPLICA_URL is not set` says so). Nothing else changes.
2. With it set, it first checks in the shell whether the database file exists, so a normal boot never touches the bucket: a Tigris outage or a rotated key cannot stop a routine restart. Only when the file is missing does it run `litestream restore -if-db-not-exists -if-replica-exists`: on an empty volume with a replica, that restores the database before the server starts; with no replica yet (the first run) it carries on. **Any other failure stops the boot** (bad credentials, an unreachable bucket), on purpose: a server started empty would make a new database and replicate it over the good copy. The machine then crash-loops in Fly's view until someone looks, which is the right outcome.
3. It starts `litestream replicate` beside the server, in a loop that restarts it 5 seconds after it exits. The server never waits for it.
4. It `exec`s the server, so the server is still PID 1 and still handles SIGTERM as before.

The database was already in WAL mode (`server/src/db.ts`), which Litestream needs, and `db.ts` now also sets `PRAGMA busy_timeout = 5000` (Litestream's tips page recommends it). Litestream takes the write lock for a moment at each checkpoint, and `node:sqlite` waits 0 ms by default, so without the pragma a write landing then (an alert's insert in `publish()`, the health check's ping) would fail at once with "database is locked". The pragma applies to every connection that opens the database through `db.ts`, the CLI tools included. The replica is a bucket on Tigris, Fly's object storage, which does not share the volume's host. Every day Litestream takes a full snapshot and keeps a week, so a restore can also go back to a chosen moment within that week. Litestream's own metrics are served on `127.0.0.1:9090` inside the machine and nowhere else.

**`GET /health/deep`** (`server/src/health.ts`, the route in `api.ts`) answers 200 with `{ ok: true, checks: [...] }`, or 503 with the same body when any check fails:

| Check | Fails when |
|---|---|
| `database` | a test write to `kv` (`health:ping`) fails: the volume is full, read-only or gone |
| `espn` | no ESPN request got any reply (a 404 counts, an error does not) for 120 s, or none since boot. Every league's scoreboard is read every 10 s, so this means ESPN is down or the poller is dead |
| `trackers` | a game's poll loop started no pass for 60 s (`GameTracker.loopAt` in `live.ts`), so that game misses alerts while everything else looks fine |
| `replication` | with replication on: Litestream's metrics do not answer, its `litestream_sync_error_count` rose since the last check, or it reports the disk full. Not configured counts as passing |

For the first 120 s after a boot only the database is checked, since the first scans and Litestream's first sync take a moment. **It is deliberately not Fly's health check.** A failing Fly check takes the only machine out of routing, which would turn a stuck poller into a full outage; `fly.toml` keeps checking `/health`, which answers whenever the process is up.

### Setting it up (once)

**Status (October 13, 2026): steps 1 to 5 are done.** Production runs the image as release v81 (backup `hatewatch-backup-2026-10-13-before-redundancy.db` taken first). The Tigris bucket `hatewatch-backups` was created (its `AWS_*` and `BUCKET_NAME` secrets restarted the app once, release v82), and `LITESTREAM_REPLICA_URL` was applied at 19:12 UTC with `fly secrets deploy`: Litestream has replicated every second since (`litestream ltx` lists its files). A restore from the bucket into a scratch file on the machine gave the same row counts as the live database (80 devices, 258 follows, 2,327 events, 2,775 feed rows) and `integrity_check` ok. **Step 6, the outside monitor, is not done**, so nothing yet tells the owner when `/health/deep` fails; and the restore has not yet been tried from the owner's own computer (it needs the bucket keys and `brew install litestream`). Each step is the owner's to run or approve (CLAUDE.md, "Release flow": ask before every deploy).

1. **Deploy the image without the secret** (`fly deploy --remote-only` from `server/`, when nothing is live and after the `VACUUM INTO` backup). This only adds the files and `/health/deep`; `start.sh` skips Litestream. If Fly's build fails, the old machine keeps running. Check `https://hate-watch-api.fly.dev/health/deep` answers 200 and the log shows the not-set line.
2. **Create the bucket:** `fly storage create -a hate-watch-api -n hatewatch-backups`. It sets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and the endpoint as secrets on the app (which may restart it, so run it when nothing is live too) and prints the keys once: **keep a copy in a password manager**, because a restore from your own computer (below) needs them.
3. **Turn replication on:** `fly secrets set --stage -a hate-watch-api 'LITESTREAM_REPLICA_URL=s3://hatewatch-backups/hatewatch?endpoint=fly.storage.tigris.dev&region=auto'`. `--stage` sets the secret without restarting the app (`fly secrets set --help`); it takes effect at the next restart, which is `fly machine restart` when nothing is live. Without `--stage`, setting a secret restarts the app at once.
4. **Check it:** the log shows Litestream starting and no errors (`fly logs -a hate-watch-api`); `/health/deep` shows `replication` passing after the 2-minute grace; and `fly ssh console -a hate-watch-api -C "litestream ltx 's3://hatewatch-backups/hatewatch?endpoint=fly.storage.tigris.dev&region=auto'"` lists files.
5. **Rehearse a restore** into a scratch file on your computer (Runbooks, "Restore to an earlier moment") and open it with `sqlite3`: compare its `devices` and `events` row counts with production's. A backup that was never restored is a guess.
6. **Add the outside monitor** (below).

### Monitoring

`/health/deep` needs something outside Fly to call it and tell a person; nothing does yet. A free uptime service does it (UptimeRobot checks every 5 minutes, Better Stack every 3, both can push to a phone): point an HTTP monitor at `https://hate-watch-api.fly.dev/health/deep` and alert on any non-200. Creating the account is the owner's to do. A GitHub Actions cron was ruled out: a private repository's free minutes do not cover a check every few minutes.

What an alert means, by the failing check in the 503 body (`curl -s https://hate-watch-api.fly.dev/health/deep`):

- **`database`**: the volume. `fly ssh console -a hate-watch-api -C "df -h /data"`; if it is full, free space or grow the volume (`fly volumes extend`); if the volume is gone, the lost-volume runbook.
- **`espn`**: first open ESPN's scoreboard in a browser or with `curl`. If ESPN answers and the server does not read it, restart (`fly machine restart`). If ESPN is down, nothing here helps.
- **`trackers`**: a game is stuck. `fly logs` for that game's id; a restart fixes it, so do it between games or accept the 5-minute boot window mid-game.
- **`replication`**: the backup is not working. Runbook "A broken backup".

### Runbooks

All of these change production, so each is the owner's call; the read-only ones (`fly status`, `fly logs`, `fly releases`) are free.

**The server does not answer.** `fly status -a hate-watch-api`, `fly logs -a hate-watch-api`. A crashed machine restarts by itself; a stopped or wedged one: `fly machine restart <id> -a hate-watch-api`.

**A bad deploy.** `fly releases -a hate-watch-api` shows the image of each release; redeploy the previous one with `fly deploy -a hate-watch-api --image <that image>`.

**The volume is lost or corrupt** (with replication on; without it, the latest Fly snapshot: `fly volumes snapshots list`, then `fly volumes create --snapshot-id`). The new machine restores before it serves:

1. `fly machine list -a hate-watch-api` and `fly volumes list -a hate-watch-api` to see what is left.
2. Destroy the broken machine and volume (`fly machine destroy <id> --force`, `fly volumes destroy <id>`), after looking at both.
3. `fly volumes create hatewatch_data --region iad --size 1 -a hate-watch-api`.
4. From `server/`: `fly deploy --remote-only --ha=false`. `start.sh` sees no database, restores it, then starts. The log shows the restore.
5. Check `/health/deep` and the Scores tab; then post a developer notice if alerts were missed (CLAUDE.md, "Release flow": ask first).

**Restore to an earlier moment** (a bad deploy that wrote wrong data, or the rehearsal). On a computer with Litestream (`brew install litestream`), with the bucket's keys in `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`:

```bash
litestream restore -o /tmp/hatewatch-restored.db -timestamp 2026-10-12T20:00:00Z \
  's3://hatewatch-backups/hatewatch?endpoint=fly.storage.tigris.dev&region=auto'
sqlite3 /tmp/hatewatch-restored.db 'select count(*) from devices; select count(*) from events;'
```

Without `-timestamp` it restores the latest. To put a restored file on the volume, stop the app (`fly machine stop`), copy it over `/data/hatewatch.db` with `fly ssh sftp`, delete `hatewatch.db-wal` and `hatewatch.db-shm` beside it, and start it.

**A broken backup** (the `replication` check fails). `fly logs -a hate-watch-api | grep -i litestream`. Bad credentials or a missing bucket show there; `fly secrets list` shows whether the secrets exist. Fix the cause and restart. Litestream restarts itself every 5 seconds, so a bucket outage heals on its own once the bucket is back, and the check passes again when the error count stops rising.

### Not built yet

**A warm standby in a second region (active-passive).** A second machine in the same Fly app (for example `ord`), restoring the replica continuously (`litestream restore -f`). A lease decides who polls: only the holder calls `engine.start()`, and a standby answers 503 on `/health`, so Fly's proxy sends it nothing until it takes over (about 30 to 60 s after the leader stops renewing). The lease needs a store both machines can reach (a conditional write to the Tigris bucket, or a small Redis). It is required, not optional: without it a slow primary and a woken standby would both publish. The existing restart recovery covers the rest, but the lag window above becomes a duplicate-push window on a failover. About $4 to $6 a month more (check Fly's pricing). `fly.toml`'s "exactly one machine" comment and docs/deploy.md would change with it. Before building, run the design past the advisor: it touches `index.ts`, the engine start, `/health` and `fly.toml`.

**Independence from the fly.dev address.** The app falls back to `https://hate-watch-api.fly.dev` (`app/src/lib/api.ts`) and `associatedDomains` in `app/app.json` names it, so a second host elsewhere cannot take over. An over-the-air update can ship a list of fallback API URLs to builds after 12 (JavaScript only). A custom domain that can be re-pointed needs a new build because of `associatedDomains`. Both need a second host that is itself fed from the replica.

**Active-active** is not planned: it would need a networked database and elected pollers, a rewrite for a server that costs a few dollars a month, and the alert ids assume one writer.

### Known gaps

- **Exactly one machine may replicate to a bucket path.** Litestream's own tips warn that two replicators into one path can make a restore impossible. A future standby restores with `-f` and never replicates; a development machine never gets the secret.
- **No final sync on a stop.** When the server exits on SIGTERM, Litestream is killed with the container and does not flush its last second. A normal deploy loses nothing, because the volume persists; only a volume lost at the same moment would.
- **`/health/deep` does not watch F1's or the UFC's loops,** only the game trackers, the ESPN replies and the database.
- **If `savings.scoreboard-sleep` ever ships** (the call-reduction branch), the 120-second ESPN silence check will false-alarm overnight and needs a longer limit or a quiet-hours rule.

### What was tested

Ran, offline (October 12, 2026): `test/health.test.ts` (every check passing and failing, the boot grace, the Litestream error counter, the metrics parser, the ESPN-reply timestamp); the real server on a copy of the development database, where `GET /health/deep` answered 200 over HTTP and `/health` still answered; `start.sh` with stand-in `litestream` and `node` programs in the three cases (no secret: just the server; secret and a working restore: restore, replicate, server; secret and a failing restore: it stops and the server is never started). Litestream's flags and metric names were read from its v0.5.17 source (`restore -if-db-not-exists -if-replica-exists`, `replicate`, `litestream_sync_error_count`, `litestream_disk_full`), the `busy_timeout` advice from its tips page, and `fly volumes create --snapshot-id`, `fly deploy --image`, `fly volumes snapshots list <volume id>` and `fly secrets set --stage` from `fly ... --help`. The tests open an in-memory database, never the development one.

**Not run, and only the first deploy can show:** the image build (there is no Docker on the Mac; Fly's remote builder is the first build), the real Litestream against a real bucket, the restore of a real replica, and the behaviour of the Fly commands (their flags exist; what they do to a live app was not run) and of Tigris. That is why step 1 deploys without the secret and step 5 is a rehearsal.
