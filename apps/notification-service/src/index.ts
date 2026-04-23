import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import Fastify from 'fastify'
import cors from '@fastify/cors'
import sgMail from '@sendgrid/mail'
import { supabase } from '@forecast/db'

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@digitalnexa.com'
const FROM_NAME  = 'Digital NEXA Platform'
const SG_ENABLED = !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY !== 'dev')

if (SG_ENABLED) sgMail.setApiKey(process.env.SENDGRID_API_KEY!)

async function sendEmail(to: string, subject: string, html: string) {
  if (!SG_ENABLED) {
    console.log(`[EMAIL STUB] To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g,'').slice(0,200)}`)
    return
  }
  try {
    await sgMail.send({ to, from: { email: FROM_EMAIL, name: FROM_NAME }, subject, html })
  } catch (err: any) {
    console.error('SendGrid error:', err?.response?.body || err.message)
  }
}

// ── Slack helper ──────────────────────────────────────────────────────────────

async function getSlackConfig(workspaceId: string): Promise<{ botToken: string; channelId: string } | null> {
  const { data: ws } = await supabase.from('workspaces').select('sync_state').eq('id', workspaceId).single()
  const slack = ((ws as any)?.sync_state)?.slack
  if (!slack?.botToken || !slack?.channelId) return null
  return { botToken: slack.botToken, channelId: slack.channelId }
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

// ── Email templates ────────────────────────────────────────────────────────────

function budgetAlertHtml(projectName: string, clientName: string, pct: number, budget: number, cost: number): string {
  const color = pct >= 100 ? '#f43f5e' : pct >= 90 ? '#f59e0b' : '#f59e0b'
  const emoji = pct >= 100 ? '🚨' : '⚠️'
  return `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#0e0e12;color:#f0f0f4;border-radius:12px;overflow:hidden">
    <div style="background:${color};padding:20px 28px">
      <div style="font-size:22px;font-weight:800">${emoji} Budget Alert — ${pct}%</div>
      <div style="opacity:.85;margin-top:4px;font-size:14px">Digital NEXA Project Tracker</div>
    </div>
    <div style="padding:28px">
      <p style="font-size:16px;font-weight:700;color:${color};margin:0 0 16px">${projectName}</p>
      <p style="color:#8888a0;margin:0 0 20px;font-size:14px">Client: ${clientName}</p>
      <div style="background:#1c1c22;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <span style="color:#8888a0;font-size:13px">Budget</span>
          <span style="font-weight:600;font-size:13px">AED ${budget.toLocaleString()}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:10px">
          <span style="color:#8888a0;font-size:13px">Cost to date</span>
          <span style="font-weight:600;font-size:13px;color:${color}">AED ${cost.toLocaleString()}</span>
        </div>
        <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:8px;overflow:hidden;margin-top:14px">
          <div style="height:100%;width:${Math.min(pct,100)}%;background:${color};border-radius:4px"></div>
        </div>
        <div style="text-align:right;font-size:12px;color:${color};font-weight:700;margin-top:6px">${pct}% consumed</div>
      </div>
      <p style="color:#8888a0;font-size:13px;margin:0">Review the project in the <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/projects" style="color:#00d4b4">NEXA Platform</a> to take action.</p>
    </div>
  </div>`
}

function weeklyDigestHtml(
  managerName: string,
  weekLabel: string,
  stats: { totalHrs: number; billableHrs: number; billPct: number; teamUtil: number; submittedCount: number; totalUsers: number; budgetAlerts: { name: string; pct: number }[] }
): string {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0e0e12;color:#f0f0f4;border-radius:12px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#131321,#1a1030);padding:24px 32px;border-bottom:1px solid rgba(255,255,255,0.07)">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#55556a;margin-bottom:6px">WEEKLY DIGEST</div>
      <div style="font-size:22px;font-weight:800">Good morning, ${managerName} 👋</div>
      <div style="color:#8888a0;margin-top:4px;font-size:14px">Week of ${weekLabel} — NEXA Operations Summary</div>
    </div>
    <div style="padding:28px 32px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px">
        <div style="background:#1c1c22;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#55556a;margin-bottom:6px">Total Hours</div>
          <div style="font-size:26px;font-weight:800;color:#00d4b4">${stats.totalHrs.toFixed(1)}h</div>
          <div style="font-size:11px;color:#8888a0;margin-top:3px">${stats.billableHrs.toFixed(1)}h billable (${stats.billPct}%)</div>
        </div>
        <div style="background:#1c1c22;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#55556a;margin-bottom:6px">Team Utilization</div>
          <div style="font-size:26px;font-weight:800;color:${stats.teamUtil>=80?'#00d4b4':stats.teamUtil>=60?'#f59e0b':'#f43f5e'}">${stats.teamUtil}%</div>
          <div style="font-size:11px;color:#8888a0;margin-top:3px">Target: 80%</div>
        </div>
        <div style="background:#1c1c22;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#55556a;margin-bottom:6px">Timesheet Compliance</div>
          <div style="font-size:26px;font-weight:800;color:${stats.submittedCount/Math.max(stats.totalUsers,1)>=0.8?'#00d4b4':'#f43f5e'}">${stats.submittedCount}/${stats.totalUsers}</div>
          <div style="font-size:11px;color:#8888a0;margin-top:3px">submitted last week</div>
        </div>
        <div style="background:#1c1c22;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#55556a;margin-bottom:6px">Budget Alerts</div>
          <div style="font-size:26px;font-weight:800;color:${stats.budgetAlerts.length?'#f59e0b':'#00d4b4'}">${stats.budgetAlerts.length}</div>
          <div style="font-size:11px;color:#8888a0;margin-top:3px">projects over 80%</div>
        </div>
      </div>
      ${stats.budgetAlerts.length ? `
      <div style="background:#1c1c22;border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:16px;margin-bottom:20px">
        <div style="font-size:12px;font-weight:700;color:#f59e0b;margin-bottom:10px">⚠ BUDGET ALERTS</div>
        ${stats.budgetAlerts.map(a => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px"><span style="color:#f0f0f4">${a.name}</span><span style="color:${a.pct>=100?'#f43f5e':'#f59e0b'};font-weight:700">${a.pct}%</span></div>`).join('')}
      </div>` : ''}
      <p style="text-align:center;margin:0"><a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/reports" style="background:#00d4b4;color:#0e0e12;text-decoration:none;padding:10px 24px;border-radius:6px;font-weight:700;font-size:14px;display:inline-block">View Full Reports →</a></p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid rgba(255,255,255,0.05);font-size:11px;color:#55556a;text-align:center">Digital NEXA Platform · Internal use only</div>
  </div>`
}

function timesheetReminderHtml(name: string, weekLabel: string, hoursLogged: number): string {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;background:#0e0e12;color:#f0f0f4;border-radius:12px;overflow:hidden">
    <div style="background:#1c1c22;padding:20px 28px;border-bottom:1px solid rgba(255,255,255,0.07)">
      <div style="font-size:20px;font-weight:800">⏰ Timesheet Reminder</div>
      <div style="color:#8888a0;margin-top:4px;font-size:13px">Week of ${weekLabel}</div>
    </div>
    <div style="padding:24px 28px">
      <p style="font-size:15px;margin:0 0 16px">Hi ${name.split(' ')[0]},</p>
      <p style="color:#8888a0;font-size:14px;margin:0 0 20px">
        ${hoursLogged > 0
          ? `You've logged <strong style="color:#00d4b4">${hoursLogged.toFixed(1)} hours</strong> this week — don't forget to submit before the weekend.`
          : `We don't see any hours logged for this week yet. Please log your time before the end of day.`}
      </p>
      <div style="text-align:center;margin-bottom:20px">
        <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/timesheets" style="background:#00d4b4;color:#0e0e12;text-decoration:none;padding:10px 24px;border-radius:6px;font-weight:700;font-size:14px;display:inline-block">Go to My Timesheets →</a>
      </div>
      <p style="color:#55556a;font-size:12px;margin:0;text-align:center">Reminder sent Monday · Digital NEXA Platform</p>
    </div>
  </div>`
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

  // ── POST /notify/timesheet-reminders — send Friday reminders ──────────────
  app.post('/notify/timesheet-reminders', async (req, reply) => {
    const { workspaceId } = req.body as any
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' })

    const weekStart = await getCurrentWeekStart()
    const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
    const weekEndStr = weekEnd.toISOString().slice(0,10)
    const weekLabel  = new Date(weekStart).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})

    // Get all active non-admin users
    const { data: users } = await supabase.from('users').select('id, name, email, capacity_hrs')
      .eq('workspace_id', workspaceId).eq('active', true).is('deleted_at', null)
      .not('permission_profile', 'eq', 'super_admin')

    if (!users?.length) return reply.status(200).send({ sent: 0 })

    // Get submissions this week (already submitted = skip)
    const { data: subs } = await supabase.from('timesheet_submissions').select('user_id')
      .in('user_id', users.map((u: any) => u.id)).eq('week_start', weekStart)
    const submittedIds = new Set((subs || []).map((s: any) => s.user_id))

    // Get hours logged this week
    const { data: entries } = await supabase.from('time_entries').select('user_id, hours')
      .in('user_id', users.map((u: any) => u.id)).gte('date', weekStart).lte('date', weekEndStr)
    const hoursByUser: Record<string, number> = {}
    for (const e of entries || []) hoursByUser[e.user_id] = (hoursByUser[e.user_id] || 0) + Number(e.hours)

    let sent = 0
    const missingNames: string[] = []
    for (const u of users) {
      if (submittedIds.has(u.id)) continue // already submitted
      missingNames.push(u.name)
      if (!u.email) continue
      const hoursLogged = hoursByUser[u.id] || 0
      const html = timesheetReminderHtml(u.name, weekLabel, hoursLogged)
      await sendEmail(u.email, `⏰ Don't forget to submit your timesheet — ${weekLabel}`, html)
      sent++
    }

    // Slack — post summary of missing timesheets
    if (missingNames.length > 0) {
      const slack = await getSlackConfig(workspaceId)
      if (slack) {
        const list = missingNames.map(n => `• ${n}`).join('\n')
        await sendSlack(slack.botToken, slack.channelId,
          `⏰ Timesheet Reminder — ${missingNames.length} pending`,
          [{ type: 'section', text: { type: 'mrkdwn', text: `:alarm_clock: *Timesheet Reminder*\n${missingNames.length} people haven't submitted for ${weekLabel}:\n${list}` } }]
        )
      }
    }

    return reply.status(200).send({ sent })
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
