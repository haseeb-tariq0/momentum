import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface EmptyStateProps {
  /** Optional Lucide icon component */
  icon?: ReactNode
  title: string
  description?: ReactNode
  /** Primary action — usually a Button */
  action?: ReactNode
  className?: string
}

/**
 * Centered empty state for "no results", "nothing here yet", error fallbacks.
 * Use inside a Card or as a standalone block.
 */
function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center px-6 py-12',
        className,
      )}
    >
      {icon && (
        <div className="text-muted mb-3 [&_svg]:w-8 [&_svg]:h-8">{icon}</div>
      )}
      <div className="text-base font-medium text-primary mb-1">{title}</div>
      {description && (
        <div className="text-sm text-muted mb-4 max-w-sm">{description}</div>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export { EmptyState }
