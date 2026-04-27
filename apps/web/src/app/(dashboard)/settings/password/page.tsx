'use client'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/lib/queries'
import Link from 'next/link'
import { Check, AlertCircle, Shield } from 'lucide-react'
import { Card, Input, Label, Button } from '@/components/ui'
import { cn } from '@/lib/cn'

// Password-strength rating (0–4) based on length + character variety.
// Matches the tiered bar renderer below — keep in sync when tweaking.
function strengthOf(pw: string): number {
  if (pw.length >= 12 && /[A-Z]/.test(pw) && /[0-9]/.test(pw)) return 4
  if (pw.length >= 10) return 3
  if (pw.length >= 8)  return 2
  if (pw.length >= 1)  return 1
  return 0
}

const STRENGTH_LABEL = ['', 'Too short', 'Fair', 'Good', 'Strong']
const STRENGTH_COLOR = ['', 'bg-status-rose', 'bg-status-amber', 'bg-accent', 'bg-accent']

export default function ChangePasswordPage() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [done, setDone] = useState(false)

  const mutation = useMutation({
    mutationFn: () => authApi.changePassword(form.current, form.next),
    onSuccess: () => { setDone(true); setForm({ current: '', next: '', confirm: '' }) },
  })

  const mismatch  = !!form.next && !!form.confirm && form.next !== form.confirm
  const tooShort  = !!form.next && form.next.length < 8
  const canSubmit = !!(form.current && form.next.length >= 8 && form.next === form.confirm)

  const errMsg = (() => {
    const msg = (mutation.error as any)?.message || ''
    if (msg.includes('WRONG_PASSWORD')) return 'Current password is incorrect'
    if (mutation.error) return 'Something went wrong — try again'
    return null
  })()

  const strength = strengthOf(form.next)

  return (
    <div className="flex flex-col gap-5 w-full">
      <div>
        <h2 className="text-lg font-semibold text-primary">Password</h2>
        <p className="text-sm text-muted">
          Minimum 8 characters. You won't be signed out of other sessions.
        </p>
      </div>

      {done && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-accent/30 bg-accent/10 text-accent">
          <Check size={14} />
          <span className="text-sm font-medium">Password updated successfully</span>
        </div>
      )}

      {errMsg && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-status-rose/30 bg-status-rose/10 text-status-rose">
          <AlertCircle size={14} />
          <span className="text-sm">{errMsg}</span>
        </div>
      )}

      <Card className="p-6">
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="pw-current">Current Password</Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={form.current}
              onChange={e => setForm(p => ({ ...p, current: e.target.value }))}
              placeholder="Your current password"
              onKeyDown={e => e.key === 'Enter' && canSubmit && mutation.mutate()}
            />
          </div>

          <div>
            <Label htmlFor="pw-next">New Password</Label>
            <Input
              id="pw-next"
              type="password"
              autoComplete="new-password"
              value={form.next}
              onChange={e => setForm(p => ({ ...p, next: e.target.value }))}
              placeholder="Minimum 8 characters"
              aria-invalid={tooShort || undefined}
              onKeyDown={e => e.key === 'Enter' && canSubmit && mutation.mutate()}
            />
            {tooShort && (
              <div className="mt-1 text-xs text-status-rose">Must be at least 8 characters</div>
            )}
            {form.next.length > 0 && (
              <div className="mt-2">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map(n => (
                    <div
                      key={n}
                      className={cn(
                        'flex-1 h-1 rounded-sm transition-colors',
                        n <= strength ? STRENGTH_COLOR[strength] : 'bg-surface-overlay',
                      )}
                    />
                  ))}
                </div>
                <div className="mt-1 text-xs text-muted">
                  Strength: <span className="text-secondary">{STRENGTH_LABEL[strength] || '—'}</span>
                  {strength < 4 && form.next.length > 0 && (
                    <span className="text-muted"> · 12+ chars with upper-case + number = Strong</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="pw-confirm">Confirm Password</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))}
              placeholder="Repeat new password"
              aria-invalid={mismatch || undefined}
              onKeyDown={e => e.key === 'Enter' && canSubmit && mutation.mutate()}
            />
            {mismatch && (
              <div className="mt-1 text-xs text-status-rose">Passwords don't match</div>
            )}
          </div>

          <div className="pt-3 mt-1 border-t border-line-subtle flex items-center gap-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
              loading={mutation.isPending}
            >
              Update Password
            </Button>
            <Link href="/settings/profile" className="text-sm text-muted hover:text-primary no-underline">
              Cancel
            </Link>
          </div>
        </div>
      </Card>

      {/* Security tips footer — subtle, educational */}
      <Card className="p-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded-md bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
          <Shield size={15} />
        </div>
        <div className="text-xs text-muted leading-relaxed">
          <span className="text-secondary font-medium">Tips:</span> Use a unique password you don't reuse anywhere
          else. A passphrase — four unrelated words like <code className="text-accent">coral-table-velvet-8</code> —
          is easier to remember and stronger than a short password with special characters.
        </div>
      </Card>
    </div>
  )
}
