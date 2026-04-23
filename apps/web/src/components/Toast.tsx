'use client'
import { useEffect, useState, useRef } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'
type ToastItem = { id: number; kind: ToastKind; message: string }

let _push: ((t: Omit<ToastItem, 'id'>) => void) | null = null
let _nextId = 1

export function showToast(message: string, kind: ToastKind = 'info') {
  if (_push) _push({ kind, message })
}
// Convenience wrappers
showToast.success = (m: string) => showToast(m, 'success')
showToast.error   = (m: string) => showToast(m, 'error')
showToast.info    = (m: string) => showToast(m, 'info')

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    _push = (t) => {
      const id = _nextId++
      setItems(prev => [...prev, { ...t, id }])
      const timer = setTimeout(() => {
        setItems(prev => prev.filter(x => x.id !== id))
        timersRef.current.delete(id)
      }, 4500)
      timersRef.current.set(id, timer)
    }
    return () => {
      _push = null
      // Cleanup all pending timers on unmount
      for (const t of timersRef.current.values()) clearTimeout(t)
      timersRef.current.clear()
    }
  }, [])

  function dismiss(id: number) {
    const t = timersRef.current.get(id)
    if (t) { clearTimeout(t); timersRef.current.delete(id) }
    setItems(prev => prev.filter(x => x.id !== id))
  }

  if (items.length === 0) return null

  return (
    <div role="region" aria-label="Notifications" aria-live="polite"
      style={{ position: 'fixed', top: 20, right: 20, zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380, pointerEvents: 'none' }}>
      {items.map(t => {
        const cfg = t.kind === 'success'
          ? { icon: CheckCircle2, color: 'var(--accent)', bg: 'var(--accent-dim)', border: 'var(--border-accent)' }
          : t.kind === 'error'
          ? { icon: AlertCircle, color: 'var(--rose)', bg: 'rgba(244,63,94,0.1)', border: 'rgba(244,63,94,0.35)' }
          : { icon: Info, color: 'var(--text-secondary)', bg: 'var(--bg-raised)', border: 'var(--border-muted)' }
        const Icon = cfg.icon
        return (
          <div key={t.id} role="status"
            style={{
              pointerEvents: 'auto',
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10,
              padding: '12px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
              backdropFilter: 'blur(12px)',
              animation: 'toast-slide-in 0.18s ease-out',
            }}>
            <Icon size={18} style={{ color: cfg.color, flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>{t.message}</div>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification"
              style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>
              <X size={14} />
            </button>
          </div>
        )
      })}
      <style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
