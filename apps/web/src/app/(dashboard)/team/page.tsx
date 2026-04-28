'use client'
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, authApi } from '@/lib/queries'
import { useAuthStore, useEffectivePermissions } from '@/lib/store'
import { format, subWeeks, startOfWeek } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Lock, List, LayoutGrid, Check, Search, Plus, X, Settings as SettingsIcon, Power,
} from 'lucide-react'
import {
  PageHeader, StatCard, Card, Avatar, Badge, Input, Label, Skeleton, Button,
  EmptyState, Select,
  type BadgeProps,
} from '@/components/ui'
import { showConfirm } from '@/components/ConfirmDialog'
import { showToast } from '@/components/Toast'
import { cn } from '@/lib/cn'

// Map permission profile → Badge variant + label
type Role = { label: string; variant: BadgeProps['variant'] }
const ROLE: Record<string, Role> = {
  super_admin:     { label: 'Super Admin',  variant: 'danger'  },
  admin:           { label: 'Admin',        variant: 'violet'  },
  account_manager: { label: 'Acct Mgr',     variant: 'info'    },
  collaborator:    { label: 'Collaborator', variant: 'default' },
}

// Layout: name | dept | job title | role | last week | capacity | actions
// minmax(0, …fr) lets columns shrink below content width so long names/emails
// don't push the row past its container.
const LIST_GRID_COLS = 'minmax(0,1.8fr) minmax(0,1fr) minmax(0,1fr) 110px 180px 80px 90px'

export default function PeoplePage() {
  const router = useRouter()
  const { isAdmin, isSuperAdmin } = useAuthStore()
  const perms = useEffectivePermissions()
  const canView   = !!perms.view_team
  const canEdit   = isAdmin()       // any admin/AM/super can inline-edit (matches old admin tab)
  const canInvite = isAdmin()       // matches old admin tab gating
  const canManage = isSuperAdmin()  // Off + Perms — matches old admin tab gating

  // ── Filter & view state ────────────────────────────────────────────────────
  const [search, setSearch]             = useState('')
  const [filterDept, setFilterDept]     = useState('All')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'deactivated'>('active')
  const [view, setView]                 = useState<'list' | 'grid'>('list')

  // ── Edit & invite state (lifted from former Admin > People tab) ─────────
  const [editing, setEditing] = useState<{ id: string; field: string; value: string } | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({
    name: '', email: '', jobTitle: '',
    permissionProfile: 'collaborator',
    departmentId: '', capacityHrs: 40, internalHourlyCost: 0,
  })

  const prevWeekStart = format(subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1), 'yyyy-MM-dd')

  // ── Queries ────────────────────────────────────────────────────────────────
  // Backend defaults to active-only; opt in to all users when the filter
  // includes deactivated rows. Separate cache key so toggling the filter
  // doesn't reuse the active-only payload.
  const includeDeactivated = filterStatus !== 'active'
  const qc = useQueryClient()
  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users', includeDeactivated],
    queryFn:  () => usersApi.list(includeDeactivated ? { include_deactivated: 'true' } : undefined).then((r: any) => r.data),
    enabled:  canView,
    staleTime: 60_000,
  })
  const { data: complianceData } = useQuery({
    queryKey: ['compliance', prevWeekStart],
    queryFn:  () => usersApi.timesheetCompliance(prevWeekStart).then((r: any) => r.data),
    enabled:  canView,
    staleTime: 60_000,
  })
  const { data: deptsRaw } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => usersApi.departments().then((r: any) => r.data),
    enabled:  canView,
  })
  const { data: customRolesRaw } = useQuery({
    queryKey: ['custom-roles'],
    queryFn:  () => usersApi.customRoles().then((r: any) => r.data),
    enabled:  canView,
  })

  // ── Mutations (lifted from Admin > People tab) ────────────────────────────
  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => usersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditing(null)
    },
  })
  const deactivate = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  const invite = useMutation({
    mutationFn: () => {
      // Custom role value is encoded as "base_role:uuid" — parse it before sending
      const profile = inviteForm.permissionProfile
      const isCustom = profile.includes(':')
      const permissionProfile = isCustom ? profile.split(':')[0] : profile
      const customRoleId      = isCustom ? profile.split(':')[1] : null
      return authApi.invite({ ...inviteForm, permissionProfile, customRoleId } as any)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowInvite(false)
      setInviteForm({ name: '', email: '', jobTitle: '', permissionProfile: 'collaborator', departmentId: '', capacityHrs: 40, internalHourlyCost: 0 })
    },
  })

  // ── Permission gate ───────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="px-7 py-10">
        <EmptyState
          icon={<Lock />}
          title="Access Required"
          description="You need the View Team permission to see the People directory."
        />
      </div>
    )
  }

  const users:       any[] = usersData       || []
  const compliance:  any[] = complianceData  || []
  const depts:       any[] = deptsRaw        || []
  const customRoles: any[] = customRolesRaw  || []

  const compMap: Record<string, any> = useMemo(() => {
    const m: Record<string, any> = {}
    for (const c of compliance) m[c.id] = c
    return m
  }, [compliance])

  const departments = useMemo(
    () => ['All', ...Array.from(new Set(users.map((u: any) => u.departments?.name).filter(Boolean))).sort() as string[]],
    [users],
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return users.filter((u: any) => {
      const ms = !needle
        || u.name?.toLowerCase().includes(needle)
        || u.email?.toLowerCase().includes(needle)
        || (u.job_title || '').toLowerCase().includes(needle)
      const md = filterDept === 'All' || u.departments?.name === filterDept
      const isActive = u.active !== false
      const mss = filterStatus === 'all'
        || (filterStatus === 'active' && isActive)
        || (filterStatus === 'deactivated' && !isActive)
      return ms && md && mss
    })
  }, [users, search, filterDept, filterStatus])

  const deptCount   = useMemo(() => new Set(users.map((u: any) => u.departments?.name).filter(Boolean)).size, [users])
  const activeCount = useMemo(() => users.filter((u: any) => u.active !== false).length, [users])

  const clearFilters = () => { setSearch(''); setFilterDept('All'); setFilterStatus('active') }

  // ── Inline edit helper ────────────────────────────────────────────────────
  function saveEdit(u: any) {
    if (!editing || editing.id !== u.id) return
    let val: any = editing.value
    if (editing.field === 'capacity_hrs') {
      const n = Number(editing.value)
      if (!Number.isFinite(n) || n < 0 || n > 168) {
        showToast.error('Capacity must be a number between 0 and 168')
        return
      }
      val = n
    }
    if (editing.field === 'permission_profile' && String(val).includes(':')) {
      const [baseRole, roleId] = String(val).split(':')
      updateUser.mutate({ id: u.id, data: { permission_profile: baseRole, custom_role_id: roleId } })
    } else if (editing.field === 'permission_profile') {
      updateUser.mutate({ id: u.id, data: { permission_profile: val, custom_role_id: null } })
    } else {
      updateUser.mutate({ id: u.id, data: { [editing.field]: val } })
    }
  }

  // Editable cell — when canEdit, click to edit; otherwise plain text.
  function EditableCell({ u, field, display, options, className }: {
    u: any; field: string; display: string;
    options?: { value: string; label: string }[]; className?: string;
  }) {
    if (!canEdit) {
      return <div className={cn('text-sm text-secondary truncate', className)}>{display || '—'}</div>
    }
    const isEdit = editing?.id === u.id && editing?.field === field
    if (isEdit) {
      if (options) return (
        <Select
          autoFocus size="sm"
          aria-label={`Edit ${field}`}
          defaultValue={editing!.value}
          onChange={e => setEditing({ ...editing!, value: e.target.value })}
          onBlur={() => saveEdit(u)}
          onKeyDown={e => { if (e.key === 'Enter') saveEdit(u); if (e.key === 'Escape') setEditing(null) }}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )
      return (
        <Input
          autoFocus
          type={field === 'capacity_hrs' ? 'number' : 'text'}
          defaultValue={editing!.value}
          onChange={e => setEditing({ ...editing!, value: e.target.value })}
          onBlur={() => saveEdit(u)}
          onKeyDown={e => { if (e.key === 'Enter') saveEdit(u); if (e.key === 'Escape') setEditing(null) }}
          className="text-sm py-1"
        />
      )
    }
    return (
      <div
        title="Click to edit"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setEditing({ id: u.id, field, value: String(u[field] ?? display) })
        }}
        className={cn('cursor-pointer text-sm text-secondary px-1 py-0.5 rounded-sm transition-colors hover:bg-surface-hover truncate', className)}
      >
        {display || <span className="text-muted italic">—</span>}
      </div>
    )
  }

  return (
    <div className="px-7 py-6">

      <PageHeader
        title="People"
        actions={
          <div className="flex items-center gap-2">
            {canInvite && (
              <Button
                variant={showInvite ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => setShowInvite(s => !s)}
              >
                {showInvite ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Invite Member</>}
              </Button>
            )}
            <div className="flex gap-1.5 p-0.5 bg-surface-raised border border-line-subtle rounded-md">
              {(['list', 'grid'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors duration-150 cursor-pointer',
                    view === v
                      ? 'bg-accent-dim text-accent'
                      : 'text-secondary hover:text-primary hover:bg-surface-hover',
                  )}
                  aria-pressed={view === v}
                >
                  {v === 'list' ? <><List size={13} /> List</> : <><LayoutGrid size={13} /> Grid</>}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* Invite form — collapsible, super-admin / admin only */}
      {canInvite && showInvite && (
        <Card className="px-4 py-4 mb-3.5 border-line-muted">
          <div className="text-base font-semibold text-primary mb-3">Invite Team Member</div>
          <div className="grid grid-cols-3 gap-2.5 mb-3">
            {([
              { label: 'Full Name *', key: 'name', type: 'text', placeholder: 'Jane Smith' },
              { label: 'Email *', key: 'email', type: 'email', placeholder: 'jane@digitalnexa.com' },
              { label: 'Job Title', key: 'jobTitle', type: 'text', placeholder: 'Account Manager' },
            ] as any[]).map(f => (
              <div key={f.key}>
                <Label className="text-xs uppercase tracking-wider">{f.label}</Label>
                <Input
                  type={f.type}
                  placeholder={f.placeholder}
                  value={(inviteForm as any)[f.key]}
                  onChange={e => setInviteForm(frm => ({ ...frm, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <div>
              <Label className="text-xs uppercase tracking-wider">Role</Label>
              <Select
                aria-label="Role"
                value={inviteForm.permissionProfile}
                onChange={e => setInviteForm(f => ({ ...f, permissionProfile: e.target.value }))}
              >
                <optgroup label="Built-in">
                  <option value="collaborator">Collaborator</option>
                  <option value="account_manager">Account Manager</option>
                  <option value="admin">Admin</option>
                  {isSuperAdmin() && <option value="super_admin">Super Admin</option>}
                </optgroup>
                {customRoles.length > 0 && (
                  <optgroup label="Custom Roles">
                    {customRoles.map((r: any) => (
                      <option key={r.id} value={r.base_role + ':' + r.id}>{r.name}</option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider">Department</Label>
              <Select
                aria-label="Department"
                value={inviteForm.departmentId}
                onChange={e => setInviteForm(f => ({ ...f, departmentId: e.target.value }))}
              >
                <option value="">No department</option>
                {depts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => invite.mutate()}
              disabled={!inviteForm.name || !inviteForm.email || invite.isPending}
              loading={invite.isPending}
            >
              {invite.isPending ? 'Inviting...' : 'Send Invite'}
            </Button>
            <Button variant="secondary" onClick={() => setShowInvite(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 mb-5">
        <StatCard label="Total Members" value={users.length} sub={`${activeCount} active`} />
        <StatCard label="Departments"   value={deptCount}    sub="teams" tone="amber" />
        <StatCard
          label="Filtered"
          value={filtered.length}
          sub={(() => {
            const statusLabel = filterStatus === 'active' ? 'active' : filterStatus === 'deactivated' ? 'deactivated' : ''
            const deptLabel = filterDept === 'All' ? '' : `in ${filterDept}`
            const parts = [statusLabel, deptLabel].filter(Boolean)
            return parts.length ? parts.join(' ') : 'showing all'
          })()}
          tone="accent"
        />
      </div>

      {/* Search + dept + status filters */}
      <div className="flex gap-2.5 mb-3.5">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, or job title…"
            className="pl-9 py-2 text-base"
          />
        </div>
        <Select
          aria-label="Filter by department"
          value={filterDept}
          onChange={e => setFilterDept(e.target.value)}
          className="w-auto min-w-[180px]"
        >
          {departments.map(d => (
            <option key={d} value={d}>{d === 'All' ? 'All Departments' : d}</option>
          ))}
        </Select>
        <Select
          aria-label="Filter by status"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as 'all' | 'active' | 'deactivated')}
          className="w-auto min-w-[150px]"
        >
          <option value="active">Active only</option>
          <option value="deactivated">Deactivated only</option>
          <option value="all">All statuses</option>
        </Select>
      </div>

      {/* LIST VIEW */}
      {view === 'list' && (
        <Card className="overflow-hidden p-0">
          {/* Sticky header */}
          <div
            className="grid items-center px-5 py-2.5 bg-surface border-b border-line-subtle sticky top-0 z-sticky"
            style={{ gridTemplateColumns: LIST_GRID_COLS, columnGap: 14 }}
          >
            {['Name', 'Department', 'Job Title', 'Role', 'Last Week', 'Capacity', ''].map((h, i) => (
              <div key={i} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
            ))}
          </div>

          {isLoading && (
            <div className="flex flex-col gap-2 px-5 py-3.5">
              {[0, 1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-[54px] w-full" />
              ))}
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <EmptyState
              title="No members match your search"
              action={
                (search || filterDept !== 'All' || filterStatus !== 'active') && (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )
              }
            />
          )}

          {!isLoading && filtered.map((u: any, i: number) => {
            const role      = ROLE[u.permission_profile] || ROLE.collaborator
            const comp      = compMap[u.id]
            const logged    = comp?.loggedHrs    || 0
            const cap       = comp?.capacityHrs  || Number(u.capacity_hrs || 40)
            const util      = cap > 0 ? Math.round((logged / cap) * 100) : 0
            const submitted = comp?.submitted
            const barColor  = util >= 100 ? 'bg-status-rose' : util >= 75 ? 'bg-status-amber' : 'bg-accent'
            const utilColor = util >= 100 ? 'text-status-rose' : util >= 75 ? 'text-status-amber' : 'text-accent'
            const capHrs    = Number(u.capacity_hrs || 40)
            const isLast    = i === filtered.length - 1
            const hasCustom = Object.keys(u.custom_permissions || {}).length > 0
            const isActive  = u.active !== false

            // Row navigates to the detail page on click — but inline-edit cells
            // and action buttons stop propagation so they don't trigger nav.
            return (
              <div
                key={u.id}
                className={cn(
                  'grid items-center px-5 py-3 transition-colors duration-150 hover:bg-surface-hover',
                  !isLast && 'border-b border-line-subtle',
                  !isActive && 'opacity-50',
                )}
                style={{ gridTemplateColumns: LIST_GRID_COLS, columnGap: 14 }}
              >
                {/* Avatar + name (link to detail) */}
                <Link
                  href={`/team/${u.id}`}
                  className="flex items-center gap-2.5 min-w-0 no-underline text-inherit"
                >
                  <Avatar name={u.name || '?'} size="lg" />
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-primary truncate flex items-center gap-1.5">
                      <span className="truncate">{u.name}</span>
                      {hasCustom && (
                        <Badge variant="violet" className="text-[9px] px-1.5 py-px flex-shrink-0">CUSTOM</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted truncate">{u.email}</div>
                  </div>
                </Link>

                {/* Dept (inline-editable for admins) */}
                <EditableCell
                  u={u}
                  field="department_id"
                  display={u.departments?.name || '—'}
                  options={[{ value: '', label: 'No dept' }, ...depts.map((d: any) => ({ value: d.id, label: d.name }))]}
                />

                {/* Job title (inline-editable) */}
                <EditableCell u={u} field="job_title" display={u.job_title || '—'} />

                {/* Role (inline-editable for admins, shown as Badge otherwise) */}
                <div>
                  {canEdit && editing?.id === u.id && editing?.field === 'permission_profile' ? (
                    <Select
                      autoFocus size="sm"
                      aria-label="Edit role"
                      defaultValue={u.permission_profile}
                      onChange={e => setEditing({ id: u.id, field: 'permission_profile', value: e.target.value })}
                      onBlur={() => saveEdit(u)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(u); if (e.key === 'Escape') setEditing(null) }}
                    >
                      <optgroup label="Built-in">
                        <option value="collaborator">Collaborator</option>
                        <option value="account_manager">Account Manager</option>
                        <option value="admin">Admin</option>
                        {isSuperAdmin() && <option value="super_admin">Super Admin</option>}
                      </optgroup>
                      {customRoles.length > 0 && (
                        <optgroup label="Custom">
                          {customRoles.map((r: any) => <option key={r.id} value={r.base_role + ':' + r.id}>{r.name}</option>)}
                        </optgroup>
                      )}
                    </Select>
                  ) : canEdit ? (
                    <div
                      title="Click to edit"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setEditing({ id: u.id, field: 'permission_profile', value: u.permission_profile })
                      }}
                      className="cursor-pointer hover:bg-surface-hover rounded-sm px-0.5 py-0.5 inline-block"
                    >
                      <Badge variant={role.variant}>{u.custom_roles?.name || role.label}</Badge>
                    </div>
                  ) : (
                    <Badge variant={role.variant}>{u.custom_roles?.name || role.label}</Badge>
                  )}
                </div>

                {/* Last week utilization */}
                <Link
                  href={`/team/${u.id}`}
                  className="min-w-0 overflow-hidden no-underline text-inherit"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="flex-1 h-1.5 bg-surface-overlay rounded-full overflow-hidden min-w-0">
                      <div
                        className={cn('h-full rounded-full transition-[width] duration-500', barColor)}
                        style={{ width: `${Math.min(util, 100)}%` }}
                      />
                    </div>
                    <span className={cn('text-xs font-bold min-w-[34px] text-right tabular-nums flex-shrink-0', utilColor)}>{util}%</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted whitespace-nowrap overflow-hidden text-ellipsis">
                    <span className="tabular-nums flex-shrink-0">{logged.toFixed(1)}h / {cap}h</span>
                    {submitted === false && (
                      <span className="text-status-rose font-bold text-[9px] bg-status-rose-dim px-1.5 py-px rounded flex-shrink-0">
                        NOT SUBMITTED
                      </span>
                    )}
                    {submitted === true && (
                      <span className="text-accent inline-flex flex-shrink-0" aria-label="Submitted">
                        <Check size={11} />
                      </span>
                    )}
                  </div>
                </Link>

                {/* Capacity (inline-editable) */}
                <EditableCell
                  u={u}
                  field="capacity_hrs"
                  display={`${capHrs}h`}
                  className="text-right tabular-nums"
                />

                {/* Actions (super-admin only) */}
                <div className="flex items-center gap-1 justify-end">
                  {canManage && (
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        // Send to Admin > Permissions tab pre-selected for this user.
                        // The admin page reads ?tab and ?user from the URL on mount.
                        router.push(`/admin?tab=permissions&user=${u.id}`)
                      }}
                      className={cn(
                        'rounded-sm text-[11px] cursor-pointer font-semibold px-2 py-1 border',
                        hasCustom
                          ? 'bg-status-violet-dim border-[rgba(139,92,246,0.3)] text-status-violet'
                          : 'bg-transparent border-line-muted text-secondary hover:bg-surface-hover',
                      )}
                      title="Edit permissions"
                    >
                      Perms
                    </button>
                  )}
                  {canManage && isActive && (
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        showConfirm(
                          `Deactivate ${u.name}?`,
                          () => deactivate.mutate(u.id),
                          { confirmLabel: 'Deactivate', subtext: 'The user will lose access to the platform.' },
                        )
                      }}
                      className="text-[11px] text-muted hover:text-status-rose cursor-pointer font-semibold px-1.5 py-1 bg-transparent border-none"
                      title="Deactivate user"
                      aria-label={`Deactivate ${u.name}`}
                    >
                      Off
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {!isLoading && filtered.length > 0 && (
            <div className="px-5 py-2.5 bg-surface border-t border-line-subtle text-xs text-muted">
              Showing {filtered.length} of {users.length} members · Utilization from previous week
            </div>
          )}
        </Card>
      )}

      {/* GRID VIEW */}
      {view === 'grid' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
          {!isLoading && filtered.map((u: any) => {
            const role      = ROLE[u.permission_profile] || ROLE.collaborator
            const comp      = compMap[u.id]
            const logged    = comp?.loggedHrs    || 0
            const cap       = comp?.capacityHrs  || Number(u.capacity_hrs || 40)
            const util      = cap > 0 ? Math.round((logged / cap) * 100) : 0
            const barColor  = util >= 100 ? 'bg-status-rose' : util >= 75 ? 'bg-status-amber' : 'bg-accent'
            const utilColor = util >= 100 ? 'text-status-rose' : util >= 75 ? 'text-status-amber' : 'text-accent'
            const hasCustom = Object.keys(u.custom_permissions || {}).length > 0
            const isActive  = u.active !== false

            return (
              <div
                key={u.id}
                className={cn(
                  'relative bg-surface-raised border border-line-subtle rounded-lg p-4 pb-3.5',
                  'transition-[border-color,box-shadow] duration-150 hover:border-line-accent hover:shadow-md',
                  !isActive && 'opacity-50',
                )}
              >
                {/* Action buttons in card top-right (super-admin only) */}
                {canManage && (
                  <div className="absolute top-2 right-2 flex gap-1 z-10">
                    <button
                      onClick={() => router.push(`/admin?tab=permissions&user=${u.id}`)}
                      className={cn(
                        'rounded-sm text-[10px] cursor-pointer font-semibold px-1.5 py-0.5 border',
                        hasCustom
                          ? 'bg-status-violet-dim border-[rgba(139,92,246,0.3)] text-status-violet'
                          : 'bg-transparent border-line-muted text-secondary hover:bg-surface-hover',
                      )}
                      title="Edit permissions"
                      aria-label="Edit permissions"
                    >
                      <SettingsIcon size={11} />
                    </button>
                    {isActive && (
                      <button
                        onClick={() => showConfirm(
                          `Deactivate ${u.name}?`,
                          () => deactivate.mutate(u.id),
                          { confirmLabel: 'Deactivate', subtext: 'The user will lose access to the platform.' },
                        )}
                        className="rounded-sm text-[10px] cursor-pointer text-muted hover:text-status-rose hover:bg-status-rose-dim px-1.5 py-0.5 bg-transparent border border-line-muted"
                        title="Deactivate user"
                        aria-label={`Deactivate ${u.name}`}
                      >
                        <Power size={11} />
                      </button>
                    )}
                  </div>
                )}

                <Link
                  href={`/team/${u.id}`}
                  className="block no-underline text-inherit"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar name={u.name || '?'} size="lg" className="w-11 h-11 text-sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold text-primary truncate flex items-center gap-1.5">
                        <span className="truncate">{u.name}</span>
                        {hasCustom && (
                          <Badge variant="violet" className="text-[9px] px-1 py-px flex-shrink-0">·</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted truncate">{u.job_title || '—'}</div>
                    </div>
                  </div>
                  <div className="text-xs text-secondary mb-1.5 truncate">
                    {u.departments?.name || 'No Department'}
                  </div>
                  <div className="mb-3">
                    <Badge variant={role.variant}>{u.custom_roles?.name || role.label}</Badge>
                  </div>
                  <div className="text-[10px] text-muted mb-1.5 tabular-nums">
                    Last week · {logged.toFixed(1)}h / {cap}h
                  </div>
                  <div className="bg-surface-overlay rounded-full h-1.5 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-[width] duration-500', barColor)}
                      style={{ width: `${Math.min(util, 100)}%` }}
                    />
                  </div>
                  <div className={cn('text-xs font-bold mt-1.5 text-right tabular-nums', utilColor)}>
                    {util}%
                  </div>
                </Link>
              </div>
            )
          })}

          {isLoading && Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-surface-raised border border-line-subtle rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="w-11 h-11 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-2 w-3/4" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}

          {!isLoading && filtered.length === 0 && (
            <div className="col-span-full">
              <EmptyState
                title="No members match your search"
                action={
                  (search || filterDept !== 'All' || filterStatus !== 'active') && (
                    <Button variant="secondary" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
