/**
 * Forecast.it → Supabase Import Script
 * 
 * Pulls all real data from Forecast.it API and inserts into our Supabase DB.
 * 
 * Run from D:\forecast:
 *   node scripts/import-from-forecast.mjs
 * 
 * Imports in order:
 *  1. Departments
 *  2. Team members (persons)
 *  3. Clients
 *  4. Projects
 *  5. Phases per project
 *  6. Tasks + assignees per project
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// ── Load .env.local manually (no dotenv dep in this script) ────────────────────
try {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch { /* env file optional if vars are already set */ }

// ── Config (all from env — never hardcode) ─────────────────────────────────────
const FORECAST_API_KEY = process.env.FORECAST_API_KEY
const FORECAST_BASE    = 'https://api.forecast.it/api/v1'

const SUPABASE_URL     = process.env.SUPABASE_URL
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY
const WORKSPACE_ID     = process.env.WORKSPACE_ID || '00000000-0000-0000-0000-000000000001'
const DEFAULT_PASSWORD = process.env.IMPORT_DEFAULT_PASSWORD_HASH

if (!FORECAST_API_KEY || !SUPABASE_URL || !SUPABASE_KEY || !DEFAULT_PASSWORD) {
  console.error('❌ Missing required env vars. Set in .env.local:')
  console.error('   FORECAST_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IMPORT_DEFAULT_PASSWORD_HASH')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Forecast API helpers ──────────────────────────────────────────────────────
async function forecastGet(path) {
  const res = await fetch(`${FORECAST_BASE}${path}`, {
    headers: { 'X-FORECAST-API-KEY': FORECAST_API_KEY }
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

async function forecastGetAll(path) {
  let page = 1, all = []
  while (true) {
    const sep  = path.includes('?') ? '&' : '?'
    const data = await forecastGet(`${path}${sep}page_size=100&page=${page}`)
    if (!Array.isArray(data) || data.length === 0) break
    all = all.concat(data)
    if (data.length < 100) break
    page++
  }
  return all
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function mapStatus(stage) {
  if (!stage) return 'running'
  const s = String(stage).toLowerCase()
  if (s === 'halted') return 'halted'
  if (s === 'done' || s === 'closed' || s === 'archived') return 'done'
  return 'running'
}

const COLORS = ['#0D9488','#7C3AED','#2563EB','#D97706','#DC2626','#059669','#0891B2','#BE185D']

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n🚀 Forecast → Supabase Import\n' + '═'.repeat(50))

  // Test connection
  console.log('\n1️⃣  Testing API connection...')
  try {
    const me = await forecastGet('/whoami')
    console.log(`   ✅ Connected: ${me.first_name} ${me.last_name} (${me.email})`)
  } catch(e) {
    console.error('   ❌ Cannot connect to Forecast API:', e.message)
    console.error('   → Check the API key and try again')
    process.exit(1)
  }

  // ── DEPARTMENTS ─────────────────────────────────────────────────────────────
  console.log('\n2️⃣  Departments...')
  const fDepts = await forecastGetAll('/departments')
  const { data: dbDepts } = await supabase.from('departments').select('id,name').eq('workspace_id', WORKSPACE_ID)
  const deptByName = Object.fromEntries((dbDepts||[]).map(d => [d.name.toLowerCase(), d.id]))
  const deptMap = {}

  for (const d of fDepts) {
    const name = (d.name||'').trim()
    if (!name) continue
    if (deptByName[name.toLowerCase()]) {
      deptMap[d.id] = deptByName[name.toLowerCase()]
    } else {
      const { data } = await supabase.from('departments').insert({ name, workspace_id: WORKSPACE_ID }).select('id').single()
      if (data) { deptMap[d.id] = data.id; deptByName[name.toLowerCase()] = data.id; console.log(`   + ${name}`) }
    }
  }
  console.log(`   ✅ ${fDepts.length} departments processed`)

  // ── PERSONS ──────────────────────────────────────────────────────────────────
  console.log('\n3️⃣  Team members...')
  const fPersons = await forecastGetAll('/persons')
  // Forecast's job titles live in /roles; person.default_role is the FK.
  const fRoles = await forecastGetAll('/roles')
  const roleNameById = Object.fromEntries(fRoles.map(r => [r.id, String(r.name || '').trim()]))
  const { data: dbUsers } = await supabase.from('users').select('id,email').eq('workspace_id', WORKSPACE_ID)
  const userByEmail = Object.fromEntries((dbUsers||[]).map(u => [u.email.toLowerCase(), u.id]))
  const personMap = {}
  let newUsers = 0

  for (const p of fPersons) {
    const email = (p.email||'').toLowerCase().trim()
    if (!email) continue

    if (userByEmail[email]) {
      personMap[p.id] = userByEmail[email]
      continue
    }

    const { data, error } = await supabase.from('users').insert({
      workspace_id:       WORKSPACE_ID,
      email,
      name:               `${p.first_name||''} ${p.last_name||''}`.trim() || email,
      job_title:          (p.default_role && roleNameById[p.default_role]) || null,
      permission_profile: p.is_admin ? 'admin' : 'collaborator',
      seat_type:          p.is_core_user ? 'full' : 'collaborator',
      department_id:      p.department_id ? (deptMap[p.department_id] || null) : null,
      capacity_hrs:       p.weekly_capacity ? Math.round(p.weekly_capacity / 60) : 40,
      active:             p.active !== false,
      start_date:         p.start_date || null,
      end_date:           p.end_date   || null,
      password_hash:      DEFAULT_PASSWORD,
    }).select('id').single()

    if (!error && data) {
      personMap[p.id] = data.id
      userByEmail[email] = data.id
      newUsers++
    } else if (error) {
      console.warn(`   ⚠️  ${email}: ${error.message}`)
    }
  }
  console.log(`   ✅ ${newUsers} new users imported (${fPersons.length - newUsers} already existed)`)

  // ── CLIENTS ──────────────────────────────────────────────────────────────────
  console.log('\n4️⃣  Clients...')
  const fClients = await forecastGetAll('/clients')
  const { data: dbClients } = await supabase.from('clients').select('id,name').eq('workspace_id', WORKSPACE_ID)
  const clientByName = Object.fromEntries((dbClients||[]).map(c => [c.name.toLowerCase(), c.id]))
  const clientMap = {}
  let newClients = 0

  for (const c of fClients) {
    const name = (c.name||'').trim()
    if (!name) continue
    if (clientByName[name.toLowerCase()]) {
      clientMap[c.id] = clientByName[name.toLowerCase()]
    } else {
      const { data } = await supabase.from('clients').insert({ name, workspace_id: WORKSPACE_ID }).select('id').single()
      if (data) { clientMap[c.id] = data.id; clientByName[name.toLowerCase()] = data.id; newClients++ }
    }
  }
  console.log(`   ✅ ${newClients} new clients imported`)

  // ── PROJECTS ──────────────────────────────────────────────────────────────────
  console.log('\n5️⃣  Projects...')
  const fProjects = await forecastGetAll('/projects')
  const { data: dbProjects } = await supabase.from('projects').select('id,name').eq('workspace_id', WORKSPACE_ID).is('deleted_at', null)
  const projectByName = Object.fromEntries((dbProjects||[]).map(p => [p.name.toLowerCase(), p.id]))
  const projectMap = {}
  let newProjects = 0

  for (let i = 0; i < fProjects.length; i++) {
    const p    = fProjects[i]
    const name = (p.name||'').trim()
    if (!name) continue

    if (projectByName[name.toLowerCase()]) {
      projectMap[p.id] = projectByName[name.toLowerCase()]
      continue
    }

    // Forecast v1 uses ISO-string start_date / end_date on the live feed.
    const startDate = p.start_date || null
    const endDate   = p.end_date   || null

    const { data, error } = await supabase.from('projects').insert({
      workspace_id:  WORKSPACE_ID,
      name,
      status:        mapStatus(p.stage),
      color:         COLORS[i % COLORS.length],
      budget_type:   'fixed_price',
      budget_amount: p.budget || null,
      currency:      p.currency || 'AED',
      client_id:     p.client ? (clientMap[p.client] || null) : null,
      start_date:    startDate,
      end_date:      endDate,
    }).select('id').single()

    if (!error && data) {
      projectMap[p.id] = data.id
      projectByName[name.toLowerCase()] = data.id
      newProjects++
      if (newProjects % 25 === 0) console.log(`   ... ${newProjects} projects done`)
    }

    if (i % 50 === 0 && i > 0) await sleep(300)
  }
  console.log(`   ✅ ${newProjects} new projects imported`)

  // ── PHASES & TASKS ────────────────────────────────────────────────────────────
  console.log('\n6️⃣  Phases & Tasks (slowest step)...')
  let totalPhases = 0, totalTasks = 0
  const forecastPids = Object.keys(projectMap)

  for (let pi = 0; pi < forecastPids.length; pi++) {
    const fPid   = forecastPids[pi]
    const ourPid = projectMap[fPid]

    try {
      // Phases
      const phases    = await forecastGetAll(`/projects/${fPid}/phases`)
      const phaseIdMap = {}

      for (const ph of phases) {
        const { data } = await supabase.from('phases').insert({
          project_id: ourPid,
          name:       ph.name || 'Phase',
          sort_order: totalPhases++,
        }).select('id').single()
        if (data) phaseIdMap[ph.id] = data.id
      }

      // Create default phase if project has no phases
      let defaultPhaseId = null
      if (phases.length === 0) {
        const { data } = await supabase.from('phases').insert({ project_id: ourPid, name: 'Tasks', sort_order: 0 }).select('id').single()
        defaultPhaseId = data?.id
      }

      // Tasks
      const tasks = await forecastGetAll(`/projects/${fPid}/tasks`)

      for (const t of tasks) {
        const phaseId = t.phase_id ? phaseIdMap[t.phase_id] : defaultPhaseId
        if (!phaseId) continue

        const dueDate = t.end_year
          ? `${t.end_year}-${String(t.end_month||12).padStart(2,'0')}-${String(t.end_day||28).padStart(2,'0')}`
          : null

        const { data: td } = await supabase.from('tasks').insert({
          phase_id:      phaseId,
          title:         t.title || 'Task',
          estimated_hrs: t.estimate ? Math.round(t.estimate / 60 * 10) / 10 : null,
          status:        t.done ? 'done' : 'todo',
          billable:      t.billable !== false,
          due_date:      dueDate,
          sort_order:    totalTasks++,
        }).select('id').single()

        // Assignees
        if (td && t.assigned_persons?.length) {
          const rows = t.assigned_persons.map(pid => personMap[pid]).filter(Boolean).map(uid => ({ task_id: td.id, user_id: uid }))
          if (rows.length) await supabase.from('task_assignees').upsert(rows, { onConflict: 'task_id,user_id', ignoreDuplicates: true })
        }
      }

      if ((pi + 1) % 20 === 0 || pi === forecastPids.length - 1) {
        console.log(`   ... ${pi + 1}/${forecastPids.length} projects done (${totalPhases} phases, ${totalTasks} tasks)`)
        await sleep(200)
      }

    } catch(e) {
      console.warn(`   ⚠️  Project ${fPid}: ${e.message}`)
    }
  }

  // ── DONE ──────────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(50))
  console.log('✅  IMPORT COMPLETE')
  console.log('═'.repeat(50))
  console.log(`   👥 Users:    ${newUsers}`)
  console.log(`   🏢 Clients:  ${newClients}`)
  console.log(`   📁 Projects: ${newProjects}`)
  console.log(`   📋 Phases:   ${totalPhases}`)
  console.log(`   ✅ Tasks:    ${totalTasks}`)
  console.log('\n   Default password for all users: password123')
  console.log('   Login at: http://localhost:3000\n')
}

run().catch(e => { console.error('\n❌ Fatal:', e.message); process.exit(1) })
