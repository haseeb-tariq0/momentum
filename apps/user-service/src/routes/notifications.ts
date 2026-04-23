import type { FastifyInstance } from 'fastify'
import { supabase } from '@forecast/db'

export async function notificationRoutes(app: FastifyInstance) {
  const isAdminRole = (p: string) => ['super_admin', 'admin'].includes(p)

  // GET /notifications — live derived alerts
  app.get('/', async (req: any, reply: any) => {
    const user = req.user
    const notifications: any[] = []

    try {
      // ── Budget alerts (admin only) ────────────────────────────────────────
      if (isAdminRole(user.profile)) {
        const { data: projects } = await supabase
          .from('projects')
          .select('id, name, color, phases(tasks(estimated_hrs, time_entries(hours)))')
          .eq('workspace_id', user.workspaceId)
          .eq('status', 'running')
          .is('deleted_at', null)

        for (const p of projects || []) {
          const allTasks  = ((p as any).phases || []).flatMap((ph: any) => ph.tasks || [])
          const estHrs    = allTasks.reduce((s: number, t: any) => s + Number(t.estimated_hrs || 0), 0)
          const loggedHrs = allTasks.flatMap((t: any) => t.time_entries || []).reduce((s: number, e: any) => s + Number(e.hours), 0)
          const pct       = estHrs > 0 ? Math.round((loggedHrs / estHrs) * 100) : 0

          if (pct >= 100) {
            notifications.push({
              id: `budget-exceeded-${(p as any).id}`,
              type: 'budget_exceeded', severity: 'critical',
              title: `${(p as any).name} exceeded budget`,
              message: `${pct}% of estimated hours used`,
              projectId: (p as any).id, color: (p as any).color, pct,
              createdAt: new Date().toISOString(), read: false,
            })
          } else if (pct >= 80) {
            notifications.push({
              id: `budget-warning-${(p as any).id}`,
              type: 'budget_warning', severity: 'warning',
              title: `${(p as any).name} budget warning`,
              message: `${pct}% of estimated hours used`,
              projectId: (p as any).id, color: (p as any).color, pct,
              createdAt: new Date().toISOString(), read: false,
            })
          }
        }

        // ── Timesheet compliance alert (mid-week) ───────────────────────────
        const today     = new Date()
        const dow       = today.getDay()
        if (dow >= 3) {
          const mon = new Date(today)
          mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
          const weekStart = mon.toISOString().slice(0, 10)
          const weekEnd   = today.toISOString().slice(0, 10)

          const { data: allUsers } = await supabase
            .from('users').select('id, name')
            .eq('workspace_id', user.workspaceId).eq('active', true).is('deleted_at', null)

          // 🛡️ Scope time_entries to THIS workspace's users only. Without this
          // .in() filter the query returns entries from every tenant, which
          // both leaks data and poisons the "missing timesheets" calculation.
          const workspaceUserIds = (allUsers || []).map((u: any) => u.id)
          const { data: entries } = workspaceUserIds.length === 0 ? { data: [] as any[] } : await supabase
            .from('time_entries').select('user_id')
            .in('user_id', workspaceUserIds)
            .gte('date', weekStart).lte('date', weekEnd)

          const submittedIds = new Set((entries || []).map((e: any) => e.user_id))
          const missing = (allUsers || []).filter((u: any) => !submittedIds.has(u.id))

          if (missing.length > 0) {
            notifications.push({
              id: `compliance-${weekStart}`,
              type: 'compliance', severity: 'warning',
              title: `${missing.length} member${missing.length > 1 ? 's' : ''} missing timesheets`,
              message: `${missing.slice(0, 3).map((u: any) => u.name.split(' ')[0]).join(', ')}${missing.length > 3 ? ` +${missing.length - 3}` : ''} haven't logged this week`,
              missingCount: missing.length,
              weekStart,
              createdAt: new Date().toISOString(), read: false,
            })
          }
        }
      }

      // ── My overdue tasks ──────────────────────────────────────────────────
      const today = new Date().toISOString().slice(0, 10)
      const { data: myAssignments } = await supabase
        .from('task_assignees')
        .select('tasks(id, title, due_date, status, phases(projects(id, name, color)))')
        .eq('user_id', user.id)

      for (const assignment of myAssignments || []) {
        const t = (assignment as any).tasks
        if (!t || !t.due_date || t.due_date >= today || t.status === 'done') continue
        notifications.push({
          id: `overdue-${t.id}`,
          type: 'overdue_task', severity: 'warning',
          title: `"${t.title}" is overdue`,
          message: `Due ${t.due_date}${t.phases?.projects?.name ? ` · ${t.phases.projects.name}` : ''}`,
          taskId: t.id,
          projectId: t.phases?.projects?.id,
          color: t.phases?.projects?.color,
          dueDate: t.due_date,
          createdAt: new Date().toISOString(), read: false,
        })
      }

      // Sort: critical first
      notifications.sort((a, b) => {
        const o: Record<string, number> = { critical: 0, warning: 1, info: 2 }
        return (o[a.severity] || 2) - (o[b.severity] || 2)
      })

    } catch (err: any) {
      console.error('Notifications error:', err?.message)
    }

    return reply.status(200).send({
      data: notifications,
      unreadCount: notifications.filter(n => !n.read).length,
    })
  })
}
