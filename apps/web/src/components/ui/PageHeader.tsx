import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  /** Right-aligned actions: buttons, view toggles, etc. */
  actions?: ReactNode
  className?: string
}

/**
 * Standard page header — title + optional subtitle on the left,
 * optional actions on the right. Wraps gracefully on narrow screens.
 *
 * Use at the top of every dashboard page so titles are visually consistent.
 */
function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-end justify-between flex-wrap gap-3 mb-5',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold text-primary tracking-[-0.01em] mb-1">
          {title}
        </h1>
        {subtitle && (
          <div className="text-sm text-muted">{subtitle}</div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}

export { PageHeader }
