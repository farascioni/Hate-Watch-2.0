# Node 24 runs the TypeScript sources directly (type stripping) and ships node:sqlite.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# SQLite lives on the Fly volume mounted at /data (see fly.toml).
ENV HW_DB=/data/hatewatch.db \
    PORT=8080
EXPOSE 8080

# Runs as root on purpose: Fly mounts volumes root-owned, so a non-root user can't write /data.
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
