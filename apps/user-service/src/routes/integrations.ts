// Per-user third-party integrations.
//
// Today: Google Drive — used so a user's "Export to Sheets" lands in
// their own Drive instead of the workspace's shared service-account
// drive. Tomorrow: Dropbox / OneDrive / others. Provider-specific code
// lives behind a thin abstraction (PROVIDERS map below) so the route
// surface stays uniform.
//
// Auth model:
//   - Code flow with `access_type=offline&prompt=consent` so we get a
//     refresh token (not just access_token like Sign-in's implicit flow).
//   - The OAuth `state` parameter is an HMAC-SHA256 signed JSON blob
//     carrying `{userId, provider, ts}` so the callback can identify
//     who's connecting WITHOUT trusting the redirect's session cookie
//     (which can be missing if the user crosses devices mid-flow).
//   - State has a 15-minute TTL — anything older is rejected.
//
// Storage:
//   - Refresh token AES-256-GCM encrypted via tokenCrypto.ts.
//   - One row per (user_id, provider) in user_oauth_grants — UPDATE on
//     reconnect, soft-delete via revoked_at on disconnect.

import type { FastifyInstance } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { supabase } from '@forecast/db'
import { encryptToken, isTokenCryptoConfigured } from '../lib/tokenCrypto.js'

// ─── Provider config ─────────────────────────────────────────────────────────

type ProviderConfig = {
  scopes:        string[]
  authUri:       string
  tokenUri:      string
  // For displaying back to the user in the UI: "Connected as foo@bar.com"
  // Returned by the provider's userinfo endpoint after token exchange.
  userinfoUri?:  string
}

const PROVIDERS: Record<string, ProviderConfig> = {
  google_drive: {
    // drive.file = only files this app creates (least privilege — we
    // can't poke around in unrelated Drive content even if we tried).
    // spreadsheets = read/write the sheets we generate.
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    authUri:     'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUri:    'https://oauth2.googleapis.com/token',
    userinfoUri: 'https://www.googleapis.com/oauth2/v3/userinfo',
  },
}

// ─── State signing / verification ────────────────────────────────────────────
// Uses OAUTH_STATE_SECRET if set; falls back to JWT_PRIVATE_KEY (already
// required in every env) or OAUTH_TOKEN_ENC_KEY (also required). In
// production we refuse to start the OAuth flow if NONE of these are set
// — a dev-only literal fallback would let an attacker forge state for
// any user and overwrite their grant during the callback.

function getStateSecret(): string | null {
  const s =
    process.env.OAUTH_STATE_SECRET ||
    process.env.JWT_PRIVATE_KEY ||
    process.env.OAUTH_TOKEN_ENC_KEY ||
    null
  // In dev (NODE_ENV !== 'production') a missing secret means a fresh
  // checkout pre-key-generation — fall back to a deterministic dev
  // string so localhost just works. In prod this MUST throw / return
  // null so /connect can refuse rather than mint forgeable state.
  if (s) return s
  if (process.env.NODE_ENV === 'production') return null
  return 'dev-only-state-secret-do-not-use-in-prod'
}

const STATE_TTL_MS = 15 * 60 * 1000

function signState(payload: { userId: string; provider: string }): string | null {
  const secret = getStateSecret()
  if (!secret) return null
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString('base64url')
  const sig  = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyState(state: string): { userId: string; provider: string } | null {
  if (!state || typeof state !== 'string') return null
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const secret = getStateSecret()
  if (!secret) return null
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(sig, 'base64url')
  const b = Buffer.from(expected, 'base64url')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof data?.ts !== 'number') return null
    if (Date.now() - data.ts > STATE_TTL_MS) return null
    if (typeof data?.userId !== 'string')   return null
    if (typeof data?.provider !== 'string') return null
    return { userId: data.userId, provider: data.provider }
  } catch {
    return null
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRedirectUri(): string {
  // The frontend is at FRONTEND_URL (Next.js) and rewrites /api/v1/* to the
  // gateway. So the OAuth redirect target is always the frontend origin —
  // Google never talks directly to the gateway.
  const frontend = process.env.FRONTEND_URL || 'http://localhost:3000'
  return `${frontend}/api/v1/integrations/google-drive/callback`
}

function clientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  if (clientId.startsWith('REPLACE') || clientSecret.startsWith('REPLACE')) return null
  return { clientId, clientSecret }
}

function frontendIntegrationsUrl(query: Record<string, string>): string {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:3000'
  const qs = new URLSearchParams(query).toString()
  return `${frontend}/settings/integrations?${qs}`
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function integrationsRoutes(app: FastifyInstance) {

  // GET /integrations/google-drive/status
  // Returns whether the calling user has an active Drive grant + the
  // Google account email it's linked to.
  app.get('/google-drive/status', async (req: any, reply: any) => {
    const user = req.user
    if (!user?.id) return reply.status(401).send({ errors: [{ code: 'NO_USER' }] })

    const { data } = await supabase
      .from('user_oauth_grants')
      .select('granted_email, granted_at, last_used_at, scopes')
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .is('revoked_at', null)
      .maybeSingle()

    if (!data) return reply.status(200).send({ connected: false })
    return reply.status(200).send({
      connected:    true,
      grantedEmail: (data as any).granted_email,
      grantedAt:    (data as any).granted_at,
      lastUsedAt:   (data as any).last_used_at,
      scopes:       (data as any).scopes || [],
    })
  })

  // GET /integrations/google-drive/connect
  // Returns the authorize URL the frontend should open. We don't 302 here
  // because the frontend wants to control whether to popup vs redirect.
  app.get('/google-drive/connect', async (req: any, reply: any) => {
    const user = req.user
    if (!user?.id) return reply.status(401).send({ errors: [{ code: 'NO_USER' }] })

    const creds = clientCreds()
    if (!creds) {
      return reply.status(503).send({ errors: [{
        code: 'NOT_CONFIGURED',
        message: 'GOOGLE_OAUTH_CLIENT_ID/SECRET not set on the server.',
      }] })
    }
    if (!isTokenCryptoConfigured()) {
      return reply.status(503).send({ errors: [{
        code: 'NOT_CONFIGURED',
        message: 'OAUTH_TOKEN_ENC_KEY not set — refresh tokens can\'t be encrypted at rest.',
      }] })
    }

    const provider = 'google_drive'
    const cfg = PROVIDERS[provider]
    const state = signState({ userId: user.id, provider })
    if (!state) {
      // Production deploy with no OAuth_STATE_SECRET / JWT_PRIVATE_KEY /
      // OAUTH_TOKEN_ENC_KEY — refusing to mint state is safer than using
      // a guessable fallback. (P1-2 from Apr 30 audit.)
      return reply.status(503).send({ errors: [{
        code: 'NOT_CONFIGURED',
        message: 'OAuth state secret is not configured on the server. Set OAUTH_STATE_SECRET (or JWT_PRIVATE_KEY) in env.',
      }] })
    }

    const params = new URLSearchParams({
      client_id:     creds.clientId,
      redirect_uri:  getRedirectUri(),
      response_type: 'code',
      scope:         cfg.scopes.join(' '),
      access_type:   'offline',  // → refresh token
      prompt:        'consent',  // force consent so we ALWAYS get a refresh token even on re-grant
      include_granted_scopes: 'true',
      state,
    })

    return reply.status(200).send({ url: `${cfg.authUri}?${params.toString()}` })
  })

  // GET /integrations/google-drive/callback
  // Public route — Google redirects the browser here with `code` and
  // `state`. Both are verified before we touch the DB. Always responds
  // with a redirect to the Settings page; query params communicate
  // success/failure to the UI.
  app.get('/google-drive/callback', async (req: any, reply: any) => {
    const { code, state, error: oauthError } = (req.query || {}) as Record<string, string>

    if (oauthError) {
      // User clicked "Cancel" or denied scope on the consent screen.
      return reply.redirect(frontendIntegrationsUrl({ gdrive: 'error', reason: oauthError }))
    }
    if (!code || !state) {
      return reply.redirect(frontendIntegrationsUrl({ gdrive: 'error', reason: 'missing_code_or_state' }))
    }

    const verified = verifyState(state)
    if (!verified) {
      return reply.redirect(frontendIntegrationsUrl({ gdrive: 'error', reason: 'invalid_state' }))
    }
    if (verified.provider !== 'google_drive') {
      return reply.redirect(frontendIntegrationsUrl({ gdrive: 'error', reason: 'provider_mismatch' }))
    }

    const creds = clientCreds()
    if (!creds) {
      return reply.redirect(frontendIntegrationsUrl({ gdrive: 'error', reason: 'not_configured' }))
    }

    try {
      // Exchange the authorization code for a refresh token + access token.
      const tokenRes = await fetch(PROVIDERS.google_drive.tokenUri, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          code,
          client_id:     creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri:  getRedirectUri(),
          grant_type:    'authorization_code',
        }),
      })
      const tokenData = await tokenRes.json() as any
      if (!tokenRes.ok || !tokenData?.refresh_token) {
        // No refresh_token typically means the user has previously
        // granted access from this client and Google reused that grant
        // without re-issuing one. `prompt=consent` should prevent it,
        // but we'll surface it cleanly if it happens.
        //
        // Strip any token material before logging — Google can return a
        // valid `access_token` and `id_token` even when refresh_token is
        // missing, and those are bearer credentials we don't want in
        // platform logs (Render retains warn-level lines indefinitely).
        const reason = tokenData?.error || 'no_refresh_token'
        const { access_token, id_token, refresh_token, ...safeForLog } = tokenData || {}
        console.warn('[gdrive callback] token exchange failed:', reason, safeForLog)
        return reply.redirect(frontendIntegrationsUrl({ gdrive: 'error', reason }))
      }

      // Look up the connected Google account email so the UI can show
      // "Connected as foo@gmail.com" — useful when the user signs into
      // a different Google account than their Momentum email.
      let grantedEmail: string | null = null
      try {
        const meRes = await fetch(PROVIDERS.google_drive.userinfoUri!, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        })
        if (meRes.ok) {
          const me = await meRes.json() as { email?: string }
          grantedEmail = (me.email || '').toLowerCase() || null
        }
      } catch { /* non-fatal */ }

      // Encrypt the refresh token before it goes anywhere near the DB.
      const refreshTokenEnc = encryptToken(tokenData.refresh_token)

      // Granted scopes can be a subset of what we requested if the user
      // unticks one on the consent screen. Persisting what we actually
      // got lets the export endpoint refuse cleanly later instead of
      // calling a Sheets endpoint and 403'ing.
      const grantedScopes: string[] = typeof tokenData.scope === 'string'
        ? tokenData.scope.split(/\s+/).filter(Boolean)
        : PROVIDERS.google_drive.scopes

      // Upsert: one row per (user, provider). Reconnect path clears
      // revoked_at + replaces the token.
      const { error: upsertErr } = await supabase
        .from('user_oauth_grants')
        .upsert({
          user_id:           verified.userId,
          provider:          'google_drive',
          refresh_token_enc: refreshTokenEnc,
          scopes:            grantedScopes,
          granted_email:     grantedEmail,
          granted_at:        new Date().toISOString(),
          revoked_at:        null,
        }, { onConflict: 'user_id,provider' })

      if (upsertErr) {
        console.error('[gdrive callback] upsert failed:', upsertErr.message)
        return reply.redirect(frontendIntegrationsUrl({ gdrive: 'error', reason: 'db_upsert_failed' }))
      }

      return reply.redirect(frontendIntegrationsUrl({ gdrive: 'connected' }))
    } catch (e: any) {
      console.error('[gdrive callback] unexpected error:', e?.message || e)
      return reply.redirect(frontendIntegrationsUrl({ gdrive: 'error', reason: 'exchange_failed' }))
    }
  })

  // DELETE /integrations/google-drive
  // Soft-revokes the grant. The row stays for audit; future reconnect
  // updates this same row in place via upsert.
  app.delete('/google-drive', async (req: any, reply: any) => {
    const user = req.user
    if (!user?.id) return reply.status(401).send({ errors: [{ code: 'NO_USER' }] })

    const { error } = await supabase
      .from('user_oauth_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .is('revoked_at', null)

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ ok: true })
  })

}
