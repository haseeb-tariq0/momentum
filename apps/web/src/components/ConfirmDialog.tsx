'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import { AlertCircle } from 'lucide-react'

type ConfirmState = {
  message: string
  subtext?: string
  confirmLabel?: string
  onConfirm: () => void
} | null

let _show: ((state: ConfirmState) => void) | null = null

export function showConfirm(
  message: string,
  onConfirm: () => void,
  opts?: { subtext?: string; confirmLabel?: string }
) {
  if (_show) {
    _show({ message, onConfirm, subtext: opts?.subtext, confirmLabel: opts?.confirmLabel || 'Delete' })
  }
}

export function ConfirmDialog() {
  const [state, setState] = useState<ConfirmState>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    _show = setState
    return () => { _show = null }
  }, [])

  useEffect(() => {
    if (state) setTimeout(() => cancelRef.current?.focus(), 50)
  }, [state])

  useEffect(() => {
    if (!state) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setState(null) }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [state])

  if (!state) return null

  const handleConfirm = () => { state.onConfirm(); setState(null) }
  const handleCancel = () => setState(null)

  return (
    <div
      className="fixed inset-0 z-toast flex items-center justify-center bg-black/55 backdrop-blur-sm animate-overlay-in"
      onClick={e => { if (e.target === e.currentTarget) handleCancel() }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cd-message"
        className="bg-surface-raised border border-line-muted rounded-2xl px-7 pt-6 pb-5 w-[380px] max-w-[calc(100vw-32px)] shadow-md animate-panel-in"
      >
        {/* Warning icon */}
        <div className="w-11 h-11 rounded-full bg-status-rose-dim border border-[rgba(244,63,94,0.2)] flex items-center justify-center mb-4">
          <AlertCircle size={20} className="text-status-rose" />
        </div>

        {/* Title */}
        <p id="cd-message" className="text-lg font-semibold text-primary mb-2 leading-snug">
          {state.message}
        </p>

        {/* Subtext */}
        <p className="text-base text-secondary mb-6 leading-relaxed">
          {state.subtext || 'This action cannot be undone.'}
        </p>

        {/* Divider */}
        <div className="h-px bg-line-subtle mb-4" />

        {/* Actions */}
        <div className="flex gap-2.5 justify-end">
          <Button ref={cancelRef} variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm}>
            {state.confirmLabel || 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  )
}
