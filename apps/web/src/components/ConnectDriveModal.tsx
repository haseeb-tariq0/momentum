'use client'
// Singleton modal that prompts the user to connect Google Drive when an
// "Export to Sheets" action returns 412 NOT_CONNECTED. Mirrors the
// pattern in Toast.tsx — a single host component lives in the dashboard
// layout, and any code anywhere can call `showConnectDriveModal({...})`.
//
// We use this instead of a per-page inline modal so the four (and
// growing) report pages don't each maintain their own copy of the same
// "Connect Google Drive" markup. Adding a 5th report → just call the
// helper.
import { useEffect, useState } from 'react'
import { gdriveApi } from '@/lib/queries'
import { showToast } from '@/components/Toast'
import { Button } from '@/components/ui'
import { X, ExternalLink, Loader2 } from 'lucide-react'

type ModalState = {
  reason?: 'not_connected' | 'grant_invalid'  // tunes the copy
  // Optional: a short description of what was being exported, so the
  // user understands why the modal popped (e.g. "Partner Report").
  exportName?: string
}

let _show: ((s: ModalState) => void) | null = null

/** Pop the modal. Safe to call from anywhere — if the host isn't
 *  mounted yet it's a no-op. */
export function showConnectDriveModal(state: ModalState = {}) {
  if (_show) _show(state)
}

// 4-color Drive logo (same as in Settings/Integrations) so the modal
// reads as obviously Google rather than another generic dialog.
function DriveLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  )
}

export function ConnectDriveModal() {
  const [open, setOpen]       = useState(false)
  const [state, setState]     = useState<ModalState>({})
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    _show = (s) => { setState(s); setOpen(true) }
    return () => { _show = null }
  }, [])

  // ESC closes — nice touch for keyboard users, not strictly required.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  async function handleConnect() {
    setConnecting(true)
    try {
      const res: any = await gdriveApi.getAuthUrl()
      if (res?.url) {
        // Full-page redirect — Google's OAuth screen doesn't play nice
        // in a popup on every browser (Safari blocks; Edge sometimes
        // refuses without a user gesture). Redirect is universal.
        window.location.href = res.url
      } else {
        showToast.error('Could not get Google authorization URL.')
      }
    } catch (e: any) {
      const apiMsg = e?.response?.data?.errors?.[0]?.message || e?.message || 'unknown'
      showToast.error('Failed to start Google sign-in: ' + apiMsg)
    } finally {
      setConnecting(false)
    }
  }

  // Copy adapts to whether this is a first-time connect or a re-grant.
  const isReconnect = state.reason === 'grant_invalid'
  const headline    = isReconnect
    ? 'Reconnect your Google Drive'
    : 'Connect your Google Drive'
  const subtitle    = isReconnect
    ? 'Your previous connection has expired or was revoked. Sign in again to keep exporting reports as Sheets.'
    : 'Exports land in your own Drive as Google Sheets, so you control sharing, renaming, and where they live.'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-drive-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div style={{
        background: 'var(--bg-card, #fff)',
        color:      'var(--text-primary, #1A1F2B)',
        borderRadius: 14,
        boxShadow: '0 24px 60px -24px rgba(0,0,0,0.4), 0 8px 24px -8px rgba(0,0,0,0.2)',
        maxWidth: 460, width: '100%',
        border: '1px solid var(--border-muted, rgba(15,23,42,0.08))',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '28px 28px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <DriveLogo size={36} />
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted, #6B7280)', padding: 4, borderRadius: 6,
              }}
            >
              <X size={18} />
            </button>
          </div>
          <h2 id="connect-drive-title" style={{
            fontSize: 18, fontWeight: 600, margin: '14px 0 6px',
            letterSpacing: '-0.01em',
          }}>
            {headline}
          </h2>
          <p style={{
            fontSize: 14, lineHeight: 1.55, margin: 0,
            color: 'var(--text-secondary, #4B5563)',
          }}>
            {subtitle}
          </p>
          {state.exportName && (
            <p style={{
              fontSize: 12, marginTop: 12, padding: '8px 12px',
              borderRadius: 6,
              background: 'var(--surface, #FAFBFC)',
              border: '1px solid var(--border-muted, rgba(15,23,42,0.06))',
              color: 'var(--text-muted, #6B7280)',
            }}>
              Trying to export: <strong style={{ color: 'var(--text-primary, #1A1F2B)' }}>{state.exportName}</strong>
            </p>
          )}
          <ul style={{
            listStyle: 'none', padding: 0, margin: '16px 0 0',
            fontSize: 13, color: 'var(--text-secondary, #4B5563)',
          }}>
            <li style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
              <span style={{ color: 'var(--accent, #0BB39F)' }}>✓</span>
              Momentum only sees files it creates on your behalf
            </li>
            <li style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
              <span style={{ color: 'var(--accent, #0BB39F)' }}>✓</span>
              You can disconnect at any time from Settings -&gt; Integrations
            </li>
            <li style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
              <span style={{ color: 'var(--accent, #0BB39F)' }}>✓</span>
              The sheet you create stays in your Drive even after disconnect
            </li>
          </ul>
        </div>
        <div style={{
          padding: '16px 28px',
          borderTop: '1px solid var(--border-muted, rgba(15,23,42,0.06))',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={connecting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={connecting} onClick={handleConnect}>
            {connecting ? 'Redirecting...' : <><ExternalLink size={14} className="inline mr-1.5" />Continue with Google</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
