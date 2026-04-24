import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '@forecast/db'
import { assertProjectInWorkspace, assertPhaseInWorkspace, assertTaskInWorkspace } from '../lib/scope.js'

// Date schema with end >= start refinement
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')

// ── Shape objects (unrefined) ────────────────────────────────────────────
// Keep the raw ZodObjects available so route handlers can derive partial /
// omit / pick variants. Zod .refine() wraps the object in a ZodEffects,
// which doesn't expose those methods — trying to call phaseSchema.omit(...)
// or taskSchema.partial() on a refined schema throws
// "taskSchema.omit is not a function" at runtime and every PATCH returns
// 500. Bug caught Apr 23 after task-status dropdowns stopped saving.
const phaseShape = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  start_date: dateStr.optional(),
  end_date:   dateStr.optional(),
  sort_order: z.number().int().default(0),
})

const taskShape = z.object({
  phase_id:      z.string().uuid(),
  title:         z.string().min(1).max(500),
  description:   z.string().max(5000).optional(),
  estimated_hrs: z.number().min(0).max(10000).optional(),
  status:        z.enum(['todo','in_progress','done']).default('todo'),
  billable:      z.boolean().optional(), // optional — inherits from parent project if omitted
  start_date:    dateStr.optional(),
  due_date:      dateStr.optional(),
  sort_order:    z.number().int().default(0),
  assignee_ids:  z.array(z.string().uuid()).optional(),
})

// ── Refined schemas for full-body validation (POST/create) ───────────────
// These add the cross-field checks; use these when the caller passes a
// complete payload. For partial updates (PATCH), derive from the shape
// objects directly — see the PATCH handlers below.
const phaseSchema = phaseShape.refine(
  d => !d.start_date || !d.end_date || d.start_date <= d.end_date,
  { message: 'end_date must be ≥ start_date', path: ['end_date'] },
)

const taskSchema = taskShape.refine(
  d => !d.start_date || !d.due_date || d.start_date <= d.due_date,
  { message: 'due_date must be ≥ start_date', path: ['due_date'] },
)

export async function taskRoutes(app: FastifyInstance) {

  // ── POST /projects/:projectId/phases ──────────────────────────────────────
  // Admins only. Per Murtaza: collaborators cannot create phases.
  app.post('/:projectId/phases', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN', message: 'Collaborators cannot create phases.' }] })
    }
    const { projectId } = req.params as { projectId: string }
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return

    const body = phaseSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })
    const { data, error } = await supabase.from('phases').insert({ project_id: projectId, ...body.data }).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  // ── PATCH /projects/:projectId/phases/:phaseId ────────────────────────────
  app.patch('/:projectId/phases/:phaseId', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { projectId, phaseId } = req.params as any
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertPhaseInWorkspace(phaseId, user.workspaceId, reply)) return

    // Partial update — derive from the unrefined shape so .partial() works.
    // See phaseShape/taskShape note near the top of the file. We intentionally
    // drop the cross-field refinement on PATCH: a caller updating only
    // `name` shouldn't have to re-send both dates just to satisfy the
    // end>=start check.
    const body = phaseShape.partial().safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })
    const { data, error } = await supabase.from('phases').update(body.data).eq('id', phaseId).eq('project_id', projectId).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  // ── DELETE /projects/:projectId/phases/:phaseId ───────────────────────────
  app.delete('/:projectId/phases/:phaseId', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { projectId, phaseId } = req.params as any
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertPhaseInWorkspace(phaseId, user.workspaceId, reply)) return

    await supabase.from('phases').delete().eq('id', phaseId).eq('project_id', projectId)
    return reply.status(200).send({ data: { message: 'Phase deleted' } })
  })

  // ── GET /projects/:projectId/tasks ────────────────────────────────────────
  app.get('/:projectId/tasks', async (req, reply) => {
    const user = (req as any).user
    const { projectId } = req.params as { projectId: string }
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return

    const { data: phases } = await supabase.from('phases').select('id').eq('project_id', projectId)
    const phaseIds = (phases || []).map((p: any) => p.id)
    if (!phaseIds.length) return reply.status(200).send({ data: [] })

    const { data, error } = await supabase
      .from('tasks')
      .select(`*, task_assignees(*, users(id, name, avatar_url, job_title)), time_entries(id, hours, billable, user_id, date, note)`)
      .in('phase_id', phaseIds)
      .order('sort_order')

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  // ── POST /projects/:projectId/tasks ───────────────────────────────────────
  app.post('/:projectId/tasks', async (req, reply) => {
    const user = (req as any).user
    const { projectId } = req.params as { projectId: string }
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return

    const body = taskSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })

    // The phase_id in the body must also belong to this project (and therefore workspace).
    const { data: phaseRow } = await supabase
      .from('phases').select('id').eq('id', body.data.phase_id).eq('project_id', projectId).maybeSingle()
    if (!phaseRow) return reply.status(404).send({ errors: [{ code: 'PHASE_NOT_IN_PROJECT' }] })

    // Inherit billable from parent project when not explicitly provided (Apr 9 meeting)
    const { assignee_ids, ...taskData } = body.data
    if (taskData.billable === undefined) {
      const { data: proj } = await supabase.from('projects').select('billable').eq('id', projectId).single()
      taskData.billable = proj?.billable !== false  // default true if column missing
    }

    const { data: task, error } = await supabase.from('tasks').insert(taskData).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })

    // Collaborators always get auto-assigned to their own tasks.
    // Admins can assign to anyone — but only users in the same workspace.
    let finalAssignees: string[] = []
    if (user.profile === 'collaborator') {
      finalAssignees = [user.id]
    } else if (assignee_ids?.length) {
      const { data: validUsers } = await supabase
        .from('users').select('id').in('id', assignee_ids).eq('workspace_id', user.workspaceId)
      finalAssignees = (validUsers || []).map((u: any) => u.id)
    }
    if (finalAssignees.length) {
      await supabase.from('task_assignees').insert(finalAssignees.map((uid: string) => ({ task_id: task.id, user_id: uid })))
    }

    const { data: full } = await supabase
      .from('tasks')
      .select('*, task_assignees(*, users(id, name, avatar_url, job_title))')
      .eq('id', task.id).single()
    return reply.status(201).send({ data: full })
  })

  // ── PATCH /projects/:projectId/tasks/:taskId ──────────────────────────────
  app.patch('/:projectId/tasks/:taskId', async (req, reply) => {
    const user = (req as any).user
    const { projectId, taskId } = req.params as any
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertTaskInWorkspace(taskId, user.workspaceId, reply)) return

    // Partial update — derive from the unrefined shape. Dropping cross-field
    // refinement here is intentional (see PATCH phase handler above for
    // the same reasoning). `phase_id` is omitted so tasks can't be moved
    // between phases via this endpoint; that would need a dedicated reorder /
    // move API.
    const body = taskShape.omit({ phase_id: true }).partial().safeParse(req.body)
    if (!body.success) return reply.status(400).send({ errors: body.error.issues })

    const { assignee_ids, ...taskData } = body.data

    // Stamp every in-app edit so the Forecast.it sync can tell local edits
    // apart from unsynced rows and not overwrite them. See syncTasks in
    // apps/user-service/src/lib/forecastSync.ts for the gate.
    const nowIso = new Date().toISOString()

    if (user.profile === 'collaborator') {
      // Status change: only allowed if this collaborator is assigned to the task
      if (taskData.status !== undefined) {
        const { data: assignment } = await supabase
          .from('task_assignees')
          .select('user_id')
          .eq('task_id', taskId)
          .eq('user_id', user.id)
          .single()

        if (!assignment) {
          return reply.status(403).send({
            errors: [{ code: 'FORBIDDEN', message: 'You can only change the status of tasks assigned to you.' }]
          })
        }
        await supabase.from('tasks').update({ status: taskData.status, locally_edited_at: nowIso }).eq('id', taskId)
      }

      // Collaborators can only add/remove themselves as assignee
      if (assignee_ids !== undefined) {
        await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', user.id)
        if (assignee_ids.includes(user.id)) {
          await supabase.from('task_assignees').upsert({ task_id: taskId, user_id: user.id }, { onConflict: 'task_id,user_id' })
        }
      }
    } else {
      // Admin: full update
      const { error } = await supabase.from('tasks').update({ ...taskData, locally_edited_at: nowIso }).eq('id', taskId)
      if (error) return reply.status(500).send({ errors: [{ message: error.message }] })

      if (assignee_ids !== undefined) {
        await supabase.from('task_assignees').delete().eq('task_id', taskId)
        if (assignee_ids.length) {
          // Validate all assignees are in workspace before insert
          const { data: validUsers } = await supabase
            .from('users').select('id').in('id', assignee_ids).eq('workspace_id', user.workspaceId)
          const valid = (validUsers || []).map((u: any) => u.id)
          if (valid.length) {
            await supabase.from('task_assignees').insert(valid.map((uid: string) => ({ task_id: taskId, user_id: uid })))
          }
        }
      }
    }

    const { data: full } = await supabase
      .from('tasks')
      .select('*, task_assignees(*, users(id, name, avatar_url, job_title)), time_entries(hours, billable, user_id, date)')
      .eq('id', taskId).single()
    return reply.status(200).send({ data: full })
  })

  // ── DELETE /projects/:projectId/tasks/:taskId ─────────────────────────────
  app.delete('/:projectId/tasks/:taskId', async (req, reply) => {
    const user = (req as any).user
    if (user.profile === 'collaborator') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { projectId, taskId } = req.params as any
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertTaskInWorkspace(taskId, user.workspaceId, reply)) return

    await supabase.from('tasks').delete().eq('id', taskId)
    return reply.status(200).send({ data: { message: 'Task deleted' } })
  })

  // ── POST /projects/:projectId/phases/:phaseId/tasks/reorder ──────────────────
  app.post('/:projectId/phases/:phaseId/tasks/reorder', async (req, reply) => {
    const user = (req as any).user
    if (!['super_admin','admin','account_manager'].includes(user.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }
    const { projectId, phaseId } = req.params as any
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertPhaseInWorkspace(phaseId, user.workspaceId, reply)) return

    const { items } = req.body as { items: { id: string; sort_order: number }[] }
    if (!Array.isArray(items)) return reply.status(400).send({ errors: [{ code: 'INVALID_BODY' }] })

    // Only reorder tasks that actually belong to this phase (defense in depth)
    const itemIds = items.map(i => i.id)
    const { data: validTasks } = await supabase.from('tasks').select('id').in('id', itemIds).eq('phase_id', phaseId)
    const validIds = new Set((validTasks || []).map((t: any) => t.id))

    await Promise.all(items.filter(i => validIds.has(i.id)).map(({ id, sort_order }) =>
      supabase.from('tasks').update({ sort_order }).eq('id', id).eq('phase_id', phaseId)
    ))
    return reply.status(200).send({ data: { message: 'Reordered' } })
  })

  // ── POST /projects/:projectId/tasks/:taskId/assignees ─────────────────────
  app.post('/:projectId/tasks/:taskId/assignees', async (req, reply) => {
    const user = (req as any).user
    const { projectId, taskId } = req.params as any
    const { userIds } = req.body as { userIds: string[] }
    if (!Array.isArray(userIds)) return reply.status(400).send({ errors: [{ code: 'INVALID_BODY' }] })
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertTaskInWorkspace(taskId, user.workspaceId, reply)) return

    if (user.profile === 'collaborator') {
      if (!userIds.includes(user.id)) {
        return reply.status(403).send({ errors: [{ code: 'FORBIDDEN', message: 'Collaborators can only assign themselves.' }] })
      }
      await supabase.from('task_assignees').upsert({ task_id: taskId, user_id: user.id }, { onConflict: 'task_id,user_id' })
    } else {
      // Validate all assignees are in workspace
      const { data: validUsers } = await supabase
        .from('users').select('id').in('id', userIds).eq('workspace_id', user.workspaceId)
      for (const u of validUsers || []) {
        await supabase.from('task_assignees').upsert({ task_id: taskId, user_id: (u as any).id }, { onConflict: 'task_id,user_id' })
      }
    }

    const { data } = await supabase.from('tasks').select('*, task_assignees(*, users(id, name, avatar_url, job_title))').eq('id', taskId).single()
    return reply.status(200).send({ data })
  })

  // ── DELETE /projects/:projectId/tasks/:taskId/assignees/:userId ───────────
  app.delete('/:projectId/tasks/:taskId/assignees/:userId', async (req, reply) => {
    const user = (req as any).user
    const { projectId, taskId, userId } = req.params as any
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertTaskInWorkspace(taskId, user.workspaceId, reply)) return

    if (user.profile === 'collaborator' && userId !== user.id) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN', message: 'Collaborators can only remove themselves.' }] })
    }
    await supabase.from('task_assignees').delete().eq('task_id', taskId).eq('user_id', userId)
    return reply.status(200).send({ data: { message: 'Assignee removed' } })
  })

  // ── GET /projects/:projectId/tasks/:taskId/comments ────────────────────────
  app.get('/:projectId/tasks/:taskId/comments', async (req, reply) => {
    const user = (req as any).user
    const { projectId, taskId } = req.params as any
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertTaskInWorkspace(taskId, user.workspaceId, reply)) return

    const { data, error } = await supabase
      .from('task_comments')
      .select('*, users(id, name, job_title, avatar_url)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  // ── POST /projects/:projectId/tasks/:taskId/comments ──────────────────────
  app.post('/:projectId/tasks/:taskId/comments', async (req, reply) => {
    const user = (req as any).user
    const { projectId, taskId } = req.params as any
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertTaskInWorkspace(taskId, user.workspaceId, reply)) return

    const { body } = req.body as any
    if (!body?.trim()) return reply.status(400).send({ errors: [{ code: 'MISSING_BODY' }] })
    const { data, error } = await supabase
      .from('task_comments')
      .insert({ task_id: taskId, user_id: user.id, body: body.trim().slice(0, 5000) })
      .select('*, users(id, name, job_title, avatar_url)')
      .single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  // ── DELETE /projects/:projectId/tasks/:taskId/comments/:commentId ──────────
  app.delete('/:projectId/tasks/:taskId/comments/:commentId', async (req, reply) => {
    const user = (req as any).user
    const { projectId, taskId, commentId } = req.params as any
    if (!await assertProjectInWorkspace(projectId, user.workspaceId, reply)) return
    if (!await assertTaskInWorkspace(taskId, user.workspaceId, reply)) return

    const { data: comment } = await supabase
      .from('task_comments')
      .select('user_id, task_id')
      .eq('id', commentId)
      .eq('task_id', taskId)
      .maybeSingle()
    if (!comment) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    if (comment.user_id !== user.id && !['super_admin','admin'].includes(user.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }
    await supabase.from('task_comments').delete().eq('id', commentId)
    return reply.status(200).send({ data: { message: 'Deleted' } })
  })
}
