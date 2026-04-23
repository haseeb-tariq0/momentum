// Fix project ID: use last 4 chars of the actual ID (each seeded project ends in 0300, 0301 etc.)
// P0300 → P300, P0301 → P301 etc.
// Reads: p.id?.slice(-4).replace(/^0+/, '') gives "300", "301"...
// Better: just show last 3 meaningful hex chars

export function projectShortId(id: string): string {
  if (!id) return 'P???'
  // For UUID-format IDs like 00000000-0000-0000-0000-000000000301
  // strip all dashes and zeros, take last meaningful segment
  const digits = id.replace(/-/g, '').replace(/^0+/, '')
  if (!digits) return 'P001'
  // Take last 4 chars
  return 'P' + digits.slice(-4).toUpperCase()
}

/**
 * Returns today's date as a YYYY-MM-DD string in the **user's local timezone**.
 *
 * Do NOT use `new Date().toISOString().slice(0,10)` for this — it returns UTC
 * date, which silently shifts by one day for anyone west of the prime meridian
 * (US) and for anyone east of it after midnight UTC (UAE after 4 AM local).
 * That off-by-one corrupts "overdue", "due today", "this week" comparisons
 * which all compare against YYYY-MM-DD strings stored in the DB.
 */
export function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Like {@link todayLocalISO} but for any Date, in local timezone. */
export function dateLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
