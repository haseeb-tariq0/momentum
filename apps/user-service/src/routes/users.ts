import type { FastifyInstance, FastifyReply } from 'fastify'
import { supabase } from '@forecast/db'
import { nextClientCodes } from '../lib/clientCodes.js'

// ─── Workspace boundary helpers ──────────────────────────────────────────────
// Each helper sends a 404 and returns false if the entity doesn't belong to
// the caller's workspace. Always: `if (!await assertX(...)) return`
async function assertRowInWorkspace(
  table: string,
  id: string,
  wid: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!id || !wid) { reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] }); return false }
  const { data } = await supabase.from(table).select('id').eq('id', id).eq('workspace_id', wid).maybeSingle()
  if (!data) { reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] }); return false }
  return true
}

// Holiday calendars use the same pattern but the row is in another table
async function assertHolidayInCalendar(
  holidayId: string,
  wid: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!holidayId || !wid) { reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] }); return false }
  const { data } = await supabase
    .from('holidays')
    .select('id, holiday_calendars!inner(workspace_id)')
    .eq('id', holidayId)
    .maybeSingle()
  if (!data || (data as any).holiday_calendars?.workspace_id !== wid) {
    reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] }); return false
  }
  return true
}

async function assertRateCardEntryInWorkspace(
  entryId: string,
  wid: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (!entryId || !wid) { reply.status(400).send({ errors: [{ code: 'MISSING_ID' }] }); return false }
  const { data } = await supabase
    .from('rate_card_entries')
    .select('id, rate_cards!inner(workspace_id)')
    .eq('id', entryId)
    .maybeSingle()
  if (!data || (data as any).rate_cards?.workspace_id !== wid) {
    reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] }); return false
  }
  return true
}

export const ALL_PERMISSIONS = [
  'view_projects', 'manage_projects', 'delete_projects',
  'view_financials', 'manage_financials',
  'view_team', 'manage_team', 'invite_members',
  'view_timesheets', 'manage_timesheets',
  'view_reports', 'manage_admin', 'manage_rate_cards', 'manage_clients',
] as const

export type Permission = typeof ALL_PERMISSIONS[number]

export const ROLE_DEFAULTS: Record<string, Record<Permission, boolean>> = {
  super_admin: Object.fromEntries(ALL_PERMISSIONS.map(p => [p, true])) as Record<Permission, boolean>,
  admin: {
    view_projects: true, manage_projects: true, delete_projects: false,
    view_financials: true, manage_financials: false,
    view_team: true, manage_team: true, invite_members: true,
    view_timesheets: true, manage_timesheets: false,
    view_reports: true, manage_admin: false,
    manage_rate_cards: false, manage_clients: true,
  },
  account_manager: {
    view_projects: true, manage_projects: true, delete_projects: false,
    view_financials: true, manage_financials: false,
    view_team: true, manage_team: false, invite_members: false,
    view_timesheets: true, manage_timesheets: false,
    view_reports: true, manage_admin: false,
    manage_rate_cards: false, manage_clients: true,
  },
  collaborator: {
    view_projects: true, manage_projects: false, delete_projects: false,
    view_financials: false, manage_financials: false,
    view_team: false, manage_team: false, invite_members: false,
    view_timesheets: true, manage_timesheets: false,
    view_reports: false, manage_admin: false,
    manage_rate_cards: false, manage_clients: false,
  },
}

export function resolvePermissions(role: string, custom: Record<string, boolean> = {}): Record<Permission, boolean> {
  const base = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.collaborator
  return Object.fromEntries(ALL_PERMISSIONS.map(p => [p, p in custom ? custom[p] : base[p]])) as Record<Permission, boolean>
}

export async function userRoutes(app: FastifyInstance) {
  const isAdmin = (p: string) => ['super_admin', 'admin', 'account_manager'].includes(p)

  app.get('/workspace', async (req, reply) => {
    const user = (req as any).user
    const { data, error } = await supabase.from('workspaces').select('*').eq('id', user.workspaceId).single()
    if (error || !data) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return reply.status(200).send({ data })
  })

  app.patch('/workspace', async (req, reply) => {
    const user = (req as any).user
    if (user.profile !== 'super_admin') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const allowed = ['name','default_currency','billable_utilization_pct','resource_utilization_pct','weekends_enabled','allow_entries_on_done','allow_entries_over_estimate','allow_late_entries','timesheet_deadline_day']
    const body = req.body as any
    const updateData: any = {}
    for (const k of allowed) { if (k in body) updateData[k] = body[k] }
    const { data, error } = await supabase.from('workspaces').update(updateData).eq('id', user.workspaceId).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.get('/me', async (req, reply) => {
    const { data, error } = await supabase
      .from('users')
      .select('*, departments(id, name), holiday_calendars(id, name, country), workspaces(id, name, billable_utilization_pct, weekends_enabled, default_currency)')
      .eq('id', (req as any).user.id).single()
    if (error || !data) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    const resolved = resolvePermissions(data.permission_profile, data.custom_permissions || {})
    return reply.status(200).send({ data: { ...data, resolved_permissions: resolved } })
  })


  // ── GET /users/me/week-capacity?weekStart=YYYY-MM-DD ─────────────────────
  // Returns holiday/leave-adjusted capacity for the logged-in user for a given week.
  app.get('/me/week-capacity', async (req, reply) => {
    const user       = (req as any).user
    const { weekStart } = req.query as any
    if (!weekStart) return reply.status(400).send({ errors: [{ message: 'weekStart required' }] })

    // Parse week bounds
    const wStart = new Date(weekStart + 'T00:00:00')
    const wEnd   = new Date(wStart); wEnd.setDate(wEnd.getDate() + 6)
    const wStartStr = weekStart
    const wEndStr   = wEnd.toISOString().slice(0, 10)

    // Get user's raw capacity and holiday calendar
    const { data: userData } = await supabase
      .from('users')
      .select('capacity_hrs, holiday_calendar_id')
      .eq('id', user.id)
      .single()

    const rawCapacity = Number(userData?.capacity_hrs || 40)
    const dailyRate   = rawCapacity / 5

    // Count holiday days this week on user's calendar
    let holidayDays = 0
    if (userData?.holiday_calendar_id) {
      const { data: holidays } = await supabase
        .from('holidays')
        .select('date')
        .eq('calendar_id', userData.holiday_calendar_id)
        .gte('date', wStartStr)
        .lte('date', wEndStr)
      // Only count weekdays
      holidayDays = (holidays || []).filter((h: any) => {
        const dow = new Date(h.date + 'T12:00:00').getDay()
        return dow !== 0 && dow !== 6
      }).length
    }
    const holidayHrs = holidayDays * dailyRate

    // Count approved time-off hours logged this week
    const { data: leaveEntries } = await supabase
      .from('time_entries')
      .select('hours')
      .eq('user_id', user.id)
      .eq('type', 'time_off')
      .gte('date', wStartStr)
      .lte('date', wEndStr)
    const leaveHrs = (leaveEntries || []).reduce((s: number, e: any) => s + Number(e.hours || 0), 0)

    const adjustedCapacity = Math.max(0, rawCapacity - holidayHrs - leaveHrs)

    return reply.status(200).send({
      data: { rawCapacity, holidayDays, holidayHrs, leaveHrs, adjustedCapacity }
    })
  })
  app.get('/departments', async (req, reply) => {
    const wid = (req as any).user.workspaceId
    const { data: depts, error } = await supabase.from('departments').select('*').eq('workspace_id', wid).order('name')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    const { data: userRows } = await supabase.from('users').select('department_id').eq('workspace_id', wid).eq('active', true).is('deleted_at', null)
    const countMap: Record<string, number> = {}
    for (const u of userRows || []) {
      if (u.department_id) countMap[u.department_id] = (countMap[u.department_id] || 0) + 1
    }
    return reply.status(200).send({ data: (depts || []).map((d: any) => ({ ...d, user_count: countMap[d.id] || 0 })) })
  })

  app.post('/departments', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { name } = req.body as any
    const { data, error } = await supabase.from('departments').insert({ workspace_id: user.workspaceId, name }).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  // PATCH /departments/:id — update name or utilisation targets per department
  app.patch('/departments/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    if (!await assertRowInWorkspace('departments', id, user.workspaceId, reply)) return
    const { name, resource_utilization_pct, billable_utilization_pct } = req.body as any
    const update: any = {}
    if (name !== undefined) update.name = String(name).trim()
    if (resource_utilization_pct !== undefined) update.resource_utilization_pct = resource_utilization_pct
    if (billable_utilization_pct !== undefined) update.billable_utilization_pct = billable_utilization_pct
    const { data, error } = await supabase
      .from('departments').update(update)
      .eq('id', id).eq('workspace_id', user.workspaceId)
      .select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  // ── Google Calendar iCal → country code mapping ────────────────────────────
  // Public iCal feeds — no API key or OAuth needed
  const GOOGLE_CAL_IDS: Record<string, string> = {
    'AE': 'en.ae#holiday@group.v.calendar.google.com',
    'AF': 'en.af#holiday@group.v.calendar.google.com',
    'AL': 'en.al#holiday@group.v.calendar.google.com',
    'BA': 'en.ba#holiday@group.v.calendar.google.com',
    'AR': 'en.ar#holiday@group.v.calendar.google.com',
    'AU': 'en.australian#holiday@group.v.calendar.google.com',
    'AT': 'en.austrian#holiday@group.v.calendar.google.com',
    'AZ': 'en.az#holiday@group.v.calendar.google.com',
    'BH': 'en.bh#holiday@group.v.calendar.google.com',
    'BD': 'en.bd#holiday@group.v.calendar.google.com',
    'BY': 'en.by#holiday@group.v.calendar.google.com',
    'BE': 'en.be#holiday@group.v.calendar.google.com',
    'BR': 'en.brazilian#holiday@group.v.calendar.google.com',
    'CA': 'en.canadian#holiday@group.v.calendar.google.com',
    'CL': 'en.cl#holiday@group.v.calendar.google.com',
    'CN': 'en.china#holiday@group.v.calendar.google.com',
    'CO': 'en.co#holiday@group.v.calendar.google.com',
    'HR': 'en.croatian#holiday@group.v.calendar.google.com',
    'CZ': 'en.czech#holiday@group.v.calendar.google.com',
    'DK': 'en.danish#holiday@group.v.calendar.google.com',
    'EG': 'en.eg#holiday@group.v.calendar.google.com',
    'EE': 'en.et#holiday@group.v.calendar.google.com',
    'FI': 'en.finnish#holiday@group.v.calendar.google.com',
    'FR': 'en.french#holiday@group.v.calendar.google.com',
    'DE': 'en.german#holiday@group.v.calendar.google.com',
    'GH': 'en.gh#holiday@group.v.calendar.google.com',
    'GR': 'en.greek#holiday@group.v.calendar.google.com',
    'HK': 'en.hong_kong#holiday@group.v.calendar.google.com',
    'HU': 'en.hungarian#holiday@group.v.calendar.google.com',
    'IS': 'en.is#holiday@group.v.calendar.google.com',
    'IN': 'en.indian#holiday@group.v.calendar.google.com',
    'ID': 'en.id#holiday@group.v.calendar.google.com',
    'IR': 'en.ir#holiday@group.v.calendar.google.com',
    'IQ': 'en.iq#holiday@group.v.calendar.google.com',
    'IE': 'en.irish#holiday@group.v.calendar.google.com',
    'IL': 'en.jewish#holiday@group.v.calendar.google.com',
    'IT': 'en.italian#holiday@group.v.calendar.google.com',
    'JP': 'en.japanese#holiday@group.v.calendar.google.com',
    'JO': 'en.jo#holiday@group.v.calendar.google.com',
    'KZ': 'en.kz#holiday@group.v.calendar.google.com',
    'KE': 'en.kenyan#holiday@group.v.calendar.google.com',
    'KW': 'en.kw#holiday@group.v.calendar.google.com',
    'LB': 'en.lb#holiday@group.v.calendar.google.com',
    'MY': 'en.malaysia#holiday@group.v.calendar.google.com',
    'MV': 'en.mv#holiday@group.v.calendar.google.com',
    'MX': 'en.mexican#holiday@group.v.calendar.google.com',
    'MA': 'en.ma#holiday@group.v.calendar.google.com',
    'NP': 'en.np#holiday@group.v.calendar.google.com',
    'NL': 'en.dutch#holiday@group.v.calendar.google.com',
    'NZ': 'en.new_zealand#holiday@group.v.calendar.google.com',
    'NG': 'en.nigerian#holiday@group.v.calendar.google.com',
    'NO': 'en.norwegian#holiday@group.v.calendar.google.com',
    'OM': 'en.om#holiday@group.v.calendar.google.com',
    'PK': 'en.pk#holiday@group.v.calendar.google.com',
    'PH': 'en.philippines#holiday@group.v.calendar.google.com',
    'PL': 'en.polish#holiday@group.v.calendar.google.com',
    'PT': 'en.portuguese#holiday@group.v.calendar.google.com',
    'QA': 'en.qa#holiday@group.v.calendar.google.com',
    'RO': 'en.romanian#holiday@group.v.calendar.google.com',
    'RU': 'en.russian#holiday@group.v.calendar.google.com',
    'SA': 'en.sa#holiday@group.v.calendar.google.com',
    'RS': 'en.rs#holiday@group.v.calendar.google.com',
    'SG': 'en.singapore#holiday@group.v.calendar.google.com',
    'SK': 'en.slovak#holiday@group.v.calendar.google.com',
    'ZA': 'en.south_africa#holiday@group.v.calendar.google.com',
    'KR': 'en.south_korea#holiday@group.v.calendar.google.com',
    'ES': 'en.spain#holiday@group.v.calendar.google.com',
    'LK': 'en.lk#holiday@group.v.calendar.google.com',
    'SE': 'en.swedish#holiday@group.v.calendar.google.com',
    'CH': 'en.swiss#holiday@group.v.calendar.google.com',
    'TW': 'en.taiwan#holiday@group.v.calendar.google.com',
    'TH': 'en.th#holiday@group.v.calendar.google.com',
    'TN': 'en.tn#holiday@group.v.calendar.google.com',
    'TR': 'en.turkish#holiday@group.v.calendar.google.com',
    'UA': 'en.ukrainian#holiday@group.v.calendar.google.com',
    'GB': 'en.uk#holiday@group.v.calendar.google.com',
    'US': 'en.usa#holiday@group.v.calendar.google.com',
    'VN': 'en.vietnamese#holiday@group.v.calendar.google.com',
    'YE': 'en.ye#holiday@group.v.calendar.google.com',
  }

  // ── Parse Google public iCal feed and return YYYY-MM-DD date strings ─────────
  async function fetchGoogleHolidayDates(googleCalendarId: string, year: number): Promise<{ date: string; name: string }[]> {
    const encoded = encodeURIComponent(googleCalendarId)
    const url = `https://calendar.google.com/calendar/ical/${encoded}/public/basic.ics`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Forecast-App/1.0' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) throw new Error(`Google Calendar iCal returned ${res.status}`)
    const ical  = await res.text()
    const items: { date: string; name: string }[] = []
    const yearStr = String(year)
    // Split into VEVENT blocks
    const blocks = ical.split('BEGIN:VEVENT')
    for (const block of blocks.slice(1)) {
      const dateMatch = block.match(/DTSTART(?:;[^:]+)?:(\d{8})/)
      const nameMatch = block.match(/SUMMARY:(.+?)(?:\r?\n(?![ \t])|$)/m)
      if (!dateMatch) continue
      const raw = dateMatch[1]          // YYYYMMDD
      if (!raw.startsWith(yearStr)) continue
      const date = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`
      const name = nameMatch ? nameMatch[1].trim().replace(/\\,/g, ',').replace(/\\n/g, ' ') : 'Public Holiday'
      items.push({ date, name })
    }
    // Deduplicate by date (take first)
    const seen = new Set<string>()
    return items.filter(h => { if (seen.has(h.date)) return false; seen.add(h.date); return true })
  }

  // Countries supported by Nager.Date public API (fallback only)
  const NAGER_SUPPORTED = new Set(['AD','AL','AR','AM','AU','AT','AZ','BA','BS','BD','BY','BE','BO','BR','BG','CA','CL','CN','CO','HR','CY','CZ','DK','DO','EC','EE','FI','FR','GE','DE','GH','GR','HN','HK','HU','IS','IN','IE','IL','IT','JM','JP','KZ','KE','KR','LV','LS','LI','LT','LU','MY','MT','MX','MD','MA','NL','NZ','NG','NO','PA','PY','PE','PH','PL','PT','PR','RO','RU','SA','RS','SG','SK','SI','ZA','ES','SE','CH','TW','TN','TR','UA','GB','US','UY','VE','VN','ZW'])

  // ── PATCH /calendars/:id — update google_calendar_id or name ─────────────────
  app.patch('/calendars/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    if (!await assertRowInWorkspace('holiday_calendars', id, user.workspaceId, reply)) return
    const { google_calendar_id, name } = req.body as any
    const update: any = {}
    if (google_calendar_id !== undefined) update.google_calendar_id = google_calendar_id || null
    if (name !== undefined) update.name = name
    const { data, error } = await supabase
      .from('holiday_calendars').update(update)
      .eq('id', id).eq('workspace_id', user.workspaceId)
      .select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  // Holiday sync — tries Google iCal first, falls back to Nager.Date
  app.post('/calendars/:id/sync', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    const { year = new Date().getFullYear() } = req.body as any

    // Workspace boundary on the calendar
    const { data: cal, error: calErr } = await supabase
      .from('holiday_calendars')
      .select('id, name, country_code, google_calendar_id, workspace_id')
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .maybeSingle()
    if (calErr || !cal) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })

    const yearStr = String(year)

    // ── Strategy 1: Google Calendar iCal (preferred — 200+ countries, no key) ──
    const googleCalId = cal.google_calendar_id
      || (cal.country_code ? GOOGLE_CAL_IDS[cal.country_code] : null)

    if (googleCalId) {
      try {
        const items = await fetchGoogleHolidayDates(googleCalId, year)
        // Auto-save the google_calendar_id if it was derived from country_code
        if (!cal.google_calendar_id && cal.country_code && GOOGLE_CAL_IDS[cal.country_code]) {
          await supabase.from('holiday_calendars').update({ google_calendar_id: googleCalId }).eq('id', id)
        }
        // Delete existing for this year, insert fresh
        await supabase.from('holidays').delete().eq('calendar_id', id).gte('date', `${yearStr}-01-01`).lte('date', `${yearStr}-12-31`)
        if (items.length > 0) {
          await supabase.from('holidays').insert(items.map(h => ({ calendar_id: id, name: h.name, date: h.date })))
        }
        return reply.status(200).send({ data: { inserted: items.length, year, source: 'google_calendar', country: cal.country_code } })
      } catch (e: any) {
        // Google failed — fall through to Nager.Date
        console.warn(`Google iCal failed for ${googleCalId}: ${e.message} — trying Nager.Date fallback`)
      }
    }

    // ── Strategy 2: Nager.Date fallback ──────────────────────────────────────────
    if (!cal.country_code) {
      return reply.status(400).send({ errors: [{ code: 'NO_SOURCE', message: 'No Google Calendar ID or country code set. Please link a Google Calendar or add holidays manually.' }] })
    }
    if (!NAGER_SUPPORTED.has(cal.country_code)) {
      return reply.status(200).send({ data: { inserted: 0, unsupported: true, message: `${cal.country_code} is not in the Nager.Date database and Google Calendar sync failed. Please add holidays manually.` } })
    }

    let allHolidays: any[]
    try {
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cal.country_code}`)
      if (!res.ok) return reply.status(502).send({ errors: [{ code: 'UPSTREAM_ERROR', message: `Nager.Date returned ${res.status} for ${cal.country_code}` }] })
      allHolidays = await res.json() as any[]
    } catch (e: any) {
      return reply.status(502).send({ errors: [{ code: 'FETCH_FAILED', message: e.message }] })
    }

    if (!Array.isArray(allHolidays) || allHolidays.length === 0) {
      return reply.status(200).send({ data: { inserted: 0, message: 'No holidays found for this country/year' } })
    }

    // ── Filter to official national public holidays only ─────────────────────────────
    // Nager.Date returns Public + Bank + Optional + Observance + School etc.
    // We only want: type=Public AND global=true (applies to whole country, not just regions)
    const holidays = allHolidays.filter((h: any) => {
      const types: string[] = Array.isArray(h.types) ? h.types : []
      const isPublic = types.includes('Public')
      const isGlobal = h.global !== false  // default true if not specified
      const isNational = !h.counties       // counties=null means it applies nationwide
      return isPublic && isGlobal && isNational
    })

    await supabase.from('holidays').delete().eq('calendar_id', id).gte('date', `${yearStr}-01-01`).lte('date', `${yearStr}-12-31`)
    const rows = holidays.map((h: any) => ({ calendar_id: id, name: h.name || h.localName, date: h.date }))
    const { error: insErr } = await supabase.from('holidays').insert(rows)
    if (insErr) return reply.status(500).send({ errors: [{ message: insErr.message }] })
    return reply.status(200).send({ data: { inserted: rows.length, year, total_before_filter: allHolidays.length, source: 'nager_date', country: cal.country_code } })
  })

  // Holiday calendars
  app.get('/calendars', async (req, reply) => {
    const { data, error } = await supabase.from('holiday_calendars').select('id, name, country, country_code, is_default, holidays(id, name, date)').eq('workspace_id', (req as any).user.workspaceId).order('name')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.post('/calendars', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { name, country, country_code } = req.body as any
    if (!name?.trim()) return reply.status(400).send({ errors: [{ code: 'MISSING_NAME' }] })
    // Auto-populate google_calendar_id from country_code if available
    const google_calendar_id = country_code ? (GOOGLE_CAL_IDS[country_code] || null) : null
    const { data, error } = await supabase.from('holiday_calendars')
      .insert({ workspace_id: user.workspaceId, name: name.trim(), country: country || null, country_code: country_code || null, google_calendar_id })
      .select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  app.delete('/calendars/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    if (!await assertRowInWorkspace('holiday_calendars', id, user.workspaceId, reply)) return
    await supabase.from('holiday_calendars').delete().eq('id', id).eq('workspace_id', user.workspaceId)
    return reply.status(200).send({ data: { message: 'Deleted' } })
  })

  app.get('/calendars/:id/holidays', async (req, reply) => {
    const user = (req as any).user
    const { id } = req.params as any
    if (!await assertRowInWorkspace('holiday_calendars', id, user.workspaceId, reply)) return
    const { data, error } = await supabase.from('holidays').select('*').eq('calendar_id', id).order('date')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.post('/calendars/:id/holidays', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    if (!await assertRowInWorkspace('holiday_calendars', id, user.workspaceId, reply)) return
    const { name, date } = req.body as any
    if (!name?.trim() || !date) return reply.status(400).send({ errors: [{ code: 'MISSING_FIELDS' }] })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.status(400).send({ errors: [{ code: 'BAD_DATE' }] })
    const { data, error } = await supabase.from('holidays').insert({ calendar_id: id, name: String(name).trim(), date }).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  app.patch('/calendars/:calendarId/holidays/:holidayId', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { calendarId, holidayId } = req.params as any
    if (!await assertRowInWorkspace('holiday_calendars', calendarId, user.workspaceId, reply)) return
    if (!await assertHolidayInCalendar(holidayId, user.workspaceId, reply)) return
    const { name, date } = req.body as any
    const update: any = {}
    if (name !== undefined) update.name = String(name).trim()
    if (date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.status(400).send({ errors: [{ code: 'BAD_DATE' }] })
      update.date = date
    }
    const { data, error } = await supabase.from('holidays').update(update)
      .eq('id', holidayId).eq('calendar_id', calendarId).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.delete('/calendars/:calendarId/holidays/:holidayId', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { calendarId, holidayId } = req.params as any
    if (!await assertRowInWorkspace('holiday_calendars', calendarId, user.workspaceId, reply)) return
    if (!await assertHolidayInCalendar(holidayId, user.workspaceId, reply)) return
    await supabase.from('holidays').delete().eq('id', holidayId).eq('calendar_id', calendarId)
    return reply.status(200).send({ data: { message: 'Deleted' } })
  })

  // ─── Sub-client validation ─────────────────────────────────────────────────
  // Shared between POST /clients and PATCH /clients/:id to stop three failure
  // modes: (1) pointing at a parent that isn't in the same workspace, (2) a
  // client pointing at itself, and (3) creating a parent cycle A→B→A.
  //
  // Phase-1 rule: only one level of nesting is supported. If the proposed
  // parent already has a parent, we reject the write — simpler for the UI,
  // matches Murtaza's Apr 17 example (Nexa Cognition > Redwood, not
  // Nexa Cognition > Redwood > SubRedwood). We can relax this in phase 2
  // if the need arises.
  async function validateParentClient(
    proposedParentId: string,
    selfId: string | null,
    workspaceId: string,
    reply: FastifyReply,
  ): Promise<boolean> {
    if (!proposedParentId) return true
    if (selfId && proposedParentId === selfId) {
      reply.status(400).send({ errors: [{ code: 'SELF_PARENT', message: 'A client cannot be its own parent' }] })
      return false
    }
    const { data: parent } = await supabase
      .from('clients')
      .select('id, parent_client_id, deleted_at')
      .eq('id', proposedParentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!parent || parent.deleted_at) {
      reply.status(404).send({ errors: [{ code: 'PARENT_NOT_FOUND', message: 'Parent client not found in this workspace' }] })
      return false
    }
    if (parent.parent_client_id) {
      reply.status(400).send({ errors: [{ code: 'PARENT_IS_SUB_CLIENT', message: 'Chosen parent is already a sub-client. Only one level of nesting is supported.' }] })
      return false
    }
    return true
  }

  // Clients
  //
  // GET /clients returns parent + children info alongside each row so the UI
  // can render hierarchy indicators ("2 sub-clients", parent-of-X badge)
  // without a second round-trip. Two Supabase nested-select relationships are
  // used: `parent` (one-to-one via parent_client_id) and `children` (reverse
  // of the same FK). The `!parent_client_id` hint disambiguates which FK to
  // follow, since there are two FKs on clients (parent_client_id and itself).
  app.get('/clients', async (req, reply) => {
    const { data, error } = await supabase
      .from('clients')
      .select('*, parent:parent_client_id(id, name), children:clients!parent_client_id(id, name, deleted_at)')
      .eq('workspace_id', (req as any).user.workspaceId)
      .is('deleted_at', null)
      .order('name')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    // Filter out soft-deleted children before returning to the client —
    // Supabase's nested select doesn't support `.is('deleted_at', null)` on
    // the nested relation, so we filter client-side.
    const rows = (data || []).map((c: any) => ({
      ...c,
      children: Array.isArray(c.children) ? c.children.filter((ch: any) => !ch.deleted_at) : [],
    }))
    return reply.status(200).send({ data: rows })
  })

  app.post('/clients', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })

    // See projects.ts — same sync-lock guard. Manually-created clients pollute
    // the count with orphans (no forecast_id) that never sync back.
    const syncLocked = process.env.FORECAST_SYNC_LOCKED !== '0' && !!process.env.FORECAST_API_KEY
    if (syncLocked) {
      return reply.status(403).send({ errors: [{
        code: 'FORECAST_SYNC_LOCKED',
        message: 'Clients are managed in Forecast.it during migration. Create it there — it appears here within 5 minutes.',
      }] })
    }

    const body = req.body as any
    if (!body.name || !body.name.trim()) return reply.status(400).send({ errors: [{ message: 'Client name is required' }] })

    // Validate parent_client_id before generating a code / inserting anything
    const parentId = body.parent_client_id || null
    if (parentId && !await validateParentClient(parentId, null, user.workspaceId, reply)) return

    // Auto-generate a human-readable client ID: CLT-001, CLT-002, etc.
    const [clientCode] = await nextClientCodes(user.workspaceId, 1)

    // Whitelist allowed fields (mass assignment protection)
    const insert: any = {
      workspace_id: user.workspaceId,
      client_code: clientCode,
      name: String(body.name).trim(),
      country: body.country || null,
      address: body.address || null,
      logo_url: body.logo_url || null,
      active: body.active !== false,
      parent_client_id: parentId,
    }
    const { data, error } = await supabase.from('clients').insert(insert).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  app.patch('/clients/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    // Whitelist allowed fields
    const body = req.body as any
    const update: any = {}
    if (body.name !== undefined) update.name = String(body.name).trim()
    if (body.country !== undefined) update.country = body.country
    if (body.address !== undefined) update.address = body.address
    if (body.logo_url !== undefined) update.logo_url = body.logo_url
    if (body.active !== undefined) update.active = !!body.active
    if (body.default_rate_card_id !== undefined) update.default_rate_card_id = body.default_rate_card_id || null

    // Parent-client update — validate before writing. Passing null / empty
    // string clears the parent (promotes back to top-level).
    if (body.parent_client_id !== undefined) {
      const newParent = body.parent_client_id || null
      if (newParent) {
        if (!await validateParentClient(newParent, id, user.workspaceId, reply)) return
        // Also guard against promoting THIS client into a parent while it has
        // children — keeps us at a single level of nesting. If this client
        // has any children, it can't itself become a child.
        const { data: myChildren } = await supabase
          .from('clients').select('id').eq('parent_client_id', id).is('deleted_at', null).limit(1)
        if (myChildren && myChildren.length > 0) {
          return reply.status(400).send({ errors: [{ code: 'HAS_CHILDREN', message: 'This client has sub-clients. Re-parent or remove them before making this client a sub-client itself.' }] })
        }
      }
      update.parent_client_id = newParent
    }

    const { data, error } = await supabase.from('clients').update(update)
      .eq('id', id).eq('workspace_id', user.workspaceId).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    if (!data) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return reply.status(200).send({ data })
  })

  // ── POST /clients/:id/merge ─────────────────────────────────────────────────
  // Merge one client into another. Re-points all projects + invoices from the
  // source to the target, then soft-deletes the source. Used when finance-sheet
  // names don't match project-tracker names for the same real-world customer
  // (e.g. "Align Technology LLC" vs "Align Technology Medical Surgical ...").
  app.post('/clients/:id/merge', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const sourceId = (req.params as any).id
    const targetId = (req.body as any)?.into_client_id
    if (!targetId) return reply.status(400).send({ errors: [{ code: 'MISSING_TARGET', message: 'into_client_id required' }] })
    if (sourceId === targetId) return reply.status(400).send({ errors: [{ code: 'SAME_CLIENT', message: 'Cannot merge a client into itself' }] })

    // Both must belong to caller's workspace and be active
    const { data: rows } = await supabase
      .from('clients').select('id, name, deleted_at')
      .in('id', [sourceId, targetId])
      .eq('workspace_id', user.workspaceId)
    if (!rows || rows.length !== 2) {
      return reply.status(404).send({ errors: [{ code: 'NOT_FOUND', message: 'One or both clients not found in your workspace' }] })
    }
    const source = (rows as any[]).find(r => r.id === sourceId)
    const target = (rows as any[]).find(r => r.id === targetId)
    if (source.deleted_at || target.deleted_at) {
      return reply.status(400).send({ errors: [{ code: 'ALREADY_DELETED', message: 'Cannot merge a deleted client' }] })
    }

    // 1) Re-point all active projects
    const { data: movedProjects, error: projErr } = await supabase
      .from('projects').update({ client_id: targetId })
      .eq('client_id', sourceId).is('deleted_at', null).select('id')
    if (projErr) return reply.status(500).send({ errors: [{ message: `Project re-point failed: ${projErr.message}` }] })

    // 2) Re-point all invoices (no deleted filter — invoices are immutable records)
    const { data: movedInvoices, error: invErr } = await supabase
      .from('client_invoices').update({ client_id: targetId })
      .eq('client_id', sourceId).select('id')
    if (invErr) return reply.status(500).send({ errors: [{ message: `Invoice re-point failed: ${invErr.message}` }] })

    // 3) Re-point any sub-clients of the source to the target. Without this,
    // merging Parent-A into Parent-B would soft-delete A and its FK cascades
    // would null out its children's parent_client_id — promoting them to
    // top-level. Almost always the intent is "these customers are the same,
    // so A's family should become B's family"; if the caller wants the old
    // behaviour they can clear parent_client_id on each child before merging.
    const { error: subErr } = await supabase
      .from('clients').update({ parent_client_id: targetId })
      .eq('parent_client_id', sourceId).eq('workspace_id', user.workspaceId)
    if (subErr) return reply.status(500).send({ errors: [{ message: `Sub-client re-point failed: ${subErr.message}` }] })

    // 4) Soft-delete the source client
    const { error: delErr } = await supabase
      .from('clients').update({ deleted_at: new Date().toISOString() })
      .eq('id', sourceId).eq('workspace_id', user.workspaceId)
    if (delErr) return reply.status(500).send({ errors: [{ message: `Delete failed: ${delErr.message}` }] })

    return reply.status(200).send({
      ok: true,
      source: { id: source.id, name: source.name },
      target: { id: target.id, name: target.name },
      projectsMoved: movedProjects?.length || 0,
      invoicesMoved: movedInvoices?.length || 0,
    })
  })

  // Labels
  app.get('/labels', async (req, reply) => {
    const { data, error } = await supabase.from('project_labels').select('*').eq('workspace_id', (req as any).user.workspaceId).order('name')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.post('/labels', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { name, color } = req.body as any
    const { data, error } = await supabase.from('project_labels').insert({ workspace_id: user.workspaceId, name, color }).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  // Rate cards
  app.get('/rate-cards', async (req, reply) => {
    const { data, error } = await supabase.from('rate_cards').select('*, rate_card_entries(*)').eq('workspace_id', (req as any).user.workspaceId).order('name')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.post('/rate-cards', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { name, currency = 'AED' } = req.body as any
    if (!name?.trim()) return reply.status(400).send({ errors: [{ code: 'MISSING_NAME' }] })
    const { data, error } = await supabase.from('rate_cards').insert({ workspace_id: user.workspaceId, name: name.trim(), currency }).select('*, rate_card_entries(*)').single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  app.patch('/rate-cards/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    if (!await assertRowInWorkspace('rate_cards', id, user.workspaceId, reply)) return
    const { name, currency } = req.body as any
    const update: any = {}
    if (name) update.name = String(name).trim()
    if (currency) update.currency = currency
    const { data, error } = await supabase
      .from('rate_cards').update(update)
      .eq('id', id).eq('workspace_id', user.workspaceId)
      .select('*, rate_card_entries(*)').single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.patch('/rate-cards/:id/entries/:entryId', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id, entryId } = req.params as any
    if (!await assertRowInWorkspace('rate_cards', id, user.workspaceId, reply)) return
    if (!await assertRateCardEntryInWorkspace(entryId, user.workspaceId, reply)) return
    const { hourly_rate, department_id, job_title } = req.body as any
    const update: any = {}
    if (hourly_rate !== undefined) {
      const rate = Number(hourly_rate)
      if (!Number.isFinite(rate) || rate < 0) return reply.status(400).send({ errors: [{ code: 'BAD_RATE' }] })
      update.hourly_rate = rate
    }
    if (department_id !== undefined) {
      if (department_id) {
        const { data: dept } = await supabase.from('departments').select('id').eq('id', department_id).eq('workspace_id', user.workspaceId).maybeSingle()
        if (!dept) return reply.status(400).send({ errors: [{ code: 'BAD_DEPARTMENT' }] })
      }
      update.department_id = department_id || null
    }
    if (job_title !== undefined) update.job_title = job_title ? String(job_title).trim() : null
    const { data, error } = await supabase.from('rate_card_entries')
      .update(update).eq('id', entryId).eq('rate_card_id', id).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.post('/rate-cards/:id/entries', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    if (!await assertRowInWorkspace('rate_cards', id, user.workspaceId, reply)) return
    const { job_title, department_id, hourly_rate } = req.body as any
    // Either department_id OR job_title must be provided (department preferred)
    if (!department_id && !job_title?.trim()) return reply.status(400).send({ errors: [{ code: 'MISSING_DEPT_OR_TITLE' }] })
    const rate = Number(hourly_rate)
    if (!Number.isFinite(rate) || rate < 0) return reply.status(400).send({ errors: [{ code: 'BAD_RATE' }] })
    if (department_id) {
      const { data: dept } = await supabase.from('departments').select('id').eq('id', department_id).eq('workspace_id', user.workspaceId).maybeSingle()
      if (!dept) return reply.status(400).send({ errors: [{ code: 'BAD_DEPARTMENT' }] })
    }
    const insertRow: any = { rate_card_id: id, hourly_rate: rate }
    if (department_id) insertRow.department_id = department_id
    if (job_title?.trim()) insertRow.job_title = String(job_title).trim()
    const { data, error } = await supabase.from('rate_card_entries')
      .insert(insertRow).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  // (DELETE /rate-cards/:id/entries/:entryId already exists below at line ~695 — don't duplicate)

  app.delete('/rate-cards/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    if (!await assertRowInWorkspace('rate_cards', id, user.workspaceId, reply)) return
    await supabase.from('rate_card_entries').delete().eq('rate_card_id', id)
    const { error } = await supabase.from('rate_cards').delete()
      .eq('id', id).eq('workspace_id', user.workspaceId)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data: { deleted: true } })
  })

  app.delete('/rate-cards/:id/entries/:entryId', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id, entryId } = req.params as any
    if (!await assertRowInWorkspace('rate_cards', id, user.workspaceId, reply)) return
    if (!await assertRateCardEntryInWorkspace(entryId, user.workspaceId, reply)) return
    const { error } = await supabase.from('rate_card_entries').delete()
      .eq('id', entryId).eq('rate_card_id', id)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data: { deleted: true } })
  })

  // Permissions
  app.get('/permissions-schema', async (req, reply) => {
    return reply.status(200).send({ data: { permissions: ALL_PERMISSIONS, roleDefaults: ROLE_DEFAULTS } })
  })

  app.patch('/:id/permissions', async (req, reply) => {
    const caller = (req as any).user
    if (caller.profile !== 'super_admin') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    if (!await assertRowInWorkspace('users', id, caller.workspaceId, reply)) return
    const overrides = req.body as Record<string, boolean>
    if (!overrides || typeof overrides !== 'object') return reply.status(400).send({ errors: [{ code: 'INVALID_BODY' }] })
    const invalid = Object.keys(overrides).filter(k => !ALL_PERMISSIONS.includes(k as Permission))
    if (invalid.length) return reply.status(400).send({ errors: [{ code: 'INVALID_PERMISSIONS', message: `Unknown: ${invalid.join(', ')}` }] })
    // Coerce values to boolean (defense against truthy strings etc)
    const cleaned: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(overrides)) cleaned[k] = !!v
    const { data: u, error } = await supabase.from('users').update({ custom_permissions: cleaned })
      .eq('id', id).eq('workspace_id', caller.workspaceId)
      .select('id, name, permission_profile, custom_permissions').single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data: { ...u, resolved_permissions: resolvePermissions(u.permission_profile, u.custom_permissions || {}) } })
  })

  // ── Shared helper: compute net capacity (hrs) for a user over a date range ──
  function netCapacity(
    capacityHrs: number,
    from: string,
    to: string,
    holidayDates: Set<string>,   // public holidays for this user's calendar in range
    timeOffHrs: number,          // approved leave hours in range
  ): number {
    const daily = Number(capacityHrs || 40) / 5   // 8 h/day for 40 h/week contract
    let workDays = 0
    const cur = new Date(from + 'T12:00:00')
    const end = new Date(to   + 'T12:00:00')
    while (cur <= end) {
      const dow = cur.getDay()
      if (dow !== 0 && dow !== 6) workDays++   // Mon–Fri only
      cur.setDate(cur.getDate() + 1)
    }
    const grossHrs = Math.max(0, workDays - holidayDates.size) * daily
    return Math.round(Math.max(0, grossHrs - timeOffHrs) * 10) / 10
  }

  // Timesheet compliance
  app.get('/timesheet-compliance', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const query = req.query as any
    const weekStart = query.weekStart || new Date().toISOString().slice(0, 10)
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
    const weekEndStr = weekEnd.toISOString().slice(0, 10)

    // Fetch users WITH holiday_calendar_id so we can compute net capacity
    const { data: users, error: uErr } = await supabase
      .from('users')
      .select('id, name, job_title, capacity_hrs, holiday_calendar_id, departments(name)')
      .eq('workspace_id', user.workspaceId)
      .eq('active', true)
      .is('deleted_at', null)
      .order('name')
    if (uErr) return reply.status(500).send({ errors: [{ message: uErr.message }] })

    // Fetch public holidays for all calendars in this week
    const calIds = [...new Set((users || []).map((u: any) => u.holiday_calendar_id).filter(Boolean))]
    const { data: holidays } = calIds.length
      ? await supabase.from('holidays').select('date, calendar_id')
          .in('calendar_id', calIds).gte('date', weekStart).lte('date', weekEndStr)
      : { data: [] }

    // calendarId → Set of holiday dates in week
    const calHolidays: Record<string, Set<string>> = {}
    for (const h of holidays || []) {
      if (!calHolidays[h.calendar_id]) calHolidays[h.calendar_id] = new Set()
      calHolidays[h.calendar_id].add(h.date)
    }

    // Fetch time entries for week (work + time_off)
    const { data: entries } = await supabase
      .from('time_entries')
      .select('user_id, hours, date, billable, type')
      .gte('date', weekStart).lte('date', weekEndStr)

    const result = (users || []).map((u: any) => {
      const myEntries  = (entries || []).filter((e: any) => e.user_id === u.id)
      const workEntries = myEntries.filter((e: any) => e.type !== 'time_off')
      const totalHrs   = workEntries.reduce((s: number, e: any) => s + Number(e.hours), 0)
      const billableHrs = workEntries.filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours), 0)
      const timeOffHrs  = myEntries.filter((e: any) => e.type === 'time_off').reduce((s: number, e: any) => s + Number(e.hours), 0)
      const daysLogged  = new Set(workEntries.map((e: any) => e.date)).size

      const calId       = u.holiday_calendar_id
      const holSet      = calId ? (calHolidays[calId] || new Set()) : new Set<string>()
      const cap         = netCapacity(u.capacity_hrs, weekStart, weekEndStr, holSet, timeOffHrs)
      const holidayCount = holSet.size

      return {
        id: u.id, name: u.name,
        department: u.departments?.name || '—',
        jobTitle:   u.job_title || '—',
        capacityHrs: cap,          // ← NET capacity (holidays + leave deducted)
        grossCapHrs: Number(u.capacity_hrs) || 40,
        holidayCount,
        timeOffHrs,
        loggedHrs:   Math.round(totalHrs    * 10) / 10,
        billableHrs: Math.round(billableHrs * 10) / 10,
        daysLogged,
        submitted:   totalHrs > 0,
      }
    })
    return reply.status(200).send({ data: result, weekStart, weekEnd: weekEndStr })
  })

  // Skills endpoints
  app.get('/:id/skills', async (req, reply) => {
    const { id } = req.params as any
    const caller = (req as any).user
    if (!await assertRowInWorkspace('users', id, caller.workspaceId, reply)) return
    const { data, error } = await supabase.from('user_skills').select('skill').eq('user_id', id).order('created_at')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.post('/:id/skills', async (req, reply) => {
    const { id } = req.params as any
    const caller = (req as any).user
    if (caller.profile === 'collaborator' && id !== caller.id) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    if (!await assertRowInWorkspace('users', id, caller.workspaceId, reply)) return
    const { skill } = req.body as any
    if (!skill?.trim()) return reply.status(400).send({ errors: [{ code: 'MISSING_SKILL' }] })
    const cleanSkill = String(skill).trim().slice(0, 100)
    const { data, error } = await supabase.from('user_skills').insert({ user_id: id, skill: cleanSkill }).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  app.delete('/:id/skills/:skill', async (req, reply) => {
    const { id, skill } = req.params as any
    const caller = (req as any).user
    if (caller.profile === 'collaborator' && id !== caller.id) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    if (!await assertRowInWorkspace('users', id, caller.workspaceId, reply)) return
    await supabase.from('user_skills').delete().eq('user_id', id).eq('skill', decodeURIComponent(skill))
    return reply.status(200).send({ data: { message: 'Removed' } })
  })

  // Users CRUD
  // Defaults to active users only — pass ?include_deactivated=true to include
  // deactivated rows (used by the People page's "Show deactivated" toggle).
  // Reports, project pickers, and other "innocent" consumers inherit the
  // active-only default so ex-employees don't bleed into utilization
  // tables and assignee dropdowns.
  app.get('/', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const includeDeactivated = (req.query as any)?.include_deactivated === 'true'
    let q = supabase
      .from('users')
      .select('*, departments(id, name), holiday_calendars(id, name), custom_roles(id, name, base_role)')
      .eq('workspace_id', user.workspaceId)
      .is('deleted_at', null)
    if (!includeDeactivated) q = q.eq('active', true)
    const { data, error } = await q.order('name')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    const enriched = (data || []).map((u: any) => ({ ...u, resolved_permissions: resolvePermissions(u.permission_profile, u.custom_permissions || {}) }))
    return reply.status(200).send({ data: enriched })
  })

  // ── GET /users/holidays-range?from=&to= ─────────────────────────────────
  // Returns holiday dates per calendar_id for the date range — used by Reports
  app.get('/holidays-range', async (req, reply) => {
    const user  = (req as any).user
    const query = req.query as any
    const { from, to } = query
    if (!from || !to) return reply.status(400).send({ errors: [{ message: 'from and to required' }] })

    // Find all holiday_calendar_ids used by this workspace's users
    const { data: wsUsers } = await supabase
      .from('users')
      .select('id, holiday_calendar_id')
      .eq('workspace_id', user.workspaceId)
      .eq('active', true)
      .is('deleted_at', null)
      .not('holiday_calendar_id', 'is', null)

    const calIds = [...new Set((wsUsers || []).map((u: any) => u.holiday_calendar_id).filter(Boolean))]
    if (!calIds.length) return reply.status(200).send({ data: { calendarHolidays: {}, userCalendarMap: {} } })

    // Fetch holidays in range for those calendars
    const { data: holidays } = await supabase
      .from('holidays')
      .select('date, calendar_id')
      .in('calendar_id', calIds)
      .gte('date', from)
      .lte('date', to)

    // calendarId -> array of holiday date strings
    const calendarHolidays: Record<string, string[]> = {}
    for (const h of holidays || []) {
      if (!calendarHolidays[h.calendar_id]) calendarHolidays[h.calendar_id] = []
      calendarHolidays[h.calendar_id].push(h.date)
    }

    // userId -> calendarId
    const userCalendarMap: Record<string, string> = {}
    for (const u of wsUsers || []) {
      if (u.holiday_calendar_id) userCalendarMap[u.id] = u.holiday_calendar_id
    }

    // ── Time-off hours per user in date range ─────────────────────────────
    // Approved leave = any time_entry with type='time_off' in the range
    const allUserIds = (wsUsers || []).map((u: any) => u.id)
    const { data: timeOffEntries } = await supabase
      .from('time_entries')
      .select('user_id, hours')
      .eq('type', 'time_off')
      .in('user_id', allUserIds.length ? allUserIds : ['none'])
      .gte('date', from)
      .lte('date', to)

    const userTimeOffHrs: Record<string, number> = {}
    for (const e of timeOffEntries || []) {
      userTimeOffHrs[e.user_id] = (userTimeOffHrs[e.user_id] || 0) + Number(e.hours)
    }

    return reply.status(200).send({ data: { calendarHolidays, userCalendarMap, userTimeOffHrs } })
  })

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user
    if (user.profile === 'collaborator' && id !== user.id) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    // Workspace boundary check (IDOR fix)
    const { data, error } = await supabase.from('users').select('*, departments(*), holiday_calendars(*)')
      .eq('id', id).eq('workspace_id', user.workspaceId).single()
    if (error || !data) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    // Hide internal_hourly_cost from non-super-admin
    if (user.profile !== 'super_admin') delete (data as any).internal_hourly_cost
    return reply.status(200).send({ data: { ...data, resolved_permissions: resolvePermissions(data.permission_profile, data.custom_permissions || {}) } })
  })

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user
    if (user.profile === 'collaborator' && id !== user.id) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const body = req.body as any
    // Whitelist allowed fields per role
    const ALLOWED_FIELDS_BASE = ['name','email','job_title','avatar_url','department_id','holiday_calendar_id','capacity_hrs','start_date','end_date','active']
    const ALLOWED_FIELDS_ADMIN = [...ALLOWED_FIELDS_BASE, 'permission_profile','seat_type','custom_role_id']
    const ALLOWED_FIELDS_SUPER = [...ALLOWED_FIELDS_ADMIN, 'internal_hourly_cost']
    const allowed = user.profile === 'super_admin' ? ALLOWED_FIELDS_SUPER
                  : isAdmin(user.profile) ? ALLOWED_FIELDS_ADMIN
                  : ALLOWED_FIELDS_BASE
    const updateData: any = {}
    for (const k of allowed) if (k in body) updateData[k] = body[k]
    // Normalize empty values to null for nullable fields
    if ('end_date' in updateData && !updateData.end_date) updateData.end_date = null
    if ('custom_role_id' in updateData && !updateData.custom_role_id) updateData.custom_role_id = null
    if ('department_id' in updateData && !updateData.department_id) updateData.department_id = null
    // IDOR fix: workspace boundary
    const { data, error } = await supabase.from('users').update(updateData)
      .eq('id', id).eq('workspace_id', user.workspaceId).select().single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    if (!data) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    return reply.status(200).send({ data })
  })

  app.delete('/:id', async (req, reply) => {
    const user = (req as any).user
    if (user.profile !== 'super_admin') return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    if (id === user.id) return reply.status(400).send({ errors: [{ code: 'CANNOT_DEACTIVATE_SELF' }] })
    if (!await assertRowInWorkspace('users', id, user.workspaceId, reply)) return
    const { count } = await supabase.from('users')
      .update({ active: false, deleted_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', id).eq('workspace_id', user.workspaceId)
    if (count === 0) return reply.status(404).send({ errors: [{ code: 'NOT_FOUND' }] })
    // Revoke all sessions for the deactivated user
    await supabase.from('refresh_tokens').delete().eq('user_id', id)
    return reply.status(200).send({ data: { message: 'Deactivated' } })
  })

  // ── Custom Roles ────────────────────────────────────────────────────────────
  app.get('/custom-roles', async (req, reply) => {
    const user = (req as any).user
    const { data, error } = await supabase
      .from('custom_roles')
      .select('*')
      .eq('workspace_id', user.workspaceId)
      .order('name')
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.post('/custom-roles', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { name, base_role = 'collaborator' } = req.body as any
    if (!name?.trim()) return reply.status(400).send({ errors: [{ message: 'Name required' }] })
    const { data, error } = await supabase
      .from('custom_roles')
      .insert({ workspace_id: user.workspaceId, name: name.trim(), base_role })
      .select()
      .single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(201).send({ data })
  })

  app.patch('/custom-roles/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    const { name, base_role } = req.body as any
    const update: any = {}
    if (name?.trim()) update.name = name.trim()
    if (base_role) update.base_role = base_role
    const { data, error } = await supabase
      .from('custom_roles')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .select()
      .single()
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data })
  })

  app.delete('/custom-roles/:id', async (req, reply) => {
    const user = (req as any).user
    if (!isAdmin(user.profile)) return reply.status(403).send({ errors: [{ code: 'FORBIDDEN' }] })
    const { id } = req.params as any
    // Unset custom_role_id for any users that had this role
    await supabase.from('users').update({ custom_role_id: null }).eq('custom_role_id', id)
    const { error } = await supabase
      .from('custom_roles')
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
    if (error) return reply.status(500).send({ errors: [{ message: error.message }] })
    return reply.status(200).send({ data: { message: 'Deleted' } })
  })

  // ── Slack integration ─────────────────────────────────────────────────────

  app.get('/slack/status', async (req, reply) => {
    const user = (req as any).user
    const { data: ws } = await supabase.from('workspaces').select('sync_state').eq('id', user.workspaceId).single()
    const slack = ((ws as any)?.sync_state)?.slack || null
    if (!slack?.botToken) return reply.status(200).send({ connected: false })
    return reply.status(200).send({
      connected: true,
      teamName: slack.teamName,
      channelId: slack.channelId,
      channelName: slack.channelName,
      connectedAt: slack.connectedAt,
    })
  })

  app.get('/slack/channels', async (req, reply) => {
    const user = (req as any).user
    const { data: ws } = await supabase.from('workspaces').select('sync_state').eq('id', user.workspaceId).single()
    const slack = ((ws as any)?.sync_state)?.slack
    if (!slack?.botToken) return reply.status(400).send({ errors: [{ code: 'NOT_CONNECTED' }] })

    try {
      const res = await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200', {
        headers: { Authorization: `Bearer ${slack.botToken}` },
      })
      const data = await res.json() as any
      if (!data.ok) return reply.status(500).send({ errors: [{ message: data.error }] })
      const channels = (data.channels || []).map((c: any) => ({ id: c.id, name: c.name, is_private: c.is_private }))
      return reply.status(200).send({ data: channels })
    } catch (e: any) {
      return reply.status(500).send({ errors: [{ message: e.message }] })
    }
  })

  app.patch('/slack/channel', async (req, reply) => {
    const user = (req as any).user
    const { channelId, channelName } = req.body as any
    if (!channelId) return reply.status(400).send({ errors: [{ code: 'MISSING_CHANNEL' }] })

    const { data: ws } = await supabase.from('workspaces').select('sync_state').eq('id', user.workspaceId).single()
    const currentState = ((ws as any)?.sync_state) || {}
    if (!currentState.slack?.botToken) return reply.status(400).send({ errors: [{ code: 'NOT_CONNECTED' }] })

    // Join the channel so the bot can post to it
    await fetch('https://slack.com/api/conversations.join', {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentState.slack.botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId }),
    })

    const newState = { ...currentState, slack: { ...currentState.slack, channelId, channelName } }
    await supabase.from('workspaces').update({ sync_state: newState }).eq('id', user.workspaceId)
    return reply.status(200).send({ data: { channelId, channelName } })
  })

  app.post('/slack/test', async (req, reply) => {
    const user = (req as any).user
    const { data: ws } = await supabase.from('workspaces').select('sync_state').eq('id', user.workspaceId).single()
    const slack = ((ws as any)?.sync_state)?.slack
    if (!slack?.botToken || !slack?.channelId) return reply.status(400).send({ errors: [{ code: 'NOT_CONFIGURED' }] })

    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${slack.botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: slack.channelId,
          text: '✅ NextTrack is connected! Notifications will appear here.',
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: '✅ *NextTrack is connected!*\nBudget alerts, timesheet reminders, and weekly digests will appear in this channel.' } },
          ],
        }),
      })
      const data = await res.json() as any
      if (!data.ok) return reply.status(500).send({ errors: [{ message: data.error }] })
      return reply.status(200).send({ sent: true })
    } catch (e: any) {
      return reply.status(500).send({ errors: [{ message: e.message }] })
    }
  })

  app.delete('/slack/disconnect', async (req, reply) => {
    const user = (req as any).user
    const { data: ws } = await supabase.from('workspaces').select('sync_state').eq('id', user.workspaceId).single()
    const currentState = ((ws as any)?.sync_state) || {}
    const { slack: _, ...rest } = currentState
    await supabase.from('workspaces').update({ sync_state: rest }).eq('id', user.workspaceId)
    return reply.status(200).send({ data: { message: 'Disconnected' } })
  })
}

