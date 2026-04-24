'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/lib/store'
import { usersApi } from '@/lib/queries'
import Sidebar from '@/components/layout/Sidebar'
import GlobalSearch from '@/components/GlobalSearch'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Toaster } from '@/components/Toast'

export const dynamic = 'force-dynamic'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, hydrated, hydrate, setAuth } = useAuthStore()
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => { hydrate() }, [])

  useEffect(() => {
    if (!hydrated) return
    if (typeof window === 'undefined') return
    const t = localStorage.getItem('access_token')
    if (!t) { router.replace('/login'); return }
    if (!user && t) {
      usersApi.me().then((res: any) => {
        const u = res.data
        setAuth({
          id:                u.id,
          email:             u.email,
          name:              u.name,
          jobTitle:          u.job_title,
          avatarUrl:         u.avatar_url,
          seatType:          u.seat_type,
          permissionProfile: u.permission_profile,
          capacityHrs:       Number(u.capacity_hrs),
          workspaceId:       u.workspace_id,
          workspaceName:     u.workspaces?.name ?? 'Digital Nexa',
          departmentId:      u.department_id,
          departmentName:    u.departments?.name,
        }, t)
      }).catch(() => router.replace('/login'))
    }
  }, [hydrated])

  // Cmd+K / Ctrl+K to open global search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(s => !s)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const closeSearch = useCallback(() => setSearchOpen(false), [])

  if (!hydrated) return null

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar onSearchClick={() => setSearchOpen(true)} />
      <main className="flex-1 overflow-y-auto overflow-x-hidden h-screen bg-surface-base lg:pl-0 pl-0 pt-12 lg:pt-0">
        {/* key=pathname forces remount per route change so the fade animation
            fires. Uses animate-fade-in (150ms) from tailwind.config.js. */}
        <div key={pathname} className="animate-fade-in">
          {children}
        </div>
      </main>
      <GlobalSearch open={searchOpen} onClose={closeSearch} />
      <ConfirmDialog />
      <Toaster />
    </div>
  )
}
