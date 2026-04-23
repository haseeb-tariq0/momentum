import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'default' | 'accent' | 'amber' | 'rose' | 'violet' | 'profit' | 'loss'

interface StatCardProps {
  label: string
  value: ReactNode
  /** Sub-text below the value (e.g. "of 58 active") */
  sub?: ReactNode
  tone?: Tone
  className?: string
}

const valueColor: Record<Tone, string> = {
  default: 'text-primary',
  accent:  'text-accent',
  amber:   'text-status-amber',
  rose:    'text-status-rose',
  violet:  'text-status-violet',
  profit:  'text-status-profit',
  loss:    'text-status-loss',
}

/**
 * KPI / metric card. Use in a grid for the page's stat strip.
 *
 * Example:
 *   <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-5">
 *     <StatCard label="Total" value={42} sub="active" />
 *     <StatCard label="Overdue" value={3} tone="rose" />
 *   </div>
 */
function StatCard({ label, value, sub, tone = 'default', className }: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-surface-raised border border-line-subtle rounded-lg px-4 py-3.5',
        className,
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">
        {label}
      </div>
      <div className={cn('text-2xl font-bold leading-none mb-1 tabular-nums', valueColor[tone])}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  )
}

export { StatCard, type StatCardProps }
