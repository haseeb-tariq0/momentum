/**
 * Parse a user-typed time-entry string into hours.
 *
 * Rules (Apr 17 call — Murtaza):
 *   - Bare number is HOURS.           "4"     → 4h
 *   - `Nm` or `Nmin` is MINUTES.      "40m"   → 0.6667h
 *   - `Nh` or `Nhr` is HOURS explicit."4h"    → 4h
 *   - Decimals allowed on hours.      "4.5"   → 4.5h
 *   - Combo `NhNm` sums both.         "1h30m" → 1.5h
 *   - HH:MM accepted.                 "4:30"  → 4.5h
 *   - Whitespace + any casing tolerated. "1 H 30 M" → 1.5h
 *
 * The previous implementation used `parseFloat`, which silently accepts "40m"
 * as 40 because parseFloat strips trailing non-numeric chars. That meant a
 * user typing "40m" (meaning 40 minutes) would log 40 hours. This parser
 * rejects unknown suffixes and forces the user to retype rather than corrupt
 * their timesheet.
 *
 * Returns:
 *   - number of hours (float, >= 0) on success
 *   - null if the input is empty, invalid, or the total exceeds 24 hours
 */
export function parseTimeInput(raw: string): number | null {
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null

  // Shape 1: HH:MM  (e.g. "4:30", "0:45")
  let m = s.match(/^(\d+):(\d{1,2})$/)
  if (m) {
    const h  = Number(m[1])
    const mn = Number(m[2])
    if (mn >= 60) return null
    return clamp24(h + mn / 60)
  }

  // Shape 2: combo — hours AND minutes both present, both suffixed
  //   "1h30m", "2hr15min", "0h45m"
  m = s.match(/^(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours)(\d+)(?:m|min|mins|minute|minutes)$/)
  if (m) {
    const h  = Number(m[1])
    const mn = Number(m[2])
    return clamp24(h + mn / 60)
  }

  // Shape 3: minutes only — "40m", "90min"
  m = s.match(/^(\d+(?:\.\d+)?)(?:m|min|mins|minute|minutes)$/)
  if (m) {
    return clamp24(Number(m[1]) / 60)
  }

  // Shape 4: hours only with suffix — "4h", "4.5hr"
  m = s.match(/^(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours)$/)
  if (m) {
    return clamp24(Number(m[1]))
  }

  // Shape 5: bare number — "4", "4.5", "0.25"  → hours (default per Apr 17 rule)
  m = s.match(/^(\d+(?:\.\d+)?)$/)
  if (m) {
    return clamp24(Number(m[1]))
  }

  return null
}

function clamp24(hours: number): number | null {
  if (!Number.isFinite(hours) || hours < 0) return null
  if (hours > 24) return null
  return hours
}
