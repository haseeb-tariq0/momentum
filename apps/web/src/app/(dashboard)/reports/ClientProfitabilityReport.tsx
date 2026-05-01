'use client'
import { Fragment, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi, usersApi } from '@/lib/queries'
import { exportToSheet } from '@/lib/exportToSheet'
import { useAuthStore } from '@/lib/store'
import { ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Card, StatCard, Badge, EmptyState, Combobox } from '@/components/ui'
import { cn } from '@/lib/cn'
import { downloadCSV, downloadXLSX, downloadPDF } from '@/lib/export'
import { formatInt, formatCurrency } from '@/lib/format'
import { showToast } from '@/components/Toast'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { DateRangePicker } from './DateRangePicker'
import { ExportMenu } from './ExportMenu'
import { ColumnToggleMenu } from './ColumnToggleMenu'
import { ReportSkeleton } from './ReportSkeleton'

// Columns for the per-client roll-up table.
//
// Per Apr 17 call:
//   - Billing, Third Party Cost, Revenue visible by default — so the math
//     "billing − third party = revenue" is obvious on the page.
//   - Profit + Margin default-hidden (Murtaza: "too figurative, people will
//     misread when cost-of-effort doesn't capture the full picture"). Kept as
//     toggleable columns so admins who want them can still opt in.
//   - Currency column removed — all amounts are AED, hardcoded in format.
const ALL_COLUMNS = [
  { key: 'clientName', label: 'Client',          default: true,  sortable: true,  align: 'left'  as const },
  { key: 'billing',    label: 'Total Billing',   default: true,  sortable: true,  align: 'right' as const },
  { key: 'thirdParty', label: 'Third Party',     default: true,  sortable: true,  align: 'right' as const },
  { key: 'revenue',    label: 'Net Revenue',     default: true,  sortable: true,  align: 'right' as const },
  { key: 'cost',       label: 'Cost of Effort',  default: true,  sortable: true,  align: 'right' as const },
  { key: 'hours',      label: 'Hours',           default: true,  sortable: true,  align: 'right' as const },
  { key: 'profit',     label: 'Profit',          default: false, sortable: true,  align: 'right' as const },
  { key: 'margin',     label: 'Margin %',        default: false, sortable: true,  align: 'right' as const },
]

type SortKey = typeof ALL_COLUMNS[number]['key']
type SortDir = 'asc' | 'desc'

function marginColor(m: number | null): string {
  if (m === null) return 'text-muted'
  if (m < 0)  return 'text-status-loss'
  if (m < 20) return 'text-status-amber'
  if (m >= 50) return 'text-status-profit'
  return 'text-status-profit'
}

function marginBadge(m: number | null): 'default' | 'success' | 'warning' | 'danger' | 'violet' {
  if (m === null) return 'default'
  if (m < 0)  return 'danger'
  if (m < 20) return 'warning'
  if (m >= 50) return 'violet'
  return 'success'
}

// Per Apr 15 meeting: this report operates MONTHLY because finance sheet
// revenue is stored as monthly sums. UI now uses a date range picker for
// visual consistency with every other report — month is derived from the
// start of the range. If the user picks a range spanning two months, we use
// the starting month's data. The "This Month" preset gives the natural
// behaviour; manual ranges within one month work as expected.
export default function ClientProfitabilityReport({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: {
  dateFrom: string
  dateTo: string
  onDateFromChange?: (v: string) => void
  onDateToChange?: (v: string) => void
}) {
  const { isAdmin } = useAuthStore()

  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => usersApi.clients().then((r: any) => r.data),
    staleTime: 60_000,
  })
  const clients: any[] = clientsData || []

  // Month derives from the start of the range (YYYY-MM-DD → YYYY-MM).
  // Previously this was a local `monthStr` state driven by a MonthPicker.
  const monthStr = (dateFrom || format(startOfMonth(new Date()), 'yyyy-MM-dd')).slice(0, 7)
  const [clientFilter, setClientFilter] = useState('all')
  const [visibleCols, setVisibleCols] = useState(() => new Set(ALL_COLUMNS.filter(c => c.default).map(c => c.key)))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const params = useMemo(() => ({
    month: monthStr,
    ...(clientFilter !== 'all' ? { client_id: clientFilter } : {}),
  }), [monthStr, clientFilter])

  const { data: reportRes, isLoading } = useQuery({
    queryKey: ['client-profitability', params],
    queryFn: () => reportsApi.clientProfitability(params).then((r: any) => r),
    enabled: isAdmin(),
    staleTime: 30_000,
  })

  const rawRows: any[] = reportRes?.data || []
  const totals = reportRes?.totals || { billing: 0, thirdParty: 0, revenue: 0, cost: 0, profit: 0, hours: 0 }

  const rows = useMemo(() => {
    const sorted = [...rawRows]
    sorted.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (sortKey === 'clientName') {
        av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase()
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      av = Number(av) || 0; bv = Number(bv) || 0
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return sorted
  }, [rawRows, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function toggleCol(key: string) {
    setVisibleCols(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  function toggleRow(id: string) {
    setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  const colDefs = ALL_COLUMNS.filter(c => visibleCols.has(c.key))
  const headers = colDefs.map(c => c.label)
  const MONEY_KEYS = new Set(['billing', 'thirdParty', 'revenue', 'cost', 'profit'])
  const exportRows = () => {
    const dr: any[][] = rows.map(r => colDefs.map(c => {
      if (c.key === 'margin') return r.margin === null ? '' : r.margin + '%'
      if (MONEY_KEYS.has(c.key)) return Math.round((r[c.key] || 0) * 100) / 100
      return r[c.key] ?? ''
    }))
    // Totals row
    dr.push(colDefs.map((c, i) => {
      if (MONEY_KEYS.has(c.key)) return Math.round(((totals as any)[c.key] || 0) * 100) / 100
      if (c.key === 'hours')    return Math.round(totals.hours)
      if (c.key === 'margin')   return totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 100) + '%' : ''
      if (i === 0) return 'TOTAL'
      return ''
    }))
    return dr
  }
  const monthLabel = (() => {
    try {
      return format(new Date(monthStr + '-01T00:00:00'), 'MMMM yyyy')
    } catch { return monthStr }
  })()
  const tag = `Client-Profitability-${monthStr}`
  const overallMargin = totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 100) : null

  return (
    <div>
      {/* Filters + Columns + Export, all on one row. Date range picker
          replaces the previous MonthPicker for visual consistency with
          every other report — month is derived from the start of the range. */}
      <div className="flex items-center gap-2 flex-wrap mb-3.5">
        <div className="w-[240px]">
          <Combobox
            size="sm"
            value={clientFilter}
            onChange={v => setClientFilter((v as string) || 'all')}
            options={[
              { value: 'all', label: 'All Clients' },
              ...clients.map((c: any) => ({ value: c.id as string, label: c.name })),
            ]}
            placeholder="All Clients"
            searchPlaceholder="Search clients…"
          />
        </div>
        {onDateFromChange && onDateToChange && (
          <>
            <div className="w-px h-6 bg-line-subtle" />
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onFromChange={onDateFromChange}
              onToChange={onDateToChange}
            />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ColumnToggleMenu columns={ALL_COLUMNS} visibleCols={visibleCols} onToggle={toggleCol} />
          {rows.length > 0 && (
            <ExportMenu
              onCSV={() => downloadCSV(`${tag}.csv`, headers, exportRows())}
              onExcel={() => downloadXLSX(`${tag}.xlsx`, headers, exportRows(), 'Client Profitability')}
              onPDF={() => downloadPDF(`${tag}.pdf`, 'Client Profitability', monthLabel, headers, exportRows(), [
                { label: 'Total Billing',    value: formatCurrency(totals.billing) },
                { label: 'Third Party Cost', value: formatCurrency(totals.thirdParty) },
                { label: 'Net Revenue',      value: formatCurrency(totals.revenue) },
                { label: 'Cost of Effort',   value: formatCurrency(totals.cost) },
              ])}
              onGoogleSheet={async () => {
                await exportToSheet({
                  title:      `Momentum — Client Profitability — ${monthLabel}`,
                  exportName: 'Client Profitability Report',
                  sheets:     [{ name: 'Client Profitability', headers, rows: exportRows() }],
                })
              }}
            />
          )}
        </div>
      </div>

      {/* Revenue breakdown (Apr 17 call): show the math explicitly so anyone
          reading can see how Total Revenue is derived from Total Billing minus
          Third Party Cost. No separate Profit KPI — Murtaza said that's too
          figurative when cost-of-effort doesn't capture the whole picture. */}
      <Card className="p-4 mb-3.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">Revenue for {monthLabel}</div>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-xs text-muted">Total Billing</div>
            <div className="text-2xl font-bold text-primary tabular-nums mt-0.5">{formatCurrency(totals.billing)}</div>
            <div className="text-[11px] text-muted mt-0.5">sales + third party (what the client was billed)</div>
          </div>
          <div>
            <div className="text-xs text-muted">− Third Party Cost</div>
            <div className="text-2xl font-bold text-secondary tabular-nums mt-0.5">{formatCurrency(totals.thirdParty)}</div>
            <div className="text-[11px] text-muted mt-0.5">passed through to suppliers</div>
          </div>
          <div>
            <div className="text-xs text-muted">= Net Revenue</div>
            <div className="text-2xl font-bold text-accent tabular-nums mt-0.5">{formatCurrency(totals.revenue)}</div>
            <div className="text-[11px] text-muted mt-0.5">what we actually earned</div>
          </div>
        </div>
      </Card>

      {/* Cost-side KPIs — no Profit / Margin blocks. */}
      <div className="grid grid-cols-2 gap-3 mb-3.5">
        <StatCard label="Total Cost of Effort" value={formatCurrency(totals.cost)} sub="hours × internal rate" />
        <StatCard label="Total Hours"          value={formatInt(totals.hours)}      sub="logged" />
      </div>

      {isLoading && <ReportSkeleton kpiCount={2} rowCount={8} />}

      {!isLoading && rows.length === 0 && (
        <Card>
          <EmptyState
            title="No data yet"
            description="Make sure the Finance Sheet has been imported (Admin → Import Finance Sheet) and that there are time entries in this date range."
          />
        </Card>
      )}

      {!isLoading && rows.length > 0 && rawRows.some(r => r.revenue > 0 && r.hours === 0) && (
        <div className="text-xs text-muted mb-2">
          <span className="text-muted">*</span> Profit marked with * means no timesheet hours were logged — cost could not be calculated.
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface border-b border-line-subtle">
                <th className="w-6"></th>
                {ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(col => {
                  const ariaSort: 'ascending' | 'descending' | 'none' =
                    sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        'px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted',
                        col.align === 'right' ? 'text-right' : 'text-left',
                        col.sortable && 'cursor-pointer select-none hover:text-primary transition-colors focus:outline focus:outline-2 focus:outline-accent focus:outline-offset-[-2px]'
                      )}
                      onClick={() => col.sortable && handleSort(col.key)}
                      onKeyDown={(e) => {
                        if (!col.sortable) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSort(col.key)
                        }
                      }}
                      tabIndex={col.sortable ? 0 : -1}
                      role={col.sortable ? 'button' : undefined}
                      aria-sort={col.sortable ? ariaSort : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.sortable && (
                          sortKey === col.key
                            ? (sortDir === 'desc' ? <ArrowDown size={10} className="text-accent" /> : <ArrowUp size={10} className="text-accent" />)
                            : <ArrowUpDown size={10} className="opacity-30" />
                        )}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isExp = expanded.has(r.clientId)
                const hasEffort = r.hours > 0
                return (
                  // Fragment needs an explicit key — React warns when the
                  // mapped element is a fragment and the key lives on a child.
                  <Fragment key={r.clientId}>
                    <tr
                      onClick={() => toggleRow(r.clientId)}
                      className={cn(
                        'cursor-pointer hover:bg-surface-hover transition-colors',
                        i < rows.length - 1 && 'border-b border-line-subtle',
                        !hasEffort && !r.revenue && 'opacity-50'
                      )}
                    >
                      <td className="px-2 py-2 text-muted">
                        {isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      {visibleCols.has('clientName') && <td className="px-3 py-2 font-medium text-primary">{r.clientName}</td>}
                      {visibleCols.has('billing')    && <td className="px-3 py-2 text-right tabular-nums text-secondary">{r.billing ? formatCurrency(r.billing) : <span className="text-muted">—</span>}</td>}
                      {visibleCols.has('thirdParty') && <td className="px-3 py-2 text-right tabular-nums text-muted">{r.thirdParty ? formatCurrency(r.thirdParty) : <span className="text-muted">—</span>}</td>}
                      {visibleCols.has('revenue')    && <td className="px-3 py-2 text-right tabular-nums font-medium text-primary">{r.revenue ? formatCurrency(r.revenue) : <span className="text-muted">—</span>}</td>}
                      {visibleCols.has('cost')       && <td className="px-3 py-2 text-right tabular-nums text-secondary">{hasEffort ? formatCurrency(r.cost) : <span className="text-muted">—</span>}</td>}
                      {visibleCols.has('hours')      && <td className="px-3 py-2 text-right tabular-nums text-secondary">{hasEffort ? Math.round(r.hours) : <span className="text-muted">—</span>}</td>}
                      {visibleCols.has('profit')     && <td className={cn('px-3 py-2 text-right tabular-nums font-semibold', !hasEffort && !r.revenue ? 'text-muted' : r.profit < 0 ? 'text-status-loss' : r.profit > 0 ? 'text-status-profit' : 'text-primary')}>
                        {!hasEffort && r.revenue ? <span className="text-muted" title="No timesheet hours logged for this client">{formatCurrency(r.revenue)}*</span> : formatCurrency(r.profit)}
                      </td>}
                      {visibleCols.has('margin') && (
                        <td className="px-3 py-2 text-right">
                          {r.margin === null || !hasEffort ? <span className="text-muted">—</span>
                            : <Badge variant={marginBadge(r.margin)}>{r.margin}%</Badge>}
                        </td>
                      )}
                    </tr>
                    {/* Monthly breakdown — respects the same column toggle as
                        the parent table, so hiding (e.g.) "Third Party" up top
                        hides it here too. Previously it always showed all six
                        fixed columns regardless of parent visibility. */}
                    {isExp && r.months.length > 0 && (
                      <tr className="bg-surface/50">
                        <td colSpan={1 + colDefs.length} className="p-0">
                          <div className="px-6 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Monthly breakdown</div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-muted">
                                  <th className="text-left py-1">Month</th>
                                  {visibleCols.has('billing')    && <th className="text-right py-1">Billing</th>}
                                  {visibleCols.has('thirdParty') && <th className="text-right py-1">3rd Party</th>}
                                  {visibleCols.has('revenue')    && <th className="text-right py-1">Revenue</th>}
                                  {visibleCols.has('cost')       && <th className="text-right py-1">Cost</th>}
                                  {visibleCols.has('hours')      && <th className="text-right py-1">Hours</th>}
                                  {visibleCols.has('profit')     && <th className="text-right py-1">Profit</th>}
                                  {visibleCols.has('margin')     && <th className="text-right py-1">Margin %</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {r.months.map((m: any) => {
                                  const mProfit = (m.revenue || 0) - (m.cost || 0)
                                  const mMargin = m.revenue > 0 ? Math.round((mProfit / m.revenue) * 100) : null
                                  return (
                                    <tr key={m.month} className="border-t border-line-subtle/50">
                                      <td className="py-1 text-secondary">{format(new Date(m.month + 'T00:00:00'), 'MMM yyyy')}</td>
                                      {visibleCols.has('billing')    && <td className="py-1 text-right tabular-nums text-secondary">{formatCurrency(m.billing)}</td>}
                                      {visibleCols.has('thirdParty') && <td className="py-1 text-right tabular-nums text-muted">{formatCurrency(m.thirdParty)}</td>}
                                      {visibleCols.has('revenue')    && <td className="py-1 text-right tabular-nums text-primary">{formatCurrency(m.revenue)}</td>}
                                      {visibleCols.has('cost')       && <td className="py-1 text-right tabular-nums text-secondary">{formatCurrency(m.cost)}</td>}
                                      {visibleCols.has('hours')      && <td className="py-1 text-right tabular-nums text-muted">{Math.round(m.hours)}</td>}
                                      {visibleCols.has('profit')     && <td className={cn('py-1 text-right tabular-nums', mProfit < 0 ? 'text-status-loss' : mProfit > 0 ? 'text-status-profit' : 'text-primary')}>{formatCurrency(mProfit)}</td>}
                                      {visibleCols.has('margin')     && <td className={cn('py-1 text-right tabular-nums', mMargin !== null && marginColor(mMargin))}>{mMargin === null ? '—' : mMargin + '%'}</td>}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface border-t border-line-subtle font-semibold">
                <td></td>
                {visibleCols.has('clientName') && <td className="px-3 py-2 text-secondary">TOTAL</td>}
                {visibleCols.has('billing')    && <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(totals.billing)}</td>}
                {visibleCols.has('thirdParty') && <td className="px-3 py-2 text-right tabular-nums text-muted">{formatCurrency(totals.thirdParty)}</td>}
                {visibleCols.has('revenue')    && <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(totals.revenue)}</td>}
                {visibleCols.has('cost')       && <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(totals.cost)}</td>}
                {visibleCols.has('hours')      && <td className="px-3 py-2 text-right tabular-nums text-secondary">{Math.round(totals.hours)}</td>}
                {visibleCols.has('profit')     && <td className={cn('px-3 py-2 text-right tabular-nums font-semibold', totals.profit < 0 ? 'text-status-loss' : totals.profit > 0 ? 'text-status-profit' : 'text-primary')}>{formatCurrency(totals.profit)}</td>}
                {visibleCols.has('margin')     && <td className={cn('px-3 py-2 text-right tabular-nums', overallMargin !== null && marginColor(overallMargin))}>{overallMargin === null ? '—' : overallMargin + '%'}</td>}
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  )
}

// ExportMenu moved to ./ExportMenu (shared across the reports section).
