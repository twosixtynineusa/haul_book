# syntax=docker/dockerfile:1
# Haul Book API image — NestJS HTTP server (port 3000) + Prisma (Postgres 18).
#
# Build context is the REPO ROOT (the api consumes packages/shared via a
# `file:../../packages/shared` dependency):
#   docker build -f apps/api/Dockerfile --target prod .
#
# Stages:
#   dev   — thin stage for the docker-compose DEFAULT (dev) profile. Copies no
#           sources: the repo is bind-mounted at /workspace and node_modules/dist
#           live in named volumes seeded by `make setup`.
#   build — compiles @haulbook/shared and the api.
#   prod  — production runtime for the compose `full` profile.

# ---------------------------------------------------------------------------
# dev — compose services: shared, api (target: dev)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS dev
# openssl: required at runtime by Prisma's linux-musl engines
RUN apk add --no-cache openssl
WORKDIR /workspace/apps/api
ENV NODE_ENV=development
# Dev-only stage (never shipped): runs as root because the dependency volumes it
# writes are root-owned. The prod stage below runs as a non-root user.
CMD ["npm", "run", "start:dev"]

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app

# 1) @haulbook/shared — installed + compiled before the api's npm ci (the api
#    resolves it as a file: symlink to ../../packages/shared).
COPY packages/shared ./packages/shared
RUN npm ci --prefix packages/shared && npm run build --prefix packages/shared

# 2) the api itself (npm ci runs `prisma generate` via postinstall). `prisma` is a
#    runtime dependency so the prod image can run `prisma migrate deploy`.
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
RUN npm ci --prefix apps/api && npm run build --prefix apps/api && \
    npm prune --omit=dev --prefix apps/api

# ---------------------------------------------------------------------------
# prod — runtime image (compose `full` profile)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS prod
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app

# Keep the packages/shared <-> apps/api relative layout so the
# node_modules/@haulbook/shared symlink still resolves, and keep shared's own
# node_modules so its runtime deps (zod) resolve from its real path.
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Non-root runtime user (compose overrides it with the host uid so files written
# to the bind-mounted output folder belong to you).
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser && \
    chown -R appuser:appgroup /app
USER appuser

WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/main.js"]
