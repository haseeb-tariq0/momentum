import type { FastifyRequest, FastifyReply } from 'fastify'
import { jwtVerify } from 'jose'

const issuer   = 'forecast-api'
const audience = 'forecast-web'

let _secret: Uint8Array | null = null
function getSecret(): Uint8Array {
  if (_secret) return _secret
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('[server] JWT_SECRET env var is required and must be ≥32 chars')
  }
  _secret = new TextEncoder().encode(process.env.JWT_SECRET)
  return _secret
}

// Trust headers — the pre-consolidation gateway used these to hand off
// verified user context to downstream services over HTTP. Still stripped
// on incoming requests in case a client tries to spoof them, even though
// downstream services now live in the same process and will read req.user
// directly.
const TRUST_HEADERS = ['x-user-id', 'x-workspace-id', 'x-user-profile', 'x-seat-type'] as const

export type AuthUser = {
  id:          string
  workspaceId: string
  profile:     string
  seat:        string
}

/**
 * Verify the bearer JWT, set `req.user` AND the legacy trust headers so
 * route modules that still read `req.headers['x-user-id']` keep working
 * during the consolidation — they'll be migrated to `req.user` over time.
 */
export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  for (const h of TRUST_HEADERS) delete req.headers[h]

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ errors: [{ code: 'MISSING_TOKEN', message: 'Authorization header required' }] })
  }
  const token = authHeader.slice(7)

  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer, audience })

    const user: AuthUser = {
      id:          payload.sub     as string,
      workspaceId: payload.wid     as string,
      profile:     payload.profile as string,
      seat:        payload.seat    as string,
    }

    ;(req as any).user = user

    // Legacy headers — downstream onRequest hooks in imported route modules
    // read these. Setting both is a belt-and-braces safety net while the
    // codebase is still mid-migration; can be dropped later.
    req.headers['x-user-id']      = user.id
    req.headers['x-workspace-id'] = user.workspaceId
    req.headers['x-user-profile'] = user.profile
    req.headers['x-seat-type']    = user.seat
  } catch (err: any) {
    const code    = err.code === 'ERR_JWT_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
    const message = err.code === 'ERR_JWT_EXPIRED' ? 'Token expired'  : 'Invalid token'
    return reply.status(401).send({ errors: [{ code, message }] })
  }
}

export { TRUST_HEADERS }
