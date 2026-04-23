import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { authRoutes } from './routes/auth.js'

async function main() {
  if (!process.env.COOKIE_SECRET || process.env.COOKIE_SECRET.length < 32) {
    throw new Error('[auth] COOKIE_SECRET env var is required and must be ≥32 chars')
  }

  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 1_000_000 })

  // CORS allowlist (anti-CSRF). In production, requests with no Origin header
  // are rejected — only same-origin browser requests with a real Origin pass.
  const isProd = process.env.NODE_ENV === 'production'
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:4000')
    .split(',').map(s => s.trim()).filter(Boolean)
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        if (isProd) return cb(new Error('CORS: origin required'), false)
        return cb(null, true) // dev tools (curl, Postman) only in non-prod
      }
      if (allowedOrigins.includes(origin)) return cb(null, true)
      if (!isProd && /\.ngrok(-free)?\.(app|io)$|^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/i.test(origin)) {
        return cb(null, true)
      }
      return cb(new Error('CORS: origin not allowed'), false)
    },
    credentials: true,
  })
  await app.register(cookie, { secret: process.env.COOKIE_SECRET })
  await app.register(authRoutes, { prefix: '/auth' })

  app.get('/health', async () => ({
    status:   'ok',
    service:  'auth',
    supabase: !!process.env.SUPABASE_URL,
    jwt:      !!process.env.JWT_SECRET,
  }))

  const port = Number(process.env.AUTH_SERVICE_PORT) || 3001
  // Bind to loopback only — gateway is the only public entry point.
  // This is the single most important defense against header spoofing on
  // direct access to port 3001.
  await app.listen({ port, host: '127.0.0.1' })
  console.log(`✅ Auth service → 127.0.0.1:${port}`)
  console.log(`   Supabase: ${process.env.SUPABASE_URL || 'MISSING'}`)
}

process.on('unhandledRejection', (err) => { console.error('[auth-service] unhandledRejection:', err); process.exit(1) })
process.on('uncaughtException',  (err) => { console.error('[auth-service] uncaughtException:',  err); process.exit(1) })

main().catch(e => { console.error(e); process.exit(1) })
