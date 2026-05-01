# Momentum production process types.
#
# This file is consumed by Heroku-style platforms (Render, Railway, Fly,
# DigitalOcean App Platform, Heroku itself). Each entry is a long-running
# process; the platform restarts it on crash.
#
# Pre-requisite for every process: `pnpm install --frozen-lockfile && pnpm build`
# at deploy time so each `node dist/index.js` resolves.
#
# REQUIRED INFRASTRUCTURE
#   - Postgres (we use Supabase) — connection in DATABASE_URL / SUPABASE_*
#   - Redis (BullMQ + session store) — REDIS_URL
#   - Public hostname for the web tier — NEXT_PUBLIC_APP_URL
#
# NETWORK TOPOLOGY
#   - `web` is the only public-facing process (the Next.js app)
#   - `api-gateway` is reachable from `web` only (private network or
#     reverse-proxied via Next route handlers)
#   - All `*-service` processes bind to 127.0.0.1 and are only reachable
#     from `api-gateway` over the private network — never expose them
#   - `worker` (apps/jobs) makes outbound HTTP to notification-service
#     using NOTIFICATION_SERVICE_URL (default http://localhost:3006)
#
# DO NOT collapse `worker` into another process. The whole point of a
# separate worker is that BullMQ's Redis-backed schedules survive web
# restarts and don't get throttled by request handlers.

web:           pnpm --filter @forecast/web start
api-gateway:   pnpm --filter @forecast/api-gateway start
auth:          pnpm --filter @forecast/auth-service start
notification:  pnpm --filter @forecast/notification-service start
project:       pnpm --filter @forecast/project-service start
report:        pnpm --filter @forecast/report-service start
time:          pnpm --filter @forecast/time-service start
user:          pnpm --filter @forecast/user-service start
worker:        pnpm --filter @forecast/jobs start
