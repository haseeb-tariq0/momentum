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
      {/* Section title */}
      <div>
        <h2 className="text-lg font-semibold text-primary">Profile</h2>
        <p className="text-sm text-muted">Update your name and job title. Email and role can only be changed by an admin.</p>
      </div>

      {/* Identity preview */}
      <Card className="flex items-center gap-4 px-5 py-4">
        <Avatar name={form.name || '?'} size="lg" className="w-16 h-16 text-xl" />
        <div className="flex-1 min-w-0">
          <div className="text-xl font-semibold text-primary mb-0.5 truncate">
            {form.name || 'Your Name'}
          </div>
          <div className="text-base text-secondary mb-1.5 truncate">
            {form.job_title || 'Job title'}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={role.variant}>{role.label}</Badge>
            <span className="text-xs text-muted truncate">{user?.email}</span>
          </div>
        </div>
      </Card>

      {/* Editable fields */}
      <Card className="p-6">
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

        <div className="mt-6 pt-5 border-t border-line-subtle">
          <div className="text-xs font-bold uppercase tracking-wider text-muted mb-3">Admin-managed</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {readOnlyFields.map(f => (
              <div key={f.label}>
                <div className="text-[11px] text-muted mb-1">{f.label}</div>
                <div className="px-3 py-2 bg-surface border border-line-subtle rounded-md text-sm text-secondary truncate" title={f.value}>
                  {f.value}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-2">
            Need a change? Ping your workspace admin — these fields are locked to prevent accidental edits.
          </p>
        </div>

        <div className="mt-6 pt-5 border-t border-line-subtle flex items-center gap-3">
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
      <Card className="overflow-hidden p-0">
        <div className="px-4 py-2.5 border-b border-line-subtle text-[10px] font-bold uppercase tracking-wider text-muted">
          Security
        </div>
        <Link
          href="/settings/password"
          className="flex items-center justify-between px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover no-underline cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
              <Lock size={16} />
            </div>
            <div>
              <div className="text-sm font-medium text-primary mb-0.5">Change Password</div>
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
