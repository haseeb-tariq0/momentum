# Software Requirements Document
## Forecast — Internal Project Tracker for Digital Nexa
**Client:** Murtaza Talib — Head of Client Services, Digital Nexa
**Prepared by:** Haseeb Tariq — AI Developer
**Meeting Date:** March 2026
**Document Version:** 1.0

---

## 1. Project Overview

Digital Nexa currently uses Forecast.app as their internal project management and timesheet tool. The goal is to build a custom internal version that solves the specific pain points of Forecast while tailoring the system exactly to Digital Nexa's workflows. The new system must handle 63 team members across 10 departments working on 190+ active projects.

---

## 2. User Roles & Permissions

### 2.1 Seat Types
There are two seat types reflecting the original Forecast pricing model:
- **Core Seats** — 21 seats. Full access users including managers and department leads.
- **Collaborator Seats** — 42 seats. Regular team members who primarily log time and work on assigned tasks.

### 2.2 Permission Profiles
Three permission profiles must be defined:

| Profile | Who | What They Can Do |
|---|---|---|
| **Super Admin** | Murtaza + 1 other | Everything — create users, clients, projects, tasks, view all reports, manage all settings |
| **Admin / Manager** | Department leads | Create projects, clients, tasks, assign people, view reports — cannot create users |
| **Collaborator** | All other team members | View assigned projects, create tasks within assigned projects, log timesheets only |

### 2.3 Key Permission Rules (from meeting)
- **Only Super Admins can create new users.** This is critical — Murtaza specifically said unrestricted user creation will break the system.
- **Collaborators CAN create tasks** within projects they are assigned to. This was explicitly requested to reduce admin workload — otherwise every task would need to be created by the admin.
- **Collaborators CANNOT** create clients, projects, or phases.
- **Account Managers / Admins** can create projects and clients but cannot create users.
- Permissions should be configurable per profile so Murtaza can give or take access at any time.

---

## 3. People & Team Management

### 3.1 Team Members
- Total team: **63 members** (42 collaborators + 21 core)
- Each user must have: Name, Email, Department, Job Title, Seat Type, Permission Profile, Holiday Calendar, Capacity (default 40h/week)
- Users can be **deactivated** (not deleted) when they leave

### 3.2 Departments
10 departments must exist in the system:
- Client Service, Design, Web, SEO, Performance, Arabic Copy, English Copy, Production, Inbound, Operations

### 3.3 Holiday Calendars
- Each user must be linked to a **country-specific holiday calendar** (e.g. UAE, Pakistan, India)
- When a user's calendar has a holiday, that day should automatically be blocked/greyed out in their timesheet and resourcing view
- Example from meeting: Haseeb's calendar was incorrectly set to UAE instead of Pakistan — Pakistan holidays (Eid 19–20 March) were not showing

### 3.4 User Profile Fields Required
- Name, Email, Job Title
- Department assignment
- Seat Type (Core / Collaborator)
- Permission Profile (Super Admin / Admin / Collaborator)
- Holiday Calendar (country-based)
- Weekly capacity hours (default 40h)

---

## 4. Project Management

### 4.1 Project Access — Default Open Policy
**Critical requirement from Murtaza:** Every team member should have default access to all projects. The reason is that restricting project access creates blockers — people can't log timesheets or assign tasks if they're not added to a project. Admin overhead becomes too high with 190 projects.

- All users can see all projects by default
- A user's **timesheet only shows tasks they are personally assigned to** — this keeps timesheets clean without restricting project visibility

### 4.2 Project Status
Only 3 statuses needed (Murtaza said Opportunity and Planning are not used):
- **Running** — default when created
- **Halted** — client has gone quiet temporarily
- **Done** — project completed

### 4.3 Project Fields Required
- Project name, description
- Auto-generated project ID
- Client (linked to client record)
- Start date, end date
- Status (Running / Halted / Done)
- Project color
- Label (e.g. SEO, Performance, Design)
- Budget type (see section 6)
- Rate card assignment

### 4.4 Project Labels
- Labels like "SEO", "Performance", "Design" can be created with a name and color
- Labels are used to filter projects on the dashboard and in reports
- Nice to have: show how many projects and tasks use each label

---

## 5. Task Management

### 5.1 The Core Problem — No Task Duplication
**This is the biggest pain point Murtaza raised.** In the current Forecast system, every time someone books time on a task, or assigns someone to a task across multiple days, a new duplicate task is created. This resulted in 64,609 tasks in their system.

**The requirement:** One task is one task. Multiple people can be assigned to the same task. Multiple days of hours can be logged against the same task. No duplicates.

### 5.2 How Tasks Should Work
- One task can have **multiple assignees**
- Each assignee logs their own individual hours separately
- Total task hours = sum of all assignees' logged hours
- Example: Task T1 has 3 people — P1 logs 2h, P2 logs 2h, P3 logs 2h → Total = 6h logged against T1

### 5.3 Task Fields
- Title
- Phase (must belong to a phase)
- Assigned to (one or more people)
- Estimated hours
- Start date, due date
- Billable / Non-billable toggle
- Status (To Do / In Progress / Done)

### 5.4 Resourcing — Pick Existing Tasks
When allocating someone from the Resourcing section, you should be able to **pick an existing task** from a project's phases — not create a new one. This directly solves the duplication problem.

---

## 6. Financial Tracking & Rate Cards

### 6.1 Rate Cards
- Rate cards define hourly rates per job title / role
- Support currencies: AED, USD, GBP
- Multiple rate cards can exist (e.g. different rates for different client tiers)
- Rate cards are assigned to projects, not users

### 6.2 Budget Types per Project
Four budget types must be supported:
- **Fixed Price** — e.g. AED 50,000 total
- **Time & Materials** — calculated from actual hours × rate
- **Retainer** — monthly/weekly/daily with defined hours or value
- **Fixed Hours** — e.g. AMC contracts with 10 hours/month

### 6.3 Budget Tracking
- Each project profile must show: Estimated hours vs Actual hours vs Remaining
- Cost tracking: Rate card × hours logged = cost consumed from budget
- Example from meeting: Project estimated at 67 hours had actually used 280 hours — this overrun must be visible
- Budget consumption shown as a percentage (e.g. 80%, 90%, 100%)

### 6.4 Budget Alert Notifications
When a project's consumed budget reaches certain thresholds, the assigned account manager must be notified:
- Alert at **80%** consumed
- Alert at **90%** consumed
- Alert at **100%** consumed (budget exceeded)

---

## 7. Timesheets

### 7.1 Core Timesheet Behaviour
- Timesheet shows Mon–Sun by default
- Only tasks **assigned to the logged-in user** appear automatically — no manual searching
- Users can log time against: assigned project tasks, internal time categories, time off categories

### 7.2 Time Entry Flexibility
**Murtaza specifically requested this:** The system should NOT block users from logging time even if:
- A project has expired or is marked Done
- Hours logged exceed the task estimate
- The task is in a "done" state

Reason: People often log timesheets late. Strict blocking reduces compliance without adding value since Digital Nexa staff are not paid by timesheets.

### 7.3 Timesheet Locking
- Locking exists as a feature but Murtaza has chosen NOT to enforce it currently
- Reason: People don't fill timesheets regularly — locking them out makes it worse
- The option should exist in settings but be disabled by default

### 7.4 Timesheet Reminders
- Every Monday, send an automated reminder to any team member who has **missing time registrations** from the previous week
- Send a project digest reminder to account managers

### 7.5 Internal Time Categories
- Predefined categories for non-billable internal time (e.g. Ramadan, internal meetings)
- Can be activated or deactivated by admin
- Phase 1: can be hardcoded; Phase 2: make them manageable through admin panel

### 7.6 Time Off Categories
- Predefined leave types: Sick Leave, Vacation, Unpaid Leave, In Lieu, Time Yet to Join
- Same as internal time — can be hardcoded in Phase 1

---

## 8. Utilization & Reporting

### 8.1 Two Utilization Targets
- **Resource Utilization** — always 100% (if your capacity is 40h, you should log 40h)
- **Billable Utilization** — target is adjustable, currently set at **80%** (meaning 80% of logged hours should be billable client work, 20% can be internal)
- The billable utilization target must be adjustable in workspace settings (80%, 85%, 90%)

### 8.2 Reports Required
- **Utilization Report** — who is logging what percentage of billable vs internal hours
- **P&L / Budget Report** — revenue vs cost per project
- **Compliance Report** — who submitted timesheets on time each week
- **Project Progress** — task completion rates per project

---

## 9. Workspace Settings

The following settings must be configurable by Super Admin:

| Setting | Description | Default |
|---|---|---|
| Default working hours | Hours per day | 8 |
| Weekend inclusion | Can time be logged on weekends | Yes |
| Billable utilization target | Target % of billable hours | 80% |
| Allow time on expired projects | Log time even if project is past end date | On |
| Allow time exceeding task estimate | Log more hours than estimated | On |
| Timesheet locking | Auto-lock timesheets after X days | Off |
| Timesheet reminder day | Day to send weekly reminder | Monday |

---

## 10. Clients

- Clients need: Name, Logo, Country, Address
- No invoicing or billing needed — finance uses QuickBooks separately
- Keep clients simple — just a name and basic profile for linking to projects

---

## 11. Integrations

### Phase 1 (Core — must have)
- None required for Phase 1 beyond the system itself

### Phase 2 (Important)
- **Slack** — real-time notifications when project changes happen, budget alerts pushed to a Slack channel
- **HubSpot** — link client projects to HubSpot deals

### Phase 3 (Future)
- **Google Drive** — sync files uploaded to a project with the corresponding folder in Google Drive. Goal is one place to upload, visible everywhere
- **QuickBooks** — not needed, finance team handles this separately

---

## 12. Implementation Phasing

### Phase 1 — Core (Current)
- User roles and permissions
- Team and department management
- Project and task management (no duplication)
- Timesheet logging and tracking
- Basic budget tracking
- Basic reports (Utilization, Compliance, P&L)
- Holiday calendars
- Import all 63 users and 190 projects

### Phase 2 — Enhanced
- Budget alert email notifications
- Weekly Monday timesheet reminder emails
- Configurable internal time and time off categories
- Slack integration
- Adjustable permission roles through UI

### Phase 3 — Integrations & AI
- Google Drive file sync
- HubSpot integration
- Natural language queries
- Budget forecasting and anomaly detection

---

## 13. What We Have Already Built vs What Is Remaining

### ✅ Built
- Full project/task/phase management
- Multi-assignee tasks (no duplication)
- Timesheet submission and locking flow
- Admin can edit any person's timesheet inline
- Budget tracking with threshold alerts (visual only, no email yet)
- P&L, Utilization, Compliance, Progress reports
- CSV exports
- Holiday calendar table (not yet linked to users)
- Internal time and time off categories
- Rate cards and budget types
- 3 permission roles (Super Admin, Admin, Collaborator)
- Collaborator task creation and self-assignment
- Department management

### 🔴 Still Remaining
- Default open project access for all users (currently requires manual membership)
- Account Manager role (the middle role between Admin and Collaborator)
- Import all 63 real team members
- Import all 190 real projects
- Holiday calendars linked to users (block days automatically)
- Budget alert emails (80%, 90%, 100%)
- Monday timesheet reminder emails
- Workspace settings page (utilisation target, weekend toggle, time entry flexibility settings)
- Project Time tab on project detail page (backend done, frontend tab pending)
- Resourcing — pick existing tasks rather than creating new allocations
- Project filter by label on projects list
- Slack integration (Phase 2)

---

*Document based on initial requirements meeting with Murtaza Talib, March 2026*
*Digital Nexa — Internal Tool Development*
