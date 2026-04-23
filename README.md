# Forecast — Internal Project Tracker
### Built for Digital Nexa · Replacing Forecast.app · Manager: Murtaza Talib

---

## 🚀 Quick Start

```bash
cd D:\forecast
pnpm dev
```

| Service | URL | Port |
|---|---|---|
| Frontend (Next.js) | http://localhost:3000 | 3000 |
| API Gateway | http://localhost:4000 | 4000 |
| Auth Service | — | 3001 |
| Project Service | — | 3002 |
| Time Service | — | 3003 |
| User Service | — | 3004 |
| Notification Service | — | 3006 |

### Login Credentials (all use `password123`)
| Email | Role |
|---|---|
| murtaza@digitalnexa.com | Super Admin |
| haseeb@digitalnexa.com | Super Admin |
| bob@digitalnexa.com | Collaborator |

### Supabase
- Project ref + service-role key live in `.env.local` (gitignored).
- **Never commit Supabase service-role keys or Forecast.it API keys to this repo.**
- See `.env.local.example` for the required variable names.

---

## 📅 Development Log

---

### Week 1 — March 24–26, 2026

#### March 24, 2026 — Project Setup & Architecture

**Goal:** Build a full internal project tracker from scratch to replace Forecast.app for Digital Nexa (58 team members, 190 running projects).

**What was done:**
- Set up monorepo using pnpm workspaces + Turborepo
- Chose microservices architecture: each feature area gets its own Fastify service
- Created 6 services: `web` (Next.js 14), `api-gateway`, `auth-service`, `project-service`, `time-service`, `user-service`
- Set up Supabase (PostgreSQL) as the database (project ref in `.env.local`)
- Designed the full database schema with **18+ tables**
- Set up JWT authentication with 3 permission roles: `super_admin`, `admin`, `collaborator`
- Built API Gateway on port 4000 to route all frontend requests to the correct service
- Fixed CORS by routing through Next.js rewrites (`/api/v1/*` → `localhost:4000`)
- Seeded the database with test data: 10 users, 6 projects, 5 clients, 22 tasks, 3 rate cards

---

#### March 25, 2026 — Core Pages & Dashboard

**What was done:**
- Built the **Login page** with Quick Access buttons for fast dev testing
- Built the **Dashboard (My Work) page**: week progress, assigned tasks, budget alert banner
- Built the **Projects page**: accordion list, phases, tasks, New Project modal, status tabs
- Built the **Resourcing page**: weekly capacity grid, allocation form
- Applied dark theme with blue accent color system (`--mint: #3B82F6`)

---

#### March 26, 2026 — Project Detail & Financials

**What was done:**
- Built the **Project Detail page** with 4 tabs: Scoping, Financials, Team, Settings
- Built multi-assignee picker (floating, search by name/job title)
- Budget tracking with 4 alert thresholds: 70%, 80%, 90%, 100%
- Cost by role breakdown table: Rate/hr × Hours = Cost per job title
- Project membership system via `project_members` table

---

### Week 2 — March 27–30, 2026

#### March 27, 2026 — Timesheets & Time Tracking

**What was done:**
- Built **My Timesheet** tab: week grid, auto-populated tasks, inline hour entry, Copy Previous Week, Submit Week, lock flow
- Built **Team View** tab (admin only): all projects → tasks → each person's hours per day
- Built `timesheet_submissions` table with submit/lock/unlock flow

---

#### March 28, 2026 — Reports, Admin Panel & Notifications

**What was done:**
- Built **Reports page** with 4 tabs: P&L, Utilization, Compliance, Progress — all with CSV export
- Built **Admin panel** with 7 tabs: Workspace Settings, Rate Cards, Clients, Labels, Departments, Holiday Calendars, Timesheet Compliance
- Built **Team page**: search, filter, stats, coloured avatars, role badges
- Built **Notifications bell**: budget alerts, overdue task warnings, compliance reminders
- Fixed PostgREST double foreign key bug on `project_members` table

---

#### March 29, 2026 — Collaborator Permissions & Project Membership

**What was done:**
- Defined full permission matrix (see table below)
- `canAccessProject()` helper on the backend
- Collaborator-gated create, assign, status-change flows
- `AssignMeButton` component, `StatusSelect` with `isEditable` prop

---

#### March 30, 2026 — Admin Timesheet Editing & Bug Fixes

**What was done:**
- Admin can edit any user's time entry inline (PUT/DELETE `/time/:id`)
- Rewrote All Timesheets admin page with `EditableCell` component
- Improved Team page: 4 stat cards, search, department + role filters, avatar colours
- All 5 services confirmed running (3001–3004, 4000)

---

### Sprint 5 — March 31 – April 1, 2026

#### Sprint 5 — Feature Completions (P1)

**Auth & Session:**
- ✅ Session persistence across page reloads (localStorage + auto-refresh)
- ✅ Account Manager role added between Collaborator and Admin
- ✅ Password change flow in profile settings
- ✅ Profile settings page (`/settings`)

**Projects:**
- ✅ Due date chips on tasks (colour-coded: amber = soon, red = overdue)
- ✅ Billable toggle per task
- ✅ Label filter on projects list
- ✅ Client grouping mode on projects list
- ✅ Task comments thread — 💬 button opens threaded discussion per task
- ✅ Drag-to-reorder tasks — ⠿ handle to drag tasks within a phase
- ✅ Inline time log widget — ⏱ button opens log-time panel directly on task row

**Timesheets:**
- ✅ Weekly grid with Copy Previous Week
- ✅ Submit/lock flow with confirmation
- ✅ Team View tab with per-person breakdown

---

#### Sprint 5 — Admin Completions (P2)

**Admin → People tab:**
- ✅ Inline cell editing (click any cell to edit department, job title, seat type, role, capacity)
- ✅ Invite Member form (name, email, job title, seat type, role, department, capacity, cost)
- ✅ Deactivate user button
- ✅ Custom Permissions editor (per-user override of role defaults with OVERRIDE badges)
- ✅ **Person names are clickable links** → navigates to `/team/[id]` profile page

**Admin → Rate Cards:**
- ✅ Create/edit rate cards with currency
- ✅ Add/remove rate entries (job title → hourly rate) inline
- ✅ Live save on blur

**Admin → Departments, Clients, Labels:**
- ✅ Full CRUD for departments, clients, labels
- ✅ Colour picker for labels

**Admin → Time Categories:**
- ✅ Internal Time categories (non-billable overhead)
- ✅ Time Off categories (annual leave, sick leave)
- ✅ Deactivate/reactivate without deleting logged time

**Admin → Holiday Calendars tab:**
- ✅ `+ Add Country` button opens searchable country picker modal (100+ countries)
- ✅ Auto-syncs public holidays on add (Nager.Date API)
- ✅ `↻ Auto-sync` / `Manual only` badges per calendar
- ✅ Sync button with year picker per calendar
- ✅ Manual holiday add (name + date)
- ✅ Per-holiday delete

**Admin → Workspace Settings:**
- ✅ Workspace name, default currency
- ✅ Utilisation targets (Resource % and Billable %)
- ✅ Timesheet rules (weekends enabled, allow late entries, allow over-estimate, allow entries on done tasks)
- ✅ Submission deadline day-of-week picker
- ✅ Email Notification triggers (Weekly Digest, Timesheet Reminder, Budget Check) via SendGrid

**Admin → Import Forecast tab:**
- ✅ API key input with test connection (shows people/clients/projects count)
- ✅ Per-category import checkboxes (departments, users, clients, projects, tasks)
- ✅ Streaming SSE import with live progress log
- ✅ Final import summary with counts

---

#### Sprint 5 — Reports (P2)

- ✅ **Time Registered** tab — hours per person per project
- ✅ **Utilization** tab — capacity vs logged vs billable per person
- ✅ **P&L** tab — budget vs cost vs profit per project with margin %
- ✅ **Task Report** tab — completion rates, overdue counts per project
- ✅ **Compliance** tab — timesheet submission rates per person per week
- ✅ **Project Progress** tab — phase/task completion percentages

---

#### Sprint 5 — Other Features (P2)

- ✅ **My Work** page: cleaned up, "Log Time" widget removed from right sidebar
- ✅ **Timer widget** (bottom-left): start/stop timer, shows running task name, Change Task button
- ✅ **Global Search (⌘K)**: fuzzy search across projects, tasks, people — keyboard navigable
- ✅ **Resourcing page**: fully wired, allocation create/delete, capacity bars, week navigation
- ✅ **Settings** page: placeholder for future workspace settings
- ✅ **notification-service** added on port 3006 (SendGrid email)

---

#### Sprint 5 — Person Profile Page `/team/[id]` (P3)

**New page** — comprehensive person profile:
- ✅ Avatar display with Upload Photo / Remove buttons
- ✅ Status badge (Active / Deactivated)
- ✅ Editable fields: Full Name, Email, Job Title, Start Date, End Date
- ✅ Role & Permissions: Permission Profile, Seat Type, Department, Holiday Calendar selects
- ✅ Deactivate / Reactivate button (Super Admin only)
- ✅ Holiday Calendar picker with `+ Add new calendar` inline link
- ✅ Capacity (hrs/wk) and Internal Cost (AED/hr) inputs
- ✅ Skills section: add/remove skill tags
- ✅ Project Assignments: lists all projects the person is a member of
- ✅ Working Hours grid: per-day input (Mon–Sun) with weekly total
- ✅ Save Changes button with success flash

---

#### Sprint 5 — Build Error Fix (P3)

**Problem:** `projects/[id]/page.tsx` had accumulated hidden encoding issues causing SWC/TSX parser to fail with "Unexpected token `div`".

**Fix:** Completely rewrote the file from scratch:
- All `useState<...>` generics replaced with `useState(null as Type)` pattern
- All `useRef<...>` replaced with `useRef(null as any)`
- All `Record<string, X>` type annotations replaced with `any`
- `handleDrop` moved from inside `.map()` callback to component scope
- IIFE in JSX replaced with simple conditional render
- `pickerTask` computed before return statement

---

### UI Polish — April 1, 2026

#### UI Polish — Custom Dropdowns & ConfirmDialog

**Problem:** All native `<select>` dropdowns showed the browser's default ugly chrome, and all destructive confirmations used the browser's native `confirm()` popup.

---

##### Fix 1: Custom `<select>` Styling — `globals.css`

Added comprehensive CSS that globally reskins every `<select>` element across the entire app without touching any component files.

**What changed — `D:\forecast\apps\web\src\app\globals.css`:**
- `-webkit-appearance: none` / `appearance: none` — removes all browser default chrome
- Custom SVG chevron via `background-image: url(data:image/svg+xml,...)` with `!important` to beat inline `style="background: ..."` shorthand resets
- `padding-right: 32px !important` — space for the chevron
- Themed border (`var(--border-muted)`), background (`var(--bg-surface)`), text colour (`var(--text-primary)`)
- Hover state: slightly stronger border
- Focus state: `border-color: var(--accent)` + `box-shadow: 0 0 0 3px var(--accent-dim)` blue glow
- Disabled state: `opacity: 0.45`, `cursor: not-allowed`
- Dark mode: chevron colour `#8892A4`
- Light mode override: chevron colour `#94A3B8`
- `td select, th select`: `width: auto; min-width: 120px` — preserves natural width in admin table cells
- `select option`: styled background and text for the dropdown list

Also added to `globals.css`:
- **Custom checkbox** styling: `appearance: none`, blue checked state, white checkmark via `::after`
- **Input / textarea focus rings**: consistent `border-color: var(--accent) !important` + blue glow on focus

---

##### Fix 2: `ConfirmDialog` Component — Replaces All `confirm()` Popups

**New file — `D:\forecast\apps\web\src\components\ConfirmDialog.tsx`:**

A globally-mounted React component that replaces every browser `confirm()` dialog with a beautiful, animated modal.

**Features:**
- Blur backdrop (`backdrop-filter: blur(6px)`) with fade-in animation
- Modal panel slides up with spring animation (`cubic-bezier(0.32,1.24,0.6,1)`)
- Warning icon in a red circle
- Custom message (title) + subtext per call
- Divider line between text and buttons
- **Cancel button**: transparent, hover reveals `var(--bg-hover)` fill
- **Confirm button**: solid `var(--rose)` red, red box shadow, hover lifts with `translateY(-1px)`
- Escape key closes the dialog
- Click outside the modal closes it
- Cancel button auto-focused on open for keyboard accessibility
- Custom `confirmLabel` per call (Delete / Deactivate / Remove)

**Usage pattern:**
```typescript
import { showConfirm } from '@/components/ConfirmDialog'

// Instead of: if (confirm('Delete this?')) doIt()
showConfirm('Delete this task?', () => deleteTask.mutate(id), {
  confirmLabel: 'Delete',           // button text
  subtext: 'This cannot be undone.' // optional secondary message
})
```

**Registered in layout — `D:\forecast\apps\web\src\app\(dashboard)\layout.tsx`:**
```tsx
import { ConfirmDialog } from '@/components/ConfirmDialog'
// ...
<ConfirmDialog />  {/* Added alongside GlobalSearch */}
```

---

##### Fix 3: All `confirm()` Calls Replaced — 5 Files

Every native browser `confirm()` dialog in the codebase has been replaced with `showConfirm()`.

| File | Action | confirmLabel | Subtext |
|---|---|---|---|
| `projects/[id]/page.tsx` | Delete phase | Delete | *(default)* |
| `projects/[id]/page.tsx` | Delete task | Delete | *(default)* |
| `admin/page.tsx` | Deactivate user (people table) | Deactivate | "The user will lose access to the platform." |
| `admin/page.tsx` | Remove rate card entry | Remove | *(default)* |
| `admin/page.tsx` | Delete holiday calendar | Delete | "All holidays in this calendar will be permanently removed." |
| `admin/page.tsx` | Deactivate time category | Deactivate | "It won't appear in timesheets but all logged time is kept." |
| `team/[id]/page.tsx` | Deactivate user (profile header) | Deactivate | "The user will lose access to the platform." |
| `resourcing/page.tsx` | Remove allocation | Remove | "This person will be unallocated from the task." |

**Zero** native browser `confirm()` dialogs remain anywhere in the codebase.

---

## ✅ Current Status — What's Built

### Infrastructure
- Monorepo: pnpm + Turborepo, 7 Fastify microservices + Next.js 14 frontend
- Supabase PostgreSQL with 20+ tables, fully seeded
- JWT authentication, 4 permission roles (super_admin, admin, account_manager, collaborator)
- API Gateway routing all services through a single entry point
- Dark + light theme with blue brand color system
- Session persistence with auto-refresh tokens
- SendGrid email notifications (notification-service port 3006)

### Pages (12 complete)

| Page | Route | Status |
|---|---|---|
| Login | `/` | ✅ |
| My Work | `/dashboard` | ✅ |
| Projects List | `/projects` | ✅ |
| Project Detail | `/projects/[id]` | ✅ |
| Resourcing | `/resourcing` | ✅ |
| Timesheets | `/timesheets` | ✅ |
| Team | `/team` | ✅ |
| Person Profile | `/team/[id]` | ✅ |
| Reports | `/reports` | ✅ |
| Admin Panel | `/admin` | ✅ |
| Global Search | `⌘K` anywhere | ✅ |
| Timer Widget | Bottom-left permanent | ✅ |

### Key Features

| Feature | Status |
|---|---|
| Timesheet submit/lock/unlock flow | ✅ |
| Admin edits any person's timesheet inline | ✅ |
| Collaborator permission gates (project membership + task assignment) | ✅ |
| Self-assign for collaborators | ✅ |
| Multi-person task assignees | ✅ |
| Task comments thread | ✅ |
| Drag-to-reorder tasks | ✅ |
| Inline time log per task | ✅ |
| Due date chips (amber = soon, red = overdue) | ✅ |
| Budget tracking with 4 threshold alerts | ✅ |
| P&L calculations (Budget − Cost = Profit + Margin %) | ✅ |
| CSV export (P&L, Compliance, Projects, Timesheets) | ✅ |
| Bulk add project members by department | ✅ |
| Holiday calendars with auto-sync (Nager.Date) | ✅ |
| Custom permissions per user (override role defaults) | ✅ |
| Import from Forecast.it (streaming SSE, 190 projects) | ✅ |
| Email notification triggers (digest, reminders, budget check) | ✅ |
| Person profile with skills, working hours, project list | ✅ |
| Avatar upload | ✅ |
| Global search ⌘K | ✅ |
| Timer widget with running task | ✅ |
| **Custom styled `<select>` dropdowns** (no browser chrome) | ✅ |
| **Styled ConfirmDialog** (replaces all native confirm() popups) | ✅ |
| **Custom styled checkboxes** | ✅ |
| **Consistent input/textarea focus rings** | ✅ |

---

## 🗄️ Database Tables (20+)

| Table | Purpose |
|---|---|
| `workspaces` | Workspace settings (Digital Nexa) |
| `users` | Team members with roles and capacity |
| `departments` | 10 departments (Design, Web, SEO, etc.) |
| `clients` | Client companies (Align Technology, etc.) |
| `projects` | Running projects with budgets |
| `project_labels` | Tags applied to projects |
| `project_members` | Who has access to each project |
| `phases` | Project phases / milestones |
| `tasks` | Individual tasks within phases |
| `task_assignees` | Who is assigned to each task |
| `task_comments` | Threaded comments per task |
| `time_entries` | Hours logged per task per user per day |
| `timesheet_submissions` | Submitted + locked weeks |
| `internal_time_categories` | Internal meeting, admin etc. |
| `time_off_categories` | Annual leave, sick leave etc. |
| `rate_cards` | Hourly billing rates per role |
| `rate_card_entries` | Rate per job title per card |
| `holiday_calendars` | Public holidays per region |
| `allocations` | Planned resource allocations per task |
| `user_skills` | Skills per team member |

**Extra columns added:**
- `workspaces.timesheet_deadline_day` — day of week for submission cutoff
- `holiday_calendars.country_code` — ISO code for auto-sync
- `users.end_date` — employment end date
- `users.start_date` — employment start date

---

## 👥 Permission Matrix

| Action | Non-Member Collaborator | Project-Member Collaborator | Account Manager | Admin | Super Admin |
|---|---|---|---|---|---|
| View project | ❌ | ✅ | ✅ | ✅ | ✅ |
| Create phase | ❌ | ✅ | ✅ | ✅ | ✅ |
| Create task | ❌ | ✅ (auto-assigned) | ✅ | ✅ | ✅ |
| Change task status | ❌ | ✅ own tasks only | ✅ any | ✅ any | ✅ any |
| Assign self | ❌ | ✅ | ✅ | ✅ | ✅ |
| Assign others | ❌ | ❌ | ✅ | ✅ | ✅ |
| Delete task/phase | ❌ | ❌ | ❌ | ✅ | ✅ |
| Add project members | ❌ | ❌ | ✅ | ✅ | ✅ |
| Edit any timesheet | ❌ | ❌ | ❌ | ✅ | ✅ |
| Invite users | ❌ | ❌ | ❌ | ✅ | ✅ |
| Deactivate users | ❌ | ❌ | ❌ | ❌ | ✅ |
| Manage workspace settings | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 🏗️ Architecture

```
D:\forecast\
├── apps\
│   ├── web\                    # Next.js 14 — port 3000
│   ├── api-gateway\            # Fastify — port 4000
│   ├── auth-service\           # JWT login/refresh — port 3001
│   ├── project-service\        # Projects, phases, tasks, assignees — port 3002
│   ├── time-service\           # Time entries, timesheets — port 3003
│   ├── user-service\           # Users, admin, reports — port 3004
│   ├── notification-service\   # SendGrid email — port 3006
│   └── jobs\                   # BullMQ background jobs
├── packages\
│   ├── db\                     # Supabase client (shared)
│   ├── types\                  # Shared TypeScript types
│   └── validators\             # Shared Zod schemas
└── README.md
```

### API Routing (via Gateway port 4000)
```
/auth/*           → auth-service         (3001)
/projects/*       → project-service      (3002)
/resourcing/*     → project-service      (3002)
/time/*           → time-service         (3003)
/users/*          → user-service         (3004)
/reports/*        → user-service         (3004)
/notifications/*  → user-service         (3004)
/notify/*         → notification-service (3006)
```

---

## 🎨 UI System

### Design Tokens — `globals.css`

| Token | Dark | Light | Usage |
|---|---|---|---|
| `--bg-base` | `#0A0B0F` | `#F1F5F9` | Page background |
| `--bg-raised` | `#111318` | `#FFFFFF` | Cards, panels |
| `--bg-surface` | `#161820` | `#F8FAFC` | Input backgrounds |
| `--bg-overlay` | `#1C1F28` | `#EEF2F7` | Tags, overlays |
| `--accent` | `#3B82F6` | `#2563EB` | Primary blue |
| `--rose` | `#F43F5E` | `#DC2626` | Danger / destructive |
| `--amber` | `#F59E0B` | `#D97706` | Warning |
| `--violet` | `#8B5CF6` | `#7C3AED` | Permissions / special |
| `--text-primary` | `#E8EAF0` | `#0F172A` | Main text |
| `--text-secondary` | `#8892A4` | `#475569` | Secondary text |
| `--text-tertiary` | `#4A5568` | `#94A3B8` | Labels, hints |

### Custom Components — `src/components/`

| Component | File | Purpose |
|---|---|---|
| `ConfirmDialog` | `ConfirmDialog.tsx` | Styled modal replacing browser `confirm()` — global, mounted in layout |
| `GlobalSearch` | `GlobalSearch.tsx` | ⌘K fuzzy search modal across all entities |
| `Sidebar` | `layout/Sidebar.tsx` | App navigation sidebar |

### `showConfirm()` API
```typescript
import { showConfirm } from '@/components/ConfirmDialog'

showConfirm(
  'Are you sure?',          // Title shown in bold
  () => doTheAction(),       // Callback — only fires on confirm click
  {
    confirmLabel: 'Delete',  // Button text (default: 'Delete')
    subtext: 'Cannot undo.'  // Secondary message (default: 'This action cannot be undone.')
  }
)
```

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React, TanStack Query |
| Backend | Fastify (TypeScript), Zod validation |
| Database | Supabase (PostgreSQL) |
| Auth | JWT (access + refresh tokens) |
| Email | SendGrid via notification-service |
| Monorepo | pnpm workspaces + Turborepo |
| Styling | Inline CSS with CSS variables (no Tailwind) |
| Runtime | Node.js via tsx (TypeScript execute) |

---

## 🟡 Still To Do

### High Priority
- [ ] Dark mode toggle in the sidebar (theme switcher)
- [ ] Bulk CSV import for remaining team members not in Forecast
- [ ] Weekly digest email auto-send on Monday (currently manual trigger)
- [ ] Mobile responsive layout

### Future Features
- [ ] Slack integration — budget alerts + weekly summary to channel
- [ ] Google Drive — auto-export P&L report weekly
- [ ] AI natural language queries ("How is Invisalign tracking this month?")
- [ ] Budget forecasting based on burn rate
- [ ] Gantt chart view on project detail

---

---

### April 2, 2026 — Meeting Review + Major Sprint (Post-Murtaza Review)

**Meeting summary:** Murtaza + Haseeb 11:23–11:39 AM. Murtaza gave overall positive feedback ("quite amazing") and confirmed the app is nearly ready to present to the bank. Key feedback acted on:

#### Resourcing — Full UX Overhaul (Murtaza's #1 request)
- **Complete rewrite** of `resourcing/page.tsx`
- **Click any empty cell → QuickAddPopup** anchored to that cell: pre-filled person + date, project dropdown, task dropdown (auto-filtered by project), 2/4/6/8h hour presets, "This day" vs "Mon→Fri" span toggle
- **Click allocation pill → AllocDetailPopup**: shows task, project, hours/day, date range, Remove button
- **Colored allocation pills** in grid — project color bar, task name, hours
- **Save bug fixed**: `staleTime: 0` + direct `refetch()` — grid now always refreshes immediately after save
- **New backend**: `GET /resourcing/projects` (running projects for popup dropdown)
- **Fixed** `GET /resourcing/tasks?projectId=xxx` — now correctly filters tasks by project
- **Demo allocations seeded** in DB for Apr 6–10 across all 10 team members
- **⚠️ RESTART NEEDED**: `project-service` must be restarted to pick up new routes

#### Reports — Capacity Calculation Fix (Murtaza's P1)
- Utilization capacity was flat `40h/week`. **Now: working days in date range × daily rate**
- April 2026 = 22 working days × 8h = **176h** (not 40h)
- Subtitle shows formula: `capacity = working days in range × daily rate (date → date)`
- `useMemo` dependency array updated to include `dateFrom, dateTo`

#### Reports — Compliance Clarity (Murtaza's P2)
- Tab was `Compliance (70%)` — confusing. **Now: `Compliance`** (clean label)
- Header now reads: `Previous week: March 23, 2026 | 70% compliance · 7 of 10 team members submitted their timesheet`

#### Reports — Export CSV / Excel / PDF (All 4 tabs)
- Old: CSV only + broken `window.print()` PDF button
- **New `ExportMenu` dropdown** on every tab: CSV, Excel (.xlsx via SheetJS CDN), PDF (.pdf via jsPDF + AutoTable CDN)
- Excel: real `.xlsx` workbooks with auto column widths
- PDF: branded Digital Nexa report with header, stat cards, paginated table, page numbers
- No package install needed — CDN loads on first use, cached in `window.__XLSX__` / `window.__jsPDF__`
- Loading spinner while Excel/PDF generate

---

### Monday April 6, 2026 — Next Review with Murtaza
- **Time:** 4:00–5:15 PM
- **Focus:** Resourcing popup flow demo, reports export, capacity numbers
- **Outstanding:** Drag-to-extend allocation across days (noted for follow-up)
- **Pre-demo checklist:**
  - [ ] Restart `project-service` to activate new resourcing routes
  - [ ] Navigate to Resourcing → Next Week (Apr 6–12) to show allocations
  - [ ] Demo: click empty cell, select project + task, save
  - [ ] Show Utilization tab with 176h capacity
  - [ ] Show Compliance tab clarity
  - [ ] Show Export dropdown (CSV / Excel / PDF)

---

*Last updated: April 2, 2026*
*Built by: Haseeb Tariq — AI Developer, Digital Nexa*
*Supabase project ref: see .env.local*


---

### Monday April 6, 2026 — Pre-Demo Sprint (Morning Session)

**Context:** Day of the 4:00–5:15 PM demo with Murtaza. Full sprint to close every remaining item from the April 2 meeting, fix bugs found in code review, and polish the UI.

---

#### Resourcing — Drag-to-Extend Allocation (Murtaza's Outstanding P0)

- **Built drag-to-extend** on allocation pills in `resourcing/page.tsx`
- A `┆` drag handle appears on the **right edge** of every pill on its last visible day
- `onMouseDown` → captures all day-column DOM rects → `mousemove` snaps `newEndDate` to nearest column → `mouseUp` fires `PATCH /resourcing/allocations/:id` with new `end_date`
- **Live preview tooltip** at top of screen: "↔ Dragging to Wed Apr 8 (+2d)"
- Pills in the extended range render as a **dashed preview** (lighter color, dashed border) while dragging
- `dragStateRef` used as a stable ref mirror so window event listeners don't go stale
- `project-service` **restarted** — all new routes now live
- All 6 services confirmed running on ports 3001–3006 ✅

---

#### Overview Dashboard — Chart Overhaul

**Problem:** Utilization view showed 30 tiny 5px daily bars in 3 colors — completely unreadable.

**What was built:**

- **Bar chart mode** — week-aggregated for Month/Utilization (5 wide bars per week), daily for This Week view. Interactive: hover highlights slot, bar brightens, tooltip appears.
- **Area chart mode** — smooth Catmull-Rom bezier curve with gradient fill. For Utilization: colored background bands (red zone >100%, amber zone 80–100%), 80% dashed threshold line, glowing dot markers per working day.
- **Chart type switcher** — icon buttons in toolbar (Bar / Area). Candle/sparkline removed as it wasn't needed.
- **Interactive tooltips on all chart modes** — frosted glass card (backdrop-blur 12px) shows: date header, Logged hours, Billable hours, Utilization %, mini progress bar. Tooltip auto-flips sides near right edge. Cursor becomes crosshair.
- **Billable hours per day** tracked separately — tooltip shows both logged and billable breakdown.
- Utilization view uses week-aggregated data (5 bars) for bar mode; daily data for area mode.

**Status dropdown fix:**
- Clicking a task status in Overview now shows a proper `<select>` dropdown — user picks any status directly. Replaced blind cycling with `changeStatus(task, status)`.

---

#### Reports — Bug Fixes

| Bug | Fix |
|---|---|
| "Last Week" preset `to` date same as `from` | Fixed: `to = addDays(subWeeks(startOfWeek(...),1), 6)` — now correctly Mon→Sun |
| Client filter always returned 0 results | Was comparing `r.client_id` (UUID) to client name string. Fixed to `r.client_name === trClient` |
| `addDays` not imported in reports | Added to date-fns import |

---

#### Projects Page — Row Alignment Overhaul

**Problem:** Progress `100%` bled visually into Timeline "6d overdue" — no column gap, no overflow protection.

**What changed:**
- **Dropped the ID column** — grid went from 9 columns → 8 columns
- **New grid:** `24px minmax(190px,1fr) 140px 140px 52px 160px 110px 120px` with `columnGap: 14px`
- **Progress cell** redesigned: hours left-aligned, `%` right-aligned, full-width bar underneath. No horizontal pressure on adjacent columns.
- `overflow: hidden` + `whiteSpace: nowrap` added to Progress, Timeline, and Status cells
- Row and section header padding tightened

---

#### Capacity — Leave Deduction (Murtaza's "governed by leaves" request)

**Backend** (`user-service/src/routes/users.ts`):
- `GET /users/holidays-range` now returns `userTimeOffHrs` — map of `userId → approved leave hours` in the date range
- Queries `time_entries` where `type = 'time_off'` and aggregates per user
- `netCapacity()` helper deducts both public holidays AND approved leave hours

**Frontend** (`reports/page.tsx`):
- `utilizationRows` reads `holidayRangeData?.userTimeOffHrs?.[u.id]` — was already wired, just needed backend data
- **Live demo data:** Alice −16h leave, Haseeb −8h, Aman −8h in April 2026
- Capacity column shows net capacity + `−Nd holiday` + `−Nh leave` tags per person

**Smoke test — all green:**
- `GET /api/v1/resourcing/projects` → 6 projects ✅
- `GET /api/v1/resourcing/team?weekStart=2026-04-06` → 10 members with allocations ✅
- `GET /api/v1/users/holidays-range?from=2026-04-01&to=2026-04-30` → 3 users with leave hours ✅
- `GET /api/v1/time/entries?from=2026-04-01&to=2026-04-30` → 48 entries ✅

---

#### Resourcing — Cell Hover Hint Fix

- `+` hint on empty cells was permanently invisible — CSS targeted `.cell-plus` but the element had no `className`
- Added `className="cell-plus"` — hover on any empty weekday cell now shows the prompt

---

#### Sidebar — Upgrades (Observed in Code Review)

- Migrated to Tailwind + `cn()` utility — consistent with design system
- Mobile hamburger + overlay + slide-in drawer added
- Theme toggle (sun/moon) for dark/light mode
- Notification bell with live unread count badge
- `Avatar` component in user footer with `LogOut` icon
- Active nav item has `border-l-2 border-accent` left-border indicator
- Timer widget embedded above user footer (not floating)

---

## ✅ All April 2 Meeting Items — CLOSED

| Murtaza's Request | Done |
|---|---|
| Resourcing click-cell popup | ✅ Apr 2 |
| Resourcing save bug | ✅ Apr 2 |
| Resourcing drag-to-extend across days | ✅ Apr 6 |
| Capacity = working days × 8h | ✅ Apr 2 |
| Capacity minus public holidays | ✅ Apr 2 |
| Capacity minus approved leave | ✅ Apr 6 |
| Compliance label clarity | ✅ Apr 2 |
| Utilization filter by department | ✅ Apr 2 |
| PDF / Excel / CSV export | ✅ Apr 2 |

---

*Last updated: April 6, 2026*
*Built by: Haseeb Tariq — AI Developer, Digital Nexa*
*Supabase project ref: see .env.local*
