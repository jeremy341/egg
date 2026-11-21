# syntax=docker/dockerfile:1
# One image for the web app and the deployment worker. Build it from the repository root:
#   docker build -f deploy/Dockerfile -t egg-app:local .
# (compose.yaml does this.) The worker is the same image started with a different command.

ARG NODE_VERSION=22

# --- Install dependencies ---------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
# pnpm-workspace.yaml references the geoip-country patch; deps stage needs it before install.
COPY web/patches/ ./patches/
# Install the pnpm version that package.json pins, without corepack (older corepack
# versions cannot verify newer pnpm releases).
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]")"
RUN --mount=type=cache,id=egg-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- Build the app ----------------------------------------------------------
FROM deps AS build
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

# --- Run --------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
# git clones the projects. Nothing is built in this image: builds run on each user's Nest container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates bash \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
WORKDIR /app/web
# Everything stays, development dependencies included: next.config.ts needs typescript
# at start, and the worker runs through tsx.
COPY --from=build --chown=node:node /app/web ./
# The data folder (compose mounts the host folder here). Must be writable by the user.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
