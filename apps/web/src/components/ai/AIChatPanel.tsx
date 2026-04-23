'use client'
import { useState, useRef, useEffect } from 'react'

const GATEWAY = 'http://localhost:4000'

interface Message {
  id: string
  role: 'user' | 'ai'
  content: string
  time: string
}

interface AIChatPanelProps {
  open: boolean
  onClose: () => void
}

const STARTERS = [
  'Which project will go over budget first?',
  'Who has capacity this week?',
  "Summarise this week's activity",
  'What should I focus on today?',
  'Generate a status report for mobile app',
]

const MOCK_RESPONSE = `Based on your current workspace data:

• Mobile App v2 is the highest risk — 89% budget consumed with ~40% of tasks remaining. At current velocity it will exceed its 320h budget in ~8 days.

• Bob Martinez is running at 110% capacity this week. Consider reassigning 4–6h to Emma Wilson who is only at 40% utilization.

• Your team logged 187h this week — the highest in 6 weeks. Well done!

Would you like me to generate a detailed report or suggest specific task reassignments?`

function formatTime() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  // Welcome message when first opened
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        id: '0', role: 'ai',
        content: "Hi! I'm your AI assistant. I have full context of your workspace — projects, budgets, timesheets, and team capacity. What would you like to know?",
        time: formatTime(),
      }])
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(text?: string) {
    const q = (text || input).trim()
    if (!q || loading) return
    setInput('')
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: q, time: formatTime() }
    setMessages(m => [...m, userMsg])
    setLoading(true)

    try {
      const token = sessionStorage.getItem('access_token') || ''
      const res = await fetch(`${GATEWAY}/api/v1/ai/chat`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: q }),
      })
      if (!res.ok) throw new Error()
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'ai', content: '', time: formatTime() }
      setMessages(m => [...m, aiMsg])
      const reader = res.body?.getReader()
      const dec = new TextDecoder()
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          setMessages(m => m.map(msg => msg.id === aiMsg.id ? { ...msg, content: msg.content + dec.decode(value) } : msg))
        }
      }
    } catch {
      // Simulated streaming fallback
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'ai', content: '', time: formatTime() }
      setMessages(m => [...m, aiMsg])
      for (let i = 0; i < MOCK_RESPONSE.length; i += 8) {
        await new Promise(r => setTimeout(r, 14))
        setMessages(m => m.map(msg => msg.id === aiMsg.id ? { ...msg, content: msg.content + MOCK_RESPONSE.slice(i, i + 8) } : msg))
      }
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div style={{
      width: 360, height: '100vh',
      position: 'sticky', top: 0,
      background: 'var(--bg-raised)',
      borderLeft: '1px solid var(--border-muted)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{
        padding: '16px 16px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'linear-gradient(135deg, rgba(139,124,248,0.08), transparent)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'linear-gradient(135deg, #8B7CF8, #5A4FE0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, flexShrink: 0,
            boxShadow: '0 4px 12px rgba(139,124,248,0.4)',
          }}>*</div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>AI Assistant</div>
            <div style={{ fontSize: 10.5, color: 'var(--violet)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'block' }} />
              Workspace context loaded
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setMessages([])}
            style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 10px', color: 'var(--text-tertiary)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
          >Clear</button>
          <button
            onClick={onClose}
            style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 10px', color: 'var(--text-tertiary)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
          >✕ Close</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '88%', padding: '10px 13px',
              borderRadius: msg.role === 'user' ? '12px 12px 3px 12px' : '3px 12px 12px 12px',
              background: msg.role === 'user'
                ? 'linear-gradient(135deg, #8B7CF8, #5A4FE0)'
                : 'var(--bg-surface)',
              border: msg.role === 'user' ? 'none' : '1px solid var(--border-subtle)',
              color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
              fontSize: 13, lineHeight: 1.6,
            }}>
              {msg.role === 'ai' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5, opacity: 0.6 }}>
                  <span style={{ fontSize: 9, color: 'var(--violet)' }}>*</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>AI</span>
                </div>
              )}
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, paddingLeft: 4, paddingRight: 4 }}>{msg.time}</span>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', gap: 5, padding: '6px 2px', alignItems: 'center' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 7, height: 7, borderRadius: '50%', background: 'var(--violet)',
                animation: `dotPulse 1.2s ease ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Starters — only when fresh */}
      {messages.length <= 1 && (
        <div style={{ padding: '0 12px 10px', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6, padding: '0 2px' }}>
            Suggested questions
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {STARTERS.map((s, i) => (
              <button key={i} onClick={() => send(s)} style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                borderRadius: 8, padding: '7px 12px', textAlign: 'left',
                color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
                fontFamily: 'var(--font-body)', transition: 'all 0.12s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
                onMouseEnter={e => { (e.currentTarget).style.borderColor = 'rgba(139,124,248,0.4)'; (e.currentTarget).style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { (e.currentTarget).style.borderColor = 'var(--border-subtle)'; (e.currentTarget).style.color = 'var(--text-secondary)' }}
              >
                <span style={{ fontSize: 10, color: 'var(--violet)', flexShrink: 0 }}>*</span>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid var(--border-subtle)',
        display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Ask about your workspace…"
          disabled={loading}
          style={{
            flex: 1, background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 9, padding: '9px 12px',
            color: 'var(--text-primary)', fontSize: 13,
            fontFamily: 'var(--font-body)', outline: 'none',
            caretColor: 'var(--violet)',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'rgba(139,124,248,0.4)'}
          onBlur={e => (e.target as HTMLInputElement).style.borderColor = 'var(--border-subtle)'}
        />
        <button
          onClick={() => send()}
          disabled={!input.trim() || loading}
          style={{
            width: 36, height: 36, borderRadius: 9, border: 'none',
            background: input.trim() ? 'linear-gradient(135deg, #8B7CF8, #5A4FE0)' : 'var(--bg-overlay)',
            color: input.trim() ? '#fff' : 'var(--text-tertiary)',
            fontSize: 14, cursor: input.trim() ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'all 0.15s',
            boxShadow: input.trim() ? '0 4px 12px rgba(139,124,248,0.4)' : 'none',
          }}
        >↑</button>
      </div>

      <style>{`
        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}
