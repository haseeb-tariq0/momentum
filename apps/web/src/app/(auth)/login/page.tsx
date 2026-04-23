'use client'
import { useState } from 'react'
import { useAuthStore } from '@/lib/store'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui'
import { Loader2, TriangleIcon } from 'lucide-react'
import { useGoogleLogin } from '@react-oauth/google'

// Quick-access dev login is disabled in production builds.
const IS_DEV = process.env.NODE_ENV !== 'production'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    } catch (err: any) {
      setError('Cannot reach server. Make sure pnpm dev is running.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center px-4">
      <div className="w-full max-w-[400px] bg-surface-raised border border-line-subtle rounded-xl p-9 shadow-md animate-fade-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-11 h-11 rounded-lg bg-accent flex items-center justify-center mx-auto mb-3">
            <TriangleIcon size={20} className="text-white" fill="white" />
          </div>
          <h1 className="text-2xl font-bold text-primary">Forecast</h1>
          <p className="text-base text-muted mt-1">Digital Nexa</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              value={email}
              required
              autoComplete="email"
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-surface border border-line-muted rounded-md px-3 py-2.5 text-lg text-primary font-body outline-none transition-colors focus:border-accent focus:ring-[3px] focus:ring-accent-dim"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              value={password}
              required
              autoComplete="current-password"
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-surface border border-line-muted rounded-md px-3 py-2.5 text-lg text-primary font-body outline-none transition-colors focus:border-accent focus:ring-[3px] focus:ring-accent-dim"
            />
          </div>

          {error && (
            <div className="bg-status-rose-dim border border-[rgba(244,63,94,0.2)] rounded-md px-3 py-2.5 text-base text-status-rose leading-relaxed">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            className="w-full mt-1 py-2.5 text-lg"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        {/* Google Sign-In */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-line-subtle" />
          <span className="text-xs text-muted uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-line-subtle" />
        </div>

        <button
          type="button"
          onClick={() => googleLogin()}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-3 bg-surface border border-line-muted rounded-md px-3 py-2.5 text-base text-primary font-body cursor-pointer transition-colors hover:bg-surface-hover hover:border-line-muted disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {googleLoading ? (
            <><Loader2 size={16} className="animate-spin" /> Signing in with Google...</>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Sign in with Google
            </>
          )}
        </button>

        {/* Quick access — dev builds only */}
        {IS_DEV && (
          <div className="mt-6 pt-5 border-t border-line-subtle">
            <div className="text-xs text-muted mb-2 uppercase tracking-wider font-semibold">
              Quick access (dev)
            </div>
            <div className="flex flex-col gap-1.5">
              {[
                { email: 'murtaza@digitalnexa.com', role: 'Super Admin' },
                { email: 'haseeb@digitalnexa.com', role: 'Admin' },
                { email: 'bob@digitalnexa.com', role: 'Collaborator' },
              ].map(u => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => { setEmail(u.email); setPassword('password123') }}
                  className="bg-surface border border-line-subtle rounded-md px-3 py-2 cursor-pointer flex justify-between items-center font-body transition-colors hover:border-line-muted hover:bg-surface-hover"
                >
                  <span className="text-sm text-secondary">{u.email}</span>
                  <span className="text-xs text-muted">{u.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
