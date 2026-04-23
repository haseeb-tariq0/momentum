'use client'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
  isDark: true,
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)

  // On mount, read from localStorage
  useEffect(() => {
    let preferred: Theme = 'dark'
    try {
      const stored = localStorage.getItem('forecast-theme')
      if (stored === 'dark' || stored === 'light') preferred = stored
    } catch { /* localStorage may throw in private mode */ }
    setTheme(preferred)
    document.documentElement.setAttribute('data-theme', preferred)
    setMounted(true)
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try { localStorage.setItem('forecast-theme', next) } catch { /* quota / private mode */ }
    document.documentElement.setAttribute('data-theme', next)
  }

  // Prevent flash of wrong theme
  if (!mounted) return null

  return (
    <ThemeContext.Provider value={{ theme, toggle, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
