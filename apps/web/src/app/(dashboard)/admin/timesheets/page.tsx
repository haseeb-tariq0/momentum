'use client'
import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, startOfWeek, addWeeks, subWeeks, addDays } from 'date-fns'
import { api } from '@/lib/api'
import { usersApi, timeApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { downloadCSV } from '@/lib/export'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Select } from '@/components/ui'

// ── Editable hour cell — click to edit, blur/enter to save ─────────────────
function EditableCell({
  entryId, taskId, userId, date, hours, billable, isLocked, weekStart,
  onSaved,
}: {
  entryId?: string
  taskId: string
  userId: string
  date: string
  hours: number
  billable: boolean
  isLocked: boolean
  weekStart: string
  onSaved: () => void
}) {
  const [editing,   setEditing]   = useState(false)
  const [val,       setVal]       = useState('')
  const [saving,    setSaving]    = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback(() => {
    if (isLocked) return
    setVal(hours > 0 ? String(hours) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 30)
  }, [hours, isLocked])

  const save = useCallback(async () => {
    const parsed = parseFloat(val)
    const newHrs = isNaN(parsed) ? 0 : Math.max(0, Math.min(24, parsed))
    setEditing(false)

    // No change
    if (newHrs === hours) return

    setSaving(true)
    try {
      if (newHrs === 0 && entryId) {
        // Delete the entry
        await api.delete(`/time/${entryId}`)
      } else if (newHrs > 0 && entryId) {
        // Update existing entry
        await api.put(`/time/${entryId}`, { hours: newHrs, billable })
      } else if (newHrs > 0 && !entryId) {
        // Create new entry for this user+task+date
        await api.post('/time', {
          task_id: taskId, date, hours: newHrs, billable, type: 'project',
          target_user_id: userId,
        })
      }
      onSaved()
    } catch (e) {
      console.error('Save failed', e)
    } finally {
      setSaving(false)
    }
  }, [val, hours, entryId, taskId, userId, date, billable, onSaved])

  const isWeekend = new Date(date + 'T12:00:00').getDay() === 0 || new Date(date + 'T12:00:00').getDay() === 6

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } if (e.key === 'Escape') { setEditing(false) } }}
        style={{
          width: '100%', textAlign: 'center', background: 'var(--accent-dim)',
          border: '1px solid var(--border-accent)', borderRadius: 3,
          padding: '2px 2px', fontSize: 12, fontFamily: 'inherit',
          color: 'var(--accent)', outline: 'none', fontVariantNumeric: 'tabular-nums',
        }}
        autoFocus
      />
    )
  }

  return (
    <div
      onClick={startEdit}
      title={isLocked ? 'Submitted — Unlock to edit' : 'Click to edit'}
      style={{
        textAlign: 'center', padding: '2px 0', borderRadius: 3, transition: 'background 0.1s',
        cursor: isLocked ? 'default' : 'pointer',
        background: isWeekend ? 'var(--bg-overlay)' : 'transparent',
        minHeight: 22,
      }}
      onMouseEnter={e => { if (!isLocked) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isWeekend ? 'var(--bg-overlay)' : 'transparent' }}
    >
      {saving ? (
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>…</span>
      ) : hours > 0 ? (
        <span style={{ fontSize: 12, fontWeight: 600, color: billable ? 'var(--accent)' : 'var(--amber)', fontVariantNumeric: 'tabular-nums' }}>
          {hours}h
        </span>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{isLocked ? '—' : '+'}</span>
      )}
    </div>
  )
}

export default function AllTimesheetsPage() {
  const qc = useQueryClient()
  const { isAdmin } = useAuthStore()
  const [weekRef,      setWeekRef]      = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [deptFilter,   setDeptFilter]   = useState<string>('all')

  const weekStart     = format(weekRef, 'yyyy-MM-dd')
  const days          = Array.from({ length: 7 }, (_, i) => addDays(weekRef, i))
  const isCurrentWeek = weekStart === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const { data: usersRaw } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list().then((r: any) => r.data), staleTime: 60_000 })
  const { data: deptsRaw } = useQuery({ queryKey: ['departments'], queryFn: () => api.get('/users/departments').then((r: any) => r.data), staleTime: 120_000 })
  const { data: reportRaw, isLoading: reportLoading } = useQuery({
    queryKey: ['time-report', weekStart],
    queryFn:  () => api.get(`/time/report?weekStart=${weekStart}`).then((r: any) => r.data),
    staleTime: 30_000,
  })
  const { data: submissionsRaw } = useQuery({
    queryKey: ['time-submissions', weekStart],
    queryFn:  () => timeApi.submissions(weekStart).then((r: any) => r.data),
    staleTime: 30_000,
  })
  const { data: userWeekRaw, isLoading: userWeekLoading } = useQuery({
    queryKey: ['time-week-user', weekStart, selectedUser],
    queryFn:  () => api.get(`/time/week?date=${weekStart}&userId=${selectedUser}`).then((r: any) => r.data),
    enabled:  !!selectedUser,
    staleTime: 5_000,
  })

  const unsubmitMutation = useMutation({
    mutationFn: (userId: string) => timeApi.unsubmit(weekStart, userId),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['time-submissions', weekStart] })
      qc.invalidateQueries({ queryKey: ['time-report', weekStart] })
      qc.invalidateQueries({ queryKey: ['time-week-user', weekStart, selectedUser] })
    },
  })

  const refetchUserWeek = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['time-week-user', weekStart, selectedUser] })
    qc.invalidateQueries({ queryKey: ['time-report', weekStart] })
  }, [qc, weekStart, selectedUser])

  const allUsers: any[]    = usersRaw      || []
  const depts: any[]       = deptsRaw      || []
  const report: any[]      = reportRaw     || []
  const submissions: any[] = submissionsRaw|| []
  const userWeek           = userWeekRaw

  const subMap = new Map(submissions.map((s: any) => [s.user_id, s]))

  const allMerged = allUsers.map((u: any) => {
    const rep = report.find((r: any) => r.userId === u.id) || {}
    const sub = subMap.get(u.id)
    const timeOffHrs = rep.timeOffHrs || 0
    const baseCapacity = Number(u.capacity_hrs || 40)
    const adjustedCapacity = Math.max(0, baseCapacity - timeOffHrs)
    return {
      id:             u.id,
      name:           u.name,
      department:     u.departments?.name || '—',
      departmentId:   u.department_id || '',
      jobTitle:       u.job_title || '—',
      capacity:       baseCapacity,
      adjustedCapacity,
      timeOffHrs,
      totalHrs:       rep.totalHrs    || 0,
      billableHrs:    rep.billableHrs || 0,
      utilizationPct: adjustedCapacity > 0 ? Math.round((rep.totalHrs || 0) / adjustedCapacity * 100) : 0,
      submitted:      !!sub,
      submittedAt:    sub?.submitted_at || null,
      locked:         sub?.locked       || false,
    }
  })

  // Filter by department
  const merged = deptFilter === 'all' ? allMerged : allMerged.filter(u => u.department === deptFilter || u.departmentId === deptFilter)
  const users = deptFilter === 'all' ? allUsers : allUsers.filter((u: any) => (u.departments?.name || '') === deptFilter || u.department_id === deptFilter)

  const totalLogged    = merged.reduce((s, u) => s + u.totalHrs, 0)
  const totalBillable  = merged.reduce((s, u) => s + u.billableHrs, 0)
  const totalCapacity  = merged.reduce((s, u) => s + u.adjustedCapacity, 0)
  const rawCapacity    = merged.reduce((s, u) => s + u.capacity, 0)
  const teamUtil       = totalCapacity > 0 ? Math.round((totalLogged / totalCapacity) * 100) : 0
  const submittedCount = merged.filter(u => u.submitted).length
  const missingLog     = merged.filter(u => u.totalHrs === 0)
  const missingSubmit  = merged.filter(u => u.totalHrs > 0 && !u.submitted)

  function handleExport() {
    const headers = ['Name', 'Department', 'Job Title', 'Capacity (h)', 'Logged (h)', 'Billable (h)', 'Utilization %', 'Submitted']
    const rows = merged.map(u => [
      u.name, u.department, u.jobTitle, u.capacity,
      u.totalHrs, u.billableHrs, u.utilizationPct + '%',
      u.submitted ? 'Yes' : 'No',
    ])
    downloadCSV(`AllTimesheets-${weekStart}.csv`, headers, rows)
  }

  const btn: React.CSSProperties = {
    background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)',
    borderRadius: 4, padding: '6px 12px', color: 'var(--text-secondary)',
    fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
  }

  if (!isAdmin()) return (
    <div style={{ padding: '40px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>Admin access required.</div>
  )

  const selectedMeta = merged.find(u => u.id === selectedUser)

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ marginBottom: 6 }}>
            <Link href="/admin" style={{ fontSize: 12, color: 'var(--text-tertiary)', textDecoration: 'none' }}>← Admin</Link>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>All Timesheets</h1>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            {format(weekRef, 'MMM d')} – {format(addDays(weekRef, 6), 'MMM d, yyyy')}
            {deptFilter !== 'all' && <> · <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{deptFilter}</span></>}
            {' · '}<span style={{ color: 'var(--accent)', fontWeight: 500 }}>{submittedCount}</span>/{merged.length} submitted
            {' · '}{merged.filter(u => u.totalHrs > 0).length}/{merged.length} logged time
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Select
            size="sm"
            aria-label="Filter by department"
            value={deptFilter}
            onChange={e => { setDeptFilter(e.target.value); setSelectedUser(null) }}
            className="w-auto min-w-[140px]"
          >
            <option value="all">All Departments</option>
            {depts.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </Select>
          <div style={{ display: 'flex', border: '1px solid var(--border-subtle)', borderRadius: 4, overflow: 'hidden' }}>
            <button onClick={() => { setWeekRef(w => subWeeks(w, 1)); setSelectedUser(null) }} style={{ ...btn, border: 'none', borderRight: '1px solid var(--border-subtle)', borderRadius: 0 }}>← Prev</button>
            <button onClick={() => { setWeekRef(startOfWeek(new Date(), { weekStartsOn: 1 })); setSelectedUser(null) }} style={{ ...btn, border: 'none', borderRight: '1px solid var(--border-subtle)', borderRadius: 0, fontWeight: isCurrentWeek ? 600 : 400, color: isCurrentWeek ? 'var(--accent)' : 'var(--text-secondary)' }}>This Week</button>
            <button onClick={() => { setWeekRef(w => addWeeks(w, 1)); setSelectedUser(null) }} style={{ ...btn, border: 'none', borderRadius: 0 }}>Next →</button>
          </div>
          <button onClick={handleExport} style={{ ...btn }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)' }}
          >↓ Export CSV</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: deptFilter === 'all' ? 'Team Members' : deptFilter, value: `${merged.length}`, sub: deptFilter === 'all' ? 'all departments' : `${merged.length} member${merged.length!==1?'s':''}`, color: 'var(--text-primary)' },
          { label: 'Submitted',        value: `${submittedCount}/${merged.length}`, sub: 'timesheets locked', color: submittedCount === merged.length ? 'var(--accent)' : 'var(--text-primary)' },
          { label: 'Total Logged',     value: `${totalLogged}h`,                  sub: rawCapacity !== totalCapacity ? `of ${totalCapacity}h adj. capacity (${rawCapacity}h − time off)` : `of ${totalCapacity}h capacity`, color: 'var(--text-primary)' },
          { label: 'Billable Hours',   value: `${totalBillable}h`,                sub: totalLogged > 0 ? `${Math.round((totalBillable/totalLogged)*100)}% of logged` : '—', color: 'var(--accent)' },
          { label: 'Utilization', value: `${teamUtil}%`,                     sub: `${merged.filter(u=>u.totalHrs>0).length}/${merged.length} logged time`, color: teamUtil >= 80 ? 'var(--accent)' : 'var(--amber)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 5 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {missingLog.length > 0 && (
        <div style={{ marginBottom: 8, padding: '9px 14px', background: 'var(--rose-dim)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 6, fontSize: 13, color: 'var(--rose)' }}>
          <strong>{missingLog.length} member{missingLog.length > 1 ? 's' : ''} with no time logged:</strong>{' '}
          {missingLog.map(u => u.name.split(' ')[0]).join(', ')}
        </div>
      )}
      {missingSubmit.length > 0 && (
        <div style={{ marginBottom: 12, padding: '9px 14px', background: 'var(--amber-dim)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, fontSize: 13, color: 'var(--amber)' }}>
          <strong>{missingSubmit.length} member{missingSubmit.length > 1 ? 's' : ''} logged time but haven't submitted:</strong>{' '}
          {missingSubmit.map(u => u.name.split(' ')[0]).join(', ')}
        </div>
      )}

      {/* Team table */}
      <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 100px 80px 70px 70px 60px 120px', padding: '9px 18px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
          {['Name', 'Department', 'Job Title', 'Capacity', 'Logged', 'Billable', 'Util %', 'Status'].map(h => (
            <div key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{h}</div>
          ))}
        </div>

        {reportLoading && <div style={{ padding: '28px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>Loading...</div>}

        {merged.map((u, i) => {
          const isSelected  = selectedUser === u.id
          const noTime      = u.totalHrs === 0
          const statusBadge = u.submitted
            ? { label: '✓ Submitted', color: 'var(--accent)', bg: 'var(--accent-dim)' }
            : noTime
              ? { label: 'No entries', color: 'var(--rose)', bg: 'var(--rose-dim)' }
              : { label: 'Not submitted', color: 'var(--amber)', bg: 'var(--amber-dim)' }

          return (
            <div key={u.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {/* Summary row */}
              <div onClick={() => setSelectedUser(isSelected ? null : u.id)}
                style={{ display: 'grid', gridTemplateColumns: '1fr 130px 100px 80px 70px 70px 60px 120px', padding: '10px 18px', alignItems: 'center', cursor: 'pointer', background: isSelected ? 'var(--bg-surface)' : 'transparent', transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: u.submitted ? 'var(--accent-dim)' : noTime ? 'var(--rose-dim)' : 'var(--amber-dim)', border: '1px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: u.submitted ? 'var(--accent)' : noTime ? 'var(--rose)' : 'var(--amber)', flexShrink: 0 }}>
                    {u.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{u.name}</div>
                    {u.submittedAt && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Submitted {new Date(u.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{isSelected ? '▲' : '▼'}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{u.department}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.jobTitle}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }} title={u.timeOffHrs > 0 ? `${u.capacity}h − ${u.timeOffHrs}h time off` : `${u.capacity}h/week`}>{u.adjustedCapacity}h{u.timeOffHrs > 0 && <span style={{ fontSize: 9, color: 'var(--rose)', marginLeft: 2 }}>−{u.timeOffHrs}</span>}</div>
                <div style={{ fontSize: 13, fontWeight: u.totalHrs > 0 ? 600 : 400, color: u.totalHrs > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{u.totalHrs > 0 ? `${u.totalHrs}h` : '—'}</div>
                <div style={{ fontSize: 13, fontWeight: u.billableHrs > 0 ? 600 : 400, color: u.billableHrs > 0 ? 'var(--accent)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{u.billableHrs > 0 ? `${u.billableHrs}h` : '—'}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: u.utilizationPct >= 100 ? 'var(--rose)' : u.utilizationPct >= 80 ? 'var(--accent)' : u.utilizationPct > 0 ? 'var(--amber)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{u.totalHrs > 0 ? `${u.utilizationPct}%` : '—'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: statusBadge.color, background: statusBadge.bg, padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>{statusBadge.label}</span>
                  {u.submitted && (
                    <button onClick={e => { e.stopPropagation(); unsubmitMutation.mutate(u.id) }}
                      title="Unlock this person's timesheet"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 4px', fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--rose)'}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'}
                    >Unlock</button>
                  )}
                </div>
              </div>

              {/* Expanded editable timesheet */}
              {isSelected && (
                <div style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border-subtle)', padding: '14px 18px 18px' }}>
                  {userWeekLoading ? (
                    <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 0' }}>Loading {u.name}'s timesheet...</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {u.name} — week of {format(weekRef, 'MMM d, yyyy')}
                          {u.submitted && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--accent)', fontWeight: 400, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Lock size={14} /> Submitted</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 12, alignItems: 'center' }}>
                          {userWeek && <><span style={{ fontVariantNumeric: 'tabular-nums' }}>{userWeek.totalHrs}h logged</span><span style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{userWeek.billableHrs}h billable</span></>}
                          {!u.submitted && (
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-overlay)', padding: '2px 8px', borderRadius: 4 }}>
                              Click cells to edit
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Day headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: '180px repeat(7, 1fr) 50px', gap: 2, marginBottom: 4 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>TASK</div>
                        {days.map((d, di) => {
                          const isWk = d.getDay() === 0 || d.getDay() === 6
                          const dayTotal = userWeek?.dayTotals?.[format(d, 'yyyy-MM-dd')] || 0
                          return (
                            <div key={di} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: isWk ? 'var(--text-tertiary)' : dayTotal > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                              {format(d, 'EEE d')}
                              {dayTotal > 0 && <div style={{ fontSize: 9, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{dayTotal}h</div>}
                            </div>
                          )
                        })}
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textAlign: 'center', textTransform: 'uppercase' }}>TOT</div>
                      </div>

                      {/* Task rows */}
                      {!userWeek || (userWeek.rows || []).length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '12px 0' }}>{u.name} has no entries this week.</div>
                      ) : (userWeek.rows || []).map((row: any) => {
                        const rowTotal = Object.values(row.days || {}).reduce((s: number, d: any) => s + (d?.hours || 0), 0) as number
                        const barColor = row.type === 'time_off' ? 'var(--rose)' : row.type === 'internal' ? 'var(--amber)' : (row.projectColor || 'var(--accent)')
                        return (
                          <div key={row.taskId || row.categoryId}
                            style={{ display: 'grid', gridTemplateColumns: '180px repeat(7, 1fr) 50px', gap: 2, padding: '4px 0', borderTop: '1px solid var(--border-subtle)', alignItems: 'center' }}
                          >
                            {/* Task name */}
                            <div style={{ display: 'flex', gap: 5, alignItems: 'center', minWidth: 0 }}>
                              <div style={{ width: 3, height: 18, borderRadius: 2, background: barColor, flexShrink: 0 }} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.taskTitle || row.categoryName}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.projectName || (row.type === 'internal' ? 'Internal' : 'Time Off')}</div>
                              </div>
                            </div>

                            {/* Editable day cells */}
                            {days.map((d, di) => {
                              const dateStr = format(d, 'yyyy-MM-dd')
                              const cell    = row.days?.[dateStr]
                              return (
                                <EditableCell
                                  key={di}
                                  entryId={cell?.entryId}
                                  taskId={row.taskId}
                                  userId={u.id}
                                  date={dateStr}
                                  hours={cell?.hours || 0}
                                  billable={row.billable ?? true}
                                  isLocked={u.submitted}
                                  weekStart={weekStart}
                                  onSaved={refetchUserWeek}
                                />
                              )
                            })}

                            {/* Row total */}
                            <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: rowTotal > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                              {rowTotal > 0 ? `${rowTotal}h` : '—'}
                            </div>
                          </div>
                        )
                      })}

                      {/* Day totals footer */}
                      {userWeek && (userWeek.rows || []).length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: '180px repeat(7, 1fr) 50px', gap: 2, paddingTop: 6, marginTop: 4, borderTop: '2px solid var(--border-muted)' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Total</div>
                          {days.map((d, di) => {
                            const dt = userWeek.dayTotals?.[format(d, 'yyyy-MM-dd')] || 0
                            return <div key={di} style={{ textAlign: 'center', fontSize: 12, fontWeight: dt > 0 ? 700 : 400, color: dt > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{dt > 0 ? `${dt}h` : '—'}</div>
                          })}
                          <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                            {userWeek.totalHrs > 0 ? `${userWeek.totalHrs}h` : '—'}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Footer totals */}
        {merged.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 100px 80px 70px 70px 60px 120px', padding: '10px 18px', background: 'var(--bg-surface)', borderTop: '2px solid var(--border-muted)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>TOTAL — {merged.length} members</div>
            <div /><div />
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{totalCapacity}h</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{totalLogged}h</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{totalBillable}h</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: teamUtil >= 80 ? 'var(--accent)' : 'var(--amber)', fontVariantNumeric: 'tabular-nums' }}>{teamUtil}%</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: submittedCount === merged.length ? 'var(--accent)' : 'var(--amber)' }}>{submittedCount}/{merged.length} submitted</div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>
        Click row to expand · Click any hour cell to edit (admin override) · Unlock to edit submitted timesheets
      </div>
    </div>
  )
}
