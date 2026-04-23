// Quick audit: compare our heuristic vs real workflow_column status across N projects
const API_KEY = 'eb40eae0-3b95-44de-9ce9-9ac2403b1536'

async function ff(url) {
  const r = await fetch(url, { headers: { 'X-FORECAST-API-KEY': API_KEY, Accept: 'application/json' } })
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.json()
}

function heuristic(t) {
  if (t.approved === true && (t.remaining === 0 || t.remaining == null)) return 'done'
  if (t.remaining != null && t.estimate != null && t.remaining < t.estimate) return 'in_progress'
  return 'todo'
}

const args = process.argv.slice(2)
const sampleN = Number(args[0] || 20)

;(async () => {
  // Get all running projects
  const projects = await ff('https://api.forecast.it/api/v1/projects')
  const running = projects.filter(p => p.stage === 'RUNNING').slice(0, sampleN)
  console.log(`Auditing ${running.length} running projects...`)

  const real = { done: 0, in_progress: 0, todo: 0 }
  const heur = { done: 0, in_progress: 0, todo: 0 }
  let projectsScanned = 0
  let mismatches = 0
  const disagreements = []

  for (const p of running) {
    try {
      const [wfcs, tasks] = await Promise.all([
        ff(`https://api.forecast.it/api/v1/projects/${p.id}/workflow_columns`),
        ff(`https://api.forecast.it/api/v3/projects/${p.id}/tasks`),
      ])
      const catById = {}
      for (const c of wfcs) catById[c.id] = c.category

      for (const t of tasks) {
        const cat = catById[t.workflow_column]
        const realStatus = cat === 'DONE' ? 'done' : cat === 'INPROGRESS' ? 'in_progress' : 'todo'
        const heurStatus = heuristic(t)
        real[realStatus]++
        heur[heurStatus]++
        if (realStatus !== heurStatus) {
          mismatches++
          if (disagreements.length < 10) {
            disagreements.push({
              project: p.name.slice(0, 40),
              task: t.title.slice(0, 40),
              real: realStatus,
              heur: heurStatus,
              approved: t.approved,
              remaining: t.remaining,
              estimate: t.estimate,
            })
          }
        }
      }
      projectsScanned++
    } catch (e) {
      console.log(`  skip ${p.id}: ${e.message}`)
    }
  }

  const total = real.done + real.in_progress + real.todo
  console.log(`\nScanned ${projectsScanned} projects, ${total} tasks`)
  console.log('REAL      :', real)
  console.log('HEURISTIC :', heur)
  console.log(`\nMISMATCHES: ${mismatches} / ${total} (${((mismatches/total)*100).toFixed(1)}%)`)
  console.log('\nSample disagreements:')
  for (const d of disagreements) console.log(JSON.stringify(d))
})()
