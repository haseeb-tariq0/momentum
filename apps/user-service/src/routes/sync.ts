import type { FastifyInstance } from 'fastify'
import { supabase } from '@forecast/db'
import { runIncrementalSync, type SyncResult } from '../lib/forecastSync.js'

// In-flight lock to prevent overlapping runs (per workspace).
const inFlight = new Set<string>()

function isAdmin(profile: string) {
  return profile === 'super_admin' || profile === 'admin'
}

async function getForecastKey(workspaceId: string): Promise<string | null> {
  // Prefer per-workspace key stored in workspaces.sync_state.forecast_api.apiKey;
  // fall back to the FORECAST_API_KEY env var for single-tenant setup.
  const { data } = await supabase
    .from('workspaces')
    .select('sync_state')
    .eq('id', workspaceId)
    .single()
  const perWs = (data?.sync_state as any)?.forecast_api?.apiKey
  return perWs || process.env.FORECAST_API_KEY || null
}

export async function syncRoutes(app: FastifyInstance) {
  // ── GET /sync/status ──────────────────────────────────────────────────────
  app.get('/status', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const { data } = await supabase
      .from('workspaces')
      .select('sync_state')
      .eq('id', user.workspaceId)
      .single()
    const fa = ((data?.sync_state as any)?.forecast_api) || {}
    const hasKey = !!(fa.apiKey || process.env.FORECAST_API_KEY)
    const inProgress = inFlight.has(user.workspaceId)
    return reply.status(200).send({
      data: {
        enabled:    hasKey,
        inProgress,
        intervalMs: 5 * 60 * 1000,
        entities:   {
          persons:      fa.persons      || null,
          clients:      fa.clients      || null,
          projects:     fa.projects     || null,
          phases:       fa.phases       || null,
          tasks:        fa.tasks        || null,
          time_entries: fa.time_entries || null,
        },
      },
    })
  })

  // ── POST /sync/run-now ────────────────────────────────────────────────────
  app.post('/run-now', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const apiKey = await getForecastKey(user.workspaceId)
    if (!apiKey) return reply.status(400).send({ errors: [{ code: 'NO_API_KEY', message: 'FORECAST_API_KEY not configured' }] })

    if (inFlight.has(user.workspaceId)) {
      return reply.status(409).send({ errors: [{ code: 'ALREADY_RUNNING', message: 'A sync is already in progress' }] })
    }

    inFlight.add(user.workspaceId)
    try {
      const result = await runIncrementalSync(apiKey, user.workspaceId)
      return reply.status(200).send({ data: result })
    } catch (e: any) {
      return reply.status(500).send({ errors: [{ message: e?.message || 'sync failed' }] })
    } finally {
      inFlight.delete(user.workspaceId)
    }
  })

  // ── POST /sync/run-full-tasks ─────────────────────────────────────────────
  // One-shot backfill — ignores the 24h updated_at gate on tasks + phases so
  // every row gets reconciled against Forecast. Needed because the snapshot
  // importer seeded statuses from a `approved + remaining/estimate` heuristic,
  // which doesn't match Forecast's actual workflow_column.category truth.
  // Run this once after deploying new sync code to correct historical statuses.
  // Expected cost: ~3–5 min (full 53k-task pagination + 1,184 UPDATEs).
  app.post('/run-full-tasks', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    const apiKey = await getForecastKey(user.workspaceId)
    if (!apiKey) return reply.status(400).send({ errors: [{ code: 'NO_API_KEY', message: 'FORECAST_API_KEY not configured' }] })

    if (inFlight.has(user.workspaceId)) {
      return reply.status(409).send({ errors: [{ code: 'ALREADY_RUNNING', message: 'A sync is already in progress' }] })
    }

    inFlight.add(user.workspaceId)
    try {
      const result = await runIncrementalSync(apiKey, user.workspaceId, { fullResyncTasksPhases: true })
      return reply.status(200).send({ data: result })
    } catch (e: any) {
      return reply.status(500).send({ errors: [{ message: e?.message || 'sync failed' }] })
    } finally {
      inFlight.delete(user.workspaceId)
    }
  })
}

// ── Background scheduler ─────────────────────────────────────────────────────
// Runs every 5 minutes for every active workspace that has an API key.
// Uses the same in-flight lock as the manual endpoint so a user-triggered sync
// and the scheduler never overlap on the same workspace.
let schedulerStarted = false
let schedulerHandle: ReturnType<typeof setInterval> | null = null

export function startSyncScheduler() {
  if (schedulerStarted) return
  schedulerStarted = true

  const INTERVAL_MS = 5 * 60 * 1000  // 5 min

  async function tick() {
    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id, sync_state')
      .is('deleted_at', null)

    for (const ws of workspaces || []) {
      const wid = (ws as any).id as string
      const fa = ((ws as any).sync_state?.forecast_api) || {}
      const apiKey = fa.apiKey || process.env.FORECAST_API_KEY
      if (!apiKey) continue
      if (inFlight.has(wid)) { console.log(`[sync] skip ${wid}: already in flight`); continue }

      inFlight.add(wid)
      try {
        const r: SyncResult = await runIncrementalSync(apiKey, wid)
        const summary = Object.entries(r.entities).map(([k, v]) => `${k}=${(v as any).upserted}/${(v as any).changed}`).join(' ')
        console.log(`[sync] ${wid}: ${r.durationMs}ms ${summary}`)
      } catch (e: any) {
        console.warn(`[sync] ${wid} failed: ${e?.message || e}`)
      } finally {
        inFlight.delete(wid)
      }
    }
  }

  // Fire once on startup (after a short delay so the service finishes booting),
  // then every 5 minutes.
  setTimeout(() => {
    tick().catch(e => console.warn('[sync] initial tick failed:', e?.message))
    schedulerHandle = setInterval(() => {
      tick().catch(e => console.warn('[sync] tick failed:', e?.message))
    }, INTERVAL_MS)
  }, 30_000)  // 30s boot delay
}

export function stopSyncScheduler() {
  if (schedulerHandle) { clearInterval(schedulerHandle); schedulerHandle = null }
  schedulerStarted = false
}
