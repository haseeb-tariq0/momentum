import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { createHmac, timingSafeEqual } from 'crypto'
import { reportRoutes } from './routes/reports.js'
import { startWorker } from './workers/reportWorker.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; workspaceId: string; role: 'admin' | 'manager' | 'member' }
  }
}

// HS256 JWT verification using Node built-ins (no extra deps).
// Mirrors the gateway: validates signature, expiry, issuer, audience.
const JWT_ISSUER   = 'forecast-api'
const JWT_AUDIENCE = 'forecast-web'

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function verifyJwt(token: string, secret: string): { sub: string; wid: string; profile: string } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('MALFORMED')
  const [h, p, s] = parts
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest()
  const actual   = b64urlDecode(s)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('BAD_SIG')
  const payload = JSON.parse(b64urlDecode(p).toString('utf8'))
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && now >= payload.exp) throw new Error('EXPIRED')
  if (payload.iss !== JWT_ISSUER)    throw new Error('BAD_ISS')
  if (payload.aud !== JWT_AUDIENCE)  throw new Error('BAD_AUD')
  return { sub: payload.sub, wid: payload.wid, profile: payload.profile }
}

// Headers downstream services read from. Stripped on every request so a client
// cannot spoof them — they're set only from the verified JWT below.
const TRUST_HEADERS = ['x-user-id', 'x-workspace-id', 'x-user-role', 'x-user-profile'] as const

async function main() {
  // Fail fast if JWT_SECRET is missing — never boot without a way to verify tokens.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('[report-service] JWT_SECRET env var is required and must be ≥32 chars')
    process.exit(1)
  }
  const jwtSecret = process.env.JWT_SECRET

  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 1_000_000 })
  await app.register(cors)

  app.addHook('onRequest', async (req, reply) => {
    // 🛡️ Strip client-supplied trust headers first.
    for (const h of TRUST_HEADERS) delete req.headers[h]

    if (req.url === '/health') return

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ errors: [{ code: 'MISSING_TOKEN', message: 'Authorization header required' }] })
    }

    try {
      const payload = verifyJwt(authHeader.slice(7), jwtSecret)
      req.user = {
        id:          payload.sub,
        workspaceId: payload.wid,
        role:        (payload.profile === 'super_admin' || payload.profile === 'admin') ? 'admin'
                   : payload.profile === 'account_manager' ? 'manager'
                   : 'member',
      }
    } catch (err: any) {
      const code = err.message === 'EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
      return reply.status(401).send({ errors: [{ code, message: code }] })
    }
  })

  await app.register(reportRoutes, { prefix: '/reports' })

  app.get('/health', async () => ({ status: 'ok', service: 'report-service' }))

  startWorker()

  try {
    // Bind to loopback only — this service is not reachable from outside the
    // host. All external traffic must go through the gateway, which can proxy
    // here if /api/v1/reports is ever wired up to this service.
    await app.listen({ port: Number(process.env.REPORT_SERVICE_PORT) || 3005, host: '127.0.0.1' })
    console.log('✅ Report service on 127.0.0.1:', process.env.REPORT_SERVICE_PORT || 3005)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Never crash silently on a dangling promise or thrown error in an async handler.
process.on('unhandledRejection', (err) => { console.error('[report-service] unhandledRejection:', err); process.exit(1) })
process.on('uncaughtException',  (err) => { console.error('[report-service] uncaughtException:',  err); process.exit(1) })

main()
