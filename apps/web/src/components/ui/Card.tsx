import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Enable hover-lift micro-interaction — shadow grows, card rises 1px on hover,
   *  settles on active. Use for clickable/navigable cards; leave off for static
   *  containers. */
  interactive?: boolean
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'bg-surface-raised border border-line-subtle rounded-lg shadow-sm',
        interactive && [
          'transition-all duration-150',
          'hover:shadow-md hover:-translate-y-px hover:border-line-muted',
          'active:translate-y-0 active:shadow-sm',
          'cursor-pointer',
        ],
        className,
      )}
      {...props}
    />
  )
)
Card.displayName = 'Card'

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('px-5 py-4 border-b border-line-subtle', className)}
      {...props}
    />
  )
)
CardHeader.displayName = 'CardHeader'

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('px-5 py-4', className)}
      {...props}
    />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('px-5 py-3 border-t border-line-subtle', className)}
      {...props}
    />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardContent, CardFooter }
