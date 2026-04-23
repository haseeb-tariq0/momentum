'use client'
import {
  Children, isValidElement, useEffect, useId, useMemo, useRef, useState, useCallback, Fragment,
  type ReactNode, type SelectHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ──────────────────────────────────────────────────────────────────────────
 * SHARED TOKENS
 *
 * Trigger (closed state) matches Input.tsx — bg-surface + rounded-md — so
 * form rows align. Panel (open state) matches the existing popup language
 * found in ConfirmDialog / GlobalSearch / the resourcing popups:
 * bg-surface-raised + rounded-xl + shadow-md + animate-popup-slide +
 * z-popover. Change these in one place, the whole app updates.
 * ──────────────────────────────────────────────────────────────────────── */

// Closed trigger — mirrors the Input primitive so form rows feel like a family.
const triggerBase =
  'inline-flex items-center justify-between gap-2 w-full bg-surface border border-line-muted ' +
  'text-primary font-body leading-none outline-none transition-colors duration-150 cursor-pointer ' +
  'hover:border-line-strong focus:border-accent focus:shadow-accent ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

// Open panel — position: fixed so it escapes any parent overflow-hidden.
// bg-surface-raised + rounded-xl + shadow-md + entry animation.
// z-popover (400) so it floats above modals (z-modal = 300).
const panelBase =
  'fixed z-popover max-h-72 overflow-y-auto ' +
  'bg-surface-raised border border-line-muted rounded-xl shadow-md ' +
  'py-1 focus:outline-none animate-popup-slide origin-top'

const sizeStyles = {
  sm: 'h-7  px-2.5 text-xs  rounded-md',
  md: 'h-9  px-3   text-sm  rounded-md',
  lg: 'h-10 px-3.5 text-base rounded-md',
} as const

type Size = keyof typeof sizeStyles

/* ──────────────────────────────────────────────────────────────────────────
 * <Dropdown> — headless listbox (the real visual surface)
 *
 * This is THE dropdown for the app. Every <Select> in the codebase is a thin
 * children-parser around this component (see below). Built as an ARIA
 * listbox, not a native <select>, so the menu panel is a real React-rendered
 * surface we can fully theme — no OS-native picker rendering, no double
 * chevron, no platform-specific ugliness.
 *
 * Accessibility:
 *  - role="combobox" on the trigger, role="listbox" on the panel
 *  - aria-activedescendant tracks the highlighted item
 *  - Enter/Space to open, arrow keys to navigate, Home/End to jump, Escape
 *    to close, Tab to close and move focus naturally
 *  - Click-outside to close
 *  - Type-ahead: press a letter to jump to the next option starting with it
 *  - Optgroup-style section headers when options carry a `group` field
 *
 * Positioning is simple absolute-in-relative — fine for dropdowns inside the
 * normal document flow. If you ever need a dropdown inside an
 * overflow-hidden container or near the viewport edge, swap to @floating-ui
 * here and every consumer benefits.
 * ──────────────────────────────────────────────────────────────────────── */

export interface DropdownOption<T = string | number> {
  value: T
  label: string
  /** Small visual marker — e.g. a colored dot for status, a flag for currency */
  icon?: ReactNode
  /** Greyed-out second line under the label */
  description?: string
  disabled?: boolean
  /** Section header — consecutive options sharing the same group are
   *  rendered together under a sticky uppercase label, like <optgroup>. */
  group?: string
}

interface DropdownProps<T = string | number> {
  value: T | null | undefined
  onChange: (value: T) => void
  options: DropdownOption<T>[]
  placeholder?: string
  size?: Size
  /** Visually emphasizes the trigger when a non-default value is picked. */
  highlightWhenSet?: boolean
  className?: string
  /** Custom classes applied to the menu panel (e.g. to widen or constrain it). */
  menuClassName?: string
  disabled?: boolean
  /** Used by label htmlFor + aria-labelledby. */
  id?: string
  'aria-label'?: string
  /** Open the menu immediately on mount — used by inline-edit cells where
   *  the parent renders the dropdown in response to a click and expects the
   *  picker to appear without a second tap. */
  autoOpen?: boolean
  /** Fires whenever the menu closes (by pick, escape, click-outside, tab).
   *  Used by inline-edit cells as the "save on blur" hook. */
  onClose?: () => void
  /** Forwarded to the panel — lets a parent intercept Enter/Escape on top
   *  of the built-in handling (e.g. to commit/cancel an inline edit). */
  onKeyDown?: (e: ReactKeyboardEvent) => void
  /**
   * Custom trigger content. When provided, the default label + chevron is
   * replaced entirely and the button is stripped of all visual styling — the
   * caller owns the look. Use this to turn a Badge, Avatar, or icon-only
   * button into a dropdown trigger while keeping the full a11y + keyboard
   * behavior of the listbox.
   */
  trigger?: (ctx: { selected: DropdownOption<T> | undefined; open: boolean; disabled?: boolean }) => ReactNode
}

function Dropdown<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  size = 'md',
  highlightWhenSet = false,
  className,
  menuClassName,
  disabled,
  id,
  'aria-label': ariaLabel,
  autoOpen = false,
  onClose,
  onKeyDown,
  trigger,
}: DropdownProps<T>) {
  const reactId = useId()
  const listboxId = id ?? reactId
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef   = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState<number>(-1)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; minWidth: number }>({ top: 0, left: 0, minWidth: 0 })

  const selectedIndex = useMemo(
    () => options.findIndex(o => o.value === value),
    [options, value],
  )
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  /* ── Open / close ───────────────────────────────────────────────────── */

  const openMenu = useCallback(() => {
    if (disabled) return
    // Compute fixed position from the trigger button's viewport rect.
    // This lets the panel escape any parent overflow-hidden.
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const gap = 6
      const panelMaxH = 288 // max-h-72 = 18rem = 288px
      const fitsBelow = rect.bottom + gap + panelMaxH < window.innerHeight
      // Clamp horizontal position so the panel never overflows the right edge of
      // the viewport. If the trigger is in a narrow right rail, we slide the
      // panel leftward to keep it fully visible. 12px margin preserves visual
      // breathing room at the viewport edge.
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
    // Start highlight on the current selection, or the first enabled option.
    setHighlight(selectedIndex >= 0 ? selectedIndex : options.findIndex(o => !o.disabled))
  }, [disabled, options, selectedIndex])

  const closeMenu = useCallback((returnFocus = true) => {
    setOpen(false)
    setHighlight(-1)
    if (returnFocus) triggerRef.current?.focus()
    // onClose is NOT fired here — see the open→close effect below. Firing
    // synchronously (or via queueMicrotask) reads stale closure: any state
    // update from the pick that triggered close (parent's onChange) hasn't
    // been committed yet, so save-on-close handlers would see the OLD value.
  }, [])

  /* ── Click-outside ──────────────────────────────────────────────────── */

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

  /* ── autoOpen — for inline-edit cells that render the dropdown on click ─ */

  // Stable ref so the effect only fires once on mount even if openMenu's
  // closure identity churns when options/selectedIndex change.
  const didAutoOpen = useRef(false)
  useEffect(() => {
    if (!autoOpen || didAutoOpen.current || disabled) return
    didAutoOpen.current = true
    openMenu()
  }, [autoOpen, disabled, openMenu])

  /* ── Fire onClose after the open→close transition commits ──────────────
   * Runs in a useEffect (post-commit) so onClose's latest closure is used —
   * this is critical for the inline-edit pattern where the parent updates
   * state in onChange and reads it in onBlur:
   *
   *   onChange={e => setEditing({ ...editing, value: e.target.value })}
   *   onBlur={() => saveEdit(u)}     // reads `editing` via closure
   *
   * Firing synchronously (or via queueMicrotask) would call the OLD
   * saveEdit closure where editing.value is still the pre-pick value, and
   * the wrong value would be saved. The effect waits until React has
   * committed the new state and re-rendered with a fresh onClose closure.
   * ──────────────────────────────────────────────────────────────────── */
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) onClose?.()
    wasOpen.current = open
  }, [open, onClose])

  /* ── Type-ahead buffer ──────────────────────────────────────────────── */

  const typeBuffer = useRef({ text: '', timer: 0 as any })
  const advanceByChar = useCallback((ch: string) => {
    clearTimeout(typeBuffer.current.timer)
    typeBuffer.current.text += ch.toLowerCase()
    const query = typeBuffer.current.text
    const start = highlight >= 0 ? highlight : 0
    const len = options.length
    const startOffset = query.length > 1 ? 0 : 1
    for (let i = 0; i < len; i++) {
      const idx = (start + i + startOffset) % len
      const opt = options[idx]
      if (opt.disabled) continue
      if (opt.label.toLowerCase().startsWith(query)) {
        setHighlight(idx)
        break
      }
    }
    typeBuffer.current.timer = setTimeout(() => { typeBuffer.current.text = '' }, 500)
  }, [highlight, options])

  /* ── Keyboard on the trigger ────────────────────────────────────────── */

  function onTriggerKeyDown(e: ReactKeyboardEvent) {
    if (disabled) return
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        e.preventDefault()
        openMenu()
        break
    }
  }

  /* ── Keyboard on the open panel ─────────────────────────────────────── */

  function onPanelKeyDown(e: ReactKeyboardEvent) {
    const len = options.length
    const nextEnabled = (from: number, dir: 1 | -1) => {
      for (let i = 1; i <= len; i++) {
        const idx = (from + dir * i + len * 2) % len
        if (!options[idx].disabled) return idx
      }
      return from
    }

    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setHighlight(h => nextEnabled(h < 0 ? -1 : h, 1)); break
      case 'ArrowUp':   e.preventDefault(); setHighlight(h => nextEnabled(h < 0 ? len : h, -1)); break
      case 'Home':      e.preventDefault(); setHighlight(options.findIndex(o => !o.disabled)); break
      case 'End':       e.preventDefault(); {
        let i = len - 1
        while (i >= 0 && options[i].disabled) i--
        setHighlight(i)
        break
      }
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (highlight >= 0 && !options[highlight].disabled) {
          onChange(options[highlight].value)
          closeMenu()
        }
        // Let parent handlers (e.g. inline-edit save-on-Enter) also see it.
        onKeyDown?.(e)
        break
      case 'Escape':
        e.preventDefault()
        closeMenu()
        onKeyDown?.(e)
        break
      case 'Tab':
        // Let focus leave naturally, but close the panel first.
        closeMenu(false)
        break
      default:
        // Type-ahead: single printable character.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          advanceByChar(e.key)
        }
        onKeyDown?.(e)
    }
  }

  /* ── Keep highlighted option scrolled into view ─────────────────────── */

  useEffect(() => {
    if (!open || highlight < 0) return
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  /* ── Focus the panel as soon as it mounts so arrow keys work ────────── */

  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  /* ── Render ─────────────────────────────────────────────────────────── */

  const isSet = value !== null && value !== undefined && value !== ''
  const highlightStyles =
    highlightWhenSet && isSet
      ? 'border-line-accent text-accent font-semibold'
      : ''

  // Custom trigger path — caller controls every pixel, we only wire the
  // button for a11y + keyboard.
  const customTriggerContent = trigger?.({ selected, open, disabled })

  return (
    <div className={cn('relative inline-block', className)}>
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
        className={cn(
          customTriggerContent
            ? 'inline-flex items-center rounded-md outline-none cursor-pointer ' +
              'focus-visible:shadow-accent disabled:opacity-50 disabled:cursor-not-allowed'
            : cn(
                triggerBase,
                sizeStyles[size],
                'pr-9 text-left',
                highlightStyles,
              ),
        )}
      >
        {customTriggerContent ?? (
          <>
            <span className="flex items-center gap-2 truncate">
              {selected?.icon}
              <span className={cn('truncate', !selected && 'text-muted')}>
                {selected?.label ?? placeholder}
              </span>
            </span>
            <ChevronDown
              aria-hidden
              strokeWidth={2.25}
              className={cn(
                'pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted transition-transform duration-150',
                open && 'rotate-180 text-accent',
              )}
            />
          </>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={highlight >= 0 ? `${listboxId}-opt-${highlight}` : undefined}
          onKeyDown={onPanelKeyDown}
          // Stop native mousedown from reaching document-level click-outside
          // handlers (e.g. the resourcing popup's onOut). Without this, the
          // native event bubbles past React's root to document, where a
          // parent popup's handler sees the click target as "outside" (the
          // panel may have been unmounted by a React flush between the React
          // handler and the native handler) and incorrectly closes the popup.
          onMouseDown={e => e.nativeEvent.stopPropagation()}
          className={cn(panelBase, menuClassName)}
          style={{ top: panelPos.top, left: panelPos.left, minWidth: panelPos.minWidth }}
        >
          {options.length === 0 && (
            <div className="px-3 py-2.5 text-sm text-muted">No options</div>
          )}
          {(() => {
            // Walk options in order and emit a section header before each
            // run that switches to a new `group`. Native <optgroup> parity.
            let lastGroup: string | undefined
            return options.map((opt, idx) => {
              const isSelected = opt.value === value
              const isHighlighted = idx === highlight
              const showHeader = opt.group != null && opt.group !== lastGroup
              lastGroup = opt.group
              return (
                <Fragment key={`${String(opt.value)}-${idx}`}>
                  {showHeader && (
                    <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted select-none">
                      {opt.group}
                    </div>
                  )}
                  <div
                    id={`${listboxId}-opt-${idx}`}
                    data-idx={idx}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled}
                    onMouseEnter={() => !opt.disabled && setHighlight(idx)}
                    onMouseDown={(e) => {
                      // mousedown (not click) so we fire before the click-outside
                      // handler decides the panel lost focus.
                      e.preventDefault()
                      if (opt.disabled) return
                      onChange(opt.value)
                      closeMenu()
                    }}
                    className={cn(
                      'mx-1 flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm select-none transition-colors duration-100',
                      opt.disabled && 'opacity-50 cursor-not-allowed',
                      !opt.disabled && 'cursor-pointer',
                      // Selected wins over highlighted: tinted accent bg + text
                      // + trailing check. Highlighted (keyboard or hover) uses
                      // bg-surface-overlay — clearly brighter than the panel
                      // bg so the active row visibly lifts off.
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
                </Fragment>
              )
            })
          })()}
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * <Select> — drop-in replacement for native <select>
 *
 * This is a thin wrapper that parses <option> and <optgroup> children into a
 * DropdownOption[] and renders the <Dropdown> above. Same API as a real
 * <select> (value, onChange with event-like signature, defaultValue,
 * autoFocus, onBlur, optgroups, disabled options, placeholder pattern), but
 * the rendered menu is the styled custom listbox — never the OS-native
 * picker.
 *
 * Why a wrapper? When I migrated 27 native <select>s across the app, I
 * naively kept them as real <select>s here, thinking the closed trigger
 * styling was enough. It wasn't — clicking any of them showed the OS picker
 * (Chrome's flat blue list, etc.) which can't be themed because it lives
 * outside the React DOM. Wrapping in <Dropdown> was the right move and
 * required zero caller changes.
 * ──────────────────────────────────────────────────────────────────────── */

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'onChange'> {
  size?: Size
  /** Render a placeholder when value is empty */
  placeholder?: string
  /** Mirrors native onChange — receives an event-like object so existing
   *  handlers like `e => setX(e.target.value)` work unchanged. */
  onChange?: (e: { target: { value: any } }) => void
}

/**
 * Walk a Select's children and produce a flat DropdownOption[]. Recognises
 * <option>, <option disabled hidden> (treated as a placeholder), and
 * <optgroup label="…">. Preserves the original `value` type — number values
 * stay numbers — so callers that do `Number(e.target.value)` keep working.
 */
function parseOptions(children: ReactNode): { options: DropdownOption[]; inferredPlaceholder?: string } {
  const options: DropdownOption[] = []
  let inferredPlaceholder: string | undefined

  function pushOption(props: any, group?: string) {
    if (props.hidden) return
    // <option value="" disabled> is the conventional placeholder — promote it.
    if ((props.value === '' || props.value == null) && props.disabled && !group) {
      inferredPlaceholder = String(props.children ?? '')
      return
    }
    options.push({
      value: props.value,
      label: String(props.children ?? ''),
      disabled: !!props.disabled,
      ...(group && { group }),
    })
  }

  Children.forEach(children, child => {
    if (!isValidElement<any>(child)) return
    if (child.type === 'optgroup') {
      const label = child.props.label as string
      Children.forEach(child.props.children, opt => {
        if (!isValidElement<any>(opt) || opt.type !== 'option') return
        pushOption(opt.props, label)
      })
    } else if (child.type === 'option') {
      pushOption(child.props)
    }
  })

  return { options, inferredPlaceholder }
}

function Select({
  size = 'md',
  placeholder,
  className,
  children,
  value,
  defaultValue,
  onChange,
  onBlur,
  onKeyDown,
  autoFocus,
  disabled,
  id,
  'aria-label': ariaLabel,
}: SelectProps) {
  const { options, inferredPlaceholder } = useMemo(() => parseOptions(children), [children])

  // Uncontrolled fallback — admin's EditableCell uses defaultValue instead
  // of value, expecting native-select uncontrolled behavior. Mirror it.
  const isControlled = value !== undefined
  const [internal, setInternal] = useState<any>(defaultValue ?? '')
  const current = isControlled ? value : internal

  const handleChange = useCallback((next: any) => {
    if (!isControlled) setInternal(next)
    // Synthesize an event-like payload so existing handlers work unchanged:
    //   onChange={e => setX(e.target.value)}
    //   onChange={e => setX(Number(e.target.value))}  // also fine — value type preserved
    onChange?.({ target: { value: next } })
  }, [isControlled, onChange])

  return (
    <Dropdown
      value={current ?? null}
      onChange={handleChange}
      options={options}
      placeholder={placeholder ?? inferredPlaceholder}
      size={size}
      className={cn('w-full', className)}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
      autoOpen={!!autoFocus}
      onClose={onBlur as (() => void) | undefined}
      onKeyDown={onKeyDown as ((e: ReactKeyboardEvent) => void) | undefined}
    />
  )
}

export { Select, Dropdown }
export type { SelectProps, DropdownProps }
