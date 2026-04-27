'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi, phasesApi, tasksApi, usersApi, timeApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { api } from '@/lib/api'
import { showConfirm } from '@/components/ConfirmDialog'
import { showToast } from '@/components/Toast'
import {
  PageHeader, Breadcrumbs, Card, Avatar, Badge, Input, Textarea, Label, Button, EmptyState, Select, Dropdown,
  DatePicker, Skeleton, SkeletonRow,
  type BadgeProps,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { todayLocalISO } from '@/lib/utils'

const TASK_GRID_COLS = '14px minmax(0,1fr) 170px 110px 72px 72px 72px 90px 110px'

// Inline time log widget per task
function InlineTimeLog({ taskId, projectId, onClose }: { taskId: string; projectId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [hours, setHours] = useState('')
  const [date, setDate] = useState(todayLocalISO())
  const [note, setNote] = useState('')
  const logMutation = useMutation({
    mutationFn: () => timeApi.log({ task_id: taskId, date, hours: Number(hours), billable: true, type: 'project', note: note || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['timesheet'] }); onClose() },
    onError: (e: any) => showToast.error('Log failed: ' + e.message),
  })
  const canSave = !!hours && Number(hours) > 0 && Number(hours) <= 24
  return (
    <div className="border-t border-line-subtle bg-surface px-3.5 py-2.5 flex gap-2 items-center flex-wrap">
      <span className="text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap">Log Time</span>
      <Input
        type="number"
        value={hours}
        onChange={e => setHours(e.target.value)}
        placeholder="Hours"
        min="0.25"
        max="24"
        step="0.25"
        className="w-[70px] py-1.5"
        autoFocus
      />
      <div className="w-[150px]">
        <DatePicker
          value={date || null}
          onChange={v => setDate(v || todayLocalISO())}
          size="sm"
        />
      </div>
      <Input
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="flex-1 min-w-[120px] py-1.5"
        onKeyDown={e => { if (e.key === 'Enter' && canSave) logMutation.mutate() }}
      />
      <Button
        variant="primary"
        size="sm"
        onClick={() => logMutation.mutate()}
        disabled={!canSave || logMutation.isPending}
      >
        {logMutation.isPending ? '...' : 'Log'}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close"
      >
        x
      </Button>
    </div>
  )
}

// Task comments thread
function TaskComments({ taskId, projectId, myId, myName }: { taskId: string; projectId: string; myId: string; myName: string }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const prevCountRef = useRef(0)
  const justPostedRef = useRef(false)

  const { data: commentsData, isLoading } = useQuery({
    queryKey: ['comments', taskId],
    queryFn: () => tasksApi.getComments(projectId, taskId).then((r: any) => r.data),
    staleTime: 30000,
    refetchInterval: 60000,
  })
  const comments: any[] = commentsData || []

  const addComment = useMutation({
    mutationFn: () => tasksApi.addComment(projectId, taskId, draft.trim()),
    onSuccess: () => {
      justPostedRef.current = true
      qc.invalidateQueries({ queryKey: ['comments', taskId] })
      setDraft('')
    },
    onError: (e: any) => showToast.error('Comment failed: ' + e.message),
  })
  const deleteComment = useMutation({
    mutationFn: (commentId: string) => tasksApi.deleteComment(projectId, taskId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comments', taskId] }),
  })

  // Scroll-to-bottom heuristic:
  // - On initial load → scroll (user lands on most recent)
  // - When the user just posted → scroll
  // - On background refetch → only scroll if user was already near the bottom
  // - User scrolled up to read history → DON'T yank them down
  useEffect(() => {
    const count = comments.length
    const prev = prevCountRef.current
    prevCountRef.current = count
    if (count === prev) return
    if (!bottomRef.current) return

    const container = scrollContainerRef.current
    const wasAtBottom = container
      ? container.scrollHeight - container.scrollTop - container.clientHeight < 60
      : true

    const shouldScroll = prev === 0 || justPostedRef.current || wasAtBottom
    justPostedRef.current = false
    if (shouldScroll) {
      bottomRef.current.scrollIntoView({ behavior: prev === 0 ? 'auto' : 'smooth', block: 'end' })
    }
  }, [comments.length])

  return (
    <div className="border-t border-line-subtle bg-surface">
      <div className="px-3.5 pt-2.5 pb-1.5 text-xs font-bold uppercase tracking-wider text-muted">
        Comments {comments.length > 0 ? '(' + comments.length + ')' : ''}
      </div>
      <div ref={scrollContainerRef} className="max-h-[240px] overflow-y-auto px-3.5">
        {isLoading && <div className="text-sm text-muted py-2">Loading...</div>}
        {!isLoading && comments.length === 0 && <div className="text-sm text-muted italic pt-1 pb-2">No comments yet.</div>}
        {comments.map((c: any) => {
          const isMe = c.user_id === myId
          const ts = new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          return (
            <div key={c.id} className="flex gap-2 mb-2.5 items-start">
              <Avatar name={c.users?.name || '??'} size="sm" className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className="text-sm font-semibold text-primary">{c.users?.name || 'Unknown'}</span>
                  <span className="text-[10px] text-muted">{ts}</span>
                  {isMe && (
                    <button
                      onClick={() => deleteComment.mutate(c.id)}
                      className="ml-auto bg-transparent border-none text-[10px] text-muted cursor-pointer p-0 hover:text-status-rose"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className={cn(
                  'text-base text-primary leading-normal break-words px-2.5 py-1.5 rounded border',
                  isMe ? 'bg-accent-dim/40 border-line-accent' : 'bg-surface-raised border-line-subtle',
                )}>
                  {c.body}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <div className="px-3.5 pt-2 pb-3 flex gap-2 items-end">
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add a comment..."
          rows={2}
          className="flex-1 min-h-0 resize-none py-1.5"
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.trim()) addComment.mutate() }}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => addComment.mutate()}
          disabled={!draft.trim() || addComment.isPending}
          className="flex-shrink-0"
        >
          {addComment.isPending ? '...' : 'Send'}
        </Button>
      </div>
      <div className="px-3.5 pb-2 text-[10px] text-muted">Ctrl+Enter to send</div>
    </div>
  )
}

function AssigneePicker({ taskId, projectId, currentAssignees, anchorPos, onClose }: {
  taskId: string; projectId: string; currentAssignees: any[]
  anchorPos: { top: number; left: number }; onClose: () => void
}) {
  const qc = useQueryClient()
  const ref = useRef<HTMLDivElement | null>(null)
  const [search, setSearch] = useState('')
  const { data: usersData, isLoading: loadingUsers } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list().then((r: any) => r.data), staleTime: 60000 })
  const allUsers: any[] = usersData || []
  useEffect(() => {
    function handleClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    function handleScroll(e: Event) {
      // Don't close if scrolling inside the picker itself (e.g. the member list)
      if (ref.current && ref.current.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('scroll', handleScroll, true)
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('scroll', handleScroll, true) }
  }, [onClose])
  const addMutation = useMutation({ mutationFn: (uid: string) => tasksApi.addAssignees(projectId, taskId, [uid]), onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }) })
  const removeMutation = useMutation({ mutationFn: (uid: string) => tasksApi.removeAssignee(projectId, taskId, uid), onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }) })
  const assignedIds = new Set(currentAssignees.map((a: any) => a.user_id))
  const filtered = allUsers.filter((u: any) => !search || u.name.toLowerCase().includes(search.toLowerCase()) || (u.job_title||'').toLowerCase().includes(search.toLowerCase()))
  const pending = addMutation.isPending || removeMutation.isPending
  const pickerW = 252
  const left = anchorPos.left + pickerW > window.innerWidth - 12 ? anchorPos.left - pickerW + 28 : anchorPos.left
  return (
    <div
      ref={ref}
      className="fixed z-popover bg-surface-raised border border-line-muted rounded-md shadow-md overflow-hidden"
      style={{ top: anchorPos.top + 6, left, width: pickerW }}
    >
      <div className="px-2.5 py-2 border-b border-line-subtle">
        <Input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search team members..."
          className="py-1.5 text-sm"
        />
      </div>
      <div className="max-h-[230px] overflow-y-auto">
        {loadingUsers && <div className="p-3.5 text-sm text-muted text-center">Loading...</div>}
        {!loadingUsers && filtered.length === 0 && (
          <div className="p-3.5 text-sm text-muted text-center">
            {allUsers.length === 0 ? 'No members' : 'No matches'}
          </div>
        )}
        {!loadingUsers && filtered.map((u: any) => {
          const assigned = assignedIds.has(u.id)
          return (
            <div
              key={u.id}
              onClick={() => !pending && (assigned ? removeMutation.mutate(u.id) : addMutation.mutate(u.id))}
              className={cn(
                'px-3 py-2 flex items-center gap-2.5 transition-colors',
                pending ? 'cursor-wait' : 'cursor-pointer',
                assigned ? 'bg-accent-dim' : 'hover:bg-surface-hover',
              )}
            >
              <Avatar name={u.name || '?'} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="text-base font-medium text-primary truncate">{u.name}</div>
                {u.job_title && <div className="text-[10px] text-muted">{u.job_title}</div>}
              </div>
              {assigned
                ? <span className="text-xs text-accent font-bold">v</span>
                : <span className="text-lg text-muted leading-none">+</span>}
            </div>
          )
        })}
      </div>
      <div className="px-3 py-1.5 border-t border-line-subtle text-[10px] text-muted flex justify-between">
        <span>Click to add / remove</span>
        <span className="text-accent font-semibold">{assignedIds.size} assigned</span>
      </div>
    </div>
  )
}

function AssignMeButton({ taskId, projectId, assignees, myId }: {
  taskId: string; projectId: string; assignees: any[]; myId: string
}) {
  const qc = useQueryClient()
  const isAssigned = assignees.some((a: any) => a.user_id === myId)
  const addMe = useMutation({ mutationFn: () => tasksApi.addAssignees(projectId, taskId, [myId]), onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }) })
  const removeMe = useMutation({ mutationFn: () => tasksApi.removeAssignee(projectId, taskId, myId), onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }) })
  const pending = addMe.isPending || removeMe.isPending
  return isAssigned ? (
    <button
      onClick={e => { e.stopPropagation(); removeMe.mutate() }}
      disabled={pending}
      className="text-xs font-semibold text-accent bg-accent-dim border border-line-accent rounded-sm px-2 py-px cursor-pointer hover:text-status-rose hover:border-status-rose/30 disabled:opacity-50"
    >
      Me
    </button>
  ) : (
    <button
      onClick={e => { e.stopPropagation(); addMe.mutate() }}
      disabled={pending}
      className="text-xs font-medium text-secondary bg-surface-overlay border border-dashed border-line-muted rounded-sm px-2 py-px cursor-pointer hover:text-accent hover:border-accent disabled:opacity-50"
    >
      + Assign me
    </button>
  )
}

function StatusSelect({ taskId, projectId, currentStatus, isEditable = true }: {
  taskId: string; projectId: string; currentStatus: string; isEditable?: boolean
}) {
  const qc = useQueryClient()
  const updateTask = useMutation({
    mutationFn: (status: string) => tasksApi.update(projectId, taskId, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (e: any) => {
      // Surface API errors — previously the mutation had no onError handler,
      // so when the backend returned 500 (Apr 23: taskSchema.omit not a
      // function), the UI silently snapped back to the old status on refetch
      // and the user thought their click did nothing.
      const msg = e?.response?.data?.errors?.[0]?.message
        || e?.response?.data?.message
        || e?.message
        || 'Could not update task status'
      showToast.error(msg)
    },
  })
  const cfg: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
    todo:        { label: 'To Do',       variant: 'default' },
    in_progress: { label: 'In Progress', variant: 'warning' },
    done:        { label: 'Done',        variant: 'info'    },
  }
  const cur = cfg[currentStatus] || cfg.todo
  if (!isEditable) {
    return (
      <Badge variant={cur.variant} className="opacity-60 cursor-default whitespace-nowrap">
        {cur.label}
      </Badge>
    )
  }
  return (
    <Dropdown
      aria-label="Task status"
      value={currentStatus}
      onChange={(v) => updateTask.mutate(v as string)}
      options={[
        { value: 'todo',        label: 'To Do' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'done',        label: 'Done' },
      ]}
      // Custom trigger: a real Badge, matching variant. The Dropdown gives us
      // a proper menu with keyboard nav + a11y while the trigger stays a pill.
      trigger={({ selected }) => {
        const c = cfg[(selected?.value as string) ?? currentStatus] || cur
        return <Badge variant={c.variant} className="whitespace-nowrap">{c.label}</Badge>
      }}
    />
  )
}

function MembersTab({ projectId, members, isAdminUser }: { projectId: string; members: any[]; isAdminUser: boolean }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [addMode, setAddMode] = useState('none' as any)
  const { data: usersRaw } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list().then((r: any) => r.data), staleTime: 60000 })
  const { data: deptsRaw } = useQuery({ queryKey: ['departments'], queryFn: () => usersApi.departments().then((r: any) => r.data), staleTime: 60000, enabled: isAdminUser })
  const allUsers: any[] = usersRaw || []
  const depts: any[] = deptsRaw || []
  const memberIds = new Set(members.map((m: any) => m.user_id))
  const addMutation = useMutation({ mutationFn: (userIds: string[]) => projectsApi.addMembers(projectId, userIds), onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', projectId] }); setSearch(''); setAddMode('none') } })
  const addDeptMutation = useMutation({ mutationFn: (deptId: string) => projectsApi.addDepartment(projectId, deptId), onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', projectId] }); setAddMode('none') } })
  const removeMutation = useMutation({ mutationFn: (userId: string) => projectsApi.removeMember(projectId, userId), onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }) })
  const filteredUsers = allUsers.filter(u => !memberIds.has(u.id) && (!search || u.name.toLowerCase().includes(search.toLowerCase()) || (u.job_title||'').toLowerCase().includes(search.toLowerCase())))
  const byDept: any = {}
  for (const m of members) { const d = m.users?.departments?.name || 'No Department'; if (!byDept[d]) byDept[d] = []; byDept[d].push(m) }
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <div className="text-xl font-semibold text-primary mb-0.5">
            Project Team <span className="text-base font-normal text-muted">({members.length} people)</span>
          </div>
          <div className="text-sm text-muted">Track who is actively working on this project.</div>
        </div>
        {isAdminUser && addMode === 'none' && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setAddMode('department')}>+ Add Department</Button>
            <Button variant="primary" onClick={() => setAddMode('individual')}>+ Add People</Button>
          </div>
        )}
        {isAdminUser && addMode !== 'none' && (
          <Button variant="secondary" onClick={() => { setAddMode('none'); setSearch('') }}>Cancel</Button>
        )}
      </div>

      {isAdminUser && addMode === 'department' && (
        <Card className="p-4 mb-4">
          <div className="text-base font-semibold text-primary mb-3">Add by Department</div>
          <div className="flex flex-wrap gap-2">
            {depts.map((d: any) => (
              <button
                key={d.id}
                onClick={() => addDeptMutation.mutate(d.id)}
                disabled={addDeptMutation.isPending}
                className="bg-surface border border-line-muted rounded-md px-3.5 py-2 text-base text-primary cursor-pointer flex items-center gap-2 hover:bg-surface-hover disabled:opacity-50"
              >
                Dept: <span className="font-medium">{d.name}</span>
                <span className="text-xs text-muted bg-surface-overlay px-1.5 py-px rounded-full">{d.user_count || 0}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {isAdminUser && addMode === 'individual' && (
        <Card className="p-4 mb-4">
          <div className="text-base font-semibold text-primary mb-2.5">Add Team Members</div>
          <Input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or role..."
            className="mb-2"
          />
          <div className="max-h-[240px] overflow-y-auto flex flex-col gap-px">
            {filteredUsers.slice(0, 20).map((u: any) => (
              <div
                key={u.id}
                onClick={() => addMutation.mutate([u.id])}
                className="px-3 py-2 rounded-md cursor-pointer flex items-center gap-2.5 hover:bg-surface-hover"
              >
                <Avatar name={u.name || '?'} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="text-base font-medium text-primary">{u.name}</div>
                  <div className="text-xs text-muted">{u.job_title || ''}{u.departments?.name ? ' - ' + u.departments.name : ''}</div>
                </div>
                <span className="text-sm text-accent font-semibold">Add</span>
              </div>
            ))}
            {filteredUsers.length === 0 && (
              <div className="p-4 text-sm text-muted text-center">
                {allUsers.filter(u => !memberIds.has(u.id)).length === 0 ? 'Everyone is already on this project.' : 'No matches for "' + search + '"'}
              </div>
            )}
          </div>
        </Card>
      )}

      {members.length === 0 && addMode === 'none' && (
        <div className="bg-surface-raised border border-dashed border-line-muted rounded-md">
          <EmptyState
            title="No project members yet"
            description="Add people or departments to track who is on this project."
            action={isAdminUser ? (
              <div className="flex gap-2 justify-center">
                <Button variant="secondary" onClick={() => setAddMode('department')}>+ Add Department</Button>
                <Button variant="primary" onClick={() => setAddMode('individual')}>+ Add People</Button>
              </div>
            ) : undefined}
          />
        </div>
      )}

      {members.length > 0 && (
        <Card className="overflow-hidden p-0">
          {Object.entries(byDept).map(([deptName, deptMembers]: any, di: number) => (
            <div key={deptName}>
              <div className="px-4 py-1.5 bg-surface border-b border-line-subtle flex justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">{deptName}</span>
                <span className="text-xs text-muted">{deptMembers.length} people</span>
              </div>
              {deptMembers.map((m: any, mi: number) => {
                const isLast = mi === deptMembers.length - 1 && di === Object.keys(byDept).length - 1
                const role = m.users?.permission_profile === 'super_admin'
                  ? 'Super Admin'
                  : m.users?.permission_profile === 'admin' ? 'Admin' : 'Collaborator'
                return (
                  <div
                    key={m.user_id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 bg-surface-raised',
                      !isLast && 'border-b border-line-subtle',
                    )}
                  >
                    <Avatar name={m.users?.name || '??'} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-medium text-primary">{m.users?.name || 'Unknown'}</div>
                      <div className="text-xs text-muted">
                        {m.users?.job_title || '-'}
                        <span className="text-[10px] ml-1.5 bg-surface-overlay px-1.5 py-px rounded-sm text-muted">
                          {role}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-muted">
                      Added {m.added_at ? new Date(m.added_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '-'}
                    </div>
                    {isAdminUser && (
                      <Button variant="ghost" size="sm" onClick={() => removeMutation.mutate(m.user_id)}>
                        Remove
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

export default function ProjectDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const qc = useQueryClient()
  const { isAdmin, canViewFinancials, user: authUser } = useAuthStore()
  const isCollaborator = authUser?.permissionProfile === 'collaborator'
  const myId = authUser?.id || ''

  type PickerState = { taskId: string; top: number; left: number } | null

  const [tab, setTab] = useState('scoping')
  const [showAddPhase, setShowAddPhase] = useState(false)
  const [showAddTask, setShowAddTask] = useState<string | null>(null)
  const [phaseForm, setPhaseForm] = useState({ name: '' })
  const [taskForm, setTaskForm] = useState({ title: '', estimatedHrs: '', billable: true, dueDate: '' })
  const [settings, setSettings] = useState<Record<string, any> | null>(null)
  const [saved, setSaved] = useState(false)
  const [pickerState, setPickerState] = useState<PickerState>(null)
  const [openComments, setOpenComments] = useState<string | null>(null)
  const [openTimeLog, setOpenTimeLog] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const draggedTask = useRef<{ taskId: string; phaseId: string; index: number } | null>(null)

  const openPicker = useCallback((taskId: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPickerState(ps => ps?.taskId === taskId ? null : { taskId, top: rect.bottom, left: rect.left })
  }, [])

  const { data: project, isLoading } = useQuery({ queryKey: ['project', id], queryFn: () => projectsApi.get(id).then((r: any) => r.data) })
  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list().then((r: any) => r.data), staleTime: 60000 })
  const { data: clientsData } = useQuery({ queryKey: ['clients'], queryFn: () => usersApi.clients().then((r: any) => r.data), enabled: isAdmin(), staleTime: 60000 })
  const { data: rateCards } = useQuery({ queryKey: ['rate-cards'], queryFn: () => api.get('/users/rate-cards').then((r: any) => r.data), staleTime: 60000 })

  useEffect(() => {
    if (project && !settings) {
      // retainer_mode is UI-only — derived from which of {budget_amount, budget_hrs}
      // is populated. When the user flips between modes in the form, we blank the
      // other one on save. See the updateProject mutation below.
      const retainerMode: 'amount' | 'hours' =
        project.budget_type === 'retainer' && project.budget_hrs != null && !project.budget_amount
          ? 'hours' : 'amount'
      setSettings({
        name: project.name || '', status: project.status || 'running', color: project.color || '#0D9488',
        budget_type: project.budget_type || 'fixed_price',
        retainer_mode: retainerMode,
        budget_amount: project.budget_amount || '',
        budget_hrs:    project.budget_hrs    || '',
        currency: project.currency || 'AED', client_id: project.client_id || '', rate_card_id: project.rate_card_id || '',
        start_date: project.start_date || '', end_date: project.end_date || '',
      })
    }
  }, [project])

  const clients = clientsData || []

  const createPhase = useMutation({ mutationFn: () => phasesApi.create(id, { name: phaseForm.name }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', id] }); setShowAddPhase(false); setPhaseForm({ name: '' }) } })
  const createTask = useMutation({
    mutationFn: (phaseId: string) => tasksApi.create(id, { phase_id: phaseId, title: taskForm.title, estimated_hrs: taskForm.estimatedHrs ? Number(taskForm.estimatedHrs) : undefined, billable: taskForm.billable, due_date: taskForm.dueDate || undefined, assignee_ids: [] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', id] }); setShowAddTask(null); setTaskForm({ title: '', estimatedHrs: '', billable: true, dueDate: '' }) },
  })
  const updateProject = useMutation({ mutationFn: (data: any) => projectsApi.update(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', id] }); qc.invalidateQueries({ queryKey: ['projects-all'] }); setSaved(true); setTimeout(() => setSaved(false), 2200) } })
  const deletePhase = useMutation({ mutationFn: (phaseId: string) => phasesApi.delete(id, phaseId), onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id] }) })
  const deleteTask = useMutation({ mutationFn: (taskId: string) => tasksApi.delete(id, taskId), onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id] }) })

  const handleDrop = async (phaseId: string, phaseTasks: any[], toIndex: number) => {
    if (!draggedTask.current || draggedTask.current.phaseId !== phaseId) return
    const fromIndex = draggedTask.current.index
    if (fromIndex === toIndex) return
    const reordered = [...phaseTasks]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    const items = reordered.map((t: any, i: number) => ({ id: t.id, sort_order: i }))
    setDragOver(null)
    draggedTask.current = null
    await tasksApi.reorderTasks(id, phaseId, items)
    qc.invalidateQueries({ queryKey: ['project', id] })
  }

  if (isLoading) return (
    <div className="p-7 space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="h-20 rounded-lg" />))}
      </div>
      <Card className="p-4">
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (<SkeletonRow key={i} />))}
        </div>
      </Card>
    </div>
  )
  if (!project) return (<div className="p-8 text-base text-muted">Project not found.</div>)

  const projectMembers: any[] = project.project_members || []
  const canAddPhase = isAdmin()
  const pickerTask = pickerState ? (project.phases || []).flatMap((ph: any) => ph.tasks || []).find((t: any) => t.id === pickerState.taskId) : null

  let totalEst = 0, totalLogged = 0, totalBillable = 0, taskCount = 0, doneCount = 0
  for (const phase of project.phases || []) {
    for (const task of phase.tasks || []) {
      taskCount++
      if (task.status === 'done') doneCount++
      totalEst += Number(task.estimated_hrs || 0)
      for (const te of task.time_entries || []) { totalLogged += Number(te.hours); if (te.billable) totalBillable += Number(te.hours) }
    }
  }

  const assignedRateCard = (rateCards || []).find((rc: any) => rc.id === project.rate_card_id)
  let totalCost = 0
  if (assignedRateCard) {
    // Apr 17: rate resolves per-department; job_title is a legacy fallback.
    const rateByDept:  Record<string, number> = {}
    const rateByTitle: Record<string, number> = {}
    for (const e of (assignedRateCard.rate_card_entries || [])) {
      if (e.department_id)  rateByDept [e.department_id] = Number(e.hourly_rate)
      else if (e.job_title) rateByTitle[e.job_title]     = Number(e.hourly_rate)
    }
    for (const phase of project.phases || []) {
      for (const task of phase.tasks || []) {
        for (const te of task.time_entries || []) {
          if (!te.billable) continue
          const a = (task.task_assignees || []).find((a: any) => a.user_id === te.user_id)
          const deptId   = a?.users?.department_id || ''
          const jobTitle = a?.users?.job_title     || ''
          const rate = rateByDept[deptId] || rateByTitle[jobTitle] || 0
          totalCost += Number(te.hours) * rate
        }
      }
    }
  }

  const budget = Number(project.budget_amount) || 0
  const profit = budget > 0 ? budget - totalCost : 0
  const margin = budget > 0 && totalCost > 0 ? Math.round((profit / budget) * 100) : 0
  const hrsPct = totalEst > 0 ? Math.round((totalLogged / totalEst) * 100) : 0
  const costPct = budget > 0 && totalCost > 0 ? Math.round((totalCost / budget) * 100) : 0

  // Project status → display. Per Apr 22 call, all 5 Forecast statuses must
  // map correctly here (previously missing opportunity & planning caused
  // projects in those stages to silently render with the "Running" badge).
  const PROJ_STATUS: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
    opportunity: { label: 'Opportunity', variant: 'violet'  },
    planning:    { label: 'Template',    variant: 'default' },   // Apr 23 — Murtaza: "planning" = templates
    running:     { label: 'Running',     variant: 'success' },
    halted:      { label: 'Halted',      variant: 'warning' },
    done:        { label: 'Done',        variant: 'default' },
  }
  const sl = PROJ_STATUS[project.status] || PROJ_STATUS.running

  // Murtaza Apr 22: "here we... will have to show the start date end date.
  // Because that's from a project perspective, I need to see start date end
  // date." So we surface both dates plus a days-remaining chip right next to
  // the status badge. Expiry logic matches the Active Projects report exactly
  // (end_date - today): <0 → expired, <=30 → expiring_30d, etc.
  function fmtDateShort(d: string | null | undefined): string {
    if (!d) return '—'
    const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
    if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10)
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  let daysRemaining: number | null = null
  let expiryBadge: { label: string; variant: BadgeProps['variant'] } | null = null
  if (project.end_date) {
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime()
    const end   = new Date(String(project.end_date).slice(0, 10) + 'T00:00:00').getTime()
    daysRemaining = Math.round((end - today) / 86400000)
    if      (daysRemaining < 0)    expiryBadge = { label: `Expired ${Math.abs(daysRemaining)}d`, variant: 'danger'  }
    else if (daysRemaining <= 30)  expiryBadge = { label: `${daysRemaining}d left`,              variant: 'warning' }
    else if (daysRemaining <= 60)  expiryBadge = { label: `${daysRemaining}d left`,              variant: 'violet'  }
    else if (daysRemaining <= 90)  expiryBadge = { label: `${daysRemaining}d left`,              variant: 'default' }
    // >90 days: no chip, the date itself is enough.
  }

  const TABS = ['scoping', 'members', ...(canViewFinancials() ? ['financials'] : []), ...(isAdmin() ? ['settings'] : [])]
  const tabLabels: any = { scoping: 'Scoping', members: 'Team (' + String(projectMembers.length) + ')', financials: 'Financials', settings: 'Settings' }

  return (
    <div className="px-7 py-6">

      {pickerState && isAdmin() && pickerTask && (
        <AssigneePicker taskId={pickerState.taskId} projectId={id} currentAssignees={pickerTask.task_assignees || []} anchorPos={{ top: pickerState.top, left: pickerState.left }} onClose={() => setPickerState(null)} />
      )}

      {/* Breadcrumb — uses the shared component so spacing + typography
          stay consistent with other nested routes. */}
      <Breadcrumbs
        items={[
          { label: 'Projects', href: '/projects' },
          ...(project.clients?.name ? [{ label: project.clients.name }] : []),
          { label: project.name },
        ]}
      />

      <PageHeader
        title={project.name}
        subtitle={
          <div className="flex items-center gap-2.5 flex-wrap">
            <Badge variant={sl.variant}>{sl.label}</Badge>
            {project.clients?.name && <span className="text-base text-secondary">{project.clients.name}</span>}
            {/* Start → End dates with days-remaining chip. Apr 22 Murtaza req. */}
            {(project.start_date || project.end_date) && (
              <span className="text-sm text-secondary inline-flex items-center gap-1.5">
                <span className="text-muted">{fmtDateShort(project.start_date)}</span>
                <span className="text-muted">→</span>
                <span className={cn('font-medium', expiryBadge?.variant === 'danger' ? 'text-status-rose' : 'text-primary')}>
                  {fmtDateShort(project.end_date)}
                </span>
                {expiryBadge && <Badge variant={expiryBadge.variant}>{expiryBadge.label}</Badge>}
              </span>
            )}
            <span className="text-sm text-muted">{doneCount}/{taskCount} tasks done</span>
            {projectMembers.length > 0 && (
              <div className="flex items-center gap-1">
                {projectMembers.slice(0, 5).map((m: any) => (
                  <Avatar key={m.user_id} name={m.users?.name || '??'} size="sm" className="w-5 h-5 text-[7px]" />
                ))}
                {projectMembers.length > 5 && <span className="text-[10px] text-muted">+{projectMembers.length - 5}</span>}
              </div>
            )}
            {hrsPct >= 80 && (
              <Badge variant={hrsPct >= 90 ? 'danger' : 'warning'}>{hrsPct}% hours</Badge>
            )}
          </div>
        }
        actions={
          project.budget_amount && canViewFinancials() ? (
            <div className="text-right">
              <div className="text-[10px] text-muted uppercase tracking-wider mb-0.5">Budget</div>
              <div className="text-xl font-semibold text-primary tabular-nums">
                {project.currency} {Number(project.budget_amount).toLocaleString()}
              </div>
              {totalCost > 0 && (
                <div className={cn(
                  'text-sm mt-0.5',
                  costPct >= 100 ? 'text-status-rose' : costPct >= 80 ? 'text-status-amber' : 'text-muted',
                )}>
                  {project.currency} {Math.round(totalCost).toLocaleString()} cost ({costPct}%)
                </div>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Project color chip adjacent to header — preserved from original */}
      <div className="flex items-center gap-3 -mt-2 mb-4">
        <div
          className="w-[38px] h-[38px] rounded-md flex-shrink-0 border-2"
          style={{ background: project.color + '22', borderColor: project.color }}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line-subtle mb-4">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'bg-transparent border-none cursor-pointer px-4 py-2 text-base border-b-2 transition-colors',
              tab === t
                ? 'text-primary font-semibold border-accent'
                : 'text-muted font-normal border-transparent hover:text-secondary',
            )}
          >
            {tabLabels[t] || t}
          </button>
        ))}
      </div>

      {tab === 'scoping' && (
        <div>
          <div className="grid grid-cols-4 gap-3.5 mb-5">
            {[
              { label: 'Estimated',    value: totalEst.toFixed(1) + 'h' },
              { label: 'Actual',       value: totalLogged.toFixed(1) + 'h' },
              { label: 'Billable',     value: totalBillable.toFixed(1) + 'h' },
              { label: 'Non-Billable', value: (totalLogged - totalBillable).toFixed(1) + 'h' },
            ].map(s => (
              <Card key={s.label} className="px-4 py-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">{s.label}</div>
                <div className="text-2xl font-semibold text-primary tabular-nums">{s.value}</div>
              </Card>
            ))}
          </div>

          {(project.phases || []).map((phase: any) => (
            <Card key={phase.id} className="overflow-hidden p-0 mb-3.5">
              <div className="px-4 py-2.5 bg-surface border-b border-line-subtle flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={phase.name}
                    className="text-base font-bold text-primary bg-transparent border border-transparent rounded-sm px-1 py-px font-body outline-none cursor-text max-w-[200px] focus:border-accent"
                    onBlur={e => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== phase.name) phasesApi.update(id, phase.id, { name: v }).then(() => qc.invalidateQueries({ queryKey: ['project', id] })) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  />
                  <span className="text-xs text-muted">{phase.tasks?.length || 0} tasks</span>
                </div>
                <div className="flex gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => setShowAddTask(phase.id)}>+ Add Task</Button>
                  {isAdmin() && (
                    <Button variant="ghost" size="sm" onClick={() => showConfirm('Delete phase "' + phase.name + '"?', () => deletePhase.mutate(phase.id))}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>

              <div
                className="grid px-4 py-2 border-b border-line-subtle"
                style={{ gridTemplateColumns: TASK_GRID_COLS, gap: '0 4px' }}
              >
                {['', 'Task', 'Assigned To', 'Status', 'Est.', 'Actual', 'Billable', 'Progress', ''].map((h, i) => (
                  <div
                    key={i}
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-wider text-muted',
                      i > 3 ? 'text-right' : 'text-left',
                    )}
                  >
                    {h}
                  </div>
                ))}
              </div>

              {(phase.tasks || []).length === 0 && (
                <div className="p-4 text-base text-muted text-center">No tasks yet</div>
              )}

              {(phase.tasks || []).map((task: any, ti: number) => {
                const logged = (task.time_entries || []).reduce((s: number, e: any) => s + Number(e.hours), 0)
                const billable = (task.time_entries || []).filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours), 0)
                const est = Number(task.estimated_hrs) || 0
                const pct = est > 0 ? Math.min(Math.round((logged / est) * 100), 100) : 0
                const isOverdue = task.due_date && task.due_date < todayLocalISO() && task.status !== 'done'
                const isOpen = pickerState?.taskId === task.id
                const assignedToMe = (task.task_assignees || []).some((a: any) => a.user_id === myId)
                const statusEditable = isAdmin() || (!isCollaborator) || assignedToMe
                const isLast = ti === (phase.tasks?.length || 0) - 1
                const rowHasBorder = !(openComments === task.id || openTimeLog === task.id) && !isLast
                return (
                  <div
                    key={task.id}
                    draggable={isAdmin()}
                    onDragStart={() => { draggedTask.current = { taskId: task.id, phaseId: phase.id, index: ti } }}
                    onDragOver={e => { e.preventDefault(); setDragOver(task.id) }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={() => handleDrop(phase.id, phase.tasks || [], ti)}
                    style={{ opacity: draggedTask.current?.taskId === task.id ? 0.4 : 1 }}
                  >
                    <div className={cn(
                      'transition-colors',
                      rowHasBorder && 'border-b border-line-subtle',
                      dragOver === task.id ? 'bg-accent-dim' : 'bg-transparent',
                    )}>
                      <div
                        className="grid items-center px-4 py-2.5 transition-colors hover:bg-surface-hover"
                        style={{ gridTemplateColumns: TASK_GRID_COLS, gap: '0 4px' }}
                      >
                        <div
                          title={isAdmin() ? 'Drag to reorder' : ''}
                          className={cn(
                            'text-[10px] text-center select-none text-line-muted',
                            isAdmin() ? 'cursor-grab' : 'cursor-default',
                          )}
                        >
                          {isAdmin() ? ':' : ''}
                        </div>

                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              'text-base font-medium',
                              task.status === 'done' ? 'text-muted line-through' : 'text-primary',
                            )}>
                              {task.title}
                            </span>
                            {isOverdue && (
                              <span className="text-[10px] font-bold text-status-rose bg-status-rose-dim px-1.5 py-px rounded-sm">OVERDUE</span>
                            )}
                          </div>
                          <div className="flex gap-1 mt-0.5 items-center flex-wrap">
                            {!task.billable && (
                              <span className="text-[9px] font-semibold text-muted bg-surface-overlay px-1.5 py-px rounded-sm uppercase tracking-wider">NON-BILLABLE</span>
                            )}
                            {task.due_date && (function() {
                              const today = todayLocalISO()
                              // T00:00:00 forces local-midnight parsing — plain YYYY-MM-DD is parsed as UTC.
                              const daysUntil = Math.round((new Date(task.due_date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
                              const isDone = task.status === 'done'
                              const variant: BadgeProps['variant'] = isDone ? 'default' : daysUntil < 0 ? 'danger' : daysUntil <= 3 ? 'warning' : 'default'
                              const label = isDone ? 'Due ' + task.due_date : daysUntil < 0 ? Math.abs(daysUntil) + 'd overdue' : daysUntil === 0 ? 'Due today' : daysUntil === 1 ? 'Due tomorrow' : 'Due ' + task.due_date
                              return <Badge variant={variant} className="text-[10px] whitespace-nowrap">{label}</Badge>
                            })()}
                          </div>
                        </div>

                        <div className="flex gap-1 items-center flex-wrap">
                          {isAdmin() ? (
                            <React.Fragment>
                              {(task.task_assignees || []).slice(0, 3).map((a: any, ai: number) => (
                                <div
                                  key={ai}
                                  title={a.users?.name || ''}
                                  onClick={e => { e.stopPropagation(); openPicker(task.id, e) }}
                                  className={cn(
                                    'rounded-full cursor-pointer',
                                    isOpen && 'ring-1 ring-accent',
                                  )}
                                >
                                  <Avatar name={a.users?.name || '??'} size="sm" className="w-[22px] h-[22px] text-[8px]" />
                                </div>
                              ))}
                              {(task.task_assignees || []).length > 3 && (
                                <div className="w-[22px] h-[22px] rounded-full bg-surface-overlay flex items-center justify-center text-[9px] text-muted font-semibold">
                                  +{(task.task_assignees || []).length - 3}
                                </div>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); openPicker(task.id, e) }}
                                className={cn(
                                  'w-[22px] h-[22px] rounded-full border-[1.5px] border-dashed cursor-pointer flex items-center justify-center text-sm leading-none',
                                  isOpen
                                    ? 'bg-accent-dim border-accent text-accent'
                                    : 'bg-surface-overlay border-line-muted text-muted',
                                )}
                              >
                                +
                              </button>
                            </React.Fragment>
                          ) : isCollaborator ? (
                            <React.Fragment>
                              {(task.task_assignees || []).slice(0, 3).map((a: any, ai: number) => (
                                <Avatar
                                  key={ai}
                                  name={a.users?.name || '??'}
                                  size="sm"
                                  className={cn(
                                    'w-[22px] h-[22px] text-[8px]',
                                    a.user_id === myId && 'ring-1 ring-accent',
                                  )}
                                />
                              ))}
                              {(task.task_assignees || []).length > 3 && (
                                <span className="text-[10px] text-muted">+{(task.task_assignees || []).length - 3}</span>
                              )}
                              <AssignMeButton taskId={task.id} projectId={id} assignees={task.task_assignees || []} myId={myId} />
                            </React.Fragment>
                          ) : (
                            <React.Fragment>
                              {(task.task_assignees || []).slice(0, 4).map((a: any, ai: number) => (
                                <Avatar
                                  key={ai}
                                  name={a.users?.name || '??'}
                                  size="sm"
                                  className="w-[22px] h-[22px] text-[8px]"
                                />
                              ))}
                              {(task.task_assignees || []).length === 0 && (
                                <span className="text-xs text-muted italic">Unassigned</span>
                              )}
                            </React.Fragment>
                          )}
                        </div>

                        <div>
                          <StatusSelect taskId={task.id} projectId={id} currentStatus={task.status || 'todo'} isEditable={statusEditable} />
                        </div>

                        <div className="text-right text-sm text-secondary tabular-nums">
                          {est > 0 ? est + 'h' : '-'}
                        </div>

                        <div className={cn(
                          'text-right text-sm tabular-nums',
                          logged > est && est > 0 ? 'text-status-rose' : 'text-secondary',
                        )}>
                          {logged > 0 ? logged.toFixed(1) + 'h' : '-'}
                        </div>

                        <div className="text-right">
                          {isAdmin() ? (
                            <button
                              onClick={e => { e.stopPropagation(); tasksApi.update(id, task.id, { billable: !task.billable }).then(() => qc.invalidateQueries({ queryKey: ['project', id] })) }}
                              title={task.billable ? 'Click to mark non-billable' : 'Click to mark billable'}
                              className={cn(
                                'rounded-sm px-1.5 py-px text-xs font-semibold cursor-pointer border',
                                task.billable
                                  ? 'bg-accent-dim border-accent text-accent'
                                  : 'bg-surface-overlay border-line-muted text-muted',
                              )}
                            >
                              {task.billable ? '$ Bill' : '- No'}
                            </button>
                          ) : (
                            <span className={cn('text-sm', task.billable ? 'text-accent' : 'text-muted')}>
                              {billable > 0 ? billable.toFixed(1) + 'h' : '-'}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 justify-end">
                          <div className="flex-1 h-[3px] bg-surface-overlay rounded-sm overflow-hidden max-w-[48px]">
                            <div
                              className={cn('h-full rounded-sm', pct >= 100 ? 'bg-status-rose' : 'bg-accent')}
                              style={{ width: pct + '%' }}
                            />
                          </div>
                          <span className="text-[10px] text-muted min-w-[24px] text-right tabular-nums">{pct}%</span>
                        </div>

                        <div className="text-right flex items-center gap-1 justify-end">
                          <button
                            onClick={() => setOpenTimeLog((prev: any) => prev === task.id ? null : task.id)}
                            title="Log time"
                            className={cn(
                              'rounded-sm px-1.5 py-px text-xs cursor-pointer border',
                              openTimeLog === task.id
                                ? 'bg-accent-dim/60 border-line-accent text-accent'
                                : 'bg-transparent border-transparent text-muted',
                            )}
                          >
                            T
                          </button>
                          <button
                            onClick={() => setOpenComments((prev: any) => prev === task.id ? null : task.id)}
                            title="Comments"
                            className={cn(
                              'rounded-sm px-1.5 py-px text-xs cursor-pointer border',
                              openComments === task.id
                                ? 'bg-accent-dim border-line-accent text-accent'
                                : 'bg-transparent border-transparent text-muted',
                            )}
                          >
                            C
                          </button>
                          {isAdmin() && (
                            <button
                              onClick={() => showConfirm('Delete "' + task.title + '"?', () => deleteTask.mutate(task.id))}
                              className="bg-transparent border-none text-muted cursor-pointer text-xs p-0 hover:text-status-rose"
                            >
                              Del
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    {openTimeLog === task.id && (
                      <InlineTimeLog taskId={task.id} projectId={id} onClose={() => setOpenTimeLog(null)} />
                    )}
                    {openComments === task.id && (
                      <TaskComments taskId={task.id} projectId={id} myId={myId} myName={authUser?.name || 'You'} />
                    )}
                  </div>
                )
              })}

              {showAddTask === phase.id && (
                <div className="px-3.5 py-3 bg-surface border-t border-line-subtle">
                  <div className="text-sm font-semibold text-muted mb-1 uppercase tracking-wider">
                    New Task in {phase.name}
                  </div>
                  <div className="px-2 py-1.5 mb-2 rounded bg-status-amber-dim text-xs text-status-amber font-medium">
                    Please check the existing tasks above to make sure this task doesn't already exist before creating a new one.
                  </div>
                  <div className="flex gap-2 flex-wrap items-end">
                    <div className="flex-[2_1_160px]">
                      <Label>Task name *</Label>
                      <Input
                        autoFocus
                        value={taskForm.title}
                        onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
                        placeholder="e.g. Campaign Creatives"
                        onKeyDown={e => { if (e.key === 'Enter' && taskForm.title) createTask.mutate(phase.id) }}
                      />
                    </div>
                    <div className="flex-[0_0_80px]">
                      <Label>Est. hrs</Label>
                      <Input
                        type="number"
                        value={taskForm.estimatedHrs}
                        onChange={e => setTaskForm(f => ({ ...f, estimatedHrs: e.target.value }))}
                        placeholder="e.g. 8"
                      />
                    </div>
                    <div className="flex-[0_0_120px]">
                      <Label>Due date</Label>
                      <DatePicker
                        value={taskForm.dueDate || null}
                        onChange={v => setTaskForm(f => ({ ...f, dueDate: v || '' }))}
                        placeholder="Pick due date"
                        clearable
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-sm text-secondary cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={taskForm.billable}
                        onChange={e => setTaskForm(f => ({ ...f, billable: e.target.checked }))}
                      />
                      Billable
                    </label>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button
                        variant="primary"
                        onClick={() => createTask.mutate(phase.id)}
                        disabled={!taskForm.title || createTask.isPending}
                      >
                        {createTask.isPending ? 'Adding...' : 'Add Task'}
                      </Button>
                      <Button variant="secondary" onClick={() => setShowAddTask(null)}>Cancel</Button>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}

          {canAddPhase && (
            showAddPhase ? (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={phaseForm.name}
                  onChange={e => setPhaseForm({ name: e.target.value })}
                  placeholder="Phase name"
                  className="flex-1"
                  onKeyDown={e => { if (e.key === 'Enter' && phaseForm.name) createPhase.mutate() }}
                />
                <Button variant="primary" onClick={() => createPhase.mutate()} disabled={!phaseForm.name}>
                  Add Phase
                </Button>
                <Button variant="secondary" onClick={() => setShowAddPhase(false)}>Cancel</Button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddPhase(true)}
                className="bg-transparent border border-dashed border-line-muted rounded-md p-3 text-muted text-base cursor-pointer w-full transition-colors hover:border-accent hover:text-accent"
              >
                + Add Phase
              </button>
            )
          )}
        </div>
      )}

      {tab === 'members' && <MembersTab projectId={id} members={projectMembers} isAdminUser={isAdmin()} />}

      {tab === 'financials' && canViewFinancials() && (
        <div>
          {hrsPct >= 70 && (
            <div className={cn(
              'rounded-md px-4 py-2.5 mb-4 border',
              hrsPct >= 90
                ? 'bg-status-rose-dim border-status-rose/25'
                : 'bg-status-amber-dim border-status-amber/25',
            )}>
              <span className={cn(
                'text-base font-semibold',
                hrsPct >= 90 ? 'text-status-rose' : 'text-status-amber',
              )}>
                {hrsPct >= 100 ? 'Budget exceeded (' + hrsPct + '%)' : (hrsPct >= 90 ? 'Critical' : 'Warning') + ': ' + hrsPct + '% of hours consumed'}
              </span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mb-3.5">
            {[
              { label: 'Budget (Revenue)',   value: budget > 0 ? project.currency + ' ' + budget.toLocaleString() : 'Not set',                                                                                      sub: (project.budget_type || '').replace(/_/g, ' '),             valueClass: 'text-primary' },
              { label: 'Cost (Hours x Rate)', value: totalCost > 0 ? project.currency + ' ' + Math.round(totalCost).toLocaleString() : assignedRateCard ? project.currency + ' 0' : 'No rate card',                  sub: assignedRateCard ? 'Rate: ' + assignedRateCard.name : 'Assign in Settings', valueClass: 'text-primary' },
              { label: 'Profit',             value: budget > 0 && totalCost > 0 ? project.currency + ' ' + Math.round(profit).toLocaleString() : '-',                                                                 sub: budget > 0 && totalCost > 0 ? margin + '% margin' : 'Need budget + rate card', valueClass: profit >= 0 ? 'text-accent' : 'text-status-rose' },
              { label: 'Estimated Hours',    value: totalEst.toFixed(1) + 'h',                                                                                                                                        sub: 'Across ' + taskCount + ' tasks',                            valueClass: 'text-primary' },
              { label: 'Actual Hours',       value: totalLogged.toFixed(1) + 'h',                                                                                                                                     sub: hrsPct + '% of estimate',                                    valueClass: hrsPct >= 90 ? 'text-status-rose' : hrsPct >= 80 ? 'text-status-amber' : 'text-primary' },
              { label: 'Billable',           value: totalBillable.toFixed(1) + 'h',                                                                                                                                   sub: totalLogged > 0 ? Math.round((totalBillable / totalLogged) * 100) + '% of logged' : '-', valueClass: 'text-accent' },
            ].map(s => (
              <Card key={s.label} className="px-4 py-3.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">{s.label}</div>
                <div className={cn('text-2xl font-semibold mb-1 tabular-nums', s.valueClass)}>{s.value}</div>
                <div className="text-xs text-muted capitalize">{s.sub}</div>
              </Card>
            ))}
          </div>

          {budget > 0 && totalCost > 0 && (
            <Card className="px-4 py-4 mb-3">
              <div className="flex justify-between mb-2.5">
                <div className="text-base font-semibold text-primary">Budget Consumption</div>
                <div className="text-sm text-secondary tabular-nums">
                  {project.currency} {Math.round(totalCost).toLocaleString()} / {project.currency} {budget.toLocaleString()}
                </div>
              </div>
              <div className="bg-surface-overlay rounded-sm h-2 overflow-hidden mb-3">
                <div
                  className={cn(
                    'h-full rounded-sm',
                    costPct >= 100 ? 'bg-status-rose' : costPct >= 80 ? 'bg-status-amber' : 'bg-accent',
                  )}
                  style={{ width: Math.min(costPct, 100) + '%' }}
                />
              </div>
              <div className="flex gap-2">
                {[70, 80, 90, 100].map(t => {
                  const reached = costPct >= t
                  return (
                    <div
                      key={t}
                      className={cn(
                        'flex-1 px-2 py-1.5 rounded-sm border text-center',
                        reached
                          ? (t >= 90 ? 'bg-status-rose-dim border-status-rose/30' : 'bg-status-amber-dim border-status-amber/30')
                          : 'bg-surface-overlay border-line-subtle',
                      )}
                    >
                      <div className={cn(
                        'text-base font-bold',
                        reached ? (t >= 90 ? 'text-status-rose' : 'text-status-amber') : 'text-muted',
                      )}>
                        {t}%
                      </div>
                      <div className="text-[10px] text-muted mt-0.5">
                        {reached ? 'Reached' : project.currency + ' ' + Math.round(budget * t / 100).toLocaleString()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {assignedRateCard && totalLogged > 0 && (
            <Card className="overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-line-subtle text-base font-semibold text-primary">
                Cost by Role - {assignedRateCard.name}
              </div>
              <div className="grid grid-cols-[1fr_80px_80px_100px] px-4 py-2 bg-surface border-b border-line-subtle">
                {['Role', 'Rate/hr', 'Hours', 'Cost'].map(h => (
                  <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
                ))}
              </div>
              {(function() {
                // Apr 17: rate resolves per-department. We still group the
                // breakdown by role (the existing UI), but each entry's cost
                // uses the assignee's department rate first and falls back to
                // legacy job_title rates. "Rate/hr" shown is the effective
                // blended rate (cost ÷ hours) so rows with mixed departments
                // don't misreport.
                const byRole: Record<string, { hrs: number; cost: number }> = {}
                const byDept:  Record<string, number> = {}
                const byTitle: Record<string, number> = {}
                for (const e of (assignedRateCard.rate_card_entries || [])) {
                  if (e.department_id)  byDept [e.department_id] = Number(e.hourly_rate)
                  else if (e.job_title) byTitle[e.job_title]     = Number(e.hourly_rate)
                }
                for (const phase of project.phases || []) {
                  for (const task of phase.tasks || []) {
                    for (const te of task.time_entries || []) {
                      if (!te.billable) continue
                      const a = (task.task_assignees || []).find((a: any) => a.user_id === te.user_id)
                      const role     = a?.users?.job_title     || 'Unknown'
                      const deptId   = a?.users?.department_id || ''
                      const jobTitle = a?.users?.job_title     || ''
                      const rate = byDept[deptId] || byTitle[jobTitle] || 0
                      const hrs  = Number(te.hours)
                      if (!byRole[role]) byRole[role] = { hrs: 0, cost: 0 }
                      byRole[role].hrs  += hrs
                      byRole[role].cost += hrs * rate
                    }
                  }
                }
                return Object.entries(byRole).sort(([, a]: any, [, b]: any) => b.cost - a.cost).map(([role, data]: any) => {
                  const effRate = data.hrs > 0 ? data.cost / data.hrs : 0
                  return (
                  <div key={role} className="grid grid-cols-[1fr_80px_80px_100px] px-4 py-2 border-b border-line-subtle items-center">
                    <div className="text-base text-primary">{role}</div>
                    <div className="text-sm text-secondary tabular-nums">{effRate > 0 ? project.currency + ' ' + Math.round(effRate) : '-'}</div>
                    <div className="text-sm text-secondary tabular-nums">{data.hrs.toFixed(1)}h</div>
                    <div className="text-sm font-semibold text-primary tabular-nums">{data.cost > 0 ? project.currency + ' ' + Math.round(data.cost).toLocaleString() : '-'}</div>
                  </div>
                  )
                })
              })()}
              <div className="grid grid-cols-[1fr_80px_80px_100px] px-4 py-2.5 bg-surface">
                <div className="text-base font-bold text-primary">Total</div>
                <div />
                <div className="text-sm font-semibold text-primary tabular-nums">{totalBillable.toFixed(1)}h</div>
                <div className="text-base font-bold text-primary tabular-nums">
                  {project.currency} {Math.round(totalCost).toLocaleString()}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'settings' && isAdmin() && settings && (
        <Card className="px-6 py-5">
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div className="col-span-2">
              <Label>Project Name</Label>
              <Input
                value={settings.name}
                onChange={e => setSettings((s: any) => ({ ...s, name: e.target.value }))}
              />
            </div>
            {[
              // "opportunity" removed from the status editor (Apr 23 — Murtaza).
              // Existing opportunity rows stay in the DB (sync keeps writing) but
              // are neither created nor selectable from the UI.
              { label: 'Status',      key: 'status',       options: [{ value: 'planning', label: 'Template' }, { value: 'running', label: 'Running' }, { value: 'halted', label: 'Halted' }, { value: 'done', label: 'Done' }] },
              { label: 'Client',      key: 'client_id',    options: [{ value: '', label: 'No client' }, ...clients.map((c: any) => ({ value: c.id, label: c.name }))] },
              // "fixed_hours" dropped as a top-level type (Apr 23 — Murtaza);
              // retainer sub-type (amount vs hours) replaces it, rendered below.
              { label: 'Budget Type', key: 'budget_type',  options: [{ value: 'fixed_price', label: 'Fixed Price' }, { value: 'time_and_materials', label: 'Time & Materials' }, { value: 'retainer', label: 'Retainer' }] },
              { label: 'Currency',    key: 'currency',     options: [{ value: 'AED', label: 'AED' }, { value: 'USD', label: 'USD' }, { value: 'GBP', label: 'GBP' }, { value: 'EUR', label: 'EUR' }] },
              { label: 'Rate Card',   key: 'rate_card_id', options: [{ value: '', label: 'No rate card' }, ...(rateCards || []).map((rc: any) => ({ value: rc.id, label: rc.name + ' (' + rc.currency + ')' }))] },
            ].map(f => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Select
                  aria-label={f.label}
                  value={settings[f.key]}
                  onChange={e => setSettings((s: any) => ({ ...s, [f.key]: e.target.value }))}
                >
                  {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </div>
            ))}
            {/* Retainer: sub-type picker + matching second field.
                Non-retainer types get their own inline renders below. */}
            {settings.budget_type === 'retainer' && (
              <>
                <div>
                  <Label>Retainer Type</Label>
                  <Select
                    aria-label="Retainer Type"
                    value={settings.retainer_mode || 'amount'}
                    onChange={e => setSettings((s: any) => ({ ...s, retainer_mode: e.target.value }))}
                  >
                    <option value="amount">Fixed Monthly Amount</option>
                    <option value="hours">Fixed Monthly Hours</option>
                  </Select>
                </div>
                {settings.retainer_mode === 'hours' ? (
                  <div>
                    <Label>Monthly Hours</Label>
                    <Input
                      type="number"
                      value={settings.budget_hrs}
                      onChange={e => setSettings((s: any) => ({ ...s, budget_hrs: e.target.value }))}
                      placeholder="e.g. 40"
                    />
                  </div>
                ) : (
                  <div>
                    <Label>Monthly Amount ({settings.currency})</Label>
                    <Input
                      type="number"
                      value={settings.budget_amount}
                      onChange={e => setSettings((s: any) => ({ ...s, budget_amount: e.target.value }))}
                      placeholder="e.g. 18000"
                    />
                  </div>
                )}
              </>
            )}
            {settings.budget_type === 'fixed_price' && (
              <div>
                <Label>Budget Amount ({settings.currency})</Label>
                <Input
                  type="number"
                  value={settings.budget_amount}
                  onChange={e => setSettings((s: any) => ({ ...s, budget_amount: e.target.value }))}
                />
              </div>
            )}
            <div>
              <Label>Start Date</Label>
              <DatePicker
                value={settings.start_date?.slice(0, 10) || null}
                onChange={v => setSettings((s: any) => ({ ...s, start_date: v || '' }))}
                placeholder="Pick start date"
                clearable
              />
            </div>
            <div>
              <Label>End Date</Label>
              <DatePicker
                value={settings.end_date?.slice(0, 10) || null}
                onChange={v => setSettings((s: any) => ({ ...s, end_date: v || '' }))}
                placeholder="Pick end date"
                min={settings.start_date?.slice(0, 10) || undefined}
                clearable
              />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex gap-1.5 flex-wrap">
                {['#0D9488', '#7C3AED', '#2563EB', '#D97706', '#DC2626', '#059669', '#0891B2', '#BE185D'].map(c => (
                  <div
                    key={c}
                    onClick={() => setSettings((s: any) => ({ ...s, color: c }))}
                    className={cn(
                      'w-[26px] h-[26px] rounded-sm cursor-pointer border-2',
                      settings.color === c ? 'border-white shadow-[0_0_0_2px_var(--accent)]' : 'border-transparent',
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-center pt-3.5 border-t border-line-subtle">
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                // Strip UI-only retainer_mode, normalize budget fields per type
                // so the server never sees both budget_amount and budget_hrs set
                // together. Mirrors the create-page logic.
                const { retainer_mode, budget_amount, budget_hrs, ...rest } = settings as any
                const payload: any = { ...rest }
                if (settings!.budget_type === 'retainer') {
                  if (retainer_mode === 'hours') {
                    payload.budget_hrs    = budget_hrs    ? Number(budget_hrs)    : null
                    payload.budget_amount = null
                  } else {
                    payload.budget_amount = budget_amount ? Number(budget_amount) : null
                    payload.budget_hrs    = null
                  }
                } else if (settings!.budget_type === 'fixed_price') {
                  payload.budget_amount = budget_amount ? Number(budget_amount) : null
                  payload.budget_hrs    = null
                } else {
                  payload.budget_amount = null
                  payload.budget_hrs    = null
                }
                updateProject.mutate(payload)
              }}
              disabled={updateProject.isPending}
            >
              {updateProject.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
            {saved && <span className="text-base text-accent font-medium">Saved</span>}
            {updateProject.isError && <span className="text-base text-status-rose">Save failed</span>}
          </div>
        </Card>
      )}
    </div>
  )
}
