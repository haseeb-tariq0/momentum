import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import { supabase } from '@forecast/db'

// Outbound mail goes through a dedicated Google Workspace mailbox
// (momentum@digitalnexa.com) using the Gmail HTTP API + OAuth2 —
// NOT SMTP (which Google's been deprecating for OAuth and which
// requires the much broader https://mail.google.com/ scope), NOT
// app passwords (which Workspace tenants increasingly disable), and
// NOT a third-party relay like SendGrid (which would need DNS
// delegation we don't want to do). The Gmail API only needs the
// narrow gmail.send scope — least privilege.
//
// Reuses the existing OAuth client from the nexttrack-493307 GCP
// project that's already powering "Sign in with Google", so no new
// credentials beyond a one-time refresh token captured via
// scripts/get-gmail-refresh-token.ts.
//
// Env contract:
//   GMAIL_USER                  → momentum@digitalnexa.com
//   GOOGLE_OAUTH_CLIENT_ID      → already set (sign-in flow)
//   GOOGLE_OAUTH_CLIENT_SECRET  → already set (sign-in flow)
//   GMAIL_OAUTH_REFRESH_TOKEN   → from the helper script
//   GMAIL_FROM_NAME             → "Momentum" (optional)
const GMAIL_USER     = process.env.GMAIL_USER                 || ''
const CLIENT_ID      = process.env.GOOGLE_OAUTH_CLIENT_ID     || ''
const CLIENT_SECRET  = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''
const REFRESH_TOKEN  = process.env.GMAIL_OAUTH_REFRESH_TOKEN  || ''
const FROM_EMAIL     = GMAIL_USER || 'momentum@digitalnexa.com'
const FROM_NAME      = process.env.GMAIL_FROM_NAME || 'Momentum'
const MAIL_ENABLED   = !!(GMAIL_USER && CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN)

// OAuth2Client refreshes the access token automatically when the
// cached one expires, using the long-lived refresh token. The Gmail
// API client wraps that for the HTTP requests.
const gmailClient = MAIL_ENABLED
  ? (() => {
      const oauth2 = new OAuth2Client(CLIENT_ID, CLIENT_SECRET)
      oauth2.setCredentials({ refresh_token: REFRESH_TOKEN })
      return google.gmail({ version: 'v1', auth: oauth2 })
    })()
  : null

// Loud startup banner so it's obvious from the logs whether the
// service will actually deliver mail or just stub. Without this you
// can stare at 200-OK responses all day while every send is a no-op.
console.log(`[notification-service] Mail: ${MAIL_ENABLED ? `ENABLED (Gmail API as ${FROM_EMAIL})` : 'DISABLED — stub mode (run scripts/get-gmail-refresh-token.ts and set GMAIL_USER + GMAIL_OAUTH_REFRESH_TOKEN)'}`)

export type SendEmailResult =
  | { ok: true }
  | { ok: false; stub: true;  reason: string }
  | { ok: false; stub: false; reason: string; code?: string }

// Returns a result object instead of throwing OR silently succeeding.
// The previous SendGrid version swallowed every error into
// console.error and returned void, so callers (and the UI) thought
// every send worked. The test-reminder route inspects this result and
// surfaces the real failure to the Integrations toast.
async function sendEmail(to: string, subject: string, html: string): Promise<SendEmailResult> {
  if (!gmailClient) {
    console.log(`[EMAIL STUB] To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g,'').slice(0,200)}`)
    return { ok: false, stub: true, reason: 'Gmail OAuth2 not configured — set GMAIL_USER + GMAIL_OAUTH_REFRESH_TOKEN (run scripts/get-gmail-refresh-token.ts)' }
  }
  try {
    // Build an RFC 2822 message. Subject is wrapped in a UTF-8
    // encoded-word so non-ASCII characters (em-dashes, smart
    // quotes, etc.) survive in mail clients that don't auto-detect
    // the charset. The Gmail API expects the whole message
    // base64url-encoded as `raw`.
    const message = [
      `From: "${FROM_NAME}" <${FROM_EMAIL}>`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      html,
    ].join('\r\n')
    const raw = Buffer.from(message).toString('base64url')
    await gmailClient.users.messages.send({ userId: 'me', requestBody: { raw } })
    return { ok: true }
  } catch (err: any) {
    // googleapis surfaces failures as GaxiosError with .code (HTTP
    // status) and .errors[]/.response.data. Forward the human-
    // readable reason to the toast so misconfig is obvious.
    const code   = err?.code ? String(err.code) : undefined
    const detail =
      err?.response?.data?.error?.message ||
      err?.errors?.[0]?.message ||
      err?.message ||
      'unknown Gmail API error'
    console.error('[Gmail API] send failed:', { code, detail, to, from: FROM_EMAIL })
    return { ok: false, stub: false, reason: detail, code }
  }
}

// ── Slack helper ──────────────────────────────────────────────────────────────

async function getSlackConfig(workspaceId: string): Promise<{ botToken: string; channelId: string } | null> {
  const { data: ws } = await supabase.from('workspaces').select('sync_state').eq('id', workspaceId).single()
  const slack = ((ws as any)?.sync_state)?.slack
  if (!slack?.botToken || !slack?.channelId) return null
  return { botToken: slack.botToken, channelId: slack.channelId }
}

// Looser variant of getSlackConfig — returns the bot token even if no channel
// has been picked yet. Per-user DM flows don't need a channel; they only need
// the bot token + im:write scope. Channel-based flows should keep using
// getSlackConfig so the absence of a channel disables them.
async function getSlackToken(workspaceId: string): Promise<string | null> {
  const { data: ws } = await supabase.from('workspaces').select('sync_state').eq('id', workspaceId).single()
  const slack = ((ws as any)?.sync_state)?.slack
  return slack?.botToken || null
}

async function sendSlack(token: string, channel: string, text: string, blocks?: any[]) {
  try {
    const body: any = { channel, text }
    if (blocks) body.blocks = blocks
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as any
    if (!data.ok) console.error('[Slack] Failed:', data.error)
  } catch (err: any) {
    console.error('[Slack] Error:', err.message)
  }
}

// Cache email → Slack user-id lookups for the lifetime of the request loop.
// users.lookupByEmail is rate-limited at Tier 3 (~50/min). For 200-person
// workspaces this is fine, but a daily deadline-reminders sweep that DMs every
// assignee will hit the same user repeatedly across multiple alerts (3-day
// notice + 1-day notice + overdue). The cache flattens those to one API call.
const slackUserIdCache = new Map<string, string | null>()

async function lookupSlackUserIdByEmail(token: string, email: string): Promise<string | null> {
  const key = `${token.slice(-6)}|${email.toLowerCase()}`
  if (slackUserIdCache.has(key)) return slackUserIdCache.get(key)!

  try {
    const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json() as any
    if (!data.ok) {
      // users_not_found is expected (Momentum user not in Slack workspace).
      // Log everything else so missing scopes / token revocation is visible.
      if (data.error !== 'users_not_found') {
        console.error(`[Slack] lookupByEmail(${email}) failed: ${data.error}`)
      }
      slackUserIdCache.set(key, null)
      return null
    }
    slackUserIdCache.set(key, data.user.id)
    return data.user.id
  } catch (err: any) {
    console.error(`[Slack] lookupByEmail(${email}) error:`, err.message)
    return null
  }
}

// DM a Slack user identified by their email. Returns true if delivered.
// Slack's chat.postMessage with channel=<user_id> auto-opens the IM channel
// on first send (im:write scope), so no separate conversations.open call is
// needed.
async function sendSlackDM(token: string, email: string, text: string, blocks?: any[]): Promise<boolean> {
  const userId = await lookupSlackUserIdByEmail(token, email)
  if (!userId) return false

  try {
    const body: any = { channel: userId, text }
    if (blocks) body.blocks = blocks
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as any
    if (!data.ok) {
      console.error(`[Slack DM] postMessage(${email}) failed: ${data.error}`)
      return false
    }
    return true
  } catch (err: any) {
    console.error(`[Slack DM] postMessage(${email}) error:`, err.message)
    return false
  }
}

// ── Email templates ────────────────────────────────────────────────────────────

// Budget alert template — same design language as timesheetReminderHtml.
// Severity drives the eyebrow + the cost number colour:
//   ≥100% → red       (over budget; code red)
//   ≥80%  → amber     (warning; matches the trigger threshold)
//   <80%  → teal      (shouldn't fire, but degrades gracefully)
// Progress bar is a 2-cell table — width-based, no CSS gradients, so it
// renders the same in every client.
function budgetAlertHtml(projectName: string, clientName: string, pct: number, budget: number, cost: number): string {
  const severityColor = pct >= 100 ? '#E11D48' : pct >= 80 ? '#F59E0B' : '#0BB39F'
  const severityLabel = pct >= 100 ? 'Over budget' : 'Budget alert'
  const appUrl        = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const cta           = `${appUrl}/projects`
  const filledPct     = Math.min(pct, 100)
  const remainingPct  = Math.max(100 - pct, 0)
  const preheader     = `${projectName} is at ${pct}% of budget (AED ${cost.toLocaleString()} of ${budget.toLocaleString()}).`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(severityLabel)}</title>
<style>
  @media only screen and (max-width: 580px) {
    .container { width: 100% !important; }
    .px-card   { padding-left: 24px !important; padding-right: 24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#1A1F2B;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#F5F6F8;opacity:0;">
    ${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F6F8;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" class="container" style="width:560px;max-width:560px;">

        <tr><td style="padding:0 0 24px;">
          <div style="font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#1A1F2B;">Momentum</div>
        </td></tr>

        <tr><td style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

            <tr><td class="px-card" style="padding:40px 40px 0;">
              <div style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${severityColor};margin:0 0 16px;">
                ${escapeHtml(severityLabel)} &middot; ${pct}%
              </div>
              <div style="font-size:22px;line-height:1.35;font-weight:600;color:#1A1F2B;letter-spacing:-0.01em;margin:0 0 14px;">
                ${escapeHtml(projectName)} has consumed ${pct}% of its budget.
              </div>
              <div style="font-size:15px;line-height:1.6;color:#4B5563;margin:0 0 28px;">
                Client: <strong style="color:#1A1F2B;font-weight:600;">${escapeHtml(clientName)}</strong>. ${pct >= 100
                  ? `The project has exceeded the planned spend &mdash; review whether to extend the budget or pause work.`
                  : `Worth reviewing this week before it crosses the line.`}
              </div>
            </td></tr>

            <!-- Stat row: Budget | Cost -->
            <tr><td class="px-card" style="padding:0 40px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAFBFC;border:1px solid #E5E7EB;border-radius:8px;">
                <tr>
                  <td style="padding:18px 22px;" valign="top">
                    <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#6B7280;margin:0 0 6px;">Budget</div>
                    <div style="font-size:18px;font-weight:600;color:#1A1F2B;line-height:1.2;letter-spacing:-0.01em;">
                      AED ${budget.toLocaleString()}
                    </div>
                  </td>
                  <td style="padding:18px 22px;border-left:1px solid #E5E7EB;" valign="top" align="right">
                    <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#6B7280;margin:0 0 6px;">Cost to date</div>
                    <div style="font-size:18px;font-weight:600;color:${severityColor};line-height:1.2;letter-spacing:-0.01em;">
                      AED ${cost.toLocaleString()}
                    </div>
                  </td>
                </tr>
              </table>
            </td></tr>

            <!-- Progress bar — pure table, no CSS gradients -->
            <tr><td class="px-card" style="padding:0 40px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                <tr>
                  ${filledPct > 0 ? `<td height="8" style="background:${severityColor};border-radius:${remainingPct === 0 ? '4px' : '4px 0 0 4px'};font-size:0;line-height:0;width:${filledPct}%;">&nbsp;</td>` : ''}
                  ${remainingPct > 0 ? `<td height="8" style="background:#E5E7EB;border-radius:${filledPct === 0 ? '4px' : '0 4px 4px 0'};font-size:0;line-height:0;width:${remainingPct}%;">&nbsp;</td>` : ''}
                </tr>
              </table>
              <div style="font-size:12px;color:#6B7280;margin-top:8px;text-align:right;">
                <strong style="color:${severityColor};font-weight:600;">${pct}%</strong> consumed
              </div>
            </td></tr>

            <!-- CTA -->
            <tr><td class="px-card" style="padding:0 40px 36px;" align="left">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${cta}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="18%" stroke="f" fillcolor="#0BB39F">
                <w:anchorlock/>
                <center style="color:#FFFFFF;font-family:sans-serif;font-size:14px;font-weight:600;">Review project</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${cta}" style="display:inline-block;padding:12px 26px;background:#0BB39F;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.01em;border-radius:8px;">
                Review project
              </a>
              <!--<![endif]-->
            </td></tr>

            <tr><td class="px-card" style="padding:0 40px;">
              <div style="height:1px;background:#E5E7EB;font-size:0;line-height:0;">&nbsp;</div>
            </td></tr>
            <tr><td class="px-card" style="padding:20px 40px 32px;">
              <div style="font-size:13px;line-height:1.55;color:#6B7280;">
                You&rsquo;re receiving this because you&rsquo;re an admin on this workspace. Adjust who gets budget alerts in <strong style="color:#1A1F2B;font-weight:600;">Settings &rarr; Notifications</strong>.
              </div>
            </td></tr>

          </table>
        </td></tr>

        <tr><td style="padding:24px 0 0;text-align:center;">
          <div style="font-size:12px;color:#9CA3AF;line-height:1.6;">
            Momentum &middot; Digital Nexa<br>
            Sent when a project crosses 80% or 100% of its budget.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// Weekly digest template — same design language as the other emails.
// Layout principle: 4 stat cards arranged as 2 rows of 2 in nested
// tables (CSS grid is stripped by Gmail). Each metric is dark text on
// a light card; only the value gets a tinted colour when it's
// off-target — that way the email reads as restrained reporting
// rather than a christmas tree of red/amber/green.
function weeklyDigestHtml(
  managerName: string,
  weekLabel: string,
  stats: { totalHrs: number; billableHrs: number; billPct: number; teamUtil: number; submittedCount: number; totalUsers: number; budgetAlerts: { name: string; pct: number }[] }
): string {
  const firstName  = (managerName || '').split(' ')[0] || 'there'
  const appUrl     = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const cta        = `${appUrl}/reports`
  const compliancePct = Math.round((stats.submittedCount / Math.max(stats.totalUsers, 1)) * 100)
  const utilColor     = stats.teamUtil >= 80  ? '#0BB39F' : stats.teamUtil >= 60 ? '#F59E0B' : '#E11D48'
  const compColor     = compliancePct >= 80   ? '#1A1F2B' : '#E11D48'
  const alertColor    = stats.budgetAlerts.length ? '#F59E0B' : '#1A1F2B'
  const preheader     = `${stats.totalHrs.toFixed(0)}h logged, ${stats.teamUtil}% utilization, ${stats.submittedCount}/${stats.totalUsers} timesheets in.`

  // Stat card — used 4× to keep the markup readable. value defaults to
  // dark text; pass an off-target colour to highlight a number.
  const statCard = (label: string, value: string, hint: string, color = '#1A1F2B') => `
    <td width="50%" valign="top" style="padding:8px;">
      <div style="background:#FAFBFC;border:1px solid #E5E7EB;border-radius:8px;padding:18px 20px;">
        <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#6B7280;margin:0 0 8px;">${label}</div>
        <div style="font-size:22px;font-weight:600;color:${color};line-height:1.1;letter-spacing:-0.01em;">${value}</div>
        <div style="font-size:12px;color:#6B7280;margin-top:6px;">${hint}</div>
      </div>
    </td>`

  const alertRow = (a: { name: string; pct: number }, i: number) => `
    <tr>
      <td style="padding:12px 0;${i > 0 ? 'border-top:1px solid #E5E7EB;' : ''}font-size:13px;color:#1A1F2B;">${escapeHtml(a.name)}</td>
      <td align="right" style="padding:12px 0;${i > 0 ? 'border-top:1px solid #E5E7EB;' : ''}font-size:13px;font-weight:600;color:${a.pct >= 100 ? '#E11D48' : '#F59E0B'};">${a.pct}%</td>
    </tr>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Weekly digest</title>
<style>
  @media only screen and (max-width: 580px) {
    .container { width: 100% !important; }
    .px-card   { padding-left: 24px !important; padding-right: 24px !important; }
    .stat-cell { display:block !important; width:100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#1A1F2B;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#F5F6F8;opacity:0;">
    ${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F6F8;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" class="container" style="width:560px;max-width:560px;">

        <tr><td style="padding:0 0 24px;">
          <div style="font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#1A1F2B;">Momentum</div>
        </td></tr>

        <tr><td style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

            <tr><td class="px-card" style="padding:40px 40px 0;">
              <div style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#0BB39F;margin:0 0 16px;">
                Weekly digest &middot; ${escapeHtml(weekLabel)}
              </div>
              <div style="font-size:22px;line-height:1.35;font-weight:600;color:#1A1F2B;letter-spacing:-0.01em;margin:0 0 14px;">
                Good morning, ${escapeHtml(firstName)}.
              </div>
              <div style="font-size:15px;line-height:1.6;color:#4B5563;margin:0 0 28px;">
                Here&rsquo;s how last week shaped up across the team.
              </div>
            </td></tr>

            <!-- 2x2 stat grid -->
            <tr><td class="px-card" style="padding:0 32px 12px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  ${statCard('Total hours', `${stats.totalHrs.toFixed(1)}h`, `${stats.billableHrs.toFixed(1)}h billable &middot; ${stats.billPct}%`)}
                  ${statCard('Team utilization', `${stats.teamUtil}%`, 'target 80%', utilColor)}
                </tr>
                <tr>
                  ${statCard('Timesheets in', `${stats.submittedCount}/${stats.totalUsers}`, `${compliancePct}% compliance`, compColor)}
                  ${statCard('Budget alerts', String(stats.budgetAlerts.length), 'projects over 80%', alertColor)}
                </tr>
              </table>
            </td></tr>

            ${stats.budgetAlerts.length ? `
            <tr><td class="px-card" style="padding:16px 40px 0;">
              <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:18px 20px;">
                <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#B45309;margin:0 0 12px;">
                  Projects over budget
                </div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  ${stats.budgetAlerts.map((a, i) => alertRow(a, i)).join('')}
                </table>
              </div>
            </td></tr>` : ''}

            <tr><td class="px-card" style="padding:32px 40px 36px;" align="left">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${cta}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="18%" stroke="f" fillcolor="#0BB39F">
                <w:anchorlock/>
                <center style="color:#FFFFFF;font-family:sans-serif;font-size:14px;font-weight:600;">View full reports</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${cta}" style="display:inline-block;padding:12px 26px;background:#0BB39F;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.01em;border-radius:8px;">
                View full reports
              </a>
              <!--<![endif]-->
            </td></tr>

            <tr><td class="px-card" style="padding:0 40px;">
              <div style="height:1px;background:#E5E7EB;font-size:0;line-height:0;">&nbsp;</div>
            </td></tr>
            <tr><td class="px-card" style="padding:20px 40px 32px;">
              <div style="font-size:13px;line-height:1.55;color:#6B7280;">
                Numbers cover the full week (Mon&ndash;Sun). Drill into any metric in <strong style="color:#1A1F2B;font-weight:600;">Reports</strong> for the breakdown by person, project, or department.
              </div>
            </td></tr>

          </table>
        </td></tr>

        <tr><td style="padding:24px 0 0;text-align:center;">
          <div style="font-size:12px;color:#9CA3AF;line-height:1.6;">
            Momentum &middot; Digital Nexa<br>
            Sent every Monday morning to workspace admins.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// Timesheet reminder template. Lessons learned the hard way:
//   - Gmail Web strips remote images that aren't on a publicly reachable
//     URL (so any localhost-served logo renders as a broken icon). Use
//     pure-text branding, no <img> tag.
//   - Gmail also strips most CSS gradients, drop-shadows, and any
//     property it doesn't recognise — the email looks "off" everywhere
//     except Apple Mail. Stick to flat colours and solid borders.
//   - Mixing serif (Georgia) and sans-serif felt design-y in a preview
//     but reads inconsistent in real inboxes. Single sans-serif stack
//     throughout.
//   - 560px container is more comfortable on mobile than 600px and
//     still fits Outlook's 580px sane width.
//
// One accent colour (teal #0BB39F) used sparingly: link, CTA, the
// missing-week label. Everything else is greyscale on white. The
// design degrades cleanly to a wall of text if all CSS is stripped
// (the table layout still flows).
function timesheetReminderHtml(opts: {
  name:         string
  weekLabel:    string  // e.g. "21 Apr – 27 Apr 2026"
  hoursLogged:  number  // hours logged for the missing week (often 0)
  capacityHrs?: number  // optional weekly capacity for the stat card
  appUrl:       string
}): string {
  const { name, weekLabel, hoursLogged, capacityHrs, appUrl } = opts
  const firstName = (name || '').split(' ')[0] || 'there'
  const cta       = `${appUrl}/timesheets`
  const isEmpty   = hoursLogged < 0.01
  const statValue = isEmpty ? '0h' : `${hoursLogged.toFixed(1)}h`
  const statHint  = capacityHrs
    ? `of ${capacityHrs}h weekly capacity`
    : (isEmpty ? 'no time logged' : 'logged, not submitted')
  const preheader = isEmpty
    ? `Your timesheet for ${weekLabel} is empty. It takes about a minute to log.`
    : `${statValue} logged for ${weekLabel} — please submit it.`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Timesheet reminder</title>
<style>
  @media only screen and (max-width: 580px) {
    .container { width: 100% !important; }
    .px-card   { padding-left: 24px !important; padding-right: 24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#1A1F2B;">
  <!-- Preheader: visible in inbox list, hidden in body -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#F5F6F8;opacity:0;">
    ${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F5F6F8;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" class="container" style="width:560px;max-width:560px;">

        <!-- Brand wordmark -->
        <tr><td style="padding:0 0 24px;">
          <div style="font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#1A1F2B;">
            Momentum
          </div>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

            <!-- Headline -->
            <tr><td class="px-card" style="padding:40px 40px 0;">
              <div style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#0BB39F;margin:0 0 16px;">
                Timesheet reminder
              </div>
              <div style="font-size:22px;line-height:1.35;font-weight:600;color:#1A1F2B;letter-spacing:-0.01em;margin:0 0 14px;">
                Hi ${escapeHtml(firstName)}, your timesheet for ${escapeHtml(weekLabel)} ${isEmpty ? 'is empty.' : 'isn&rsquo;t submitted yet.'}
              </div>
              <div style="font-size:15px;line-height:1.6;color:#4B5563;margin:0 0 28px;">
                ${isEmpty
                  ? `We didn&rsquo;t see any time logged last week. It only takes a minute &mdash; open the timesheet and add your hours by project.`
                  : `You&rsquo;ve logged <strong style="color:#1A1F2B;font-weight:600;">${statValue}</strong> but haven&rsquo;t hit submit. Once you do, finance can close the week.`}
              </div>
            </td></tr>

            <!-- Stat row -->
            <tr><td class="px-card" style="padding:0 40px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAFBFC;border:1px solid #E5E7EB;border-radius:8px;">
                <tr>
                  <td style="padding:18px 22px;" valign="top">
                    <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#6B7280;margin:0 0 6px;">Hours logged</div>
                    <div style="font-size:24px;font-weight:600;color:${isEmpty ? '#1A1F2B' : '#0BB39F'};line-height:1;letter-spacing:-0.01em;">
                      ${statValue}
                    </div>
                    <div style="font-size:12px;color:#6B7280;margin-top:6px;">${escapeHtml(statHint)}</div>
                  </td>
                  <td style="padding:18px 22px;border-left:1px solid #E5E7EB;" valign="top" align="right">
                    <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#6B7280;margin:0 0 6px;">Week</div>
                    <div style="font-size:14px;font-weight:600;color:#1A1F2B;line-height:1.3;">${escapeHtml(weekLabel)}</div>
                    <div style="font-size:12px;color:#6B7280;margin-top:6px;">Mon&ndash;Sun</div>
                  </td>
                </tr>
              </table>
            </td></tr>

            <!-- CTA — Outlook-safe VML + HTML fallback -->
            <tr><td class="px-card" style="padding:0 40px 36px;" align="left">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${cta}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="18%" stroke="f" fillcolor="#0BB39F">
                <w:anchorlock/>
                <center style="color:#FFFFFF;font-family:sans-serif;font-size:14px;font-weight:600;">Log my time</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a href="${cta}" style="display:inline-block;padding:12px 26px;background:#0BB39F;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.01em;border-radius:8px;">
                Log my time
              </a>
              <!--<![endif]-->
            </td></tr>

            <!-- Hairline + helper text -->
            <tr><td class="px-card" style="padding:0 40px;">
              <div style="height:1px;background:#E5E7EB;font-size:0;line-height:0;">&nbsp;</div>
            </td></tr>
            <tr><td class="px-card" style="padding:20px 40px 32px;">
              <div style="font-size:13px;line-height:1.55;color:#6B7280;">
                Already filed last week? Open Momentum and hit <strong style="color:#1A1F2B;font-weight:600;">Submit</strong> on the week summary &mdash; that closes it for finance.
              </div>
            </td></tr>

          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0 0;text-align:center;">
          <div style="font-size:12px;color:#9CA3AF;line-height:1.6;">
            Momentum &middot; Digital Nexa<br>
            Sent every Monday if your prior-week timesheet is missing.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// Tiny escape so user-supplied strings (name, etc.) can't break the HTML.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

async function getLastWeekRange() {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun,1=Mon...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const thisMonday = new Date(now); thisMonday.setDate(now.getDate() + diffToMonday); thisMonday.setHours(0,0,0,0)
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7)
  const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1)
  return {
    start: lastMonday.toISOString().slice(0,10),
    end:   lastSunday.toISOString().slice(0,10),
    label: `${lastMonday.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${lastSunday.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`,
  }
}

async function getCurrentWeekStart() {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const thisMonday = new Date(now); thisMonday.setDate(now.getDate() + diffToMonday); thisMonday.setHours(0,0,0,0)
  return thisMonday.toISOString().slice(0,10)
}

// ── Budget alert check (called on demand or scheduled) ────────────────────────

async function checkBudgetAlerts(workspaceId: string) {
  // Get all running projects with rate cards
  const { data: projects } = await supabase.from('projects')
    .select('id, name, budget_amount, rate_card_id, clients(name), workspaces(id)')
    .eq('status', 'running').eq('workspace_id', workspaceId)
    .gt('budget_amount', 0)
    .range(0, 9999)

  if (!projects?.length) return []

  const alerts: { project: any; pct: number; cost: number }[] = []

  for (const p of projects) {
    // Get all billable time entries for this project
    const { data: phases } = await supabase.from('phases').select('id').eq('project_id', p.id)
    if (!phases?.length) continue
    const phaseIds = phases.map((ph: any) => ph.id)
    const { data: tasks } = await supabase.from('tasks').select('id').in('phase_id', phaseIds)
    if (!tasks?.length) continue
    const taskIds = tasks.map((t: any) => t.id)

    const { data: entries } = await supabase.from('time_entries').select('hours, user_id, task_id').in('task_id', taskIds).eq('billable', true)
    if (!entries?.length) continue

    // Get rate card. Apr 17: rate resolves per-department; fall back to
    // legacy job_title entries for cards that haven't been migrated yet.
    if (!p.rate_card_id) continue
    const { data: rc } = await supabase.from('rate_cards').select('*, rate_card_entries(job_title, department_id, hourly_rate)').eq('id', p.rate_card_id).single()
    if (!rc) continue

    const rateByDept:  Record<string, number> = {}
    const rateByTitle: Record<string, number> = {}
    for (const e of rc.rate_card_entries || []) {
      if (e.department_id)  rateByDept [e.department_id] = Number(e.hourly_rate)
      else if (e.job_title) rateByTitle[e.job_title]     = Number(e.hourly_rate)
    }

    let cost = 0
    const { data: assignees } = await supabase.from('task_assignees').select('user_id, task_id, users(job_title, department_id)').in('task_id', taskIds)
    const deptMap:  Record<string, string> = {}
    const titleMap: Record<string, string> = {}
    for (const a of assignees || []) {
      const key = `${a.task_id}:${a.user_id}`
      deptMap[key]  = (a as any).users?.department_id || ''
      titleMap[key] = (a as any).users?.job_title     || ''
    }

    for (const e of entries) {
      // Bug fix: was using user_id:user_id instead of task_id:user_id
      const key      = `${e.task_id}:${e.user_id}`
      const deptId   = deptMap[key]  || ''
      const jobTitle = titleMap[key] || ''
      const rate = rateByDept[deptId] || rateByTitle[jobTitle] || rc.default_hourly_rate || 0
      cost += Number(e.hours) * rate
    }

    const pct = Math.round((cost / Number(p.budget_amount)) * 100)
    if (pct >= 80) alerts.push({ project: p, pct, cost: Math.round(cost) })
  }

  return alerts
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 1_000_000 })
  await app.register(cors)

  app.get('/health', async () => ({ status: 'ok', service: 'notification-service' }))

  // ── POST /notify/budget-alert — trigger budget alert for a project ─────────
  app.post('/notify/budget-alert', async (req, reply) => {
    const { projectId, projectName, clientName, pct, budget, cost, adminEmails, workspaceId } = req.body as any
    const html = budgetAlertHtml(projectName, clientName, pct, budget, cost)
    const subject = `${pct >= 100 ? '🚨' : '⚠️'} Budget Alert: ${projectName} at ${pct}%`
    for (const email of (adminEmails || [])) {
      await sendEmail(email, subject, html)
    }
    // Slack
    if (workspaceId) {
      const slack = await getSlackConfig(workspaceId)
      if (slack) {
        const emoji = pct >= 100 ? ':rotating_light:' : ':warning:'
        await sendSlack(slack.botToken, slack.channelId,
          `${emoji} Budget Alert: ${projectName} at ${pct}%`,
          [{ type: 'section', text: { type: 'mrkdwn', text: `${emoji} *Budget Alert — ${pct}%*\n*${projectName}*\nClient: ${clientName}\nBudget: AED ${budget.toLocaleString()} | Cost: AED ${cost.toLocaleString()}` } }]
        )
      }
    }
    return reply.status(200).send({ sent: true })
  })

  // ── POST /notify/weekly-digest — send Monday morning digest ───────────────
  app.post('/notify/weekly-digest', async (req, reply) => {
    const { workspaceId } = req.body as any
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })

    const { start, end, label } = await getLastWeekRange()

    // Get workspace admins to email
    const { data: admins } = await supabase.from('users')
      .select('id, name, email').eq('workspace_id', workspaceId)
      .in('permission_profile', ['super_admin', 'admin']).eq('active', true)

    if (!admins?.length) return reply.status(200).send({ sent: 0 })

    // Get all users
    const { data: allUsers } = await supabase.from('users').select('id, capacity_hrs')
      .eq('workspace_id', workspaceId).eq('active', true).is('deleted_at', null)

    // Get last week's time entries
    const userIds = (allUsers || []).map((u: any) => u.id)
    const { data: entries } = await supabase.from('time_entries').select('user_id, hours, billable')
      .in('user_id', userIds.length ? userIds : ['none']).gte('date', start).lte('date', end)

    const totalHrs    = (entries || []).reduce((s: number, e: any) => s + Number(e.hours), 0)
    const billableHrs = (entries || []).filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours), 0)
    const billPct     = totalHrs > 0 ? Math.round(billableHrs / totalHrs * 100) : 0
    const totalCap    = (allUsers || []).reduce((s: number, u: any) => s + Number(u.capacity_hrs || 40), 0)
    const teamUtil    = totalCap > 0 ? Math.round(totalHrs / totalCap * 100) : 0

    // Get submissions
    const { data: subs } = await supabase.from('timesheet_submissions').select('user_id')
      .in('user_id', userIds.length ? userIds : ['none']).eq('week_start', start)
    const submittedCount = (subs || []).length

    // Get budget alerts
    const alerts = await checkBudgetAlerts(workspaceId)
    const budgetAlerts = alerts.map(a => ({ name: a.project.name, pct: a.pct }))

    // Send to each admin
    let sent = 0
    for (const admin of admins) {
      if (!admin.email) continue
      const html = weeklyDigestHtml(admin.name, label, { totalHrs, billableHrs, billPct, teamUtil, submittedCount, totalUsers: allUsers?.length || 0, budgetAlerts })
      await sendEmail(admin.email, `📊 Weekly Digest — ${label}`, html)
      sent++
    }

    // Slack
    const slack = await getSlackConfig(workspaceId)
    if (slack) {
      const alertLine = budgetAlerts.length ? `\n:warning: ${budgetAlerts.length} budget alert(s)` : ''
      await sendSlack(slack.botToken, slack.channelId,
        `📊 Weekly Digest — ${label}`,
        [{ type: 'section', text: { type: 'mrkdwn', text: `:bar_chart: *Weekly Digest — ${label}*\nUtilization: *${teamUtil}%* | Billable: *${billPct}%*\nHours: *${totalHrs.toFixed(1)}h* | Timesheets: *${submittedCount}/${allUsers?.length || 0}* submitted${alertLine}` } }]
      )
    }

    return reply.status(200).send({ sent, weekLabel: label })
  })

  // ── POST /notify/timesheet-reminders — Monday morning reminders ──────────
  // Spec: every Monday at 09:00, look at the prior week (Mon–Sun that just
  // ended). For each active non-admin user who didn't submit a timesheet
  // for that week, send a reminder email + post a single Slack summary.
  // Earlier this endpoint targeted the *current* week, which fired the
  // morning the week began — that's a Monday-morning ping for a week the
  // user hasn't even started yet. Switched to last-week per product.
  app.post('/notify/timesheet-reminders', async (req, reply) => {
    const { workspaceId } = req.body as any
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })

    const last = await getLastWeekRange()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Get all active non-admin users
    const { data: users } = await supabase.from('users').select('id, name, email, capacity_hrs')
      .eq('workspace_id', workspaceId).eq('active', true).is('deleted_at', null)
      .not('permission_profile', 'eq', 'super_admin')

    if (!users?.length) return reply.status(200).send({ sent: 0, weekLabel: last.label })

    // Submissions for last week — anyone who already submitted is skipped
    const { data: subs } = await supabase.from('timesheet_submissions').select('user_id')
      .in('user_id', users.map((u: any) => u.id)).eq('week_start', last.start)
    const submittedIds = new Set((subs || []).map((s: any) => s.user_id))

    // Hours logged for last week (used to personalise the email copy)
    const { data: entries } = await supabase.from('time_entries').select('user_id, hours')
      .in('user_id', users.map((u: any) => u.id)).gte('date', last.start).lte('date', last.end)
    const hoursByUser: Record<string, number> = {}
    for (const e of entries || []) hoursByUser[e.user_id] = (hoursByUser[e.user_id] || 0) + Number(e.hours)

    let sent = 0
    const missingNames: string[] = []
    for (const u of users) {
      if (submittedIds.has(u.id)) continue
      missingNames.push(u.name)
      if (!u.email) continue
      const hoursLogged = hoursByUser[u.id] || 0
      const html = timesheetReminderHtml({
        name:         u.name,
        weekLabel:    last.label,
        hoursLogged,
        capacityHrs:  Number((u as any).capacity_hrs) || undefined,
        appUrl,
      })
      await sendEmail(u.email, `Your timesheet for ${last.label} is missing`, html)
      sent++
    }

    if (missingNames.length > 0) {
      const slack = await getSlackConfig(workspaceId)
      if (slack) {
        const list = missingNames.map(n => `• ${n}`).join('\n')
        await sendSlack(slack.botToken, slack.channelId,
          `⏰ Timesheet Reminder — ${missingNames.length} pending`,
          [{ type: 'section', text: { type: 'mrkdwn', text: `:alarm_clock: *Timesheet Reminder*\n${missingNames.length} people haven't submitted for ${last.label}:\n${list}` } }]
        )
      }
    }

    return reply.status(200).send({ sent, weekLabel: last.label, missing: missingNames.length })
  })

  // ── POST /notify/test-timesheet-reminder — send the reminder to ONE user ──
  // Used by the Settings → Integrations "Send test reminder to me" button so
  // admins can preview the email without waiting for Monday + without
  // spamming the whole team. Body: { email, name?, hoursLogged?, capacityHrs? }.
  // If `email` matches an active user, we pull their real name + capacity
  // from the DB; otherwise we fall back to the body fields. Last week's
  // label is computed the same way as the scheduled job.
  app.post('/notify/test-timesheet-reminder', async (req, reply) => {
    const body = (req.body || {}) as {
      email?:        string
      name?:         string
      hoursLogged?:  number
      capacityHrs?:  number
    }
    const email = (body.email || '').trim()
    if (!email) return reply.status(400).send({ error: 'email required' })

    const { data: user } = await supabase.from('users')
      .select('id, name, capacity_hrs')
      .eq('email', email).maybeSingle()

    const last = await getLastWeekRange()
    const html = timesheetReminderHtml({
      name:         user?.name || body.name || email.split('@')[0],
      weekLabel:    last.label,
      hoursLogged:  Number.isFinite(body.hoursLogged) ? Number(body.hoursLogged) : 0,
      capacityHrs:  Number((user as any)?.capacity_hrs) || body.capacityHrs,
      appUrl:       process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    })
    const result = await sendEmail(email, `[TEST] Your timesheet for ${last.label} is missing`, html)
    if (!result.ok) {
      // 502 = upstream (SendGrid) refused; 503 = stub mode (server
      // misconfig). Either way we surface the real reason so the
      // Integrations toast says something actionable like "verified
      // sender required" or "API key invalid" instead of "success".
      const code = result.stub ? 503 : 502
      return reply.status(code).send({
        ok:        false,
        sentTo:    email,
        weekLabel: last.label,
        error:     result.reason,
        stub:      result.stub === true,
      })
    }
    return reply.status(200).send({ ok: true, sentTo: email, weekLabel: last.label })
  })

  // ── POST /notify/test-weekly-digest — preview digest with mock data ───────
  // Same purpose as the timesheet test endpoint: lets an admin preview the
  // styled email without standing up a full workspace's worth of data. All
  // numeric stats are caller-supplied and default to a "looks normal" set.
  // Body: { email, name?, totalHrs?, billableHrs?, teamUtil?, submitted?,
  //         totalUsers?, alerts? }
  app.post('/notify/test-weekly-digest', async (req, reply) => {
    const body = (req.body || {}) as {
      email?:        string
      name?:         string
      totalHrs?:     number
      billableHrs?:  number
      teamUtil?:     number
      submitted?:    number
      totalUsers?:   number
      alerts?:       { name: string; pct: number }[]
    }
    const email = (body.email || '').trim()
    if (!email) return reply.status(400).send({ error: 'email required' })

    const { data: user } = await supabase.from('users')
      .select('name').eq('email', email).maybeSingle()

    const { label }     = await getLastWeekRange()
    const totalHrs      = Number.isFinite(body.totalHrs)    ? Number(body.totalHrs)    : 312.5
    const billableHrs   = Number.isFinite(body.billableHrs) ? Number(body.billableHrs) : 248.0
    const billPct       = totalHrs > 0 ? Math.round(billableHrs / totalHrs * 100) : 0
    const teamUtil      = Number.isFinite(body.teamUtil)    ? Number(body.teamUtil)    : 78
    const submittedCnt  = Number.isFinite(body.submitted)   ? Number(body.submitted)   : 9
    const totalUsers    = Number.isFinite(body.totalUsers)  ? Number(body.totalUsers)  : 12
    const budgetAlerts  = Array.isArray(body.alerts) ? body.alerts : [
      { name: 'Acme Website Redesign', pct: 92 },
      { name: 'Beta App Phase 2',      pct: 108 },
    ]

    const html = weeklyDigestHtml(
      user?.name || body.name || email.split('@')[0],
      label,
      { totalHrs, billableHrs, billPct, teamUtil, submittedCount: submittedCnt, totalUsers, budgetAlerts },
    )
    const result = await sendEmail(email, `[TEST] Weekly Digest — ${label}`, html)
    if (!result.ok) {
      const code = result.stub ? 503 : 502
      return reply.status(code).send({
        ok:        false,
        sentTo:    email,
        weekLabel: label,
        error:     result.reason,
        stub:      result.stub === true,
      })
    }
    return reply.status(200).send({ ok: true, sentTo: email, weekLabel: label })
  })

  // ── POST /notify/deadline-reminders — DM each assignee about their tasks ──
  // Three buckets: due in 3 days (heads-up), due tomorrow (last call), overdue
  // (still open). Each user gets ONE consolidated DM listing every relevant
  // task they own — not three separate pings. Status='done' tasks are skipped.
  // Re-running the same day is idempotent for the 3d/1d buckets (date-equals
  // filter); overdue keeps firing daily until the assignee marks it done,
  // which is the desired nudge cadence.
  app.post('/notify/deadline-reminders', async (req, reply) => {
    const { workspaceId } = req.body as any
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })

    const botToken = await getSlackToken(workspaceId)
    if (!botToken) return reply.status(200).send({ skipped: 'slack not connected' })

    // Date math in Asia/Dubai-implicit local time. tasks.due_date is a DATE
    // column (no time component), so string compare on YYYY-MM-DD is exact.
    const today = new Date(); today.setHours(0,0,0,0)
    const in1 = new Date(today); in1.setDate(today.getDate() + 1)
    const in3 = new Date(today); in3.setDate(today.getDate() + 3)
    const todayStr = today.toISOString().slice(0,10)
    const in1Str   = in1.toISOString().slice(0,10)
    const in3Str   = in3.toISOString().slice(0,10)

    // 1. Workspace's active projects
    const { data: projects } = await supabase.from('projects')
      .select('id, name')
      .eq('workspace_id', workspaceId).is('deleted_at', null)
      .neq('status', 'archived')
    if (!projects?.length) return reply.status(200).send({ usersDm: 0, tasksFound: 0 })
    const projectIds = projects.map((p: any) => p.id)
    const projectNameById: Record<string, string> = Object.fromEntries(projects.map((p: any) => [p.id, p.name]))

    // 2. Phases belonging to those projects
    const { data: phases } = await supabase.from('phases')
      .select('id, project_id').in('project_id', projectIds)
    if (!phases?.length) return reply.status(200).send({ usersDm: 0, tasksFound: 0 })
    const phaseIds = phases.map((ph: any) => ph.id)
    const projectIdByPhaseId: Record<string, string> = Object.fromEntries(phases.map((ph: any) => [ph.id, ph.project_id]))

    // 3. Tasks with a due date within range and not done. We pull anything
    //    due_date <= today+3 and not done — the bucket filter happens in JS
    //    so we get overdue (any age), due-tomorrow, and due-in-3 in one query.
    const { data: tasks } = await supabase.from('tasks')
      .select('id, title, due_date, status, phase_id')
      .in('phase_id', phaseIds)
      .neq('status', 'done')
      .not('due_date', 'is', null)
      .lte('due_date', in3Str)
    if (!tasks?.length) return reply.status(200).send({ usersDm: 0, tasksFound: 0 })

    // Bucket each task — only keep tasks that fall in one of the 3 buckets.
    type Bucket = 'overdue' | 'tomorrow' | 'in3'
    const tasksWithBucket: { id: string; title: string; due_date: string; phase_id: string; bucket: Bucket }[] = []
    for (const t of tasks) {
      const due = (t as any).due_date as string  // YYYY-MM-DD
      let bucket: Bucket | null = null
      if (due < todayStr) bucket = 'overdue'
      else if (due === in1Str) bucket = 'tomorrow'
      else if (due === in3Str) bucket = 'in3'
      if (bucket) tasksWithBucket.push({ ...(t as any), bucket })
    }
    if (!tasksWithBucket.length) return reply.status(200).send({ usersDm: 0, tasksFound: 0 })

    const taskIds = tasksWithBucket.map(t => t.id)

    // 4. Assignees of those tasks, joined to user email
    const { data: rows } = await supabase.from('task_assignees')
      .select('task_id, user_id, users(id, name, email, active)')
      .in('task_id', taskIds)
    if (!rows?.length) return reply.status(200).send({ usersDm: 0, tasksFound: tasksWithBucket.length })

    // 5. Group tasks per user
    type UserBundle = { name: string; email: string; overdue: any[]; tomorrow: any[]; in3: any[] }
    const byUser: Record<string, UserBundle> = {}
    const taskById = new Map(tasksWithBucket.map(t => [t.id, t]))
    for (const r of rows) {
      const u: any = (r as any).users
      if (!u?.email || u.active === false) continue
      const t = taskById.get((r as any).task_id)
      if (!t) continue
      const projectName = projectNameById[projectIdByPhaseId[t.phase_id]] || '—'
      const item = { title: t.title, due: t.due_date, project: projectName }
      if (!byUser[u.id]) byUser[u.id] = { name: u.name, email: u.email, overdue: [], tomorrow: [], in3: [] }
      byUser[u.id][t.bucket].push(item)
    }

    // 6. Build + send a DM per user. Sequential, not parallel — Slack rate
    //    limits chat.postMessage at Tier 4 (~100/min) which is fine, but
    //    users.lookupByEmail is Tier 3 (~50/min). Sequential keeps us safe
    //    on both even for large workspaces.
    const userList = Object.values(byUser)
    let sent = 0
    const failures: string[] = []
    for (const u of userList) {
      const totalTasks = u.overdue.length + u.tomorrow.length + u.in3.length
      if (totalTasks === 0) continue

      const firstName = u.name.split(' ')[0]
      const summary = `${totalTasks} task${totalTasks === 1 ? '' : 's'} need${totalTasks === 1 ? 's' : ''} attention`
      const headerText = `:wave: Hi ${firstName}, ${summary}.`

      const sections: string[] = []
      if (u.overdue.length) {
        const lines = u.overdue.map((t: any) => `• *${t.title}* — _${t.project}_, was due ${t.due}`).join('\n')
        sections.push(`:rotating_light: *Overdue (${u.overdue.length})*\n${lines}`)
      }
      if (u.tomorrow.length) {
        const lines = u.tomorrow.map((t: any) => `• *${t.title}* — _${t.project}_`).join('\n')
        sections.push(`:alarm_clock: *Due tomorrow*\n${lines}`)
      }
      if (u.in3.length) {
        const lines = u.in3.map((t: any) => `• *${t.title}* — _${t.project}_, due ${t.due}`).join('\n')
        sections.push(`:calendar: *Due in 3 days*\n${lines}`)
      }
      const bodyText = `${headerText}\n\n${sections.join('\n\n')}`
      const blocks = [
        { type: 'section', text: { type: 'mrkdwn', text: headerText } },
        ...sections.map(s => ({ type: 'section', text: { type: 'mrkdwn', text: s } })),
        { type: 'context', elements: [{ type: 'mrkdwn',
          text: `<${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/tasks|Open Momentum →>` }] },
      ]

      const ok = await sendSlackDM(botToken, u.email, bodyText, blocks)
      if (ok) sent++
      else failures.push(u.email)
    }

    return reply.status(200).send({
      usersDm: sent,
      tasksFound: tasksWithBucket.length,
      eligibleUsers: userList.length,
      failures: failures.length ? failures : undefined,
    })
  })

  // ── POST /notify/budget-check — scan all projects, send alerts ────────────
  app.post('/notify/budget-check', async (req, reply) => {
    const { workspaceId } = req.body as any
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })

    const { data: admins } = await supabase.from('users').select('email')
      .eq('workspace_id', workspaceId).in('permission_profile', ['super_admin', 'admin']).eq('active', true)
    const adminEmails = (admins || []).map((a: any) => a.email).filter(Boolean)
    if (!adminEmails.length) return reply.status(200).send({ alerts: 0 })

    const alerts = await checkBudgetAlerts(workspaceId)
    let sent = 0

    const slack = await getSlackConfig(workspaceId)
    for (const alert of alerts) {
      if (alert.pct < 80) continue
      const html = budgetAlertHtml(alert.project.name, alert.project.clients?.name || '—', alert.pct, Number(alert.project.budget_amount), alert.cost)
      const subject = `${alert.pct >= 100 ? '🚨' : '⚠️'} Budget Alert: ${alert.project.name} at ${alert.pct}%`
      for (const email of adminEmails) await sendEmail(email, subject, html)
      // Slack
      if (slack) {
        const emoji = alert.pct >= 100 ? ':rotating_light:' : ':warning:'
        await sendSlack(slack.botToken, slack.channelId,
          `${emoji} Budget Alert: ${alert.project.name} at ${alert.pct}%`,
          [{ type: 'section', text: { type: 'mrkdwn', text: `${emoji} *Budget Alert — ${alert.pct}%*\n*${alert.project.name}*\nClient: ${alert.project.clients?.name || '—'}\nBudget: AED ${Number(alert.project.budget_amount).toLocaleString()} | Cost: AED ${alert.cost.toLocaleString()}` } }]
        )
      }
      sent++
    }

    return reply.status(200).send({ alerts: alerts.length, notificationsSent: sent })
  })

  try {
    // Bind to loopback only — gateway is the only public entry point.
    await app.listen({ port: Number(process.env.NOTIFICATION_SERVICE_PORT) || 3006, host: '127.0.0.1' })
    console.log('✅ Notification service on 127.0.0.1:' + (process.env.NOTIFICATION_SERVICE_PORT || 3006))
  } catch (err) {
    process.exit(1)
  }
}

process.on('unhandledRejection', (err) => { console.error('[notification-service] unhandledRejection:', err); process.exit(1) })
process.on('uncaughtException',  (err) => { console.error('[notification-service] uncaughtException:',  err); process.exit(1) })

main()
