'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Download,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  FileType,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui'
import { showToast } from '@/components/Toast'

/**
 * Unified Export dropdown for the reports section.
 *
 * Before this existed, every report file (page.tsx, ActiveProjectsReport,
 * ClientTimesheetReport, ClientProfitabilityReport, CostOfEffortReport,
 * PartnerReport, PartnerBillingReport) had its own near-identical copy of
 * this component. Behavior drifted between them — only page.tsx had ESC-to-
 * close + focus restoration, only PartnerBillingReport surfaced a loading
 * state for Google Sheet builds, and style details (menu width, chevron size)
 * diverged subtly. Any bug fix had to be applied 7 times.
 *
 * Props:
 * - onCSV (required)       — always synchronous, fires immediately.
 * - onExcel (required)     — may be async (xlsx generation can take a moment).
 * - onPDF (optional)       — only rendered if provided. PartnerBilling skips PDF.
 * - onGoogleSheet (opt)    — only rendered if provided.
 * - gsheetLoading (opt)    — lets the parent surface its own "building sheet"
 *                            state (multi-tab sheets take visibly longer and
 *                            the parent knows when they finish).
 */
export function ExportMenu({
  onCSV,
  onExcel,
  onPDF,
  onGoogleSheet,
  gsheetLoading,
}: {
  onCSV: () => void
  onExcel: () => void | Promise<void>
  onPDF?: () => void | Promise<void>
  onGoogleSheet?: () => void | Promise<void>
  gsheetLoading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<'excel' | 'pdf' | 'gsheet' | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Close and return keyboard focus to the trigger button — important for
  // users navigating the dropdown without a mouse.
  function closeAndRestoreFocus() {
    setOpen(false)
    queueMicrotask(() => triggerRef.current?.focus())
  }

  async function handle(type: 'csv' | 'excel' | 'pdf' | 'gsheet') {
    closeAndRestoreFocus()
    if (type === 'csv') {
      onCSV()
      return
    }
    setLoading(type)
    try {
      if (type === 'excel') await onExcel()
      else if (type === 'pdf' && onPDF) await onPDF()
      else if (type === 'gsheet' && onGoogleSheet) await onGoogleSheet()
    } catch (e: any) {
      showToast.error(`${type.toUpperCase()} export failed: ${e?.message || 'unknown error'}`)
    } finally {
      setLoading(null)
    }
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

  const isLoading = loading !== null || gsheetLoading

  return (
    <div className="relative">
      <Button ref={triggerRef} variant="secondary" size="sm" onClick={() => setOpen(o => !o)}>
        {isLoading ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Exporting…</>
        ) : (
          <><Download className="w-3.5 h-3.5" /> Export</>
        )}
        <ChevronDown className="w-2.5 h-2.5 opacity-50" />
      </Button>
      {open && (
        <>
          <div onClick={closeAndRestoreFocus} className="fixed inset-0 z-overlay" />
          <div className="absolute top-[calc(100%+5px)] right-0 bg-surface-raised border border-line-muted rounded-lg shadow-md z-popover min-w-[180px] overflow-hidden animate-menu-slide">
            <button
              onClick={() => handle('csv')}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 bg-transparent border-none cursor-pointer text-base text-primary text-left hover:bg-surface-hover"
            >
              <FileText className="w-4 h-4 text-accent" />
              <div>
                <div className="font-semibold">CSV</div>
                <div className="text-xs text-muted">Google Sheets compatible</div>
              </div>
            </button>
            <div className="h-px bg-line-subtle mx-2.5" />
            <button
              onClick={() => handle('excel')}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 bg-transparent border-none cursor-pointer text-base text-primary text-left hover:bg-surface-hover"
            >
              <FileSpreadsheet className="w-4 h-4 text-[#22c55e]" />
              <div>
                <div className="font-semibold">Excel <span className="text-[10px] text-muted">.xlsx</span></div>
                <div className="text-xs text-muted">Microsoft Excel workbook</div>
              </div>
            </button>
            {onGoogleSheet && (
              <>
                <div className="h-px bg-line-subtle mx-2.5" />
                <button
                  onClick={() => handle('gsheet')}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 bg-transparent border-none cursor-pointer text-base text-primary text-left hover:bg-surface-hover"
                >
                  <FileSpreadsheet className="w-4 h-4 text-[#0B8043]" />
                  <div>
                    <div className="font-semibold">Google Sheets</div>
                    <div className="text-xs text-muted">Opens in your Drive</div>
                  </div>
                </button>
              </>
            )}
            {onPDF && (
              <>
                <div className="h-px bg-line-subtle mx-2.5" />
                <button
                  onClick={() => handle('pdf')}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 bg-transparent border-none cursor-pointer text-base text-primary text-left hover:bg-surface-hover"
                >
                  <FileType className="w-4 h-4 text-status-rose" />
                  <div>
                    <div className="font-semibold">PDF <span className="text-[10px] text-muted">.pdf</span></div>
                    <div className="text-xs text-muted">Formatted report file</div>
                  </div>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
