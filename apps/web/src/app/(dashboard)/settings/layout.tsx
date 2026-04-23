'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, Lock, Plug } from 'lucide-react'
import { cn } from '@/lib/cn'

// Settings sections — extend this list when new settings pages are added.
// Icon shown in the sidebar, label is human-readable, hint describes scope.
const SECTIONS = [
  { href: '/settings/profile',      label: 'Profile',      Icon: User, hint: 'Your name, title, and identity' },
  { href: '/settings/password',     label: 'Password',     Icon: Lock, hint: 'Security — change your password' },
  { href: '/settings/integrations', label: 'Integrations', Icon: Plug, hint: 'Connected apps (Slack, etc.)' },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="px-7 py-6 max-w-[1100px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary">Settings</h1>
        <p className="text-sm text-muted">Manage your account and connected services.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        {/* Sidebar */}
        <aside className="md:sticky md:top-6 md:self-start">
          <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {SECTIONS.map(s => {
              const active = pathname === s.href || pathname.startsWith(s.href + '/')
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  className={cn(
                    'group inline-flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap',
                    active
                      ? 'bg-accent-dim text-accent font-semibold'
                      : 'text-secondary hover:text-primary hover:bg-surface-hover',
                  )}
                >
                  <s.Icon size={15} className={active ? 'text-accent' : 'text-muted group-hover:text-secondary'} />
                  <span>{s.label}</span>
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="min-w-0">
          {children}
        </div>
      </div>
    </div>
  )
}
