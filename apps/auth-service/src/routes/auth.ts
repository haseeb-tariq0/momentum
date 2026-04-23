import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { z } from 'zod'
import { supabase } from '@forecast/db'
import { signAccessToken, signRefreshToken, verifyToken, verifyRefreshToken } from '../lib/jwt.js'
import { OAuth2Client } from 'google-auth-library'

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
})

// ─── Auth helper ─────────────────────────────────────────────────────────────
// Verifies the Bearer token directly. Never trust x-user-id headers — those
// are gateway-internal and can be spoofed by anything that reaches us directly
// on port 3001.
async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) {
    reply.status(401).send({ errors: [{ code: 'UNAUTHORIZED', message: 'Bearer token required' }] })
    return null
  }
  try {
    const payload = await verifyToken(h.slice(7))
    return payload as { sub: string; wid: string; profile: string; seat: string }
  } catch {
    reply.status(401).send({ errors: [{ code: 'INVALID_TOKEN' }] })
    return null
  }
}

// ─── Login rate limiting (in-memory sliding window per IP) ───────────────────
// 5 attempts / minute / IP. Anything more returns 429. Single-process only —
// upgrade to redis-backed store if we ever run multiple auth-service replicas.
const loginAttempts = new Map<string, number[]>()
function checkLoginRate(ip: string): boolean {
  const now = Date.now()
  const windowMs = 60_000
  const maxAttempts = 5
  const arr = (loginAttempts.get(ip) || []).filter(t => now - t < windowMs)
  if (arr.length >= maxAttempts) {
    loginAttempts.set(ip, arr)
    return false
  }
  arr.push(now)
  loginAttempts.set(ip, arr)
  // Periodic GC
  if (loginAttempts.size > 10_000) {
    for (const [k, v] of loginAttempts) {
      if (v.every(t => now - t > windowMs)) loginAttempts.delete(k)
    }
  }
  return true
}

// ─── Google OAuth client (lazy) ─────────────────────────────────────────────
let _googleClient: OAuth2Client | null = null
function getGoogleClient(): OAuth2Client | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) return null
  if (!_googleClient) _googleClient = new OAuth2Client(clientId)
  return _googleClient
}

// ─── Shared session helper ──────────────────────────────────────────────────
// Issues access + refresh tokens and sends the standard login response.
// Used by both /login (password) and /google (OAuth) endpoints.
type UserRow = {
  id: string; email: string; name: string; job_title: string | null;
  avatar_url: string | null; seat_type: string; permission_profile: string;
  capacity_hrs: any; workspace_id: string; department_id: string | null;
}

async function issueSessionAndRespond(user: UserRow, reply: FastifyReply) {
  const [{ data: workspace }, { data: department }] = await Promise.all([
    supabase.from('workspaces').select('id, name').eq('id', user.workspace_id).single(),
    user.department_id
      ? supabase.from('departments').select('id, name').eq('id', user.department_id).single()
      : Promise.resolve({ data: null }),
  ])

  const accessToken = await signAccessToken({
    sub:     user.id,
    wid:     user.workspace_id,
    profile: user.permission_profile,
    seat:    user.seat_type,
  })

  const refreshToken = await signRefreshToken(user.id)

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)
  await supabase.from('refresh_tokens').insert({
    user_id:    user.id,
    token:      refreshToken,
    expires_at: expiresAt.toISOString(),
  })

  reply.setCookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   60 * 60 * 24 * 30,
    path:     '/auth/refresh',
  })

  return reply.status(200).send({
    data: {
      accessToken,
      user: {
        id:                user.id,
        email:             user.email,
        name:              user.name,
        jobTitle:          user.job_title,
        seatType:          user.seat_type,
        permissionProfile: user.permission_profile,
        capacityHrs:       Number(user.capacity_hrs),
        workspaceId:       user.workspace_id,
        workspaceName:     workspace?.name ?? 'Digital Nexa',
        departmentId:      user.department_id,
        departmentName:    (department as any)?.name ?? null,
        avatarUrl:         user.avatar_url,
      },
    },
  })
}

export async function authRoutes(app: FastifyInstance) {

  // POST /auth/login
  app.post('/login', async (req, reply) => {
    if (!checkLoginRate(req.ip)) {
      return reply.status(429).send({
        errors: [{ code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again in a minute.' }],
      })
    }

    const body = loginSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })

    const { email, password } = body.data

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, email, name, job_title, avatar_url, seat_type, permission_profile, capacity_hrs, workspace_id, department_id, active, password_hash')
      .eq('email', email)
      .eq('active', true)
      .single()

    if (userErr || !user) {
      return reply.status(401).send({ errors: [{ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }] })
    }

    if (!user.password_hash) {
      return reply.status(401).send({ errors: [{ code: 'NO_PASSWORD' }] })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return reply.status(401).send({ errors: [{ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }] })
    }

    return issueSessionAndRespond(user, reply)
  })

  // POST /auth/google — Sign in with Google (accepts access token from implicit flow)
  app.post('/google', async (req, reply) => {
    if (!checkLoginRate(req.ip)) {
      return reply.status(429).send({
        errors: [{ code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again in a minute.' }],
      })
    }

    const bodySchema = z.object({ accessToken: z.string().min(1) })
    const body = bodySchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })

    // Verify the Google access token by calling Google's userinfo endpoint
    let googleEmail: string
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${body.data.accessToken}` },
      })
      if (!res.ok) {
        return reply.status(401).send({ errors: [{ code: 'INVALID_GOOGLE_TOKEN', message: 'Invalid or expired Google token.' }] })
      }
      const info = await res.json() as { email?: string; email_verified?: boolean }
      if (!info.email || !info.email_verified) {
        return reply.status(401).send({ errors: [{ code: 'EMAIL_NOT_VERIFIED', message: 'Google account email is not verified.' }] })
      }
      googleEmail = info.email.toLowerCase()
    } catch {
      return reply.status(401).send({ errors: [{ code: 'GOOGLE_ERROR', message: 'Could not verify Google token.' }] })
    }

    // Look up the user — must already exist (invite-first policy)
    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, job_title, avatar_url, seat_type, permission_profile, capacity_hrs, workspace_id, department_id, active')
      .eq('email', googleEmail)
      .eq('active', true)
      .single()

    if (!user) {
      return reply.status(401).send({
        errors: [{ code: 'USER_NOT_FOUND', message: 'No account found for this email. Ask your admin for an invite.' }],
      })
    }

    return issueSessionAndRespond(user, reply)
  })

  // Treat the template placeholder ("REPLACE_WITH_*") as not configured —
  // otherwise the OAuth URL would be built with a literal placeholder
  // client_id and Slack shows "Something went wrong authorizing this app."
  // with no useful detail. Both the /auth/slack route and the /slack/status
  // endpoint read through this helper so the UI stays in sync.
  const isSlackConfigured = (): boolean => {
    const id = process.env.SLACK_CLIENT_ID
    const secret = process.env.SLACK_CLIENT_SECRET
    if (!id || !secret) return false
    if (id.startsWith('REPLACE_WITH_') || secret.startsWith('REPLACE_WITH_')) return false
    return true
  }

  // GET /auth/slack — returns the Slack OAuth authorize URL
  app.get('/slack', async (req, reply) => {
    if (!isSlackConfigured()) {
      return reply.status(503).send({ errors: [{
        code: 'NOT_CONFIGURED',
        message: 'Slack integration is not configured on this workspace. Ask an admin to set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET in server env.',
      }] })
    }
    const clientId = process.env.SLACK_CLIENT_ID!
    const redirectUri = encodeURIComponent(process.env.SLACK_REDIRECT_URI || 'http://localhost:3000/api/v1/auth/slack/callback')
    const scopes = encodeURIComponent('chat:write,channels:read,groups:read')
    const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}`
    return reply.status(200).send({ url })
  })

  // GET /auth/slack/configured — lightweight probe for the frontend to disable
  // the Connect button when env is missing (avoids an auth-service round-trip
  // fail on every page load). No auth required so it can render even pre-login.
  app.get('/slack/configured', async (_req, reply) => {
    return reply.status(200).send({ configured: isSlackConfigured() })
  })

  // GET /auth/slack/callback — exchanges code for bot token, stores in workspace
  app.get('/slack/callback', async (req, reply) => {
    const { code } = req.query as any
    if (!code) return reply.redirect('/settings/integrations?slack=error&reason=no_code')

    const clientId = process.env.SLACK_CLIENT_ID
    const clientSecret = process.env.SLACK_CLIENT_SECRET
    if (!clientId || !clientSecret) return reply.redirect('/settings/integrations?slack=error&reason=not_configured')

    try {
      // Exchange code for token
      const res = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: process.env.SLACK_REDIRECT_URI || 'http://localhost:3000/api/v1/auth/slack/callback',
        }),
      })
      const data = await res.json() as any
      if (!data.ok) return reply.redirect(`/settings/integrations?slack=error&reason=${data.error || 'unknown'}`)

      const botToken = data.access_token
      const teamId = data.team?.id
      const teamName = data.team?.name

      // Find the workspace to store the token — use the first workspace (single-tenant)
      const { data: workspaces } = await supabase.from('workspaces').select('id').limit(1)
      const workspaceId = workspaces?.[0]?.id
      if (!workspaceId) return reply.redirect('/settings/integrations?slack=error&reason=no_workspace')

      // Read existing sync_state so we don't clobber other keys
      const { data: wsRow } = await supabase.from('workspaces').select('sync_state').eq('id', workspaceId).single()
      const currentState = ((wsRow as any)?.sync_state) || {}

      const newSyncState = {
        ...currentState,
        slack: {
          botToken,
          teamId,
          teamName,
          channelId: null,
          channelName: null,
          connectedAt: new Date().toISOString(),
        },
      }

      await supabase.from('workspaces').update({ sync_state: newSyncState }).eq('id', workspaceId)
      return reply.redirect('/settings/integrations?slack=connected')
    } catch {
      return reply.redirect('/settings/integrations?slack=error&reason=exchange_failed')
    }
  })

  // POST /auth/refresh — rotates refresh token on every use.
  // The old token is atomically deleted and a new one issued. If an attacker
  // and the legitimate user both hold the same refresh token, only the first
  // request wins; the second sees INVALID_REFRESH_TOKEN.
  app.post('/refresh', async (req, reply) => {
    const refreshToken = req.cookies?.refresh_token
    if (!refreshToken) {
      return reply.status(401).send({ errors: [{ code: 'NO_REFRESH_TOKEN' }] })
    }
    try {
      await verifyRefreshToken(refreshToken)

      // Atomic delete-and-fetch: row is gone after this returns, so a parallel
      // request with the same token gets `null`.
      const { data: stored } = await supabase
        .from('refresh_tokens')
        .delete()
        .eq('token', refreshToken)
        .select('expires_at, user_id')
        .single()

      if (!stored) {
        return reply.status(401).send({ errors: [{ code: 'INVALID_REFRESH_TOKEN' }] })
      }
      if (new Date(stored.expires_at) < new Date()) {
        return reply.status(401).send({ errors: [{ code: 'TOKEN_EXPIRED' }] })
      }

      const { data: user } = await supabase
        .from('users')
        .select('id, workspace_id, permission_profile, seat_type, active')
        .eq('id', stored.user_id)
        .single()

      if (!user?.active) return reply.status(401).send({ errors: [{ code: 'USER_INACTIVE' }] })

      // Issue new pair
      const accessToken = await signAccessToken({
        sub: user.id, wid: user.workspace_id,
        profile: user.permission_profile, seat: user.seat_type,
      })
      const newRefreshToken = await signRefreshToken(user.id)
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30)
      await supabase.from('refresh_tokens').insert({
        user_id:    user.id,
        token:      newRefreshToken,
        expires_at: expiresAt.toISOString(),
      })

      reply.setCookie('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   60 * 60 * 24 * 30,
        path:     '/auth/refresh',
      })

      return reply.status(200).send({ data: { accessToken } })
    } catch {
      return reply.status(401).send({ errors: [{ code: 'INVALID_REFRESH_TOKEN' }] })
    }
  })

  // POST /auth/logout
  app.post('/logout', async (req, reply) => {
    const rt = req.cookies?.refresh_token
    if (rt) await supabase.from('refresh_tokens').delete().eq('token', rt)
    reply.clearCookie('refresh_token', { path: '/auth/refresh' })
    return reply.status(200).send({ data: { message: 'Logged out' } })
  })

  // POST /auth/change-password
  // Identity comes from the verified Bearer token, NOT the x-user-id header.
  // After password change, all refresh tokens for this user are revoked so
  // anyone holding a stolen token loses access.
  app.post('/change-password', async (req, reply) => {
    const auth = await requireAuth(req, reply); if (!auth) return
    const userId = auth.sub

    const changePwSchema = z.object({
      currentPassword: z.string().min(1),
      newPassword:     z.string().min(8, 'Minimum 8 characters').max(128),
    })
    const parsed = changePwSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ errors: parsed.error.issues })
    const { currentPassword, newPassword } = parsed.data

    if (currentPassword === newPassword) {
      return reply.status(400).send({ errors: [{ code: 'SAME_PASSWORD', message: 'New password must differ from current password' }] })
    }

    const { data: user } = await supabase.from('users').select('id, password_hash').eq('id', userId).single()
    if (!user) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })

    const valid = await bcrypt.compare(currentPassword, user.password_hash || '')
    if (!valid) return reply.status(401).send({ errors: [{ code: 'WRONG_PASSWORD', message: 'Current password is incorrect' }] })

    const hash = await bcrypt.hash(newPassword, 10)
    await supabase.from('users').update({ password_hash: hash }).eq('id', userId)

    // Revoke all sessions for this user — forces re-login everywhere.
    await supabase.from('refresh_tokens').delete().eq('user_id', userId)

    return reply.status(200).send({ data: { message: 'Password updated' } })
  })

  // POST /auth/invite
  // Caller identity AND target workspace come from the verified token —
  // never trust x-workspace-id from headers (CSRF / cross-workspace inject).
  app.post('/invite', async (req, reply) => {
    const auth = await requireAuth(req, reply); if (!auth) return

    const callerProfile = auth.profile
    if (!['super_admin', 'admin'].includes(callerProfile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }

    const schema = z.object({
      email: z.string().email(), name: z.string().min(1), jobTitle: z.string().optional(),
      seatType: z.enum(['core','collaborator']).default('collaborator'),
      permissionProfile: z.enum(['super_admin','admin','account_manager','collaborator']).default('collaborator'),
      departmentId: z.string().uuid().optional(),
      capacityHrs: z.number().min(0).max(168).default(40),
      internalHourlyCost: z.number().min(0).default(0),
      customRoleId: z.string().uuid().optional().nullable(),
    })
    const b = schema.safeParse(req.body)
    if (!b.success) return reply.status(400).send({ errors: b.error.issues })

    if (b.data.permissionProfile === 'super_admin' && callerProfile !== 'super_admin') {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }

    // Workspace is bound to the caller's session — admin in WS A cannot
    // inject users into WS B by tampering with headers.
    const workspaceId = auth.wid

    // Cryptographically random temp password (12 url-safe chars).
    const tempPassword = crypto.randomBytes(9).toString('base64url')
    const passwordHash = await bcrypt.hash(tempPassword, 10)

    const { data: newUser, error } = await supabase.from('users').insert({
      workspace_id: workspaceId,
      email: b.data.email, name: b.data.name, job_title: b.data.jobTitle,
      seat_type: b.data.seatType, permission_profile: b.data.permissionProfile,
      department_id: b.data.departmentId || null,
      capacity_hrs: b.data.capacityHrs,
      internal_hourly_cost: b.data.internalHourlyCost,
      custom_role_id: b.data.customRoleId || null,
      password_hash: passwordHash,
    }).select().single()

    if (error) {
      if (error.code === '23505') return reply.status(409).send({ errors: [{ code: 'EMAIL_IN_USE' }] })
      return reply.status(500).send({ errors: [{ message: error.message }] })
    }
    return reply.status(201).send({ data: { id: newUser.id, email: newUser.email, name: newUser.name, tempPassword } })
  })
}
