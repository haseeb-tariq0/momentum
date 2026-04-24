import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant =
  | 'timesheet'    // week grid with no entries
  | 'reports'      // no saved reports
  | 'resourcing'   // empty allocation grid
  | 'projects'     // no projects found
  | 'team'         // no team members
  | 'tasks'        // no tasks assigned
  | 'search'       // no search results
  | 'generic'      // fallback

interface EmptyStateProps {
  /** Custom icon (wins over `variant`). Pass a Lucide icon if you don't want the illustration. */
  icon?: ReactNode
  /** Pre-baked illustration + tone. Renders a soft, themed SVG above the title. */
  variant?: Variant
  title: string
  description?: ReactNode
  /** Primary action — usually a Button */
  action?: ReactNode
  /** Secondary action — usually a ghost/text link */
  secondaryAction?: ReactNode
  className?: string
  /** Reduce vertical padding for embedded/inline use. */
  compact?: boolean
}

/**
 * Centered empty state for "no results", "nothing here yet", error fallbacks.
 *
 * Pass `variant` for a pre-baked illustration that matches the domain, or
 * `icon` to use a plain Lucide glyph. `variant` wins if both are provided.
 */
function EmptyState({
  icon, variant, title, description, action, secondaryAction, className, compact,
}: EmptyStateProps) {
  const Illus = variant ? ILLUSTRATIONS[variant] : null
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center px-6',
        compact ? 'py-8' : 'py-14',
        className,
      )}
    >
      {Illus ? (
        <div className="mb-5"><Illus /></div>
      ) : icon ? (
        <div className="text-muted mb-3 [&_svg]:w-8 [&_svg]:h-8">{icon}</div>
      ) : null}
      <div className="text-base font-semibold text-primary mb-1">{title}</div>
      {description && (
        <div className="text-sm text-muted mb-4 max-w-sm leading-relaxed">{description}</div>
      )}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-1">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}

// ─── Illustrations ─────────────────────────────────────────────────────────
// Inline SVG. Each is ~120×96, uses currentColor + accent CSS vars so it
// adapts to the theme. Deliberately minimal — strokes only, no gradients,
// consistent 1.5 stroke width. The goal is "intentional empty state", not
// marketing-site illustration.

const ACCENT = 'var(--accent)'
const LINE   = 'var(--line-muted)'
const MUTED  = 'var(--text-tertiary)'

function IllusTimesheet() {
  // Weekly calendar grid with a tiny checkmark on an empty cell.
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <rect x="10" y="14" width="100" height="70" rx="8" stroke={LINE} strokeWidth="1.5" />
      <line x1="10" y1="32" x2="110" y2="32" stroke={LINE} strokeWidth="1.5" />
      {[30, 50, 70, 90].map(x => <line key={x} x1={x} y1="32" x2={x} y2="84" stroke={LINE} strokeWidth="1" opacity="0.6" />)}
      <line x1="10" y1="56" x2="110" y2="56" stroke={LINE} strokeWidth="1" opacity="0.6" />
      {/* current-day pill */}
      <rect x="53" y="20" width="14" height="8" rx="3" fill={ACCENT} opacity="0.2" />
      <rect x="53" y="20" width="14" height="8" rx="3" stroke={ACCENT} strokeWidth="1.2" />
      {/* one filled entry, one empty */}
      <rect x="14" y="36" width="14" height="16" rx="2" fill={ACCENT} opacity="0.15" />
      <rect x="14" y="36" width="14" height="16" rx="2" stroke={ACCENT} strokeWidth="1.2" />
      <path d="M72 62 L76 66 L82 58" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IllusReports() {
  // Stacked bar chart with a star floating top-right.
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <rect x="14" y="18" width="92" height="64" rx="7" stroke={LINE} strokeWidth="1.5" />
      {/* bars */}
      <rect x="24" y="56" width="10" height="18" rx="2" fill={ACCENT} opacity="0.35" />
      <rect x="40" y="46" width="10" height="28" rx="2" fill={ACCENT} opacity="0.55" />
      <rect x="56" y="38" width="10" height="36" rx="2" fill={ACCENT} opacity="0.75" />
      <rect x="72" y="50" width="10" height="24" rx="2" fill={ACCENT} opacity="0.45" />
      <line x1="22" y1="74" x2="98" y2="74" stroke={LINE} strokeWidth="1.2" />
      {/* star */}
      <path d="M96 26 L98.2 30.6 L103.2 31.3 L99.6 35 L100.5 40 L96 37.7 L91.5 40 L92.4 35 L88.8 31.3 L93.8 30.6 Z"
            fill={ACCENT} opacity="0.9" />
    </svg>
  )
}

function IllusResourcing() {
  // Grid of rows with people dots + a drag-selection rect.
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <rect x="10" y="14" width="100" height="70" rx="8" stroke={LINE} strokeWidth="1.5" />
      {[28, 42, 56, 70].map(y => <line key={y} x1="10" y1={y} x2="110" y2={y} stroke={LINE} strokeWidth="1" opacity="0.5" />)}
      {[30, 50, 70, 90].map(x => <line key={x} x1={x} y1="14" x2={x} y2="84" stroke={LINE} strokeWidth="1" opacity="0.4" />)}
      {/* people dots in left column */}
      {[21, 35, 49, 63, 77].map(y => <circle key={y} cx="17" cy={y} r="2.5" fill={MUTED} opacity="0.6" />)}
      {/* one allocated block */}
      <rect x="32" y="30" width="36" height="10" rx="2" fill={ACCENT} opacity="0.25" />
      <rect x="32" y="30" width="36" height="10" rx="2" stroke={ACCENT} strokeWidth="1.2" strokeDasharray="3 2" />
    </svg>
  )
}

function IllusProjects() {
  // Folder-ish stack.
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <rect x="18" y="30" width="84" height="52" rx="6" fill={ACCENT} opacity="0.1" />
      <rect x="18" y="30" width="84" height="52" rx="6" stroke={LINE} strokeWidth="1.5" />
      <path d="M18 34 L46 34 L52 24 L82 24 L82 34" stroke={LINE} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      {/* three list rows */}
      <line x1="28" y1="48" x2="74" y2="48" stroke={MUTED} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="28" y1="58" x2="82" y2="58" stroke={MUTED} strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      <line x1="28" y1="68" x2="62" y2="68" stroke={MUTED} strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
    </svg>
  )
}

function IllusTeam() {
  // Three overlapping avatar circles.
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <circle cx="44" cy="50" r="18" fill={ACCENT} opacity="0.15" />
      <circle cx="44" cy="50" r="18" stroke={ACCENT} strokeWidth="1.5" />
      <circle cx="60" cy="50" r="18" fill="var(--surface-raised)" />
      <circle cx="60" cy="50" r="18" fill={ACCENT} opacity="0.2" />
      <circle cx="60" cy="50" r="18" stroke={ACCENT} strokeWidth="1.5" />
      <circle cx="76" cy="50" r="18" fill="var(--surface-raised)" />
      <circle cx="76" cy="50" r="18" fill={ACCENT} opacity="0.25" />
      <circle cx="76" cy="50" r="18" stroke={ACCENT} strokeWidth="1.5" />
      {/* initials */}
      <text x="44" y="55" textAnchor="middle" fontSize="11" fontWeight="700" fill={ACCENT}>A</text>
      <text x="60" y="55" textAnchor="middle" fontSize="11" fontWeight="700" fill={ACCENT}>M</text>
      <text x="76" y="55" textAnchor="middle" fontSize="11" fontWeight="700" fill={ACCENT}>+</text>
    </svg>
  )
}

function IllusTasks() {
  // Checkbox list.
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <rect x="18" y="20" width="84" height="56" rx="6" stroke={LINE} strokeWidth="1.5" />
      {[32, 46, 60].map((y, i) => (
        <g key={y}>
          <rect x="28" y={y - 5} width="10" height="10" rx="2" stroke={i === 0 ? ACCENT : LINE} strokeWidth="1.4" fill={i === 0 ? ACCENT : 'none'} opacity={i === 0 ? 0.8 : 1} />
          {i === 0 && <path d={`M30 ${y} L33 ${y + 2} L36 ${y - 2}`} stroke="var(--surface-raised)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />}
          <line x1="44" y1={y} x2={86 - i * 8} y2={y} stroke={MUTED} strokeWidth="1.5" strokeLinecap="round" opacity={0.7 - i * 0.15} />
        </g>
      ))}
    </svg>
  )
}

function IllusSearch() {
  // Magnifier over faint dotted grid.
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      {[24, 40, 56, 72, 88].flatMap(x => [24, 40, 56, 72].map(y =>
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill={MUTED} opacity="0.4" />,
      ))}
      <circle cx="60" cy="46" r="18" stroke={ACCENT} strokeWidth="2" fill="var(--surface-raised)" opacity="0.95" />
      <circle cx="60" cy="46" r="18" stroke={ACCENT} strokeWidth="2" fill="none" />
      <line x1="73" y1="59" x2="86" y2="72" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function IllusGeneric() {
  // Simple circle with a spark.
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" fill="none" aria-hidden>
      <circle cx="60" cy="48" r="28" fill={ACCENT} opacity="0.12" />
      <circle cx="60" cy="48" r="28" stroke={ACCENT} strokeWidth="1.5" />
      <path d="M60 36 L60 60 M48 48 L72 48" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const ILLUSTRATIONS: Record<Variant, () => JSX.Element> = {
  timesheet:  IllusTimesheet,
  reports:    IllusReports,
  resourcing: IllusResourcing,
  projects:   IllusProjects,
  team:       IllusTeam,
  tasks:      IllusTasks,
  search:     IllusSearch,
  generic:    IllusGeneric,
}

export { EmptyState }
