'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const SHORTCUTS = [
  { keys: ['G', 'D'], description: 'Go to Dashboard',   category: 'Navigation' },
  { keys: ['G', 'P'], description: 'Go to Projects',    category: 'Navigation' },
  { keys: ['G', 'T'], description: 'Go to Timesheets',  category: 'Navigation' },
  { keys: ['G', 'M'], description: 'Go to Team',        category: 'Navigation' },
  { keys: ['G', 'R'], description: 'Go to Reports',     category: 'Navigation' },
  { keys: ['N'],      description: 'New project',       category: 'Actions'    },
  { keys: ['L'],      description: 'Log time',          category: 'Actions'    },
  { keys: ['?'],      description: 'Show shortcuts',    category: 'Help'       },
  { keys: ['⌘', 'K'], description: 'Command palette',  category: 'Help'       },
]

export default function KeyboardShortcuts() {
  const router = useRouter()
  const [showHelp, setShowHelp] = useState(false)
  const [seq, setSeq] = useState<string[]>([])

  useEffect(() => {
    let seqState: string[] = []
    let seqTimer: ReturnType<typeof setTimeout>

    function onKey(e: KeyboardEvent) {
      const active = document.activeElement
      const isTyping = active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || (active as HTMLElement)?.isContentEditable

      if (isTyping) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const key = e.key.toUpperCase()

      clearTimeout(seqTimer)
      seqState = [...seqState, key]
      setSeq([...seqState])

      // Two-key sequences
      if (seqState.length === 2 && seqState[0] === 'G') {
        const dest: Record<string, string> = { D: '/dashboard', P: '/projects', T: '/timesheets', M: '/team', R: '/reports' }
        if (dest[seqState[1]]) router.push(dest[seqState[1]])
        seqState = []
        setSeq([])
        return
      }

      // Single-key actions
      if (seqState.length === 1) {
        if (key === '?') { e.preventDefault(); setShowHelp(h => !h) }
        if (key === 'N') { router.push('/projects?new=1') }
        if (key === 'L') { router.push('/timesheets') }
      }

      // Reset after 1.2s
      seqTimer = setTimeout(() => { seqState = []; setSeq([]) }, 1200)
    }

    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(seqTimer) }
  }, [router])

  return (
    <>
      {/* Key sequence indicator */}
      {seq.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 80, right: 28, zIndex: 900,
          background: 'var(--bg-raised)', border: '1px solid var(--border-accent)',
          borderRadius: 8, padding: '8px 14px',
          display: 'flex', gap: 4, alignItems: 'center',
          animation: 'fadeUp 0.15s ease',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {seq.map((k, i) => (
            <kbd key={i} style={{
              fontSize: 14, fontFamily: 'var(--font-mono)',
              fontWeight: 700, color: 'var(--accent)',
              background: 'var(--accent-dim)', border: '1px solid var(--border-accent)',
              borderRadius: 5, padding: '2px 8px',
            }}>{k}</kbd>
          ))}
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>…</span>
        </div>
      )}

      {/* Help overlay */}
      {showHelp && (
        <>
          <div onClick={() => setShowHelp(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(7,8,13,0.8)', backdropFilter: 'blur(6px)', zIndex: 900, animation: 'fadeIn 0.15s ease' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 901,
            background: 'var(--bg-raised)', border: '1px solid var(--border-muted)',
            borderRadius: 16, padding: '28px 32px', width: 480,
            boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
            animation: 'scaleIn 0.2s var(--ease-out)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Keyboard Shortcuts</h2>
              <button onClick={() => setShowHelp(false)} style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 10px', color: 'var(--text-tertiary)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>Close</button>
            </div>

            {['Navigation', 'Actions', 'Help'].map(cat => (
              <div key={cat} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8 }}>{cat}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {SHORTCUTS.filter(s => s.category === cat).map((s, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.description}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {s.keys.map((k, j) => (
                          <kbd key={j} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'var(--bg-overlay)', border: '1px solid var(--border-muted)', borderRadius: 5, padding: '2px 8px', color: 'var(--text-primary)' }}>{k}</kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 8 }}>Press <kbd style={{ fontSize: 10, fontFamily: 'var(--font-mono)', background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 5px' }}>?</kbd> to toggle this panel</p>
          </div>
        </>
      )}
    </>
  )
}
