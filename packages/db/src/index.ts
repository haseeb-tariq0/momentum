import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy client — env vars are populated by dotenv at runtime, but ESM hoists
// imports above all other module code. A top-level env check would fire
// before dotenv had a chance to run. Defer to first use.
let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (_client) return _client
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      '[db] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. ' +
      'Set them in .env.local (gitignored) — never hardcode service-role keys.'
    )
  }
  _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  })
  console.log(`[db] ✅ Supabase client → ${SUPABASE_URL}`)
  return _client
}

// Proxy that lazy-instantiates on first access. Existing call sites
// (`supabase.from('users').select(...)`) work unchanged.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const client = getClient()
    const value = (client as any)[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
