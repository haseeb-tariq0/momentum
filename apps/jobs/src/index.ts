import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import { Worker, Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { supabase } from '@forecast/db'

function makeConnection() {
  const conn = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    // Never give up on Redis — a short outage (restart, network blip, maintenance
    // window) should self-heal. Exponential backoff capped at 30s.
    retryStrategy: (times) => Math.min(times * 500, 30_000),
    reconnectOnError: () => true,
  })
  conn.on('error', (err) => {
    console.error('[jobs] redis connection error:', err?.message || err)
  })
  return conn
}

const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || `http://localhost:${process.env.NOTIFICATION_SERVICE_PORT || 3006}`

console.log('🔧 Background jobs worker starting...')

const snapshotWorker = new Worker('snapshots', async (job) => {
  console.log(`Running snapshot job: ${job.id}`)
  const weekStart = getMonday(new Date())
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
  const weekStartStr = weekStart.toISOString().slice(0, 10)
  const weekEndStr   = weekEnd.toISOString().slice(0, 10)

  const { data: workspaces } = await supabase
    .from('workspaces').select('id').is('deleted_at', null)

  for (const ws of workspaces || []) {
    const { data: users } = await supabase
      .from('users').select('id, capacity_hrs')
      .eq('workspace_id', ws.id).eq('active', true).is('deleted_at', null)

    if (!users?.length) continue
    const userIds = users.map((u: any) => u.id)

    // 🛡️ Batch aggregate for all users at once instead of one query per user.
    // Sum is done in JS since PostgREST doesn't support groupBy + sum here.
    const { data: entries } = await supabase
      .from('time_entries').select('user_id, hours')
      .in('user_id', userIds)
      .gte('date', weekStartStr).lte('date', weekEndStr)

    const byUser: Record<string, number> = {}
    for (const e of entries || []) byUser[e.user_id] = (byUser[e.user_id] || 0) + Number(e.hours)

    for (const user of users) {
      const loggedHrs = byUser[user.id] || 0
      const capacity  = Number((user as any).capacity_hrs || 0)
      console.log(`  User ${user.id}: ${loggedHrs}h / ${capacity}h`)
    }
  }
}, { connection: makeConnection() })

snapshotWorker.on('error',  (err) => { console.error('[jobs] snapshotWorker error:', err?.message || err) })
snapshotWorker.on('failed',  (job, err) => { console.error(`[jobs] snapshot job ${job?.id} failed:`, err?.message || err) })

// ── Notification scheduler ────────────────────────────────────────────────
// Four recurring jobs (all stagger-started to keep the notification-service
// from getting four parallel sweeps at exactly :00):
//   1. budget-check       — daily 09:00 — scans projects for threshold breaches
//   2. deadline-reminders — daily 09:05 — DMs assignees about due / overdue tasks
//   3. timesheet-reminder — Monday 09:00 — nudges users with missing timesheets
//   4. weekly-digest      — Monday 09:05 — emails admins last-week stats
//
// Each job iterates active workspaces and POSTs to the notification service.
// The endpoint mapping below is the single source of truth — adding a new
// scheduled notification means adding it here AND to OUR_JOBS in
// scheduleRecurring().

type JobName =
  | 'budget-check'
  | 'timesheet-reminder'
  | 'weekly-digest'
  | 'deadline-reminders'

const ENDPOINT_BY_JOB: Record<JobName, string> = {
  'budget-check':       '/notify/budget-check',
  'timesheet-reminder': '/notify/timesheet-reminders',
  'weekly-digest':      '/notify/weekly-digest',
  'deadline-reminders': '/notify/deadline-reminders',
}

const notifyWorker = new Worker('notifications', async (job) => {
  const kind     = job.name as JobName
  const endpoint = ENDPOINT_BY_JOB[kind]
  if (!endpoint) throw new Error(`unknown notification job: ${kind}`)
  console.log(`📣 Running ${kind} for all workspaces`)
  const { data: workspaces } = await supabase
    .from('workspaces').select('id, name').is('deleted_at', null)
  const failures: string[] = []
  for (const ws of workspaces || []) {
    try {
      // AbortSignal.timeout ensures a hung notification-service can't freeze the
      // entire job loop. 30s per workspace is generous for HTTP + SendGrid.
      const res = await fetch(`${NOTIFICATION_URL}${endpoint}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ workspaceId: ws.id }),
        signal:  AbortSignal.timeout(30_000),
      })
      const json: any = await res.json().catch(() => ({}))
      if (!res.ok) {
        failures.push(`${ws.name}(${res.status})`)
        console.warn(`  ${ws.name}: ${kind} → HTTP ${res.status} ${JSON.stringify(json)}`)
      } else {
        console.log(`  ${ws.name}: ${kind} → ok ${JSON.stringify(json)}`)
      }
    } catch (e: any) {
      failures.push(`${ws.name}(${e?.name || 'err'})`)
      console.warn(`  ${ws.name}: ${kind} → error ${e?.message || 'unknown'}`)
    }
  }
  // Throw if ANY workspace failed so BullMQ retries + alerting picks it up.
  // Silent partial failures are the whole reason budget alerts go missing.
  if (failures.length) throw new Error(`${kind} failed for: ${failures.join(', ')}`)
}, { connection: makeConnection(), concurrency: 2 })

notifyWorker.on('error',  (err) => { console.error('[jobs] notifyWorker error:', err?.message || err) })
notifyWorker.on('failed',  (job, err) => { console.error(`[jobs] notify job ${job?.id} (${job?.name}) failed:`, err?.message || err) })

// Register repeating jobs (idempotent — re-running doesn't create duplicates)
async function scheduleRecurring() {
  const queue = new Queue('notifications', { connection: makeConnection() })
  // Cron timezone — pin to a stable TZ so DST doesn't shift the schedule by an
  // hour twice a year. Override via CRON_TZ env var if needed.
  const tz = process.env.CRON_TZ || 'Asia/Dubai'

  // Self-heal any stale repeatables BEFORE adding new ones. Background:
  // BullMQ's `jobId` option dedupes queue jobs but NOT repeatable schedules —
  // each distinct (pattern, tz) combination creates a separate schedule. So
  // if someone deploys without CRON_TZ set (tz=null) and later with it set
  // to Asia/Dubai, you silently get DOUBLE the emails / alerts. We found 10
  // completed jobs in Redis that were firing twice daily because of this.
  //
  // Remove anything whose (name + pattern) matches what we're about to add
  // but whose tz differs. This keeps the re-add below truly idempotent
  // regardless of prior state.
  const OUR_JOBS = [
    { name: 'budget-check',       pattern: '0 9 * * *' },
    { name: 'deadline-reminders', pattern: '5 9 * * *' },
    { name: 'timesheet-reminder', pattern: '0 9 * * 1' },
    { name: 'weekly-digest',      pattern: '5 9 * * 1' },
  ]
  // Names that USED to be scheduled but should no longer fire. Any repeatable
  // matching one of these is removed from Redis on startup. Once a deployment
  // has cycled through this and the Redis entry is gone, the name can be
  // dropped from this list.
  // Apr 30: deadline-reminders was deprecated Apr 29 then re-instated the next
  // day with daily 09:05 cadence. Keep this set empty until something else
  // actually gets retired — leaving stale names here is harmless but noisy.
  const DEPRECATED_JOBS = new Set<string>([])

  const existing = await queue.getRepeatableJobs()
  for (const r of existing) {
    // BullMQ used to expose the schedule as `r.cron`; current versions only
    // populate `r.pattern`. Cast to `any` keeps the legacy match working for
    // any stale Redis entries created by old code, without breaking the type
    // check on the new BullMQ types.
    if (DEPRECATED_JOBS.has(r.name)) {
      await queue.removeRepeatableByKey(r.key)
      console.log(`🧹 Removed deprecated repeatable: ${r.name} (no longer scheduled)`)
      continue
    }
    const ours = OUR_JOBS.find(j => j.name === r.name && ((r as any).cron === j.pattern || r.pattern === j.pattern))
    if (!ours) continue
    if (r.tz !== tz) {
      await queue.removeRepeatableByKey(r.key)
      console.log(`🧹 Removed stale ${r.name} repeatable (tz=${r.tz ?? 'null'}) — will re-add with tz=${tz}`)
    }
  }

  // Shared retry config: 3 attempts with exponential backoff — if the
  // notification service is briefly down, BullMQ retries instead of losing
  // the alert entirely.
  const retryOpts = {
    attempts: 3,
    backoff:  { type: 'exponential' as const, delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 500 },
  }
  // Daily budget check at 09:00 ${tz}
  await queue.add('budget-check', {}, {
    repeat: { pattern: '0 9 * * *', tz },
    jobId:  'recurring-budget-check',         // stable id prevents duplicates
    ...retryOpts,
  })
  // Daily deadline reminders at 09:05 ${tz} — staggered 5 min after
  // budget-check so the notification-service isn't hit by both at once.
  await queue.add('deadline-reminders', {}, {
    repeat: { pattern: '5 9 * * *', tz },
    jobId:  'recurring-deadline-reminders',
    ...retryOpts,
  })
  // Weekly timesheet reminder — every Monday at 09:00 ${tz}
  await queue.add('timesheet-reminder', {}, {
    repeat: { pattern: '0 9 * * 1', tz },
    jobId:  'recurring-timesheet-reminder',
    ...retryOpts,
  })
  // Weekly admin digest — Mondays at 09:05 ${tz}, after the reminders go out.
  // The 5-min offset means the digest's "Timesheets in" stat reflects the
  // settled prior-week reality, not whatever Monday-morning rush happens
  // between the reminder firing and admins opening the digest.
  await queue.add('weekly-digest', {}, {
    repeat: { pattern: '5 9 * * 1', tz },
    jobId:  'recurring-weekly-digest',
    ...retryOpts,
  })
  console.log(
    `📅 Scheduled (${tz}): budget-check 09:00 daily · deadline-reminders 09:05 daily · ` +
    `timesheet-reminder 09:00 Mon · weekly-digest 09:05 Mon`,
  )
}

scheduleRecurring().catch((e) => console.warn('Failed to schedule recurring jobs:', e?.message))

console.log('✅ All workers running')

function getMonday(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  d.setHours(0, 0, 0, 0)
  return d
}

// Drain workers on both SIGTERM (K8s/Docker stop) and SIGINT (Ctrl+C).
// Without SIGINT, in-flight jobs are killed mid-execution and Redis locks
// stay held until their default ~10min timeout, blocking the next run.
async function shutdown(signal: string) {
  console.log(`[jobs] ${signal} received — draining workers…`)
  try {
    await Promise.all([snapshotWorker.close(), notifyWorker.close()])
    console.log('[jobs] workers closed cleanly')
    process.exit(0)
  } catch (err) {
    console.error('[jobs] shutdown error:', err)
    process.exit(1)
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

process.on('unhandledRejection', (err) => { console.error('[jobs] unhandledRejection:', err); process.exit(1) })
process.on('uncaughtException',  (err) => { console.error('[jobs] uncaughtException:',  err); process.exit(1) })
