import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'

type Tone = 'default' | 'accent' | 'amber' | 'rose' | 'violet' | 'profit' | 'loss'

interface StatCardProps {
  label: string
  value: ReactNode
  /** Sub-text below the value (e.g. "of 58 active") */
  sub?: ReactNode
  tone?: Tone
  /** Optional delta chip: positive → up arrow + green, negative → down arrow + red, 0 → flat. */
  delta?: { value: number; label?: string; /** When lower is better (e.g. overdue count), flip the color */ invert?: boolean }
  /** Optional sparkline — 4–24 numeric points, rendered as a 60×18 inline SVG. */
  sparkline?: number[]
  /** Click handler — when provided the card behaves like a tile (hover + pointer cursor). */
  onClick?: () => void
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

const sparklineStroke: Record<Tone, string> = {
  default: 'var(--text-secondary)',
  accent:  'var(--accent)',
  amber:   'var(--amber)',
  rose:    'var(--rose)',
  violet:  'var(--violet)',
  profit:  'var(--profit)',
  loss:    'var(--loss)',
}

function DeltaChip({ value, label, invert }: { value: number; label?: string; invert?: boolean }) {
  const isUp   = value > 0
  const isDown = value < 0
  // "good" direction = up by default, flipped when invert=true (e.g. overdue count
  // going down is good, not bad).
  const good = invert ? isDown : isUp
  const bad  = invert ? isUp   : isDown
  const Icon = isUp ? ArrowUp : isDown ? ArrowDown : Minus
  const toneCls = good
    ? 'bg-[rgba(16,185,129,0.12)] text-[#10B981]'
    : bad
      ? 'bg-status-rose-dim text-status-rose'
      : 'bg-surface-overlay text-muted'
  const formatted = isUp
    ? `+${value}`
    : isDown
      ? `${value}`  // already has minus
      : '0'
  return (
    <span className={cn('inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[10px] font-semibold tabular-nums', toneCls)}>
      <Icon size={10} />
      {formatted}
      {label && <span className="text-muted font-normal ml-0.5">{label}</span>}
    </span>
  )
}

function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  if (!data.length) return null
  const w = 60
  const h = 18
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const step = w / Math.max(1, data.length - 1)
  // Build the path with a 1px top/bottom inset so the stroke doesn't clip.
  const points = data.map((v, i) => {
    const x = i * step
    const y = h - 1 - ((v - min) / span) * (h - 2)
    return [x, y] as const
  })
  const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
    </svg>
  )
}

/**
 * KPI / metric card. Use in a grid for the page's stat strip.
 *
 * Adds `delta` (±N with arrow) and `sparkline` (inline mini trend) since
 * the Apr 24 UI pass — raw numbers felt decontextualized.
 */
function StatCard({ label, value, sub, tone = 'default', delta, sparkline, onClick, className }: StatCardProps) {
  const hasTrail = delta || sparkline
  const Container: any = onClick ? 'button' : 'div'
  return (
    <Container
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'bg-surface-raised border border-line-subtle rounded-lg px-4 py-3.5 text-left block w-full',
        'transition-all duration-150',
        onClick && 'cursor-pointer hover:border-line-muted hover:shadow-sm hover:-translate-y-px active:translate-y-0',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
          {label}
        </div>
        {delta && <DeltaChip {...delta} />}
      </div>
      <div className="flex items-end justify-between gap-3 mt-1.5">
        <div className={cn('text-2xl font-bold leading-none mb-1 tabular-nums', valueColor[tone])}>
          {value}
        </div>
        {sparkline && <Sparkline data={sparkline} stroke={sparklineStroke[tone]} />}
      </div>
      {sub && <div className={cn('text-xs text-muted', hasTrail ? 'mt-0.5' : '')}>{sub}</div>}
    </Container>
  )
}

export { StatCard, type StatCardProps }
