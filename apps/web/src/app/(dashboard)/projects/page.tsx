'use client'
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi, usersApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import { todayLocalISO, dateLocalISO } from '@/lib/utils'
import { Play, Pause, CheckCircle2, Users, ChevronDown, Plus, Lightbulb, ClipboardList } from 'lucide-react'
import {
  Button, Badge, Card, Skeleton, SkeletonCard, SkeletonTable,
  PageHeader, StatCard, EmptyState, Input, Label, Select,
  Combobox, DatePicker,
  type BadgeProps,
} from '@/components/ui'

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_ICONS: Record<string, React.ComponentType<any>> = {
  opportunity: Lightbulb,
  planning:    ClipboardList,
  running:     Play,
  halted:      Pause,
  done:        CheckCircle2,
}

type StatusCfg = { label: string; iconClass: string; sectionBg: string }
// Apr 23 — Murtaza: the "planning" status is relabeled to "Templates" across
// the UI. Internal DB value stays "planning" so syncs and reports keep working;
// only the user-facing copy changes. Projects sitting under this section ARE
// the pool of templates the New Project dropdown clones from.
const STATUS_CFG: Record<string, StatusCfg> = {
  opportunity: { label: 'Opportunity', iconClass: 'text-status-violet', sectionBg: 'bg-status-violet-dim' },
  planning:    { label: 'Templates',   iconClass: 'text-accent',        sectionBg: 'bg-accent-dim' },
  running:     { label: 'Running',     iconClass: 'text-[#10B981]',     sectionBg: 'bg-[rgba(16,185,129,0.06)]' },
  halted:      { label: 'Halted',      iconClass: 'text-status-amber',  sectionBg: 'bg-status-amber-dim' },
  done:        { label: 'Done',        iconClass: 'text-muted',         sectionBg: 'bg-surface-overlay' },
}

// Apr 23 — Murtaza: collapse to 3 top-level budget types. "fixed_hours" is
// removed as a top-level choice; retainer handles the hours case via a
// sub-type dropdown (amount vs hours) rendered in the form.
// Left in the map as a fallback so any legacy row with budget_type='fixed_hours'
// still renders something sensible instead of the "—" default.
const BUDGET_LABEL: Record<string, string> = {
  fixed_price:        'Fixed',
  time_and_materials: 'T&M',
  retainer:           'Retainer',
  fixed_hours:        'Fixed Hrs',   // legacy only
}

// Outer sections (status) — mirrors Forecast.it's /projects top-level tabs.
// Clients are nested inside each status section.
//
// Intentionally excluded (Apr 23 — Murtaza):
//   • opportunity — 165 HubSpot-integration orphans (no client, no budget), noise.
//   • planning    — these ARE the templates; surfaced via the template dropdown on
//                   project create, not mixed into the real-projects list. Avoids
//                   showing the same 17 template rows twice and keeps the list
//                   focused on actual work.
// Both statuses still sync and exist in the DB — we just don't render their sections here.
const SECTION_ORDER = ['running','halted','done']

const NO_CLIENT_KEY = '— No Client —'

const COLORS = ['#0D9488','#7C3AED','#2563EB','#D97706','#DC2626','#059669','#0891B2','#BE185D']

// Client column removed from rows — client is now the section header.
const ROW_GRID_COLS = '24px minmax(220px,1fr) 140px 52px 160px 110px 120px'

// ── Helpers ───────────────────────────────────────────────────────────────────────────
type DaysLeft = { label: string; className: string; bold: boolean }
function daysLeft(endDate: string | null): DaysLeft {
  if (!endDate) return { label: 'No end date', className: 'text-muted', bold: false }
  const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000)
  if (diff < 0)   return { label: `${Math.abs(diff)}d overdue`, className: 'text-status-rose', bold: true }
  if (diff === 0) return { label: 'Due today',                  className: 'text-status-rose', bold: true }
  if (diff <= 7)  return { label: `${diff}d left`,              className: 'text-status-amber', bold: false }
  if (diff <= 30) return { label: `${diff}d left`,              className: 'text-secondary',   bold: false }
  const weeks = Math.round(diff / 7)
  return { label: `${weeks}w left`, className: 'text-muted', bold: false }
}

type Health = { label: string; variant: BadgeProps['variant'] }
function healthBadge(pct: number, status: string): Health {
  if (status === 'opportunity') return { label: 'Opportunity', variant: 'violet'  }
  if (status === 'planning')    return { label: 'Planning',    variant: 'info'    }
  if (status === 'halted')      return { label: 'On hold',     variant: 'warning' }
  if (status === 'done')        return { label: 'Complete',    variant: 'default' }
  // running: assess by hours burn
  if (pct >= 100) return { label: 'Over budget', variant: 'danger'  }
  if (pct >= 85)  return { label: 'At risk',     variant: 'warning' }
  return          { label: 'On track',    variant: 'success' }
}

// ── Expanded task panel ─────────────────────────────────────────────────────────────────────
function ProjectTasks({ projectId, currency }: { projectId: string; currency: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId).then((r: any) => r.data),
    staleTime: 60_000,
  })

  if (isLoading) return (
    <div className="p-5 space-y-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )

  const phases = data?.phases || []
  if (!phases.length) return (
    <div className="px-5 py-5 text-center text-sm text-muted">
      No tasks yet.{' '}
      <Link href={`/projects/${projectId}`} className="text-accent font-medium no-underline">
        Open project →
      </Link>
    </div>
  )

  const allTasks = phases.flatMap((ph: any) => (ph.tasks||[]).map((t: any) => ({...t, phaseName: ph.name})))
  const totalLogged   = allTasks.reduce((s: number, t: any) => s + (t.time_entries||[]).reduce((x: number, e: any) => x + Number(e.hours), 0), 0)
  const totalEst      = allTasks.reduce((s: number, t: any) => s + Number(t.estimated_hrs||0), 0)
  const totalBillable = allTasks.reduce((s: number, t: any) => s + (t.time_entries||[]).filter((e: any)=>e.billable).reduce((x: number, e: any)=>x+Number(e.hours),0), 0)
  const doneCount     = allTasks.filter((t: any) => t.status === 'done').length

  const TASK_VARIANT: Record<string, BadgeProps['variant']> = {
    todo:        'default',
    in_progress: 'warning',
    done:        'info',
  }
  const TASK_LABEL: Record<string, string> = {
    todo:        'To Do',
    in_progress: 'In Progress',
    done:        'Done',
  }

  return (
    <div className="bg-surface border-t border-line-subtle">
      <div className="flex flex-wrap gap-5 items-center px-4 py-2 pl-10 border-b border-line-subtle">
        <span className="text-xs text-muted">
          <strong className="text-primary">{doneCount}</strong>/{allTasks.length} tasks done
        </span>
        <span className="text-xs text-muted">
          <strong className="text-primary">{totalLogged.toFixed(1)}h</strong> logged
          {totalEst > 0 ? <> / <strong className="text-secondary">{totalEst.toFixed(1)}h</strong> est</> : null}
        </span>
        <span className="text-xs text-muted">
          <strong className="text-accent">{totalBillable.toFixed(1)}h</strong> billable
        </span>
        <Link
          href={`/projects/${projectId}`}
          className="ml-auto text-sm text-accent font-medium no-underline"
          onClick={e => e.stopPropagation()}
        >
          Open full project →
        </Link>
      </div>

      {phases.map((phase: any) => (
        <div key={phase.id}>
          <div
            className="grid px-4 py-1.5 pl-10 bg-surface-overlay border-b border-line-subtle"
            style={{ gridTemplateColumns: '24px minmax(120px,1fr) 90px 60px 56px 56px 70px' }}
          >
            <div />
            <div className="text-[10px] font-bold text-muted uppercase tracking-wider">
              {phase.name} ({phase.tasks?.length || 0})
            </div>
            {['Assignees','Status','Est.','Logged','Progress'].map(h => (
              <div key={h} className="text-[9px] font-bold uppercase tracking-wider text-muted text-right">{h}</div>
            ))}
          </div>
          {(phase.tasks||[]).map((task: any, ti: number) => {
            const logged   = (task.time_entries||[]).reduce((s: number, e: any)=>s+Number(e.hours),0)
            const billable = (task.time_entries||[]).filter((e: any)=>e.billable).reduce((s: number, e: any)=>s+Number(e.hours),0)
            const est      = Number(task.estimated_hrs)||0
            const pct      = est>0?Math.min(Math.round((logged/est)*100),100):0
            const isOverdue= task.due_date && task.due_date<todayLocalISO() && task.status!=='done'
            const isLastTask = ti >= (phase.tasks?.length || 0) - 1
            return (
              <div
                key={task.id}
                className={cn(
                  'grid items-center px-4 py-2 pl-10 transition-all duration-150',
                  'hover:bg-surface-hover hover:shadow-[inset_2px_0_0_0_var(--accent)]',
                  !isLastTask && 'border-b border-line-subtle',
                )}
                style={{ gridTemplateColumns: '24px minmax(120px,1fr) 90px 60px 56px 56px 70px' }}
              >
                <div className="flex justify-center">
                  <div
                    className={cn(
                      'w-[5px] h-[5px] rounded-full opacity-60',
                      task.status === 'done' ? 'bg-muted' : 'bg-accent',
                    )}
                  />
                </div>
                <div>
                  <span
                    className={cn(
                      'text-base font-medium',
                      task.status === 'done' ? 'text-muted line-through' : 'text-primary',
                    )}
                  >
                    {task.title}
                  </span>
                  {isOverdue && (
                    <span className="ml-1.5 text-[9px] font-bold text-status-rose bg-status-rose-dim px-1 py-px rounded-sm">
                      OVERDUE
                    </span>
                  )}
                </div>
                <div className="flex gap-0.5 justify-end items-center">
                  {(task.task_assignees||[]).slice(0,3).map((a: any, ai: number) => (
                    <div
                      key={ai}
                      title={a.users?.name || ''}
                      className="w-[18px] h-[18px] rounded-full bg-accent-dim border border-line-accent flex items-center justify-center text-[7px] font-bold text-accent"
                    >
                      {(a.users?.name || '?').split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                    </div>
                  ))}
                  {(task.task_assignees||[]).length === 0 && <span className="text-[10px] text-muted">—</span>}
                </div>
                <div className="text-right">
                  <Badge variant={TASK_VARIANT[task.status] || 'default'}>
                    {TASK_LABEL[task.status] || task.status}
                  </Badge>
                </div>
                <div className="text-right text-sm text-secondary">{est > 0 ? `${est}h` : '—'}</div>
                <div className={cn('text-right text-sm', logged > est && est > 0 ? 'text-status-rose' : 'text-secondary')}>
                  {logged > 0 ? `${logged.toFixed(1)}h` : '—'}
                </div>
                <div className="flex items-center gap-1 justify-end">
                  <div className="w-10 h-1 bg-surface-overlay rounded-sm overflow-hidden">
                    <div
                      className={cn('h-full rounded-sm', pct >= 100 ? 'bg-status-rose' : 'bg-accent')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted min-w-[24px] text-right tabular-nums">{pct}%</span>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Single project row ──────────────────────────────────────────────────────────────────────────
function ProjectRow({ p, isLast, expanded, onToggle }: { p: any; isLast: boolean; expanded: boolean; onToggle: () => void }) {
  const logged    = p.stats?.loggedHrs    || 0
  const est       = p.stats?.estimatedHrs || 0
  const tasks     = p.stats?.taskCount    || 0
  const done      = p.stats?.doneCount    || 0
  const teamCount = p.stats?.teamCount    || 0
  const pct       = est > 0 ? Math.min(Math.round((logged / est) * 100), 100) : 0
  const dl        = daysLeft(p.end_date)
  const hb        = healthBadge(pct, p.status)
  const barColor  = pct >= 100 ? 'bg-status-rose' : pct >= 85 ? 'bg-status-amber' : 'bg-[#10B981]'
  const pctColor  = pct >= 100 ? 'text-status-rose' : pct >= 85 ? 'text-status-amber' : 'text-[#10B981]'

  return (
    <div className={cn(!(isLast && !expanded) && 'border-b border-line-subtle')}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        className={cn(
          'grid items-center px-3.5 py-2 cursor-pointer transition-all duration-150',
          // Left-edge accent on hover — subtle "you're on a row" signal
          // without the density-hostile look of a full zebra stripe.
          'hover:bg-surface-hover hover:shadow-[inset_2px_0_0_0_var(--accent)]',
          expanded ? 'bg-surface' : 'bg-surface-raised',
        )}
        style={{ gridTemplateColumns: ROW_GRID_COLS, columnGap: 14 }}
      >
        {/* Chevron */}
        <div className="text-center select-none">
          <ChevronDown
            size={12}
            className={cn('text-muted transition-transform duration-150', !expanded && '-rotate-90')}
          />
        </div>

        {/* Name + color + labels */}
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-1 h-5 rounded-sm flex-shrink-0"
            style={{ background: p.color || '#0D9488' }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link
                href={`/projects/${p.id}`}
                onClick={e => e.stopPropagation()}
                className="text-base font-semibold text-primary no-underline truncate hover:text-accent"
              >
                {p.name}
              </Link>
              {(p.labels || []).map((l: any) => (
                <span
                  key={l.id}
                  className="text-[9px] font-bold px-1 py-px rounded-md whitespace-nowrap flex-shrink-0 border"
                  style={{
                    background: `${l.color || '#888'}22`,
                    color: l.color || '#888',
                    borderColor: `${l.color || '#888'}44`,
                  }}
                >
                  {l.name}
                </span>
              ))}
            </div>
            {tasks > 0 && (
              <div className="text-[10px] text-muted mt-px">{done}/{tasks} tasks done</div>
            )}
          </div>
        </div>

        {/* Budget — surfaces whichever of {budget_amount, budget_hrs} is populated.
            Retainers in hours mode show "40h / month"; amount mode shows currency. */}
        <div>
          <span className="text-[10px] font-semibold text-muted bg-surface-overlay px-1.5 py-px rounded-sm mr-1">
            {BUDGET_LABEL[p.budget_type] || 'Fixed'}
          </span>
          <span className="text-sm text-secondary">
            {p.budget_hrs
              ? `${Number(p.budget_hrs).toLocaleString()}h${p.budget_type === 'retainer' ? ' / mo' : ''}`
              : p.budget_amount
              ? `${p.currency || 'AED'} ${Number(p.budget_amount).toLocaleString()}`
              : '—'}
          </span>
        </div>

        {/* Team */}
        <div className="text-sm text-muted text-center overflow-hidden">
          {teamCount > 0 ? (
            <span
              title={`${teamCount} team member${teamCount !== 1 ? 's' : ''}`}
              className="flex items-center justify-center gap-0.5"
            >
              <Users size={12} className="text-muted" />
              <span className="text-xs">{teamCount}</span>
            </span>
          ) : '—'}
        </div>

        {/* Progress */}
        {est > 0 ? (
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-[10px] text-muted tabular-nums">
                {logged.toFixed(1)}h / {est.toFixed(1)}h
              </span>
              <span className={cn('text-xs font-bold tabular-nums', pctColor)}>{pct}%</span>
            </div>
            <div className="h-1 bg-surface-overlay rounded-sm overflow-hidden">
              <div
                className={cn('h-full rounded-sm transition-[width] duration-300', barColor)}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}

        {/* Days remaining */}
        <div className={cn('overflow-hidden whitespace-nowrap text-xs', dl.className, dl.bold && 'font-semibold')}>
          {dl.label}
        </div>

        {/* Health badge */}
        <div>
          <Badge variant={hb.variant}>{hb.label}</Badge>
        </div>
      </div>

      {expanded && <ProjectTasks projectId={p.id} currency={p.currency || 'AED'} />}
    </div>
  )
}

// ── Client sub-group (nested inside a status section) ──────────────────────────────────────────
function ClientGroup({ clientName, projects, expanded, onToggle, isLast }: {
  clientName: string; projects: any[]; expanded: Set<string>; onToggle: (id: string) => void; isLast: boolean
}) {
  const [open, setOpen] = useState(true)
  const totalBudget = projects.reduce((s, p) => s + Number(p.budget_amount || 0), 0)
  const currency    = projects[0]?.currency || 'AED'
  const initials = clientName === NO_CLIENT_KEY
    ? '—'
    : clientName.split(' ').map(w => w[0]).filter(Boolean).slice(0,2).join('').toUpperCase()

  return (
    <div className={cn(!isLast && 'border-b border-line-subtle')}>
      {/* Client sub-header */}
      <div
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2 px-3.5 py-1.5 cursor-pointer select-none hover:bg-surface-hover transition-colors bg-surface',
          open && 'border-b border-line-subtle',
        )}
      >
        <ChevronDown
          size={11}
          className={cn('text-muted transition-transform duration-150', !open && '-rotate-90')}
        />
        <div className="w-5 h-5 rounded-sm bg-accent-dim border border-line-accent flex items-center justify-center text-[9px] font-bold text-accent flex-shrink-0">
          {initials}
        </div>
        <span className="text-sm font-semibold text-primary truncate">{clientName}</span>
        <span className="text-[11px] font-semibold text-muted bg-surface-overlay px-1.5 py-px rounded-md ml-0.5">
          {projects.length}
        </span>
        {totalBudget > 0 && (
          <span className="text-[11px] text-muted ml-1">· {currency} {totalBudget.toLocaleString()}</span>
        )}
      </div>

      {/* Project rows */}
      {open && projects.map((p, i) => (
        <ProjectRow
          key={p.id}
          p={p}
          isLast={i === projects.length - 1}
          expanded={expanded.has(p.id)}
          onToggle={() => onToggle(p.id)}
        />
      ))}
    </div>
  )
}

// ── Status section (outer) — contains one or more ClientGroups ─────────────────────────────────
function StatusSection({ status, clientGroups, expanded, onToggle }: {
  status: string
  clientGroups: Array<[string, any[]]>
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  // Collapsed by default so the page opens at a glance; users click a section
  // to drill in. Running is the most-used one but even that stays collapsed for
  // consistency — we can revisit if Murtaza asks.
  const [open, setOpen] = useState(false)
  const cfg = STATUS_CFG[status] || STATUS_CFG.running
  const allProjects = clientGroups.flatMap(([, ps]) => ps)
  const totalBudget = allProjects.reduce((s, p) => s + Number(p.budget_amount || 0), 0)
  const currency    = allProjects[0]?.currency || 'AED'
  const StatusIcon  = STATUS_ICONS[status] || Play

  return (
    <div className="mb-4 border border-line-subtle rounded-lg overflow-hidden">
      {/* Section header */}
      <div
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2.5 px-3.5 py-2 cursor-pointer select-none hover:opacity-85 transition-opacity',
          cfg.sectionBg,
          open && 'border-b border-line-subtle',
        )}
      >
        <StatusIcon size={14} className={cfg.iconClass} />
        <span className="text-lg font-bold text-primary">{cfg.label}</span>
        <span className="text-sm font-semibold text-secondary bg-surface-overlay px-2 py-px rounded-lg ml-0.5">
          {allProjects.length}
        </span>
        <span className="text-xs text-muted ml-1">
          · {clientGroups.length} client{clientGroups.length !== 1 ? 's' : ''}
        </span>
        {totalBudget > 0 && (
          <span className="text-xs text-muted ml-1">· {currency} {totalBudget.toLocaleString()} total</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ChevronDown
            size={14}
            className={cn('text-muted transition-transform duration-150', !open && '-rotate-90')}
          />
        </div>
      </div>

      {/* Column headers (only when open) */}
      {open && (
        <div
          className="grid px-3.5 py-1.5 bg-surface-overlay border-b border-line-subtle"
          style={{ gridTemplateColumns: ROW_GRID_COLS, columnGap: 14 }}
        >
          <div />
          {['Project','Budget','Team','Progress','Timeline','Status'].map(h => (
            <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
          ))}
        </div>
      )}

      {/* Client groups */}
      {open && clientGroups.map(([clientName, projects], i) => (
        <ClientGroup
          key={clientName}
          clientName={clientName}
          projects={projects}
          expanded={expanded}
          onToggle={onToggle}
          isLast={i === clientGroups.length - 1}
        />
      ))}
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const qc = useQueryClient()
  const { isAdmin } = useAuthStore()
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set())
  const [showCreate,  setShowCreate]  = useState(false)
  const [search,      setSearch]      = useState('')
  const [labelFilter, setLabelFilter] = useState<string | null>(null)
  const [labelsOpen,  setLabelsOpen]  = useState(false)
  const [stripFilter, setStripFilter] = useState<string | null>(null)
  // retainer_mode is UI-only — doesn't map to a DB column. It gates which of
  // { budget_amount, budget_hrs } we send: mode=amount → budget_amount (currency),
  // mode=hours → budget_hrs. Applies only when budget_type === 'retainer'.
  //
  // source_project_id is the planning-stage project (if any) we're cloning
  // phases/tasks from — "template" in user-facing terms (Apr 23 — Murtaza).
  const [form, setForm] = useState({ name:'', client_id:'', status:'running', color:'#0D9488', budget_type:'fixed_price', retainer_mode:'amount', budget_amount:'', budget_hrs:'', currency:'AED', start_date:'', end_date:'', billable:true, source_project_id:'' })

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  const { data: raw, isLoading } = useQuery({ queryKey:['projects-all'], queryFn:()=>projectsApi.list().then((r:any)=>r.data), staleTime:30_000 })
  const { data: clientsRaw }     = useQuery({ queryKey:['clients'], queryFn:()=>usersApi.clients().then((r:any)=>r.data), enabled:isAdmin() })
  const { data: labelsRaw }      = useQuery({ queryKey:['labels'],  queryFn:()=>usersApi.labels().then((r:any)=>r.data),   staleTime:60_000 })
  // Templates = planning-stage projects (Apr 23 — Murtaza). We don't use the
  // legacy /templates endpoint (project_templates table is empty).
  const { data: templatesRaw }   = useQuery({ queryKey:['project-templates'], queryFn:()=>projectsApi.templates().then((r:any)=>r.data), enabled:isAdmin(), staleTime:60_000 })

  const create = useMutation({
    mutationFn: () => {
      // Strip UI-only retainer_mode and translate to the right budget column.
      // - retainer + mode=hours  → budget_hrs set, budget_amount undefined
      // - retainer + mode=amount → budget_amount set, budget_hrs undefined
      // - fixed_price / time_and_materials → budget_amount only (for fixed_price)
      const { retainer_mode, budget_hrs, budget_amount, ...rest } = form
      const payload: any = { ...rest }
      if (form.budget_type === 'retainer') {
        if (retainer_mode === 'hours') {
          payload.budget_hrs    = budget_hrs    ? Number(budget_hrs)    : undefined
          payload.budget_amount = undefined
        } else {
          payload.budget_amount = budget_amount ? Number(budget_amount) : undefined
          payload.budget_hrs    = undefined
        }
      } else if (form.budget_type === 'fixed_price') {
        payload.budget_amount = budget_amount ? Number(budget_amount) : undefined
        payload.budget_hrs    = undefined
      } else {
        // time_and_materials — no upfront budget
        payload.budget_amount = undefined
        payload.budget_hrs    = undefined
      }
      return projectsApi.create(payload)
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey:['projects-all'] })
      setShowCreate(false)
      setForm({ name:'',client_id:'',status:'running',color:'#0D9488',budget_type:'fixed_price',retainer_mode:'amount',budget_amount:'',budget_hrs:'',currency:'AED',start_date:'',end_date:'',billable:true,source_project_id:'' })
      if (data?.data?.id) window.location.href=`/projects/${data.data.id}`
    },
  })

  const allProjects: any[] = raw || []
  const allLabels: any[]   = labelsRaw || []

  // Date constants for expiry filters
  const todayStr = todayLocalISO()
  const d30 = dateLocalISO(new Date(Date.now() + 30*86400000))
  const d60 = dateLocalISO(new Date(Date.now() + 60*86400000))

  // Filter
  const filtered = allProjects.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.clients?.name||'').toLowerCase().includes(search.toLowerCase())
    const matchLabel  = !labelFilter || (p.labels||[]).some((l:any)=>l.id===labelFilter)
    // Strip filter (admin expired/expiring)
    if (stripFilter === 'expired') return matchSearch && matchLabel && p.end_date && p.end_date < todayStr
    if (stripFilter === 'exp30')   return matchSearch && matchLabel && p.end_date && p.end_date >= todayStr && p.end_date <= d30
    if (stripFilter === 'exp60')   return matchSearch && matchLabel && p.end_date && p.end_date > d30 && p.end_date <= d60
    return matchSearch && matchLabel
  })

  // Nested grouping: status → client → projects. Mirrors Forecast.it's
  // /projects layout where clients are grouped under their status bucket.
  const nested: Record<string, Record<string, any[]>> = {}
  for (const p of filtered) {
    const status = p.status
    const client = p.clients?.name || NO_CLIENT_KEY
    if (!nested[status]) nested[status] = {}
    if (!nested[status][client]) nested[status][client] = []
    nested[status][client].push(p)
  }
  // Sort clients alphabetically (No Client last) and projects within a client
  // alphabetically — status order is already handled by the outer section.
  const nestedSorted: Record<string, Array<[string, any[]]>> = {}
  for (const status of Object.keys(nested)) {
    const clientKeys = Object.keys(nested[status]).sort((a, b) => {
      if (a === NO_CLIENT_KEY) return 1
      if (b === NO_CLIENT_KEY) return -1
      return a.localeCompare(b)
    })
    nestedSorted[status] = clientKeys.map(k => {
      const projs = [...nested[status][k]].sort((a, b) => a.name.localeCompare(b.name))
      return [k, projs] as [string, any[]]
    })
  }

  // KPI summaries
  const running = allProjects.filter(p=>p.status==='running')
  const halted  = allProjects.filter(p=>p.status==='halted')
  const done    = allProjects.filter(p=>p.status==='done')
  const expired     = running.filter(p=>p.end_date && p.end_date < todayStr)
  const expiring30  = running.filter(p=>p.end_date && p.end_date >= todayStr && p.end_date <= d30)
  const expiring60  = running.filter(p=>p.end_date && p.end_date > d30 && p.end_date <= d60)
  const retainerRev = running.filter(p=>p.budget_type==='retainer').reduce((s,p)=>s+Number(p.budget_amount||0),0)
  const fixedRev    = running.filter(p=>p.budget_type==='fixed_price').reduce((s,p)=>s+Number(p.budget_amount||0),0)

  type StripItem = {
    key: string
    label: string
    value: React.ReactNode
    sub: string
    tone: 'default' | 'accent' | 'amber' | 'rose' | 'violet'
    clickable: boolean
  }
  const stripItems: StripItem[] = [
    { key: 'expired',  label: 'Expired',          value: expired.length,    sub: 'projects past end date', tone: expired.length > 0 ? 'rose' : 'default',     clickable: true  },
    { key: 'exp30',    label: 'Expiring 30d',     value: expiring30.length, sub: 'ending within 30 days',  tone: expiring30.length > 0 ? 'amber' : 'default', clickable: true  },
    { key: 'exp60',    label: 'Expiring 60d',     value: expiring60.length, sub: 'ending 30–60 days',      tone: 'default',                                    clickable: true  },
    { key: 'retainer', label: 'Retainer Revenue', value: retainerRev > 0 ? `AED ${(retainerRev/1000).toFixed(0)}k` : '—', sub: `${running.filter(p=>p.budget_type==='retainer').length} retainer projects`, tone: 'accent', clickable: false },
    { key: 'fixed',    label: 'Project Revenue',  value: fixedRev    > 0 ? `AED ${(fixedRev/1000).toFixed(0)}k`    : '—', sub: `${running.filter(p=>p.budget_type==='fixed_price').length} fixed price`,    tone: 'accent', clickable: false },
  ]

  return (
    <div className="px-7 py-6">

      <PageHeader
        title="Projects"
        actions={
          isAdmin() ? (
            <Button onClick={() => setShowCreate(s => !s)} variant={showCreate ? 'secondary' : 'primary'}>
              {showCreate ? 'Cancel' : <><Plus size={14} /> New Project</>}
            </Button>
          ) : undefined
        }
      />

      {/* KPI strip — admins only */}
      {isAdmin() && (
        <div className="grid grid-cols-5 gap-2.5 mb-[18px]">
          {stripItems.map(s => {
            const active = stripFilter === s.key
            const onClick = s.clickable
              ? () => setStripFilter(stripFilter === s.key ? null : s.key)
              : undefined
            return (
              <div
                key={s.key}
                onClick={onClick}
                className={cn(
                  s.clickable && 'cursor-pointer',
                  active && 'ring-1 ring-accent',
                  'rounded-md',
                )}
              >
                <StatCard
                  label={s.label}
                  value={s.value}
                  sub={s.sub}
                  tone={s.tone}
                  className={cn(active && 'bg-accent-dim border-accent')}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* KPI strip — collaborators (Active / Halted / Done counts only, no financial data) */}
      {!isAdmin() && (
        <div className="grid grid-cols-3 gap-2.5 mb-[18px]">
          <StatCard label="Running" value={running.length} sub="in progress" tone="accent" />
          <StatCard label="Halted"  value={halted.length}  sub="on hold"     tone="amber" />
          <StatCard label="Done"    value={done.length}    sub="completed"   tone="default" />
        </div>
      )}

      {/* Create form */}
      {showCreate && isAdmin() && (
        <Card className="p-5 mb-4">
          <div className="text-lg font-semibold text-primary mb-3.5">New Project</div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="col-span-full">
              <Label htmlFor="new-project-name">Project Name *</Label>
              <Input
                id="new-project-name"
                autoFocus
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Invisalign SEO 2026"
                onKeyDown={e => e.key === 'Enter' && form.name && create.mutate()}
              />
            </div>
            <div>
              <Label htmlFor="new-project-client">Client *</Label>
              <Combobox
                id="new-project-client"
                value={form.client_id || null}
                onChange={v => setForm(f => ({ ...f, client_id: (v as string) || '' }))}
                options={(clientsRaw || []).map((c: any) => ({ value: c.id as string, label: c.name }))}
                placeholder="Select a client *"
                searchPlaceholder="Search clients…"
                emptyMessage="No clients match"
                className={cn(form.name && !form.client_id && '[&>button]:border-status-rose')}
              />
            </div>
            <div>
              <Label htmlFor="new-project-status">Status</Label>
              <Select
                id="new-project-status"
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              >
                {/* "opportunity" removed from the create-project dropdown (Apr 23 — Murtaza). */}
                {(['planning','running','halted','done'] as string[]).map(s => (
                  <option key={s} value={s}>{STATUS_CFG[s]?.label || s}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="new-project-template">Template (optional)</Label>
              <Select
                id="new-project-template"
                value={form.source_project_id}
                onChange={e => setForm(f => ({ ...f, source_project_id: e.target.value }))}
                disabled={!(templatesRaw || []).length}
              >
                <option value="">
                  {(templatesRaw || []).length ? '— No template —' : 'No templates yet — add one in the Templates section'}
                </option>
                {(templatesRaw || []).map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.phase_count || 0} phases, {t.task_count || 0} tasks)
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="new-project-budget-type">Budget Type</Label>
              <Select
                id="new-project-budget-type"
                value={form.budget_type}
                onChange={e => setForm(f => ({ ...f, budget_type: e.target.value }))}
              >
                <option value="fixed_price">Fixed Price</option>
                <option value="time_and_materials">Time &amp; Materials</option>
                <option value="retainer">Retainer</option>
              </Select>
            </div>
            {/* Second column is a dynamic pair (Apr 23 — Murtaza):
                  • Retainer  → sub-type picker + matching second field (AED or hrs)
                  • Fixed Price → Budget Amount (currency)
                  • T&M        → nothing (no upfront budget)
                This keeps the grid layout stable because we always render SOMETHING
                in the budget slot (or an invisible spacer for T&M). */}
            {form.budget_type === 'retainer' ? (
              <>
                <div>
                  <Label htmlFor="new-project-retainer-mode">Retainer Type</Label>
                  <Select
                    id="new-project-retainer-mode"
                    value={form.retainer_mode}
                    onChange={e => setForm(f => ({ ...f, retainer_mode: e.target.value }))}
                  >
                    <option value="amount">Fixed Monthly Amount</option>
                    <option value="hours">Fixed Monthly Hours</option>
                  </Select>
                </div>
                {form.retainer_mode === 'hours' ? (
                  <div>
                    <Label htmlFor="new-project-budget-hrs">Monthly Hours</Label>
                    <Input
                      id="new-project-budget-hrs"
                      type="number"
                      value={form.budget_hrs}
                      onChange={e => setForm(f => ({ ...f, budget_hrs: e.target.value }))}
                      placeholder="e.g. 40"
                    />
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="new-project-budget-amount">Monthly Amount ({form.currency})</Label>
                    <Input
                      id="new-project-budget-amount"
                      type="number"
                      value={form.budget_amount}
                      onChange={e => setForm(f => ({ ...f, budget_amount: e.target.value }))}
                      placeholder="e.g. 18000"
                    />
                  </div>
                )}
              </>
            ) : form.budget_type === 'fixed_price' ? (
              <div>
                <Label htmlFor="new-project-budget-amount">Budget Amount ({form.currency})</Label>
                <Input
                  id="new-project-budget-amount"
                  type="number"
                  value={form.budget_amount}
                  onChange={e => setForm(f => ({ ...f, budget_amount: e.target.value }))}
                  placeholder="e.g. 45000"
                />
              </div>
            ) : (
              // T&M: no upfront budget — render an empty cell to preserve grid rhythm
              <div aria-hidden />
            )}
            <div>
              <Label htmlFor="new-project-start">Start Date</Label>
              <DatePicker
                id="new-project-start"
                value={form.start_date || null}
                onChange={v => setForm(f => ({ ...f, start_date: v || '' }))}
                placeholder="Pick start date"
                clearable
              />
            </div>
            <div>
              <Label htmlFor="new-project-end">End Date</Label>
              <DatePicker
                id="new-project-end"
                value={form.end_date || null}
                onChange={v => setForm(f => ({ ...f, end_date: v || '' }))}
                placeholder="Pick end date"
                min={form.start_date || undefined}
                clearable
              />
            </div>
            <div>
              <Label>Billable</Label>
              <div
                onClick={() => setForm(f => ({ ...f, billable: !f.billable }))}
                className="flex items-center gap-2 cursor-pointer py-1.5"
                role="switch"
                aria-checked={form.billable}
              >
                <div
                  className={cn(
                    'w-9 h-5 rounded-xl border border-line-muted transition-colors relative',
                    form.billable ? 'bg-accent' : 'bg-surface-overlay',
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded-full bg-white absolute top-px transition-[left] duration-200 shadow-sm',
                      form.billable ? 'left-[17px]' : 'left-px',
                    )}
                  />
                </div>
                <span
                  className={cn(
                    'text-sm font-medium',
                    form.billable ? 'text-accent' : 'text-muted',
                  )}
                >
                  {form.billable ? 'Billable' : 'Non-billable'}
                </span>
              </div>
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex gap-1.5 flex-wrap">
                {COLORS.map(c => (
                  <div
                    key={c}
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={cn(
                      'w-[26px] h-[26px] rounded-sm cursor-pointer transition-transform duration-100',
                      form.color === c ? 'border-2 border-white scale-110' : 'border-2 border-transparent',
                    )}
                    style={{ background: c }}
                    role="button"
                    aria-label={`Pick color ${c}`}
                    aria-pressed={form.color === c}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-center pt-3 border-t border-line-subtle">
            <Button
              variant="primary"
              onClick={() => create.mutate()}
              disabled={!form.name || !form.client_id || create.isPending}
              loading={create.isPending}
            >
              {create.isPending ? 'Creating...' : 'Create Project'}
            </Button>
            {create.isError && <span className="text-sm text-status-rose">Failed — try again</span>}
          </div>
        </Card>
      )}

      {/* Search + label filters */}
      <div className="flex gap-2 mb-3.5 items-center flex-wrap">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search projects or clients…"
          className="w-60 py-1.5 text-sm"
        />
        {allLabels.length > 0 && (() => {
          const activeLabel = labelFilter ? allLabels.find((l: any) => l.id === labelFilter) : null
          return (
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => setLabelsOpen(o => !o)}
                className={cn(
                  'flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-lg border cursor-pointer transition-colors',
                  activeLabel
                    ? 'border-line-subtle bg-transparent'
                    : 'border-line-subtle bg-transparent text-muted',
                )}
                style={activeLabel ? {
                  borderColor: activeLabel.color || '#888',
                  background: `${activeLabel.color || '#888'}22`,
                  color: activeLabel.color || undefined,
                } : undefined}
                aria-expanded={labelsOpen}
              >
                <span className="font-semibold">Label:</span>
                <span className={activeLabel ? 'font-bold' : ''}>{activeLabel?.name || 'All'}</span>
                <ChevronDown size={12} className={cn('transition-transform', !labelsOpen && '-rotate-90')} />
              </button>
              {labelsOpen && (
                <div className="flex flex-wrap gap-1.5 p-2 bg-surface-overlay border border-line-subtle rounded-lg">
                  <button
                    onClick={() => { setLabelFilter(null); setLabelsOpen(false) }}
                    className={cn(
                      'text-xs px-2.5 py-0.5 rounded-lg border cursor-pointer transition-colors',
                      !labelFilter
                        ? 'border-accent bg-accent-dim text-accent font-bold'
                        : 'border-line-subtle bg-transparent text-muted',
                    )}
                    aria-pressed={!labelFilter}
                  >
                    All
                  </button>
                  {allLabels.map((l: any) => {
                    const active = labelFilter === l.id
                    return (
                      <button
                        key={l.id}
                        onClick={() => { setLabelFilter(prev => prev === l.id ? null : l.id); setLabelsOpen(false) }}
                        className={cn(
                          'text-xs px-2.5 py-0.5 rounded-lg border cursor-pointer transition-all',
                          active ? 'font-bold' : 'font-normal text-muted',
                        )}
                        style={{
                          borderColor: active ? (l.color || '#888') : `${l.color || '#888'}44`,
                          background: active ? `${l.color || '#888'}22` : 'transparent',
                          color: active ? (l.color || '#888') : undefined,
                        }}
                        aria-pressed={active}
                      >
                        {l.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
        {expanded.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(new Set())}
            className="ml-auto"
          >
            Collapse all
          </Button>
        )}
      </div>

      {/* Project sections grouped by status */}
      {isLoading && (
        <Card className="overflow-hidden">
          <SkeletonTable rows={8} />
        </Card>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <EmptyState
            variant={search ? 'search' : 'projects'}
            title={search ? 'No projects match your search' : 'No projects yet'}
            description={search
              ? 'Try a different keyword, or clear the search to see everything.'
              : 'Projects will show up here once you create one or sync from Forecast.it.'
            }
            action={
              isAdmin() && !search ? (
                <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                  Create your first project →
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {!isLoading && SECTION_ORDER.filter(s => nestedSorted[s]?.length).map(status => (
        <StatusSection
          key={status}
          status={status}
          clientGroups={nestedSorted[status]}
          expanded={expanded}
          onToggle={toggleExpand}
        />
      ))}

      <div className="text-xs text-muted mt-1">
        {filtered.length} projects · Click any row to expand tasks · Click project name to open
      </div>
    </div>
  )
}
