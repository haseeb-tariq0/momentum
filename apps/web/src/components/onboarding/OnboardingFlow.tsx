'use client'
import { useState } from 'react'

interface OnboardingProps {
  onComplete: () => void
}

const STEPS = [
  { id:'welcome',   title:"Welcome to Forecast",      subtitle:"Your AI-powered project intelligence platform", icon:'W', color:'var(--accent)'   },
  { id:'workspace', title:"Name your workspace",       subtitle:"This is how your team will identify your organisation", icon:'N', color:'var(--violet)' },
  { id:'project',   title:"Create your first project", subtitle:"Get started by setting up a project to track", icon:'+', color:'var(--amber)'  },
  { id:'invite',    title:"Invite your team",          subtitle:"Bring in people who will log time and manage work", icon:'T', color:'var(--sky)'    },
  { id:'done',      title:"You're ready to go!",       subtitle:"Your workspace is set up. Let's build something great.", icon:'G', color:'var(--accent)' },
]

export default function OnboardingFlow({ onComplete }: OnboardingProps) {
  const [step, setStep]             = useState(0)
  const [workspace, setWorkspace]   = useState('')
  const [project, setProject]       = useState({ name: '', budget: '' })
  const [inviteEmail, setInviteEmail] = useState('')
  const [invites, setInvites]       = useState<string[]>([])

  const current = STEPS[step]
  const isFirst = step === 0
  const isLast  = step === STEPS.length - 1

  function addInvite() {
    if (!inviteEmail.trim() || invites.includes(inviteEmail)) return
    setInvites(i => [...i, inviteEmail])
    setInviteEmail('')
  }

  function canProceed() {
    if (current.id === 'workspace') return workspace.trim().length >= 2
    if (current.id === 'project')   return project.name.trim().length >= 2
    return true
  }

  const inputStyle = (accent: string) => ({
    width: '100%', background: 'var(--bg-surface)',
    border: '1px solid var(--border-muted)', borderRadius: 10,
    padding: '13px 16px', color: 'var(--text-primary)',
    fontSize: 15, fontFamily: 'var(--font-body)', outline: 'none',
  })

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'var(--bg-base)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      {/* Aurora */}
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        <div style={{ position:'absolute', width:600, height:600, borderRadius:'50%', top:'-10%', left:'50%', transform:'translateX(-50%)', background:`radial-gradient(circle, ${current.color}08 0%, transparent 70%)`, filter:'blur(60px)', transition:'background 0.5s' }} />
      </div>

      <div style={{ width:'100%', maxWidth:520, position:'relative', animation:'scaleIn 0.3s var(--ease-out)' }}>

        {/* Progress */}
        <div style={{ display:'flex', justifyContent:'center', gap:8, marginBottom:36 }}>
          {STEPS.map((s,i) => (
            <div key={s.id} style={{ width:i===step?24:6, height:6, borderRadius:99, background:i<step?'var(--text-tertiary)':i===step?current.color:'var(--border-subtle)', transition:'all 0.3s var(--ease-out)' }} />
          ))}
        </div>

        <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border-subtle)', borderRadius:20, padding:'44px 44px 36px', boxShadow:'0 40px 80px rgba(0,0,0,0.5)' }}>

          {/* Icon */}
          <div style={{ width:56, height:56, borderRadius:14, marginBottom:24, background:`${current.color}18`, border:`1px solid ${current.color}33`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, color:current.color, boxShadow:`0 8px 24px ${current.color}22` }}>{current.icon}</div>

          <h1 style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:300, letterSpacing:'-0.03em', color:'var(--text-primary)', marginBottom:8, lineHeight:1.2 }}>{current.title}</h1>
          <p style={{ fontSize:14, color:'var(--text-secondary)', marginBottom:32, lineHeight:1.5 }}>{current.subtitle}</p>

          {/* Step content */}
          {current.id === 'workspace' && (
            <div>
              <label style={{ display:'block', fontSize:11.5, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--text-secondary)', marginBottom:8 }}>Workspace name</label>
              <input autoFocus value={workspace} onChange={e=>setWorkspace(e.target.value)} placeholder="Acme Corporation" style={inputStyle('var(--violet)')} onFocus={e=>(e.target as HTMLInputElement).style.borderColor='var(--violet)'} onBlur={e=>(e.target as HTMLInputElement).style.borderColor='var(--border-muted)'} />
            </div>
          )}

          {current.id === 'project' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ display:'block', fontSize:11.5, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--text-secondary)', marginBottom:8 }}>Project name</label>
                <input autoFocus value={project.name} onChange={e=>setProject(p=>({...p,name:e.target.value}))} placeholder="Website Redesign" style={inputStyle('var(--amber)')} onFocus={e=>(e.target as HTMLInputElement).style.borderColor='var(--amber)'} onBlur={e=>(e.target as HTMLInputElement).style.borderColor='var(--border-muted)'} />
              </div>
              <div>
                <label style={{ display:'block', fontSize:11.5, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--text-secondary)', marginBottom:8 }}>Budget (hours) — optional</label>
                <input type="number" value={project.budget} onChange={e=>setProject(p=>({...p,budget:e.target.value}))} placeholder="200" style={inputStyle('var(--amber)')} onFocus={e=>(e.target as HTMLInputElement).style.borderColor='var(--amber)'} onBlur={e=>(e.target as HTMLInputElement).style.borderColor='var(--border-muted)'} />
              </div>
            </div>
          )}

          {current.id === 'invite' && (
            <div>
              <label style={{ display:'block', fontSize:11.5, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--text-secondary)', marginBottom:8 }}>Invite by email</label>
              <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addInvite()} placeholder="colleague@company.com" style={inputStyle('var(--sky)')} onFocus={e=>(e.target as HTMLInputElement).style.borderColor='var(--sky)'} onBlur={e=>(e.target as HTMLInputElement).style.borderColor='var(--border-muted)'} />
                <button onClick={addInvite} style={{ background:'var(--sky)', border:'none', borderRadius:10, padding:'11px 18px', color:'#fff', fontSize:14, fontWeight:700, fontFamily:'var(--font-body)', cursor:'pointer', whiteSpace:'nowrap' }}>Add</button>
              </div>
              {invites.length > 0 && (
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {invites.map(email=>(
                    <div key={email} style={{ display:'flex', alignItems:'center', gap:6, background:'var(--sky-dim)', border:'1px solid rgba(56,189,248,0.3)', borderRadius:99, padding:'4px 10px' }}>
                      <span style={{ fontSize:12, color:'var(--sky)' }}>{email}</span>
                      <button onClick={()=>setInvites(i=>i.filter(e=>e!==email))} style={{ background:'none', border:'none', color:'var(--sky)', fontSize:12, cursor:'pointer', lineHeight:1 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:12 }}>You can also do this later from the Team page.</p>
            </div>
          )}

          {current.id === 'done' && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {[
                { icon:'✓', text:`Workspace "${workspace||'Your workspace'}" created`, color:'var(--accent)' },
                { icon:'✓', text:`Project "${project.name||'My first project'}" set up`, color:'var(--accent)' },
                { icon:invites.length>0?'✓':'○', text:invites.length>0?`${invites.length} invite(s) sent`:'No invites yet — do it from Team later', color:invites.length>0?'var(--accent)':'var(--text-tertiary)' },
              ].map((item,i)=>(
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--bg-surface)', borderRadius:9 }}>
                  <span style={{ color:item.color, fontWeight:700 }}>{item.icon}</span>
                  <span style={{ fontSize:13.5, color:'var(--text-secondary)' }}>{item.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Nav */}
          <div style={{ display:'flex', gap:10, marginTop:36 }}>
            {!isFirst && (
              <button onClick={()=>setStep(s=>s-1)} style={{ flex:'0 0 auto', background:'var(--bg-overlay)', border:'1px solid var(--border-muted)', borderRadius:10, padding:'12px 22px', color:'var(--text-secondary)', fontSize:14, fontFamily:'var(--font-body)', cursor:'pointer' }}>← Back</button>
            )}
            <button
              onClick={()=>isLast?onComplete():setStep(s=>s+1)}
              disabled={!canProceed()}
              style={{
                flex:1, border:'none', borderRadius:10, padding:'13px',
                background:canProceed()?current.color:'var(--bg-overlay)',
                color:canProceed()?(current.color==='var(--accent)'?'#07080D':'#fff'):'var(--text-tertiary)',
                fontSize:14, fontWeight:700, fontFamily:'var(--font-body)',
                cursor:canProceed()?'pointer':'not-allowed',
                boxShadow:canProceed()?`0 8px 24px ${current.color}33`:'none',
                transition:'all 0.2s',
              }}
            >
              {isLast?'Open Forecast →':isFirst?'Get started →':'Continue →'}
            </button>
          </div>

          {!isFirst && !isLast && (
            <button onClick={()=>setStep(s=>s+1)} style={{ width:'100%', background:'none', border:'none', color:'var(--text-tertiary)', fontSize:12, cursor:'pointer', marginTop:10, fontFamily:'var(--font-body)' }}>
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
