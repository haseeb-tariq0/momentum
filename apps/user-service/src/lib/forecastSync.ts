import { supabase } from '@forecast/db'

const FORECAST_V1 = 'https://api.forecast.it/api/v1'
const FORECAST_V4 = 'https://api.forecast.it/api/v4'

// Forecast's /time_registrations?updated_after expects DDMMYYYYTHHMMSS in UTC.
// Other endpoints ignore updated_after silently — for those we filter client-side
// by comparing the row's `updated_at` against our last sync timestamp.
function fmtForecastTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    pad(d.getUTCDate()) +
    pad(d.getUTCMonth() + 1) +
    d.getUTCFullYear() +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  )
}

async function fGet(apiKey: string, path: string): Promise<any> {
  const res = await fetch(`${FORECAST_V1}${path}`, {
    headers: { 'X-FORECAST-API-KEY': apiKey },
    signal: AbortSignal.timeout(60_000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error('Forecast API key invalid or expired')
  }
  if (!res.ok) throw new Error(`Forecast ${path} → ${res.status}`)
  return res.json()
}

// v4 tasks/phases are the only endpoints that return these resources in full.
// They return a paged envelope: { pageContents, pageNumber, pageSize, totalObjectCount }.
// Neither honors `updated_after` server-side — we paginate everything and filter in JS.
async function fGetAllV4(apiKey: string, path: string, pageSize = 500): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const url = `${FORECAST_V4}${path}${sep}pageSize=${pageSize}&pageNumber=${page}`
    const res = await fetch(url, {
      headers: { 'X-FORECAST-API-KEY': apiKey },
      signal: AbortSignal.timeout(120_000),
    })
    if (res.status === 401 || res.status === 403) throw new Error('Forecast API key invalid or expired')
    if (!res.ok) throw new Error(`Forecast v4 ${path} → ${res.status}`)
    const body: any = await res.json()
    const pc: any[] = Array.isArray(body?.pageContents) ? body.pageContents : []
    out.push(...pc)
    // Stop when the last page is partial or empty. totalObjectCount is a belt-and-braces
    // guard against a server that keeps returning full pages past the dataset end.
    if (pc.length < pageSize) break
    const total = Number(body?.totalObjectCount || 0)
    if (total > 0 && out.length >= total) break
  }
  return out
}

type EntityResult = {
  pulled:    number
  changed:   number
  upserted:  number
  errors:    number
}

export type SyncResult = {
  startedAt: string
  finishedAt: string
  durationMs: number
  entities: Record<string, EntityResult>
  error: string | null
}

type SyncState = {
  forecast_api?: Record<string, { lastSyncAt?: string; lastResult?: any; lastError?: string | null }>
}

// Cap the "since" window at 24h. This serves two purposes:
//   1. First run (since=null) becomes a 24h delta instead of skipping writes
//      entirely — we catch changes made between the last full import and the
//      moment live-sync first runs.
//   2. If the service is offline for days, we don't try to replay a week of
//      changes in one tick. Anything older than 24h is assumed covered by the
//      full importer, which the admin runs manually.
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000
function effectiveSince(since: Date | null): Date {
  const floor = new Date(Date.now() - MAX_LOOKBACK_MS)
  if (!since || since < floor) return floor
  return since
}

async function loadSyncState(workspaceId: string): Promise<SyncState> {
  const { data } = await supabase
    .from('workspaces')
    .select('sync_state')
    .eq('id', workspaceId)
    .single()
  return (data?.sync_state || {}) as SyncState
}

async function saveSyncState(workspaceId: string, state: SyncState): Promise<void> {
  await supabase.from('workspaces').update({ sync_state: state }).eq('id', workspaceId)
}

async function syncPersons(apiKey: string, workspaceId: string, since: Date | null, roleNameById: Record<number, string>, deptMap: Record<number, string>): Promise<EntityResult> {
  const result: EntityResult = { pulled: 0, changed: 0, upserted: 0, errors: 0 }
  const rows = await fGet(apiKey, '/persons')
  if (!Array.isArray(rows)) return result
  result.pulled = rows.length

  // Cap the window at 24h — handles first-run and long-downtime safely.
  const cutoff = effectiveSince(since)

  // Pre-fetch existing users once so the match loop doesn't do N queries.
  const { data: existingUsers } = await supabase
    .from('users')
    .select('id, email, forecast_id')
    .eq('workspace_id', workspaceId)
    .range(0, 9999)
  const byEmail: Record<string, string> = {}
  const byFid:   Record<number, string> = {}
  for (const u of existingUsers || []) {
    if ((u as any).email) byEmail[String((u as any).email).toLowerCase()] = (u as any).id
    if ((u as any).forecast_id) byFid[(u as any).forecast_id] = (u as any).id
  }

  // Only import actual staff — exclude CLIENT (external client-portal logins)
  // and SYSTEM (API / Hubspot / Slack / Forecast Service User). Explicit
  // allow-list is safer than a deny-list: a new Forecast user_type won't
  // silently flood in.
  const STAFF_TYPES = new Set(['COLLABORATOR', 'CONTROLLER', 'ADMIN', 'MANAGER', 'COORDINATOR'])

  for (const p of rows) {
    if (p.user_type && !STAFF_TYPES.has(p.user_type)) continue
    const email = String(p.email || '').toLowerCase().trim()
    if (!email) continue
    const existingId = byFid[p.id] || byEmail[email] || null
    // The 24h cutoff only gates UPDATES. New rows (not in our DB yet) always
    // insert, regardless of how old their updated_at is — otherwise a project
    // created in Forecast 3 months ago and never touched since would be
    // invisible to NextTrack forever.
    if (existingId && (!p.updated_at || new Date(p.updated_at) <= cutoff)) continue
    result.changed++
    const patch: any = {
      name:         `${p.first_name||''} ${p.last_name||''}`.trim() || email,
      job_title:    (p.default_role && roleNameById[p.default_role]) || null,
      department_id: p.department_id ? (deptMap[p.department_id] || null) : null,
      active:       p.active !== false,
      start_date:   p.start_date || null,
      end_date:     p.end_date   || null,
      forecast_id:  p.id,
      deleted_at:   null,  // Forecast is source of truth — restore if locally deleted
    }
    if (p.weekly_capacity) patch.capacity_hrs = Math.round(p.weekly_capacity / 60)

    const { error } = existingId
      ? await supabase.from('users').update(patch).eq('id', existingId)
      : await supabase.from('users').insert({ ...patch, email, workspace_id: workspaceId, password_hash: process.env.IMPORT_DEFAULT_PASSWORD_HASH || '' })
    if (error) { result.errors++; console.warn(`[sync] person ${email}: ${error.message}`) }
    else result.upserted++
  }
  return result
}

async function syncClients(apiKey: string, workspaceId: string, since: Date | null): Promise<EntityResult> {
  const result: EntityResult = { pulled: 0, changed: 0, upserted: 0, errors: 0 }
  const rows = await fGet(apiKey, '/clients')
  if (!Array.isArray(rows)) return result
  result.pulled = rows.length
  const cutoff = effectiveSince(since)

  const { data: existingClients } = await supabase
    .from('clients')
    .select('id, name, forecast_id')
    .eq('workspace_id', workspaceId)
    .range(0, 9999)
  const byName: Record<string, string> = {}
  const byFid:  Record<number, string> = {}
  for (const c of existingClients || []) {
    if ((c as any).name) byName[String((c as any).name).toLowerCase()] = (c as any).id
    if ((c as any).forecast_id) byFid[(c as any).forecast_id] = (c as any).id
  }

  for (const c of rows) {
    const name = String(c.name || '').trim()
    if (!name) continue
    const existingId = byFid[c.id] || byName[name.toLowerCase()] || null
    if (existingId && (!c.updated_at || new Date(c.updated_at) <= cutoff)) continue
    result.changed++
    const patch = {
      name,
      country: c.country || null,
      address: [c.street, c.zip, c.city].filter(Boolean).join(', ') || null,
      forecast_id: c.id,
      deleted_at: null as string | null,
    }
    const { error } = existingId
      ? await supabase.from('clients').update(patch).eq('id', existingId)
      : await supabase.from('clients').insert({ ...patch, workspace_id: workspaceId, active: true })
    if (error) { result.errors++; console.warn(`[sync] client ${name}: ${error.message}`) }
    else result.upserted++
  }
  return result
}

function mapStatus(s: any): string {
  if (!s) return 'running'
  const x = String(s).toLowerCase()
  if (x === 'halted' || x === 'paused' || x === 'on hold') return 'halted'
  if (x === 'done' || x === 'closed' || x === 'archived' || x === 'completed') return 'done'
  if (x === 'opportunity' || x === 'prospect' || x === 'lead' || x === 'pipeline') return 'opportunity'
  if (x === 'planning' || x === 'pending' || x === 'not started' || x === 'upcoming') return 'planning'
  return 'running'
}

async function syncProjects(apiKey: string, workspaceId: string, since: Date | null, clientMap: Record<number, string>): Promise<EntityResult> {
  const result: EntityResult = { pulled: 0, changed: 0, upserted: 0, errors: 0 }
  const rows = await fGet(apiKey, '/projects')
  if (!Array.isArray(rows)) return result
  result.pulled = rows.length
  const cutoff = effectiveSince(since)

  // Pre-fetch projects once, paginated (we have 1,187+). Build fid → id map.
  const existingProjs: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from('projects')
      .select('id, forecast_id')
      .eq('workspace_id', workspaceId)
      .range(from, from + 999)
    const page = data || []
    existingProjs.push(...page)
    if (page.length < 1000) break
  }
  const byFid: Record<number, string> = {}
  for (const p of existingProjs) if ((p as any).forecast_id) byFid[(p as any).forecast_id] = (p as any).id

  // Note: we intentionally do NOT gate project updates on updated_at here.
  // Forecast sometimes doesn't bump updated_at when fields like end_date are
  // cleared, so a stale row in our DB could sit uncorrected forever if we only
  // updated rows with fresh updated_at. Instead we upsert every row every
  // cycle and rely on Supabase to be a no-op when values already match.
  for (const p of rows) {
    const name = String(p.name || '').trim()
    if (!name) continue
    const existingId = byFid[p.id] || null
    result.changed++

    // Forecast v1 returns dates as ISO strings on `start_date` / `end_date`.
    // The legacy `project_start_year/month/day` fields are always null on the
    // live API — they exist in the JSON snapshot format but not the live feed.
    const startDate = p.start_date || null
    const endDate   = p.end_date   || null

    const patch = {
      name,
      status:        mapStatus(p.stage),
      budget_amount: p.budget ?? null,
      currency:      p.currency || 'AED',
      client_id:     p.client ? (clientMap[p.client] || null) : null,
      start_date:    startDate,
      end_date:      endDate,
      forecast_id:   p.id,
      // If someone soft-deleted the row locally but Forecast still has it,
      // restore it — Forecast is the source of truth during migration.
      deleted_at:    null as string | null,
    }
    const { error } = existingId
      ? await supabase.from('projects').update(patch).eq('id', existingId)
      : await supabase.from('projects').insert({ ...patch, workspace_id: workspaceId })
    if (error) { result.errors++; console.warn(`[sync] project ${name}: ${error.message}`) }
    else result.upserted++
  }
  return result
}

// Fetch in bulk, paginated — pre-fetching all existing phases/tasks once is
// dramatically faster than re-querying per row.
async function fetchAllExisting(table: 'phases' | 'tasks', _workspaceId: string): Promise<any[]> {
  const out: any[] = []
  // Neither phases nor tasks have a workspace_id column — scope inherits via
  // phase→project→workspace (and task→phase→project→workspace). Single-tenant
  // migration, so we fetch all and rely on forecast_id uniqueness to avoid
  // cross-workspace collisions. If multi-tenant later, add a project_id
  // prefilter based on workspaceId's projects.
  //
  // For tasks, we also pull `status` so syncTasks can short-circuit updates
  // where the computed status already matches — 53k UPDATEs at 30-50ms each
  // is a 30-40 min round-trip total, most of them no-ops.
  for (let from = 0; ; from += 1000) {
    const q = table === 'phases'
      ? supabase.from('phases').select('id, forecast_id, project_id').range(from, from + 999)
      : supabase.from('tasks').select('id, forecast_id, phase_id, status').range(from, from + 999)
    const { data } = await q
    const page = data || []
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

async function syncPhases(
  apiKey: string, workspaceId: string, since: Date | null,
  projectMap: Record<number, string>,
  fullResync: boolean = false,
): Promise<EntityResult> {
  const result: EntityResult = { pulled: 0, changed: 0, upserted: 0, errors: 0 }
  const rows = await fGetAllV4(apiKey, '/phases')
  result.pulled = rows.length
  const cutoff = effectiveSince(since)

  const existing = await fetchAllExisting('phases', workspaceId)
  const byFid: Record<number, string> = {}
  for (const p of existing) if ((p as any).forecast_id) byFid[(p as any).forecast_id] = (p as any).id

  for (const p of rows) {
    const pid   = projectMap[p.project_id]
    if (!pid) continue  // phase belongs to a project we haven't synced
    const fid         = p.id
    const existingId  = byFid[fid] || null
    // Skip if existing and older than cutoff — client-side delta filter since
    // /v4/phases doesn't honor updated_after. fullResync bypasses the gate
    // for one-off backfills.
    if (!fullResync && existingId && (!p.updated_at || new Date(p.updated_at) <= cutoff)) continue
    result.changed++

    // phases has no workspace_id or deleted_at columns — scope inherits via project.
    const patch: any = {
      name:        p.name || 'Untitled Phase',
      start_date:  p.start_date || null,
      end_date:    p.end_date   || null,
      forecast_id: fid,
    }
    const { error } = existingId
      ? await supabase.from('phases').update(patch).eq('id', existingId)
      : await supabase.from('phases').insert({ ...patch, project_id: pid })
    if (error) { result.errors++; console.warn(`[sync] phase ${fid}: ${error.message}`) }
    else result.upserted++
  }
  return result
}

// Cache for workflow_column id → category per project. Populated lazily during
// task sync: we only fetch a project's column list if a task in that project
// actually changed this cycle (keeps the 1,184-project roster from being hit
// every sync when only a handful of tasks moved).
async function loadProjectColumns(
  apiKey: string,
  projectForecastId: number,
  cache: Map<number, Map<number, string>>,
): Promise<Map<number, string>> {
  const hit = cache.get(projectForecastId)
  if (hit) return hit
  try {
    const cols = await fGet(apiKey, `/projects/${projectForecastId}/workflow_columns`)
    const m = new Map<number, string>()
    if (Array.isArray(cols)) {
      for (const c of cols) if (c?.id && c?.category) m.set(c.id, String(c.category))
    }
    cache.set(projectForecastId, m)
    return m
  } catch (e: any) {
    console.warn(`[sync] workflow_columns ${projectForecastId}: ${e?.message || e}`)
    const empty = new Map<number, string>()
    cache.set(projectForecastId, empty)
    return empty
  }
}

// Map Forecast's workflow column category → our tasks.status enum.
// Categories observed: TODO, INPROGRESS, DONE, OPTIONALLY others.
// The DB enum uses 'todo' (no underscore) — see project-service/tasks.ts:29.
// The dashed "to_do" variant is wrong and the DB CHECK constraint will reject it.
function mapColumnCategory(category: string | undefined | null): 'todo' | 'in_progress' | 'done' {
  const c = String(category || '').toUpperCase()
  if (c === 'DONE')       return 'done'
  if (c === 'INPROGRESS') return 'in_progress'
  return 'todo'
}

// Find-or-create a synthetic "Tasks" phase for projects that have tasks with no
// milestone in Forecast (~20% of tasks — not an edge case). Ports the same pattern
// the snapshot importer uses (packages/db/import-from-snapshot.mjs:719): the
// synthetic phase's forecast_id is -project_fid so it can never collide with a
// real Forecast phase id (always positive).
//
// Our tasks.phase_id is NOT NULL, so without this bucket ~10,700 orphan tasks
// would be silently dropped on every sync.
async function getOrCreateDefaultPhase(
  projectForecastId: number,
  workspaceId: string,
  projectMap: Record<number, string>,
  defaultPhaseCache: Map<number, string>,
): Promise<string | null> {
  const hit = defaultPhaseCache.get(projectForecastId)
  if (hit) return hit
  const ourProjectId = projectMap[projectForecastId]
  if (!ourProjectId) return null

  const synthFid = -projectForecastId
  const { data: existing } = await supabase
    .from('phases')
    .select('id')
    .eq('forecast_id', synthFid)
    .limit(1)
    .maybeSingle()
  if (existing?.id) {
    defaultPhaseCache.set(projectForecastId, (existing as any).id)
    return (existing as any).id
  }
  const { data: created, error } = await supabase
    .from('phases')
    .insert({
      // phases has no workspace_id — scope inherits via project.
      project_id:   ourProjectId,
      name:         'Tasks',
      sort_order:   9999,
      forecast_id:  synthFid,
    })
    .select('id').single()
  if (error || !created) {
    console.warn(`[sync] default-phase ${projectForecastId}: ${error?.message || 'insert failed'}`)
    return null
  }
  defaultPhaseCache.set(projectForecastId, (created as any).id)
  return (created as any).id
}

async function syncTasks(
  apiKey: string, workspaceId: string, since: Date | null,
  projectMap: Record<number, string>, phaseMap: Record<number, string>,
  fullResync: boolean = false,
): Promise<EntityResult> {
  const result: EntityResult = { pulled: 0, changed: 0, upserted: 0, errors: 0 }
  const rows = await fGetAllV4(apiKey, '/tasks')
  result.pulled = rows.length
  const cutoff = effectiveSince(since)

  const existing = await fetchAllExisting('tasks', workspaceId)
  const byFid:       Record<number, string> = {}
  const statusByFid: Record<number, string> = {}
  for (const t of existing) {
    if ((t as any).forecast_id) {
      byFid[(t as any).forecast_id]       = (t as any).id
      statusByFid[(t as any).forecast_id] = (t as any).status
    }
  }

  // Lazy per-project column → category cache (see loadProjectColumns).
  const colCache = new Map<number, Map<number, string>>()
  // Lazy per-project synthetic "Tasks" phase cache for orphan-milestone tasks.
  const defaultPhaseCache = new Map<number, string>()

  for (const t of rows) {
    const existingId = byFid[t.id] || null
    // Client-side delta gate — /v4/tasks doesn't honor updated_after.
    // Skipped entirely on fullResync: used for one-off backfills to correct
    // statuses that were imported wrong from the snapshot (which used a
    // `approved`/`remaining` heuristic instead of workflow_column.category).
    if (!fullResync && existingId && (!t.updated_at || new Date(t.updated_at) <= cutoff)) continue

    // Resolve phase_id. Forecast uses `milestone` for phase reference.
    // When a task has no milestone (~20% of tasks), bucket it under a
    // synthetic "Tasks" phase per project so the row can actually insert
    // (tasks.phase_id is NOT NULL).
    let ourPhaseId: string | null = null
    if (t.milestone) {
      ourPhaseId = phaseMap[t.milestone] || null
    }
    if (!ourPhaseId && t.project_id && projectMap[t.project_id]) {
      ourPhaseId = await getOrCreateDefaultPhase(t.project_id, workspaceId, projectMap, defaultPhaseCache)
    }
    if (!ourPhaseId) continue  // no way to place this task (project unknown too)

    // Resolve workflow_column → our status enum. Only touches the network if
    // this project's columns haven't been cached yet in the current run.
    let status: 'todo' | 'in_progress' | 'done' = 'todo'
    if (t.workflow_column && t.project_id && projectMap[t.project_id]) {
      const cols = await loadProjectColumns(apiKey, t.project_id, colCache)
      status = mapColumnCategory(cols.get(t.workflow_column))
    }

    // Full-resync fast path: if the row exists and the only thing we reliably
    // know about drift is status (updated_at gate was already bypassed), skip
    // rows where status already matches. Avoids 50k+ no-op UPDATEs that turned
    // a theoretical 3-min job into a 45-min grind on the first run.
    //
    // Trade-off: we won't pick up drift in title/description/dates on a full
    // resync if the status is unchanged. That's fine — those fields are what
    // the normal 15-min delta path is for. Full resync is specifically a
    // status-correction backfill.
    if (fullResync && existingId && statusByFid[t.id] === status) continue

    result.changed++
    const patch: any = {
      phase_id:       ourPhaseId,
      title:          t.title || 'Untitled Task',
      description:    t.description || null,
      estimated_hrs:  t.estimate ? Number(t.estimate) / 60 : null,  // Forecast stores minutes
      status,
      billable:       !t.un_billable,
      start_date:     t.start_date || null,
      due_date:       t.end_date   || null,
      forecast_id:    t.id,
      // tasks has no deleted_at column — no soft-delete needed here.
    }
    const { error } = existingId
      ? await supabase.from('tasks').update(patch).eq('id', existingId)
      : await supabase.from('tasks').insert(patch)
    if (error) { result.errors++; console.warn(`[sync] task ${t.id}: ${error.message}`) }
    else result.upserted++
  }
  return result
}

async function syncTimeEntries(apiKey: string, workspaceId: string, since: Date | null, personMap: Record<number, string>): Promise<EntityResult> {
  const result: EntityResult = { pulled: 0, changed: 0, upserted: 0, errors: 0 }
  // This endpoint DOES support server-side updated_after (DDMMYYYYTHHMMSS format).
  // Cap at 24h so a long-downtime never triggers a massive pull.
  const from = effectiveSince(since)
  const rows = await fGet(apiKey, `/time_registrations?updated_after=${fmtForecastTime(from)}`)
  if (!Array.isArray(rows)) return result
  result.pulled = rows.length
  result.changed = rows.length  // All rows returned are already filtered by Forecast

  // Map task_id → our internal task_id. For now, we only sync entries for tasks
  // we already have locally (matched by forecast_id). Rows pointing to unknown
  // tasks are skipped — they'll import once the full task sync catches up.
  const taskFids = [...new Set(rows.map((e: any) => e.task).filter(Boolean))]
  const { data: existingTasks } = taskFids.length
    ? await supabase.from('tasks').select('id, forecast_id').in('forecast_id', taskFids as any[]).range(0, 9999)
    : { data: [] as any[] }
  const taskMap: Record<number, string> = {}
  for (const t of existingTasks || []) if ((t as any).forecast_id) taskMap[(t as any).forecast_id] = (t as any).id

  // Pre-fetch existing time_entries matching this batch's forecast_ids in one query.
  // time_entries has no workspace_id column — scope is inherited through task_id → task → phase → project.
  const fids = rows.map((e: any) => e.id).filter(Boolean)
  const { data: existingEntries } = fids.length
    ? await supabase.from('time_entries').select('id, forecast_id').in('forecast_id', fids as any[]).range(0, 9999)
    : { data: [] as any[] }
  const byFid: Record<number, string> = {}
  for (const t of existingEntries || []) if ((t as any).forecast_id) byFid[(t as any).forecast_id] = (t as any).id

  for (const e of rows) {
    const userId = e.person ? personMap[e.person] : null
    const taskId = e.task   ? taskMap[e.task]     : null
    if (!userId || !taskId) continue

    const patch: any = {
      user_id:      userId,
      task_id:      taskId,
      date:         e.date,
      hours:        Number(e.time_registered || 0) / 60,
      note:         e.notes || null,
      billable:     Number(e.billable_minutes_registered || 0) > 0,
      type:         e.task ? 'project' : 'internal_time',
      forecast_id:  e.id,
    }
    const existingId = byFid[e.id] || null
    const { error } = existingId
      ? await supabase.from('time_entries').update(patch).eq('id', existingId)
      : await supabase.from('time_entries').insert(patch)
    if (error) { result.errors++; console.warn(`[sync] time_entry ${e.id}: ${error.message}`) }
    else result.upserted++
  }
  return result
}

export async function runIncrementalSync(apiKey: string, workspaceId: string, options?: { fullResyncTasksPhases?: boolean }): Promise<SyncResult> {
  const startedAt = new Date()
  const state = await loadSyncState(workspaceId)
  const fa = state.forecast_api || {}

  // Build lookup maps we'll reuse across entity syncs
  const [{ data: depts }, { data: clients }, { data: persons }, rolesRaw] = await Promise.all([
    supabase.from('departments').select('id, forecast_id').eq('workspace_id', workspaceId).range(0, 9999),
    supabase.from('clients').select('id, forecast_id').eq('workspace_id', workspaceId).range(0, 9999),
    supabase.from('users').select('id, forecast_id').eq('workspace_id', workspaceId).range(0, 9999),
    fGet(apiKey, '/roles').catch(() => []),
  ])
  const deptMap: Record<number, string> = {}
  for (const d of depts || []) if ((d as any).forecast_id) deptMap[(d as any).forecast_id] = (d as any).id
  const clientMap: Record<number, string> = {}
  for (const c of clients || []) if ((c as any).forecast_id) clientMap[(c as any).forecast_id] = (c as any).id
  const personMap: Record<number, string> = {}
  for (const p of persons || []) if ((p as any).forecast_id) personMap[(p as any).forecast_id] = (p as any).id
  const roleNameById: Record<number, string> = {}
  for (const r of (rolesRaw || []) as any[]) if (r?.id) roleNameById[r.id] = String(r.name || '').trim()

  const out: SyncResult = {
    startedAt:  startedAt.toISOString(),
    finishedAt: '',
    durationMs: 0,
    entities:   {},
    error:      null,
  }

  const runEntity = async (name: string, fn: () => Promise<EntityResult>) => {
    const since = fa[name]?.lastSyncAt ? new Date(new Date(fa[name].lastSyncAt!).getTime() - 60_000) : null
    try {
      const r = await fn()
      out.entities[name] = r
      fa[name] = { lastSyncAt: startedAt.toISOString(), lastResult: r, lastError: null }
    } catch (e: any) {
      const err = e?.message || String(e)
      out.entities[name] = { pulled: 0, changed: 0, upserted: 0, errors: 1 }
      fa[name] = { ...fa[name], lastError: err }
      console.warn(`[sync] ${name} failed: ${err}`)
    }
  }

  // Order matters: persons/clients first (projects reference clients; tasks
  // reference phases reference projects; time_entries reference persons+tasks).
  //
  // Tasks and phases skip every cycle if the last sync was within TASKS_MIN_GAP_MS —
  // /v4/tasks and /v4/phases have no server-side delta, and a full pagination
  // pass is heavy (~26MB across 107 pages for tasks). Gating to every 15
  // minutes keeps bandwidth sane while still picking up status changes fast
  // enough for testers to notice.
  const TASKS_MIN_GAP_MS  = 15 * 60 * 1000
  const PHASES_MIN_GAP_MS = 15 * 60 * 1000

  await runEntity('persons',  () => syncPersons (apiKey, workspaceId, fa.persons?.lastSyncAt  ? new Date(new Date(fa.persons .lastSyncAt!).getTime() - 60_000) : null, roleNameById, deptMap))
  await runEntity('clients',  () => syncClients (apiKey, workspaceId, fa.clients?.lastSyncAt  ? new Date(new Date(fa.clients .lastSyncAt!).getTime() - 60_000) : null))

  // Refresh clientMap after new clients were inserted (so projects can resolve them)
  const { data: clients2 } = await supabase.from('clients').select('id, forecast_id').eq('workspace_id', workspaceId).range(0, 9999)
  for (const c of clients2 || []) if ((c as any).forecast_id) clientMap[(c as any).forecast_id] = (c as any).id

  await runEntity('projects', () => syncProjects(apiKey, workspaceId, fa.projects?.lastSyncAt ? new Date(new Date(fa.projects.lastSyncAt!).getTime() - 60_000) : null, clientMap))

  // Refresh projectMap + phaseMap after projects/phases sync so downstream entities resolve FKs.
  const { data: projects2 } = await supabase.from('projects').select('id, forecast_id').eq('workspace_id', workspaceId).range(0, 9999)
  const projectMap: Record<number, string> = {}
  for (const p of projects2 || []) if ((p as any).forecast_id) projectMap[(p as any).forecast_id] = (p as any).id

  // ── Phases ───────────────────────────────────────────────────────────────
  const fullResync = options?.fullResyncTasksPhases === true
  const phasesLastMs = fa.phases?.lastSyncAt ? new Date(fa.phases.lastSyncAt).getTime() : 0
  // fullResync bypasses both the 15-min cadence gate AND the internal 24h
  // updated_at filter — used to reconcile existing rows that have stale state.
  if (fullResync || Date.now() - phasesLastMs >= PHASES_MIN_GAP_MS) {
    await runEntity('phases', () => syncPhases(apiKey, workspaceId, fa.phases?.lastSyncAt ? new Date(new Date(fa.phases.lastSyncAt!).getTime() - 60_000) : null, projectMap, fullResync))
  } else {
    out.entities['phases'] = { pulled: 0, changed: 0, upserted: 0, errors: 0 }  // gated
  }

  // Rebuild phaseMap from DB (picks up any inserts from syncPhases above).
  // phases has no workspace_id — forecast_id uniqueness + single-tenant means
  // we can safely fetch all and rely on the FID→uuid mapping.
  const phaseMap: Record<number, string> = {}
  for (let from = 0; ; from += 1000) {
    const { data: ph } = await supabase.from('phases').select('id, forecast_id').range(from, from + 999)
    const page = ph || []
    for (const p of page) if ((p as any).forecast_id) phaseMap[(p as any).forecast_id] = (p as any).id
    if (page.length < 1000) break
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  const tasksLastMs = fa.tasks?.lastSyncAt ? new Date(fa.tasks.lastSyncAt).getTime() : 0
  if (fullResync || Date.now() - tasksLastMs >= TASKS_MIN_GAP_MS) {
    await runEntity('tasks', () => syncTasks(apiKey, workspaceId, fa.tasks?.lastSyncAt ? new Date(new Date(fa.tasks.lastSyncAt!).getTime() - 60_000) : null, projectMap, phaseMap, fullResync))
  } else {
    out.entities['tasks'] = { pulled: 0, changed: 0, upserted: 0, errors: 0 }  // gated
  }

  // Refresh personMap for time entries
  const { data: persons2 } = await supabase.from('users').select('id, forecast_id').eq('workspace_id', workspaceId).range(0, 9999)
  for (const p of persons2 || []) if ((p as any).forecast_id) personMap[(p as any).forecast_id] = (p as any).id

  await runEntity('time_entries', () => syncTimeEntries(apiKey, workspaceId, fa.time_entries?.lastSyncAt ? new Date(new Date(fa.time_entries.lastSyncAt!).getTime() - 60_000) : null, personMap))

  state.forecast_api = fa
  await saveSyncState(workspaceId, state)

  const finishedAt = new Date()
  out.finishedAt = finishedAt.toISOString()
  out.durationMs = finishedAt.getTime() - startedAt.getTime()
  return out
}
