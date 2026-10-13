#!/bin/sh
# The container's entrypoint (Dockerfile). Without LITESTREAM_REPLICA_URL it only starts the server, as before.
# With it: (1) if the database file is missing (a new or empty volume) and the replica has one, restore it first;
# (2) keep Litestream replicating next to the server. docs/redundancy.md. Exactly one machine may replicate to a bucket path.
set -eu

DB="${HW_DB:-/data/hatewatch.db}"

if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
  # -if-db-not-exists: nothing to do when the volume already has the database (every normal boot).
  # -if-replica-exists: a first run with nothing replicated yet is fine. Any other failure (bad credentials, an unreachable
  # bucket) stops the boot on purpose: starting empty would make a new database and replicate it over the good copy.
  # The shell checks for the file first, so a normal boot never touches the bucket: a Tigris outage or a rotated key can't
  # stop a routine restart.
  if [ ! -f "$DB" ]; then
    litestream restore -o "$DB" -if-db-not-exists -if-replica-exists "$LITESTREAM_REPLICA_URL"
  fi

  # Litestream runs beside the server, never in front of it: if it dies it is started again in 5s, and the server never
  # waits for it. GET /health/deep reports a Litestream that isn't answering.
  (
    while true; do
      litestream replicate -config /etc/litestream.yml || true
      echo "[litestream] exited; restarting in 5s"
      sleep 5
    done
  ) &
else
  echo "[boot] LITESTREAM_REPLICA_URL is not set: the database is not replicated off this machine"
fi

exec node --disable-warning=ExperimentalWarning src/index.ts
