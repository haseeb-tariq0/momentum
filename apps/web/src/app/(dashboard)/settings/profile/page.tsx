'use client'
import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import Link from 'next/link'
import { showToast } from '@/components/Toast'
import { ChevronRight, Check, Lock } from 'lucide-react'
import {
  Card, Avatar, Badge, Input, Label, Button,
  type BadgeProps,
} from '@/components/ui'

const ROLE: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  super_admin:     { label: 'Super Admin',     variant: 'danger'  },
  admin:           { label: 'Admin',           variant: 'violet'  },
  account_manager: { label: 'Account Manager', variant: 'warning' },
  collaborator:    { label: 'Collaborator',    variant: 'default' },
}

export default function ProfileSettingsPage() {
  const qc = useQueryClient()
  const { user, setUser } = useAuthStore()
  const [form, setForm]   = useState({ name: '', job_title: '' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (user) setForm({ name: user.name || '', job_title: user.jobTitle || '' })
  }, [user])

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current) }, [])

  const updateProfile = useMutation({
    mutationFn: () => usersApi.updateProfile(user!.id, { name: form.name, job_title: form.job_title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      if (user) setUser({ ...user, name: form.name, jobTitle: form.job_title })
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
    },
    onError: (e: any) => showToast.error('Save failed: ' + (e?.message || 'unknown error')),
  })

  const role = ROLE[user?.permissionProfile || 'collaborator']

  const readOnlyFields = [
    { label: 'Email',      value: user?.email          || '—' },
    { label: 'Role',       value: role.label },
    { label: 'Department', value: user?.departmentName || '—' },
    { label: 'Capacity',   value: `${user?.capacityHrs || 40}h/week` },
  ]

  const isDirty = form.name !== (user?.name || '') || form.job_title !== (user?.jobTitle || '')

  return (
    <div className="flex flex-col gap-5">
      {/* Identity preview — doubles as a hero so the page opens with context
          about *who* is being edited rather than a bare form. Avatar upshift
          + badge row make the identity feel owned, not generic. */}
      <Card className="flex items-center gap-5 px-6 py-5 relative overflow-hidden">
        {/* Soft accent wash in the corner — decorative, low-contrast. */}
        <div
          aria-hidden
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-accent/10 pointer-events-none"
        />
        <Avatar name={form.name || '?'} size="lg" className="w-20 h-20 text-2xl relative z-10 ring-2 ring-surface-raised" />
        <div className="flex-1 min-w-0 relative z-10">
          <div className="text-2xl font-semibold text-primary mb-0.5 truncate font-heading">
            {form.name || 'Your Name'}
          </div>
          <div className="text-base text-secondary mb-2 truncate">
            {form.job_title || 'Job title'}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={role.variant}>{role.label}</Badge>
            {user?.departmentName && (
              <span className="text-xs text-muted">{user.departmentName}</span>
            )}
            <span className="text-xs text-muted">·</span>
            <span className="text-xs text-muted truncate">{user?.email}</span>
          </div>
        </div>
      </Card>

      {/* Editable fields */}
      <Card className="overflow-hidden p-0">
        <div className="px-6 py-4 border-b border-line-subtle">
          <div className="text-sm font-semibold text-primary">Your details</div>
          <div className="text-xs text-muted mt-0.5">Name and job title — the rest is managed by an admin.</div>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="profile-name">Full Name</Label>
              <Input
                id="profile-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Your full name"
              />
            </div>
            <div>
              <Label htmlFor="profile-title">Job Title</Label>
              <Input
                id="profile-title"
                value={form.job_title}
                onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))}
                placeholder="e.g. Senior Account Manager"
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-5 border-t border-line-subtle bg-surface-overlay/40">
          <div className="text-xs font-bold uppercase tracking-wider text-muted mb-3">Admin-managed</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {readOnlyFields.map(f => (
              <div key={f.label}>
                <div className="text-[11px] text-muted mb-1">{f.label}</div>
                <div className="px-3 py-2 bg-surface-raised border border-line-subtle rounded-md text-sm text-secondary truncate" title={f.value}>
                  {f.value}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-3 flex items-center gap-1">
            <Lock size={10} className="inline" />
            Need a change? Ping your workspace admin — these fields are locked to prevent accidental edits.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-line-subtle flex items-center gap-3 bg-surface-raised">
          <Button
            variant="primary"
            size="md"
            onClick={() => updateProfile.mutate()}
            disabled={!form.name || !isDirty}
            loading={updateProfile.isPending}
          >
            Save Changes
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-accent font-medium">
              <Check size={14} /> Saved
            </span>
          )}
          {updateProfile.isError && !saved && (
            <span className="text-sm text-status-rose">Save failed</span>
          )}
          {!isDirty && !saved && (
            <span className="text-xs text-muted">No changes to save</span>
          )}
        </div>
      </Card>

      {/* Security shortcut */}
      <Card interactive className="overflow-hidden p-0">
        <Link
          href="/settings/password"
          className="flex items-center justify-between px-5 py-4 no-underline"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-md bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
              <Lock size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-primary mb-0.5">Change Password</div>
              <div className="text-xs text-muted">
                Update your password — especially if you were given a temporary one
              </div>
            </div>
          </div>
          <ChevronRight size={16} className="text-muted flex-shrink-0" aria-hidden />
        </Link>
      </Card>
    </div>
  )
}
