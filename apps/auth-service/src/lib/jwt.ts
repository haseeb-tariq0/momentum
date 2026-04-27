import { SignJWT, jwtVerify } from 'jose'

const issuer   = 'forecast-api'
const audience = 'forecast-web'

// Lazy secret loader — env vars are loaded by dotenv at runtime, but ESM
// hoists imports above all other module code. A top-level env check would
// fire before dotenv had a chance to populate process.env. Defer to first use.
let _secret: Uint8Array | null = null
function getSecret(): Uint8Array {
  if (_secret) return _secret
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('[auth] JWT_SECRET env var is required and must be ≥32 chars')
  }
  _secret = new TextEncoder().encode(process.env.JWT_SECRET)
  return _secret
}

export interface AccessTokenPayload {
  sub:     string   // userId
  wid:     string   // workspaceId
  profile: string   // super_admin | admin | account_manager | collaborator
  seat:    string   // core | collaborator
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime('8h')   // 8 hours — long enough for a full work day
    .sign(getSecret())
}

export async function signRefreshToken(userId: string): Promise<string> {
  // No expiry — session lasts until the user explicitly logs out.
  // The DB row (refresh_tokens.expires_at = year 2100) is the real gate;
  // logout deletes the row, which immediately invalidates the token.
  return new SignJWT({ sub: userId, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(issuer)
    .sign(getSecret())
}

// For verifying access tokens (requires issuer + audience)
export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret(), { issuer, audience })
  return payload as any
}

// For verifying refresh tokens (no audience — they don't have one)
export async function verifyRefreshToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret(), { issuer })
  return payload as any
}
