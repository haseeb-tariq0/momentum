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

export { Skeleton, SkeletonText, SkeletonCard, SkeletonRow }
