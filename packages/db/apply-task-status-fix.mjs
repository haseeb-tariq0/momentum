// Apply task status fixes directly via Supabase client
import fs from 'fs/promises'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const url = process.env.SUPABASE_URL || 'https://rqltujdrcnotbxlxberl.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) { console.error('SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1) }

const supabase = createClient(url, key, { auth: { persistSession: false } })

const TASKS_FILE = 'D:/forecast/scripts/forecast-audit-out/raw/tasks_by_project.json'
const WFC_FILE   = 'D:/forecast/scripts/forecast-audit-out/raw/workflow_columns_by_project.json'

function correctStatus(task, wfcMap) {
  const cat = wfcMap[task.workflow_column]
  if (cat === 'DONE')       return 'done'
  if (cat === 'INPROGRESS') return 'in_progress'
  return 'todo'
}

;(async () => {
  const tasksByProject = JSON.parse(await fs.readFile(TASKS_FILE, 'utf8'))
  const wfcByProject   = JSON.parse(await fs.readFile(WFC_FILE, 'utf8'))

  // Build {status: [forecast_id,...]}
  const bucket = { done: [], in_progress: [], todo: [] }
  for (const pid of Object.keys(tasksByProject)) {
    const wfc = wfcByProject[pid]
    if (!wfc) continue
    for (const t of tasksByProject[pid] || []) {
      const st = correctStatus(t, wfc)
      bucket[st].push(t.id)
    }
  }

  console.log('Tasks to update:')
  console.log('  done        :', bucket.done.length)
  console.log('  in_progress :', bucket.in_progress.length)
  console.log('  todo        :', bucket.todo.length)
  console.log()

  // Update in chunks. supabase .in() filter takes an array — but URL length
  // matters for PostgREST. Keep chunks at ~500 ids per call.
  const CHUNK = 500
  let updated = 0

  for (const status of ['done', 'in_progress', 'todo']) {
    const ids = bucket[status]
    console.log(`\nUpdating ${ids.length} tasks to status='${status}'...`)
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      const { error, count } = await supabase
        .from('tasks')
        .update({ status, updated_at: new Date().toISOString() }, { count: 'exact' })
        .in('forecast_id', slice)
        .neq('status', status)   // skip rows already correct
      if (error) {
        console.error(`  ERR at ${i}: ${error.message}`)
        break
      }
      updated += (count || 0)
      if ((i / CHUNK) % 10 === 0) console.log(`  ${i}/${ids.length}  total updated so far: ${updated}`)
    }
  }

  console.log(`\nDone. Rows updated: ${updated}`)
})()
