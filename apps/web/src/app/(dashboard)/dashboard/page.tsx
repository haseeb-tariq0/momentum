'use client'
import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/store'
import { timeApi, projectsApi, tasksApi, usersApi } from '@/lib/queries'
import { api } from '@/lib/api'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, addMonths, subMonths,
  eachDayOfInterval, startOfWeek, endOfWeek, addDays,
} from 'date-fns'
import { PageHeader, Card, Avatar, Badge, EmptyState, Dropdown, Combobox } from '@/components/ui'
import { cn } from '@/lib/cn'
import { todayLocalISO } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────
type ChartBar = {
  date: string; hrs: number; billableHrs?: number
  label: string; labelSub?: string; isToday: boolean; isWeekend: boolean
}
type ChartMode = 'month' | 'week' | 'utilization'
type ChartType = 'bar' | 'area'

const STATUS: Record<string, { label: string; color: string; bg: string; next: string }> = {
  todo:        { label: 'To Do',       color: '#6B7280', bg: 'rgba(107,114,128,0.12)', next: 'in_progress' },
  in_progress: { label: 'In Progress', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',  next: 'done' },
  done:        { label: 'Done',        color: '#10B981', bg: 'rgba(16,185,129,0.12)',  next: 'todo' },
}

// ── Smooth Catmull-Rom bezier path ─────────────────────────────────────────
// Monotone cubic spline — no overshoot, no flat plateaus
function catmullRom(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length === 1 ? `M${pts[0][0]},${pts[0][1]}` : ''
  const n = pts.length
  // Compute slopes with monotone constraint
  const dx: number[] = [], dy: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0]
    dy[i] = pts[i + 1][1] - pts[i][1]
    m[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0
  }
  const tan: number[] = new Array(n)
  tan[0] = m[0]
  tan[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) { tan[i] = 0 }
    else { tan[i] = (m[i - 1] + m[i]) / 2 }
  }
  // Clamp tangents to prevent overshoot
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue }
    const a = tan[i] / m[i], b = tan[i + 1] / m[i]
    const s = a * a + b * b
    if (s > 9) { const t = 3 / Math.sqrt(s); tan[i] = t * a * m[i]; tan[i + 1] = t * b * m[i] }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < n - 1; i++) {
    const seg = dx[i] / 3
    const cp1x = pts[i][0] + seg
    const cp1y = pts[i][1] + tan[i] * seg
    const cp2x = pts[i + 1][0] - seg
    const cp2y = pts[i + 1][1] - tan[i + 1] * seg
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${pts[i + 1][0].toFixed(2)},${pts[i + 1][1].toFixed(2)}`
  }
  return d
}

// ── Icons ──────────────────────────────────────────────────────────────────
function BarIcon({ active }: { active: boolean }) {
  const c = active ? '#fff' : 'currentColor'
  return (
    <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
      <rect x="0"  y="4"   width="3.2" height="7"    rx="1.2" fill={c} opacity={active ? 0.8 : 0.6}/>
      <rect x="4"  y="0.5" width="3.2" height="10.5" rx="1.2" fill={c}/>
      <rect x="8"  y="5"   width="3.2" height="6"    rx="1.2" fill={c} opacity={active ? 0.85 : 0.7}/>
      <rect x="12" y="2"   width="3"   height="9"    rx="1.2" fill={c} opacity={active ? 0.9 : 0.75}/>
    </svg>
  )
}
function AreaIcon({ active }: { active: boolean }) {
  const c = active ? '#fff' : 'currentColor'
  return (
    <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
      <path d="M0 10 C2.5 10,2.5 1.5,5 4 C7.5 6.5,7.5 0.5,10 2.5 C12.5 4.5,12.5 6,15 5 L15 11 L0 11 Z"
        fill={c} opacity={active ? 0.3 : 0.2}/>
      <path d="M0 10 C2.5 10,2.5 1.5,5 4 C7.5 6.5,7.5 0.5,10 2.5 C12.5 4.5,12.5 6,15 5"
        stroke={c} strokeWidth="1.6" strokeLinecap="round" fill="none"/>
      <circle cx="5"  cy="4"   r="1.5" fill={c} opacity={active ? 0.9 : 0.7}/>
      <circle cx="10" cy="2.5" r="1.5" fill={c}/>
    </svg>
  )
}

// ── Chart Tooltip ──────────────────────────────────────────────────────────
function ChartTooltip({ item, hoverX, hoverY, containerW, viewType, dailyCap }: {
  item: { d: ChartBar; x: number; y: number; val: number } | null
  hoverX: number; hoverY: number; containerW: number
  viewType: ChartMode; dailyCap: number
}) {
  if (!item) return null
  const { d, val } = item
  const isUtil  = viewType === 'utilization'
  const util    = isUtil && dailyCap > 0 ? d.hrs / dailyCap : null
  const dotCol  = util !== null
    ? (util >= 1 ? '#FB7185' : util >= 0.8 ? '#FCD34D' : '#9278C7')
    : '#9278C7'

  const TIP_W = 164
  const left = hoverX > containerW * 0.6 ? hoverX - TIP_W - 14 : hoverX + 18
  const top  = Math.max(8, hoverY - 50)

  let dateLabel = ''
  try { dateLabel = format(new Date(d.date), 'EEE, d MMM') } catch { dateLabel = d.date }

  return (
    <div
      className="absolute pointer-events-none bg-surface-raised border border-line-muted rounded-lg px-3 py-2.5 shadow-md backdrop-blur-xl"
      style={{
        left, top, width: TIP_W, zIndex: 20,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18), 0 0 0 0.5px var(--border-subtle)',
        transition: 'left 0.05s, top 0.05s',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-primary tracking-[0.01em]">{dateLabel}</span>
        {d.isToday && (
          <span className="text-[9px] font-extrabold text-[#9278C7] bg-[rgba(109,74,174,0.18)] px-1.5 py-px rounded-sm uppercase tracking-[0.06em]">Today</span>
        )}
      </div>

      {/* Rows: Total / % / Billable + Non-Billable */}
      <div className="flex flex-col gap-1.5">
        {/* Total */}
        <div className="flex justify-between items-center">
          <span className="text-xs text-secondary">Total</span>
          <span className="text-sm font-bold tabular-nums" style={{ color: dotCol }}>
            {d.hrs.toFixed(1)}h
          </span>
        </div>

        {/* Percentage (utilization view OR if dailyCap available) */}
        {(util !== null || (d.hrs > 0 && dailyCap > 0)) && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-secondary">Percentage</span>
            <span className="text-sm font-bold tabular-nums" style={{ color: dotCol }}>
              {Math.round((util !== null ? util : d.hrs / dailyCap) * 100)}%
            </span>
          </div>
        )}

        {/* Billable + Non-Billable split */}
        {d.billableHrs !== undefined && d.hrs > 0 && (
          <div className="flex justify-between items-center pt-1 border-t border-line-subtle">
            <span className="text-xs text-secondary">Billable</span>
            <span className="text-sm font-bold text-accent tabular-nums">
              {d.billableHrs.toFixed(1)}h
            </span>
          </div>
        )}
        {d.billableHrs !== undefined && d.hrs > 0 && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-secondary">Non-Billable</span>
            <span className="text-sm font-bold text-muted tabular-nums">
              {Math.max(0, d.hrs - d.billableHrs).toFixed(1)}h
            </span>
          </div>
        )}
      </div>

      {/* Mini progress bar */}
      {(util !== null || (d.hrs > 0 && dailyCap > 0)) && (
        <div className="mt-2 h-[2.5px] bg-surface-overlay rounded-sm overflow-hidden">
          <div
            className="h-full rounded-sm transition-[width] duration-150"
            style={{
              width: `${Math.min((util !== null ? util : d.hrs / dailyCap) * 100, 100)}%`,
              background: dotCol,
            }}
          />
        </div>
      )}
    </div>
  )
}

// ── Bar tooltip (for candle/bar chart) ─────────────────────────────────────
function BarTooltip({ item, hoverX, hoverY, containerW, viewType, dailyCap }: {
  item: { d: ChartBar; barX: number; barW: number } | null
  hoverX: number; hoverY: number; containerW: number
  viewType: ChartMode; dailyCap: number
}) {
  if (!item || item.d.hrs === 0) return null
  const { d } = item
  const isUtil  = viewType === 'utilization'
  const util    = isUtil && dailyCap > 0 ? d.hrs / dailyCap : null
  const dotCol  = util !== null ? (util >= 1 ? '#FB7185' : util >= 0.8 ? '#FCD34D' : '#9278C7') : '#9278C7'

  const TIP_W = 152
  const left = hoverX > containerW * 0.6 ? hoverX - TIP_W - 12 : hoverX + 14
  const top  = Math.max(8, hoverY - 40)

  let dateLabel = ''
  try {
    dateLabel = d.labelSub ? `${d.label} – ${d.labelSub}` : format(new Date(d.date), 'EEE, d MMM')
  } catch { dateLabel = d.label || d.date }

  return (
    <div
      className="absolute pointer-events-none bg-surface-raised border border-line-muted rounded-lg px-3 py-2 shadow-md backdrop-blur-xl"
      style={{
        left, top, width: TIP_W, zIndex: 20,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18), 0 0 0 0.5px var(--border-subtle)',
      }}
    >
      <div className="text-xs font-bold text-primary mb-1.5 flex items-center justify-between">
        <span>{dateLabel}</span>
        {d.isToday && <span className="text-[9px] font-extrabold text-[#9278C7] bg-[rgba(109,74,174,0.18)] px-1.5 py-px rounded-sm uppercase">Today</span>}
      </div>
      <div className="flex flex-col gap-1">
        {/* Total */}
        <div className="flex justify-between">
          <span className="text-xs text-secondary">Total</span>
          <span className="text-sm font-bold" style={{ color: dotCol }}>{d.hrs.toFixed(1)}h</span>
        </div>
        {/* Percentage */}
        {(util !== null || (d.hrs > 0 && dailyCap > 0)) && (
          <div className="flex justify-between">
            <span className="text-xs text-secondary">Percentage</span>
            <span className="text-sm font-bold" style={{ color: dotCol }}>
              {Math.round((util !== null ? util : d.hrs / dailyCap) * 100)}%
            </span>
          </div>
        )}
        {/* Billable + Non-Billable split */}
        {d.billableHrs !== undefined && d.hrs > 0 && (
          <>
            <div className="flex justify-between pt-1 border-t border-line-subtle">
              <span className="text-xs text-secondary">Billable</span>
              <span className="text-sm font-bold text-accent">{d.billableHrs.toFixed(1)}h</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-secondary">Non-Billable</span>
              <span className="text-sm font-bold text-muted">{Math.max(0, d.hrs - d.billableHrs).toFixed(1)}h</span>
            </div>
          </>
        )}
      </div>
      {d.hrs > 0 && dailyCap > 0 && (
        <div className="mt-1.5 h-0.5 bg-surface-overlay rounded-sm overflow-hidden">
          <div
            className="h-full rounded-sm"
            style={{ width: `${Math.min((util ?? d.hrs / dailyCap) * 100, 100)}%`, background: dotCol }}
          />
        </div>
      )}
    </div>
  )
}

// ── DueChip ────────────────────────────────────────────────────────────────
function DueChip({ due, status }: { due: string; status: string }) {
  const today = todayLocalISO()
  // Append T00:00 so the YYYY-MM-DD string is parsed as local midnight, not
  // UTC midnight (which would shift by a day in non-UTC timezones).
  const diff  = Math.round((new Date(due + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
  const done  = status === 'done'
  const color = done ? '#4A5568' : diff < 0 ? 'var(--rose)' : diff <= 3 ? 'var(--amber)' : '#4A5568'
  const bg    = done ? 'transparent' : diff < 0 ? 'var(--rose-dim)' : diff <= 3 ? 'rgba(245,158,11,0.1)' : 'transparent'
  let label: string
  if (done) {
    label = format(new Date(due), 'MMM d')
  } else if (diff < 0) {
    label = `${Math.abs(diff)}d overdue`
  } else if (diff === 0) {
    label = 'Today'
  } else if (diff === 1) {
    label = 'Tomorrow'
  } else if (diff <= 7) {
    label = `${diff}d left`
  } else {
    label = format(new Date(due), 'MMM d')
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[10px] px-1.5 py-px rounded-sm border whitespace-nowrap',
        diff < 0 && !done ? 'font-bold' : 'font-medium',
      )}
      style={{ color, background: bg, borderColor: `${color}33` }}
    >
      {!done && diff < 0 && <AlertTriangle size={9} />}{label}
    </span>
  )
}

// ── TaskRow ────────────────────────────────────────────────────────────────
function TaskRow({ task, project, onStatusChange, isLast }: { task: any; project: any; onStatusChange: (status: string) => void; isLast: boolean }) {
  const est    = Number(task.estimated_hrs) || 0
  const logged = (task.time_entries || []).reduce((s: number, e: any) => s + Number(e.hours), 0)
  const pct    = est > 0 ? Math.min(Math.round((logged / est) * 100), 100) : -1
  const barColor = pct >= 100 ? 'var(--rose)' : pct >= 80 ? 'var(--amber)' : 'var(--accent)'
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover',
        !isLast && 'border-b border-line-subtle',
      )}
    >
      {/* Task name + project */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {project?.color && <div className="w-[3px] h-3.5 rounded-sm flex-shrink-0" style={{ background: project.color }} />}
          <span
            className={cn(
              'text-base font-medium truncate',
              task.status === 'done' ? 'text-muted line-through' : 'text-primary',
            )}
          >{task.title}</span>
        </div>
        <div className="text-xs text-muted mt-0.5 truncate">
          {task.phases?.projects?.name || project?.name || '—'}{task.phases?.name ? ` · ${task.phases.name}` : ''}
        </div>
      </div>

      {/* Progress — compact single line */}
      <div className="flex items-center gap-1.5 flex-shrink-0 w-[110px]">
        {pct >= 0 ? (
          <>
            <div className="w-10 h-[3px] bg-surface-overlay rounded-sm overflow-hidden flex-shrink-0">
              <div className="h-full rounded-sm" style={{ width: `${pct}%`, background: barColor }} />
            </div>
            <span className="text-[10px] font-bold tabular-nums" style={{ color: barColor }}>{pct}%</span>
            <span className="text-[10px] text-muted tabular-nums">{logged.toFixed(1)}/{est}h</span>
          </>
        ) : <span className="text-[10px] text-muted">—</span>}
      </div>

      {/* Due */}
      <div className="flex-shrink-0 w-[85px]">
        {task.due_date ? <DueChip due={task.due_date} status={task.status} /> : <span className="text-xs text-muted">—</span>}
      </div>

      {/* Status */}
      <div className="flex-shrink-0 w-[104px]" onClick={e => e.stopPropagation()}>
        <Dropdown
          aria-label="Task status"
          size="sm"
          value={task.status}
          onChange={(v) => onStatusChange(v as string)}
          options={Object.entries(STATUS).map(([val, cfg]) => ({
            value: val,
            label: cfg.label,
            // Colored dot that matches the legacy per-status fill color.
            icon: (
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: cfg.color }}
                aria-hidden
              />
            ),
          }))}
        />
      </div>
    </div>
  )
}

function SectionHeader({ label, count, color }: { label: string; count: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-[7px] bg-surface border-b border-line-subtle">
      <span
        className="text-xs font-bold uppercase tracking-[0.06em]"
        style={{ color: color || 'var(--text-tertiary)' }}
      >{label}</span>
      <span className="text-xs font-semibold text-secondary bg-surface-overlay px-1.5 rounded-md">{count}</span>
    </div>
  )
}

// ── Helper: compute nice Y-axis grid values ────────────────────────────────
function niceGridLines(maxVal: number, targetCount: number = 4): number[] {
  if (maxVal <= 0) return [1]
  const rough = maxVal / targetCount
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const nice = [1, 2, 2.5, 5, 10].map(m => m * mag)
  const step = nice.find(n => n >= rough) || nice[nice.length - 1]
  const lines: number[] = []
  for (let v = step; v <= maxVal * 1.01; v += step) lines.push(Math.round(v * 100) / 100)
  if (lines.length === 0) lines.push(maxVal)
  return lines
}

// ── Helper: auto-thin X-axis labels to prevent overlap ──────────────────────
function thinLabels(data: { label: string; x: number }[], minGap: number): Set<number> {
  const show = new Set<number>()
  let lastX = -Infinity
  for (let i = 0; i < data.length; i++) {
    if (!data[i].label) continue
    if (data[i].x - lastX >= minGap) { show.add(i); lastX = data[i].x }
  }
  return show
}

// ── CANDLE / BAR chart with tooltip ───────────────────────────────────────
function CandleBarChart({ data, viewType, chartType, maxValue, dailyCap }: {
  data: ChartBar[]; viewType: ChartMode; chartType: 'candle' | 'bar'
  maxValue: number; dailyCap: number
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [hoverPx, setHoverPx]  = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const W = 1000, H = 300
  const PL = 48, PR = 20, PT = 28, PB = 40
  const CW = W - PL - PR
  const CH = H - PT - PB
  const n  = data.length
  const slotW = n > 0 ? CW / n : 1
  const barW  = chartType === 'candle' ? Math.max(slotW * 0.18, 3) : Math.max(Math.min(slotW * 0.56, 72), 2)
  const peakData = Math.max(0, ...data.map(d => d.hrs || 0))
  const maxV  = Math.max(maxValue, peakData * 1.15, 1)
  const gridLines = niceGridLines(maxV)
  const radius = chartType === 'candle' ? Math.min(barW / 2, 2) : Math.min(barW / 3, 5)
  // Compute which X labels to show (auto-thin)
  const xLabelData = data.map((d, i) => ({ label: d.label, x: PL + i * slotW + slotW / 2 }))
  const visibleLabels = thinLabels(xLabelData, 50) // min 50px gap between labels

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current || n === 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const pixelX = e.clientX - rect.left
    const pixelY = e.clientY - rect.top
    const svgX = (pixelX / rect.width) * W
    let best = 0, bestDist = Infinity
    for (let i = 0; i < n; i++) {
      const cx = PL + i * slotW + slotW / 2
      const d = Math.abs(cx - svgX)
      if (d < bestDist) { bestDist = d; best = i }
    }
    setHoverIdx(best)
    setHoverPx({ x: pixelX, y: pixelY })
  }, [n, slotW])

  function getColor(d: ChartBar, isHover: boolean) {
    // Solid colors only (no gradients) — Murtaza meeting Apr 9
    if (viewType === 'utilization' && dailyCap > 0) {
      const pct = d.hrs / dailyCap
      if (pct >= 1)    return isHover ? '#FB7185' : '#F43F5E'
      if (pct >= 0.8)  return isHover ? '#FCD34D' : '#F59E0B'
      if (d.hrs === 0) return 'rgba(109,74,174,0.07)'
      return isHover ? '#9278C7' : '#6D4AAE'
    }
    if (d.hrs === 0) return d.isWeekend ? 'rgba(255,255,255,0.02)' : 'rgba(109,74,174,0.07)'
    return isHover || d.isToday ? '#9278C7' : '#6D4AAE'
  }

  const hoverItem = hoverIdx !== null && hoverIdx < n ? {
    d: data[hoverIdx],
    barX: PL + hoverIdx * slotW + (slotW - barW) / 2,
    barW,
  } : null

  if (n === 0) return null

  return (
    <div ref={containerRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >

        {/* Hover slot highlight */}
        {hoverIdx !== null && (
          <rect x={PL + hoverIdx * slotW} y={PT} width={slotW} height={CH}
            fill="rgba(109,74,174,0.07)" rx="2" />
        )}

        {/* Clip rect — prevent bars/labels from overflowing */}
        <defs><clipPath id="chartClip"><rect x={PL} y={0} width={CW} height={H - PB} /></clipPath></defs>

        {/* Grid lines — nice round numbers */}
        {gridLines.map(val => {
          const y = PT + CH * (1 - val / maxV)
          if (y < PT - 5 || y > PT + CH + 5) return null
          return (
            <g key={val}>
              <line x1={PL} x2={W - PR} y1={y} y2={y}
                stroke="var(--border-subtle)" strokeWidth="0.5" strokeOpacity="0.6" />
              <text x={PL - 8} y={y + 3.5} textAnchor="end"
                fill="var(--text-tertiary)" fontSize="10" fontFamily="Inter, sans-serif">{val % 1 === 0 ? val : val.toFixed(1)}h</text>
            </g>
          )
        })}

        {/* Cap line — util view */}
        {viewType === 'utilization' && dailyCap > 0 && (() => {
          const y = PT + CH * (1 - dailyCap / maxV)
          return (
            <g>
              <line x1={PL} x2={W - PR} y1={y} y2={y}
                stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="5 4" strokeOpacity="0.45" />
              <text x={PL + 6} y={y - 5} fill="#F59E0B" fontSize="10" fontFamily="Inter, sans-serif" opacity="0.7">capacity</text>
            </g>
          )
        })()}

        {/* Bars — clipped to chart area */}
        <g clipPath="url(#chartClip)">
        {data.map((d, i) => {
          const isHover = hoverIdx === i
          const x   = PL + i * slotW + (slotW - barW) / 2
          const bh  = d.hrs > 0 ? Math.max(3, (d.hrs / maxV) * CH) : 0
          const y   = PT + CH - bh
          const fill = getColor(d, isHover)
          // Only show value label if bar is wide enough (>18px) and hovered or few bars
          const showLabel = chartType === 'bar' && d.hrs > 0 && (isHover || (n <= 40 && barW >= 14))
          return (
            <g key={d.date}>
              {d.hrs > 0 && (
                <rect x={x} y={Math.max(PT, y)} width={barW} height={Math.min(bh, CH)}
                  rx={radius} ry={radius} fill={fill}
                  style={{ transition: 'fill 0.1s' }}
                />
              )}
              {d.hrs === 0 && viewType !== 'utilization' && (
                <rect x={x} y={PT + CH - 1} width={barW} height={1}
                  rx="0.5" fill="var(--border-subtle)" opacity="0.3" />
              )}
              {showLabel && (
                <text x={x + barW / 2} y={Math.max(PT + 10, y - 5)} textAnchor="middle"
                  fill={isHover ? 'var(--accent)' : 'var(--text-secondary)'}
                  fontSize={barW < 20 ? '8' : '10'} fontWeight="700" fontFamily="Inter, sans-serif"
                  opacity={isHover ? 1 : 0.7}>{d.hrs.toFixed(1)}h</text>
              )}
            </g>
          )
        })}
        </g>

        {/* Hover cursor line — candle mode */}
        {chartType === 'candle' && hoverIdx !== null && (
          <line
            x1={PL + hoverIdx * slotW + slotW / 2}
            x2={PL + hoverIdx * slotW + slotW / 2}
            y1={PT} y2={PT + CH}
            stroke="#9278C7" strokeWidth="1" strokeDasharray="3 4" strokeOpacity="0.45" />
        )}

        {/* Today fallback line */}
        {chartType === 'candle' && data.map((d, i) => {
          if (!d.isToday || d.hrs > 0 || hoverIdx === i) return null
          const x = PL + i * slotW + slotW / 2
          return <line key="tl" x1={x} x2={x} y1={PT} y2={PT + CH}
            stroke="#6D4AAE" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.25" />
        })}

        {/* X-axis labels — auto-thinned to prevent overlap */}
        {data.map((d, i) => {
          if (!visibleLabels.has(i) && hoverIdx !== i) return null
          const x = PL + i * slotW + slotW / 2
          return (
            <g key={`xl-${d.date}`}>
              <text x={x} y={H - (d.labelSub ? 18 : 8)} textAnchor="middle"
                fill={hoverIdx === i ? 'var(--accent)' : d.isToday ? 'var(--accent)' : 'var(--text-tertiary)'}
                fontSize={n <= 14 ? '10' : '9'}
                fontWeight={hoverIdx === i || d.isToday ? '700' : '400'}
                fontFamily="Inter, sans-serif">{d.label}</text>
              {d.labelSub && (
                <text x={x} y={H - 4} textAnchor="middle"
                  fill={hoverIdx === i ? 'var(--accent)' : 'var(--text-tertiary)'}
                  fontSize="10" fontFamily="Inter, sans-serif">{d.labelSub}</text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Bar tooltip */}
      {hoverIdx !== null && (
        <BarTooltip
          item={hoverItem}
          hoverX={hoverPx.x} hoverY={hoverPx.y}
          containerW={containerRef.current?.offsetWidth || 800}
          viewType={viewType} dailyCap={dailyCap}
        />
      )}
    </div>
  )
}

// ── AREA chart with interactive tooltip ───────────────────────────────────
function AreaChart({ data, viewType, dailyCap }: {
  data: ChartBar[]; viewType: ChartMode; dailyCap: number
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [hoverPx, setHoverPx]  = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const W = 1000, H = 300
  const PL = 48, PR = 20, PT = 32, PB = 40
  const CW = W - PL - PR
  const CH = H - PT - PB
  const bottom = PT + CH
  const isUtil = viewType === 'utilization'

  const peakHrs  = Math.max(1, ...data.map(d => d.hrs || 0))
  const maxHrs   = Math.max(dailyCap * 1.2, peakHrs * 1.25)
  const maxVal   = isUtil ? Math.max(1.35, (dailyCap > 0 ? peakHrs / dailyCap : 1) * 1.25) : maxHrs
  const toY      = (v: number) => PT + CH * (1 - Math.min(v / maxVal, 1))

  // Exclude weekends; evenly space workdays
  const workdays = data.filter(d => !d.isWeekend)
  const items = workdays.map((d, i) => {
    const val = isUtil ? (dailyCap > 0 ? d.hrs / dailyCap : 0) : d.hrs
    const x   = PL + (i / Math.max(workdays.length - 1, 1)) * CW
    return { d, x, y: toY(val), val, hasData: d.hrs > 0 }
  })

  // Only plot days with actual data for the smooth line (skip 0-hour days)
  const dataItems = items.filter(it => it.hasData)
  const svgPts: [number, number][] = dataItems.map(it => [it.x, it.y])
  const linePath = catmullRom(svgPts)
  const last = svgPts[svgPts.length - 1]
  const first = svgPts[0]
  const areaPath = linePath && svgPts.length > 0
    ? `${linePath} L${last[0]},${bottom} L${first[0]},${bottom} Z`
    : ''

  const cap80Y  = toY(isUtil ? 0.8 : dailyCap * 0.8)
  const cap100Y = toY(isUtil ? 1.0 : dailyCap)

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current || items.length === 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const pixelX = e.clientX - rect.left
    const pixelY = e.clientY - rect.top
    const svgX = (pixelX / rect.width) * W
    let best = 0, bestDist = Infinity
    items.forEach((it, i) => {
      const d = Math.abs(it.x - svgX)
      if (d < bestDist) { bestDist = d; best = i }
    })
    setHoverIdx(best)
    setHoverPx({ x: pixelX, y: pixelY })
  }, [items])

  const hoverItem = hoverIdx !== null && hoverIdx < items.length ? items[hoverIdx] : null
  const areaGridLines = isUtil ? niceGridLines(maxVal, 4) : niceGridLines(maxVal)
  // Auto-thin X labels
  const xItems = items.map((it) => ({ label: it.d.label, x: it.x }))
  const areaVisibleLabels = thinLabels(xItems, 55)

  return (
    <div ref={containerRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          {/* No gradients — solid colors per Apr 9 meeting */}
          <clipPath id="areaClip"><rect x={PL} y={0} width={CW} height={H - PB + 4} /></clipPath>
        </defs>

        {/* Threshold bands */}
        {isUtil && cap100Y > PT && (
          <>
            <rect x={PL} y={PT}      width={CW} height={Math.max(0, cap100Y - PT)}   fill="rgba(244,63,94,0.045)" />
            <rect x={PL} y={cap100Y} width={CW} height={Math.max(0, cap80Y - cap100Y)} fill="rgba(245,158,11,0.04)" />
          </>
        )}

        {/* Hover column glow */}
        {hoverItem && (
          <rect x={hoverItem.x - 16} y={PT} width={32} height={CH}
            fill="rgba(109,74,174,0.06)" rx="3" />
        )}

        {/* Grid lines — nice round numbers */}
        {areaGridLines.map(val => {
          const y = toY(isUtil ? val : val)
          if (y < PT - 5 || y > PT + CH + 5) return null
          const label = isUtil ? `${Math.round(val * 100)}%` : `${val % 1 === 0 ? val : val.toFixed(1)}h`
          const isCap = isUtil && Math.abs(val - 1.0) < 0.01
          return (
            <g key={val}>
              <line x1={PL} x2={W - PR} y1={y} y2={y}
                stroke={isCap ? 'rgba(244,63,94,0.22)' : 'var(--border-subtle)'}
                strokeWidth={isCap ? '1' : '0.5'} strokeDasharray={isCap ? '4 3' : undefined} strokeOpacity="0.6" />
              <text x={PL - 8} y={y + 3.5} textAnchor="end"
                fill={isCap ? 'rgba(244,63,94,0.55)' : 'var(--text-tertiary)'}
                fontSize="10" fontFamily="Inter, sans-serif">{label}</text>
            </g>
          )
        })}

        {/* 80% line */}
        {isUtil && cap80Y > PT && cap80Y < PT + CH && (
          <g>
            <line x1={PL} x2={W - PR} y1={cap80Y} y2={cap80Y}
              stroke="#F59E0B" strokeWidth="1" strokeDasharray="4 3" strokeOpacity="0.4" />
            <text x={W - PR - 4} y={cap80Y - 5} textAnchor="end"
              fill="#F59E0B" fontSize="8" opacity="0.65" fontFamily="Inter, sans-serif">80%</text>
          </g>
        )}

        {/* Area fill + smooth line — clipped (solid colors, no gradients) */}
        <g clipPath="url(#areaClip)">
          {areaPath && <path d={areaPath} fill={isUtil ? 'rgba(146,120,199,0.18)' : 'rgba(109,74,174,0.22)'} />}
          {linePath && (
            <path d={linePath} fill="none" stroke="#6D4AAE"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </g>

        {/* Data point dots */}
        {items.map((it, i) => {
          const { d, x, y, val } = it
          const isOver  = isUtil && val >= 1
          const isWarn  = isUtil && val >= 0.8 && val < 1
          const col     = isOver ? '#FB7185' : isWarn ? '#FCD34D' : '#9278C7'
          const isHover = hoverIdx === i
          const r       = isHover ? 5.5 : d.isToday ? 4.5 : 2.5
          if (!d.hrs && !d.isToday) return null
          return (
            <g key={d.date}>
              {/* Outer glow rings */}
              {isHover && <circle cx={x} cy={y} r={r + 8} fill={col} opacity="0.1" />}
              {(isHover || d.isToday) && <circle cx={x} cy={y} r={r + 4} fill={col} opacity="0.15" />}
              <circle cx={x} cy={y} r={r + 1.5} fill={col} opacity="0.2" />
              {/* Solid dot */}
              <circle cx={x} cy={y} r={r} fill={col} />
              {/* Inner shine */}
              <circle cx={x - r * 0.2} cy={y - r * 0.25} r={r * 0.32} fill="rgba(255,255,255,0.6)" />
              {/* Today / hover label */}
              {(d.isToday || isHover) && d.hrs > 0 && (
                <text x={x} y={y - r - 9} textAnchor="middle"
                  fill={col} fontSize="10" fontWeight="700" fontFamily="Inter, sans-serif">
                  {isUtil ? `${Math.round(val * 100)}%` : `${d.hrs.toFixed(1)}h`}
                </text>
              )}
            </g>
          )
        })}

        {/* Hover cursor vertical line */}
        {hoverItem && (
          <line
            x1={hoverItem.x} x2={hoverItem.x}
            y1={PT} y2={bottom}
            stroke="#9278C7" strokeWidth="1.5" strokeDasharray="4 3" strokeOpacity="0.5"
          />
        )}

        {/* Today static line */}
        {!hoverItem && items.map((it) => {
          if (!it.d.isToday) return null
          return <line key="tvl" x1={it.x} x2={it.x} y1={PT} y2={bottom}
            stroke="#9278C7" strokeWidth="1" strokeDasharray="3 4" strokeOpacity="0.25" />
        })}

        {/* X-axis labels — auto-thinned */}
        {items.map((it, i) => {
          if (!areaVisibleLabels.has(i) && hoverIdx !== i) return null
          const isH = hoverIdx === i
          return (
            <text key={it.d.date} x={it.x} y={H - 8} textAnchor="middle"
              fill={isH ? 'var(--accent)' : it.d.isToday ? 'var(--accent)' : 'var(--text-tertiary)'}
              fontSize={items.length <= 14 ? '10' : '9'}
              fontWeight={isH || it.d.isToday ? '700' : '400'}
              fontFamily="Inter, sans-serif">{it.d.label}</text>
          )
        })}
      </svg>

      {/* Floating tooltip */}
      {hoverItem && (
        <ChartTooltip
          item={hoverItem}
          hoverX={hoverPx.x} hoverY={hoverPx.y}
          containerW={containerRef.current?.offsetWidth || 800}
          viewType={viewType} dailyCap={dailyCap}
        />
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const qc = useQueryClient()
  const { user, isAdmin } = useAuthStore()

  const [chartView, setChartView]           = useState<ChartMode>('month')
  const [chartType, setChartType]           = useState<ChartType>('bar')
  const [billableFilter, setBillableFilter] = useState<'all' | 'billable' | 'nonbillable'>('all')
  const [chartMonth, setChartMonth]         = useState(new Date())
  const [weekOffset, setWeekOffset]         = useState(0)
  const [adminDept,   setAdminDept]         = useState<string>('all')
  const [selectedPerson, setSelectedPerson] = useState<string>('all')

  // When switching depts, reset person filter
  function handleDeptChange(dept: string) {
    setAdminDept(dept)
    setSelectedPerson('all')
  }

  const today      = todayLocalISO()
  const monthStart = startOfMonth(chartMonth)
  const monthEnd   = endOfMonth(chartMonth)
  const monthKey   = format(chartMonth, 'yyyy-MM')

  const weekStart     = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekEnd       = endOfWeek(new Date(), { weekStartsOn: 1 })
  const viewWeekStart = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset * 7)
  const viewWeekEnd   = addDays(viewWeekStart, 6)
  const viewWeekKey   = format(viewWeekStart, 'yyyy-MM-dd')

  const { data: monthEntries } = useQuery({
    queryKey: ['month-entries', monthKey, user?.id],
    queryFn:  () => api.get(`/time/entries?from=${format(monthStart, 'yyyy-MM-dd')}&to=${format(monthEnd, 'yyyy-MM-dd')}&user_id=${user?.id}`).then((r: any) => r.data),
    enabled:  !!user?.id, staleTime: 60_000,
      placeholderData: (old: any) => old,
  })
  const { data: weekEntriesRaw } = useQuery({
    queryKey: ['week-entries', viewWeekKey, user?.id],
    queryFn:  () => api.get(`/time/entries?from=${viewWeekKey}&to=${format(viewWeekEnd, 'yyyy-MM-dd')}&user_id=${user?.id}`).then((r: any) => r.data),
    enabled:  chartView === 'week' && !!user?.id, staleTime: 60_000,
      placeholderData: (old: any) => old,
  })

  // ── Week-adjusted capacity (holidays + time-off subtracted) ──────────────
  const weekStartKey = format(weekStart, 'yyyy-MM-dd')
  const { data: weekCapData } = useQuery({
    queryKey: ['week-capacity', weekStartKey, user?.id],
    queryFn:  () => usersApi.weekCapacity(weekStartKey).then((r: any) => r.data),
    enabled:  !!user?.id, staleTime: 3_600_000,  // 1hr — changes only when holidays/leave change
    placeholderData: (old: any) => old,
  })
  // Use adjusted capacity for current week's view; fall back to raw if data not yet loaded
  const rawCapacity   = Number(user?.capacityHrs || 40)
  const capacity      = weekCapData?.adjustedCapacity ?? rawCapacity
  const holidayDays   = weekCapData?.holidayDays    ?? 0
  const leaveHrsWeek  = weekCapData?.leaveHrs       ?? 0
  const dailyCap  = capacity / 5
  const weekCap   = capacity
  const { data: tasksRaw, isLoading: tLoad } = useQuery({
    queryKey: ['my-tasks'],
    queryFn:  () => timeApi.tasks({ search: '' }).then((r: any) => r.data),
    staleTime: 30_000,
      placeholderData: (old: any) => old,
  })
  const { data: projectsData } = useQuery({
    queryKey: ['projects-all'],
    queryFn:  () => projectsApi.list().then((r: any) => r.data),
    staleTime: 60_000,
      placeholderData: (old: any) => old,
  })

  // ── Admin dept view ──────────────────────────────────────────────────────
  // Per-user time-off hours for dynamic capacity
  const { data: holidayRangeData } = useQuery({
    queryKey: ['holidays-range-dash', format(monthStart, 'yyyy-MM-dd'), format(monthEnd, 'yyyy-MM-dd')],
    queryFn:  () => api.get(`/users/holidays-range?from=${format(monthStart, 'yyyy-MM-dd')}&to=${format(monthEnd, 'yyyy-MM-dd')}`).then((r: any) => r.data),
    enabled:  isAdmin(), staleTime: 120_000,
    placeholderData: (old: any) => old,
  })
  const userTimeOffMap: Record<string, number> = holidayRangeData?.userTimeOffHrs || {}

  const { data: allUsersRaw } = useQuery({
    queryKey: ['users-overview'],
    queryFn:  () => api.get('/users').then((r: any) => r.data),
    enabled:  isAdmin(), staleTime: 120_000,
      placeholderData: (old: any) => old,
  })
  const { data: deptsRaw } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => api.get('/users/departments').then((r: any) => r.data),
    enabled:  isAdmin(), staleTime: 120_000,
      placeholderData: (old: any) => old,
  })
  const deptObj    = (deptsRaw || []).find((d: any) => d.name === adminDept)
  const allUsers: any[] = allUsersRaw || []
  const depts: any[]    = deptsRaw    || []
  const deptMembers: any[] = adminDept === 'all' || adminDept === 'all_team'
    ? allUsers
    : allUsers.filter((u: any) => deptObj ? u.department_id === deptObj.id : false)
  const deptMemberIds = new Set(deptMembers.map((u: any) => u.id))
  // All-team entries for admin dept view
  const { data: allTeamMonthRaw } = useQuery({
    queryKey: ['all-team-month', monthKey],
    queryFn:  () => api.get('/time/entries?from=' + format(monthStart, 'yyyy-MM-dd') + '&to=' + format(monthEnd, 'yyyy-MM-dd')).then((r: any) => r.data),
    enabled:  isAdmin() && adminDept !== 'all', staleTime: 60_000,
      placeholderData: (old: any) => old,
  })
  const { data: allTeamWeekRaw } = useQuery({
    queryKey: ['all-team-week', viewWeekKey],
    queryFn:  () => api.get('/time/entries?from=' + viewWeekKey + '&to=' + format(viewWeekEnd, 'yyyy-MM-dd')).then((r: any) => r.data),
    enabled:  isAdmin() && adminDept !== 'all' && chartView === 'week', staleTime: 60_000,
      placeholderData: (old: any) => old,
  })
  const isAdminDeptMode = isAdmin() && adminDept !== 'all'

  const updateStatus = useMutation({
    mutationFn: ({ projectId, taskId, status }: { projectId: string; taskId: string; status: string }) =>
      tasksApi.update(projectId, taskId, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-tasks'] }),
  })

  const tasks     = tasksRaw || []
  const openTasks = tasks.filter((t: any) => t.status !== 'done')
  const doneTasks = tasks.filter((t: any) => t.status === 'done')

  function applyBillable(es: any[]) {
    if (billableFilter === 'billable')    return es.filter(e => e.billable)
    if (billableFilter === 'nonbillable') return es.filter(e => !e.billable)
    return es
  }

  // ── Month data ─────────────────────────────────────────────────────────
  const allMonthEntries: any[] = monthEntries || []
  const monthFiltered = applyBillable(allMonthEntries)

  // Per-day maps (total and billable)
  const monthDayMap: Record<string, number> = {}
  const monthBillableMap: Record<string, number> = {}
  for (const e of monthFiltered) {
    const d = e.date?.slice(0, 10)
    if (d) {
      monthDayMap[d] = (monthDayMap[d] || 0) + Number(e.hours || 0)
      if (e.billable) monthBillableMap[d] = (monthBillableMap[d] || 0) + Number(e.hours || 0)
    }
  }

  const monthDays        = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const totalMonthHrs    = monthFiltered.reduce((s, e) => s + Number(e.hours || 0), 0)
  const allMonthTotal    = allMonthEntries.reduce((s, e) => s + Number(e.hours || 0), 0)
  const billableMonthHrs = allMonthEntries.filter(e => e.billable).reduce((s, e) => s + Number(e.hours || 0), 0)
  const maxMonthDay      = Math.max(dailyCap, ...Object.values(monthDayMap))

  // ── Week data ───────────────────────────────────────────────────────────
  const allWeekEntries: any[] = weekEntriesRaw || []
  const weekFiltered   = applyBillable(allWeekEntries)
  const weekDayMap: Record<string, number> = {}
  const weekBillableMap: Record<string, number> = {}
  for (const e of weekFiltered) {
    const d = e.date?.slice(0, 10)
    if (d) {
      weekDayMap[d] = (weekDayMap[d] || 0) + Number(e.hours || 0)
      if (e.billable) weekBillableMap[d] = (weekBillableMap[d] || 0) + Number(e.hours || 0)
    }
  }
  const viewWeekDays     = eachDayOfInterval({ start: viewWeekStart, end: viewWeekEnd })
  const totalViewWeekHrs = weekFiltered.reduce((s, e) => s + Number(e.hours || 0), 0)
  const allWeekTotal     = allWeekEntries.reduce((s, e) => s + Number(e.hours || 0), 0)
  const billableWeekHrs  = allWeekEntries.filter(e => e.billable).reduce((s, e) => s + Number(e.hours || 0), 0)
  const maxWeekDay       = Math.max(dailyCap, ...Object.values(weekDayMap))

  // ── Build chart data arrays ─────────────────────────────────────────────
  const monthChartData: ChartBar[] = monthDays.map(d => {
    const key = format(d, 'yyyy-MM-dd')
    return {
      date: key, hrs: monthDayMap[key] || 0, billableHrs: monthBillableMap[key] || 0,
      label: format(d, 'd'),
      isToday: key === today, isWeekend: d.getDay() === 0 || d.getDay() === 6,
    }
  })
  const weekChartData: ChartBar[] = viewWeekDays.map(d => {
    const key = format(d, 'yyyy-MM-dd')
    return {
      date: key, hrs: weekDayMap[key] || 0, billableHrs: weekBillableMap[key] || 0,
      label: format(d, 'EEE'), labelSub: format(d, 'd'),
      isToday: key === today, isWeekend: d.getDay() === 0 || d.getDay() === 6,
    }
  })

  // ── Utilization week-aggregated (for candle/bar) ────────────────────────
  const utilWeekData: ChartBar[] = (() => {
    const result: ChartBar[] = []
    let cur = startOfWeek(monthStart, { weekStartsOn: 1 })
    while (cur <= monthEnd) {
      const wEnd2   = endOfWeek(cur, { weekStartsOn: 1 })
      const clampS  = cur < monthStart ? monthStart : cur
      const clampE  = wEnd2 > monthEnd ? monthEnd : wEnd2
      const fromKey = format(clampS, 'yyyy-MM-dd')
      const toKey   = format(clampE, 'yyyy-MM-dd')
      const wEntries = applyBillable(allMonthEntries.filter(e => {
        const d = e.date?.slice(0, 10) || ''
        return d >= fromKey && d <= toKey
      }))
      const wHrs = wEntries.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
      const wBill = wEntries.filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
      const wKey    = format(cur, 'yyyy-MM-dd')
      const wEndKey = format(wEnd2, 'yyyy-MM-dd')
      result.push({
        date: wKey, hrs: wHrs, billableHrs: wBill,
        label: format(clampS, 'd MMM'), labelSub: format(clampE, 'd MMM'),
        isToday: today >= wKey && today <= wEndKey, isWeekend: false,
      })
      cur = addDays(wEnd2, 1)
    }
    return result
  })()
  const maxUtilVal = Math.max(weekCap * 1.1, ...utilWeekData.map(d => d.hrs))

  const adminMonthEntriesAll: any[] = isAdminDeptMode ? (allTeamMonthRaw || []) : []
  const personFilter = (e: any) => deptMemberIds.has(e.user_id) && (selectedPerson === 'all' || e.user_id === selectedPerson)
  const adminMonthFiltered = adminMonthEntriesAll.filter(personFilter)
  const adminWeekFiltered  = isAdminDeptMode ? ((allTeamWeekRaw || []) as any[]).filter(personFilter) : []

  const activeDeptMembers = selectedPerson === 'all' ? deptMembers : deptMembers.filter((u: any) => u.id === selectedPerson)
  const deptCapacityMonth = activeDeptMembers.reduce((s: number, u: any) => {
    const daily = Number(u.capacity_hrs || 40) / 5
    const workDays = eachDayOfInterval({ start: monthStart, end: monthEnd }).filter((d: Date) => d.getDay() !== 0 && d.getDay() !== 6).length
    return s + workDays * daily
  }, 0)
  const deptCapacityWeek = activeDeptMembers.reduce((s: number, u: any) => s + Number(u.capacity_hrs || 40), 0)
  const deptDailyCap     = deptCapacityWeek > 0 ? Math.round(deptCapacityWeek / 5 * 10) / 10 : dailyCap

  // ── Dept chart data (admin dept mode) ──────────────────────────────────
  const adminMonthDayMap: Record<string, number> = {}
  const adminMonthBillMap: Record<string, number> = {}
  for (const e of adminMonthFiltered) {
    const d = e.date?.slice(0, 10)
    if (d) {
      adminMonthDayMap[d] = (adminMonthDayMap[d] || 0) + Number(e.hours || 0)
      if (e.billable) adminMonthBillMap[d] = (adminMonthBillMap[d] || 0) + Number(e.hours || 0)
    }
  }
  const adminWeekDayMap: Record<string, number> = {}
  const adminWeekBillMap: Record<string, number> = {}
  for (const e of adminWeekFiltered) {
    const d = e.date?.slice(0, 10)
    if (d) {
      adminWeekDayMap[d] = (adminWeekDayMap[d] || 0) + Number(e.hours || 0)
      if (e.billable) adminWeekBillMap[d] = (adminWeekBillMap[d] || 0) + Number(e.hours || 0)
    }
  }
  const adminMonthChart: ChartBar[] = monthDays.map(d => {
    const key = format(d, 'yyyy-MM-dd')
    return { date: key, hrs: adminMonthDayMap[key] || 0, billableHrs: adminMonthBillMap[key] || 0,
      label: format(d, 'd'), isToday: key === today, isWeekend: d.getDay() === 0 || d.getDay() === 6 }
  })
  const adminWeekChart: ChartBar[] = viewWeekDays.map(d => {
    const key = format(d, 'yyyy-MM-dd')
    return { date: key, hrs: adminWeekDayMap[key] || 0, billableHrs: adminWeekBillMap[key] || 0,
      label: format(d, 'EEE'), labelSub: format(d, 'd'), isToday: key === today, isWeekend: d.getDay() === 0 || d.getDay() === 6 }
  })
  // Dept utilization view — weekly bars aggregated
  const adminUtilChart: ChartBar[] = (() => {
    const result: ChartBar[] = []
    let cur = startOfWeek(monthStart, { weekStartsOn: 1 })
    while (cur <= monthEnd) {
      const wEnd2  = endOfWeek(cur, { weekStartsOn: 1 })
      const clampS = cur < monthStart ? monthStart : cur
      const clampE = wEnd2 > monthEnd ? monthEnd : wEnd2
      const fk = format(clampS, 'yyyy-MM-dd'), tk = format(clampE, 'yyyy-MM-dd')
      const wEntries = adminMonthFiltered.filter((e: any) => { const d = e.date?.slice(0,10)||''; return d>=fk&&d<=tk })
      const wHrs  = wEntries.reduce((s: number, e: any) => s + Number(e.hours||0), 0)
      const wBill = wEntries.filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours||0), 0)
      const wKey = format(cur, 'yyyy-MM-dd'), wEndKey = format(wEnd2, 'yyyy-MM-dd')
      result.push({ date: wKey, hrs: wHrs, billableHrs: wBill,
        label: format(clampS, 'd MMM'), labelSub: format(clampE, 'd MMM'),
        isToday: today>=wKey&&today<=wEndKey, isWeekend: false })
      cur = addDays(wEnd2, 1)
    }
    return result
  })()
  const adminMaxMonthDay = Math.max(deptDailyCap, ...Object.values(adminMonthDayMap))
  const adminMaxWeekDay  = Math.max(deptDailyCap, ...Object.values(adminWeekDayMap))
  const adminMaxUtilVal  = Math.max(deptCapacityWeek * 1.1, ...adminUtilChart.map(d => d.hrs))

  // ── What to pass to charts ──────────────────────────────────────────────
  const candleBarData = isAdminDeptMode
    ? (chartView === 'week'        ? adminWeekChart
      : chartView === 'utilization' ? adminUtilChart
      :                               adminMonthChart)
    : (chartView === 'week' ? weekChartData : chartView === 'utilization' ? utilWeekData : monthChartData)
  const candleBarMax  = isAdminDeptMode
    ? (chartView === 'week'        ? adminMaxWeekDay
      : chartView === 'utilization' ? adminMaxUtilVal
      :                               adminMaxMonthDay)
    : (chartView === 'week' ? maxWeekDay : chartView === 'utilization' ? maxUtilVal : maxMonthDay)
  const candleBarCap  = isAdminDeptMode
    ? (chartView === 'utilization' ? deptCapacityWeek : deptDailyCap)
    : (chartView === 'utilization' ? weekCap : dailyCap)
  const areaData = isAdminDeptMode
    ? (chartView === 'week' ? adminWeekChart : adminMonthChart)
    : (chartView === 'week' ? weekChartData : monthChartData)
  const areaCap  = isAdminDeptMode ? deptDailyCap : dailyCap

  // ── Task groups ─────────────────────────────────────────────────────────
  const overdue: any[] = [], dueToday: any[] = [], thisWeek: any[] = [], nextWeek: any[] = [], later: any[] = [], noDate: any[] = []
  for (const task of openTasks) {
    if (!task.due_date) { noDate.push(task); continue }
    const d = task.due_date
    if (d < today)                                           overdue.push(task)
    else if (d === today)                                    dueToday.push(task)
    else if (d <= format(weekEnd, 'yyyy-MM-dd'))             thisWeek.push(task)
    else if (d <= format(addDays(weekEnd, 7), 'yyyy-MM-dd')) nextWeek.push(task)
    else                                                     later.push(task)
  }

  const projectMap = useMemo(() => {
    const m: Record<string, any> = {}
    for (const p of (projectsData || [])) m[p.id] = p
    return m
  }, [projectsData])

  function getProject(task: any) {
    const pid = task.phases?.projects?.id || task.phases?.project_id
    return pid ? projectMap[pid] : null
  }
  function getProjectId(task: any) { return task.phases?.projects?.id || task.phases?.project_id || null }
  function changeStatus(task: any, status: string) {
    const pid = getProjectId(task)
    if (!pid) return
    updateStatus.mutate({ projectId: pid, taskId: task.id, status })
  }
  function renderSection(ts: any[], label: string, color?: string) {
    if (!ts.length) return null
    return (
      <div className="border border-line-subtle rounded-md overflow-hidden mb-2">
        <SectionHeader label={label} count={ts.length} color={color} />
        {ts.map((task, i) => <TaskRow key={task.id} task={task} project={getProject(task)} onStatusChange={(s) => changeStatus(task, s)} isLast={i === ts.length - 1} />)}
      </div>
    )
  }

  // ── Monthly capacity (working days × daily rate - leave - holidays) ─────
  const monthWorkDays = monthDays.filter(d => d.getDay() !== 0 && d.getDay() !== 6).length
  const userMonthLeave = (userTimeOffMap[user?.id || ''] || 0)
  const monthHolidayDays = holidayDays  // from weekCapData, approximate
  const monthHolidayHours = monthHolidayDays * (rawCapacity / 5)
  const monthCapacityRaw = monthWorkDays * (rawCapacity / 5)
  const monthCapacity = Math.max(0, monthCapacityRaw - userMonthLeave - monthHolidayHours)
  const monthUtilPct = monthCapacity > 0 ? Math.round(allMonthTotal / monthCapacity * 100) : 0

  // ── KPIs ───────────────────────────────────────────────────────────────
  // Same order in both views: Total → Utilization → Billable → Non-Billable
  const weekUtilPct = capacity > 0 ? Math.round(allWeekTotal / capacity * 100) : 0
  const kpis = chartView === 'week'
    ? [
        { label: 'Week Total',   value: `${totalViewWeekHrs.toFixed(1)}h`, sub: 'all hours', color: 'var(--text-primary)' },
        { label: 'Utilization',  value: `${weekUtilPct}%`, sub: (holidayDays > 0 || leaveHrsWeek > 0) ? `of ${capacity}h` + (holidayDays > 0 ? ` · ${holidayDays}d holiday` : '') + (leaveHrsWeek > 0 ? ` · ${leaveHrsWeek}h leave` : '') : `of ${capacity}h capacity`, color: weekUtilPct >= 100 ? 'var(--rose)' : 'var(--accent)', pct: Math.min(weekUtilPct, 100) },
        { label: 'Billable',     value: `${billableWeekHrs.toFixed(1)}h`,  sub: allWeekTotal > 0 ? `${Math.round(billableWeekHrs / allWeekTotal * 100)}% of total` : '—', color: 'var(--accent)' },
        { label: 'Non-Billable', value: `${(allWeekTotal - billableWeekHrs).toFixed(1)}h`, sub: 'internal / overhead', color: 'var(--text-secondary)' },
      ]
    : [
        { label: 'This Month',   value: `${allMonthTotal.toFixed(1)}h`,    sub: `of ${Math.round(monthCapacity)}h capacity` + (userMonthLeave > 0 ? ` · ${userMonthLeave}h leave` : ''), color: 'var(--accent)', pct: Math.min(monthUtilPct, 100) },
        { label: 'Utilization',  value: `${monthUtilPct}%`,                sub: monthUtilPct >= 80 ? 'On track' : monthUtilPct >= 50 ? 'Building up' : 'Behind', color: monthUtilPct >= 100 ? 'var(--rose)' : monthUtilPct >= 50 ? 'var(--accent)' : 'var(--amber)' },
        { label: 'Billable',     value: `${billableMonthHrs.toFixed(1)}h`, sub: allMonthTotal > 0 ? `${Math.round(billableMonthHrs / allMonthTotal * 100)}% of logged` : '—', color: 'var(--accent)' },
        { label: 'Non-Billable', value: `${(allMonthTotal - billableMonthHrs).toFixed(1)}h`, sub: 'internal / overhead', color: 'var(--text-secondary)' },
      ]

  // ── Admin dept KPI computation ──────────────────────────────────────────
  const adminDeptLoggedMonth = adminMonthFiltered.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
  const adminDeptBillMonth   = adminMonthFiltered.filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
  const adminDeptLoggedWeek  = adminWeekFiltered.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
  const adminDeptBillWeek    = adminWeekFiltered.filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
  const adminUtilMonth = deptCapacityMonth > 0 ? Math.round(adminDeptLoggedMonth / deptCapacityMonth * 100) : 0
  const adminUtilWeek  = deptCapacityWeek  > 0 ? Math.round(adminDeptLoggedWeek  / deptCapacityWeek  * 100) : 0
  const adminBillPctM  = adminDeptLoggedMonth > 0 ? Math.round(adminDeptBillMonth / adminDeptLoggedMonth * 100) : 0
  const adminBillPctW  = adminDeptLoggedWeek  > 0 ? Math.round(adminDeptBillWeek  / adminDeptLoggedWeek  * 100) : 0
  const pplLabel = selectedPerson === 'all' ? activeDeptMembers.length+' people' : activeDeptMembers[0]?.name || '1 person'
  // Same order everywhere: Logged → Utilization → Billable → Capacity/Non-Billable
  const adminDeptKpis = chartView === 'week' ? [
    { label: 'Logged',        value: adminDeptLoggedWeek.toFixed(1)+'h', sub: pplLabel+' · this week', color: 'var(--text-primary)' },
    { label: 'Utilization',   value: adminUtilWeek+'%', sub: adminUtilWeek>=100?'Over capacity':adminUtilWeek>=80?'On target':'Below target', color: adminUtilWeek>=100?'var(--rose)':adminUtilWeek>=80?'var(--accent)':'var(--amber)', pct: Math.min(adminUtilWeek,100) },
    { label: 'Billable',      value: adminDeptBillWeek.toFixed(1)+'h',   sub: adminBillPctW+'% billable', color: 'var(--accent)' },
    { label: 'Capacity',      value: deptCapacityWeek+'h',               sub: selectedPerson==='all' ? activeDeptMembers.length+' × '+(activeDeptMembers[0]?.capacity_hrs||40)+'h/wk' : (activeDeptMembers[0]?.capacity_hrs||40)+'h/wk', color: 'var(--text-secondary)' },
  ] : [
    { label: 'Logged',        value: adminDeptLoggedMonth.toFixed(1)+'h', sub: pplLabel, color: 'var(--text-primary)' },
    { label: 'Utilization',   value: adminUtilMonth+'%', sub: adminUtilMonth>=100?'Over capacity':adminUtilMonth>=80?'On target':'Below target', color: adminUtilMonth>=100?'var(--rose)':adminUtilMonth>=80?'var(--accent)':'var(--amber)', pct: Math.min(adminUtilMonth,100) },
    { label: 'Billable',      value: adminDeptBillMonth.toFixed(1)+'h',   sub: adminBillPctM+'% of logged', color: 'var(--accent)' },
    { label: 'Capacity',      value: Math.round(deptCapacityMonth)+'h',   sub: 'working days × daily rate', color: 'var(--text-secondary)' },
  ]

  // ── Button helpers ─────────────────────────────────────────────────────
  const chartTypeBtn = (type: ChartType, Icon: React.FC<{ active: boolean }>, tip: string) => {
    const active = chartType === type
    return (
      <button
        key={type}
        onClick={() => setChartType(type)}
        title={tip}
        className={cn(
          'w-[34px] h-[30px] rounded border-0 cursor-pointer inline-flex items-center justify-center transition-colors duration-150',
          active
            ? 'bg-accent text-white shadow-glow'
            : 'bg-transparent text-muted hover:bg-surface-hover',
        )}
        aria-pressed={active}
      >
        <Icon active={active} />
      </button>
    )
  }
  const tabBtn = (v: ChartMode, lbl: string) => {
    const active = chartView === v
    return (
      <button
        key={v}
        onClick={() => setChartView(v)}
        className={cn(
          'px-3.5 py-[5px] rounded text-sm font-semibold font-body border-0 cursor-pointer transition-colors duration-150',
          active
            ? 'bg-accent text-white shadow-glow'
            : 'bg-transparent text-muted hover:text-primary',
        )}
        aria-pressed={active}
      >
        {lbl}
      </button>
    )
  }
  const filterBtn = (v: string, lbl: string, active: boolean) => (
    <button
      key={v}
      onClick={() => setBillableFilter(v as any)}
      className={cn(
        'px-2.5 py-1 rounded-sm text-xs font-semibold font-body border-0 cursor-pointer transition-colors duration-150',
        active
          ? 'bg-surface-raised text-primary shadow-sm'
          : 'bg-transparent text-muted hover:text-primary',
      )}
      aria-pressed={active}
    >
      {lbl}
    </button>
  )

  return (
    <div className="px-7 pt-[22px] pb-8 min-h-screen bg-surface-base">

      {/* Header */}
      <PageHeader
        title="Overview"
        subtitle={
          <>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {isAdminDeptMode
              ? <span className="text-accent font-semibold"> · {adminDept}{selectedPerson !== 'all' ? ` · ${deptMembers.find((u: any) => u.id === selectedPerson)?.name || ''}` : ` (${deptMembers.length} people)`}</span>
              : user?.departmentName ? (' \u00b7 ' + user.departmentName) : ''}
          </>
        }
        actions={
          <>
            {isAdmin() && (
              <>
                <Dropdown
                  aria-label="Filter by department"
                  size="sm"
                  value={adminDept}
                  onChange={handleDeptChange}
                  // 'all' is the baseline ("My View") — any other value is a
                  // real filter and should visually pop.
                  highlightWhenSet={isAdminDeptMode}
                  options={[
                    { value: 'all', label: 'My View' },
                    ...depts.map((d: any) => ({ value: d.name as string, label: d.name })),
                  ]}
                />
                {isAdminDeptMode && (
                  <div className="min-w-[200px]">
                    <Combobox
                      aria-label="Filter by person"
                      size="sm"
                      value={selectedPerson}
                      onChange={v => setSelectedPerson((v as string) || 'all')}
                      options={[
                        { value: 'all', label: 'All People' },
                        ...deptMembers.map((u: any) => ({
                          value: u.id as string,
                          label: u.name,
                          description: u.job_title || undefined,
                        })),
                      ]}
                      placeholder="All People"
                      searchPlaceholder="Search people…"
                    />
                  </div>
                )}
              </>
            )}
            <Link
              href='/timesheets'
              className="inline-flex items-center gap-1.5 text-base font-semibold text-accent no-underline bg-accent-dim border border-line-accent px-4 py-2 rounded-md"
            >
              Log Time →
            </Link>
          </>
        }
      />

      {/* ── ADMIN UTILIZATION REPORT ── */}
      {isAdminDeptMode && (() => {
        // Pick the right data based on period
        const periodLogged   = chartView === 'week' ? adminDeptLoggedWeek : adminDeptLoggedMonth
        const periodBillable = chartView === 'week' ? adminDeptBillWeek   : adminDeptBillMonth
        // periodCapacity will be recalculated after peopleRows to use adjusted (time-off deducted) values
        const periodLabel    = chartView === 'week' ? 'This Week' : format(chartMonth, 'MMMM yyyy')

        // Build sorted people rows
        const sourceEntries = chartView === 'week' ? adminWeekFiltered : adminMonthFiltered
        const workDaysCount = chartView === 'week' ? 5 : eachDayOfInterval({ start: monthStart, end: monthEnd }).filter((d: Date) => d.getDay() !== 0 && d.getDay() !== 6).length
        const peopleRows = deptMembers.map((u: any) => {
          const ue       = sourceEntries.filter((e: any) => e.user_id === u.id)
          const logged   = ue.reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
          const bill     = ue.filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
          const nonBill  = Math.round((logged - bill) * 10) / 10
          const rawCap   = Math.round(workDaysCount * (Number(u.capacity_hrs || 40) / 5) * 10) / 10
          const timeOff  = userTimeOffMap[u.id] || 0
          const cap      = Math.max(0, Math.round((rawCap - timeOff) * 10) / 10)
          const util     = cap > 0 ? Math.round(logged / cap * 100) : 0
          return { ...u, logged, bill, nonBill, rawCap, timeOff, cap, util }
        }).sort((a: any, b: any) => b.util - a.util)

        // Compute aggregated capacity from adjusted per-person values
        const periodCapacity = peopleRows.reduce((s: number, u: any) => s + u.cap, 0)
        const totalTimeOff   = peopleRows.reduce((s: number, u: any) => s + u.timeOff, 0)
        const resourceUtil   = periodCapacity > 0 ? Math.round(periodLogged / periodCapacity * 100) : 0
        const billableUtil   = periodCapacity > 0 ? Math.round(periodBillable / periodCapacity * 100) : 0
        const billablePctOfLogged = periodLogged > 0 ? Math.round(periodBillable / periodLogged * 100) : 0
        const maxBar         = Math.max(periodCapacity, periodLogged, 1)

        return (
        <div className="mb-6">
          {/* Summary card */}
          <Card className="overflow-hidden mb-4 rounded-xl">
            {/* Header with period selector */}
            <div className="flex justify-between items-center px-5 py-3.5 border-b border-line-subtle">
              <div>
                <div className="text-lg font-bold text-primary">Weekly Utilization Report</div>
                <div className="text-sm text-muted mt-0.5">{adminDept} · {pplLabel} · {periodLabel}</div>
              </div>
              <div className="flex bg-surface-overlay rounded-md p-[3px] gap-0.5">
                {tabBtn('week', 'This Week')}
                {tabBtn('month', 'This Month')}
              </div>
            </div>

            {/* Three metric cards */}
            <div className="grid grid-cols-3 border-b border-line-subtle">
              {[
                { label: 'Adjusted Capacity', value: `${Math.round(periodCapacity)}h`, sub: totalTimeOff > 0 ? `${activeDeptMembers.length} people · ${totalTimeOff}h time off deducted` : `${activeDeptMembers.length} people × ${Math.round(Number(activeDeptMembers[0]?.capacity_hrs || 40))}h/wk`, color: 'var(--text-secondary)' },
                { label: 'Logged Hours', value: `${periodLogged.toFixed(1)}h`, sub: `${resourceUtil}% of capacity`, color: resourceUtil >= 80 ? 'var(--accent)' : resourceUtil > 0 ? 'var(--amber)' : 'var(--text-tertiary)' },
                { label: 'Billable Hours', value: `${periodBillable.toFixed(1)}h`, sub: `${billablePctOfLogged}% of logged · ${billableUtil}% of capacity`, color: 'var(--accent)' },
              ].map((m, i) => (
                <div
                  key={m.label}
                  className={cn('px-6 py-5', i < 2 && 'border-r border-line-subtle')}
                >
                  <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted mb-2">{m.label}</div>
                  <div
                    className="text-[28px] font-extrabold tabular-nums tracking-[-0.02em] leading-none"
                    style={{ color: m.color }}
                  >{m.value}</div>
                  <div className="text-xs text-muted mt-1.5">{m.sub}</div>
                </div>
              ))}
            </div>

            {/* Three-bar horizontal comparison */}
            <div className="px-6 py-5">
              {[
                { label: 'Capacity', value: periodCapacity, color: 'var(--text-tertiary)', bg: 'var(--bg-overlay)' },
                { label: 'Logged',   value: periodLogged,   color: '#6D4AAE', bg: 'rgba(109,74,174,0.18)' },
                { label: 'Billable', value: periodBillable, color: '#10B981', bg: 'rgba(16,185,129,0.15)' },
              ].map(bar => (
                <div key={bar.label} className="flex items-center gap-3 mb-2.5">
                  <div className="w-[60px] text-xs font-semibold text-muted text-right flex-shrink-0">{bar.label}</div>
                  <div className="flex-1 h-6 rounded overflow-hidden relative" style={{ background: bar.bg }}>
                    <div
                      className="h-full rounded transition-[width] duration-500"
                      style={{
                        width: `${maxBar > 0 ? Math.min((bar.value / maxBar) * 100, 100) : 0}%`,
                        background: bar.color,
                        minWidth: bar.value > 0 ? 2 : 0,
                      }}
                    />
                  </div>
                  <div
                    className="w-[55px] text-sm font-semibold tabular-nums text-right flex-shrink-0"
                    style={{ color: bar.color }}
                  >{Math.round(bar.value)}h</div>
                </div>
              ))}
              {/* Utilization percentages */}
              <div className="flex gap-6 mt-4 pl-[72px]">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ background: resourceUtil >= 80 ? '#6D4AAE' : resourceUtil > 0 ? 'var(--amber)' : 'var(--text-tertiary)' }}
                  />
                  <span className="text-base text-secondary">Resource Utilization:</span>
                  <span
                    className="text-[15px] font-extrabold tabular-nums"
                    style={{ color: resourceUtil >= 100 ? 'var(--rose)' : resourceUtil >= 80 ? '#6D4AAE' : resourceUtil > 0 ? 'var(--amber)' : 'var(--text-tertiary)' }}
                  >{resourceUtil}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm bg-[#10B981]" />
                  <span className="text-base text-secondary">Billable Utilization:</span>
                  <span className="text-[15px] font-extrabold tabular-nums text-[#10B981]">{billableUtil}%</span>
                </div>
              </div>
            </div>
          </Card>

          {/* People breakdown table — Actual | Availability | Util% */}
          <Card className="overflow-hidden rounded-xl">
            <div className="px-5 py-3 bg-surface border-b border-line-subtle flex justify-between items-center">
              <div className="text-base font-semibold text-primary">Team Breakdown — {adminDept} ({deptMembers.length})</div>
              <div className="text-xs text-muted">{periodLabel}{totalTimeOff > 0 ? ` · ${totalTimeOff}h time off deducted` : ''}</div>
            </div>
            {/* Section headers */}
            <div
              className="grid px-5 pt-1.5 pb-0.5 bg-surface"
              style={{ gridTemplateColumns: 'minmax(0,1.3fr) 65px 65px 65px 60px 70px 120px' }}
            >
              <div />
              <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-accent text-center" style={{ gridColumn: '2 / 5' }}>Actual</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-muted text-center" style={{ gridColumn: '5 / 7' }}>Availability</div>
              <div />
            </div>
            <div
              className="grid px-5 pt-0.5 pb-2 bg-surface border-b border-line-subtle"
              style={{ gridTemplateColumns: 'minmax(0,1.3fr) 65px 65px 65px 60px 70px 120px' }}
            >
              {['Person', 'Billable', 'Non-Bill', 'Total', 'Time Off', 'Capacity', 'Util %'].map(h => (
                <div key={h} className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted">{h}</div>
              ))}
            </div>
            {peopleRows.length === 0 && (
              <EmptyState title="No members in this department." />
            )}
            {peopleRows.map((u: any, i: number) => {
              const uc = u.util >= 100 ? 'var(--rose)' : u.util >= 80 ? 'var(--accent)' : u.util > 0 ? 'var(--amber)' : 'var(--text-tertiary)'
              return (
                <div
                  key={u.id}
                  className={cn(
                    'grid px-5 py-2.5 items-center',
                    i < peopleRows.length - 1 && 'border-b border-line-subtle',
                  )}
                  style={{ gridTemplateColumns: 'minmax(0,1.3fr) 65px 65px 65px 60px 70px 120px' }}
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={u.name || '?'} size="md" />
                    <div>
                      <div className="text-base font-medium text-primary">{u.name}</div>
                      <div className="text-[10px] text-muted">{u.job_title || '—'}</div>
                    </div>
                  </div>
                  {/* Actual */}
                  <div className="text-sm text-accent tabular-nums">{u.bill > 0 ? u.bill.toFixed(1)+'h' : '—'}</div>
                  <div className="text-sm text-secondary tabular-nums">{u.nonBill > 0 ? u.nonBill.toFixed(1)+'h' : '—'}</div>
                  <div
                    className={cn(
                      'text-sm tabular-nums',
                      u.logged > 0 ? 'font-semibold text-primary' : 'text-muted',
                    )}
                  >{u.logged > 0 ? u.logged.toFixed(1)+'h' : '—'}</div>
                  {/* Availability */}
                  <div
                    className={cn('text-sm tabular-nums', u.timeOff > 0 ? 'text-status-rose' : 'text-muted')}
                  >{u.timeOff > 0 ? `-${u.timeOff}h` : '—'}</div>
                  <div className="text-sm text-secondary tabular-nums">{u.cap}h</div>
                  {/* Util % */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1.5 bg-surface-overlay rounded-sm overflow-hidden">
                      <div
                        className="h-full rounded-sm transition-[width] duration-500"
                        style={{ width: Math.min(u.util,100)+'%', background: uc }}
                      />
                    </div>
                    <span
                      className="text-sm font-bold tabular-nums text-right min-w-[32px]"
                      style={{ color: uc }}
                    >{u.util}%</span>
                  </div>
                </div>
              )
            })}
          </Card>
        </div>
        )
      })()}

      {/* Chart card — individual user view only */}
      {!isAdminDeptMode && (
        <Card className="mb-6 overflow-hidden rounded-xl">

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 px-[18px] py-3 border-b border-line-subtle">
            <div className="flex bg-surface-overlay rounded-md p-[3px] gap-0.5">
              {tabBtn('month',       'Month')}
              {tabBtn('week',        'This Week')}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted font-bold tracking-[0.07em] uppercase">Chart</span>
              <div className="flex bg-surface-overlay rounded-md p-[3px] gap-px">
                {chartTypeBtn('bar',    BarIcon,    'Bar chart')}
                {chartTypeBtn('area',   AreaIcon,   'Area chart')}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted font-bold tracking-[0.07em] uppercase">Show</span>
              <div className="flex bg-surface-overlay rounded-md p-[3px] gap-px">
                {filterBtn('all',        'All',      billableFilter === 'all')}
                {filterBtn('billable',   'Billable', billableFilter === 'billable')}
                {filterBtn('nonbillable','Non-Bill', billableFilter === 'nonbillable')}
              </div>
            </div>
          </div>

          {/* Period nav */}
          <div className="flex items-center justify-between px-6 pt-3">
            {(
              <>
                <button
                  onClick={() => chartView === 'week' ? setWeekOffset(o => o - 1) : setChartMonth(m => subMonths(m, 1))}
                  className="w-[30px] h-[30px] rounded bg-surface-overlay border border-line-subtle cursor-pointer text-secondary text-xl flex items-center justify-center flex-shrink-0 hover:border-line-accent transition-colors"
                >‹</button>
                <div className="text-center">
                  <div className="text-[15px] font-bold text-primary tracking-[-0.01em]">
                    {chartView === 'week' ? `${format(viewWeekStart, 'd MMM')} – ${format(viewWeekEnd, 'd MMM yyyy')}` : format(chartMonth, 'MMMM yyyy')}
                  </div>
                  <div className="text-xs text-muted mt-px">
                    {isAdminDeptMode
                      ? (chartView === 'week' ? adminDeptLoggedWeek.toFixed(1)+'h logged · '+adminDeptBillWeek.toFixed(1)+'h billable · '+deptMembers.length+' people' : adminDeptLoggedMonth.toFixed(1)+'h logged · '+adminDeptBillMonth.toFixed(1)+'h billable · '+deptMembers.length+' people')
                      : chartView === 'week' ? (totalViewWeekHrs.toFixed(1)+'h logged · '+billableWeekHrs.toFixed(1)+'h billable') : (totalMonthHrs.toFixed(1)+'h '+(billableFilter==='all'?'logged':billableFilter)+' · '+billableMonthHrs.toFixed(1)+'h billable')}
                  </div>
                </div>
                <button
                  onClick={() => chartView === 'week' ? setWeekOffset(o => o + 1) : setChartMonth(m => addMonths(m, 1))}
                  className="w-[30px] h-[30px] rounded bg-surface-overlay border border-line-subtle cursor-pointer text-secondary text-xl flex items-center justify-center flex-shrink-0 hover:border-line-accent transition-colors"
                >›</button>
              </>
            )}
          </div>

          {/* Chart */}
          <div className="px-[18px] pt-2.5">
            {chartType === 'area'
              ? <AreaChart data={areaData} viewType={chartView} dailyCap={areaCap} />
              : <CandleBarChart data={candleBarData} viewType={chartView} chartType={chartType} maxValue={candleBarMax} dailyCap={candleBarCap} />
            }
          </div>

          {/* Legend */}
          {chartView === 'utilization' && chartType !== 'area' && (
            <div className="flex gap-4 px-6 pt-1 items-center">
              {([['#9278C7', 'On track'], ['#FDE68A', 'Warning (80–100%)'], ['#FB7185', 'Over capacity']] as [string, string][]).map(([c, l]) => (
                <div key={l} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm" style={{ background: c }} />
                  <span className="text-[10px] text-muted">{l}</span>
                </div>
              ))}
            </div>
          )}

          {/* KPI strip */}
          <div className="grid grid-cols-4 border-t border-line-subtle mt-3.5">
            {(isAdminDeptMode ? adminDeptKpis : kpis as any[]).map((s: any, i: number) => (
              <div
                key={s.label}
                className={cn('px-5 py-3.5', i < 3 && 'border-r border-line-subtle')}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-muted mb-1">{s.label}</div>
                <div
                  className="text-2xl font-extrabold tabular-nums tracking-[-0.02em] mb-0.5"
                  style={{ color: s.color }}
                >{s.value}</div>
                <div className="text-xs text-muted">{s.sub}</div>
                {'pct' in s && typeof s.pct === 'number' && (
                  <div className="mt-[7px] h-0.5 bg-surface-overlay rounded-sm overflow-hidden">
                    <div
                      className="h-full rounded-sm transition-[width] duration-500"
                      style={{ width: `${Math.min(s.pct, 100)}%`, background: s.color }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tasks */}
      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 236px' }}>
        <div>
          {tLoad ? (
            <div className="p-8 text-center text-base text-muted">Loading tasks…</div>
          ) : openTasks.length === 0 ? (
            <Card className="px-6 py-9 text-center">
              <div className="mb-2.5 flex justify-center"><CheckCircle2 size={30} className="text-accent" /></div>
              <div className="text-lg font-semibold text-secondary">All caught up!</div>
              <div className="text-sm text-muted mt-1">No open tasks assigned to you.</div>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-3 px-4 py-2 mb-1.5">
                <div className="flex-1 text-[10px] font-bold uppercase tracking-[0.06em] text-muted">Task</div>
                <div className="w-[110px] text-[10px] font-bold uppercase tracking-[0.06em] text-muted flex-shrink-0">Progress</div>
                <div className="w-[85px] text-[10px] font-bold uppercase tracking-[0.06em] text-muted flex-shrink-0">Due</div>
                <div className="w-[90px] text-[10px] font-bold uppercase tracking-[0.06em] text-muted flex-shrink-0">Status</div>
              </div>
              {overdue.length > 0 && (
                <div className="border border-[rgba(244,63,94,0.3)] rounded-md overflow-hidden mb-2 bg-[rgba(244,63,94,0.025)]">
                  <div className="flex items-center gap-2 px-4 py-2 bg-[rgba(244,63,94,0.06)] border-b border-[rgba(244,63,94,0.15)]">
                    <AlertTriangle size={13} className="text-status-rose" />
                    <span className="text-xs font-bold uppercase tracking-[0.06em] text-status-rose">Overdue</span>
                    <span className="text-xs font-semibold text-status-rose bg-status-rose-dim px-1.5 rounded-md">{overdue.length}</span>
                  </div>
                  {overdue.map((task, i) => <TaskRow key={task.id} task={task} project={getProject(task)} onStatusChange={(s) => changeStatus(task, s)} isLast={i === overdue.length - 1} />)}
                </div>
              )}
              {renderSection(dueToday, 'Due Today', 'var(--amber)')}
              {renderSection(thisWeek, 'This Week')}
              {renderSection(nextWeek, 'Next Week')}
              {renderSection(later,    'Later')}
              {renderSection(noDate,   'No Due Date')}
            </>
          )}
          {doneTasks.length > 0 && (
            <div className="border border-line-subtle rounded-md overflow-hidden mt-1">
              <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-line-subtle">
                <span className="text-xs font-bold uppercase tracking-[0.06em] text-muted inline-flex items-center gap-1"><CheckCircle2 size={11} /> Completed</span>
                <span className="text-xs font-semibold text-muted bg-surface-overlay px-1.5 rounded-md">{doneTasks.length}</span>
              </div>
              {doneTasks.slice(0, 5).map((task: any, i: number) => <TaskRow key={task.id} task={task} project={getProject(task)} onStatusChange={(s) => changeStatus(task, s)} isLast={i === Math.min(doneTasks.length, 5) - 1} />)}
              {doneTasks.length > 5 && <div className="px-4 py-2 text-sm text-muted text-center">+{doneTasks.length - 5} more</div>}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-2.5 sticky top-[22px]">
          <Card className="px-4 py-3.5">
            <div className="text-xs font-bold text-muted uppercase tracking-[0.06em] mb-3">Task Summary</div>
            {[
              { label: 'Overdue',   value: overdue.length,               color: overdue.length > 0 ? 'var(--rose)' : 'var(--text-tertiary)' },
              { label: 'Due today', value: dueToday.length,              color: dueToday.length > 0 ? 'var(--amber)' : 'var(--text-tertiary)' },
              { label: 'This week', value: thisWeek.length,              color: 'var(--text-primary)' },
              { label: 'Next week', value: nextWeek.length,              color: 'var(--text-tertiary)' },
              { label: 'Later',     value: later.length + noDate.length, color: 'var(--text-tertiary)' },
              { label: 'Done',      value: doneTasks.length,             color: '#10B981' },
            ].map(s => (
              <div key={s.label} className="flex justify-between items-center py-[5px] border-b border-line-subtle">
                <span className="text-sm text-secondary">{s.label}</span>
                <span
                  className="text-lg font-bold tabular-nums"
                  style={{ color: s.value > 0 ? s.color : 'var(--text-tertiary)' }}
                >{s.value}</span>
              </div>
            ))}
          </Card>
          <Card className="px-4 py-3.5">
            <div className="text-xs font-bold text-muted uppercase tracking-[0.06em] mb-3">By Status</div>
            {Object.entries(STATUS).map(([key, cfg]) => {
              const count = tasks.filter((t: any) => t.status === key).length
              return (
                <div key={key} className="flex justify-between items-center py-[5px] border-b border-line-subtle">
                  <span className="text-sm font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                  <span
                    className="text-lg font-bold tabular-nums"
                    style={{ color: count > 0 ? cfg.color : 'var(--text-tertiary)' }}
                  >{count}</span>
                </div>
              )
            })}
          </Card>
        </div>
      </div>
    </div>
  )
}
