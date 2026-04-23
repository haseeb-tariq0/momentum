import { prisma } from '@forecast/db'
import { publish } from '@forecast/events'

export async function checkBudgetAlert(projectId: string, workspaceId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { budgetHrs: true },
  })

  if (!project?.budgetHrs) return

  const logged = await prisma.timeEntry.aggregate({
    where: { task: { projectId } },
    _sum:  { hours: true },
  })

  const totalLogged = Number(logged._sum.hours || 0)
  const budget      = Number(project.budgetHrs)
  const pct         = (totalLogged / budget) * 100

  if (pct >= 80) {
    await publish('PROJECT_BUDGET_80PCT', { projectId, workspaceId, pct: Math.round(pct) })
  }
}
