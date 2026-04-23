'use client'
import { useEffect, useId, useRef, useState, useCallback } from 'react'
import {
  format, parse, isValid, startOfMonth, endOfMonth, addMonths, subMonths,
  startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, isAfter, isBefore,
  isToday as isTodayFn,
} from 'date-fns'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ──────────────────────────────────────────────────────────────────────────
 * <DatePicker> — popover month-grid calendar
 *
 * Replaces native <input type="date"> which renders differently in every
 * browser and can't be themed. Stores values as ISO YYYY-MM-DD strings to
 * stay compatible with existing code that used date inputs.
 * ──────────────────────────────────────────────────────────────────────── */

interface DatePickerProps {
  value: string | null | undefined           // ISO YYYY-MM-DD
  onChange: (value: string | null) => void
  placeholder?: string
  min?: string                                // ISO YYYY-MM-DD
  max?: string                                // ISO YYYY-MM-DD
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

function parseISO(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parse(value, 'yyyy-MM-dd', new Date())
  return isValid(d) ? d : null
}

function toISO(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  min,
  max,
  disabled,
  clearable = false,
  size = 'md',
  id,
  className,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const reactId = useId()
  const panelId = id ?? reactId
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef   = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const selectedDate = parseISO(value)
  const minDate = parseISO(min || null)
  const maxDate = parseISO(max || null)
  const [viewMonth, setViewMonth] = useState<Date>(() => selectedDate || new Date())

  // Keep view month in sync when value changes externally
  useEffect(() => {
    if (selectedDate) setViewMonth(selectedDate)
    // only when value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const openPanel = useCallback(() => {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const gap = 6
      const panelH = 320
      const panelW = 280
      const fitsBelow = rect.bottom + gap + panelH < window.innerHeight
      setPanelPos({
        top:  fitsBelow ? rect.bottom + gap : Math.max(8, rect.top - gap - panelH),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - panelW - 8)),
      })
    }
    setOpen(true)
    setViewMonth(selectedDate || new Date())
  }, [disabled, selectedDate])

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

  function isDisabledDay(d: Date): boolean {
    if (minDate && isBefore(d, minDate)) return true
    if (maxDate && isAfter(d, maxDate)) return true
    return false
  }

  function pickDay(d: Date) {
    if (isDisabledDay(d)) return
    onChange(toISO(d))
    closePanel()
  }

  // Build 6×7 day grid for the visible month
  const monthStart = startOfMonth(viewMonth)
  const monthEnd   = endOfMonth(viewMonth)
  // Start from Monday to match most of Europe/MENA business calendars.
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd   = endOfWeek(monthEnd,   { weekStartsOn: 1 })
  const days: Date[] = []
  for (let d = gridStart; !isAfter(d, gridEnd); d = addDays(d, 1)) days.push(d)

  const today = new Date()
  const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

  const hasValue = !!selectedDate

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
          <span className={cn('truncate', !hasValue && 'text-muted')}>
            {selectedDate ? format(selectedDate, 'd MMM yyyy') : placeholder}
          </span>
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
          aria-label="Choose date"
          onMouseDown={e => e.nativeEvent.stopPropagation()}
          className="fixed z-popover bg-surface-raised border border-line-muted rounded-xl shadow-md animate-popup-slide origin-top p-3 w-[280px]"
          style={{ top: panelPos.top, left: panelPos.left }}
        >
          {/* Month header */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewMonth(m => subMonths(m, 1))}
              className="p-1 rounded hover:bg-surface-overlay text-muted hover:text-primary"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-semibold text-primary select-none">
              {format(viewMonth, 'MMMM yyyy')}
            </div>
            <button
              type="button"
              onClick={() => setViewMonth(m => addMonths(m, 1))}
              className="p-1 rounded hover:bg-surface-overlay text-muted hover:text-primary"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Weekday row */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(w => (
              <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted py-1 select-none">
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d, i) => {
              const inMonth = isSameMonth(d, viewMonth)
              const isSel   = !!selectedDate && isSameDay(d, selectedDate)
              const isTdy   = isTodayFn(d)
              const dis     = isDisabledDay(d)
              return (
                <button
                  key={i}
                  type="button"
                  disabled={dis}
                  onClick={() => pickDay(d)}
                  className={cn(
                    'h-8 w-full text-xs rounded-md transition-colors select-none',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    dis && 'opacity-30 cursor-not-allowed',
                    !dis && !isSel && 'hover:bg-surface-overlay',
                    !inMonth && !isSel && 'text-muted',
                    inMonth && !isSel && !dis && 'text-primary',
                    isSel && 'bg-accent text-white font-semibold hover:bg-accent',
                    !isSel && isTdy && 'ring-1 ring-accent text-accent font-semibold',
                  )}
                >
                  {format(d, 'd')}
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-line-subtle">
            <button
              type="button"
              onClick={() => { const t = new Date(); if (!isDisabledDay(t)) { onChange(toISO(t)); closePanel() } }}
              className="text-xs text-accent hover:underline font-medium"
            >
              Today
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
