import { Pool } from 'pg'

let pool: Pool | null = null

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.TIMESCALE_URL || process.env.DATABASE_URL })
  }
  return pool
}

interface TimeEntry {
  userId:    string
  taskId:    string
  projectId: string
  date:      string
  hours:     number
}

export async function syncToTimescale(entry: TimeEntry) {
  const client = await getPool().connect()
  try {
    await client.query(`
      INSERT INTO time_entries_ts (user_id, task_id, project_id, date, hours, synced_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id, task_id, date)
      DO UPDATE SET hours = EXCLUDED.hours, synced_at = NOW()
    `, [entry.userId, entry.taskId, entry.projectId, entry.date, entry.hours])
  } finally {
    client.release()
  }
}
