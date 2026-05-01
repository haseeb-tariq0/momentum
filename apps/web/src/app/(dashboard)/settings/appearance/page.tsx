'use client'
import { useTheme } from '@/lib/theme'
import { Card } from '@/components/ui'
import { Sun, Moon, Check } from 'lucide-react'
import { cn } from '@/lib/cn'

// Appearance settings — surfaces the theme toggle that used to live in the
// sidebar header. Picker style (vs. a tiny single switch) makes the choice
// feel deliberate and gives room to add density / motion preferences later
// without re-laying-out the page.
type ThemeOption = {
  id: 'light' | 'dark'
  label: string
  hint: string
  Icon: typeof Sun
}

const OPTIONS: ThemeOption[] = [
  { id: 'light', label: 'Light', hint: 'Bright, high-contrast surfaces',  Icon: Sun  },
  { id: 'dark',  label: 'Dark',  hint: 'Easier on the eyes after hours',  Icon: Moon },
]

export default function AppearanceSettingsPage() {
  const { theme, toggle } = useTheme()

  // `toggle` flips between dark/light. We only call it when the clicked
  // option is *different* from the current theme so re-clicking the active
  // card is a no-op (rather than flipping the user away from their choice).
  function selectTheme(next: 'light' | 'dark') {
    if (theme !== next) toggle()
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden p-0">
        <div className="px-6 py-4 border-b border-line-subtle">
          <div className="text-sm font-semibold text-primary">Theme</div>
          <div className="text-xs text-muted mt-0.5">
            Choose how Momentum looks. Switches instantly — saved to this browser.
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
            {OPTIONS.map(opt => {
              const active = theme === opt.id
              const isLight = opt.id === 'light'
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => selectTheme(opt.id)}
                  aria-pressed={active}
                  className={cn(
                    'group relative flex flex-col items-stretch gap-3 p-3 rounded-lg border-2 cursor-pointer text-left transition-all',
                    active
                      ? 'border-accent bg-accent-dim/30'
                      : 'border-line-subtle hover:border-line-muted bg-surface-overlay',
                  )}
                >
                  {/* Faux UI preview swatch — gives the user a sense of what
                      the theme looks like without making them flip it just
                      to peek. Hardcoded greys so the swatch doesn't change
                      based on the *current* theme. */}
                  <div
                    className={cn(
                      'h-24 rounded-md border overflow-hidden flex flex-col',
                      isLight
                        ? 'bg-white border-zinc-200'
                        : 'bg-zinc-900 border-zinc-700',
                    )}
                    aria-hidden
                  >
                    <div className={cn('h-2 w-full', isLight ? 'bg-zinc-100' : 'bg-zinc-800')} />
                    <div className="flex-1 flex p-2 gap-2">
                      <div className={cn('w-8 rounded', isLight ? 'bg-zinc-100' : 'bg-zinc-800')} />
                      <div className="flex-1 flex flex-col gap-1.5">
                        <div className={cn('h-2 w-3/4 rounded', isLight ? 'bg-zinc-200' : 'bg-zinc-700')} />
                        <div className={cn('h-2 w-1/2 rounded', isLight ? 'bg-zinc-200' : 'bg-zinc-700')} />
                        <div className="mt-auto flex gap-1.5">
                          <div className="h-3 w-6 rounded bg-violet-500" />
                          <div className={cn('h-3 flex-1 rounded', isLight ? 'bg-zinc-100' : 'bg-zinc-800')} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
                        <opt.Icon size={14} className={active ? 'text-accent' : 'text-muted'} />
                        {opt.label}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 truncate">{opt.hint}</div>
                    </div>
                    <span
                      className={cn(
                        'inline-flex items-center justify-center w-5 h-5 rounded-full border-2 flex-shrink-0 transition-colors',
                        active
                          ? 'bg-accent border-accent text-white'
                          : 'bg-surface-raised border-line-muted text-transparent',
                      )}
                      aria-hidden
                    >
                      <Check size={11} />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <p className="text-[11px] text-muted mt-4">
            Your choice is stored locally in this browser. Sign in on another device and pick again there.
          </p>
        </div>
      </Card>
    </div>
  )
}
