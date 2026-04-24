// Load env before any module that touches process.env at import time.
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'

import { authMiddleware } from './middleware/auth.js'

// Import route modules directly from sibling service packages. The actual
// service bootstrap (apps/*/src/index.ts) is ignored — those files still
// exist so each service can run standalone in dev if needed, but the
// deployed artifact is this single process.
import { authRoutes }       from '../../auth-service/src/routes/auth.js'
import { projectRoutes }    from '../../project-service/src/routes/projects.js'
import { taskRoutes }       from '../../project-service/src/routes/tasks.js'
import { resourcingRoutes } from '../../project-service/src/routes/resourcing.js'
import { templateRoutes }   from '../../project-service/src/routes/templates.js'
import { timeRoutes }       from '../../time-service/src/routes/time.js'
import { userRoutes }       from '../../user-service/src/routes/users.js'
import { importRoutes }     from '../../user-service/src/routes/import.js'
import { syncRoutes, startSyncScheduler } from '../../user-service/src/routes/sync.js'
import { reportRoutes }         from '../../user-service/src/routes/reports.js'
import { notificationRoutes }   from '../../user-service/src/routes/notifications.js'

async function main() {
  // COOKIE_SECRET is required by auth-service (refresh-token cookie).
  // We guard here so the server fails loudly at boot, not silently on login.
  if (!process.env.COOKIE_SECRET || process.env.COOKIE_SECRET.length < 32) {
    throw new Error('[server] COOKIE_SECRET env var is required and must be ≥32 chars')
  }

  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 10_000_000 })

  await app.register(cookie, { secret: process.env.COOKIE_SECRET })

  // CORS allowlist (anti-CSRF). ALLOWED_ORIGINS is a comma-separated list
  // of origins that are trusted to make credentialed requests.
  const isProd = process.env.NODE_ENV === 'production'
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',').map(s => s.trim()).filter(Boolean)
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        if (isProd) return cb(new Error('CORS: origin required'), false)
        return cb(null, true)
      }
      if (allowedOrigins.includes(origin)) return cb(null, true)
      if (!isProd && /\.ngrok(-free)?\.(app|io)$|^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(origin)) {
        return cb(null, true)
      }
      return cb(new Error('CORS: origin not allowed'), false)
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization'],
  })

  await app.register(rateLimit, { max: 500, timeWindow: '1 minute' })

  // ── Auth gate ─────────────────────────────────────────────────────────────
  // Global onRequest hook fires for EVERY route in Fastify regardless of
  // plugin registration order — so we explicitly bypass public paths rather
  // than relying on "register before hook" ordering tricks. /api/v1/auth/* is
  // bypassed wholesale because:
  //   • login / refresh / google / slack OAuth / logout — no token expected
  //   • change-password / invite — handlers call requireAuth() themselves
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return
    if (req.url === '/health') return
    if (req.url?.startsWith('/api/v1/auth/')) return
    await authMiddleware(req, reply)
  })

  // ── Auth routes ───────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/v1/auth' })

  // ── Protected routes ──────────────────────────────────────────────────────
  // Mount each route module at its final /api/v1/* prefix. Order matters
  // for Fastify plugin registration when two plugins share a prefix root.
  await app.register(projectRoutes,       { prefix: '/api/v1/projects'   })
  await app.register(taskRoutes,          { prefix: '/api/v1/projects'   })
  await app.register(templateRoutes,      { prefix: '/api/v1/templates'  })
  await app.register(resourcingRoutes,    { prefix: '/api/v1/resourcing' })
  await app.register(timeRoutes,          { prefix: '/api/v1/time'       })

  // userRoutes contains slack/* handlers alongside user CRUD, all under /users.
  // Frontend slackApi calls will need to hit /api/v1/users/slack/* — the old
  // gateway's /api/v1/slack → /slack rewrite was broken (user-service never
  // exposed /slack at root). The frontend has been updated to match.
  await app.register(userRoutes,          { prefix: '/api/v1/users'      })
  await app.register(importRoutes,        { prefix: '/api/v1/users'      })
  await app.register(syncRoutes,          { prefix: '/api/v1/users/sync' })
  await app.register(reportRoutes,        { prefix: '/api/v1/reports'    })
  await app.register(notificationRoutes,  { prefix: '/api/v1/notifications' })

  app.get('/health', async () => ({
    status: 'ok',
    service: 'server',
    version: 'consolidated-v1',
    ts: Date.now(),
    db: !!process.env.SUPABASE_URL,
  }))

  // Render provides PORT; locally we default to 4000 (same as the old gateway).
  const port = Number(process.env.PORT) || Number(process.env.API_GATEWAY_PORT) || 4000
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`✅ Momentum server → http://0.0.0.0:${port}  [consolidated]`)

  // Forecast.it sync scheduler — no-op if FORECAST_API_KEY is unset.
  // Honors FORECAST_SYNC_DISABLED=1 for when you want the server up but
  // don't want any outbound sync traffic (e.g. demo environments).
  if (process.env.FORECAST_SYNC_DISABLED !== '1') {
    startSyncScheduler()
    console.log('🔄 Forecast.it sync scheduler started (5 min interval)')
  }
}

process.on('unhandledRejection', (err) => { console.error('[server] unhandledRejection:', err); process.exit(1) })
process.on('uncaughtException',  (err) => { console.error('[server] uncaughtException:',  err); process.exit(1) })

main().catch(e => { console.error(e); process.exit(1) })
