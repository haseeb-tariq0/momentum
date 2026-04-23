import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { supabase } from '@forecast/db'

const taskSchema = z.object({
  title:         z.string().min(1),
  description:   z.string().optional().nullable(),
  estimated_hrs: z.number().nonnegative().optional().nullable(),
  billable:      z.boolean().default(true),
  sort_order:    z.number().int().default(0),
})

const phaseSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional().nullable(),
  sort_order:  z.number().int().default(0),
  tasks:       z.array(taskSchema).default([]),
})

const templateSchema = z.object({
  name:        z.string().min(1),
  description: z.string().optional().nullable(),
  color:       z.string().default('#0D9488'),
  phases:      z.array(phaseSchema).default([]),
})

async function assertTemplateInWorkspace(
  templateId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!templateId || !workspaceId) {
    reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] })
    return false
  }
  const { data } = await supabase
    .from('project_templates')
    .select('id')
    .eq('id', templateId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!data) {
    reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return false
  }
  return true
}

// Write phases + their tasks for a template. Returns an error message on the
// first failure so the caller can roll back instead of leaving a partial template.
async function writeTemplatePhases(
  templateId: string,
  phases: Array<{ name: string; description?: string | null; sort_order?: number; tasks: Array<any> }>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]
    const { data: phase, error: pErr } = await supabase
      .from('template_phases')
      .insert({
        template_id: templateId,
        name:        p.name,
        description: p.description ?? null,
        sort_order:  p.sort_order ?? i,
      })
      .select('*').single()
    if (pErr || !phase) return { ok: false, error: pErr?.message || 'phase insert failed' }

    if (p.tasks.length) {
      const rows = p.tasks.map((t: any, j: number) => ({
        template_phase_id: phase.id,
        title:             t.title,
        description:       t.description ?? null,
        estimated_hrs:     t.estimated_hrs ?? null,
        billable:          t.billable,
        sort_order:        t.sort_order ?? j,
      }))
      const { error: tErr } = await supabase.from('template_tasks').insert(rows)
      if (tErr) return { ok: false, error: tErr.message }
    }
  }
  return { ok: true }
}

async function hydrateTemplate(templateId: string) {
  const { data: template } = await supabase
    .from('project_templates')
    .select('*')
    .eq('id', templateId)
    .maybeSingle()
  if (!template) return null

  const { data: phases } = await supabase
    .from('template_phases')
    .select('*')
    .eq('template_id', templateId)
    .order('sort_order')

  const phaseIds = (phases || []).map((p: any) => p.id)
  const { data: tasks } = phaseIds.length
    ? await supabase
        .from('template_tasks')
        .select('*')
        .in('template_phase_id', phaseIds)
        .order('sort_order')
    : { data: [] as any[] }

  const byPhase: Record<string, any[]> = {}
  for (const t of tasks || []) {
    ;(byPhase[t.template_phase_id] ||= []).push(t)
  }

  return {
    ...template,
    phases: (phases || []).map((p: any) => ({ ...p, tasks: byPhase[p.id] || [] })),
  }
}

export async function templateRoutes(app: FastifyInstance) {

  // ── GET /templates ────────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const user = (req as any).user
    const { data: templates, error } = await supabase
      .from('project_templates')
      .select('*')
      .eq('workspace_id', user.workspaceId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })

    const ids = (templates || []).map((t: any) => t.id)
    if (!ids.length) return reply.status(200).send({ data: [] })

    // Gather phase + task counts in one pass
    const { data: phases } = await supabase
      .from('template_phases')
      .select('id, template_id')
      .in('template_id', ids)

    const phaseToTemplate: Record<string, string> = {}
    const phaseCount: Record<string, number> = {}
    for (const p of phases || []) {
      phaseToTemplate[p.id] = p.template_id
      phaseCount[p.template_id] = (phaseCount[p.template_id] || 0) + 1
    }

    const phaseIds = Object.keys(phaseToTemplate)
    const taskCount: Record<string, number> = {}
    if (phaseIds.length) {
      const { data: tasks } = await supabase
        .from('template_tasks')
        .select('template_phase_id')
        .in('template_phase_id', phaseIds)
      for (const t of tasks || []) {
        const tid = phaseToTemplate[t.template_phase_id]
        if (tid) taskCount[tid] = (taskCount[tid] || 0) + 1
      }
    }

    const enriched = (templates || []).map((t: any) => ({
      ...t,
      phase_count: phaseCount[t.id] || 0,
      task_count:  taskCount[t.id]  || 0,
    }))
    return reply.status(200).send({ data: enriched })
  })

  // ── GET /templates/:id ────────────────────────────────────────────────────
  app.get('/:id', async (req, reply) => {
    const user = (req as any).user
    const { id } = req.params as { id: string }
    if (!await assertTemplateInWorkspace(id, user.workspaceId, reply)) return
    const full = await hydrateTemplate(id)
    return reply.status(200).send({ data: full })
  })

  // ── POST /templates ───────────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const parsed = templateSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ errors: parsed.error.issues })
    const { phases, ...rest } = parsed.data

    const { data: template, error } = await supabase
      .from('project_templates')
      .insert({ ...rest, workspace_id: user.workspaceId })
      .select('*').single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })

    const result = await writeTemplatePhases(template.id, phases)
    if (!result.ok) {
      // Hard delete the empty template — phase/task cascade will clean up anything partial.
      await supabase.from('project_templates').delete().eq('id', template.id)
      return reply.status(500).send({ errors: [{ message: result.error }] })
    }

    const full = await hydrateTemplate(template.id)
    return reply.status(201).send({ data: full })
  })

  // ── PATCH /templates/:id ──────────────────────────────────────────────────
  // Full replace of phases+tasks: simpler to reason about and templates
  // are small. Matches the "templates are static recipes" mental model.
  app.patch('/:id', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as { id: string }
    if (!await assertTemplateInWorkspace(id, user.workspaceId, reply)) return
    const parsed = templateSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ errors: parsed.error.issues })
    const { phases, ...rest } = parsed.data

    if (Object.keys(rest).length) {
      const { error } = await supabase
        .from('project_templates')
        .update(rest)
        .eq('id', id)
      if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    }

    if (phases !== undefined) {
      // Cascade will delete template_tasks under the phases we remove.
      await supabase.from('template_phases').delete().eq('template_id', id)
      const result = await writeTemplatePhases(id, phases)
      if (!result.ok) {
        return reply.status(500).send({ errors: [{ message: result.error }] })
      }
    }

    const full = await hydrateTemplate(id)
    return reply.status(200).send({ data: full })
  })

  // ── DELETE /templates/:id ─────────────────────────────────────────────────
  app.delete('/:id', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as { id: string }
    if (!await assertTemplateInWorkspace(id, user.workspaceId, reply)) return
    const { error } = await supabase
      .from('project_templates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data: { ok: true } })
  })
}

// Exported for project-service to call during project creation.
// Copies the template's phases + tasks into the given project. Returns a status
// so the caller can surface partial failures instead of silently losing tasks.
// Per Apr 15 spec: tasks are pulled once — template edits don't propagate back.
export async function applyTemplateToProject(
  templateId: string,
  projectId: string,
): Promise<{ ok: true; phases: number; tasks: number } | { ok: false; error: string; phases: number; tasks: number }> {
  const { data: phases, error: phasesErr } = await supabase
    .from('template_phases')
    .select('*')
    .eq('template_id', templateId)
    .order('sort_order')
  if (phasesErr) return { ok: false, error: phasesErr.message, phases: 0, tasks: 0 }
  if (!phases?.length) return { ok: true, phases: 0, tasks: 0 }

  let createdPhases = 0
  let createdTasks  = 0

  for (const tp of phases) {
    const { data: newPhase, error: phaseErr } = await supabase
      .from('phases')
      .insert({
        project_id:  projectId,
        name:        tp.name,
        description: tp.description,
        sort_order:  tp.sort_order,
      })
      .select('*').single()
    if (phaseErr || !newPhase) {
      return { ok: false, error: phaseErr?.message || 'phase insert failed', phases: createdPhases, tasks: createdTasks }
    }
    createdPhases++

    const { data: tasks, error: tasksListErr } = await supabase
      .from('template_tasks')
      .select('*')
      .eq('template_phase_id', tp.id)
      .order('sort_order')
    if (tasksListErr) {
      return { ok: false, error: tasksListErr.message, phases: createdPhases, tasks: createdTasks }
    }
    if (!tasks?.length) continue

    const rows = tasks.map((t: any) => ({
      phase_id:      newPhase.id,
      title:         t.title,
      description:   t.description,
      estimated_hrs: t.estimated_hrs,
      billable:      t.billable,
      sort_order:    t.sort_order,
    }))
    const { error: tasksInsertErr } = await supabase.from('tasks').insert(rows)
    if (tasksInsertErr) {
      return { ok: false, error: tasksInsertErr.message, phases: createdPhases, tasks: createdTasks }
    }
    createdTasks += rows.length
  }
  return { ok: true, phases: createdPhases, tasks: createdTasks }
}
