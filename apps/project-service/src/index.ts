import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { projectRoutes }    from './routes/projects.js'
import { taskRoutes }       from './routes/tasks.js'
import { resourcingRoutes } from './routes/resourcing.js'
import { templateRoutes }   from './routes/templates.js'
import { supabase }         from '@forecast/db'

async function main() {
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 1_000_000 })
  await app.register(cors)
  app.addHook('onRequest', async (req) => {
    (req as any).user = {
      id:          req.headers['x-user-id']      as string,
      workspaceId: req.headers['x-workspace-id'] as string,
      profile:     req.headers['x-user-profile'] as string,
      seat:        req.headers['x-seat-type']    as string,
    }
  })
  await app.register(projectRoutes,    { prefix: '/projects' })
  await app.register(taskRoutes,       { prefix: '/projects' })
  await app.register(resourcingRoutes, { prefix: '/resourcing' })
  await app.register(templateRoutes,   { prefix: '/templates' })

  // ── Global search ─────────────────────────────────────────────────────────
  app.get('/search', async (req: any, reply: any) => {
    const user  = req.user
    const raw   = ((req.query as any).q || '').trim()
    if (raw.length < 2) return reply.status(200).send({ data: { projects:[], tasks:[], users:[] } })

    // Sanitize: PostgREST .or() filters use comma + paren syntax. Strip those
    // from user input so a search like `foo,bar)` cannot break out of the OR.
    const safe = raw.replace(/[,()*]/g, '').slice(0, 100)
    if (!safe) return reply.status(200).send({ data: { projects:[], tasks:[], users:[] } })
    const q = `%${safe}%`

    const { supabase } = await import('@forecast/db')
    const [{ data: projects }, { data: tasks }, { data: users }] = await Promise.all([
      supabase.from('projects').select('id, name, color, status, clients(name)')
        .eq('workspace_id', user.workspaceId)
        .is('deleted_at', null)
        .ilike('name', q).limit(8),
      // 🛡️ Tasks must be filtered by workspace via the project chain — was leaking cross-workspace
      supabase.from('tasks').select('id, title, status, due_date, phases!inner(id, name, projects!inner(id, name, color, workspace_id))')
        .eq('phases.projects.workspace_id', user.workspaceId)
        .ilike('title', q).limit(12),
      supabase.from('users').select('id, name, job_title, email, departments(name)')
        .eq('workspace_id', user.workspaceId).eq('active', true)
        .or(`name.ilike.${q},email.ilike.${q},job_title.ilike.${q}`)
        .limit(6),
    ])
    return reply.status(200).send({ data: { projects: projects||[], tasks: tasks||[], users: users||[] } })
  })
  app.get('/health', async () => ({ status: 'ok', service: 'project-service', version: 'v5-ws-enforce', ts: Date.now() }))
  const port = Number(process.env.PROJECT_SERVICE_PORT) || 3002
  // Bind to loopback only — gateway is the only public entry point.
  // Binding to 0.0.0.0 would let anyone on the network spoof x-user-id headers.
  await app.listen({ port, host: '127.0.0.1' })
  console.log(`✅ Project service → 127.0.0.1:${port} [v5-ws-enforce]`)
}
process.on('unhandledRejection', (err) => { console.error('[project-service] unhandledRejection:', err); process.exit(1) })
process.on('uncaughtException',  (err) => { console.error('[project-service] uncaughtException:',  err); process.exit(1) })

main().catch(e => { console.error(e); process.exit(1) })
