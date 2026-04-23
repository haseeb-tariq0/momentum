import { prisma } from './index'
import bcrypt from 'bcryptjs'

async function seed() {
  console.log('🌱 Seeding database...')

  // Clean up
  await prisma.timeEntry.deleteMany()
  await prisma.projectMember.deleteMany()
  await prisma.task.deleteMany()
  await prisma.milestone.deleteMany()
  await prisma.project.deleteMany()
  await prisma.user.deleteMany()
  await prisma.workspace.deleteMany()

  // Workspace
  const workspace = await prisma.workspace.create({
    data: { name: 'Acme Corp', plan: 'pro' },
  })

  // Users
  const hash = await bcrypt.hash('password123', 12)

  const admin = await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      email: 'admin@acme.com',
      passwordHash: hash,
      name: 'Alice Admin',
      role: 'admin',
      capacityHrs: 40,
    },
  })

  const manager = await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      email: 'manager@acme.com',
      passwordHash: hash,
      name: 'Bob Manager',
      role: 'manager',
      capacityHrs: 40,
    },
  })

  const member = await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      email: 'member@acme.com',
      passwordHash: hash,
      name: 'Carol Member',
      role: 'member',
      capacityHrs: 32,
    },
  })

  // Project
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: 'Website Redesign',
      description: 'Full redesign of the company website',
      budgetHrs: 200,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-06-30'),
      status: 'active',
    },
  })

  // Members
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: manager.id, role: 'lead', allocHrsPerWk: 20 },
      { projectId: project.id, userId: member.id, role: 'contributor', allocHrsPerWk: 16 },
    ],
  })

  // Tasks
  const task1 = await prisma.task.create({
    data: {
      projectId: project.id,
      assigneeId: member.id,
      title: 'Design homepage mockups',
      estimatedHrs: 20,
      status: 'in_progress',
      priority: 'high',
    },
  })

  await prisma.task.create({
    data: {
      projectId: project.id,
      assigneeId: manager.id,
      title: 'Write technical spec',
      estimatedHrs: 8,
      status: 'done',
      priority: 'medium',
    },
  })

  // Time entries
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  await prisma.timeEntry.create({
    data: {
      userId: member.id,
      taskId: task1.id,
      date: today,
      hours: 4,
      note: 'Completed hero section',
    },
  })

  // Milestone
  await prisma.milestone.create({
    data: {
      projectId: project.id,
      name: 'Design approval',
      dueDate: new Date('2024-02-28'),
      status: 'upcoming',
    },
  })

  console.log('✅ Seed complete')
  console.log(`   Workspace: ${workspace.id}`)
  console.log(`   Admin:   admin@acme.com / password123`)
  console.log(`   Manager: manager@acme.com / password123`)
  console.log(`   Member:  member@acme.com / password123`)
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
