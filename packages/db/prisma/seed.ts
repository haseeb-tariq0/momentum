import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '../../.env.local') })

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ── Workspace ─────────────────────────────────────────────────────────────
  const workspace = await prisma.workspace.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Digital Nexa',
      plan: 'enterprise',
      billableUtilizationPct: 80,
      weekendsEnabled: true,
      defaultCurrency: 'AED',
    },
  })
  console.log('✅ Workspace:', workspace.name)

  // ── Holiday Calendars ──────────────────────────────────────────────────────
  const uaeCalendar = await prisma.holidayCalendar.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      workspaceId: workspace.id,
      name: 'UAE Holidays',
      country: 'UAE',
      isDefault: true,
    },
  })

  const pkCalendar = await prisma.holidayCalendar.upsert({
    where: { id: '00000000-0000-0000-0000-000000000011' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000011',
      workspaceId: workspace.id,
      name: 'Pakistan Calendar',
      country: 'Pakistan',
      isDefault: false,
    },
  })

  const inCalendar = await prisma.holidayCalendar.upsert({
    where: { id: '00000000-0000-0000-0000-000000000012' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000012',
      workspaceId: workspace.id,
      name: 'India Calendar',
      country: 'India',
      isDefault: false,
    },
  })
  console.log('✅ Holiday calendars seeded')

  // ── Internal Time Categories ───────────────────────────────────────────────
  const internalCats = ['Ramadan Hours', 'All-hands Meeting', 'Pitch Preparation', 'Training']
  for (const name of internalCats) {
    await prisma.internalTimeCategory.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name } },
      update: {},
      create: { workspaceId: workspace.id, name },
    })
  }

  // ── Time Off Categories ────────────────────────────────────────────────────
  const timeOffCats = ['Vacation', 'Sick Leave', 'Unpaid Leave', 'In-Lieu', 'Yet to Join']
  for (const name of timeOffCats) {
    await prisma.timeOffCategory.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name } },
      update: {},
      create: { workspaceId: workspace.id, name },
    })
  }
  console.log('✅ Time categories seeded')

  // ── Departments ────────────────────────────────────────────────────────────
  const deptData = [
    { id: '00000000-0000-0000-0000-000000000020', name: 'Client Service' },
    { id: '00000000-0000-0000-0000-000000000021', name: 'Web' },
    { id: '00000000-0000-0000-0000-000000000022', name: 'Design' },
    { id: '00000000-0000-0000-0000-000000000023', name: 'Performance' },
    { id: '00000000-0000-0000-0000-000000000024', name: 'SEO' },
    { id: '00000000-0000-0000-0000-000000000025', name: 'Inbound' },
    { id: '00000000-0000-0000-0000-000000000026', name: 'Production' },
    { id: '00000000-0000-0000-0000-000000000027', name: 'Arabic Copy' },
    { id: '00000000-0000-0000-0000-000000000028', name: 'English Copy' },
    { id: '00000000-0000-0000-0000-000000000029', name: 'Operations' },
  ]
  const depts: Record<string, string> = {}
  for (const d of deptData) {
    await prisma.department.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name: d.name } },
      update: {},
      create: { id: d.id, workspaceId: workspace.id, name: d.name },
    })
    depts[d.name] = d.id
  }
  console.log('✅ Departments seeded')

  // ── Rate Card ──────────────────────────────────────────────────────────────
  const rateCard = await prisma.rateCard.upsert({
    where: { id: '00000000-0000-0000-0000-000000000030' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000030',
      workspaceId: workspace.id,
      name: 'Standard AED 2024',
      currency: 'AED',
      isDefault: true,
      rates: {
        create: [
          { jobTitle: 'Account Manager',       hourlyRate: 215 },
          { jobTitle: 'Account Executive',      hourlyRate: 175 },
          { jobTitle: 'Frontend Developer',     hourlyRate: 226 },
          { jobTitle: 'AI Developer',           hourlyRate: 240 },
          { jobTitle: 'Graphic Designer',       hourlyRate: 181 },
          { jobTitle: 'Design Lead',            hourlyRate: 220 },
          { jobTitle: '3D Graphic Designer',    hourlyRate: 190 },
          { jobTitle: 'Motion Graphic Designer',hourlyRate: 185 },
          { jobTitle: 'SEO Specialist',         hourlyRate: 172 },
          { jobTitle: 'Performance Specialist', hourlyRate: 172 },
          { jobTitle: 'Content Creator',        hourlyRate: 167 },
          { jobTitle: 'Arabic Copywriter',      hourlyRate: 161 },
          { jobTitle: 'English Copywriter',     hourlyRate: 161 },
          { jobTitle: 'Videographer/Editor',    hourlyRate: 173 },
          { jobTitle: 'Data Analyst',           hourlyRate: 180 },
          { jobTitle: 'Operations Manager',     hourlyRate: 200 },
          { jobTitle: 'Head of Client Services',hourlyRate: 280 },
        ],
      },
    },
  })
  console.log('✅ Rate card seeded')

  // ── Project Labels ─────────────────────────────────────────────────────────
  const labelData = [
    { name: 'SEO',          color: '#0D9488' },
    { name: 'Performance',  color: '#7C3AED' },
    { name: 'Social Media', color: '#2563EB' },
    { name: 'Credits',      color: '#D97706' },
    { name: 'Design',       color: '#DB2777' },
    { name: 'Development',  color: '#0891B2' },
    { name: 'Content',      color: '#059669' },
    { name: 'AMC',          color: '#DC2626' },
  ]
  for (const l of labelData) {
    await prisma.projectLabel.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name: l.name } },
      update: {},
      create: { workspaceId: workspace.id, ...l },
    })
  }
  console.log('✅ Labels seeded')

  // ── Users ──────────────────────────────────────────────────────────────────
  const hash = await bcrypt.hash('password123', 10)

  const userData = [
    { id: '00000000-0000-0000-0000-000000000100', email: 'admin@digitalnexa.com',   name: 'Murtaza Talib',  jobTitle: 'Head of Client Services', seatType: 'core' as const,         permissionProfile: 'super_admin' as const, deptId: depts['Client Service'],  calId: uaeCalendar.id, cost: 280 },
    { id: '00000000-0000-0000-0000-000000000101', email: 'haseeb@digitalnexa.com',  name: 'Haseeb Tariq',   jobTitle: 'AI Developer',             seatType: 'core' as const,         permissionProfile: 'admin' as const,       deptId: depts['Web'],             calId: pkCalendar.id,  cost: 240 },
    { id: '00000000-0000-0000-0000-000000000102', email: 'manager@digitalnexa.com', name: 'Ahmed Moawad',   jobTitle: 'Account Manager',          seatType: 'core' as const,         permissionProfile: 'admin' as const,       deptId: depts['Client Service'],  calId: uaeCalendar.id, cost: 215 },
    { id: '00000000-0000-0000-0000-000000000103', email: 'alice@digitalnexa.com',   name: 'Alice Chen',     jobTitle: 'Frontend Developer',       seatType: 'core' as const,         permissionProfile: 'admin' as const,       deptId: depts['Web'],             calId: uaeCalendar.id, cost: 226 },
    { id: '00000000-0000-0000-0000-000000000104', email: 'bob@digitalnexa.com',     name: 'Bob Martinez',   jobTitle: 'Graphic Designer',         seatType: 'collaborator' as const, permissionProfile: 'collaborator' as const,deptId: depts['Design'],          calId: uaeCalendar.id, cost: 181 },
    { id: '00000000-0000-0000-0000-000000000105', email: 'carol@digitalnexa.com',   name: 'Carol Davis',    jobTitle: 'SEO Specialist',           seatType: 'collaborator' as const, permissionProfile: 'collaborator' as const,deptId: depts['SEO'],             calId: inCalendar.id,  cost: 172 },
    { id: '00000000-0000-0000-0000-000000000106', email: 'david@digitalnexa.com',   name: 'David Park',     jobTitle: 'Performance Specialist',   seatType: 'collaborator' as const, permissionProfile: 'collaborator' as const,deptId: depts['Performance'],     calId: uaeCalendar.id, cost: 172 },
    { id: '00000000-0000-0000-0000-000000000107', email: 'emma@digitalnexa.com',    name: 'Emma Wilson',    jobTitle: 'Content Creator',          seatType: 'collaborator' as const, permissionProfile: 'collaborator' as const,deptId: depts['English Copy'],    calId: uaeCalendar.id, cost: 167 },
  ]

  for (const u of userData) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        id: u.id,
        workspaceId: workspace.id,
        departmentId: u.deptId,
        holidayCalendarId: u.calId,
        email: u.email,
        passwordHash: hash,
        name: u.name,
        jobTitle: u.jobTitle,
        seatType: u.seatType,
        permissionProfile: u.permissionProfile,
        capacityHrs: 40,
        internalHourlyCost: u.cost,
        startDate: new Date('2023-06-01'),
      },
    })
  }
  console.log('✅ Users seeded')

  // ── Client ─────────────────────────────────────────────────────────────────
  const client = await prisma.client.upsert({
    where: { id: '00000000-0000-0000-0000-000000000200' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000200',
      workspaceId: workspace.id,
      name: 'Align Technology LLC',
      country: 'UAE',
    },
  })

  const nexa = await prisma.client.upsert({
    where: { id: '00000000-0000-0000-0000-000000000201' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000201',
      workspaceId: workspace.id,
      name: 'NEXA Internal',
      country: 'UAE',
    },
  })
  console.log('✅ Clients seeded')

  // ── Project 1 — exact match from live Forecast ─────────────────────────────
  const p1141 = await prisma.project.upsert({
    where: { id: '00000000-0000-0000-0000-000000000300' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000300',
      workspaceId: workspace.id,
      clientId: client.id,
      rateCardId: rateCard.id,
      name: 'Invisalign - Africa Credits 2026',
      status: 'running',
      color: '#0D9488',
      budgetType: 'fixed_price',
      budgetAmount: 45000,
      currency: 'AED',
      startDate: new Date('2025-03-01'),
      endDate: new Date('2026-03-31'),
    },
  })

  const phaseP1141 = await prisma.phase.upsert({
    where: { id: '00000000-0000-0000-0000-000000000400' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000400',
      projectId: p1141.id,
      name: 'Agency Wide Tasks',
      sortOrder: 0,
    },
  })

  const task1 = await prisma.task.upsert({
    where: { id: '00000000-0000-0000-0000-000000000500' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000500',
      phaseId: phaseP1141.id,
      title: 'Account Management',
      estimatedHrs: 20,
      status: 'in_progress',
      billable: true,
    },
  })

  // Assign both Haseeb and Ahmed to the same task — no duplication!
  await prisma.taskAssignee.upsert({
    where: { taskId_userId: { taskId: task1.id, userId: '00000000-0000-0000-0000-000000000101' } },
    update: {},
    create: { taskId: task1.id, userId: '00000000-0000-0000-0000-000000000101' },
  })
  await prisma.taskAssignee.upsert({
    where: { taskId_userId: { taskId: task1.id, userId: '00000000-0000-0000-0000-000000000102' } },
    update: {},
    create: { taskId: task1.id, userId: '00000000-0000-0000-0000-000000000102' },
  })

  // Individual time entries on the SAME task
  const today = new Date()
  today.setHours(0,0,0,0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  await prisma.timeEntry.upsert({
    where: { userId_taskId_date: { userId: '00000000-0000-0000-0000-000000000101', taskId: task1.id, date: today } },
    update: {},
    create: { userId: '00000000-0000-0000-0000-000000000101', taskId: task1.id, date: today, hours: 8, billable: true, type: 'project', note: 'Onboarding session' },
  })
  await prisma.timeEntry.upsert({
    where: { userId_taskId_date: { userId: '00000000-0000-0000-0000-000000000102', taskId: task1.id, date: yesterday } },
    update: {},
    create: { userId: '00000000-0000-0000-0000-000000000102', taskId: task1.id, date: yesterday, hours: 3, billable: true, type: 'project' },
  })

  // ── Project 2 — NEXA Internal ──────────────────────────────────────────────
  const p1279 = await prisma.project.upsert({
    where: { id: '00000000-0000-0000-0000-000000000301' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000301',
      workspaceId: workspace.id,
      clientId: nexa.id,
      name: 'NEXA - Internal Department Hours',
      status: 'running',
      color: '#7C3AED',
      budgetType: 'time_and_materials',
      currency: 'AED',
      startDate: new Date('2024-01-01'),
    },
  })

  const phaseInternal = await prisma.phase.upsert({
    where: { id: '00000000-0000-0000-0000-000000000401' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000401',
      projectId: p1279.id,
      name: 'Agency Wide Tasks',
      sortOrder: 0,
    },
  })

  const taskOnboarding = await prisma.task.upsert({
    where: { id: '00000000-0000-0000-0000-000000000501' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000501',
      phaseId: phaseInternal.id,
      title: 'Onboarding',
      estimatedHrs: 8,
      status: 'in_progress',
      billable: false,
    },
  })

  await prisma.taskAssignee.upsert({
    where: { taskId_userId: { taskId: taskOnboarding.id, userId: '00000000-0000-0000-0000-000000000101' } },
    update: {},
    create: { taskId: taskOnboarding.id, userId: '00000000-0000-0000-0000-000000000101' },
  })

  // ── Project 3 — Website Redesign ────────────────────────────────────────────
  const p1384 = await prisma.project.upsert({
    where: { id: '00000000-0000-0000-0000-000000000302' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000302',
      workspaceId: workspace.id,
      clientId: client.id,
      rateCardId: rateCard.id,
      name: 'Website Redesign 2026',
      status: 'running',
      color: '#2563EB',
      budgetType: 'fixed_price',
      budgetAmount: 25000,
      currency: 'AED',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-06-30'),
    },
  })

  const phaseDesign = await prisma.phase.upsert({
    where: { id: '00000000-0000-0000-0000-000000000402' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000402',
      projectId: p1384.id,
      name: 'Design Phase',
      sortOrder: 0,
    },
  })

  const phaseDev = await prisma.phase.upsert({
    where: { id: '00000000-0000-0000-0000-000000000403' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000403',
      projectId: p1384.id,
      name: 'Development Phase',
      sortOrder: 1,
    },
  })

  const taskDesignSystem = await prisma.task.upsert({
    where: { id: '00000000-0000-0000-0000-000000000502' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000502',
      phaseId: phaseDesign.id,
      title: 'Design System Audit',
      estimatedHrs: 12,
      status: 'done',
      billable: true,
    },
  })

  const taskFrontend = await prisma.task.upsert({
    where: { id: '00000000-0000-0000-0000-000000000503' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000503',
      phaseId: phaseDev.id,
      title: 'Responsive Navigation',
      estimatedHrs: 16,
      status: 'in_progress',
      billable: true,
    },
  })

  // Multiple people on same task — the FIX in action
  await prisma.taskAssignee.upsert({
    where: { taskId_userId: { taskId: taskFrontend.id, userId: '00000000-0000-0000-0000-000000000101' } },
    update: {},
    create: { taskId: taskFrontend.id, userId: '00000000-0000-0000-0000-000000000101' },
  })
  await prisma.taskAssignee.upsert({
    where: { taskId_userId: { taskId: taskFrontend.id, userId: '00000000-0000-0000-0000-000000000103' } },
    update: {},
    create: { taskId: taskFrontend.id, userId: '00000000-0000-0000-0000-000000000103' },
  })

  console.log('✅ Projects, phases, tasks, and time entries seeded')
  console.log('')
  console.log('🎉 Seed complete!')
  console.log('')
  console.log('Login credentials:')
  console.log('  admin@digitalnexa.com  / password123  (Super Admin)')
  console.log('  haseeb@digitalnexa.com / password123  (Admin)')
  console.log('  manager@digitalnexa.com/ password123  (Admin)')
  console.log('  alice@digitalnexa.com  / password123  (Admin)')
  console.log('  bob@digitalnexa.com    / password123  (Collaborator)')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
