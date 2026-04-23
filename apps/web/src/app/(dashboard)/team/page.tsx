'use client'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usersApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { format, subWeeks, startOfWeek } from 'date-fns'
import Link from 'next/link'
import { Lock, List, LayoutGrid, Check, Search } from 'lucide-react'
import {
  PageHeader, StatCard, Card, Avatar, Badge, Input, Skeleton, Button, EmptyState, Select,
  type BadgeProps,
} from '@/components/ui'
import { cn } from '@/lib/cn'

// Map permission profile → Badge variant + label
type Role = { label: string; variant: BadgeProps['variant'] }
const ROLE: Record<string, Role> = {
  super_admin:     { label: 'Super Admin',  variant: 'danger'  },
  admin:           { label: 'Admin',        variant: 'violet'  },
  account_manager: { label: 'Acct Mgr',     variant: 'info'    },
  collaborator:    { label: 'Collaborator', variant: 'default' },
}

// minmax(0, …fr) lets columns shrink below content width so long names/emails
// don't push the row past its container.
const LIST_GRID_COLS = 'minmax(0,1.8fr) minmax(0,1fr) minmax(0,1fr) 110px 180px 80px'

export default function TeamPage() {
  const { isAdmin } = useAuthStore()
  const [search, setSearch]             = useState('')
  const [filterDept, setFilterDept]     = useState('All')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'deactivated'>('active')
  const [view, setView]                 = useState<'list' | 'grid'>('list')

  const prevWeekStart = format(subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1), 'yyyy-MM-dd')

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn:  () => usersApi.list().then((r: any) => r.data),
    enabled:  isAdmin(),
    staleTime: 60_000,
  })
  const { data: complianceData } = useQuery({
    queryKey: ['compliance', prevWeekStart],
    queryFn:  () => usersApi.timesheetCompliance(prevWeekStart).then((r: any) => r.data),
    enabled:  isAdmin(),
    staleTime: 60_000,
  })

  if (!isAdmin()) {
    return (
      <div className="px-7 py-10">
        <EmptyState
          icon={<Lock />}
          title="Admin Access Required"
          description="You need admin permissions to view the team directory."
        />
      </div>
    )
  }

  const users:      any[] = usersData      || []
  const compliance: any[] = complianceData || []

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

  const clearFilters = () => { setSearch(''); setFilterDept('All'); setFilterStatus('all') }

  return (
    <div className="px-7 py-6">

      <PageHeader
        title="Team"
        actions={
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
        }
      />

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
            {['Name', 'Department', 'Job Title', 'Role', 'Last Week', 'Capacity'].map(h => (
              <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
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
                (search || filterDept !== 'All' || filterStatus !== 'all') && (
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

            return (
              <Link
                key={u.id}
                href={`/team/${u.id}`}
                className={cn(
                  'grid items-center px-5 py-3 transition-colors duration-150 cursor-pointer no-underline text-inherit hover:bg-surface-hover',
                  !isLast && 'border-b border-line-subtle',
                  u.active === false && 'opacity-50',
                )}
                style={{ gridTemplateColumns: LIST_GRID_COLS, columnGap: 14 }}
              >
                {/* Avatar + name */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={u.name || '?'} size="lg" />
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-primary truncate">{u.name}</div>
                    <div className="text-xs text-muted truncate">{u.email}</div>
                  </div>
                </div>

                {/* Dept */}
                <div className="text-sm text-secondary truncate">{u.departments?.name || '—'}</div>

                {/* Job title */}
                <div className="text-sm text-secondary truncate">{u.job_title || '—'}</div>

                {/* Role */}
                <div>
                  <Badge variant={role.variant}>{role.label}</Badge>
                </div>

                {/* Last week utilization */}
                <div className="min-w-0 overflow-hidden">
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
                </div>

                {/* Capacity */}
                <div className="text-sm font-medium text-secondary tabular-nums text-right">{capHrs}h/w</div>
              </Link>
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

            return (
              <Link
                key={u.id}
                href={`/team/${u.id}`}
                className={cn(
                  'block bg-surface-raised border border-line-subtle rounded-lg p-4 pb-3.5',
                  'transition-[border-color,box-shadow] duration-150 cursor-pointer no-underline text-inherit',
                  'hover:border-line-accent hover:shadow-md',
                  u.active === false && 'opacity-50',
                )}
              >
                <div className="flex items-center gap-3 mb-3">
                  <Avatar name={u.name || '?'} size="lg" className="w-11 h-11 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-bold text-primary truncate">{u.name}</div>
                    <div className="text-xs text-muted truncate">{u.job_title || '—'}</div>
                  </div>
                </div>
                <div className="text-xs text-secondary mb-1.5 truncate">
                  {u.departments?.name || 'No Department'}
                </div>
                <div className="mb-3">
                  <Badge variant={role.variant}>{role.label}</Badge>
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
                  (search || filterDept !== 'All') && (
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
