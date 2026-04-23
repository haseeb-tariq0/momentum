import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { prisma } from '@forecast/db'
import { publish } from '@forecast/events'

function makeConnection() {
  const conn = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    // Retry forever with exponential backoff capped at 30s — a temporary Redis
    // outage should self-heal, not kill the worker process.
    retryStrategy: (times) => Math.min(times * 500, 30_000),
    reconnectOnError: () => true,
  })
  conn.on('error', (err) => {
    console.error('[report-worker] redis connection error:', err?.message || err)
  })
  return conn
}

export function startWorker() {
  const worker = new Worker('reports', async (job) => {
    const { reportId, workspaceId, userId, type, filters } = job.data
    console.log(`Processing report ${reportId} of type ${type}`)

    try {
      let reportData: unknown

      switch (type) {
        case 'utilization':
          reportData = await generateUtilizationReport(workspaceId, filters)
          break
        case 'burn_rate':
          reportData = await generateBurnRateReport(workspaceId, filters)
          break
        case 'logged_vs_estimated':
          reportData = await generateLoggedVsEstimatedReport(workspaceId, filters)
          break
        case 'forecast':
          reportData = await generateForecastReport(workspaceId, filters)
          break
        default:
          throw new Error(`Unknown report type: ${type}`)
      }

      const s3Url = `https://s3.amazonaws.com/${process.env.S3_BUCKET || 'forecast-dev'}/reports/${reportId}.json`

      await prisma.report.update({
        where: { id: reportId },
        data:  { status: 'ready', s3Url, generatedAt: new Date() },
      })

      await publish('REPORT_READY', { reportId, userId })
      console.log(`✅ Report ${reportId} completed`)
    } catch (err) {
      console.error(`Report ${reportId} failed:`, err)
      await prisma.report.update({ where: { id: reportId }, data: { status: 'failed' } })
      throw err
    }
  }, { connection: makeConnection(), concurrency: 3 })

  worker.on('error',  (err) => { console.error('[report-worker] error:', err?.message || err) })
  worker.on('failed', (job, err) => { console.error(`[report-worker] job ${job?.id} failed:`, err?.message || err) })
  console.log('Report worker started')
  return worker
}

async function generateUtilizationReport(workspaceId: string, filters: any) {
  const users = await prisma.user.findMany({
    where: { workspaceId, active: true },
    include: {
      timeEntries: {
        where: {
          ...(filters?.startDate && { date: { gte: new Date(filters.startDate) } }),
          ...(filters?.endDate   && { date: { lte: new Date(filters.endDate) } }),
        },
      },
    },
  })
  return users.map(u => ({
    userId:      u.id,
    name:        u.name,
    capacityHrs: Number(u.capacityHrs),
    loggedHrs:   u.timeEntries.reduce((s, e) => s + Number(e.hours), 0),
  }))
}

async function generateBurnRateReport(workspaceId: string, filters: any) {
  return prisma.project.findMany({
    where: { workspaceId, deletedAt: null },
    include: { tasks: { include: { timeEntries: { select: { hours: true } } } } },
  })
}

async function generateLoggedVsEstimatedReport(workspaceId: string, _filters: any) {
  return prisma.task.findMany({
    where: { project: { workspaceId, deletedAt: null } },
    include: {
      project:     { select: { name: true, color: true } },
      timeEntries: { select: { hours: true } },
    },
  })
}

async function generateForecastReport(workspaceId: string, _filters: any) {
  const projects = await prisma.project.findMany({
    where: { workspaceId, status: 'active', deletedAt: null },
    include: {
      tasks:   { include: { timeEntries: { select: { hours: true } } } },
      members: { select: { allocHrsPerWk: true } },
    },
  })
  return projects.map(p => {
    const budgetHrs      = Number(p.budgetHrs || 0)
    const loggedHrs      = p.tasks.flatMap(t => t.timeEntries).reduce((s, e) => s + Number(e.hours), 0)
    const remaining      = Math.max(0, budgetHrs - loggedHrs)
    const weeklyCapacity = p.members.reduce((s, m) => s + Number(m.allocHrsPerWk), 0)
    return { projectId: p.id, name: p.name, budgetHrs, loggedHrs, remaining, weeklyCapacity }
  })
}
