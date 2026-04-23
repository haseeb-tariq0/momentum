import { supabase } from '@forecast/db'
import type { FastifyReply } from 'fastify'

/**
 * Workspace boundary helpers. Every route that takes an entity ID from the URL
 * MUST validate that the entity belongs to the caller's workspace, otherwise
 * any admin can read/mutate data from another workspace by guessing UUIDs.
 *
 * Each helper sends a 404 (not 403, to avoid leaking existence) and returns
 * `false` if the boundary check fails — callers should `return` immediately.
 */

export async function assertProjectInWorkspace(
  projectId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!projectId || !workspaceId) {
    reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] })
    return false
  }
  const { data } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!data) {
    reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return false
  }
  return true
}

export async function assertPhaseInWorkspace(
  phaseId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!phaseId || !workspaceId) {
    reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] })
    return false
  }
  const { data } = await supabase
    .from('phases')
    .select('id, projects!inner(workspace_id, deleted_at)')
    .eq('id', phaseId)
    .maybeSingle()
  const proj = (data as any)?.projects
  if (!data || !proj || proj.workspace_id !== workspaceId || proj.deleted_at) {
    reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return false
  }
  return true
}

export async function assertTaskInWorkspace(
  taskId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!taskId || !workspaceId) {
    reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] })
    return false
  }
  const { data } = await supabase
    .from('tasks')
    .select('id, phases!inner(projects!inner(workspace_id, deleted_at))')
    .eq('id', taskId)
    .maybeSingle()
  const proj = (data as any)?.phases?.projects
  if (!data || !proj || proj.workspace_id !== workspaceId || proj.deleted_at) {
    reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return false
  }
  return true
}

export async function assertUserInWorkspace(
  userId: string,
  workspaceId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!userId || !workspaceId) {
    reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] })
    return false
  }
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!data) {
    reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return false
  }
  return true
}
