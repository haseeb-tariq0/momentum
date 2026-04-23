// ─── JWT Payload ──────────────────────────────────────────────────────────────
export interface JwtPayload {
  sub: string        // user id
  wid: string        // workspace id
  role: 'admin' | 'manager' | 'member'
  jti: string        // unique token id (for denylist)
  iat: number
  exp: number
}

// ─── API Envelope ─────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T
  meta?: {
    page?: number
    limit?: number
    total?: number
    nextCursor?: string | null
  }
}

export interface ApiError {
  errors: Array<{
    code: string
    message: string
    field?: string
  }>
}

// ─── Domain types ─────────────────────────────────────────────────────────────
export type Role = 'admin' | 'manager' | 'member'
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived'
export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'
export type MilestoneStatus = 'upcoming' | 'reached' | 'missed'
export type ReportType = 'utilization' | 'burn_rate' | 'logged_vs_estimated' | 'forecast'
export type ReportStatus = 'pending' | 'ready' | 'failed'

export interface WorkspaceDto {
  id: string
  name: string
  plan: string
  createdAt: string
}

export interface UserDto {
  id: string
  workspaceId: string
  email: string
  name: string
  avatarUrl: string | null
  role: Role
  capacityHrs: number
  timezone: string
  active: boolean
  createdAt: string
}

export interface ProjectDto {
  id: string
  workspaceId: string
  name: string
  description: string | null
  budgetHrs: number | null
  startDate: string | null
  endDate: string | null
  status: ProjectStatus
  color: string
  createdAt: string
}

export interface TaskDto {
  id: string
  projectId: string
  assigneeId: string | null
  title: string
  description: string | null
  estimatedHrs: number | null
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  createdAt: string
}

export interface TimeEntryDto {
  id: string
  userId: string
  taskId: string
  date: string
  hours: number
  note: string | null
  createdAt: string
}

export interface MilestoneDto {
  id: string
  projectId: string
  name: string
  dueDate: string
  status: MilestoneStatus
}

export interface ReportDto {
  id: string
  workspaceId: string
  type: ReportType
  filters: Record<string, unknown>
  status: ReportStatus
  s3Url: string | null
  generatedAt: string | null
  createdAt: string
}

// ─── Domain Events ────────────────────────────────────────────────────────────
export type DomainEvent =
  | { type: 'TIME_LOGGED';         payload: { userId: string; taskId: string; projectId: string; hours: number; date: string } }
  | { type: 'PROJECT_CREATED';     payload: { projectId: string; workspaceId: string } }
  | { type: 'TASK_ASSIGNED';       payload: { taskId: string; userId: string; projectId: string } }
  | { type: 'MEMBER_ADDED';        payload: { projectId: string; userId: string } }
  | { type: 'USER_DEACTIVATED';    payload: { userId: string; workspaceId: string } }
  | { type: 'ROLE_CHANGED';        payload: { userId: string; oldRole: Role; newRole: Role } }
  | { type: 'PROJECT_BUDGET_80PCT';payload: { projectId: string; workspaceId: string; pct: number } }
  | { type: 'REPORT_READY';        payload: { reportId: string; userId: string } }
