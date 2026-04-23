import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type LabelHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const inputBase =
  'w-full bg-surface border border-line-muted rounded-md px-3 py-2 text-base text-primary placeholder:text-muted font-body outline-none transition-colors duration-150 focus:border-accent focus:ring-[3px] focus:ring-accent-dim disabled:opacity-50 disabled:cursor-not-allowed'

/* ── Input ─────────────────────────────────────────────────────── */
const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputBase, className)} {...props} />
  )
)
Input.displayName = 'Input'

/* ── Textarea ──────────────────────────────────────────────────── */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(inputBase, 'min-h-[80px] resize-y', className)} {...props} />
  )
)
Textarea.displayName = 'Textarea'

/* ── Label ─────────────────────────────────────────────────────── */
function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block text-sm font-medium text-secondary mb-1.5', className)}
      {...props}
    />
  )
}

export { Input, Textarea, Label }
