'use client'
import { useEffect, useId, useRef, useState, useCallback } from 'react'
import { format, parse, isValid } from 'date-fns'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ──────────────────────────────────────────────────────────────────────────
 * <MonthPicker> — popover month + year picker
 *
 * Replaces native <input type="month"> which renders differently per browser
 * and can't be themed. Stores values as "YYYY-MM" strings for compatibility.
 * ──────────────────────────────────────────────────────────────────────── */

interface MonthPickerProps {
  value: string | null | undefined           // "YYYY-MM"
  onChange: (value: string | null) => void
  placeholder?: string
  min?: string                                // "YYYY-MM"
  max?: string                                // "YYYY-MM"
  disabled?: boolean
  clearable?: boolean
  size?: 'sm' | 'md' | 'lg'
  id?: string
  className?: string
  'aria-label'?: string
}

const triggerBase =
  'inline-flex items-center justify-between gap-2 w-full bg-surface border border-line-muted ' +
  'text-primary font-body leading-none outline-none transition-colors duration-150 cursor-pointer ' +
  'hover:border-line-strong focus:border-accent focus:shadow-accent ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

const sizeStyles = {
  sm: 'h-7  px-2.5 text-xs  rounded-md',
  md: 'h-9  px-3   text-sm  rounded-md',
  lg: 'h-10 px-3.5 text-base rounded-md',
} as const

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function parseYM(v: string | null | undefined): { year: number; month: number } | null {
  if (!v) return null
  const d = parse(v + '-01', 'yyyy-MM-dd', new Date())
  return isValid(d) ? { year: d.getFullYear(), month: d.getMonth() } : null
}

function toYM(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function compareYM(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function MonthPicker({
  value,
  onChange,
  placeholder = 'Pick month',
  min,
  max,
  disabled,
  clearable = false,
  size = 'md',
  id,
  className,
  'aria-label': ariaLabel,
}: MonthPickerProps) {
  const reactId = useId()
  const panelId = id ?? reactId
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef   = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const selected = parseYM(value)
  const [viewYear, setViewYear] = useState<number>(() => selected?.year ?? new Date().getFullYear())

  useEffect(() => {
    if (selected) setViewYear(selected.year)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const openPanel = useCallback(() => {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const gap = 6
      const panelH = 240
      const panelW = 240
      const fitsBelow = rect.bottom + gap + panelH < window.innerHeight
      setPanelPos({
        top:  fitsBelow ? rect.bottom + gap : Math.max(8, rect.top - gap - panelH),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - panelW - 8)),
      })
    }
    setOpen(true)
    setViewYear(selected?.year ?? new Date().getFullYear())
  }, [disabled, selected])

  const closePanel = useCallback((returnFocus = true) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  // Click-outside
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      closePanel(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open, closePanel])

  // Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closePanel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closePanel])

  function isDisabledMonth(year: number, month: number): boolean {
    const ym = toYM(year, month)
    if (min && compareYM(ym, min) < 0) return true
    if (max && compareYM(ym, max) > 0) return true
    return false
  }

  function pickMonth(month: number) {
    if (isDisabledMonth(viewYear, month)) return
    onChange(toYM(viewYear, month))
    closePanel()
  }

  const hasValue = !!selected
  const triggerLabel = selected
    ? format(new Date(selected.year, selected.month, 1), 'MMMM yyyy')
    : placeholder

  const currentYear = new Date().getFullYear()

  return (
    <div className={cn('relative inline-block w-full', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? closePanel(false) : openPanel())}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault()
            openPanel()
          }
        }}
        className={cn(triggerBase, sizeStyles[size], 'pr-9 text-left')}
      >
        <span className="flex items-center gap-2 truncate">
          <Calendar className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden />
          <span className={cn('truncate', !hasValue && 'text-muted')}>{triggerLabel}</span>
        </span>
        {clearable && hasValue && !disabled ? (
          <span
            role="button"
            aria-label="Clear"
            tabIndex={-1}
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange(null) }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-overlay text-muted hover:text-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </span>
        ) : null}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Choose month"
          onMouseDown={e => e.nativeEvent.stopPropagation()}
          className="fixed z-popover bg-surface-raised border border-line-muted rounded-xl shadow-md animate-popup-slide origin-top p-3 w-[240px]"
          style={{ top: panelPos.top, left: panelPos.left }}
        >
          {/* Year header */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setViewYear(y => y - 1)}
              className="p-1 rounded hover:bg-surface-overlay text-muted hover:text-primary"
              aria-label="Previous year"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-semibold text-primary select-none">{viewYear}</div>
            <button
              type="button"
              onClick={() => setViewYear(y => y + 1)}
              className="p-1 rounded hover:bg-surface-overlay text-muted hover:text-primary"
              aria-label="Next year"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Month grid 3×4 */}
          <div className="grid grid-cols-3 gap-1">
            {MONTHS_SHORT.map((label, idx) => {
              const isSel = !!selected && selected.year === viewYear && selected.month === idx
              const isCurrent = viewYear === currentYear && idx === new Date().getMonth()
              const dis = isDisabledMonth(viewYear, idx)
              return (
                <button
                  key={label}
                  type="button"
                  disabled={dis}
                  onClick={() => pickMonth(idx)}
                  className={cn(
                    'h-9 text-sm rounded-md transition-colors select-none',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    dis && 'opacity-30 cursor-not-allowed',
                    !dis && !isSel && 'hover:bg-surface-overlay text-primary',
                    isSel && 'bg-accent text-white font-semibold hover:bg-accent',
                    !isSel && isCurrent && 'ring-1 ring-accent text-accent font-semibold',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-line-subtle">
            <button
              type="button"
              onClick={() => {
                const now = new Date()
                const ym = toYM(now.getFullYear(), now.getMonth())
                if (!(min && compareYM(ym, min) < 0) && !(max && compareYM(ym, max) > 0)) {
                  onChange(ym)
                  closePanel()
                }
              }}
              className="text-xs text-accent hover:underline font-medium"
            >
              This month
            </button>
            {clearable && hasValue && (
              <button
                type="button"
                onClick={() => { onChange(null); closePanel() }}
                className="text-xs text-muted hover:text-status-rose"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
