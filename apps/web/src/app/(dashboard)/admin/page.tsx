'use client'
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, authApi, timeApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { showConfirm } from '@/components/ConfirmDialog'
import { showToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { ALL_PERMISSIONS, PERMISSION_LABELS, PERMISSION_GROUPS } from '@/lib/queries'
import { Search, Globe, Calendar, Pencil, XCircle, X, Ban, RotateCcw, Eye, EyeOff, Play, RefreshCw, Info, Upload, Camera, GitMerge, Plus } from 'lucide-react'
import { uploadFile } from '@/lib/upload'
import { PageHeader, Card, Button, Badge, Input, Label, EmptyState, Select, DatePicker } from '@/components/ui'
import { cn } from '@/lib/cn'
import FinanceImport from './FinanceImport'
import ForecastSync  from './ForecastSync'
import { TemplatesPanel } from './templates/TemplatesPanel'

const ROLE_DEFAULTS: Record<string, Record<string, boolean>> = {
  super_admin: Object.fromEntries(ALL_PERMISSIONS.map(p => [p, true])),
  admin: {
    view_projects: true, manage_projects: true, delete_projects: false,
    view_financials: true, manage_financials: false,
    view_team: true, manage_team: true, invite_members: true,
    view_timesheets: true, manage_timesheets: false,
    view_reports: true, manage_admin: false,
    manage_rate_cards: false, manage_clients: true,
  },
  account_manager: {
    view_projects: true, manage_projects: true, delete_projects: false,
    view_financials: true, manage_financials: false,
    view_team: true, manage_team: false, invite_members: false,
    view_timesheets: true, manage_timesheets: false,
    view_reports: true, manage_admin: false,
    manage_rate_cards: false, manage_clients: true,
  },
  collaborator: {
    view_projects: true, manage_projects: false, delete_projects: false,
    view_financials: false, manage_financials: false,
    view_team: false, manage_team: false, invite_members: false,
    view_timesheets: true, manage_timesheets: false,
    view_reports: false, manage_admin: false,
    manage_rate_cards: false, manage_clients: false,
  },
}

function resolvePermissions(role: string, custom: Record<string, boolean> = {}): Record<string, boolean> {
  const base = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.collaborator
  return Object.fromEntries(ALL_PERMISSIONS.map(p => [p, p in custom ? custom[p] : base[p]]))
}

type EditingUser = { id: string; field: string; value: string }
type ImportStatus = 'idle' | 'testing' | 'running' | 'done' | 'error'
type LogEntry = { type: string; msg: string; time: string }


function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={cn(
        'relative w-10 h-[22px] rounded-full flex-shrink-0 transition-all duration-200 outline-none',
        on
          ? 'bg-accent shadow-[0_0_0_1px_var(--accent)]'
          : 'bg-surface-overlay shadow-[inset_0_1px_2px_rgba(0,0,0,0.1),0_0_0_1px_var(--border-muted)]',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      )}
      aria-pressed={on}
    >
      <div
        className={cn(
          'absolute top-[2px] w-4 h-4 rounded-full transition-[left] duration-200',
          on ? 'bg-white shadow-sm' : 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]',
        )}
        style={{ left: on ? 20 : 3 }}
      />
    </button>
  )
}

// ── Import Option Checkbox ─────────────────────────────────────────────────────
function ImportOption({ label, sub, checked, onChange, disabled }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label
      className={cn(
        'flex items-start gap-2.5 px-3.5 py-3 border rounded-md transition-all duration-150',
        checked ? 'bg-accent-dim border-[rgba(0,212,180,0.2)]' : 'bg-transparent border-line-subtle',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={e => !disabled && onChange(e.target.checked)}
        className="mt-0.5 w-[15px] h-[15px] flex-shrink-0 cursor-pointer accent-accent"
      />
      <div>
        <div className="text-base font-semibold text-primary mb-0.5">{label}</div>
        <div className="text-xs text-muted">{sub}</div>
      </div>
    </label>
  )
}

// Countries supported by the Nager public holidays API
const NAGER_SUPPORTED = new Set([
  'AD','AL','AR','AT','AU','AX','BA','BB','BE','BG','BJ','BO','BR','BS','BW','BY',
  'BZ','CA','CH','CL','CN','CO','CR','CU','CY','CZ','DE','DK','DO','EC','EE','EG',
  'ES','FI','FO','FR','GA','GB','GD','GL','GM','GR','GT','GY','HN','HR','HT','HU',
  'ID','IE','IM','IS','IT','JE','JM','JP','KR','LI','LS','LT','LU','LV','MA','MC',
  'MD','ME','MG','MK','MN','MT','MX','MZ','NA','NE','NG','NI','NL','NO','NZ','PA',
  'PE','PG','PH','PL','PR','PT','PY','RO','RS','RU','SE','SG','SI','SK','SM','SR',
  'SV','TN','TR','UA','US','UY','VA','VE','VN','ZA','ZW',
])

// ── Full world country list with ISO codes ────────────────────────────────────────
const ALL_COUNTRIES = [
  { code:'AE', name:'UAE (United Arab Emirates)' },
  { code:'AF', name:'Afghanistan' },
  { code:'AL', name:'Albania' },
  { code:'DZ', name:'Algeria' },
  { code:'AR', name:'Argentina' },
  { code:'AM', name:'Armenia' },
  { code:'AU', name:'Australia' },
  { code:'AT', name:'Austria' },
  { code:'AZ', name:'Azerbaijan' },
  { code:'BH', name:'Bahrain' },
  { code:'BD', name:'Bangladesh' },
  { code:'BY', name:'Belarus' },
  { code:'BE', name:'Belgium' },
  { code:'BO', name:'Bolivia' },
  { code:'BA', name:'Bosnia and Herzegovina' },
  { code:'BR', name:'Brazil' },
  { code:'BG', name:'Bulgaria' },
  { code:'CA', name:'Canada' },
  { code:'CL', name:'Chile' },
  { code:'CN', name:'China' },
  { code:'CO', name:'Colombia' },
  { code:'HR', name:'Croatia' },
  { code:'CY', name:'Cyprus' },
  { code:'CZ', name:'Czech Republic' },
  { code:'DK', name:'Denmark' },
  { code:'EC', name:'Ecuador' },
  { code:'EG', name:'Egypt' },
  { code:'EE', name:'Estonia' },
  { code:'ET', name:'Ethiopia' },
  { code:'FI', name:'Finland' },
  { code:'FR', name:'France' },
  { code:'GE', name:'Georgia' },
  { code:'DE', name:'Germany' },
  { code:'GH', name:'Ghana' },
  { code:'GR', name:'Greece' },
  { code:'HK', name:'Hong Kong' },
  { code:'HU', name:'Hungary' },
  { code:'IS', name:'Iceland' },
  { code:'IN', name:'India' },
  { code:'ID', name:'Indonesia' },
  { code:'IR', name:'Iran' },
  { code:'IQ', name:'Iraq' },
  { code:'IE', name:'Ireland' },
  { code:'IL', name:'Israel' },
  { code:'IT', name:'Italy' },
  { code:'JM', name:'Jamaica' },
  { code:'JP', name:'Japan' },
  { code:'JO', name:'Jordan' },
  { code:'KZ', name:'Kazakhstan' },
  { code:'KE', name:'Kenya' },
  { code:'KW', name:'Kuwait' },
  { code:'KG', name:'Kyrgyzstan' },
  { code:'LV', name:'Latvia' },
  { code:'LB', name:'Lebanon' },
  { code:'LY', name:'Libya' },
  { code:'LI', name:'Liechtenstein' },
  { code:'LT', name:'Lithuania' },
  { code:'LU', name:'Luxembourg' },
  { code:'MY', name:'Malaysia' },
  { code:'MV', name:'Maldives' },
  { code:'MT', name:'Malta' },
  { code:'MX', name:'Mexico' },
  { code:'MD', name:'Moldova' },
  { code:'MA', name:'Morocco' },
  { code:'MZ', name:'Mozambique' },
  { code:'MM', name:'Myanmar' },
  { code:'NP', name:'Nepal' },
  { code:'NL', name:'Netherlands' },
  { code:'NZ', name:'New Zealand' },
  { code:'NG', name:'Nigeria' },
  { code:'NO', name:'Norway' },
  { code:'OM', name:'Oman' },
  { code:'PK', name:'Pakistan' },
  { code:'PS', name:'Palestine' },
  { code:'PA', name:'Panama' },
  { code:'PY', name:'Paraguay' },
  { code:'PE', name:'Peru' },
  { code:'PH', name:'Philippines' },
  { code:'PL', name:'Poland' },
  { code:'PT', name:'Portugal' },
  { code:'QA', name:'Qatar' },
  { code:'RO', name:'Romania' },
  { code:'RU', name:'Russia' },
  { code:'SA', name:'Saudi Arabia' },
  { code:'SN', name:'Senegal' },
  { code:'RS', name:'Serbia' },
  { code:'SG', name:'Singapore' },
  { code:'SK', name:'Slovakia' },
  { code:'SI', name:'Slovenia' },
  { code:'ZA', name:'South Africa' },
  { code:'KR', name:'South Korea' },
  { code:'ES', name:'Spain' },
  { code:'LK', name:'Sri Lanka' },
  { code:'SD', name:'Sudan' },
  { code:'SE', name:'Sweden' },
  { code:'CH', name:'Switzerland' },
  { code:'SY', name:'Syria' },
  { code:'TW', name:'Taiwan' },
  { code:'TJ', name:'Tajikistan' },
  { code:'TZ', name:'Tanzania' },
  { code:'TH', name:'Thailand' },
  { code:'TN', name:'Tunisia' },
  { code:'TR', name:'Turkey' },
  { code:'TM', name:'Turkmenistan' },
  { code:'UG', name:'Uganda' },
  { code:'UA', name:'Ukraine' },
  { code:'GB', name:'United Kingdom' },
  { code:'US', name:'United States' },
  { code:'UY', name:'Uruguay' },
  { code:'UZ', name:'Uzbekistan' },
  { code:'VE', name:'Venezuela' },
  { code:'VN', name:'Vietnam' },
  { code:'YE', name:'Yemen' },
  { code:'ZM', name:'Zambia' },
  { code:'ZW', name:'Zimbabwe' },
]

// ── Holiday Calendars tab ─────────────────────────────────────────────────────────────────────────
function HolidayCalendarsTab({ qc }: any) {
  const [selectedCalId, setSelectedCalId] = useState<string | null>(null)
  const [newHolName,    setNewHolName]    = useState('')
  const [newHolDate,    setNewHolDate]    = useState('')
  const [editHolId,     setEditHolId]     = useState<string | null>(null)
  const [editHolName,   setEditHolName]   = useState('')
  const [editHolDate,   setEditHolDate]   = useState('')
  const [showPicker,    setShowPicker]    = useState(false)
  const [countrySearch, setCountrySearch] = useState('')
  const [syncYear,      setSyncYear]      = useState(new Date().getFullYear())
  const [syncing,       setSyncing]       = useState(false)
  const [syncResult,    setSyncResult]    = useState<{ ok: boolean; msg: string } | null>(null)
  const [creating,      setCreating]      = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const { data: calendars, isLoading } = useQuery({ queryKey: ['calendars'], queryFn: () => usersApi.calendars().then((r: any) => r.data), staleTime: 30_000 })
  const cals: any[] = calendars || []
  const selectedCal = cals.find(c => c.id === selectedCalId)
  const existingCodes = new Set(cals.map((c: any) => c.country_code).filter(Boolean))
  const filteredCountries = ALL_COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
    c.code.toLowerCase().includes(countrySearch.toLowerCase())
  )
  async function addCountry(country: { code: string; name: string }) {
    setCreating(true); setShowPicker(false); setCountrySearch('')
    try {
      const { api } = await import('@/lib/api')
      const res: any = await api.post('/users/calendars', { name: country.name + ' Holidays', country: country.name, country_code: country.code })
      const newCalId = res?.data?.id
      if (newCalId) {
        await usersApi.syncHolidays(newCalId, syncYear)
        await qc.invalidateQueries({ queryKey: ['calendars'] })
        setSelectedCalId(newCalId)
        setSyncResult({ ok: true, msg: 'Added ' + country.name + ' with ' + syncYear + ' public holidays' })
        setTimeout(() => setSyncResult(null), 4000)
      } else { await qc.invalidateQueries({ queryKey: ['calendars'] }) }
    } catch (e: any) { setSyncResult({ ok: false, msg: 'Failed to add country: ' + e.message }) }
    finally { setCreating(false) }
  }
  function doDeleteCal(id: string) {
    showConfirm('Delete this calendar and all its holidays?', async () => {
      const { api } = await import('@/lib/api')
      await api.delete('/users/calendars/' + id)
      qc.invalidateQueries({ queryKey: ['calendars'] })
      if (selectedCalId === id) setSelectedCalId(null)
    }, { confirmLabel: 'Delete', subtext: 'All holidays will be permanently removed.' })
  }
  const [holSaving, setHolSaving] = useState(false)
  async function doAddHoliday() {
    if (!newHolName.trim() || !newHolDate || !selectedCalId) return
    setHolSaving(true)
    try {
      await usersApi.addHoliday(selectedCalId, { name: newHolName.trim(), date: newHolDate })
      qc.invalidateQueries({ queryKey: ['calendars'] })
      setNewHolName(''); setNewHolDate('')
      showToast.success('Holiday added')
    } catch (e: any) {
      showToast.error('Failed to add holiday: ' + (e?.message || 'unknown'))
    } finally {
      setHolSaving(false)
    }
  }
  function doDeleteHoliday(calId: string, holId: string, holName?: string) {
    showConfirm(
      `Delete ${holName ? `"${holName}"` : 'this holiday'}?`,
      async () => {
        setHolSaving(true)
        try {
          const { api } = await import('@/lib/api')
          await api.delete('/users/calendars/' + calId + '/holidays/' + holId)
          qc.invalidateQueries({ queryKey: ['calendars'] })
          showToast.success('Holiday deleted')
        } catch (e: any) {
          showToast.error('Failed to delete: ' + (e?.message || 'unknown'))
        } finally {
          setHolSaving(false)
        }
      },
      { confirmLabel: 'Delete', subtext: 'This cannot be undone.' },
    )
  }
  async function doEditHoliday(calId: string, holId: string) {
    if (!editHolName.trim() || !editHolDate) return
    setHolSaving(true)
    try {
      const { api } = await import('@/lib/api')
      await api.patch('/users/calendars/' + calId + '/holidays/' + holId, { name: editHolName.trim(), date: editHolDate })
      qc.invalidateQueries({ queryKey: ['calendars'] })
      setEditHolId(null); setEditHolName(''); setEditHolDate('')
      showToast.success('Holiday updated')
    } catch (e: any) {
      showToast.error('Failed to update: ' + (e?.message || 'unknown'))
    } finally {
      setHolSaving(false)
    }
  }
  function startEditHol(hol: any) { setEditHolId(hol.id); setEditHolName(hol.name); setEditHolDate(hol.date) }
  async function doSync(calId: string) {
    setSyncing(true); setSyncResult(null)
    try {
      const res: any = await usersApi.syncHolidays(calId, syncYear)
      qc.invalidateQueries({ queryKey: ['calendars'] })
      if (res.data?.unsupported) { setSyncResult({ ok: false, msg: res.data.message }) }
      else { setSyncResult({ ok: true, msg: 'Synced ' + (res.data?.inserted ?? 0) + ' holidays for ' + syncYear }); setTimeout(() => setSyncResult(null), 4000) }
    } catch (e: any) { setSyncResult({ ok: false, msg: e.message || 'Sync failed' }) }
    finally { setSyncing(false) }
  }
  useEffect(() => { if (showPicker) setTimeout(() => searchRef.current?.focus(), 50) }, [showPicker])
  return (
    <div className="grid grid-cols-[290px_1fr] gap-4">
      {showPicker && (
        <>
          <div
            onClick={() => { setShowPicker(false); setCountrySearch('') }}
            className="fixed inset-0 bg-black/45 backdrop-blur-sm z-overlay"
          />
          <Card className="fixed top-[15vh] left-1/2 -translate-x-1/2 w-[460px] z-modal overflow-hidden p-0 border-line-muted rounded-xl shadow-md">
            <div className="px-4 py-3.5 border-b border-line-subtle">
              <div className="text-lg font-semibold text-primary mb-2.5">Add Country Calendar</div>
              <div className="flex items-center gap-2 bg-surface border border-line-muted rounded px-3 py-2">
                <Search size={16} className="text-muted" />
                <input
                  ref={searchRef}
                  value={countrySearch}
                  onChange={e => setCountrySearch(e.target.value)}
                  placeholder="Search country..."
                  className="flex-1 bg-transparent border-none outline-none text-lg text-primary font-body focus-visible:ring-2 focus-visible:ring-accent rounded"
                  onKeyDown={e => { if (e.key === 'Escape') { setShowPicker(false); setCountrySearch('') } }}
                />
                {countrySearch && (
                  <button
                    onClick={() => setCountrySearch('')}
                    className="bg-none border-none cursor-pointer text-muted p-0 leading-none"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-[340px] overflow-y-auto">
              {filteredCountries.length === 0 && (
                <div className="py-6 text-center text-base text-muted">No matching countries</div>
              )}
              {filteredCountries.map(c => {
                const alreadyAdded = existingCodes.has(c.code)
                return (
                  <div
                    key={c.code}
                    onClick={() => !alreadyAdded && addCountry(c)}
                    className={cn(
                      'px-4 py-2.5 flex items-center justify-between border-b border-line-subtle',
                      alreadyAdded ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-accent-dim',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-bold text-muted bg-surface-overlay px-1.5 py-px rounded-sm font-mono">{c.code}</span>
                      <span className="text-base text-primary font-medium">{c.name}</span>
                    </div>
                    {alreadyAdded ? (
                      <Badge variant="default" className="text-accent bg-accent-dim border-transparent">Added</Badge>
                    ) : NAGER_SUPPORTED.has(c.code) ? (
                      <Badge variant="default" className="text-accent bg-accent-dim border-transparent">Auto</Badge>
                    ) : (
                      <Badge variant="default">Manual</Badge>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="px-4 py-2.5 border-t border-line-subtle text-xs text-muted flex justify-between">
              <span>Synced from public data</span>
              <kbd
                onClick={() => { setShowPicker(false); setCountrySearch('') }}
                className="cursor-pointer bg-surface-overlay border border-line-muted rounded-sm px-1.5 py-px text-[10px]"
              >Esc</kbd>
            </div>
          </Card>
        </>
      )}
      <div>
        <div className="flex justify-between items-center mb-2.5">
          <div className="text-sm font-semibold text-muted uppercase tracking-wider">Calendars ({cals.length})</div>
          <Button variant="secondary" size="sm" onClick={() => setShowPicker(true)} disabled={creating}>
            {creating ? 'Adding...' : <><Plus size={14} /> Add Country</>}
          </Button>
        </div>
        {syncResult && (
          <div className={cn(
            'mb-2.5 px-3 py-2 rounded text-sm font-medium',
            syncResult.ok ? 'bg-accent-dim text-accent' : 'bg-status-rose-dim text-status-rose',
          )}>
            {syncResult.ok ? '✓ ' : '✕ '}{syncResult.msg}
          </div>
        )}
        {isLoading && <div className="text-base text-muted py-3">Loading...</div>}
        <Card className="overflow-hidden p-0">
          {cals.length === 0 && (
            <EmptyState icon={<Globe />} title="No calendars yet" />
          )}
          {cals.map((cal: any, i: number) => (
            <div
              key={cal.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedCalId(cal.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedCalId(cal.id) } }}
              aria-pressed={selectedCalId === cal.id}
              className={cn(
                'px-3.5 py-2.5 cursor-pointer flex items-center justify-between',
                i < cals.length - 1 && 'border-b border-line-subtle',
                selectedCalId === cal.id
                  ? 'bg-accent-dim border-l-2 border-l-accent'
                  : 'border-l-2 border-l-transparent hover:bg-surface-hover',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {cal.country_code && (
                    <span className="text-[10px] font-bold text-muted bg-surface-overlay px-1 py-px rounded-sm font-mono flex-shrink-0">{cal.country_code}</span>
                  )}
                  <span className={cn('text-base font-medium', selectedCalId === cal.id ? 'text-accent' : 'text-primary')}>{cal.name}</span>
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {cal.holidays?.length > 0
                    ? <span className="text-accent font-medium">✓ {cal.holidays.length} holidays</span>
                    : <span className="text-status-amber">No holidays — sync needed</span>}
                </div>
              </div>
              <button
                aria-label="Delete calendar"
                title="Delete calendar"
                onClick={e => { e.stopPropagation(); doDeleteCal(cal.id) }}
                className="bg-none border-none text-muted hover:text-status-rose cursor-pointer p-1 rounded-sm flex-shrink-0"
              >
                <XCircle size={14} />
              </button>
            </div>
          ))}
        </Card>
      </div>
      <div>
        {!selectedCal ? (
          <Card className="p-0">
            <EmptyState
              icon={<Calendar />}
              title="Select a country calendar"
              description="Click a calendar on the left to view its holidays."
              action={<Button variant="secondary" size="sm" onClick={() => setShowPicker(true)}><Plus size={14} /> Add Country Calendar</Button>}
            />
          </Card>
        ) : (
          <div>
            <div className="flex justify-between items-start mb-3.5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {selectedCal.country_code && (
                    <span className="text-sm font-bold text-muted bg-surface-overlay border border-line-muted px-1.5 py-0.5 rounded font-mono">{selectedCal.country_code}</span>
                  )}
                  <div className="text-xl font-semibold text-primary">{selectedCal.name}</div>
                </div>
                <div className="text-sm text-muted">
                  {selectedCal.holidays?.length > 0
                    ? <span className="text-accent font-medium">{selectedCal.holidays.length} holidays loaded</span>
                    : <span className="text-status-amber">No holidays</span>}
                  <span className="mx-1.5">·</span>affects Resourcing capacity
                </div>
              </div>
              <div className="flex items-center gap-2">
                {NAGER_SUPPORTED.has(selectedCal.country_code) ? (
                  <>
                    <Select
                      size="sm"
                      aria-label="Sync year"
                      value={syncYear}
                      onChange={e => setSyncYear(Number(e.target.value))}
                      className="w-auto min-w-[90px]"
                    >
                      {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                    </Select>
                    <Button variant="primary" size="sm" onClick={() => doSync(selectedCal.id)} disabled={syncing}>
                      {syncing ? 'Syncing...' : 'Sync Holidays'}
                    </Button>
                  </>
                ) : (
                  <Badge variant="warning">Manual entry only</Badge>
                )}
              </div>
            </div>
            <Card className="px-3.5 py-3 mb-3.5 border-line-muted">
              <div className="text-sm font-semibold text-primary mb-2">Add Custom Holiday</div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-[10px] uppercase tracking-wider">Holiday Name</Label>
                  <Input
                    value={newHolName}
                    onChange={e => setNewHolName(e.target.value)}
                    placeholder="e.g. Company Retreat Day"
                    className="text-sm py-1.5"
                    onKeyDown={e => e.key === 'Enter' && doAddHoliday()}
                  />
                </div>
                <div className="flex-[0_0_160px]">
                  <Label className="text-[10px] uppercase tracking-wider">Date</Label>
                  <DatePicker
                    value={newHolDate || null}
                    onChange={v => setNewHolDate(v || '')}
                    size="sm"
                  />
                </div>
                <Button variant="primary" size="sm" onClick={doAddHoliday} loading={holSaving} disabled={!newHolName.trim() || !newHolDate || holSaving}>
                  Add
                </Button>
              </div>
            </Card>
            <Card className="overflow-hidden p-0">
              <div className="grid grid-cols-[1fr_140px_70px] px-4 py-2 bg-surface border-b border-line-subtle">
                {['Holiday', 'Date', ''].map(h => (
                  <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
                ))}
              </div>
              {(!selectedCal.holidays || selectedCal.holidays.length === 0) && (
                <div className="py-6 px-4 text-center">
                  <div className="text-base text-muted mb-2">No holidays loaded yet</div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => doSync(selectedCal.id)}
                    disabled={syncing || !selectedCal.country_code}
                  >
                    Sync {syncYear} Public Holidays
                  </Button>
                </div>
              )}
              {(selectedCal.holidays || []).sort((a: any, b: any) => a.date.localeCompare(b.date)).map((hol: any, i: number) => {
                const isLast = i === (selectedCal.holidays?.length || 0) - 1
                return (
                  <div key={hol.id} className={cn(!isLast && 'border-b border-line-subtle')}>
                    {editHolId === hol.id ? (
                      <div className="grid grid-cols-[1fr_140px_90px] px-4 py-1.5 gap-2 items-center bg-accent-dim">
                        <Input
                          value={editHolName}
                          onChange={e => setEditHolName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') doEditHoliday(selectedCal.id, hol.id); if (e.key === 'Escape') setEditHolId(null) }}
                          className="text-sm py-1 border-accent"
                          autoFocus
                        />
                        <DatePicker
                          value={editHolDate || null}
                          onChange={v => setEditHolDate(v || '')}
                          size="sm"
                        />
                        <div className="flex gap-1">
                          <Button variant="primary" size="sm" onClick={() => doEditHoliday(selectedCal.id, hol.id)} loading={holSaving} disabled={holSaving}>Save</Button>
                          <Button variant="secondary" size="sm" aria-label="Cancel edit" onClick={() => setEditHolId(null)}>
                            <X size={12} />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-[1fr_140px_70px] px-4 py-2 items-center hover:bg-surface-hover">
                        <div className="text-base text-primary">{hol.name}</div>
                        <div className="text-sm text-secondary tabular-nums">
                          {new Date(hol.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                        <div className="flex gap-1">
                          <button
                            aria-label="Edit holiday"
                            onClick={() => startEditHol(hol)}
                            title="Edit"
                            className="bg-none border-none text-muted hover:text-accent hover:bg-accent-dim cursor-pointer p-1 rounded-sm"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            aria-label={`Delete holiday ${hol.name}`}
                            onClick={() => doDeleteHoliday(selectedCal.id, hol.id, hol.name)}
                            disabled={holSaving}
                            title="Delete"
                            className="bg-none border-none text-muted hover:text-status-rose hover:bg-status-rose-dim cursor-pointer p-1 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <XCircle size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Category section — top-level so React never remounts it on parent re-render ────
function CategorySection({ title, desc, colorClass, dotColorClass, buttonColorClass, categories, newVal, setNewVal, onAdd, isSaving, onDeactivate }: any) {
  return (
    <Card className="mb-4 p-0 overflow-hidden">
      <div className="px-4 py-3 bg-surface border-b border-line-subtle flex justify-between items-center">
        <div>
          <span className="text-lg font-semibold text-primary">{title}</span>
          <span className="ml-2 text-xs text-muted">{categories.length} active</span>
        </div>
        <span className="text-xs text-muted">{desc}</span>
      </div>
      {categories.length === 0 && (
        <div className="px-4 py-3.5 text-base text-muted italic">No categories yet</div>
      )}
      {categories.map((cat: any, i: number) => (
        <div
          key={cat.id}
          className={cn(
            'flex items-center justify-between px-4 py-2',
            i < categories.length - 1 && 'border-b border-line-subtle',
          )}
        >
          <div className="flex items-center gap-2">
            <div className={cn('w-2 h-2 rounded-full', dotColorClass, !cat.active && 'opacity-[0.35]')} />
            <span className={cn('text-base', cat.active ? 'text-primary' : 'text-muted line-through')}>{cat.name}</span>
            {!cat.active && (
              <span className="text-[10px] text-muted bg-surface-overlay px-1.5 py-px rounded-sm">inactive</span>
            )}
          </div>
          <button
            aria-label={cat.active ? `Deactivate ${cat.name}` : `${cat.name} (inactive)`}
            onClick={() => onDeactivate(cat.id, cat.name)}
            title={cat.active ? 'Deactivate' : 'Inactive'}
            className="bg-none border-none text-muted hover:text-status-rose hover:bg-status-rose-dim cursor-pointer p-1 rounded-sm"
          >
            <Ban size={14} />
          </button>
        </div>
      ))}
      <div className="flex gap-2 items-center px-4 py-2.5 border-t border-dashed border-line-subtle bg-accent-dim/30">
        <Input
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          placeholder={`+ New ${title.toLowerCase()} category...`}
          className="flex-1 h-7 text-sm py-1 px-2.5"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }}
        />
        <button
          onClick={onAdd}
          disabled={!newVal.trim() || isSaving}
          className={cn(
            'inline-flex items-center justify-center gap-2 h-7 rounded px-3 text-xs font-semibold font-body flex-shrink-0 transition-colors',
            newVal.trim()
              ? cn(buttonColorClass, 'text-white cursor-pointer')
              : 'bg-surface-overlay text-muted cursor-not-allowed',
          )}
        >
          {isSaving ? 'Adding...' : <><Plus size={14} /> Add</>}
        </button>
      </div>
    </Card>
  )
}

// ── Time Categories management tab ───────────────────────────────────────────────
function TimeCategoriesTab({ categoriesRaw, qc }: any) {
  const [newInternal, setNewInternal] = useState('')
  const [newTimeOff,  setNewTimeOff]  = useState('')
  const [saving,      setSaving]      = useState<string | null>(null)

  const internal: any[] = categoriesRaw?.internal || []
  const timeOff:  any[] = categoriesRaw?.timeOff  || []

  async function createInternal() {
    const name = newInternal.trim()
    if (!name) return
    if (internal.some((c: any) => c.name?.toLowerCase() === name.toLowerCase() && c.active)) {
      showToast.error(`"${name}" already exists`)
      return
    }
    setSaving('internal')
    try {
      await timeApi.createInternalCategory(name)
      setNewInternal('')
      qc.invalidateQueries({ queryKey: ['time-categories-all'] })
      showToast.info(`Added "${name}"`)
    } catch (e: any) {
      showToast.error('Failed to add: ' + (e?.message || 'unknown error'))
    } finally {
      setSaving(null)
    }
  }
  async function createTimeOff() {
    const name = newTimeOff.trim()
    if (!name) return
    if (timeOff.some((c: any) => c.name?.toLowerCase() === name.toLowerCase() && c.active)) {
      showToast.error(`"${name}" already exists`)
      return
    }
    setSaving('timeoff')
    try {
      await timeApi.createTimeOffCategory(name)
      setNewTimeOff('')
      qc.invalidateQueries({ queryKey: ['time-categories-all'] })
      showToast.info(`Added "${name}"`)
    } catch (e: any) {
      showToast.error('Failed to add: ' + (e?.message || 'unknown error'))
    } finally {
      setSaving(null)
    }
  }
  function deactivate(type: 'internal'|'timeoff', id: string, name: string) {
    showConfirm(`Deactivate "${name}"?`, async () => {
      try {
        if (type==='internal') await timeApi.deleteInternalCategory(id)
        else await timeApi.deleteTimeOffCategory(id)
        qc.invalidateQueries({ queryKey: ['time-categories-all'] })
      } catch (e: any) {
        showToast.error('Failed: ' + (e?.message || 'unknown error'))
      }
    }, { confirmLabel: 'Deactivate', subtext: "It won't appear in timesheets but all logged time is kept." })
  }

  return (
    <div>
      <CategorySection
        title="Internal Time"
        desc="Non-billable project overhead"
        dotColorClass="bg-status-amber"
        buttonColorClass="bg-status-amber"
        categories={internal}
        newVal={newInternal}
        setNewVal={setNewInternal}
        onAdd={createInternal}
        isSaving={saving==='internal'}
        onDeactivate={(id: string, name: string)=>deactivate('internal', id, name)}
      />
      <CategorySection
        title="Time Off"
        desc="Leave types"
        dotColorClass="bg-status-rose"
        buttonColorClass="bg-status-rose"
        categories={timeOff}
        newVal={newTimeOff}
        setNewVal={setNewTimeOff}
        onAdd={createTimeOff}
        isSaving={saving==='timeoff'}
        onDeactivate={(id: string, name: string)=>deactivate('timeoff', id, name)}
      />
    </div>
  )
}

// ── Inline add-entry row for a single rate card ───────────────────────────────
function AddRateEntryRow({ rcId, currency, departments, existingDeptIds, onAdded }: { rcId: string; currency: string; departments: any[]; existingDeptIds: Set<string>; onAdded: () => void }) {
  const [deptId, setDeptId] = useState('')
  const [rate,   setRate]   = useState('')
  const [saving, setSaving] = useState(false)

  const availableDepts = departments.filter(d => !existingDeptIds.has(d.id))

  async function save() {
    if (!deptId) return
    const numRate = Number(rate)
    if (!Number.isFinite(numRate) || numRate < 0) {
      showToast.error('Rate must be a number ≥ 0')
      return
    }
    setSaving(true)
    try {
      await usersApi.addRateEntry(rcId, { department_id: deptId, hourly_rate: numRate })
      setDeptId(''); setRate('')
      onAdded()
    } finally { setSaving(false) }
  }

  return (
    <div className="grid grid-cols-[1fr_140px_36px] px-4 py-2 border-t border-dashed border-line-subtle items-center gap-2 bg-accent-dim/20">
      <Select
        value={deptId}
        onChange={e => setDeptId(e.target.value)}
        className="text-sm py-1"
        aria-label="Department"
      >
        <option value="">+ Add department rate...</option>
        {availableDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          value={rate}
          onChange={e => setRate(e.target.value)}
          placeholder="Rate"
          className="w-20 text-right text-sm py-1"
          onKeyDown={e => e.key === 'Enter' && save()}
        />
        <span className="text-xs text-muted whitespace-nowrap">{currency}/hr</span>
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={save}
        disabled={!deptId || !rate || saving}
        className="px-2"
      >
        {saving ? '…' : '✓'}
      </Button>
    </div>
  )
}

export default function AdminPage() {
  const { isAdmin, isSuperAdmin } = useAuthStore()
  const qc = useQueryClient()

  // ── Core tab state ─────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'people' | 'permissions' | 'roles' | 'base_rates' | 'rate_cards' | 'departments' | 'clients' | 'labels' | 'time_categories' | 'holidays' | 'templates' | 'settings' | 'import' | 'finance_import' | 'forecast_sync'>('people')

  // ── People / permissions state ─────────────────────────────────────────────
  const [showInvite,  setShowInvite]  = useState(false)
  const [showClient,  setShowClient]  = useState(false)
  const [deptName,    setDeptName]    = useState('')
  const [labelForm,   setLabelForm]   = useState({ name: '', color: '#0D9488' })
  const [editing,     setEditing]     = useState<EditingUser | null>(null)
  const [clientForm,  setClientForm]  = useState<{ name: string; country: string; address: string; logo_url: string; parent_client_id: string }>({ name: '', country: '', address: '', logo_url: '', parent_client_id: '' })
  const [editingClient, setEditingClient] = useState<any | null>(null)
  const [mergingClient, setMergingClient] = useState<any | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [mergeSubmitting, setMergeSubmitting] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [pendingOverrides, setPendingOverrides] = useState<Record<string, boolean>>({})
  const [permMode, setPermMode] = useState<'role'|'department'|'user'>('role')
  const [selectedRole, setSelectedRole] = useState<string>('collaborator')
  const [rolePermEdits, setRolePermEdits] = useState<Record<string, Record<string, boolean>>>({})
  const [rolePermSaving, setRolePermSaving] = useState(false)
  const [rolePermSaved, setRolePermSaved] = useState(false)
  const [selectedPermDept, setSelectedPermDept] = useState<string>('')
  const [savedMsg,    setSavedMsg]    = useState(false)
  const [wsSaved,     setWsSaved]     = useState(false)
  // Cleanup all transient timers on unmount
  const transientTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  useEffect(() => () => { transientTimers.current.forEach(t => clearTimeout(t)); transientTimers.current.clear() }, [])
  const safeTimeout = (fn: () => void, ms: number) => {
    const t = setTimeout(() => { transientTimers.current.delete(t); fn() }, ms)
    transientTimers.current.add(t)
    return t
  }
  const [wsForm,      setWsForm]      = useState<any>(null)
  const [inviteForm,  setInviteForm]  = useState({ name: '', email: '', jobTitle: '', permissionProfile: 'collaborator', departmentId: '', capacityHrs: 40, internalHourlyCost: 0 })
  const [showNewRc,   setShowNewRc]   = useState(false)
  const [newRcForm,   setNewRcForm]   = useState({ name: '', currency: 'AED' })

  // ── Import state ───────────────────────────────────────────────────────────
  // Forecast.it API key is paste-in only — never hardcoded into the build.
  const [importApiKey, setImportApiKey] = useState('')
  const [importOptions, setImportOptions] = useState({ departments: true, users: true, clients: true, projects: true, tasks: true })
  const [importStatus,  setImportStatus]  = useState<ImportStatus>('idle')
  const [importLogs,    setImportLogs]    = useState<LogEntry[]>([])
  const [importCounts,  setImportCounts]  = useState<Record<string, number> | null>(null)
  const [testResult,    setTestResult]    = useState<{ ok: boolean; user?: string; counts?: Record<string, number>; error?: string } | null>(null)
  const [showApiKey,    setShowApiKey]    = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [importLogs])

  // ── Data queries ───────────────────────────────────────────────────────────
  const { data: users,       isLoading } = useQuery({ queryKey: ['users'],       queryFn: () => usersApi.list().then((r: any) => r.data) })
  const { data: depts }                  = useQuery({ queryKey: ['departments'], queryFn: () => usersApi.departments().then((r: any) => r.data) })
  const { data: clients }                = useQuery({ queryKey: ['clients'],     queryFn: () => usersApi.clients().then((r: any) => r.data) })
  const { data: labels }                 = useQuery({ queryKey: ['labels'],      queryFn: () => usersApi.labels().then((r: any) => r.data) })
  const { data: customRolesRaw }         = useQuery({ queryKey: ['custom-roles'], queryFn: () => usersApi.customRoles().then((r: any) => r.data), enabled: isAdmin() })
  const customRoles: any[] = customRolesRaw || []
  const [newRoleName, setNewRoleName]    = useState('')
  const [newRoleBase, setNewRoleBase]    = useState('collaborator')
  const addCustomRole  = useMutation({ mutationFn: () => usersApi.createCustomRole({ name: newRoleName, base_role: newRoleBase }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['custom-roles'] }); setNewRoleName('') } })
  const deleteCustomRole = useMutation({ mutationFn: (id: string) => usersApi.deleteCustomRole(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-roles'] }) })
  const { data: rateCards }              = useQuery({ queryKey: ['rate-cards'],  queryFn: () => api.get('/users/rate-cards').then((r: any) => r.data), enabled: isAdmin() })
  const { data: categoriesRaw }          = useQuery({ queryKey: ['time-categories-all'], queryFn: () => timeApi.categories().then((r: any) => r.data), enabled: isAdmin() })
  const { data: workspaceData }          = useQuery({ queryKey: ['workspace'],   queryFn: () => usersApi.workspace().then((r: any) => r.data), enabled: isSuperAdmin() })

  // Auto-select first item when switching permission modes
  useEffect(() => {
    if (permMode === 'department' && !selectedPermDept && depts?.length) {
      setSelectedPermDept(depts[0].id)
    }
    if (permMode === 'user' && !selectedUserId && users?.length) {
      setSelectedUserId(users[0].id)
    }
  }, [permMode, depts, selectedPermDept, users, selectedUserId])

  useEffect(() => {
    if (workspaceData && !wsForm) setWsForm({
      name: workspaceData.name || 'Digital Nexa',
      default_currency: workspaceData.default_currency || 'AED',
      billable_utilization_pct: workspaceData.billable_utilization_pct ?? 60,
      resource_utilization_pct: workspaceData.resource_utilization_pct ?? 100,
      weekends_enabled: workspaceData.weekends_enabled ?? true,
      allow_entries_on_done: workspaceData.allow_entries_on_done ?? true,
      allow_entries_over_estimate: workspaceData.allow_entries_over_estimate ?? true,
      allow_late_entries: workspaceData.allow_late_entries ?? true,
      timesheet_deadline_day: workspaceData.timesheet_deadline_day ?? 5, // 5 = Friday
    })
  }, [workspaceData])

  // ── Auto-save workspace settings with 800ms debounce ──────────────────────
  const wsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsInitRef     = useRef(false)
  useEffect(() => {
    if (!wsForm) return
    if (!wsInitRef.current) { wsInitRef.current = true; return }
    if (wsDebounceRef.current) clearTimeout(wsDebounceRef.current)
    wsDebounceRef.current = setTimeout(() => { saveWorkspace.mutate(wsForm) }, 800)
    return () => { if (wsDebounceRef.current) clearTimeout(wsDebounceRef.current) }
  }, [wsForm])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invite        = useMutation({
    mutationFn: () => {
      // Custom role value is encoded as "base_role:uuid" — parse it before sending
      const profile = inviteForm.permissionProfile
      const isCustom = profile.includes(':')
      const permissionProfile = isCustom ? profile.split(':')[0] : profile
      const customRoleId      = isCustom ? profile.split(':')[1] : null
      return authApi.invite({ ...inviteForm, permissionProfile, customRoleId } as any)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowInvite(false)
      setInviteForm({ name:'',email:'',jobTitle:'',permissionProfile:'collaborator',departmentId:'',capacityHrs:40,internalHourlyCost:0 })
    },
  })
  const updateUser    = useMutation({ mutationFn: ({ id, data }: any) => usersApi.update(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditing(null) } })
  const addDept       = useMutation({ mutationFn: () => usersApi.createDept(deptName), onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setDeptName('') } })
  const deleteDept    = useMutation({ mutationFn: (id: string) => api.delete('/users/departments/' + id), onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }) })
  const addClient        = useMutation({ mutationFn: () => usersApi.createClient(clientForm), onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); setShowClient(false); setClientForm({ name:'',country:'',address:'',logo_url:'',parent_client_id:'' }) } })
  const deactivateClient = useMutation({ mutationFn: (id: string) => usersApi.updateClient(id, { active: false }), onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }) })
  const activateClient   = useMutation({ mutationFn: (id: string) => usersApi.updateClient(id, { active: true }),  onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }) })
  const addLabel      = useMutation({ mutationFn: () => usersApi.createLabel(labelForm), onSuccess: () => { qc.invalidateQueries({ queryKey: ['labels'] }); setLabelForm({ name:'',color:'#0D9488' }) } })
  const deactivate    = useMutation({ mutationFn: (id: string) => usersApi.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) })
  const savePerms     = useMutation({ mutationFn: ({ id, overrides }: { id: string; overrides: Record<string, boolean> }) => usersApi.updatePermissions(id, overrides), onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2000) } })
  const saveWorkspace   = useMutation({ mutationFn: (data: any) => usersApi.updateWorkspace(data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['workspace'] }); setWsSaved(true); setTimeout(() => setWsSaved(false), 2000) } })
  const createRateCard  = useMutation({ mutationFn: (data: any) => usersApi.createRateCard(data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['rate-cards'] }); setNewRcForm({ name:'', currency:'AED' }); setShowNewRc(false) } })

  // ── Email triggers ─────────────────────────────────────────────────────────
  const [emailStatus, setEmailStatus] = useState<Record<string, 'idle'|'sending'|'done'|'error'>>({})
  async function triggerEmail(endpoint: string, label: string) {
    setEmailStatus(s => ({ ...s, [label]: 'sending' }))
    try {
      const wsRes = await usersApi.workspace().then((r: any) => r.data)
      const wid   = wsRes?.id || '00000000-0000-0000-0000-000000000001'
      await api.post(endpoint, { workspaceId: wid })
      setEmailStatus(s => ({ ...s, [label]: 'done' }))
      setTimeout(() => setEmailStatus(s => ({ ...s, [label]: 'idle' })), 4000)
    } catch { setEmailStatus(s => ({ ...s, [label]: 'error' })); setTimeout(() => setEmailStatus(s => ({ ...s, [label]: 'idle' })), 4000) }
  }

  // ── Import: Test connection ────────────────────────────────────────────────
  async function runTest() {
    setTestResult(null)
    setImportStatus('testing')
    try {
      const r = await api.post('/users/import/test', { apiKey: importApiKey })
      setTestResult(r as any)
    } catch(e: any) {
      setTestResult({ ok: false, error: e.message })
    } finally {
      setImportStatus('idle')
    }
  }

  // ── Import: Stream the full import ────────────────────────────────────────
  async function runImport() {
    if (!importApiKey.trim()) return
    setImportStatus('running')
    setImportLogs([])
    setImportCounts(null)

    const addLog = (type: string, msg: string) => {
      const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setImportLogs(prev => [...prev, { type, msg, time }])
    }

    try {
      const token = useAuthStore.getState().token
      const response = await fetch('http://localhost:4000/api/v1/users/import/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          apiKey: importApiKey,
          options: importOptions,
          workspaceId: '00000000-0000-0000-0000-000000000001',
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      const reader  = response.body!.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          try {
            const data = JSON.parse(trimmed.slice(5).trim())
            if (data.msg) addLog(data.type || 'log', data.msg)
            if (data.type === 'done') {
              setImportStatus('done')
              if (data.counts) setImportCounts(data.counts)
              qc.invalidateQueries()  // Refresh all queries after import
            }
            if (data.type === 'error') setImportStatus('error')
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch(e: any) {
      setImportStatus('error')
      const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setImportLogs(prev => [...prev, { type: 'error', msg: `Connection failed: ${e.message}`, time }])
    }
  }

  if (!isAdmin()) {
    return (
      <div className="px-7 py-10">
        <EmptyState title="Admin" description="You need Admin access." />
      </div>
    )
  }

  const selectedUser     = (users || []).find((u: any) => u.id === selectedUserId)
  const selectedResolved = selectedUser ? resolvePermissions(selectedUser.permission_profile, pendingOverrides) : null
  const hasCustomPerms   = selectedUser && Object.keys(pendingOverrides).length > 0
  const overrideCount    = Object.keys(pendingOverrides).length

  function openPermEditor(u: any) { setSelectedUserId(u.id); setPendingOverrides(u.custom_permissions || {}); setTab('permissions') }

  function togglePerm(perm: string) {
    if (!selectedUser) return
    const base    = ROLE_DEFAULTS[selectedUser.permission_profile]?.[perm] ?? false
    const current = selectedResolved?.[perm] ?? false
    setPendingOverrides(prev => {
      const next = { ...prev }
      if (current === base) { next[perm] = !base } else { delete next[perm] }
      return next
    })
  }

  function saveEdit(u: any) {
    if (!editing || editing.id !== u.id) return
    let val: any = editing.value
    if (editing.field === 'capacity_hrs') {
      const n = Number(editing.value)
      if (!Number.isFinite(n) || n < 0 || n > 168) {
        showToast.error('Capacity must be a number between 0 and 168')
        return
      }
      val = n
    }
    if (editing.field === 'permission_profile' && String(val).includes(':')) {
      // Custom role encoded as "base_role:uuid"
      const [baseRole, roleId] = String(val).split(':')
      updateUser.mutate({ id: u.id, data: { permission_profile: baseRole, custom_role_id: roleId } })
    } else if (editing.field === 'permission_profile') {
      updateUser.mutate({ id: u.id, data: { permission_profile: val, custom_role_id: null } })
    } else {
      updateUser.mutate({ id: u.id, data: { [editing.field]: val } })
    }
  }

  const PROFILE_COLORS: Record<string, string> = {
    super_admin: 'text-status-rose',
    admin: 'text-status-violet',
    account_manager: 'text-status-amber',
    collaborator: 'text-muted',
  }

  const ALL_TABS = [
    { key: 'people',      label: `People (${users?.length || 0})` },
    { key: 'permissions', label: 'Permissions' },
    { key: 'roles',       label: `Roles (${customRoles.length})` },
    ...(isSuperAdmin() ? [{ key: 'base_rates', label: 'Base Rate Card' }] : []),
    { key: 'rate_cards',  label: 'Partner Rate Cards' },
    { key: 'departments', label: `Departments (${depts?.length || 0})` },
    { key: 'clients',     label: `Clients (${clients?.length || 0})` },
    { key: 'labels',          label: `Labels (${labels?.length || 0})` },
    { key: 'time_categories', label: 'Time Categories' },
    { key: 'holidays',        label: 'Holidays' },
    { key: 'templates',       label: 'Project Templates' },
    ...(isSuperAdmin() ? [{ key: 'settings', label: 'Workspace Settings' }] : []),
    { key: 'import',          label: '↓ Import Forecast' },
    { key: 'finance_import',  label: '⟳ Finance Sheet Sync' },
    { key: 'forecast_sync',   label: '↻ Live Forecast Sync' },
  ] as const

  function EditableCell({ u, field, display, options }: { u: any; field: string; display: string; options?: { value: string; label: string }[] }) {
    const isEdit = editing?.id === u.id && editing?.field === field
    if (isEdit) {
      if (options) return (
        <Select
          autoFocus
          size="sm"
          aria-label={`Edit ${field}`}
          defaultValue={editing!.value}
          onChange={e => setEditing({ ...editing!, value: e.target.value })}
          onBlur={() => saveEdit(u)}
          onKeyDown={e => { if (e.key === 'Enter') saveEdit(u); if (e.key === 'Escape') setEditing(null) }}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )
      return (
        <Input
          autoFocus
          type={field === 'capacity_hrs' ? 'number' : 'text'}
          defaultValue={editing!.value}
          onChange={e => setEditing({ ...editing!, value: e.target.value })}
          onBlur={() => saveEdit(u)}
          onKeyDown={e => { if (e.key === 'Enter') saveEdit(u); if (e.key === 'Escape') setEditing(null) }}
          className="text-sm py-1"
        />
      )
    }
    return (
      <div
        title="Click to edit"
        onClick={() => setEditing({ id: u.id, field, value: String(u[field] ?? display) })}
        className="cursor-pointer text-sm text-secondary px-1 py-0.5 rounded-sm transition-colors hover:bg-surface-hover"
      >
        {display || <span className="text-muted italic">—</span>}
      </div>
    )
  }

  const isImportRunning = importStatus === 'running' || importStatus === 'testing'

  return (
    <div className="px-7 py-6 overflow-auto h-full">
      <PageHeader title="Admin" />

      {/* Tab navigation — pill tabs */}
      <div className="flex border-b border-line-subtle mb-3.5 overflow-x-auto">
        {ALL_TABS.map(t => {
          const isActive = tab === t.key
          const isImportTab = t.key === 'import'
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={cn(
                'bg-none border-none cursor-pointer px-3.5 py-2 whitespace-nowrap text-base font-body transition-colors',
                'border-b-2',
                isActive
                  ? cn('font-semibold', isImportTab ? 'text-accent border-accent' : 'text-primary border-accent')
                  : cn('font-normal border-transparent', isImportTab ? 'text-accent/60' : 'text-muted hover:text-secondary'),
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── PEOPLE ── */}
      {tab === 'people' && (
        <div>
          {showInvite && (
            <Card className="px-4 py-4 mb-3.5 border-line-muted">
              <div className="text-base font-semibold text-primary mb-3">Invite Team Member</div>
              <div className="grid grid-cols-3 gap-2.5 mb-3">
                {([
                  { label: 'Full Name *', key: 'name', type: 'text', placeholder: 'Jane Smith' },
                  { label: 'Email *', key: 'email', type: 'email', placeholder: 'jane@digitalnexa.com' },
                  { label: 'Job Title', key: 'jobTitle', type: 'text', placeholder: 'Account Manager' },
                ] as any[]).map(f => (
                  <div key={f.key}>
                    <Label className="text-xs uppercase tracking-wider">{f.label}</Label>
                    <Input
                      type={f.type}
                      placeholder={f.placeholder}
                      value={(inviteForm as any)[f.key]}
                      onChange={e => setInviteForm(frm => ({ ...frm, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))}
                    />
                  </div>
                ))}
                <div>
                  <Label className="text-xs uppercase tracking-wider">Role</Label>
                  <Select
                    aria-label="Role"
                    value={inviteForm.permissionProfile}
                    onChange={e => setInviteForm(f => ({ ...f, permissionProfile: e.target.value }))}
                  >
                    <optgroup label="Built-in">
                      <option value="collaborator">Collaborator</option>
                      <option value="account_manager">Account Manager</option>
                      <option value="admin">Admin</option>
                      {isSuperAdmin() && <option value="super_admin">Super Admin</option>}
                    </optgroup>
                    {customRoles.length > 0 && (
                      <optgroup label="Custom Roles">
                        {customRoles.map((r: any) => (
                          <option key={r.id} value={r.base_role + ':' + r.id}>{r.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider">Department</Label>
                  <Select
                    aria-label="Department"
                    value={inviteForm.departmentId}
                    onChange={e => setInviteForm(f => ({ ...f, departmentId: e.target.value }))}
                  >
                    <option value="">No department</option>
                    {(depts || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => invite.mutate()} disabled={!inviteForm.name || !inviteForm.email || invite.isPending} loading={invite.isPending}>
                  {invite.isPending ? 'Inviting...' : 'Send Invite'}
                </Button>
                <Button variant="secondary" onClick={() => setShowInvite(false)}>Cancel</Button>
              </div>
            </Card>
          )}
          <Card className="p-0 relative">
            <div className="grid grid-cols-[1.8fr_1fr_1fr_110px_70px_110px] data-row-head sticky top-0 z-sticky px-4 py-2.5 items-center bg-surface border-b border-line-subtle rounded-t-lg">
              {['Name / Email', 'Department', 'Job Title', 'Role', 'Capacity', ''].map(h => (
                <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowInvite(s => !s)}
              className="absolute top-1.5 right-3 z-sticky"
            >
              {showInvite ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Invite Member</>}
            </Button>
            {isLoading && <div className="p-5 text-base text-muted">Loading...</div>}
            {(users || []).map((u: any, i: number) => {
              const initials  = u.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || '??'
              const profile   = u.permission_profile || 'collaborator'
              const roleName  = u.custom_roles?.name || profile.replace(/_/g, ' ')
              const hasCustom = Object.keys(u.custom_permissions || {}).length > 0
              const isLast = i === (users?.length || 0) - 1
              return (
                <div
                  key={u.id}
                  className={cn(
                    'grid grid-cols-[1.8fr_1fr_1fr_110px_70px_110px] px-4 py-2.5 items-center',
                    !isLast && 'border-b border-line-subtle',
                    u.active === false && 'opacity-40',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-surface-overlay border border-line-muted flex items-center justify-center text-[10px] font-bold text-secondary flex-shrink-0">
                      {initials}
                    </div>
                    <div>
                      <div className="text-base font-medium text-primary flex items-center gap-1.5">
                        <a
                          href={`/team/${u.id}`}
                          onClick={e => { e.preventDefault(); window.location.href = `/team/${u.id}` }}
                          className="text-inherit no-underline cursor-pointer hover:text-accent"
                        >{u.name}</a>
                        {hasCustom && (
                          <Badge variant="violet" className="text-[9px] px-1.5 py-px">CUSTOM</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted">{u.email}</div>
                    </div>
                  </div>
                  <EditableCell u={u} field="department_id" display={u.departments?.name || '—'} options={[{ value: '', label: 'No dept' }, ...(depts||[]).map((d: any) => ({ value: d.id, label: d.name }))]} />
                  <EditableCell u={u} field="job_title" display={u.job_title || '—'} />
                  <div>
                    {editing?.id === u.id && editing?.field === 'permission_profile' ? (
                      <Select
                        autoFocus
                        size="sm"
                        aria-label="Edit role"
                        defaultValue={profile}
                        onChange={e => setEditing({ id: u.id, field: 'permission_profile', value: e.target.value })}
                        onBlur={() => saveEdit(u)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(u); if (e.key === 'Escape') setEditing(null) }}
                      >
                        <optgroup label="Built-in">
                          <option value="collaborator">Collaborator</option>
                          <option value="account_manager">Account Manager</option>
                          <option value="admin">Admin</option>
                          {isSuperAdmin() && <option value="super_admin">Super Admin</option>}
                        </optgroup>
                        {customRoles.length > 0 && (
                          <optgroup label="Custom">
                            {customRoles.map((r: any) => <option key={r.id} value={r.base_role + ':' + r.id}>{r.name}</option>)}
                          </optgroup>
                        )}
                      </Select>
                    ) : (
                      <div
                        onClick={() => setEditing({ id: u.id, field: 'permission_profile', value: profile })}
                        className={cn(
                          'cursor-pointer text-sm font-semibold px-1 py-0.5 rounded-sm inline-block capitalize hover:bg-surface-hover',
                          PROFILE_COLORS[profile],
                        )}
                      >
                        {roleName}
                      </div>
                    )}
                  </div>
                  <EditableCell u={u} field="capacity_hrs" display={`${u.capacity_hrs || 40}h`} />
                  <div className="flex gap-1.5">
                    {isSuperAdmin() && (
                      <button
                        onClick={() => openPermEditor(u)}
                        className={cn(
                          'rounded-sm text-xs cursor-pointer font-body px-2 py-0.5 border',
                          hasCustom
                            ? 'bg-status-violet-dim border-[rgba(139,92,246,0.3)] text-status-violet'
                            : 'bg-transparent border-line-muted text-secondary',
                        )}
                      >
                        Perms
                      </button>
                    )}
                    {isSuperAdmin() && u.active !== false && (
                      <button
                        onClick={() => showConfirm(`Deactivate ${u.name}?`, () => deactivate.mutate(u.id), { confirmLabel: 'Deactivate', subtext: 'The user will lose access to the platform.' })}
                        className="bg-none border-none text-xs text-muted hover:text-status-rose cursor-pointer font-body px-0 py-0.5"
                      >
                        Off
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </Card>
        </div>
      )}

      {/* ── PERMISSIONS ── */}
      {tab === 'permissions' && (() => {
        const roleEdits = rolePermEdits[selectedRole] || {}
        const hasRoleEdits = Object.keys(roleEdits).length > 0
        const getRolePerm = (perm: string) => perm in roleEdits ? roleEdits[perm] : (ROLE_DEFAULTS[selectedRole]?.[perm] ?? false)
        const toggleRolePerm = (perm: string) => {
          const cur = getRolePerm(perm)
          setRolePermEdits(prev => ({ ...prev, [selectedRole]: { ...(prev[selectedRole]||{}), [perm]: !cur } }))
        }
        async function saveRolePerms() {
          if (!hasRoleEdits || rolePermSaving) return
          setRolePermSaving(true)
          try {
            const roleUsers = (users||[]).filter((u:any) => u.permission_profile === selectedRole)
            const permsToSet = roleEdits
            await Promise.all(roleUsers.map((u:any) => {
              const existing = u.custom_permissions || {}
              const merged = { ...existing, ...permsToSet }
              return api.patch('/users/' + u.id + '/permissions', merged)
            }))
            qc.invalidateQueries({ queryKey: ['users'] })
            setRolePermEdits(prev => { const n = {...prev}; delete n[selectedRole]; return n })
            setRolePermSaved(true)
            safeTimeout(() => setRolePermSaved(false), 2000)
          } catch(e: any) { showToast.error('Failed: ' + (e?.message || 'error')) }
          finally { setRolePermSaving(false) }
        }
        // Department users for dept mode
        const deptUsers = selectedPermDept ? (users||[]).filter((u:any) => u.department_id === selectedPermDept || u.departments?.name === selectedPermDept) : []

        // Dept perm helpers — compute "current majority" per perm across dept users
        const deptPermEdits = rolePermEdits['__dept_' + selectedPermDept] || {}
        const hasDeptEdits = Object.keys(deptPermEdits).length > 0
        function getDeptPerm(perm: string): boolean {
          if (perm in deptPermEdits) return deptPermEdits[perm]
          // Majority vote: if more than half of dept users have this perm on, show as on
          if (deptUsers.length === 0) return false
          const onCount = deptUsers.filter((u: any) => {
            const resolved = resolvePermissions(u.permission_profile, u.custom_permissions || {})
            return resolved[perm]
          }).length
          return onCount > deptUsers.length / 2
        }
        function toggleDeptPerm(perm: string) {
          const cur = getDeptPerm(perm)
          const key = '__dept_' + selectedPermDept
          setRolePermEdits(prev => ({ ...prev, [key]: { ...(prev[key]||{}), [perm]: !cur } }))
        }
        async function saveDeptPerms() {
          if (!hasDeptEdits || rolePermSaving) return
          setRolePermSaving(true)
          try {
            await Promise.all(deptUsers.map((u: any) => {
              const existing = u.custom_permissions || {}
              const merged = { ...existing, ...deptPermEdits }
              return api.patch('/users/' + u.id + '/permissions', merged)
            }))
            qc.invalidateQueries({ queryKey: ['users'] })
            const key = '__dept_' + selectedPermDept
            setRolePermEdits(prev => { const n = {...prev}; delete n[key]; return n })
            setRolePermSaved(true)
            safeTimeout(() => setRolePermSaved(false), 2000)
          } catch(e: any) { showToast.error('Failed: ' + (e?.message || 'error')) }
          finally { setRolePermSaving(false) }
        }

        // Mode toggle helper — embedded inside each mode's sidebar card
        const modeToggleRow = (
          <div className="flex gap-0.5 p-[3px] bg-surface-overlay border-b border-line-subtle">
            {(['role','department','user'] as const).map(m => (
              <button key={m} onClick={() => setPermMode(m)} className={cn('flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer font-body border-none transition-colors', permMode===m ? 'bg-surface-raised text-accent shadow-sm' : 'bg-transparent text-muted hover:text-secondary')}>
                {m==='role'?'Role':m==='department'?'Dept':'User'}
              </button>
            ))}
          </div>
        )

        return (
        <div>
          {permMode === 'role' ? (
            /* ── ROLE-LEVEL PERMISSIONS ── */
            <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 items-start">
              {/* Left: mode toggle + role list — sticky */}
              <div className="sticky top-4">
                <Card className="overflow-hidden p-0">
                  {modeToggleRow}
                  {[
                    { key:'super_admin', label:'Super Admin', desc:'Full access', dotClass:'bg-status-rose' },
                    { key:'admin', label:'Admin', desc:'Manage team & projects', dotClass:'bg-status-violet' },
                    { key:'account_manager', label:'Account Manager', desc:'Projects & clients', dotClass:'bg-accent' },
                    { key:'collaborator', label:'Collaborator', desc:'Log time & view', dotClass:'bg-muted' },
                  ].map((r, i) => {
                    const count = (users||[]).filter((u:any)=>u.permission_profile===r.key).length
                    const isSel = selectedRole===r.key
                    return (
                      <div
                        key={r.key}
                        onClick={() => { setSelectedRole(r.key); setRolePermSaved(false) }}
                        className={cn(
                          'px-3.5 py-2.5 cursor-pointer flex gap-2.5 items-center border-l-2',
                          i < 3 && 'border-b border-line-subtle',
                          isSel
                            ? 'bg-accent-dim border-l-accent'
                            : 'border-l-transparent hover:bg-surface-hover',
                        )}
                      >
                        <div className={cn('w-2 h-2 rounded-full flex-shrink-0', r.dotClass)} />
                        <div className="flex-1">
                          <div className={cn('text-base font-medium', isSel ? 'text-accent font-semibold' : 'text-primary')}>{r.label}</div>
                          <div className="text-[10px] text-muted">{r.desc} · {count} {count===1?'member':'members'}</div>
                        </div>
                      </div>
                    )
                  })}
                </Card>
                <div className="mt-2.5 text-xs text-muted px-1">
                  Changes apply to all {(users||[]).filter((u:any)=>u.permission_profile===selectedRole).length} members with this role.
                </div>
              </div>
              {/* Right: header + permissions */}
              <Card className="overflow-hidden p-0">
                {/* Header row inside the card */}
                <div className="px-5 py-3 flex justify-between items-center border-b border-line-subtle">
                  <div>
                    <div className="text-lg font-semibold text-primary capitalize">{selectedRole.replace(/_/g,' ')}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {(users||[]).filter((u:any)=>u.permission_profile===selectedRole).length} members with this role
                      {selectedRole==='super_admin' && <span className="text-status-amber ml-2">All permissions always on</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    {hasRoleEdits && (
                      <Button variant="secondary" size="sm" onClick={() => setRolePermEdits(prev => { const n = { ...prev }; delete n[selectedRole]; return n })}>
                        Discard
                      </Button>
                    )}
                    <Button variant="primary" size="sm" onClick={saveRolePerms} disabled={!hasRoleEdits || rolePermSaving || selectedRole==='super_admin'} loading={rolePermSaving}>
                      {rolePermSaving ? 'Saving...' : 'Apply to All'}
                    </Button>
                    {rolePermSaved && <span className="text-sm text-accent font-medium">Saved!</span>}
                  </div>
                </div>
                {/* Permission groups — all inside the same Card */}
                {PERMISSION_GROUPS.map(group => (
                  <div key={group.label}>
                    <div className="px-4 py-2 bg-surface-overlay/60 border-b border-line-muted border-t border-t-line-subtle text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
                      {group.label}
                    </div>
                    {group.keys.map((perm, pi) => {
                      const isOn = getRolePerm(perm)
                      const isEdited = perm in roleEdits
                      const isDisabled = selectedRole === 'super_admin'
                      return (
                        <div
                          key={perm}
                          onClick={() => !isDisabled && toggleRolePerm(perm)}
                          className={cn(
                            'flex items-center gap-4 px-4 py-3 transition-colors',
                            pi < group.keys.length - 1 && 'border-b border-line-subtle',
                            isEdited && 'bg-accent-dim/50',
                            !isDisabled && 'cursor-pointer hover:bg-surface-hover',
                          )}
                        >
                          <Toggle on={isOn} onChange={() => toggleRolePerm(perm)} disabled={isDisabled} />
                          <div className="flex items-center gap-2">
                            <span className={cn('text-base', isOn ? 'text-primary font-medium' : 'text-secondary')}>{PERMISSION_LABELS[perm]}</span>
                            {isEdited && <Badge variant="default" className="text-[9px] px-1.5 py-px text-accent bg-accent-dim border-transparent">CHANGED</Badge>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </Card>
            </div>
          ) : permMode === 'department' ? (
            /* ── BY DEPARTMENT ── */
            <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 items-start">
              <div className="sticky top-4">
                <Card className="overflow-hidden p-0">
                  {modeToggleRow}
                  {(depts||[]).map((d:any, i:number) => {
                    const isSel = selectedPermDept === d.id
                    const count = (users||[]).filter((u:any) => u.department_id === d.id).length
                    const isLast = i === (depts||[]).length - 1
                    return (
                      <div
                        key={d.id}
                        onClick={() => setSelectedPermDept(d.id)}
                        className={cn(
                          'px-3.5 py-2.5 cursor-pointer flex gap-2.5 items-center border-l-2',
                          !isLast && 'border-b border-line-subtle',
                          isSel
                            ? 'bg-accent-dim border-l-accent'
                            : 'border-l-transparent hover:bg-surface-hover',
                        )}
                      >
                        <div className="flex-1">
                          <div className={cn('text-base font-medium', isSel ? 'text-accent font-semibold' : 'text-primary')}>{d.name}</div>
                          <div className="text-[10px] text-muted">{count} {count===1?'member':'members'}</div>
                        </div>
                      </div>
                    )
                  })}
                </Card>
              </div>
              <div>
                {selectedPermDept ? (
                  <>
                    <Card className="overflow-hidden p-0">
                      {/* Header */}
                      <div className="px-5 py-3 flex justify-between items-center border-b border-line-subtle">
                        <div>
                          <div className="text-lg font-semibold text-primary">{(depts||[]).find((d:any)=>d.id===selectedPermDept)?.name || 'Department'}</div>
                          <div className="text-xs text-muted mt-0.5">
                            {deptUsers.length} members — changes apply to everyone in this department
                          </div>
                        </div>
                        <div className="flex gap-2 items-center">
                          {hasDeptEdits && (
                            <Button variant="secondary" size="sm" onClick={() => { const key = '__dept_' + selectedPermDept; setRolePermEdits(prev => { const n = { ...prev }; delete n[key]; return n }) }}>
                              Discard
                            </Button>
                          )}
                          <Button variant="primary" size="sm" onClick={saveDeptPerms} disabled={!hasDeptEdits || rolePermSaving} loading={rolePermSaving}>
                            {rolePermSaving ? 'Saving...' : `Apply to ${deptUsers.length} Members`}
                          </Button>
                          {rolePermSaved && <span className="text-sm text-accent font-medium">Saved!</span>}
                        </div>
                      </div>
                      {/* Permission groups */}
                      {PERMISSION_GROUPS.map(group => (
                      <div key={group.label}>
                        <div className="px-4 py-2 bg-surface-overlay/60 border-b border-line-muted border-t border-t-line-subtle text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
                          {group.label}
                        </div>
                        {group.keys.map((perm, pi) => {
                          const isOn = getDeptPerm(perm)
                          const isEdited = perm in deptPermEdits
                          return (
                            <div
                              key={perm}
                              onClick={() => toggleDeptPerm(perm)}
                              className={cn(
                                'flex items-center gap-4 px-4 py-3 transition-colors cursor-pointer hover:bg-surface-hover',
                                pi < group.keys.length - 1 && 'border-b border-line-subtle',
                                isEdited && 'bg-accent-dim/50',
                              )}
                            >
                              <Toggle on={isOn} onChange={() => toggleDeptPerm(perm)} />
                              <div className="flex items-center gap-2">
                                <span className={cn('text-base', isOn ? 'text-primary font-medium' : 'text-secondary')}>{PERMISSION_LABELS[perm]}</span>
                                {isEdited && <Badge variant="default" className="text-[9px] px-1.5 py-px text-accent bg-accent-dim border-transparent">CHANGED</Badge>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </Card>
                    {/* Members list below */}
                    <Card className="mt-4 overflow-hidden p-0">
                      <div className="px-4 py-2.5 bg-surface border-b border-line-subtle text-xs font-bold uppercase tracking-wider text-muted">
                        Members in this department ({deptUsers.length})
                      </div>
                      {deptUsers.map((u:any, i:number) => {
                        const profile = u.permission_profile || 'collaborator'
                        const isLast = i === deptUsers.length - 1
                        return (
                          <div
                            key={u.id}
                            className={cn(
                              'flex items-center gap-2.5 px-4 py-2',
                              !isLast && 'border-b border-line-subtle',
                            )}
                          >
                            <div className="w-[22px] h-[22px] rounded-full bg-surface-overlay border border-line-muted flex items-center justify-center text-[8px] font-bold text-secondary flex-shrink-0">
                              {u.name?.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-primary">{u.name}</span>
                              <span className="text-xs text-muted ml-2">{u.job_title || ''}</span>
                            </div>
                            <span className={cn('text-[10px] font-semibold capitalize', PROFILE_COLORS[profile])}>
                              {profile.replace(/_/g,' ')}
                            </span>
                          </div>
                        )
                      })}
                    </Card>
                  </>
                ) : (
                  <Card className="p-0">
                    <EmptyState title="Select a department to manage permissions" />
                  </Card>
                )}
              </div>
            </div>
          ) : (
            /* ── PER-USER PERMISSIONS ── */
            <div className={cn('grid gap-4 items-start', selectedUser ? 'grid-cols-[200px_minmax(0,1fr)]' : 'grid-cols-1')}>
              <div className="sticky top-4">
                <Card className="overflow-hidden p-0 max-h-[500px] overflow-y-auto">
                  {modeToggleRow}
                  {(users || []).map((u: any, i: number) => {
                    const profile   = u.permission_profile || 'collaborator'
                    const hasCustom = Object.keys(u.custom_permissions || {}).length > 0
                    const isSelected = selectedUserId === u.id
                    const isLast = i === (users?.length || 0) - 1
                    return (
                      <div
                        key={u.id}
                        onClick={() => openPermEditor(u)}
                        className={cn(
                          'px-3.5 py-2.5 cursor-pointer flex gap-2.5 items-center border-l-2',
                          !isLast && 'border-b border-line-subtle',
                          isSelected
                            ? 'bg-accent-dim border-l-accent'
                            : 'border-l-transparent hover:bg-surface-hover',
                        )}
                      >
                        <div className="w-6 h-6 rounded-full bg-surface-overlay border border-line-muted flex items-center justify-center text-[9px] font-bold text-secondary flex-shrink-0">
                          {u.name?.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={cn('text-base font-medium truncate', isSelected ? 'text-accent' : 'text-primary')}>{u.name}</div>
                          <div className="text-[10px] text-muted capitalize">{profile.replace('_', ' ')}</div>
                        </div>
                        {hasCustom && <div className="w-1.5 h-1.5 rounded-full bg-status-violet flex-shrink-0" />}
                      </div>
                    )
                  })}
                </Card>
              </div>
              {selectedUser ? (
                <Card className="overflow-hidden p-0">
                  <div className="px-5 py-3 flex justify-between items-center border-b border-line-subtle">
                    <div>
                      <div className="text-xl font-semibold text-primary mb-0.5">{selectedUser.name}</div>
                      <div className="text-sm text-muted">
                        <span className={cn('capitalize', PROFILE_COLORS[selectedUser.permission_profile])}>
                          {selectedUser.permission_profile?.replace('_',' ')}
                        </span>
                        <span className="mx-1.5">·</span><span>{selectedUser.email}</span>
                      </div>
                      {hasCustomPerms && (
                        <div className="mt-1.5 text-xs text-status-violet font-medium">
                          {overrideCount} custom override{overrideCount > 1 ? 's' : ''} active
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 items-center">
                      {hasCustomPerms && (
                        <Button variant="secondary" size="sm" onClick={() => setPendingOverrides({})}>
                          Reset to defaults
                        </Button>
                      )}
                      <Button variant="primary" onClick={() => savePerms.mutate({ id: selectedUser.id, overrides: pendingOverrides })} disabled={savePerms.isPending} loading={savePerms.isPending}>
                        {savePerms.isPending ? 'Saving...' : 'Save Permissions'}
                      </Button>
                      {savedMsg && <span className="text-sm text-accent font-medium">Saved!</span>}
                    </div>
                  </div>
                  {PERMISSION_GROUPS.map(group => (
                    <div key={group.label}>
                      <div className="px-4 py-2 bg-surface-overlay/60 border-b border-line-muted border-t border-t-line-subtle text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
                        {group.label}
                      </div>
                        {group.keys.map((perm, pi) => {
                          const current = selectedResolved?.[perm] ?? false
                          const isOverride = perm in pendingOverrides
                          const roleDefault = ROLE_DEFAULTS[selectedUser.permission_profile]?.[perm] ?? false
                          const isDisabled = !isSuperAdmin()
                          return (
                            <div
                              key={perm}
                              onClick={() => !isDisabled && togglePerm(perm)}
                              className={cn(
                                'flex items-center gap-4 px-4 py-3 transition-colors',
                                pi < group.keys.length - 1 && 'border-b border-line-subtle',
                                isOverride && 'bg-accent-dim/50',
                                !isDisabled && 'cursor-pointer hover:bg-surface-hover',
                              )}
                            >
                              <Toggle on={current} onChange={() => togglePerm(perm)} disabled={isDisabled} />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className={cn('text-base', current ? 'text-primary font-medium' : 'text-secondary')}>
                                    {PERMISSION_LABELS[perm]}
                                  </span>
                                  {isOverride && <Badge variant="violet" className="text-[10px] px-1.5 py-px">OVERRIDE</Badge>}
                                </div>
                                {isOverride && (
                                  <div className="text-xs text-muted mt-0.5">
                                    Default: {roleDefault ? 'On' : 'Off'}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setPendingOverrides(prev => { const n = { ...prev }; delete n[perm]; return n }) }}
                                      className="ml-2 bg-none border-none text-muted text-xs cursor-pointer font-body p-0 underline"
                                    >
                                      Revert
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  ))}
                </Card>
              ) : (
                <Card className="p-0">
                  <EmptyState title="Select a user to edit their permissions" />
                </Card>
              )}
            </div>
          )}
        </div>
        )
      })()}

      {/* ── ROLES ── */}
      {tab === 'roles' && (
        <div>
          <div className="grid grid-cols-2 gap-6">
            {/* Left: create new role */}
            <div>
              <div className="text-base font-semibold text-primary mb-3.5">Create a Role</div>
              <Card className="p-4 border-line-muted">
                <div className="mb-2.5">
                  <Label className="text-xs uppercase tracking-wider">Role Name</Label>
                  <Input
                    value={newRoleName}
                    onChange={e => setNewRoleName(e.target.value)}
                    placeholder="e.g. Senior Account Manager"
                    onKeyDown={e => e.key === 'Enter' && newRoleName.trim() && addCustomRole.mutate()}
                  />
                </div>
                <div className="mb-3.5">
                  <Label className="text-xs uppercase tracking-wider">Base Permission Level</Label>
                  <Select
                    aria-label="Base permission level"
                    value={newRoleBase}
                    onChange={e => setNewRoleBase(e.target.value)}
                  >
                    <option value="super_admin">Super Admin</option>
                    <option value="admin">Admin</option>
                    <option value="account_manager">Account Manager</option>
                    <option value="collaborator">Collaborator</option>
                  </Select>
                </div>
                <Button variant="primary" onClick={() => addCustomRole.mutate()} disabled={!newRoleName.trim() || addCustomRole.isPending} loading={addCustomRole.isPending}>
                  {addCustomRole.isPending ? 'Creating...' : <><Plus size={14} /> Create Role</>}
                </Button>
              </Card>
              <Card className="mt-4 px-3.5 py-3 bg-surface-overlay">
                <div className="text-xs font-bold text-muted uppercase tracking-wider mb-2">Built-in Roles</div>
                {[
                  { key: 'super_admin', label: 'Super Admin', desc: 'Full access to everything' },
                  { key: 'admin', label: 'Admin', desc: 'Manage team, projects, clients' },
                  { key: 'account_manager', label: 'Account Manager', desc: 'Projects & clients, no admin' },
                  { key: 'collaborator', label: 'Collaborator', desc: 'Log time & view projects' },
                ].map(r => (
                  <div key={r.key} className="flex items-center gap-2.5 py-1.5 border-b border-line-subtle last:border-b-0">
                    <div className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                    <div>
                      <div className="text-sm font-semibold text-primary">{r.label}</div>
                      <div className="text-xs text-muted">{r.desc}</div>
                    </div>
                  </div>
                ))}
              </Card>
            </div>

            {/* Right: custom roles list */}
            <div>
              <div className="text-base font-semibold text-primary mb-3.5">Custom Roles ({customRoles.length})</div>
              <Card className="overflow-hidden p-0">
                {customRoles.length === 0 && (
                  <EmptyState
                    icon={<Search />}
                    title="No custom roles yet"
                    description="Create a role on the left — it will appear in the Invite dropdown."
                  />
                )}
                {customRoles.map((role: any, i: number) => (
                  <div
                    key={role.id}
                    className={cn(
                      'flex items-center justify-between px-4 py-3',
                      i < customRoles.length - 1 && 'border-b border-line-subtle',
                    )}
                  >
                    <div>
                      <div className="text-base font-semibold text-primary">{role.name}</div>
                      <div className="text-xs text-muted mt-0.5">
                        Base: <span className="text-accent font-medium">{role.base_role.replace('_', ' ')}</span>
                      </div>
                    </div>
                    <button
                      aria-label={`Delete role ${role.name}`}
                      onClick={() => showConfirm('Delete role "' + role.name + '"?', () => deleteCustomRole.mutate(role.id), { confirmLabel: 'Delete', subtext: 'Users with this role will keep their base permission level.' })}
                      className="bg-none border-none text-muted hover:text-status-rose hover:bg-status-rose-dim cursor-pointer p-1 rounded"
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* ── BASE RATE CARD (per-person internal cost) ── */}
      {tab === 'base_rates' && isSuperAdmin() && (
        <div>
          <Card className="overflow-hidden p-0">
            <div className="grid grid-cols-[1.6fr_1fr_1fr_100px_160px] px-4 py-2 bg-surface border-b border-line-subtle">
              {['Person', 'Department', 'Job Title', 'Capacity', 'Internal Cost (AED/hr)'].map(h => (
                <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
              ))}
            </div>
            {(users || [])
              .slice()
              .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')))
              .map((u: any, i: number, arr: any[]) => {
                const isLast = i === arr.length - 1
                const deptName = (depts as any[])?.find((d: any) => d.id === u.department_id)?.name || '—'
                return (
                  <div
                    key={u.id}
                    className={cn(
                      'grid grid-cols-[1.6fr_1fr_1fr_100px_160px] px-4 py-1.5 items-center',
                      !isLast && 'border-b border-line-subtle',
                    )}
                  >
                    <div className="text-sm text-primary truncate">
                      {u.name}
                      <span className="text-xs text-muted ml-2">{u.email}</span>
                    </div>
                    <div className="text-sm text-secondary truncate">{deptName}</div>
                    <div className="text-sm text-secondary truncate">{u.job_title || '—'}</div>
                    <div className="text-sm text-secondary tabular-nums">
                      {u.capacity_hrs ?? 40} <span className="text-muted text-xs">hrs/wk</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        defaultValue={Number(u.internal_hourly_cost ?? 0)}
                        className="w-24 text-right text-sm py-1"
                        onBlur={e => {
                          const r = Number(e.target.value)
                          if (r !== Number(u.internal_hourly_cost ?? 0)) {
                            updateUser.mutate({ id: u.id, data: { internal_hourly_cost: r } })
                          }
                        }}
                      />
                      <span className="text-sm text-muted">/hr</span>
                    </div>
                  </div>
                )
              })}
            {!users?.length && <EmptyState title="No users yet" />}
          </Card>
        </div>
      )}

      {/* ── RATE CARDS ── */}
      {tab === 'rate_cards' && (
        <div>
          {showNewRc && (
            <Card className="px-4 py-4 mb-4 border-line-muted">
              <div className="text-base font-semibold text-primary mb-3">Create Rate Card</div>
              <div className="grid grid-cols-[1fr_160px] gap-2.5 mb-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider">Rate Card Name *</Label>
                  <Input
                    autoFocus
                    value={newRcForm.name}
                    onChange={e => setNewRcForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Standard AED Rates"
                    onKeyDown={e => e.key === 'Enter' && newRcForm.name && createRateCard.mutate(newRcForm)}
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider">Currency</Label>
                  <Select
                    aria-label="Currency"
                    value={newRcForm.currency}
                    onChange={e => setNewRcForm(f => ({ ...f, currency: e.target.value }))}
                  >
                    <option value="AED">AED</option><option value="USD">USD</option><option value="GBP">GBP</option><option value="EUR">EUR</option>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => createRateCard.mutate(newRcForm)} disabled={!newRcForm.name || createRateCard.isPending} loading={createRateCard.isPending}>
                  {createRateCard.isPending ? 'Creating...' : 'Create Rate Card'}
                </Button>
                <Button variant="secondary" onClick={() => { setShowNewRc(false); setNewRcForm({ name: '', currency: 'AED' }) }}>Cancel</Button>
                {createRateCard.isError && <span role="alert" className="text-sm text-status-rose self-center">Failed — check console</span>}
              </div>
            </Card>
          )}
          <Card className="p-0 relative overflow-hidden">
            <div className="px-4 py-2.5 bg-surface border-b border-line-subtle flex items-center justify-between sticky top-0 z-sticky">
              <div className="text-xs font-bold uppercase tracking-wider text-muted">
                {(rateCards || []).length} rate card{(rateCards || []).length === 1 ? '' : 's'}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setShowNewRc(s => !s)}>
                {showNewRc ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Rate Card</>}
              </Button>
            </div>
          {(rateCards || []).map((rc: any, rcIdx: number, rcArr: any[]) => (
            <div key={rc.id} className={cn('overflow-hidden', rcIdx < rcArr.length - 1 && 'border-b-4 border-line-subtle')}>
              <div className="px-4 py-3 bg-surface-overlay border-b border-line-subtle flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                  <input
                    defaultValue={rc.name}
                    className="text-lg font-semibold text-primary bg-transparent border border-transparent rounded-sm px-1.5 py-0.5 font-body outline-none cursor-text max-w-[220px] focus:border-accent focus-visible:ring-2 focus-visible:ring-accent-dim"
                    onBlur={e => {
                      const v = (e.target as HTMLInputElement).value.trim()
                      if (v && v !== rc.name) api.patch('/users/rate-cards/' + rc.id, { name: v }).then(() => qc.invalidateQueries({ queryKey: ['rate-cards'] }))
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  />
                  <span className="text-xs text-muted font-semibold">{rc.currency}</span>
                  {rc.is_default && (
                    <Badge variant="default" className="text-[10px] px-1.5 py-px text-accent bg-accent-dim border-transparent">DEFAULT</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-sm text-muted">{rc.rate_card_entries?.length || 0} job titles</span>
                  <button
                    aria-label={`Delete rate card ${rc.name}`}
                    onClick={() => showConfirm(`Delete rate card "${rc.name}"?`, async () => { await api.delete('/users/rate-cards/' + rc.id); qc.invalidateQueries({ queryKey: ['rate-cards'] }) }, { confirmLabel: 'Delete', subtext: 'All rate entries in this card will be permanently removed.' })}
                    className="bg-none border-none text-muted hover:text-status-rose hover:bg-status-rose-dim cursor-pointer p-1 rounded-sm"
                  >
                    <XCircle size={14} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_140px] px-4 py-2 bg-surface border-b border-line-subtle">
                {['Team / Department', `Rate (${rc.currency}/hr)`].map(h => (
                  <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
                ))}
              </div>
              {(rc.rate_card_entries || []).map((entry: any, i: number) => {
                const isLast = i === (rc.rate_card_entries?.length || 0) - 1
                // Look up department name from loaded departments (falls back to legacy job_title)
                const deptName = entry.department_id
                  ? (depts as any[])?.find((d: any) => d.id === entry.department_id)?.name || '(unknown dept)'
                  : (entry.job_title || '—')
                const label = entry.department_id ? deptName : `${deptName} (legacy job title)`
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      'grid grid-cols-[1fr_140px_36px] px-4 py-2 items-center',
                      !isLast && 'border-b border-line-subtle',
                    )}
                  >
                    <div className="text-base text-primary">{label}</div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        defaultValue={entry.hourly_rate}
                        className="w-20 text-right text-sm py-1"
                        onBlur={e => {
                          const r = Number(e.target.value)
                          if (r !== Number(entry.hourly_rate)) usersApi.updateRateEntry(rc.id, entry.id, { hourly_rate: r }).then(() => qc.invalidateQueries({ queryKey: ['rate-cards'] }))
                        }}
                      />
                      <span className="text-sm text-muted">/hr</span>
                    </div>
                    <button
                      aria-label={`Remove ${label}`}
                      onClick={() => showConfirm(`Remove ${label}?`, () => usersApi.deleteRateEntry(rc.id, entry.id).then(() => qc.invalidateQueries({ queryKey: ['rate-cards'] })), { confirmLabel: 'Remove' })}
                      className="bg-none border-none text-muted hover:text-status-rose cursor-pointer p-0 leading-none"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
              {/* Inline add entry row */}
              <AddRateEntryRow
                rcId={rc.id}
                currency={rc.currency}
                departments={depts || []}
                existingDeptIds={new Set((rc.rate_card_entries || []).map((e: any) => e.department_id).filter(Boolean))}
                onAdded={() => qc.invalidateQueries({ queryKey: ['rate-cards'] })}
              />
            </div>
          ))}
          {!rateCards?.length && (
            <div className="px-4 py-6">
              <EmptyState title="No rate cards yet — create one above." />
            </div>
          )}
          </Card>
        </div>
      )}

      {/* ── DEPARTMENTS ── */}
      {tab === 'departments' && (
        <div>
          <div className="flex gap-2 items-center mb-3.5">
            <Input
              value={deptName}
              onChange={e => setDeptName(e.target.value)}
              placeholder="New department name"
              className="w-60 h-7 text-sm py-1 px-2.5"
              onKeyDown={e => e.key === 'Enter' && deptName && addDept.mutate()}
            />
            <Button variant="secondary" size="sm" onClick={() => addDept.mutate()} disabled={!deptName}><Plus size={14} /> Add</Button>
          </div>
          <Card className="overflow-hidden p-0">
            <div className="grid grid-cols-[1.4fr_80px_140px_140px_44px] px-5 py-2.5 bg-surface border-b border-line-subtle gap-3">
              {['Department', 'Members', 'Resource Target %', 'Billable Target %', ''].map(h => (
                <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
              ))}
            </div>
            {(depts || []).map((d: any, i: number) => {
              const memberCount = (users || []).filter((u: any) => u.department_id === d.id).length
              const wsResource  = workspaceData?.resource_utilization_pct ?? 100
              const wsBillable  = workspaceData?.billable_utilization_pct ?? 60
              const isLast = i === (depts?.length || 0) - 1
              return (
                <div
                  key={d.id}
                  className={cn(
                    'grid grid-cols-[1.4fr_80px_140px_140px_44px] px-5 py-3 items-center gap-3',
                    !isLast && 'border-b border-line-subtle',
                  )}
                >
                  <div className="text-base font-medium text-primary">{d.name}</div>
                  <div className="text-sm text-muted">{memberCount} member{memberCount !== 1 ? 's' : ''}</div>

                  {/* Resource utilisation target */}
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number" min={0} max={100} step={5}
                      value={d.resource_utilization_pct ?? ''}
                      placeholder={`${wsResource} (default)`}
                      className="w-20 text-center text-sm py-1"
                      onBlur={e => {
                        const val = e.target.value === '' ? null : Number(e.target.value)
                        api.patch(`/users/departments/${d.id}`, { resource_utilization_pct: val })
                          .then(() => qc.invalidateQueries({ queryKey: ['departments'] }))
                          .catch((err: any) => console.warn('Dept resource target update failed:', err?.message))
                      }}
                      onChange={() => { /* controlled-ish; actual save on blur */ }}
                    />
                    <span className="text-xs text-muted">%</span>
                    {d.resource_utilization_pct !== null && d.resource_utilization_pct !== undefined && (
                      <button
                        aria-label="Reset resource utilization to workspace default"
                        onClick={() => api.patch(`/users/departments/${d.id}`, { resource_utilization_pct: null }).then(() => qc.invalidateQueries({ queryKey: ['departments'] })).catch((e: any) => showToast.error('Failed to reset: ' + (e?.message || 'error')))}
                        title="Reset to workspace default"
                        className="bg-none border-none cursor-pointer text-muted hover:text-status-rose p-0 leading-none"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* Billable utilisation target */}
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number" min={0} max={100} step={5}
                      value={d.billable_utilization_pct ?? ''}
                      placeholder={`${wsBillable} (default)`}
                      className="w-20 text-center text-sm py-1"
                      onBlur={e => {
                        const val = e.target.value === '' ? null : Number(e.target.value)
                        api.patch(`/users/departments/${d.id}`, { billable_utilization_pct: val })
                          .then(() => qc.invalidateQueries({ queryKey: ['departments'] }))
                          .catch((err: any) => console.warn('Dept billable target update failed:', err?.message))
                      }}
                      onChange={() => { /* controlled-ish; actual save on blur */ }}
                    />
                    <span className="text-xs text-muted">%</span>
                    {d.billable_utilization_pct !== null && d.billable_utilization_pct !== undefined && (
                      <button
                        aria-label="Reset billable utilization to workspace default"
                        onClick={() => api.patch(`/users/departments/${d.id}`, { billable_utilization_pct: null }).then(() => qc.invalidateQueries({ queryKey: ['departments'] })).catch((e: any) => showToast.error('Failed to reset: ' + (e?.message || 'error')))}
                        title="Reset to workspace default"
                        className="bg-none border-none cursor-pointer text-muted hover:text-status-rose p-0 leading-none"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {/* Delete dept */}
                  <div className="flex items-center">
                    <button
                      aria-label={`Delete department ${d.name}`}
                      onClick={() => showConfirm('Delete department ' + d.name + '?', () => deleteDept.mutate(d.id), { confirmLabel: 'Delete', subtext: 'Members will remain but lose their department assignment.' })}
                      title="Delete department"
                      className="bg-none border border-transparent rounded-sm px-1.5 py-1 cursor-pointer text-muted hover:text-status-rose hover:border-[rgba(244,63,94,0.4)] hover:bg-status-rose-dim leading-none"
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
            {(!depts || depts.length === 0) && <div className="p-5 text-base text-muted">No departments.</div>}
          </Card>
        </div>
      )}

      {/* ── CLIENTS ── */}
      {tab === 'clients' && (() => {
        // Logo file picker handler — shared between create and edit
        async function handleLogoUpload(file: File, target: 'create' | 'edit') {
          if (!file.type.startsWith('image/')) { showToast.error('Please select an image file'); return }
          if (file.size > 5 * 1024 * 1024) { showToast.error('Image must be under 5 MB'); return }
          setUploadingLogo(true)
          try {
            const url = await uploadFile(file, 'clients')
            if (target === 'create') setClientForm(f => ({ ...f, logo_url: url }))
            else if (editingClient) setEditingClient((c: any) => ({ ...c, logo_url: url }))
          } catch (e: any) { showToast.error('Upload failed: ' + (e?.message || 'error')) }
          finally { setUploadingLogo(false) }
        }

        // Shared logo widget
        function LogoWidget({ logoUrl, name, target }: { logoUrl?: string; name?: string; target: 'create' | 'edit' }) {
          const fileRef = useRef<HTMLInputElement>(null)
          return (
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div
                onClick={() => fileRef.current?.click()}
                className="w-16 h-16 rounded-xl bg-surface-overlay border-2 border-dashed border-line-muted hover:border-accent flex items-center justify-center overflow-hidden cursor-pointer transition-colors group relative"
              >
                {logoUrl ? (
                  <>
                    <img src={logoUrl} alt={`${name || 'Client'} logo`} width={64} height={64} loading="lazy" decoding="async" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera size={16} className="text-white" />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-0.5 text-muted group-hover:text-accent transition-colors">
                    <Upload size={16} />
                    <span className="text-[8px] font-bold uppercase">Upload</span>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f, target); e.target.value = '' }} />
              {uploadingLogo && <span className="text-[9px] text-accent">Uploading...</span>}
            </div>
          )
        }

        return (
        <div>
          {/* ── Merge Clients dialog ── */}
          {mergingClient && (
            <div
              className="fixed inset-0 bg-black/40 flex items-center justify-center z-modal"
              onClick={() => !mergeSubmitting && setMergingClient(null)}
            >
              <Card className="p-4 w-[460px] max-w-[90vw]" onClick={(e: any) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-2">
                  <GitMerge size={16} className="text-accent" />
                  <div className="text-lg font-semibold text-primary">Merge Client</div>
                </div>
                <div className="text-sm text-secondary mb-1">
                  Merging <b>{mergingClient.name}</b> into another client.
                </div>
                <div className="text-xs text-muted mb-3">
                  All projects + invoices for <b>{mergingClient.name}</b> will be re-pointed to the target, then this
                  client will be soft-deleted. This cannot be undone.
                </div>
                <Label className="text-xs uppercase tracking-wider">Merge into</Label>
                <Select value={mergeTargetId} onChange={e => setMergeTargetId(e.target.value)} autoFocus>
                  <option value="">Select target client...</option>
                  {(clients || [])
                    .filter((c: any) => c.id !== mergingClient.id && c.active !== false)
                    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
                    .map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </Select>
                <div className="flex gap-2 mt-3 justify-end">
                  <Button variant="secondary" onClick={() => setMergingClient(null)} disabled={mergeSubmitting}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!mergeTargetId || mergeSubmitting}
                    loading={mergeSubmitting}
                    onClick={async () => {
                      if (!mergeTargetId) return
                      setMergeSubmitting(true)
                      try {
                        const res: any = await usersApi.mergeClient(mergingClient.id, mergeTargetId)
                        showToast.success(`Merged: ${res.projectsMoved} projects + ${res.invoicesMoved} invoices moved`)
                        qc.invalidateQueries({ queryKey: ['clients'] })
                        qc.invalidateQueries({ queryKey: ['client-profitability'] })
                        setMergingClient(null)
                      } catch (e: any) {
                        showToast.error('Merge failed: ' + (e?.message || 'error'))
                      } finally {
                        setMergeSubmitting(false)
                      }
                    }}
                  >
                    {mergeSubmitting ? 'Merging...' : 'Merge'}
                  </Button>
                </div>
              </Card>
            </div>
          )}


          {/* ── Create form ── */}
          {showClient && (
            <Card className="px-4 py-3.5 mb-3 border-line-muted">
              <div className="flex gap-4 mb-3">
                <LogoWidget logoUrl={clientForm.logo_url} name={clientForm.name} target="create" />
                <div className="flex-1 grid grid-cols-2 gap-2.5">
                  <div className="col-span-2">
                    <Label className="text-xs uppercase tracking-wider">Company Name *</Label>
                    <Input placeholder="Align Technology LLC" value={clientForm.name} onChange={e => setClientForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    {/* Parent Client — optional. Only top-level clients (no parent of
                        their own) are offered, matching the one-level-deep rule in
                        the backend. Use — None — for top-level clients like Nexa
                        Cognition itself. */}
                    <Label className="text-xs uppercase tracking-wider">Parent Client (optional)</Label>
                    <Select
                      aria-label="Parent client"
                      value={clientForm.parent_client_id}
                      onChange={e => setClientForm(f => ({ ...f, parent_client_id: e.target.value }))}
                    >
                      <option value="">— None (top-level client) —</option>
                      {(clients || [])
                        .filter((c: any) => c.active !== false && !c.parent_client_id)
                        .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
                        .map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider">Country</Label>
                    <Input placeholder="UAE" value={clientForm.country} onChange={e => setClientForm(f => ({ ...f, country: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider">Address</Label>
                    <Input placeholder="Dubai, UAE" value={clientForm.address} onChange={e => setClientForm(f => ({ ...f, address: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => addClient.mutate()} disabled={!clientForm.name || uploadingLogo} loading={addClient.isPending}>
                  {addClient.isPending ? 'Adding...' : 'Add Client'}
                </Button>
                <Button variant="secondary" onClick={() => { setShowClient(false); setClientForm({ name:'',country:'',address:'',logo_url:'',parent_client_id:'' }) }}>Cancel</Button>
              </div>
            </Card>
          )}

          {/* ── Edit form (inline, replaces the row) ── */}
          {editingClient && (
            <Card className="px-4 py-3.5 mb-3 border-accent bg-accent-dim/20">
              <div className="flex gap-4 mb-3">
                <LogoWidget logoUrl={editingClient.logo_url} name={editingClient.name} target="edit" />
                <div className="flex-1 grid grid-cols-2 gap-2.5">
                  <div>
                    <Label className="text-xs uppercase tracking-wider">Company Name *</Label>
                    <Input value={editingClient.name} onChange={e => setEditingClient((c: any) => ({ ...c, name: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider">Client ID</Label>
                    <Input value={editingClient.client_code || ''} disabled className="opacity-60" />
                  </div>
                  <div className="col-span-2">
                    {/* Parent Client editor. Edge cases:
                        - If THIS client has any sub-clients already, it can't be made
                          into a sub-client itself (enforced backend-side too). We
                          disable the dropdown and show a hint rather than letting the
                          user try + get a toast error.
                        - The current parent is excluded from the "change parent"
                          list because you can't re-parent to yourself (handled by
                          .filter on c.id !== editingClient.id as well). */}
                    <Label className="text-xs uppercase tracking-wider">Parent Client (optional)</Label>
                    {(() => {
                      const hasChildren = Array.isArray(editingClient.children) && editingClient.children.length > 0
                      return (
                        <>
                          <Select
                            aria-label="Parent client"
                            disabled={hasChildren}
                            value={editingClient.parent_client_id || ''}
                            onChange={e => setEditingClient((c: any) => ({ ...c, parent_client_id: e.target.value }))}
                          >
                            <option value="">— None (top-level client) —</option>
                            {(clients || [])
                              .filter((c: any) => c.active !== false && c.id !== editingClient.id && !c.parent_client_id)
                              .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
                              .map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                          </Select>
                          {hasChildren && (
                            <div className="text-[11px] text-muted mt-1">
                              This client has {editingClient.children.length} sub-client{editingClient.children.length === 1 ? '' : 's'}. Re-parent or remove them before nesting this client under another.
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider">Country</Label>
                    <Input value={editingClient.country || ''} onChange={e => setEditingClient((c: any) => ({ ...c, country: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider">Address</Label>
                    <Input value={editingClient.address || ''} onChange={e => setEditingClient((c: any) => ({ ...c, address: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={async () => {
                  try {
                    await usersApi.updateClient(editingClient.id, {
                      name: editingClient.name, country: editingClient.country,
                      address: editingClient.address, logo_url: editingClient.logo_url,
                      parent_client_id: editingClient.parent_client_id || null,
                    })
                    qc.invalidateQueries({ queryKey: ['clients'] })
                    setEditingClient(null)
                    showToast.success('Client updated')
                  } catch (e: any) { showToast.error('Failed: ' + (e?.message || 'error')) }
                }} disabled={!editingClient.name || uploadingLogo}>
                  Save Changes
                </Button>
                <Button variant="secondary" onClick={() => setEditingClient(null)}>Cancel</Button>
              </div>
            </Card>
          )}

          {/* ── Active clients table ── */}
          <Card className="p-0 relative">
            <div className="grid grid-cols-[60px_1fr_100px_120px_180px_60px] data-row-head sticky top-0 z-sticky px-5 py-2.5 items-center bg-surface border-b border-line-subtle rounded-t-lg">
              {['ID', 'Client', 'Country', 'Address', 'Rate Card (Partner)', ''].map(h => (
                <div key={h} className="text-xs font-semibold uppercase tracking-wider text-muted">{h}</div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowClient(s => !s)}
              className="absolute top-1.5 right-3 z-sticky"
            >
              {showClient ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Client</>}
            </Button>
            {(() => {
              // Sort so sub-clients always render directly below their parent — otherwise
              // "Nexa Cognition" and "Redwood" get scattered by alphabetical order and the
              // └ connector loses its visual meaning. We keep top-level clients in their
              // existing name order (server already sorts by name) and splice each parent's
              // children immediately after it, also sorted by name.
              const active = (clients || []).filter((c: any) => c.active !== false)
              const parents = active.filter((c: any) => !c.parent_client_id)
              const childrenByParent: Record<string, any[]> = {}
              for (const c of active) {
                if (c.parent_client_id) {
                  (childrenByParent[c.parent_client_id] = childrenByParent[c.parent_client_id] || []).push(c)
                }
              }
              for (const k of Object.keys(childrenByParent)) {
                childrenByParent[k].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
              }
              const ordered: any[] = []
              for (const p of parents) {
                ordered.push(p)
                if (childrenByParent[p.id]) ordered.push(...childrenByParent[p.id])
              }
              // Orphaned sub-clients (parent missing/soft-deleted) — render at the end
              // so they're not invisible. Shouldn't normally happen because the merge
              // endpoint re-points children, but defending against it keeps the UI
              // trustworthy if a row gets orphaned another way.
              const shownIds = new Set(ordered.map((c: any) => c.id))
              const orphans = active.filter((c: any) => !shownIds.has(c.id))
              ordered.push(...orphans)
              return ordered
            })().map((c: any, i: number, arr: any[]) => {
              const isLast = i === arr.length - 1
              const isEditing = editingClient?.id === c.id
              return (
                <div
                  key={c.id}
                  className={cn(
                    'grid grid-cols-[60px_1fr_100px_120px_180px_60px] data-row px-5 py-2.5 items-center',
                    !isLast && 'border-b border-line-subtle',
                    isEditing && 'bg-accent-dim/10',
                  )}
                >
                  <div className="text-[11px] font-mono text-muted">{c.client_code || '—'}</div>
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Indent children one step to make the hierarchy scannable.
                        Uses a left margin + thin connector line so the structure
                        reads at a glance without needing a dedicated column. */}
                    {c.parent_client_id && (
                      <div className="flex-shrink-0 w-3 text-muted" aria-hidden="true">└</div>
                    )}
                    <div className="w-8 h-8 rounded-md bg-surface-overlay border border-line-muted flex-shrink-0 flex items-center justify-center overflow-hidden">
                      {c.logo_url ? (
                        <img src={c.logo_url} alt={`${c.name} logo`} width={32} height={32} loading="lazy" decoding="async" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      ) : (
                        <span className="text-sm font-bold text-muted">{c.name?.[0]?.toUpperCase() || '?'}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-medium text-primary truncate">{c.name}</div>
                      {/* Hierarchy hints — parent name if this is a sub-client,
                          sub-client count if this is a parent. Kept on one line
                          and never shown both (a sub-client can't itself have
                          children in the phase-1 single-level model). */}
                      {c.parent?.name ? (
                        <div className="text-[11px] text-muted truncate">under {c.parent.name}</div>
                      ) : (c.children?.length ?? 0) > 0 ? (
                        <div className="text-[11px] text-accent">{c.children.length} sub-client{c.children.length === 1 ? '' : 's'}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-sm text-secondary">{c.country || '—'}</div>
                  <div className="text-sm text-secondary truncate">{c.address || '—'}</div>
                  <Select
                    size="sm"
                    aria-label={`Rate card for ${c.name}`}
                    value={c.default_rate_card_id || ''}
                    onChange={async e => {
                      const v = e.target.value || null
                      try {
                        await usersApi.updateClient(c.id, { default_rate_card_id: v })
                        qc.invalidateQueries({ queryKey: ['clients'] })
                      } catch (err: any) {
                        showToast.error('Failed: ' + (err?.message || 'error'))
                      }
                    }}
                    className="text-sm py-1"
                  >
                    <option value="">— None —</option>
                    {(rateCards || []).map((rc: any) => (
                      <option key={rc.id} value={rc.id}>{rc.name} ({rc.currency})</option>
                    ))}
                  </Select>
                  <div className="flex gap-1">
                    <button
                      aria-label={`Edit ${c.name}`}
                      onClick={() => setEditingClient({ ...c })}
                      title="Edit client"
                      className="text-muted hover:text-accent hover:bg-accent-dim bg-none border-none rounded-sm p-1 cursor-pointer leading-none"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      aria-label={`Merge ${c.name}`}
                      onClick={() => { setMergingClient(c); setMergeTargetId('') }}
                      title="Merge this client into another"
                      className="text-muted hover:text-accent hover:bg-accent-dim bg-none border-none rounded-sm p-1 cursor-pointer leading-none"
                    >
                      <GitMerge size={13} />
                    </button>
                    <button
                      aria-label={`Deactivate ${c.name}`}
                      onClick={() => showConfirm('Deactivate ' + c.name + '?', () => deactivateClient.mutate(c.id), { confirmLabel: 'Deactivate', subtext: 'Client will be hidden from project creation.' })}
                      title="Deactivate client"
                      className="text-muted hover:text-status-rose hover:bg-status-rose-dim bg-none border-none rounded-sm p-1 cursor-pointer leading-none"
                    >
                      <Ban size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
            {(clients || []).filter((c: any) => c.active !== false).length === 0 && (
              <div className="p-5 text-base text-muted">No active clients.</div>
            )}
          </Card>

          {/* ── Deactivated clients ── */}
          {(clients || []).filter((c: any) => c.active === false).length > 0 && (
            <Card className="p-0 mt-3 opacity-70">
              <div className="grid grid-cols-[60px_1fr_100px_120px_180px_60px] data-row-head sticky top-0 z-sticky px-5 py-2.5 items-center bg-surface border-b border-line-subtle rounded-t-lg">
                {['ID', 'Deactivated', 'Country', 'Address', 'Rate Card', ''].map(h => (
                  <div key={h} className="text-xs font-semibold uppercase tracking-wider text-muted">{h}</div>
                ))}
              </div>
              {(clients || []).filter((c: any) => c.active === false).map((c: any, i: number, arr: any[]) => {
                const isLast = i === arr.length - 1
                return (
                  <div key={c.id} className={cn('grid grid-cols-[60px_1fr_100px_120px_180px_60px] data-row px-5 py-2.5 items-center', !isLast && 'border-b border-line-subtle')}>
                    <div className="text-[11px] font-mono text-muted">{c.client_code || '—'}</div>
                    <div className="flex items-center gap-2.5 opacity-50">
                      <div className="w-8 h-8 rounded-md bg-surface-overlay border border-line-muted flex-shrink-0 flex items-center justify-center overflow-hidden">
                        {c.logo_url ? (
                          <img src={c.logo_url} alt={`${c.name} logo`} width={32} height={32} loading="lazy" decoding="async" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        ) : (
                          <span className="text-sm font-bold text-muted">{c.name?.[0]?.toUpperCase() || '?'}</span>
                        )}
                      </div>
                      <span className="text-base text-muted line-through truncate">{c.name}</span>
                    </div>
                    <div className="text-sm text-muted">{c.country || '—'}</div>
                    <div className="text-sm text-muted truncate">{c.address || '—'}</div>
                    <div className="text-xs text-muted truncate">
                      {(rateCards || []).find((rc: any) => rc.id === c.default_rate_card_id)?.name || '—'}
                    </div>
                    <div>
                      <button aria-label={`Reactivate ${c.name}`} onClick={() => activateClient.mutate(c.id)} title="Reactivate" className="text-accent hover:bg-accent-dim bg-none border-none rounded-sm p-1 cursor-pointer leading-none">
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </Card>
          )}
        </div>
        )
      })()}

      {/* ── LABELS ── */}
      {tab === 'labels' && (
        <div>
          <div className="flex gap-2 items-center mb-3.5">
            <Input
              value={labelForm.name}
              onChange={e => setLabelForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Label name"
              className="w-[200px] h-7 text-sm py-1 px-2.5"
              onKeyDown={e => e.key === 'Enter' && labelForm.name && addLabel.mutate()}
            />
            <input
              type="color"
              value={labelForm.color}
              onChange={e => setLabelForm(f => ({ ...f, color: e.target.value }))}
              className="w-7 h-7 rounded-sm border border-line-muted cursor-pointer p-0.5"
            />
            <Button variant="secondary" size="sm" onClick={() => addLabel.mutate()} disabled={!labelForm.name}><Plus size={14} /> Add</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(labels || []).map((l: any) => (
              <div
                key={l.id}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 border"
                style={{ background: `${l.color}18`, borderColor: `${l.color}44` }}
              >
                <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
                <span className="text-base font-semibold" style={{ color: l.color }}>{l.name}</span>
              </div>
            ))}
            {(!labels || labels.length === 0) && <div className="text-base text-muted">No labels.</div>}
          </div>
        </div>
      )}

      {/* ── TIME CATEGORIES ── */}
      {tab === 'time_categories' && (
        <TimeCategoriesTab categoriesRaw={categoriesRaw} qc={qc} />
      )}

      {/* ── HOLIDAYS ── */}
      {tab === 'holidays' && <HolidayCalendarsTab qc={qc} />}

      {tab === 'templates' && <TemplatesPanel />}

      {/* ── WORKSPACE SETTINGS ── */}
      {tab === 'settings' && isSuperAdmin() && wsForm && (
        <div>
          <div className="grid grid-cols-2 gap-4">
            <Card className="overflow-hidden p-0">
              <div className="px-4 py-3 bg-surface border-b border-line-subtle text-sm font-bold uppercase tracking-wider text-muted">General</div>
              <div className="p-4">
                <div className="mb-3.5">
                  <Label className="text-xs uppercase tracking-wider">Workspace Name</Label>
                  <Input
                    value={wsForm.name}
                    onChange={e => setWsForm((f: any) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider">Default Currency</Label>
                  <Select
                    aria-label="Default currency"
                    value={wsForm.default_currency}
                    onChange={e => setWsForm((f: any) => ({ ...f, default_currency: e.target.value }))}
                  >
                    <option value="AED">AED — UAE Dirham</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="GBP">GBP — British Pound</option>
                    <option value="EUR">EUR — Euro</option>
                  </Select>
                </div>
              </div>
            </Card>
            <Card className="overflow-hidden p-0">
              <div className="px-4 py-3 bg-surface border-b border-line-subtle text-sm font-bold uppercase tracking-wider text-muted">Utilisation Targets</div>
              <div className="p-4">
                <div className="mb-4">
                  <div className="flex justify-between mb-2">
                    <label className="text-base text-primary">Resource Utilisation</label>
                    <span className="text-lg font-semibold text-accent">{wsForm.resource_utilization_pct}%</span>
                  </div>
                  <input
                    type="range" min="50" max="100" step="5"
                    value={wsForm.resource_utilization_pct}
                    onChange={e => setWsForm((f: any) => ({ ...f, resource_utilization_pct: Number(e.target.value) }))}
                    className="w-full accent-accent"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-base text-primary">Billable Utilisation</label>
                    <span className="text-lg font-semibold text-status-violet">{wsForm.billable_utilization_pct}%</span>
                  </div>
                  <input
                    type="range" min="40" max="100" step="5"
                    value={wsForm.billable_utilization_pct}
                    onChange={e => setWsForm((f: any) => ({ ...f, billable_utilization_pct: Number(e.target.value) }))}
                    className="w-full accent-status-violet"
                  />
                </div>
              </div>
            </Card>
            {/* ── Per-department utilisation overrides ── */}
            <Card className="overflow-hidden p-0 col-span-full">
              <div className="px-4 py-3 bg-surface border-b border-line-subtle flex justify-between items-center">
                <span className="text-sm font-bold uppercase tracking-wider text-muted">Utilisation Targets — By Department</span>
                <span className="text-xs text-muted">Leave blank to inherit workspace defaults above · click away to save</span>
              </div>
              <div className="grid grid-cols-[1.4fr_80px_140px_140px] px-4 py-2 bg-surface border-b border-line-subtle gap-3">
                {['Department', 'Members', 'Resource %', 'Billable %'].map(h => (
                  <div key={h} className="text-[10px] font-bold uppercase tracking-wider text-muted">{h}</div>
                ))}
              </div>
              {(depts || []).map((d: any, i: number) => {
                const memberCount = (users || []).filter((u: any) => u.department_id === d.id).length
                const isLast = i === (depts?.length || 0) - 1
                return (
                  <div
                    key={d.id}
                    className={cn(
                      'grid grid-cols-[1.4fr_80px_140px_140px] px-4 py-2.5 items-center gap-3',
                      !isLast && 'border-b border-line-subtle',
                    )}
                  >
                    <div className="text-base font-medium text-primary">{d.name}</div>
                    <div className="text-sm text-muted">{memberCount}m</div>
                    {/* Resource target */}
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" min={0} max={100} step={5}
                        defaultValue={d.resource_utilization_pct ?? ''}
                        placeholder={`${wsForm?.resource_utilization_pct ?? 80}`}
                        key={`res-${d.id}-${d.resource_utilization_pct}`}
                        className={cn(
                          'w-[72px] text-center text-sm py-1',
                          d.resource_utilization_pct != null && 'border-accent',
                        )}
                        onBlur={e => {
                          const val = e.target.value === '' ? null : Number(e.target.value)
                          api.patch(`/users/departments/${d.id}`, { resource_utilization_pct: val })
                            .then(() => qc.invalidateQueries({ queryKey: ['departments'] }))
                            .catch((err: any) => console.warn('Dept update failed:', err?.message))
                        }}
                      />
                      <span className="text-[10px] text-muted">%</span>
                      {d.resource_utilization_pct != null && (
                        <button
                          onClick={() => api.patch(`/users/departments/${d.id}`, { resource_utilization_pct: null }).then(() => qc.invalidateQueries({ queryKey: ['departments'] })).catch((e: any) => showToast.error('Failed to reset: ' + (e?.message || 'error')))}
                          className="bg-none border-none cursor-pointer text-muted hover:text-status-rose p-0 leading-none"
                          title="Reset to workspace default"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    {/* Billable target */}
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" min={0} max={100} step={5}
                        defaultValue={d.billable_utilization_pct ?? ''}
                        placeholder={`${wsForm?.billable_utilization_pct ?? 80}`}
                        key={`bill-${d.id}-${d.billable_utilization_pct}`}
                        className={cn(
                          'w-[72px] text-center text-sm py-1',
                          d.billable_utilization_pct != null && 'border-status-violet',
                        )}
                        onBlur={e => {
                          const val = e.target.value === '' ? null : Number(e.target.value)
                          api.patch(`/users/departments/${d.id}`, { billable_utilization_pct: val })
                            .then(() => qc.invalidateQueries({ queryKey: ['departments'] }))
                            .catch((err: any) => console.warn('Dept update failed:', err?.message))
                        }}
                      />
                      <span className="text-[10px] text-muted">%</span>
                      {d.billable_utilization_pct != null && (
                        <button
                          onClick={() => api.patch(`/users/departments/${d.id}`, { billable_utilization_pct: null }).then(() => qc.invalidateQueries({ queryKey: ['departments'] })).catch((e: any) => showToast.error('Failed to reset: ' + (e?.message || 'error')))}
                          className="bg-none border-none cursor-pointer text-muted hover:text-status-rose p-0 leading-none"
                          title="Reset to workspace default"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {(!depts || depts.length === 0) && (
                <div className="p-4 text-base text-muted">No departments yet — add them in the Departments tab first.</div>
              )}
            </Card>

            <Card className="overflow-hidden p-0">
              <div className="px-4 py-3 bg-surface border-b border-line-subtle text-sm font-bold uppercase tracking-wider text-muted">Time Entry Rules</div>
              <div className="px-4 py-3 flex flex-col gap-3.5">
                {/* Timesheet deadline day */}
                <div className="flex justify-between items-center gap-3">
                  <div>
                    <div className="text-base text-primary font-medium">Submission deadline</div>
                    <div className="text-xs text-muted mt-0.5">Which day of week timesheets must be submitted by</div>
                  </div>
                  <Select
                    size="sm"
                    aria-label="Submission deadline day"
                    value={wsForm.timesheet_deadline_day}
                    onChange={e => setWsForm((f: any) => ({ ...f, timesheet_deadline_day: Number(e.target.value) }))}
                    className="w-auto min-w-[130px]"
                  >
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                    <option value={0}>Sunday</option>
                  </Select>
                </div>
                {[
                  { key: 'weekends_enabled', label: 'Allow weekend logging', sub: 'Some teams work Sat/Sun' },
                  { key: 'allow_entries_on_done', label: 'Allow entries on completed tasks', sub: 'People log timesheets late' },
                  { key: 'allow_entries_over_estimate', label: 'Allow entries exceeding estimate', sub: 'Tasks often run over' },
                  { key: 'allow_late_entries', label: 'Allow late timesheet entries', sub: 'Expired projects still need entries' },
                ].map(s => (
                  <div key={s.key} className="flex justify-between items-center gap-3">
                    <div>
                      <div className="text-base text-primary font-medium">{s.label}</div>
                      <div className="text-xs text-muted mt-0.5">{s.sub}</div>
                    </div>
                    <Toggle on={!!wsForm[s.key]} onChange={v => setWsForm((f: any) => ({ ...f, [s.key]: v }))} />
                  </div>
                ))}
              </div>
            </Card>
          </div>
          {/* Auto-save status indicator */}
          {(saveWorkspace.isPending || wsSaved) && (
            <div className="mt-3 flex items-center gap-1.5">
              {saveWorkspace.isPending
                ? <span className="text-sm text-muted">⟳ Saving...</span>
                : <span className="text-sm text-accent font-medium">✓ Saved</span>
              }
            </div>
          )}

          {/* ── Email Notifications ── */}
          <Card className="mt-6 overflow-hidden p-0">
            <div className="px-4 py-3 bg-surface border-b border-line-subtle flex justify-between items-center">
              <span className="text-sm font-bold uppercase tracking-wider text-muted">Email Notifications</span>
              <span className="text-xs text-muted">Triggers send to all admins via SendGrid</span>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {[
                { label: 'Weekly Digest', desc: 'Monday morning summary — hours, utilization, compliance, budget alerts', endpoint: '/notify/weekly-digest', key: 'digest' },
                { label: 'Timesheet Reminder', desc: 'Friday reminder to all users who haven’t submitted this week', endpoint: '/notify/timesheet-reminders', key: 'reminder' },
                { label: 'Budget Check', desc: 'Scan all running projects and send alerts for those over 80% budget', endpoint: '/notify/budget-check', key: 'budget' },
              ].map(({ label, desc, endpoint, key }) => {
                const status = emailStatus[key] || 'idle'
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between px-3.5 py-3 bg-surface rounded-md border border-line-subtle"
                  >
                    <div>
                      <div className="text-base font-semibold text-primary mb-0.5">{label}</div>
                      <div className="text-sm text-muted">{desc}</div>
                    </div>
                    <Button
                      variant={status === 'done' ? 'primary' : status === 'error' ? 'danger' : 'secondary'}
                      size="sm"
                      onClick={() => triggerEmail(endpoint, key)}
                      disabled={status === 'sending'}
                      className="whitespace-nowrap ml-4"
                    >
                      {status === 'sending' ? 'Sending...' : status === 'done' ? '✓ Sent!' : status === 'error' ? '✕ Error' : 'Send Now'}
                    </Button>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* ── IMPORT FROM FORECAST ──────────────────────────────────────────── */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      {tab === 'import' && (
        <div className="max-w-[820px]">

          {/* ── Section 1: API Key ────────────────────────────────────────── */}
          <Card className="overflow-hidden p-0 mb-3.5">
            <div className="px-4 py-3 bg-surface border-b border-line-subtle flex justify-between items-center">
              <span className="text-sm font-bold uppercase tracking-wider text-muted">API Configuration</span>
              <span className="text-xs text-muted">Get keys at app.forecast.it/admin/api-keys</span>
            </div>
            <div className="p-4">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs uppercase tracking-wider">Forecast API Key</Label>
                  <div className="relative">
                    <Input
                      type={showApiKey ? 'text' : 'password'}
                      value={importApiKey}
                      onChange={e => setImportApiKey(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="font-mono pr-10"
                    />
                    <button
                      onClick={() => setShowApiKey(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-none border-none cursor-pointer text-base text-muted p-0 flex items-center"
                      aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    >
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={runTest}
                  disabled={!importApiKey.trim() || isImportRunning}
                >
                  {importStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                </Button>
              </div>

              {/* Test result */}
              {testResult && (
                <div className={cn(
                  'mt-2.5 px-3.5 py-2.5 border rounded',
                  testResult.ok
                    ? 'bg-accent-dim border-[rgba(0,212,180,0.2)]'
                    : 'bg-status-rose-dim border-[rgba(244,63,94,0.2)]',
                )}>
                  {testResult.ok ? (
                    <div>
                      <div className="text-base font-semibold text-accent mb-1.5">Connected as {testResult.user}</div>
                      <div className="flex gap-5">
                        {[
                          { label: 'People',   value: testResult.counts?.persons  ?? '—' },
                          { label: 'Clients',  value: testResult.counts?.clients  ?? '—' },
                          { label: 'Projects', value: testResult.counts?.projects ?? '—' },
                        ].map(s => (
                          <div key={s.label} className="text-center">
                            <div className="text-xl font-bold text-primary tabular-nums">{s.value}</div>
                            <div className="text-xs text-muted">{s.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div role="alert" className="text-base text-status-rose font-medium">Failed: {testResult.error || 'Connection failed'}</div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* ── Section 2: Import Options ─────────────────────────────────── */}
          <Card className="overflow-hidden p-0 mb-3.5">
            <div className="px-4 py-3 bg-surface border-b border-line-subtle flex justify-between items-center">
              <span className="text-sm font-bold uppercase tracking-wider text-muted">What to Import</span>
              <div className="flex gap-2.5">
                <button
                  onClick={() => setImportOptions({ departments: true, users: true, clients: true, projects: true, tasks: true })}
                  className="bg-none border-none text-xs text-accent cursor-pointer font-body p-0"
                >Select all</button>
                <span className="text-line-muted">·</span>
                <button
                  onClick={() => setImportOptions({ departments: false, users: false, clients: false, projects: false, tasks: false })}
                  className="bg-none border-none text-xs text-muted cursor-pointer font-body p-0"
                >Clear</button>
              </div>
            </div>
            <div className="p-4 grid grid-cols-2 gap-2.5">
              <ImportOption label="Departments" sub="Team structure and department names" checked={importOptions.departments} onChange={v => setImportOptions(o => ({ ...o, departments: v }))} disabled={isImportRunning} />
              <ImportOption label="Team Members" sub="All people with roles and capacities" checked={importOptions.users} onChange={v => setImportOptions(o => ({ ...o, users: v }))} disabled={isImportRunning} />
              <ImportOption label="Clients" sub="All client companies" checked={importOptions.clients} onChange={v => setImportOptions(o => ({ ...o, clients: v }))} disabled={isImportRunning} />
              <ImportOption label="Projects" sub="All projects with status, budget, dates" checked={importOptions.projects} onChange={v => setImportOptions(o => ({ ...o, projects: v }))} disabled={isImportRunning} />
              <div className="col-span-full">
                <ImportOption label="Tasks & Phases" sub="All tasks with assignees, estimates and due dates (slowest step — 190 projects)" checked={importOptions.tasks} onChange={v => setImportOptions(o => ({ ...o, tasks: v }))} disabled={isImportRunning || !importOptions.projects} />
              </div>
            </div>
            <div className="px-4 py-2.5 border-t border-line-subtle bg-surface text-xs text-muted flex items-center gap-1.5">
              <Info size={12} />
              <span>Safe to re-run at any time — existing records matched by name/email are skipped, not duplicated.</span>
            </div>
          </Card>

          {/* ── Section 3: Start button ───────────────────────────────────── */}
          <div className="flex gap-2.5 items-center mb-3.5">
            {importStatus !== 'running' ? (
              <Button
                variant="primary"
                size="lg"
                onClick={runImport}
                disabled={!importApiKey.trim() || Object.values(importOptions).every(v => !v)}
              >
                {importStatus === 'done'
                  ? <><RefreshCw size={14} /> Run Again</>
                  : importStatus === 'error'
                  ? <><RefreshCw size={14} /> Retry</>
                  : <><Play size={14} /> Start Import</>}
              </Button>
            ) : (
              <Button variant="secondary" size="lg" disabled loading>
                Importing…
              </Button>
            )}
            {importStatus === 'done' && <span className="text-base font-semibold text-accent">Import complete</span>}
            {importStatus === 'error' && <span role="alert" className="text-base font-semibold text-status-rose">Import failed — check logs below</span>}
            {importStatus === 'running' && (
              <span className="text-sm text-muted">
                {importOptions.tasks ? 'This may take 3–8 minutes for 190 projects…' : 'Running…'}
              </span>
            )}
          </div>

          {/* ── Section 4: Live log ───────────────────────────────────────── */}
          {importLogs.length > 0 && (
            <Card className="overflow-hidden p-0 mb-3.5">
              <div className="px-4 py-2.5 bg-surface border-b border-line-subtle flex justify-between items-center">
                <span className="text-sm font-bold uppercase tracking-wider text-muted">
                  Progress Log
                  {importStatus === 'running' && <span className="ml-2 inline-block w-[7px] h-[7px] bg-accent rounded-full animate-pulse-opacity" />}
                </span>
                <button
                  onClick={() => setImportLogs([])}
                  className="bg-none border-none text-xs text-muted cursor-pointer font-body"
                >Clear</button>
              </div>
              <div
                ref={logRef}
                className="h-[320px] overflow-y-auto py-2.5 font-mono text-sm"
              >
                {importLogs.map((entry, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex gap-2.5 px-4 py-0.5 border-l-2',
                      entry.type === 'step'
                        ? 'bg-surface border-l-accent'
                        : entry.type === 'error'
                        ? 'bg-status-rose-dim border-l-status-rose'
                        : 'border-l-transparent',
                    )}
                  >
                    <span className="text-muted flex-shrink-0 text-xs mt-px">{entry.time}</span>
                    <span className={cn(
                      'leading-[1.4]',
                      entry.type === 'error'
                        ? 'text-status-rose'
                        : entry.type === 'step'
                        ? 'text-primary font-semibold'
                        : 'text-secondary',
                    )}>{entry.msg}</span>
                  </div>
                ))}
                {importStatus === 'running' && (
                  <div className="px-4 py-1 text-muted text-xs">
                    <span className="animate-pulse-opacity">█</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Section 5: Final counts ───────────────────────────────────── */}
          {importStatus === 'done' && importCounts && (
            <Card className="px-5 py-4 border-[rgba(0,212,180,0.25)]">
              <div className="text-base font-semibold text-accent mb-3.5">Import Summary</div>
              <div className="grid grid-cols-5 gap-2.5">
                {[
                  { label: 'Depts',    key: 'departments' },
                  { label: 'People',   key: 'users' },
                  { label: 'Clients',  key: 'clients' },
                  { label: 'Projects', key: 'projects' },
                  { label: 'Tasks',    key: 'tasks' },
                ].map(s => (
                  <div
                    key={s.key}
                    className="bg-surface border border-line-subtle rounded p-3 text-center"
                  >
                    <div className="text-2xl font-bold text-primary tabular-nums leading-none">{(importCounts as any)[s.key] || 0}</div>
                    <div className="text-xs text-muted mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3.5 text-sm text-muted">
                All imported users have been given the default password: <code className="bg-surface-overlay px-1.5 py-px rounded-sm font-mono">password123</code> — they can change it after logging in.
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── IMPORT FINANCE SHEET ───────────────────────────────────────────── */}
      {tab === 'finance_import' && (
        <div className="max-w-[1100px]">
          <FinanceImport />
        </div>
      )}

      {/* ── LIVE FORECAST SYNC ─────────────────────────────────────────────── */}
      {tab === 'forecast_sync' && (
        <div className="max-w-[1100px]">
          <ForecastSync />
        </div>
      )}
    </div>
  )
}
