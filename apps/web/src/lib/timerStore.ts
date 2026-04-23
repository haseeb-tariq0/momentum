import { create } from 'zustand'

interface TimerState {
  running:    boolean
  startedAt:  number | null   // epoch ms when timer last started
  elapsed:    number           // accumulated seconds (before most recent start)
  taskId:     string | null
  taskTitle:  string | null
  projectName:string | null

  start:  (task?: { id: string; title: string; projectName: string }) => void
  stop:   () => void
  reset:  () => void
  setTask:(task: { id: string; title: string; projectName: string }) => void
  totalSeconds: () => number
}

// Persist timer state across page navigations in localStorage
const storage = typeof window !== 'undefined' ? localStorage : null
const KEY = 'forecast_timer'

function loadPersistedState(): Partial<TimerState> {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch { return {} }
}

function saveState(state: Partial<TimerState>) {
  try {
    storage?.setItem(KEY, JSON.stringify({
      running:    state.running,
      startedAt:  state.startedAt,
      elapsed:    state.elapsed,
      taskId:     state.taskId,
      taskTitle:  state.taskTitle,
      projectName:state.projectName,
    }))
  } catch {}
}

const persisted = loadPersistedState()

export const useTimerStore = create<TimerState>((set, get) => ({
  running:     persisted.running     ?? false,
  startedAt:   persisted.startedAt   ?? null,
  elapsed:     persisted.elapsed     ?? 0,
  taskId:      persisted.taskId      ?? null,
  taskTitle:   persisted.taskTitle   ?? null,
  projectName: persisted.projectName ?? null,

  start(task) {
    const next: Partial<TimerState> = {
      running:    true,
      startedAt:  Date.now(),
      ...(task ? { taskId: task.id, taskTitle: task.title, projectName: task.projectName } : {}),
    }
    set(next)
    saveState({ ...get(), ...next })
  },

  stop() {
    const { startedAt, elapsed } = get()
    const extra = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
    const next = { running: false, startedAt: null, elapsed: elapsed + extra }
    set(next)
    saveState({ ...get(), ...next })
  },

  reset() {
    const next = { running: false, startedAt: null, elapsed: 0, taskId: null, taskTitle: null, projectName: null }
    set(next)
    saveState(next)
  },

  setTask(task) {
    const next = { taskId: task.id, taskTitle: task.title, projectName: task.projectName }
    set(next)
    saveState({ ...get(), ...next })
  },

  totalSeconds() {
    const { running, startedAt, elapsed } = get()
    if (running && startedAt) return elapsed + Math.floor((Date.now() - startedAt) / 1000)
    return elapsed
  },
}))

export function formatElapsed(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}
