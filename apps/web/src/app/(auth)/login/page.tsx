'use client'
import { useState } from 'react'
import { useAuthStore } from '@/lib/store'
import { Loader2, ArrowRight, Mail, Lock } from 'lucide-react'
import { useGoogleLogin } from '@react-oauth/google'
import { Mark, NexaWordmark } from '@/components/Brand/BrandLockup'

// ─────────────────────────────────────────────────────────────────────────
// Login page — full-bleed 3-column layout (locked design 2026-05-01).
//
//   ┌────────────┬────────────┬────────────┐
//   │ identity   │   form     │ atmosphere │
//   │ (logo +    │  (auth     │ (purple    │
//   │  tagline)  │   center)  │  mirror)   │
//   └────────────┴────────────┴────────────┘
//
// Color rule:
//   - TEAL  — brand identity only (mark, headline accent, "Live" pulse)
//   - PURPLE (--accent) — system actions only (CTA, focus rings, links)
//
// The atmosphere flows across all three zones (no hard dividers). A teal
// ghost arc backs the left column, a purple ghost arc mirrors it on the
// right, and the form sits as the optical center of the page.
//
// Quick-access dev shortcut is preserved (IS_DEV check) but rendered
// underneath the form, not as a third panel — keeps the page calm.
// ─────────────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV !== 'production'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const setAuth = useAuthStore(s => s.setAuth)

  const googleLogin = useGoogleLogin({
    flow: 'implicit',
    onSuccess: async (tokenResponse) => {
      setError('')
      setGoogleLoading(true)
      try {
        const res = await fetch('/api/v1/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accessToken: tokenResponse.access_token }),
        })
        const json = await res.json()
        if (!res.ok) {
          setError(json?.errors?.[0]?.message || 'Google login failed')
          return
        }
        localStorage.setItem('access_token', json.data.accessToken)
        localStorage.setItem('auth_user', JSON.stringify(json.data.user))
        setAuth(json.data.user, json.data.accessToken)
        window.location.href = '/dashboard'
      } catch {
        setError('Cannot reach server.')
      } finally {
        setGoogleLoading(false)
      }
    },
    onError: () => setError('Google sign-in was cancelled or failed.'),
    scope: 'email profile',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.errors?.[0]?.message || json?.message || 'Login failed')
        return
      }
      localStorage.setItem('access_token', json.data.accessToken)
      localStorage.setItem('auth_user', JSON.stringify(json.data.user))
      setAuth(json.data.user, json.data.accessToken)
      window.location.href = '/dashboard'
    } catch {
      setError('Cannot reach server. Make sure pnpm dev is running.')
    } finally {
      setLoading(false)
    }
  }

  return (
    // 3-column grid: identity / auth / atmosphere.
    // Atmosphere is layered as four radial gradients on the page itself —
    // teal wells lean toward the left zone, the soft purple ambient wraps
    // the right edge so the system accent isn't completely hiding.
    <div
      className="relative h-screen min-h-[680px] grid overflow-hidden"
      style={{
        gridTemplateColumns: '1fr 460px 1fr',
        backgroundColor: 'var(--bg-base)',
        backgroundImage:
          'radial-gradient(ellipse 760px 540px at 18% 35%, rgba(0,196,180,0.12), transparent 60%),' +
          'radial-gradient(ellipse 560px 400px at 14% 80%, rgba(74,158,255,0.06), transparent 65%),' +
          'radial-gradient(ellipse 680px 480px at 86% 60%, rgba(109,74,174,0.07), transparent 65%)',
      }}
    >
      {/* Soft dot-grid texture, masked toward the middle so the edges breathe */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.035) 1px, transparent 0)',
          backgroundSize: '16px 16px',
          maskImage:
            'radial-gradient(ellipse 80% 80% at 30% 50%, black 30%, transparent 85%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 80% at 30% 50%, black 30%, transparent 85%)',
        }}
      />

      {/* Teal ghost arc behind the left zone — sized far larger than the
          mark so it reads as ambient atmosphere, not a logo. */}
      <svg
        aria-hidden
        viewBox="-9 -9 78 78"
        className="absolute pointer-events-none"
        style={{
          left: '-120px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '780px',
          height: '780px',
          opacity: 0.06,
        }}
      >
        <path
          d="M 8,52 Q 8,8 52,8"
          stroke="#00C4B4"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="52" cy="8" r="6" fill="#4A9EFF" />
      </svg>

      {/* ─── LEFT: brand identity ─────────────────────────────────────── */}
      <section className="relative px-16 py-12 flex flex-col justify-between max-[1100px]:px-8 max-[1100px]:gap-12">
        {/* top-left: lockup */}
        <div className="flex items-center gap-3 w-fit">
          <Mark className="w-9 h-9 flex-shrink-0" />
          <div className="leading-[1.1]">
            <div
              className="text-[20px] tracking-[-0.02em] text-primary"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
            >
              Momentum
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted whitespace-nowrap">
              <span>powered by</span>
              <NexaWordmark height={7} className="flex-shrink-0" />
            </div>
          </div>
        </div>

        {/* center-left: editorial tagline */}
        <div className="max-w-[560px]">
          <h1
            className="text-primary"
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontWeight: 400,
              fontSize: 'clamp(48px, 6vw, 80px)',
              lineHeight: 1.02,
              letterSpacing: '-0.01em',
            }}
          >
            Plan time.
            <br />
            Hold the{' '}
            <b
              style={{
                fontStyle: 'normal',
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                color: '#00C4B4',
              }}
            >
              line.
            </b>
          </h1>
          <p
            className="mt-7 max-w-[440px] text-secondary"
            style={{ fontSize: 16, lineHeight: 1.6 }}
          >
            A workspace for teams that ship on time and inside budget. Plan,
            track and report — one place, one truth.
          </p>
        </div>

        {/* bottom-left: mono pulse stamp */}
        <div
          className="flex items-center gap-3 text-[11px] tracking-[0.10em] text-muted"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: '#00C4B4',
              boxShadow: '0 0 8px rgba(0,196,180,0.18)',
            }}
          />
          <span>Live · v4.12</span>
          <span className="w-6 h-px bg-line-muted" />
          <span>© 2026 Digital Nexa</span>
        </div>
      </section>

      {/* ─── CENTER: auth ─────────────────────────────────────────────── */}
      <section className="relative flex items-center justify-center py-12 max-[1100px]:px-8 max-[1100px]:pb-12 max-[1100px]:pt-0">
        <div className="w-full max-w-[420px] flex flex-col">
          <h2
            className="text-primary"
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 24,
              letterSpacing: '-0.005em',
            }}
          >
            Welcome back
          </h2>
          <div className="mt-1.5 mb-7 text-[13px] text-secondary">
            Sign in to your workspace.
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col">
            {/* Email */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="login-email"
                className="flex justify-between items-baseline text-[10px] tracking-[0.14em] uppercase font-medium text-secondary"
              >
                <span>Email</span>
                <span className="text-[11px] tracking-normal normal-case font-normal text-muted">
                  Need an invite?
                </span>
              </label>
              <FieldShell icon={<Mail size={16} />}>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  required
                  autoComplete="email"
                  placeholder="you@digitalnexa.com"
                  onChange={e => setEmail(e.target.value)}
                  className="w-full h-12 bg-transparent border-0 outline-none text-sm text-primary pl-[42px] pr-3.5 font-body placeholder:text-muted/70"
                />
              </FieldShell>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-2 mt-[18px]">
              <label
                htmlFor="login-password"
                className="flex justify-between items-baseline text-[10px] tracking-[0.14em] uppercase font-medium text-secondary"
              >
                <span>Password</span>
                <span className="text-[11px] tracking-normal normal-case font-normal text-secondary border-b border-dashed border-line-muted pb-px cursor-pointer">
                  Forgot?
                </span>
              </label>
              <FieldShell icon={<Lock size={16} />}>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  onChange={e => setPassword(e.target.value)}
                  className="w-full h-12 bg-transparent border-0 outline-none text-sm text-primary pl-[42px] pr-[68px] font-body placeholder:text-muted/70"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-md text-[10px] uppercase tracking-[0.14em] text-muted hover:text-primary hover:bg-surface-hover bg-transparent border-0 cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </FieldShell>
            </div>

            {error && (
              <div className="mt-4 bg-status-rose-dim border border-[rgba(244,63,94,0.2)] rounded-md px-3 py-2.5 text-sm text-status-rose leading-relaxed">
                {error}
              </div>
            )}

            {/* Primary CTA — system purple. The single most important
                action on the page; gets the most colour weight. */}
            <button
              type="submit"
              disabled={loading}
              className="group relative mt-6 h-[50px] rounded-[10px] flex items-center justify-center gap-2 cursor-pointer border-0 font-body font-semibold text-sm tracking-[0.02em] disabled:opacity-60 disabled:cursor-not-allowed transition-[transform,filter,background-color] hover:-translate-y-px active:translate-y-0"
              style={{
                color: '#fff',
                backgroundColor: 'var(--accent)',
                boxShadow:
                  '0 0 0 1px rgba(255,255,255,0.04) inset, 0 14px 32px -12px rgba(109,74,174,0.55)',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#7C58C0')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 mt-6 mb-[14px]">
            <span className="flex-1 h-px bg-line-subtle" />
            <span className="text-[10px] uppercase tracking-[0.20em] text-muted">
              or continue with
            </span>
            <span className="flex-1 h-px bg-line-subtle" />
          </div>

          {/* Google */}
          <button
            type="button"
            onClick={() => googleLogin()}
            disabled={googleLoading}
            className="w-full h-12 flex items-center justify-center gap-3 bg-surface-overlay border border-line-subtle rounded-[10px] text-sm font-medium text-primary cursor-pointer transition-colors hover:bg-surface-hover hover:border-line-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Signing in with Google…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
                  <path fill="#FFC107" d="M43.6 20.5h-1.9V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.6 8.4 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41 35.7 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {/* Footer link */}
          <div className="mt-7 text-center text-xs text-muted">
            New here?{' '}
            <a
              href="mailto:webteam@digitalnexa.com"
              className="text-primary border-b border-dashed border-line-muted pb-px no-underline hover:text-accent hover:border-accent transition-colors"
            >
              Request access
            </a>
          </div>

          {/* Quick access — dev builds only. Kept compact so the calm of
              the page isn't broken in production (where this whole block
              never renders). */}
          {IS_DEV && (
            <div className="mt-6 pt-5 border-t border-line-subtle">
              <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted mb-2.5">
                Quick access — dev
              </div>
              <div className="flex flex-col gap-1.5">
                {[
                  { email: 'murtaza@digitalnexa.com', role: 'Super Admin' },
                  { email: 'haseeb@digitalnexa.com', role: 'Admin' },
                  { email: 'bob@digitalnexa.com',     role: 'Collaborator' },
                ].map(u => (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => { setEmail(u.email); setPassword('password123') }}
                    className="bg-surface-overlay border border-line-subtle rounded-md px-3 py-2 cursor-pointer flex justify-between items-center font-body transition-colors hover:border-line-muted hover:bg-surface-hover"
                  >
                    <span className="text-xs text-secondary">{u.email}</span>
                    <span className="text-[10px] tracking-[0.08em] uppercase text-muted">{u.role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─── RIGHT: atmospheric mirror — purple ghost arc + faint rings ── */}
      <section
        aria-hidden
        className="relative max-[1100px]:hidden"
      >
        {/* Concentric rings, anchored to the right edge, in NEXA-purple
            tones. Mirror the teal atmosphere of the left zone. */}
        <span
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 680, height: 680,
            right: -260, top: '50%', transform: 'translateY(-50%)',
            border: '1px solid rgba(109,74,174,0.06)',
          }}
        />
        <span
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 440, height: 440,
            right: -160, top: '50%', transform: 'translateY(-50%)',
            border: '1px solid rgba(109,74,174,0.08)',
          }}
        />
        <span
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 240, height: 240,
            right: -60, top: '50%', transform: 'translateY(-50%)',
            border: '1px solid rgba(0,196,180,0.05)',
          }}
        />
        {/* Mirrored mark in NEXA-purple. Same shape, rotated 180°, lower
            opacity — purely atmospheric. */}
        <svg
          viewBox="-9 -9 78 78"
          className="absolute pointer-events-none"
          style={{
            right: -180, top: '50%',
            transform: 'translateY(-50%) rotate(180deg)',
            width: 680, height: 680,
            opacity: 0.05,
          }}
        >
          <path
            d="M 8,52 Q 8,8 52,8"
            stroke="#6D4AAE"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="52" cy="8" r="6" fill="#8B2FE0" />
        </svg>
      </section>
    </div>
  )
}

// ─── FieldShell ──────────────────────────────────────────────────────────
// Input wrapper carrying the icon + focus ring + background. Keeps the
// input itself plain so styling concerns don't tangle.
function FieldShell({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative bg-surface-overlay border border-line-subtle rounded-[10px] transition-[border-color,background-color,box-shadow] duration-150 focus-within:border-accent focus-within:bg-[rgba(109,74,174,0.04)] focus-within:shadow-[0_0_0_4px_var(--accent-dim)]">
      <span
        aria-hidden
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
      >
        {icon}
      </span>
      {children}
    </div>
  )
}
