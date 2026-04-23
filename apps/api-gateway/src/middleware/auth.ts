import type { FastifyRequest, FastifyReply } from 'fastify'
import { jwtVerify } from 'jose'
import type { Redis } from 'ioredis'

const issuer   = 'forecast-api'
const audience = 'forecast-web'

// Lazy secret loader — env vars are loaded by dotenv at runtime, but ESM
// hoists imports above all other module code, so a top-level env check would
// fire before dotenv had a chance to populate process.env. Defer to first use.
let _secret: Uint8Array | null = null
function getSecret(): Uint8Array {
  if (_secret) return _secret
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('[gateway] JWT_SECRET env var is required and must be ≥32 chars')
  }
  _secret = new TextEncoder().encode(process.env.JWT_SECRET)
  return _secret
}

// Headers we set from the verified JWT. They MUST be stripped from incoming
// requests first — otherwise a client could spoof them and have them flow
// downstream if any code path skipped verification.
const TRUST_HEADERS = ['x-user-id', 'x-workspace-id', 'x-user-profile', 'x-seat-type'] as const

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply, redis: Redis) {
  // 🛡️ Strip client-supplied trust headers BEFORE anything else.
  for (const h of TRUST_HEADERS) delete req.headers[h]

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ errors: [{ code: 'MISSING_TOKEN', message: 'Authorization header required' }] })
  }

  const token = authHeader.slice(7)

  try {
    // Verify with full claim validation: signature, expiry, issuer, audience.
    const { payload } = await jwtVerify(token, getSecret(), { issuer, audience })

    // Forward verified user context to downstream services
    req.headers['x-user-id']      = payload.sub        as string
    req.headers['x-workspace-id'] = payload.wid        as string
    req.headers['x-user-profile'] = payload.profile    as string
    req.headers['x-seat-type']    = payload.seat       as string

  } catch (err: any) {
    const code    = err.code === 'ERR_JWT_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
    const message = err.code === 'ERR_JWT_EXPIRED' ? 'Token expired'  : 'Invalid token'
    return reply.status(401).send({ errors: [{ code, message }] })
  }
}
