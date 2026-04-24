'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore, useEffectivePermissions } from '@/lib/store'
import { authApi } from '@/lib/queries'
import { useTheme } from '@/lib/theme'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Avatar, Tooltip } from '@/components/ui'
import {
  LayoutDashboard, FolderKanban, CalendarRange, Clock, Users,
  BarChart3, Shield, Settings, Bell, Sun, Moon,
  LogOut, AlertTriangle, AlertCircle,
  Menu, X,
} from 'lucide-react'

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 320
const SIDEBAR_DEFAULT = 180
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
      { href: '/timesheets',       label: 'Timesheets',      icon: Clock,          perm: 'view_timesheets' },
      { href: '/resourcing',       label: 'Resourcing',      icon: CalendarRange,  adminOnly: true },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/reports',          label: 'Reports',         icon: BarChart3 },
      // Team page now gated on view_team — collaborators default to `false`
      // so the link disappears for them unless a super admin grants it.
      { href: '/team',             label: 'Team',            icon: Users,          perm: 'view_team' },
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
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
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
  const notifications: any[] = notifData?.data || []
  const unread = notifData?.unreadCount || 0

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
        {/* Single-row header — compact icon buttons (w-6 h-6, 10px glyph)
            at the right end so "Momentum" keeps its full weight without
            forcing a second row. flex-shrink-0 on the icon cluster + min-w-0
            on the brand keeps proportions sensible if the user drags the
            sidebar narrower than default. */}
        <div className="px-4 pt-4 pb-3 border-b border-line-subtle">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="text-xl font-bold text-primary tracking-tight font-heading whitespace-nowrap">Momentum</div>
              <div className="text-xs text-muted mt-0.5 truncate">{user?.workspaceName || 'Digital Nexa'}</div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
            {/* Notification bell — dropdown uses fixed positioning so it escapes the narrow sidebar */}
            <div ref={notifRef} className="relative">
              <Tooltip content={`${unread} notification${unread !== 1 ? 's' : ''}`} side="bottom">
                <button
                  ref={bellRef}
                  onClick={toggleNotifs}
                  className={cn(
                    'w-6 h-6 rounded-md flex items-center justify-center cursor-pointer border transition-colors relative',
                    showNotifs
                      ? 'bg-accent-dim border-line-accent text-accent'
                      : 'bg-surface-overlay border-line-subtle text-secondary hover:bg-surface-hover hover:border-line-muted hover:text-primary',
                  )}
                  aria-label="Notifications"
                >
                  <Bell size={12} />
                  {unread > 0 && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-status-rose border-2 border-surface-raised flex items-center justify-center text-[8px] font-bold text-white leading-none">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </button>
              </Tooltip>

              {showNotifs && dropPos && (
                <div
                  style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: 320 }}
                  className="bg-surface-raised border border-line-muted rounded-lg shadow-md z-modal overflow-hidden animate-popup-slide"
                >
                  <div className="px-4 py-3 border-b border-line-subtle flex justify-between items-center">
                    <span className="text-base font-semibold text-primary">Notifications</span>
                    {unread > 0 && <span className="text-xs text-accent font-semibold">{unread} new</span>}
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
                          className={cn(
                            'px-4 py-3 border-b border-line-subtle flex gap-3 items-start',
                            !n.read && 'bg-surface-hover',
                          )}
                        >
                          <div className={cn(
                            'w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5',
                            n.severity === 'critical' ? 'bg-status-rose' : 'bg-status-amber',
                          )} />
                          <div className="flex-1 min-w-0">
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
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0',
                            n.severity === 'critical'
                              ? 'bg-status-rose-dim text-status-rose'
                              : 'bg-status-amber-dim text-status-amber',
                          )}>
                            {n.severity === 'critical' ? <AlertCircle size={10} /> : <AlertTriangle size={10} />}
                          </span>
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

            {/* Theme toggle */}
            <Tooltip content={isDark ? 'Switch to light mode' : 'Switch to dark mode'} side="bottom">
              <button
                onClick={toggle}
                className="w-6 h-6 rounded-md bg-surface-overlay border border-line-subtle cursor-pointer flex items-center justify-center text-secondary hover:bg-surface-hover hover:border-line-muted hover:text-primary transition-colors"
                aria-label="Toggle theme"
              >
                {isDark ? <Sun size={12} /> : <Moon size={12} />}
              </button>
            </Tooltip>

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
                  (item.href === '/admin' && pathname?.startsWith('/admin')) ||
                  (item.href === '/timesheets' && pathname?.startsWith('/timesheets')) ||
                  (item.href !== '/dashboard' && item.href !== '/admin' && item.href !== '/timesheets' && pathname?.startsWith(item.href))

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

        {/* User footer — anchored to the bottom via mt-auto */}
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
