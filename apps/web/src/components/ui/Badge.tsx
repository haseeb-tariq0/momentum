import { cn } from '@/lib/cn'
import type { HTMLAttributes } from 'react'

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'outline'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant
  dot?: boolean
}

const variantStyles: Record<Variant, string> = {
  default:
    'bg-surface-overlay text-secondary border-line-subtle',
  success:
    'bg-[rgba(16,185,129,0.12)] text-[#10B981] border-[rgba(16,185,129,0.2)]',
  warning:
    'bg-status-amber-dim text-status-amber border-[rgba(245,158,11,0.2)]',
  danger:
    'bg-status-rose-dim text-status-rose border-[rgba(244,63,94,0.2)]',
  info:
    'bg-status-sky-dim text-status-sky border-[rgba(56,189,248,0.2)]',
  violet:
    'bg-status-violet-dim text-status-violet border-[rgba(139,92,246,0.2)]',
  outline:
    'bg-transparent text-secondary border-line-muted',
}

const dotColors: Record<Variant, string> = {
  default: 'bg-muted',
  success: 'bg-[#10B981]',
  warning: 'bg-status-amber',
  danger:  'bg-status-rose',
  info:    'bg-status-sky',
  violet:  'bg-status-violet',
  outline: 'bg-text-tertiary',
}

function Badge({ className, variant = 'default', dot, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border',
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColors[variant])} />}
      {children}
    </span>
  )
}

export { Badge, type BadgeProps }
