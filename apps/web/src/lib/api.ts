const BASE = '/api/v1'

// Use localStorage (not sessionStorage) so token persists across browser restarts.
const storage = typeof window !== 'undefined' ? localStorage : null

function getToken() {
  if (typeof window === 'undefined') return ''
  try { return storage?.getItem('access_token') || '' } catch { return '' }
}

function setToken(token: string) {
  try { storage?.setItem('access_token', token) } catch { /* quota / private mode */ }
}

function clearAuth() {
  try {
    storage?.removeItem('access_token')
    storage?.removeItem('auth_user')
  } catch { /* private mode */ }
}

let isRefreshing = false
let refreshQueue: Array<(success: boolean) => void> = []

// Cross-tab refresh token rotation: if Tab A refreshes first, Tab B's stored
// access token is still valid for ~8h, so most requests just work. But if
// Tab B's request 401s and Tab B then calls /auth/refresh, the refresh token
// has already been rotated by Tab A — Tab B sees INVALID_REFRESH_TOKEN.
// We retry once after a short delay to give the cookie store time to settle
// and Tab A's new cookie to be visible.
async function tryRefresh(): Promise<boolean> {
  if (isRefreshing) {
    return new Promise(resolve => { refreshQueue.push(resolve) })
  }
  isRefreshing = true
  let success = false
  try {
    let res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })

    // Cross-tab race: another tab may have just rotated the cookie. Retry once.
    if (res.status === 401) {
      await new Promise(r => setTimeout(r, 250))
      res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    }

    if (res.ok) {
      const data = await res.json().catch(() => null)
      if (data?.data?.accessToken) {
        setToken(data.data.accessToken)
        success = true
      }
    }
  } catch { /* network error */ }

  isRefreshing = false
  const queue = refreshQueue
  refreshQueue = []
  queue.forEach(fn => fn(success))
  return success
}

async function request<T = any>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, String(v))
    })
  }

  const token = getToken()
  const res = await fetch(url.toString(), {
    method,
    credentials: 'include',   // send cookies (refresh_token httpOnly cookie)
    headers: {
      // Only advertise a JSON body when we're actually sending one.
      // Fastify rejects empty bodies that claim content-type: application/json
      // with a 400 "Body cannot be empty" error, which breaks POST endpoints
      // that take no payload (e.g. /users/sync/run-now).
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  // Token expired — attempt silent refresh then retry once
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/refresh') {
    const ok = await tryRefresh()
    if (!ok) {
      // Refresh failed — session truly expired
      clearAuth()
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
      throw new Error('Session expired')
    }

    // Retry the original request with new token
    const newToken = getToken()
    const retry = await fetch(url.toString(), {
      method,
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(newToken ? { Authorization: `Bearer ${newToken}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (retry.status === 401) {
      clearAuth()
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
      throw new Error('Session expired')
    }
    const retryJson = await retry.json().catch(() => ({}))
    if (!retry.ok) {
      let message = retryJson?.errors?.[0]?.message
      if (!message) {
        if (retry.status === 403) message = "You don't have permission to do that. If this is unexpected, your session may be stale — try refreshing."
        else if (retry.status === 404) message = 'Not found.'
        else if (retry.status >= 500) message = 'Server error. Please try again in a moment.'
        else message = `Request failed (${retry.status})`
      }
      throw Object.assign(new Error(message), { status: retry.status, errors: retryJson?.errors })
    }
    return retryJson
  }

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Friendlier message for permission errors. The raw 'FORBIDDEN' code from
    // the backend isn't useful for the user — they need to know what to do.
    let message = json?.errors?.[0]?.message
    if (!message) {
      if (res.status === 403) message = "You don't have permission to do that. If this is unexpected, your session may be stale — try refreshing."
      else if (res.status === 404) message = 'Not found.'
      else if (res.status === 429) message = 'Too many requests — please slow down.'
      else if (res.status >= 500) message = 'Server error. Please try again in a moment.'
      else message = `Request failed (${res.status})`
    }
    throw Object.assign(new Error(message), { status: res.status, errors: json?.errors })
  }
  return json
}

export const api = {
  get:    <T = any>(path: string, params?: Record<string, any>) => request<T>('GET',    path, undefined, params),
  post:   <T = any>(path: string, body?: unknown)                => request<T>('POST',   path, body),
  patch:  <T = any>(path: string, body?: unknown)                => request<T>('PATCH',  path, body),
  put:    <T = any>(path: string, body?: unknown)                => request<T>('PUT',    path, body),
  delete: <T = any>(path: string, body?: unknown)                => request<T>('DELETE', path, body),
}
