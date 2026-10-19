# SutraFlow
# Copyright (c) 2026-27 Surya Partap Singh
# Developer: Surya Partap Singh | Website: MixAgile.com
# File version: 1.7.5
# License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
# A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
# SPDX-License-Identifier: AGPL-3.0-only
# syntax=docker/dockerfile:1
# SutraFlow: one image for the studio and for headless engines (SUTRA_MODE=studio | engine).
#
#   docker build -t sutraflow:1.7.5 .
#   docker run -p 4800:4800 -p 8080:8080 -v sutra-data:/data sutraflow:1.7.5
#   docker run -e SUTRA_MODE=engine -e SUTRA_ADMIN_TOKEN=... -v ./deploy:/deploy:ro -p 8080:8080 sutraflow:1.7.5

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    SUTRA_MODE=studio \
    SUTRA_DATA_DIR=/data \
    SUTRA_DEPLOY_DIR=/deploy \
    SUTRA_ADMIN_HOST=0.0.0.0 \
    SUTRA_ADMIN_PORT=4800 \
    SUTRA_GATEWAY_HTTP_PORT=8080 \
    SUTRA_GATEWAY_HTTPS_PORT=8443 \
    SUTRA_LOG_FORMAT=json
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /deploy \
 && chown node:node /data /deploy
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/docs/sutraflow-user-guide.html ./docs/sutraflow-user-guide.html
COPY --from=build --chown=node:node /app/samples ./samples
USER node
VOLUME ["/data"]
EXPOSE 4800 8080 8443
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.SUTRA_ADMIN_PORT||4800)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# tini forwards SIGTERM so the engine drains its running steps before it stops.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/main.js"]
