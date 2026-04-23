'use client'

interface EmptyStateProps {
  type: 'projects' | 'timesheets' | 'team' | 'reports' | 'notifications' | 'tasks'
  onAction?: () => void
}

const CONFIGS = {
  projects: {
    icon: (
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3"/>
        <rect x="18" y="22" width="28" height="20" rx="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M23 22V18a2 2 0 012-2h14a2 2 0 012 2v4" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M23 32h18M23 37h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="46" cy="44" r="8" fill="var(--accent)" fillOpacity="0.15" stroke="var(--accent)" strokeWidth="1.5"/>
        <path d="M43 44h6M46 41v6" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'No projects yet',
    body: 'Create your first project to start tracking budgets, tasks, and team progress.',
    action: 'Create your first project',
    color: 'var(--accent)',
  },
  timesheets: {
    icon: (
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3"/>
        <circle cx="32" cy="32" r="16" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M32 20v12l8 5" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M14 32h4M46 32h4M32 14v4M32 46v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
      </svg>
    ),
    title: 'No hours logged this week',
    body: 'Click any cell in the grid to log your hours. Your time entries will appear here.',
    action: 'Log time now',
    color: 'var(--amber)',
  },
  team: {
    icon: (
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3"/>
        <circle cx="32" cy="24" r="8" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M16 48c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="46" cy="44" r="8" fill="var(--violet)" fillOpacity="0.15" stroke="var(--violet)" strokeWidth="1.5"/>
        <path d="M43 44h6M46 41v6" stroke="var(--violet)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'No team members yet',
    body: 'Invite your team to start tracking project assignments and team utilization.',
    action: 'Invite your first member',
    color: 'var(--violet)',
  },
  reports: {
    icon: (
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3"/>
        <rect x="16" y="16" width="32" height="32" rx="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M22 38l6-8 6 4 8-10" stroke="var(--sky)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M22 44h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
        <circle cx="46" cy="44" r="8" fill="var(--sky)" fillOpacity="0.15" stroke="var(--sky)" strokeWidth="1.5"/>
        <path d="M43 44h6M46 41v6" stroke="var(--sky)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'No reports generated yet',
    body: 'Generate your first report to see team utilization, burn rates, and AI-powered insights.',
    action: 'Generate first report',
    color: 'var(--sky)',
  },
  notifications: {
    icon: (
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3"/>
        <path d="M32 14c-8.837 0-16 7.163-16 16v8l-4 6h40l-4-6V30C48 21.163 40.837 14 32 14Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M28 44a4 4 0 008 0" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="44" cy="20" r="6" fill="var(--accent)" fillOpacity="0.15" stroke="var(--accent)" strokeWidth="1.5"/>
        <path d="M44 17v3l2 2" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'You\'re all caught up!',
    body: 'No new notifications. We\'ll alert you when there\'s budget activity, team updates, or AI insights.',
    action: undefined,
    color: 'var(--accent)',
  },
  tasks: {
    icon: (
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3"/>
        <rect x="16" y="20" width="32" height="6" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="16" y="30" width="32" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
        <rect x="16" y="40" width="20" height="6" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
        <path d="M26 23h14M26 33h14M26 43h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="20" cy="23" r="2" fill="var(--accent)"/>
        <circle cx="20" cy="33" r="2" fill="var(--accent)" fillOpacity="0.6"/>
        <circle cx="20" cy="43" r="2" fill="var(--accent)" fillOpacity="0.3"/>
      </svg>
    ),
    title: 'No tasks yet',
    body: 'Add tasks to this project to start tracking progress and logging time.',
    action: 'Add first task',
    color: 'var(--accent)',
  },
}

export default function EmptyState({ type, onAction }: EmptyStateProps) {
  const cfg = CONFIGS[type]

  return (
    <div className="animate-fade-up" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '64px 32px', textAlign: 'center',
    }}>
      {/* Glow behind icon */}
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <div style={{
          position: 'absolute', inset: -20,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${cfg.color}15 0%, transparent 70%)`,
          filter: 'blur(16px)',
        }} />
        <div style={{ color: 'var(--text-tertiary)', position: 'relative' }}>
          {cfg.icon}
        </div>
      </div>

      <h3 style={{
        fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300,
        letterSpacing: '-0.02em', color: 'var(--text-primary)', marginBottom: 10,
      }}>{cfg.title}</h3>

      <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 320, marginBottom: 24 }}>
        {cfg.body}
      </p>

      {cfg.action && onAction && (
        <button onClick={onAction} style={{
          background: cfg.color === 'var(--accent)' ? 'var(--accent)' : `${cfg.color}`,
          border: 'none', borderRadius: 9, padding: '10px 22px',
          color: cfg.color === 'var(--accent)' ? '#07080D' : '#fff',
          fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--font-body)',
          cursor: 'pointer',
          boxShadow: `0 8px 24px ${cfg.color}33`,
          transition: 'all 0.15s',
        }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'}
        >{cfg.action}</button>
      )}
    </div>
  )
}
