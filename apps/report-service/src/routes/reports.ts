import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@forecast/db'
import { reportQueue } from '../lib/queue.js'

const createReportSchema = z.object({
  type: z.enum(['utilization', 'burn_rate', 'logged_vs_estimated', 'forecast']),
  filters: z.object({
    startDate:  z.string().optional(),
    endDate:    z.string().optional(),
    projectIds: z.array(z.string().uuid()).optional(),
    userIds:    z.array(z.string().uuid()).optional(),
  }).default({}),
})

export async function reportRoutes(app: FastifyInstance) {
  // POST /reports — queue a report (manager+)
  app.post('/', async (req, reply) => {
    const { workspaceId, role, id: userId } = req.user

    if (role === 'member') {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN', message: 'Managers and admins only' }] })
    }

    const body = createReportSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })

    const report = await prisma.report.create({
      data: { workspaceId, type: body.data.type, filters: body.data.filters, status: 'pending' },
    })

    await reportQueue.add('generate', { reportId: report.id, workspaceId, userId, ...body.data })

    return reply.status(202).send({ data: { id: report.id, status: 'pending' } })
  })

  // GET /reports — list reports for workspace
  app.get('/', async (req, reply) => {
    const { workspaceId } = req.user

    const reports = await prisma.report.findMany({
      where:   { workspaceId },
      orderBy: { createdAt: 'desc' },
      take:    50,
    })

    return reply.send({ data: reports })
  })

  // GET /reports/:id — get report status + data URL
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { workspaceId } = req.user

    const report = await prisma.report.findFirst({ where: { id, workspaceId } })
    if (!report) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'Report not found' }] })

    return reply.send({ data: report })
  })

  // GET /reports/data/utilization — inline utilization data (no queue)
  app.get('/data/utilization', async (req, reply) => {
    const { workspaceId } = req.user
    const query = req.query as { startDate?: string; endDate?: string }

    const startDate = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const endDate   = query.endDate   ? new Date(query.endDate)   : new Date()

    // Group time entries by user for the period
    const entries = await prisma.timeEntry.groupBy({
      by:     ['userId'],
      where:  {
        date: { gte: startDate, lte: endDate },
        user: { workspaceId },
      },
      _sum:   { hours: true },
    })

    const users = await prisma.user.findMany({
      where:  { workspaceId, active: true },
      select: { id: true, name: true, capacityHrs: true, avatarUrl: true },
    })

    const days     = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const weeks    = days / 7

    const data = users.map((user) => {
      const logged   = entries.find((e) => e.userId === user.id)?._sum.hours ?? 0
      const capacity = Number(user.capacityHrs) * weeks
      const pct      = capacity > 0 ? Math.round((Number(logged) / capacity) * 100) : 0
      return { ...user, loggedHrs: Number(logged), capacityHrs: capacity, utilizationPct: pct }
    })

    return reply.send({ data, meta: { startDate: startDate.toISOString(), endDate: endDate.toISOString(), days } })
  })

  // GET /reports/data/burn-rate — project burn rate
  app.get('/data/burn-rate', async (req, reply) => {
    const { workspaceId } = req.user
    const query = req.query as { projectId?: string }

    const projects = await prisma.project.findMany({
      where:   { workspaceId, deletedAt: null, ...(query.projectId && { id: query.projectId }) },
      select:  { id: true, name: true, budgetHrs: true, color: true, status: true },
    })

    const data = await Promise.all(projects.map(async (project) => {
      const logged = await prisma.timeEntry.aggregate({
        where: { task: { projectId: project.id } },
        _sum:  { hours: true },
      })
      const loggedHrs   = Number(logged._sum.hours || 0)
      const budgetHrs   = Number(project.budgetHrs || 0)
      const burnPct     = budgetHrs > 0 ? Math.round((loggedHrs / budgetHrs) * 100) : null
      const remainingHrs= budgetHrs - loggedHrs

      return { ...project, loggedHrs, budgetHrs, burnPct, remainingHrs }
    }))

    return reply.send({ data })
  })
}
