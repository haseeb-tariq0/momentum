/**
 * One-time helper to capture a Gmail OAuth2 refresh token for the
 * notification-service. Run once, paste output into .env.local.
 *
 * Usage:
 *   pnpm tsx scripts/get-gmail-refresh-token.ts
 *
 * Reads GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET from
 * .env.local (the same OAuth client used for "Sign in with Google"
 * — no new credentials are required).
 *
 * Before running:
 *   1. In GCP Console → APIs & Services → Library → enable Gmail API
 *   2. APIs & Services → OAuth consent screen → add scope
 *      https://www.googleapis.com/auth/gmail.send
 *   3. APIs & Services → Credentials → your OAuth client → add
 *      http://localhost:9999/oauth-callback to "Authorized redirect
 *      URIs" (you can remove this redirect URI again once the token
 *      is captured — it's not needed at runtime)
 *
 * The script:
 *   - Spins up http://localhost:9999/oauth-callback locally
 *   - Prints a Google authorization URL
 *   - You open it, sign in as momentum@digitalnexa.com, click Allow
 *   - Google redirects back, the script exchanges the code for a
 *     refresh token and prints the env line to paste
 *
 * Refresh tokens stay valid as long as the app keeps using them
 * regularly — your weekly reminder cron alone keeps it alive.
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

// Resolve .env.local relative to THIS script (not CWD) so it works
// regardless of which workspace pnpm runs us from.
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '..', '.env.local') })

const CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID     || ''
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''
const REDIRECT_URI  = 'http://localhost:9999/oauth-callback'
const SCOPE         = 'https://www.googleapis.com/auth/gmail.send'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n[error] Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in .env.local')
  console.error('        These are the same values used by the existing "Sign in with Google" flow.\n')
  process.exit(1)
}

// access_type=offline + prompt=consent guarantees Google returns a
// refresh_token even if this Google account has previously authorized
// the same OAuth client. Without prompt=consent, Google silently
// reuses the prior grant and omits the refresh_token from the
// response, leaving you with only a 1-hour access token.
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPE,
    access_type:   'offline',
    prompt:        'consent',
  }).toString()

console.log('\n=== Gmail OAuth2 — refresh token capture ===\n')
console.log('Listening on http://localhost:9999/oauth-callback')
console.log('Make sure that URL is in your OAuth client\'s')
console.log('"Authorized redirect URIs" before continuing.\n')
console.log('Open this URL in a browser and sign in as the')
console.log('Momentum mailbox (momentum@digitalnexa.com):\n')
console.log(`  ${authUrl}\n`)
console.log('Waiting for the redirect...\n')

const server = createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith('/oauth-callback')) {
    res.writeHead(404).end('not found')
    return
  }

  const url   = new URL(req.url, 'http://localhost:9999')
  const code  = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end(`OAuth error: ${error}`)
    console.error(`\n[error] Google returned: ${error}\n`)
    server.close()
    process.exit(1)
  }
  if (!code) {
    res.writeHead(400).end('missing ?code param')
    return
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }).toString(),
    })
    const tokens: any = await tokenRes.json()

    if (!tokens.refresh_token) {
      res.writeHead(500, { 'Content-Type': 'text/html' }).end(`
        <html><body style="font-family:system-ui;padding:40px">
          <h2 style="color:#c00">No refresh token returned</h2>
          <p>Revoke the app at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> and rerun the script.</p>
        </body></html>
      `)
      console.error('\n[error] Google did not return a refresh_token.')
      console.error('        This usually means the Momentum mailbox previously authorized')
      console.error('        this OAuth client. Revoke at https://myaccount.google.com/permissions')
      console.error('        and rerun this script.\n')
      console.error('        Raw response:', tokens, '\n')
      server.close()
      process.exit(1)
    }

    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`
      <html><body style="font-family:system-ui;padding:40px;background:#0e1621;color:#e8edf3">
        <h2 style="color:#4ade80">✓ Refresh token captured</h2>
        <p>Check your terminal and paste the printed value into <code>.env.local</code>.</p>
        <p>You can close this tab.</p>
      </body></html>
    `)
    console.log('\n✓ Refresh token captured.\n')
    console.log('--- paste into .env.local ---\n')
    console.log(`GMAIL_USER=momentum@digitalnexa.com`)
    console.log(`GMAIL_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log(`GMAIL_FROM_NAME=Momentum\n`)
    console.log('Then remove http://localhost:9999/oauth-callback from')
    console.log('your OAuth client\'s redirect URIs in GCP Console.\n')
    server.close()
    process.exit(0)
  } catch (e: any) {
    res.writeHead(500).end('token exchange failed: ' + (e?.message || 'unknown'))
    console.error('\n[error] Token exchange failed:', e?.message || e, '\n')
    server.close()
    process.exit(1)
  }
})

server.listen(9999)
