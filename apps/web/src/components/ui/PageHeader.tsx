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
        'flex items-end justify-between flex-wrap gap-3 mb-6',
        className,
      )}
    >
      <div className="min-w-0">
        {/* Display-tier title — heavier weight + tighter tracking than before
            so page titles feel like Linear / Height / Vercel rather than
            a generic CMS section header. font-heading picks up the brand
            heading font (var --font-heading in globals.css). */}
        <h1 className="font-heading text-[28px] sm:text-[30px] font-bold text-primary tracking-[-0.02em] leading-none mb-1.5">
          {title}
        </h1>
        {subtitle && (
          <div className="text-sm text-muted leading-snug">{subtitle}</div>
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
