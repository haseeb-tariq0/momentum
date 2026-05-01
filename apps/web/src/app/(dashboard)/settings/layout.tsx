'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, Lock, Plug, Palette, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui'

// Settings sections, grouped by concern so the rail reads as purposeful
// sections rather than a flat list. Extending this: add a new entry to an
// existing group or add a new group below.
type Section = { href: string; label: string; Icon: any; hint: string }
type Group   = { label: string | null; items: Section[] }

const GROUPS: Group[] = [
  {
    label: 'Account',
    items: [
      { href: '/settings/profile',      label: 'Profile',      Icon: User, hint: 'Name, title, identity' },
      { href: '/settings/password',     label: 'Password',     Icon: Lock, hint: 'Change your password' },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { href: '/settings/appearance',   label: 'Appearance',   Icon: Palette, hint: 'Theme and display' },
    ],
  },
  {
    label: 'Connected',
    items: [
      { href: '/settings/integrations', label: 'Integrations', Icon: Plug, hint: 'Slack, calendars, etc.' },
    ],
  },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // Active section for the rail + for the page-header subtitle.
  const flat = GROUPS.flatMap(g => g.items)
  const current = flat.find(s => pathname === s.href || pathname.startsWith(s.href + '/'))

  return (
    // Full-viewport shell — no centered max-width. The older 1100px cap left
    // huge dead space on wide monitors and made the page feel unfinished.
    // Content padding scales with breakpoint (px-6 mobile → px-10 desktop).
    <div className="px-6 lg:px-10 py-6 min-h-full">
      <PageHeader
        title="Settings"
        subtitle={current
          ? <span className="inline-flex items-center gap-1.5"><SettingsIcon size={12} className="text-muted" /> {current.hint}</span>
          : 'Manage your account and connected services.'
        }
      />

      {/* Responsive 2-pane shell. Rail is 240px on desktop; content takes
          the rest. On mobile, the rail becomes a horizontal scroll strip. */}
      <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-6 lg:gap-8">
        {/* Rail */}
        <aside className="md:sticky md:top-6 md:self-start">
          <nav className="flex md:flex-col gap-4 overflow-x-auto md:overflow-visible -mx-1 px-1">
            {GROUPS.map((g, gi) => (
              <div key={gi} className="md:w-full flex md:flex-col gap-1 flex-shrink-0">
                {g.label && (
                  <div className="hidden md:block text-[10px] font-bold uppercase tracking-[0.08em] text-muted px-3 mb-1">
                    {g.label}
                  </div>
                )}
                {g.items.map(s => {
                  const active = pathname === s.href || pathname.startsWith(s.href + '/')
                  return (
                    <Link
                      key={s.href}
                      href={s.href}
                      className={cn(
                        'relative group inline-flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all duration-150 whitespace-nowrap',
                        active
                          ? 'bg-accent-dim text-accent font-semibold'
                          : 'text-secondary hover:text-primary hover:bg-surface-hover',
                      )}
                    >
                      {/* Left-edge accent bar, matching main sidebar. Hidden on
                          mobile where the rail is a horizontal strip. */}
                      {active && (
                        <span
                          aria-hidden
                          className="hidden md:block absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-accent"
                        />
                      )}
                      <s.Icon size={15} className={active ? 'text-accent' : 'text-muted group-hover:text-secondary'} />
                      <span>{s.label}</span>
                    </Link>
                  )
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* Content — min-w-0 lets children truncate without overflowing.
            Inner content caps at 4xl (56rem ≈ 896px) so form rows don't
            stretch into uncomfortable line lengths on ultrawide monitors.
            The shell itself stays full width; only the inner readable
            content is bounded. */}
        <div className="min-w-0">
          <div className="w-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
