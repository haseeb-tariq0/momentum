/**
 * Forecast.it → Supabase import, driven from the on-disk JSON snapshot in
 * scripts/forecast-audit-out/raw/ (not the live Forecast API).
 *
 * Strategy:
 *  • Upsert every entity keyed by forecast_id (already indexed unique per
 *    workspace). Existing dev rows with forecast_id = null are left alone.
 *  • For entities that exist in BOTH the snapshot AND as dev rows (same
 *    natural key — client name / user email / department name), backfill
 *    forecast_id on the dev row so it becomes "owned" by the Forecast source
 *    and future re-imports update in place instead of creating duplicates.
 *  • Import order mirrors FK dependencies: lookup tables → parents → children.
 *  • Forecast IDs are integers, stored in a bigint column. In-memory maps
 *    (forecastId → supabaseUuid) are built per entity for child joins.
 *
 * Usage:
 *   cd D:\forecast
 *   node packages/db/import-from-snapshot.mjs [--dry-run] [--refresh]
 *       [--only users,clients] [--skip time_entries] [--workspace-id <uuid>]
 *
 * Flags:
 *   --dry-run  Report what would be written, don't write.
 *   --refresh  After inserting new rows, UPDATE existing rows from the
 *              snapshot too. Without this flag, rows that already exist by
 *              forecast_id are skipped entirely — which is what caused the
 *              Apr 22 bug where 183 Running projects had NULL end_date in
 *              our DB forever because an early import run got it wrong and
 *              every subsequent run said "already exists, nothing to do."
 *              Per Murtaza's Apr 22 spec: "only start and end date are
 *              manually entered for each project" — Forecast is source of
 *              truth for projects/phases/tasks/clients/labels, so re-running
 *              with --refresh keeps us aligned instead of frozen.
 *              Users are NEVER refreshed (would clobber password_hash and
 *              permission_profile promotions done in-app). Time entries are
 *              aggregated separately and also not affected by this flag.
 *
 * Re-runnable: running twice is a no-op on unchanged data. Safe to interrupt
 * mid-run (Ctrl-C) and restart.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

// ── Env loading ─────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
// .env.local lives at the repo root — two directories up from packages/db/
const ENV_PATH = resolve(__dirname, '..', '..', '.env.local')
if (existsSync(ENV_PATH)) {
  const raw = readFileSync(ENV_PATH, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) {
      let v = m[2]
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}

const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const DEFAULT_PW     = process.env.IMPORT_DEFAULT_PASSWORD_HASH
// Workspace into which everything is imported. Defaults to the single-tenant
// Digital NEXA workspace the app ships with.
const WORKSPACE_ID   = process.env.WORKSPACE_ID || '00000000-0000-0000-0000-000000000001'
// Script now lives under packages/db/ so @supabase/supabase-js resolves, but
// the JSON snapshot is still at repo-root/scripts/forecast-audit-out. Two
// levels up, then into scripts.
const SNAPSHOT_DIR   = resolve(__dirname, '..', '..', 'scripts', 'forecast-audit-out', 'raw')

if (!SUPABASE_URL || !SUPABASE_KEY || !DEFAULT_PW) {
  console.error('❌ Missing env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / IMPORT_DEFAULT_PASSWORD_HASH)')
  process.exit(1)
}
if (!existsSync(SNAPSHOT_DIR)) {
  console.error(`❌ Snapshot dir not found: ${SNAPSHOT_DIR}`)
  console.error('   Run scripts/forecast-audit.mjs first to produce the JSON dump.')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DRY     = args.includes('--dry-run')
// --refresh: re-apply snapshot values on top of existing rows. See the
// header comment for the full rationale. Short version: without this flag,
// a single broken first import run can freeze wrong values into the DB
// forever — re-runs just say "already exists" and move on.
const REFRESH = args.includes('--refresh')
function argVal(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}
const only = argVal('--only')?.split(',').map(s => s.trim()) || null
const skip = argVal('--skip')?.split(',').map(s => s.trim()) || []

// Guard against a destructive combination we got burned by on Apr 22:
// `--only projects --refresh` wipes client_id/rate_card_id on EVERY project
// because the clientMap / rateCardMap are never populated (those blocks were
// skipped), so `clientMap.get(p.client)` returns undefined → row is refreshed
// with client_id=null. Same trap for any --only subset that skips upstream
// lookups. Refuse the combo outright; force a full run.
if (REFRESH && (only || skip.length)) {
  console.error('❌ --refresh cannot be combined with --only or --skip.')
  console.error('   Refreshing a subset nulls out foreign keys on the refreshed')
  console.error('   rows because dependency maps from skipped stages are empty.')
  console.error('   Run without --only/--skip, or drop --refresh.')
  process.exit(1)
}

function shouldRun(entity) {
  if (only && !only.includes(entity)) return false
  if (skip.includes(entity)) return false
  return true
}

// ── Logging helpers ─────────────────────────────────────────────────────────
const t0 = Date.now()
function log(...a) { console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a) }
function banner(s) { console.log('\n' + '═'.repeat(60) + '\n ' + s + '\n' + '═'.repeat(60)) }

// ── Snapshot loaders ────────────────────────────────────────────────────────
function loadJSON(filename) {
  const p = join(SNAPSHOT_DIR, filename)
  const raw = readFileSync(p, 'utf8')
  return JSON.parse(raw)
}
function sizeOf(filename) {
  const p = join(SNAPSHOT_DIR, filename)
  const b = readFileSync(p).length
  return b < 1024 ? `${b}B` : b < 1024 * 1024 ? `${(b/1024).toFixed(1)}KB` : `${(b/1024/1024).toFixed(1)}MB`
}

// ── Enum mappers ────────────────────────────────────────────────────────────
function mapProjectStatus(stage) {
  if (!stage) return 'running'
  const s = String(stage).toLowerCase()
  if (s === 'opportunity') return 'opportunity'
  if (s === 'planning')    return 'planning'
  if (s === 'halted')      return 'halted'
  if (s === 'done' || s === 'closed' || s === 'archived') return 'done'
  return 'running'
}
function mapBudgetType(t) {
  const s = String(t || '').toUpperCase()
  if (s === 'RETAINER')            return { budget_type: 'retainer',           billable: true }
  if (s === 'TIME_AND_MATERIALS')  return { budget_type: 'time_and_materials', billable: true }
  if (s === 'NON_BILLABLE')        return { budget_type: 'fixed_price',        billable: false }
  // FIXED_PRICE_V2 and anything else → fixed_price
  return { budget_type: 'fixed_price', billable: true }
}
function mapTaskStatus(t) {
  if (t.approved === true && (t.remaining === 0 || t.remaining === null)) return 'done'
  if (t.remaining != null && t.estimate != null && t.remaining < t.estimate) return 'in_progress'
  return 'todo'
}
// Forecast capacity is given as daily minutes (monday, tuesday, ... sunday).
// Sum to weekly hours for our capacity_hrs field.
function computeCapacityHrs(p) {
  const mins = (p.monday||0) + (p.tuesday||0) + (p.wednesday||0) + (p.thursday||0) + (p.friday||0) + (p.saturday||0) + (p.sunday||0)
  if (!mins) return 40  // sensible default for contracts with unknown shape
  return Math.round(mins / 60 * 10) / 10
}

// ── Core dedup-insert helper ────────────────────────────────────────────────
// Builds a forecast_id → supabase UUID map by:
//   1. Fetching existing rows whose forecast_id is in our input set
//   2. Filtering input down to rows NOT already present
//   3. Plain INSERTing the new rows in batches
//
// Why this instead of upsert(): the `forecast_id` unique indexes are partial
// (`WHERE forecast_id IS NOT NULL`), and PostgREST can't target partial
// unique indexes with ON CONFLICT. Attempts fail with Postgres error 42P10
// ("no unique or exclusion constraint matching the ON CONFLICT specification").
// Plain INSERT + pre-dedup avoids the conflict machinery entirely and is
// also easier to reason about.
//
// `conflict` param is kept for backwards-compat but ignored — all call
// sites pass either 'forecast_id' (no workspace scope) or 'workspace_id,forecast_id'
// (scoped). We honour the scoping via `workspaceScoped`.
async function upsertByForecastId({ table, rows, conflict, label, refreshable = false }) {
  const workspaceScoped = String(conflict || '').includes('workspace_id')
  if (DRY) {
    log(`  [dry-run] would dedup+insert ${rows.length} ${label}`)
    return new Map()
  }
  const map = new Map()
  if (!rows.length) return map

  // ── Phase 1: fetch existing rows by forecast_id ────────────────────────────
  // We chunk the IN (...) list because PostgREST's URL length limit caps around
  // ~2000 ids per request. 500 per chunk is safe and still fast.
  const fids = rows.map(r => Number(r.forecast_id)).filter(n => Number.isFinite(n))
  const existing = []
  const LOOKUP_CHUNK = 500
  for (let i = 0; i < fids.length; i += LOOKUP_CHUNK) {
    const chunk = fids.slice(i, i + LOOKUP_CHUNK)
    let q = db.from(table).select('id, forecast_id').in('forecast_id', chunk)
    if (workspaceScoped) q = q.eq('workspace_id', WORKSPACE_ID)
    const { data, error } = await q
    if (error) {
      console.error(`  ✗ ${table} lookup chunk ${i}-${i+chunk.length} failed:`, error.message)
      continue
    }
    for (const r of data || []) existing.push(r)
  }
  const existingSet = new Set()
  for (const r of existing) {
    map.set(Number(r.forecast_id), r.id)
    existingSet.add(Number(r.forecast_id))
  }

  const newRows = rows.filter(r => !existingSet.has(Number(r.forecast_id)))

  // ── Phase 1b: REFRESH existing rows from snapshot (only if --refresh set) ──
  // This is the permanent fix for the "stale data frozen from broken first
  // import" class of bug. For tables the caller has opted in (refreshable:
  // true), we upsert-by-id to re-apply every snapshot field over top of the
  // existing row. `id` has a proper full unique index (primary key), so the
  // 42P10 partial-index trap doesn't apply here — we can use ON CONFLICT.
  let refreshed = 0, refreshFailed = 0
  if (REFRESH && refreshable && existingSet.size > 0) {
    const existingRows = rows
      .filter(r => existingSet.has(Number(r.forecast_id)))
      .map(r => ({ ...r, id: map.get(Number(r.forecast_id)) }))
    const RBATCH = 200
    for (let i = 0; i < existingRows.length; i += RBATCH) {
      const chunk = existingRows.slice(i, i + RBATCH)
      const { error } = await db.from(table).upsert(chunk, { onConflict: 'id' })
      if (error) {
        console.error(`  ✗ ${table} refresh batch ${i}-${i+chunk.length} failed:`, error.message)
        // Per-row fallback so one bad row doesn't kill the batch.
        for (const r of chunk) {
          const { id, ...fields } = r
          const { error: eOne } = await db.from(table).update(fields).eq('id', id)
          if (eOne) {
            refreshFailed++
            if (refreshFailed <= 5) console.error(`    ✗ forecast_id=${r.forecast_id}: ${eOne.message}`)
            else if (refreshFailed === 6) console.error(`    ... (suppressing further per-row refresh errors)`)
          } else {
            refreshed++
          }
        }
        continue
      }
      refreshed += chunk.length
    }
  }

  if (newRows.length === 0) {
    if (REFRESH && refreshable) {
      log(`  ${table}: 0 inserted, ${refreshed} refreshed from snapshot${refreshFailed ? `, ${refreshFailed} failed` : ''}`)
    } else if (REFRESH && !refreshable) {
      log(`  ${table}: all ${rows.length} already exist — skipping refresh (table not opted in)`)
    } else {
      log(`  ${table}: all ${rows.length} already exist — nothing to insert (pass --refresh to update from snapshot)`)
    }
    return map
  }

  // ── Phase 2: insert new rows in batches ────────────────────────────────────
  const BATCH = 500
  let inserted = 0, failed = 0
  for (let i = 0; i < newRows.length; i += BATCH) {
    const chunk = newRows.slice(i, i + BATCH)
    const { data, error } = await db.from(table).insert(chunk).select('id, forecast_id')
    if (error) {
      console.error(`  ✗ ${table} insert batch ${i}-${i+chunk.length} failed:`, error.message)
      // Row-by-row recovery — a single bad row shouldn't lose the rest of the batch.
      for (const r of chunk) {
        const { data: one, error: eOne } = await db.from(table).insert([r]).select('id, forecast_id')
        if (eOne) {
          failed++
          if (failed <= 5) console.error(`    ✗ forecast_id=${r.forecast_id}: ${eOne.message}`)
          else if (failed === 6) console.error(`    ... (suppressing further per-row errors)`)
        } else if (one?.[0]) {
          map.set(Number(one[0].forecast_id), one[0].id); inserted++
        }
      }
      continue
    }
    for (const r of data || []) { map.set(Number(r.forecast_id), r.id); inserted++ }
  }
  log(`  ${table}: ${inserted} inserted, ${existing.length} already existed${REFRESH && refreshable ? ` (${refreshed} refreshed from snapshot)` : ''}, ${failed + refreshFailed} failed`)
  return map
}

// Backfill forecast_id on any dev row whose natural key matches a Forecast
// entity. This is what makes "keep dev rows, merge real data in" actually
// work — otherwise we'd end up with two "Solution Leisure Group" clients.
async function backfillForecastIds({ table, naturalKey, wherePairs, workspaceScoped = true }) {
  if (DRY) return 0
  let updated = 0
  for (const [natVal, forecastId] of wherePairs) {
    if (!natVal) continue
    let q = db.from(table).update({ forecast_id: forecastId }).is('forecast_id', null).eq(naturalKey, natVal)
    if (workspaceScoped) q = q.eq('workspace_id', WORKSPACE_ID)
    const { error, count } = await q.select('id', { count: 'exact', head: true })
    if (!error && count) updated += count
  }
  return updated
}

// ── Main ────────────────────────────────────────────────────────────────────
banner('🚀 Forecast snapshot → Supabase import')
log(`Workspace: ${WORKSPACE_ID}`)
log(`Snapshot:  ${SNAPSHOT_DIR}`)
log(`Mode:      ${DRY ? 'DRY RUN (no writes)' : 'LIVE'}${REFRESH ? ' + REFRESH (update existing rows from snapshot)' : ''}`)
if (only) log(`--only:    ${only.join(', ')}`)
if (skip.length) log(`--skip:    ${skip.join(', ')}`)

// ── 1. Departments ──────────────────────────────────────────────────────────
let deptMap = new Map()
if (shouldRun('departments')) {
  banner('1. Departments')
  const src = loadJSON('departments.json')
  log(`Loaded ${src.length} departments from departments.json (${sizeOf('departments.json')})`)

  // Backfill existing dev rows matching by name (case-insensitive would be
  // ideal but we can't case-match in a single query — and the dev data is
  // known-small, so exact match is fine here).
  const pairs = src.map(d => [String(d.name || '').trim(), d.id]).filter(([n]) => n)
  const bf = await backfillForecastIds({ table: 'departments', naturalKey: 'name', wherePairs: pairs })
  if (bf) log(`Backfilled forecast_id on ${bf} existing dev departments`)

  const rows = src.map(d => ({
    workspace_id: WORKSPACE_ID,
    name: String(d.name || '').trim(),
    forecast_id: d.id,
  })).filter(r => r.name)

  deptMap = await upsertByForecastId({
    table: 'departments', rows, conflict: 'workspace_id,forecast_id', label: 'departments', refreshable: true,
  })
  log(`✓ departments: ${deptMap.size} mapped`)
}

// ── 2. Holiday calendars ────────────────────────────────────────────────────
let calMap = new Map()
if (shouldRun('holiday_calendars')) {
  banner('2. Holiday calendars')
  const src = loadJSON('holiday_calendars.json')
  log(`Loaded ${src.length} calendars`)
  // Backfill by name where possible
  const pairs = src.map(c => [String(c.name || '').trim(), c.id]).filter(([n]) => n)
  const bf = await backfillForecastIds({ table: 'holiday_calendars', naturalKey: 'name', wherePairs: pairs })
  if (bf) log(`Backfilled forecast_id on ${bf} existing dev calendars`)

  const rows = src.map(c => ({
    workspace_id: WORKSPACE_ID,
    name: String(c.name || '').trim() || 'Calendar',
    country: c.name || null,  // forecast has no country_code, just a name
    forecast_id: c.id,
  })).filter(r => r.name)

  calMap = await upsertByForecastId({
    table: 'holiday_calendars', rows, conflict: 'workspace_id,forecast_id', label: 'calendars', refreshable: true,
  })
  log(`✓ holiday_calendars: ${calMap.size} mapped`)
}

// ── 3. Rate cards ───────────────────────────────────────────────────────────
let rateCardMap = new Map()
if (shouldRun('rate_cards')) {
  banner('3. Rate cards')
  const src = loadJSON('rate_cards.json')
  log(`Loaded ${src.length} rate cards`)
  const pairs = src.map(rc => [String(rc.name || '').trim(), rc.id]).filter(([n]) => n)
  const bf = await backfillForecastIds({ table: 'rate_cards', naturalKey: 'name', wherePairs: pairs })
  if (bf) log(`Backfilled forecast_id on ${bf} existing dev rate cards`)

  const rows = src.map(rc => ({
    workspace_id: WORKSPACE_ID,
    name: String(rc.name || '').trim() || `Rate Card ${rc.id}`,
    currency: rc.currency || 'AED',
    forecast_id: rc.id,
  }))
  rateCardMap = await upsertByForecastId({
    table: 'rate_cards', rows, conflict: 'workspace_id,forecast_id', label: 'rate cards', refreshable: true,
  })
  log(`✓ rate_cards: ${rateCardMap.size} mapped`)

  // Rate card entries come from rate_card_versions.json. Each version has a
  // `rates` array with {role, rate, ...} — we take the LATEST version per
  // card and use its rates as our active entries. Historical versions are
  // not carried over (phase-1 scope).
  banner('3b. Rate card entries')
  const versions = loadJSON('rate_card_versions.json')
  log(`Loaded ${versions.length} versions`)

  // Group versions by rate_card_id, take the one with latest (or null)
  // start_date — null means "active going forward", which is typically the
  // most recent.
  const byCard = new Map()
  for (const v of versions) {
    const cur = byCard.get(v.rate_card_id)
    if (!cur) { byCard.set(v.rate_card_id, v); continue }
    // Prefer the one with the latest start_date; null start_date ranks highest.
    const curScore = cur.start_date ? new Date(cur.start_date).getTime() : Infinity
    const newScore = v.start_date ? new Date(v.start_date).getTime() : Infinity
    if (newScore > curScore) byCard.set(v.rate_card_id, v)
  }
  log(`Picked latest version for ${byCard.size} cards`)

  // Roles in Forecast ≈ job_titles in our model (we don't have role_id).
  // We store hourly_rate keyed by job_title for now; department-based
  // resolution can come later when we have a role→department lookup.
  const roles = loadJSON('roles.json')
  const roleName = new Map(roles.map(r => [r.id, r.name]))

  let rceRows = []
  for (const [fCardId, ver] of byCard) {
    const ourCardId = rateCardMap.get(fCardId)
    if (!ourCardId) continue
    for (const rate of ver.rates || []) {
      const jobTitle = roleName.get(rate.role) || `Role ${rate.role}`
      rceRows.push({
        rate_card_id: ourCardId,
        job_title: jobTitle,
        hourly_rate: Number(rate.rate || ver.default_rate || 0),
        // Stable synthetic forecast_id: card × 100000 + role (roles are all < 1M,
        // rate_card ids are all < 1M, product fits in bigint fine).
        forecast_id: fCardId * 1_000_000 + rate.role,
      })
    }
  }
  log(`Building ${rceRows.length} entries`)
  await upsertByForecastId({
    table: 'rate_card_entries', rows: rceRows, conflict: 'forecast_id', label: 'rate card entries', refreshable: true,
  })
  log(`✓ rate_card_entries upserted`)
}

// ── 4. Project labels ───────────────────────────────────────────────────────
let labelMap = new Map()
if (shouldRun('labels')) {
  banner('4. Project labels')
  const src = loadJSON('labels.json')
  log(`Loaded ${src.length} labels`)
  const pairs = src.map(l => [String(l.name || '').trim(), l.id]).filter(([n]) => n)
  const bf = await backfillForecastIds({ table: 'project_labels', naturalKey: 'name', wherePairs: pairs })
  if (bf) log(`Backfilled forecast_id on ${bf} existing dev labels`)

  const rows = src.map(l => ({
    workspace_id: WORKSPACE_ID,
    name: String(l.name || '').trim() || `Label ${l.id}`,
    color: l.color || '#8888a0',
    forecast_id: l.id,
  }))
  labelMap = await upsertByForecastId({
    table: 'project_labels', rows, conflict: 'workspace_id,forecast_id', label: 'labels', refreshable: true,
  })
  log(`✓ project_labels: ${labelMap.size} mapped`)
}

// ── 5. Internal + time-off categories ───────────────────────────────────────
let internalCatMap = new Map(), timeOffCatMap = new Map()
if (shouldRun('time_categories')) {
  banner('5. Time categories (internal + time-off)')
  const src = loadJSON('non_project_time.json')
  log(`Loaded ${src.length} categories`)
  const internals = src.filter(c => c.is_internal_time === true)
  const timeOffs  = src.filter(c => c.is_internal_time === false)
  log(`  • ${internals.length} internal, ${timeOffs.length} time-off`)

  // Internal
  const iPairs = internals.map(c => [String(c.name || '').trim(), c.id]).filter(([n]) => n)
  const iBf = await backfillForecastIds({ table: 'internal_time_categories', naturalKey: 'name', wherePairs: iPairs })
  if (iBf) log(`  Backfilled forecast_id on ${iBf} existing dev internal categories`)

  const iRows = internals.map(c => ({
    workspace_id: WORKSPACE_ID,
    name: String(c.name || '').trim() || `Category ${c.id}`,
    active: true,
    forecast_id: c.id,
  }))
  internalCatMap = await upsertByForecastId({
    table: 'internal_time_categories', rows: iRows, conflict: 'workspace_id,forecast_id', label: 'internal cats', refreshable: true,
  })

  // Time-off
  const oPairs = timeOffs.map(c => [String(c.name || '').trim(), c.id]).filter(([n]) => n)
  const oBf = await backfillForecastIds({ table: 'time_off_categories', naturalKey: 'name', wherePairs: oPairs })
  if (oBf) log(`  Backfilled forecast_id on ${oBf} existing dev time-off categories`)

  const oRows = timeOffs.map(c => ({
    workspace_id: WORKSPACE_ID,
    name: String(c.name || '').trim() || `Category ${c.id}`,
    active: true,
    forecast_id: c.id,
  }))
  timeOffCatMap = await upsertByForecastId({
    table: 'time_off_categories', rows: oRows, conflict: 'workspace_id,forecast_id', label: 'time-off cats', refreshable: true,
  })
  log(`✓ ${internalCatMap.size} internal + ${timeOffCatMap.size} time-off categories mapped`)
}

// ── 6. Users (persons) ──────────────────────────────────────────────────────
let personMap = new Map()
if (shouldRun('users')) {
  banner('6. Users (from persons.json)')
  const src = loadJSON('persons.json')
  log(`Loaded ${src.length} persons`)
  // Filter: staff only. Forecast's user_type values we've seen in the snapshot:
  //   ADMIN(3) COLLABORATOR(96) CONTROLLER(38) COORDINATOR(2) MANAGER(5) CLIENT(21) SYSTEM(4)
  // We skip CLIENT (external client logins like aaron.j@cognition.agency) and
  // SYSTEM (API/service accounts with empty emails). Everyone else is staff.
  const STAFF_TYPES = new Set(['ADMIN', 'COLLABORATOR', 'CONTROLLER', 'COORDINATOR', 'MANAGER'])
  const staff = src.filter(p => STAFF_TYPES.has(p.user_type))
  log(`  • ${staff.length} staff, ${src.length - staff.length} filtered out`)

  const withEmail = staff.filter(p => p.email && p.email.includes('@'))
  if (withEmail.length !== staff.length) log(`  • ${staff.length - withEmail.length} without email (skipped)`)

  // Backfill existing dev users by email (case-insensitive on the app side,
  // but emails in dev seed use lowercase so exact match is fine).
  const pairs = withEmail.map(p => [String(p.email || '').toLowerCase().trim(), p.id]).filter(([e]) => e)
  const bf = await backfillForecastIds({ table: 'users', naturalKey: 'email', wherePairs: pairs })
  if (bf) log(`Backfilled forecast_id on ${bf} existing dev users`)

  // Forecast stores job titles as "roles" keyed by person.default_role.
  // Some role names have leading/trailing whitespace in the source — trim.
  const rolesForTitle = loadJSON('roles.json')
  const roleNameForTitle = new Map(rolesForTitle.map(r => [r.id, String(r.name || '').trim()]))

  // Permission mapping: ADMIN/MANAGER → admin, rest → collaborator. No
  // super_admin from the import — only the dev owner (Murtaza) is super_admin,
  // and he's preserved by the upsert skipping pre-existing rows without a
  // forecast_id. The caller can promote specific people via Admin UI after.
  function mapProfile(ut) {
    if (ut === 'ADMIN' || ut === 'MANAGER') return 'admin'
    return 'collaborator'
  }

  const rows = withEmail.map(p => ({
    workspace_id:       WORKSPACE_ID,
    email:              String(p.email).toLowerCase().trim(),
    name:               `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(p.email).split('@')[0],
    password_hash:      DEFAULT_PW,
    job_title:          (p.default_role && roleNameForTitle.get(p.default_role)) || null,
    department_id:      p.department_id ? (deptMap.get(p.department_id) || null) : null,
    holiday_calendar_id: p.holiday_calendar_id ? (calMap.get(p.holiday_calendar_id) || null) : null,
    capacity_hrs:       computeCapacityHrs(p),
    internal_hourly_cost: Number(p.cost || 0),
    active:             p.active !== false,
    permission_profile: mapProfile(p.user_type),
    seat_type:          'core',
    timezone:           'Asia/Dubai',
    start_date:         p.start_date || null,
    end_date:           p.end_date   || null,
    forecast_id:        p.id,
  }))
  // ⚠️ NOT refreshable. Doing `refreshable: true` here would stomp on:
  //   • password_hash — every user would get reset to DEFAULT_PW, locking
  //     out anyone who changed their password.
  //   • permission_profile — any in-app promotions to admin/super_admin
  //     would be reverted back to the imported role on each run.
  //   • active — if someone was manually deactivated in our app but is
  //     still active in Forecast, we'd reactivate them.
  // Users must be managed via the Admin UI going forward. The import still
  // INSERTS new users discovered in the snapshot, but leaves existing ones
  // completely untouched.
  personMap = await upsertByForecastId({
    table: 'users', rows, conflict: 'workspace_id,forecast_id', label: 'users',
  })
  log(`✓ users: ${personMap.size} mapped`)
}

// ── 7. Clients ──────────────────────────────────────────────────────────────
let clientMap = new Map()
if (shouldRun('clients')) {
  banner('7. Clients')
  const src = loadJSON('clients.json')
  log(`Loaded ${src.length} clients`)
  const pairs = src.map(c => [String(c.name || '').trim(), c.id]).filter(([n]) => n)
  const bf = await backfillForecastIds({ table: 'clients', naturalKey: 'name', wherePairs: pairs })
  if (bf) log(`Backfilled forecast_id on ${bf} existing dev clients`)

  const rows = src.map(c => ({
    workspace_id: WORKSPACE_ID,
    name: String(c.name || '').trim() || `Client ${c.id}`,
    country: c.country || null,
    address: [c.street, c.zip, c.city].filter(Boolean).join(', ') || null,
    active: true,
    forecast_id: c.id,
  })).filter(r => r.name)
  clientMap = await upsertByForecastId({
    table: 'clients', rows, conflict: 'workspace_id,forecast_id', label: 'clients', refreshable: true,
  })
  log(`✓ clients: ${clientMap.size} mapped`)
}

// ── 8. Projects ─────────────────────────────────────────────────────────────
let projectMap = new Map()
if (shouldRun('projects')) {
  banner('8. Projects')
  const src = loadJSON('projects.json')
  log(`Loaded ${src.length} projects`)
  const pairs = src.map(p => [String(p.name || '').trim(), p.id]).filter(([n]) => n)
  const bf = await backfillForecastIds({ table: 'projects', naturalKey: 'name', wherePairs: pairs })
  if (bf) log(`Backfilled forecast_id on ${bf} existing dev projects`)

  const colors = ['#0D9488','#7C3AED','#2563EB','#D97706','#DC2626','#059669','#0891B2','#BE185D']
  const rows = src.map((p, i) => {
    const { budget_type, billable } = mapBudgetType(p.budget_type)
    return {
      workspace_id: WORKSPACE_ID,
      name:         String(p.name || '').trim() || `Project ${p.id}`,
      client_id:    p.client ? (clientMap.get(p.client) || null) : null,
      rate_card_id: p.rate_card ? (rateCardMap.get(p.rate_card) || null) : null,
      status:       mapProjectStatus(p.stage),
      color:        p.color || colors[i % colors.length],
      budget_type,
      billable:     p.billable === false ? false : billable,
      budget_amount: p.budget != null ? Number(p.budget) : null,
      currency:     'AED',
      start_date:   p.start_date || null,
      end_date:     p.end_date || null,
      description:  null,  // skip HTML descriptions — they contain Forecast-specific DraftJS wrappers
      forecast_id:  p.id,
    }
  })
  // ⚠️ refreshable=true: projects are EXACTLY where the drift bug happened
  // (Apr 22: 183 Running projects had NULL end_date forever because an
  // earlier run put wrong values in and subsequent runs just skipped them).
  // Re-importing with --refresh now corrects status / start_date / end_date /
  // budget / name / client_id / rate_card_id / color automatically.
  projectMap = await upsertByForecastId({
    table: 'projects', rows, conflict: 'workspace_id,forecast_id', label: 'projects', refreshable: true,
  })
  log(`✓ projects: ${projectMap.size} mapped`)

  // Project→label join rows
  if (shouldRun('labels') || shouldRun('project_labels')) {
    const joinRows = []
    for (const p of src) {
      const projId = projectMap.get(p.id)
      if (!projId || !Array.isArray(p.labels)) continue
      for (const fLabelId of p.labels) {
        const labelId = labelMap.get(fLabelId)
        if (labelId) joinRows.push({ project_id: projId, label_id: labelId })
      }
    }
    if (joinRows.length) {
      log(`Inserting ${joinRows.length} project↔label joins`)
      // Pure join table, dedup via composite primary key — upsert with
      // ignoreDuplicates so re-runs don't explode.
      const BATCH = 1000
      for (let i = 0; i < joinRows.length; i += BATCH) {
        const chunk = joinRows.slice(i, i + BATCH)
        const { error } = await db.from('project_label_on_projects')
          .upsert(chunk, { onConflict: 'project_id,label_id', ignoreDuplicates: true })
        if (error) console.error(`  ✗ label-join batch ${i}:`, error.message)
      }
      log(`✓ label joins inserted`)
    }
  }
}

// ── 9. Phases ───────────────────────────────────────────────────────────────
// phases_by_project.json is keyed by Forecast project_id. We need a single
// flat list for upsert, plus a (forecastPhaseId → supabaseUuid) map for task import.
let phaseMap = new Map()
// Each project may need a "default" phase for tasks that had no phase —
// we create these on demand below. This map: forecastProjectId → ourDefaultPhaseUuid.
const defaultPhaseByProject = new Map()
if (shouldRun('phases')) {
  banner('9. Phases')
  const phasesByProject = loadJSON('phases_by_project.json')
  const allPhases = []
  for (const fPid of Object.keys(phasesByProject)) {
    const ourPid = projectMap.get(Number(fPid))
    if (!ourPid) continue
    const arr = phasesByProject[fPid] || []
    for (let i = 0; i < arr.length; i++) {
      const ph = arr[i]
      allPhases.push({
        project_id: ourPid,
        name: String(ph.name || '').trim() || 'Phase',
        start_date: ph.start_date || null,
        end_date: ph.end_date || null,
        sort_order: i,
        forecast_id: ph.id,
      })
    }
  }
  log(`Upserting ${allPhases.length} phases`)
  phaseMap = await upsertByForecastId({
    table: 'phases', rows: allPhases, conflict: 'forecast_id', label: 'phases', refreshable: true,
  })
  log(`✓ phases: ${phaseMap.size} mapped`)
}

// ── 10. Tasks + assignees ───────────────────────────────────────────────────
let taskMap = new Map()
if (shouldRun('tasks')) {
  banner('10. Tasks')
  const tasksByProject = loadJSON('tasks_by_project.json')
  const allTasks = []
  const tasksByProjId = new Map()  // forecastProjectId → Task[] for later assignee walk
  let orphanCount = 0
  for (const fPid of Object.keys(tasksByProject)) {
    const ourPid = projectMap.get(Number(fPid))
    if (!ourPid) continue
    const arr = tasksByProject[fPid] || []
    tasksByProjId.set(Number(fPid), arr)
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i]
      // Resolve phase_id: first try t.milestone (which is the phase reference
      // in Forecast — confirmed via sample). Fallback to creating a default
      // phase per-project for orphan tasks.
      let phaseId = null
      if (t.milestone) phaseId = phaseMap.get(t.milestone) || null
      if (!phaseId) {
        // Create a default phase for this project if we haven't yet.
        // Synthetic forecast_id: negative of the project id, so it never
        // collides with real phase ids (which are all positive). Because we
        // can't ON CONFLICT into the partial unique index, we first SELECT
        // to see if this synthetic phase already exists from a prior run.
        let defId = defaultPhaseByProject.get(Number(fPid))
        if (!defId && !DRY) {
          const synthId = -Number(fPid)
          const { data: existingDef } = await db.from('phases')
            .select('id').eq('forecast_id', synthId).limit(1).maybeSingle()
          if (existingDef) {
            defId = existingDef.id
          } else {
            const { data, error } = await db.from('phases').insert({
              project_id: ourPid,
              name: 'Tasks',
              sort_order: 9999,
              forecast_id: synthId,
            }).select('id').single()
            if (!error && data) defId = data.id
          }
          if (defId) defaultPhaseByProject.set(Number(fPid), defId)
        }
        phaseId = defId || null
        if (!phaseId) { orphanCount++; continue }
      }
      allTasks.push({
        phase_id: phaseId,
        title: String(t.title || '').trim() || `Task ${t.id}`,
        description: t.description || null,
        estimated_hrs: t.estimate != null ? Math.round(t.estimate / 60 * 10) / 10 : null,
        status: mapTaskStatus(t),
        billable: t.un_billable !== true,
        start_date: t.start_date || null,
        due_date: t.end_date || null,
        sort_order: i,
        forecast_id: t.id,
      })
    }
  }
  if (orphanCount) log(`  ! ${orphanCount} tasks skipped (no phase resolvable)`)
  log(`Upserting ${allTasks.length} tasks`)
  // refreshable=true: Forecast is source of truth for task title/status/
  // estimate/dates/billable. If a coordinator edits a task in Forecast,
  // re-running --refresh reflects it here. Task _assignees_ live in a
  // separate join table (task_assignees) and are handled below — this
  // refresh doesn't touch them.
  taskMap = await upsertByForecastId({
    table: 'tasks', rows: allTasks, conflict: 'forecast_id', label: 'tasks', refreshable: true,
  })
  log(`✓ tasks: ${taskMap.size} mapped`)

  // Task assignees (many-to-many)
  banner('10b. Task assignees')
  const joinRows = []
  for (const [fPid, arr] of tasksByProjId) {
    for (const t of arr) {
      const ourTaskId = taskMap.get(t.id)
      if (!ourTaskId) continue
      for (const fPersonId of (t.assigned_persons || [])) {
        const userId = personMap.get(fPersonId)
        if (userId) joinRows.push({ task_id: ourTaskId, user_id: userId })
      }
    }
  }
  log(`Inserting ${joinRows.length} task↔user assignments`)
  if (!DRY && joinRows.length) {
    const BATCH = 1000
    for (let i = 0; i < joinRows.length; i += BATCH) {
      const chunk = joinRows.slice(i, i + BATCH)
      const { error } = await db.from('task_assignees')
        .upsert(chunk, { onConflict: 'task_id,user_id', ignoreDuplicates: true })
      if (error) console.error(`  ✗ assignee batch ${i}:`, error.message)
    }
  }
  log(`✓ task_assignees inserted`)
}

// ── 11. Time entries ────────────────────────────────────────────────────────
if (shouldRun('time_entries')) {
  banner('11. Time entries')
  const src = loadJSON('time_registrations.json')
  log(`Loaded ${src.length} entries (${sizeOf('time_registrations.json')})`)

  // Quality filters from the audit:
  //   • Skip entries with >16h (garbage from system user 594346 with
  //     impossible single-day hours — 76 in current snapshot)
  //   • Skip zero-hour placeholder markers
  //
  // Then aggregate by (user_id, target, date): our DB enforces uniqueness
  // on (user_id, task_id, date) but Forecast allows multiple entries per
  // day on the same task. ~5k groups have 2-26 rows each (~7k rows
  // collapse). For each group: sum hours, OR billable flags, concatenate
  // notes with ' ; ', keep the lowest forecast_id for deterministic re-runs.
  let tooBig = 0, missingUser = 0, missingTarget = 0
  const grouped = new Map()

  for (const e of src) {
    const hours = Number(e.time_registered || 0) / 60
    if (hours > 16) { tooBig++; continue }
    if (hours <= 0) continue

    const userId = personMap.get(e.person)
    if (!userId) { missingUser++; continue }

    let type, taskId = null, internalCatId = null, timeOffCatId = null
    if (e.task) {
      type = 'project'
      taskId = taskMap.get(e.task) || null
      if (!taskId) { missingTarget++; continue }
    } else if (e.non_project_time) {
      const intId = internalCatMap.get(e.non_project_time)
      const offId = timeOffCatMap.get(e.non_project_time)
      if (intId)      { type = 'internal'; internalCatId = intId }
      else if (offId) { type = 'time_off'; timeOffCatId  = offId }
      else { missingTarget++; continue }
    } else {
      missingTarget++; continue
    }

    const targetKey = taskId || internalCatId || timeOffCatId
    const key = `${userId}|${type}|${targetKey}|${e.date}`
    const isBillable = type === 'project' && Number(e.billable_minutes_registered || 0) > 0
    const existing = grouped.get(key)
    if (existing) {
      existing.hours = Math.round((Number(existing.hours) + hours) * 100) / 100
      if (isBillable) existing.billable = true
      if (e.notes) existing.note = existing.note ? `${existing.note} ; ${e.notes}` : e.notes
      if (Number(e.id) < Number(existing.forecast_id)) existing.forecast_id = e.id
    } else {
      grouped.set(key, {
        user_id: userId,
        date: e.date,
        hours: Math.round(hours * 100) / 100,
        billable: isBillable,
        note: e.notes || null,
        type,
        task_id: taskId,
        internal_time_category_id: internalCatId,
        time_off_category_id: timeOffCatId,
        forecast_id: e.id,
      })
    }
  }

  const rows = [...grouped.values()]
  const preAgg = src.length - tooBig - missingUser - missingTarget
  const collapsed = preAgg - rows.length
  log(`  • ${rows.length} entries ready (${collapsed} duplicate rows collapsed by user+task+date)`)
  log(`  • skipped: ${tooBig} >16h, ${missingUser} missing user, ${missingTarget} missing task/category`)

  // NOTE: time_entries is deliberately NOT refreshable. The rows coming
  // out of the grouping loop above are already aggregates derived from the
  // snapshot — if users add new entries in our app after go-live, a
  // refresh would overwrite them with the stale snapshot aggregate. For
  // backfill-only behaviour (insert anything new the snapshot has, leave
  // existing rows alone), do not opt this in.
  await upsertByForecastId({
    table: 'time_entries', rows, conflict: 'forecast_id', label: 'time entries',
  })
  log(`✓ time_entries upserted`)
}

// ── Done ────────────────────────────────────────────────────────────────────
banner('✓ IMPORT COMPLETE')
log(`Total elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (DRY) log('(dry run — no actual writes performed)')
log('Default login password for new users: password123 (change in Admin)')
process.exit(0)
