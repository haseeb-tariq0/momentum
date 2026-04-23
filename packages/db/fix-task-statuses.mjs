// Fix all task statuses using the correct Forecast workflow_column → category mapping.
// Reads from on-disk snapshot; writes fix_task_statuses.sql with one UPDATE per task.
// Usage: node fix-task-statuses.mjs [--apply]
// Without --apply it just writes the SQL file.

import fs from 'fs/promises'

const TASKS_FILE = 'D:/forecast/scripts/forecast-audit-out/raw/tasks_by_project.json'
const WFC_FILE   = 'D:/forecast/scripts/forecast-audit-out/raw/workflow_columns_by_project.json'
const OUT_SQL    = 'D:/forecast/packages/db/fix_task_statuses.sql'

function correctStatus(task, wfcMap) {
  const cat = wfcMap[task.workflow_column]
  if (cat === 'DONE')       return 'done'
  if (cat === 'INPROGRESS') return 'in_progress'
  return 'todo'   // TODO, unknown, or no workflow_column
}

;(async () => {
  const tasksByProject = JSON.parse(await fs.readFile(TASKS_FILE, 'utf8'))
  const wfcByProject   = JSON.parse(await fs.readFile(WFC_FILE, 'utf8'))

  let total = 0
  const byStatus = { done: 0, in_progress: 0, todo: 0 }
  const byProject = {}

  const updates = []  // {forecast_id, status}

  for (const projectId of Object.keys(tasksByProject)) {
    const wfc = wfcByProject[projectId]
    if (!wfc) {
      // No workflow columns for this project — leave tasks alone (rare edge case)
      continue
    }
    for (const t of tasksByProject[projectId] || []) {
      total++
      const st = correctStatus(t, wfc)
      byStatus[st]++
      byProject[projectId] = (byProject[projectId] || 0) + 1
      updates.push({ fid: t.id, status: st })
    }
  }

  console.log(`Computed correct status for ${total} tasks`)
  console.log('  done        :', byStatus.done)
  console.log('  in_progress :', byStatus.in_progress)
  console.log('  todo        :', byStatus.todo)
  console.log(`Writing SQL to ${OUT_SQL}...`)

  // Build a single big statement per status bucket using UNNEST
  // — this is way faster than 53k individual UPDATEs.
  const byBucket = { done: [], in_progress: [], todo: [] }
  for (const u of updates) byBucket[u.status].push(u.fid)

  const parts = []
  parts.push('-- Auto-generated: fixes task.status for every imported task.')
  parts.push('-- Uses real Forecast workflow_column category mapping.')
  parts.push('-- Run via supabase SQL or `psql -f fix_task_statuses.sql`.')
  parts.push('BEGIN;')
  for (const st of ['done', 'in_progress', 'todo']) {
    const ids = byBucket[st]
    if (!ids.length) continue
    // Chunk to keep each UPDATE < 2MB
    const CHUNK = 5000
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      parts.push(
        `UPDATE tasks SET status = '${st}', updated_at = NOW() ` +
        `WHERE forecast_id = ANY(ARRAY[${slice.join(',')}]::bigint[]) ` +
        `AND status IS DISTINCT FROM '${st}';`
      )
    }
  }
  parts.push('COMMIT;')

  await fs.writeFile(OUT_SQL, parts.join('\n'))
  console.log(`Wrote SQL (${parts.length - 2} UPDATE statements).`)
})()
