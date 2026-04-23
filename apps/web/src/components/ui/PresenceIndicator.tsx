'use client'
import { useEffect, useState } from 'react'

interface Viewer {
  id: string
  name: string
  initials: string
  color: string
  page: string
}

// Simulated presence — replace with Supabase Realtime
const MOCK_VIEWERS: Viewer[] = [
  { id: '2', name: 'Bob Martinez',  initials: 'BM', color: '#8B7CF8', page: 'Dashboard' },
  { id: '3', name: 'Carol Davis',   initials: 'CD', color: '#FFAB2E', page: 'Projects'  },
]

export default function PresenceIndicator({ page }: { page: string }) {
  const [viewers, setViewers] = useState<Viewer[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    // Filter to this page
    const here = MOCK_VIEWERS.filter(v => v.page === page)
    setViewers(here)

    // TODO: Replace with Supabase Realtime
    // const channel = supabase.channel(`presence:${page}`)
    // channel.on('presence', { event: 'sync' }, () => { ... })
    // channel.subscribe(async (status) => { if (status === 'SUBSCRIBED') await channel.track({ userId, page }) })
    // return () => supabase.removeChannel(channel)
  }, [page])

  if (viewers.length === 0) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex' }}>
        {viewers.map((v, i) => (
          <div
            key={v.id}
            style={{ position: 'relative', marginLeft: i > 0 ? -6 : 0 }}
            onMouseEnter={() => setHoveredId(v.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: `${v.color}22`, border: `2px solid var(--bg-raised)`,
              outline: `1.5px solid ${v.color}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, color: v.color,
              fontFamily: 'var(--font-mono)',
              cursor: 'default',
              position: 'relative',
            }}>
              {v.initials}
              <span style={{
                position: 'absolute', bottom: -1, right: -1,
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--accent)',
                border: '1.5px solid var(--bg-raised)',
              }} />
            </div>

            {/* Tooltip */}
            {hoveredId === v.id && (
              <div style={{
                position: 'absolute', top: 32, left: '50%', transform: 'translateX(-50%)',
                background: 'var(--bg-overlay)', border: '1px solid var(--border-muted)',
                borderRadius: 7, padding: '5px 10px', whiteSpace: 'nowrap',
                fontSize: 11, color: 'var(--text-secondary)',
                boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
                zIndex: 99, animation: 'fadeUp 0.1s ease',
              }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{v.name}</span>
                <span style={{ color: 'var(--text-tertiary)' }}> is here</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        {viewers.length === 1 ? `${viewers[0].name.split(' ')[0]} is here` : `${viewers.length} viewing`}
      </span>
    </div>
  )
}
