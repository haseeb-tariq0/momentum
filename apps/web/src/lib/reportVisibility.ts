/**
 * Report visibility — per-user editable as of Apr 24.
 *
 * History: was hard-coded 3-tier per Apr 17 meeting. Replaced with a
 * permission-driven system so super admin can grant/revoke individual
 * reports on a per-user basis from /admin → Permissions without having
 * to edit code or promote a collaborator to an admin role.
 *
 * Defaults per profile (set in apps/web/src/app/(dashboard)/admin/page.tsx
 * ROLE_DEFAULTS) preserve the prior 3-tier behavior:
 *   super_admin    → all 11 reports
 *   admin          → all except P&L
 *   account_manager→ time + utilization + active_projects + client_profitability
 *   collaborator   → time + utilization
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

// Ordered list — tabs + template gallery render in this order.
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

// Slug → permission key mapping. Dashes become underscores and we prefix
// with `view_report_`. Must stay in lockstep with REPORT_PERMISSIONS in
// apps/web/src/lib/queries.ts.
export function reportPermissionKey(slug: ReportSlug): string {
  return `view_report_${slug.replace(/-/g, '_')}`
}

export type PermissionMap = Record<string, boolean> | null | undefined

/**
 * True iff the user is allowed to see this report.
 *
 * Two overloads for backward compat:
 *   • (slug, permissions)  — NEW, preferred. Reads the resolved permission
 *     map returned from the server (role defaults + per-user overrides).
 *   • (slug, profile)      — LEGACY. Falls back to the Apr 17 3-tier rule
 *     when a permission map isn't available yet (e.g. before /auth/me
 *     caches are warmed). Kept so we don't have to update every call site
 *     in one pass.
 */
export function canSeeReport(
  slug: ReportSlug,
  permissionsOrProfile: PermissionMap | PermissionProfile | null | undefined,
): boolean {
  if (!permissionsOrProfile) return false
  // Permission-map overload.
  if (typeof permissionsOrProfile === 'object') {
    return permissionsOrProfile[reportPermissionKey(slug)] === true
  }
  // Legacy profile overload — preserves the original 3-tier rule exactly.
  const profile = permissionsOrProfile
  const COLLABORATOR_ACCESS: ReportSlug[] = ['time', 'utilization']
  const ACCOUNT_MANAGER_ACCESS: ReportSlug[] = [...COLLABORATOR_ACCESS, 'active-projects', 'client-profitability']
  if (slug === 'pnl') return profile === 'super_admin'
  if (profile === 'super_admin' || profile === 'admin') return true
  if (profile === 'account_manager') return ACCOUNT_MANAGER_ACCESS.includes(slug)
  if (profile === 'collaborator')    return COLLABORATOR_ACCESS.includes(slug)
  return false
}

/** Slugs the given profile (or permission map) may see, in display order. */
export function visibleReports(
  permissionsOrProfile: PermissionMap | PermissionProfile | null | undefined,
): ReportSlug[] {
  if (!permissionsOrProfile) return []
  return ALL_REPORT_SLUGS.filter(s => canSeeReport(s, permissionsOrProfile))
}
