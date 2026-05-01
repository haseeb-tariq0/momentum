'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore, useEffectivePermissions } from '@/lib/store'
import { authApi } from '@/lib/queries'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Avatar, Tooltip } from '@/components/ui'
import { Mark, NexaWordmark } from '@/components/Brand/BrandLockup'
import {
  LayoutDashboard, FolderKanban, CalendarRange, Clock, Users,
  BarChart3, Shield, Settings, Bell,
  LogOut, AlertTriangle, AlertCircle,
  Menu, X, LayoutTemplate,
} from 'lucide-react'

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 320
const SIDEBAR_DEFAULT = 210
const SIDEBAR_STORAGE_KEY = 'sidebar-width'

// `perm` gates the nav item on an effective permission key (resolved from
// role defaults + per-user overrides via useEffectivePermissions). `adminOnly`
// stays as a coarser fallback for items not yet mapped to a specific perm.
type NavItem = { href: string; label: string; icon: any; adminOnly?: boolean; perm?: string }
type NavSection = { label: string | null; items: NavItem[] }

// Grouped sidebar nav — each section is rendered with a subtle label separator.
const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      { href: '/dashboard',        label: 'Overview',        icon: LayoutDashboard },
      { href: '/projects',         label: 'Projects',        icon: FolderKanban,   perm: 'view_projects' },
      { href: '/admin/templates',  label: 'Templates',       icon: LayoutTemplate, adminOnly: true },
      { href: '/timesheets',       label: 'Timesheets',      icon: Clock,          perm: 'view_timesheets' },
      { href: '/resourcing',       label: 'Resourcing',      icon: CalendarRange,  adminOnly: true },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/reports',          label: 'Reports',         icon: BarChart3 },
      // People page (URL kept as /team for now to preserve existing email
      // and notification deep links to /team/[id]). Gated on view_team —
      // collaborators default to `false` so the link disappears for them
      // unless a super admin grants it. Absorbs what used to be the
      // Admin > People tab (invite, inline edit, deactivate, perms).
      { href: '/team',             label: 'People',          icon: Users,          perm: 'view_team' },
    ],
  },
  {
    label: 'Manage',
    items: [
      // /admin page covers many admin concerns (People, Permissions, Rate
      // Cards, etc.) — admins and account managers need it. Kept on the
      // coarse isAdmin() gate rather than the narrower `manage_admin` perm.
      { href: '/admin',            label: 'Admin',           icon: Shield,         adminOnly: true },
      { href: '/settings/profile', label: 'Settings',        icon: Settings },
    ],
  },
]

// ── Main Sidebar ─────────────────────────────────────────────────────────────
export default function Sidebar({ onSearchClick }: { onSearchClick?: () => void }) {
  const pathname = usePathname()
  const { user, clearAuth, isAdmin } = useAuthStore()
  const permissions = useEffectivePermissions()
  const [showNotifs, setShowNotifs] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLButtonElement>(null)
  // Notification dropdown uses fixed positioning anchored to the bell button,
  // so it escapes the sidebar's implicit overflow-x clipping (which hides the
  // panel behind the nav at narrow widths).
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null)

  function toggleNotifs() {
    if (!showNotifs && bellRef.current) {
      const r = bellRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 6, left: r.left })
    }
    setShowNotifs(s => !s)
  }

  // Resizable width — persisted to localStorage. Initial render uses the
  // default to avoid SSR/client hydration mismatch; saved value loads on mount.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_STORAGE_KEY))
    if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) setSidebarWidth(saved)
  }, [])

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    if (!isResizing) return
    function handleMove(e: MouseEvent) {
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX))
      setSidebarWidth(next)
    }
    function handleUp() { setIsResizing(false) }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isResizing])

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r: any) => r).catch(() => ({ data: [], unreadCount: 0 })),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
  const allNotifications: any[] = notifData?.data || []

  // ── Session-scoped dismiss ────────────────────────────────────────────
  // Notifications are derived live from current state (overdue tasks,
  // budget %, missing timesheets) — there are no DB rows to mark read.
  // We track dismissed IDs in component state so the user can clear the
  // dropdown for the current session. If the underlying issue still
  // applies on next page load, the alert deliberately reappears — we do
  // NOT permanently silence real problems. Backed by sessionStorage so
  // dismissals survive an in-tab refresh but not a new session.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = sessionStorage.getItem('notif-dismissed')
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch { return new Set() }
  })
  function persistDismissed(next: Set<string>) {
    setDismissedIds(next)
    try { sessionStorage.setItem('notif-dismissed', JSON.stringify([...next])) } catch {}
  }
  function dismissOne(id: string) {
    const next = new Set(dismissedIds); next.add(id); persistDismissed(next)
  }
  function dismissAll() {
    persistDismissed(new Set(allNotifications.map(n => n.id)))
  }

  const notifications = allNotifications.filter(n => !dismissedIds.has(n.id))
  const unread = notifications.length

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifs(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleLogout() {
    await authApi.logout().catch(() => {})
    clearAuth()
    window.location.href = '/login'
  }

  // Hide nav items whose gate doesn't pass. `adminOnly` = roles admin/AM/super.
  // `perm` = specific permission key (view_team, view_projects, etc.) — this
  // is what lets super admin hide/show Team per user from /admin Permissions.
  const visibleSections = NAV_SECTIONS
    .map(s => ({
      ...s,
      items: s.items.filter(n => {
        if (n.adminOnly && !isAdmin()) return false
        if (n.perm && permissions[n.perm] !== true) return false
        return true
      }),
    }))
    .filter(s => s.items.length > 0)

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-modal bg-surface-raised border border-line-subtle rounded-md p-1.5 cursor-pointer text-secondary hover:text-primary"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-overlay animate-overlay-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — full viewport height so the user footer anchors to the bottom via mt-auto on the footer block. Width is user-resizable via the right-edge drag handle (persists to localStorage). */}
      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          'flex-shrink-0 sticky top-0 h-screen overflow-y-auto flex flex-col bg-surface-raised border-r border-line-subtle shadow-sm relative',
          'max-lg:fixed max-lg:z-modal max-lg:transition-transform max-lg:duration-200',
          mobileOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        )}
      >
        {/* Header — two clearly-aligned zones:
              [MARK · WORDMARK + TAGLINE]   [BELL]
            Items-center keeps the mark and bell on the same vertical
            axis as the wordmark. Generous gap between brand zone and
            bell makes the boundary obvious without needing a literal
            divider line. Atmospheric wash (radial accents + ghost rings
            + dotted grid) bleeds edge-to-edge across the header band
            so the brand area has texture without sitting in a boxed
            card. overflow-hidden clamps the rings to the sidebar edge. */}
        <div
          className="relative overflow-hidden px-4 pt-4 pb-3 border-b border-line-subtle"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 160px 110px at 10% 55%, rgba(0,196,180,0.08), transparent 70%), ' +
              'radial-gradient(ellipse 130px 90px at 22% 30%, rgba(74,158,255,0.06), transparent 70%)',
          }}
        >
          {/* Dotted-grid wash, masked horizontally so it fades into the
              edges rather than ending in a hard line. */}
          <span
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-40"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)',
              backgroundSize: '14px 14px',
              maskImage:
                'linear-gradient(90deg, transparent, black 25%, black 75%, transparent)',
              WebkitMaskImage:
                'linear-gradient(90deg, transparent, black 25%, black 75%, transparent)',
            }}
          />
          {/* Ghost concentric circles — large + offset so the curves
              run through the brand area as ambient texture. */}
          <span
            aria-hidden
            className="absolute left-[-70px] top-1/2 -translate-y-1/2 w-[220px] h-[220px] rounded-full border border-[rgba(0,196,180,0.05)] pointer-events-none"
          />
          <span
            aria-hidden
            className="absolute left-[-25px] top-1/2 -translate-y-1/2 w-[130px] h-[130px] rounded-full border border-[rgba(74,158,255,0.06)] pointer-events-none"
          />

          <div className="relative z-10 flex items-center gap-3 w-full">
            {/* Brand zone — mark + (wordmark + tagline stacked) */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <Mark className="w-8 h-8 flex-shrink-0 drop-shadow-[0_2px_8px_rgba(0,196,180,0.35)]" />
              <div className="leading-[1.1] min-w-0 overflow-hidden">
                <div className="font-display font-medium text-[16px] tracking-[-0.02em] text-primary truncate">
                  Momentum
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted whitespace-nowrap overflow-hidden">
                  <span>powered by</span>
                  <NexaWordmark height={7} className="flex-shrink-0" />
                </div>
              </div>
            </div>

            {/* Action zone — bell + (mobile-only) close */}
            <div className="flex items-center gap-1 flex-shrink-0">
            {/* Notification bell — dropdown uses fixed positioning so it escapes the narrow sidebar */}
            <div ref={notifRef} className="relative">
              <Tooltip content={`${unread} notification${unread !== 1 ? 's' : ''}`} side="bottom">
                <button
                  ref={bellRef}
                  onClick={toggleNotifs}
                  className={cn(
                    // Bell is a borderless icon button — sits flush in the
                    // sidebar header without visually competing with the
                    // brand lockup. Calm by default, toned hover, only
                    // brightens when the dropdown is actually open. Size
                    // is 24px so the brand lockup keeps full width for
                    // "powered by NEXA" at sidebar's default 210px width.
                    'w-6 h-6 rounded-md flex items-center justify-center cursor-pointer transition-colors relative',
                    showNotifs
                      ? 'bg-accent-dim text-accent'
                      : 'bg-transparent text-secondary hover:bg-surface-hover hover:text-primary',
                  )}
                  aria-label="Notifications"
                >
                  <Bell size={12} />
                  {/* Unread indicator — small purple dot (system theme),
                      not a red count badge. Exact count lives in the
                      dropdown header ("N new"); the button just signals
                      "something to look at". Hidden when dropdown is open
                      since the user is already looking. */}
                  {unread > 0 && !showNotifs && (
                    <span
                      aria-hidden
                      className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent"
                      style={{ boxShadow: '0 0 0 1.5px var(--bg-raised)' }}
                    />
                  )}
                </button>
              </Tooltip>

              {showNotifs && dropPos && (
                <div
                  style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: 320 }}
                  className="bg-surface-raised border border-line-muted rounded-lg shadow-md z-modal overflow-hidden animate-popup-slide"
                >
                  <div className="px-4 py-3 border-b border-line-subtle flex justify-between items-center">
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-semibold text-primary">Notifications</span>
                      {unread > 0 && <span className="text-xs text-accent font-semibold">{unread} new</span>}
                    </div>
                    {unread > 0 && (
                      <button
                        type="button"
                        onClick={dismissAll}
                        className="text-[11px] text-muted hover:text-primary bg-transparent border-0 cursor-pointer transition-colors"
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>
                  <div className="max-h-[360px] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="py-8 px-4 text-center text-base text-muted">
                        All clear — no alerts right now
                      </div>
                    ) : (
                      notifications.map((n: any) => (
                        <div
                          key={n.id}
                          className="group relative px-4 py-3 border-b border-line-subtle flex gap-3 items-start bg-surface-hover/30 hover:bg-surface-hover transition-colors"
                        >
                          <div className={cn(
                            'w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5',
                            n.severity === 'critical' ? 'bg-status-rose' : 'bg-status-amber',
                          )} />
                          <div className="flex-1 min-w-0 pr-6">
                            <div className="text-sm font-semibold text-primary mb-0.5">{n.title}</div>
                            <div className="text-xs text-muted leading-relaxed">{n.message}</div>
                            {n.projectId && (
                              <Link
                                href={`/projects/${n.projectId}`}
                                onClick={() => setShowNotifs(false)}
                                className="text-xs text-accent no-underline mt-1 inline-block hover:underline"
                              >
                                View project {'→'}
                              </Link>
                            )}
                          </div>
                          {/* Severity icon — pinned top-right, hides on hover so
                              the dismiss button can take its slot. */}
                          <span className={cn(
                            'absolute top-3 right-3 px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 group-hover:opacity-0 transition-opacity',
                            n.severity === 'critical'
                              ? 'bg-status-rose-dim text-status-rose'
                              : 'bg-status-amber-dim text-status-amber',
                          )}>
                            {n.severity === 'critical' ? <AlertCircle size={10} /> : <AlertTriangle size={10} />}
                          </span>
                          {/* Per-item dismiss — appears on row hover, slots in
                              where the severity icon was. */}
                          <button
                            type="button"
                            onClick={() => dismissOne(n.id)}
                            className="absolute top-2.5 right-2.5 w-5 h-5 rounded-md flex items-center justify-center bg-transparent border-0 cursor-pointer text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-overlay hover:text-primary transition-opacity"
                            aria-label="Mark as read"
                            title="Mark as read"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  {notifications.length > 0 && (
                    <div className="px-4 py-2.5 border-t border-line-subtle flex justify-between items-center">
                      <Link href="/reports" onClick={() => setShowNotifs(false)} className="text-xs text-accent no-underline font-medium hover:underline">
                        View reports {'→'}
                      </Link>
                      <Link href="/admin/timesheets" onClick={() => setShowNotifs(false)} className="text-xs text-muted no-underline hover:text-secondary">
                        All timesheets
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mobile-only close (hidden on desktop) */}
            <button
              onClick={() => setMobileOpen(false)}
              className="lg:hidden w-6 h-6 rounded-md bg-surface-overlay border border-line-subtle cursor-pointer flex items-center justify-center text-secondary hover:bg-surface-hover"
              aria-label="Close menu"
            >
              <X size={12} />
            </button>
          </div>
          </div>
        </div>

        {/* Nav — grouped into sections for visual hierarchy */}
        <nav className="py-2">
          {visibleSections.map((section, sIdx) => (
            <div key={sIdx} className={cn(sIdx > 0 && 'mt-4')}>
              {section.label && (
                <div className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {section.label}
                </div>
              )}
              {section.items.map(item => {
                const Icon = item.icon
                const active =
                  (item.href === '/dashboard' && pathname === '/dashboard') ||
                  (item.href === '/admin' && pathname === '/admin') ||
                  (item.href === '/admin/templates' && pathname?.startsWith('/admin/templates')) ||
                  (item.href === '/timesheets' && pathname?.startsWith('/timesheets')) ||
                  (item.href !== '/dashboard' && item.href !== '/admin' && item.href !== '/admin/templates' && item.href !== '/timesheets' && pathname?.startsWith(item.href))

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex items-center gap-2.5 no-underline transition-all duration-150',
                      'mx-1.5 rounded-md cursor-pointer px-3 py-2 text-[15px]',
                      active
                        ? 'bg-accent-dim text-accent font-semibold shadow-[inset_0_0_0_1px_var(--accent-dim)]'
                        : 'text-secondary hover:bg-surface-hover hover:text-primary',
                    )}
                    onClick={() => setMobileOpen(false)}
                  >
                    {/* Left-edge accent bar — visible only when active. Gives the
                        nav a clear "selected" signal beyond the bg tint alone. */}
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-accent"
                      />
                    )}
                    <Icon size={17} className="flex-shrink-0" />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* User footer — anchored to the bottom via mt-auto. The "powered
            by NEXA" attribution lives in the sidebar header next to the
            wordmark now, so this block stays focused on the user identity
            row alone. */}
        <div className="mt-auto px-3 py-2 border-t border-line-subtle">
          <div className="flex items-center gap-2">
            <Avatar name={user?.name || 'User'} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-primary truncate">{user?.name || 'User'}</div>
              <div className="text-[10px] text-muted capitalize truncate">{user?.permissionProfile?.replace(/_/g, ' ') || 'Member'}</div>
            </div>

            <Tooltip content="Sign out" side="top">
              <button
                onClick={handleLogout}
                className="bg-transparent border-none cursor-pointer text-muted p-1 rounded hover:text-status-rose transition-colors"
                aria-label="Sign out"
              >
                <LogOut size={14} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Resize handle — drag to adjust sidebar width. Desktop only (hidden on mobile drawer). */}
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsResizing(true) }}
          className={cn(
            'hidden lg:block absolute top-0 right-0 bottom-0 w-1 cursor-ew-resize transition-colors',
            isResizing ? 'bg-accent' : 'hover:bg-accent/50',
          )}
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
        />
      </aside>
    </>
  )
}
