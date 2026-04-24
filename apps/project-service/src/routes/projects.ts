import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '@forecast/db'
import { assertProjectInWorkspace } from '../lib/scope.js'
import { applyTemplateToProject } from './templates.js'

const projectSchema = z.object({
  name:            z.string().min(1),
  description:     z.string().optional(),
  client_id:       z.string().uuid(),
  rate_card_id:    z.string().uuid().optional(),
  status:          z.enum(['opportunity','planning','running','halted','done']).default('running'),
  color:           z.string().default('#0D9488'),
  budget_type:     z.enum(['fixed_price','time_and_materials','retainer','fixed_hours']).default('fixed_price'),
  budget_amount:   z.number().optional(),
  budget_hrs:      z.number().optional(),
  currency:        z.string().default('AED'),
  retainer_period: z.enum(['monthly','weekly','daily']).optional(),
  retainer_count:  z.number().int().optional(),
  start_date:      z.string().optional(),
  end_date:        z.string().optional(),
  label_ids:       z.array(z.string().uuid()).optional(),
  alert_at_80:     z.boolean().optional(),
  alert_at_90:     z.boolean().optional(),
  billable:        z.boolean().default(true),
  template_id:     z.string().uuid().optional(),
  // Apr 23 — Murtaza: "template" = a planning-stage project. When set, the
  // server clones that project's phases + tasks into the new project. This is
  // the preferred path; the old `template_id` (pointing at project_templates)
  // is kept for backwards compat but the project_templates table is empty.
  source_project_id: z.string().uuid().optional(),
})

// ── Helper: clone phases + tasks from one project into another ──────────────
// Used by the "create from template" flow (Apr 23 — Murtaza). Caller is expected
// to have already verified both projects belong to the same workspace.
// Returns a shape compatible with applyTemplateToProject() so the caller can
// treat both sources identically.
async function cloneFromProject(
  sourceProjectId: string,
  targetProjectId: string,
): Promise<{ ok: true; phases: number; tasks: number } | { ok: false; error: string; phases: number; tasks: number }> {
  const { data: srcPhases, error: pErr } = await supabase
    .from('phases')
    .select('*')
    .eq('project_id', sourceProjectId)
    .order('sort_order')
  if (pErr) return { ok: false, error: pErr.message, phases: 0, tasks: 0 }
  if (!srcPhases?.length) return { ok: true, phases: 0, tasks: 0 }

  let createdPhases = 0
  let createdTasks  = 0
  for (const sp of srcPhases) {
    const { data: newPhase, error: npErr } = await supabase
      .from('phases')
      .insert({
        project_id:  targetProjectId,
        name:        sp.name,
        description: sp.description,
        sort_order:  sp.sort_order,
        // Deliberately do NOT copy start_date/end_date from the template —
        // dates belong to the new project's timeline, not the template's.
      })
      .select('*').single()
    if (npErr || !newPhase) {
      return { ok: false, error: npErr?.message || 'phase insert failed', phases: createdPhases, tasks: createdTasks }
    }
    createdPhases++

    const { data: srcTasks, error: tlErr } = await supabase
      .from('tasks')
      .select('title, description, estimated_hrs, billable, sort_order')
      .eq('phase_id', sp.id)
      .order('sort_order')
    if (tlErr) return { ok: false, error: tlErr.message, phases: createdPhases, tasks: createdTasks }
    if (!srcTasks?.length) continue

    const rows = srcTasks.map((t: any) => ({
      phase_id:      newPhase.id,
      title:         t.title,
      description:   t.description,
      estimated_hrs: t.estimated_hrs,
      billable:      t.billable,
      status:        'todo',              // never clone status — every new task starts fresh
      sort_order:    t.sort_order,
    }))
    const { error: tiErr } = await supabase.from('tasks').insert(rows)
    if (tiErr) return { ok: false, error: tiErr.message, phases: createdPhases, tasks: createdTasks }
    createdTasks += rows.length
  }
  return { ok: true, phases: createdPhases, tasks: createdTasks }
}

// ── Helper: fetch project members + user details + department name ─────────
async function fetchProjectMembers(projectId: string) {
  const [
    { data: members },
    { data: depts },
  ] = await Promise.all([
    supabase.from('project_members')
      .select('id, project_id, user_id, added_by, added_at')
      .eq('project_id', projectId)
      .order('added_at'),
    supabase.from('departments').select('id, name'),
  ])

  if (!members?.length) return []

  const userIds = [...new Set(members.map((m: any) => m.user_id))]
  const { data: users } = await supabase
    .from('users')
    .select('id, name, job_title, avatar_url, department_id, permission_profile')
    .in('id', userIds)

  const userMap: Record<string, any> = {}
  for (const u of users || []) userMap[u.id] = u

  const deptMap: Record<string, string> = {}
  for (const d of depts || []) deptMap[d.id] = d.name

  return members.map((m: any) => {
    const u = userMap[m.user_id]
    return {
      ...m,
      users: u ? {
        ...u,
        departments: u.department_id
          ? { id: u.department_id, name: deptMap[u.department_id] || 'Unknown' }
          : null,
      } : null,
    }
  })
}

export async function projectRoutes(app: FastifyInstance) {

  // ── GET /projects/templates ───────────────────────────────────────────────
  // Apr 23 — Murtaza: planning-stage projects ARE the templates. This endpoint
  // feeds the "Template" dropdown on project create. Returns the minimum fields
  // the picker needs + phase_count / task_count so users can gauge template size.
  //
  // Declared before the generic `/:id` handler below so it doesn't get mistaken
  // for a project UUID.
  app.get('/templates', async (req, reply) => {
    const user = (req as any).user
    const { data: projects, error } = await supabase
      .from('projects')
      .select('id, name, color')
      .eq('workspace_id', user.workspaceId)
      .eq('status', 'planning')
      .is('deleted_at', null)
      .order('name')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    const ids = (projects || []).map((p: any) => p.id)
    if (!ids.length) return reply.status(200).send({ data: [] })

    // One-shot counts rather than N+1 queries.
    const { data: phases } = await supabase
      .from('phases')
      .select('id, project_id')
      .in('project_id', ids)
    const phaseByProject: Record<string, number> = {}
    const phaseToProject: Record<string, string> = {}
    for (const p of phases || []) {
      phaseByProject[(p as any).project_id] = (phaseByProject[(p as any).project_id] || 0) + 1
      phaseToProject[(p as any).id] = (p as any).project_id
    }
    const phaseIds = Object.keys(phaseToProject)
    const taskByProject: Record<string, number> = {}
    if (phaseIds.length) {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('phase_id')
        .in('phase_id', phaseIds)
      for (const t of tasks || []) {
        const pid = phaseToProject[(t as any).phase_id]
        if (pid) taskByProject[pid] = (taskByProject[pid] || 0) + 1
      }
    }
    const out = (projects || []).map((p: any) => ({
      ...p,
      phase_count: phaseByProject[p.id] || 0,
      task_count:  taskByProject[p.id]  || 0,
    }))
    return reply.status(200).send({ data: out })
  })

  // ── GET /projects ─────────────────────────────────────────────────────────
  // ALL users see ALL projects by default (Murtaza requirement).
  // Timesheets only show tasks assigned to you — that keeps things clean.
  app.get('/', async (req, reply) => {
    const user = (req as any).user
    const wid  = user.workspaceId
    const { status, search } = req.query as any

    // Supabase PostgREST caps responses at db-max-rows (1000 on Supabase cloud).
    // We have 1,187+ projects, so paginate manually to get everything.
    const PAGE = 1000
    const all: any[] = []
    let memberOf: string[] | null = null
    if (user.profile === 'collaborator') {
      // A collaborator "belongs" to a project two ways:
      //   1. They're in project_members (explicit project-level add).
      //   2. They're assigned to any task inside the project (task_assignees).
      // Task assignment alone doesn't create a project_members row, so
      // checking only (1) hid projects from collaborators who were given
      // work at the task level. Union both sets.
      const [{ data: m }, { data: ta }] = await Promise.all([
        supabase.from('project_members').select('project_id').eq('user_id', user.id),
        supabase.from('task_assignees')
          .select('tasks!inner(phases!inner(project_id))')
          .eq('user_id', user.id),
      ])
      const fromMembership = (m || []).map((r: any) => r.project_id)
      const fromTasks      = (ta || []).map((r: any) => r.tasks?.phases?.project_id).filter(Boolean)
      memberOf = [...new Set([...fromMembership, ...fromTasks])]
      if (memberOf.length === 0) return reply.status(200).send({ data: [] })
    }

    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from('projects')
        .select('*, clients(id, name, logo_url), rate_cards(id, name, currency)')
        .eq('workspace_id', wid)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1)
      if (status) q = q.eq('status', status)
      if (search) q = q.ilike('name', `%${search}%`)
      if (memberOf) q = q.in('id', memberOf)

      const { data, error } = await q
      if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
      const page = data || []
      all.push(...page)
      if (page.length < PAGE) break
    }
    const projects = all

    const projectIds = (projects || []).map((p: any) => p.id)
    if (!projectIds.length) return reply.status(200).send({ data: [] })

    const rateCardIds = [...new Set((projects || []).map((p: any) => p.rate_card_id).filter(Boolean))] as string[]
    const { data: rcEntries } = rateCardIds.length
      ? await supabase.from('rate_card_entries').select('rate_card_id, job_title, department_id, hourly_rate').in('rate_card_id', rateCardIds)
      : { data: [] }

    // Apr 17: rate resolves by department; job_title is the legacy fallback.
    const ratesByCard: Record<string, { byDept: Record<string, number>; byTitle: Record<string, number> }> = {}
    for (const e of rcEntries || []) {
      if (!ratesByCard[e.rate_card_id]) ratesByCard[e.rate_card_id] = { byDept: {}, byTitle: {} }
      if (e.department_id)  ratesByCard[e.rate_card_id].byDept[e.department_id] = Number(e.hourly_rate)
      else if (e.job_title) ratesByCard[e.rate_card_id].byTitle[e.job_title]    = Number(e.hourly_rate)
    }

    const { data: wsUsers } = await supabase.from('users').select('id, job_title, department_id').eq('workspace_id', wid)
    const userJobTitle: Record<string, string> = {}
    const userDeptId:   Record<string, string> = {}
    for (const u of wsUsers || []) {
      userJobTitle[u.id] = u.job_title    || ''
      userDeptId[u.id]   = u.department_id || ''
    }

    const [{ data: tasks }, { data: timeEntries }] = await Promise.all([
      supabase.from('tasks').select('id, status, estimated_hrs, phase_id, phases!inner(project_id)').in('phases.project_id', projectIds),
      supabase.from('time_entries').select('hours, billable, user_id, tasks!inner(phase_id, phases!inner(project_id))').in('tasks.phases.project_id', projectIds),
    ])

    const stats: Record<string, any> = {}
    for (const pid of projectIds) stats[pid] = { estimatedHrs:0, loggedHrs:0, billableHrs:0, costAED:0, taskCount:0, doneCount:0 }

    for (const t of tasks || []) {
      const pid = (t as any).phases?.project_id
      if (!pid || !stats[pid]) continue
      stats[pid].taskCount++
      if ((t as any).status === 'done') stats[pid].doneCount++
      if ((t as any).estimated_hrs) stats[pid].estimatedHrs += Number((t as any).estimated_hrs)
    }

    const projRC: Record<string, string> = {}
    for (const p of projects || []) if (p.rate_card_id) projRC[p.id] = p.rate_card_id

    for (const te of timeEntries || []) {
      const pid = (te as any).tasks?.phases?.project_id
      if (!pid || !stats[pid]) continue
      stats[pid].loggedHrs += Number((te as any).hours)
      if ((te as any).billable) {
        stats[pid].billableHrs += Number((te as any).hours)
        const rcId = projRC[pid]
        const idx  = rcId ? ratesByCard[rcId] : null
        if (idx) {
          const uid      = (te as any).user_id
          const deptId   = userDeptId[uid]   || ''
          const jobTitle = userJobTitle[uid] || ''
          const rate     = idx.byDept[deptId] || idx.byTitle[jobTitle] || 0
          stats[pid].costAED += Number((te as any).hours) * rate
        }
      }
    }
    for (const pid of projectIds) stats[pid].costAED = Math.round(stats[pid].costAED)

    return reply.status(200).send({ data: (projects || []).map((p: any) => ({ ...p, stats: stats[p.id] || { estimatedHrs:0, loggedHrs:0, billableHrs:0, costAED:0, taskCount:0, doneCount:0 } })) })
  })

  // ── GET /projects/:id ─────────────────────────────────────────────────────
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const wid    = (req as any).user.workspaceId

    const { data: project, error: pErr } = await supabase
      .from('projects')
      .select('*, clients(*), rate_cards(*, rate_card_entries(*))')
      .eq('id', id).eq('workspace_id', wid).is('deleted_at', null).single()

    if (pErr || !project) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })

    const [members, { data: phases }] = await Promise.all([
      fetchProjectMembers(id),
      supabase.from('phases').select('*').eq('project_id', id).order('sort_order'),
    ])

    const phaseIds = (phases || []).map((ph: any) => ph.id)
    let tasks: any[] = []
    if (phaseIds.length) {
      const { data: t } = await supabase.from('tasks').select('*').in('phase_id', phaseIds).order('sort_order')
      tasks = t || []

      const taskIds = tasks.map((t: any) => t.id)
      if (taskIds.length) {
        const [{ data: assignees }, { data: entries }] = await Promise.all([
          supabase.from('task_assignees').select('task_id, user_id, users(id, name, avatar_url, job_title, department_id)').in('task_id', taskIds),
          supabase.from('time_entries').select('*, users(id, name)').in('task_id', taskIds).order('date', { ascending: false }),
        ])
        const assigneesByTask: Record<string, any[]> = {}
        const entriesByTask: Record<string, any[]>   = {}
        for (const a of assignees || []) {
          if (!assigneesByTask[a.task_id]) assigneesByTask[a.task_id] = []
          assigneesByTask[a.task_id].push(a)
        }
        for (const e of entries || []) {
          if (!e.task_id) continue
          if (!entriesByTask[e.task_id]) entriesByTask[e.task_id] = []
          entriesByTask[e.task_id].push(e)
        }
        tasks = tasks.map((t: any) => ({
          ...t,
          task_assignees: assigneesByTask[t.id] || [],
          time_entries:   entriesByTask[t.id]   || [],
        }))
      }
    }

    const phasesWithTasks = (phases || []).map((ph: any) => ({
      ...ph, tasks: tasks.filter((t: any) => t.phase_id === ph.id),
    }))

    return reply.status(200).send({ data: { ...project, project_members: members, phases: phasesWithTasks } })
  })

  // ── POST /projects/:id/members ────────────────────────────────────────────
  app.post('/:id/members', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as { id: string }
    if (!await assertProjectInWorkspace(id, user.workspaceId, reply)) return

    const { user_ids } = req.body as { user_ids: string[] }
    if (!Array.isArray(user_ids) || !user_ids.length) return reply.status(400).send({ errors: [{ code: 'MISSING_USER_IDS' }] })

    // Only members in the same workspace may be added — prevents cross-workspace project leak
    const { data: validUsers } = await supabase
      .from('users').select('id').in('id', user_ids).eq('workspace_id', user.workspaceId)
    const validIds = (validUsers || []).map((u: any) => u.id)
    if (!validIds.length) return reply.status(400).send({ errors: [{ code: 'NO_VALID_USERS' }] })

    const inserts = validIds.map(uid => ({ project_id: id, user_id: uid, added_by: user.id }))
    const { error } = await supabase.from('project_members')
      .upsert(inserts, { onConflict: 'project_id,user_id', ignoreDuplicates: true })
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    const members = await fetchProjectMembers(id)
    return reply.status(200).send({ data: members })
  })

  // ── POST /projects/:id/members/department ─────────────────────────────────
  app.post('/:id/members/department', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as { id: string }
    if (!await assertProjectInWorkspace(id, user.workspaceId, reply)) return

    const { department_id } = req.body as { department_id: string }
    if (!department_id) return reply.status(400).send({ errors: [{ code: 'MISSING_DEPARTMENT_ID' }] })

    // Department must belong to caller's workspace
    const { data: dept } = await supabase
      .from('departments').select('id').eq('id', department_id).eq('workspace_id', user.workspaceId).maybeSingle()
    if (!dept) return reply.status(404).send({ errors: [{ code: 'DEPT_NOT_FOUND' }] })

    const { data: deptUsers, error: uErr } = await supabase
      .from('users').select('id')
      .eq('department_id', department_id)
      .eq('workspace_id', user.workspaceId)
      .eq('active', true).is('deleted_at', null)
    if (uErr) return reply.status(500).send({ errors: [{ message: uErr.message }] })
    if (!deptUsers?.length) return reply.status(200).send({ data: [], message: 'No active users in this department' })
    const inserts = deptUsers.map((u: any) => ({ project_id: id, user_id: u.id, added_by: user.id }))
    const { error } = await supabase.from('project_members')
      .upsert(inserts, { onConflict: 'project_id,user_id', ignoreDuplicates: true })
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    const members = await fetchProjectMembers(id)
    return reply.status(200).send({ data: members, added: deptUsers.length })
  })

  // ── DELETE /projects/:id/members/:userId ──────────────────────────────────
  app.delete('/:id/members/:userId', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id, userId } = req.params as { id: string; userId: string }
    if (!await assertProjectInWorkspace(id, user.workspaceId, reply)) return

    const { error } = await supabase.from('project_members').delete()
      .eq('project_id', id).eq('user_id', userId)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data: { message: 'Member removed' } })
  })

  // ── POST /projects ────────────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    // During Forecast.it migration, all projects must originate in Forecast —
    // otherwise they appear as orphans in NextTrack (no forecast_id), inflate
    // every count, and never sync back. The `FORECAST_SYNC_LOCKED` env var
    // (default: on while FORECAST_API_KEY is set) blocks native creation.
    const syncLocked = process.env.FORECAST_SYNC_LOCKED !== '0' && !!process.env.FORECAST_API_KEY
    if (syncLocked) {
      return reply.status(403).send({ errors: [{
        code: 'FORECAST_SYNC_LOCKED',
        message: 'Projects are managed in Forecast.it during migration. Create it there — it appears here within 5 minutes.',
      }] })
    }

    const body = projectSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })
    const { label_ids, template_id, source_project_id, ...rest } = body.data
    const { data: project, error } = await supabase.from('projects')
      .insert({ ...rest, workspace_id: user.workspaceId }).select('*, clients(*)').single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    // Bug fix: was using undefined `id`, must use `project.id`
    if (label_ids?.length && project) {
      await supabase.from('project_label_on_projects')
        .insert(label_ids.map((lid: string) => ({ project_id: project.id, label_id: lid })))
    }

    // Apr 15 meeting — auto-assign every active workspace user to the project team.
    // Users only see tasks on their timesheet if they're assigned to those specific
    // tasks, so this doesn't leak anything — it just removes the "I forgot to add
    // Ahmed to the team" friction when someone joins mid-project.
    if (project) {
      const { data: activeUsers } = await supabase
        .from('users')
        .select('id')
        .eq('workspace_id', user.workspaceId)
        .eq('active', true)
        .is('deleted_at', null)

      const memberRows = (activeUsers || []).map((u: any) => ({
        project_id: project.id,
        user_id: u.id,
        added_by: user.id,
      }))
      if (memberRows.length) {
        await supabase.from('project_members')
          .upsert(memberRows, { onConflict: 'project_id,user_id', ignoreDuplicates: true })
        // Non-fatal: if this fails we don't want to roll back the project create.
      }
    }

    // Apply template (copy phases + tasks into the new project) if requested.
    // Two paths (Apr 23 — Murtaza reconciliation):
    //   (a) source_project_id → clone from a planning-stage project (preferred).
    //   (b) template_id        → legacy project_templates row (table is empty but kept for compat).
    // source_project_id wins if both are provided.
    let templateWarning: string | undefined
    if (project && source_project_id) {
      const { data: src } = await supabase
        .from('projects')
        .select('id')
        .eq('id', source_project_id)
        .eq('workspace_id', user.workspaceId)
        .is('deleted_at', null)
        .maybeSingle()
      if (!src) {
        templateWarning = 'Template project not found in this workspace; project created empty.'
      } else if (source_project_id === project.id) {
        templateWarning = 'A project cannot be cloned from itself; project created empty.'
      } else {
        try {
          const res = await cloneFromProject(source_project_id, project.id)
          if (!res.ok) {
            req.log.error({ err: res.error, projectId: project.id, createdPhases: res.phases, createdTasks: res.tasks }, 'clone-from-project failed mid-stream')
            templateWarning = `Template partially applied (${res.phases} phase(s), ${res.tasks} task(s)) before error: ${res.error}`
          }
        } catch (e: any) {
          req.log.error({ err: e, projectId: project.id }, 'clone-from-project threw')
          templateWarning = 'Template application failed unexpectedly.'
        }
      }
    } else if (project && template_id) {
      const { data: tpl } = await supabase
        .from('project_templates')
        .select('id')
        .eq('id', template_id)
        .eq('workspace_id', user.workspaceId)
        .is('deleted_at', null)
        .maybeSingle()
      if (!tpl) {
        templateWarning = 'Template not found; project created without template.'
      } else {
        try {
          const res = await applyTemplateToProject(template_id, project.id)
          if (!res.ok) {
            req.log.error({ err: res.error, projectId: project.id, createdPhases: res.phases, createdTasks: res.tasks }, 'template apply failed mid-stream')
            templateWarning = `Template partially applied (${res.phases} phase(s), ${res.tasks} task(s)) before error: ${res.error}`
          }
        } catch (e: any) {
          req.log.error({ err: e, projectId: project.id }, 'template apply threw')
          templateWarning = 'Template application failed unexpectedly.'
        }
      }
    }

    return reply.status(201).send({ data: project, ...(templateWarning ? { warnings: [templateWarning] } : {}) })
  })

  // ── PATCH /projects/:id ───────────────────────────────────────────────────
  app.patch('/:id', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as { id: string }
    const body = projectSchema.partial().safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })
    const { label_ids, ...rest } = body.data
    // IDOR fix: workspace boundary
    const { data: project, error } = await supabase.from('projects')
      .update(rest).eq('id', id).eq('workspace_id', user.workspaceId).select('*, clients(*)').single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    if (!project) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    if (label_ids !== undefined) {
      await supabase.from('project_label_on_projects').delete().eq('project_id', id)
      if (label_ids.length) {
        await supabase.from('project_label_on_projects')
          .insert(label_ids.map((lid: string) => ({ project_id: id, label_id: lid })))
      }
    }
    return reply.status(200).send({ data: project })
  })

  // ── DELETE /projects/:id ──────────────────────────────────────────────────
  app.delete('/:id', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as { id: string }
    // IDOR fix: workspace boundary
    const { error, count } = await supabase.from('projects')
      .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', id).eq('workspace_id', user.workspaceId)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    if (count === 0) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return reply.status(200).send({ data: { message: 'Archived' } })
  })
}
