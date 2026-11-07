# syntax=docker/dockerfile:1
# Haul Book web image — Next.js 15 (port 3100).
#
# Build context is the REPO ROOT (the web app consumes packages/shared via a
# `file:../../packages/shared` dependency):
#   docker build -f apps/web/Dockerfile --target prod .
#
# Stages:
#   dev   — thin stage for the docker-compose DEFAULT (dev) profile. Copies no
#           sources: the repo is bind-mounted at /workspace and node_modules/.next
#           live in named volumes seeded by `make setup`.
#   build — compiles @haulbook/shared and `next build`.
#   prod  — production runtime for the compose `full` profile.

# ---------------------------------------------------------------------------
# dev — compose `web` service (target: dev)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS dev
WORKDIR /workspace/apps/web
ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1
# Dev-only stage (never shipped): runs as root because the dependency volumes it
# writes are root-owned. The prod stage below runs as a non-root user.
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Rewrites are resolved at build time, so the api's in-cluster URL is baked in.
ARG API_INTERNAL_URL=http://api-prod:3000
ENV API_INTERNAL_URL=$API_INTERNAL_URL

# 1) @haulbook/shared first (file: dependency of the web app)
COPY packages/shared ./packages/shared
RUN npm ci --prefix packages/shared && npm run build --prefix packages/shared

# 2) the web app
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
RUN npm ci --prefix apps/web && npm run build --prefix apps/web

# ---------------------------------------------------------------------------
# prod — runtime image (compose `full` profile)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS prod
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Keep the packages/shared <-> apps/web relative layout so the
# node_modules/@haulbook/shared symlink still resolves.
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/next.config.ts ./apps/web/next.config.ts
COPY --from=build /app/apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/.next ./apps/web/.next

# Non-root runtime user
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser && \
    chown -R appuser:appgroup /app
USER appuser

WORKDIR /app/apps/web
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3100 || exit 1
CMD ["npm", "run", "start"]
