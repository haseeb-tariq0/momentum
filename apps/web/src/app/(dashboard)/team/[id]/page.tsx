'use client'
import { useState, useRef, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usersApi, projectsApi } from '@/lib/queries'
import { useAuthStore } from '@/lib/store'
import { api } from '@/lib/api'
import { showConfirm } from '@/components/ConfirmDialog'
import { Search, Calendar, X, Check } from 'lucide-react'
import Link from 'next/link'
import {
  PageHeader, Card, Avatar, Badge, Input, Label, Button, Skeleton, Select,
  type BadgeProps,
} from '@/components/ui'
import { cn } from '@/lib/cn'

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const ROLE: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  super_admin:     { label: 'Super Admin',  variant: 'danger'  },
  admin:           { label: 'Admin',        variant: 'violet'  },
  account_manager: { label: 'Acct Mgr',     variant: 'info'    },
  collaborator:    { label: 'Collaborator', variant: 'default' },
}

// Full country list with ISO codes (same as admin holidays tab)
const ALL_COUNTRIES = [
  {code:'AE',name:'UAE (United Arab Emirates)'},{code:'AF',name:'Afghanistan'},{code:'AL',name:'Albania'},
  {code:'DZ',name:'Algeria'},{code:'AR',name:'Argentina'},{code:'AM',name:'Armenia'},{code:'AU',name:'Australia'},
  {code:'AT',name:'Austria'},{code:'AZ',name:'Azerbaijan'},{code:'BH',name:'Bahrain'},{code:'BD',name:'Bangladesh'},
  {code:'BY',name:'Belarus'},{code:'BE',name:'Belgium'},{code:'BO',name:'Bolivia'},{code:'BR',name:'Brazil'},
  {code:'BG',name:'Bulgaria'},{code:'CA',name:'Canada'},{code:'CL',name:'Chile'},{code:'CN',name:'China'},
  {code:'CO',name:'Colombia'},{code:'HR',name:'Croatia'},{code:'CY',name:'Cyprus'},{code:'CZ',name:'Czech Republic'},
  {code:'DK',name:'Denmark'},{code:'EC',name:'Ecuador'},{code:'EG',name:'Egypt'},{code:'EE',name:'Estonia'},
  {code:'ET',name:'Ethiopia'},{code:'FI',name:'Finland'},{code:'FR',name:'France'},{code:'GE',name:'Georgia'},
  {code:'DE',name:'Germany'},{code:'GH',name:'Ghana'},{code:'GR',name:'Greece'},{code:'HK',name:'Hong Kong'},
  {code:'HU',name:'Hungary'},{code:'IS',name:'Iceland'},{code:'IN',name:'India'},{code:'ID',name:'Indonesia'},
  {code:'IR',name:'Iran'},{code:'IQ',name:'Iraq'},{code:'IE',name:'Ireland'},{code:'IL',name:'Israel'},
  {code:'IT',name:'Italy'},{code:'JM',name:'Jamaica'},{code:'JP',name:'Japan'},{code:'JO',name:'Jordan'},
  {code:'KZ',name:'Kazakhstan'},{code:'KE',name:'Kenya'},{code:'KW',name:'Kuwait'},{code:'LV',name:'Latvia'},
  {code:'LB',name:'Lebanon'},{code:'LY',name:'Libya'},{code:'LT',name:'Lithuania'},{code:'LU',name:'Luxembourg'},
  {code:'MY',name:'Malaysia'},{code:'MV',name:'Maldives'},{code:'MT',name:'Malta'},{code:'MX',name:'Mexico'},
  {code:'MA',name:'Morocco'},{code:'MM',name:'Myanmar'},{code:'NP',name:'Nepal'},{code:'NL',name:'Netherlands'},
  {code:'NZ',name:'New Zealand'},{code:'NG',name:'Nigeria'},{code:'NO',name:'Norway'},{code:'OM',name:'Oman'},
  {code:'PK',name:'Pakistan'},{code:'PS',name:'Palestine'},{code:'PA',name:'Panama'},{code:'PE',name:'Peru'},
  {code:'PH',name:'Philippines'},{code:'PL',name:'Poland'},{code:'PT',name:'Portugal'},{code:'QA',name:'Qatar'},
  {code:'RO',name:'Romania'},{code:'RU',name:'Russia'},{code:'SA',name:'Saudi Arabia'},{code:'RS',name:'Serbia'},
  {code:'SG',name:'Singapore'},{code:'SK',name:'Slovakia'},{code:'SI',name:'Slovenia'},{code:'ZA',name:'South Africa'},
  {code:'KR',name:'South Korea'},{code:'ES',name:'Spain'},{code:'LK',name:'Sri Lanka'},{code:'SE',name:'Sweden'},
  {code:'CH',name:'Switzerland'},{code:'SY',name:'Syria'},{code:'TW',name:'Taiwan'},{code:'TH',name:'Thailand'},
  {code:'TN',name:'Tunisia'},{code:'TR',name:'Turkey'},{code:'UA',name:'Ukraine'},{code:'GB',name:'United Kingdom'},
  {code:'US',name:'United States'},{code:'UZ',name:'Uzbekistan'},{code:'VN',name:'Vietnam'},{code:'YE',name:'Yemen'},
]

// Country picker modal (reusable)
function CountryPickerModal({ onSelect, onClose, existingCodes = new Set() }: { onSelect: (c:{code:string;name:string})=>void; onClose:()=>void; existingCodes?: Set<string> }) {
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 50) }, [])
  const filtered = ALL_COUNTRIES.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/45 z-overlay backdrop-blur-sm" />
      <div className="fixed top-[15vh] left-1/2 -translate-x-1/2 w-[460px] max-w-[calc(100vw-32px)] bg-surface-raised border border-line-muted rounded-xl shadow-md z-modal overflow-hidden">
        <div className="px-4 py-3.5 border-b border-line-subtle">
          <div className="text-lg font-semibold text-primary mb-2.5">Add Country Calendar</div>
          <div className="flex items-center gap-2 bg-surface border border-line-muted rounded px-3 py-2">
            <Search size={16} className="text-muted" />
            <input
              ref={ref}
              value={search}
              onChange={e=>setSearch(e.target.value)}
              placeholder="Search country (e.g. India, Saudi Arabia...)"
              className="flex-1 bg-transparent border-0 outline-none text-lg text-primary font-body"
              onKeyDown={e=>e.key==='Escape'&&onClose()}
            />
            {search && (
              <button aria-label="Clear search" onClick={()=>setSearch('')} className="bg-transparent border-0 cursor-pointer text-muted p-0 leading-none">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="max-h-[340px] overflow-y-auto">
          {filtered.length===0 && (
            <div className="p-6 text-center text-base text-muted">No countries matching "{search}"</div>
          )}
          {filtered.map(c => {
            const added = existingCodes.has(c.code)
            return (
              <div
                key={c.code}
                onClick={()=>!added&&onSelect(c)}
                className={cn(
                  'px-4 py-2.5 flex items-center justify-between border-b border-line-subtle',
                  added ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-accent-dim',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold text-muted bg-surface-overlay px-1.5 py-0.5 rounded-sm font-mono min-w-[28px] text-center">{c.code}</span>
                  <span className="text-base text-primary font-medium">{c.name}</span>
                </div>
                {added
                  ? <span className="inline-flex items-center gap-1 text-xs text-accent bg-accent-dim px-2 py-0.5 rounded-sm font-semibold"><Check size={14} /> Added</span>
                  : <span className="text-xs text-muted">→ Add &amp; sync holidays</span>
                }
              </div>
            )
          })}
        </div>
        <div className="px-4 py-2.5 border-t border-line-subtle text-xs text-muted flex justify-between">
          <span>Holidays synced automatically on add</span>
          <kbd className="bg-surface-overlay border border-line-muted rounded-sm px-1.5 py-px text-[10px] cursor-pointer" onClick={onClose}>Esc</kbd>
        </div>
      </div>
    </>
  )
}

export default function PersonProfilePage() {
  const { id } = useParams() as { id: string }
  const router  = useRouter()
  const qc      = useQueryClient()
  const { isAdmin, isSuperAdmin, user: me } = useAuthStore()
  const canEdit = isAdmin() || me?.id === id

  const [editForm,       setEditForm]       = useState<any>(null)
  const [saving,         setSaving]         = useState(false)
  const [saved,          setSaved]          = useState(false)
  const [newSkill,       setNewSkill]       = useState('')
  const [addingSkill,    setAddingSkill]    = useState(false)
  const [uploadingAvatar,setUploadingAvatar]= useState(false)
  const [showCalPicker,  setShowCalPicker]  = useState(false)
  const [addingCal,      setAddingCal]      = useState(false)
  const [workHours,      setWorkHours]      = useState<Record<string,number>>({ Sunday:0, Monday:8, Tuesday:8, Wednesday:8, Thursday:8, Friday:8, Saturday:0 })
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: userData,   isLoading } = useQuery({ queryKey:['user-profile',id], queryFn:()=>api.get(`/users/${id}`).then((r:any)=>r.data), staleTime:30_000 })
  const { data: deptsData }             = useQuery({ queryKey:['departments'], queryFn:()=>usersApi.departments().then((r:any)=>r.data), staleTime:60_000 })
  const { data: calendarsData }         = useQuery({ queryKey:['calendars'], queryFn:()=>usersApi.calendars().then((r:any)=>r.data), staleTime:30_000 })
  const { data: skillsData }            = useQuery({ queryKey:['user-skills',id], queryFn:()=>api.get(`/users/${id}/skills`).then((r:any)=>r.data) })
  const { data: projectsData }          = useQuery({ queryKey:['projects-all'], queryFn:()=>projectsApi.list().then((r:any)=>r.data), staleTime:60_000 })

  if (userData && !editForm) {
    setEditForm({
      name:                 userData.name || '',
      email:                userData.email || '',
      job_title:            userData.job_title || '',
      seat_type:            userData.seat_type || 'collaborator',
      permission_profile:   userData.permission_profile || 'collaborator',
      department_id:        userData.department_id || '',
      holiday_calendar_id:  userData.holiday_calendar_id || '',
      capacity_hrs:         userData.capacity_hrs ?? 40,
      internal_hourly_cost: userData.internal_hourly_cost ?? 0,
      start_date:           userData.start_date || '',
      end_date:             userData.end_date || '',
      active:               userData.active !== false,
    })
  }

  const user        = userData
  const depts       = deptsData     || []
  const calendars   = calendarsData || []
  const skills      = skillsData    || []
  const allProjects = projectsData  || []
  const myProjects  = allProjects.filter((p:any) => (p.project_members||[]).some((m:any)=>m.user_id===id))
  const existingCalCodes: Set<string> = new Set(calendars.map((c:any)=>c.country_code).filter(Boolean))

  async function saveProfile() {
    if (!editForm || !canEdit) return
    setSaving(true)
    try {
      await api.patch(`/users/${id}`, editForm)
      qc.invalidateQueries({ queryKey:['users'] })
      qc.invalidateQueries({ queryKey:['user-profile',id] })
      setSaved(true); setTimeout(()=>setSaved(false), 2500)
    } finally { setSaving(false) }
  }

  async function addSkill() {
    if (!newSkill.trim()) return
    setAddingSkill(true)
    try { await api.post(`/users/${id}/skills`, { skill:newSkill.trim() }); qc.invalidateQueries({ queryKey:['user-skills',id] }); setNewSkill('') }
    finally { setAddingSkill(false) }
  }

  async function removeSkill(skill: string) {
    await api.delete(`/users/${id}/skills/${encodeURIComponent(skill)}`)
    qc.invalidateQueries({ queryKey:['user-skills',id] })
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setUploadingAvatar(true)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      await api.patch(`/users/${id}`, { avatar_url: ev.target?.result as string })
      qc.invalidateQueries({ queryKey:['user-profile',id] }); qc.invalidateQueries({ queryKey:['users'] })
      setUploadingAvatar(false)
    }
    reader.readAsDataURL(file)
  }

  async function handleAddCalendar(country: { code: string; name: string }) {
    setShowCalPicker(false)
    setAddingCal(true)
    try {
      const res: any = await api.post('/users/calendars', { name:`${country.name} Holidays`, country:country.name, country_code:country.code })
      const newCalId = res?.data?.id
      if (newCalId) {
        // Sync 2026 holidays immediately
        await usersApi.syncHolidays(newCalId, 2026)
        await qc.invalidateQueries({ queryKey:['calendars'] })
        // Auto-select the new calendar for this person
        setEditForm((f:any) => ({ ...f, holiday_calendar_id: newCalId }))
      }
    } finally { setAddingCal(false) }
  }

  if (isLoading || !editForm) return (
    <div className="px-7 py-6 w-full">
      <Skeleton className="h-8 w-40 mb-5" />
      <Card className="p-6 mb-4">
        <div className="flex items-start gap-6">
          <Skeleton className="h-[88px] w-[88px] rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3.5">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
  if (!user) return (
    <div className="px-7 py-6 text-base text-muted">Person not found.</div>
  )

  const role = ROLE[user.permission_profile || 'collaborator'] || ROLE.collaborator
  const isDeactivated = user.active === false
  const selectedCal = calendars.find((c:any) => c.id === editForm.holiday_calendar_id)

  return (
    <div className="px-7 py-6 w-full">

      {showCalPicker && (
        <CountryPickerModal
          existingCodes={existingCalCodes}
          onSelect={handleAddCalendar}
          onClose={()=>setShowCalPicker(false)}
        />
      )}

      <PageHeader
        title={user.name}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <Link href="/team" className="text-muted hover:text-primary no-underline">People</Link>
            <span aria-hidden>/</span>
            <span className="text-primary">{user.name}</span>
          </span>
        }
        actions={
          isSuperAdmin() ? (
            !isDeactivated ? (
              <Button
                variant="danger"
                onClick={()=>showConfirm(`Deactivate ${user.name}?`, ()=>api.delete(`/users/${id}`).then(()=>{qc.invalidateQueries({queryKey:['users']});qc.invalidateQueries({queryKey:['user-profile',id]})}), { confirmLabel:'Deactivate', subtext:'The user will lose access to the platform.' })}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={()=>api.patch(`/users/${id}`,{active:true}).then(()=>{qc.invalidateQueries({queryKey:['users']});qc.invalidateQueries({queryKey:['user-profile',id]})})}
              >
                Reactivate
              </Button>
            )
          ) : undefined
        }
      />

      {/* ── HEADER CARD ─────────────────────────────────────────────── */}
      <Card className="flex items-start gap-6 px-7 py-6 mb-4">
        {/* Avatar */}
        <div className="flex flex-col items-center gap-2.5 flex-shrink-0">
          <Avatar
            name={user.name || '?'}
            src={user.avatar_url}
            size="lg"
            className="w-[88px] h-[88px] text-2xl border-2 border-line-muted"
          />
          {canEdit && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={()=>fileRef.current?.click()} disabled={uploadingAvatar}>
                {uploadingAvatar ? 'Uploading...' : 'Update photo'}
              </Button>
              {user.avatar_url && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={()=>api.patch(`/users/${id}`,{avatar_url:null}).then(()=>qc.invalidateQueries({queryKey:['user-profile',id]}))}
                >
                  Remove
                </Button>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <h2 className="text-2xl font-bold text-primary m-0">{user.name}</h2>
            {isDeactivated
              ? <Badge variant="default">Deactivated</Badge>
              : <Badge variant="success">Active</Badge>
            }
          </div>
          <div className="text-lg text-secondary mb-0.5">{user.email}</div>
          <div className="text-base text-muted mb-3">
            {user.job_title || <em>No job title</em>}
            {user.departments?.name && <><span className="mx-2 opacity-40">·</span><span>{user.departments.name}</span></>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Badge variant={role.variant}>{role.label}</Badge>
            <Badge variant="default" className="capitalize">{user.seat_type || 'collaborator'}</Badge>
            {user.start_date && (
              <Badge variant="default">
                Since {new Date(user.start_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
              </Badge>
            )}
            <Badge variant="default">{editForm.capacity_hrs}h/wk</Badge>
            {selectedCal && (
              <Badge variant="default" className="inline-flex items-center gap-1">
                <Calendar size={12} /> {selectedCal.name}
              </Badge>
            )}
          </div>
        </div>
      </Card>

      {/* ── TWO COLUMN GRID ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3.5">

        {/* SECTION 1: Team Member Info */}
        <Card className="overflow-hidden p-0">
          <div className="px-4 py-3 bg-surface border-b border-line-subtle text-sm font-bold uppercase tracking-wider text-muted">
            Team Member Info
          </div>
          <div className="px-4 py-4 flex flex-col gap-3">
            {([
              { label:'Full Name',   key:'name',       type:'text',  disabled:!canEdit },
              { label:'Email',       key:'email',      type:'email', disabled:!isSuperAdmin() },
              { label:'Job Title',   key:'job_title',  type:'text',  disabled:!canEdit },
              { label:'Start Date',  key:'start_date', type:'date',  disabled:!isAdmin() },
              { label:'End Date',    key:'end_date',   type:'date',  disabled:!isAdmin() },
            ] as any[]).map(f=>(
              <div key={f.key}>
                <Label htmlFor={`field-${f.key}`}>{f.label}</Label>
                <Input
                  id={`field-${f.key}`}
                  type={f.type}
                  value={editForm[f.key]||''}
                  disabled={f.disabled}
                  onChange={e=>setEditForm((frm:any)=>({...frm,[f.key]:e.target.value}))}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* SECTION 2: Role & Permissions */}
        <Card className="overflow-hidden p-0">
          <div className="px-4 py-3 bg-surface border-b border-line-subtle text-sm font-bold uppercase tracking-wider text-muted">
            Role &amp; Permissions
          </div>
          <div className="px-4 py-4 flex flex-col gap-3">

            {/* Permission Profile */}
            <div>
              <Label htmlFor="field-permission">Permission Profile</Label>
              <Select
                id="field-permission"
                value={editForm.permission_profile}
                disabled={!isSuperAdmin()}
                onChange={e=>setEditForm((f:any)=>({...f,permission_profile:e.target.value}))}
              >
                <option value="collaborator">Collaborator</option>
                <option value="account_manager">Account Manager</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </Select>
            </div>

            {/* Role */}
            <div>
              <Label htmlFor="field-seat">Role</Label>
              <Select
                id="field-seat"
                value={editForm.seat_type}
                disabled={!isSuperAdmin()}
                onChange={e=>setEditForm((f:any)=>({...f,seat_type:e.target.value}))}
              >
                <option value="collaborator">Collaborator</option>
                <option value="core">Core</option>
              </Select>
            </div>

            {/* Department */}
            <div>
              <Label htmlFor="field-dept">Department</Label>
              <Select
                id="field-dept"
                value={editForm.department_id}
                disabled={!isAdmin()}
                onChange={e=>setEditForm((f:any)=>({...f,department_id:e.target.value}))}
              >
                <option value="">No department</option>
                {depts.map((d:any)=><option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>

            {/* Holiday Calendar — with inline "Add" button */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <Label htmlFor="field-cal" className="mb-0">Holiday Calendar</Label>
                {isAdmin() && (
                  <button
                    onClick={()=>setShowCalPicker(true)}
                    disabled={addingCal}
                    className="bg-transparent border-0 text-xs font-semibold text-accent cursor-pointer p-0 inline-flex items-center gap-0.5 hover:opacity-70 disabled:opacity-50"
                  >
                    {addingCal?'Adding...':'+ Add new calendar'}
                  </button>
                )}
              </div>
              <Select
                id="field-cal"
                value={editForm.holiday_calendar_id}
                disabled={!isAdmin()}
                onChange={e=>setEditForm((f:any)=>({...f,holiday_calendar_id:e.target.value}))}
              >
                <option value="">No calendar</option>
                {calendars.map((c:any)=>(
                  <option key={c.id} value={c.id}>
                    {c.country_code ? `[${c.country_code}] ` : ''}{c.name}{c.holidays?.length ? ` — ${c.holidays.length} holidays` : ''}
                  </option>
                ))}
              </Select>
              {selectedCal && (
                <div className="mt-1.5 text-xs text-accent inline-flex items-center gap-1">
                  <Check size={14} />
                  <span>{selectedCal.holidays?.length || 0} holidays loaded · affects Resourcing capacity</span>
                </div>
              )}
            </div>

            {/* Capacity + Cost */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label htmlFor="field-cap">Capacity (hrs/wk)</Label>
                <Input
                  id="field-cap"
                  type="number"
                  min="1"
                  max="80"
                  value={editForm.capacity_hrs}
                  disabled={!isAdmin()}
                  onChange={e=>setEditForm((f:any)=>({...f,capacity_hrs:Number(e.target.value)}))}
                />
              </div>
              {isSuperAdmin() && (
                <div>
                  <Label htmlFor="field-cost">Cost (AED/hr)</Label>
                  <Input
                    id="field-cost"
                    type="number"
                    min="0"
                    value={editForm.internal_hourly_cost}
                    onChange={e=>setEditForm((f:any)=>({...f,internal_hourly_cost:Number(e.target.value)}))}
                  />
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* SECTION 3: Skills */}
        <Card className="overflow-hidden p-0">
          <div className="px-4 py-3 bg-surface border-b border-line-subtle text-sm font-bold uppercase tracking-wider text-muted">
            Skills ({skills.length})
          </div>
          <div className="px-4 py-3.5">
            {skills.length===0 && (
              <div className="text-base text-muted italic mb-3">No skills added yet</div>
            )}
            <div className={cn('flex flex-wrap gap-1.5', skills.length>0 && 'mb-3')}>
              {skills.map((s:any)=>{
                const label = s.skill || s
                return (
                  <Badge key={label} variant="default" className="gap-1">
                    <span>{label}</span>
                    {canEdit && (
                      <button
                        aria-label={`Remove skill ${label}`}
                        onClick={()=>removeSkill(label)}
                        className="bg-transparent border-0 cursor-pointer text-muted hover:text-primary p-0 inline-flex items-center leading-none"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </Badge>
                )
              })}
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <Input
                  value={newSkill}
                  onChange={e=>setNewSkill(e.target.value)}
                  placeholder="Add a skill (e.g. Figma, React...)"
                  className="flex-1"
                  onKeyDown={e=>e.key==='Enter'&&addSkill()}
                />
                <Button
                  variant="primary"
                  onClick={addSkill}
                  disabled={!newSkill.trim()||addingSkill}
                  loading={addingSkill}
                >
                  Add
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* SECTION 4: Project Assignments */}
        <Card className="overflow-hidden p-0">
          <div className="px-4 py-3 bg-surface border-b border-line-subtle text-sm font-bold uppercase tracking-wider text-muted">
            Project Assignments ({myProjects.length})
          </div>
          <div className="max-h-[260px] overflow-y-auto">
            {myProjects.length===0 && (
              <div className="px-4 py-5 text-base text-muted italic">Not assigned to any projects</div>
            )}
            {myProjects.map((p:any,i:number)=>{
              const statusVariant: BadgeProps['variant'] =
                p.status==='running' ? 'success' :
                p.status==='halted'  ? 'warning' : 'default'
              return (
                <div
                  key={p.id}
                  onClick={()=>router.push(`/projects/${p.id}`)}
                  className={cn(
                    'px-4 py-2.5 flex items-center gap-2.5 cursor-pointer hover:bg-surface-hover',
                    i < myProjects.length - 1 && 'border-b border-line-subtle',
                  )}
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: p.color || 'var(--accent)' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-medium text-primary truncate">{p.name}</div>
                    <div className="text-xs text-muted">{p.clients?.name || '—'}</div>
                  </div>
                  <Badge variant={statusVariant} className="capitalize flex-shrink-0">{p.status}</Badge>
                </div>
              )
            })}
          </div>
        </Card>

        {/* SECTION 5: Working Hours — editable per-day inputs */}
        <Card className="overflow-hidden p-0 col-span-2">
          <div className="px-4 py-3 bg-surface border-b border-line-subtle flex justify-between items-center">
            <span className="text-sm font-bold uppercase tracking-wider text-muted">Working Hours</span>
            <span className="text-xs text-accent font-medium">
              Total: {Object.values(workHours).reduce((a,b)=>a+b,0)}h/week
            </span>
          </div>
          <div className="px-4 py-4 grid grid-cols-7 gap-3">
            {DAYS.map(day=>{
              const isWeekend = day==='Saturday'||day==='Sunday'
              return (
                <div key={day} className="text-center">
                  <div className={cn(
                    'text-xs font-semibold uppercase tracking-wider mb-2',
                    isWeekend ? 'text-muted' : 'text-secondary',
                  )}>
                    {day.slice(0,3)}
                  </div>
                  <div className={cn(
                    'rounded-md px-1 py-2.5 border',
                    isWeekend
                      ? 'bg-surface-overlay border-line-subtle'
                      : 'bg-surface border-line-muted',
                  )}>
                    {isAdmin() ? (
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={workHours[day]}
                        onChange={e=>setWorkHours(h=>({...h,[day]:Number(e.target.value)}))}
                        className={cn(
                          'w-full bg-transparent border-0 outline-none text-center text-2xl font-bold font-body p-0',
                          isWeekend ? 'text-muted' : 'text-primary',
                        )}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      <div className={cn(
                        'text-2xl font-bold',
                        isWeekend ? 'text-muted' : 'text-primary',
                      )}>
                        {workHours[day]}
                      </div>
                    )}
                    <div className="text-[10px] text-muted mt-0.5">hours</div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

      </div>

      {/* ── SAVE ─────────────────────────────────────────────────────── */}
      {canEdit && (
        <div className="mt-5 pt-5 border-t border-line-subtle flex gap-2.5 items-center">
          <Button
            variant="primary"
            size="lg"
            onClick={saveProfile}
            loading={saving}
          >
            Save Changes
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={()=>router.push('/team')}
          >
            Cancel
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-base font-semibold text-accent">
              <Check size={14} /> Saved successfully
            </span>
          )}
        </div>
      )}
    </div>
  )
}
