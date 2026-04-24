'use client'
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

type Side = 'top' | 'right' | 'bottom' | 'left'

interface TooltipProps {
  content: string
  side?: Side
  /** Delay before showing, ms. Default 350ms — matches OS-level tooltips. */
  delay?: number
  /** Disable when content is empty or the button already shows the same label. */
  disabled?: boolean
  children: ReactNode
}

/**
 * Lightweight tooltip. Wraps its child in an inline-flex span which owns
 * the positioning ref and the hover/focus handlers — so we never touch
 * the child's own ref or event handlers. (The previous cloneElement-based
 * design stomped on `ref={bellRef}` and `onClick`, silently breaking any
 * child that relied on those — bug caught Apr 24 after the notification
 * bell stopped opening its dropdown.)
 *
 * The wrapper span has `display: inline-flex` and no box styling, so it
 * shouldn't affect layout in any flex/grid context. Works with icon
 * buttons, text links, badges — anything renderable.
 */
function Tooltip({ content, side = 'top', delay = 350, disabled, children }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<number>()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current) }, [])

  function compute() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 6
    switch (side) {
      case 'top':    setPos({ top: r.top - gap,           left: r.left + r.width / 2 }); break
      case 'bottom': setPos({ top: r.bottom + gap,        left: r.left + r.width / 2 }); break
      case 'left':   setPos({ top: r.top + r.height / 2,  left: r.left - gap });          break
      case 'right':  setPos({ top: r.top + r.height / 2,  left: r.right + gap });         break
    }
  }

  function show() {
    if (disabled || !content) return
    timerRef.current = window.setTimeout(() => {
      compute()
      setOpen(true)
    }, delay)
  }
  function hide() {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setOpen(false)
  }

  const translate: Record<Side, string> = {
    top:    'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left:   'translate(-100%, -50%)',
    right:  'translate(0, -50%)',
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex"
      >
        {children}
      </span>
      {open && pos && typeof window !== 'undefined' && createPortal(
        <div
          role="tooltip"
          className={cn(
            'fixed z-modal pointer-events-none',
            'px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap',
            'bg-primary text-surface-raised shadow-md',
            'animate-fade-in',
          )}
          style={{ top: pos.top, left: pos.left, transform: translate[side] }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}

export { Tooltip }
