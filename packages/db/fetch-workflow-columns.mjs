// Fetches workflow_columns for every project and writes a consolidated map.
// Output: {<project_id>: {<column_id>: <category>}}
// Categories are: TODO, INPROGRESS, DONE
import fs from 'fs/promises'
import path from 'path'

const API_KEY = 'eb40eae0-3b95-44de-9ce9-9ac2403b1536'
const OUT = 'D:/forecast/scripts/forecast-audit-out/raw/workflow_columns_by_project.json'

async function ff(url) {
  const r = await fetch(url, { headers: { 'X-FORECAST-API-KEY': API_KEY, Accept: 'application/json' } })
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.json()
}

// Concurrency-limited runner
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

;(async () => {
  console.log('Loading projects...')
  const projects = await ff('https://api.forecast.it/api/v1/projects')
  console.log(`${projects.length} total projects`)

  const result = {}
  let done = 0
  let failed = 0

  await mapLimit(projects, 8, async (p) => {
    try {
      const wfcs = await ff(`https://api.forecast.it/api/v1/projects/${p.id}/workflow_columns`)
      const byId = {}
      for (const c of wfcs) byId[c.id] = c.category
      result[p.id] = byId
    } catch (e) {
      failed++
      console.log(`  FAILED ${p.id} (${p.name}): ${e.message}`)
    }
    done++
    if (done % 100 === 0) console.log(`  ${done}/${projects.length}...`)
  })

  console.log(`\nDone. ${Object.keys(result).length} projects mapped, ${failed} failed.`)
  await fs.writeFile(OUT, JSON.stringify(result))
  console.log(`Wrote ${OUT}`)

  // Quick sanity check
  const catCounts = { TODO: 0, INPROGRESS: 0, DONE: 0, OTHER: 0 }
  for (const pid of Object.keys(result)) {
    for (const colId of Object.keys(result[pid])) {
      const c = result[pid][colId]
      if (catCounts[c] != null) catCounts[c]++
      else catCounts.OTHER++
    }
  }
  console.log('Workflow column categories across all projects:')
  console.log(catCounts)
})()
