import { supabase } from '@forecast/db'

/**
 * Allocate the next N human-readable client IDs (CLT-001, CLT-002, …) for a
 * workspace. Scans existing codes for the max numeric suffix and increments
 * from there. Shared by the manual create flow and both auto-import flows
 * (Forecast.it sync + Finance-sheet auto-create) so codes never drift.
 *
 * Not transactional — two concurrent callers could hand out the same
 * sequence. Safe in practice because all three callers are admin-triggered
 * and rarely concurrent. Revisit if import becomes multi-tenant concurrent.
 */
export async function nextClientCodes(workspaceId: string, count: number): Promise<string[]> {
  if (count <= 0) return []
  const { data } = await supabase
    .from('clients')
    .select('client_code')
    .eq('workspace_id', workspaceId)
    .not('client_code', 'is', null)

  let max = 0
  for (const row of data || []) {
    const m = /^CLT-(\d+)$/.exec((row as any).client_code || '')
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  const codes: string[] = []
  for (let i = 1; i <= count; i++) {
    codes.push(`CLT-${String(max + i).padStart(3, '0')}`)
  }
  return codes
}
