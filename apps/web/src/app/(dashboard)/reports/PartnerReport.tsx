'use client'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi, usersApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { Card, StatCard, EmptyState, Combobox, Badge } from '@/components/ui'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { downloadCSV, downloadXLSX, downloadPDF } from '@/lib/export'
import { formatCurrency, formatHours, formatInt } from '@/lib/format'
import { showToast } from '@/components/Toast'
import { DateRangePicker } from './DateRangePicker'
import { ExportMenu } from './ExportMenu'
import { ReportSkeleton } from './ReportSkeleton'

/**
 * Partner Report — per Apr 17 call with Murtaza (verbatim spec):
 *
 *   "Each partner has their own rate card. So for Human Magic, the rate card
 *    would be different. For Pure Minds, the rate card would be different.
 *    […] The formula is hours worked multiplied by the rate card, and the
 *    rate is based on the department, not the person."
 *
 *   "User-driven templates — save a variant per partner ('Human Magic Partner
 *    Report', 'Pure Minds Partner Report', 'Nexa Cognition Partner Report')
 *    so when they open the saved view it loads that partner straight away."
 *
 * The endpoint `/reports/partner` already implements the department-first
 * rate lookup with a job_title fallback, falls back from project.rate_card_id
 * to client.default_rate_card_id, and returns both a detail row per time
 * entry and summaries grouped by project + by department.
 *
 * Visibility gate: admin + super_admin only (matches reportVisibility.ts).
 *
 * Save-view integration: the parent page's "Save view" button reads slug=
 * 'partner-report' and snapshots dateFrom/dateTo + (client_id once we pass
 * it up as a f_* URL param). The client filter state is owned here so
 * switching tabs preserves it, and we replay it from URL `f_client` on mount.
 */

type SortKey = 'name' | 'hours' | 'cost' | 'rate'
type SortDir = 'asc' | 'desc'

const DEPT_COLUMNS = [
  { key: 'name',  label: 'Department / Team', default: true,  align: 'left'  as const, sortable: true  },
  { key: 'rate',  label: 'Rate',              default: true,  align: 'right' as const, sortable: false },
  { key: 'hours', label: 'Hours',             default: true,  align: 'right' as const, sortable: true  },
  { key: 'cost',  label: 'Cost',              default: true,  align: 'right' as const, sortable: true  },
]

const PROJECT_COLUMNS = [
  { key: 'name',  label: 'Project', default: true, align: 'left'  as const, sortable: true  },
  { key: 'hours', label: 'Hours',   default: true, align: 'right' as const, sortable: true  },
  { key: 'cost',  label: 'Cost',    default: true, align: 'right' as const, sortable: true  },
]

interface Props {
  dateFrom:        string
  dateTo:          string
  onDateFromChange:(v: string) => void
  onDateToChange:  (v: string) => void
  initialClientId?: string | null
}

export default function PartnerReport({
  dateFrom, dateTo, onDateFromChange, onDateToChange, initialClientId,
}: Props) {
  const { isAdmin } = useAuthStore()

  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => usersApi.clients().then((r: any) => r.data),
    staleTime: 60_000,
  })
  const clients: any[] = clientsData || []

  // Client is REQUIRED — /reports/partner returns 400 MISSING_CLIENT without it.
  // Default to the first client when available so users see something useful
  // on first paint rather than an empty-state message. The initialClientId
  // prop is used for URL-param replay when a saved view is opened.
  const [clientFilter, setClientFilter] = useState<string>(initialClientId || '')
  const effectiveClient = clientFilter || clients[0]?.id || ''

  // Column / sort state — same pattern as ClientProfitabilityReport so the
  // two reports feel consistent when switching tabs.
  const [deptSortKey, setDeptSortKey] = useState<SortKey>('cost')
  const [deptSortDir, setDeptSortDir] = useState<SortDir>('desc')
  const [projSortKey, setProjSortKey] = useState<SortKey>('cost')
  const [projSortDir, setProjSortDir] = useState<SortDir>('desc')
  const [visibleDeptCols] = useState(() => new Set(DEPT_COLUMNS.filter(c => c.default).map(c => c.key)))
  const [visibleProjCols] = useState(() => new Set(PROJECT_COLUMNS.filter(c => c.default).map(c => c.key)))

  const params = useMemo(
    () => ({ client_id: effectiveClient, from: dateFrom, to: dateTo }),
    [effectiveClient, dateFrom, dateTo],
  )

  const { data: reportRes, isLoading } = useQuery({
    queryKey: ['partner-report', params],
    queryFn: () => reportsApi.partner(params).then((r: any) => r),
    enabled: isAdmin() && !!effectiveClient,
    staleTime: 30_000,
  })

  const clientInfo: { id: string; name: string } | null = reportRes?.client || null
  const summary = reportRes?.summary || { byProject: [], byDepartment: [], totalHrs: 0, totalCost: 0 }
  const currency: string = reportRes?.currency || 'AED'
  const rows: any[] = reportRes?.data || []

  // Sorting
  const sortedByDept = useMemo(() => {
    const r = [...(summary.byDepartment || [])]
    r.sort((a: any, b: any) => {
      let av = a[deptSortKey], bv = b[deptSortKey]
      if (deptSortKey === 'name') {
        av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase()
        return deptSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      av = Number(av) || 0; bv = Number(bv) || 0
      return deptSortDir === 'asc' ? av - bv : bv - av
    })
    return r
  }, [summary.byDepartment, deptSortKey, deptSortDir])

  const sortedByProject = useMemo(() => {
    const r = [...(summary.byProject || [])]
    r.sort((a: any, b: any) => {
      let av = a[projSortKey], bv = b[projSortKey]
      if (projSortKey === 'name') {
        av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase()
        return projSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      av = Number(av) || 0; bv = Number(bv) || 0
      return projSortDir === 'asc' ? av - bv : bv - av
    })
    return r
  }, [summary.byProject, projSortKey, projSortDir])

  function toggleDeptSort(key: SortKey) {
    if (deptSortKey === key) setDeptSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setDeptSortKey(key); setDeptSortDir('desc') }
  }
  function toggleProjSort(key: SortKey) {
    if (projSortKey === key) setProjSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setProjSortKey(key); setProjSortDir('desc') }
  }
  function sortIcon(active: boolean, dir: SortDir) {
    if (!active) return <ArrowUpDown size={11} className="opacity-30" />
    return dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
  }

  // ── Export ───────────────────────────────────────────────────────────────
  // Exports capture both summaries as separate sheets (Excel/GSheet), matching
  // the natural "sectioned" reading of the report. CSV only gets the Per
  // Department sheet — CSV is single-tab — which matches what Murtaza asked
  // for on Apr 17 ("department by department").
  const clientNameSafe = clientInfo?.name || 'client'
  const tag = `Partner-Report-${clientNameSafe.replace(/[^a-z0-9]+/gi, '-')}-${dateFrom}-to-${dateTo}`
  const deptHeaders  = ['Department / Team', 'Rate', 'Hours', 'Cost']
  const projHeaders  = ['Project', 'Hours', 'Cost']
  const entryHeaders = ['Date', 'Project', 'Task', 'Phase', 'Person', 'Department', 'Role', 'Hours', 'Rate', 'Cost', 'Billable', 'Note']

  const deptExportRows = () => {
    const dr: any[][] = sortedByDept.map((d: any) => [d.name, d.rate, d.hours, d.cost])
    dr.push(['TOTAL', '', summary.totalHrs, summary.totalCost])
    return dr
  }
  const projExportRows = () => {
    const pr: any[][] = sortedByProject.map((p: any) => [p.name, p.hours, p.cost])
    pr.push(['TOTAL', summary.totalHrs, summary.totalCost])
    return pr
  }
  const entryExportRows = () => rows.map((r: any) => [
    r.date, r.projectName, r.taskName, r.phaseName, r.personName, r.department, r.role,
    r.hours, r.rate, r.cost, r.billable ? 'Yes' : 'No', r.note || '',
  ])

  const reportTitle = `Partner Report — ${clientInfo?.name || '…'}`
  const rangeLabel  = `${dateFrom} → ${dateTo}`

  async function doGoogleSheet() {
    const popup = window.open('about:blank', '_blank')
    try {
      const res: any = await reportsApi.exportGoogleSheet({
        title: `NextTrack — ${reportTitle} — ${rangeLabel}`,
        sheets: [
          { name: 'By Department', headers: deptHeaders, rows: deptExportRows() },
          { name: 'By Project',    headers: projHeaders, rows: projExportRows() },
          { name: 'Detail',        headers: entryHeaders, rows: entryExportRows() },
        ],
      })
      if (popup) popup.location.href = res.url
      else showToast.success(`Sheet created: ${res.url} (popup blocked — click the link)`)
    } catch (e: any) {
      if (popup) popup.close()
      showToast.error('Export failed: ' + (e?.message || 'unknown'))
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Filter bar — client Combobox first (REQUIRED for this report),
          then date range, then Export. No status/expiry/budget dropdowns —
          this report is scoped per-client and doesn't filter beyond that. */}
      <div className="flex items-center gap-2 flex-wrap mb-3.5">
        <div className="w-[260px]">
          <Combobox
            size="sm"
            value={clientFilter || effectiveClient}
            onChange={v => setClientFilter((v as string) || '')}
            options={clients.map((c: any) => ({ value: c.id as string, label: c.name }))}
            placeholder="Select partner…"
            searchPlaceholder="Search partners…"
            aria-label="Partner"
          />
        </div>
        <div className="w-px h-6 bg-line-subtle" />
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onFromChange={onDateFromChange}
          onToChange={onDateToChange}
        />
        <div className="ml-auto">
          {rows.length > 0 && (
            <ExportMenu
              onCSV={() => downloadCSV(`${tag}.csv`, deptHeaders, deptExportRows())}
              onExcel={async () => {
                // Single-file Excel export bundling the three views. downloadXLSX
                // takes one sheet at a time currently — we export the "By
                // Department" view as the primary sheet because that's the
                // summary Murtaza wanted ("department by department"). The
                // GSheet export below gets all three tabs.
                await downloadXLSX(`${tag}.xlsx`, deptHeaders, deptExportRows(), 'By Department')
              }}
              onPDF={() => downloadPDF(`${tag}.pdf`, reportTitle, rangeLabel, deptHeaders, deptExportRows(), [
                { label: 'Partner', value: clientInfo?.name || '—' },
                { label: 'Total Hours', value: formatHours(summary.totalHrs) },
                { label: 'Total Cost',  value: formatCurrency(summary.totalCost, currency) },
                { label: 'Departments', value: String(sortedByDept.length) },
              ])}
              onGoogleSheet={doGoogleSheet}
            />
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && <ReportSkeleton kpiCount={3} rowCount={10} />}

      {/* No-client state — shows if the workspace has zero clients */}
      {!isLoading && !effectiveClient && (
        <Card>
          <EmptyState
            title="No clients to report on"
            description="Add a client to the workspace to generate a partner report."
          />
        </Card>
      )}

      {/* No-data state — client selected but no time in range */}
      {!isLoading && effectiveClient && rows.length === 0 && (
        <Card>
          <EmptyState
            title={`No time logged for ${clientInfo?.name || 'this partner'} in the selected range`}
            description="Try widening the date range, or pick a different partner from the selector."
          />
        </Card>
      )}

      {/* Main report body */}
      {!isLoading && rows.length > 0 && (
        <>
          {/* Top-line KPIs — same 3-column rhythm used on Client Profitability,
              so the two reports feel like siblings. */}
          <div className="grid grid-cols-3 gap-3 mb-3.5">
            <StatCard
              label="Total Hours"
              value={formatHours(summary.totalHrs)}
              sub={`${rows.length} time ${rows.length === 1 ? 'entry' : 'entries'}`}
            />
            <StatCard
              label="Total Cost"
              value={formatCurrency(summary.totalCost, currency)}
              sub="hours × rate card"
              tone="accent"
            />
            <StatCard
              label="Effective Rate"
              value={summary.totalHrs > 0
                ? formatCurrency(summary.totalCost / summary.totalHrs, currency)
                : '—'}
              sub="avg per hour"
              tone="violet"
            />
          </div>

          {/* Per-department summary — the primary view Murtaza asked for.
              "Rate is based on the department, not the person." */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mb-3.5">
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line-subtle flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">By Department / Team</div>
                  <div className="text-xs text-muted mt-0.5">hours × departmental rate</div>
                </div>
                <Badge variant="default">{sortedByDept.length}</Badge>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-line-subtle">
                    {DEPT_COLUMNS.filter(c => visibleDeptCols.has(c.key)).map(c => (
                      <th
                        key={c.key}
                        className={cn(
                          'px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap',
                          c.align === 'right' ? 'text-right' : 'text-left',
                          c.sortable && 'cursor-pointer select-none',
                        )}
                        onClick={c.sortable ? () => toggleDeptSort(c.key as SortKey) : undefined}
                      >
                        <span className={cn('inline-flex items-center gap-1', c.align === 'right' && 'justify-end w-full')}>
                          {c.label}
                          {c.sortable && sortIcon(deptSortKey === c.key, deptSortDir)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedByDept.map((d: any, i: number) => (
                    <tr key={i} className={cn(i < sortedByDept.length - 1 && 'border-b border-line-subtle', 'hover:bg-surface-hover')}>
                      <td className="px-3 py-2 font-medium text-primary truncate max-w-[280px]" title={d.name}>{d.name}</td>
                      <td className="px-3 py-2 text-right text-secondary tabular-nums">
                        {d.rate > 0 ? formatCurrency(d.rate, currency) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-secondary tabular-nums">{formatHours(d.hours)}</td>
                      <td className="px-3 py-2 text-right text-accent font-semibold tabular-nums">
                        {formatCurrency(d.cost, currency)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-surface-overlay border-t border-line-muted">
                    <td className="px-3 py-2 font-bold text-primary">Total</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{formatHours(summary.totalHrs)}</td>
                    <td className="px-3 py-2 text-right font-bold text-accent tabular-nums">
                      {formatCurrency(summary.totalCost, currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>

            {/* Per-project summary — secondary view. Each row prefixed with
                client name to match Murtaza's format ("Human Magic - Website"
                not just "Website"). */}
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line-subtle flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">By Project</div>
                  <div className="text-xs text-muted mt-0.5">effort across each engagement</div>
                </div>
                <Badge variant="default">{sortedByProject.length}</Badge>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-line-subtle">
                    {PROJECT_COLUMNS.filter(c => visibleProjCols.has(c.key)).map(c => (
                      <th
                        key={c.key}
                        className={cn(
                          'px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap',
                          c.align === 'right' ? 'text-right' : 'text-left',
                          c.sortable && 'cursor-pointer select-none',
                        )}
                        onClick={c.sortable ? () => toggleProjSort(c.key as SortKey) : undefined}
                      >
                        <span className={cn('inline-flex items-center gap-1', c.align === 'right' && 'justify-end w-full')}>
                          {c.label}
                          {c.sortable && sortIcon(projSortKey === c.key, projSortDir)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedByProject.map((p: any, i: number) => (
                    <tr key={i} className={cn(i < sortedByProject.length - 1 && 'border-b border-line-subtle', 'hover:bg-surface-hover')}>
                      <td className="px-3 py-2 font-medium text-primary truncate max-w-[280px]" title={p.name}>{p.name}</td>
                      <td className="px-3 py-2 text-right text-secondary tabular-nums">{formatHours(p.hours)}</td>
                      <td className="px-3 py-2 text-right text-accent font-semibold tabular-nums">
                        {formatCurrency(p.cost, currency)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-surface-overlay border-t border-line-muted">
                    <td className="px-3 py-2 font-bold text-primary">Total</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{formatHours(summary.totalHrs)}</td>
                    <td className="px-3 py-2 text-right font-bold text-accent tabular-nums">
                      {formatCurrency(summary.totalCost, currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </div>

          {/* Detail — collapsible so the page doesn't scroll forever on big
              engagements. Default: closed. When open, shows the raw time
              entries underlying the summaries. */}
          <DetailSection
            rows={rows}
            currency={currency}
          />
        </>
      )}
    </div>
  )
}

/**
 * Collapsible detail table. Split out as its own component so the
 * show/hide state doesn't force re-renders of the two summary tables.
 */
function DetailSection({ rows, currency }: { rows: any[]; currency: string }) {
  const [open, setOpen] = useState(false)

  // Top 100 rows by default; gated behind a "Show all" toggle for big ranges.
  const [showAll, setShowAll] = useState(false)
  const displayRows = showAll ? rows : rows.slice(0, 100)

  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-surface-hover border-b border-line-subtle bg-transparent"
      >
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Detail — Time Entries</div>
          <Badge variant="default">{rows.length}</Badge>
        </div>
        <span className="text-xs text-muted">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface border-b border-line-subtle">
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Date</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Project</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Task</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Person</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Department</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Hours</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Rate</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted whitespace-nowrap">Cost</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r: any, i: number) => (
                  <tr key={r.id || i} className={cn(i < displayRows.length - 1 && 'border-b border-line-subtle', 'hover:bg-surface-hover')}>
                    <td className="px-3 py-2 text-muted tabular-nums whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2 text-primary truncate max-w-[220px]" title={r.projectName}>{r.projectName}</td>
                    <td className="px-3 py-2 text-secondary truncate max-w-[220px]" title={r.taskName}>{r.taskName}</td>
                    <td className="px-3 py-2 text-primary">{r.personName}</td>
                    <td className="px-3 py-2 text-secondary">{r.department || '—'}</td>
                    <td className="px-3 py-2 text-right text-secondary tabular-nums">{formatHours(r.hours)}</td>
                    <td className="px-3 py-2 text-right text-muted tabular-nums">
                      {r.rate > 0 ? formatCurrency(r.rate, currency) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-accent font-semibold tabular-nums">
                      {formatCurrency(r.cost, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && !showAll && (
            <div className="px-4 py-2.5 border-t border-line-subtle bg-surface flex items-center justify-between">
              <div className="text-xs text-muted">
                Showing first 100 of {formatInt(rows.length)} entries
              </div>
              <button
                onClick={() => setShowAll(true)}
                className="text-xs text-accent hover:underline bg-transparent border-0 cursor-pointer"
              >
                Show all
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
