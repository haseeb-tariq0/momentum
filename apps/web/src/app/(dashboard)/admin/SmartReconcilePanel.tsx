'use client'
import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { financeApi, usersApi } from '@/lib/queries'
import { showToast } from '@/components/Toast'
import { Button, Combobox } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  CheckCircle2, XCircle, Sparkles, AlertTriangle, HelpCircle,
  ChevronDown, ChevronRight, Loader2, Zap,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

type MatchInfo = {
  clientId: string
  clientName: string
  confidence: number
  reason: 'suffix_stripped' | 'normalized_exact' | 'fuzzy'
}

type Suggestion = {
  rawName: string
  invoiceCount: number
  totalRevenue: number
  match: MatchInfo
}

type NoMatchItem = {
  name: string
  count: number
  revenue: number
}

type SuggestionsData = {
  highConfidence: Suggestion[]
  possible: Suggestion[]
  noMatch: NoMatchItem[]
}

// Per-item decision
type Decision =
  | { action: 'merge'; clientId: string; clientName: string }
  | { action: 'create' }
  | { action: 'skip' }
  | { action: 'pending' }

type DecisionMap = Map<string, Decision>

// ── Helpers ──────────────────────────────────────────────────────────────────

function confidenceLabel(confidence: number, reason: string): string {
  if (reason === 'suffix_stripped') return 'Service suffix stripped'
  if (reason === 'normalized_exact') return 'Exact match (punctuation ignored)'
  return `${Math.round(confidence * 100)}% similarity`
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return 'text-accent'
  if (confidence >= 0.6)  return 'text-status-amber'
  return 'text-status-rose'
}

function fmtRevenue(n: number): string {
  return n.toLocaleString('en-AE', { maximumFractionDigits: 0 })
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SmartReconcilePanel({ onApplied }: { onApplied: () => void }) {
  const qc = useQueryClient()
  const [applying, setApplying] = useState(false)
  const [decisions, setDecisions] = useState<DecisionMap>(new Map())
  const [showPossible, setShowPossible] = useState(true)
  const [showNoMatch, setShowNoMatch] = useState(true)

  // Load suggestions
  const { data: suggestionsRaw, isLoading, refetch } = useQuery({
    queryKey: ['finance-smart-suggestions'],
    queryFn: () => financeApi.smartSuggestions().then((r: any) => r.data as SuggestionsData),
    staleTime: 0,
  })

  // Load existing clients for manual link dropdown
  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => usersApi.clients().then((r: any) => r.data),
    staleTime: 60_000,
  })
  const clientOptions = useMemo(
    () => (clientsData || []).map((c: any) => ({ value: c.id as string, label: c.name as string })),
    [clientsData],
  )

  // Initialise decisions when data arrives:
  //   high confidence → pre-accepted (merge with suggested client)
  //   possible & noMatch → pending (needs human review)
  useEffect(() => {
    if (!suggestionsRaw) return
    const next: DecisionMap = new Map()
    for (const s of suggestionsRaw.highConfidence) {
      next.set(s.rawName, { action: 'merge', clientId: s.match.clientId, clientName: s.match.clientName })
    }
    for (const s of suggestionsRaw.possible) {
      next.set(s.rawName, { action: 'pending' })
    }
    for (const nm of suggestionsRaw.noMatch) {
      next.set(nm.name, { action: 'pending' })
    }
    setDecisions(next)
  }, [suggestionsRaw])

  const data = suggestionsRaw

  // Count accepted (merge + create) decisions
  const mergeCount  = useMemo(() => [...decisions.values()].filter(d => d.action === 'merge').length,  [decisions])
  const createCount = useMemo(() => [...decisions.values()].filter(d => d.action === 'create').length, [decisions])
  const pendingCount = useMemo(() => [...decisions.values()].filter(d => d.action === 'pending').length, [decisions])
  const totalToApply = mergeCount + createCount

  function setDecision(rawName: string, decision: Decision) {
    setDecisions(prev => new Map(prev).set(rawName, decision))
  }

  function acceptAllHigh() {
    if (!data) return
    setDecisions(prev => {
      const next = new Map(prev)
      for (const s of data.highConfidence) {
        next.set(s.rawName, { action: 'merge', clientId: s.match.clientId, clientName: s.match.clientName })
      }
      return next
    })
  }

  async function handleApply() {
    if (!totalToApply) return
    setApplying(true)
    try {
      // 1) Bulk-map all merge decisions
      const mergeMappings = [...decisions.entries()]
        .filter(([, d]) => d.action === 'merge')
        .map(([rawName, d]) => ({ raw_name: rawName, client_id: (d as any).clientId }))

      let linked = 0
      if (mergeMappings.length) {
        const res: any = await financeApi.bulkMap(mergeMappings)
        linked = res.linked || 0
      }

      // 2) Auto-create for "create" decisions
      let created = 0
      const createNames = [...decisions.entries()]
        .filter(([, d]) => d.action === 'create')
        .map(([rawName]) => rawName)
      if (createNames.length) {
        const res: any = await financeApi.autoCreateClients(createNames)
        created = res.created || 0
        linked += res.invoicesLinked || 0
      }

      showToast.success(`Done — ${linked} invoices linked${created ? `, ${created} new clients created` : ''}`)
      onApplied()
      qc.invalidateQueries({ queryKey: ['finance-smart-suggestions'] })
      qc.invalidateQueries({ queryKey: ['finance-unmatched'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client-profitability'] })
      refetch()
    } catch (e: any) {
      showToast.error('Apply failed: ' + (e?.message || 'unknown error'))
    } finally {
      setApplying(false)
    }
  }

  // ── Empty / loading states ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted text-sm">
        <Loader2 size={16} className="animate-spin" /> Analysing unmatched names…
      </div>
    )
  }

  if (!data || (data.highConfidence.length + data.possible.length + data.noMatch.length) === 0) {
    return (
      <div className="flex items-center gap-2 p-6 text-accent text-sm">
        <CheckCircle2 size={16} /> All invoice rows are matched to clients.
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* ── Apply bar ── */}
      <div className="flex items-center justify-between bg-surface border border-line-subtle rounded-lg px-4 py-2.5">
        <div className="text-sm text-muted">
          {totalToApply > 0
            ? <><span className="font-semibold text-primary">{mergeCount}</span> merge{mergeCount !== 1 ? 's' : ''}{createCount > 0 ? <>, <span className="font-semibold text-primary">{createCount}</span> new client{createCount !== 1 ? 's' : ''}</> : ''} ready to apply{pendingCount > 0 ? <> · <span className="text-status-amber">{pendingCount} still pending</span></> : ''}</>
            : pendingCount > 0
              ? <span className="text-status-amber">{pendingCount} items still need a decision</span>
              : 'No items to apply'
          }
        </div>
        <Button
          variant="primary"
          onClick={handleApply}
          disabled={applying || totalToApply === 0}
        >
          {applying
            ? <><Loader2 size={14} className="animate-spin" /> Applying…</>
            : <><Zap size={14} /> Apply {totalToApply} decision{totalToApply !== 1 ? 's' : ''}</>
          }
        </Button>
      </div>

      {/* ── Section 1: High confidence ── */}
      {data.highConfidence.length > 0 && (
        <Section
          icon={<Sparkles size={15} className="text-accent" />}
          title={`Likely matches — ${data.highConfidence.length} names`}
          color="accent"
          defaultOpen
          headerAction={
            <button
              onClick={acceptAllHigh}
              className="text-xs text-accent hover:underline cursor-pointer bg-transparent border-none"
            >
              ✓ Accept all
            </button>
          }
        >
          <TableHeader />
          {data.highConfidence.map(s => (
            <SuggestionRow
              key={s.rawName}
              rawName={s.rawName}
              invoiceCount={s.invoiceCount}
              totalRevenue={s.totalRevenue}
              suggestion={s.match}
              decision={decisions.get(s.rawName) || { action: 'pending' }}
              clientOptions={clientOptions}
              onDecision={d => setDecision(s.rawName, d)}
            />
          ))}
        </Section>
      )}

      {/* ── Section 2: Possible matches ── */}
      {data.possible.length > 0 && (
        <Section
          icon={<AlertTriangle size={15} className="text-status-amber" />}
          title={`Possible matches — ${data.possible.length} names`}
          subtitle="Lower confidence — review before merging."
          color="amber"
          defaultOpen={showPossible}
          onToggle={() => setShowPossible(p => !p)}
        >
          <TableHeader />
          {data.possible.map(s => (
            <SuggestionRow
              key={s.rawName}
              rawName={s.rawName}
              invoiceCount={s.invoiceCount}
              totalRevenue={s.totalRevenue}
              suggestion={s.match}
              decision={decisions.get(s.rawName) || { action: 'pending' }}
              clientOptions={clientOptions}
              onDecision={d => setDecision(s.rawName, d)}
            />
          ))}
        </Section>
      )}

      {/* ── Section 3: No match ── */}
      {data.noMatch.length > 0 && (
        <Section
          icon={<HelpCircle size={15} className="text-muted" />}
          title={`No match found — ${data.noMatch.length} names`}
          color="muted"
          defaultOpen={showNoMatch}
          onToggle={() => setShowNoMatch(p => !p)}
        >
          <div className="grid grid-cols-[2fr_60px_130px_260px] gap-2 px-3 py-1 bg-surface border-b border-line-subtle text-[10px] font-bold uppercase tracking-wider text-muted">
            <div>Name from sheet</div>
            <div className="text-right">Rows</div>
            <div className="text-right">Revenue</div>
            <div>Action</div>
          </div>
          {data.noMatch.map(nm => (
            <NoMatchRow
              key={nm.name}
              name={nm.name}
              count={nm.count}
              revenue={nm.revenue}
              decision={decisions.get(nm.name) || { action: 'pending' }}
              clientOptions={clientOptions}
              onDecision={d => setDecision(nm.name, d)}
            />
          ))}
        </Section>
      )}
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  icon, title, subtitle, color, children, defaultOpen, onToggle, headerAction,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  color: 'accent' | 'amber' | 'muted'
  children: React.ReactNode
  defaultOpen?: boolean
  onToggle?: () => void
  headerAction?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? true)
  const toggle = () => { setOpen(o => !o); onToggle?.() }

  const borderColor = color === 'accent' ? 'border-accent/30' : color === 'amber' ? 'border-status-amber/30' : 'border-line-subtle'

  return (
    <div className={cn('border rounded-lg overflow-hidden', borderColor)}>
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-transparent border-none cursor-pointer text-left hover:bg-surface-hover"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {open ? <ChevronDown size={14} className="text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-muted flex-shrink-0" />}
          {icon}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-primary">{title}</div>
            {subtitle && <div className="text-xs text-muted truncate">{subtitle}</div>}
          </div>
        </div>
        {headerAction && (
          <div onClick={e => e.stopPropagation()} className="ml-3 flex-shrink-0">
            {headerAction}
          </div>
        )}
      </button>
      {open && <div className="border-t border-line-subtle">{children}</div>}
    </div>
  )
}

// ── Table header ──────────────────────────────────────────────────────────────

function TableHeader() {
  return (
    <div className="grid grid-cols-[2fr_60px_130px_2fr_220px] gap-2 px-3 py-1 bg-surface border-b border-line-subtle text-[10px] font-bold uppercase tracking-wider text-muted">
      <div>Name from sheet</div>
      <div className="text-right">Rows</div>
      <div className="text-right">Revenue</div>
      <div>Suggested client</div>
      <div>Decision</div>
    </div>
  )
}

// ── Suggestion row ────────────────────────────────────────────────────────────

function SuggestionRow({
  rawName, invoiceCount, totalRevenue, suggestion, decision, clientOptions, onDecision,
}: {
  rawName: string
  invoiceCount: number
  totalRevenue: number
  suggestion: MatchInfo
  decision: Decision
  clientOptions: { value: string; label: string }[]
  onDecision: (d: Decision) => void
}) {
  const [showOverride, setShowOverride] = useState(false)

  const isMerge   = decision.action === 'merge'
  const isSkip    = decision.action === 'skip'
  const isPending = decision.action === 'pending'

  const rowBg = isMerge ? 'bg-accent/5' : isSkip ? 'bg-surface opacity-50' : ''

  return (
    <div className={cn('grid grid-cols-[2fr_60px_130px_2fr_220px] gap-2 px-3 py-2 border-b border-line-subtle last:border-b-0 items-center', rowBg)}>
      {/* Raw name */}
      <div className="min-w-0">
        <div className="text-sm text-primary truncate font-mono text-xs" title={rawName}>{rawName}</div>
      </div>

      {/* Invoice count */}
      <div className="text-sm text-secondary text-right tabular-nums">{invoiceCount}</div>

      {/* Revenue */}
      <div className="text-sm text-secondary text-right tabular-nums">
        {fmtRevenue(totalRevenue)}
      </div>

      {/* Suggested client + confidence */}
      <div className="min-w-0">
        {showOverride ? (
          <Combobox
            size="sm"
            value={isMerge ? (decision as any).clientId : null}
            onChange={v => {
              if (v) {
                const label = clientOptions.find(o => o.value === v)?.label || ''
                onDecision({ action: 'merge', clientId: v as string, clientName: label })
                setShowOverride(false)
              }
            }}
            options={clientOptions}
            placeholder="Search clients…"
            searchPlaceholder="Search clients…"
          />
        ) : (
          <div>
            <div className="text-sm text-primary truncate" title={suggestion.clientName}>
              {isMerge && (decision as any).clientId !== suggestion.clientId
                ? (decision as any).clientName   // overridden
                : suggestion.clientName}
            </div>
            <div className={cn('text-[11px]', confidenceColor(suggestion.confidence))}>
              {confidenceLabel(suggestion.confidence, suggestion.reason)}
              {' · '}
              <button
                onClick={() => setShowOverride(true)}
                className="underline cursor-pointer bg-transparent border-none text-[11px] text-muted hover:text-primary"
              >
                change
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Decision buttons */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onDecision({ action: 'merge', clientId: suggestion.clientId, clientName: suggestion.clientName })}
          title="Accept — merge invoices into this client"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors cursor-pointer',
            isMerge
              ? 'bg-accent text-white border-accent'
              : 'bg-transparent text-muted border-line-subtle hover:border-accent hover:text-accent',
          )}
        >
          <CheckCircle2 size={12} /> Merge
        </button>
        <button
          onClick={() => { onDecision({ action: 'skip' }); setShowOverride(false) }}
          title="Skip — leave this invoice unlinked for now"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors cursor-pointer',
            isSkip
              ? 'bg-surface-hover text-secondary border-line'
              : 'bg-transparent text-muted border-line-subtle hover:border-line hover:text-secondary',
          )}
        >
          <XCircle size={12} /> Skip
        </button>
      </div>
    </div>
  )
}

// ── No-match row ──────────────────────────────────────────────────────────────

function NoMatchRow({
  name, count, revenue, decision, clientOptions, onDecision,
}: {
  name: string
  count: number
  revenue: number
  decision: Decision
  clientOptions: { value: string; label: string }[]
  onDecision: (d: Decision) => void
}) {
  const [showLink, setShowLink] = useState(false)

  const isCreate  = decision.action === 'create'
  const isMerge   = decision.action === 'merge'
  const isSkip    = decision.action === 'skip'

  const rowBg = isCreate ? 'bg-accent/5' : isMerge ? 'bg-accent/5' : isSkip ? 'bg-surface opacity-50' : ''

  return (
    <div className={cn('grid grid-cols-[2fr_60px_130px_260px] gap-2 px-3 py-2 border-b border-line-subtle last:border-b-0 items-center', rowBg)}>
      {/* Name */}
      <div className="text-sm text-primary font-mono text-xs truncate" title={name}>{name}</div>

      {/* Count */}
      <div className="text-sm text-secondary text-right tabular-nums">{count}</div>

      {/* Revenue */}
      <div className="text-sm text-secondary text-right tabular-nums">{fmtRevenue(revenue)}</div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {showLink ? (
          <Combobox
            size="sm"
            value={isMerge ? (decision as any).clientId : null}
            onChange={v => {
              if (v) {
                const label = clientOptions.find(o => o.value === v)?.label || ''
                onDecision({ action: 'merge', clientId: v as string, clientName: label })
                setShowLink(false)
              }
            }}
            options={clientOptions}
            placeholder="Search clients…"
            searchPlaceholder="Search clients…"
          />
        ) : (
          <>
            {/* Show current decision badge if decided */}
            {isCreate && (
              <span className="text-xs text-accent font-medium flex items-center gap-1">
                <CheckCircle2 size={11} /> Will create
              </span>
            )}
            {isMerge && (
              <span className="text-xs text-accent font-medium truncate max-w-[200px]" title={(decision as any).clientName}>
                → {(decision as any).clientName}
              </span>
            )}

            <button
              onClick={() => onDecision({ action: 'create' })}
              title="Create a new client from this name"
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap',
                isCreate
                  ? 'bg-accent text-white border-accent'
                  : 'bg-transparent text-muted border-line-subtle hover:border-accent hover:text-accent',
              )}
            >
              + Create
            </button>
            <button
              onClick={() => setShowLink(true)}
              title="Manually link to an existing client"
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border border-line-subtle text-muted hover:border-line hover:text-secondary transition-colors cursor-pointer whitespace-nowrap bg-transparent"
            >
              🔗 Link
            </button>
            {(isCreate || isMerge) && (
              <button
                onClick={() => { onDecision({ action: 'pending' }); setShowLink(false) }}
                className="text-[11px] text-muted hover:text-secondary cursor-pointer bg-transparent border-none"
              >
                undo
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
