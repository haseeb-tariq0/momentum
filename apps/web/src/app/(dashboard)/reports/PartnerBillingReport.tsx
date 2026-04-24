'use client'
import { Fragment, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { ChevronDown, ChevronRight, Receipt, CheckCircle2, AlertCircle } from 'lucide-react'
import { Card, StatCard, Badge, EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { downloadCSV, downloadXLSX } from '@/lib/export'
import { formatCurrency } from '@/lib/format'
import { showToast } from '@/components/Toast'
import { format } from 'date-fns'
import { DateRangePicker } from './DateRangePicker'
import { ExportMenu } from './ExportMenu'
import { ReportSkeleton } from './ReportSkeleton'

/**
 * Partner Billing — Apr 17 spec with Murtaza.
 *
 * Sister report to Partner Report: where Partner Report shows what we SHOULD
 * bill (hours × rate card), Partner Billing shows what actually landed on an
 * invoice — sourced from client_invoices (the Finance Sheet).
 *
 * Three numbers per client-month, all derived server-side:
 *   Total Billing = sales_amount + third_party   (gross on the invoice)
 *   Third Party   = third_party                  (passed-through supplier cost)
 *   Net Revenue   = sales_amount                 (what we actually earned)
 *
 * Nesting (Apr 17 edge case):
 *   Nexa Cognition is both a partner AND a parent with sub-clients (Redwood,
 *   Bespoke). Sub-clients have their own rate cards but their billing rolls
 *   up under Nexa Cognition in this view. Handled via clients.parent_client_id
 *   — parent rows render their own direct billing plus children's totals,
 *   and children are grouped as nested sub-rows when a parent is expanded.
 *
 * Missing-rate-card indicator:
 *   Rows show a small badge when the client's default_rate_card_id is NULL.
 *   Most partners don't have rate cards configured yet; this makes the gap
 *   visible without hiding actual billing data.
 *
 * No PDF export here — the per-currency totals and nested structure don't
 * fit a simple landscape table well. CSV / Excel / Google Sheet only.
 */

interface Props {
  dateFrom:        string
  dateTo:          string
  onDateFromChange:(v: string) => void
  onDateToChange:  (v: string) => void
}

export default function PartnerBillingReport({
  dateFrom, dateTo, onDateFromChange, onDateToChange,
}: Props) {
  const { isAdmin } = useAuthStore()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Toggle: fold child clients into their parent rows (tree view) vs show
  // every client as a flat row (invoice-style list). Tree is default because
  // the Nexa Cognition parent/child roll-up is the main reason this report
  // exists — but the flat view is useful for auditing the raw finance rows.
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('tree')

  const { data: reportRes, isLoading } = useQuery({
    queryKey: ['partner-billing', dateFrom, dateTo],
    queryFn: () => reportsApi.partnerBilling({ from: dateFrom, to: dateTo }).then((r: any) => r),
    enabled: isAdmin(),
    staleTime: 30_000,
  })

  const rawRows: any[] = reportRes?.data || []
  const totals = reportRes?.totals || { billing: 0, thirdParty: 0, netRevenue: 0, clientCount: 0, unmappedCount: 0 }
  const totalsByCurrency: Record<string, { billing: number; thirdParty: number; netRevenue: number; count: number }>
    = reportRes?.totalsByCurrency || {}
  const range = reportRes?.range || { from: dateFrom, to: dateTo }
  const currencies = Object.keys(totalsByCurrency).sort()

  // ── Tree build: parent rows with nested children ──────────────────────────
  // Children attach to parents by parent_client_id. Orphans (children whose
  // parent isn't in the report's date-range) render at the top level alongside
  // parents — losing them would be wrong, and the UI can't infer that Redwood
  // should appear without Nexa Cognition having any invoices this month.
  const treeRows = useMemo(() => {
    if (viewMode !== 'tree') return rawRows
    const byId: Record<string, any> = {}
    for (const r of rawRows) {
      if (r.clientId) byId[r.clientId] = { ...r, children: [] }
    }
    const topLevel: any[] = []
    for (const r of rawRows) {
      const node = r.clientId ? byId[r.clientId] : { ...r, children: [] }
      if (r.parentClientId && byId[r.parentClientId] && r.parentClientId !== r.clientId) {
        byId[r.parentClientId].children.push(node)
      } else {
        topLevel.push(node)
      }
    }
    // Add children's totals into parents so the parent row represents the
    // full rollup Murtaza expects to see at a glance. Children still render
    // their individual totals when expanded, so no data is hidden.
    function sumWithChildren(node: any): any {
      let billing = node.billing, thirdParty = node.thirdParty, netRevenue = node.netRevenue
      for (const c of node.children) {
        const childSum = sumWithChildren(c)
        billing += childSum.billing
        thirdParty += childSum.thirdParty
        netRevenue += childSum.netRevenue
      }
      // Mutate the rendered node with rollup totals; keep `selfBilling` etc.
      // for the UI to show "Direct vs rollup" if ever needed.
      node.selfBilling = node.billing
      node.selfThirdParty = node.thirdParty
      node.selfNetRevenue = node.netRevenue
      node.billing = Math.round(billing * 100) / 100
      node.thirdParty = Math.round(thirdParty * 100) / 100
      node.netRevenue = Math.round(netRevenue * 100) / 100
      return { billing, thirdParty, netRevenue }
    }
    for (const n of topLevel) sumWithChildren(n)
    // Resort: the rollup totals may have reshuffled order
    topLevel.sort((a, b) => b.billing - a.billing)
    return topLevel
  }, [rawRows, viewMode])

  function toggleRow(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ── Export shape ──────────────────────────────────────────────────────────
  // Flat CSV/Excel (tree structure lost — each row just has its client name).
  // The monthly breakdown is serialized as a single summary column so it
  // survives the round trip to a spreadsheet.
  const exportHeaders = ['Client', 'Currency', 'Total Billing', 'Third Party', 'Net Revenue', 'Rate Card', 'Months']
  const exportRows = () => rawRows.map(r => [
    r.clientName,
    r.currency,
    r.billing,
    r.thirdParty,
    r.netRevenue,
    r.rateCardConfigured ? (r.rateCardName || '(configured)') : '(not configured)',
    (r.months || []).map((m: any) => `${m.month.slice(0, 7)}: ${formatCurrency(m.billing, r.currency)}`).join(' | '),
  ])
  const rangeLabel = (() => {
    try {
      return `${format(new Date(range.from + 'T00:00:00'), 'MMM yyyy')} — ${format(new Date(range.to + 'T00:00:00'), 'MMM yyyy')}`
    } catch { return `${range.from} → ${range.to}` }
  })()
  const tag = `Partner-Billing-${range.from}-to-${range.to}`

  return (
    <div>
      {/* Filter bar — date range + view toggle + export */}
      <div className="flex items-center gap-2 flex-wrap mb-3.5">
        <DateRangePicker
          from={dateFrom} to={dateTo}
          onFromChange={onDateFromChange} onToChange={onDateToChange}
        />
        <div className="w-px h-6 bg-line-subtle" />
        {/* View toggle — tree default (parent/child rollup), flat option for
            raw auditing. Both use the same data; only the rendering differs. */}
        <div className="inline-flex gap-0.5 p-0.5 bg-surface-raised border border-line-subtle rounded-md">
          {(['tree', 'flat'] as const).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer',
                viewMode === m
                  ? 'bg-accent-dim text-accent'
                  : 'text-secondary hover:text-primary hover:bg-surface-hover',
              )}
              aria-pressed={viewMode === m}
              title={m === 'tree'
                ? 'Group sub-clients under their parent (Nexa Cognition → Redwood, Bespoke)'
                : 'Show every client on its own row'}
            >
              {m === 'tree' ? 'Grouped' : 'Flat'}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          {rawRows.length > 0 && (
            <ExportMenu
              onCSV={() => downloadCSV(`${tag}.csv`, exportHeaders, exportRows())}
              onExcel={() => downloadXLSX(`${tag}.xlsx`, exportHeaders, exportRows(), 'Partner Billing')}
              onGoogleSheet={async () => {
                const popup = window.open('about:blank', '_blank')
                try {
                  const res: any = await reportsApi.exportGoogleSheet({
                    title: `NextTrack — Partner Billing — ${rangeLabel}`,
                    sheets: [{ name: 'Partner Billing', headers: exportHeaders, rows: exportRows() }],
                  })
                  if (popup) popup.location.href = res.url
                  else showToast.success(`Sheet created: ${res.url}`)
                } catch (e: any) {
                  if (popup) popup.close()
                  showToast.error('Export failed: ' + (e?.message || 'unknown'))
                }
              }}
            />
          )}
        </div>
      </div>

      {/* Revenue breakdown — same three-column math as Client Profitability
          so the numbers reconcile across reports. Per-currency StatCards
          below if multiple currencies are present. */}
      <Card className="p-4 mb-3.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">
          Billing for {rangeLabel}
        </div>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-xs text-muted">Total Billing</div>
            <div className="text-2xl font-bold text-primary tabular-nums mt-0.5">{formatCurrency(totals.billing)}</div>
            <div className="text-[11px] text-muted mt-0.5">sales + third party (on the invoice)</div>
          </div>
          <div>
            <div className="text-xs text-muted">− Third Party Cost</div>
            <div className="text-2xl font-bold text-secondary tabular-nums mt-0.5">{formatCurrency(totals.thirdParty)}</div>
            <div className="text-[11px] text-muted mt-0.5">passed through to suppliers</div>
          </div>
          <div>
            <div className="text-xs text-muted">= Net Revenue</div>
            <div className="text-2xl font-bold text-accent tabular-nums mt-0.5">{formatCurrency(totals.netRevenue)}</div>
            <div className="text-[11px] text-muted mt-0.5">what we actually earned</div>
          </div>
        </div>
      </Card>

      {/* Per-currency totals only render when there are 2+ currencies. Most
          months are AED-only, so this block stays hidden most of the time —
          when Nexa UK (GBP) enters the picture, it shows up. */}
      {currencies.length > 1 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 mb-3.5">
          {currencies.map(cur => (
            <StatCard
              key={cur}
              label={`${cur} total`}
              value={formatCurrency(totalsByCurrency[cur].netRevenue, cur)}
              tone="violet"
              sub={`${totalsByCurrency[cur].count} partners · ${formatCurrency(totalsByCurrency[cur].billing, cur)} billed`}
            />
          ))}
        </div>
      )}

      {/* Unmapped-invoices indicator — rows whose client_name_raw couldn't
          be resolved against our clients table. Non-zero almost always means
          the Finance Sheet has a partner spelling we haven't mapped yet. */}
      {totals.unmappedCount > 0 && (
        <div className="mb-3.5 px-3.5 py-2.5 bg-status-amber-dim border border-status-amber/30 rounded text-sm flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5 text-status-amber" />
          <div>
            <span className="font-semibold text-status-amber">{totals.unmappedCount} unmapped invoice row{totals.unmappedCount === 1 ? '' : 's'}.</span>
            <span className="text-secondary ml-1">
              These came in from the Finance Sheet but don't match a client by name. Admin → Import Finance Sheet → Unmatched to map them.
            </span>
          </div>
        </div>
      )}

      {isLoading && <ReportSkeleton kpiCount={0} rowCount={8} />}

      {!isLoading && rawRows.length === 0 && (
        <Card>
          <EmptyState
            title="No invoices in this range"
            description="Partner Billing reads from the Finance Sheet (client_invoices table). If there should be data here, check that the Finance Sheet has been imported for these months (Admin → Import Finance Sheet)."
          />
        </Card>
      )}

      {!isLoading && rawRows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface border-b border-line-subtle">
                <th className="w-6"></th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted text-left">Partner</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted text-left">Rate Card</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted text-right">Billing</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted text-right">Third Party</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted text-right">Net Revenue</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted text-right">Currency</th>
              </tr>
            </thead>
            <tbody>
              {treeRows.map((r, i) => (
                <PartnerBillingRow
                  key={r.clientId || `raw::${r.clientName}`}
                  row={r}
                  depth={0}
                  isLast={i === treeRows.length - 1}
                  expanded={expanded}
                  onToggle={toggleRow}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface border-t border-line-subtle font-semibold">
                <td></td>
                <td className="px-3 py-2 text-secondary">TOTAL — {totals.clientCount} partners</td>
                <td></td>
                <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(totals.billing)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{formatCurrency(totals.thirdParty)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(totals.netRevenue)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  )
}

// ── Row component (recursive for tree mode) ────────────────────────────────
// Renders one client-row; when expanded, renders both its monthly breakdown
// AND its child rows (for Nexa Cognition → sub-clients). Depth drives the
// left-indent so nested rows are visually clear without needing a separate
// table-within-a-table.
function PartnerBillingRow({
  row, depth, isLast, expanded, onToggle,
}: {
  row: any; depth: number; isLast: boolean;
  expanded: Set<string>; onToggle: (id: string) => void;
}) {
  const rowId = row.clientId || `raw::${row.clientName}`
  const isExp = expanded.has(rowId)
  const hasChildren = (row.children || []).length > 0
  const hasMonths   = (row.months || []).length > 0
  const canExpand   = hasChildren || hasMonths
  const indentPx    = depth * 20
  const rateCardConfigured = row.rateCardConfigured

  return (
    <Fragment>
      <tr
        onClick={() => canExpand && onToggle(rowId)}
        className={cn(
          canExpand && 'cursor-pointer hover:bg-surface-hover transition-colors',
          !isLast && 'border-b border-line-subtle',
          depth > 0 && 'bg-surface/30',
        )}
      >
        <td className="px-2 py-2 text-muted" style={{ paddingLeft: 8 + indentPx }}>
          {canExpand && (isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            {depth === 0
              ? <Receipt size={14} className="text-muted flex-shrink-0" />
              : <span className="text-muted text-xs flex-shrink-0">└</span>}
            <span className={cn('truncate', depth === 0 ? 'font-medium text-primary' : 'text-secondary text-xs')}>
              {row.clientName}
            </span>
            {!row.clientId && (
              <Badge variant="warning" className="text-[10px] px-1.5 py-0">unmapped</Badge>
            )}
            {hasChildren && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0">{row.children.length} sub-client{row.children.length === 1 ? '' : 's'}</Badge>
            )}
          </div>
        </td>
        <td className="px-3 py-2">
          {rateCardConfigured
            ? <span className="inline-flex items-center gap-1 text-xs text-accent">
                <CheckCircle2 size={11} /> {row.rateCardName || 'configured'}
              </span>
            : <span className="inline-flex items-center gap-1 text-xs text-muted">
                <AlertCircle size={11} /> not set
              </span>
          }
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-semibold text-primary">
          {formatCurrency(row.billing, row.currency)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-muted">
          {row.thirdParty ? formatCurrency(row.thirdParty, row.currency) : <span className="text-muted">—</span>}
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-semibold text-accent">
          {formatCurrency(row.netRevenue, row.currency)}
        </td>
        <td className="px-3 py-2 text-right text-xs text-muted">{row.currency}</td>
      </tr>

      {/* Expanded: monthly breakdown table for this client. Numbers here are
          the client's OWN invoices (not rolled-up with children) so the audit
          trail is clear — if a parent shows AED 50k but the month table only
          adds up to AED 30k, the other AED 20k is in the sub-clients. */}
      {isExp && hasMonths && (
        <tr className="bg-surface/50">
          <td colSpan={7} className="p-0">
            <div className="px-6 py-2" style={{ paddingLeft: 48 + indentPx }}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">
                Monthly invoices {hasChildren && '(this client only — sub-clients shown below)'}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted">
                    <th className="text-left py-1">Month</th>
                    <th className="text-right py-1">Billing</th>
                    <th className="text-right py-1">Third Party</th>
                    <th className="text-right py-1">Net Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {row.months.map((m: any) => (
                    <tr key={m.month} className="border-t border-line-subtle/50">
                      <td className="py-1 text-secondary">
                        {(() => {
                          try { return format(new Date(m.month + 'T00:00:00'), 'MMM yyyy') } catch { return m.month }
                        })()}
                      </td>
                      <td className="py-1 text-right tabular-nums text-secondary">{formatCurrency(m.billing, m.currency)}</td>
                      <td className="py-1 text-right tabular-nums text-muted">{m.thirdParty ? formatCurrency(m.thirdParty, m.currency) : '—'}</td>
                      <td className="py-1 text-right tabular-nums text-primary">{formatCurrency(m.netRevenue, m.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}

      {/* Expanded: render child rows recursively. Parent's row above already
          shows the rolled-up total, and each child row here is that child's
          own standalone view (expandable independently). */}
      {isExp && hasChildren && row.children.map((c: any, ci: number) => (
        <PartnerBillingRow
          key={c.clientId || `raw::${c.clientName}`}
          row={c}
          depth={depth + 1}
          isLast={ci === row.children.length - 1 && !hasMonths ? false : ci === row.children.length - 1}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </Fragment>
  )
}
