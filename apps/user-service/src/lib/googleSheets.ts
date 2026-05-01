// Google Sheets client for reading the NEXA Finance Sheet (Client_Revenue tab).
//
// Uses a service account (nexttrack-sheets-reader@nexttrack-493307.iam.gserviceaccount.com)
// with read-only scope. The sheet must be shared with that email as Viewer.
//
// The service account JSON key is stored base64-encoded in .env.local as
// GOOGLE_SHEETS_SERVICE_ACCOUNT_B64 — avoids shell-quoting issues with the
// multiline private_key field.
//
// Per-user OAuth path lives at the bottom of the file (createSpreadsheetForUser)
// and uses the refresh token from user_oauth_grants instead of the service
// account, so exports land in the user's own Drive. That's the path the
// /reports/export-google-sheet endpoint uses now; the service-account path
// stays for finance-sheet reads + as a fallback.
import { google, sheets_v4, drive_v3 } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import { supabase } from '@forecast/db'
import { decryptToken } from './tokenCrypto.js'

type ServiceAccountCreds = {
  client_email: string
  private_key:  string
  project_id?:  string
}

// Cache the JWT clients + service clients across calls.
// Read-only client (for syncing finance sheet) and write client (for export)
// are separate because the scopes differ — keeps least-privilege clear.
let cachedSheets:      sheets_v4.Sheets | null = null
let cachedSheetsWrite: sheets_v4.Sheets | null = null
let cachedDriveWrite:  drive_v3.Drive   | null = null
let cachedCreds:       ServiceAccountCreds | null = null

function parseCredsFromEnv(): ServiceAccountCreds | null {
  const b64 = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_B64
  if (!b64) return null
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8')
    const parsed = JSON.parse(json)
    if (!parsed.client_email || !parsed.private_key) return null
    return parsed as ServiceAccountCreds
  } catch {
    return null
  }
}

/** True iff service-account credentials are configured in env. */
export function isGoogleSheetsConfigured(): boolean {
  return !!parseCredsFromEnv()
}

/** Returns the service account email (e.g. for admin UI "share the sheet with X"). */
export function getServiceAccountEmail(): string | null {
  return parseCredsFromEnv()?.client_email || null
}

/** Get (or create) the cached Sheets client. Throws if creds not configured. */
export function getSheetsClient(): sheets_v4.Sheets {
  if (cachedSheets) return cachedSheets
  const creds = parseCredsFromEnv()
  if (!creds) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_B64 not set or invalid')
  cachedCreds = creds
  const jwt = new google.auth.JWT({
    email:  creds.client_email,
    key:    creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  cachedSheets = google.sheets({ version: 'v4', auth: jwt })
  return cachedSheets
}

/**
 * Get (or create) the write-capable Sheets + Drive clients.
 * Broader scopes: full Sheets read/write + drive.file (this-app-only).
 * drive.file means we can only touch files the service account creates —
 * we can't poke around in other Drives even if we tried.
 */
function getWriteClients(): { sheets: sheets_v4.Sheets; drive: drive_v3.Drive } {
  if (cachedSheetsWrite && cachedDriveWrite) {
    return { sheets: cachedSheetsWrite, drive: cachedDriveWrite }
  }
  const creds = parseCredsFromEnv()
  if (!creds) throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_B64 not set or invalid')
  const jwt = new google.auth.JWT({
    email:  creds.client_email,
    key:    creds.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  })
  cachedSheetsWrite = google.sheets({ version: 'v4', auth: jwt })
  cachedDriveWrite  = google.drive ({ version: 'v3', auth: jwt })
  return { sheets: cachedSheetsWrite, drive: cachedDriveWrite }
}

// Google sheet tab names: max 100 chars, no [ ] : * ? / \
function sanitizeTabName(name: string): string {
  return String(name || 'Sheet').replace(/[[\]:*?/\\]/g, '-').slice(0, 100) || 'Sheet'
}

// Convert a cell value into something Sheets API understands.
// Numbers stay numbers; everything else becomes a string (which Google renders as text).
function cellValue(v: any): any {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v
  return String(v)
}

/**
 * Create a new Google Sheet, populated with the provided tabs.
 * Returns the spreadsheet ID + URL.
 *
 * If `GOOGLE_EXPORTS_FOLDER_ID` is set in env, the sheet is created inside
 * that Shared Drive (or folder) via the Drive API — service account must be
 * added as Content Manager on the drive. Files in a Shared Drive are owned
 * by the drive, so the service account doesn't need its own storage quota.
 * The Shared Drive's existing member list / domain access controls who can
 * see the file (typically "all @digitalnexa.com" via the existing drive).
 *
 * If the env var is not set, falls back to direct `spreadsheets.create`,
 * which will fail with 403 for service accounts (they don't have personal
 * Drive storage) — we surface a friendly error in the route handler.
 */
export async function createSpreadsheet(opts: {
  title:    string
  sheets:   Array<{ name: string; headers: string[]; rows: any[][] }>
  shareWith?: string | null   // optional: grant explicit edit access to this user
}): Promise<{ spreadsheetId: string; url: string }> {
  const { sheets: sheetsApi, drive } = getWriteClients()
  const folderId = process.env.GOOGLE_EXPORTS_FOLDER_ID || null
  const tabs = opts.sheets.length ? opts.sheets : [{ name: 'Sheet1', headers: [], rows: [] }]

  let spreadsheetId: string | null = null

  if (folderId) {
    // Preferred path: create the spreadsheet file inside a Shared Drive folder
    // using the Drive API. supportsAllDrives: true is required for shared drives.
    const fileRes = await drive.files.create({
      requestBody: {
        name: opts.title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folderId],
      },
      supportsAllDrives: true,
      fields: 'id',
    })
    spreadsheetId = fileRes.data.id || null
    if (!spreadsheetId) throw new Error('drive.files.create returned no id')

    // The file was just created empty (with default Sheet1). Rename default tab
    // to match first requested tab + add any additional tabs via batchUpdate.
    const requests: any[] = []
    // Rename default sheetId 0 to first tab
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: 0, title: sanitizeTabName(tabs[0].name) },
        fields: 'title',
      },
    })
    // Add remaining tabs
    for (let i = 1; i < tabs.length; i++) {
      requests.push({
        addSheet: { properties: { title: sanitizeTabName(tabs[i].name) } },
      })
    }
    if (requests.length > 0) {
      await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      })
    }
  } else {
    // Fallback path: direct sheets.create (only works for user OAuth, not
    // service accounts — leaves a clear 403 for the route to catch)
    const createRes = await sheetsApi.spreadsheets.create({
      requestBody: {
        properties: { title: opts.title },
        sheets: tabs.map(t => ({ properties: { title: sanitizeTabName(t.name) } })),
      },
      fields: 'spreadsheetId',
    })
    spreadsheetId = createRes.data.spreadsheetId || null
    if (!spreadsheetId) throw new Error('spreadsheets.create returned no id')
  }

  // Write data into each tab in one batch call.
  const batchData = tabs.map(t => ({
    range: `${sanitizeTabName(t.name)}!A1`,
    values: [
      t.headers.map(cellValue),
      ...t.rows.map(r => (r || []).map(cellValue)),
    ],
  }))
  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: batchData,
    },
  })

  // Optional: explicitly share with the requesting user. In the Shared Drive
  // path this is usually redundant (the drive itself grants access), but it
  // ensures the user can always open the link even if drive-level sharing
  // changes. supportsAllDrives is needed for files in shared drives.
  if (opts.shareWith) {
    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: {
          type:         'user',
          role:         'writer',
          emailAddress: opts.shareWith,
        },
        sendNotificationEmail: false,
        supportsAllDrives: true,
      })
    } catch (e: any) {
      // Non-fatal: Shared Drive already grants domain access, so the user
      // can open the sheet even if this individual share fails.
      console.warn('[googleSheets] permissions.create failed:', e?.message)
    }
  }

  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  }
}

// ─── Finance sheet row reader ────────────────────────────────────────────────

// Column header names as they appear in the NEXA sheet's Client_Revenue tab.
// Kept in sync with apps/web/src/app/(dashboard)/admin/FinanceImport.tsx COL_MAP.
//
// Each entry is an array of accepted header strings — the first match wins.
// Live sheet uses "Sales Amount for Services (Exc VAT)" while older xlsx
// snapshots said "Sales Amount for Services" — accept both.
// Column R "Client Name (For Ops use)" is the canonical mapped short name used
// everywhere in NextTrack (matches what finance maintains against Forecast names).
// Column D "Client Name" is the long legal finance name — kept only as a
// fallback for rows where column R hasn't been filled in yet. Murtaza confirmed
// in the Apr 17 call: "Column D is not used anywhere. Column R is the mapping."
const COL_MAP: Record<string, string[]> = {
  month:               ['Month'],
  invoice_date:        ['Invoice Date'],
  invoice_no:          ['Invoice No.'],
  client_name_mapped:  ['Client Name (For Ops use)'],
  client_name_finance: ['Client Name'],
  sales_person:        ['Sales Person'],
  service_department:  ['Service Department'],
  service_category:    ['Service Categories'],
  type:                ['Type'],
  classification:      ['Classification'],
  services_detail:     ['Services in detail'],
  sales_amount:        ['Sales Amount for Services (Exc VAT)', 'Sales Amount for Services'],
  third_party:         ['Third Party'],
  advertising_budget:  ['Advertising Budget'],
}

export type FinanceSheetRow = {
  month:               any
  invoice_date:        any
  invoice_no:          any
  client_name_mapped:  string  // Column R (preferred)
  client_name_finance: string  // Column D (fallback)
  sales_person:        any
  service_department:  any
  service_category:    any
  type:                any
  classification:      any
  services_detail:     any
  sales_amount:        any
  third_party:         any
  advertising_budget:  any
}

/**
 * Read rows from the Client_Revenue tab of the given spreadsheet.
 *
 * Scans for the header row by looking for "Client Name" within the first 10
 * rows (matching the frontend XLSX parser's behavior). Returns an array of
 * normalized row objects suitable for the existing processFinanceRows pipeline.
 */
export async function readFinanceSheetRows(
  spreadsheetId: string,
  sheetName = 'Client_Revenue',
): Promise<{ rows: FinanceSheetRow[]; sheetTitle: string; sheetUrl: string }> {
  const sheets = getSheetsClient()

  // Pull a wide range; sheet has ~30 cols and ~5000 rows. A:AD covers 30 cols.
  const range = `${sheetName}!A1:AD10000`
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption:    'UNFORMATTED_VALUE', // numbers as numbers, dates as serials
    dateTimeRenderOption: 'FORMATTED_STRING',  // dates → readable strings (safer for our loose parser)
  })

  const raw: any[][] = (data.values || []) as any[][]

  // Find header row (scan first 10 rows for "Client Name")
  let headerIdx = -1
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const r = raw[i] || []
    if (r.some(c => typeof c === 'string' && c.trim() === 'Client Name')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) {
    throw new Error(`Header row (with "Client Name") not found in first 10 rows of "${sheetName}"`)
  }

  const headers = (raw[headerIdx] || []).map(h => String(h || '').trim())
  const colIdx: Record<string, number> = {}
  for (const [key, candidates] of Object.entries(COL_MAP)) {
    for (const label of candidates) {
      const idx = headers.indexOf(label)
      if (idx >= 0) { colIdx[key] = idx; break }
    }
  }

  const rows: FinanceSheetRow[] = []
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i] || []
    // Skip blank rows (no client name in either column R or column D)
    if (!r[colIdx.client_name_mapped] && !r[colIdx.client_name_finance]) continue
    const obj: any = {}
    for (const [key, idx] of Object.entries(colIdx)) {
      obj[key] = r[idx]
    }
    rows.push(obj as FinanceSheetRow)
  }

  // Fetch sheet metadata (title) for display in admin UI
  let sheetTitle = sheetName
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title' })
    sheetTitle = meta.data.properties?.title || sheetName
  } catch { /* non-fatal */ }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  return { rows, sheetTitle, sheetUrl }
}

// ─── Software Costs reader ────────────────────────────────────────────────────
// Parses the Software_Costs tab which is in wide format:
//   Row 1: title ("Subscriptions Tracker")
//   Row 2: blank
//   Row 3: headers → Software Name | Billing Frequency | Department | Dec 2025 | Jan 2026 | ... | Dec 2026
//   Row 4+: data → one row per software × department with monthly amounts
//
// We unpivot so each returned record is (software, department, month, amount) —
// callers can then dedup via hash and upsert into `software_costs` table.

export type SoftwareCostRow = {
  software_name:     string
  department:        string
  billing_frequency: string
  month:             string  // YYYY-MM-01
  amount:            number
}

// Parse a month header like "Jan 2026" / "January 2026" / "2026-01" → YYYY-MM-01
function parseMonthHeader(s: string): string | null {
  if (!s) return null
  const t = String(s).trim()

  // Already a date? (e.g. Excel serial or "2026-01-01")
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(t)) {
    return t.slice(0, 7) + '-01'
  }

  // "Jan 2026" / "January 2026" / "Jan-26" etc.
  const MONTHS: Record<string, number> = {
    jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4,
    may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, sept:9, september:9,
    oct:10, october:10, nov:11, november:11, dec:12, december:12,
  }
  const m = t.match(/^([A-Za-z]+)\s*[-\s]\s*(\d{2,4})$/)
  if (m) {
    const monthNum = MONTHS[m[1].toLowerCase()]
    if (!monthNum) return null
    const yearRaw = parseInt(m[2], 10)
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw
    return `${year}-${String(monthNum).padStart(2, '0')}-01`
  }

  return null
}

export async function readSoftwareCostsRows(
  spreadsheetId: string,
  sheetName = 'Software_Costs',
): Promise<{ rows: SoftwareCostRow[]; sheetTitle: string; sheetUrl: string }> {
  const sheets = getSheetsClient()

  // Pull a reasonably wide range. 2 metadata cols + 1 dept col + up to 36 month cols.
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:AR2000`,
    valueRenderOption:    'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  })
  const raw: any[][] = (data.values || []) as any[][]

  // Find header row — scan first 10 rows for "Software Name"
  let headerIdx = -1
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const r = raw[i] || []
    if (r.some(c => typeof c === 'string' && c.trim() === 'Software Name')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) {
    throw new Error(`Header row (with "Software Name") not found in first 10 rows of "${sheetName}"`)
  }

  const headers = (raw[headerIdx] || []).map(h => String(h || '').trim())
  const nameIdx = headers.indexOf('Software Name')
  const freqIdx = headers.indexOf('Billing Frequency')
  const deptIdx = headers.indexOf('Department')

  // Map each header column index → YYYY-MM-01 if it's a month column
  const monthColByIdx: Record<number, string> = {}
  for (let i = 0; i < headers.length; i++) {
    // Skip the first three metadata columns
    if (i === nameIdx || i === freqIdx || i === deptIdx) continue
    const parsed = parseMonthHeader(headers[i])
    if (parsed) monthColByIdx[i] = parsed
  }

  const rows: SoftwareCostRow[] = []
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i] || []
    const softwareName = String(r[nameIdx] || '').trim()
    if (!softwareName) continue  // skip blank rows
    const department = String(r[deptIdx] || '').trim() || 'Unassigned'
    const billingFrequency = String(r[freqIdx] || '').trim() || 'Monthly'

    // Emit one row per month-column that has a non-zero value
    for (const [colIdxStr, month] of Object.entries(monthColByIdx)) {
      const colIdx = Number(colIdxStr)
      const raw = r[colIdx]
      const amount = Number(raw)
      if (!Number.isFinite(amount) || amount <= 0) continue
      rows.push({
        software_name:     softwareName,
        department,
        billing_frequency: billingFrequency,
        month,
        amount,
      })
    }
  }

  let sheetTitle = sheetName
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title' })
    sheetTitle = meta.data.properties?.title || sheetName
  } catch { /* non-fatal */ }

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  return { rows, sheetTitle, sheetUrl }
}

// ─── Per-user OAuth path ─────────────────────────────────────────────────────
// Used by /reports/export-google-sheet so the spreadsheet lands in the
// caller's own Drive instead of the service account's shared drive.
//
// Flow:
//   1. Look up active grant for (userId, 'google_drive')
//   2. Decrypt the refresh token
//   3. Build an OAuth2Client; google-auth-library auto-refreshes the access
//      token from the refresh token on every API call
//   4. Use sheets.spreadsheets.create — the file is owned by the user
//      (not the service account), no shared-drive plumbing needed
//
// Errors surfaced to callers:
//   NotConnectedError      — user hasn't connected Drive yet
//   GrantInvalidError      — token decrypt fails or Google rejects the refresh
//                            (revoked from Google's side, password change, etc.)

export class NotConnectedError extends Error {
  code = 'NOT_CONNECTED'
  constructor() { super('Google Drive not connected for this user') }
}
export class GrantInvalidError extends Error {
  code = 'GRANT_INVALID'
  constructor(detail: string) { super(`Google Drive grant invalid: ${detail}`) }
}

async function getUserDriveClient(userId: string): Promise<{
  sheets: sheets_v4.Sheets
  drive:  drive_v3.Drive
  grantedEmail: string | null
  grantId: string
}> {
  const { data: grant } = await supabase
    .from('user_oauth_grants')
    .select('id, refresh_token_enc, granted_email, scopes')
    .eq('user_id', userId)
    .eq('provider', 'google_drive')
    .is('revoked_at', null)
    .maybeSingle()

  if (!grant) throw new NotConnectedError()

  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new GrantInvalidError('GOOGLE_OAUTH_CLIENT_ID/SECRET not set on the server')
  }

  let refreshToken: string
  try {
    refreshToken = decryptToken((grant as any).refresh_token_enc)
  } catch (e: any) {
    // Either OAUTH_TOKEN_ENC_KEY changed (key rotation without re-grant)
    // or the row is corrupted. Log the detail server-side; surface a
    // generic reason to the caller so we don't tell an attacker
    // *which* failure mode we hit (helps an attacker tell key-rotation
    // from row-tampering).
    console.warn('[gdrive] token decrypt failed for user', userId, '-', e?.message || 'unknown')
    throw new GrantInvalidError('token decrypt failed')
  }

  const oauth2 = new OAuth2Client(clientId, clientSecret)
  oauth2.setCredentials({ refresh_token: refreshToken })

  return {
    sheets:       google.sheets({ version: 'v4', auth: oauth2 }),
    drive:        google.drive ({ version: 'v3', auth: oauth2 }),
    grantedEmail: (grant as any).granted_email || null,
    grantId:      (grant as any).id,
  }
}

/** Mark a grant as recently used. Best-effort; failures are silent.
 *  Skips revoked rows so a disconnect that races with an in-flight
 *  export doesn't see its `revoked_at` overshadowed by a stale
 *  last_used_at write. */
async function touchGrant(grantId: string): Promise<void> {
  try {
    await supabase
      .from('user_oauth_grants')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', grantId)
      .is('revoked_at', null)
  } catch { /* non-fatal */ }
}

/**
 * Create a Google Sheet in the calling user's own Drive, populated with
 * the provided tabs. Returns the spreadsheet ID + URL the frontend can
 * open in a new tab.
 *
 * The user becomes the owner of the file — they can rename, share,
 * download, or delete it however they like. Momentum can only see /
 * modify this file (because we requested `drive.file` scope, not full
 * drive read), so the integration is least-privilege from the user's
 * perspective.
 */
export async function createSpreadsheetForUser(opts: {
  userId: string
  title:  string
  sheets: Array<{ name: string; headers: string[]; rows: any[][] }>
}): Promise<{ spreadsheetId: string; url: string; ownerEmail: string | null }> {
  const { sheets: sheetsApi, grantedEmail, grantId } = await getUserDriveClient(opts.userId)
  const tabs = opts.sheets.length ? opts.sheets : [{ name: 'Sheet1', headers: [], rows: [] }]

  let spreadsheetId: string
  try {
    const createRes = await sheetsApi.spreadsheets.create({
      requestBody: {
        properties: { title: opts.title },
        sheets: tabs.map(t => ({ properties: { title: sanitizeTabName(t.name) } })),
      },
      fields: 'spreadsheetId',
    })
    if (!createRes.data.spreadsheetId) throw new Error('spreadsheets.create returned no id')
    spreadsheetId = createRes.data.spreadsheetId
  } catch (e: any) {
    // 401 invalid_grant means Google revoked our refresh token — typical
    // causes are user password change, app removal from Google Account
    // permissions, or > 6 months unused. Surface as GrantInvalid so the
    // route can prompt a reconnect.
    if (/invalid_grant|invalid token|unauthorized/i.test(e?.message || '')) {
      throw new GrantInvalidError(e?.message || 'Google rejected the refresh token')
    }
    throw e
  }

  // Write data into each tab in one batch call.
  const batchData = tabs.map(t => ({
    range: `${sanitizeTabName(t.name)}!A1`,
    values: [
      t.headers.map(cellValue),
      ...t.rows.map(r => (r || []).map(cellValue)),
    ],
  }))
  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: batchData,
    },
  })

  // Best-effort touch — telemetry only, never block the response on this.
  void touchGrant(grantId)

  return {
    spreadsheetId,
    url:        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    ownerEmail: grantedEmail,
  }
}
