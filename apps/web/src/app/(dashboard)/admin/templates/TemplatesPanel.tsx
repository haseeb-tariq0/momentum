'use client'
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { templatesApi, projectsApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, ChevronUp, X, Loader2, ExternalLink } from 'lucide-react'
import {
  Card, Button, Input, Label, Textarea, EmptyState, Skeleton, Badge,
} from '@/components/ui'
import { showConfirm } from '@/components/ConfirmDialog'
import { cn } from '@/lib/cn'
import Link from 'next/link'

// Stable client-side key. Used as React key so reordering/removing phases or
// tasks doesn't bleed form state between sibling rows (array indices can't).
function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `k_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

type TaskDraft = {
  _key: string
  id?: string
  title: string
  description?: string
  estimated_hrs?: number | null
  billable: boolean
  sort_order?: number
}

type PhaseDraft = {
  _key: string
  id?: string
  name: string
  description?: string
  sort_order?: number
  tasks: TaskDraft[]
}

type TemplateDraft = {
  id?: string
  name: string
  description?: string
  color: string
  phases: PhaseDraft[]
}

// Unified item shown in the merged list.
type TemplateItem = {
  id: string
  name: string
  color: string
  phase_count: number
  task_count: number
  kind: 'planning' | 'template'  // planning = project in planning stage, template = reusable blueprint
}

const COLORS = ['#0D9488','#7C3AED','#2563EB','#D97706','#DC2626','#059669','#0891B2','#BE185D']

function emptyTemplate(): TemplateDraft {
  return { name: '', description: '', color: '#0D9488', phases: [] }
}

/**
 * Reusable panel — rendered at /admin/templates and inside the Admin page
 * as the "Project Templates" tab. No PageHeader/container; each host wraps
 * it in its own layout.
 *
 * Shows two item kinds merged in one list:
 *   • "Planning" — projects in planning stage (status=planning). Clicking opens the project.
 *   • "Template" — standalone reusable templates (project_templates table). Editable here.
 */
export function TemplatesPanel() {
  const qc = useQueryClient()
  const { isAdmin } = useAuthStore()
  const [editing, setEditing] = useState<TemplateDraft | null>(null)
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null)
  const editReqRef = useRef(0)

  // Fetch planning-stage projects (the primary "template" source per Apr 23 spec)
  const { data: planningRaw, isLoading: loadingPlanning } = useQuery({
    queryKey: ['projects-templates'],
    queryFn: () => projectsApi.templates().then((r: any) => r.data),
    staleTime: 30_000,
  })

  // Fetch standalone reusable templates (project_templates table)
  const { data: templatesRaw, isLoading: loadingTemplates } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list().then((r: any) => r.data),
    staleTime: 30_000,
  })

  const isLoading = loadingPlanning || loadingTemplates

  // Merge into a single sorted list: planning projects first, then templates
  const items: TemplateItem[] = [
    ...(planningRaw  || []).map((p: any) => ({ ...p, kind: 'planning'  as const })),
    ...(templatesRaw || []).map((t: any) => ({ ...t, kind: 'template' as const })),
  ]

  const save = useMutation({
    mutationFn: async (t: TemplateDraft) => {
      const payload = {
        name: t.name,
        description: t.description || null,
        color: t.color,
        phases: t.phases.map((p, i) => ({
          name: p.name,
          description: p.description || null,
          sort_order: i,
          tasks: p.tasks.map((task, j) => ({
            title: task.title,
            description: task.description || null,
            estimated_hrs: task.estimated_hrs ?? null,
            billable: task.billable,
            sort_order: j,
          })),
        })),
      }
      return t.id
        ? templatesApi.update(t.id, payload)
        : templatesApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      setEditing(null)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => templatesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })

  async function openEdit(id: string) {
    const myReq = ++editReqRef.current
    setLoadingEditId(id)
    let res: any
    try { res = await templatesApi.get(id) }
    finally {
      if (myReq === editReqRef.current) setLoadingEditId(null)
    }
    if (myReq !== editReqRef.current) return
    const t = res?.data
    if (!t) return
    setEditing({
      id: t.id,
      name: t.name,
      description: t.description || '',
      color: t.color || '#0D9488',
      phases: (t.phases || []).map((p: any) => ({
        _key: uid(),
        id: p.id,
        name: p.name,
        description: p.description || '',
        sort_order: p.sort_order,
        tasks: (p.tasks || []).map((tk: any) => ({
          _key: uid(),
          id: tk.id,
          title: tk.title,
          description: tk.description || '',
          estimated_hrs: tk.estimated_hrs != null ? Number(tk.estimated_hrs) : null,
          billable: !!tk.billable,
          sort_order: tk.sort_order,
        })),
      })),
    })
  }

  function closeEditor() {
    editReqRef.current++
    setEditing(null)
    setLoadingEditId(null)
  }

  if (!isAdmin()) {
    return (
      <EmptyState title="Admin only" description="You don't have permission to manage project templates." />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-muted">
          {items.length} item{items.length === 1 ? '' : 's'}
          {' '}
          <span className="text-muted/60">
            ({(planningRaw || []).length} planning · {(templatesRaw || []).length} reusable)
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setEditing(emptyTemplate())}
        >
          <Plus size={14} /> New Template
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0,1,2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description="Planning-stage projects and reusable templates will appear here."
        />
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <Card key={`${item.kind}-${item.id}`} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className="w-3 h-10 rounded-sm flex-shrink-0"
                    style={{ background: item.color || '#0D9488' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-primary truncate">{item.name}</span>
                      <Badge
                        variant={item.kind === 'planning' ? 'warning' : 'default'}
                        className="text-[10px] px-1.5 py-0.5 flex-shrink-0"
                      >
                        {item.kind === 'planning' ? 'Planning' : 'Template'}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {item.phase_count || 0} phase{item.phase_count === 1 ? '' : 's'} · {item.task_count || 0} task{item.task_count === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {item.kind === 'planning' ? (
                    // Planning projects — open the actual project page
                    <Link href={`/projects/${item.id}`}>
                      <Button variant="ghost" title="Open project">
                        <ExternalLink size={14} />
                      </Button>
                    </Link>
                  ) : (
                    // Reusable templates — edit / delete
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => openEdit(item.id)}
                        disabled={loadingEditId === item.id}
                        title="Edit"
                      >
                        {loadingEditId === item.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Pencil size={14} />}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          showConfirm(
                            `Delete template "${item.name}"?`,
                            () => remove.mutate(item.id),
                            { subtext: "Existing projects won't be affected.", confirmLabel: 'Delete' },
                          )
                        }
                        title="Delete"
                      >
                        <Trash2 size={14} className="text-status-rose" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditor
          draft={editing}
          onChange={setEditing}
          onClose={closeEditor}
          onSave={() => save.mutate(editing)}
          saving={save.isPending}
        />
      )}
    </div>
  )
}

// ── Editor drawer ────────────────────────────────────────────────────────────
function TemplateEditor({
  draft, onChange, onClose, onSave, saving,
}: {
  draft: TemplateDraft
  onChange: (d: TemplateDraft) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
}) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  function addPhase() {
    onChange({ ...draft, phases: [...draft.phases, { _key: uid(), name: '', tasks: [] }] })
  }
  function updatePhase(idx: number, patch: Partial<PhaseDraft>) {
    onChange({ ...draft, phases: draft.phases.map((p, i) => i === idx ? { ...p, ...patch } : p) })
  }
  function removePhase(idx: number) {
    onChange({ ...draft, phases: draft.phases.filter((_, i) => i !== idx) })
  }
  function movePhase(idx: number, dir: -1 | 1) {
    const next = [...draft.phases]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChange({ ...draft, phases: next })
  }

  const canSave = draft.name.trim().length > 0 && !saving

  return (
    <div
      className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm flex items-stretch justify-end animate-overlay-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-full bg-surface-raised shadow-xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-surface-raised border-b border-line-subtle px-5 py-3.5 flex items-center justify-between">
          <div className="font-semibold text-primary">
            {draft.id ? 'Edit template' : 'New template'}
          </div>
          <Button variant="ghost" onClick={onClose}><X size={16} /></Button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <Label htmlFor="tpl-name">Name *</Label>
            <Input
              id="tpl-name"
              autoFocus
              value={draft.name}
              onChange={e => onChange({ ...draft, name: e.target.value })}
              placeholder="e.g. Website Launch"
            />
          </div>

          <div>
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea
              id="tpl-desc"
              rows={2}
              value={draft.description || ''}
              onChange={e => onChange({ ...draft, description: e.target.value })}
              placeholder="What is this template for?"
            />
          </div>

          <div>
            <Label>Color</Label>
            <div className="flex gap-1.5 flex-wrap">
              {COLORS.map(c => (
                <div
                  key={c}
                  onClick={() => onChange({ ...draft, color: c })}
                  className={cn(
                    'w-[26px] h-[26px] rounded-sm cursor-pointer transition-transform',
                    draft.color === c
                      ? 'ring-2 ring-offset-2 ring-offset-surface-raised ring-accent scale-110'
                      : 'ring-0',
                  )}
                  style={{ background: c }}
                  role="button"
                  aria-label={`Pick color ${c}`}
                  aria-pressed={draft.color === c}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-line-subtle pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-primary">Phases & Tasks</div>
              <Button variant="ghost" onClick={addPhase}><Plus size={14} /> Add phase</Button>
            </div>

            {draft.phases.length === 0 && (
              <div className="text-sm text-muted py-4 text-center border border-dashed border-line-subtle rounded-md">
                No phases yet. Add one to start building the template.
              </div>
            )}

            <div className="space-y-3">
              {draft.phases.map((phase, pi) => (
                <PhaseEditor
                  key={phase._key}
                  phase={phase}
                  index={pi}
                  isFirst={pi === 0}
                  isLast={pi === draft.phases.length - 1}
                  onChange={patch => updatePhase(pi, patch)}
                  onRemove={() => removePhase(pi)}
                  onMoveUp={() => movePhase(pi, -1)}
                  onMoveDown={() => movePhase(pi, 1)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-surface-raised border-t border-line-subtle px-5 py-3 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            loading={saving}
            onClick={onSave}
          >
            {saving ? 'Saving…' : draft.id ? 'Save template' : 'Create template'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function PhaseEditor({
  phase, index, isFirst, isLast, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  phase: PhaseDraft
  index: number
  isFirst: boolean
  isLast: boolean
  onChange: (patch: Partial<PhaseDraft>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [open, setOpen] = useState(true)

  function addTask() {
    onChange({ tasks: [...phase.tasks, { _key: uid(), title: '', billable: true }] })
  }
  function updateTask(idx: number, patch: Partial<TaskDraft>) {
    onChange({ tasks: phase.tasks.map((t, i) => i === idx ? { ...t, ...patch } : t) })
  }
  function removeTask(idx: number) {
    onChange({ tasks: phase.tasks.filter((_, i) => i !== idx) })
  }

  return (
    <div className="border border-line-subtle rounded-md">
      <div className="flex items-center gap-2 p-2.5 bg-surface-overlay">
        <button
          onClick={() => setOpen(v => !v)}
          className="text-muted hover:text-primary"
          aria-label="Toggle phase"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Input
          value={phase.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder={`Phase ${index + 1} name`}
          className="flex-1 text-sm"
        />
        <Badge variant="default">{phase.tasks.length} task{phase.tasks.length === 1 ? '' : 's'}</Badge>
        <Button variant="ghost" disabled={isFirst} onClick={onMoveUp} title="Move up"><ChevronUp size={14} /></Button>
        <Button variant="ghost" disabled={isLast}  onClick={onMoveDown} title="Move down"><ChevronDown size={14} /></Button>
        <Button variant="ghost" onClick={onRemove} title="Remove phase"><Trash2 size={13} className="text-status-rose" /></Button>
      </div>

      {open && (
        <div className="p-3 space-y-2">
          {phase.tasks.length === 0 && (
            <div className="text-xs text-muted py-2 text-center">No tasks.</div>
          )}
          {phase.tasks.map((task, ti) => (
            <div key={task._key} className="flex flex-wrap gap-2 items-center">
              <Input
                value={task.title}
                onChange={e => updateTask(ti, { title: e.target.value })}
                placeholder="Task title"
                className="text-sm flex-1 min-w-[180px]"
              />
              <Input
                type="number"
                step="0.25"
                min="0"
                value={task.estimated_hrs ?? ''}
                onChange={e => updateTask(ti, { estimated_hrs: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="Est. hrs"
                className="text-sm w-[90px]"
              />
              <label className="flex items-center gap-1.5 text-xs text-secondary cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={task.billable}
                  onChange={e => updateTask(ti, { billable: e.target.checked })}
                />
                Billable
              </label>
              <Button variant="ghost" onClick={() => removeTask(ti)} title="Remove task">
                <Trash2 size={13} className="text-status-rose" />
              </Button>
            </div>
          ))}
          <Button variant="ghost" onClick={addTask} className="w-full justify-center">
            <Plus size={13} /> Add task
          </Button>
        </div>
      )}
    </div>
  )
}
