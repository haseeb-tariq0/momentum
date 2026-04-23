/**
 * App-wide number / currency / percentage formatters.
 *
 * Use these instead of `.toLocaleString()` / `.toFixed()` / string concat so
 * the whole app uses identical rules:
 *   - Integers get thousand separators (1,234 not 1234)
 *   - Currency always shows 3-letter ISO code (AED 1,234.00)
 *   - Hours use one decimal (1.5h), zero hides the decimal (1h)
 *   - Percents never show decimals unless < 1% (displayed as "<1%")
 *
 * All formatters are cached — `Intl.NumberFormat` instantiation is surprisingly
 * expensive in hot loops (reports render 100+ cells).
 */

const LOCALE = 'en-US'

// Cache NumberFormat instances — cheaper than building one per render
const intCache = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
const decCache = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const currencyCache = new Map<string, Intl.NumberFormat>()
const percentCache  = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })

function getCurrencyFormatter(currency: string): Intl.NumberFormat {
  const key = currency.toUpperCase()
  let f = currencyCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: key,
      // Always show 2 decimals — Apr 17 call: "two decimal places by default
      // in reports, 9.17 should always show two places." Keeps money columns
      // visually aligned even when the amount happens to be whole.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      currencyDisplay: 'code',    // "AED 1,234.00" not "د.إ.‏1,234.00"
    })
    currencyCache.set(key, f)
  }
  return f
}

/** Thousand-separated integer. `formatInt(12345)` → "12,345". */
export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return intCache.format(Math.round(n))
}

/** Decimal with up to 2 places. `formatDec(1.5)` → "1.5", `formatDec(1)` → "1". */
export function formatDec(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return decCache.format(n)
}

/**
 * Currency. `formatCurrency(1234, 'AED')` → "AED 1,234".
 * Uses ISO code ("AED"/"USD"/"GBP") so we never ship a symbol we don't own.
 */
export function formatCurrency(n: number | null | undefined, currency: string = 'AED'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return getCurrencyFormatter(currency).format(n)
}

/** Hours. `formatHours(1.5)` → "1.5h", `formatHours(8)` → "8h". */
export function formatHours(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  // Hide the .0 when whole; show one decimal otherwise
  const rounded = Math.round(n * 10) / 10
  if (Number.isInteger(rounded)) return `${rounded}h`
  return `${rounded.toFixed(1)}h`
}

/**
 * Hours + minutes — human-readable timesheet format (Apr 23 call — Murtaza).
 * `0.17` → "10m"  ·  `1.5` → "1h 30m"  ·  `8` → "8h"  ·  `8.17` → "8h 10m".
 * Nothing / zero → "—" so empty cells stay visually quiet.
 *
 * Minutes are rounded to the nearest integer — prevents "1h 29.8m" when
 * fractional hours don't divide cleanly. Values < 1 minute display as "<1m"
 * so tiny rounding residue doesn't disappear silently.
 */
export function formatHoursHM(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return '—'
  const totalMinutes = Math.round(n * 60)
  if (totalMinutes === 0) return '<1m'
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * Percentage. Accepts already-calculated percentage (75 → "75%").
 * For a ratio (0.75 → "75%") pass `ratio: true`.
 * Tiny positive values below 1% show as "<1%" so "0%" never hides signal.
 */
export function formatPercent(n: number | null | undefined, ratio: boolean = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const pct = ratio ? n * 100 : n
  if (pct > 0 && pct < 1) return '<1%'
  if (pct < 0 && pct > -1) return '>-1%'
  return `${percentCache.format(pct)}%`
}

/** Signed integer for variance cells. `formatDelta(-500)` → "−500". */
export function formatDelta(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const rounded = Math.round(n)
  if (rounded === 0) return '0'
  const s = intCache.format(Math.abs(rounded))
  return rounded > 0 ? `+${s}` : `−${s}`
}
