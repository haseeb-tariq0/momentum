'use client'

import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, subWeeks, addDays } from 'date-fns'
import { Button, DatePicker } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * Shared date range picker used across the reports section.
 *
 * Moved here (Apr 21) so the exact same component is used on every tab that
 * needs a date range — previously it was defined locally in page.tsx and the
 * Client Report / Cost of Effort tabs had no visible date picker at all, even
 * though they read from the same dateFrom / dateTo state.
 *
 * Design decisions from the Apr 21 review:
 *   - No "FROM" / "TO" labels. Two date inputs with a small arrow between are
 *     self-evidently a range.
 *   - Presets limited to This Month / Last Month / Last Week. Q1/Q4 quarters
 *     removed — anyone who needs a quarter can type the range directly.
 *   - Used in the filter bar AFTER the primary dropdowns (client / project /
 *     person), not before them. Date is a secondary filter, not the hero.
 */
export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
}) {
  const presets = [
    {
      label: 'This Month',
      from: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
      to: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
    },
    {
      label: 'Last Month',
      from: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
      to: format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    },
    {
      label: 'Last Week',
      from: format(subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1), 'yyyy-MM-dd'),
      to: format(addDays(subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1), 6), 'yyyy-MM-dd'),
    },
  ]
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="inline-flex items-center gap-1.5">
        <div className="w-[140px]">
          <DatePicker value={from || null} onChange={v => onFromChange(v || '')} size="sm" aria-label="Start date" />
        </div>
        <span className="text-muted text-xs select-none" aria-hidden="true">→</span>
        <div className="w-[140px]">
          <DatePicker value={to || null} onChange={v => onToChange(v || '')} size="sm" min={from || undefined} aria-label="End date" />
        </div>
      </div>
      <div className="flex gap-1">
        {presets.map(p => {
          const active = from === p.from && to === p.to
          return (
            <Button
              key={p.label}
              variant="ghost"
              size="sm"
              onClick={() => { onFromChange(p.from); onToChange(p.to) }}
              className={cn(
                active && 'bg-accent-dim text-accent hover:bg-accent-dim hover:text-accent',
              )}
            >
              {p.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
