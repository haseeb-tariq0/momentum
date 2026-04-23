import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { Loader2 } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variantStyles: Record<Variant, string> = {
  primary:
    'bg-accent text-white font-semibold shadow-glow hover:shadow-glow-lg hover:-translate-y-px active:translate-y-0',
  secondary:
    'bg-surface-overlay border border-line-muted text-secondary hover:bg-surface-hover hover:text-primary hover:border-line-muted',
  ghost:
    'text-secondary hover:bg-surface-hover hover:text-primary',
  danger:
    'bg-status-rose text-white font-semibold hover:opacity-90 hover:-translate-y-px active:translate-y-0',
}

const sizeStyles: Record<Size, string> = {
  sm: 'h-7 px-3 text-xs rounded',
  md: 'h-8 px-4 text-sm rounded-md',
  lg: 'h-9 px-5 text-base rounded-md',
  icon: 'h-7 w-7 rounded-md',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium cursor-pointer transition-all duration-150',
          'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
export { Button, type ButtonProps }
