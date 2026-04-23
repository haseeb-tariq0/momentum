'use client'
import {
  useEffect, useId, useMemo, useRef, useState, useCallback,
  type ReactNode, type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { ChevronDown, Check, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ──────────────────────────────────────────────────────────────────────────
 * <Combobox> — searchable dropdown
 *
 * Use this instead of <Select> / <Dropdown> when the list is long enough that
 * users need to type to find an item (clients, people, projects, labels…).
 *
 * Behavior: click to open → search input is auto-focused → typing filters the
 * list case-insensitively (matches label + description) → arrow keys move
 * highlight → Enter picks → Esc closes. Optional clear button on the trigger.
 *
 * Styling follows the same tokens as Dropdown (bg-surface / rounded-md /
 * focus-accent) so pickers in the same form row align visually.
 * ──────────────────────────────────────────────────────────────────────── */

export interface ComboboxOption<T extends string | number = string> {
  value: T
  label: string
  /** Small visual marker — e.g. avatar, flag, colored dot */
  icon?: ReactNode
  /** Greyed-out second line under the label — also searchable */
  description?: string
  disabled?: boolean
}

interface ComboboxProps<T extends string | number> {
  value: T | null | undefined
  onChange: (value: T | null) => void
  options: ComboboxOption<T>[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  /** Show an × button on the trigger that clears the value. */
  clearable?: boolean
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
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

export function Combobox<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches',
  clearable = false,
  size = 'md',
  disabled,
  id,
  className,
  'aria-label': ariaLabel,
}: ComboboxProps<T>) {
  const reactId = useId()
  const listboxId = id ?? reactId
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef   = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; minWidth: number }>({ top: 0, left: 0, minWidth: 0 })

  const selected = useMemo(
    () => options.find(o => o.value === value),
    [options, value],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      (o.description?.toLowerCase().includes(q) ?? false)
    )
  }, [options, query])

  const openMenu = useCallback(() => {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const gap = 6
      const panelMaxH = 320
      const fitsBelow = rect.bottom + gap + panelMaxH < window.innerHeight
      // Clamp left so the panel never overflows the viewport right edge.
      const edgeGap = 12
      const panelMinW = rect.width
      const maxLeft = Math.max(edgeGap, window.innerWidth - panelMinW - edgeGap)
      setPanelPos({
        top:  fitsBelow ? rect.bottom + gap : rect.top - gap - Math.min(panelMaxH, rect.top - gap - 8),
        left: Math.min(rect.left, maxLeft),
        minWidth: panelMinW,
      })
    }
    setOpen(true)
    setQuery('')
    setHighlight(0)
  }, [disabled])

  const closeMenu = useCallback((returnFocus = true) => {
    setOpen(false)
    setQuery('')
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  // Click-outside
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      closeMenu(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open, closeMenu])

  // Autofocus search input on open
  useEffect(() => {
    if (open) {
      // Microtask so the input exists before focus
      queueMicrotask(() => inputRef.current?.focus())
    }
  }, [open])

  // Keep highlight in range when filter changes
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1))
  }, [filtered.length, highlight])

  // Scroll highlighted into view
  useEffect(() => {
    if (!open) return
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  function onTriggerKeyDown(e: ReactKeyboardEvent) {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu()
    }
  }

  function onInputKeyDown(e: ReactKeyboardEvent) {
    const len = filtered.length
    const nextEnabled = (from: number, dir: 1 | -1) => {
      if (!len) return -1
      for (let i = 1; i <= len; i++) {
        const idx = (from + dir * i + len * 2) % len
        if (!filtered[idx].disabled) return idx
      }
      return from
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => nextEnabled(h, 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => nextEnabled(h, -1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlight >= 0 && highlight < len && !filtered[highlight].disabled) {
        onChange(filtered[highlight].value)
        closeMenu()
      }
    }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu() }
    else if (e.key === 'Tab') { closeMenu(false) }
  }

  const hasValue = value !== null && value !== undefined && value !== ('' as T)

  return (
    <div className={cn('relative inline-block w-full', className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={cn(triggerBase, sizeStyles[size], 'pr-9 text-left')}
      >
        <span className="flex items-center gap-2 truncate">
          {selected?.icon}
          <span className={cn('truncate', !selected && 'text-muted')}>
            {selected?.label ?? placeholder}
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
        ) : (
          <ChevronDown
            aria-hidden
            strokeWidth={2.25}
            className={cn(
              'pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted transition-transform duration-150',
              open && 'rotate-180 text-accent',
            )}
          />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={listboxId}
          role="listbox"
          onMouseDown={e => e.nativeEvent.stopPropagation()}
          className="fixed z-popover bg-surface-raised border border-line-muted rounded-xl shadow-md animate-popup-slide origin-top overflow-hidden"
          style={{ top: panelPos.top, left: panelPos.left, minWidth: panelPos.minWidth, maxWidth: Math.max(panelPos.minWidth, 360) }}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-line-subtle">
            <Search className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setHighlight(0) }}
              onKeyDown={onInputKeyDown}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm text-primary placeholder:text-muted outline-none"
            />
            {query && (
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); setQuery(''); inputRef.current?.focus() }}
                className="text-muted hover:text-primary shrink-0"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2.5 text-sm text-muted">{emptyMessage}</div>
            )}
            {filtered.map((opt, idx) => {
              const isSelected = opt.value === value
              const isHighlighted = idx === highlight
              return (
                <div
                  key={`${String(opt.value)}-${idx}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  onMouseEnter={() => !opt.disabled && setHighlight(idx)}
                  onMouseDown={e => {
                    e.preventDefault()
                    if (opt.disabled) return
                    onChange(opt.value)
                    closeMenu()
                  }}
                  className={cn(
                    'mx-1 flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm select-none transition-colors duration-100',
                    opt.disabled && 'opacity-50 cursor-not-allowed',
                    !opt.disabled && 'cursor-pointer',
                    isSelected
                      ? 'bg-accent-dim text-accent font-medium'
                      : isHighlighted && !opt.disabled
                        ? 'bg-surface-overlay text-primary'
                        : 'text-secondary',
                  )}
                >
                  {opt.icon && <span className="mt-0.5 shrink-0">{opt.icon}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{opt.label}</div>
                    {opt.description && (
                      <div className="text-xs text-muted truncate mt-0.5">{opt.description}</div>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" aria-hidden />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
