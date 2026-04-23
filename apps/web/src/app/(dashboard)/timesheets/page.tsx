'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { timeApi } from '@/lib/queries'
import { api } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { format, addWeeks, subWeeks, startOfWeek, addDays, isSameDay, startOfMonth, endOfMonth, addMonths, subMonths, eachWeekOfInterval, differenceInBusinessDays } from 'date-fns'
import { exportTimesheetWeek } from '@/lib/export'
import { parseTimeInput } from '@/lib/parseTime'
import { formatHoursHM } from '@/lib/format'
import { Lock, Check } from 'lucide-react'
import { showToast } from '@/components/Toast'
import { PageHeader, Card, Badge, Button, Input, Skeleton, EmptyState, StatCard, Select, Combobox } from '@/components/ui'
import { cn } from '@/lib/cn'

// Grid layout — min-width ensures day columns stay ≥ 80px each so entries remain
// readable on narrow viewports. The parent `overflow-x-auto` wrapper scrolls
// horizontally when the viewport is narrower than the minimum total width.
const WEEK_GRID_COLS = 'minmax(180px,220px) repeat(7, minmax(80px,1fr)) 60px'
const TEAM_GRID_COLS = 'minmax(200px,260px) repeat(7, minmax(80px,1fr)) 70px'
const WEEK_MIN_WIDTH = 820  // 220 + 7*80 + 60 = 840 — small buffer below
const TEAM_MIN_WIDTH = 880

// ─────────────────────────────────────────────────────────────────────────────
// SHARED — week navigation bar (used by both views)
// ─────────────────────────────────────────────────────────────────────────────
function WeekNav({ weekRef, setWeekRef, onReset, isCurrentWeek }: any) {
  return (
    <div className="flex border border-line-subtle rounded overflow-hidden">
      <button
        onClick={() => setWeekRef((w: any) => subWeeks(w, 1))}
        className="bg-surface-raised border-r border-line-subtle px-3 py-1.5 text-base text-secondary hover:bg-surface-hover cursor-pointer"
      >
        ← Prev
      </button>
      <button
        onClick={onReset}
        className={cn(
          'bg-surface-raised border-r border-line-subtle px-3 py-1.5 text-base hover:bg-surface-hover cursor-pointer',
          isCurrentWeek ? 'font-semibold text-accent' : 'text-secondary',
        )}
      >
        This Week
      </button>
      <button
        onClick={() => setWeekRef((w: any) => addWeeks(w, 1))}
        className="bg-surface-raised px-3 py-1.5 text-base text-secondary hover:bg-surface-hover cursor-pointer"
      >
        Next →
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CELL EDIT POPOVER — hours + note (Apr 23 — Murtaza)
// Floats above the cell so the note textarea isn't constrained by the 50px
// grid-cell width. Saves on Enter or outside-click, cancels on Escape.
// ─────────────────────────────────────────────────────────────────────────────
function CellEditPopover({
  hoursVal, setHoursVal, noteVal, setNoteVal, onSave, onCancel,
}: {
  hoursVal: string
  setHoursVal: (v: string) => void
  noteVal: string
  setNoteVal: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Click-outside → save. Checked on mousedown so the popover commits before
  // any other UI (e.g. opening the NEXT cell) handles the click — otherwise
  // two cells could end up in edit mode simultaneously.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onSave()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onSave])

  return (
    <div
      ref={ref}
      className="absolute z-50 left-1/2 -translate-x-1/2 top-[36px] w-[220px] bg-surface-raised border-2 border-accent rounded-md shadow-lg p-2 flex flex-col gap-1.5"
      onClick={e => e.stopPropagation()}
    >
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        value={hoursVal}
        onChange={e => setHoursVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onSave() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        placeholder='e.g. "4", "40m", "1h30m"'
        title='"4" = 4h · "40m" = 40 min · "1h30m" = 1.5h · "4:30" = 4.5h'
        className="w-full text-left bg-surface-overlay border border-line-subtle rounded px-2 py-1 text-primary text-sm outline-none focus:border-accent"
      />
      <textarea
        value={noteVal}
        onChange={e => setNoteVal(e.target.value)}
        onKeyDown={e => {
          // Enter saves; Shift+Enter inserts newline for multi-line notes
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        placeholder="Note (optional)…"
        rows={2}
        className="w-full bg-surface-overlay border border-line-subtle rounded px-2 py-1 text-primary text-xs outline-none focus:border-accent resize-none"
      />
      <div className="flex justify-between items-center text-[10px] text-muted">
        <span>↵ Save · Esc Cancel</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MY TIMESHEET VIEW — the logged-in user's own sheet
// ─────────────────────────────────────────────────────────────────────────────
function MyTimesheetView({ weekRef, setWeekRef }: any) {
  const qc = useQueryClient()
  const { isAdmin, user } = useAuthStore()
  const [editCell,       setEditCell]      = useState<{ rowKey: string; dayIdx: number } | null>(null)
  const [editVal,        setEditVal]       = useState('')
  const [editNote,       setEditNote]      = useState('')
  const [showFind,       setShowFind]      = useState(false)
  const [findTab,        setFindTab]       = useState<'tasks'|'internal'|'time_off'>('tasks')
  const [search,         setSearch]        = useState('')
  const [pendingRows,    setPendingRows]   = useState<any[]>([])
  const [copying,        setCopying]       = useState(false)
  const [showSubmitNote, setShowSubmitNote]= useState(false)
  const [submitNote,     setSubmitNote]    = useState('')

  const weekDate      = format(weekRef, 'yyyy-MM-dd')
  const prevDate      = format(subWeeks(weekRef, 1), 'yyyy-MM-dd')
  const days          = Array.from({ length: 7 }, (_, i) => addDays(weekRef, i))
  const weekLabel     = format(weekRef, 'MMM-d-yyyy')
  const isCurrentWeek = weekDate === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const isPastWeek    = weekRef < startOfWeek(new Date(), { weekStartsOn: 1 })

  const { data: raw, isLoading } = useQuery({ queryKey: ['timesheet', weekDate], queryFn: () => timeApi.week(weekDate).then((r: any) => r.data) })
  const { data: prevRaw } = useQuery({ queryKey: ['timesheet', prevDate], queryFn: () => timeApi.week(prevDate).then((r: any) => r.data), staleTime: 60_000 })
  const { data: tasksRaw } = useQuery({ queryKey: ['ts-tasks', search], queryFn: () => timeApi.tasks({ search }).then((r: any) => r.data), enabled: showFind && findTab === 'tasks' })
  const { data: catsRaw } = useQuery({ queryKey: ['time-categories'], queryFn: () => timeApi.categories().then((r: any) => r.data), enabled: showFind })

  // Holidays for this week — used to grey out holiday cells
  const weekEndDate = format(addDays(weekRef, 6), 'yyyy-MM-dd')
  const { data: holidayData } = useQuery({
    queryKey: ['holidays-range-ts', weekDate, weekEndDate],
    queryFn:  () => api.get(`/users/holidays-range?from=${weekDate}&to=${weekEndDate}`).then((r: any) => r.data),
    staleTime: 3_600_000, // 1hr — holidays change rarely
  })
  // Build a Set of holiday dates that apply to the current user
  const myHolidays = (() => {
    const set = new Set<string>()
    if (!holidayData || !user?.id) return set
    const myCalId = holidayData.userCalendarMap?.[user.id]
    if (!myCalId) return set
    const dates: string[] = holidayData.calendarHolidays?.[myCalId] || []
    for (const d of dates) set.add(d)
    return set
  })()

  const logTime    = useMutation({ mutationFn: (data: any) => timeApi.log(data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['timesheet', weekDate] }); setEditCell(null); setEditVal(''); setEditNote('') }, onError: (e: any) => showToast.error('Save failed: ' + (e?.message || 'error')) })
  const updateTime = useMutation({ mutationFn: ({ id, data }: any) => timeApi.update(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['timesheet', weekDate] }); setEditCell(null); setEditVal(''); setEditNote('') }, onError: (e: any) => showToast.error('Update failed: ' + (e?.message || 'error')) })
  const deleteTime = useMutation({ mutationFn: (id: string) => timeApi.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheet', weekDate] }) })
  const submitMutation = useMutation({
    mutationFn: () => timeApi.submit(weekDate, submitNote || undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['timesheet', weekDate] }); qc.invalidateQueries({ queryKey: ['compliance'] }); setShowSubmitNote(false); setSubmitNote('') },
    onError: (e: any) => showToast.error(e?.message || 'Submit failed'),
  })
  const unsubmitMutation = useMutation({
    mutationFn: () => timeApi.unsubmit(weekDate),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['timesheet', weekDate] }); qc.invalidateQueries({ queryKey: ['compliance'] }) },
  })

  const serverRows  : any[] = raw?.rows      || []
  const totals               = raw?.dayTotals  || {}
  const totalHrs             = raw?.totalHrs   || 0
  const billableHrs          = raw?.billableHrs || 0
  const submission           = raw?.submission  || null
  const isLocked             = raw?.isLocked   ?? false
  const serverRowKeys        = new Set(serverRows.map((r: any) => r.taskId ? `task-${r.taskId}` : `${r.type}-${r.categoryId}`))
  const allRows              = [...serverRows, ...pendingRows.filter((p: any) => !serverRowKeys.has(p.rowKey))]
  const hasEntries           = serverRows.some((r: any) => Object.values(r.days || {}).some((d: any) => d?.hours > 0))
  const prevRowCount         = (prevRaw?.rows || []).filter((r: any) => Object.values(r.days || {}).some((d: any) => d?.hours > 0)).length

  // Group rows by project (Apr 23 — Murtaza). Internal time and time-off get
  // their own synthetic groups so they still render even though they have no
  // project. Groups order: project groups alphabetically, then internal, then
  // time off — matches what people expect when scanning the week.
  type RowGroup = {
    key:        string
    label:      string          // project name / "Internal Time" / "Time Off"
    clientName: string          // optional subtitle
    color:      string
    type:       'project' | 'internal' | 'time_off'
    rows:       any[]
  }
  const groups: RowGroup[] = (() => {
    const m = new Map<string, RowGroup>()
    for (const r of allRows) {
      let key:string, label:string, color:string, clientName:string, gType:RowGroup['type']
      if (r.type === 'internal') {
        key = '__internal__'; label = 'Internal Time'; color = 'var(--amber)'; clientName = ''; gType = 'internal'
      } else if (r.type === 'time_off') {
        key = '__time_off__'; label = 'Time Off';     color = 'var(--rose)';  clientName = ''; gType = 'time_off'
      } else {
        key = r.projectId || `proj:${r.projectName || '—'}`
        label = r.projectName || '—'
        color = r.projectColor || 'var(--accent)'
        clientName = r.clientName || ''
        gType = 'project'
      }
      let g = m.get(key)
      if (!g) { g = { key, label, clientName, color, type: gType, rows: [] }; m.set(key, g) }
      g.rows.push(r)
    }
    const arr = [...m.values()]
    return arr.sort((a, b) => {
      const rank = (t: RowGroup['type']) => t === 'project' ? 0 : t === 'internal' ? 1 : 2
      const r = rank(a.type) - rank(b.type)
      if (r !== 0) return r
      return a.label.localeCompare(b.label)
    })
  })()
  // Per-group per-day totals so the project header can show "day X of this project"
  function groupDayTotal(group: RowGroup, dayKey: string): number {
    let s = 0
    for (const row of group.rows) s += row.days?.[dayKey]?.hours || 0
    return s
  }
  function groupWeekTotal(group: RowGroup): number {
    let s = 0
    for (const row of group.rows) for (const d of Object.values(row.days || {})) s += (d as any)?.hours || 0
    return s
  }

  async function copyPreviousWeek() {
    const prevRows: any[] = (prevRaw?.rows || []).filter((r: any) =>
      Object.values(r.days || {}).some((d: any) => d?.hours > 0)
    )
    if (!prevRows.length) { showToast.info('No time logged last week to copy.'); return }
    setCopying(true)
    let copied = 0
    for (const row of prevRows) {
      for (const [prevDayKey, cell] of Object.entries(row.days || {})) {
        const hrs = (cell as any)?.hours || 0
        if (hrs <= 0) continue
        // Shift the date exactly 7 days forward
        const thisDayFmt = format(addDays(new Date(prevDayKey + 'T12:00:00'), 7), 'yyyy-MM-dd')
        // Skip if already has an entry this day for this row
        const cur = serverRows.find((r: any) =>
          row.type === 'project' ? r.taskId === row.taskId
          : r.categoryId === row.categoryId && r.type === row.type
        )
        if (cur?.days?.[thisDayFmt]?.hours > 0) continue
        try {
          const payload: any = { date: thisDayFmt, hours: hrs, type: row.type || 'project' }
          if (row.type === 'project' || !row.type) {
            payload.task_id = row.taskId
            payload.billable = (cell as any)?.billable ?? row.billable ?? true
          }
          if (row.type === 'internal') payload.internal_time_category_id = row.categoryId
          if (row.type === 'time_off')  payload.time_off_category_id = row.categoryId
          await timeApi.log(payload)
          copied++
        } catch(e) { console.warn('Copy entry failed:', e) }
      }
    }
    await qc.invalidateQueries({ queryKey: ['timesheet', weekDate] })
    setCopying(false)
    if (copied === 0) showToast.info('All entries from last week already exist this week.')
  }

  function openCell(rowKey: string, dayIdx: number, currentHrs: number, currentNote: string = '') {
    if (isLocked) return
    setEditCell({ rowKey, dayIdx })
    setEditVal(currentHrs > 0 ? String(currentHrs) : '')
    setEditNote(currentNote || '')
  }

  function closeEdit() { setEditCell(null); setEditVal(''); setEditNote('') }

  function saveCell() {
    if (!editCell) return
    // parseTimeInput handles the Forecast-compatible shorthand (Apr 17 call):
    //   "4" → 4h | "40m" → 40 min | "1h30m" → 1.5h | "4:30" → 4.5h
    // parseFloat would silently swallow "40m" as 40 hours — that was the bug.
    const parsed = parseTimeInput(editVal)
    const row  = allRows.find((r: any) => (r.taskId ? `task-${r.taskId}` : `${r.type}-${r.categoryId}`) === editCell.rowKey)
    if (!row) { closeEdit(); return }
    const dayKey   = format(days[editCell.dayIdx], 'yyyy-MM-dd')
    const existing = (row as any).days?.[dayKey]
    const noteTrimmed = editNote.trim()

    // Empty / cleared hours input → delete the existing entry (if any) and bail.
    const trimmed = editVal.trim()
    if (!trimmed) {
      if (existing?.entryId) deleteTime.mutate(existing.entryId)
      closeEdit()
      return
    }
    // Couldn't parse → tell the user what's accepted instead of silently wiping.
    if (parsed === null) {
      showToast.error('Enter hours ("4", "4.5"), minutes ("40m"), or combo ("1h30m" / "4:30"). Max 24h.')
      return
    }
    const hrs = parsed
    if (hrs <= 0 && existing?.entryId) { deleteTime.mutate(existing.entryId); closeEdit(); return }
    if (hrs <= 0) { closeEdit(); return }
    if (existing?.entryId) {
      updateTime.mutate({ id: existing.entryId, data: { hours: hrs, note: noteTrimmed || null } })
    } else {
      const payload: any = { date: dayKey, hours: hrs, type: row.type || 'project', note: noteTrimmed || null }
      if (row.type === 'project' || !row.type) { payload.task_id = row.taskId; payload.billable = true }
      if (row.type === 'internal') payload.internal_time_category_id = row.categoryId
      if (row.type === 'time_off') payload.time_off_category_id = row.categoryId
      logTime.mutate(payload)
      setPendingRows(prev => prev.filter((p: any) => p.rowKey !== editCell.rowKey))
    }
  }

  const internalCats = catsRaw?.internal || []
  const timeOffCats  = catsRaw?.timeOff  || []
  const displayTasks = tasksRaw || []

  return (
    <div>
      {/* Submission banner */}
      {submission && (
        <div className="mb-3 px-3.5 py-2 rounded-md bg-accent-dim border border-line-accent flex items-center gap-2.5">
          <Check size={15} className="text-accent" />
          <div className="flex-1">
            <span className="text-base font-semibold text-accent">Submitted</span>
            <span className="text-sm text-secondary ml-2">
              {new Date(submission.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            {submission.note && <div className="text-xs text-muted mt-0.5">{submission.note}</div>}
          </div>
          {isLocked && (
            <Badge variant="info">
              <Lock size={11} /> Locked
            </Badge>
          )}
          {(isAdmin() || !isPastWeek) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => unsubmitMutation.mutate()}
              disabled={unsubmitMutation.isPending}
            >
              {unsubmitMutation.isPending ? '...' : 'Unlock'}
            </Button>
          )}
        </div>
      )}

      {/* Toolbar row */}
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <div className="text-base text-muted flex gap-2.5 items-center">
          <span>{format(weekRef, 'MMM d')} – {format(addDays(weekRef, 6), 'MMM d, yyyy')}</span>
          <span>·</span>
          <span>
            <strong className="text-primary">{formatHoursHM(totalHrs)}</strong> logged ·{' '}
            <strong className="text-accent">{formatHoursHM(billableHrs)}</strong> billable
          </span>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <WeekNav weekRef={weekRef} setWeekRef={setWeekRef} isCurrentWeek={isCurrentWeek}
            onReset={() => { setWeekRef(startOfWeek(new Date(), { weekStartsOn: 1 })); setPendingRows([]) }}
          />
          {!isLocked && (
            <Button
              variant="secondary"
              size="md"
              onClick={copyPreviousWeek}
              disabled={copying || prevRowCount === 0}
            >
              ⎘ {copying ? 'Copying...' : `Copy Prev${prevRowCount > 0 ? ` (${prevRowCount})` : ''}`}
            </Button>
          )}
          {allRows.length > 0 && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => { if (raw) exportTimesheetWeek({ ...raw, days: days.map(d => ({ date: format(d, 'yyyy-MM-dd') })) }, weekLabel) }}
            >
              ↓ CSV
            </Button>
          )}
          {/* "+ Find Tasks" and "✓ Submit Week" intentionally hidden (Apr 23 call — Murtaza).
              Tasks auto-appear when the user is assigned — if a task is missing, the user
              asks their account manager to assign them (reinforces accountability).
              Entries save on blur, so the weekly Submit/lock flow is not surfaced in v1. */}
        </div>
      </div>

      {/* Submit panel */}
      {showSubmitNote && !submission && (
        <Card className="bg-accent-dim border-line-accent px-3.5 py-3 mb-3">
          <div className="text-base font-semibold text-accent mb-1.5">
            Submit {format(weekRef, 'MMM d')} – {format(addDays(weekRef, 6), 'MMM d')}?
          </div>
          <div className="text-sm text-secondary mb-2">
            {formatHoursHM(totalHrs)} logged · {formatHoursHM(billableHrs)} billable · Entries lock on submit.
          </div>
          <Input
            value={submitNote}
            onChange={e => setSubmitNote(e.target.value)}
            placeholder="Optional note..."
            className="mb-2"
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? 'Submitting...' : 'Yes, Submit & Lock'}
            </Button>
            <Button variant="secondary" size="md" onClick={() => setShowSubmitNote(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Find Tasks panel */}
      {showFind && !isLocked && (
        <Card className="px-3 py-3 mb-3">
          <div className="flex border-b border-line-subtle mb-2">
            {[
              { key: 'tasks',    label: `Tasks (${displayTasks.length})`,     activeClass: 'text-accent border-accent' },
              { key: 'internal', label: `Internal (${internalCats.length})`,  activeClass: 'text-status-amber border-status-amber' },
              { key: 'time_off', label: `Time Off (${timeOffCats.length})`,   activeClass: 'text-status-rose border-status-rose' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setFindTab(t.key as any)}
                className={cn(
                  'bg-transparent border-0 cursor-pointer px-3 py-1.5 text-sm border-b-2 border-transparent',
                  findTab === t.key ? `font-semibold ${t.activeClass}` : 'text-muted',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {findTab === 'tasks' && (
            <Input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by task or project..."
              className="mb-1.5"
            />
          )}
          <div className="max-h-[200px] overflow-y-auto">
            {findTab === 'tasks' && displayTasks.slice(0, 20).map((task: any) => {
              const rowKey = `task-${task.id}`
              const added  = serverRowKeys.has(rowKey) || !!pendingRows.find((p: any) => p.rowKey === rowKey)
              return (
                <div
                  key={task.id}
                  onClick={() => { if (!added) { setPendingRows((prev: any) => [...prev, { rowKey, type: 'project', taskId: task.id, taskTitle: task.title, phaseName: task.phases?.name || '', projectId: task.phases?.projects?.id || '', projectName: task.phases?.projects?.name || '', projectColor: task.phases?.projects?.color || '#6D4AAE', clientName: task.phases?.projects?.clients?.name || '' }]); setShowFind(false) } }}
                  className={cn(
                    'px-2 py-1.5 rounded flex gap-2 items-center',
                    added ? 'opacity-40 cursor-default' : 'cursor-pointer hover:bg-surface-hover',
                  )}
                >
                  <div
                    className="w-[3px] h-[26px] rounded-sm flex-shrink-0"
                    style={{ background: task.phases?.projects?.color || 'var(--accent)' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-primary truncate">{task.title}</div>
                    <div className="text-[10px] text-muted">
                      {task.phases?.projects?.name}{task.phases?.name ? ` · ${task.phases.name}` : ''}
                    </div>
                  </div>
                  {!added && <span className="text-xs text-accent font-semibold">Add →</span>}
                </div>
              )
            })}
            {findTab === 'tasks' && displayTasks.length === 0 && (
              <div className="p-3 text-sm text-muted text-center">
                {search ? 'No matches' : 'Type to search...'}
              </div>
            )}
            {findTab === 'internal' && internalCats.map((cat: any) => {
              const rowKey = `internal-${cat.id}`
              const added = serverRowKeys.has(rowKey) || !!pendingRows.find((p: any) => p.rowKey === rowKey)
              return (
                <div
                  key={cat.id}
                  onClick={() => { if (!added) { setPendingRows((prev: any) => [...prev, { rowKey, type: 'internal', categoryId: cat.id, categoryName: cat.name }]); setShowFind(false) } }}
                  className={cn(
                    'px-2 py-1.5 rounded flex gap-2 items-center',
                    added ? 'opacity-40 cursor-default' : 'cursor-pointer hover:bg-surface-hover',
                  )}
                >
                  <div className="w-2 h-2 rounded-full bg-status-amber flex-shrink-0" />
                  <span className="text-sm text-primary font-medium flex-1">{cat.name}</span>
                  {!added && <span className="text-xs text-status-amber font-semibold">Add →</span>}
                </div>
              )
            })}
            {findTab === 'time_off' && timeOffCats.map((cat: any) => {
              const rowKey = `time_off-${cat.id}`
              const added = serverRowKeys.has(rowKey) || !!pendingRows.find((p: any) => p.rowKey === rowKey)
              return (
                <div
                  key={cat.id}
                  onClick={() => { if (!added) { setPendingRows((prev: any) => [...prev, { rowKey, type: 'time_off', categoryId: cat.id, categoryName: cat.name }]); setShowFind(false) } }}
                  className={cn(
                    'px-2 py-1.5 rounded flex gap-2 items-center',
                    added ? 'opacity-40 cursor-default' : 'cursor-pointer hover:bg-surface-hover',
                  )}
                >
                  <div className="w-2 h-2 rounded-full bg-status-rose flex-shrink-0" />
                  <span className="text-sm text-primary font-medium flex-1">{cat.name}</span>
                  {!added && <span className="text-xs text-status-rose font-semibold">Add →</span>}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Timesheet grid — horizontal-scroll wrapper ensures usability on narrow viewports */}
      <Card className={cn('overflow-x-auto p-0', isLocked && 'border-line-accent')} style={{ '--week-min-w': `${WEEK_MIN_WIDTH}px` } as any}>
        <div style={{ minWidth: WEEK_MIN_WIDTH }}>
        {/* Day header */}
        <div
          className={cn(
            'grid border-b border-line-subtle',
            isLocked ? 'bg-accent-dim' : 'bg-surface',
          )}
          style={{ gridTemplateColumns: WEEK_GRID_COLS }}
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
            {isLocked ? (
              <span className="inline-flex items-center gap-1">
                <Lock size={14} /> LOCKED
              </span>
            ) : (
              'TASK / CATEGORY'
            )}
          </div>
          {days.map((d, i) => {
            const isToday = isSameDay(d, new Date())
            const dt      = totals[format(d, 'yyyy-MM-dd')] || 0
            const isWknd  = d.getDay() === 0 || d.getDay() === 6
            const isHoliday = myHolidays.has(format(d, 'yyyy-MM-dd'))
            return (
              <div
                key={i}
                className="px-0.5 py-1 text-center border-l border-line-subtle"
                title={isHoliday ? 'Public holiday' : undefined}
                style={{
                  background: isHoliday ? 'rgba(245,158,11,0.12)' : isToday ? 'var(--accent-dim)' : isWknd ? 'var(--bg-hover)' : 'transparent',
                }}
              >
                <div
                  className={cn(
                    'text-lg font-semibold leading-tight',
                    isHoliday ? 'text-status-amber' : isToday ? 'text-accent' : isWknd ? 'text-muted' : 'text-primary',
                  )}
                >
                  {format(d, 'd')}
                </div>
                <div
                  className={cn(
                    'text-[9px] uppercase tracking-wider',
                    isHoliday ? 'text-status-amber' : isToday ? 'text-accent' : 'text-muted',
                  )}
                >
                  {isHoliday ? 'HOLIDAY' : format(d, 'EEE')}
                </div>
                {dt > 0 && (
                  <div
                    className={cn(
                      'text-[10px] tabular-nums font-medium',
                      isToday ? 'text-accent' : 'text-secondary',
                    )}
                  >
                    {formatHoursHM(dt)}
                  </div>
                )}
              </div>
            )
          })}
          <div className="px-1 py-1.5 text-center border-l border-line-subtle text-[10px] font-bold uppercase text-muted">
            Total
          </div>
        </div>

        {isLoading && (
          <div className="flex flex-col gap-2 p-3.5">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}
        {!isLoading && allRows.length === 0 && (
          // Richer empty state — fills card vertical space, offers direct
          // actions instead of only describing the UI. Avoids the old "tiny
          // message on a huge empty card" look that made the page feel sparse.
          <div className="flex flex-col items-center justify-center text-center px-6 py-16">
            <div className="w-14 h-14 rounded-full bg-accent/10 text-accent flex items-center justify-center mb-4">
              <Check size={22} />
            </div>
            <div className="text-lg font-semibold text-primary mb-1">
              No entries yet for this week
            </div>
            <div className="text-sm text-muted mb-5 max-w-md">
              Tasks you're assigned to will appear here automatically. If a task is missing, ask your account manager to assign you to the project.
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {!isLocked && prevRowCount > 0 && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={copyPreviousWeek}
                  disabled={copying}
                >
                  {copying ? 'Copying…' : `↺ Copy last week (${prevRowCount} rows)`}
                </Button>
              )}
            </div>
          </div>
        )}

        {groups.map((group, gi) => {
          const groupWeekHrs = groupWeekTotal(group)
          const isLastGroup  = gi === groups.length - 1
          return (
            <div key={group.key}>
              {/* Project / category header row */}
              <div
                className="grid bg-surface border-b border-line-subtle"
                style={{ gridTemplateColumns: WEEK_GRID_COLS }}
              >
                <div className="px-2.5 py-1.5 flex gap-1.5 items-center border-r border-line-subtle min-w-0">
                  <div
                    className="w-[3px] h-5 rounded-sm flex-shrink-0"
                    style={{ background: group.color }}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-primary truncate">
                      {group.label}
                    </div>
                    {group.clientName && (
                      <div className="text-[10px] text-muted truncate">{group.clientName}</div>
                    )}
                  </div>
                </div>
                {days.map((d, di) => {
                  const dk    = format(d, 'yyyy-MM-dd')
                  const gdt   = groupDayTotal(group, dk)
                  const isWknd = d.getDay() === 0 || d.getDay() === 6
                  return (
                    <div
                      key={di}
                      className="border-l border-line-subtle flex items-center justify-center text-[11px] tabular-nums text-secondary"
                      style={{ background: isWknd ? 'var(--bg-hover)' : 'transparent' }}
                    >
                      {gdt > 0 ? formatHoursHM(gdt) : ''}
                    </div>
                  )
                })}
                <div
                  className={cn(
                    'border-l border-line-subtle flex items-center justify-center text-sm tabular-nums',
                    groupWeekHrs > 0 ? 'font-semibold text-accent' : 'text-muted',
                  )}
                >
                  {groupWeekHrs > 0 ? formatHoursHM(groupWeekHrs) : ''}
                </div>
              </div>

              {/* Task rows nested under the group */}
              {group.rows.map((row: any, ri: number) => {
                const rowKey    = row.taskId ? `task-${row.taskId}` : `${row.type}-${row.categoryId}`
                const rowTotal  = Object.values(row.days || {}).reduce((s: number, d: any) => s + (d?.hours || 0), 0) as number
                const isPending = !serverRowKeys.has(rowKey)
                const isLastRow = isLastGroup && ri === group.rows.length - 1
                const subLabel  = group.type === 'project'
                  ? (row.phaseName || '')
                  : (group.type === 'internal' ? 'Internal' : 'Time Off')
                return (
                  <div
                    key={rowKey}
                    className={cn(
                      'grid',
                      !isLastRow && 'border-b border-line-subtle',
                      isPending && 'opacity-65',
                    )}
                    style={{ gridTemplateColumns: WEEK_GRID_COLS }}
                  >
                    <div className="px-2.5 py-1.5 pl-6 flex gap-1.5 items-center border-r border-line-subtle min-w-0">
                      <div className="min-w-0">
                        <div className="text-sm text-primary truncate">
                          {row.taskTitle || row.categoryName}
                        </div>
                        {(subLabel || isPending || row.autoAdded) && (
                          <div className="text-[10px] text-muted truncate">
                            {subLabel}
                            {isPending && <span className="text-accent"> → click cell</span>}
                            {row.autoAdded && !isPending && rowTotal === 0 && <span className="text-muted"> assigned</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    {days.map((d, di) => {
                      const dayKey  = format(d, 'yyyy-MM-dd')
                      const cell    = row.days?.[dayKey]
                      const hrs     = cell?.hours || 0
                      const isEdit  = editCell?.rowKey === rowKey && editCell?.dayIdx === di
                      const isToday = isSameDay(d, new Date())
                      const isWknd  = d.getDay() === 0 || d.getDay() === 6
                      const isHoliday = myHolidays.has(dayKey)
                      return (
                        <div
                          key={di}
                          className="border-l border-line-subtle flex items-center justify-center px-0.5 py-[3px] min-h-[42px]"
                          title={isHoliday ? 'Public holiday — no work expected' : undefined}
                          style={{
                            background: isHoliday ? 'rgba(245,158,11,0.08)' : isToday ? 'var(--accent-dim)' : isWknd ? 'var(--bg-hover)' : 'transparent',
                          }}
                        >
                          {isEdit ? (
                            <div className="relative">
                              <CellEditPopover
                                hoursVal={editVal}
                                setHoursVal={setEditVal}
                                noteVal={editNote}
                                setNoteVal={setEditNote}
                                onSave={saveCell}
                                onCancel={closeEdit}
                              />
                            </div>
                          ) : (
                            <div className="relative">
                              <div
                                onClick={() => openCell(rowKey, di, hrs, cell?.note || '')}
                                title={cell?.note ? `${formatHoursHM(hrs)} — ${cell.note}` : isLocked ? 'Locked' : hrs > 0 ? `${formatHoursHM(hrs)} — click to edit` : 'Click to log'}
                                className={cn(
                                  'w-[50px] h-[30px] rounded flex items-center justify-center text-sm tabular-nums transition-all duration-100 relative border',
                                  isLocked ? 'cursor-not-allowed' : 'cursor-pointer',
                                  hrs > 0
                                    ? 'bg-accent-dim border-line-accent text-accent font-semibold'
                                    : 'bg-transparent border-transparent text-muted hover:border-line-muted hover:text-secondary',
                                )}
                              >
                                {hrs > 0 ? formatHoursHM(hrs) : isLocked ? '' : '+'}
                                {cell?.note && (
                                  <span
                                    className="absolute top-0.5 right-[3px] w-1 h-1 rounded-full bg-status-amber flex-shrink-0"
                                    title={cell.note}
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div
                      className={cn(
                        'border-l border-line-subtle flex items-center justify-center text-sm tabular-nums',
                        rowTotal > 0 ? 'font-semibold text-primary' : 'text-muted',
                      )}
                    >
                      {rowTotal > 0 ? formatHoursHM(rowTotal) : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}

        {allRows.length > 0 && (
          <div
            className="grid border-t-2 border-line-muted bg-surface"
            style={{ gridTemplateColumns: WEEK_GRID_COLS }}
          >
            <div className="px-3 py-1.5 text-xs font-bold text-muted uppercase tracking-wider">
              Day Total
            </div>
            {days.map((d, i) => {
              const dt = totals[format(d, 'yyyy-MM-dd')] || 0
              const isWknd = d.getDay() === 0 || d.getDay() === 6
              return (
                <div
                  key={i}
                  className="border-l border-line-subtle flex items-center justify-center px-0.5 py-1.5"
                  style={{ background: isWknd ? 'var(--bg-hover)' : 'transparent' }}
                >
                  <span
                    className={cn(
                      'text-sm tabular-nums',
                      dt > 0 ? 'font-bold text-primary' : 'text-muted',
                    )}
                  >
                    {dt > 0 ? formatHoursHM(dt) : '—'}
                  </span>
                </div>
              )
            })}
            <div
              className={cn(
                'border-l border-line-subtle flex items-center justify-center text-base font-bold tabular-nums',
                totalHrs > 0 ? 'text-accent' : 'text-muted',
              )}
            >
              {totalHrs > 0 ? formatHoursHM(totalHrs) : '—'}
            </div>
          </div>
        )}
        </div>
      </Card>

      {/* Below-grid summary row — fills the vertical space that was blank when
          the week is empty, and gives the user a useful "at a glance" view. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        {/* Weekly progress vs capacity */}
        <Card className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">Week progress</div>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold text-primary tabular-nums">{formatHoursHM(totalHrs)}</div>
            <div className="text-xs text-muted">of {user?.capacityHrs || 40}h logged</div>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.min(100, (totalHrs / (user?.capacityHrs || 40)) * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-muted">
            <span className="text-accent font-semibold">{formatHoursHM(billableHrs)}</span> billable ·{' '}
            <span className="text-secondary">{formatHoursHM(Math.max(0, totalHrs - billableHrs))}</span> non-billable
          </div>
        </Card>

        {/* Day-by-day mini breakdown */}
        <Card className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">Day breakdown</div>
          <div className="grid grid-cols-7 gap-1">
            {days.map(d => {
              const dk = format(d, 'yyyy-MM-dd')
              const hrs = totals[dk] || 0
              const isToday = isSameDay(d, new Date())
              const isWknd  = d.getDay() === 0 || d.getDay() === 6
              return (
                <div key={dk} className="text-center">
                  <div className={cn('text-[10px] uppercase tracking-wider', isToday ? 'text-accent font-semibold' : isWknd ? 'text-muted' : 'text-muted')}>
                    {format(d, 'EEE')[0]}
                  </div>
                  <div className={cn(
                    'mt-0.5 py-1 rounded text-xs tabular-nums font-medium',
                    hrs > 0 ? (isToday ? 'bg-accent/15 text-accent' : 'bg-surface text-primary') : 'text-muted',
                  )}>
                    {hrs > 0 ? formatHoursHM(hrs) : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Tips / shortcuts */}
        <Card className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">Tips</div>
          {isLocked ? (
            <div className="text-sm text-secondary leading-relaxed">
              This week is submitted. Click <strong className="text-primary">Unlock</strong> above to edit entries.
            </div>
          ) : (
            <div className="text-xs text-secondary leading-relaxed space-y-1.5">
              <div>
                Click any cell · <kbd className="bg-surface-overlay px-1 py-px rounded-sm text-[10px]">Enter</kbd> save · <kbd className="bg-surface-overlay px-1 py-px rounded-sm text-[10px]">Esc</kbd> cancel
              </div>
              <div>
                Type <code className="text-accent">4</code> for 4h, <code className="text-accent">40m</code> for 40 min, <code className="text-accent">1h30m</code> or <code className="text-accent">4:30</code> for combos.
              </div>
              <div className="text-muted">Enter 0 to delete · Max 24h per day.</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM VIEW — all projects → all tasks → every person's hours
// ─────────────────────────────────────────────────────────────────────────────
function TeamTimesheetView({ weekRef, setWeekRef }: any) {
  const weekDate      = format(weekRef, 'yyyy-MM-dd')
  const days          = Array.from({ length: 7 }, (_, i) => addDays(weekRef, i))
  const isCurrentWeek = weekDate === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [personFilter, setPersonFilter] = useState<string | null>(null)

  const { data: raw, isLoading } = useQuery({
    queryKey: ['team-timesheet', weekDate],
    queryFn:  () => timeApi.teamWeek(weekDate).then((r: any) => r.data),
  })
  const { data: deptsRaw } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => import('@/lib/queries').then(m => m.usersApi.departments()).then((r: any) => r.data),
  })
  const departments: any[] = deptsRaw || []

  // Unique people list built from the raw team data — used as the source for
  // the searchable people dropdown (Apr 23 — Murtaza). Derived instead of
  // fetched separately so the list is always exactly the people with hours or
  // assignments in the current week, not the whole workspace roster.
  const peopleOptions = useMemo(() => {
    const byId: Record<string, { value: string; label: string; description?: string; departmentId?: string }> = {}
    const rawProjects: any[] = raw?.projects || []
    for (const p of rawProjects) for (const t of p.tasks || []) for (const u of t.users || []) {
      if (!byId[u.userId]) byId[u.userId] = { value: u.userId, label: u.userName || 'Unknown', description: u.jobTitle || '', departmentId: u.departmentId }
    }
    return Object.values(byId)
      .filter(p => !deptFilter || p.departmentId === deptFilter)   // narrow by dept when active
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [raw, deptFilter])

  // If the selected person is no longer in the filtered option list (because
  // the user changed the department), clear the selection — keeps the two
  // filters consistent so the grid never shows "no results, but a filter is set."
  useEffect(() => {
    if (personFilter && !peopleOptions.some(p => p.value === personFilter)) setPersonFilter(null)
  }, [personFilter, peopleOptions])

  // Filter by department + person + search.
  // Memoized: with 1000+ projects/tasks/users, rebuilding on every keystroke
  // (e.g. typing the filter) caused visible lag. Now only re-runs when raw,
  // deptFilter, personFilter, or filter actually change.
  const projects: any[] = useMemo(() => {
    const rawProjects: any[] = raw?.projects || []
    const needle = filter.trim().toLowerCase()
    return rawProjects.map((p: any) => {
      const tasks = p.tasks.map((t: any) => {
        let users = t.users
        if (deptFilter)   users = users.filter((u: any) => u.departmentId === deptFilter)
        if (personFilter) users = users.filter((u: any) => u.userId === personFilter)
        return { ...t, users }
      }).filter((t: any) => t.users.length > 0)
      return { ...p, tasks }
    }).filter((p: any) => p.tasks.length > 0).filter((p: any) =>
      !needle || p.projectName.toLowerCase().includes(needle) ||
      p.tasks.some((t: any) => t.taskTitle.toLowerCase().includes(needle) ||
        t.users.some((u: any) => u.userName.toLowerCase().includes(needle))
      )
    )
  }, [raw, deptFilter, personFilter, filter])

  const grandTotalHrs    = raw?.grandTotalHrs    || 0
  const grandBillableHrs = raw?.grandBillableHrs || 0

  function toggleProject(pid: string) {
    setExpandedProjects(prev => {
      const n = new Set(prev)
      if (n.has(pid)) n.delete(pid); else n.add(pid)
      return n
    })
  }

  function expandAll()   { setExpandedProjects(new Set(projects.map((p: any) => p.projectId))) }
  function collapseAll() { setExpandedProjects(new Set()) }

  return (
    <div className="overflow-x-auto">
      {/* Toolbar */}
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Select
            size="sm"
            aria-label="Filter by department"
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="w-auto min-w-[160px]"
          >
            <option value="">All Departments</option>
            {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Combobox
            size="sm"
            aria-label="Filter by person"
            value={personFilter}
            onChange={v => setPersonFilter((v as string) || null)}
            options={peopleOptions}
            placeholder={`All People${peopleOptions.length ? ` (${peopleOptions.length})` : ''}`}
            searchPlaceholder="Search people…"
            emptyMessage="No people match"
            clearable
            className="w-[200px]"
          />
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by project, task, or person..."
            className="w-[240px] py-1.5 text-sm"
          />
          {projects.length > 0 && (
            <>
              <Button variant="secondary" size="sm" onClick={expandAll}>Expand all</Button>
              <Button variant="secondary" size="sm" onClick={collapseAll}>Collapse all</Button>
            </>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {grandTotalHrs > 0 && (
            <span className="text-sm text-muted">
              <strong className="text-primary">{grandTotalHrs}h</strong> logged ·{' '}
              <strong className="text-accent">{grandBillableHrs}h</strong> billable{' '}
              across {projects.length} project{projects.length !== 1 ? 's' : ''}
            </span>
          )}
          <WeekNav
            weekRef={weekRef}
            setWeekRef={setWeekRef}
            isCurrentWeek={isCurrentWeek}
            onReset={() => setWeekRef(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2 py-4">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}
      {!isLoading && projects.length === 0 && (
        <Card>
          <EmptyState
            title="No time logged this week"
            description="Time entries and assigned tasks will appear here once team members log hours."
          />
        </Card>
      )}

      {/* Day column headers — sticky */}
      {projects.length > 0 && (
        <div
          className="grid px-3.5 py-1.5 bg-surface border border-line-subtle border-b-0 rounded-t-md sticky top-0 z-sticky"
          style={{ gridTemplateColumns: TEAM_GRID_COLS, minWidth: TEAM_MIN_WIDTH }}
        >
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
            PROJECT / TASK / PERSON
          </div>
          {days.map((d, i) => {
            const isToday = isSameDay(d, new Date())
            const isWknd  = d.getDay() === 0 || d.getDay() === 6
            return (
              <div key={i} className="text-center">
                <div
                  className={cn(
                    'text-lg font-semibold leading-tight',
                    isToday ? 'text-accent' : isWknd ? 'text-muted' : 'text-primary',
                  )}
                >
                  {format(d, 'd')}
                </div>
                <div
                  className={cn(
                    'text-[9px] uppercase tracking-wider',
                    isToday ? 'text-accent' : 'text-muted',
                  )}
                >
                  {format(d, 'EEE')}
                </div>
              </div>
            )
          })}
          <div className="text-center text-[10px] font-bold uppercase tracking-wider text-muted">
            Total
          </div>
        </div>
      )}

      {/* Projects */}
      {projects.length > 0 && (
        <div
          className={cn(
            'border border-line-subtle overflow-hidden',
            projects.length > 0 ? 'rounded-b-md' : 'rounded-md',
          )}
          style={{ minWidth: TEAM_MIN_WIDTH }}
        >
          {projects.map((project: any, pi: number) => {
            const isExpanded = expandedProjects.has(project.projectId)
            return (
              <div
                key={project.projectId}
                className={cn(pi < projects.length - 1 && 'border-b border-line-muted')}
              >
                {/* Project header row */}
                <div
                  onClick={() => toggleProject(project.projectId)}
                  className={cn(
                    'grid px-3.5 py-2.5 items-center cursor-pointer transition-colors duration-100 hover:bg-surface-hover',
                    isExpanded ? 'bg-surface' : 'bg-surface-raised',
                  )}
                  style={{ gridTemplateColumns: TEAM_GRID_COLS }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-muted flex-shrink-0">{isExpanded ? '▾' : '▸'}</span>
                    <div
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ background: project.projectColor || 'var(--accent)' }}
                    />
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-primary truncate">
                        {project.projectName}
                      </div>
                      <div className="text-[10px] text-muted">
                        {project.clientName && `${project.clientName} · `}
                        {project.tasks.length} task{project.tasks.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  {/* Day totals for whole project */}
                  {days.map((d, di) => {
                    const dayKey = format(d, 'yyyy-MM-dd')
                    let dayHrs = 0
                    for (const task of project.tasks) {
                      for (const u of task.users) {
                        dayHrs += u.days?.[dayKey]?.hours || 0
                      }
                    }
                    const isWknd = d.getDay() === 0 || d.getDay() === 6
                    return (
                      <div
                        key={di}
                        className={cn(
                          'text-center text-sm tabular-nums py-0.5',
                          dayHrs > 0 ? 'font-semibold text-primary' : 'text-muted',
                        )}
                        style={{ background: isWknd ? 'var(--bg-hover)' : 'transparent' }}
                      >
                        {dayHrs > 0 ? formatHoursHM(dayHrs) : '—'}
                      </div>
                    )
                  })}
                  <div
                    className={cn(
                      'text-center text-base font-bold tabular-nums',
                      project.totalHrs > 0 ? 'text-accent' : 'text-muted',
                    )}
                  >
                    {project.totalHrs > 0 ? formatHoursHM(project.totalHrs) : '—'}
                  </div>
                </div>

                {/* Tasks + users — shown when expanded */}
                {isExpanded && project.tasks.map((task: any) => (
                  <div key={task.taskId}>
                    {/* Task row */}
                    <div
                      className="grid py-1.5 pr-3.5 pl-9 items-center bg-surface border-t border-line-subtle"
                      style={{ gridTemplateColumns: TEAM_GRID_COLS }}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-primary truncate">
                          {task.taskTitle}
                        </div>
                        <div className="text-[10px] text-muted flex gap-2">
                          {task.phaseName && <span>{task.phaseName}</span>}
                          {task.estHrs > 0 && <span>Est: {task.estHrs}h</span>}
                          <span
                            className={cn(
                              task.totalHrs > task.estHrs && task.estHrs > 0
                                ? 'text-status-rose'
                                : 'text-muted',
                            )}
                          >
                            Logged: {formatHoursHM(task.totalHrs)}
                          </span>
                          <span className="text-accent">
                            {task.users.length} {task.users.length === 1 ? 'person' : 'people'}
                          </span>
                        </div>
                      </div>
                      {days.map((d, di) => {
                        const dayKey = format(d, 'yyyy-MM-dd')
                        let dayHrs = 0
                        for (const u of task.users) dayHrs += u.days?.[dayKey]?.hours || 0
                        const isWknd = d.getDay() === 0 || d.getDay() === 6
                        return (
                          <div
                            key={di}
                            className={cn(
                              'text-center text-xs tabular-nums py-0.5',
                              dayHrs > 0 ? 'text-secondary' : 'text-transparent',
                            )}
                            style={{ background: isWknd ? 'var(--bg-hover)' : 'transparent' }}
                          >
                            {dayHrs > 0 ? formatHoursHM(dayHrs) : '·'}
                          </div>
                        )
                      })}
                      <div
                        className={cn(
                          'text-center text-sm tabular-nums',
                          task.totalHrs > 0 ? 'font-semibold text-primary' : 'text-muted',
                        )}
                      >
                        {task.totalHrs > 0 ? formatHoursHM(task.totalHrs) : '—'}
                      </div>
                    </div>

                    {/* Person rows — each person who worked on this task */}
                    {task.users.map((user: any) => {
                      const userTotal = Object.values(user.days || {}).reduce((s: number, d: any) => s + (d?.hours || 0), 0) as number
                      const faded = user.autoAdded && userTotal === 0
                      return (
                        <div
                          key={user.userId}
                          className={cn(
                            'grid py-1.5 pr-3.5 pl-[52px] items-center border-t border-line-subtle',
                            faded ? 'bg-transparent opacity-55' : 'bg-surface-raised',
                          )}
                          style={{ gridTemplateColumns: TEAM_GRID_COLS }}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {/* Avatar */}
                            <div
                              className={cn(
                                'w-[22px] h-[22px] rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 border',
                                userTotal > 0
                                  ? 'bg-accent-dim border-line-accent text-accent'
                                  : 'bg-surface-overlay border-line-muted text-muted',
                              )}
                            >
                              {user.userName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-primary truncate">
                                {user.userName}
                              </div>
                              {user.jobTitle && (
                                <div className="text-[10px] text-muted">
                                  {user.jobTitle}
                                  {user.autoAdded && userTotal === 0 ? ' · assigned, no hours yet' : ''}
                                </div>
                              )}
                            </div>
                          </div>
                          {days.map((d, di) => {
                            const dayKey = format(d, 'yyyy-MM-dd')
                            const cell   = user.days?.[dayKey]
                            const hrs    = cell?.hours || 0
                            const isToday = isSameDay(d, new Date())
                            const isWknd  = d.getDay() === 0 || d.getDay() === 6
                            return (
                              <div
                                key={di}
                                className="flex items-center justify-center px-0.5 py-[3px] min-h-9"
                                style={{
                                  background: isToday ? 'var(--accent-dim)' : isWknd ? 'var(--bg-hover)' : 'transparent',
                                }}
                              >
                                {hrs > 0 ? (
                                  <div
                                    title={cell?.note || ''}
                                    className={cn(
                                      'w-11 h-7 rounded flex items-center justify-center text-xs font-semibold tabular-nums border',
                                      cell?.billable
                                        ? 'bg-accent-dim border-line-accent text-accent'
                                        : 'bg-status-amber-dim border-[rgba(245,158,11,0.3)] text-status-amber',
                                    )}
                                  >
                                    {formatHoursHM(hrs)}
                                  </div>
                                ) : (
                                  <div className="w-11 h-7 flex items-center justify-center text-xs text-muted">
                                    —
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          <div
                            className={cn(
                              'text-center text-sm tabular-nums',
                              userTotal > 0 ? 'font-semibold text-primary' : 'text-muted',
                            )}
                          >
                            {userTotal > 0 ? formatHoursHM(userTotal) : '—'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {projects.length > 0 && (
        <div className="mt-2 text-xs text-muted">
          Blue cells = billable hours · Amber cells = non-billable · Faded rows = assigned but no hours logged yet
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY SUMMARY VIEW — overview of a full month
// ─────────────────────────────────────────────────────────────────────────────
function MonthlyView({ monthRef, setMonthRef }: any) {
  const monthStart = format(startOfMonth(monthRef), 'yyyy-MM-dd')
  const monthEnd   = format(endOfMonth(monthRef), 'yyyy-MM-dd')
  const monthLabel = format(monthRef, 'MMMM yyyy')
  const isCurrentMonth = format(monthRef, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  const { data: entriesRaw, isLoading } = useQuery({
    queryKey: ['time-entries-month', monthStart],
    queryFn:  () => timeApi.entries({ from: monthStart, to: monthEnd, include_all_types: 'true' }).then((r: any) => r.data),
    staleTime: 30_000,
  })

  const entries: any[] = entriesRaw || []

  // Group by week
  const weeks = eachWeekOfInterval({ start: startOfMonth(monthRef), end: endOfMonth(monthRef) }, { weekStartsOn: 1 })
  const weekSummaries = weeks.map(weekStart => {
    const ws = format(weekStart, 'yyyy-MM-dd')
    const we = format(addDays(weekStart, 6), 'yyyy-MM-dd')
    const weekEntries = entries.filter(e => e.date >= ws && e.date <= we && e.type !== 'time_off')
    const totalHrs    = weekEntries.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
    const billableHrs = weekEntries.filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
    return { weekStart: ws, weekEnd: we, weekDate: weekStart, totalHrs: Math.round(totalHrs * 10) / 10, billableHrs: Math.round(billableHrs * 10) / 10 }
  })

  // Task breakdown across the month
  const taskMap: Record<string, { title: string; project: string; color: string; hours: number; billableHrs: number }> = {}
  for (const e of entries) {
    if (e.type === 'time_off' || e.type === 'internal') continue
    const key = e.task_id || 'unknown'
    if (!taskMap[key]) {
      taskMap[key] = {
        title: e.task_title || 'Unknown task',
        project: e.project_name || '',
        color: e.project_color || 'var(--accent)',
        hours: 0,
        billableHrs: 0,
      }
    }
    taskMap[key].hours += Number(e.hours || 0)
    if (e.billable) taskMap[key].billableHrs += Number(e.hours || 0)
  }
  const taskBreakdown = Object.values(taskMap).sort((a, b) => b.hours - a.hours)

  // Internal + time-off summaries
  const internalHrs = entries.filter((e: any) => e.type === 'internal').reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
  const timeOffHrs  = entries.filter((e: any) => e.type === 'time_off').reduce((s: number, e: any) => s + Number(e.hours || 0), 0)

  // Totals
  const totalLogged  = entries.filter(e => e.type !== 'time_off').reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
  const totalBillable = entries.filter(e => e.billable && e.type !== 'time_off').reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
  // Estimate capacity: business days in month × 8h minus time-off
  const bizDays = differenceInBusinessDays(addDays(endOfMonth(monthRef), 1), startOfMonth(monthRef))
  const capacity = Math.max(0, bizDays * 8 - timeOffHrs)
  const utilPct = capacity > 0 ? Math.round((totalLogged / capacity) * 100) : 0

  const utilTone: 'accent' | 'amber' | 'default' =
    utilPct >= 80 ? 'accent' : utilPct > 0 ? 'amber' : 'default'

  return (
    <div>
      {/* Month nav */}
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <div className="text-base text-muted flex gap-2.5 items-center">
          <span>{monthLabel}</span>
          <span>·</span>
          <span>
            <strong className="text-primary">{Math.round(totalLogged * 10) / 10}h</strong> logged ·{' '}
            <strong className="text-accent">{Math.round(totalBillable * 10) / 10}h</strong> billable
          </span>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex border border-line-subtle rounded overflow-hidden">
            <button
              onClick={() => setMonthRef((m: any) => subMonths(m, 1))}
              className="bg-surface-raised border-r border-line-subtle px-3 py-1.5 text-base text-secondary hover:bg-surface-hover cursor-pointer"
            >
              ← Prev
            </button>
            <button
              onClick={() => setMonthRef(new Date())}
              className={cn(
                'bg-surface-raised border-r border-line-subtle px-3 py-1.5 text-base hover:bg-surface-hover cursor-pointer',
                isCurrentMonth ? 'font-semibold text-accent' : 'text-secondary',
              )}
            >
              This Month
            </button>
            <button
              onClick={() => setMonthRef((m: any) => addMonths(m, 1))}
              className="bg-surface-raised px-3 py-1.5 text-base text-secondary hover:bg-surface-hover cursor-pointer"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-2.5 mb-3.5">
        <StatCard
          label="Total Logged"
          value={formatHoursHM(totalLogged)}
          sub={`of ${capacity}h capacity`}
        />
        <StatCard
          label="Billable"
          value={formatHoursHM(totalBillable)}
          sub={totalLogged > 0 ? `${Math.round((totalBillable / totalLogged) * 100)}% of logged` : '—'}
          tone="accent"
        />
        <StatCard
          label="Utilization"
          value={`${utilPct}%`}
          sub={`${bizDays} working days${timeOffHrs > 0 ? ` · ${formatHoursHM(timeOffHrs)} off` : ''}`}
          tone={utilTone}
        />
        <StatCard
          label="Time Off"
          value={timeOffHrs > 0 ? formatHoursHM(timeOffHrs) : '—'}
          sub={internalHrs > 0 ? `${formatHoursHM(internalHrs)} internal` : 'no time off'}
          tone={timeOffHrs > 0 ? 'rose' : 'default'}
        />
      </div>

      {/* Weekly breakdown table */}
      <Card className="overflow-hidden p-0 mb-3.5">
        <div className="grid grid-cols-[1fr_80px_80px_80px] px-4 py-2 bg-surface border-b border-line-subtle">
          {['Week', 'Total', 'Billable', 'Non-Bill'].map(h => (
            <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">
              {h}
            </div>
          ))}
        </div>
        {isLoading && (
          <div className="p-4 flex flex-col gap-2">
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        )}
        {weekSummaries.map((w, i) => {
          const nonBill = Math.round((w.totalHrs - w.billableHrs) * 10) / 10
          return (
            <div
              key={w.weekStart}
              className={cn(
                'grid grid-cols-[1fr_80px_80px_80px] px-4 py-2.5 items-center',
                i < weekSummaries.length - 1 && 'border-b border-line-subtle',
              )}
            >
              <div className="text-base text-primary font-medium">
                {format(w.weekDate, 'MMM d')} – {format(addDays(w.weekDate, 6), 'MMM d')}
              </div>
              <div
                className={cn(
                  'text-base tabular-nums',
                  w.totalHrs > 0 ? 'font-semibold text-primary' : 'text-muted',
                )}
              >
                {w.totalHrs > 0 ? formatHoursHM(w.totalHrs) : '—'}
              </div>
              <div
                className={cn(
                  'text-base tabular-nums',
                  w.billableHrs > 0 ? 'font-semibold text-accent' : 'text-muted',
                )}
              >
                {w.billableHrs > 0 ? formatHoursHM(w.billableHrs) : '—'}
              </div>
              <div
                className={cn(
                  'text-base tabular-nums',
                  nonBill > 0 ? 'font-semibold text-status-amber' : 'text-muted',
                )}
              >
                {nonBill > 0 ? formatHoursHM(nonBill) : '—'}
              </div>
            </div>
          )
        })}
        {/* Monthly totals footer */}
        <div className="grid grid-cols-[1fr_80px_80px_80px] px-4 py-2.5 bg-surface border-t-2 border-line-muted">
          <div className="text-sm font-bold text-primary">TOTAL</div>
          <div className="text-base font-bold text-primary tabular-nums">
            {formatHoursHM(totalLogged)}
          </div>
          <div className="text-base font-bold text-accent tabular-nums">
            {formatHoursHM(totalBillable)}
          </div>
          <div className="text-base font-bold text-status-amber tabular-nums">
            {formatHoursHM(totalLogged - totalBillable)}
          </div>
        </div>
      </Card>

      {/* Task breakdown */}
      {taskBreakdown.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="px-4 py-2.5 bg-surface border-b border-line-subtle text-sm font-bold text-muted uppercase tracking-wider">
            Where your hours went
          </div>
          {taskBreakdown.slice(0, 15).map((t, i) => {
            const pct = totalLogged > 0 ? Math.round((t.hours / totalLogged) * 100) : 0
            return (
              <div
                key={i}
                className={cn(
                  'grid grid-cols-[3px_1fr_60px_40px] px-4 py-2 items-center gap-2.5',
                  i < Math.min(taskBreakdown.length, 15) - 1 && 'border-b border-line-subtle',
                )}
              >
                <div
                  className="w-[3px] h-[22px] rounded-sm"
                  style={{ background: t.color }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-primary truncate">{t.title}</div>
                  <div className="text-[10px] text-muted truncate">{t.project}</div>
                </div>
                <div className="text-base font-semibold text-primary tabular-nums text-right">
                  {formatHoursHM(t.hours)}
                </div>
                <div className="text-xs text-muted tabular-nums text-right">{pct}%</div>
              </div>
            )
          })}
          {internalHrs > 0 && (
            <div className="grid grid-cols-[3px_1fr_60px_40px] px-4 py-2 border-t border-line-subtle items-center gap-2.5">
              <div className="w-[3px] h-[22px] rounded-sm bg-status-amber" />
              <div>
                <div className="text-sm font-medium text-primary">Internal Time</div>
                <div className="text-[10px] text-muted">Non-billable overhead</div>
              </div>
              <div className="text-base font-semibold text-status-amber tabular-nums text-right">
                {formatHoursHM(internalHrs)}
              </div>
              <div className="text-xs text-muted tabular-nums text-right">
                {totalLogged > 0 ? Math.round((internalHrs / totalLogged) * 100) : 0}%
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE ROOT — tab switcher for admin, single view for regular users
// ─────────────────────────────────────────────────────────────────────────────
export default function TimesheetsPage() {
  const { isAdmin } = useAuthStore()
  const [activeTab,  setActiveTab]  = useState<'mine'|'team'>('mine')
  const [viewMode,   setViewMode]   = useState<'week'|'month'>('week')
  const [weekRef,    setWeekRef]    = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [monthRef,   setMonthRef]   = useState(new Date())

  return (
    <div className="px-7 py-6">
      <PageHeader
        title="Timesheets"
        actions={
          <div className="flex gap-2 items-center">
            {/* Week / Month toggle */}
            <div className="flex bg-surface-raised border border-line-subtle rounded-md overflow-hidden">
              {[
                { key: 'week',  label: 'Week' },
                { key: 'month', label: 'Month' },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setViewMode(t.key as any)}
                  className={cn(
                    'border-0 cursor-pointer px-3 py-1.5 text-sm transition-colors duration-100',
                    viewMode === t.key
                      ? 'bg-surface-overlay font-semibold text-primary'
                      : 'bg-transparent text-muted hover:text-primary',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* Only admins see both tabs */}
            {isAdmin() && viewMode === 'week' && (
              <div className="flex bg-surface-raised border border-line-subtle rounded-md overflow-hidden">
                {[
                  { key: 'mine', label: 'My Timesheet' },
                  { key: 'team', label: 'Team View' },
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key as any)}
                    className={cn(
                      'border-0 cursor-pointer px-4 py-1.5 text-base transition-colors duration-100',
                      activeTab === t.key
                        ? 'bg-accent text-white font-semibold'
                        : 'bg-transparent text-secondary hover:text-primary',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />

      {/* Views */}
      {viewMode === 'week' && activeTab === 'mine' && (
        <MyTimesheetView weekRef={weekRef} setWeekRef={setWeekRef} />
      )}
      {viewMode === 'week' && activeTab === 'team' && isAdmin() && (
        <TeamTimesheetView weekRef={weekRef} setWeekRef={setWeekRef} />
      )}
      {viewMode === 'month' && (
        <MonthlyView monthRef={monthRef} setMonthRef={setMonthRef} />
      )}
    </div>
  )
}
