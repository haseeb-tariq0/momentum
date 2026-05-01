'use client'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '@/lib/queries'
import { exportToSheet } from '@/lib/exportToSheet'
import { useAuthStore } from '@/lib/store'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Card, StatCard, Badge, EmptyState, Select, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { downloadCSV, downloadXLSX, downloadPDF } from '@/lib/export'
import { showToast } from '@/components/Toast'
import { ExportMenu } from './ExportMenu'
import { ColumnToggleMenu } from './ColumnToggleMenu'
import { ReportSkeleton } from './ReportSkeleton'
import { DateRangePicker } from './DateRangePicker'

type SortKey = string

const ALL_COLUMNS = [
  { key: 'name',           label: 'Project',        default: true },
  { key: 'client',         label: 'Client',          default: true },
  { key: 'status',         label: 'Status',          default: true },
  { key: 'startDate',      label: 'Start Date',      default: true },
  { key: 'endDate',        label: 'End Date',        default: true },
  { key: 'daysRemaining',  label: 'Days Remaining',  default: true },
  { key: 'expiryStatus',   label: 'Expiry',          default: true },
  { key: 'budgetType',     label: 'Budget Type',     default: true },
  { key: 'budgetAmount',   label: 'Budget',          default: false },
  { key: 'currency',       label: 'Currency',        default: false },
  { key: 'estimatedHrs',   label: 'Estimated Hrs',   default: true },
  { key: 'loggedHrs',      label: 'Logged Hrs',      default: true },
  { key: 'hrsBurnPct',     label: 'Hrs Burn %',      default: true },
]

function expiryBadge(s: string) {
  if (s === 'expired')       return <Badge variant="danger">Expired</Badge>
  if (s === 'expiring_30d')  return <Badge variant="warning">Expiring 30d</Badge>
  if (s === 'expiring_60d')  return <Badge variant="violet">Expiring 60d</Badge>
  if (s === 'expiring_90d')  return <Badge variant="default">Expiring 90d</Badge>
  return <Badge variant="success">Active</Badge>
}

// Props — Active Projects now accepts a date range from the parent, same as
// every other report tab. Required so the Reports page's shared dateFrom/
// dateTo state drives this tab too, which means saved favorites and URL
// ?from=&to= params apply here the same way they do for Time Registered etc.
interface Props {
  dateFrom:        string
  dateTo:          string
  onDateFromChange:(v: string) => void
  onDateToChange:  (v: string) => void
}

export default function ActiveProjectsReport({ dateFrom, dateTo, onDateFromChange, onDateToChange }: Props) {
  const { isAdmin } = useAuthStore()
  const { data: raw, isLoading } = useQuery({
    queryKey: ['report-active-projects'],
    queryFn: () => reportsApi.activeProjects().then((r: any) => r.data),
    enabled: isAdmin(),
    staleTime: 30_000,
  })

  const projects: any[] = raw || []

  const [statusFilter, setStatusFilter] = useState('all')
  const [expiryFilter, setExpiryFilter] = useState('all')
  const [budgetFilter, setBudgetFilter] = useState('all')
  const [labelFilter,  setLabelFilter]  = useState('all')
  const [sortKey, setSortKey]     = useState<SortKey>('daysRemaining')
  const [sortAsc, setSortAsc]     = useState(true)
  const [visibleCols, setVisibleCols] = useState(() => new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.key)))

  // Collect unique labels across all projects for the category dropdown
  const allLabels = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color?: string }>()
    for (const p of projects) {
      for (const l of (p.labels || [])) if (l?.id) map.set(l.id, l)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [projects])

  // ── TABLE rows: apply every filter (date range + status + expiry + budget + labels).
  // This is what the user sees in the list and exports via CSV/Excel/PDF.
  const filtered = useMemo(() => {
    // Always drop "opportunity" rows (Apr 23 — Murtaza): HubSpot-integration
    // orphans without clients/budgets. "All Statuses" means "all real statuses."
    let rows = projects.filter(p => p.status !== 'opportunity')
    rows = rows.filter(p => {
      if (!dateFrom || !dateTo) return true
      const projStart = p.startDate
      const projEnd   = p.endDate
      if (projStart && projStart > dateTo) return false
      if (projEnd   && projEnd   < dateFrom) return false
      return true
    })
    if (statusFilter !== 'all') rows = rows.filter(p => p.status === statusFilter)
    if (expiryFilter !== 'all') rows = rows.filter(p => p.expiryStatus === expiryFilter)
    if (budgetFilter !== 'all') rows = rows.filter(p => p.budgetType === budgetFilter)
    if (labelFilter  !== 'all') rows = rows.filter(p => (p.labels || []).some((l: any) => l.id === labelFilter))
    rows.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string' || typeof bv === 'string') {
        return sortAsc
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av))
      }
      return sortAsc ? av - bv : bv - av
    })
    return rows
  }, [projects, dateFrom, dateTo, statusFilter, expiryFilter, budgetFilter, labelFilter, sortKey, sortAsc])

  // ── KPI cards: decoupled from the date range and status filter on purpose.
  //
  // Apr 22 — Murtaza caught that /reports KPIs disagreed with /projects KPIs
  // (10/29/20 vs 22/17/17). Root cause: the reports page defaulted to a
  // "This Month" date range, so historically-expired projects fell outside
  // the window and the Expired count shrank from 22 → whatever had an
  // end_date in April. But "expired" is about deadlines, not about which
  // projects were active in a particular month — so date-filtering the
  // KPIs produced numbers that were technically correct but operationally
  // meaningless.
  //
  // Fix: the KPI cards count ALL running projects (ignoring date range,
  // ignoring status/expiry/budget/label dropdowns) so they give a stable
  // "state of the pipeline" that matches the Projects page exactly. The
  // table below still honors every filter — that's the exploration surface.
  //
  // Budget-type and label filters DO apply to the KPIs though, because those
  // describe the pipeline itself ("how many retainer projects are expiring?"
  // is a valid KPI question). Only the date range and status/expiry dropdowns
  // are skipped — date range because it's a lens, not a scope; status
  // because we always want running projects for the deadline view.
  const kpiRows = useMemo(() => {
    let rows = projects.filter(p => p.status === 'running')
    if (budgetFilter !== 'all') rows = rows.filter(p => p.budgetType === budgetFilter)
    if (labelFilter  !== 'all') rows = rows.filter(p => (p.labels || []).some((l: any) => l.id === labelFilter))
    return rows
  }, [projects, budgetFilter, labelFilter])

  const expired     = kpiRows.filter(p => p.expiryStatus === 'expired').length
  const expiring30  = kpiRows.filter(p => p.expiryStatus === 'expiring_30d').length
  const expiring60  = kpiRows.filter(p => p.expiryStatus === 'expiring_60d').length
  const expiring90  = kpiRows.filter(p => p.expiryStatus === 'expiring_90d').length
  const EXPIRING_STATUSES = ['expired', 'expiring_30d', 'expiring_60d', 'expiring_90d']
  const active      = kpiRows.filter(p => !EXPIRING_STATUSES.includes(p.expiryStatus)).length

  // Reset detection — shown only if any filter is non-default. We intentionally
  // don't include the date range here because dateFrom/dateTo are owned by the
  // parent's shared state and have their own "This Month" preset in the
  // DateRangePicker; resetting them from this button would silently affect
  // every other tab too.
  const hasActiveFilters = statusFilter !== 'all' || expiryFilter !== 'all' || budgetFilter !== 'all' || labelFilter !== 'all'
  function resetFilters() {
    setStatusFilter('all'); setExpiryFilter('all'); setBudgetFilter('all'); setLabelFilter('all')
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }
  function sortIcon(key: SortKey) {
    if (sortKey !== key) return null
    return sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  // Sortable <th> props — keyboard support (Enter/Space to toggle), focus
  // outline, and aria-sort for screen readers.
  function sortableThProps(key: SortKey, align: 'left' | 'right' = 'left') {
    const ariaSort: 'ascending' | 'descending' | 'none' =
      sortKey === key ? (sortAsc ? 'ascending' : 'descending') : 'none'
    return {
      onClick: () => toggleSort(key),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggleSort(key)
        }
      },
      tabIndex: 0,
      role: 'button' as const,
      'aria-sort': ariaSort,
      className: cn(
        'px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted cursor-pointer whitespace-nowrap select-none',
        'focus:outline focus:outline-2 focus:outline-accent focus:outline-offset-[-2px]',
        align === 'right' ? 'text-right' : 'text-left',
      ),
    }
  }
  function toggleCol(key: string) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // Export — rows respect the visible-column set and the filter state
  const headers = ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(c => c.label)
  const exportRows = () => filtered.map(p =>
    ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(c => {
      const v = p[c.key]
      if (c.key === 'daysRemaining' && v != null) return v
      if (c.key === 'hrsBurnPct') return v + '%'
      return v ?? ''
    })
  )
  const tag = new Date().toISOString().slice(0, 10)
  const doCSV   = () => downloadCSV(`Active-Projects-${tag}.csv`, headers, exportRows())
  const doExcel = () => downloadXLSX(`Active-Projects-${tag}.xlsx`, headers, exportRows(), 'Active Projects')
  const doPDF   = () => downloadPDF(`Active-Projects-${tag}.pdf`, 'Active Projects Report', `${filtered.length} projects · ${tag}`, headers, exportRows(), [
    { label: 'Expired', value: String(expired) },
    { label: 'Expiring 30d', value: String(expiring30) },
    { label: 'Expiring 60d', value: String(expiring60) },
    { label: 'Expiring 90d', value: String(expiring90) },
    { label: 'Active', value: String(active) },
  ])

  // Synchronous popup + 412→modal handling lives inside the helper now.
  // See apps/web/src/lib/exportToSheet.ts for the story behind the
  // about:blank dance and how NOT_CONNECTED bubbles into the modal.
  const doGoogleSheet = async () => {
    await exportToSheet({
      title:      `Momentum — Active Projects — ${tag}`,
      exportName: 'Active Projects Report',
      sheets:     [{ name: 'Active Projects', headers, rows: exportRows() }],
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Filter bar — matches the layout convention used across the reports
          section: primary dropdowns first, then a vertical divider, then the
          shared DateRangePicker, then Reset (conditional), with column/export
          controls pinned to the right via ml-auto. Spacing, divider style,
          and border-radius all come from the same tokens as Time Registered /
          Utilization so visually the tabs are interchangeable. */}
      <div className="flex items-center gap-2 flex-wrap mb-3.5">
        <Select size="sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-auto min-w-[140px]" aria-label="Filter by status">
          <option value="all">All Statuses</option>
          {/* "Opportunity" filter removed (Apr 23 — Murtaza): 165 HubSpot-integration
              orphan rows without clients/budgets, shouldn't surface in reports. */}
          <option value="planning">Templates</option>
          <option value="running">Running</option>
          <option value="halted">Halted</option>
          <option value="done">Done</option>
        </Select>
        <Select size="sm" value={expiryFilter} onChange={e => setExpiryFilter(e.target.value)} className="w-auto min-w-[160px]" aria-label="Filter by expiry">
          <option value="all">All Expiry</option>
          <option value="expired">Expired</option>
          <option value="expiring_30d">Expiring in 30d</option>
          <option value="expiring_60d">Expiring in 60d</option>
          <option value="expiring_90d">Expiring in 90d</option>
          <option value="beyond_90d">Active (beyond 90d)</option>
        </Select>

        <Select size="sm" value={budgetFilter} onChange={e => setBudgetFilter(e.target.value)} className="w-auto min-w-[160px]" aria-label="Filter by budget type">
          <option value="all">All Budget Types</option>
          <option value="retainer">Retainer</option>
          <option value="fixed_price">Project (Fixed)</option>
          <option value="time_and_materials">Time &amp; Materials</option>
        </Select>
        {allLabels.length > 0 && (
          <Select size="sm" value={labelFilter} onChange={e => setLabelFilter(e.target.value)} className="w-auto min-w-[160px]" aria-label="Filter by category">
            <option value="all">All Categories</option>
            {allLabels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}
        <div className="w-px h-6 bg-line-subtle" />
        <DateRangePicker from={dateFrom} to={dateTo} onFromChange={onDateFromChange} onToChange={onDateToChange} />
        {hasActiveFilters && (
          <Button size="sm" variant="secondary" onClick={resetFilters}>Reset</Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ColumnToggleMenu columns={ALL_COLUMNS} visibleCols={visibleCols} onToggle={toggleCol} />
          <ExportMenu onCSV={doCSV} onExcel={doExcel} onPDF={doPDF} onGoogleSheet={doGoogleSheet} />
        </div>
      </div>

      {/* KPIs — 5 expiry buckets over ALL running projects (ignoring the date
          range and status filter). This gives a stable "state of the pipeline"
          that matches /projects exactly. Apr 22: previously these counted
          from the date-filtered list which produced confusing numbers when
          the default "This Month" window hid historical expiries. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-3.5">
        <StatCard label="Expired" value={String(expired)} sub="past end date" tone="rose" />
        <StatCard label="Expiring 30d" value={String(expiring30)} sub="within 30 days" tone="amber" />
        <StatCard label="Expiring 60d" value={String(expiring60)} sub="within 60 days" tone="violet" />
        <StatCard label="Expiring 90d" value={String(expiring90)} sub="within 90 days" />
        <StatCard label="Active" value={String(active)} sub="beyond 90 days" tone="accent" />
      </div>

      {/* Table */}
      {isLoading && <ReportSkeleton kpiCount={5} rowCount={10} />}
      {!isLoading && filtered.length === 0 && (
        <Card>
          <EmptyState
            title="No projects found"
            description={hasActiveFilters || (dateFrom && dateTo)
              ? "Try widening the date range or clearing the other filters."
              : "No active projects in the workspace yet."}
          />
        </Card>
      )}
      {!isLoading && filtered.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface border-b border-line-subtle">
                {visibleCols.has('name') && <th {...sortableThProps('name')}>Project {sortIcon('name')}</th>}
                {visibleCols.has('client') && <th {...sortableThProps('client')}>Client {sortIcon('client')}</th>}
                {visibleCols.has('status') && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Status</th>}
                {visibleCols.has('startDate') && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Start</th>}
                {visibleCols.has('endDate') && <th {...sortableThProps('endDate')}>End {sortIcon('endDate')}</th>}
                {visibleCols.has('daysRemaining') && <th {...sortableThProps('daysRemaining', 'right')}>Days Left {sortIcon('daysRemaining')}</th>}
                {visibleCols.has('expiryStatus') && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Expiry</th>}
                {visibleCols.has('budgetType') && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Type</th>}
                {visibleCols.has('budgetAmount') && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Budget</th>}
                {visibleCols.has('currency') && <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Curr.</th>}
                {visibleCols.has('estimatedHrs') && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Est. Hrs</th>}
                {visibleCols.has('loggedHrs') && <th {...sortableThProps('loggedHrs', 'right')}>Logged {sortIcon('loggedHrs')}</th>}
                {visibleCols.has('hrsBurnPct') && <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Burn %</th>}
              </tr>
            </thead>

            <tbody>
              {filtered.map((p, i) => (
                <tr key={p.id} className={cn('hover:bg-surface-hover', i < filtered.length - 1 && 'border-b border-line-subtle')}>
                  {visibleCols.has('name') && <td className="px-3 py-2 font-medium text-primary max-w-[200px] truncate" title={p.name}>{p.name}</td>}
                  {visibleCols.has('client') && <td className="px-3 py-2 text-secondary max-w-[160px] truncate" title={p.client || ''}>{p.client || '—'}</td>}
                          {visibleCols.has('status') && <td className="px-3 py-2"><Badge variant={
          p.status === 'running'     ? 'success' :
          p.status === 'halted'      ? 'warning' :
          p.status === 'opportunity' ? 'violet'  :
          p.status === 'planning'    ? 'info'    :
          'default'
        }>{
          p.status === 'running'     ? 'Running' :
          p.status === 'opportunity' ? 'Opportunity' :
          p.status === 'planning'    ? 'Template' :
          p.status === 'halted'      ? 'Halted' :
          p.status === 'done'        ? 'Done' :
          p.status
        }</Badge></td>}
                  {visibleCols.has('startDate') && <td className="px-3 py-2 text-muted tabular-nums">{p.startDate || '—'}</td>}
                  {visibleCols.has('endDate') && <td className="px-3 py-2 text-muted tabular-nums">{p.endDate || '—'}</td>}
                  {visibleCols.has('daysRemaining') && <td className={cn('px-3 py-2 text-right tabular-nums font-semibold', p.daysRemaining != null && p.daysRemaining < 0 ? 'text-status-rose' : p.daysRemaining != null && p.daysRemaining <= 30 ? 'text-status-amber' : 'text-secondary')}>{p.daysRemaining != null ? p.daysRemaining : '—'}</td>}
                  {visibleCols.has('expiryStatus') && <td className="px-3 py-2">{expiryBadge(p.expiryStatus)}</td>}
                  {visibleCols.has('budgetType') && <td className="px-3 py-2 text-secondary capitalize">{p.budgetType || '—'}</td>}
                  {visibleCols.has('budgetAmount') && <td className="px-3 py-2 text-right text-secondary tabular-nums">{p.budgetAmount ? p.budgetAmount.toLocaleString() : '—'}</td>}
                  {visibleCols.has('currency') && <td className="px-3 py-2 text-muted">{p.currency}</td>}
                  {visibleCols.has('estimatedHrs') && <td className="px-3 py-2 text-right text-secondary tabular-nums">{p.estimatedHrs || '—'}</td>}
                  {visibleCols.has('loggedHrs') && <td className="px-3 py-2 text-right text-primary font-semibold tabular-nums">{p.loggedHrs || '—'}</td>}
                  {visibleCols.has('hrsBurnPct') && <td className="px-3 py-2 text-right">
                    {p.hrsBurnPct > 0 ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-12 h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(p.hrsBurnPct, 100)}%`, background: p.hrsBurnPct > 100 ? 'var(--rose)' : p.hrsBurnPct > 80 ? 'var(--amber)' : 'var(--accent)' }} />
                        </div>
                        <span className={cn('text-xs tabular-nums', p.hrsBurnPct > 100 ? 'text-status-rose' : 'text-secondary')}>{p.hrsBurnPct}%</span>
                      </div>
                    ) : '—'}
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
