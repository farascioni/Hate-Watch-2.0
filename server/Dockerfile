# Litestream 0.5.17 (pinned by digest), the static binary that replicates the database off the volume: docs/redundancy.md.
FROM litestream/litestream:0.5.17@sha256:4b02b9859a6b6b4087d8b8944e15f7e984bd7957cba322bbeee38b0e27b9656a AS litestream

# Node 24 runs the TypeScript sources directly (type stripping) and ships node:sqlite.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Litestream and the CA bundle it needs to reach the bucket over HTTPS (node:slim's bundle may be absent).
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=litestream /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY litestream.yml /etc/litestream.yml
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# SQLite lives on the Fly volume mounted at /data (see fly.toml).
ENV HW_DB=/data/hatewatch.db \
    PORT=8080
EXPOSE 8080

# Runs as root on purpose: Fly mounts volumes root-owned, so a non-root user can't write /data.
# start.sh restores the database from the replica when the volume is empty, starts Litestream if LITESTREAM_REPLICA_URL is
# set, then execs the server (node --disable-warning=ExperimentalWarning src/index.ts).
CMD ["./start.sh"]
