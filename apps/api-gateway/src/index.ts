// MUST be first
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import httpProxy from '@fastify/http-proxy'
import { Redis } from 'ioredis'
import { authMiddleware } from './middleware/auth.js'

const SERVICES = {
  auth:     `http://localhost:${process.env.AUTH_SERVICE_PORT    || 3001}`,
  projects: `http://localhost:${process.env.PROJECT_SERVICE_PORT || 3002}`,
  time:     `http://localhost:${process.env.TIME_SERVICE_PORT    || 3003}`,
  users:    `http://localhost:${process.env.USER_SERVICE_PORT    || 3004}`,
  // Note: reports → user-service (contains P&L + utilization routes)
  // Note: notifications → user-service (contains notification routes)
}

async function main() {
  const redis = process.env.UPSTASH_REDIS_URL
    ? new Redis(process.env.UPSTASH_REDIS_URL)
    : { status: 'unavailable', get: async () => null, set: async () => null, del: async () => null } as any

  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 10_000_000 })

  // CORS allowlist (anti-CSRF). Reads ALLOWED_ORIGINS env var (comma-separated).
  const isProd = process.env.NODE_ENV === 'production'
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',').map(s => s.trim()).filter(Boolean)
  await app.register(import('@fastify/cors'), {
    origin: (origin, cb) => {
      if (!origin) {
        if (isProd) return cb(new Error('CORS: origin required'), false)
        return cb(null, true) // dev tools (curl, Postman) only
      }
      if (allowedOrigins.includes(origin)) return cb(null, true)
      // In dev, allow ngrok tunnels + any local-network origin so the app
      // can be demoed on a phone / shared link without reconfiguring env.
      if (!isProd && /\.ngrok(-free)?\.(app|io)$|^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(origin)) {
        return cb(null, true)
      }
      return cb(new Error('CORS: origin not allowed'), false)
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    // 🛡️ Only Content-Type + Authorization. Trust headers (x-user-id, etc.)
    // are SET BY THE GATEWAY from the verified JWT — clients must never send them.
    allowedHeaders: ['Content-Type','Authorization'],
  })

  await app.register(rateLimit, { max: 500, timeWindow: '1 minute' })

  // ── Public auth routes ──────────────────────────────────────────────────
  await app.register(httpProxy, {
    upstream:      SERVICES.auth,
    prefix:        '/api/v1/auth',
    rewritePrefix: '/auth',
  })

  // Auth routes that need the user id header (protected, not truly public)
  await app.register(httpProxy, { upstream: SERVICES.auth, prefix: '/api/v1/account', rewritePrefix: '/auth' })

  // ── Auth middleware ─────────────────────────────────────────────────────
  // The middleware strips trust headers and verifies the JWT on every
  // request. Public routes (/api/v1/auth/*, /health) still need their trust
  // headers stripped — otherwise an attacker could send spoofed headers to
  // a public endpoint that happens to read them.
  const TRUST_HEADERS = ['x-user-id', 'x-workspace-id', 'x-user-profile', 'x-seat-type'] as const
  app.addHook('onRequest', async (req, reply) => {
    for (const h of TRUST_HEADERS) delete req.headers[h]
    if (req.method === 'OPTIONS') return
    if (req.url?.startsWith('/api/v1/auth')) return
    // OAuth callbacks come from Google's browser-side redirect with no
    // session cookie — they authenticate via signed `state` instead.
    // Same exemption we'd give Slack's callback if it lived here.
    //
    // Match the path exactly (after stripping query string) — `startsWith`
    // would also exempt `/callbackfoo`, `/callback/admin`, etc., so any
    // sibling route someone adds later silently inherits the JWT bypass.
    if (req.url) {
      const path = req.url.split('?', 1)[0]
      if (path === '/api/v1/integrations/google-drive/callback') return
    }
    if (req.url === '/health') return
    await authMiddleware(req, reply, redis)
  })

  // ── Protected routes ────────────────────────────────────────────────────
  await app.register(httpProxy, { upstream: SERVICES.projects, prefix: '/api/v1/projects',       rewritePrefix: '/projects' })
  await app.register(httpProxy, { upstream: SERVICES.projects, prefix: '/api/v1/templates',      rewritePrefix: '/templates' })
  await app.register(httpProxy, { upstream: SERVICES.projects, prefix: '/api/v1/resourcing',     rewritePrefix: '/resourcing' })
  await app.register(httpProxy, { upstream: SERVICES.projects, prefix: '/api/v1/search',         rewritePrefix: '/search' })
  await app.register(httpProxy, { upstream: SERVICES.time,     prefix: '/api/v1/time',           rewritePrefix: '/time' })
  await app.register(httpProxy, { upstream: SERVICES.users,    prefix: '/api/v1/users',          rewritePrefix: '/users' })

  // Slack integration → user-service /slack routes
  await app.register(httpProxy, { upstream: SERVICES.users,    prefix: '/api/v1/slack',          rewritePrefix: '/slack' })

  // Reports → user-service /reports routes (P&L, utilization summaries)
  await app.register(httpProxy, { upstream: SERVICES.users,    prefix: '/api/v1/reports',        rewritePrefix: '/reports' })

  // Notifications → user-service /notifications routes
  await app.register(httpProxy, { upstream: SERVICES.users,    prefix: '/api/v1/notifications',  rewritePrefix: '/notifications' })

  // Per-user third-party integrations (Google Drive today) → user-service
  await app.register(httpProxy, { upstream: SERVICES.users,    prefix: '/api/v1/integrations',   rewritePrefix: '/integrations' })

  // Email triggers → notification-service (port 3006)
  await app.register(httpProxy, { upstream: `http://localhost:${process.env.NOTIFICATION_SERVICE_PORT || 3006}`, prefix: '/api/v1/notify', rewritePrefix: '/notify' })

  app.get('/health', async () => ({
    status: 'ok', services: SERVICES,
    db: !!process.env.SUPABASE_URL,
    redis: redis.status || 'connected',
    routes: {
      auth: SERVICES.auth, projects: SERVICES.projects,
      time: SERVICES.time, users: SERVICES.users,
      reports: `${SERVICES.users} (via user-service)`,
      notifications: `${SERVICES.users} (via user-service)`,
    },
  }))

  const port = Number(process.env.API_GATEWAY_PORT) || 4000
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`✅ Gateway → http://localhost:${port}`)
}

process.on('unhandledRejection', (err) => { console.error('[api-gateway] unhandledRejection:', err); process.exit(1) })
process.on('uncaughtException',  (err) => { console.error('[api-gateway] uncaughtException:',  err); process.exit(1) })

main().catch(e => { console.error(e); process.exit(1) })
