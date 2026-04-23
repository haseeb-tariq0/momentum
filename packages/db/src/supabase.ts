import { createClient, SupabaseClient } from '@supabase/supabase-js'

const url  = process.env.SUPABASE_URL  || ''
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!url || !key) {
  console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing')
}

// Service role client — bypasses RLS, full access
// Used server-side only (never exposed to client)
export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    autoRefreshToken: false,
    persistSession:   false,
  },
})

export default supabase
