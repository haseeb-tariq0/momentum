'use client'
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, startOfWeek, addWeeks, subWeeks, addDays, isSameDay } from 'date-fns'
import { api } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { showConfirm } from '@/components/ConfirmDialog'
import { X, Check, ChevronRight, ChevronDown, Users, User } from 'lucide-react'
import { showToast } from '@/components/Toast'
import {
  PageHeader, StatCard, Card, Button, Input, Label, Select,
} from '@/components/ui'
import { cn } from '@/lib/cn'

// ── Types ─────────────────────────────────────────────────────────────────────
interface CellPopup {
  memberId:    string
  memberName:  string
  clickedDate: string
  anchorRect:  DOMRect
}

interface DragState {
  allocId:       string
  userId:        string
  origStartDate: string
  origEndDate:   string
  newEndDate:    string
  // pixel positions of each visible day (for hit-testing)
  dayRects: { date: string; left: number; right: number }[]
}

// ── Searchable Project Dropdown ─────────────────────────────────────────────
function ProjectPicker({ projects, value, onChange }: {
  projects: any[]
  value: string
  onChange: (id: string, name: string) => void
}) {
  const [open,   setOpen]   = useState(false)
  const [query,  setQuery]  = useState('')
  const ref                 = useRef<HTMLDivElement>(null)
  const inputRef            = useRef<HTMLInputElement>(null)

  const selected = projects.find(p => p.id === value)
  const filtered = query.trim()
    ? projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || (p.clients?.name||'').toLowerCase().includes(query.toLowerCase()))
    : projects

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center justify-between w-full px-2.5 py-1.5 bg-surface border rounded text-base text-primary cursor-pointer transition-colors duration-150 outline-none',
          open ? 'border-accent' : 'border-line-muted',
        )}
      >
        <span className={cn('truncate', selected ? 'text-primary' : 'text-muted')}>
          {selected
            ? (
              <>
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle flex-shrink-0"
                  style={{ background: selected.color || 'var(--accent)' }}
                />
                {selected.name}
              </>
            )
            : 'Search project...'}
        </span>
        <span className="text-muted text-[10px] flex-shrink-0">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-dropdown bg-surface-raised border border-line-muted rounded-md shadow-md overflow-hidden">
          <div className="px-2 py-1.5 border-b border-line-subtle">
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type to search..."
              onClick={e => e.stopPropagation()}
              className="w-full bg-transparent border-none text-primary text-sm outline-none px-1 py-0.5 font-body"
            />
          </div>
          <div className="max-h-[180px] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-2.5 py-2.5 text-sm text-muted text-center">No projects found</div>
            )}
            {filtered.map(p => (
              <div key={p.id}
                onClick={() => { onChange(p.id, p.name); setOpen(false); setQuery('') }}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-2 text-sm cursor-pointer hover:bg-surface-hover',
                  p.id === value && 'bg-accent-dim',
                )}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: p.color || 'var(--accent)' }}
                />
                <div className="min-w-0">
                  <div className="font-medium text-primary truncate">{p.name}</div>
                  {p.clients?.name && <div className="text-[10px] text-muted">{p.clients.name}</div>}
                </div>
                {p.id === value && (
                  <span className="ml-auto text-accent flex-shrink-0"><Check size={14} /></span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Quick-Add Popup ──────────────────────────────────────────────────────────
function QuickAddPopup({
  popup, weekDays, onClose, onSave, saving
}: {
  popup:    CellPopup
  weekDays: Date[]
  onClose:  () => void
  onSave:   (payloads: any[]) => void
  saving:   boolean
}) {
  const [projectId, setProjectId] = useState('')
  const [phaseId,   setPhaseId]   = useState('')
  const [taskId,    setTaskId]    = useState('')
  const [hours,     setHours]     = useState(8)
  // Inline task creation state
  const [creatingTask,    setCreatingTask]    = useState(false)
  const [newTaskName,     setNewTaskName]     = useState('')
  const [newTaskEst,      setNewTaskEst]      = useState('')
  const [newTaskBillable, setNewTaskBillable] = useState(true)
  const [savingTask,      setSavingTask]      = useState(false)
  const qc = useQueryClient()
  // selectedDays: set of 'yyyy-MM-dd' strings the user picked
  const [selectedDays, setSelectedDays] = useState<Set<string>>(() => new Set([popup.clickedDate]))
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])
  // Click-outside is now handled by a backdrop overlay below (same pattern
  // as ConfirmDialog). The old document.addEventListener('mousedown') approach
  // broke when Dropdown panels opened inside the popup — the native event
  // propagation race caused the popup to close on every option pick.

  const { data: projectsRaw } = useQuery({
    queryKey: ['resourcing-projects'],
    queryFn:  () => api.get('/resourcing/projects').then((r: any) => r.data),
    staleTime: 60_000,
  })
  const projects: any[] = projectsRaw || []

  const { data: tasksRaw, isLoading: tasksLoading } = useQuery({
    queryKey: ['resourcing-tasks-by-project', projectId],
    queryFn:  () => api.get(`/resourcing/tasks?projectId=${projectId}`).then((r: any) => r.data),
    enabled:  !!projectId,
    staleTime: 30_000,
  })
  const allTasks: any[] = tasksRaw || []

  // Fetch project details to get phases (always, for Project → Phase → Task picker)
  const { data: projectDetail } = useQuery({
    queryKey: ['project-detail-popup', projectId],
    queryFn:  () => api.get(`/projects/${projectId}`).then((r: any) => r.data),
    enabled:  !!projectId,
    staleTime: 60_000,
  })
  const phases: any[] = projectDetail?.phases || []

  // Filter tasks by selected phase
  const tasks = phaseId ? allTasks.filter((t: any) => (t.phases?.id || t.phase_id) === phaseId) : []

  // Inherit billable from project when entering task creation mode
  useEffect(() => {
    if (creatingTask && projectDetail && typeof projectDetail.billable === 'boolean') {
      setNewTaskBillable(projectDetail.billable)
    }
  }, [creatingTask, projectDetail])

  function toggleDay(dk: string) {
    setSelectedDays(prev => {
      const next = new Set(prev)
      if (next.has(dk)) { if (next.size > 1) next.delete(dk) } // keep at least 1 selected
      else next.add(dk)
      return next
    })
  }

  // Quick-select presets
  function selectPreset(preset: 'today' | 'weekdays' | 'all') {
    if (preset === 'today') setSelectedDays(new Set([popup.clickedDate]))
    else if (preset === 'weekdays') setSelectedDays(new Set(weekDays.slice(0,5).map(d => format(d,'yyyy-MM-dd'))))
    else setSelectedDays(new Set(weekDays.map(d => format(d,'yyyy-MM-dd'))))
  }

  const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

  const vw = typeof window !== 'undefined' ? window.innerWidth  : 1440
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const W  = 310, H = 440
  let left = popup.anchorRect.left
  let top  = popup.anchorRect.bottom + 6
  if (left + W > vw - 12) left = vw - W - 12
  if (top  + H > vh - 12) top  = popup.anchorRect.top - H - 6

  const selectedCount = selectedDays.size

  return (
    <>
    {/* Invisible backdrop — click to close. Uses z-index one step below the
        popup so clicks on the popup (and its Dropdown panels) never reach it.
        This replaces the old document.addEventListener('mousedown') approach
        which was fragile with nested Dropdown components. */}
    <div className="fixed inset-0 z-overlay" onClick={onClose} />
    <div
      ref={popupRef}
      className="fixed z-popover bg-surface-raised border border-line-muted rounded-xl shadow-md animate-popup-slide"
      style={{ left, top, width: W, maxWidth: 'calc(100vw - 24px)' }}
    >

      {/* Header */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2.5 border-b border-line-subtle">
        <div>
          <div className="text-base font-semibold text-primary">Allocate — {popup.memberName.split(' ')[0]}</div>
          <div className="text-xs text-muted mt-px">
            {selectedCount === 1
              ? format(new Date(Array.from(selectedDays)[0]+'T12:00:00'), 'EEEE, MMM d')
              : `${selectedCount} days selected`}
          </div>
        </div>
        <button
          aria-label="Close popup"
          onClick={onClose}
          className="bg-transparent border-none cursor-pointer text-muted p-0 leading-none hover:text-primary"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2.5 px-3.5 pt-3 pb-3.5">

        {/* Day Picker */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-0">Days</Label>
            <div className="flex gap-1">
              {[['Today','today'],['Mon–Fri','weekdays'],['All 7','all']].map(([label, preset]) => (
                <button
                  key={preset}
                  onClick={() => selectPreset(preset as any)}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm font-body cursor-pointer bg-surface border border-line-muted text-muted hover:text-primary"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-7 gap-[3px]">
            {weekDays.map((d, i) => {
              const dk      = format(d, 'yyyy-MM-dd')
              const sel_    = selectedDays.has(dk)
              const isWknd  = d.getDay()===0 || d.getDay()===6
              return (
                <button
                  key={dk}
                  onClick={() => toggleDay(dk)}
                  className={cn(
                    'flex flex-col items-center gap-px py-1 rounded font-body cursor-pointer border transition-all duration-100',
                    sel_
                      ? 'bg-accent border-accent text-white'
                      : isWknd
                        ? 'bg-surface-overlay border-line-muted text-muted'
                        : 'bg-surface border-line-muted text-secondary',
                  )}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wide">{DAY_LABELS[i]}</span>
                  <span className="text-xs font-semibold">{format(d,'d')}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Project */}
        <div>
          <Label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Project</Label>
          <ProjectPicker
            projects={projects}
            value={projectId}
            onChange={(id) => { setProjectId(id); setPhaseId(''); setTaskId('') }}
          />
        </div>

        {/* Phase */}
        <div>
          <Label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Phase</Label>
          <Select
            aria-label="Phase"
            value={phaseId}
            onChange={e => { setPhaseId(e.target.value); setTaskId('') }}
            disabled={!projectId}
          >
            <option value="">{!projectId ? 'Select a project first' : phases.length === 0 ? 'No phases in project' : 'Pick a phase…'}</option>
            {phases.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>

        {/* Task */}
        <div>
          <Label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Task</Label>
          {!creatingTask ? (
            <Select
              aria-label="Task"
              value={taskId}
              onChange={e => {
                if (e.target.value === '__new__') { setCreatingTask(true); setTaskId('') }
                else setTaskId(e.target.value)
              }}
              disabled={!phaseId}
            >
              <option value="">{tasksLoading ? 'Loading tasks…' : !phaseId ? 'Select a phase first' : tasks.length === 0 ? 'No tasks in this phase' : 'Pick a task…'}</option>
              {tasks.map((t: any) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
              {phaseId && <option value="__new__">+ Create New Task</option>}
            </Select>
          ) : (
            <div className="flex flex-col gap-2 p-2.5 rounded-md border border-accent bg-accent-dim/30">
              <div className="px-1.5 py-1 mb-0.5 rounded bg-status-amber-dim text-[10px] text-status-amber font-medium">
                Before creating a new task, check the task dropdown to make sure it doesn't already exist.
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-accent uppercase tracking-wider">New Task</span>
                <button
                  aria-label="Cancel new task"
                  onClick={() => { setCreatingTask(false); setNewTaskName(''); setNewTaskEst('') }}
                  className="bg-transparent border-0 text-muted hover:text-primary cursor-pointer p-0 leading-none"
                >
                  <X size={14} />
                </button>
              </div>
              {/* Task name */}
              <Input
                autoFocus
                value={newTaskName}
                onChange={e => setNewTaskName(e.target.value)}
                placeholder="Task name…"
                onKeyDown={e => { if (e.key === 'Escape') { setCreatingTask(false); setNewTaskName(''); setNewTaskEst('') } }}
              />
              {/* Estimated hours */}
              <div>
                <label className="block text-[9px] font-bold text-muted uppercase tracking-wider mb-1">Estimated Hours (optional)</label>
                <input
                  type="number" min={0} step={0.25}
                  value={newTaskEst}
                  onChange={e => setNewTaskEst(e.target.value)}
                  placeholder="—"
                  className="w-full text-xs px-2 py-1.5 bg-surface border border-line-muted rounded text-primary outline-none focus:border-accent"
                />
              </div>
              {/* Billable toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newTaskBillable}
                  onChange={e => setNewTaskBillable(e.target.checked)}
                  className="cursor-pointer"
                />
                <span className="text-xs text-secondary">
                  Billable
                  {projectDetail && typeof projectDetail.billable === 'boolean' && (
                    <span className="text-[10px] text-muted ml-1">
                      (project default: {projectDetail.billable ? 'Billable' : 'Non-billable'})
                    </span>
                  )}
                </span>
              </label>
              {/* Phase indicator (read-only — uses the phase already picked above) */}
              <div className="text-[10px] text-muted">
                Will be added to <span className="text-secondary font-medium">{phases.find((p: any) => p.id === phaseId)?.name || 'selected phase'}</span>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="primary" size="sm"
                  disabled={!newTaskName.trim() || !phaseId || savingTask}
                  loading={savingTask}
                  onClick={async () => {
                    if (!newTaskName.trim() || !phaseId) return
                    setSavingTask(true)
                    try {
                      const payload: any = {
                        title: newTaskName.trim(),
                        phase_id: phaseId,
                        status: 'todo',
                        billable: newTaskBillable,
                      }
                      if (newTaskEst && Number(newTaskEst) > 0) payload.estimated_hrs = Number(newTaskEst)
                      const r: any = await api.post(`/projects/${projectId}/tasks`, payload)
                      setTaskId(r.data.id)
                      setCreatingTask(false)
                      setNewTaskName(''); setNewTaskEst('')
                      qc.invalidateQueries({ queryKey: ['resourcing-tasks-by-project', projectId] })
                      showToast.success('Task created')
                    } catch (e: any) {
                      showToast.error('Failed to create task: ' + (e?.message || 'error'))
                    } finally {
                      setSavingTask(false)
                    }
                  }}
                >
                  Create Task
                </Button>
                <Button
                  variant="secondary" size="sm"
                  onClick={() => { setCreatingTask(false); setNewTaskName(''); setNewTaskEst('') }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Hours */}
        <div>
          <Label className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Hours / day</Label>
          <div className="flex items-center gap-[5px]">
            {[2,4,6,8].map(h => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={cn(
                  'flex-1 py-1.5 text-sm font-semibold font-body rounded cursor-pointer border',
                  hours===h
                    ? 'bg-accent-dim text-accent border-accent'
                    : 'bg-surface text-secondary border-line-muted',
                )}
              >
                {h}h
              </button>
            ))}
            <Input
              type="number"
              min={0.25}
              max={16}
              step={0.25}
              value={hours}
              onChange={e => setHours(Number(e.target.value))}
              className="w-14 px-2 py-1.5 text-center text-sm"
            />
          </div>
        </div>

        {/* Save */}
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            if (!taskId || !projectId) return
            // Group selected days into contiguous date ranges so we create
            // ONE allocation per run instead of one per day.
            // Mon+Tue+Wed+Thu+Fri → single { start: Mon, end: Fri }
            // Mon+Wed+Fri         → three separate single-day allocations
            const sorted = Array.from(selectedDays).sort()
            const ranges: { start: string; end: string }[] = []
            for (const day of sorted) {
              const last = ranges[ranges.length - 1]
              if (last) {
                // Check if this day is the next weekday after `last.end`
                const prev = new Date(last.end + 'T12:00:00')
                const curr = new Date(day + 'T12:00:00')
                const diffMs = curr.getTime() - prev.getTime()
                const diffDays = Math.round(diffMs / 86_400_000)
                // 1 = next day, 2 = skipped Sat (Fri→Mon impossible here), 3 = skipped weekend (Fri→Mon)
                if (diffDays <= 3) { last.end = day; continue }
              }
              ranges.push({ start: day, end: day })
            }
            const payloads = ranges.map(r => ({
              user_id: popup.memberId, task_id: taskId,
              start_date: r.start, end_date: r.end,
              hours_per_day: hours, note: null,
            }))
            onSave(payloads)
          }}
          disabled={!taskId || !projectId || saving}
          loading={saving}
          className="w-full mt-0.5"
        >
          {saving ? 'Saving...' : `Allocate ${hours}h/day × ${selectedCount} day${selectedCount>1?'s':''}`}
        </Button>
      </div>
    </div>
    </>
  )
}

// ── Allocation Detail Popup ──────────────────────────────────────────────────
function AllocDetailPopup({
  alloc, anchorRect, clickedDay, onClose, onDeleteDay, onDeleteAll, onUpdateHours, deleting
}: {
  alloc:         any
  anchorRect:    DOMRect
  clickedDay:    string
  onClose:       () => void
  onDeleteDay:   () => void
  onDeleteAll:   () => void
  onUpdateHours: (hrs: number) => void
  deleting:      boolean
}) {
  const isMultiDay = alloc.startDate !== alloc.endDate
  const ref                       = useRef<HTMLDivElement>(null)
  const [hours, setHours]         = useState<number>(alloc.hoursPerDay)
  const [saving,  setSaving]      = useState(false)
  const hoursChanged              = hours !== alloc.hoursPerDay
  const [estimate,     setEstimate]     = useState<string>(String(alloc.estimatedHrs || ''))
  const [savingEst,    setSavingEst]    = useState(false)
  const [estSaved,     setEstSaved]     = useState(false)
  const origEstimate   = String(alloc.estimatedHrs || '')
  const estimateChanged = estimate !== origEstimate
  const estSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (estSavedTimerRef.current) clearTimeout(estSavedTimerRef.current) }, [])

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => { document.removeEventListener('keydown', k) }
  }, [onClose])
  // Click-outside uses a backdrop (same fix as AllocationPopup).

  async function saveHours() {
    if (!hoursChanged || saving) return
    setSaving(true)
    try {
      await onUpdateHours(hours)
    } catch (e: any) {
      showToast.error('Failed to update: ' + (e?.message || 'error'))
    } finally {
      setSaving(false)
    }
  }

  async function saveEstimate() {
    if (!estimateChanged || savingEst || !alloc.projectId || !alloc.taskId) return
    setSavingEst(true)
    try {
      const hrs = parseFloat(estimate) || 0
      await api.patch(`/projects/${alloc.projectId}/tasks/${alloc.taskId}`, { estimated_hrs: hrs > 0 ? hrs : null })
      setEstSaved(true)
      if (estSavedTimerRef.current) clearTimeout(estSavedTimerRef.current)
      estSavedTimerRef.current = setTimeout(() => setEstSaved(false), 1500)
    } catch (e: any) {
      showToast.error('Failed to update estimate: ' + (e?.message || 'error'))
    } finally {
      setSavingEst(false)
    }
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const W  = 260
  let left = anchorRect.left
  let top  = anchorRect.bottom + 6
  if (left + W > vw - 12) left = vw - W - 12

  return (
    <>
    <div className="fixed inset-0 z-overlay" onClick={onClose} />
    <div
      ref={ref}
      className="fixed z-popover bg-surface-raised border border-line-muted rounded-lg shadow-md px-3.5 py-3 animate-popup-slide"
      style={{ left, top, width: W, maxWidth: 'calc(100vw - 24px)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-[3px] h-8 rounded-sm flex-shrink-0"
          style={{ background: alloc.projectColor || 'var(--accent)' }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-primary leading-tight truncate">{alloc.taskTitle}</div>
          <div className="text-xs text-muted">{alloc.projectName}</div>
        </div>
        <button
          onClick={onClose}
          className="bg-transparent border-none cursor-pointer text-muted p-0 leading-none flex-shrink-0 hover:text-primary"
        >
          <X size={16} />
        </button>
      </div>
      <div className="h-px bg-line-subtle my-2" />

      {/* Period */}
      <div className="flex justify-between text-xs text-muted mb-2">
        <span>Period</span>
        <span className="font-semibold text-primary">
          {format(new Date(alloc.startDate+'T12:00:00'),'MMM d')} – {format(new Date(alloc.endDate+'T12:00:00'),'MMM d')}
        </span>
      </div>

      {/* Task estimate */}
      {alloc.taskId && alloc.projectId && (
        <div className="flex justify-between items-center text-xs text-muted mb-3">
          <span>Task Estimate</span>
          <div className="flex items-center gap-1">
            <input
              type="number" min={0} step={1} value={estimate}
              onChange={e => setEstimate(e.target.value)}
              onBlur={saveEstimate}
              onKeyDown={e => { if (e.key==='Enter') saveEstimate(); if (e.key==='Escape') setEstimate(origEstimate) }}
              className="w-[50px] bg-surface border border-line-muted rounded-sm px-1.5 py-0.5 text-xs text-primary font-body outline-none text-right"
            />
            <span className="text-[10px] text-muted">hrs</span>
            {estSaved && <span className="text-[10px] text-accent font-semibold"><Check size={14} /></span>}
          </div>
        </div>
      )}

      {/* Editable hours */}
      <div className="mb-3">
        <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">Hours / day</div>
        <div className="flex items-center gap-[5px]">
          {[2,4,6,8].map(h => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={cn(
                'flex-1 py-1 text-sm font-semibold font-body rounded-sm cursor-pointer border',
                hours===h
                  ? 'bg-accent-dim text-accent border-accent'
                  : 'bg-surface text-secondary border-line-muted',
              )}
            >
              {h}h
            </button>
          ))}
          <input
            type="number" min={0.25} max={16} step={0.25} value={hours}
            onChange={e => setHours(Number(e.target.value))}
            onKeyDown={e => e.key === 'Enter' && saveHours()}
            className="w-[50px] bg-surface border border-line-muted rounded-sm px-1.5 py-1 text-sm text-primary font-body outline-none text-center"
          />
        </div>
      </div>

      {/* Save hours button — only shows when changed */}
      {hoursChanged && (
        <Button
          variant="primary"
          size="sm"
          onClick={saveHours}
          disabled={saving}
          loading={saving}
          className="w-full mb-2"
        >
          {saving ? 'Saving...' : `Update to ${hours}h/day`}
        </Button>
      )}

      {/* Remove — per-day (primary) + full range (secondary) */}
      <Button
        variant="danger"
        size="sm"
        onClick={onDeleteDay}
        disabled={deleting}
        className="w-full"
      >
        {deleting ? 'Removing...' : isMultiDay ? `Remove ${new Date(clickedDay+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}` : 'Remove Allocation'}
      </Button>
      {isMultiDay && (
        <button
          onClick={onDeleteAll}
          disabled={deleting}
          className="w-full text-center text-[10px] text-muted hover:text-status-rose cursor-pointer bg-transparent border-0 font-body mt-1.5 py-0.5"
        >
          Remove entire allocation ({alloc.startDate} → {alloc.endDate})
        </button>
      )}
    </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ResourcingPage() {
  const qc = useQueryClient()
  const { isAdmin } = useAuthStore()

  const [weekRef,     setWeekRef]     = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [cellPopup,   setCellPopup]   = useState<CellPopup | null>(null)
  const [detailPopup, setDetailPopup] = useState<{ alloc: any; anchorRect: DOMRect; clickedDay: string } | null>(null)
  const [deptFilter,  setDeptFilter]  = useState<string>('all')
  const [groupByDept, setGroupByDept] = useState(true)
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set())

  // ── Drag-to-extend state ───────────────────────────────────────────────────
  const [dragState, setDragState] = useState<DragState | null>(null)
  const dragStateRef = useRef<DragState | null>(null)   // ref mirror for stable event listeners
  dragStateRef.current = dragState

  const weekStart = format(weekRef, 'yyyy-MM-dd')
  const weekEnd   = format(addDays(weekRef, 6), 'yyyy-MM-dd')
  const days      = Array.from({ length: 7 }, (_, i) => addDays(weekRef, i))

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: raw, isLoading, refetch } = useQuery({
    queryKey: ['resourcing', weekStart],
    queryFn:  () => api.get(`/resourcing/team?weekStart=${weekStart}`).then((r: any) => r.data),
    staleTime: 15_000,  // 15s — mutations call refetch() explicitly after save
  })
  const { data: deptsRaw } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => api.get('/users/departments').then((r: any) => r.data),
    staleTime: 120_000,
  })
  const depts: any[] = deptsRaw || []

  // Holidays for the visible week — used to grey out holiday cells per user
  const weekEndStr = format(addDays(weekRef, 6), 'yyyy-MM-dd')
  const { data: holidayData } = useQuery({
    queryKey: ['holidays-range-resourcing', weekStart, weekEndStr],
    queryFn:  () => api.get(`/users/holidays-range?from=${weekStart}&to=${weekEndStr}`).then((r: any) => r.data),
    staleTime: 3_600_000,
  })
  // Helper: is `dateStr` a holiday for `userId`?
  function isHolidayFor(userId: string, dateStr: string): boolean {
    if (!holidayData) return false
    const calId = holidayData.userCalendarMap?.[userId]
    if (!calId) return false
    const dates: string[] = holidayData.calendarHolidays?.[calId] || []
    return dates.includes(dateStr)
  }

  const createAlloc = useMutation({
    mutationFn: (d: any) => api.post('/resourcing/allocations', d),
    onSuccess:  () => { refetch(); setCellPopup(null) },
    onError:    (e: any) => showToast.error('Failed to save: ' + (e?.message || 'error')),
  })

  // ── Save multiple allocations (one per selected day) and refresh grid ──────
  const [savingMulti, setSavingMulti] = useState(false)
  const justSavedRef = useRef(false)  // prevents cell-click re-opening popup immediately after save
  async function handleMultiSave(payloads: any[]) {
    setSavingMulti(true)
    try {
      await Promise.all(payloads.map((p: any) => api.post('/resourcing/allocations', p)))
      await refetch()
      justSavedRef.current = true
      setCellPopup(null)
      setTimeout(() => { justSavedRef.current = false }, 400)
    } catch(e: any) {
      showToast.error('Failed to save: ' + (e?.message || 'unknown error'))
    } finally {
      setSavingMulti(false)
    }
  }

  const patchAlloc = useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/resourcing/allocations/${id}`, data),
    onSuccess:  () => { refetch() },
    onError:    (e: any) => { refetch(); showToast.error('Failed to extend: ' + (e?.message || 'error')) },
  })

  const updateAllocHours = useMutation({
    mutationFn: ({ id, hours_per_day }: { id: string; hours_per_day: number }) =>
      api.patch('/resourcing/allocations/' + id, { hours_per_day }),
    onSuccess: () => {
      justSavedRef.current = true
      refetch()
      setDetailPopup(null)
      setTimeout(() => { justSavedRef.current = false }, 400)
    },
    onError: (e: any) => showToast.error('Failed to update hours: ' + (e?.message || 'error')),
  })
  const deleteAlloc = useMutation({
    mutationFn: (id: string) => api.delete(`/resourcing/allocations/${id}`),
    onSuccess:  () => { refetch(); setDetailPopup(null) },
  })

  // ── Per-day allocation removal ───────────────────────────────────────────
  // Instead of deleting the whole Mon–Fri allocation when the user only wants
  // to remove Wednesday, we shrink or split the date range.
  const removeDayFromAlloc = useMutation({
    mutationFn: async ({ alloc, day }: { alloc: any; day: string }) => {
      const start = alloc.startDate as string
      const end   = alloc.endDate   as string

      // Helper: move a date string forward/backward by N days (skipping weekends)
      const shiftDay = (d: string, dir: 1 | -1): string => {
        const dt = new Date(d + 'T12:00:00')
        do { dt.setDate(dt.getDate() + dir) } while (dt.getDay() === 0 || dt.getDay() === 6)
        return dt.toISOString().slice(0, 10)
      }

      if (start === end) {
        // Single-day allocation — just delete it
        await api.delete(`/resourcing/allocations/${alloc.id}`)
      } else if (day === start) {
        // Clicked the first day — shrink from the left
        await api.patch(`/resourcing/allocations/${alloc.id}`, { start_date: shiftDay(day, 1) })
      } else if (day === end) {
        // Clicked the last day — shrink from the right
        await api.patch(`/resourcing/allocations/${alloc.id}`, { end_date: shiftDay(day, -1) })
      } else {
        // Clicked in the middle — split into two allocations
        // 1. Shrink the original to end before the clicked day
        await api.patch(`/resourcing/allocations/${alloc.id}`, { end_date: shiftDay(day, -1) })
        // 2. Create a new allocation starting after the clicked day
        await api.post('/resourcing/allocations', {
          user_id:       alloc.userId,
          task_id:       alloc.taskId,
          start_date:    shiftDay(day, 1),
          end_date:      end,
          hours_per_day: alloc.hoursPerDay,
          note:          alloc.note || undefined,
        })
      }
    },
    onSuccess: () => { refetch(); setDetailPopup(null) },
    onError: (e: any) => showToast.error('Failed to remove day: ' + (e?.message || 'error')),
  })

  const allTeam       = raw || []
  const team          = deptFilter === 'all' ? allTeam : allTeam.filter((m: any) => m.department === deptFilter || m.departmentId === deptFilter)
  const totalCapacity = team.reduce((s: number, u: any) => s + u.capacityHrs, 0)
  const totalAlloc    = team.reduce((s: number, u: any) => s + u.allocatedHrs, 0)
  const teamUtil      = totalCapacity > 0 ? Math.round((totalAlloc / totalCapacity) * 100) : 0

  // Group team by department for department view
  const deptGroups = (() => {
    const map: Record<string, { name: string; members: any[] }> = {}
    for (const m of team) {
      const dName = m.department || 'Unassigned'
      if (!map[dName]) map[dName] = { name: dName, members: [] }
      map[dName].members.push(m)
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
  })()

  const toggleDept = (name: string) => {
    setExpandedDepts(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // ── Drag-to-extend: global mouse handlers ─────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const ds = dragStateRef.current
      if (!ds) return
      // Find which day rect the cursor is in
      const hit = ds.dayRects.find(r => e.clientX >= r.left && e.clientX <= r.right)
      if (!hit) return
      // Only extend forward (can't drag left past start)
      if (hit.date >= ds.origStartDate) {
        // Calculate how many weekdays the allocation would span
        const member = allTeam.find((m: any) => m.id === ds.userId)
        if (member) {
          const weeklyCapHrs = member.capacityHrs || 40
          const allocHpd = member.allocations.find((a: any) => a.id === ds.allocId)?.hoursPerDay || 8
          // Count weekdays from start to proposed end
          let proposedDays = 0
          let cur = new Date(ds.origStartDate + 'T12:00:00')
          const end = new Date(hit.date + 'T12:00:00')
          while (cur <= end) {
            const dow = cur.getDay()
            if (dow !== 0 && dow !== 6) proposedDays++
            cur = new Date(cur.getTime() + 86400000)
          }
          // Sum OTHER allocations' hours for the week
          const otherAllocHrs = member.allocations
            .filter((a: any) => a.id !== ds.allocId)
            .reduce((s: number, a: any) => s + Number(a.hoursPerDay), 0)
          const projectedTotal = (proposedDays * allocHpd) + otherAllocHrs
          // Cap: don't let drag extend beyond weekly capacity (with 15% buffer)
          if (projectedTotal > weeklyCapHrs * 1.15) return
        }
        setDragState(s => s ? { ...s, newEndDate: hit.date } : s)
      }
    }

    function onMouseUp(e: MouseEvent) {
      const ds = dragStateRef.current
      if (!ds) return
      // Save if end date changed
      if (ds.newEndDate !== ds.origEndDate) {
        patchAlloc.mutate({ id: ds.allocId, end_date: ds.newEndDate })
      }
      setDragState(null)
      dragStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
      // If unmounted mid-drag, reset body styles so the cursor doesn't stay
      // ew-resize site-wide and text selection doesn't stay disabled.
      if (dragStateRef.current) {
        dragStateRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, []) // stable — uses ref

  // ── Cell & pill click handlers ─────────────────────────────────────────────
  function handleCellClick(e: React.MouseEvent, member: any, date: Date) {
    if (!isAdmin() || dragState || justSavedRef.current) return
    const dk   = format(date, 'yyyy-MM-dd')
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDetailPopup(null)
    setCellPopup({ memberId: member.id, memberName: member.name, clickedDate: dk, anchorRect: rect })
  }

  function handleAllocClick(e: React.MouseEvent, alloc: any, day: string) {
    e.stopPropagation()
    if (!isAdmin() || dragState) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setCellPopup(null)
    setDetailPopup({ alloc, anchorRect: rect, clickedDay: day })
  }

  // ── Start drag: collect day column rects ──────────────────────────────────
  function startDrag(e: React.MouseEvent, alloc: any) {
    e.preventDefault()
    e.stopPropagation()
    if (!isAdmin()) return

    // Find the parent row for this allocation to scope day rect collection
    const pill = e.currentTarget.closest('[data-member-row]') as HTMLElement | null
    const scope = pill || document

    // Collect day column bounding rects from the same row only (deduped by date)
    const seen = new Set<string>()
    const dayRects = Array.from(scope.querySelectorAll('[data-day-col]') as NodeListOf<HTMLElement>)
      .map(el => { const r = el.getBoundingClientRect(); return { date: el.dataset.dayCol || '', left: r.left, right: r.right } })
      .filter(r => {
        if (!r.date || seen.has(r.date)) return false
        seen.add(r.date)
        // Exclude weekends
        const d = new Date(r.date + 'T12:00:00')
        return d.getDay() !== 0 && d.getDay() !== 6
      })

    const ds: DragState = {
      allocId:       alloc.id,
      userId:        alloc.userId || '',
      origStartDate: alloc.startDate,
      origEndDate:   alloc.endDate,
      newEndDate:    alloc.endDate,
      dayRects,
    }
    setDragState(ds)
    dragStateRef.current = ds
    document.body.style.cursor    = 'ew-resize'
    document.body.style.userSelect = 'none'
  }

  function utilColor(pct: number) {
    return pct >= 100 ? 'var(--rose)' : pct >= 80 ? 'var(--amber)' : 'var(--accent)'
  }

  const teamUtilTone: 'rose' | 'amber' | 'accent' =
    teamUtil >= 90 ? 'rose' : teamUtil >= 70 ? 'amber' : 'accent'

  return (
    <div className="px-7 py-6 relative">

      {/* Popups */}
      {cellPopup && !dragState && (
        <QuickAddPopup
          popup={cellPopup} weekDays={days}
          onClose={() => setCellPopup(null)}
          onSave={handleMultiSave}
          saving={savingMulti}
        />
      )}
      {detailPopup && !dragState && (
        <AllocDetailPopup
          alloc={detailPopup.alloc}
          anchorRect={detailPopup.anchorRect}
          clickedDay={detailPopup.clickedDay}
          onClose={() => setDetailPopup(null)}
          onDeleteDay={() => {
            const a = detailPopup.alloc
            const day = detailPopup.clickedDay
            if (a.startDate === a.endDate) {
              // Single day → confirm then delete entirely
              showConfirm('Remove this allocation?', () => deleteAlloc.mutate(a.id),
                { confirmLabel: 'Remove', subtext: 'This person will be unallocated from this task.' })
            } else {
              // Multi-day → remove just the clicked day (no confirmation needed, it's one day)
              removeDayFromAlloc.mutate({ alloc: a, day })
            }
          }}
          onDeleteAll={() => showConfirm(
            'Remove entire allocation?',
            () => deleteAlloc.mutate(detailPopup.alloc.id),
            { confirmLabel: 'Remove All', subtext: `This removes ${detailPopup.alloc.startDate} → ${detailPopup.alloc.endDate} entirely.` }
          )}
          onUpdateHours={(hrs) => updateAllocHours.mutateAsync({ id: detailPopup!.alloc.id, hours_per_day: hrs })}
          deleting={deleteAlloc.isPending || removeDayFromAlloc.isPending}
        />
      )}

      {/* Drag tooltip */}
      {dragState && (() => {
        const member = allTeam.find((m: any) => m.id === dragState.userId)
        const allocHpd = member?.allocations.find((a: any) => a.id === dragState.allocId)?.hoursPerDay || 8
        // Count weekdays in proposed range
        let proposedDays = 0
        let cur = new Date(dragState.origStartDate + 'T12:00:00')
        const end = new Date(dragState.newEndDate + 'T12:00:00')
        while (cur <= end) { const dow = cur.getDay(); if (dow !== 0 && dow !== 6) proposedDays++; cur = new Date(cur.getTime() + 86400000) }
        const projHrs = proposedDays * allocHpd
        const weekCap = member?.capacityHrs || 40
        const otherHrs = (member?.allocations || []).filter((a: any) => a.id !== dragState.allocId).reduce((s: number, a: any) => s + Number(a.hoursPerDay), 0)
        const totalProj = projHrs + otherHrs
        const isOver = totalProj > weekCap
        return (
          <div
            className={cn(
              'fixed top-3 left-1/2 -translate-x-1/2 z-toast bg-surface-raised border rounded-md px-4 py-2 text-base font-semibold shadow-md pointer-events-none',
              isOver ? 'border-status-rose text-status-rose' : 'border-accent text-accent',
            )}
          >
            ↔ Dragging to {format(new Date(dragState.newEndDate+'T12:00:00'), 'EEE MMM d')}
            {dragState.newEndDate !== dragState.origEndDate && (
              <span className="text-muted font-normal">
                {' '}({dragState.newEndDate > dragState.origEndDate ? '+' : ''}{
                  Math.round((new Date(dragState.newEndDate).getTime() - new Date(dragState.origEndDate).getTime()) / 86400000)
                }d)
              </span>
            )}
            <span className={cn('ml-2.5 text-xs font-normal', isOver ? 'text-status-rose' : 'text-muted')}>
              {projHrs}h / {weekCap}h cap{isOver ? ' — OVER' : ''}
            </span>
          </div>
        )
      })()}

      {/* Header */}
      <PageHeader
        title="Resourcing"
        actions={
          <div className="flex items-center gap-2.5">
            {/* View toggle: Department (grouped) vs Person (flat) */}
            <div className="flex border border-line-subtle rounded-md overflow-hidden">
              <button
                onClick={() => setGroupByDept(true)}
                className={cn('flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-colors border-none cursor-pointer', groupByDept ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-secondary')}
              >
                <Users size={13} /> Departments
              </button>
              <button
                onClick={() => setGroupByDept(false)}
                className={cn('flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-colors border-none border-l border-line-subtle cursor-pointer', !groupByDept ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-secondary')}
              >
                <User size={13} /> People
              </button>
            </div>
            <Select
              size="sm"
              aria-label="Filter by department"
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="w-auto min-w-[160px]"
            >
              <option value="all">All Departments</option>
              {depts.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </Select>
            <div className="flex border border-line-subtle rounded-md overflow-hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWeekRef(w => subWeeks(w,1))}
                className="rounded-none border-r border-line-subtle"
              >
                ← Prev
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWeekRef(startOfWeek(new Date(),{weekStartsOn:1}))}
                className="rounded-none border-r border-line-subtle"
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWeekRef(w => addWeeks(w,1))}
                className="rounded-none"
              >
                Next →
              </Button>
            </div>
            <span className="text-base text-secondary font-semibold">
              {format(weekRef,'MMM d')} – {format(addDays(weekRef,6),'MMM d, yyyy')}
            </span>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-2.5 mb-4">
        <StatCard label="Team Members"   value={String(team.length)} sub="active" />
        <StatCard label="Total Capacity" value={`${totalCapacity}h`} sub="this week" />
        <StatCard
          label="Allocated"
          value={`${totalAlloc.toFixed(0)}h`}
          sub={`${teamUtil}% utilization`}
          tone={teamUtilTone}
        />
        <StatCard
          label="Available"
          value={`${Math.max(0,totalCapacity-totalAlloc).toFixed(0)}h`}
          sub="remaining"
        />
      </div>

      {/* Grid */}
      <Card className="overflow-hidden p-0">

        {/* Column headers */}
        <div
          className="grid bg-surface border-b border-line-subtle"
          style={{ gridTemplateColumns: '190px repeat(7,minmax(0,1fr)) 100px' }}
        >
          <div className="px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">Person</div>
          {days.map((d, i) => {
            const isToday = isSameDay(d, new Date())
            const isWknd  = d.getDay()===0 || d.getDay()===6
            return (
              <div
                key={i}
                data-day-col={format(d,'yyyy-MM-dd')}
                className={cn(
                  'py-2 px-1 text-center border-l border-line-subtle',
                  isToday ? 'bg-accent-dim' : isWknd ? 'bg-surface-hover' : '',
                )}
              >
                <div className={cn(
                  'text-[15px] font-bold leading-tight',
                  isToday ? 'text-accent' : isWknd ? 'text-muted' : 'text-primary',
                )}>
                  {format(d,'d')}
                </div>
                <div className={cn(
                  'text-[9px] font-semibold uppercase tracking-wider',
                  isToday ? 'text-accent' : 'text-muted',
                )}>
                  {format(d,'EEE')}
                </div>
              </div>
            )
          })}
          <div className="px-2 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted text-center border-l border-line-subtle">
            Capacity
          </div>
        </div>

        {isLoading && (
          <div className="py-10 text-center text-base text-muted">
            <div className="inline-block w-[18px] h-[18px] rounded-full border-2 border-accent border-t-transparent animate-spin mb-2" />
            <div>Loading team...</div>
          </div>
        )}
        {!isLoading && team.length===0 && (
          <div className="py-10 text-center text-base text-muted">No team members found.</div>
        )}

        {/* ── Department grouped view ── */}
        {groupByDept && deptGroups.map((dg, dgi) => {
          const dCap   = dg.members.reduce((s: number, u: any) => s + u.capacityHrs, 0)
          const dAlloc = dg.members.reduce((s: number, u: any) => s + u.allocatedHrs, 0)
          const dUtil  = dCap > 0 ? Math.round((dAlloc / dCap) * 100) : 0
          const duc    = utilColor(dUtil)
          const isExp  = expandedDepts.has(dg.name)
          return (
            <div key={dg.name}>
              {/* Department summary row */}
              <div
                onClick={() => toggleDept(dg.name)}
                className={cn(
                  'grid cursor-pointer hover:bg-surface-hover transition-colors',
                  dgi < deptGroups.length - 1 && !isExp && 'border-b border-line-subtle',
                  isExp && 'border-b border-line-subtle bg-surface',
                )}
                style={{ gridTemplateColumns: '190px repeat(7,minmax(0,1fr)) 100px' }}
              >
                <div className="flex items-center gap-2.5 px-3.5 py-3">
                  {isExp ? <ChevronDown size={14} className="text-accent flex-shrink-0" /> : <ChevronRight size={14} className="text-muted flex-shrink-0" />}
                  <div className="min-w-0">
                    <div className={cn('text-base font-semibold truncate', isExp ? 'text-accent' : 'text-primary')}>{dg.name}</div>
                    <div className="text-[10px] text-muted">{dg.members.length} {dg.members.length === 1 ? 'member' : 'members'}</div>
                  </div>
                </div>
                {/* Empty day cells for summary row */}
                {days.map((d, di) => (
                  <div key={di} className="border-l border-line-subtle" />
                ))}
                {/* Department capacity summary */}
                <div className="flex flex-col justify-center gap-1 px-2.5 py-2 border-l border-line-subtle">
                  <div className="flex justify-between text-[10px] text-muted tabular-nums">
                    <span className="font-semibold" style={{ color: duc }}>{dAlloc}h</span>
                    <span>{dCap}h</span>
                  </div>
                  <div className="h-[5px] bg-surface-overlay rounded-sm overflow-hidden">
                    <div className="h-full rounded-sm transition-[width] duration-300" style={{ width: `${Math.min(dUtil, 100)}%`, background: duc }} />
                  </div>
                  <div className="text-[9px] font-bold text-right" style={{ color: duc }}>{dUtil}%</div>
                </div>
              </div>
              {/* Expanded member rows */}
              {isExp && dg.members.map((member: any, mi: number) => {
                const uc = utilColor(member.utilization)
                const dayAllocMap: Record<string, any[]> = {}
                for (let i = 0; i < 7; i++) dayAllocMap[format(days[i], 'yyyy-MM-dd')] = []
                for (const alloc of member.allocations) {
                  for (let i = 0; i < 7; i++) {
                    const dk = format(days[i], 'yyyy-MM-dd')
                    const isDragging = dragState?.allocId === alloc.id
                    const effectiveEnd = isDragging ? dragState!.newEndDate : alloc.endDate
                    if (dk >= alloc.startDate && dk <= effectiveEnd) {
                      dayAllocMap[dk].push({ ...alloc, isDragging, effectiveEnd })
                    }
                  }
                }
                return (
                  <div key={member.id} data-member-row={member.id} className={cn(mi < dg.members.length - 1 && 'border-b border-line-subtle', mi === dg.members.length - 1 && dgi < deptGroups.length - 1 && 'border-b border-line-subtle')}>
                    <div className="grid min-h-[52px]" style={{ gridTemplateColumns: '190px repeat(7,minmax(0,1fr)) 100px' }}>
                      <div className="flex items-center gap-2.5 px-3.5 py-2.5 pl-8">
                        <div className="w-7 h-7 rounded-full flex-shrink-0 bg-surface-overlay border border-line-muted flex items-center justify-center text-[9px] font-bold text-secondary">
                          {member.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-base font-medium text-primary truncate">{member.name}</div>
                          <div className="text-[10px] text-muted truncate">{member.jobTitle || '—'}</div>
                        </div>
                      </div>
                      {days.map((d, di) => {
                        const dk = format(d, 'yyyy-MM-dd')
                        const isToday = isSameDay(d, new Date())
                        const isWknd = d.getDay() === 0 || d.getDay() === 6
                        const isHol = isHolidayFor(member.id, dk)
                        const allocs = dayAllocMap[dk] || []
                        const totalH = allocs.reduce((s: number, a: any) => s + Number(a.hoursPerDay), 0)
                        const isOver = totalH > (member.capacityHrs / 5) * 1.15
                        const canInteract = isAdmin() && !isWknd && !isHol && !dragState
                        return (
                          <div
                            key={di}
                            data-day-col={dk}
                            onClick={(e) => { if (!dragState && !isHol) handleCellClick(e, member, d) }}
                            title={isHol ? 'Public holiday' : undefined}
                            className={cn(
                              'relative flex flex-col gap-0.5 p-[3px] border-l border-line-subtle min-h-[52px] max-h-[90px] transition-colors duration-100',
                              allocs.length > 2 && 'overflow-y-auto',
                              isHol ? 'bg-status-amber-dim' : isToday ? 'bg-accent-dim/50' : isWknd ? 'bg-surface-hover/40' : '',
                              canInteract ? 'cursor-pointer hover:bg-accent-dim' : 'cursor-default',
                            )}
                          >
                            {isHol && <div className="text-center pointer-events-none py-px"><span className="text-[7px] font-bold uppercase tracking-wider text-status-amber opacity-80">Holiday</span></div>}
                            {isAdmin() && allocs.length === 0 && !isWknd && !isHol && !dragState && (
                              <div className="cell-plus absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 text-xl text-accent pointer-events-none">+</div>
                            )}
                            {allocs.map((alloc: any) => {
                              const isDraggingThis = dragState?.allocId === alloc.id
                              const isPreview = isDraggingThis && dk > alloc.origEndDate
                              const effectiveEnd = isDraggingThis ? dragState!.newEndDate : alloc.endDate
                              const isLastDay = dk === effectiveEnd || (effectiveEnd > weekEnd && di === 6)
                              const showHandle = isAdmin() && isLastDay && !isWknd
                              return (
                                <div
                                  key={alloc.id}
                                  onClick={(e) => { e.stopPropagation(); if (!dragState) handleAllocClick(e, alloc, dk) }}
                                  className={cn(
                                    'group relative flex items-center justify-between rounded-sm px-1 py-0.5 pl-[5px] text-[10px] font-semibold overflow-hidden whitespace-nowrap text-ellipsis leading-[1.4]',
                                    dragState ? 'cursor-ew-resize' : isAdmin() ? 'cursor-pointer' : 'cursor-default',
                                    isDraggingThis && 'opacity-90',
                                  )}
                                  style={{
                                    background: isPreview ? `${alloc.projectColor || '#6D4AAE'}18` : alloc.projectColor ? `${alloc.projectColor}22` : 'var(--accent-dim)',
                                    border: isPreview ? `1px dashed ${alloc.projectColor || 'var(--accent)'}88` : `1px solid ${alloc.projectColor ? `${alloc.projectColor}55` : 'var(--border-accent)'}`,
                                    borderLeft: `3px solid ${alloc.projectColor || 'var(--accent)'}`,
                                    color: isPreview ? `${alloc.projectColor || '#6D4AAE'}99` : (alloc.projectColor || 'var(--accent)'),
                                  }}
                                >
                                  <span className="flex-1 min-w-0 truncate">{alloc.hoursPerDay}h · {alloc.taskTitle?.length > 10 ? alloc.taskTitle.slice(0, 10) + '…' : alloc.taskTitle}</span>
                                  {showHandle && (
                                    <div
                                      title="Drag to extend"
                                      onMouseDown={(e) => startDrag(e, alloc)}
                                      className="drag-handle flex-shrink-0 w-[6px] self-stretch flex items-center justify-center ml-auto rounded-r-sm opacity-0 group-hover:opacity-100 transition-opacity cursor-ew-resize"
                                      style={{ background: `${alloc.projectColor || 'var(--accent)'}55` }}
                                    >
                                      <div className="w-[2px] h-3 rounded-full" style={{ background: alloc.projectColor || 'var(--accent)' }} />
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                            {isOver && allocs.length > 0 && !isHol && <div className="text-[9px] font-bold text-status-rose text-center">OVER</div>}
                          </div>
                        )
                      })}
                      <div className="flex flex-col justify-center gap-1 px-2.5 py-2 border-l border-line-subtle">
                        <div className="flex justify-between text-[10px] text-muted tabular-nums">
                          <span className="font-semibold" style={{ color: uc }}>{member.allocatedHrs}h</span>
                          <span>{member.capacityHrs}h</span>
                        </div>
                        <div className="h-[5px] bg-surface-overlay rounded-sm overflow-hidden">
                          <div className="h-full rounded-sm transition-[width] duration-300" style={{ width: `${Math.min(member.utilization, 100)}%`, background: uc }} />
                        </div>
                        <div className="text-[9px] font-bold text-right" style={{ color: uc }}>{member.utilization}%</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* ── Flat person view (original) ── */}
        {!groupByDept && team.map((member: any, mi: number) => {
          const uc = utilColor(member.utilization)

          // Build per-day allocation map
          const dayAllocMap: Record<string, any[]> = {}
          for (let i=0; i<7; i++) dayAllocMap[format(days[i],'yyyy-MM-dd')] = []
          for (const alloc of member.allocations) {
            for (let i=0; i<7; i++) {
              const dk        = format(days[i],'yyyy-MM-dd')
              const isDragging = dragState?.allocId === alloc.id
              const effectiveEnd = isDragging ? dragState!.newEndDate : alloc.endDate
              if (dk >= alloc.startDate && dk <= effectiveEnd) {
                dayAllocMap[dk].push({ ...alloc, isDragging, effectiveEnd })
              }
            }
          }

          return (
            <div
              key={member.id}
              data-member-row={member.id}
              className={cn(mi < team.length-1 && 'border-b border-line-subtle')}
            >
              <div
                className="grid min-h-[52px]"
                style={{ gridTemplateColumns: '190px repeat(7,minmax(0,1fr)) 100px' }}
              >

                {/* Person */}
                <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                  <div className="w-7 h-7 rounded-full flex-shrink-0 bg-surface-overlay border border-line-muted flex items-center justify-center text-[9px] font-bold text-secondary">
                    {member.name?.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-medium text-primary truncate">{member.name}</div>
                    <div className="text-[10px] text-muted truncate">{member.department||member.jobTitle||'—'}</div>
                  </div>
                </div>

                {/* Day cells */}
                {days.map((d, di) => {
                  const dk      = format(d,'yyyy-MM-dd')
                  const isToday = isSameDay(d, new Date())
                  const isWknd  = d.getDay()===0 || d.getDay()===6
                  const isHol   = isHolidayFor(member.id, dk)
                  const allocs  = dayAllocMap[dk] || []
                  const totalH  = allocs.reduce((s:number,a:any)=>s+Number(a.hoursPerDay),0)
                  const isOver  = totalH > (member.capacityHrs/5)*1.15
                  const canInteract = isAdmin() && !isWknd && !isHol && !dragState

                  return (
                    <div
                      key={di}
                      data-day-col={dk}
                      onClick={(e) => { if (!dragState && !isHol) handleCellClick(e, member, d) }}
                      title={isHol ? 'Public holiday' : undefined}
                      className={cn(
                        'relative flex flex-col gap-0.5 p-[3px] border-l border-line-subtle min-h-[52px] max-h-[90px] transition-colors duration-100',
                        allocs.length > 2 && 'overflow-y-auto',
                        isHol ? 'bg-status-amber-dim' : isToday ? 'bg-accent-dim/50' : isWknd ? 'bg-surface-hover/40' : '',
                        canInteract ? 'cursor-pointer hover:bg-accent-dim' : 'cursor-default',
                      )}
                    >
                      {/* Holiday label — small inline tag, not a full-cell overlay.
                          The amber bg on the cell already signals "holiday"; this label
                          just names it. Keeping it inline avoids overlapping with any
                          allocation pills or the OVER indicator below them. */}
                      {isHol && (
                        <div className="text-center pointer-events-none py-px">
                          <span className="text-[7px] font-bold uppercase tracking-wider text-status-amber opacity-80">Holiday</span>
                        </div>
                      )}
                      {/* "+" hint on empty weekday cells */}
                      {isAdmin() && allocs.length===0 && !isWknd && !isHol && !dragState && (
                        <div className="cell-plus absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 text-xl text-accent pointer-events-none">+</div>
                      )}

                      {/* Allocation pills */}
                      {allocs.map((alloc: any) => {
                        const isDraggingThis = dragState?.allocId === alloc.id
                        const isPreview      = isDraggingThis && dk > alloc.origEndDate   // extended preview region
                        // Show drag handle only on the LAST visible day of this allocation
                        const effectiveEnd   = isDraggingThis ? dragState!.newEndDate : alloc.endDate
                        const isLastDay      = dk === effectiveEnd || (effectiveEnd > weekEnd && di === 6)
                        const showHandle     = isAdmin() && isLastDay && !isWknd

                        return (
                          <div
                            key={alloc.id}
                            onClick={(e) => { e.stopPropagation(); if (!dragState) handleAllocClick(e, alloc, dk) }}
                            className={cn(
                              'group relative flex items-center justify-between rounded-sm px-1 py-0.5 pl-[5px] text-[10px] font-semibold overflow-hidden whitespace-nowrap text-ellipsis leading-[1.4]',
                              dragState ? 'cursor-ew-resize' : isAdmin() ? 'cursor-pointer' : 'cursor-default',
                              isDraggingThis && 'opacity-90',
                            )}
                            style={{
                              background: isPreview
                                ? `${alloc.projectColor||'#6D4AAE'}18`
                                : alloc.projectColor ? `${alloc.projectColor}22` : 'var(--accent-dim)',
                              border: isPreview
                                ? `1px dashed ${alloc.projectColor||'var(--accent)'}88`
                                : `1px solid ${alloc.projectColor ? `${alloc.projectColor}55` : 'var(--border-accent)'}`,
                              borderLeft: `3px solid ${alloc.projectColor||'var(--accent)'}`,
                              color: isPreview ? `${alloc.projectColor||'#6D4AAE'}99` : (alloc.projectColor||'var(--accent)'),
                            }}
                          >
                            <span className="flex-1 min-w-0 truncate">
                              {alloc.hoursPerDay}h · {alloc.taskTitle?.length>10 ? alloc.taskTitle.slice(0,10)+'…' : alloc.taskTitle}
                            </span>

                            {/* ── Drag handle — shown on last visible day of allocation ── */}
                            {showHandle && (
                              <div
                                title="Drag to extend"
                                onMouseDown={(e) => startDrag(e, alloc)}
                                className="drag-handle flex-shrink-0 w-[6px] self-stretch flex items-center justify-center ml-auto rounded-r-sm opacity-0 group-hover:opacity-100 transition-opacity cursor-ew-resize"
                                style={{ background: `${alloc.projectColor || 'var(--accent)'}55` }}
                              >
                                <div className="w-[2px] h-3 rounded-full" style={{ background: alloc.projectColor || 'var(--accent)' }} />
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* Over-capacity — skip on holidays (it's expected/resolved) */}
                      {isOver && allocs.length>0 && !isHol && (
                        <div className="text-[9px] font-bold text-status-rose text-center">OVER</div>
                      )}
                    </div>
                  )
                })}

                {/* Capacity column */}
                <div className="flex flex-col justify-center gap-1 px-2.5 py-2 border-l border-line-subtle">
                  <div className="flex justify-between text-[10px] text-muted tabular-nums">
                    <span className="font-semibold" style={{ color: uc }}>{member.allocatedHrs}h</span>
                    <span>{member.capacityHrs}h</span>
                  </div>
                  <div className="h-[5px] bg-surface-overlay rounded-sm overflow-hidden">
                    <div
                      className="h-full rounded-sm transition-[width] duration-300"
                      style={{ width: `${Math.min(member.utilization,100)}%`, background: uc }}
                    />
                  </div>
                  <div className="text-[9px] font-bold text-right" style={{ color: uc }}>
                    {member.utilization}%
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </Card>

      {/* Hints */}
      {isAdmin() && (
        <div className="flex items-center gap-1.5 mt-2.5 text-xs text-muted">
          <span className="text-accent">*</span>
          Click any empty cell to allocate
          <span className="opacity-40">·</span>
          Click a pill to see details or remove
          <span className="opacity-40">·</span>
          <span className="text-accent">⋮</span> Drag the right edge of a pill to extend it
        </div>
      )}

      <style>{`
        div:hover > .cell-plus { opacity: 0.4 !important; }
        div:hover > div:hover > .cell-plus { opacity: 0.7 !important; }
      `}</style>
    </div>
  )
}
