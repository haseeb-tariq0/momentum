/**
 * Role-based report visibility — updated Apr 22 after the over-extended
 * Apr 21 lockdown was reviewed against the Apr 17 meeting transcript.
 *
 * Per Apr 17 meeting with Murtaza (verbatim 3-tier spec):
 *   "By default we will create it so that the Account Manager should see
 *    these specific reports [Active Projects + Client Profitability, plus
 *    the baseline two], the Super Admin should see all reports, and a
 *    normal user should only see his Utilization and Time Registered."
 *
 * So:
 *   - Super Admin / Admin    → all reports
 *   - Account Manager        → baseline + Active Projects + Client Profitability
 *   - Collaborator           → baseline only (Time Registered + Utilization)
 *
 * Report status after Apr 22 review:
 *   • Time Registered      — ships Phase 1, full implementation (all roles)
 *   • Utilization          — ships Phase 1, full implementation (all roles)
 *   • Active Projects      — ships Phase 1, full implementation (AM + admin)
 *   • Client Profitability — ships Phase 1, full implementation (AM + admin)
 *   • Compliance           — ships Phase 1, full implementation (admin only)
 *   • Partner Report       — STUB restored, template-based per Murtaza's Apr 17 vision (admin only)
 *   • Partner Billing      — STUB restored, finance-sheet + sub-client logic (admin only)
 *   • Task Report          — STUB restored (admin only)
 *   • Project Progress     — STUB restored, scoping in Phase 2 (admin only)
 *   • Client Timesheet     — STUB restored, scope TBD with Murtaza (admin only)
 *   • P&L                  — Phase 2 placeholder (SUPER_ADMIN ONLY)
 *
 * Only Cost of Effort was deleted outright — Murtaza explicitly approved
 * that on Apr 17 because its data was already shown inside Client
 * Profitability.
 */

export type PermissionProfile =
  | 'super_admin'
  | 'admin'
  | 'account_manager'
  | 'collaborator'

export type ReportSlug =
  | 'time'
  | 'utilization'
  | 'client-profitability'
  | 'active-projects'
  | 'compliance'
  | 'partner-report'
  | 'partner-billing'
  | 'task-report'
  | 'project-progress'
  | 'client-timesheet'
  | 'pnl'

// Ordered list — tabs + template gallery render in this order. Phase-1 core
// reports come first, then the Phase-2 / stub reports, then P&L at the end.
export const ALL_REPORT_SLUGS: readonly ReportSlug[] = [
  'time',
  'utilization',
  'active-projects',
  'client-profitability',
  'compliance',
  'partner-report',
  'partner-billing',
  'task-report',
  'project-progress',
  'client-timesheet',
  'pnl',
] as const

// Phase-1 core reports that Murtaza called out by name on Apr 17. These
// govern the 3-tier visibility rule below — the additional restored
// reports default to admin-only (see canSeeReport).
const COLLABORATOR_ACCESS: ReportSlug[] = ['time', 'utilization']

const ACCOUNT_MANAGER_ACCESS: ReportSlug[] = [
  ...COLLABORATOR_ACCESS,
  'active-projects',
  'client-profitability',
]

// Compliance + restored stubs are admin-tier. P&L is super_admin only.
const SUPER_ADMIN_ONLY: ReportSlug[] = ['pnl']

/** True iff the given permission profile is allowed to see this report. */
export function canSeeReport(
  slug: ReportSlug,
  profile: PermissionProfile | null | undefined,
): boolean {
  if (!profile) return false
  if (SUPER_ADMIN_ONLY.includes(slug)) return profile === 'super_admin'
  if (profile === 'super_admin' || profile === 'admin') return true
  if (profile === 'account_manager') return ACCOUNT_MANAGER_ACCESS.includes(slug)
  if (profile === 'collaborator')    return COLLABORATOR_ACCESS.includes(slug)
  return false
}

/** Slugs the given profile may see, in the canonical display order. */
export function visibleReports(
  profile: PermissionProfile | null | undefined,
): ReportSlug[] {
  if (!profile) return []
  return ALL_REPORT_SLUGS.filter(s => canSeeReport(s, profile))
}
