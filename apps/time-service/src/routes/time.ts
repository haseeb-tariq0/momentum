import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { supabase } from '@forecast/db'
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns'

const logTimeSchema = z.object({
  task_id:                   z.string().uuid().optional(),
  internal_time_category_id: z.string().uuid().optional(),
  time_off_category_id:      z.string().uuid().optional(),
  date:                      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  hours:                     z.number().min(0.25).max(24),
  billable:                  z.boolean().default(true),
  note:                      z.string().max(2000).optional(),
  type:                      z.enum(['project','internal','time_off']).default('project'),
  target_user_id:            z.string().uuid().optional(),
})

// ─── Workspace boundary helpers ──────────────────────────────────────────────
async function assertUserInWorkspace(userId: string, wid: string, reply: FastifyReply): Promise<boolean> {
  if (!userId || !wid) { reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] }); return false }
  const { data } = await supabase.from('users').select('id').eq('id', userId).eq('workspace_id', wid).maybeSingle()
  if (!data) { reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] }); return false }
  return true
}

async function assertProjectInWorkspace(projectId: string, wid: string, reply: FastifyReply): Promise<boolean> {
  if (!projectId || !wid) { reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] }); return false }
  const { data } = await supabase.from('projects').select('id')
    .eq('id', projectId).eq('workspace_id', wid).is('deleted_at', null).maybeSingle()
  if (!data) { reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] }); return false }
  return true
}

async function assertEntryInWorkspace(entryId: string, wid: string, reply: FastifyReply): Promise<{ id: string; user_id: string } | null> {
  if (!entryId || !wid) { reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] }); return null }
  // time_entries → users → workspace_id
  const { data } = await supabase
    .from('time_entries')
    .select('id, user_id, users!inner(workspace_id)')
    .eq('id', entryId)
    .maybeSingle()
  const wsId = (data as any)?.users?.workspace_id
  if (!data || wsId !== wid) { reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] }); return null }
  return { id: (data as any).id, user_id: (data as any).user_id }
}

export async function timeRoutes(app: FastifyInstance) {

  // ── GET /time/week ────────────────────────────────────────────────────────
  app.get('/week', async (req, reply) => {
    const caller  = (req as any).user
    const query   = req.query as any
    const isAdmin = ['super_admin','admin'].includes(caller.profile)
    const targetUserId = (query.userId && isAdmin) ? query.userId : caller.id
    // Workspace boundary: admin must not be able to fetch users from other workspaces.
    if (targetUserId !== caller.id) {
      if (!await assertUserInWorkspace(targetUserId, caller.workspaceId, reply)) return
    }
    const refDate      = query.date ? new Date(query.date) : new Date()
    const weekStart    = startOfWeek(refDate, { weekStartsOn: 1 })
    const weekEnd      = endOfWeek(refDate,   { weekStartsOn: 1 })
    const weekStartStr = format(weekStart, 'yyyy-MM-dd')
    const weekEndStr   = format(weekEnd,   'yyyy-MM-dd')
    const { data: entries, error } = await supabase
      .from('time_entries')
      .select(`*, tasks(id,title,phase_id,billable,phases(id,name,projects(id,name,color,clients(name)))),
               internal_time_categories(id,name), time_off_categories(id,name)`)
      .eq('user_id', targetUserId)
      .gte('date', weekStartStr).lte('date', weekEndStr).order('date')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    const { data: submission } = await supabase.from('timesheet_submissions')
      .select('id, submitted_at, locked, note').eq('user_id', targetUserId)
      .eq('week_start', weekStartStr).maybeSingle()
    const rows: Record<string, any> = {}
    for (const e of entries || []) {
      let rowKey = ''; let rowMeta: any = {}
      if (e.type === 'project' && e.task_id && e.tasks) {
        rowKey  = `task-${e.task_id}`
        const t = e.tasks as any
        rowMeta = { type:'project', taskId:e.task_id, taskTitle:t.title, phaseId:t.phase_id,
          phaseName:t.phases?.name, projectId:t.phases?.projects?.id,
          projectName:t.phases?.projects?.name, projectColor:t.phases?.projects?.color,
          clientName:t.phases?.projects?.clients?.name, billable:t.billable }
      } else if (e.type === 'internal' && e.internal_time_category_id) {
        rowKey  = `internal-${e.internal_time_category_id}`
        rowMeta = { type:'internal', categoryId:e.internal_time_category_id, categoryName:(e.internal_time_categories as any)?.name }
      } else if (e.type === 'time_off' && e.time_off_category_id) {
        rowKey  = `time_off-${e.time_off_category_id}`
        rowMeta = { type:'time_off', categoryId:e.time_off_category_id, categoryName:(e.time_off_categories as any)?.name }
      }
      if (!rowKey) continue
      if (!rows[rowKey]) rows[rowKey] = { ...rowMeta, days:{}, totalHrs:0 }
      const dayKey = format(new Date(e.date), 'yyyy-MM-dd')
      rows[rowKey].days[dayKey] = { entryId:e.id, hours:Number(e.hours), billable:e.billable, note:e.note }
      rows[rowKey].totalHrs += Number(e.hours)
    }
    const { data: assignments } = await supabase.from('task_assignees')
      .select(`task_id, tasks(id,title,phase_id,status,billable,phases(id,name,projects(id,name,color,status,end_date,deleted_at,clients(name))))`)
      .eq('user_id', targetUserId)
    const todayStr = format(new Date(), 'yyyy-MM-dd')
    for (const a of assignments || []) {
      const task = (a as any).tasks
      if (!task || task.status === 'done' || task.phases?.projects?.status === 'done') continue
      // Hide tasks from soft-deleted projects. task_assignees rows aren't
      // cleaned up when a project is deleted, so without this filter
      // deleted projects keep haunting the assignee's timesheet forever.
      if (task.phases?.projects?.deleted_at) continue
      // Hide tasks from expired projects
      if (task.phases?.projects?.end_date && task.phases.projects.end_date < todayStr) continue
      const rowKey = `task-${task.id}`
      if (!rows[rowKey]) rows[rowKey] = { type:'project', taskId:task.id, taskTitle:task.title,
        phaseId:task.phase_id, phaseName:task.phases?.name,
        projectId:task.phases?.projects?.id, projectName:task.phases?.projects?.name,
        projectColor:task.phases?.projects?.color, clientName:task.phases?.projects?.clients?.name,
        billable:task.billable, days:{}, totalHrs:0, autoAdded:true }
    }
    const days = Array.from({ length: 7 }, (_, i) => ({
      date: format(addDays(weekStart, i), 'yyyy-MM-dd'),
      dayName: format(addDays(weekStart, i), 'EEE'),
      dayNum:  format(addDays(weekStart, i), 'd'),
    }))
    const dayTotals: Record<string, number> = {}
    for (const row of Object.values(rows))
      for (const [day, cell] of Object.entries(row.days as any))
        dayTotals[day] = (dayTotals[day] || 0) + (cell as any).hours
    const totalHrs    = Object.values(dayTotals).reduce((s: any, h: any) => s + h, 0)
    const billableHrs = (entries || []).filter(e => e.billable).reduce((s, e) => s + Number(e.hours), 0)
    const sortedRows  = Object.values(rows).sort((a: any, b: any) => {
      if (a.autoAdded && !b.autoAdded) return 1
      if (!a.autoAdded && b.autoAdded) return -1
      return (a.projectName || '').localeCompare(b.projectName || '')
    })
    return reply.status(200).send({ data: {
      weekStart: weekStartStr, weekEnd: weekEndStr, targetUser: targetUserId,
      days, rows: sortedRows, dayTotals,
      totalHrs: Math.round(totalHrs * 10) / 10,
      billableHrs: Math.round(billableHrs * 10) / 10,
      submission: submission || null,
      isLocked: submission?.locked ?? false,
    }})
  })

  // ── GET /time/team-week ───────────────────────────────────────────────────
  app.get('/team-week', async (req, reply) => {
    const user    = (req as any).user
    const isAdmin = ['super_admin','admin'].includes(user.profile)
    if (!isAdmin) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { date } = req.query as any
    const refDate      = date ? new Date(date) : new Date()
    const weekStart    = startOfWeek(refDate, { weekStartsOn: 1 })
    const weekEnd      = endOfWeek(refDate,   { weekStartsOn: 1 })
    const weekStartStr = format(weekStart, 'yyyy-MM-dd')
    const weekEndStr   = format(weekEnd,   'yyyy-MM-dd')
    const days = Array.from({ length: 7 }, (_, i) => ({
      date: format(addDays(weekStart, i), 'yyyy-MM-dd'),
      dayName: format(addDays(weekStart, i), 'EEE'),
      dayNum:  format(addDays(weekStart, i), 'd'),
    }))
    const { data: entries, error } = await supabase.from('time_entries')
      .select(`id, user_id, date, hours, billable, type, note,
        tasks(id,title,phase_id,estimated_hrs,billable,phases(id,name,projects(id,name,color,status,deleted_at,clients(name)))),
        users(id,name,job_title,avatar_url,department_id)`)
      .eq('type', 'project').gte('date', weekStartStr).lte('date', weekEndStr).order('date')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    const { data: allAssignments } = await supabase.from('task_assignees')
      .select(`user_id, task_id, users(id,name,job_title,department_id),
        tasks(id,title,phase_id,status,estimated_hrs,billable,phases(id,name,projects(id,name,color,status,deleted_at,clients(name))))`)
    const projects: Record<string, any> = {}
    function ensureProject(proj: any) {
      if (!proj?.id) return null
      if (!projects[proj.id]) projects[proj.id] = { projectId:proj.id, projectName:proj.name, projectColor:proj.color, clientName:proj.clients?.name||'', totalHrs:0, billableHrs:0, tasks:{} }
      return projects[proj.id]
    }
    function ensureTask(pe: any, task: any, phase: any) {
      if (!task||!pe) return null
      if (!pe.tasks[task.id]) pe.tasks[task.id] = { taskId:task.id, taskTitle:task.title, phaseName:phase?.name||'', totalHrs:0, billableHrs:0, estHrs:Number(task.estimated_hrs||0), users:{} }
      return pe.tasks[task.id]
    }
    function ensureUser(te: any, userId: string, userName: string, jobTitle: string, departmentId?: string) {
      if (!te) return null
      if (!te.users[userId]) te.users[userId] = { userId, userName, jobTitle, departmentId: departmentId||null, totalHrs:0, days:{} }
      return te.users[userId]
    }
    for (const e of entries || []) {
      const task = (e as any).tasks; const eu = (e as any).users
      if (!task?.phases?.projects) continue
      const proj = task.phases.projects
      if (proj.status === 'done' || proj.deleted_at) continue
      const pe = ensureProject(proj); const te = ensureTask(pe, task, task.phases)
      const ue = ensureUser(te, e.user_id, eu?.name||'Unknown', eu?.job_title||'', eu?.department_id)
      if (!ue) continue
      const dayKey = format(new Date(e.date), 'yyyy-MM-dd')
      ue.days[dayKey] = { entryId:e.id, hours:Number(e.hours), billable:e.billable, note:e.note }
      ue.totalHrs += Number(e.hours); te.totalHrs += Number(e.hours)
      if (e.billable) { te.billableHrs += Number(e.hours); pe.billableHrs += Number(e.hours) }
      pe.totalHrs += Number(e.hours)
    }
    for (const a of allAssignments || []) {
      const task = (a as any).tasks; const au = (a as any).users
      if (!task?.phases?.projects) continue
      const proj = task.phases.projects
      if (proj.status==='done' || proj.deleted_at || task.status==='done') continue
      const pe = ensureProject(proj); const te = ensureTask(pe, task, task.phases)
      if (!te.users[a.user_id]) { ensureUser(te, a.user_id, au?.name||'Unknown', au?.job_title||'', au?.department_id); te.users[a.user_id].autoAdded = true }
    }
    const projectList = Object.values(projects)
      .filter((p: any) => Object.keys(p.tasks).length > 0)
      .sort((a: any, b: any) => a.projectName.localeCompare(b.projectName))
      .map((p: any) => ({
        ...p,
        tasks: Object.values(p.tasks)
          .sort((a: any, b: any) => a.taskTitle.localeCompare(b.taskTitle))
          .map((t: any) => ({ ...t, users: Object.values(t.users).sort((a: any, b: any) => { if (a.totalHrs>0&&b.totalHrs===0) return -1; if (a.totalHrs===0&&b.totalHrs>0) return 1; return a.userName.localeCompare(b.userName) }) })),
      }))
    return reply.status(200).send({ data: {
      weekStart: weekStartStr, weekEnd: weekEndStr, days, projects: projectList,
      grandTotalHrs:    Math.round(projectList.reduce((s:number,p:any)=>s+p.totalHrs,0)*10)/10,
      grandBillableHrs: Math.round(projectList.reduce((s:number,p:any)=>s+p.billableHrs,0)*10)/10,
    }})
  })

  // ── GET /time/project/:projectId ──────────────────────────────────────────
  app.get('/project/:projectId', async (req, reply) => {
    const caller = (req as any).user
    if (!['super_admin','admin'].includes(caller.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { projectId } = req.params as { projectId: string }
    if (!await assertProjectInWorkspace(projectId, caller.workspaceId, reply)) return
    const { from, to } = req.query as any
    const { data: phases } = await supabase.from('phases').select('id, name').eq('project_id', projectId)
    const phaseIds = (phases || []).map((p: any) => p.id)
    if (!phaseIds.length) return reply.status(200).send({ data: [] })
    const { data: tasks } = await supabase.from('tasks').select('id, title, phase_id, estimated_hrs, billable, status').in('phase_id', phaseIds)
    const taskIds = (tasks || []).map((t: any) => t.id)
    if (!taskIds.length) return reply.status(200).send({ data: [] })
    const phaseMap: Record<string, string> = {}
    for (const p of phases || []) phaseMap[p.id] = p.name
    let entryQuery = supabase.from('time_entries')
      .select('id, user_id, task_id, date, hours, billable, note, type, users(id, name, job_title)')
      .in('task_id', taskIds).order('date', { ascending: false })
    if (from) entryQuery = entryQuery.gte('date', from)
    if (to)   entryQuery = entryQuery.lte('date', to)
    const { data: entries, error } = await entryQuery
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    const taskMap: Record<string, any> = {}
    for (const t of tasks || []) taskMap[t.id] = { taskId:t.id, taskTitle:t.title, phaseName:phaseMap[t.phase_id]||'', estimatedHrs:Number(t.estimated_hrs||0), billable:t.billable, status:t.status, totalHrs:0, billableHrs:0, users:{} as Record<string,any> }
    for (const e of entries || []) {
      if (!e.task_id || !taskMap[e.task_id]) continue
      const tm = taskMap[e.task_id]; const u = (e as any).users; const uid = e.user_id
      if (!tm.users[uid]) tm.users[uid] = { userId:uid, userName:u?.name||'Unknown', jobTitle:u?.job_title||'', totalHrs:0, entries:[] }
      tm.users[uid].entries.push({ id:e.id, date:e.date, hours:Number(e.hours), billable:e.billable, note:e.note })
      tm.users[uid].totalHrs += Number(e.hours); tm.totalHrs += Number(e.hours)
      if (e.billable) tm.billableHrs += Number(e.hours)
    }
    const result = Object.values(taskMap)
      .filter((t: any) => t.totalHrs > 0 || t.estimatedHrs > 0)
      .sort((a: any, b: any) => a.phaseName.localeCompare(b.phaseName) || a.taskTitle.localeCompare(b.taskTitle))
      .map((t: any) => ({ ...t, users: Object.values(t.users).sort((a: any, b: any) => b.totalHrs - a.totalHrs) }))
    const totals = result.reduce((acc: any, t: any) => { acc.totalHrs += t.totalHrs; acc.billableHrs += t.billableHrs; return acc }, { totalHrs:0, billableHrs:0 })
    return reply.status(200).send({ data: result, totals })
  })

  // ── GET /time/entries — flat time entries for date range (Time Reg. report)
  app.get('/entries', async (req, reply) => {
    const user    = (req as any).user
    const isAdmin = ['super_admin','admin'].includes(user.profile)
    const { from, to, user_id: filterUser, project_id: filterProject, client_id: filterClient, include_all_types } = req.query as any
    const startDate = from || format(new Date(), 'yyyy-MM-01')
    const endDate   = to   || format(new Date(), 'yyyy-MM-dd')
    // Non-admins can only see their own entries
    const targetUser = isAdmin ? filterUser : user.id
    // Workspace boundary on admin's filterUser
    if (isAdmin && filterUser && filterUser !== user.id) {
      if (!await assertUserInWorkspace(filterUser, user.workspaceId, reply)) return
    }
    if (filterProject) {
      if (!await assertProjectInWorkspace(filterProject, user.workspaceId, reply)) return
    }
    let q = supabase.from('time_entries')
      .select(`id, user_id, task_id, date, hours, billable, note, type,
        internal_time_category_id, time_off_category_id,
        users(id, name, job_title, departments(name)),
        tasks(id, title, phase_id, phases(id, name, projects(id, name, color, status, clients(id, name)))),
        internal_time_categories(id, name),
        time_off_categories(id, name)`)
      .gte('date', startDate).lte('date', endDate)
      .order('date', { ascending: false })
    if (!include_all_types) q = q.eq('type', 'project')
    if (targetUser) q = q.eq('user_id', targetUser)
    if (!isAdmin) q = q.eq('user_id', user.id)
    const { data: entries, error } = await q
    if (error) return reply.status(500).send({ errors:[{message:error.message}] })
    let rows = (entries || []).map((e: any) => {
      const task = e.tasks; const phase = task?.phases; const project = phase?.projects
      const client = project?.clients; const userObj = e.users; const dept = userObj?.departments
      return {
        id: e.id, date: e.date, hours: Number(e.hours), billable: e.billable, note: e.note, type: e.type || 'project',
        user_id: e.user_id, user_name: userObj?.name||'Unknown', user_title: userObj?.job_title||'', department: dept?.name||'',
        task_id: e.task_id, task_title: task?.title||'',
        phase_id: task?.phase_id, phase_name: phase?.name||'',
        project_id: project?.id||'', project_name: project?.name||'', project_color: project?.color||'#0D9488',
        client_id: client?.id||'', client_name: client?.name||'',
        category_name: e.internal_time_categories?.name || e.time_off_categories?.name || '',
      }
    })
    if (filterProject) rows = rows.filter((r:any) => r.project_id === filterProject)
    if (filterClient)  rows = rows.filter((r:any) => r.client_id === filterClient)
    const totalHrs    = rows.reduce((s:number,e:any)=>s+e.hours,0)
    const billableHrs = rows.filter((e:any)=>e.billable).reduce((s:number,e:any)=>s+e.hours,0)
    return reply.status(200).send({
      data: rows,
      meta: { from:startDate, to:endDate, totalEntries:rows.length,
        totalHrs:Math.round(totalHrs*10)/10, billableHrs:Math.round(billableHrs*10)/10,
        nonBillableHrs:Math.round((totalHrs-billableHrs)*10)/10 }
    })
  })

  // ── POST /time/submit ─────────────────────────────────────────────────────
  app.post('/submit', async (req, reply) => {
    const user = (req as any).user; const body = req.body as any
    const weekStartStr = body.weekStart
    if (!weekStartStr) return reply.status(400).send({ errors: [{ code: 'MISSING_WEEK_START' }] })
    const weekEnd = new Date(weekStartStr); weekEnd.setDate(weekEnd.getDate()+6)
    const weekEndStr = weekEnd.toISOString().slice(0,10)
    const { count } = await supabase.from('time_entries').select('id',{count:'exact',head:true})
      .eq('user_id',user.id).gte('date',weekStartStr).lte('date',weekEndStr)
    if ((count||0)===0) return reply.status(400).send({ errors: [{ code:'NO_ENTRIES', message:'No time entries to submit.' }] })
    const { data, error } = await supabase.from('timesheet_submissions')
      .upsert({ user_id:user.id, workspace_id:user.workspaceId, week_start:weekStartStr, week_end:weekEndStr,
        submitted_by:user.id, submitted_at:new Date().toISOString(), note:body.note||null, locked:true },
        { onConflict:'user_id,week_start' }).select().single()
    if (error) return reply.status(500).send({ errors: [{ message:error.message }] })
    return reply.status(200).send({ data, message:'Timesheet submitted.' })
  })

  // ── DELETE /time/submit ───────────────────────────────────────────────────
  app.delete('/submit', async (req, reply) => {
    const user = (req as any).user; const body = req.body as any
    const isAdmin = ['super_admin','admin'].includes(user.profile)
    const weekStartStr = body.weekStart
    const targetUserId = (body.userId && isAdmin) ? body.userId : user.id
    if (!weekStartStr) return reply.status(400).send({ errors: [{ code:'MISSING_WEEK_START' }] })
    if (!isAdmin && targetUserId !== user.id) return reply.status(403).send({ errors: [{ code:'FORBIDDEN' }] })
    // Workspace boundary on admin's targetUserId
    if (targetUserId !== user.id) {
      if (!await assertUserInWorkspace(targetUserId, user.workspaceId, reply)) return
    }
    const { error } = await supabase.from('timesheet_submissions').delete()
      .eq('user_id',targetUserId).eq('week_start',weekStartStr).eq('workspace_id', user.workspaceId)
    if (error) return reply.status(500).send({ errors: [{ message:error.message }] })
    return reply.status(200).send({ data: { message:'Unlocked.' } })
  })

  // ── GET /time/submissions ─────────────────────────────────────────────────
  app.get('/submissions', async (req, reply) => {
    const user = (req as any).user
    if (!['super_admin','admin'].includes(user.profile)) return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    const { weekStart } = req.query as any
    if (!weekStart) return reply.status(400).send({ errors:[{code:'MISSING_WEEK_START'}] })
    const { data, error } = await supabase.from('timesheet_submissions')
      .select('*')
      .eq('workspace_id',user.workspaceId).eq('week_start',weekStart)
    if (error) return reply.status(500).send({ errors:[{message:error.message}] })
    return reply.status(200).send({ data })
  })

  // ── POST /time — log time ─────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const caller  = (req as any).user
    const isAdmin = ['super_admin','admin'].includes(caller.profile)
    const body    = logTimeSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })
    const { date, hours, billable, note, type, task_id, internal_time_category_id, time_off_category_id, target_user_id } = body.data
    const userId = (isAdmin && target_user_id) ? target_user_id : caller.id
    if (type === 'project' && !task_id) return reply.status(400).send({ errors: [{ code: 'MISSING_TASK' }] })

    // Workspace boundary checks for cross-user / task references
    if (userId !== caller.id) {
      if (!await assertUserInWorkspace(userId, caller.workspaceId, reply)) return
    }
    if (type === 'project' && task_id) {
      const { data: taskCheck } = await supabase
        .from('tasks').select('id, phases!inner(projects!inner(workspace_id))')
        .eq('id', task_id).maybeSingle()
      const taskWs = (taskCheck as any)?.phases?.projects?.workspace_id
      if (!taskCheck || taskWs !== caller.workspaceId) {
        return reply.status(404).send({ errors: [{ code: 'TASK_NOT_FOUND' }] })
      }
    }
    if (type === 'internal' && internal_time_category_id) {
      const { data: cat } = await supabase
        .from('internal_time_categories').select('id').eq('id', internal_time_category_id).eq('workspace_id', caller.workspaceId).maybeSingle()
      if (!cat) return reply.status(404).send({ errors: [{ code: 'CATEGORY_NOT_FOUND' }] })
    }
    if (type === 'time_off' && time_off_category_id) {
      const { data: cat } = await supabase
        .from('time_off_categories').select('id').eq('id', time_off_category_id).eq('workspace_id', caller.workspaceId).maybeSingle()
      if (!cat) return reply.status(404).send({ errors: [{ code: 'CATEGORY_NOT_FOUND' }] })
    }

    // ── Fetch workspace settings for rule enforcement ──────────────────────
    const { data: ws } = await supabase
      .from('workspaces')
      .select('weekends_enabled, allow_entries_on_done, allow_entries_over_estimate, allow_late_entries')
      .eq('id', caller.workspaceId)
      .single()

    // Rule 1: weekends_enabled — block logging on Sat/Sun
    if (ws && ws.weekends_enabled === false) {
      const dow = new Date(date + 'T12:00:00').getDay()
      if (dow === 0 || dow === 6) {
        return reply.status(422).send({ errors: [{ code: 'WEEKENDS_DISABLED', message: 'Weekend time logging is disabled for this workspace.' }] })
      }
    }

    // Rule 2: allow_late_entries — block entries more than 14 days old
    if (ws && ws.allow_late_entries === false) {
      const entryDate = new Date(date + 'T00:00:00')
      const cutoff    = new Date(); cutoff.setDate(cutoff.getDate() - 14)
      if (entryDate < cutoff) {
        return reply.status(422).send({ errors: [{ code: 'LATE_ENTRY_DISABLED', message: 'Late time entries (older than 14 days) are not allowed.' }] })
      }
    }

    if (type === 'project' && task_id) {
      // Rule 3: allow_entries_on_done — block logging on completed tasks
      if (ws && ws.allow_entries_on_done === false) {
        const { data: task } = await supabase.from('tasks').select('status').eq('id', task_id).single()
        if (task?.status === 'done') {
          return reply.status(422).send({ errors: [{ code: 'TASK_COMPLETED', message: 'Time logging on completed tasks is disabled.' }] })
        }
      }

      // Rule 4: allow_entries_over_estimate — block if hours would exceed task estimate
      if (ws && ws.allow_entries_over_estimate === false) {
        const { data: task } = await supabase.from('tasks').select('estimated_hrs').eq('id', task_id).single()
        if (task?.estimated_hrs) {
          const { data: existing } = await supabase
            .from('time_entries')
            .select('hours')
            .eq('task_id', task_id)
          const logged = (existing || []).reduce((s: number, e: any) => s + Number(e.hours), 0)
          if (logged + hours > Number(task.estimated_hrs)) {
            return reply.status(422).send({ errors: [{ code: 'OVER_ESTIMATE', message: `This entry would exceed the task estimate of ${task.estimated_hrs}h (${logged.toFixed(1)}h already logged).` }] })
          }
        }
      }
    }

    const { data, error } = await supabase.from('time_entries').upsert({
      user_id: userId, task_id: type === 'project' ? task_id : null,
      internal_time_category_id: type === 'internal' ? internal_time_category_id : null,
      time_off_category_id: type === 'time_off' ? time_off_category_id : null,
      date, hours, billable: type === 'project' ? billable : false, note: note || null, type,
    }, { onConflict: 'user_id,task_id,date' }).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  // ── PUT /time/:id ─────────────────────────────────────────────────────────
  app.put('/:id', async (req, reply) => {
    const caller  = (req as any).user
    const isAdmin = ['super_admin','admin'].includes(caller.profile)
    const { id }  = req.params as { id:string }
    const body    = logTimeSchema.partial().safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors:body.error.issues })

    // Workspace check (covers both admin and self-edit paths)
    const existing = await assertEntryInWorkspace(id, caller.workspaceId, reply)
    if (!existing) return
    if (!isAdmin && existing.user_id !== caller.id) {
      return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    }

    const update: any = {}
    if (body.data.hours    !== undefined) update.hours   = body.data.hours
    if (body.data.billable !== undefined) update.billable= body.data.billable
    if (body.data.note     !== undefined) update.note    = body.data.note
    const { data, error } = await supabase.from('time_entries').update(update).eq('id',id).select().single()
    if (error) return reply.status(500).send({ errors:[{message:error.message}] })
    return reply.status(200).send({ data })
  })

  // ── DELETE /time/:id ──────────────────────────────────────────────────────
  app.delete('/:id', async (req, reply) => {
    const caller  = (req as any).user
    const isAdmin = ['super_admin','admin'].includes(caller.profile)
    const { id }  = req.params as { id:string }

    const existing = await assertEntryInWorkspace(id, caller.workspaceId, reply)
    if (!existing) return
    if (!isAdmin && existing.user_id !== caller.id) {
      return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    }

    await supabase.from('time_entries').delete().eq('id', id)
    return reply.status(200).send({ data:{message:'Deleted'} })
  })

  // ── GET /time/tasks ───────────────────────────────────────────────────────
  app.get('/tasks', async (req, reply) => {
    const user = (req as any).user
    const { search } = req.query as any
    const [{ data: assignedRows }, { data: memberProjects }] = await Promise.all([
      supabase.from('task_assignees').select('task_id').eq('user_id', user.id),
      supabase.from('project_members').select('project_id').eq('user_id', user.id),
    ])
    const assignedTaskIds  = (assignedRows   || []).map((a: any) => a.task_id)
    const memberProjectIds = (memberProjects || []).map((m: any) => m.project_id)
    if (!assignedTaskIds.length && !memberProjectIds.length) return reply.status(200).send({ data: [] })
    let memberPhaseIds: string[] = []
    if (memberProjectIds.length > 0) {
      const { data: phases } = await supabase.from('phases').select('id').in('project_id', memberProjectIds)
      memberPhaseIds = (phases || []).map((p: any) => p.id)
    }
    // Two fixes vs. the old query:
    //   1. `!inner` + `.is('phases.projects.deleted_at', null)` drops tasks whose
    //      parent project has been soft-deleted. Without this, a task from a
    //      deleted project shows up on Overview, the collaborator clicks its
    //      status dropdown, and the PATCH 404s (assertProjectInWorkspace rejects
    //      deleted rows). See apps/project-service/src/lib/scope.ts.
    //   2. Dropping `.neq('status','done')` so the Completed section on the
    //      Overview page actually renders after a refetch. Previously the
    //      server withheld all done tasks → marking a task done made it vanish
    //      with no way to un-done from this screen.
    // Ordering by updated_at keeps recently-touched work at the top, so the
    // 100-row cap doesn't starve the open list just because the user has a
    // big backlog of old done tasks.
    let query = supabase
      .from('tasks')
      .select('*, phases!inner(id,name,projects!inner(id,name,color,status,deleted_at,clients(name)))')
      .is('phases.projects.deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(100)
    if (search) query = query.ilike('title', `%${search}%`)
    const hasAssigned = assignedTaskIds.length > 0; const hasPhases = memberPhaseIds.length > 0
    if (hasAssigned && hasPhases) query = query.or(`id.in.(${assignedTaskIds.join(',')}),phase_id.in.(${memberPhaseIds.join(',')})`)
    else if (hasPhases) query = query.in('phase_id', memberPhaseIds)
    else query = query.in('id', assignedTaskIds)
    const { data, error } = await query
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  // ── GET /time/categories ──────────────────────────────────────────────────
  app.get('/categories', async (req, reply) => {
    const wid = (req as any).user.workspaceId
    const [{ data: internal }, { data: timeOff }] = await Promise.all([
      supabase.from('internal_time_categories').select('*').eq('workspace_id',wid).order('name'),
      supabase.from('time_off_categories').select('*').eq('workspace_id',wid).order('name'),
    ])
    return reply.status(200).send({ data: { internal, timeOff } })
  })

  // ── POST /time/categories/internal ────────────────────────────────────────
  app.post('/categories/internal', async (req, reply) => {
    const user = (req as any).user
    if (!['super_admin','admin','account_manager'].includes(user.profile)) return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    const { name } = req.body as any
    if (!name?.trim()) return reply.status(400).send({ errors:[{code:'MISSING_NAME'}] })
    const { data, error } = await supabase.from('internal_time_categories')
      .insert({ workspace_id: user.workspaceId, name: name.trim(), active: true })
      .select().single()
    if (error) return reply.status(500).send({ errors:[{message:error.message}] })
    return reply.status(201).send({ data })
  })

  // ── PATCH /time/categories/internal/:id ───────────────────────────────────
  app.patch('/categories/internal/:id', async (req, reply) => {
    const user = (req as any).user
    if (!['super_admin','admin'].includes(user.profile)) return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    const { id } = req.params as any
    const { name, active } = req.body as any
    const update: any = {}
    if (name !== undefined) {
      const n = String(name).trim()
      if (!n) return reply.status(400).send({ errors:[{code:'EMPTY_NAME'}] })
      update.name = n
    }
    if (active !== undefined) update.active = !!active
    if (Object.keys(update).length === 0) return reply.status(400).send({ errors:[{code:'NO_FIELDS'}] })

    // 🛡️ Workspace boundary — without this, an admin in WS A could rename WS B's categories
    const { data, error } = await supabase
      .from('internal_time_categories')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .select().maybeSingle()
    if (error) return reply.status(500).send({ errors:[{message:error.message}] })
    if (!data) return reply.status(404).send({ errors:[{code:'NOT_FOUND'}] })
    return reply.status(200).send({ data })
  })

  // ── DELETE /time/categories/internal/:id ─────────────────────────────────
  app.delete('/categories/internal/:id', async (req, reply) => {
    const user = (req as any).user
    if (!['super_admin','admin'].includes(user.profile)) return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    const { id } = req.params as any
    const { error, count } = await supabase
      .from('internal_time_categories')
      .update({ active: false }, { count: 'exact' })
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
    if (error) return reply.status(500).send({ errors:[{message:error.message}] })
    if (count === 0) return reply.status(404).send({ errors:[{code:'NOT_FOUND'}] })
    return reply.status(200).send({ data:{ message:'Deactivated' } })
  })

  // ── POST /time/categories/time-off ─────────────────────────────────────────
  app.post('/categories/time-off', async (req, reply) => {
    const user = (req as any).user
    if (!['super_admin','admin'].includes(user.profile)) return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    const { name } = req.body as any
    if (!name?.trim()) return reply.status(400).send({ errors:[{code:'MISSING_NAME'}] })
    const { data, error } = await supabase.from('time_off_categories')
      .insert({ workspace_id: user.workspaceId, name: name.trim(), active: true })
      .select().single()
    if (error) return reply.status(500).send({ errors:[{message:error.message}] })
    return reply.status(201).send({ data })
  })

  // ── PATCH /time/categories/time-off/:id ────────────────────────────────────
  app.patch('/categories/time-off/:id', async (req, reply) => {
    const user = (req as any).user
    if (!['super_admin','admin'].includes(user.profile)) return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    const { id } = req.params as any
    const { name, active } = req.body as any
    const update: any = {}
    if (name !== undefined) {
      const n = String(name).trim()
      if (!n) return reply.status(400).send({ errors:[{code:'EMPTY_NAME'}] })
      update.name = n
    }
    if (active !== undefined) update.active = !!active
    if (Object.keys(update).length === 0) return reply.status(400).send({ errors:[{code:'NO_FIELDS'}] })

    const { data, error } = await supabase
      .from('time_off_categories')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .select().maybeSingle()
    if (error) return reply.status(500).send({ errors:[{message:error.message}] })
    if (!data) return reply.status(404).send({ errors:[{code:'NOT_FOUND'}] })
    return reply.status(200).send({ data })
  })

  // ── DELETE /time/categories/time-off/:id ──────────────────────────────────
  app.delete('/categories/time-off/:id', async (req, reply) => {
    const user = (req as any).user
    if (!['super_admin','admin'].includes(user.profile)) return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    const { id } = req.params as any
    const { error, count } = await supabase
      .from('time_off_categories')
      .update({ active: false }, { count: 'exact' })
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
    if (error) return reply.status(500).send({ errors:[{message:error.message}] })
    if (count === 0) return reply.status(404).send({ errors:[{code:'NOT_FOUND'}] })
    return reply.status(200).send({ data:{ message:'Deactivated' } })
  })

  // ── GET /time/report — per-user compliance summary for a week ─────────────
  app.get('/report', async (req, reply) => {
    const user    = (req as any).user
    const isAdmin = ['super_admin','admin'].includes(user.profile)
    if (!isAdmin) return reply.status(403).send({ errors:[{code:'FORBIDDEN'}] })
    const { weekStart } = req.query as any
    const refDate = weekStart ? new Date(weekStart) : new Date()
    const start = format(startOfWeek(refDate,{weekStartsOn:1}),'yyyy-MM-dd')
    const end   = format(endOfWeek(refDate,{weekStartsOn:1}),'yyyy-MM-dd')
    const { data: users, error: uErr } = await supabase.from('users').select('id,name,capacity_hrs')
      .eq('workspace_id',user.workspaceId).eq('active',true).is('deleted_at',null)
    if (uErr) return reply.status(500).send({ errors:[{message:uErr.message}] })
    const userIds = (users||[]).map((u:any)=>u.id)
    const [{ data: entries }, { data: submissions }, { data: timeOffEntries }] = await Promise.all([
      supabase.from('time_entries').select('user_id,hours,billable,type')
        .in('user_id',userIds.length?userIds:['none']).gte('date',start).lte('date',end),
      supabase.from('timesheet_submissions').select('user_id,submitted_at,locked')
        .in('user_id',userIds.length?userIds:['none']).eq('week_start',start),
      supabase.from('time_entries').select('user_id,hours')
        .in('user_id',userIds.length?userIds:['none']).eq('type','time_off').gte('date',start).lte('date',end),
    ])
    const submittedMap = new Set((submissions||[]).map((s:any)=>s.user_id))
    // Calculate time-off hours per user
    const timeOffMap: Record<string,number> = {}
    for (const e of timeOffEntries||[]) timeOffMap[e.user_id] = (timeOffMap[e.user_id]||0) + Number(e.hours)
    const byUser: Record<string,any> = {}
    for (const u of users||[]) byUser[u.id] = { userId:u.id, userName:u.name, capacity:Number(u.capacity_hrs||40), totalHrs:0, billableHrs:0, timeOffHrs: timeOffMap[u.id]||0, submitted:submittedMap.has(u.id) }
    for (const e of entries||[]) { if (!byUser[e.user_id]) continue; if (e.type !== 'time_off') { byUser[e.user_id].totalHrs+=Number(e.hours); if(e.billable)byUser[e.user_id].billableHrs+=Number(e.hours) } }
    const result = Object.values(byUser).map((u:any) => ({
      ...u,
      totalHrs:       Math.round(u.totalHrs*10)/10,
      billableHrs:    Math.round(u.billableHrs*10)/10,
      timeOffHrs:     Math.round(u.timeOffHrs*10)/10,
      utilizationPct: u.capacity>0?Math.round((u.totalHrs/u.capacity)*100):0,
      billablePct:    u.totalHrs>0?Math.round((u.billableHrs/u.totalHrs)*100):0,
    }))
    return reply.status(200).send({ data:result, weekStart:start, weekEnd:end })
  })
}
