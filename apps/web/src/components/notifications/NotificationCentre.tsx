'use client'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectsApi, usersApi, timeApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { format, subWeeks, startOfWeek } from 'date-fns'
import { Bell, AlertTriangle, CalendarDays, ClipboardList, CheckCircle2, ListChecks } from 'lucide-react'
import { todayLocalISO } from '@/lib/utils'


const NOTIF_ICONS: Record<string, React.ComponentType<any>> = {
  'warning': AlertTriangle,
  'calendar': CalendarDays,
  'clipboard': ClipboardList,
  'tasks': ListChecks,
  'check': CheckCircle2,
}

interface Notification {
  id: string
  type: 'budget' | 'timesheet' | 'task' | 'team' | 'system'
  title: string
  body: string
  time: string
  read: boolean
  color: string
  icon: string
  href?: string
}

export default function NotificationCentre() {
  const { user, isAdmin } = useAuthStore()
  const [open, setOpen]     = useState(false)
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all'|'unread'>('all')

  const prevWeekStart = format(subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1), 'yyyy-MM-dd')
  const today = todayLocalISO()

  // Load data for notifications
  const { data: projectsData }   = useQuery({ queryKey: ['projects-all'],  queryFn: () => projectsApi.list().then((r: any) => r.data), staleTime: 60_000 })
  const { data: complianceData } = useQuery({ queryKey: ['compliance', prevWeekStart], queryFn: () => usersApi.timesheetCompliance(prevWeekStart).then((r: any) => r.data), enabled: isAdmin(), staleTime: 60_000 })
  const { data: myTasksData }    = useQuery({ queryKey: ['my-tasks'],       queryFn: () => timeApi.tasks({ search: '' }).then((r: any) => r.data), staleTime: 30_000 })

  // Generate real notifications from live data
  const allNotifs: Notification[] = useMemo(() => {
    const notifs: Notification[] = []

    // 1. Budget alerts — running projects >80% of estimated hours
    for (const p of (projectsData || []).filter((p: any) => p.status === 'running')) {
      const est    = p.stats?.estimatedHrs || 0
      const logged = p.stats?.loggedHrs    || 0
      const pct    = est > 0 ? Math.round((logged / est) * 100) : 0
      if (pct >= 100) {
        notifs.push({
          id: `budget-over-${p.id}`, type: 'budget',
          title: 'Budget Exceeded',
          body: `${p.name} has used ${pct}% of its estimated ${est}h budget.`,
          time: 'now', read: false,
          color: 'var(--rose)', icon: 'warning',
          href: `/projects/${p.id}`,
        })
      } else if (pct >= 85) {
        notifs.push({
          id: `budget-warn-${p.id}`, type: 'budget',
          title: 'Budget Warning',
          body: `${p.name} has reached ${pct}% of its ${est}h budget.`,
          time: 'recently', read: false,
          color: 'var(--amber)', icon: 'warning',
          href: `/projects/${p.id}`,
        })
      }
    }

    // 2. Overdue end dates — running projects past their end date
    for (const p of (projectsData || []).filter((p: any) => p.status === 'running' && p.end_date)) {
      const diff = Math.ceil((new Date(p.end_date).getTime() - Date.now()) / 86400000)
      if (diff < 0) {
        notifs.push({
          id: `overdue-proj-${p.id}`, type: 'system',
          title: 'Project Overdue',
          body: `${p.name} passed its end date ${Math.abs(diff)} day${Math.abs(diff) !== 1 ? 's' : ''} ago.`,
          time: `${Math.abs(diff)}d ago`, read: false,
          color: 'var(--rose)', icon: 'calendar',
          href: `/projects/${p.id}`,
        })
      }
    }

    // 3. Timesheet compliance — missing submissions from last week
    if (isAdmin()) {
      const missing = (complianceData || []).filter((u: any) => !u.submitted)
      if (missing.length > 0) {
        notifs.push({
          id: `compliance-${prevWeekStart}`, type: 'timesheet',
          title: 'Missing Timesheets',
          body: `${missing.length} team member${missing.length > 1 ? 's' : ''} haven't submitted last week's timesheet: ${missing.slice(0, 2).map((u: any) => u.name?.split(' ')[0]).join(', ')}${missing.length > 2 ? ` +${missing.length - 2} more` : ''}.`,
          time: 'this week', read: false,
          color: 'var(--amber)', icon: 'clipboard',
          href: '/reports',
        })
      }
    }

    // 4. Overdue tasks — tasks past their due date
    const overdueTasks = (myTasksData || []).filter((t: any) => t.status !== 'done' && t.due_date && t.due_date < today)
    if (overdueTasks.length > 0) {
      notifs.push({
        id: `overdue-tasks-${today}`, type: 'task',
        title: 'Overdue Tasks',
        body: `You have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}: ${overdueTasks.slice(0, 2).map((t: any) => t.title).join(', ')}${overdueTasks.length > 2 ? ` +${overdueTasks.length - 2} more` : ''}.`,
        time: 'now', read: false,
        color: 'var(--rose)', icon: 'tasks',
        href: '/dashboard',
      })
    }

    // Sort: unread first, then by severity
    return notifs.sort((a, b) => {
      if (!a.read && b.read) return -1
      if (a.read && !b.read) return 1
      return 0
    })
  }, [projectsData, complianceData, myTasksData, today, isAdmin, prevWeekStart])

  // Apply read/dismissed state
  const notifs = allNotifs
    .filter(n => !dismissed.has(n.id))
    .map(n => ({ ...n, read: readIds.has(n.id) ? true : n.read }))

  const unread = notifs.filter(n => !n.read).length
  const shown  = filter === 'unread' ? notifs.filter(n => !n.read) : notifs

  function markAllRead() { setReadIds(new Set(notifs.map(n => n.id))) }
  function markRead(id: string) { setReadIds(prev => new Set([...prev, id])) }
  function dismiss(id: string) { setDismissed(prev => new Set([...prev, id])); markRead(id) }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>

      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative',
          background: open ? 'var(--bg-overlay)' : 'var(--bg-raised)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 9, width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: open ? 'var(--text-primary)' : 'var(--text-secondary)',
          cursor: 'pointer', fontSize: 14,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          transition: 'all 0.15s',
        }}
        title="Notifications"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            background: 'var(--rose)', color: '#fff',
            borderRadius: '50%', width: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, border: '1.5px solid var(--bg-surface)',
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 380, maxHeight: 520, overflow: 'hidden',
            background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)',
            borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            zIndex: 9999, display: 'flex', flexDirection: 'column',
          }}>

            {/* Header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Notifications</span>
                {unread > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--rose)', background: 'var(--rose-dim)', padding: '1px 7px', borderRadius: 8 }}>{unread} new</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Filter toggle */}
                <div style={{ display: 'flex', background: 'var(--bg-surface)', borderRadius: 6, padding: 2 }}>
                  {(['all', 'unread'] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)} style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', border: 'none', cursor: 'pointer', background: filter === f ? 'var(--bg-raised)' : 'transparent', color: filter === f ? 'var(--text-primary)' : 'var(--text-tertiary)', transition: 'all 0.1s' }}>
                      {f === 'all' ? 'All' : 'Unread'}
                    </button>
                  ))}
                </div>
                {unread > 0 && (
                  <button onClick={markAllRead} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Mark all read</button>
                )}
              </div>
            </div>

            {/* List */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {shown.length === 0 && (
                <div style={{ padding: '40px 16px', textAlign: 'center' }}>
                  <div style={{ marginBottom: 8 }}><CheckCircle2 size={24} style={{ color: 'var(--accent)' }} /></div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>All clear!</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{filter === 'unread' ? 'No unread notifications.' : 'No notifications right now.'}</div>
                </div>
              )}
              {shown.map((n, i) => (
                <div key={n.id}
                  onClick={() => { markRead(n.id); if (n.href) { setOpen(false); window.location.href = n.href } }}
                  style={{
                    display: 'grid', gridTemplateColumns: '36px 1fr 20px',
                    gap: 10, padding: '12px 14px',
                    borderBottom: i < shown.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    cursor: n.href ? 'pointer' : 'default',
                    background: n.read ? 'transparent' : `${n.color}08`,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = n.read ? 'transparent' : `${n.color}08`}
                >
                  {/* Icon */}
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: `${n.color}18`, border: `1px solid ${n.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {(() => { const Icon = NOTIF_ICONS[n.icon] || AlertTriangle; return <Icon size={16} style={{ color: n.color }} /> })()}
                  </div>

                  {/* Content */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: 'var(--text-primary)' }}>{n.title}</span>
                      {!n.read && <div style={{ width: 6, height: 6, borderRadius: '50%', background: n.color, flexShrink: 0 }} />}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{n.body}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>{n.time}</div>
                  </div>

                  {/* Dismiss */}
                  <button onClick={e => { e.stopPropagation(); dismiss(n.id) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14, padding: 0, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, alignSelf: 'flex-start', marginTop: 2 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-overlay)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--rose)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)' }}
                    title="Dismiss"
                  >×</button>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: 'var(--bg-surface)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{notifs.length} total · {unread} unread</span>
              <a href="/reports" onClick={() => setOpen(false)} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>View Reports →</a>
            </div>
          </div>
        </>
      )}
    </div>
  )
}