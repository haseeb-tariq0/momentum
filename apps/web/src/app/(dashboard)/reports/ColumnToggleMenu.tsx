'use client'

import { useEffect, useRef, useState } from 'react'
import { Columns3 } from 'lucide-react'
import { Button } from '@/components/ui'

/**
 * Column visibility toggle — a button that opens a checklist menu.
 *
 * Extracted from five near-identical copies across the report files
 * (ActiveProjectsReport, ClientTimesheetReport, ClientProfitabilityReport,
 * CostOfEffortReport, PartnerReport). The previous copies didn't close on
 * Escape, so keyboard users had to click elsewhere to dismiss; this version
 * handles Escape + restores focus to the trigger button, matching the pattern
 * used by the shared ExportMenu.
 */
export function ColumnToggleMenu<T extends { key: string; label: string }>({
  columns,
  visibleCols,
  onToggle,
}: {
  columns: readonly T[]
  visibleCols: Set<string>
  onToggle: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  function closeAndRestoreFocus() {
    setOpen(false)
    queueMicrotask(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeAndRestoreFocus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      <Button ref={triggerRef} variant="secondary" size="sm" onClick={() => setOpen(o => !o)}>
        <Columns3 size={14} /> Columns
      </Button>
      {open && (
        <>
          <div onClick={closeAndRestoreFocus} className="fixed inset-0 z-overlay" />
          <div className="absolute top-[calc(100%+4px)] right-0 bg-surface-raised border border-line-muted rounded-lg shadow-md z-popover min-w-[200px] p-2 animate-menu-slide">
            {columns.map(c => (
              <label
                key={c.key}
                className="flex items-center gap-2 px-2 py-1.5 text-xs text-primary cursor-pointer hover:bg-surface-hover rounded"
              >
                <input
                  type="checkbox"
                  checked={visibleCols.has(c.key)}
                  onChange={() => onToggle(c.key)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
