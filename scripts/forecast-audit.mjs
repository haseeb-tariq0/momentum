/**
 * Forecast.it Pre-Migration Audit
 *
 * READ-ONLY script. Makes zero writes to Forecast or Supabase — only GETs.
 *
 * What it does:
 *   1. Pulls every entity from Forecast via REST API
 *   2. Saves raw JSON dumps per entity to ./forecast-audit-out/raw/
 *   3. Analyses each entity (counts, orphans, FK integrity, odd values)
 *   4. Writes machine-readable summary to forecast-audit-out/audit-report.json
 *   5. Writes human-readable report to forecast-audit-out/audit-report.md
 *
 * Run from D:\forecast:
 *   node scripts/forecast-audit.mjs
 *
 * Requires FORECAST_API_KEY in .env.local
 *
 * Safe to re-run — output dir is wiped and rebuilt each time.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

// ── Load .env.local manually (matches existing import script pattern) ────────
try {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch { /* env file optional */ }

const FORECAST_API_KEY = process.env.FORECAST_API_KEY
const FORECAST_BASE    = 'https://api.forecast.it/api'
if (!FORECAST_API_KEY) {
  console.error('❌ FORECAST_API_KEY not set. Add it to .env.local:')
  console.error('   FORECAST_API_KEY=eb40eae0-...')
  process.exit(1)
}

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'forecast-audit-out')
const RAW_DIR = join(OUT_DIR, 'raw')
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(RAW_DIR, { recursive: true })

const t0 = Date.now()
function ts() { return ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's' }
function log(msg) { console.log(`[${ts()}] ${msg}`) }

// ── Forecast API helpers ─────────────────────────────────────────────────────
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function forecastGet(path, { retries = 3 } = {}) {
  const url = `${FORECAST_BASE}${path}`
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'X-FORECAST-API-KEY': FORECAST_API_KEY } })
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') || 5) * 1000
        log(`   ⏳ 429 rate-limit, sleeping ${wait}ms`)
        await sleep(wait); continue
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
      return await res.json()
    } catch (e) {
      if (attempt === retries) throw e
      await sleep(1000 * attempt)
    }
  }
}

// v4 paginated endpoints (currently only time_registrations)
async function forecastGetPaginated(basePath, { pageSize = 500 } = {}) {
  const all = []
  let page = 1, total = null
  while (true) {
    const sep = basePath.includes('?') ? '&' : '?'
    const data = await forecastGet(`${basePath}${sep}pageSize=${pageSize}&pageNumber=${page}`)
    if (total === null) total = data.totalObjectCount ?? 0
    const chunk = data.pageContents || []
    all.push(...chunk)
    if (all.length >= total || chunk.length === 0) break
    page++
    if (page % 10 === 0) log(`   ... page ${page}, ${all.length}/${total} fetched`)
    await sleep(100) // fair-use throttle
  }
  return { items: all, total }
}

function saveRaw(name, data) {
  writeFileSync(join(RAW_DIR, `${name}.json`), JSON.stringify(data, null, 2))
}

// Resilient wrapper — for endpoints that are nice-to-have but not critical.
// A 404/error here logs a warning and returns a fallback instead of aborting.
async function tryFetch(path, fallback = []) {
  try { return await forecastGet(path) }
  catch (e) { log(`   ⚠️  ${path} → ${e.message.split(' — ')[0]} (continuing)`); return fallback }
}

// ── Analysis helpers ─────────────────────────────────────────────────────────
function tally(arr, key) {
  const out = {}
  for (const x of arr) {
    const v = typeof key === 'function' ? key(x) : x[key]
    const k = v == null ? '(null)' : String(v)
    out[k] = (out[k] || 0) + 1
  }
  return out
}

function normName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function findDuplicates(arr, keyFn) {
  const groups = {}
  for (const x of arr) {
    const k = keyFn(x)
    if (!k) continue
    ;(groups[k] ||= []).push(x)
  }
  return Object.entries(groups)
    .filter(([, v]) => v.length > 1)
    .map(([k, v]) => ({ key: k, count: v.length, ids: v.map(x => x.id), names: v.map(x => x.name) }))
}

function dateRange(arr, field) {
  const dates = arr.map(x => x[field]).filter(Boolean).sort()
  return { earliest: dates[0] || null, latest: dates[dates.length - 1] || null, withValue: dates.length }
}

function minutesToHours(m) { return m == null ? null : Math.round((m / 60) * 100) / 100 }

// System/integration accounts — not real humans, their time entries are bulk imports
// Operations=594346, Forecast Service=594354, API=594362, Hubspot=634047, Slack=701416
const SYSTEM_IDS = new Set([594346, 594354, 594362, 634047, 701416])

// ── Per-entity audits ────────────────────────────────────────────────────────
function auditPersons(persons) {
  const systemUsers = persons.filter(p => p.user_type === 'SYSTEM' || SYSTEM_IDS.has(p.id))
  const clients     = persons.filter(p => p.user_type === 'CLIENT')
  const staff       = persons.filter(p => p.user_type !== 'SYSTEM' && p.user_type !== 'CLIENT' && !SYSTEM_IDS.has(p.id))
  const dupEmails   = findDuplicates(persons, p => normName(p.email))
  const dupNames    = findDuplicates(persons, p => `${normName(p.first_name)} ${normName(p.last_name)}`)
  const costs       = staff.map(p => p.cost).filter(c => c > 0).sort((a, b) => a - b)
  const costStats   = costs.length ? {
    min: costs[0], max: costs[costs.length - 1],
    median: costs[Math.floor(costs.length / 2)],
    outliers: staff.filter(p => p.cost > 400).map(p => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, cost: p.cost })),
  } : null
  return {
    total: persons.length,
    staff: staff.length,
    active: staff.filter(p => p.active).length,
    former: staff.filter(p => !p.active).length,
    clientLogins: clients.length,
    systemUsers: systemUsers.map(s => ({ id: s.id, name: s.first_name, type: s.user_type })),
    byUserType: tally(persons, 'user_type'),
    byDepartment: tally(staff, 'department_id'),
    missingEmail: persons.filter(p => !p.email && p.user_type !== 'SYSTEM').length,
    missingDepartment: staff.filter(p => !p.department_id).length,
    missingCost: staff.filter(p => !p.cost).length,
    duplicateEmails: dupEmails,
    duplicateNames: dupNames,
    costStats,
    dateRange: dateRange(persons, 'created_at'),
  }
}

function auditClients(clients) {
  const dups = findDuplicates(clients, c => normName(c.name))
  // Fuzzy: "Grey" vs "Gray", trailing spaces, etc. already caught by normName
  // Extra: containment matches (e.g. "Winter Valley" inside "Winter Valley For Real Estate")
  const fuzzy = []
  const names = clients.map(c => ({ id: c.id, norm: normName(c.name), orig: c.name }))
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i].norm, b = names[j].norm
      if (a === b) continue
      if (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) {
        fuzzy.push({ a: names[i].orig, b: names[j].orig, aId: names[i].id, bId: names[j].id })
      }
    }
  }
  return {
    total: clients.length,
    withNotes: clients.filter(c => c.notes).length,
    withAddress: clients.filter(c => c.street || c.city || c.country).length,
    exactDuplicates: dups,
    possibleContainmentDuplicates: fuzzy.slice(0, 50), // cap to keep readable
    dateRange: dateRange(clients, 'created_at'),
  }
}

function auditProjects(projects) {
  return {
    total: projects.length,
    withClient:   projects.filter(p => p.client).length,
    orphans:      projects.filter(p => !p.client).length,
    withBudget:   projects.filter(p => p.budget > 0).length,
    withRateCard: projects.filter(p => p.rate_card).length,
    missingRateCard: projects.filter(p => !p.rate_card).length,
    billable:     projects.filter(p => p.billable).length,
    byStage:      tally(projects, 'stage'),
    byBudgetType: tally(projects, 'budget_type'),
    byCurrency:   tally(projects, 'currency'),
    createdRange: dateRange(projects, 'created_at'),
    endDateRange: dateRange(projects, 'end_date'),
    startDateRange: dateRange(projects, 'start_date'),
  }
}

function auditTimeRegistrations(entries) {
  let totalMinutes = 0, billableMinutes = 0
  let garbage = [], systemUserEntries = 0, over24h = 0, zeroMins = 0
  let withTask = 0, withProject = 0, withNonProjectTime = 0, orphans = 0
  const byYear = {}, byApproval = tally(entries, 'approval_status')

  for (const e of entries) {
    const mins = e.time_registered || 0
    totalMinutes += mins
    billableMinutes += (e.billable_minutes_registered || 0)
    if (mins === 0) zeroMins++
    if (mins > 1440) over24h++
    if (SYSTEM_IDS.has(e.person)) {
      systemUserEntries++
      if (mins > 960) garbage.push({ id: e.id, person: e.person, date: e.date, hours: minutesToHours(mins) })
    }
    if (e.task) withTask++
    if (e.project) withProject++
    if (e.non_project_time) withNonProjectTime++
    if (!e.task && !e.project && !e.non_project_time) orphans++
    const y = (e.date || '').slice(0, 4)
    if (y) byYear[y] = (byYear[y] || 0) + 1
  }

  return {
    total: entries.length,
    totalHours: Math.round(totalMinutes / 60),
    billableHours: Math.round(billableMinutes / 60),
    billablePercent: totalMinutes > 0 ? Math.round((billableMinutes / totalMinutes) * 1000) / 10 : 0,
    byYear, byApproval,
    linkageBreakdown: { withTask, withProject, withNonProjectTime, orphans },
    anomalies: { zeroMinutes: zeroMins, over24Hours: over24h, systemUserEntries, garbageEntriesSample: garbage.slice(0, 20), garbageCount: garbage.length },
    dateRange: dateRange(entries, 'date'),
  }
}

function auditPhasesAndTasks(phaseMap, taskMap) {
  // phaseMap/taskMap: { projectId: [...records] }
  const projectsWithPhases = Object.keys(phaseMap).filter(pid => phaseMap[pid].length > 0).length
  const projectsWithTasks  = Object.keys(taskMap).filter(pid => taskMap[pid].length > 0).length
  const allTasks  = Object.values(taskMap).flat()
  const allPhases = Object.values(phaseMap).flat()
  const tasksNoAssignee = allTasks.filter(t => !t.assigned_persons || t.assigned_persons.length === 0).length
  const tasksNoEstimate = allTasks.filter(t => !t.estimate).length
  const tasksNoDates    = allTasks.filter(t => !t.start_date && !t.end_date).length
  return {
    phases: {
      total: allPhases.length,
      projectsWithPhases,
      avgPerProject: Object.keys(phaseMap).length ? Math.round(allPhases.length / Object.keys(phaseMap).length * 10) / 10 : 0,
    },
    tasks: {
      total: allTasks.length,
      projectsWithTasks,
      avgPerProject: Object.keys(taskMap).length ? Math.round(allTasks.length / Object.keys(taskMap).length * 10) / 10 : 0,
      tasksNoAssignee,
      tasksNoEstimate,
      tasksNoDates,
      bugs: allTasks.filter(t => t.bug).length,
      blocked: allTasks.filter(t => t.blocked).length,
      highPriority: allTasks.filter(t => t.high_priority).length,
      approved: allTasks.filter(t => t.approved).length,
      unbillable: allTasks.filter(t => t.un_billable).length,
    },
  }
}

function auditRateCards(cards, versions) {
  return {
    totalCards: cards.length,
    totalVersions: versions.length,
    versionsPerCard: cards.length ? Math.round(versions.length / cards.length * 10) / 10 : 0,
    cardsByCurrency: tally(cards, 'currency'),
  }
}

// ── Markdown report writer ───────────────────────────────────────────────────
function mdHeader(r) {
  return [
    `# Forecast.it Pre-Migration Audit Report`,
    ``,
    `Generated: ${new Date().toISOString()}  `,
    `Workspace data window: ${r.projects.createdRange.earliest} → ${r.projects.createdRange.latest}  `,
    `Total records pulled: ${(r.persons.total + r.clients.total + r.projects.total + r.timeReg.total).toLocaleString()}`,
    ``,
    `---`, ``,
    `## Executive summary`, ``,
    `| Entity | Count | Notes |`,
    `|---|---:|---|`,
    `| Persons | ${r.persons.total} | ${r.persons.staff} staff (${r.persons.active} active, ${r.persons.former} former), ${r.persons.clientLogins} client logins, ${r.persons.systemUsers.length} system |`,
    `| Clients | ${r.clients.total} | ${r.clients.exactDuplicates.length} exact duplicates, ${r.clients.possibleContainmentDuplicates.length} possible near-duplicates |`,
    `| Projects | ${r.projects.total} | ${r.projects.orphans} orphaned (no client), ${r.projects.missingRateCard} without rate card |`,
    `| Phases | ${r.phasesAndTasks.phases.total} | avg ${r.phasesAndTasks.phases.avgPerProject} per project |`,
    `| Tasks | ${r.phasesAndTasks.tasks.total} | ${r.phasesAndTasks.tasks.tasksNoAssignee} unassigned, ${r.phasesAndTasks.tasks.tasksNoEstimate} no estimate |`,
    `| Time entries | ${r.timeReg.total.toLocaleString()} | ${r.timeReg.totalHours.toLocaleString()}h total (${r.timeReg.billablePercent}% billable) |`,
    ``,
  ].join('\n')
}

function mdPersons(p) {
  const lines = [
    `## Persons`, ``,
    `- **${p.total}** total records — ${p.staff} staff, ${p.clientLogins} client logins, ${p.systemUsers.length} system users`,
    `- **${p.active}** active staff, **${p.former}** former`,
    `- Missing email: ${p.missingEmail} · Missing department: ${p.missingDepartment} · Missing cost: ${p.missingCost}`,
    ``,
  ]
  if (p.costStats) lines.push(`### Cost per hour (staff only)`, ``, `Min **${p.costStats.min}** · Median **${p.costStats.median}** · Max **${p.costStats.max}**`, ``)
  if (p.costStats?.outliers?.length) {
    lines.push(`**Cost outliers (> 400):**`, ``)
    p.costStats.outliers.forEach(o => lines.push(`- ${o.name} (id ${o.id}) — cost ${o.cost}`))
    lines.push(``)
  }
  if (p.duplicateEmails.length) lines.push(`### Duplicate emails`, ``, ...p.duplicateEmails.map(d => `- \`${d.key}\` → ids ${d.ids.join(', ')}`), ``)
  if (p.duplicateNames.length)  lines.push(`### Duplicate names`, ``, ...p.duplicateNames.map(d => `- \`${d.key}\` → ids ${d.ids.join(', ')} (may be same person rehired, or client-vs-staff)`), ``)
  return lines.join('\n')
}

function mdClients(c) {
  const lines = [
    `## Clients`, ``,
    `- **${c.total}** clients on record`,
    `- With address: ${c.withAddress} · With notes: ${c.withNotes}`,
    `- Date range: ${c.dateRange.earliest} → ${c.dateRange.latest}`,
    ``,
  ]
  if (c.exactDuplicates.length) {
    lines.push(`### Exact duplicates (same normalized name) — **${c.exactDuplicates.length} groups**`, ``)
    c.exactDuplicates.forEach(d => lines.push(`- **${d.names[0]}** × ${d.count} → ids ${d.ids.join(', ')}`))
    lines.push(``)
  }
  if (c.possibleContainmentDuplicates.length) {
    lines.push(`### Possible near-duplicates (one name contains the other) — **${c.possibleContainmentDuplicates.length} pairs**`, ``)
    c.possibleContainmentDuplicates.slice(0, 30).forEach(d => lines.push(`- "${d.a}" (id ${d.aId}) ↔ "${d.b}" (id ${d.bId})`))
    if (c.possibleContainmentDuplicates.length > 30) lines.push(`- ...and ${c.possibleContainmentDuplicates.length - 30} more (see JSON report)`)
    lines.push(``)
  }
  return lines.join('\n')
}

function mdProjects(p) {
  const stageLines = Object.entries(p.byStage).map(([k, v]) => `- ${k}: ${v}`).join('\n')
  const budgetLines = Object.entries(p.byBudgetType).map(([k, v]) => `- ${k}: ${v}`).join('\n')
  return [
    `## Projects`, ``,
    `- **${p.total}** total · **${p.withClient}** with client · **${p.orphans}** orphans`,
    `- Rate card coverage: **${p.withRateCard}** / ${p.total} (${Math.round(p.withRateCard / p.total * 100)}%)`,
    `- Budget coverage: **${p.withBudget}** / ${p.total} (${Math.round(p.withBudget / p.total * 100)}%)`,
    `- Billable: ${p.billable} / ${p.total}`,
    ``,
    `### By stage`, ``, stageLines, ``,
    `### By budget type`, ``, budgetLines, ``,
    `### Date ranges`, ``,
    `- Projects created: ${p.createdRange.earliest} → ${p.createdRange.latest}`,
    `- Project start dates: ${p.startDateRange.earliest} → ${p.startDateRange.latest}`,
    `- Project end dates: ${p.endDateRange.earliest} → ${p.endDateRange.latest}`,
    ``,
  ].join('\n')
}

function mdTimeReg(t) {
  const yearLines = Object.entries(t.byYear).sort().map(([y, n]) => `- ${y}: ${n.toLocaleString()} entries`).join('\n')
  const lines = [
    `## Time registrations`, ``,
    `- **${t.total.toLocaleString()}** total entries`,
    `- **${t.totalHours.toLocaleString()}h** total logged (**${t.billableHours.toLocaleString()}h** billable = ${t.billablePercent}%)`,
    `- Date range: ${t.dateRange.earliest} → ${t.dateRange.latest}`,
    ``,
    `### Linkage breakdown`, ``,
    `- With task (→ phase → project): ${t.linkageBreakdown.withTask.toLocaleString()}`,
    `- With project directly: ${t.linkageBreakdown.withProject.toLocaleString()}`,
    `- With non-project time (leave): ${t.linkageBreakdown.withNonProjectTime.toLocaleString()}`,
    `- **Orphans (no task/project/leave): ${t.linkageBreakdown.orphans.toLocaleString()}**`,
    ``,
    `### By year`, ``, yearLines, ``,
    `### Anomalies`, ``,
    `- Zero-minute entries: ${t.anomalies.zeroMinutes}`,
    `- Over-24-hour entries: **${t.anomalies.over24Hours}** (impossible — likely bulk imports)`,
    `- Entries from system users: ${t.anomalies.systemUserEntries.toLocaleString()}`,
    `- **Garbage entries (system user + >16h): ${t.anomalies.garbageCount}** — recommend skipping these during import`,
    ``,
  ]
  if (t.anomalies.garbageEntriesSample.length) {
    lines.push(`**Sample of garbage entries:**`, ``, `| id | person | date | hours |`, `|---|---:|---|---:|`)
    t.anomalies.garbageEntriesSample.forEach(g => lines.push(`| ${g.id} | ${g.person} | ${g.date} | ${g.hours} |`))
    lines.push(``)
  }
  return lines.join('\n')
}

function mdReferenceData(r) {
  return [
    `## Reference data`, ``,
    `| Type | Count |`, `|---|---:|`,
    `| Departments | ${r.departments} |`,
    `| Roles | ${r.roles} |`,
    `| Labels | ${r.labels} |`,
    `| Holiday calendars | ${r.holidayCalendars} |`,
    `| Non-project time categories | ${r.nonProjectTime} |`,
    `| Person cost periods (historical) | ${r.personCostPeriods} |`,
    `| Rate cards | ${r.rateCards.totalCards} (${r.rateCards.totalVersions} versions across them) |`,
    `| Deleted records | ${r.deleted} |`,
    ``,
  ].join('\n')
}

function mdImporterChecklist(r) {
  const items = []
  if (r.clients.exactDuplicates.length) items.push(`Dedupe **${r.clients.exactDuplicates.length}** exact-duplicate client groups before import`)
  if (r.clients.possibleContainmentDuplicates.length) items.push(`Manually review ${r.clients.possibleContainmentDuplicates.length} possible near-duplicate client pairs`)
  if (r.projects.orphans) items.push(`Decide fate of **${r.projects.orphans}** orphan projects (no client) — skip or assign to placeholder?`)
  if (r.projects.missingRateCard) items.push(`Flag **${r.projects.missingRateCard}** projects with no rate card — cost-of-effort won't resolve`)
  if (r.projects.byStage.OPPORTUNITY || r.projects.byStage.PLANNING) items.push(`Map OPPORTUNITY/PLANNING stages to new enum (currently running/halted/done)`)
  if (r.projects.byBudgetType.FIXED_PRICE_V2) items.push(`Map FIXED_PRICE_V2 → fixed_price, NON_BILLABLE → billable=false`)
  if (r.timeReg.anomalies.garbageCount) items.push(`**Skip ${r.timeReg.anomalies.garbageCount} garbage time entries** (system user + >16h)`)
  if (r.timeReg.linkageBreakdown.orphans) items.push(`${r.timeReg.linkageBreakdown.orphans} time entries have no task/project/leave — decide: skip, or attach to "misc"?`)
  items.push(`Convert time from minutes → hours (÷60) on insert`)
  items.push(`Join time entries via task → phase → project (NOT direct time_entry.project which is always null)`)
  items.push(`Use /v3/projects/{id}/tasks for tasks (v1 returns 404)`)
  items.push(`Use /v4/time_registrations for time entries (v3 deprecated)`)
  return [
    `## Importer to-do checklist`, ``,
    `Based on this audit, the import script must handle the following:`, ``,
    ...items.map((x, i) => `${i + 1}. ${x}`), ``,
  ].join('\n')
}

function writeMarkdownReport(r) {
  const md = [
    mdHeader(r),
    mdPersons(r.persons),
    mdClients(r.clients),
    mdProjects(r.projects),
    `## Phases & Tasks

- **${r.phasesAndTasks.phases.total}** phases across ${r.phasesAndTasks.phases.projectsWithPhases} projects (avg ${r.phasesAndTasks.phases.avgPerProject})
- **${r.phasesAndTasks.tasks.total.toLocaleString()}** tasks across ${r.phasesAndTasks.tasks.projectsWithTasks} projects (avg ${r.phasesAndTasks.tasks.avgPerProject})
- ${r.phasesAndTasks.tasks.tasksNoAssignee} unassigned · ${r.phasesAndTasks.tasks.tasksNoEstimate} no estimate · ${r.phasesAndTasks.tasks.tasksNoDates} no dates
- ${r.phasesAndTasks.tasks.bugs} flagged as bug · ${r.phasesAndTasks.tasks.blocked} blocked · ${r.phasesAndTasks.tasks.highPriority} high priority
`,
    mdTimeReg(r.timeReg),
    mdReferenceData(r.referenceData),
    mdImporterChecklist(r),
    `---`, ``,
    `Raw JSON dumps: \`./forecast-audit-out/raw/\``,
    `Machine-readable summary: \`./forecast-audit-out/audit-report.json\``,
    ``,
  ].join('\n')
  writeFileSync(join(OUT_DIR, 'audit-report.md'), md)
}

// ── Main runner ──────────────────────────────────────────────────────────────
async function run() {
  console.log('\n🔍 Forecast.it Pre-Migration Audit\n' + '═'.repeat(55))
  console.log(`Output: ${OUT_DIR}`)
  console.log(`Key:    ${FORECAST_API_KEY.slice(0, 8)}...${FORECAST_API_KEY.slice(-4)}\n`)

  // ── Pull everything ──
  log('👥 Persons...');            const persons  = await forecastGet('/v1/persons');            saveRaw('persons', persons);            log(`   → ${persons.length}`)
  log('🏢 Clients...');            const clients  = await forecastGet('/v1/clients');            saveRaw('clients', clients);            log(`   → ${clients.length}`)
  log('📁 Projects...');           const projects = await forecastGet('/v1/projects');           saveRaw('projects', projects);          log(`   → ${projects.length}`)
  log('🏢 Departments...');        const departments = await tryFetch('/v1/departments');        saveRaw('departments', departments);    log(`   → ${departments.length}`)
  log('🎭 Roles...');              const roles = await tryFetch('/v1/roles');                    saveRaw('roles', roles);                log(`   → ${roles.length}`)
  log('🏷️  Labels...');             const labels = await tryFetch('/v1/labels');                  saveRaw('labels', labels);              log(`   → ${labels.length}`)
  log('📅 Holiday calendars...');  const holidays = await tryFetch('/v1/holiday_calendars');     saveRaw('holiday_calendars', holidays); log(`   → ${holidays.length}`)
  log('🌴 Non-project time...');   const npt = await tryFetch('/v1/non_project_time');           saveRaw('non_project_time', npt);       log(`   → ${npt.length}`)
  log('💰 Rate cards...');         const rateCards = await tryFetch('/v1/rate_cards');           saveRaw('rate_cards', rateCards);       log(`   → ${rateCards.length}`)

  // Rate card versions are nested under each card (/v1/rate_cards/{id}/versions)
  log('💰 Rate card versions (nested per card)...')
  const rcVers = []
  for (const card of rateCards) {
    const versions = await tryFetch(`/v1/rate_cards/${card.id}/versions`)
    for (const v of versions) rcVers.push({ ...v, rate_card_id: card.id, rate_card_name: card.name })
    await sleep(50)
  }
  saveRaw('rate_card_versions', rcVers); log(`   → ${rcVers.length} versions across ${rateCards.length} cards`)

  log('👤 Person cost periods...'); const costPer = await tryFetch('/v1/person_cost_periods');   saveRaw('person_cost_periods', costPer); log(`   → ${costPer.length}`)
  log('🗑️  Deleted records...');    const deleted = await tryFetch('/v1/DeletedData', {});        saveRaw('deleted', deleted);            log(`   → ${Array.isArray(deleted) ? deleted.length : Object.keys(deleted).length}`)

  // Phases + tasks per project (slow — loop with throttle)
  log(`📋 Phases & tasks for ${projects.length} projects (slow)...`)
  const phaseMap = {}, taskMap = {}
  let phaseErrs = 0, taskErrs = 0
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]
    try { phaseMap[p.id] = await forecastGet(`/v1/projects/${p.id}/phases`) } catch { phaseErrs++; phaseMap[p.id] = [] }
    try { taskMap[p.id]  = await forecastGet(`/v3/projects/${p.id}/tasks`)  } catch { taskErrs++;  taskMap[p.id] = [] }
    if ((i + 1) % 50 === 0) log(`   ... ${i + 1}/${projects.length} projects scanned`)
    await sleep(80)
  }
  saveRaw('phases_by_project', phaseMap)
  saveRaw('tasks_by_project', taskMap)
  log(`   → ${Object.values(phaseMap).flat().length} phases, ${Object.values(taskMap).flat().length} tasks (${phaseErrs + taskErrs} errors)`)

  // Time registrations (paginated v4)
  log('⏱️  Time registrations (paginated)...')
  const { items: timeEntries, total: timeTotal } = await forecastGetPaginated('/v4/time_registrations', { pageSize: 500 })
  saveRaw('time_registrations', timeEntries)
  log(`   → ${timeEntries.length} / ${timeTotal}`)

  // ── Analyse ──
  log('🧪 Analysing...')
  const report = {
    generatedAt: new Date().toISOString(),
    workspace: { earliestRecord: persons.reduce((m, p) => p.created_at && p.created_at < m ? p.created_at : m, '9999') },
    persons: auditPersons(persons),
    clients: auditClients(clients),
    projects: auditProjects(projects),
    phasesAndTasks: auditPhasesAndTasks(phaseMap, taskMap),
    timeReg: auditTimeRegistrations(timeEntries),
    referenceData: {
      departments: departments.length,
      roles: roles.length,
      labels: labels.length,
      holidayCalendars: holidays.length,
      nonProjectTime: npt.length,
      personCostPeriods: costPer.length,
      rateCards: auditRateCards(rateCards, rcVers),
      deleted: Array.isArray(deleted) ? deleted.length : Object.keys(deleted).length,
    },
  }

  // ── Write reports ──
  writeFileSync(join(OUT_DIR, 'audit-report.json'), JSON.stringify(report, null, 2))
  writeMarkdownReport(report)

  // ── Console summary ──
  console.log('\n' + '═'.repeat(55))
  console.log('✅  AUDIT COMPLETE')
  console.log('═'.repeat(55))
  console.log(`   👥 Persons:       ${report.persons.total} (${report.persons.active} active staff)`)
  console.log(`   🏢 Clients:       ${report.clients.total}  ⚠ ${report.clients.exactDuplicates.length} dup groups, ${report.clients.possibleContainmentDuplicates.length} near-dupes`)
  console.log(`   📁 Projects:      ${report.projects.total}  ⚠ ${report.projects.orphans} orphans, ${report.projects.missingRateCard} no rate card`)
  console.log(`   📋 Phases/Tasks:  ${report.phasesAndTasks.phases.total} / ${report.phasesAndTasks.tasks.total}`)
  console.log(`   ⏱️  Time entries:  ${report.timeReg.total.toLocaleString()}  ⚠ ${report.timeReg.anomalies.garbageCount} garbage entries`)
  console.log(`\n   📄 Report:   ${join(OUT_DIR, 'audit-report.md')}`)
  console.log(`   📦 Raw data: ${RAW_DIR}\n`)
}

run().catch(e => { console.error('\n❌ Fatal:', e.message); console.error(e.stack); process.exit(1) })
