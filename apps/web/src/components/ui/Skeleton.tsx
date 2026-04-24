import { cn } from '@/lib/cn'
import type { HTMLAttributes } from 'react'

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-md bg-surface-overlay',
        'bg-gradient-to-r from-surface-overlay via-surface-hover to-surface-overlay',
        'bg-[length:200%_100%] animate-skeleton',
        className,
      )}
      {...props}
    />
  )
}

/* Pre-composed skeleton shapes */
function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  )
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('bg-surface-raised border border-line-subtle rounded-lg p-5 space-y-3', className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 py-3', className)}>
      <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
      <Skeleton className="h-5 w-16 rounded" />
    </div>
  )
}

/** Matches the visual rhythm of <StatCard>. Use for page stat strips. */
function SkeletonStat({ className }: { className?: string }) {
  return (
    <div className={cn('bg-surface-raised border border-line-subtle rounded-lg px-4 py-3.5', className)}>
      <Skeleton className="h-2.5 w-16 mb-2" />
      <Skeleton className="h-7 w-20 mb-1.5" />
      <Skeleton className="h-3 w-24" />
    </div>
  )
}

/** N rows laid out like a typical data table. Pair with a table header. */
function SkeletonTable({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y divide-line-subtle', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid items-center gap-3 px-4 py-3" style={{ gridTemplateColumns: '1fr 120px 120px 80px 80px' }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <Skeleton className="h-7 w-7 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5 min-w-0">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-16 rounded" />
          <Skeleton className="h-5 w-14 rounded" />
        </div>
      ))}
    </div>
  )
}

/** Bar-chart skeleton with pseudo-random heights. Stable per mount. */
function SkeletonChart({ bars = 14, className }: { bars?: number; className?: string }) {
  // Deterministic-ish "random" heights so each render is visually stable
  // without useMemo state. Sine-wave pattern with a mild phase offset.
  const heights = Array.from({ length: bars }).map((_, i) =>
    45 + Math.abs(Math.sin(i * 0.9) * 40) + (i % 3) * 5,
  )
  return (
    <div className={cn('flex items-end gap-1.5 h-[180px] px-2', className)}>
      {heights.map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonText, SkeletonCard, SkeletonRow, SkeletonStat, SkeletonTable, SkeletonChart }
