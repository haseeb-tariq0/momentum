import { create } from 'zustand'

export interface AuthUser {
  id:                string
  email:             string
  name:              string
  jobTitle?:         string
  avatarUrl?:        string
  seatType:          'core' | 'collaborator'
  permissionProfile: 'super_admin' | 'admin' | 'account_manager' | 'collaborator'
  capacityHrs:       number
  workspaceId:       string
  workspaceName:     string
  departmentId?:     string
  departmentName?:   string
  // Per-user permission overrides keyed by permission slug. The effective
  // map (role defaults + these overrides) is computed in useEffectivePermissions.
  customPermissions?: Record<string, boolean>
}

interface AuthState {
  user:         AuthUser | null
  token:        string | null
  hydrated:     boolean
  setAuth:      (user: AuthUser, token: string) => void
  setUser:      (user: AuthUser) => void
  clearAuth:    () => void
  hydrate:      () => void
  isAdmin:      () => boolean
  isSuperAdmin: () => boolean
  canViewFinancials: () => boolean
}

// Use localStorage so session persists across browser restarts.
// sessionStorage was causing auto-logout whenever the tab was closed.
const storage = typeof window !== 'undefined' ? localStorage : null

// Safe storage helpers — localStorage throws in private mode and on quota
function safeGet(key: string): string | null {
  try { return storage?.getItem(key) ?? null } catch { return null }
}
function safeSet(key: string, value: string): void {
  try { storage?.setItem(key, value) } catch { /* private mode / quota */ }
}
function safeRemove(key: string): void {
  try { storage?.removeItem(key) } catch { /* private mode */ }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user:     null,
  token:    null,
  hydrated: false,

  hydrate: () => {
    if (typeof window === 'undefined') return
    try {
      const token   = safeGet('access_token')
      const userRaw = safeGet('auth_user')
      if (token && userRaw) {
        const user = JSON.parse(userRaw) as AuthUser
        // Defensive: ensure shape is roughly right before trusting it
        if (user && typeof user === 'object' && user.id) {
          set({ user, token, hydrated: true })
          return
        }
      }
      if (token) {
        // token exists but no user object — keep token, let app re-fetch user
        set({ token, hydrated: true })
        return
      }
    } catch {
      // Corrupt JSON in storage — clear and start fresh rather than crash
      safeRemove('access_token')
      safeRemove('auth_user')
    }
    set({ hydrated: true })
  },

  setUser: (user) => {
    safeSet('auth_user', JSON.stringify(user))
    set({ user })
  },

  setAuth: (user, token) => {
    safeSet('access_token', token)
    safeSet('auth_user', JSON.stringify(user))
    set({ user, token, hydrated: true })
  },

  clearAuth: () => {
    safeRemove('access_token')
    safeRemove('auth_user')
    set({ user: null, token: null, hydrated: true })
  },

  isAdmin: () => {
    const p = get().user?.permissionProfile
    return p === 'super_admin' || p === 'admin' || p === 'account_manager'
  },

  isSuperAdmin: () => get().user?.permissionProfile === 'super_admin',

  canViewFinancials: () => {
    const p = get().user?.permissionProfile
    return p === 'super_admin' || p === 'admin' || p === 'account_manager'
  },
}))

// Baseline permission defaults per role. Must stay in sync with ROLE_DEFAULTS
// in apps/web/src/app/(dashboard)/admin/page.tsx — duplicated here so the
// store can resolve effective permissions without pulling in React component
// code. If the two drift, the Permissions panel and the rest of the app
// will disagree on what a user can see.
const ROLE_DEFAULTS: Record<string, Record<string, boolean>> = {
  super_admin: {},  // sentinel — resolved by `everything === true` below
  admin: {
    view_projects: true, manage_projects: true, delete_projects: false,
    view_financials: true, manage_financials: false,
    view_team: true, manage_team: true, invite_members: true,
    view_timesheets: true, manage_timesheets: false,
    view_report_time: true, view_report_utilization: true,
    view_report_active_projects: true, view_report_client_profitability: true,
    view_report_compliance: true,
    view_report_partner_report: true, view_report_partner_billing: true,
    view_report_task_report: true, view_report_project_progress: true,
    view_report_client_timesheet: true, view_report_pnl: false,
    manage_admin: false, manage_rate_cards: false, manage_clients: true,
  },
  account_manager: {
    view_projects: true, manage_projects: true, delete_projects: false,
    view_financials: true, manage_financials: false,
    view_team: true, manage_team: false, invite_members: false,
    view_timesheets: true, manage_timesheets: false,
    view_report_time: true, view_report_utilization: true,
    view_report_active_projects: true, view_report_client_profitability: true,
    view_report_compliance: false,
    view_report_partner_report: false, view_report_partner_billing: false,
    view_report_task_report: false, view_report_project_progress: false,
    view_report_client_timesheet: false, view_report_pnl: false,
    manage_admin: false, manage_rate_cards: false, manage_clients: true,
  },
  collaborator: {
    view_projects: true, manage_projects: false, delete_projects: false,
    view_financials: false, manage_financials: false,
    view_team: false, manage_team: false, invite_members: false,
    view_timesheets: true, manage_timesheets: false,
    view_report_time: true, view_report_utilization: true,
    view_report_active_projects: false, view_report_client_profitability: false,
    view_report_compliance: false,
    view_report_partner_report: false, view_report_partner_billing: false,
    view_report_task_report: false, view_report_project_progress: false,
    view_report_client_timesheet: false, view_report_pnl: false,
    manage_admin: false, manage_rate_cards: false, manage_clients: false,
  },
}

/**
 * Resolve the effective permission map for the current logged-in user —
 * role baseline overlaid with their per-user overrides. Returns an empty
 * object when logged out. Super admin gets a proxy that returns `true`
 * for any key so new permissions added later automatically work.
 */
export function useEffectivePermissions(): Record<string, boolean> {
  const user = useAuthStore(s => s.user)
  if (!user) return {}
  if (user.permissionProfile === 'super_admin') {
    // Proxy — any lookup returns true. Means super admin doesn't need to
    // be touched every time a new permission key is added.
    return new Proxy({}, { get: () => true }) as Record<string, boolean>
  }
  const base = ROLE_DEFAULTS[user.permissionProfile] || ROLE_DEFAULTS.collaborator
  return { ...base, ...(user.customPermissions || {}) }
}
