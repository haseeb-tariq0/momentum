import type { FastifyInstance } from 'fastify'
import { supabase } from '@forecast/db'
import { createHash } from 'crypto'
import { isGoogleSheetsConfigured, getServiceAccountEmail, readFinanceSheetRows, readSoftwareCostsRows } from '../lib/googleSheets.js'
import { nextClientCodes } from '../lib/clientCodes.js'

// ──────────────────────────────────────────────────────────────────────────────
// Finance row processing — shared between the XLSX upload endpoint and the
// Google Sheets sync endpoint. Both sources pass through identical normalization
// + hashing + upsert so dedup is consistent regardless of how rows arrived.
// ──────────────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
}

function normName(s: string) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseDateLoose(val: any): Date | null {
  if (!val) return null
  if (val instanceof Date) return val
  const s = String(val).trim()
  // DD.MM.YYYY or DD/MM/YYYY
  const m1 = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
  if (m1) {
    const [, d, mo, y] = m1
    const year = y.length === 2 ? 2000 + Number(y) : Number(y)
    return new Date(year, Number(mo) - 1, Number(d))
  }
  // ISO
  const dt = new Date(s)
  return isNaN(dt.getTime()) ? null : dt
}

function parseMonthCell(val: any, invoiceDate: any): string | null {
  // Prefer invoice_date year; fallback to current year
  let year = new Date().getFullYear()
  if (invoiceDate) {
    const d = parseDateLoose(invoiceDate)
    if (d) year = d.getFullYear()
  }
  if (typeof val === 'string') {
    const m = MONTHS[val.trim().toLowerCase()]
    if (m) return `${year}-${String(m).padStart(2,'0')}-01`
  }
  if (val instanceof Date) return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-01`
  return null
}

export type FinanceProcessResult = {
  totalRows:       number
  inserted:        number
  alreadyExisted:  number
  skippedNoClient: number
  skippedNoMonth:  number
  skippedNoAmount: number
  unmatched:       { name: string; count: number }[]
}

export async function processFinanceRows(
  incoming: any[],
  workspaceId: string,
  defaultCurrency = 'AED',
): Promise<FinanceProcessResult> {
  // Load all clients for this workspace to build name lookup
  const { data: clientsRaw } = await supabase
    .from('clients')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  const clientByName: Record<string, string> = {}
  for (const c of clientsRaw || []) clientByName[normName((c as any).name)] = (c as any).id

  const toInsert: any[] = []
  let skippedNoClient = 0
  let skippedNoMonth = 0
  let skippedNoAmount = 0
  const unmatchedSet = new Map<string, number>()

  for (const row of incoming) {
    // Prefer Column R mapped name (short, matches Forecast). Fall back to
    // Column D legal name only if R is blank — keeps old rows importable
    // while forcing new rows toward the canonical mapping. Old uploads that
    // pre-date the R column will use `row.client_name` which is still accepted.
    const rawClient = String(
      row.client_name_mapped || row.client_name_finance || row.client_name || ''
    ).trim()
    const month = parseMonthCell(row.month, row.invoice_date)
    const amount = Number(row.sales_amount)

    if (!month) { skippedNoMonth++; continue }
    if (!Number.isFinite(amount) || amount === 0) { skippedNoAmount++; continue }
    if (!rawClient) { skippedNoClient++; continue }

    const clientId = clientByName[normName(rawClient)] || null
    if (!clientId) {
      unmatchedSet.set(rawClient, (unmatchedSet.get(rawClient) || 0) + 1)
    }

    const invoiceDate = parseDateLoose(row.invoice_date)

    // Canonical hash for idempotent re-imports
    const canonical = JSON.stringify({
      m: month,
      inv: String(row.invoice_no || '').trim(),
      c: normName(rawClient),
      d: String(row.service_department || '').trim().toLowerCase(),
      cat: String(row.service_category || '').trim().toLowerCase(),
      amt: amount,
    })
    const hash = createHash('sha256').update(canonical).digest('hex')

    toInsert.push({
      workspace_id: workspaceId,
      client_id: clientId,
      month,
      invoice_date: invoiceDate ? invoiceDate.toISOString().slice(0, 10) : null,
      invoice_no: row.invoice_no != null ? String(row.invoice_no) : null,
      client_name_raw: rawClient,
      sales_person: row.sales_person || null,
      service_department: row.service_department || null,
      service_category: row.service_category || null,
      type: row.type || null,
      classification: row.classification || null,
      services_detail: row.services_detail || null,
      sales_amount: amount,
      third_party: Number.isFinite(Number(row.third_party)) ? Number(row.third_party) : null,
      advertising_budget: Number.isFinite(Number(row.advertising_budget)) ? Number(row.advertising_budget) : null,
      currency: row.currency || defaultCurrency,
      source_row_hash: hash,
    })
  }

  // Upsert in chunks (Supabase has a 1000-row limit per request)
  let inserted = 0
  let alreadyExisted = 0
  const CHUNK = 500
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('client_invoices')
      .upsert(chunk, { onConflict: 'workspace_id,source_row_hash', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(`DB error: ${error.message}`)
    const newRows = data?.length || 0
    inserted += newRows
    alreadyExisted += (chunk.length - newRows)
  }

  const unmatched = Array.from(unmatchedSet.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return {
    totalRows: incoming.length,
    inserted,
    alreadyExisted,
    skippedNoClient,
    skippedNoMonth,
    skippedNoAmount,
    unmatched,
  }
}

const FORECAST_BASE = 'https://api.forecast.it/api/v1'

async function fGet(apiKey: string, path: string) {
  const sep  = path.includes('?') ? '&' : '?'
  const res  = await fetch(`${FORECAST_BASE}${path}${sep}page_size=100`, {
    headers: { 'X-FORECAST-API-KEY': apiKey },
    signal: AbortSignal.timeout(30000),
  })
  if (res.status === 401 || res.status === 403) throw new Error(`Forecast API key invalid or expired — regenerate at app.forecast.it/admin/api-keys`)
  if (!res.ok) throw new Error(`Forecast ${path} → ${res.status}`)
  return res.json()
}

async function fGetAll(apiKey: string, path: string): Promise<any[]> {
  let page = 1, all: any[] = []
  while (true) {
    const sep  = path.includes('?') ? '&' : '?'
    const data = await fGet(apiKey, `${path}${sep}page_size=100&page=${page}`)
    if (!Array.isArray(data) || data.length === 0) break
    all = all.concat(data)
    if (data.length < 100) break
    page++
  }
  return all
}

function sse(raw: any, type: string, payload: object) {
  // Suppress write errors after the client has disconnected — otherwise
  // the import loop floods stderr with EPIPE.
  try { raw.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`) } catch { /* client gone */ }
}

// Default password hash for imported users — must come from env
// (`IMPORT_DEFAULT_PASSWORD_HASH` in .env.local). Never hardcode.
const DEFAULT_PW = process.env.IMPORT_DEFAULT_PASSWORD_HASH || ''
const COLORS     = ['#0D9488','#7C3AED','#2563EB','#D97706','#DC2626','#059669','#0891B2','#BE185D']

function mapStatus(s: any) {
  if (!s) return 'running'
  const x = String(s).toLowerCase()
  if (x === 'halted' || x === 'paused' || x === 'on hold') return 'halted'
  if (x === 'done' || x === 'closed' || x === 'archived' || x === 'completed') return 'done'
  if (x === 'opportunity' || x === 'prospect' || x === 'lead' || x === 'pipeline') return 'opportunity'
  if (x === 'planning' || x === 'pending' || x === 'not started' || x === 'upcoming') return 'planning'
  return 'running'
}

export async function importRoutes(app: FastifyInstance) {

  // ── POST /users/import/test ───────────────────────────────────────────────
  app.post('/import/test', async (req, reply) => {
    const caller = (req as any).user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }
    const { apiKey } = req.body as any
    if (!apiKey) return reply.status(400).send({ error: 'apiKey required' })
    try {
      // /whoami is broken on Forecast.it with API keys — use a lightweight persons call instead
      // Fetch just page 1 with 1 result to verify the key quickly (avoid paginating all data)
      const res = await fetch(`https://api.forecast.it/api/v1/persons?page_size=3&page=1`, {
        headers: { 'X-FORECAST-API-KEY': apiKey },
        signal: AbortSignal.timeout(10000),
      })
      if (res.status === 401 || res.status === 403) {
        return reply.status(200).send({ ok: false, error: 'API key invalid or expired — regenerate at app.forecast.it/admin/api-keys' })
      }
      if (!res.ok) {
        return reply.status(200).send({ ok: false, error: `Forecast returned ${res.status}` })
      }
      const persons = await res.json()
      if (!Array.isArray(persons)) {
        return reply.status(200).send({ ok: false, error: `Unexpected response from Forecast API` })
      }
      const firstUser = persons[0]
      const userName  = firstUser ? (`${firstUser.first_name||''} ${firstUser.last_name||''}`.trim() || firstUser.email) : 'Connected'
      // Return counts as estimates — actual counts come during import
      return reply.status(200).send({ ok: true, user: userName, counts: { persons: '?', clients: '?', projects: '?' } })
    } catch(e: any) {
      return reply.status(200).send({ ok: false, error: e.message })
    }
  })

  // ── POST /users/import/stream ─────────────────────────────────────────────
  // Streams import progress as newline-delimited JSON (SSE-style).
  // 🛡️ Workspace ID comes from the verified caller, NOT the request body —
  // otherwise an admin in WS A could import data into WS B.
  app.post('/import/stream', async (req, reply) => {
    const caller = (req as any).user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }
    if (!DEFAULT_PW) {
      return reply.status(500).send({ error: 'IMPORT_DEFAULT_PASSWORD_HASH env var is not set' })
    }

    const { apiKey, options } = req.body as any
    if (!apiKey) return reply.status(400).send({ error: 'apiKey required' })

    const wid = caller.workspaceId

    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    // Don't set Access-Control-Allow-Origin manually — gateway already handles CORS.
    reply.raw.flushHeaders()

    // Track client disconnect — set when the socket closes so the long
    // import loop can bail out instead of leaking DB queries.
    let aborted = false
    req.raw.on('close', () => { aborted = true })
    req.raw.on('error', () => { aborted = true })

    const send   = (type: string, msg: string, extra?: object) => sse(reply.raw, type, { msg, ...extra })
    const log    = (msg: string) => send('log', msg)
    const step   = (msg: string) => send('step', msg)
    const done   = (msg: string, counts?: object) => { sse(reply.raw, 'done', { msg, counts }); try { reply.raw.end() } catch {} }
    const fail   = (msg: string) => { sse(reply.raw, 'error', { msg }); try { reply.raw.end() } catch {} }

    const counts = { departments: 0, users: 0, clients: 0, projects: 0, phases: 0, tasks: 0 }

    try {
      // ── Test connection ──────────────────────────────────────────────────
      step('Testing Forecast API connection...')
      // /whoami has a Forecast.it-side bug with API key auth — use /persons instead
      const firstPersonArr = await fGet(apiKey, '/persons?page_size=1&page=1')
      const sampleUser = Array.isArray(firstPersonArr) ? firstPersonArr[0] : firstPersonArr
      log(`✅ Connected — Forecast API key valid (${sampleUser?.email || 'ok'})`)

      const deptMap:    Record<string, string> = {}
      const personMap:  Record<string, string> = {}
      const clientMap:  Record<string, string> = {}
      const projectMap: Record<string, string> = {}

      // ── Departments ──────────────────────────────────────────────────────
      if (options?.departments !== false) {
        if (aborted) return
        step('Importing departments...')
        const fDepts = await fGetAll(apiKey, '/departments')
        const { data: dbDepts } = await supabase.from('departments').select('id,name').eq('workspace_id', wid)
        const byName: Record<string, string> = Object.fromEntries((dbDepts||[]).map((d: any) => [d.name.toLowerCase(), d.id]))

        for (const d of fDepts) {
          if (aborted) return
          const name = (d.name||'').trim()
          if (!name) continue
          if (byName[name.toLowerCase()]) { deptMap[d.id] = byName[name.toLowerCase()]; continue }
          const { data } = await supabase.from('departments').insert({ name, workspace_id: wid }).select('id').single()
          if (data) { deptMap[d.id] = data.id; byName[name.toLowerCase()] = data.id; counts.departments++ }
        }
        log(`✅ Departments: ${counts.departments} new, ${fDepts.length - counts.departments} existing`)
      }

      // ── Persons ───────────────────────────────────────────────────────────
      if (options?.users !== false) {
        if (aborted) return
        step('Importing team members...')
        const fPersons = await fGetAll(apiKey, '/persons')
        log(`   Found ${fPersons.length} people in Forecast`)
        // Forecast stores job titles as "roles" referenced by person.default_role (an int id)
        const fRoles = await fGetAll(apiKey, '/roles')
        const roleNameById: Record<number, string> = {}
        for (const r of fRoles) if (r?.id && r?.name) roleNameById[r.id] = String(r.name).trim()
        const { data: dbUsers } = await supabase.from('users').select('id,email').eq('workspace_id', wid)
        const byEmail: Record<string, string> = Object.fromEntries((dbUsers||[]).map((u: any) => [u.email.toLowerCase(), u.id]))

        for (const p of fPersons) {
          if (aborted) return
          const email = (p.email||'').toLowerCase().trim()
          if (!email) continue
          if (byEmail[email]) { personMap[p.id] = byEmail[email]; continue }
          const { data, error } = await supabase.from('users').insert({
            workspace_id:       wid,
            email,
            name:               `${p.first_name||''} ${p.last_name||''}`.trim() || email,
            job_title:          (p.default_role && roleNameById[p.default_role]) || null,
            permission_profile: p.is_admin ? 'admin' : 'collaborator',
            seat_type:          p.is_core_user ? 'core' : 'collaborator',
            department_id:      p.department_id ? (deptMap[p.department_id] || null) : null,
            capacity_hrs:       p.weekly_capacity ? Math.round(p.weekly_capacity / 60) : 40,
            active:             p.active !== false,
            start_date:         p.start_date || null,
            end_date:           p.end_date   || null,
            password_hash:      DEFAULT_PW,
          }).select('id').single()
          if (!error && data) { personMap[p.id] = data.id; byEmail[email] = data.id; counts.users++ }
          else if (error) log(`   ⚠️  ${email}: ${error.message}`)
        }
        log(`✅ Team members: ${counts.users} new, ${fPersons.length - counts.users} existing`)
      }

      // ── Clients ───────────────────────────────────────────────────────────
      if (options?.clients !== false) {
        if (aborted) return
        step('Importing clients...')
        const fClients = await fGetAll(apiKey, '/clients')
        const { data: dbClients } = await supabase.from('clients').select('id,name').eq('workspace_id', wid)
        const byName: Record<string, string> = Object.fromEntries((dbClients||[]).map((c: any) => [c.name.toLowerCase(), c.id]))

        // Pre-allocate one ID per new client so codes stay contiguous.
        const newNames = fClients
          .map((c: any) => (c.name || '').trim())
          .filter((n: string) => n && !byName[n.toLowerCase()])
        const allocatedCodes = await nextClientCodes(wid, newNames.length)
        let codeIdx = 0
        for (const c of fClients) {
          const name = (c.name||'').trim()
          if (!name) continue
          if (byName[name.toLowerCase()]) { clientMap[c.id] = byName[name.toLowerCase()]; continue }
          const { data } = await supabase.from('clients')
            .insert({ name, workspace_id: wid, client_code: allocatedCodes[codeIdx++] })
            .select('id').single()
          if (data) { clientMap[c.id] = data.id; byName[name.toLowerCase()] = data.id; counts.clients++ }
        }
        log(`✅ Clients: ${counts.clients} new, ${fClients.length - counts.clients} existing`)
      }

      // ── Projects ──────────────────────────────────────────────────────────
      if (options?.projects !== false) {
        if (aborted) return
        step('Importing projects...')
        const fProjects = await fGetAll(apiKey, '/projects')
        log(`   Found ${fProjects.length} projects in Forecast`)
        const { data: dbProjects } = await supabase.from('projects').select('id,name').eq('workspace_id', wid).is('deleted_at', null)
        const byName: Record<string, string> = Object.fromEntries((dbProjects||[]).map((p: any) => [p.name.toLowerCase(), p.id]))

        for (let i = 0; i < fProjects.length; i++) {
          if (aborted) return
          const p    = fProjects[i]
          const name = (p.name||'').trim()
          if (!name) continue
          if (byName[name.toLowerCase()]) { projectMap[p.id] = byName[name.toLowerCase()]; continue }

          // Forecast v1 uses ISO-string `start_date` / `end_date` on the live feed.
          // The integer `project_start_year/month/day` fields only exist in the
          // JSON snapshot format, not the live API — reading them here always
          // produced null, silently wiping real dates.
          const startDate = p.start_date || null
          const endDate   = p.end_date   || null

          const { data } = await supabase.from('projects').insert({
            workspace_id: wid, name,
            status:       mapStatus(p.stage),
            color:        COLORS[i % COLORS.length],
            budget_type:  'fixed_price',
            budget_amount: p.budget || null,
            currency:     p.currency || 'AED',
            client_id:    p.client ? (clientMap[p.client] || null) : null,
            start_date:   startDate,
            end_date:     endDate,
          }).select('id').single()

          if (data) {
            projectMap[p.id] = data.id
            byName[name.toLowerCase()] = data.id
            counts.projects++
            if (counts.projects % 25 === 0) log(`   ... ${counts.projects} projects imported`)
          }
        }
        log(`✅ Projects: ${counts.projects} new, ${fProjects.length - counts.projects} existing`)

        // ── Phases & Tasks ─────────────────────────────────────────────────
        if (options?.tasks !== false) {
          step('Importing phases and tasks...')
          const fPids = Object.keys(projectMap)

          for (let pi = 0; pi < fPids.length; pi++) {
            if (aborted) return
            const fPid   = fPids[pi]
            const ourPid = projectMap[fPid]

            try {
              const phases    = await fGetAll(apiKey, `/projects/${fPid}/phases`)
              const phaseMap: Record<string, string> = {}

              for (const ph of phases) {
                const { data } = await supabase.from('phases').insert({
                  project_id: ourPid, name: ph.name || 'Phase', sort_order: counts.phases,
                }).select('id').single()
                if (data) { phaseMap[ph.id] = data.id; counts.phases++ }
              }

              let defaultPhaseId: string | null = null
              if (phases.length === 0) {
                const { data } = await supabase.from('phases').insert({ project_id: ourPid, name: 'Tasks', sort_order: 0 }).select('id').single()
                defaultPhaseId = data?.id || null
              }

              const tasks = await fGetAll(apiKey, `/projects/${fPid}/tasks`)
              for (const t of tasks) {
                const phaseId = t.phase_id ? phaseMap[t.phase_id] : defaultPhaseId
                if (!phaseId) continue
                const dueDate = t.end_year ? `${t.end_year}-${String(t.end_month||12).padStart(2,'0')}-${String(t.end_day||28).padStart(2,'0')}` : null
                const { data: td } = await supabase.from('tasks').insert({
                  phase_id: phaseId, title: t.title || 'Task',
                  estimated_hrs: t.estimate ? Math.round(t.estimate / 60 * 10) / 10 : null,
                  status: t.done ? 'done' : 'todo', billable: t.billable !== false,
                  due_date: dueDate, sort_order: counts.tasks++,
                }).select('id').single()
                if (td && t.assigned_persons?.length) {
                  const rows = (t.assigned_persons as string[]).map(pid => personMap[pid]).filter(Boolean).map(uid => ({ task_id: td.id, user_id: uid }))
                  if (rows.length) await supabase.from('task_assignees').upsert(rows, { onConflict: 'task_id,user_id', ignoreDuplicates: true })
                }
              }

              if ((pi + 1) % 20 === 0) log(`   ... ${pi + 1}/${fPids.length} projects processed (${counts.tasks} tasks)`)
            } catch(e: any) {
              log(`   ⚠️  Project ${fPid}: ${e.message}`)
            }
          }
          log(`✅ Phases: ${counts.phases} | Tasks: ${counts.tasks}`)
        }
      }

      done('🎉 Import complete! Refresh the app to see all your data.', counts)
    } catch(e: any) {
      fail(`❌ Import failed: ${e.message}`)
    }
  })

  // ── POST /users/import/finance-sheet ──────────────────────────────────────
  // Import NEXA Finance Sheet Client_Revenue rows.
  // Frontend parses the XLSX client-side (using existing SheetJS CDN lib) and posts
  // the parsed rows as JSON, avoiding need for multipart handling on backend.
  //
  // Request body: { rows: FinanceRow[], defaultCurrency?: string }
  //   FinanceRow = { month, invoice_date, invoice_no, client_name, sales_person,
  //                  service_department, service_category, type, classification,
  //                  services_detail, sales_amount, third_party?, advertising_budget? }
  app.post('/import/finance-sheet', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }

    const body = req.body as any
    const incoming: any[] = Array.isArray(body?.rows) ? body.rows : []
    const defaultCurrency = body?.defaultCurrency || 'AED'
    if (!incoming.length) return reply.status(400).send({ errors: [{ code: 'NO_ROWS', message: 'No rows provided' }] })

    try {
      const result = await processFinanceRows(incoming, caller.workspaceId, defaultCurrency)
      return reply.status(200).send({ ok: true, ...result })
    } catch (e: any) {
      return reply.status(500).send({ errors: [{ message: e?.message || 'Import failed' }] })
    }
  })

  // Extract spreadsheet ID from a full Google Sheets URL or accept a raw ID.
  // Examples:
  //   https://docs.google.com/spreadsheets/d/1ABC.../edit?usp=sharing → 1ABC...
  //   https://docs.google.com/spreadsheets/d/1ABC.../edit#gid=0       → 1ABC...
  //   1ABC...                                                          → 1ABC...
  function extractSheetId(input: string): string | null {
    if (!input) return null
    const trimmed = input.trim()
    const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
    if (m) return m[1]
    // If it looks like a bare ID (no slashes, reasonable length), accept it
    if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed
    return null
  }

  // Resolve the active sheet ID for a workspace: prefer DB-stored config,
  // fall back to the env var (which is just a default for first-time setup).
  async function resolveSheetId(workspaceId: string): Promise<string | null> {
    const { data: wsRow } = await supabase
      .from('workspaces')
      .select('sync_state')
      .eq('id', workspaceId)
      .maybeSingle()
    const stored = ((wsRow as any)?.sync_state || {}).finance_sheet?.spreadsheetId
    return stored || process.env.GOOGLE_FINANCE_SHEET_ID || null
  }

  // ── POST /users/import/finance-sheet/config ───────────────────────────────
  // Save which Google Sheet to sync from. Accepts either a full URL or a bare
  // sheet ID. Stored in workspaces.sync_state.finance_sheet.spreadsheetId so
  // it persists across env changes / restarts.
  app.post('/import/finance-sheet/config', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }
    const body = (req.body as any) || {}
    const sheetUrlOrId = String(body.sheet_url || body.spreadsheet_id || '').trim()
    if (!sheetUrlOrId) {
      return reply.status(400).send({ errors: [{ code: 'MISSING_URL', message: 'sheet_url required' }] })
    }
    const spreadsheetId = extractSheetId(sheetUrlOrId)
    if (!spreadsheetId) {
      return reply.status(400).send({ errors: [{
        code: 'BAD_URL',
        message: 'Could not extract a sheet ID from that input. Paste a Google Sheets URL or the sheet ID directly.',
      }] })
    }

    // Read existing sync_state so we don't clobber other keys
    const { data: wsRow } = await supabase
      .from('workspaces')
      .select('sync_state')
      .eq('id', caller.workspaceId)
      .maybeSingle()
    const currentState = ((wsRow as any)?.sync_state) || {}
    const currentFinance = currentState.finance_sheet || {}

    const newSyncState = {
      ...currentState,
      finance_sheet: {
        ...currentFinance,
        spreadsheetId,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        // Reset error/title since we're pointing at a new sheet
        sheetTitle: null,
        lastError:  null,
      },
    }

    const { error } = await supabase
      .from('workspaces')
      .update({ sync_state: newSyncState })
      .eq('id', caller.workspaceId)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })

    return reply.status(200).send({ ok: true, spreadsheetId, sheetUrl: newSyncState.finance_sheet.sheetUrl })
  })

  // ── POST /users/import/finance-sheet/sheets-sync ──────────────────────────
  // Pull rows directly from the live NEXA Finance Google Sheet via service
  // account. Reuses the exact same processFinanceRows pipeline (hashing / upsert
  // / dedup) as the xlsx upload — so re-running sync is idempotent.
  app.post('/import/finance-sheet/sheets-sync', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }

    if (!isGoogleSheetsConfigured()) {
      return reply.status(400).send({ errors: [{
        code: 'NOT_CONFIGURED',
        message: 'GOOGLE_SHEETS_SERVICE_ACCOUNT_B64 not set in .env.local',
      }] })
    }

    const body = (req.body as any) || {}
    // Priority: body override → DB-stored sheet → env var fallback
    const spreadsheetId = body.spreadsheet_id || (await resolveSheetId(caller.workspaceId))
    const defaultCurrency = body.defaultCurrency || 'AED'

    if (!spreadsheetId) {
      return reply.status(400).send({ errors: [{
        code: 'NO_SHEET_ID',
        message: 'No sheet configured. Paste a Google Sheets URL in the admin panel first.',
      }] })
    }

    const startedAt = new Date().toISOString()

    // Read existing sync_state once so we can merge our updates into it
    const { data: wsRow } = await supabase
      .from('workspaces')
      .select('sync_state')
      .eq('id', caller.workspaceId)
      .maybeSingle()
    const currentState = ((wsRow as any)?.sync_state) || {}
    const currentFinance = currentState.finance_sheet || {}

    try {
      const { rows, sheetTitle, sheetUrl } = await readFinanceSheetRows(spreadsheetId)
      const result = await processFinanceRows(rows, caller.workspaceId, defaultCurrency)

      const newSyncState = {
        ...currentState,
        finance_sheet: {
          ...currentFinance,
          spreadsheetId,
          sheetTitle,
          sheetUrl,
          lastSyncAt: startedAt,
          lastSyncResult: {
            totalRows:      result.totalRows,
            inserted:       result.inserted,
            alreadyExisted: result.alreadyExisted,
            unmatchedCount: result.unmatched.length,
          },
          lastError: null,
        },
      }
      await supabase
        .from('workspaces')
        .update({ sync_state: newSyncState })
        .eq('id', caller.workspaceId)

      return reply.status(200).send({
        ok: true,
        source: 'google-sheets',
        spreadsheetId,
        sheetTitle,
        sheetUrl,
        lastSyncAt: startedAt,
        ...result,
      })
    } catch (e: any) {
      const msg = e?.message || 'Sync failed'
      // Record the error for UI surfacing — keep other state intact
      const errState = {
        ...currentState,
        finance_sheet: {
          ...currentFinance,
          spreadsheetId,
          lastSyncAt: startedAt,
          lastError:  msg,
        },
      }
      await supabase
        .from('workspaces')
        .update({ sync_state: errState })
        .eq('id', caller.workspaceId)
      return reply.status(500).send({ errors: [{ message: msg }] })
    }
  })

  // ── GET /users/import/finance-sheet/status ────────────────────────────────
  // Returns integration state for the admin UI: is the service account
  // configured, which sheet ID is wired, when did we last sync, etc.
  app.get('/import/finance-sheet/status', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }

    const configured = isGoogleSheetsConfigured()
    const serviceAccountEmail = getServiceAccountEmail()
    const envSheetId = process.env.GOOGLE_FINANCE_SHEET_ID || null

    const { data: wsRow } = await supabase
      .from('workspaces')
      .select('sync_state')
      .eq('id', caller.workspaceId)
      .maybeSingle()

    const financeState = ((wsRow as any)?.sync_state || {}).finance_sheet || null

    // The sheet that will actually be used on next sync (DB > env)
    const activeSheetId = financeState?.spreadsheetId || envSheetId
    const activeSheetUrl = activeSheetId
      ? `https://docs.google.com/spreadsheets/d/${activeSheetId}/edit`
      : null

    return reply.status(200).send({
      configured,
      serviceAccountEmail,
      envSheetId,
      financeState,
      activeSheetId,
      activeSheetUrl,
    })
  })

  // ── POST /users/import/finance-sheet/map-client ───────────────────────────
  // After upload, admin can manually map unmatched raw names to existing clients
  app.post('/import/finance-sheet/map-client', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }
    const { raw_name, client_id } = req.body as any
    if (!raw_name || !client_id) return reply.status(400).send({ errors: [{ code: 'MISSING_FIELDS' }] })

    // Verify client belongs to workspace
    const { data: client } = await supabase.from('clients')
      .select('id').eq('id', client_id).eq('workspace_id', caller.workspaceId).maybeSingle()
    if (!client) return reply.status(400).send({ errors: [{ code: 'BAD_CLIENT' }] })

    // Update all invoices with this raw_name + null client_id in this workspace
    const { data, error } = await supabase
      .from('client_invoices')
      .update({ client_id })
      .eq('workspace_id', caller.workspaceId)
      .is('client_id', null)
      .eq('client_name_raw', raw_name)
      .select('id')

    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ ok: true, updated: data?.length || 0 })
  })

  // ── GET /users/import/finance-sheet/unmatched ─────────────────────────────
  app.get('/import/finance-sheet/unmatched', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }
    const { data, error } = await supabase
      .from('client_invoices')
      .select('client_name_raw')
      .eq('workspace_id', caller.workspaceId)
      .is('client_id', null)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })

    const map = new Map<string, number>()
    for (const r of data || []) {
      const n = (r as any).client_name_raw
      map.set(n, (map.get(n) || 0) + 1)
    }
    const unmatched = Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
    return reply.status(200).send({ data: unmatched })
  })

  // ── GET /users/import/finance-sheet/smart-suggestions ────────────────────
  // Analyses all unmatched invoice names and returns three buckets:
  //   highConfidence  — suffix-stripped or normalized-exact match (>= 0.85)
  //   possible        — fuzzy trigram match (0.45 – 0.84), needs human review
  //   noMatch         — no similarity found, safe to create as new client
  //
  // Each suggestion carries the best-matching existing client + confidence score
  // + reason string so the UI can explain the recommendation.
  app.get('/import/finance-sheet/smart-suggestions', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }

    // Load all unmatched invoice rows
    const { data: unmatchedRows } = await supabase
      .from('client_invoices')
      .select('client_name_raw, sales_amount')
      .eq('workspace_id', caller.workspaceId)
      .is('client_id', null)

    // Aggregate by name: count + revenue
    const nameMap = new Map<string, { count: number; revenue: number }>()
    for (const r of unmatchedRows || []) {
      const name = String((r as any).client_name_raw || '').trim()
      if (!name) continue
      const e = nameMap.get(name) || { count: 0, revenue: 0 }
      nameMap.set(name, { count: e.count + 1, revenue: e.revenue + (Number((r as any).sales_amount) || 0) })
    }

    if (!nameMap.size) {
      return reply.status(200).send({ data: { highConfidence: [], possible: [], noMatch: [] } })
    }

    // Load all existing clients for this workspace
    const { data: allClients } = await supabase
      .from('clients')
      .select('id, name')
      .eq('workspace_id', caller.workspaceId)
      .is('deleted_at', null)

    // ── Matching helpers ────────────────────────────────────────────────────
    function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, '') }

    // Strip " - service type" suffix: "Crayon - Social" → "Crayon"
    function stripSuffix(s: string) { return s.replace(/\s*[-–—]\s*.+$/, '').trim() }

    function trigrams(s: string): Set<string> {
      const p = `  ${s.toLowerCase()} `.replace(/\s+/g, ' ')
      const out = new Set<string>()
      for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3))
      return out
    }
    function sim(a: string, b: string): number {
      const ta = trigrams(a), tb = trigrams(b)
      if (!ta.size && !tb.size) return 0
      let shared = 0
      for (const t of ta) if (tb.has(t)) shared++
      return shared / (ta.size + tb.size - shared)
    }

    const clients = (allClients || []) as { id: string; name: string }[]
    // Pre-build normalized → client lookup for O(1) exact checks
    const normMap = new Map<string, { id: string; name: string }>()
    for (const c of clients) {
      const key = norm(c.name)
      if (key && !normMap.has(key)) normMap.set(key, c) // first writer wins on collision
    }

    type MatchInfo = { clientId: string; clientName: string; confidence: number; reason: string }
    type Suggestion = { rawName: string; invoiceCount: number; totalRevenue: number; match: MatchInfo }

    const highConfidence: Suggestion[] = []
    const possible: Suggestion[] = []
    const noMatch: { name: string; count: number; revenue: number }[] = []

    for (const [rawName, stats] of nameMap.entries()) {
      const stripped = stripSuffix(rawName)
      const hasSuffix = stripped !== rawName
      let match: MatchInfo | null = null

      // Pass 1: exact normalized match on stripped name (e.g. "Crayon - Social" → "Crayon")
      if (hasSuffix) {
        const found = normMap.get(norm(stripped))
        if (found) match = { clientId: found.id, clientName: found.name, confidence: 1.0, reason: 'suffix_stripped' }
      }

      // Pass 2: exact normalized match on full name (catches case/punct drift)
      if (!match) {
        const found = normMap.get(norm(rawName))
        if (found) match = { clientId: found.id, clientName: found.name, confidence: 0.95, reason: 'normalized_exact' }
      }

      // Pass 3: fuzzy trigram on stripped name first, then full name
      if (!match) {
        let best: { client: { id: string; name: string }; score: number } | null = null
        for (const c of clients) {
          const score = Math.max(
            hasSuffix ? sim(stripped, c.name) : 0,
            sim(rawName, c.name),
          )
          if (score > 0.4 && (!best || score > best.score)) best = { client: c, score }
        }
        if (best) {
          match = { clientId: best.client.id, clientName: best.client.name, confidence: best.score, reason: 'fuzzy' }
        }
      }

      if (!match) {
        noMatch.push({ name: rawName, count: stats.count, revenue: stats.revenue })
      } else {
        const s: Suggestion = { rawName, invoiceCount: stats.count, totalRevenue: stats.revenue, match }
        if (match.confidence >= 0.85) highConfidence.push(s)
        else possible.push(s)
      }
    }

    const byCount = (a: { invoiceCount: number }, b: { invoiceCount: number }) => b.invoiceCount - a.invoiceCount
    const byCountNM = (a: { count: number }, b: { count: number }) => b.count - a.count
    highConfidence.sort(byCount)
    possible.sort(byCount)
    noMatch.sort(byCountNM)

    return reply.status(200).send({ data: { highConfidence, possible, noMatch } })
  })

  // ── POST /users/import/finance-sheet/bulk-map ─────────────────────────────
  // Apply multiple { raw_name → client_id } mappings in a single call.
  // Used by the smart reconciliation panel to commit accepted suggestions.
  app.post('/import/finance-sheet/bulk-map', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }
    const { mappings } = (req.body as any) || {}
    if (!Array.isArray(mappings) || !mappings.length) {
      return reply.status(400).send({ errors: [{ code: 'MISSING_MAPPINGS' }] })
    }

    // Verify every client_id belongs to this workspace (security check)
    const clientIds = [...new Set(mappings.map((m: any) => m.client_id).filter(Boolean))] as string[]
    const { data: validClients } = await supabase
      .from('clients').select('id').eq('workspace_id', caller.workspaceId).in('id', clientIds)
    const validSet = new Set((validClients || []).map((c: any) => c.id))

    let linked = 0
    for (const m of mappings) {
      if (!m.raw_name || !m.client_id || !validSet.has(m.client_id)) continue
      const { data, error } = await supabase
        .from('client_invoices')
        .update({ client_id: m.client_id })
        .eq('workspace_id', caller.workspaceId)
        .is('client_id', null)
        .eq('client_name_raw', m.raw_name)
        .select('id')
      if (error) return reply.status(500).send({ errors: [{ message: `Link failed for "${m.raw_name}": ${error.message}` }] })
      linked += data?.length || 0
    }
    return reply.status(200).send({ ok: true, linked })
  })

  // ── POST /users/import/finance-sheet/auto-create-clients ──────────────────
  // For every unique client_name_raw in unmatched invoices, create a new client
  // record and link the invoices to it. Safe to re-run (only acts on null client_id).
  //
  // Optional body field `names: string[]` — if provided, only processes those
  // specific raw names (used by smart reconciliation panel "Create" action).
  //
  // Returns counts: how many clients created, how many invoices linked, and a
  // list of created clients for display.
  app.post('/import/finance-sheet/auto-create-clients', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }

    // Optional: only process specific names (from smart reconciliation panel)
    const filterNames: string[] | null = Array.isArray((req.body as any)?.names) && (req.body as any).names.length
      ? (req.body as any).names.map(String)
      : null

    // 1) Get all unmatched raw names (invoices with client_id = null)
    const { data: unmatchedRows } = await supabase
      .from('client_invoices')
      .select('client_name_raw')
      .eq('workspace_id', caller.workspaceId)
      .is('client_id', null)

    const uniqueNames = Array.from(new Set(
      (unmatchedRows || [])
        .map((r: any) => String(r.client_name_raw || '').trim())
        .filter(Boolean)
        .filter(n => !filterNames || filterNames.includes(n))
    ))

    if (!uniqueNames.length) {
      return reply.status(200).send({
        ok: true,
        created: 0,
        invoicesLinked: 0,
        clients: [],
      })
    }

    // 2) Load ALL existing (non-deleted) clients, then do two levels of matching:
    //    a) exact after normalization (punctuation + case insensitive)
    //    b) pg_trgm similarity >= 0.75 (catches minor name drift like trailing "LLC")
    //    Anything lower is left to the manual "merge clients" UI — too risky to
    //    auto-link a 0.35-similarity pair without human judgement.
    const { data: allClients } = await supabase
      .from('clients')
      .select('id, name')
      .eq('workspace_id', caller.workspaceId)
      .is('deleted_at', null)

    function normalize(s: string): string {
      return s.toLowerCase().replace(/[^a-z0-9]/g, '')
    }
    // trigram similarity implementation (same algorithm pg_trgm uses at the db).
    // Kept in-process so we don't round-trip per unmatched name.
    function trigrams(s: string): Set<string> {
      const padded = `  ${s.toLowerCase()} `.replace(/\s+/g, ' ')
      const out = new Set<string>()
      for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3))
      return out
    }
    function similarity(a: string, b: string): number {
      const ta = trigrams(a), tb = trigrams(b)
      if (!ta.size && !tb.size) return 0
      let shared = 0
      for (const t of ta) if (tb.has(t)) shared++
      return shared / (ta.size + tb.size - shared)
    }

    const existingByName: Record<string, string> = {}
    const normalizedToId: Record<string, { id: string; name: string }> = {}
    for (const c of allClients || []) {
      const row = c as any
      existingByName[row.name] = row.id
      const norm = normalize(row.name)
      if (norm) normalizedToId[norm] = { id: row.id, name: row.name }
    }

    // For each unmatched name, resolve to either an existing client id or null (needs creation)
    const resolvedId: Record<string, string> = {}
    for (const raw of uniqueNames) {
      if (existingByName[raw]) { resolvedId[raw] = existingByName[raw]; continue }

      const rawNorm = normalize(raw)
      if (rawNorm && normalizedToId[rawNorm]) {
        resolvedId[raw] = normalizedToId[rawNorm].id
        continue
      }

      // Fuzzy match: >= 0.75 similarity to an existing client
      let best: { id: string; name: string; score: number } | null = null
      for (const c of allClients || []) {
        const row = c as any
        const s = similarity(raw, row.name)
        if (s >= 0.75 && (!best || s > best.score)) {
          best = { id: row.id, name: row.name, score: s }
        }
      }
      if (best) resolvedId[raw] = best.id
    }

    // 3) For each name that couldn't be resolved to an existing client, create one
    const toCreate = uniqueNames.filter(n => !resolvedId[n])
    let createdClients: any[] = []
    if (toCreate.length) {
      const allocatedCodes = await nextClientCodes(caller.workspaceId, toCreate.length)
      const payload = toCreate.map((name, i) => ({
        workspace_id: caller.workspaceId,
        name,
        client_code: allocatedCodes[i],
      }))
      const { data: created, error } = await supabase
        .from('clients')
        .insert(payload)
        .select('id, name')
      if (error) {
        return reply.status(500).send({ errors: [{ message: `Create failed: ${error.message}` }] })
      }
      createdClients = created || []
    }

    // 4) Build name → id lookup for both new + existing matches
    const nameToId: Record<string, string> = { ...resolvedId }
    for (const c of createdClients) nameToId[(c as any).name] = (c as any).id

    // 5) Link invoices to their respective clients (one update per name since
    //    Supabase needs a flat eq filter). Small loop — at most 111 iterations.
    let invoicesLinked = 0
    for (const name of uniqueNames) {
      const clientId = nameToId[name]
      if (!clientId) continue
      const { data: linked, error: linkErr } = await supabase
        .from('client_invoices')
        .update({ client_id: clientId })
        .eq('workspace_id', caller.workspaceId)
        .is('client_id', null)
        .eq('client_name_raw', name)
        .select('id')
      if (linkErr) {
        return reply.status(500).send({ errors: [{ message: `Link failed for "${name}": ${linkErr.message}` }] })
      }
      invoicesLinked += (linked?.length || 0)
    }

    return reply.status(200).send({
      ok: true,
      created: createdClients.length,
      alreadyExisted: uniqueNames.length - toCreate.length,
      invoicesLinked,
      clients: createdClients,
    })
  })

  // ── POST /users/import/software-costs/sync ────────────────────────────────
  // Pull the Software_Costs tab (wide-format: per-software-per-dept × 13 month
  // cols) and unpivot → one DB row per (software, department, month). Matches
  // department names to `departments.id` where possible for fast aggregations.
  app.post('/import/software-costs/sync', async (req: any, reply: any) => {
    const caller = req.user
    if (!caller || !['super_admin','admin'].includes(caller.profile)) {
      return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    }
    if (!isGoogleSheetsConfigured()) {
      return reply.status(400).send({ errors: [{
        code: 'NOT_CONFIGURED',
        message: 'GOOGLE_SHEETS_SERVICE_ACCOUNT_B64 not set in .env.local',
      }] })
    }

    // Use same sheet ID as finance sync (it's all one workbook)
    const body = (req.body as any) || {}
    const spreadsheetId =
      body.spreadsheet_id ||
      (await (async () => {
        const { data: wsRow } = await supabase
          .from('workspaces').select('sync_state').eq('id', caller.workspaceId).maybeSingle()
        return ((wsRow as any)?.sync_state || {}).finance_sheet?.spreadsheetId
      })()) ||
      process.env.GOOGLE_FINANCE_SHEET_ID
    if (!spreadsheetId) {
      return reply.status(400).send({ errors: [{
        code: 'NO_SHEET_ID',
        message: 'No finance sheet configured. Sync the finance sheet first (it uses the same workbook).',
      }] })
    }

    const startedAt = new Date().toISOString()

    try {
      const { rows: sheetRows, sheetTitle } = await readSoftwareCostsRows(spreadsheetId)

      // Match department names to department IDs (case-insensitive, space-collapsed)
      const { data: deptRows } = await supabase
        .from('departments').select('id, name').eq('workspace_id', caller.workspaceId)
      const deptIdByName: Record<string, string> = {}
      for (const d of deptRows || []) {
        const key = String((d as any).name || '').trim().toLowerCase().replace(/\s+/g, ' ')
        if (key) deptIdByName[key] = (d as any).id
      }
      function matchDeptId(rawName: string): string | null {
        const key = String(rawName || '').trim().toLowerCase().replace(/\s+/g, ' ')
        return deptIdByName[key] || null
      }

      const { createHash } = await import('crypto')
      const toInsert: any[] = []
      const unmatchedDeptSet = new Map<string, number>()

      for (const row of sheetRows) {
        // Canonical hash so re-sync is idempotent
        const canonical = JSON.stringify({
          sw: row.software_name.trim().toLowerCase(),
          d:  row.department.trim().toLowerCase(),
          m:  row.month,
          a:  row.amount,
        })
        const hash = createHash('sha256').update(canonical).digest('hex')

        const deptId = matchDeptId(row.department)
        if (!deptId) {
          unmatchedDeptSet.set(row.department, (unmatchedDeptSet.get(row.department) || 0) + 1)
        }

        toInsert.push({
          workspace_id:      caller.workspaceId,
          software_name:     row.software_name,
          department_raw:    row.department,
          department_id:     deptId,
          billing_frequency: row.billing_frequency,
          month:             row.month,
          amount:            row.amount,
          currency:          'AED',  // Finance sheet is all AED; update if it changes
          source_row_hash:   hash,
        })
      }

      let inserted = 0
      let alreadyExisted = 0
      const CHUNK = 500
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK)
        const { data, error } = await supabase
          .from('software_costs')
          .upsert(chunk, { onConflict: 'workspace_id,source_row_hash', ignoreDuplicates: true })
          .select('id')
        if (error) {
          return reply.status(500).send({ errors: [{ message: `DB error: ${error.message}` }] })
        }
        const newRows = data?.length || 0
        inserted += newRows
        alreadyExisted += (chunk.length - newRows)
      }

      const unmatchedDepartments = Array.from(unmatchedDeptSet.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)

      // Persist last-sync state alongside finance_sheet state
      const { data: wsRow2 } = await supabase
        .from('workspaces').select('sync_state').eq('id', caller.workspaceId).maybeSingle()
      const currentState = ((wsRow2 as any)?.sync_state) || {}
      const newSyncState = {
        ...currentState,
        software_costs: {
          spreadsheetId, sheetTitle,
          lastSyncAt: startedAt,
          lastSyncResult: {
            totalRows:      sheetRows.length,
            inserted,
            alreadyExisted,
            unmatchedDepartments: unmatchedDepartments.length,
          },
          lastError: null,
        },
      }
      await supabase
        .from('workspaces').update({ sync_state: newSyncState }).eq('id', caller.workspaceId)

      return reply.status(200).send({
        ok: true,
        source: 'google-sheets',
        spreadsheetId,
        lastSyncAt: startedAt,
        totalRows:  sheetRows.length,
        inserted,
        alreadyExisted,
        unmatchedDepartments,
      })
    } catch (e: any) {
      return reply.status(500).send({ errors: [{ message: e?.message || 'Sync failed' }] })
    }
  })
}
