import type { FastifyInstance } from 'fastify'
import { supabase } from '@forecast/db'

export async function resourcingRoutes(app: FastifyInstance) {
  const isAdmin = (p: string) => ['super_admin', 'admin'].includes(p)

  // ── GET /resourcing/team  ─────────────────────────────────────────────────
  // Returns all users with their allocations for a given week
  app.get('/team', async (req, reply) => {
    const user   = (req as any).user
    const query  = req.query as any
    const weekStart = query.weekStart || new Date().toISOString().slice(0, 10)

    // Get week boundaries (Mon–Sun, 7 days from weekStart)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const weekEndStr = weekEnd.toISOString().slice(0, 10)

    const { data: users, error: uErr } = await supabase
      .from('users')
      .select('id, name, job_title, capacity_hrs, departments(name), avatar_url')
      .eq('workspace_id', user.workspaceId)
      .eq('active', true)
      .is('deleted_at', null)
      .order('name')

    if (uErr) return reply.status(500).send({ errors: [{ message: uErr.message }] })

    // Get all allocations for the week
    const { data: allocs, error: aErr } = await supabase
      .from('allocations')
      .select(`
        id, user_id, hours_per_day, start_date, end_date, note,
        tasks ( id, title, status, estimated_hrs, phases ( name, projects ( id, name, color, clients(name) ) ) )
      `)
      .eq('workspace_id', user.workspaceId)
      .lte('start_date', weekEndStr)
      .gte('end_date', weekStart)

    if (aErr) return reply.status(500).send({ errors: [{ message: aErr.message }] })

    // Get time entries for the week to show what's been logged
    const { data: timeEntries } = await supabase
      .from('time_entries')
      .select('user_id, hours, date')
      .eq('type', 'project')
      .gte('date', weekStart)
      .lte('date', weekEndStr)

    // Get time-off entries this week — to deduct from capacity
    const { data: timeOffThisWeek } = await supabase
      .from('time_entries')
      .select('user_id, hours')
      .eq('type', 'time_off')
      .gte('date', weekStart)
      .lte('date', weekEndStr)

    const weekTimeOffMap: Record<string, number> = {}
    for (const e of timeOffThisWeek || []) {
      weekTimeOffMap[e.user_id] = (weekTimeOffMap[e.user_id] || 0) + Number(e.hours)
    }

    // Get holidays for users' calendars — to subtract from capacity
    const { data: usersWithCal } = await supabase
      .from('users')
      .select('id, holiday_calendar_id')
      .eq('workspace_id', user.workspaceId)
      .eq('active', true)
      .is('deleted_at', null)

    const calendarIds = [...new Set((usersWithCal || []).map((u: any) => u.holiday_calendar_id).filter(Boolean))]
    let holidayDates: string[] = []
    if (calendarIds.length > 0) {
      const { data: holidays } = await supabase
        .from('holidays')
        .select('date, calendar_id')
        .in('calendar_id', calendarIds)
        .gte('date', weekStart)
        .lte('date', weekEndStr)
      holidayDates = (holidays || []).map((h: any) => h.date)
    }

    // Build per-user holiday map: userId → set of holiday dates this week
    const userHolidayMap: Record<string, Set<string>> = {}
    for (const u of usersWithCal || []) {
      userHolidayMap[u.id] = new Set()
      // Simple: apply all holidays (could be per-calendar but workspace-level is fine)
    }
    if (calendarIds.length > 0) {
      const { data: holidays } = await supabase
        .from('holidays')
        .select('date, calendar_id')
        .in('calendar_id', calendarIds)
        .gte('date', weekStart)
        .lte('date', weekEndStr)
      const calToUsers: Record<string, string[]> = {}
      for (const u of usersWithCal || []) {
        if (u.holiday_calendar_id) {
          if (!calToUsers[u.holiday_calendar_id]) calToUsers[u.holiday_calendar_id] = []
          calToUsers[u.holiday_calendar_id].push(u.id)
        }
      }
      for (const h of holidays || []) {
        for (const uid of calToUsers[h.calendar_id] || []) {
          if (!userHolidayMap[uid]) userHolidayMap[uid] = new Set()
          userHolidayMap[uid].add(h.date)
        }
      }
    }

    // Build response: per-user allocation summary
    const result = (users || []).map((u: any) => {
      const myAllocs = (allocs || []).filter((a: any) => a.user_id === u.id)
      const myLogs   = (timeEntries || []).filter((te: any) => te.user_id === u.id)

      // Calculate allocated hours for the week (overlap of alloc range with week range)
      let allocatedHrs = 0
      for (const a of myAllocs) {
        const start = new Date(Math.max(new Date(a.start_date).getTime(), new Date(weekStart).getTime()))
        const end   = new Date(Math.min(new Date(a.end_date).getTime(),   new Date(weekEndStr).getTime()))
        const days  = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
        // Exclude weekends from day count
        let workDays = 0
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          if (d.getDay() !== 0 && d.getDay() !== 6) workDays++
        }
        allocatedHrs += workDays * Number(a.hours_per_day)
      }

      const loggedHrs    = myLogs.reduce((s: number, te: any) => s + Number(te.hours), 0)
      const rawCapacity  = Number(u.capacity_hrs) || 40
      // Subtract holiday hours: each holiday day = capacity / 5 working days
      const myHolidays   = userHolidayMap[u.id]?.size || 0
      const holidayHrs   = myHolidays * (rawCapacity / 5)
      // Subtract approved time-off hours logged this week
      const leaveHrs     = weekTimeOffMap[u.id] || 0
      const capacity     = Math.max(0, rawCapacity - holidayHrs - leaveHrs)
      const available    = Math.max(0, capacity - allocatedHrs)
      const utilization  = capacity > 0 ? Math.round((allocatedHrs / capacity) * 100) : 0

      return {
        id:           u.id,
        name:         u.name,
        jobTitle:     u.job_title,
        department:   u.departments?.name,
        capacityHrs:  capacity,
        allocatedHrs: Math.round(allocatedHrs * 10) / 10,
        loggedHrs:    Math.round(loggedHrs * 10) / 10,
        availableHrs: Math.round(available * 10) / 10,
        utilization,
        holidayDays: myHolidays,
        leaveHrs,
        allocations:  myAllocs.map((a: any) => ({
          id:           a.id,
          taskId:       a.task_id,
          taskTitle:    a.tasks?.title,
          estimatedHrs: a.tasks?.estimated_hrs || 0,
          phaseName:    a.tasks?.phases?.name,
          projectId:    a.tasks?.phases?.projects?.id,
          projectName:  a.tasks?.phases?.projects?.name,
          projectColor: a.tasks?.phases?.projects?.color,
          clientName:   a.tasks?.phases?.projects?.clients?.name,
          startDate:    a.start_date,
          endDate:      a.end_date,
          hoursPerDay:  a.hours_per_day,
          note:         a.note,
        })),
      }
    })

    return reply.status(200).send({ data: result, weekStart, weekEnd: weekEndStr })
  })

  // ── GET /resourcing/tasks  ────────────────────────────────────────────────
  // Tasks within the caller's workspace only (for allocation picker)
  app.get('/tasks', async (req, reply) => {
    const user   = (req as any).user
    const query  = req.query as any
    const search = (query.search || '').toLowerCase()
    const projectId = query.projectId || null

    // Restrict by workspace via project chain. Use !inner to drop tasks whose
    // project doesn't match.
    let q = supabase
      .from('tasks')
      .select('id, title, status, estimated_hrs, phases!inner ( id, name, projects!inner ( id, name, color, status, workspace_id, clients(name) ) )')
      .eq('phases.projects.workspace_id', user.workspaceId)
      .neq('status', 'done')
      .order('title')
      .limit(200)

    if (projectId) q = q.eq('phases.projects.id', projectId)

    const { data, error } = await q
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })

    const filtered = (data || []).filter((t: any) => {
      if (search &&
        !t.title?.toLowerCase().includes(search) &&
        !t.phases?.projects?.name?.toLowerCase().includes(search)) return false
      return true
    })

    return reply.status(200).send({ data: filtered })
  })

  // ── GET /resourcing/projects  ─────────────────────────────────────────────
  // Running projects for the quick-add popup dropdown
  app.get('/projects', async (req, reply) => {
    const user = (req as any).user
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, color, status, clients(name)')
      .eq('workspace_id', user.workspaceId)
      .eq('status', 'running')
      .order('name')
      .range(0, 9999)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  // ── POST /resourcing/allocations  ─────────────────────────────────────────
  // Create a new allocation (admin only)
  app.post('/allocations', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { user_id, task_id, start_date, end_date, hours_per_day, note } = req.body as any

    if (!user_id || !task_id || !start_date || !end_date) {
      return reply.status(400).send({ errors: [{ code: 'MISSING_FIELDS', message: 'user_id, task_id, start_date, end_date are required' }] })
    }

    // Date sanity
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return reply.status(400).send({ errors: [{ code: 'BAD_DATE_FORMAT' }] })
    }
    if (start_date > end_date) {
      return reply.status(400).send({ errors: [{ code: 'BAD_DATE_RANGE', message: 'end_date must be ≥ start_date' }] })
    }
    const hpd = Number(hours_per_day ?? 8)
    if (!Number.isFinite(hpd) || hpd <= 0 || hpd > 24) {
      return reply.status(400).send({ errors: [{ code: 'BAD_HOURS', message: 'hours_per_day must be between 0 and 24' }] })
    }

    // Verify both user and task belong to caller's workspace
    const { data: targetUser } = await supabase.from('users').select('id').eq('id', user_id).eq('workspace_id', user.workspaceId).maybeSingle()
    if (!targetUser) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN', message: 'User not in workspace' }] })
    const { data: targetTask } = await supabase.from('tasks').select('id, phases!inner(projects!inner(workspace_id))').eq('id', task_id).maybeSingle()
    if (!targetTask || (targetTask as any).phases?.projects?.workspace_id !== user.workspaceId) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN', message: 'Task not in workspace' }] })
    }

    // Idempotency: reject duplicate allocations on the exact same task+user+overlap.
    // Two concurrent saves of the same week from two tabs no longer create dupes.
    const { data: existing } = await supabase
      .from('allocations')
      .select('id')
      .eq('user_id', user_id)
      .eq('task_id', task_id)
      .lte('start_date', end_date)
      .gte('end_date', start_date)
      .limit(1)
    if (existing && existing.length > 0) {
      return reply.status(409).send({ errors: [{ code: 'ALLOCATION_OVERLAP', message: 'An allocation for this user/task already covers part of this date range.' }] })
    }

    const { data, error } = await supabase
      .from('allocations')
      .insert({
        workspace_id: user.workspaceId,
        user_id, task_id, start_date, end_date,
        hours_per_day: hpd,
        note: note || null,
        created_by: user.id,
      })
      .select(`
        id, user_id, task_id, start_date, end_date, hours_per_day, note,
        tasks ( id, title, phases ( name, projects ( id, name, color ) ) )
      `)
      .single()

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  // ── PATCH /resourcing/allocations/:id  ────────────────────────────────────
  app.patch('/allocations/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { id }                                         = req.params as any
    const body = req.body as any
    // Whitelist allowed fields
    const update: any = {}
    if (body.start_date    !== undefined) update.start_date    = body.start_date
    if (body.end_date      !== undefined) update.end_date      = body.end_date
    if (body.hours_per_day !== undefined) update.hours_per_day = body.hours_per_day
    if (body.note          !== undefined) update.note          = body.note

    // IDOR fix: workspace boundary
    const { data, error } = await supabase
      .from('allocations')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .select()
      .single()

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    if (!data) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return reply.status(200).send({ data })
  })

  // ── DELETE /resourcing/allocations/:id  ───────────────────────────────────
  app.delete('/allocations/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { id } = req.params as any
    // IDOR fix: workspace boundary
    const { error, count } = await supabase.from('allocations').delete({ count: 'exact' })
      .eq('id', id).eq('workspace_id', user.workspaceId)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    if (count === 0) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return reply.status(200).send({ data: { deleted: true } })
  })
}
