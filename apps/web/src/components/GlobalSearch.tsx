'use client'
import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { searchApi } from '@/lib/queries'
import { cn } from '@/lib/cn'
import { Avatar } from '@/components/ui'
import { Search, FolderKanban, CheckCircle2, Users, Loader2 } from 'lucide-react'

const STATUS_COLORS: Record<string, string> = {
  todo: '#6B7280', in_progress: '#D97706', done: '#0D9488',
  running: '#0D9488', halted: '#D97706',
}

interface GlobalSearchProps {
  open: boolean
  onClose: () => void
}

export default function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQ('')
      setCursor(0)
    }
  }, [open])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!open) return
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const { data: results, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchApi.query(q).then((r: any) => r.data),
    enabled: open && q.trim().length >= 2,
    staleTime: 10_000,
  })

  const projects: any[] = results?.projects || []
  const tasks: any[] = results?.tasks || []
  const users: any[] = results?.users || []

  const allItems = [
    ...projects.map((p: any) => ({ type: 'project', id: p.id, href: `/projects/${p.id}`, label: p.name, sub: p.clients?.name || '', color: p.color, status: p.status })),
    ...tasks.map((t: any) => ({ type: 'task', id: t.id, href: `/projects/${t.phases?.projects?.id}`, label: t.title, sub: `${t.phases?.projects?.name}${t.phases?.name ? ` \u00b7 ${t.phases.name}` : ''}`, color: t.phases?.projects?.color, status: t.status })),
    ...users.map((u: any) => ({ type: 'user', id: u.id, href: '/team', label: u.name, sub: `${u.job_title || ''}${u.departments?.name ? ` \u00b7 ${u.departments.name}` : ''}`, color: null, status: null })),
  ]

  // Reset cursor whenever the list changes (query change OR result reorder).
  // Without this, cursor can point past the end after results shrink.
  useEffect(() => {
    setCursor(c => (c >= allItems.length ? 0 : c))
  }, [allItems.length])
  useEffect(() => { setCursor(0) }, [q])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (allItems.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, allItems.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter') {
      const item = allItems[cursor] ?? allItems[0]
      if (item) {
        e.preventDefault()
        router.push(item.href)
        onClose()
      }
    }
  }

  const empty = q.length >= 2 && !isFetching && allItems.length === 0

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/50 z-overlay backdrop-blur-sm animate-overlay-in"
      />

      {/* Modal */}
      <div className="fixed top-[18vh] left-1/2 -translate-x-1/2 w-[620px] max-w-[calc(100vw-32px)] bg-surface-raised border border-line-muted rounded-xl shadow-md z-modal overflow-hidden animate-scale-in">
        {/* Search input */}
        <div className={cn('flex items-center gap-3 px-4 py-3.5', q.length >= 2 && 'border-b border-line-subtle')}>
          <Search size={18} className="text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search projects, tasks, people..."
            className="flex-1 bg-transparent border-none outline-none text-xl text-primary font-body"
          />
          {isFetching && <Loader2 size={16} className="text-accent animate-spin flex-shrink-0" />}
          <kbd
            className="flex-shrink-0 text-xs text-muted bg-surface-overlay border border-line-muted rounded px-1.5 py-0.5 cursor-pointer hover:text-secondary"
            onClick={onClose}
          >
            Esc
          </kbd>
        </div>

        {/* Results */}
        {q.length >= 2 && (
          <div className="max-h-[420px] overflow-y-auto">
            {empty && (
              <div className="py-7 text-center text-base text-muted">
                No results for <strong className="text-primary">"{q}"</strong>
              </div>
            )}

            {projects.length > 0 && (
              <ResultSection label="Projects" icon={<FolderKanban size={11} />}>
                {projects.map((p: any, i: number) => (
                  <ResultRow
                    key={p.id}
                    item={{ type: 'project', label: p.name, sub: p.clients?.name || '', color: p.color, status: p.status, href: `/projects/${p.id}` }}
                    focused={cursor === i}
                    onHover={() => setCursor(i)}
                    onClick={() => { router.push(`/projects/${p.id}`); onClose() }}
                  />
                ))}
              </ResultSection>
            )}

            {tasks.length > 0 && (
              <ResultSection label="Tasks" icon={<CheckCircle2 size={11} />}>
                {tasks.map((t: any, i: number) => {
                  const idx = projects.length + i
                  return (
                    <ResultRow
                      key={t.id}
                      item={{ type: 'task', label: t.title, sub: `${t.phases?.projects?.name || ''}${t.phases?.name ? ` \u00b7 ${t.phases.name}` : ''}`, color: t.phases?.projects?.color, status: t.status, href: `/projects/${t.phases?.projects?.id}` }}
                      focused={cursor === idx}
                      onHover={() => setCursor(idx)}
                      onClick={() => { router.push(`/projects/${t.phases?.projects?.id}`); onClose() }}
                    />
                  )
                })}
              </ResultSection>
            )}

            {users.length > 0 && (
              <ResultSection label="People" icon={<Users size={11} />}>
                {users.map((u: any, i: number) => {
                  const idx = projects.length + tasks.length + i
                  return (
                    <ResultRow
                      key={u.id}
                      item={{ type: 'user', label: u.name, sub: `${u.job_title || ''}${u.departments?.name ? ` \u00b7 ${u.departments.name}` : ''}`, color: null, status: null, href: '/team' }}
                      focused={cursor === idx}
                      onHover={() => setCursor(idx)}
                      onClick={() => { router.push('/team'); onClose() }}
                    />
                  )
                })}
              </ResultSection>
            )}
          </div>
        )}

        {/* Hint bar */}
        <div className={cn('px-4 py-2 flex gap-3 items-center', q.length >= 2 && allItems.length > 0 && 'border-t border-line-subtle')}>
          <span className="text-xs text-muted">
            <kbd className="bg-surface-overlay border border-line-muted rounded px-1 py-px text-[10px] mr-1">{'\u2191\u2193'}</kbd>navigate
          </span>
          <span className="text-xs text-muted">
            <kbd className="bg-surface-overlay border border-line-muted rounded px-1 py-px text-[10px] mr-1">{'\u21b5'}</kbd>open
          </span>
          <span className="ml-auto text-xs text-muted">Type 2+ characters to search</span>
        </div>
      </div>
    </>
  )
}

function ResultSection({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted flex items-center gap-1.5">
        {icon} {label}
      </div>
      {children}
    </div>
  )
}

function ResultRow({ item, focused, onHover, onClick }: { item: any; focused: boolean; onHover: () => void; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      className={cn(
        'px-4 py-2.5 cursor-pointer flex items-center gap-3 transition-all duration-75 border-l-[3px]',
        focused
          ? 'bg-accent-dim border-accent'
          : 'bg-transparent border-transparent hover:bg-surface-hover',
      )}
    >
      {item.type === 'user' ? (
        <Avatar name={item.label} size="sm" />
      ) : (
        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: item.color || 'var(--text-tertiary)' }} />
      )}

      <div className="flex-1 min-w-0">
        <div className={cn('text-base font-medium truncate', focused ? 'text-accent' : 'text-primary')}>
          {item.label}
        </div>
        {item.sub && <div className="text-xs text-muted truncate">{item.sub}</div>}
      </div>

      {item.status && (
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded flex-shrink-0 capitalize whitespace-nowrap"
          style={{ color: STATUS_COLORS[item.status] || 'var(--text-tertiary)', background: `${STATUS_COLORS[item.status] || '#888'}18` }}
        >
          {item.status.replace('_', ' ')}
        </span>
      )}
    </div>
  )
}
