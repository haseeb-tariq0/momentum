import { api } from './api'

// Reports are permissioned individually so super admin can grant a single
// report to a specific user without promoting them. Keys match the
// ReportSlug values in lib/reportVisibility.ts (underscored, with a
// `view_report_` prefix). Order mirrors the Reports page template gallery.
export const REPORT_PERMISSIONS = [
  'view_report_time',
  'view_report_utilization',
  'view_report_active_projects',
  'view_report_client_profitability',
  'view_report_compliance',
  'view_report_partner_report',
  'view_report_partner_billing',
  'view_report_task_report',
  'view_report_project_progress',
  'view_report_client_timesheet',
  'view_report_pnl',
] as const

export const ALL_PERMISSIONS = [
  'view_projects', 'manage_projects', 'delete_projects',
  'view_financials', 'manage_financials',
  'view_team', 'manage_team', 'invite_members',
  'view_timesheets', 'manage_timesheets',
  ...REPORT_PERMISSIONS,
  'manage_admin', 'manage_rate_cards', 'manage_clients',
] as const

export type Permission = typeof ALL_PERMISSIONS[number]

export const PERMISSION_LABELS: Record<Permission, string> = {
  view_projects: 'View Projects', manage_projects: 'Create & Edit Projects', delete_projects: 'Delete Projects',
  view_financials: 'View Financials & Budgets', manage_financials: 'Edit Financial Settings',
  view_team: 'View Team Members', manage_team: 'Edit Team Members', invite_members: 'Invite New Members',
  view_timesheets: 'View Timesheets', manage_timesheets: 'Manage All Timesheets',
  view_report_time:                 'Time Registered',
  view_report_utilization:          'Utilization',
  view_report_active_projects:      'Active Projects',
  view_report_client_profitability: 'Client Profitability',
  view_report_compliance:           'Compliance',
  view_report_partner_report:       'Partner Report',
  view_report_partner_billing:      'Partner Billing',
  view_report_task_report:          'Task Report',
  view_report_project_progress:     'Project Progress',
  view_report_client_timesheet:     'Client Timesheet',
  view_report_pnl:                  'P&L',
  manage_admin: 'Access Admin Panel',
  manage_rate_cards: 'Manage Rate Cards', manage_clients: 'Manage Clients',
}

export const PERMISSION_GROUPS = [
  { label: 'Projects',   keys: ['view_projects', 'manage_projects', 'delete_projects'] },
  { label: 'Financials', keys: ['view_financials', 'manage_financials'] },
  { label: 'Team',       keys: ['view_team', 'manage_team', 'invite_members'] },
  { label: 'Timesheets', keys: ['view_timesheets', 'manage_timesheets'] },
  { label: 'Reports',    keys: [...REPORT_PERMISSIONS] },
  { label: 'Admin',      keys: ['manage_admin', 'manage_rate_cards', 'manage_clients'] },
] as { label: string; keys: Permission[] }[]

export const authApi = {
  login:          (email: string, password: string) => api.post('/auth/login', { email, password }),
  refresh:        ()                                => api.post('/auth/refresh'),
  logout:         ()                                => api.post('/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/account/change-password', { currentPassword, newPassword }),
  invite:  (data: any) => api.post('/auth/invite', {
    email: data.email, name: data.name, job_title: data.jobTitle,
    seat_type: data.seatType, permission_profile: data.permissionProfile,
    department_id: data.departmentId || null, capacity_hrs: data.capacityHrs,
    internal_hourly_cost: data.internalHourlyCost,
    custom_role_id: data.customRoleId || null,
  }),
}

export const projectsApi = {
  list:   (params?: any) => api.get('/projects', params),
  get:    (id: string)   => api.get(`/projects/${id}`),
  // Apr 23 — planning-stage projects surface as templates via this endpoint.
  // Returns [{ id, name, color, phase_count, task_count }]. Used by the "Template"
  // dropdown on project create.
  templates: ()          => api.get('/projects/templates'),
  create: (data: any)    => api.post('/projects', {
    name: data.name, description: data.description, client_id: data.client_id || data.clientId,
    status: data.status || 'running', color: data.color || '#0D9488',
    budget_type: data.budget_type || data.budgetType || 'fixed_price',
    budget_amount: data.budget_amount || data.budgetAmount, budget_hrs: data.budget_hrs || data.budgetHrs,
    currency: data.currency || 'AED', start_date: data.start_date || data.startDate,
    end_date: data.end_date || data.endDate, label_ids: data.label_ids || data.labelIds,
    rate_card_id: data.rate_card_id || data.rateCardId,
    template_id: data.template_id || data.templateId,
    source_project_id: data.source_project_id || data.sourceProjectId,
  }),
  update:        (id: string, data: any) => api.patch(`/projects/${id}`, data),
  delete:        (id: string)            => api.delete(`/projects/${id}`),
  addMembers:    (id: string, userIds: string[]) =>
    api.post(`/projects/${id}/members`, { user_ids: userIds }),
  addDepartment: (id: string, departmentId: string) =>
    api.post(`/projects/${id}/members/department`, { department_id: departmentId }),
  removeMember:  (id: string, userId: string) =>
    api.delete(`/projects/${id}/members/${userId}`),
}

export const templatesApi = {
  list:   ()                          => api.get('/templates'),
  get:    (id: string)                => api.get(`/templates/${id}`),
  create: (data: any)                 => api.post('/templates', data),
  update: (id: string, data: any)     => api.patch(`/templates/${id}`, data),
  delete: (id: string)                => api.delete(`/templates/${id}`),
}

export const phasesApi = {
  create: (projectId: string, data: any) => api.post(`/projects/${projectId}/phases`, {
    name: data.name, description: data.description,
    start_date: data.start_date || data.startDate, end_date: data.end_date || data.endDate,
    sort_order: data.sort_order ?? data.sortOrder ?? 0,
  }),
  update: (projectId: string, phaseId: string, data: any) => api.patch(`/projects/${projectId}/phases/${phaseId}`, data),
  delete: (projectId: string, phaseId: string)             => api.delete(`/projects/${projectId}/phases/${phaseId}`),
}

export const tasksApi = {
  list:   (projectId: string) => api.get(`/projects/${projectId}/tasks`),
  create: (projectId: string, data: any) => api.post(`/projects/${projectId}/tasks`, {
    phase_id: data.phase_id || data.phaseId, title: data.title, description: data.description,
    estimated_hrs: data.estimated_hrs ?? data.estimatedHrs, status: data.status || 'todo',
    billable: data.billable ?? true, start_date: data.start_date || data.startDate,
    due_date: data.due_date || data.dueDate, sort_order: data.sort_order ?? data.sortOrder ?? 0,
    assignee_ids: data.assignee_ids || data.assigneeIds || [],
  }),
  update: (projectId: string, taskId: string, data: any) => api.patch(`/projects/${projectId}/tasks/${taskId}`, {
    title: data.title, description: data.description,
    estimated_hrs: data.estimated_hrs ?? data.estimatedHrs,
    status: data.status, billable: data.billable,
    due_date: data.due_date || data.dueDate, assignee_ids: data.assignee_ids || data.assigneeIds,
  }),
  delete:         (projectId: string, taskId: string) => api.delete(`/projects/${projectId}/tasks/${taskId}`),
  addAssignees:   (projectId: string, taskId: string, userIds: string[]) =>
    api.post(`/projects/${projectId}/tasks/${taskId}/assignees`, { userIds }),
  removeAssignee: (projectId: string, taskId: string, userId: string) =>
    api.delete(`/projects/${projectId}/tasks/${taskId}/assignees/${userId}`),
  getComments:    (projectId: string, taskId: string) =>
    api.get(`/projects/${projectId}/tasks/${taskId}/comments`),
  addComment:     (projectId: string, taskId: string, body: string) =>
    api.post(`/projects/${projectId}/tasks/${taskId}/comments`, { body }),
  deleteComment:  (projectId: string, taskId: string, commentId: string) =>
    api.delete(`/projects/${projectId}/tasks/${taskId}/comments/${commentId}`),
  reorderTasks: (projectId: string, phaseId: string, items: { id: string; sort_order: number }[]) =>
    api.post(`/projects/${projectId}/phases/${phaseId}/tasks/reorder`, { items }),
}

export const timeApi = {
  week:     (date?: string, userId?: string) =>
    api.get('/time/week', { ...(date ? { date } : {}), ...(userId ? { userId } : {}) }),
  teamWeek: (date?: string) => api.get('/time/team-week', date ? { date } : undefined),
  project:  (projectId: string, params?: { from?: string; to?: string }) =>
    api.get(`/time/project/${projectId}`, params),
  log:  (data: any) => api.post('/time', {
    task_id: data.task_id || data.taskId,
    internal_time_category_id: data.internal_time_category_id || data.internalTimeCategoryId,
    time_off_category_id: data.time_off_category_id || data.timeOffCategoryId,
    date: data.date, hours: data.hours, billable: data.billable ?? true,
    note: data.note, type: data.type || 'project',
    target_user_id: data.target_user_id || data.targetUserId,
  }),
  update:      (id: string, data: any)    => api.put(`/time/${id}`, data),
  delete:      (id: string)               => api.delete(`/time/${id}`),
  tasks:       (params?: any)             => api.get('/time/tasks', params),
  categories:  ()                         => api.get('/time/categories'),
  createInternalCategory:  (name: string) => api.post('/time/categories/internal',  { name }),
  updateInternalCategory:  (id: string, data: any) => api.patch(`/time/categories/internal/${id}`, data),
  deleteInternalCategory:  (id: string)   => api.delete(`/time/categories/internal/${id}`),
  createTimeOffCategory:   (name: string) => api.post('/time/categories/time-off', { name }),
  updateTimeOffCategory:   (id: string, data: any) => api.patch(`/time/categories/time-off/${id}`, data),
  deleteTimeOffCategory:   (id: string)   => api.delete(`/time/categories/time-off/${id}`),
  report:      (params?: any)             => api.get('/time/report', params),
  // Flat entries for a date range — powers the Time Registered report tab
  entries:     (params?: { from?: string; to?: string; user_id?: string; project_id?: string; client_id?: string; include_all_types?: string }) =>
    api.get('/time/entries', params),
  submissions: (weekStart: string)        => api.get('/time/submissions', { weekStart }),
  submit:      (weekStart: string, note?: string) => api.post('/time/submit', { weekStart, note }),
  unsubmit:    (weekStart: string, userId?: string) => api.delete('/time/submit', { weekStart, userId }),
}

export const usersApi = {
  me:     () => api.get('/users/me'),
  list:   (params?: any) => api.get('/users', params),
  get:    (id: string)   => api.get(`/users/${id}`),
  update: (id: string, data: any) => api.patch(`/users/${id}`, {
    name: data.name, job_title: data.job_title || data.jobTitle,
    seat_type: data.seat_type || data.seatType,
    permission_profile: data.permission_profile || data.permissionProfile,
    department_id: data.department_id || data.departmentId,
    capacity_hrs: data.capacity_hrs ?? data.capacityHrs,
    internal_hourly_cost: data.internal_hourly_cost ?? data.internalHourlyCost,
  }),
  updatePermissions: (id: string, overrides: Record<string, boolean>) =>
    api.patch(`/users/${id}/permissions`, overrides),
  delete: (id: string) => api.delete(`/users/${id}`),
  workspace:           ()          => api.get('/users/workspace'),
  updateWorkspace:     (data: any) => api.patch('/users/workspace', data),
  timesheetCompliance: (weekStart?: string) =>
    api.get('/users/timesheet-compliance', weekStart ? { weekStart } : undefined),
  departments:  ()                => api.get('/users/departments'),
  createDept:   (name: string)    => api.post('/users/departments', { name }),
  calendars:    ()                => api.get('/users/calendars'),
  holidays:     (calendarId: string) => api.get(`/users/calendars/${calendarId}/holidays`),
  addHoliday:   (calendarId: string, data: { name: string; date: string }) =>
    api.post(`/users/calendars/${calendarId}/holidays`, data),
  syncHolidays: (calendarId: string, year?: number) =>
    api.post(`/users/calendars/${calendarId}/sync`, { year }),
  clients:      ()                => api.get('/users/clients'),
  createClient: (data: any)       => api.post('/users/clients', {
    name: data.name, logo_url: data.logo_url || data.logoUrl,
    country: data.country, address: data.address,
    // parent_client_id — lets accounts like Nexa Cognition own sub-clients
    // like Redwood / Bisco (Apr 17 meeting). Null / undefined / empty string
    // all mean "top-level client".
    parent_client_id: data.parent_client_id || data.parentClientId || null,
  }),
  updateClient: (id: string, data: any) => api.patch(`/users/clients/${id}`, data),
  mergeClient:  (sourceId: string, intoClientId: string) =>
    api.post(`/users/clients/${sourceId}/merge`, { into_client_id: intoClientId }),
  labels:       ()                => api.get('/users/labels'),
  createLabel:  (data: { name: string; color: string }) => api.post('/users/labels', data),
  rateCards:    ()                => api.get('/users/rate-cards'),
  createRateCard: (data: { name: string; currency?: string; default_hourly_rate?: number }) =>
    api.post('/users/rate-cards', data),
  updateRateEntry: (cardId: string, entryId: string, data: { hourly_rate?: number; department_id?: string | null; job_title?: string | null }) =>
    api.patch(`/users/rate-cards/${cardId}/entries/${entryId}`, data),
  addRateEntry: (cardId: string, data: { job_title?: string; department_id?: string; hourly_rate: number }) =>
    api.post(`/users/rate-cards/${cardId}/entries`, data),
  deleteRateEntry: (cardId: string, entryId: string) =>
    api.delete(`/users/rate-cards/${cardId}/entries/${entryId}`),
  updateProfile: (id: string, data: { name?: string; job_title?: string; avatar_url?: string }) =>
    api.patch(`/users/${id}`, data),
  createCalendar: (data: { name: string; country?: string }) => api.post('/users/calendars', data),
  deleteCalendar: (id: string) => api.delete(`/users/calendars/${id}`),
  addHolidayToCalendar: (calendarId: string, data: { name: string; date: string }) =>
    api.post(`/users/calendars/${calendarId}/holidays`, data),
  deleteHoliday: (calendarId: string, holidayId: string) =>
    api.delete(`/users/calendars/${calendarId}/holidays/${holidayId}`),
  weekCapacity:     (weekStart: string)           => api.get('/users/me/week-capacity', { weekStart }),
  customRoles:      ()                            => api.get('/users/custom-roles'),
  createCustomRole: (data: { name: string; base_role: string }) => api.post('/users/custom-roles', data),
  updateCustomRole: (id: string, data: { name?: string; base_role?: string }) => api.patch(`/users/custom-roles/${id}`, data),
  deleteCustomRole: (id: string)                 => api.delete(`/users/custom-roles/${id}`),

  // Forecast.it live sync — see apps/user-service/src/routes/sync.ts
  syncStatus:      () => api.get('/users/sync/status'),
  syncRunNow:      () => api.post('/users/sync/run-now'),
  syncPause:       () => api.post('/users/sync/pause'),
  syncResume:      () => api.post('/users/sync/resume'),
  syncDisconnect:  () => api.post('/users/sync/disconnect'),
}

// NOTE on paths: the gateway proxies /api/v1/reports/* → user-service /reports/*
// (see apps/api-gateway/src/index.ts line 82). Use '/reports/...' NOT '/users/reports/...'.
export const reportsApi = {
  activeProjects: () => api.get('/reports/active-projects'),
  partner:        (params: { client_id: string; from?: string; to?: string }) =>
    api.get('/reports/partner', params),
  partnerBulk:    (params: { month: string }) =>
    api.get('/reports/partner-bulk', params),
  // Partner Billing (Apr 22): what we actually BILLED each partner-like
  // client, sourced from client_invoices (the Finance Sheet). Complements
  // Partner Report (which shows what we SHOULD bill based on hours × rate
  // card). Range is snapped to full-month boundaries server-side.
  partnerBilling: (params?: { from?: string; to?: string }) =>
    api.get('/reports/partner-billing', params),
  clientProfitability: (params?: { client_id?: string; month?: string; from?: string; to?: string }) =>
    api.get('/reports/client-profitability', params),
  costOfEffort:   (params?: { client_id?: string; from?: string; to?: string }) =>
    api.get('/reports/cost-of-effort', params),
  // Export any report's data as a real Google Sheet in the service account's
  // Drive. Returns the URL so the frontend can open it in a new tab.
  exportGoogleSheet: (data: { title: string; sheets: { name: string; headers: string[]; rows: any[][] }[] }) =>
    api.post('/reports/export-google-sheet', data),
  configs:        () => api.get('/reports/configs'),
  createConfig:   (data: { name: string; report_type: string; config: any }) =>
    api.post('/reports/configs', data),
  updateConfig:   (id: string, data: any) => api.patch(`/reports/configs/${id}`, data),
  deleteConfig:   (id: string) => api.delete(`/reports/configs/${id}`),
  duplicateConfig:(id: string) => api.post(`/reports/configs/${id}/duplicate`),
}

export const financeApi = {
  // Manual xlsx upload (fallback / one-off imports)
  importSheet:    (data: { rows: any[]; defaultCurrency?: string }) =>
    api.post('/users/import/finance-sheet', data),
  // Live Google Sheets sync
  syncGoogleSheet: (data?: { spreadsheet_id?: string; defaultCurrency?: string }) =>
    api.post('/users/import/finance-sheet/sheets-sync', data || {}),
  syncStatus:     () => api.get('/users/import/finance-sheet/status'),
  // Configure which sheet to sync from (URL or ID)
  setSheetUrl:    (sheetUrlOrId: string) =>
    api.post('/users/import/finance-sheet/config', { sheet_url: sheetUrlOrId }),
  // Shared between both sources
  unmatched:      () => api.get('/users/import/finance-sheet/unmatched'),
  mapClient:      (rawName: string, clientId: string) =>
    api.post('/users/import/finance-sheet/map-client', { raw_name: rawName, client_id: clientId }),
  autoCreateClients: () =>
    api.post('/users/import/finance-sheet/auto-create-clients', {}),
  syncSoftwareCosts: () =>
    api.post('/users/import/software-costs/sync', {}),
}

export const searchApi = {
  query: (q: string) => api.get('/search', { q }),
}

export const slackApi = {
  getAuthUrl:   () => api.get('/auth/slack'),
  configured:   () => api.get('/auth/slack/configured'),
  status:       () => api.get('/slack/status'),
  channels:     () => api.get('/slack/channels'),
  setChannel:   (channelId: string, channelName: string) => api.patch('/slack/channel', { channelId, channelName }),
  sendTest:     () => api.post('/slack/test', {}),
  disconnect:   () => api.delete('/slack/disconnect'),
}
