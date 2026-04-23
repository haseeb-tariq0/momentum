'use client'

import { Skeleton } from '@/components/ui'

/**
 * Consistent loading state for every report tab.
 *
 * Before: each report had its own "Loading projects…" / "Calculating cost of
 * effort…" / "Generating partner report…" text message, so the section felt
 * inconsistent when switching tabs (some animated, some static, some noisy).
 *
 * This component mimics the final layout of a typical report (KPI row → table)
 * with pulsing skeletons so the page height stays stable while data loads.
 *
 * Variants:
 *   - "full"  — KPIs row + table rows (default, for data-heavy reports).
 *   - "table" — table rows only (for reports with no KPIs, like the detail
 *               tables inside Partner Billing or the Client Timesheet groups).
 */
export function ReportSkeleton({
  variant = 'full',
  kpiCount = 4,
  rowCount = 8,
}: {
  variant?: 'full' | 'table'
  kpiCount?: number
  rowCount?: number
}) {
  return (
    <div className="space-y-3" aria-label="Loading report" aria-busy="true">
      {variant === 'full' && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${kpiCount}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: kpiCount }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      )}
      <div className="space-y-2">
        {Array.from({ length: rowCount }).map((_, i) => (
          <Skeleton key={i} className="h-11 rounded-md" />
        ))}
      </div>
    </div>
  )
}
