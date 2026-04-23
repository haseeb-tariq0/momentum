import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { prisma } from '@forecast/db'
import { publish } from '@forecast/events'

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

export function startWorker() {
  const worker = new Worker('reports', async (job) => {
    const { reportId, workspaceId, userId, type, filters } = job.data

    console.log(`[report-worker] Processing report ${reportId} type=${type}`)

    try {
      // Mark as processing
      await prisma.report.update({ where: { id: reportId }, data: { status: 'pending' } })

      // Generate report data based on type
      let result: Record<string, unknown> = {}

      if (type === 'utilization') {
        const entries = await prisma.timeEntry.groupBy({
          by:    ['userId'],
          where: { user: { workspaceId } },
          _sum:  { hours: true },
        })
        result = { entries, generatedAt: new Date().toISOString() }
      }

      // In production: upload result to S3 as JSON/CSV/PDF
      // const s3Url = await uploadToS3(reportId, result)
      const s3Url = `https://s3.amazonaws.com/${process.env.S3_BUCKET}/reports/${reportId}.json`

      await prisma.report.update({
        where: { id: reportId },
        data:  { status: 'ready', s3Url, generatedAt: new Date() },
      })

      await publish('REPORT_READY', { reportId, userId })

      console.log(`[report-worker] Report ${reportId} complete`)
    } catch (err) {
      console.error(`[report-worker] Report ${reportId} failed:`, err)
      await prisma.report.update({ where: { id: reportId }, data: { status: 'failed' } })
      throw err
    }
  }, { connection, concurrency: 3 })

  worker.on('failed', (job, err) => {
    console.error(`[report-worker] Job ${job?.id} failed:`, err.message)
  })

  console.log('[report-worker] Worker started')
  return worker
}
