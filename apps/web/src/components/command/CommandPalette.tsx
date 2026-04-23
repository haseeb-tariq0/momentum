'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Home, FolderKanban, Clock, Users, BarChart3, Plus, Timer, UserPlus, FileText, Sparkles, Search } from 'lucide-react'

const GATEWAY = 'http://localhost:4000'

interface Command {
  id: string
  label: string
  description?: string
  category: string
  icon: string
  shortcut?: string
  action: () => void
  keywords?: string[]
}

const CMD_ICONS: Record<string, React.ReactNode> = {
  'dashboard':   <Home size={15} />,
  'projects':    <FolderKanban size={15} />,
  'timesheets':  <Clock size={15} />,
  'team':        <Users size={15} />,
  'reports':     <BarChart3 size={15} />,
  'new-project': <Plus size={15} />,
  'log-time':    <Timer size={15} />,
  'invite':      <UserPlus size={15} />,
  'report':      <FileText size={15} />,
  'ai':          <Sparkles size={15} />,
}

const AI_SUGGESTIONS = [
  'log 3h on website redesign today',
  'show burn rate for mobile app',
  'who has capacity this week?',
  'generate weekly status report',
  'which project will go over budget first?',
]

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen]         = useState(false)
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState(0)
  const [aiMode, setAiMode]     = useState(false)
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  const COMMANDS: Command[] = [
    { id:'go-dashboard',  label:'Go to Dashboard',    category:'Navigate', icon:'dashboard', action: () => { router.push('/dashboard');  close() } },
    { id:'go-projects',   label:'Go to Projects',     category:'Navigate', icon:'projects', action: () => { router.push('/projects');   close() } },
    { id:'go-timesheets', label:'Go to Timesheets',   category:'Navigate', icon:'timesheets', action: () => { router.push('/timesheets'); close() } },
    { id:'go-team',       label:'Go to Team',         category:'Navigate', icon:'team', action: () => { router.push('/team');       close() } },
    { id:'go-reports',    label:'Go to Reports',      category:'Navigate', icon:'reports', action: () => { router.push('/reports');    close() } },
    { id:'new-project',   label:'New Project',        description:'Create a new project',         category:'Actions', icon:'new-project', shortcut:'N', action: () => { router.push('/projects?new=1'); close() } },
    { id:'log-time',      label:'Log Time',           description:'Log hours for today',          category:'Actions', icon:'log-time', shortcut:'L', action: () => { router.push('/timesheets');    close() } },
    { id:'invite-user',   label:'Invite Team Member', description:'Add someone to the workspace', category:'Actions', icon:'invite',              action: () => { router.push('/team?invite=1');  close() } },
    { id:'run-report',    label:'Generate Report',    description:'Generate and send a report',   category:'Actions', icon:'report',              action: () => { router.push('/reports');        close() } },
    { id:'ai-mode',       label:'Ask AI anything…',   description:'Switch to AI mode',            category:'AI',      icon:'ai',              action: () => { setAiMode(true); setQuery('') } },
  ]

  function close() {
    setOpen(false); setQuery(''); setAiMode(false); setAiAnswer(''); setSelected(0)
  }

  const q        = query.toLowerCase().trim()
  const filtered = !aiMode && q
    ? COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q) || c.keywords?.some(k => k.includes(q)))
    : !aiMode ? COMMANDS : []

  const grouped  = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = []
    acc[cmd.category].push(cmd)
    return acc
  }, {})
  const flatList = Object.values(grouped).flat()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o); return }
      if (!open) return
      if (e.key === 'Escape')    { close(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, flatList.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      if (e.key === 'Enter')     { e.preventDefault(); if (aiMode && query.trim()) { askAI(query); return }; if (flatList[selected]) flatList[selected].action() }
      if (e.key === 'Tab' && !aiMode) { e.preventDefault(); setAiMode(true); setQuery('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, selected, flatList, aiMode, query])

  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 30); setSelected(0) } }, [open])
  useEffect(() => { const el = listRef.current?.querySelector(`[data-idx="${selected}"]`) as HTMLElement; el?.scrollIntoView({ block: 'nearest' }) }, [selected])
  useEffect(() => { setSelected(0) }, [query])

  async function askAI(q: string) {
    setAiLoading(true); setAiAnswer('')
    try {
      const token = sessionStorage.getItem('access_token') || ''
      const res   = await fetch(`${GATEWAY}/api/v1/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ question: q }),
      })
      if (!res.ok) throw new Error()
      const reader = res.body?.getReader()
      const dec    = new TextDecoder()
      if (!reader) throw new Error()
      while (true) { const { done, value } = await reader.read(); if (done) break; setAiAnswer(a => a + dec.decode(value)) }
    } catch {
      setAiAnswer('AI features coming soon — backend integration pending.')
    } finally { setAiLoading(false) }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(7,8,13,0.75)', backdropFilter: 'blur(8px)', animation: 'fade-in 0.15s ease' }} />

      {/* Palette — always centered on screen */}
      <div style={{
        position: 'fixed',
        top: '18%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        width: 'min(580px, calc(100vw - 48px))',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-muted)',
        borderRadius: 14,
        boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        animation: 'scale-in 0.2s var(--ease-out)',
      }}>

        {/* Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 15, color: aiMode ? 'var(--violet)' : 'var(--text-tertiary)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>{aiMode ? <Sparkles size={15} /> : <Search size={15} />}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={aiMode ? 'Ask AI anything about your workspace…' : 'Search commands… (Tab → AI mode)'}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 15, fontFamily: 'var(--font-body)', caretColor: aiMode ? 'var(--violet)' : 'var(--accent)' }}
          />
          {aiMode
            ? <button onClick={() => { setAiMode(false); setQuery(''); setAiAnswer('') }} style={{ background: 'var(--violet-dim)', border: '1px solid rgba(139,124,248,0.3)', borderRadius: 6, padding: '3px 10px', color: 'var(--violet)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>Exit AI</button>
            : <button onClick={() => { setAiMode(true); setQuery('') }} style={{ background: 'var(--violet-dim)', border: '1px solid rgba(139,124,248,0.3)', borderRadius: 6, padding: '3px 10px', color: 'var(--violet)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 4 }}><Sparkles size={11} /> AI</button>
          }
          <kbd onClick={close} style={{ fontSize: 10, background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', cursor: 'pointer' }}>ESC</kbd>
        </div>

        {/* AI mode content */}
        {aiMode && (
          <div style={{ padding: '16px', maxHeight: 360, overflowY: 'auto' }}>
            {!query && !aiAnswer && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 4 }}>Try asking…</div>
                {AI_SUGGESTIONS.map((s, i) => (
                  <div key={i} onClick={() => { setQuery(s); setTimeout(() => askAI(s), 0) }} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.12s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-accent)'; (e.currentTarget as HTMLDivElement).style.color = 'var(--text-primary)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'; (e.currentTarget as HTMLDivElement).style.color = 'var(--text-secondary)' }}
                  >
                    <Sparkles size={12} style={{ color: 'var(--violet)' }} />
                    "{s}"
                  </div>
                ))}
              </div>
            )}
            {aiLoading && <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: 'var(--text-secondary)', fontSize: 13 }}><span className="animate-spin" style={{ display: 'inline-block' }}>◌</span> Thinking…</div>}
            {aiAnswer && (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-accent)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                  <Sparkles size={10} style={{ color: 'var(--violet)' }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>AI Answer</span>
                </div>
                <p style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiAnswer}</p>
                <button onClick={() => { setQuery(''); setAiAnswer('') }} style={{ marginTop: 8, background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>← Ask another</button>
              </div>
            )}
          </div>
        )}

        {/* Command list */}
        {!aiMode && (
          <div ref={listRef} style={{ maxHeight: 360, overflowY: 'auto', padding: '6px 0' }}>
            {flatList.length === 0 && <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No commands found</div>}
            {Object.entries(grouped).map(([category, cmds]) => (
              <div key={category}>
                <div style={{ padding: '8px 16px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{category}</div>
                {cmds.map(cmd => {
                  const idx  = flatList.indexOf(cmd)
                  const isSel = idx === selected
                  return (
                    <div key={cmd.id} data-idx={idx} onClick={() => cmd.action()} onMouseEnter={() => setSelected(idx)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer', background: isSel ? 'var(--accent-dim)' : 'transparent', transition: 'background 0.08s' }}>
                      <span style={{ fontSize: 15, width: 22, textAlign: 'center', color: isSel ? 'var(--accent)' : 'var(--text-tertiary)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{CMD_ICONS[cmd.icon] || cmd.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, color: isSel ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isSel ? 600 : 400 }}>{cmd.label}</div>
                        {cmd.description && <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 1 }}>{cmd.description}</div>}
                      </div>
                      {cmd.shortcut && <kbd style={{ fontSize: 10, background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', flexShrink: 0 }}>{cmd.shortcut}</kbd>}
                      {isSel && <span style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>↵</span>}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/* Footer hints */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 16, alignItems: 'center' }}>
          {[['↑↓','Navigate'],['↵','Select'],['Tab','AI mode'],['Esc','Close']].map(([key, label]) => (
            <div key={key} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <kbd style={{ fontSize: 10, background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>{key}</kbd>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
