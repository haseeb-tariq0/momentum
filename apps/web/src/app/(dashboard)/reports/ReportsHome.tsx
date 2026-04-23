'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui'
import { useAuthStore } from '@/lib/store'
import { canSeeReport, type ReportSlug } from '@/lib/reportVisibility'
import { reportsApi } from '@/lib/queries'
import { showToast } from '@/components/Toast'
import {
  Clock, TrendingUp, FolderKanban,
  Plus, Star, Trash2, Gauge, CheckSquare, Loader2,
  Building2, Receipt, ListTodo, Activity, FileText, BarChart3,
} from 'lucide-react'

// ─── Template catalog ──────────────────────────────────────────────────────────
// Apr 22 — restored Partner Report, Partner Billing, Task Report, Project
// Progress, Client Timesheet, and P&L after cross-checking the Apr 17
// meeting transcript. Only Cost of Effort stays deleted (Murtaza explicitly
// approved it). Visibility still flows through canSeeReport() for the 3-tier
// role spec — so collaborators still see only 2 reports, account managers
// see 4, admins see all except P&L, and super_admins see all 11.
//
// Stubs are clearly labelled as such in the description so Murtaza can spot
// which ones are placeholders vs fully-built during Phase-1 QA.
type Template = {
  key: ReportSlug
  label: string
  description: string
  Icon: any
  stub?: boolean  // renders a small "Stub" tag so UI reviewers know at a glance
}

const TEMPLATES: Template[] = [
  // Phase-1 finished reports ────────────────────────────────────────────────
  { key: 'time',                 label: 'Time Registered',      description: 'All time entries across the org — filter by client, project, person', Icon: Clock        },
  { key: 'utilization',          label: 'Utilization',          description: 'Team workload vs. capacity — who is over / under',                    Icon: Gauge        },
  { key: 'active-projects',      label: 'Active Projects',      description: 'Live pipeline — expiring in 30 / 60 / 90 days',                       Icon: FolderKanban },
  { key: 'client-profitability', label: 'Client Profitability', description: 'Revenue minus cost of effort per client',                             Icon: TrendingUp   },
  { key: 'compliance',           label: 'Compliance',           description: 'Who submitted their timesheet this week',                             Icon: CheckSquare  },
  // Restored + wired (Apr 22) — partner report / billing shipped live ----────────────────────────
  { key: 'partner-report',       label: 'Partner Report',       description: 'Per-partner hours × departmental rate card — save a view per partner',      Icon: Building2    },
  { key: 'partner-billing',      label: 'Partner Billing',      description: 'Billing + net revenue by partner with Nexa sub-client rollup',            Icon: Receipt      },
  // Remaining Phase-2 stubs — bodies still placeholder ---------------------
  { key: 'task-report',          label: 'Task Report',          description: 'Task-centric view: estimated vs logged, status, assignees',                    Icon: ListTodo,  stub: true },
  { key: 'project-progress',     label: 'Project Progress',     description: 'Burn-down per project: budget, hours, days remaining',                         Icon: Activity,  stub: true },
  { key: 'client-timesheet',     label: 'Client Timesheet',     description: 'Client-scoped timesheet view — scope TBD',                                     Icon: FileText,  stub: true },
  // Phase-2 placeholder ─────────────────────────────────────────────────────
  { key: 'pnl',                  label: 'P&L',                  description: 'Profit & loss — confidential, Phase 2 (super admin only)',                     Icon: BarChart3, stub: true },
]

// ─── Favorite config shape ────────────────────────────────────────────────────
// Persisted server-side in `saved_report_configs` (per-user). The legacy
// {name, tab, from, to} shape from the localStorage era is projected onto the
// server shape: tab → report_type, {from, to} live inside `config`.
type ServerFavorite = {
  id: string
  name: string
  report_type: string
  config: { from?: string; to?: string } & Record<string, unknown>
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function ReportsHome() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const profile = user?.permissionProfile ?? null

  const { data: favoritesResp, isLoading: favLoading } = useQuery({
    queryKey: ['report-configs'],
    queryFn: () => reportsApi.configs().then((r: any) => r.data),
    staleTime: 30_000,
  })
  const favorites: ServerFavorite[] = favoritesResp || []

  const deleteMut = useMutation({
    mutationFn: (id: string) => reportsApi.deleteConfig(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-configs'] })
      showToast('Saved report removed', 'success')
    },
    onError: (err: any) => {
      showToast(err?.message || 'Failed to remove saved report', 'error')
    },
  })

  // Templates the current user is allowed to see.
  const visibleTemplates = TEMPLATES.filter(t => canSeeReport(t.key, profile))

  // Favorites list filtered so a user can't bypass the role gate by clicking
  // a favorite saved earlier under a higher permission profile.
  const visibleFavorites = favorites.filter(f => canSeeReport(f.report_type as ReportSlug, profile))

  function openReport(slug: string, from?: string, to?: string, filters?: Record<string, unknown>) {
    const params = new URLSearchParams({ r: slug })
    if (from) params.set('from', from)
    if (to)   params.set('to',   to)
    // Forward saved filter state as URL params so the detail view can replay
    // the view exactly (client, person, project, dept, etc.). Prefixed with
    // `f_` so they don't collide with other URL params.
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        if (v != null && v !== '') params.set(`f_${k}`, String(v))
      }
    }
    router.push(`/reports?${params.toString()}`)
  }

  function onDeleteFavorite(id: string) {
    deleteMut.mutate(id)
  }

  return (
    <div>
      {/* ─── Your Reports (favorites) ─────────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-semibold text-primary">Your Reports</h1>
          </div>
        </div>

        {favLoading ? (
          <Card className="p-6">
            <div className="flex items-center gap-3 text-muted">
              <Loader2 size={18} className="animate-spin" />
              <div className="text-sm">Loading your saved reports…</div>
            </div>
          </Card>
        ) : visibleFavorites.length === 0 ? (
          <Card className="p-6">
            <div className="flex items-center gap-3 text-muted">
              <Star size={18} />
              <div>
                <div className="text-sm text-primary">No saved reports yet.</div>
                <div className="text-xs">Open any report below, set your filters, and save it as a favorite to see it here.</div>
              </div>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleFavorites.map(f => {
              const template = TEMPLATES.find(t => t.key === f.report_type)
              const Icon = template?.Icon || Star
              const from = f.config?.from as string | undefined
              const to   = f.config?.to   as string | undefined
              return (
                <Card
                  key={f.id}
                  className="p-4 group cursor-pointer hover:border-accent transition-colors"
                  onClick={() => openReport(f.report_type, from, to, f.config?.filters as Record<string, unknown> | undefined)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-md bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-primary truncate">{f.name}</div>
                        <div className="text-xs text-muted mt-0.5">{template?.label || f.report_type}</div>
                        {(from || to) && (
                          <div className="text-[11px] text-muted mt-1">{from || '…'} → {to || '…'}</div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm(`Remove "${f.name}" from your saved reports?`)) {
                          onDeleteFavorite(f.id)
                        }
                      }}
                      disabled={deleteMut.isPending}
                      className="opacity-50 hover:opacity-100 text-muted hover:text-status-rose bg-transparent border-0 p-1 cursor-pointer transition-opacity disabled:opacity-50"
                      title="Remove favorite"
                      aria-label={`Remove ${f.name} from saved reports`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* ─── Create New Report (templates) ────────────────────────────────── */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-primary flex items-center gap-2">
            <Plus size={18} /> Create New Report
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleTemplates.map(t => (
            <TemplateCard key={t.key} template={t} onClick={() => openReport(t.key)} />
          ))}
        </div>
      </section>
    </div>
  )
}

function TemplateCard({ template, onClick }: { template: Template; onClick: () => void }) {
  const { Icon } = template
  return (
    <Card
      onClick={onClick}
      className="p-4 cursor-pointer transition-all hover:border-accent border-line-muted"
    >
      <div className="flex items-start gap-3">
        <div className="bg-accent/10 text-accent w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0">
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-primary">{template.label}</div>
            {template.stub && (
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted bg-surface-overlay px-1.5 py-0.5 rounded">
                Stub
              </span>
            )}
          </div>
          <div className="text-xs text-muted mt-0.5 leading-snug">{template.description}</div>
        </div>
      </div>
    </Card>
  )
}
