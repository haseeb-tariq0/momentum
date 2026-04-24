import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface BreadcrumbItem {
  label: string
  /** If omitted, the item renders as plain text (current page). */
  href?: string
  icon?: ReactNode
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  className?: string
}

/**
 * Linear/Height-style breadcrumb trail. Last item is always the current
 * page (no href → rendered as text). Uses small chevrons and muted text
 * so it doesn't compete with the page title below.
 *
 * Drop above a <PageHeader> on any nested route (project detail, user
 * detail, admin sub-pages). Skip on top-level pages — redundant.
 */
function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (!items.length) return null
  return (
    <nav aria-label="Breadcrumb" className={cn('mb-3', className)}>
      <ol className="flex items-center flex-wrap gap-1 text-xs text-muted">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={i} className="flex items-center gap-1 min-w-0">
              {i > 0 && (
                <ChevronRight size={12} className="text-muted/60 flex-shrink-0" aria-hidden />
              )}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="no-underline hover:text-primary transition-colors truncate max-w-[200px] inline-flex items-center gap-1"
                >
                  {item.icon}
                  {item.label}
                </Link>
              ) : (
                <span className={cn(
                  'truncate max-w-[240px] inline-flex items-center gap-1',
                  isLast ? 'text-secondary font-medium' : '',
                )}>
                  {item.icon}
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export { Breadcrumbs }
