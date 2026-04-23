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
