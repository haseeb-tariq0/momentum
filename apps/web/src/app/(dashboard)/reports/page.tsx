'use client'
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useRouter } from 'next/navigation'
import { usersApi, projectsApi, timeApi, reportsApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { ArrowLeft, Star } from 'lucide-react'
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, subWeeks, addDays } from 'date-fns'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { api } from '@/lib/api'
import { downloadCSV, downloadXLSX, downloadPDF } from '@/lib/export'
import {
  PageHeader, StatCard, Card, Avatar, Badge, Button, EmptyState, Select,
  DatePicker, Combobox, Skeleton,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { todayLocalISO } from '@/lib/utils'
import { showToast } from '@/components/Toast'
import ActiveProjectsReport from './ActiveProjectsReport'
import ClientProfitabilityReport from './ClientProfitabilityReport'
import PartnerReport from './PartnerReport'
import PartnerBillingReport from './PartnerBillingReport'
import ReportsHome from './ReportsHome'
import { DateRangePicker } from './DateRangePicker'
import { ExportMenu } from './ExportMenu'
import { canSeeReport } from '@/lib/reportVisibility'

// Valid report-type slugs — matches the `?r=<slug>` URL param and the tab
// state.
//
// Phase 1 now ships 7 reports:
//   1. Time Registered
//   2. Utilization
//   3. Active Projects
//   4. Client Profitability
//   5. Compliance
//   6. Partner Report      — wired Apr 22 (was stub)
//   7. Partner Billing     — wired Apr 22 (was stub)
//
// The remaining 4 are Phase-2 scaffolds: they're present in routing +
// template gallery + tab strip so Murtaza's Apr 17 requirements stay
// tracked in code, but their tab bodies render a "coming in Phase 2"
// placeholder. The one previously-deleted report that stays gone is
// Cost of Effort — per Apr 17, its data is already inside Client
// Profitability, so the separate view was redundant.
const REPORT_SLUGS = [
  // Phase 1 — fully wired
  'time', 'utilization', 'active-projects', 'client-profitability', 'compliance',
  'partner-report', 'partner-billing',
  // Phase 2 scaffolds (admin-gated via canSeeReport)
  'pnl', 'task-report', 'project-progress', 'client-timesheet',
] as const
type ReportSlug = typeof REPORT_SLUGS[number]
const isValidSlug = (s: string | null): s is ReportSlug =>
  !!s && (REPORT_SLUGS as readonly string[]).includes(s)

// ── Helpers ────────────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  // Recharts tooltip: keep inline style — this renders inside the chart.
  //
  // The unit ("%" vs "h") is inferred from the SERIES NAME, not the value.
  // Previously we used `value<=100?'%':'h'` which mislabeled bar-chart hour
  // values (e.g. "40h logged" showed up as "40%" in the tooltip) and any
  // utilization >100% showed as "120h". Series with "(h)" or "Hours"/"Hrs"
  // in the name are hours; everything else is a percentage.
  return (
    <div style={{ background:'var(--bg-raised)',border:'1px solid var(--border-muted)',borderRadius:6,padding:'8px 12px',fontSize:12 }}>
      <div style={{ color:'var(--text-tertiary)',marginBottom:4,fontWeight:500 }}>{label}</div>
      {payload.map((p: any, i: number) => {
        const name = typeof p.name === 'string' ? p.name : ''
        const isHours = name.includes('(h)') || /hours?|hrs/i.test(name)
        const unit = isHours ? 'h' : '%'
        const val = p.value == null ? '—' : `${p.value}${unit}`
        return (
          <div key={i} style={{ color:p.color,fontVariantNumeric:'tabular-nums' }}>
            {p.name}: <strong>{val}</strong>
          </div>
        )
      })}
    </div>
  )
}

// ── Export dropdown moved to ./ExportMenu (shared by every report tab). ──

// ── MAIN PAGE ──────────────────────────────────────────────────────────────────
//
// Per Apr 17 call with Murtaza, /reports now has two modes:
//   1. HOME  (no ?r= param) → <ReportsHome /> — favorites + template gallery.
//   2. DETAIL (?r=<slug>)    → focused view of that one report type.
//
// The router splits on URL state rather than early-returning inside a single
// component — that way the home and detail views each get their own consistent
// Hook order (React Rules of Hooks forbid conditional hook counts).
export default function ReportsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const urlSlug = searchParams.get('r')
  const activeSlug: ReportSlug | null = isValidSlug(urlSlug) ? urlSlug : null

  // Strip dead ?r= params from the URL so bookmarks don't preserve them.
  // Without this, a bookmark to /reports?r=pnl (a slug we deleted Apr 21)
  // would keep that query string in the address bar forever, even though
  // the UI correctly falls through to the home grid. Clean it up on mount.
  useEffect(() => {
    if (urlSlug && !isValidSlug(urlSlug)) {
      router.replace('/reports', { scroll: false })
    }
  }, [urlSlug, router])

  if (!activeSlug) {
    return (
      <div className="px-7 py-6">
        <PageHeader title="Reports" />
        <ReportsHome />
      </div>
    )
  }

  // Reconciles rather than remounting on tab change. The `tab` derived from
  // `slug` is a prop, so switching tabs updates the URL, which re-renders
  // ReportsDetail with a new `slug` prop — filter state (trClient, utilDept,
  // etc.) persists across tabs because the component stays mounted. Earlier
  // we used `key={activeSlug}` to force a full remount, which made every tab
  // switch wipe state and refetch queries from scratch.
  return <ReportsDetail slug={activeSlug} />
}

// ── DETAIL VIEW ─────────────────────────────────────────────────────────────
// Renders a single report with the full filter/export toolbar. `slug` drives
// which tab body is active — it comes from the URL `?r=` param via the parent,
// so tab switches are URL updates. No local `tab` state: using the prop
// directly is what lets filter state (trClient, utilDept, etc.) persist
// across tab changes, because this component no longer unmounts on every tab.
function ReportsDetail({ slug }: { slug: ReportSlug }) {
  const { isAdmin, user } = useAuthStore()
  const searchParams = useSearchParams()
  const router = useRouter()
  const urlFrom = searchParams.get('from')
  const urlTo   = searchParams.get('to')
  const profile = user?.permissionProfile ?? null

  // Global date range — honors from/to URL params for favorite deep-links.
  const [dateFrom, setDateFrom] = useState(urlFrom || format(startOfMonth(new Date()),'yyyy-MM-dd'))
  const [dateTo,   setDateTo]   = useState(urlTo   || format(endOfMonth  (new Date()),'yyyy-MM-dd'))

  // Active tab reads directly from the URL slug — single source of truth.
  const tab = slug

  // Role gate: if a user URL-jumps to a report their role can't see
  // (e.g., collaborator opens /reports?r=pnl), bounce them back home.
  // Server-side endpoints also enforce this via isAdminRole() — this is
  // just the UI layer. Runs after profile is hydrated (not while null).
  useEffect(() => {
    if (profile && !canSeeReport(slug, profile)) {
      router.replace('/reports')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, slug])

  // Keep date state in sync if the URL changes (user clicks a different favorite, etc.)
  useEffect(() => {
    if (urlFrom && urlFrom !== dateFrom) setDateFrom(urlFrom)
    if (urlTo   && urlTo   !== dateTo)   setDateTo(urlTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFrom, urlTo])

  function selectTab(next: ReportSlug) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('r', next)
    router.replace(`/reports?${params.toString()}`, { scroll: false })
  }

  // Filters per report
  const [trPerson,  setTrPerson]  = useState('all')
  const [trProject, setTrProject] = useState('all')
  const [trClient,  setTrClient]  = useState('all')
  const [trBillable,setTrBillable]= useState('all')
  const [utilDept,  setUtilDept]  = useState('all')

  // Replay filters from URL params (prefixed `f_`) when a saved favorite is
  // opened. ReportsHome writes these via openReport(..., config.filters); we
  // read them once per slug change so switching tabs doesn't fight user input.
  // The filter keys here match what onSaveView() snapshots below.
  useEffect(() => {
    const fPerson   = searchParams.get('f_person')
    const fProject  = searchParams.get('f_project')
    const fClient   = searchParams.get('f_client')
    const fBillable = searchParams.get('f_billable')
    const fDept     = searchParams.get('f_department')
    if (fPerson)   setTrPerson(fPerson)
    if (fProject)  setTrProject(fProject)
    if (fClient)   setTrClient(fClient)
    if (fBillable) setTrBillable(fBillable)
    if (fDept)     setUtilDept(fDept)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // ── Save-view mutation ──────────────────────────────────────────────────────
  // Apr 17 spec (Murtaza, verbatim):
  //   "When they come for the first time, it will be blank. It will tell them
  //    to choose one of the templates. Then choosing that template, he will
  //    then save his report, and that will then be visible at the top where
  //    it is showing… So suppose that this will be Belkin. Then next to it
  //    will be Prague, next to it will be, let's say, Chris Jervin."
  //
  // The button lives in the tab strip header (next to "All Reports") so it's
  // visible no matter which report the user is on. We snapshot the current
  // filter state into the `config` JSON column, plus the URL date range.
  // Re-opening the favorite replays those filters via URL params + client-side
  // restore (date range today, other filters in a follow-up once the filter
  // state is URL-synced).
  const qc = useQueryClient()
  const saveMut = useMutation({
    mutationFn: (data: { name: string; report_type: string; config: any }) =>
      reportsApi.createConfig(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-configs'] })
      showToast('Saved to Your Reports', 'success')
    },
    onError: (err: any) => {
      const code = err?.response?.data?.errors?.[0]?.code
      const msg  = code === 'DUPLICATE_NAME'
        ? 'A saved report with that name already exists — pick a different name.'
        : (err?.response?.data?.errors?.[0]?.message || err?.message || 'Failed to save')
      showToast(msg, 'error')
    },
  })

  function onSaveView() {
    // Default name biases toward the active filter, so "Save" with a Belkin
    // client filter produces "Belkin — Time Registered" without typing.
    const labelMap: Record<string,string> = {
      'time':'Time Registered','utilization':'Utilization',
      'active-projects':'Active Projects','client-profitability':'Client Profitability',
      'compliance':'Compliance','partner-report':'Partner Report',
      'partner-billing':'Partner Billing','pnl':'P&L','task-report':'Task Report',
      'project-progress':'Project Progress','client-timesheet':'Client Timesheet',
    }
    const clientHint = trClient !== 'all' ? trClient : ''
    const defaultName = clientHint ? `${clientHint} — ${labelMap[slug] || slug}` : labelMap[slug] || slug
    const name = window.prompt('Name this report (shows in "Your Reports" on the home screen):', defaultName)
    if (!name) return
    const trimmed = name.trim()
    if (!trimmed) return

    // Per-report filter snapshot. Only capture filters that belong to this
    // report's tab — don't pollute the config with state from other tabs.
    const filters: Record<string, unknown> = {}
    if (slug === 'time') {
      if (trPerson   !== 'all') filters.person   = trPerson
      if (trProject  !== 'all') filters.project  = trProject
      if (trClient   !== 'all') filters.client   = trClient
      if (trBillable !== 'all') filters.billable = trBillable
    } else if (slug === 'utilization') {
      if (utilDept !== 'all') filters.department = utilDept
    } else if (slug === 'partner-report') {
      // Per Apr 17: save-view per partner is the whole point of the "Human
      // Magic Partner Report", "Pure Minds Partner Report" pattern. We reuse
      // trClient here as the selected-partner store — PartnerReport's
      // internal selector reads from the same f_client URL param on open.
      if (trClient !== 'all') filters.client = trClient
    }

    saveMut.mutate({
      name: trimmed,
      report_type: slug,
      config: { from: dateFrom, to: dateTo, filters },
    })
  }

  const prevWeekStart = format(subWeeks(startOfWeek(new Date(),{weekStartsOn:1}),1),'yyyy-MM-dd')

  // ── Data queries ────────────────────────────────────────────────────────────
  const { data: usersData }      = useQuery({ queryKey:['users'],        queryFn:()=>usersApi.list().then((r:any)=>r.data), enabled:isAdmin(), staleTime:60_000 })
  const { data: projectsData }   = useQuery({ queryKey:['projects-all'], queryFn:()=>projectsApi.list().then((r:any)=>r.data), staleTime:30_000 })
  const { data: complianceData } = useQuery({ queryKey:['compliance',prevWeekStart], queryFn:()=>usersApi.timesheetCompliance(prevWeekStart).then((r:any)=>r.data), enabled:isAdmin(), staleTime:30_000 })
  const { data: deptsData }      = useQuery({ queryKey:['departments'],  queryFn:()=>usersApi.departments().then((r:any)=>r.data), staleTime:60_000 })
  const { data: workspaceData }   = useQuery({ queryKey:['workspace'],    queryFn:()=>usersApi.workspace().then((r:any)=>r.data), staleTime:120_000 })

  // Holiday data for date range — used to compute actual net capacity per person
  const { data: holidayRangeData } = useQuery({
    queryKey: ['holidays-range', dateFrom, dateTo],
    queryFn:  () => api.get(`/users/holidays-range?from=${dateFrom}&to=${dateTo}`).then((r:any) => r.data),
    enabled:  isAdmin(),
    staleTime: 60_000,
  })

  // Time entries — flat records for the selected date range (Time Registered + Utilization)
  const { data: timeReportData, isLoading: timeLoading } = useQuery({
    queryKey: ['time-entries', dateFrom, dateTo],
    queryFn:  () => timeApi.entries({ from: dateFrom, to: dateTo }).then((r:any) => r.data),
    staleTime: 30_000,
  })

  const users      = usersData     || []
  const projects   = projectsData  || []
  const compliance = complianceData|| []
  const depts      = deptsData     || []
  const timeReport = timeReportData|| []
  const running    = projects.filter((p:any) => p.status === 'running')

  // ── Compliance stats ─────────────────────────────────────────────────────────
  const submitted = compliance.filter((u:any)=>u.submitted).length
  const missing   = compliance.filter((u:any)=>!u.submitted).length
  const compRate  = users.length>0 ? Math.round((submitted/Math.max(users.length,1))*100) : 0
  const totalCap  = compliance.reduce((s:number,u:any)=>s+Number(u.capacityHrs||0),0)  // net capacity from backend (holidays + leave deducted)
  const totalLogged2= compliance.reduce((s:number,u:any)=>s+(u.loggedHrs||0),0)
  const teamUtil  = totalCap>0 ? Math.round((totalLogged2/totalCap)*100) : 0

  // ── Time Registered filtering ────────────────────────────────────────────────
  const filteredTime = useMemo(()=>{
    let rows = [...timeReport]
    if (trPerson!=='all')  rows=rows.filter((r:any)=>r.user_id===trPerson)
    if (trProject!=='all') rows=rows.filter((r:any)=>r.project_id===trProject)
    if (trClient!=='all')  rows=rows.filter((r:any)=>r.client_name===trClient)
    if (trBillable!=='all') rows=rows.filter((r:any)=>trBillable==='billable'?r.billable:!r.billable)
    return rows
  },[timeReport,trPerson,trProject,trClient,trBillable])

  // Group time entries by project
  const timeByProject = useMemo(()=>{
    const groups: Record<string,any> = {}
    for (const entry of filteredTime as any[]) {
      const pid = entry.project_id || 'no-project'
      if (!groups[pid]) groups[pid] = { project_name: entry.project_name||'No Project', client_name: entry.client_name||'—', entries: [], totalHrs: 0 }
      groups[pid].entries.push(entry)
      groups[pid].totalHrs += Number(entry.hours||0)
    }
    return Object.values(groups).sort((a:any,b:any)=>b.totalHrs-a.totalHrs)
  },[filteredTime])

  const totalTimeHrs   = filteredTime.reduce((s:number,e:any)=>s+Number(e.hours||0),0)
  const billableHrs    = (filteredTime as any[]).filter((e:any)=>e.billable).reduce((s:number,e:any)=>s+Number(e.hours||0),0)
  const nonBillableHrs = totalTimeHrs - billableHrs

  // ── Utilization per person from time report ──────────────────────────────────
  const utilizationRows = useMemo(()=>{
    const byUser: Record<string,any> = {}
    for (const u of users as any[]) {
      byUser[u.id] = {
        id: u.id, name: u.name, dept: u.departments?.name||'—', job_title: u.job_title||'—',
        // capacity = (working days − public holidays) × daily rate
        capacity: (() => {
          const dailyRate = Number(u.capacity_hrs||40) / 5
          const s = new Date(dateFrom+'T12:00:00'), e2 = new Date(dateTo+'T12:00:00')
          let workDays = 0
          for (const d = new Date(s); d <= e2; d.setDate(d.getDate()+1)) {
            if (d.getDay()!==0 && d.getDay()!==6) workDays++
          }
          // Subtract public holidays for this person's calendar
          const calId     = u.holiday_calendar_id
          const calMap    = holidayRangeData?.calendarHolidays || {}
          const holDays   = calId ? (calMap[calId] || []).length : 0
          const grossCap  = Math.max(0, workDays - holDays) * dailyRate
          // Subtract approved time-off hours (type='time_off' entries in range)
          const leaveHrs  = holidayRangeData?.userTimeOffHrs?.[u.id] || 0
          return Math.round(Math.max(0, grossCap - leaveHrs) * 10) / 10
        })(),
        weeklyHrs:    Number(u.capacity_hrs||40),
        holidayCount: (() => {
          const calId  = u.holiday_calendar_id
          const calMap = holidayRangeData?.calendarHolidays || {}
          return calId ? (calMap[calId] || []).length : 0
        })(),
        leaveHrs: holidayRangeData?.userTimeOffHrs?.[u.id] || 0,
        logged: 0, billable: 0, nonBillable: 0,
        dept_id: u.department_id,
      }
    }
    for (const e of timeReport as any[]) {
      if (byUser[e.user_id]) {
        byUser[e.user_id].logged    += Number(e.hours||0)
        if (e.billable) byUser[e.user_id].billable    += Number(e.hours||0)
        else            byUser[e.user_id].nonBillable += Number(e.hours||0)
      }
    }
    return Object.values(byUser)
      .filter((u:any)=>utilDept==='all'||u.dept===utilDept)
      .map((u:any)=>({
        ...u,
        utilPct: u.capacity>0 ? Math.round((u.logged/u.capacity)*100) : 0,
        billPct: u.logged>0   ? Math.round((u.billable/u.logged)*100) : 0,
      }))
      .sort((a:any,b:any)=>b.utilPct-a.utilPct)
  },[timeReport,users,utilDept,dateFrom,dateTo,holidayRangeData])

  // 6-week trend — computed from actual time entries against combined team
  // capacity. Each point is (hours logged that week) / (sum of weekly
  // capacity_hrs across all users) × 100.
  //
  // Previously this used hardcoded demo numbers [68,74,71,79,83,77] for 5 of
  // 6 points and only the last point reflected reality — so any trend line
  // Murtaza looked at was fiction. Weeks with no data now render as null
  // (Recharts leaves a gap) rather than inventing numbers.
  //
  // Data availability caveat: timeReport is bounded by the selected dateFrom /
  // dateTo, so weeks outside the current range show as gaps. Default "This
  // Month" covers ~4 weeks, so the 2 oldest trend points are typically empty.
  const trendData = useMemo(() => {
    const weekly: { start: string; end: string; label: string }[] = []
    for (let i = 5; i >= 0; i--) {
      const ws = startOfWeek(subWeeks(new Date(), i), { weekStartsOn: 1 })
      const we = addDays(ws, 6)
      weekly.push({
        start: format(ws, 'yyyy-MM-dd'),
        end:   format(we, 'yyyy-MM-dd'),
        label: format(ws, 'MMM d'),
      })
    }
    const totalWeeklyCap = (users as any[]).reduce(
      (s, u) => s + Number(u.capacity_hrs || 40),
      0,
    )
    return weekly.map(w => {
      let logged = 0
      let billable = 0
      let hasAny = false
      for (const e of timeReport as any[]) {
        const d = e.date
        if (!d || d < w.start || d > w.end) continue
        hasAny = true
        const h = Number(e.hours || 0)
        logged += h
        if (e.billable) billable += h
      }
      return {
        week: w.label,
        utilization: hasAny && totalWeeklyCap > 0 ? Math.round((logged   / totalWeeklyCap) * 100) : null,
        billable:    hasAny && totalWeeklyCap > 0 ? Math.round((billable / totalWeeklyCap) * 100) : null,
      }
    })
  }, [timeReport, users])

  // Chart sources from utilizationRows so it respects the same dept filter as the table
  const teamChart = utilizationRows.slice(0,12).map((u:any)=>({
    name:     u.name?.split(' ')[0]||'',
    logged:   u.logged||0,
    capacity: u.capacity||40,
    pct:      u.utilPct||0,
  }))

  // ── Export helpers ───────────────────────────────────────────────────────────
  const timeHeaders     = ['Date','Project','Task','Phase','Person','Hours','Billable','Client','Note']
  const timeRows        = () => {
    const r = (filteredTime as any[]).map(e=>[e.date||'',e.project_name||'',e.task_title||'',e.phase_name||'',e.user_name||'',e.hours||0,e.billable?'Yes':'No',e.client_name||'',e.note||''])
    r.push(['','','','','TOTAL',totalTimeHrs.toFixed(1),'','',''])
    return r
  }
  const utilHeaders     = ['Person','Dept','Job Title','Gross Cap (h)','Holidays (d)','Leave (h)','Net Cap (h)','Logged (h)','Billable (h)','Non-Billable (h)','Util %','Billability %']
  const utilRows        = () => utilizationRows.map((u:any)=>{
    const grossCap = Math.round((u.capacity + (u.leaveHrs||0) + u.holidayCount*(u.weeklyHrs/5)) * 10) / 10
    return [u.name,u.dept,u.job_title,grossCap,u.holidayCount,u.leaveHrs||0,u.capacity,u.logged.toFixed(1),u.billable.toFixed(1),u.nonBillable.toFixed(1),u.utilPct+'%',u.billPct+'%']
  })
  const compHeaders     = ['Name','Department','Job Title','Capacity (h)','Logged (h)','Billable (h)','Non-Bill (h)','Days','Util %','Status']
  const compRows        = () => compliance.map((u:any)=>{const nb=(u.loggedHrs||0)-(u.billableHrs||0);const ut=u.capacityHrs>0?Math.round(((u.loggedHrs||0)/u.capacityHrs)*100):0;return[u.name,u.department,u.jobTitle,u.capacityHrs,u.loggedHrs||0,u.billableHrs||0,nb,u.daysLogged||0,ut+'%',u.submitted?'Submitted':'Missing']})
  const dateTag         = `${dateFrom}-to-${dateTo}`
  const today           = format(new Date(),'yyyy-MM-dd')

  // CSV
  function exportTimeCSV()       { downloadCSV(`Time-Registered-${dateTag}.csv`, timeHeaders, timeRows()) }
  function exportUtilCSV()       { downloadCSV(`Utilization-${dateTag}.csv`, utilHeaders, utilRows()) }
  function exportComplianceCSV() { downloadCSV(`Compliance-${today}.csv`, compHeaders, compRows()) }

  // Excel
  async function exportTimeXLSX() {
    await downloadXLSX(`Time-Registered-${dateTag}.xlsx`, timeHeaders, timeRows(), 'Time Registered')
  }
  async function exportUtilXLSX() {
    await downloadXLSX(`Utilization-${dateTag}.xlsx`, utilHeaders, utilRows(), 'Utilization')
  }
  async function exportComplianceXLSX() {
    await downloadXLSX(`Compliance-${today}.xlsx`, compHeaders, compRows(), 'Compliance')
  }

  // PDF
  async function exportTimePDF() {
    await downloadPDF(`Time-Registered-${dateTag}.pdf`, 'Time Registered', `${dateFrom}  →  ${dateTo}`, timeHeaders, timeRows(), [
      { label:'Total Hours',    value:`${totalTimeHrs.toFixed(1)}h` },
      { label:'Billable',       value:`${billableHrs.toFixed(1)}h` },
      { label:'Non-Billable',   value:`${nonBillableHrs.toFixed(1)}h` },
      { label:'Billability',    value:`${totalTimeHrs>0?Math.round(billableHrs/totalTimeHrs*100):0}%` },
    ])
  }
  async function exportUtilPDF() {
    const totalLeaveHrs = utilizationRows.reduce((s:number,u:any)=>s+(u.leaveHrs||0),0)
    await downloadPDF(`Utilization-${dateTag}.pdf`, 'Utilization Report', `${dateFrom}  →  ${dateTo}`, utilHeaders, utilRows(), [
      { label:'Team Members',   value:String(utilizationRows.length) },
      { label:'Total Logged',   value:`${utilizationRows.reduce((s:number,u:any)=>s+u.logged,0).toFixed(1)}h` },
      { label:'Avg Utilization',value:`${utilizationRows.length>0?Math.round(utilizationRows.reduce((s:number,u:any)=>s+u.utilPct,0)/utilizationRows.length):0}%` },
      { label:'Leave Taken',    value:`${totalLeaveHrs.toFixed(1)}h` },
    ])
  }
  async function exportCompliancePDF() {
    await downloadPDF(`Compliance-${today}.pdf`, 'Timesheet Compliance', `Week starting ${prevWeekStart}`, compHeaders, compRows(), [
      { label:'Submitted',      value:`${submitted}/${users.length}` },
      { label:'Compliance Rate',value:`${compRate}%` },
      { label:'Team Util',      value:`${teamUtil}%` },
    ])
  }

  // ── Tabs config ──────────────────────────────────────────────────────────────
  // Phase 1 (fully functional) ships 7 reports: the original baseline 5
  // plus Partner Report + Partner Billing (wired Apr 22). The remaining 4
  // are Phase 2 scaffolds — admin-only via canSeeReport(), render a
  // placeholder body. See reportVisibility.ts for the source-of-truth list.
  const ALL_TABS = [
    { key:'time',                 label:'Time Registered' },
    { key:'utilization',          label:'Utilization' },
    { key:'active-projects',      label:'Active Projects' },
    { key:'client-profitability', label:'Client Profitability' },
    { key:'compliance',           label:'Compliance' },
    { key:'partner-report',       label:'Partner Report' },
    { key:'partner-billing',      label:'Partner Billing' },
    // Phase 2 scaffolds — admin-only, placeholder bodies
    { key:'pnl',                  label:'P&L' },
    { key:'task-report',          label:'Task Report' },
    { key:'project-progress',     label:'Project Progress' },
    { key:'client-timesheet',     label:'Client Timesheet' },
  ] as const

  // Filter the tab strip to only show reports the current user's role can
  // access. Matches the 3-tier spec from the Apr 17 call (see reportVisibility.ts).
  const TABS = ALL_TABS.filter(t => canSeeReport(t.key as ReportSlug, profile))

  // ── Resolve active utilisation targets (dept override → workspace default) ──
  const wsResourceTarget  = workspaceData?.resource_utilization_pct  ?? 80
  const wsBillableTarget  = workspaceData?.billable_utilization_pct  ?? 80
  const activeDeptData    = utilDept !== 'all' ? (depts as any[]).find((d:any) => d.name === utilDept) : null
  const activeResourceTgt = activeDeptData?.resource_utilization_pct ?? wsResourceTarget
  const activeBillableTgt = activeDeptData?.billable_utilization_pct ?? wsBillableTarget

  // ── Util % color — relative to active department target ──────────────────────
  // Returns a CSS var string (used for runtime dynamic bar/label colors)
  function utilColor(pct: number, target = activeResourceTgt) {
    if (pct >= target + 20) return 'var(--rose)'    // over capacity
    if (pct >= target)      return 'var(--accent)'    // on target
    if (pct >= target - 20) return 'var(--amber)'   // below target but close
    return 'var(--violet)'                          // low
  }
  function utilLabel(pct: number, target = activeResourceTgt) {
    if (pct >= target + 20) return 'Over Capacity'
    if (pct >= target)      return 'On Target'
    if (pct >= target - 20) return 'Below Target'
    return 'Low'
  }
  // Badge variant from utilisation pct → design system tone
  function utilBadgeVariant(pct: number, target = activeResourceTgt): 'danger' | 'success' | 'warning' | 'violet' {
    if (pct >= target + 20) return 'danger'
    if (pct >= target)      return 'success'
    if (pct >= target - 20) return 'warning'
    return 'violet'
  }
  // Text color class from utilisation pct
  function utilTextClass(pct: number, target = activeResourceTgt) {
    if (pct >= target + 20) return 'text-status-rose'
    if (pct >= target)      return 'text-accent'
    if (pct >= target - 20) return 'text-status-amber'
    return 'text-status-violet'
  }

  return (
    <div className="px-7 py-6">
      <PageHeader title="Reports" />

      {/* Tabs + back-to-home on one row — uses horizontal space, saves vertical */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex gap-1 p-0.5 bg-surface-raised border border-line-subtle rounded-md overflow-x-auto w-fit max-w-full">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => selectTab(t.key as ReportSlug)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors duration-150 cursor-pointer whitespace-nowrap',
                tab === t.key
                  ? 'bg-accent-dim text-accent'
                  : 'text-secondary hover:text-primary hover:bg-surface-hover',
              )}
              aria-pressed={tab === t.key}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Save view — snapshots the active filters + date range as a named
              favorite. Lands in "Your Reports" on the home. Per Apr 17 spec,
              this is how a user builds Belkin-specific or Pure-Minds-specific
              variants of the base templates. */}
          <button
            onClick={onSaveView}
            disabled={saveMut.isPending}
            className="inline-flex items-center gap-1 text-xs font-semibold text-accent bg-accent-dim hover:bg-accent-dim/70 px-2.5 py-1 rounded border border-line-accent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title="Save this view (filters + date range) to Your Reports"
          >
            <Star size={12} /> Save view
          </button>
          <button
            onClick={() => router.push('/reports')}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary bg-transparent border-0 cursor-pointer"
          >
            <ArrowLeft size={12} /> All Reports
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB 1 — TIME REGISTERED                                               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab==='time' && (
        <div>
          {/* Filter bar with Export inline. Section title + description removed —
              the tab already says "Time Registered" and the description was fluff.
              Dropdowns first (Client → Project → Person → Billable), then date
              picker, then Reset, then Export pushed right. */}
          <div className="flex items-center gap-2 flex-wrap mb-3.5">
            <div className="w-[180px]">
              <Combobox
                size="sm"
                value={trClient}
                onChange={v => setTrClient((v as string) || 'all')}
                options={[
                  { value: 'all', label: 'All Clients' },
                  ...[...new Set((running as any[]).map(p => p.clients?.name).filter(Boolean))].map((c: any) => ({
                    value: c as string,
                    label: c as string,
                  })),
                ]}
                placeholder="All Clients"
                searchPlaceholder="Search clients…"
                aria-label="Filter by client"
              />
            </div>
            <div className="w-[200px]">
              <Combobox
                size="sm"
                value={trProject}
                onChange={v => setTrProject((v as string) || 'all')}
                options={[
                  { value: 'all', label: 'All Projects' },
                  ...running.map((p: any) => ({
                    value: p.id as string,
                    label: p.name,
                    description: p.clients?.name || undefined,
                  })),
                ]}
                placeholder="All Projects"
                searchPlaceholder="Search projects…"
                aria-label="Filter by project"
              />
            </div>
            <div className="w-[180px]">
              <Combobox
                size="sm"
                value={trPerson}
                onChange={v => setTrPerson((v as string) || 'all')}
                options={[
                  { value: 'all', label: 'All People' },
                  ...users.map((u: any) => ({
                    value: u.id as string,
                    label: u.name,
                    description: u.job_title || undefined,
                  })),
                ]}
                placeholder="All People"
                searchPlaceholder="Search people…"
                aria-label="Filter by person"
              />
            </div>
            <Select size="sm" value={trBillable} onChange={e=>setTrBillable(e.target.value)} className="w-auto min-w-[130px]" aria-label="Filter by billable">
              <option value="all">All Entries</option>
              <option value="billable">Billable Only</option>
              <option value="non-billable">Non-Billable Only</option>
            </Select>
            <div className="w-px h-6 bg-line-subtle" />
            <DateRangePicker from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
            {(trClient !== 'all' || trProject !== 'all' || trPerson !== 'all' || trBillable !== 'all') && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setTrClient('all'); setTrProject('all'); setTrPerson('all'); setTrBillable('all') }}
              >
                Reset
              </Button>
            )}
            <div className="ml-auto">
              <ExportMenu onCSV={exportTimeCSV} onExcel={exportTimeXLSX} onPDF={exportTimePDF} />
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-3.5">
            <StatCard label="Total Hours"    value={`${totalTimeHrs.toFixed(1)}h`}     sub={`${dateFrom} → ${dateTo}`} />
            <StatCard label="Billable Hours" value={`${billableHrs.toFixed(1)}h`}      sub={totalTimeHrs>0?`${Math.round(billableHrs/totalTimeHrs*100)}% of total`:'—'} tone="accent" />
            <StatCard label="Non-Billable"   value={`${nonBillableHrs.toFixed(1)}h`}   sub={totalTimeHrs>0?`${Math.round(nonBillableHrs/totalTimeHrs*100)}% of total`:'—'} />
            <StatCard label="Projects Active" value={timeByProject.length}             sub={`${users.length} people logging`} />
          </div>

          {/* Project-grouped table */}
          {timeLoading && (
            <div className="space-y-2" aria-label="Loading time entries">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-3">
                {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="h-20 rounded-lg" />))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (<Skeleton key={i} className="h-12 rounded-md" />))}
            </div>
          )}
          {!timeLoading && timeReport.length===0 && (
            <Card>
              <EmptyState
                title="No time entries found"
                description="Try a different date range or check that the time service is running."
              />
            </Card>
          )}
          {!timeLoading && timeReport.length>0 && (
            <div className="flex flex-col gap-2">
              {timeByProject.map((group:any,gi:number)=>(
                <ProjectTimeGroup key={gi} group={group} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB 2 — UTILIZATION                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab==='utilization' && (
        <div>
          {/* Filter bar — department dropdown first, date picker, Export right. */}
          <div className="flex items-center gap-3 flex-wrap mb-3.5">
            <Select size="sm" value={utilDept} onChange={e=>setUtilDept(e.target.value)} className="w-auto min-w-[160px]" aria-label="Filter by department">
              <option value="all">All Departments</option>
              {depts.map((d:any)=><option key={d.id} value={d.name}>{d.name}</option>)}
            </Select>
            <div className="w-px h-6 bg-line-subtle" />
            <DateRangePicker from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
            <div className="ml-auto">
              <ExportMenu onCSV={exportUtilCSV} onExcel={exportUtilXLSX} onPDF={exportUtilPDF} />
            </div>
          </div>

          {/* Active target indicator */}
          {activeDeptData && (
            <div className="mb-2.5 px-3 py-1.5 bg-accent-dim border border-line-accent rounded text-sm text-accent flex items-center gap-2">
              <span className="font-semibold">{activeDeptData.name} targets:</span>
              <span>Resource {activeResourceTgt}%</span>
              <span className="text-line-muted">·</span>
              <span>Billable {activeBillableTgt}%</span>
              {activeDeptData.resource_utilization_pct === null && activeDeptData.resource_utilization_pct === undefined && (
                <span className="text-muted text-xs">(using workspace defaults)</span>
              )}
            </div>
          )}

          {/* KPI row — trimmed from 6 to 4 per Apr 21 review. The 4 kept
              are the most actionable: team size for context, avg util +
              over-target for capacity, and avg billability for revenue
              health. "Below Target" dropped (less urgent than over-target —
              slack capacity is a scheduling problem, not a burnout risk) and
              "Total Billable" in hours dropped (redundant with the
              billability %, which is already normalised against total). */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3.5">
            <StatCard label="Team Members" value={utilizationRows.length} sub={utilDept==='all'?'whole team':`in ${activeDeptData?.name||utilDept}`} />
            <StatCard label="Avg Utilization" value={utilizationRows.length?Math.round(utilizationRows.reduce((s:number,u:any)=>s+u.utilPct,0)/utilizationRows.length)+'%':'—'} tone="accent" sub={`target: ${activeResourceTgt}%`} />
            <StatCard label="Over Target" value={utilizationRows.filter((u:any)=>u.utilPct>=activeResourceTgt+20).length} tone="rose" sub="at risk of burnout" />
            <StatCard label="Avg Billability" value={utilizationRows.length?Math.round(utilizationRows.reduce((s:number,u:any)=>s+u.billPct,0)/utilizationRows.length)+'%':'—'} tone="violet" sub={`target: ${activeBillableTgt}%`} />
          </div>

          {/* Per-person table */}
          <Card className="overflow-x-auto p-0 mb-3.5">
            <div
              className="grid px-4 py-2 bg-surface border-b border-line-subtle"
              style={{ gridTemplateColumns: 'minmax(0,1.6fr) 120px 130px 80px 80px 80px 80px 90px 100px' }}
            >
              {['Person','Department','Job Title','Capacity','Logged','Billable','Non-Bill','Util %','Status'].map(h=>(
                <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
              ))}
            </div>
            {utilizationRows.length===0 && (
              <div className="p-6 text-center text-base text-muted">
                {timeLoading ? 'Loading utilization data…' : 'No data for selected period.'}
              </div>
            )}
            {utilizationRows.map((u:any,i:number)=>{
              const uc = utilColor(u.utilPct)
              const ul = utilLabel(u.utilPct)
              const variant = utilBadgeVariant(u.utilPct)
              const textCls = utilTextClass(u.utilPct)
              return (
                <div
                  key={u.id}
                  className={cn(
                    'grid px-4 py-2.5 items-center',
                    i < utilizationRows.length-1 && 'border-b border-line-subtle',
                    // Row highlight on over/under capacity — was 0.015 alpha
                    // which is literally invisible; 0.05 is subtle but actually
                    // readable against the surface colour.
                    u.utilPct > 90 && 'bg-[rgba(244,63,94,0.05)]',
                    u.utilPct < 60 && u.utilPct > 0 && 'bg-[rgba(139,92,246,0.05)]',
                  )}
                  style={{ gridTemplateColumns: 'minmax(0,1.6fr) 120px 130px 80px 80px 80px 80px 90px 100px' }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar name={u.name || '?'} size="md" />
                    <span className="text-base font-medium text-primary truncate">{u.name}</span>
                  </div>
                  <div className="text-sm text-secondary">{u.dept}</div>
                  <div className="text-xs text-muted truncate">{u.job_title}</div>
                  <div className="tabular-nums">
                    <div className="text-sm text-secondary">{u.capacity}h</div>
                    {u.holidayCount>0 && <div className="text-[9px] text-status-amber mt-px">−{u.holidayCount}d holiday</div>}
                    {u.leaveHrs>0    && <div className="text-[9px] text-status-violet mt-px">−{u.leaveHrs}h leave</div>}
                  </div>
                  <div className={cn('text-sm tabular-nums', u.logged>0 ? 'font-semibold text-primary' : 'text-muted')}>{u.logged>0?`${u.logged.toFixed(1)}h`:'—'}</div>
                  <div className="text-sm text-accent tabular-nums">{u.billable>0?`${u.billable.toFixed(1)}h`:'—'}</div>
                  <div className="text-sm text-secondary tabular-nums">{u.nonBillable>0?`${u.nonBillable.toFixed(1)}h`:'—'}</div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1 bg-surface-overlay rounded-sm overflow-hidden max-w-[40px]">
                      <div className="h-full rounded-sm" style={{ width:`${Math.min(u.utilPct,100)}%`, background: uc }} />
                    </div>
                    <span className={cn('text-sm font-bold tabular-nums min-w-[32px]', textCls)}>{u.utilPct}%</span>
                  </div>
                  <div><Badge variant={variant}>{ul}</Badge></div>
                </div>
              )
            })}
          </Card>

          {/* 6-week trend chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            <Card className="px-4 py-4">
              <div className="text-base font-semibold text-primary mb-3.5">6-Week Trend</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={trendData} margin={{top:4,right:8,bottom:0,left:-28}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="week" tick={{fill:'var(--text-tertiary)',fontSize:11}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text-tertiary)',fontSize:11}} axisLine={false} tickLine={false} domain={[0,100]} />
                  <Tooltip content={<ChartTip/>} />
                  <Line type="monotone" dataKey="utilization" name="Total" stroke="var(--accent)" strokeWidth={2.5} dot={{fill:'var(--accent)',r:4,strokeWidth:0}} />
                  <Line type="monotone" dataKey="billable" name="Billable" stroke="var(--violet)" strokeWidth={2} dot={{fill:'var(--violet)',r:3,strokeWidth:0}} strokeDasharray="5 3" />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card className="px-4 py-4">
              {/* Title used to say "Previous Week" regardless of the selected
                  range — silently wrong when user picked Last Month or a
                  quarter. Now reflects the active range via a subtle caption. */}
              <div className="mb-3.5">
                <div className="text-base font-semibold text-primary">Team Hours</div>
                <div className="text-[11px] text-muted mt-0.5">{dateFrom} → {dateTo}</div>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={teamChart} margin={{top:0,right:0,bottom:0,left:-28}} barSize={18}>
                  <XAxis dataKey="name" tick={{fill:'var(--text-tertiary)',fontSize:11}} axisLine={false} tickLine={false} />
                  <YAxis tick={{fill:'var(--text-tertiary)',fontSize:11}} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip/>} cursor={{fill:'var(--bg-hover)'}} />
                  <Bar dataKey="logged" name="Logged (h)" radius={[3,3,0,0]}>
                    {teamChart.map((u:any,i:number)=>(
                      <Cell key={i} fill={u.pct>=100?'var(--rose)':u.pct>=80?'var(--amber)':u.pct>0?'var(--accent)':'var(--bg-overlay)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB — ACTIVE PROJECTS                                                 */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab==='active-projects' && (
        <ActiveProjectsReport
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB — COMPLIANCE                                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab==='compliance' && (
        <div>
          {/* Export right-aligned with a subtle week anchor on the left so users
              still know which week's compliance they're looking at. */}
          <div className="flex items-center justify-between mb-3.5">
            <div className="text-xs text-muted">
              Week of {format(new Date(prevWeekStart),'MMMM d, yyyy')}
            </div>
            <ExportMenu onCSV={exportComplianceCSV} onExcel={exportComplianceXLSX} onPDF={exportCompliancePDF} />
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-3.5">
            <StatCard label="Submitted"   value={submitted}  tone="accent" sub={`of ${users.length} members (${compRate}%)`} />
            <StatCard label="Missing"     value={missing}    tone="rose" sub="timesheets not submitted" />
            <StatCard label="Team Util"   value={`${teamUtil}%`} tone={teamUtil>=80?'accent':'amber'} sub={`${totalLogged2}h of ${totalCap}h capacity`} />
            <StatCard label="Avg Billability" value={totalLogged2>0?`${Math.round((compliance.reduce((s:number,u:any)=>s+(u.billableHrs||0),0)/totalLogged2)*100)}%`:'—'} tone="accent" sub="billable / total logged" />
          </div>
          <Card className="overflow-x-auto p-0">
            <div
              className="grid px-4 py-2 bg-surface border-b border-line-subtle"
              style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) 80px 80px 80px 80px' }}
            >
              {['Name','Department','Job Title','Capacity','Logged','Billable','Status'].map(h=>(
                <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
              ))}
            </div>
            {compliance.length===0 && <div className="p-6 text-center text-base text-muted">Loading…</div>}
            {compliance.map((u:any,i:number)=>{
              const complianceVariant: 'success' | 'danger' = u.submitted ? 'success' : 'danger'
              return (
                <div
                  key={u.id}
                  className={cn(
                    'grid px-4 py-2.5 items-center',
                    i < compliance.length-1 && 'border-b border-line-subtle',
                    !u.submitted && 'bg-[rgba(244,63,94,0.05)]',
                  )}
                  style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) 80px 80px 80px 80px' }}
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={u.name || '?'} size="md" />
                    <span className="text-base font-medium text-primary truncate">{u.name}</span>
                  </div>
                  <div className="text-sm text-secondary">{u.department}</div>
                  <div className="text-sm text-secondary truncate">{u.jobTitle}</div>
                  <div className="text-sm text-secondary tabular-nums">{u.capacityHrs}h</div>
                  <div className={cn('text-sm tabular-nums', u.loggedHrs>0 ? 'font-semibold text-primary' : 'text-muted')}>{u.loggedHrs>0?`${u.loggedHrs}h`:'—'}</div>
                  <div className={cn('text-sm tabular-nums', u.billableHrs>0 ? 'text-accent' : 'text-muted')}>{u.billableHrs>0?`${u.billableHrs}h`:'—'}</div>
                  <div><Badge variant={complianceVariant}>{u.submitted?'✓ Done':'Missing'}</Badge></div>
                </div>
              )
            })}
          </Card>
          {missing>0 && (
            <div className="mt-2.5 px-3.5 py-2.5 bg-status-rose-dim border border-[rgba(244,63,94,0.2)] rounded text-base text-status-rose">
              {missing} member{missing>1?'s':''} missing timesheets from last week.
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB — CLIENT PROFITABILITY                                            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab==='client-profitability' && <ClientProfitabilityReport dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />}

      {/* ── Phase 2 scaffolds ──────────────────────────────────────────── */}
      {/* Admin-only via canSeeReport(). Placeholder bodies capture the    */}
      {/* Apr 17 meeting requirements so the implementation brief is in-   */}
      {/* code when we get to Phase 2.                                     */}

      {tab==='partner-report' && (
        <PartnerReport
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          initialClientId={trClient !== 'all' ? trClient : undefined}
        />
      )}

      {tab==='partner-billing' && (
        <PartnerBillingReport
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
      )}

      {tab==='pnl' && (
        <Phase2Stub
          title="P&L Report"
          intro='Parked for Phase 2 per Murtaza: "let it be phase two". The P&L currently lives on a separate Google Sheet that is already linked to the Finance Sheet, and that system stays as-is for Phase 1.'
          requirements={[
            'Confidential data — visible only to super_admin + partners (not general admins)',
            'Sourced from the existing Google Sheet P&L; do NOT copy the data into the app database',
            'In-app view should either embed or link out to the existing sheet',
            'No work in Phase 1 — this is a Phase 2 deliverable after the migration stabilises',
          ]}
        />
      )}

      {tab==='task-report' && (
        <Phase2Stub
          title="Task Report"
          intro="Forecast's Task Report equivalent — task-level breakdown of logged hours. Same underlying data as Time Registered, but grouped by task with task-specific filters and columns."
          requirements={[
            "Parity with Forecast's 'Task Report' template (one of its 4 core report types)",
            'Group time entries by task; show task title, phase, project, client, total hours, billable hours, assignees',
            'Template-based like Partner Report: user saves per-task-set variants',
            'Filters: client, project, phase, task status, assignee, date range',
            'Export to CSV / Excel / PDF',
          ]}
        />
      )}

      {tab==='project-progress' && (
        <Phase2Stub
          title="Project Progress"
          intro="Progress-vs-budget view per project. Distinct from Active Projects (which is the live pipeline / expiry view) — this one focuses on how much of each project's estimated effort has been consumed."
          requirements={[
            'For each project: estimated hours (sum of task estimates), logged hours, remaining, % complete',
            'Status breakdown by phase and task',
            'Budget consumption: budget_amount vs. cost of effort so far',
            'Color-coded alerts at the 70% / 80% / 90% thresholds we already track on projects',
            'Filters: client, project status, budget type, date range',
          ]}
        />
      )}

      {tab==='client-timesheet' && (
        <Phase2Stub
          title="Client Timesheet"
          intro="Client-facing view of time entries against their projects. Was not explicitly scoped in the Apr 17 meeting — requirements to be refined before implementation."
          requirements={[
            'Needs scoping with Murtaza before build',
            'Likely shape: per-client timesheet showing billable hours by person + task for the selected month',
            'Should align with how invoices are presented to clients (from Finance Sheet)',
            'Access model TBD — possibly shareable via an external link (similar to the Active Projects external-link idea Murtaza floated)',
          ]}
        />
      )}
    </div>
  )
}

// ── Phase 2 placeholder body ─────────────────────────────────────────────────────
// Rendered for any Phase-2 scaffolded report. Surfaces the Apr 17 meeting
// requirements so engineers working on Phase 2 have the brief inline with
// the code. Visible to super_admin + admin only (enforced in canSeeReport).
function Phase2Stub({
  title,
  intro,
  requirements,
}: {
  title: string
  intro: string
  requirements: string[]
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-3 mb-4">
        <Badge variant="warning">Phase 2</Badge>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-primary">{title}</h2>
          <p className="text-sm text-secondary mt-1 leading-relaxed">{intro}</p>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-line-subtle">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
          Requirements (from Apr 17 meeting)
        </div>
        <ul className="space-y-1.5">
          {requirements.map((r, i) => (
            <li key={i} className="text-sm text-secondary flex gap-2">
              <span className="text-muted flex-shrink-0 mt-0.5">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 text-xs text-muted">
        This tab is a scaffold. The report will be implemented in Phase 2 — its
        presence here keeps the requirements tracked in code and the routing
        reserved so future work doesn't re-derive the spec.
      </div>
    </Card>
  )
}

// ── Project Time Group (used in Time Registered tab) ─────────────────────────
function ProjectTimeGroup({ group }: { group: any }) {
  const [open, setOpen] = useState(true)

  // Group entries by task
  const byTask: Record<string,any> = {}
  for (const e of group.entries||[]) {
    const key = e.task_id||'no-task'
    if (!byTask[key]) byTask[key] = { task_title:e.task_title||'No Task', entries:[], totalHrs:0 }
    byTask[key].entries.push(e)
    byTask[key].totalHrs+=Number(e.hours||0)
  }
  const tasks = Object.values(byTask).sort((a:any,b:any)=>b.totalHrs-a.totalHrs)
  const billable = (group.entries||[]).filter((e:any)=>e.billable).reduce((s:number,e:any)=>s+Number(e.hours||0),0)

  return (
    <Card className="overflow-x-auto p-0">
      {/* Project header */}
      <div
        onClick={()=>setOpen(o=>!o)}
        className={cn(
          'px-4 py-2.5 bg-surface cursor-pointer flex items-center justify-between hover:bg-surface-hover',
          open && 'border-b border-line-subtle',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm text-muted font-semibold">{open?'▾':'▸'}</span>
          <div>
            <span className="text-base font-bold text-primary">{group.project_name}</span>
            <span className="ml-2 text-xs text-muted">{group.client_name}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="success">{billable.toFixed(1)}h billable</Badge>
          <span className="text-lg font-bold text-primary tabular-nums">{group.totalHrs.toFixed(1)}h</span>
        </div>
      </div>

      {open && (
        <div>
          {/* Column headers */}
          <div
            className="grid px-4 py-1.5 bg-surface border-b border-line-subtle"
            style={{ gridTemplateColumns: 'minmax(0,1.4fr) 160px 120px 80px 80px' }}
          >
            {['Task','Person','Date','Hours','Billable'].map(h=>(
              <div key={h} className="text-[9px] font-bold uppercase tracking-wider text-muted">{h}</div>
            ))}
          </div>
          {tasks.map((task:any,ti:number)=>(
            <div key={ti}>
              {/* Task sub-header appears only when a project has multiple tasks.
                  Background was 0.01 alpha (invisible); now 0.03 for a readable
                  visual separation without shouting. */}
              {tasks.length>1 && (
                <div className="px-4 pt-1.5 pb-1 bg-[rgba(0,0,0,0.03)] border-b border-line-subtle">
                  <span className="text-xs font-semibold text-secondary">{task.task_title}</span>
                  <span className="ml-2 text-xs text-muted">{task.totalHrs.toFixed(1)}h</span>
                </div>
              )}
              {task.entries.map((entry:any,ei:number)=>(
                <div
                  key={ei}
                  className={cn(
                    'grid px-4 py-2 items-center hover:bg-surface-hover',
                    // Zebra stripe on odd rows. 0.008 alpha was invisible on
                    // every display I tested; removing the stripe entirely
                    // since the row border already separates entries.
                    ei < task.entries.length-1 && 'border-b border-line-subtle',
                  )}
                  style={{ gridTemplateColumns: 'minmax(0,1.4fr) 160px 120px 80px 80px' }}
                >
                  <div className={cn('text-sm text-secondary', tasks.length>1 && 'pl-2')}>{entry.task_title||'—'}</div>
                  <div className="flex items-center gap-1.5">
                    <Avatar name={entry.user_name || '?'} size="sm" />
                    <span className="text-sm text-secondary">{entry.user_name||'—'}</span>
                  </div>
                  <div className="text-sm text-muted">{entry.date?format(new Date(entry.date),'d MMM yyyy'):'—'}</div>
                  <div className="text-sm font-semibold text-primary tabular-nums">{Number(entry.hours||0).toFixed(1)}h</div>
                  <div>
                    <Badge variant={entry.billable ? 'success' : 'default'}>{entry.billable?'Bill':'Non-bill'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
