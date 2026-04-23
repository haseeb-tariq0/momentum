import type { FastifyInstance } from 'fastify'
import { supabase } from '@forecast/db'
import { createSpreadsheet, isGoogleSheetsConfigured } from '../lib/googleSheets.js'

export async function reportRoutes(app: FastifyInstance) {
  const isAdminRole = (p: string) => ['super_admin', 'admin'].includes(p)

  // GET /reports/pnl
  app.get('/pnl', async (req: any, reply: any) => {
    const user = req.user
    if (!isAdminRole(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { data: projects, error } = await supabase
      .from('projects')
      .select('id, name, status, budget_amount, budget_type, currency, color, rate_card_id, clients(name)')
      .eq('workspace_id', user.workspaceId)
      .eq('status', 'running')
      .is('deleted_at', null)
      .range(0, 9999)

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })

    // Load rate cards. Apr 17 call: rates resolve per-department — job_title
    // kept as a legacy fallback for cards that haven't been migrated yet.
    const { data: rateCards } = await supabase
      .from('rate_cards')
      .select('id, name, rate_card_entries(job_title, department_id, hourly_rate)')
      .eq('workspace_id', user.workspaceId)

    const rcMap: Record<string, any> = {}
    const rcRates: Record<string, { byDept: Record<string, number>; byTitle: Record<string, number> }> = {}
    for (const rc of rateCards || []) {
      rcMap[rc.id] = rc
      const idx = { byDept: {} as Record<string, number>, byTitle: {} as Record<string, number> }
      for (const re of (rc as any).rate_card_entries || []) {
        if (re.department_id) idx.byDept[re.department_id] = Number(re.hourly_rate)
        else if (re.job_title) idx.byTitle[re.job_title] = Number(re.hourly_rate)
      }
      rcRates[rc.id] = idx
    }

    // Load stats per project from time entries
    const projectIds = (projects || []).map((p: any) => p.id)

    const { data: phases } = await supabase
      .from('phases')
      .select('id, project_id, tasks(id, title, estimated_hrs, billable, task_assignees(user_id, users(job_title, department_id)), time_entries(user_id, hours, billable))')
      .in('project_id', projectIds.length ? projectIds : ['none'])

    // Build project stats
    const projectStats: Record<string, any> = {}
    for (const ph of phases || []) {
      const pid = (ph as any).project_id
      if (!projectStats[pid]) projectStats[pid] = { estHrs: 0, loggedHrs: 0, billableHrs: 0, cost: 0, tasks: [] }
      for (const task of (ph as any).tasks || []) {
        projectStats[pid].estHrs += Number(task.estimated_hrs || 0)
        projectStats[pid].tasks.push(task)
        for (const entry of task.time_entries || []) {
          projectStats[pid].loggedHrs += Number(entry.hours)
          if (entry.billable) {
            projectStats[pid].billableHrs += Number(entry.hours)
            // Calc cost — department first, job_title as legacy fallback.
            const project = (projects || []).find((p: any) => p.id === pid)
            const rcId = project?.rate_card_id
            const idx = rcId ? rcRates[rcId] : null
            if (idx) {
              const assignee = (task.task_assignees || []).find((a: any) => a.user_id === entry.user_id)
              const deptId   = assignee?.users?.department_id || ''
              const jobTitle = assignee?.users?.job_title     || ''
              const rate = idx.byDept[deptId] || idx.byTitle[jobTitle] || 0
              projectStats[pid].cost += Number(entry.hours) * rate
            }
          }
        }
      }
    }

    const result = (projects || []).map((p: any) => {
      const stats  = projectStats[p.id] || { estHrs: 0, loggedHrs: 0, billableHrs: 0, cost: 0 }
      const budget = Number(p.budget_amount) || 0
      const cost   = Math.round(stats.cost)
      const profit = budget > 0 ? budget - cost : 0
      const margin = budget > 0 && cost > 0 ? Math.round((profit / budget) * 100) : null
      const hrsPct = stats.estHrs > 0 ? Math.round((stats.loggedHrs / stats.estHrs) * 100) : 0
      const rc     = p.rate_card_id ? rcMap[p.rate_card_id] : null

      return {
        id: p.id, name: p.name, status: p.status,
        client: (p.clients as any)?.name || '',
        budgetType: p.budget_type, budget,
        currency: p.currency || 'AED',
        rateCard: rc?.name || null,
        estHrs:      Math.round(stats.estHrs * 10) / 10,
        loggedHrs:   Math.round(stats.loggedHrs * 10) / 10,
        billableHrs: Math.round(stats.billableHrs * 10) / 10,
        cost, profit, margin, hrsPct,
        color: p.color,
      }
    })

    const totals = {
      totalBudget:  result.reduce((s, p) => s + p.budget, 0),
      totalCost:    result.reduce((s, p) => s + p.cost, 0),
      totalProfit:  result.reduce((s, p) => s + p.profit, 0),
      totalLogged:  Math.round(result.reduce((s, p) => s + p.loggedHrs, 0) * 10) / 10,
      totalBillable:Math.round(result.reduce((s, p) => s + p.billableHrs, 0) * 10) / 10,
    }

    return reply.status(200).send({ data: result, totals })
  })

  // GET /reports/utilization?weekStart=YYYY-MM-DD
  app.get('/utilization', async (req: any, reply: any) => {
    const user = req.user
    if (!isAdminRole(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const weekStart = (req.query as any).weekStart || new Date().toISOString().slice(0, 10)
    const d = new Date(weekStart); d.setDate(d.getDate() + 6)
    const weekEnd = d.toISOString().slice(0, 10)

    const { data: users, error: uErr } = await supabase
      .from('users')
      .select('id, name, job_title, capacity_hrs, holiday_calendar_id, departments(name)')
      .eq('workspace_id', user.workspaceId)
      .eq('active', true)
      .is('deleted_at', null)
      .order('name')
    if (uErr) return reply.status(500).send({ errors: [{ message: uErr.message }] })

    const userIds = (users || []).map((u: any) => u.id)

    // Fetch time entries (work + time_off)
    const { data: entries } = await supabase
      .from('time_entries')
      .select('user_id, hours, billable, date, type')
      .in('user_id', userIds.length ? userIds : ['none'])
      .gte('date', weekStart)
      .lte('date', weekEnd)

    // Fetch public holidays for the week
    const calIds = [...new Set((users || []).map((u: any) => u.holiday_calendar_id).filter(Boolean))]
    const { data: holidays } = calIds.length
      ? await supabase.from('holidays').select('date, calendar_id')
          .in('calendar_id', calIds).gte('date', weekStart).lte('date', weekEnd)
      : { data: [] }
    const calHolidays: Record<string, Set<string>> = {}
    for (const h of holidays || []) {
      if (!calHolidays[h.calendar_id]) calHolidays[h.calendar_id] = new Set()
      calHolidays[h.calendar_id].add(h.date)
    }

    // Helper: net capacity for one user over the week
    function netCap(u: any, timeOffHrs: number): number {
      const daily = Number(u.capacity_hrs || 40) / 5
      let workDays = 0
      const cur = new Date(weekStart + 'T12:00:00')
      const end = new Date(weekEnd   + 'T12:00:00')
      while (cur <= end) {
        if (cur.getDay() !== 0 && cur.getDay() !== 6) workDays++
        cur.setDate(cur.getDate() + 1)
      }
      const holSet = u.holiday_calendar_id ? (calHolidays[u.holiday_calendar_id] || new Set()) : new Set()
      const gross = Math.max(0, workDays - holSet.size) * daily
      return Math.round(Math.max(0, gross - timeOffHrs) * 10) / 10
    }

    const result = (users || []).map((u: any) => {
      const myEntries   = (entries || []).filter((e: any) => e.user_id === u.id)
      const workEntries = myEntries.filter((e: any) => e.type !== 'time_off')
      const timeOffHrs  = myEntries.filter((e: any) => e.type === 'time_off').reduce((s: number, e: any) => s + Number(e.hours), 0)
      const totalHrs    = workEntries.reduce((s: number, e: any) => s + Number(e.hours), 0)
      const billableHrs = workEntries.filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours), 0)
      const cap         = netCap(u, timeOffHrs)
      return {
        userId:      u.id,
        name:        u.name,
        department:  (u.departments as any)?.name || '—',
        jobTitle:    u.job_title || '—',
        capacityHrs: cap,
        loggedHrs:   Math.round(totalHrs    * 10) / 10,
        billableHrs: Math.round(billableHrs * 10) / 10,
        daysLogged:  new Set(workEntries.map((e: any) => e.date)).size,
        utilizationPct: cap > 0 ? Math.round((totalHrs / cap) * 100) : 0,
        billablePct:    totalHrs > 0 ? Math.round((billableHrs / totalHrs) * 100) : 0,
        submitted:      totalHrs > 0,
      }
    })

    return reply.status(200).send({ data: result, weekStart, weekEnd })
  })

  // ── GET /reports/active-projects ──────────────────────────────────────────
  // Returns projects with calculated days_remaining, expiry status, logged hours,
  // and their labels (project categories per Apr 15 meeting).
  app.get('/active-projects', async (req: any, reply: any) => {
    const user = req.user
    if (!isAdminRole(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    // PostgREST caps at db-max-rows (1000 on Supabase cloud). Paginate manually.
    const PAGE = 1000
    const projects: any[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, status, start_date, end_date, budget_type, budget_amount, currency, color, clients(id, name), project_label_on_projects(project_labels(id, name, color))')
        .eq('workspace_id', user.workspaceId)
        .is('deleted_at', null)
        .order('end_date', { ascending: true, nullsFirst: false })
        .range(from, from + PAGE - 1)
      if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
      const page = data || []
      projects.push(...page)
      if (page.length < PAGE) break
    }

    const projectIds = projects.map((p: any) => p.id)

    // Aggregate logged hours per project (via tasks → phases → project_id)
    // Two-step to avoid fragile nested-path filters
    const loggedByProject: Record<string, number> = {}
    const estByProject:    Record<string, number> = {}
    if (projectIds.length) {
      // Step 1: get all tasks for these projects, with their phase → project mapping
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('id, estimated_hrs, phases!inner(project_id)')
        .in('phases.project_id', projectIds)

      // Build task_id → project_id map, and aggregate estimated hours
      const taskToProject: Record<string, string> = {}
      for (const t of tasksData || []) {
        const pid = (t as any).phases?.project_id
        const tid = (t as any).id
        if (pid && tid) {
          taskToProject[tid] = pid
          estByProject[pid] = (estByProject[pid] || 0) + Number((t as any).estimated_hrs || 0)
        }
      }

      // Step 2: get time entries for these tasks
      const taskIds = Object.keys(taskToProject)
      if (taskIds.length) {
        const { data: timeData } = await supabase
          .from('time_entries')
          .select('hours, task_id')
          .in('task_id', taskIds)

        for (const e of timeData || []) {
          const tid = (e as any).task_id
          const pid = taskToProject[tid]
          if (pid) loggedByProject[pid] = (loggedByProject[pid] || 0) + Number((e as any).hours || 0)
        }
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const result = (projects || []).map((p: any) => {
      const endDate = p.end_date
      let daysRemaining: number | null = null
      // 5 buckets per Apr 15 meeting: expired / 30d / 60d / 90d / beyond_90d
      let expiryStatus: 'beyond_90d' | 'expired' | 'expiring_30d' | 'expiring_60d' | 'expiring_90d' = 'beyond_90d'

      if (endDate) {
        const diffMs = new Date(endDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()
        daysRemaining = Math.round(diffMs / 86400000)
        if (daysRemaining < 0) expiryStatus = 'expired'
        else if (daysRemaining <= 30) expiryStatus = 'expiring_30d'
        else if (daysRemaining <= 60) expiryStatus = 'expiring_60d'
        else if (daysRemaining <= 90) expiryStatus = 'expiring_90d'
      }

      const loggedHrs = Math.round((loggedByProject[p.id] || 0) * 10) / 10
      const estimatedHrs = Math.round((estByProject[p.id] || 0) * 10) / 10

      // Flatten labels from nested join
      const labels = (p.project_label_on_projects || [])
        .map((ppl: any) => ppl.project_labels)
        .filter(Boolean)
        .map((l: any) => ({ id: l.id, name: l.name, color: l.color }))

      return {
        id: p.id, name: p.name, status: p.status,
        client: (p.clients as any)?.name || '',
        clientId: (p.clients as any)?.id || '',
        startDate: p.start_date, endDate: p.end_date,
        // Raw value for filter matching (retainer / fixed_price / time_and_materials)
        budgetType:    p.budget_type || '',
        // Pretty label for display
        budgetTypeLabel: (p.budget_type || '').replace(/_/g, ' '),
        budgetAmount: Number(p.budget_amount) || 0,
        currency: p.currency || 'AED',
        daysRemaining, expiryStatus,
        loggedHrs, estimatedHrs,
        hrsBurnPct: estimatedHrs > 0 ? Math.round((loggedHrs / estimatedHrs) * 100) : 0,
        color: p.color,
        labels,
      }
    })

    return reply.status(200).send({ data: result })
  })

  // ── GET /reports/partner ──────────────────────────────────────────────────
  // Partner report: time entries for a client/month with rate card cost calculation
  app.get('/partner', async (req: any, reply: any) => {
    const user = req.user
    if (!isAdminRole(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { client_id, from, to } = req.query as any
    if (!client_id) return reply.status(400).send({ errors: [{ code: 'MISSING_CLIENT', message: 'client_id required' }] })

    const startDate = from || new Date().toISOString().slice(0, 8) + '01'
    const endDate = to || new Date().toISOString().slice(0, 10)

    // Load client info (name, default rate card for fallback)
    const { data: clientRow } = await supabase
      .from('clients')
      .select('id, name, default_rate_card_id')
      .eq('id', client_id)
      .eq('workspace_id', user.workspaceId)
      .maybeSingle()
    if (!clientRow) return reply.status(404).send({ errors: [{ code: 'CLIENT_NOT_FOUND' }] })
    const clientDefaultRcId: string | null = (clientRow as any).default_rate_card_id || null

    // Get all projects for this client
    const { data: clientProjects } = await supabase
      .from('projects')
      .select('id, name, rate_card_id, color, currency')
      .eq('workspace_id', user.workspaceId)
      .eq('client_id', client_id)
      .is('deleted_at', null)

    const projectIds = (clientProjects || []).map((p: any) => p.id)
    if (!projectIds.length) return reply.status(200).send({
      data: [],
      summary: { byProject: [], byDepartment: [], totalHrs: 0, totalCost: 0 },
      client: { id: clientRow.id, name: clientRow.name },
      currency: 'AED',
    })

    // Rate card resolution: project.rate_card_id first; else client.default_rate_card_id.
    // Collect all rate card IDs to load in one query.
    const rcIds = [...new Set(
      [
        ...(clientProjects || []).map((p: any) => p.rate_card_id).filter(Boolean),
        ...(clientDefaultRcId ? [clientDefaultRcId] : []),
      ]
    )]
    const { data: rateCards } = rcIds.length ? await supabase
      .from('rate_cards')
      .select('id, name, currency, rate_card_entries(id, job_title, department_id, hourly_rate)')
      .in('id', rcIds)
      .eq('workspace_id', user.workspaceId)
    : { data: [] }

    const rcMap: Record<string, any> = {}
    for (const rc of rateCards || []) rcMap[rc.id] = rc

    // Get time entries for these projects in date range — include department_id on user.
    // Early-exit if there are no project IDs; .in('project_id', []) is a no-op but
    // the explicit guard also stops the query from scanning the whole table.
    const { data: entries } = projectIds.length ? await supabase
      .from('time_entries')
      .select(`id, user_id, task_id, date, hours, billable, note,
        users!inner(id, name, job_title, department_id, workspace_id, departments(id, name)),
        tasks!inner(id, title, phases!inner(id, name, project_id))`)
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('type', 'project')
      .eq('users.workspace_id', user.workspaceId)
      .in('tasks.phases.project_id', projectIds)
    : { data: [] as any[] }

    // Filter to only entries for this client's projects
    const clientEntries = (entries || []).filter((e: any) => {
      const pid = e.tasks?.phases?.project_id
      return pid && projectIds.includes(pid)
    })

    // Build rate lookup per project: { byDepartmentId, byJobTitle } (department preferred).
    // If project has no rate_card_id, fall back to the client's default rate card.
    const rateByProject: Record<string, { byDept: Record<string, number>; byTitle: Record<string, number> }> = {}
    for (const p of clientProjects || []) {
      const effectiveRcId = p.rate_card_id || clientDefaultRcId
      const rc = effectiveRcId ? rcMap[effectiveRcId] : null
      rateByProject[p.id] = { byDept: {}, byTitle: {} }
      if (rc) {
        for (const re of rc.rate_card_entries || []) {
          if (re.department_id) rateByProject[p.id].byDept[re.department_id] = Number(re.hourly_rate)
          else if (re.job_title) rateByProject[p.id].byTitle[re.job_title] = Number(re.hourly_rate)
        }
      }
    }

    const projectMap: Record<string, any> = {}
    for (const p of clientProjects || []) projectMap[p.id] = p

    // Currency: prefer client's default rate card; else first project rate card; else project.currency; else AED
    const clientDefaultRc = clientDefaultRcId ? rcMap[clientDefaultRcId] : null
    const firstRc: any = clientDefaultRc || (rateCards || [])[0]
    const currency = firstRc?.currency || (clientProjects || [])[0]?.currency || 'AED'

    // Build flat rows
    const rows = clientEntries.map((e: any) => {
      const projectId = e.tasks?.phases?.project_id || ''
      const jobTitle = e.users?.job_title || ''
      const deptId   = e.users?.department_id || ''
      const deptName = e.users?.departments?.name || ''
      const rateLookup = rateByProject[projectId] || { byDept: {}, byTitle: {} }
      // Department-based lookup first (new system), then job_title (legacy)
      const rate = rateLookup.byDept[deptId] || rateLookup.byTitle[jobTitle] || 0
      const hours = Number(e.hours)
      const cost = Math.round(hours * rate * 100) / 100

      return {
        id: e.id,
        projectId,
        projectName: projectMap[projectId]?.name || '',
        taskId: e.task_id,
        taskName: e.tasks?.title || '',
        phaseName: e.tasks?.phases?.name || '',
        hours,
        date: e.date,
        personName: e.users?.name || '',
        role: jobTitle,
        department: deptName,
        departmentId: deptId,
        team: deptName, // alias to match Murtaza's "Team" column
        billable: e.billable,
        rate,
        cost,
        note: e.note || '',
      }
    })

    // Summaries — prefix with client name to match Murtaza's format
    // "Human Magic - Website" rather than just "Website"
    const byProject: Record<string, { name: string; hours: number; cost: number }> = {}
    const byDepartment: Record<string, { name: string; hours: number; cost: number; rate: number }> = {}

    for (const r of rows) {
      if (!byProject[r.projectId]) byProject[r.projectId] = { name: r.projectName, hours: 0, cost: 0 }
      byProject[r.projectId].hours += r.hours
      byProject[r.projectId].cost += r.cost

      const deptKey = r.department || 'Unassigned'
      if (!byDepartment[deptKey]) {
        byDepartment[deptKey] = {
          name: `${clientRow.name} - ${deptKey}`,
          hours: 0, cost: 0, rate: r.rate,
        }
      }
      byDepartment[deptKey].hours += r.hours
      byDepartment[deptKey].cost += r.cost
    }

    // Round summaries
    const roundedByProject = Object.values(byProject).map(p => ({
      name: p.name,
      hours: Math.round(p.hours * 100) / 100,
      cost: Math.round(p.cost * 100) / 100,
    })).sort((a, b) => b.hours - a.hours)

    const roundedByDepartment = Object.values(byDepartment).map(d => ({
      name: d.name,
      hours: Math.round(d.hours * 100) / 100,
      cost: Math.round(d.cost * 100) / 100,
      rate: d.rate,
    })).sort((a, b) => b.hours - a.hours)

    const totalHrs = rows.reduce((s, r) => s + r.hours, 0)
    const totalCost = rows.reduce((s, r) => s + r.cost, 0)

    return reply.status(200).send({
      data: rows,
      summary: {
        byProject: roundedByProject,
        byDepartment: roundedByDepartment,
        totalHrs: Math.round(totalHrs * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
      },
      client: { id: clientRow.id, name: clientRow.name },
      currency,
    })
  })

  // ── GET /reports/partner-bulk ─────────────────────────────────────────────
  // One-click monthly billing rollup across ALL partner-billable clients.
  //   * A client is "partner-billable" if it has clients.default_rate_card_id
  //     set, OR any of its projects has projects.rate_card_id set.
  //   * For each such client: compute hours × rate card for the given month,
  //     split by department. Same math as /partner, just looped.
  //   * Response groups totals by client currency so the UI can show
  //     per-currency totals without attempting conversion.
  // Query: ?month=YYYY-MM (required, monthly only per Apr 15 meeting)
  app.get('/partner-bulk', async (req: any, reply: any) => {
    const user = req.user
    if (!isAdminRole(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { month } = req.query as any
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return reply.status(400).send({ errors: [{ code: 'BAD_MONTH', message: 'month=YYYY-MM required' }] })
    }
    const startDate = `${month}-01`
    const nextMonthStart = new Date(`${month}-01T00:00:00Z`)
    nextMonthStart.setUTCMonth(nextMonthStart.getUTCMonth() + 1)
    const endDate = new Date(nextMonthStart.getTime() - 86_400_000).toISOString().slice(0, 10)

    // Find candidate clients + their projects in one pass
    const { data: allClients } = await supabase
      .from('clients')
      .select('id, name, default_rate_card_id')
      .eq('workspace_id', user.workspaceId)
      .is('deleted_at', null)

    const { data: allProjects } = await supabase
      .from('projects')
      .select('id, name, client_id, rate_card_id')
      .eq('workspace_id', user.workspaceId)
      .is('deleted_at', null)
      .range(0, 9999)

    const projectsByClient: Record<string, any[]> = {}
    for (const p of allProjects || []) {
      const pr = p as any
      if (!pr.client_id) continue
      if (!projectsByClient[pr.client_id]) projectsByClient[pr.client_id] = []
      projectsByClient[pr.client_id].push(pr)
    }

    const billableClients = (allClients || []).filter((c: any) => {
      if (c.default_rate_card_id) return true
      return (projectsByClient[c.id] || []).some((p: any) => p.rate_card_id)
    })

    if (!billableClients.length) {
      return reply.status(200).send({ data: [], totalsByCurrency: {}, month })
    }

    // Collect all rate card IDs we'll need
    const rcIds = new Set<string>()
    for (const c of billableClients) {
      if ((c as any).default_rate_card_id) rcIds.add((c as any).default_rate_card_id)
      for (const p of projectsByClient[(c as any).id] || []) {
        if (p.rate_card_id) rcIds.add(p.rate_card_id)
      }
    }

    const { data: rateCards } = rcIds.size
      ? await supabase
          .from('rate_cards')
          .select('id, name, currency, rate_card_entries(id, job_title, department_id, hourly_rate)')
          .in('id', Array.from(rcIds))
      : { data: [] }
    const rcMap: Record<string, any> = {}
    for (const rc of rateCards || []) rcMap[(rc as any).id] = rc

    // Pull all time entries for the month in one query, filter per-client below
    const { data: allEntries } = await supabase
      .from('time_entries')
      .select(`id, user_id, task_id, date, hours, billable,
        users(id, name, department_id, departments(id, name), job_title),
        tasks(id, title, phases(id, name, project_id))`)
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('type', 'project')

    const entriesByProject: Record<string, any[]> = {}
    for (const e of allEntries || []) {
      const pid = (e as any).tasks?.phases?.project_id
      if (!pid) continue
      if (!entriesByProject[pid]) entriesByProject[pid] = []
      entriesByProject[pid].push(e)
    }

    // Build per-client report
    const perClient: any[] = []
    const totalsByCurrency: Record<string, { hours: number; cost: number; clientCount: number }> = {}

    for (const c of billableClients) {
      const cc = c as any
      const projects = projectsByClient[cc.id] || []
      const defaultRc = cc.default_rate_card_id ? rcMap[cc.default_rate_card_id] : null
      const currency = defaultRc?.currency
        || rcMap[projects.find((p: any) => p.rate_card_id)?.rate_card_id]?.currency
        || 'AED'

      let totalHrs = 0
      let totalCost = 0
      const byDept: Record<string, { name: string; hours: number; cost: number }> = {}

      for (const p of projects) {
        const effectiveRc = p.rate_card_id ? rcMap[p.rate_card_id] : defaultRc
        const byDeptId: Record<string, number> = {}
        const byTitle: Record<string, number> = {}
        if (effectiveRc) {
          for (const re of effectiveRc.rate_card_entries || []) {
            if (re.department_id) byDeptId[re.department_id] = Number(re.hourly_rate)
            else if (re.job_title) byTitle[re.job_title] = Number(re.hourly_rate)
          }
        }
        for (const e of entriesByProject[p.id] || []) {
          const ee = e as any
          const deptId = ee.users?.department_id || ''
          const deptName = ee.users?.departments?.name || 'Unassigned'
          const jobTitle = ee.users?.job_title || ''
          const rate = byDeptId[deptId] || byTitle[jobTitle] || 0
          const hrs = Number(ee.hours) || 0
          const cost = Math.round(hrs * rate * 100) / 100
          totalHrs += hrs
          totalCost += cost
          if (!byDept[deptName]) byDept[deptName] = { name: deptName, hours: 0, cost: 0 }
          byDept[deptName].hours += hrs
          byDept[deptName].cost += cost
        }
      }

      // Skip clients with zero activity — noise in the output
      if (totalHrs === 0) continue

      const rateCardName = defaultRc?.name
        || rcMap[projects.find((p: any) => p.rate_card_id)?.rate_card_id]?.name
        || '(mixed)'

      perClient.push({
        id: cc.id,
        name: cc.name,
        rateCardName,
        currency,
        totalHrs: Math.round(totalHrs * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        byDepartment: Object.values(byDept)
          .map(d => ({ name: d.name, hours: Math.round(d.hours * 100) / 100, cost: Math.round(d.cost * 100) / 100 }))
          .sort((a, b) => b.cost - a.cost),
      })

      if (!totalsByCurrency[currency]) totalsByCurrency[currency] = { hours: 0, cost: 0, clientCount: 0 }
      totalsByCurrency[currency].hours += totalHrs
      totalsByCurrency[currency].cost += totalCost
      totalsByCurrency[currency].clientCount += 1
    }

    // Round totals
    for (const cur of Object.keys(totalsByCurrency)) {
      totalsByCurrency[cur].hours = Math.round(totalsByCurrency[cur].hours * 100) / 100
      totalsByCurrency[cur].cost = Math.round(totalsByCurrency[cur].cost * 100) / 100
    }

    perClient.sort((a, b) => b.totalCost - a.totalCost)

    return reply.status(200).send({ data: perClient, totalsByCurrency, month })
  })


  // ── GET /reports/partner-billing ──────────────────────────────────────────
  // Partner Billing: what we BILLED each partner-like client, sourced from the
  // Finance Sheet (client_invoices). Complements Partner Report (which shows
  // what we should bill based on hours × partner rate card) — Partner Billing
  // shows what actually went on the invoices.
  //
  // Per Apr 17 call with Murtaza (verbatim requirements):
  //   1. Total Billing    = sales_amount + third_party  (what was billed)
  //   2. Third Party Cost = third_party                 (passed-through supplier cost)
  //   3. Net Revenue      = sales_amount                (what we actually earned)
  //   4. Same breakdown as Client Profitability's revenue side, so the numbers
  //      reconcile between reports.
  //   5. Nexa Cognition edge case: it's BOTH a partner AND has its own sub-
  //      clients (Redwood, Bespoke). Sub-clients bill on a separate "partner
  //      agency sub-client rate card" but reports ROLL UP under Nexa Cognition.
  //      We model this via clients.parent_client_id. When a parent has
  //      children with invoices, the parent row shows its own direct billing
  //      and each child is nested under it as a sub-row; rollup totals are
  //      computed client-side by the UI so the raw numbers stay auditable.
  //   6. Admin flags rate-card-configured status so Murtaza can see at a
  //      glance which partners still need their rate card set up.
  //
  // Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD (monthly snapped like client-profitability)
  //
  // "Partner-like" inclusion rule is intentionally broad: ANY client with at
  // least one invoice row in the date range qualifies. We don't gate on
  // clients.default_rate_card_id (most are NULL today) — that would hide real
  // billing data from the report until someone sets up every partner's rate
  // card. Instead we surface a `rateCardConfigured` flag per row so the
  // missing-config case is visible but not obstructive.
  app.get('/partner-billing', async (req: any, reply: any) => {
    const user = req.user
    if (!isAdminRole(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { from, to } = req.query as any
    const today = new Date()

    // Snap to full-month boundaries — invoices are stored as monthly sums so
    // partial-month ranges don't make sense. Default: current year-to-date.
    let startDate = from || `${today.getFullYear()}-01-01`
    let endDate   = to   || today.toISOString().slice(0, 10)
    startDate = startDate.slice(0, 8) + '01'
    const endY = Number(endDate.slice(0, 4))
    const endM = Number(endDate.slice(5, 7))
    const lastDay = new Date(Date.UTC(endY, endM, 0)).getUTCDate()
    endDate = `${endDate.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`

    // 1) Pull invoices in range
    const { data: invoices } = await supabase
      .from('client_invoices')
      .select('client_id, client_name_raw, month, sales_amount, third_party, currency')
      .eq('workspace_id', user.workspaceId)
      .gte('month', startDate)
      .lte('month', endDate)

    // 2) Pull all clients so we can render names + hierarchy even for clients
    //    whose invoices didn't map to a client_id (client_name_raw fallback).
    const { data: clientsData } = await supabase
      .from('clients')
      .select('id, name, parent_client_id, default_rate_card_id')
      .eq('workspace_id', user.workspaceId)
      .is('deleted_at', null)

    const clientById: Record<string, any> = {}
    for (const c of clientsData || []) clientById[(c as any).id] = c

    // 3) Rate card names for the "configured?" column
    const rcIds = new Set<string>()
    for (const c of clientsData || []) {
      const rcid = (c as any).default_rate_card_id
      if (rcid) rcIds.add(rcid)
    }
    const { data: rateCards } = rcIds.size ? await supabase
      .from('rate_cards')
      .select('id, name, currency')
      .in('id', Array.from(rcIds))
      .eq('workspace_id', user.workspaceId)
    : { data: [] }
    const rcMap: Record<string, any> = {}
    for (const rc of rateCards || []) rcMap[(rc as any).id] = rc

    // 4) Aggregate invoices into per-client + per-month buckets
    type MonthBucket = { billing: number; thirdParty: number; netRevenue: number; currency: string }
    type ClientBucket = {
      clientId: string | null          // null = unmapped invoice (by client_name_raw only)
      clientName: string
      parentClientId: string | null
      rateCardId: string | null
      rateCardName: string | null
      rateCardConfigured: boolean
      currency: string
      billing: number
      thirdParty: number
      netRevenue: number
      months: Record<string, MonthBucket>  // YYYY-MM-DD → bucket
    }

    const buckets: Record<string, ClientBucket> = {} // keyed by clientId OR 'raw::'+client_name_raw for unmapped

    function keyFor(inv: any): string {
      return inv.client_id ? `id::${inv.client_id}` : `raw::${inv.client_name_raw}`
    }

    for (const inv of invoices || []) {
      const key = keyFor(inv)
      if (!buckets[key]) {
        const clientInfo = inv.client_id ? clientById[inv.client_id] : null
        const rcId = clientInfo?.default_rate_card_id || null
        const rc   = rcId ? rcMap[rcId] : null
        buckets[key] = {
          clientId: inv.client_id || null,
          clientName: clientInfo?.name || inv.client_name_raw || '(Unknown)',
          parentClientId: clientInfo?.parent_client_id || null,
          rateCardId: rcId,
          rateCardName: rc?.name || null,
          rateCardConfigured: !!rcId,
          currency: inv.currency || 'AED',
          billing: 0, thirdParty: 0, netRevenue: 0,
          months: {},
        }
      }
      const b = buckets[key]
      const sales      = Number(inv.sales_amount) || 0
      const thirdParty = Number(inv.third_party)  || 0
      const billing    = sales + thirdParty
      b.billing    += billing
      b.thirdParty += thirdParty
      b.netRevenue += sales

      const monthKey = String(inv.month).slice(0, 10)
      if (!b.months[monthKey]) {
        b.months[monthKey] = { billing: 0, thirdParty: 0, netRevenue: 0, currency: inv.currency || 'AED' }
      }
      b.months[monthKey].billing    += billing
      b.months[monthKey].thirdParty += thirdParty
      b.months[monthKey].netRevenue += sales
    }

    // 5) Round and flatten to a list. Parent/child nesting is preserved via
    //    the parentClientId field — UI can tree-render as needed.
    const round2 = (n: number) => Math.round(n * 100) / 100
    const flatList = Object.values(buckets).map(b => ({
      ...b,
      billing:    round2(b.billing),
      thirdParty: round2(b.thirdParty),
      netRevenue: round2(b.netRevenue),
      months: Object.entries(b.months).map(([month, m]) => ({
        month,
        billing:    round2(m.billing),
        thirdParty: round2(m.thirdParty),
        netRevenue: round2(m.netRevenue),
        currency:   m.currency,
      })).sort((a, z) => a.month.localeCompare(z.month)),
    }))

    // Sort: billing desc so biggest partners surface first
    flatList.sort((a, b) => b.billing - a.billing)

    // 6) Overall totals — NOT converted across currencies. UI should show
    //    per-currency sub-totals when multiple currencies are present (rare
    //    today — almost everything is AED — but Nexa UK rows can be GBP).
    const totals = {
      billing:    round2(flatList.reduce((s, r) => s + r.billing,    0)),
      thirdParty: round2(flatList.reduce((s, r) => s + r.thirdParty, 0)),
      netRevenue: round2(flatList.reduce((s, r) => s + r.netRevenue, 0)),
      clientCount: flatList.length,
      unmappedCount: flatList.filter(r => !r.clientId).length,
    }

    // Per-currency totals so the UI can render "AED 1.2M · GBP 45k" style
    const totalsByCurrency: Record<string, { billing: number; thirdParty: number; netRevenue: number; count: number }> = {}
    for (const r of flatList) {
      const c = r.currency || 'AED'
      if (!totalsByCurrency[c]) totalsByCurrency[c] = { billing: 0, thirdParty: 0, netRevenue: 0, count: 0 }
      totalsByCurrency[c].billing    += r.billing
      totalsByCurrency[c].thirdParty += r.thirdParty
      totalsByCurrency[c].netRevenue += r.netRevenue
      totalsByCurrency[c].count      += 1
    }
    for (const c of Object.keys(totalsByCurrency)) {
      totalsByCurrency[c].billing    = round2(totalsByCurrency[c].billing)
      totalsByCurrency[c].thirdParty = round2(totalsByCurrency[c].thirdParty)
      totalsByCurrency[c].netRevenue = round2(totalsByCurrency[c].netRevenue)
    }

    return reply.status(200).send({
      data: flatList,
      totals,
      totalsByCurrency,
      range: { from: startDate, to: endDate },
    })
  })
  // ── GET /reports/client-profitability ─────────────────────────────────────
  // Revenue (from client_invoices monthly sums) - Cost of effort (hours × internal
  // hourly cost per user) = Profit per client per month.
  //
  // Per Apr 15 meeting: cost uses the INTERNAL rate (users.internal_hourly_cost —
  // constant per person regardless of client), NOT the partner rate card (which
  // is for billing partner agencies, not measuring internal cost of effort).
  //
  // Report is MONTHLY only — client_invoices are stored as monthly sums, so
  // revenue can't be compared against a sub-month or cross-month date range.
  app.get('/client-profitability', async (req: any, reply: any) => {
    const user = req.user
    if (!isAdminRole(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { client_id: filterClientId, month: filterMonth, from, to } = req.query as any

    // Range resolution:
    //   If explicit `month` provided (YYYY-MM), use just that month.
    //   Else if `from`/`to` provided, snap them to full-month boundaries
    //     (start → first of month, end → last of month).
    //   Else default to current year-to-date (all complete months so far).
    let startDate: string
    let endDate: string
    const today = new Date()
    if (filterMonth && /^\d{4}-\d{2}$/.test(filterMonth)) {
      startDate = `${filterMonth}-01`
      // Last day of that month
      const [y, m] = filterMonth.split('-').map(Number)
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
      endDate = `${filterMonth}-${String(lastDay).padStart(2, '0')}`
    } else {
      startDate = from || `${today.getFullYear()}-01-01`
      endDate = to || today.toISOString().slice(0, 10)
      // Snap to month boundaries
      startDate = startDate.slice(0, 8) + '01'
      const endY = Number(endDate.slice(0, 4))
      const endM = Number(endDate.slice(5, 7))
      const lastDay = new Date(Date.UTC(endY, endM, 0)).getUTCDate()
      endDate = `${endDate.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
    }

    // 1) Load invoices (revenue) in date range.
    //
    // Per the Apr 17 call with Murtaza, each client-month needs all three of:
    //   - Total Billing     = sales_amount + third_party   (what the client was billed)
    //   - Third Party Cost  = third_party                  (passed-through supplier cost)
    //   - Net Revenue       = sales_amount                 (already net of third party — finance sheet column L)
    // These are surfaced in the report so nobody has to reconcile "billing vs revenue"
    // manually — the breakdown makes the math visible.
    let invoiceQuery = supabase
      .from('client_invoices')
      .select('client_id, client_name_raw, month, sales_amount, third_party, currency')
      .eq('workspace_id', user.workspaceId)
      .gte('month', startDate)
      .lte('month', endDate)

    if (filterClientId) invoiceQuery = invoiceQuery.eq('client_id', filterClientId)
    const { data: invoices } = await invoiceQuery

    // 2) Load all clients for display
    let clientsQuery = supabase
      .from('clients')
      .select('id, name')
      .eq('workspace_id', user.workspaceId)
      .is('deleted_at', null)

    if (filterClientId) clientsQuery = clientsQuery.eq('id', filterClientId)
    const { data: clientsData } = await clientsQuery
    const clientNameById: Record<string, string> = {}
    for (const c of clientsData || []) clientNameById[(c as any).id] = (c as any).name

    // 3) Load projects for these clients to compute cost
    let projectsQuery = supabase
      .from('projects')
      .select('id, client_id, name, currency')
      .eq('workspace_id', user.workspaceId)
      .is('deleted_at', null)
      .range(0, 9999)
    if (filterClientId) projectsQuery = projectsQuery.eq('client_id', filterClientId)
    const { data: projectsData } = await projectsQuery

    const projectIds: string[] = []
    for (const p of projectsData || []) {
      const cid = (p as any).client_id
      if (!cid) continue
      projectIds.push((p as any).id)
    }

    // 4) Load ALL users' internal costs in one shot (these are per-person,
    //    constant, and don't depend on client/project).
    const { data: usersData } = await supabase
      .from('users')
      .select('id, internal_hourly_cost')
      .eq('workspace_id', user.workspaceId)

    const internalCostByUser: Record<string, number> = {}
    for (const u of usersData || []) {
      internalCostByUser[(u as any).id] = Number((u as any).internal_hourly_cost) || 0
    }

    // 5) Load time entries for those projects
    const { data: entries } = projectIds.length ? await supabase
      .from('time_entries')
      .select(`date, hours, billable, user_id, task_id,
        tasks(id, phases(project_id))`)
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('type', 'project')
    : { data: [] }

    // 6) Build cost map: { clientId → { YYYY-MM → bucket } }
    const projectToClient: Record<string, string> = {}
    for (const p of projectsData || []) projectToClient[(p as any).id] = (p as any).client_id

    type MonthBucket = {
      billing:    number  // L + M (total client billing)
      thirdParty: number  // M
      revenue:    number  // L (net revenue)
      cost:       number
      hours:      number
      currency:   string
    }
    const buckets: Record<string, Record<string, MonthBucket>> = {} // clientId → monthKey → bucket

    function ensureBucket(clientId: string, monthKey: string, currency: string): MonthBucket {
      if (!buckets[clientId]) buckets[clientId] = {}
      if (!buckets[clientId][monthKey]) {
        buckets[clientId][monthKey] = { billing: 0, thirdParty: 0, revenue: 0, cost: 0, hours: 0, currency }
      }
      return buckets[clientId][monthKey]
    }

    // Apply cost — using INTERNAL hourly cost (constant per user)
    for (const e of entries || []) {
      const pid = (e as any).tasks?.phases?.project_id
      if (!pid) continue
      const clientId = projectToClient[pid]
      if (!clientId) continue
      const userId = (e as any).user_id
      const rate = internalCostByUser[userId] || 0
      const hours = Number((e as any).hours)
      const cost = hours * rate
      const monthKey = String((e as any).date).slice(0, 7) + '-01' // YYYY-MM-01

      // Currency follows the project (workspace default if unset); we don't
      // convert — invoices and cost should be in the same workspace currency.
      const project = (projectsData || []).find((p: any) => p.id === pid)
      const currency = (project as any)?.currency || 'AED'

      const bucket = ensureBucket(clientId, monthKey, currency)
      bucket.cost += cost
      bucket.hours += hours
    }

    // Apply revenue + third-party + billing
    for (const inv of invoices || []) {
      const clientId = (inv as any).client_id
      if (!clientId) continue // skip unmatched invoices (they'll show in admin for mapping)
      const monthKey = String((inv as any).month).slice(0, 10) // expect YYYY-MM-DD
      const currency = (inv as any).currency || 'AED'
      const bucket = ensureBucket(clientId, monthKey, currency)
      const sales      = Number((inv as any).sales_amount) || 0
      const thirdParty = Number((inv as any).third_party)  || 0
      bucket.revenue    += sales
      bucket.thirdParty += thirdParty
      bucket.billing    += sales + thirdParty
      // If we didn't set currency from cost, use invoice currency
      if (!bucket.currency) bucket.currency = currency
    }

    // 7) Flatten to per-client rolled-up + per-month breakdown
    const round2 = (n: number) => Math.round(n * 100) / 100
    const result: any[] = []
    for (const [clientId, months] of Object.entries(buckets)) {
      const clientName = clientNameById[clientId] || '(Unknown)'
      let totalBilling = 0, totalThirdParty = 0, totalRevenue = 0, totalCost = 0, totalHours = 0
      const monthBreakdown: any[] = []
      let primaryCurrency = 'AED'
      for (const [monthKey, b] of Object.entries(months)) {
        totalBilling    += b.billing
        totalThirdParty += b.thirdParty
        totalRevenue    += b.revenue
        totalCost       += b.cost
        totalHours      += b.hours
        primaryCurrency = b.currency || primaryCurrency
        const profit = b.revenue - b.cost
        monthBreakdown.push({
          month:      monthKey,
          billing:    round2(b.billing),
          thirdParty: round2(b.thirdParty),
          revenue:    round2(b.revenue),
          cost:       round2(b.cost),
          profit:     round2(profit),
          hours:      round2(b.hours),
          margin:     b.revenue > 0 ? Math.round((profit / b.revenue) * 100) : null,
          currency:   b.currency,
        })
      }
      monthBreakdown.sort((a, b) => a.month.localeCompare(b.month))
      const totalProfit = totalRevenue - totalCost
      result.push({
        clientId,
        clientName,
        billing:    round2(totalBilling),
        thirdParty: round2(totalThirdParty),
        revenue:    round2(totalRevenue),
        cost:       round2(totalCost),
        profit:     round2(totalProfit),
        hours:      round2(totalHours),
        margin:     totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : null,
        currency:   primaryCurrency,
        months:     monthBreakdown,
      })
    }

    result.sort((a, b) => b.revenue - a.revenue)

    // Overall totals
    const totals = {
      billing:    round2(result.reduce((s, r) => s + r.billing,    0)),
      thirdParty: round2(result.reduce((s, r) => s + r.thirdParty, 0)),
      revenue:    round2(result.reduce((s, r) => s + r.revenue,    0)),
      cost:       round2(result.reduce((s, r) => s + r.cost,       0)),
      profit:     round2(result.reduce((s, r) => s + r.profit,     0)),
      hours:      round2(result.reduce((s, r) => s + r.hours,      0)),
    }

    return reply.status(200).send({
      data: result,
      totals,
      range: { from: startDate, to: endDate },
    })
  })

  // ── GET /reports/cost-of-effort ──────────────────────────────────────────
  // Per Apr 15 meeting — Murtaza's #1 asked report. Shows hours × internal
  // hourly cost (constant per user regardless of client) for a given client +
  // date range. Accepts any date range (NOT monthly-only, unlike Client
  // Profitability). Splits by person, by department, by project.
  //
  // If no client_id is provided, aggregates across all clients with a
  // "byClient" breakdown at the top.
  app.get('/cost-of-effort', async (req: any, reply: any) => {
    const user = req.user
    if (!isAdminRole(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { client_id: filterClientId, from, to } = req.query as any
    const today = new Date()
    const startDate = from || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    const endDate = to || today.toISOString().slice(0, 10)

    // 1) Load projects (scoped to client if filter provided)
    let projectsQuery = supabase
      .from('projects')
      .select('id, name, client_id, clients(id, name)')
      .eq('workspace_id', user.workspaceId)
      .is('deleted_at', null)
      .range(0, 9999)
    if (filterClientId) projectsQuery = projectsQuery.eq('client_id', filterClientId)
    const { data: projectsData } = await projectsQuery

    const projectIds = (projectsData || []).map((p: any) => p.id)
    if (!projectIds.length) {
      return reply.status(200).send({
        summary: { totalHours: 0, totalCost: 0, peopleCount: 0, departmentsCount: 0 },
        byPerson: [], byDepartment: [], byProject: [], byClient: [], details: [],
        range: { from: startDate, to: endDate },
        filterClientId: filterClientId || null,
      })
    }

    // 2) Load users with internal_hourly_cost + department info
    const { data: usersData } = await supabase
      .from('users')
      .select('id, name, job_title, internal_hourly_cost, department_id, departments(id, name)')
      .eq('workspace_id', user.workspaceId)

    type UserInfo = { id: string; name: string; jobTitle: string; rate: number; deptId: string; deptName: string }
    const userById: Record<string, UserInfo> = {}
    for (const u of usersData || []) {
      const uu = u as any
      userById[uu.id] = {
        id: uu.id,
        name: uu.name || '(unknown)',
        jobTitle: uu.job_title || '',
        rate: Number(uu.internal_hourly_cost) || 0,
        deptId: uu.department_id || 'unassigned',
        deptName: uu.departments?.name || 'Unassigned',
      }
    }

    // 3) Load time entries for these projects in date range
    const { data: entries } = await supabase
      .from('time_entries')
      .select(`id, user_id, date, hours, note,
        tasks(id, title, phases(id, name, project_id))`)
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('type', 'project')

    const clientEntries = (entries || []).filter((e: any) => {
      const pid = e.tasks?.phases?.project_id
      return pid && projectIds.includes(pid)
    })

    // Build project → client lookup
    const projectMap: Record<string, any> = {}
    for (const p of projectsData || []) projectMap[(p as any).id] = p

    // 4) Aggregate
    type Bucket = { hours: number; cost: number }
    const byPerson: Record<string, Bucket & { name: string; jobTitle: string; deptName: string }> = {}
    const byDepartment: Record<string, Bucket & { name: string; headcount: Set<string> }> = {}
    const byProject: Record<string, Bucket & { name: string; clientName: string }> = {}
    const byClient: Record<string, Bucket & { name: string }> = {}
    const details: any[] = []

    let totalHours = 0
    let totalCost = 0

    for (const e of clientEntries) {
      const ev = e as any
      const pid = ev.tasks?.phases?.project_id
      const project = projectMap[pid]
      const clientId = project?.client_id || 'no-client'
      const clientName = project?.clients?.name || 'No Client'
      const userInfo = userById[ev.user_id]
      const hours = Number(ev.hours) || 0
      const rate = userInfo?.rate || 0
      const cost = hours * rate

      totalHours += hours
      totalCost += cost

      // By person
      const pKey = ev.user_id
      if (!byPerson[pKey]) {
        byPerson[pKey] = {
          hours: 0, cost: 0,
          name: userInfo?.name || '(unknown)',
          jobTitle: userInfo?.jobTitle || '',
          deptName: userInfo?.deptName || 'Unassigned',
        }
      }
      byPerson[pKey].hours += hours
      byPerson[pKey].cost += cost

      // By department
      const dKey = userInfo?.deptId || 'unassigned'
      if (!byDepartment[dKey]) {
        byDepartment[dKey] = {
          hours: 0, cost: 0,
          name: userInfo?.deptName || 'Unassigned',
          headcount: new Set(),
        }
      }
      byDepartment[dKey].hours += hours
      byDepartment[dKey].cost += cost
      byDepartment[dKey].headcount.add(pKey)

      // By project
      if (!byProject[pid]) {
        byProject[pid] = {
          hours: 0, cost: 0,
          name: project?.name || '(unknown)',
          clientName,
        }
      }
      byProject[pid].hours += hours
      byProject[pid].cost += cost

      // By client (only useful when not filtered)
      if (!byClient[clientId]) {
        byClient[clientId] = { hours: 0, cost: 0, name: clientName }
      }
      byClient[clientId].hours += hours
      byClient[clientId].cost += cost

      // Detail row
      details.push({
        id: ev.id,
        date: ev.date,
        projectId: pid,
        projectName: project?.name || '',
        clientName,
        taskName: ev.tasks?.title || '',
        phaseName: ev.tasks?.phases?.name || '',
        personName: userInfo?.name || '',
        jobTitle: userInfo?.jobTitle || '',
        department: userInfo?.deptName || '',
        hours,
        rate,
        cost: Math.round(cost * 100) / 100,
        note: ev.note || '',
      })
    }

    function round2(n: number) { return Math.round(n * 100) / 100 }

    return reply.status(200).send({
      summary: {
        totalHours: round2(totalHours),
        totalCost:  round2(totalCost),
        peopleCount: Object.keys(byPerson).length,
        departmentsCount: Object.keys(byDepartment).length,
      },
      byPerson: Object.entries(byPerson).map(([id, v]) => ({
        userId: id, name: v.name, jobTitle: v.jobTitle, department: v.deptName,
        hours: round2(v.hours), cost: round2(v.cost),
      })).sort((a, b) => b.cost - a.cost),
      byDepartment: Object.entries(byDepartment).map(([id, v]) => ({
        id, name: v.name,
        headcount: v.headcount.size,
        hours: round2(v.hours), cost: round2(v.cost),
      })).sort((a, b) => b.cost - a.cost),
      byProject: Object.entries(byProject).map(([id, v]) => ({
        id, name: v.name, clientName: v.clientName,
        hours: round2(v.hours), cost: round2(v.cost),
      })).sort((a, b) => b.cost - a.cost),
      byClient: Object.entries(byClient).map(([id, v]) => ({
        id, name: v.name,
        hours: round2(v.hours), cost: round2(v.cost),
      })).sort((a, b) => b.cost - a.cost),
      details,
      range: { from: startDate, to: endDate },
      filterClientId: filterClientId || null,
      // Software overhead — cost of SaaS subscriptions per department for the
      // date range. Sourced from the Finance Sheet Software_Costs tab.
      // Aggregated independently of the client filter because software costs
      // are workspace-level overhead, not per-client (no allocation rules
      // from Murtaza yet — shown alongside cost of effort, not merged into it).
      softwareOverhead: await (async () => {
        const { data: swRows } = await supabase
          .from('software_costs')
          .select('software_name, department_raw, department_id, month, amount')
          .eq('workspace_id', user.workspaceId)
          .gte('month', startDate)
          .lte('month', endDate)
        const byDept: Record<string, { name: string; amount: number; softwareCount: Set<string> }> = {}
        let total = 0
        for (const r of swRows || []) {
          const rec = r as any
          const key  = rec.department_raw || 'Unassigned'
          const amt  = Number(rec.amount) || 0
          total += amt
          if (!byDept[key]) byDept[key] = { name: key, amount: 0, softwareCount: new Set() }
          byDept[key].amount += amt
          byDept[key].softwareCount.add(String(rec.software_name || ''))
        }
        return {
          total: round2(total),
          byDepartment: Object.entries(byDept).map(([_, v]) => ({
            name: v.name,
            amount: round2(v.amount),
            softwareCount: v.softwareCount.size,
          })).sort((a, b) => b.amount - a.amount),
        }
      })(),
    })
  })

  // ── POST /reports/export-google-sheet ────────────────────────────────────
  // Create a real Google Sheet in the service account's Drive, populate with
  // report data, and share it with the requesting user. Returns the URL so
  // the frontend can open it in a new tab.
  //
  // Apr 15 meeting: Murtaza said many people don't have Excel, so Google
  // Sheets is the preferred export format — with the resulting sheet saved
  // somewhere they can open it.
  app.post('/export-google-sheet', async (req: any, reply: any) => {
    const caller = req.user
    if (!isAdminRole(caller.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    if (!isGoogleSheetsConfigured()) {
      return reply.status(400).send({ errors: [{
        code: 'NOT_CONFIGURED',
        message: 'GOOGLE_SHEETS_SERVICE_ACCOUNT_B64 not set in .env.local',
      }] })
    }

    const body = (req.body as any) || {}
    const title: string = String(body.title || 'NextTrack Export').slice(0, 200)
    const sheets: Array<{ name: string; headers: string[]; rows: any[][] }> =
      Array.isArray(body.sheets) ? body.sheets : []

    if (!sheets.length) {
      return reply.status(400).send({ errors: [{ code: 'NO_SHEETS', message: 'sheets[] required' }] })
    }

    // Look up caller email so we can share the sheet with them
    const { data: userRow } = await supabase
      .from('users')
      .select('email')
      .eq('id', caller.id)
      .maybeSingle()
    const shareWith = (userRow as any)?.email || null

    try {
      const result = await createSpreadsheet({ title, sheets, shareWith })
      return reply.status(200).send({
        ok: true,
        spreadsheetId: result.spreadsheetId,
        url:           result.url,
        sharedWith:    shareWith,
      })
    } catch (e: any) {
      const msg = e?.message || 'Export failed'
      // Friendlier messages for the most common config issues
      let userMessage = msg
      if (/shared drive not found|file not found/i.test(msg)) {
        userMessage = 'Service account is not a member of the configured Shared Drive. Add nexttrack-sheets-reader@nexttrack-493307.iam.gserviceaccount.com as Content Manager on the exports Shared Drive.'
      } else if (/not been used in project|has not been enabled|API has not been used/i.test(msg)) {
        userMessage = 'Google Drive API is not enabled. Go to https://console.cloud.google.com/apis/library/drive.googleapis.com?project=nexttrack-493307 and click Enable, then wait ~30 seconds.'
      } else if (/storage quota|quota.*exceeded/i.test(msg)) {
        userMessage = 'Drive storage quota exceeded. Either clean up old exports or point GOOGLE_EXPORTS_FOLDER_ID at a Shared Drive (files in shared drives don\u2019t consume the service account\u2019s personal quota).'
      } else if (!process.env.GOOGLE_EXPORTS_FOLDER_ID && /caller does not have permission|insufficient permissions|forbidden/i.test(msg)) {
        // Service accounts can't create files in their own Drive — need a Shared Drive folder
        userMessage = 'GOOGLE_EXPORTS_FOLDER_ID not set in .env.local. Set it to the ID of a Shared Drive where the service account is a Content Manager. (Service accounts can\u2019t create files in their own Drive — they need a Shared Drive to write into.)'
      } else if (/caller does not have permission|insufficient permissions|forbidden/i.test(msg)) {
        // Folder is set but we still got 403 — likely service account lost access or drive is restricted
        userMessage = 'Permission denied by Google. Check that the service account is still a Content Manager on the Shared Drive (ID: ' + process.env.GOOGLE_EXPORTS_FOLDER_ID + ').'
      }
      console.warn('[export-google-sheet] error:', msg)
      return reply.status(500).send({ errors: [{ message: userMessage, raw: msg }] })
    }
  })

  // ── Saved Report Configs CRUD ─────────────────────────────────────────────

  // Saved report configs are per-user — each user sees only their own
  // favorites (Apr 17 intent: "AMs save their own views as templates").
  // We still scope every query by workspace_id too so a cross-workspace
  // id leak can't be coerced into an unauthorized read/write.

  // GET /reports/configs
  app.get('/configs', async (req: any, reply: any) => {
    const user = req.user
    const { data, error } = await supabase
      .from('saved_report_configs')
      .select('*')
      .eq('workspace_id', user.workspaceId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data: data || [] })
  })

  // POST /reports/configs
  app.post('/configs', async (req: any, reply: any) => {
    const user = req.user
    const { name, report_type, config } = req.body as any
    if (!name || !report_type) return reply.status(400).send({ errors: [{ code: 'MISSING_FIELDS' }] })

    const { data, error } = await supabase
      .from('saved_report_configs')
      .insert({ workspace_id: user.workspaceId, user_id: user.id, name, report_type, config: config || {} })
      .select()
      .single()

    if (error) {
      // Unique (user_id, name) collision → clearer error than a raw 500
      if ((error as any).code === '23505') {
        return reply.status(409).send({ errors: [{ code: 'DUPLICATE_NAME', message: 'A saved report with that name already exists.' }] })
      }
      return reply.status(500).send({ errors: [{ message: error.message }] })
    }
    return reply.status(201).send({ data })
  })

  // PATCH /reports/configs/:id
  app.patch('/configs/:id', async (req: any, reply: any) => {
    const user = req.user
    const { id } = req.params as any
    const body = req.body as any

    const update: any = {}
    if (body.name !== undefined) update.name = body.name
    if (body.config !== undefined) update.config = body.config
    update.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('saved_report_configs')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  // DELETE /reports/configs/:id
  app.delete('/configs/:id', async (req: any, reply: any) => {
    const user = req.user
    const { id } = req.params as any

    const { error } = await supabase
      .from('saved_report_configs')
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .eq('user_id', user.id)

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ success: true })
  })

  // POST /reports/configs/:id/duplicate
  app.post('/configs/:id/duplicate', async (req: any, reply: any) => {
    const user = req.user
    const { id } = req.params as any

    const { data: original } = await supabase
      .from('saved_report_configs')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .eq('user_id', user.id)
      .single()

    if (!original) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })

    const { data, error } = await supabase
      .from('saved_report_configs')
      .insert({
        workspace_id: user.workspaceId,
        user_id: user.id,
        name: original.name + ' (copy)',
        report_type: original.report_type,
        config: original.config,
      })
      .select()
      .single()

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })
}