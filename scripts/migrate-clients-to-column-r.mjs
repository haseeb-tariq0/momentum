/**
 * Rename existing clients from Column D long names → Column R short names.
 *
 * Background (Apr 17 call):
 *   The finance sheet's Column D is the long legal name. Column R is the
 *   canonical short name that matches Forecast/NextTrack. Up until now the
 *   sync was reading Column D, which created duplicate clients with long
 *   legal names alongside existing short-name clients created from Forecast.
 *
 * This script:
 *   1. Reads Column D + Column R from the finance sheet (Sheets REST API)
 *   2. Queries all workspace clients (Supabase REST API)
 *   3. For each client whose name appears in Column D, proposes renaming to R
 *   4. Prints the plan (dry run by default)
 *   5. Applies renames when run with --apply
 *
 * Safety:
 *   - Never merges records. Only renames in place so all FKs (time entries,
 *     projects, invoices) stay linked to the same client_id.
 *   - Skips ambiguous cases (R empty, conflict with another existing client)
 *     and prints them for manual handling.
 *
 * No npm deps — uses only Node built-ins (fetch, node:crypto).
 *
 * Usage (from D:\forecast):
 *   node scripts/migrate-clients-to-column-r.mjs          # dry run
 *   node scripts/migrate-clients-to-column-r.mjs --apply  # actually rename
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createSign } from 'node:crypto'

// ── Load .env.local ──────────────────────────────────────────────────────────
try {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch { /* env file optional */ }

const APPLY = process.argv.includes('--apply')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const WORKSPACE_ID = process.env.WORKSPACE_ID || '00000000-0000-0000-0000-000000000001'
const SHEET_ID     = process.env.GOOGLE_FINANCE_SHEET_ID
const SA_B64       = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_B64

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_KEY, SHEET_ID, SA_B64 })) {
  if (!v) { console.error(`❌ Missing env var: ${k}`); process.exit(1) }
}

// ── Google Service Account → access token (manual JWT) ───────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getGoogleAccessToken() {
  const creds = JSON.parse(Buffer.from(SA_B64, 'base64').toString('utf8'))
  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss:   creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  }
  const hp = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sig = createSign('RSA-SHA256').update(hp).sign(creds.private_key)
  const jwt = `${hp}.${b64url(sig)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  })
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  return json.access_token
}

async function readSheetRange(accessToken, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Sheets API ${range} → ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.values || []
}

// ── Supabase REST helpers ────────────────────────────────────────────────────
async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      accept:        'application/json',
    },
  })
  if (!res.ok) throw new Error(`Supabase GET ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey:          SUPABASE_KEY,
      authorization:   `Bearer ${SUPABASE_KEY}`,
      'content-type':  'application/json',
      prefer:          'return=representation',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase PATCH ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN'}`)
  console.log(`Workspace: ${WORKSPACE_ID}`)
  console.log('')

  console.log('🔑 Requesting Google access token...')
  const accessToken = await getGoogleAccessToken()
  console.log('   ✓ got token')

  console.log('📊 Reading Client_Revenue!A1:T10000...')
  const raw = await readSheetRange(accessToken, 'Client_Revenue!A1:T10000')
  console.log(`   ${raw.length} rows (including header)`)

  // Find header row within first 10 rows
  let headerIdx = -1
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const r = raw[i] || []
    if (r.some(c => typeof c === 'string' && c.trim() === 'Client Name')) { headerIdx = i; break }
  }
  if (headerIdx < 0) { console.error('❌ Header row with "Client Name" not found'); process.exit(1) }
  const headers = (raw[headerIdx] || []).map(h => String(h || '').trim())
  const dIdx = headers.indexOf('Client Name')
  const rIdx = headers.indexOf('Client Name (For Ops use)')
  if (dIdx < 0) { console.error('❌ Column D "Client Name" not found'); process.exit(1) }
  if (rIdx < 0) { console.error('❌ Column R "Client Name (For Ops use)" not found'); process.exit(1) }
  console.log(`   header at row ${headerIdx + 1}; D=col ${dIdx + 1}, R=col ${rIdx + 1}`)
  console.log('')

  // Build D → Set<R>
  const dToRset = new Map()
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i] || []
    const d = String(r[dIdx] || '').trim()
    const rv = String(r[rIdx] || '').trim()
    if (!d) continue
    if (!dToRset.has(d)) dToRset.set(d, new Set())
    if (rv) dToRset.get(d).add(rv)
  }

  const dToR = new Map()
  const dAmbiguous = []
  const dMissingR = []
  for (const [d, rset] of dToRset) {
    if (rset.size === 0) dMissingR.push(d)
    else if (rset.size > 1) dAmbiguous.push({ d, rs: Array.from(rset) })
    else dToR.set(d, Array.from(rset)[0])
  }
  console.log(`📋 Mapping summary:`)
  console.log(`   ${dToRset.size} unique long (Column D) values`)
  console.log(`   ${dToR.size} have a single R mapping (usable)`)
  console.log(`   ${dAmbiguous.length} ambiguous (multiple R values for same D)`)
  console.log(`   ${dMissingR.length} missing (no R value)`)
  console.log('')

  console.log('🗃  Fetching clients from DB...')
  const clients = await sbGet(
    `clients?select=id,name,client_code&workspace_id=eq.${WORKSPACE_ID}&deleted_at=is.null`
  )
  console.log(`   ${clients.length} clients in workspace`)
  console.log('')

  const clientByName = new Map()
  for (const c of clients) clientByName.set(c.name, c)
  const shortNames = new Set(dToR.values())

  const plan = []           // { id, code, from, to, conflict }
  const alreadyShort = []
  const noMapping = []
  for (const c of clients) {
    const short = dToR.get(c.name)
    if (short === undefined) {
      if (shortNames.has(c.name)) alreadyShort.push(c.name)
      else noMapping.push(c.name)
      continue
    }
    if (short === c.name) { alreadyShort.push(c.name); continue }
    const conflict = clientByName.has(short) && clientByName.get(short).id !== c.id
    plan.push({ id: c.id, code: c.client_code, from: c.name, to: short, conflict })
  }
  const dNotInDB = []
  for (const [d] of dToR) if (!clientByName.has(d)) dNotInDB.push(d)

  // Detect intra-plan collisions: if multiple source clients map to the same
  // target name, those must be MERGED, not blindly renamed — otherwise we'd
  // create duplicate client names (or fail on unique constraints).
  const plansByTarget = new Map() // targetName → array of plan entries
  for (const p of plan) {
    if (!plansByTarget.has(p.to)) plansByTarget.set(p.to, [])
    plansByTarget.get(p.to).push(p)
  }

  console.log('── PLAN ─────────────────────────────────────────────────────────')
  const renameable = []
  const needsMerge = []
  const conflicts  = []
  for (const p of plan) {
    if (p.conflict) { conflicts.push(p); continue }
    const siblings = plansByTarget.get(p.to) || []
    if (siblings.length > 1) { needsMerge.push(p); continue }
    renameable.push(p)
  }

  console.log(`✅ ${renameable.length} clean 1:1 renames (safe to apply):`)
  for (const p of renameable) {
    console.log(`   [${p.code || '----'}] ${p.from}`)
    console.log(`             →  ${p.to}`)
  }
  if (needsMerge.length) {
    console.log('')
    console.log(`🔀 ${needsMerge.length} sources collapse into ${new Set(needsMerge.map(p=>p.to)).size} targets — needs MERGE not rename:`)
    const byTarget = new Map()
    for (const p of needsMerge) {
      if (!byTarget.has(p.to)) byTarget.set(p.to, [])
      byTarget.get(p.to).push(p)
    }
    for (const [target, sources] of byTarget) {
      console.log(`   → ${target}  (${sources.length} sources):`)
      for (const p of sources) console.log(`       [${p.code || '----'}] ${p.from}`)
    }
  }
  if (conflicts.length) {
    console.log('')
    console.log(`⚠️  ${conflicts.length} conflicts (target already exists as a different client — also needs merge):`)
    for (const p of conflicts) {
      console.log(`   [${p.code || '----'}] ${p.from}`)
      console.log(`             ✗  ${p.to}`)
    }
  }
  console.log('')
  console.log(`${alreadyShort.length} clients already use the short name (no action)`)
  console.log(`${dNotInDB.length} D values in sheet have no matching DB client`)
  console.log(`${noMapping.length} DB clients don't appear in Column D (left alone)`)

  if (dAmbiguous.length) {
    console.log('')
    console.log(`⚠️  Ambiguous D→R mappings (manually inspect):`)
    for (const a of dAmbiguous) console.log(`    "${a.d}" → [${a.rs.map(r => `"${r}"`).join(', ')}]`)
  }
  console.log('')

  if (!APPLY) {
    console.log('Dry run complete. Re-run with --apply to execute the clean renames.')
    return
  }

  console.log(`🚀 Applying ${renameable.length} renames...`)
  let ok = 0, fail = 0
  for (const p of renameable) {
    try {
      await sbPatch(
        `clients?id=eq.${encodeURIComponent(p.id)}&workspace_id=eq.${WORKSPACE_ID}`,
        { name: p.to }
      )
      ok++
      console.log(`   ✓ ${p.from}  →  ${p.to}`)
    } catch (e) {
      fail++
      console.error(`   ✗ ${p.from}: ${e.message}`)
    }
  }
  console.log('')
  console.log(`Done. ${ok} renamed, ${fail} failed.`)
  if (conflicts.length) {
    console.log(`${conflicts.length} conflicts left for manual resolution (use Merge Clients admin UI).`)
  }
}

main().catch(e => { console.error('❌', e); process.exit(1) })
