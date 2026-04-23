'use client'
import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { financeApi, usersApi } from '@/lib/queries'
import { showToast } from '@/components/Toast'
import { Card, Button, Select, EmptyState, Input, Combobox } from '@/components/ui'
import { cn } from '@/lib/cn'
import { Upload, CheckCircle, AlertCircle, Loader2, FileSpreadsheet, RefreshCw, ExternalLink, ChevronDown, ChevronRight, Pencil, Save, X } from 'lucide-react'

type ImportResult = {
  totalRows: number
  inserted: number
  alreadyExisted: number
  skippedNoClient: number
  skippedNoMonth: number
  skippedNoAmount: number
  unmatched: { name: string; count: number }[]
  sheetTitle?: string
  sheetUrl?: string
  lastSyncAt?: string
}

// ── XLSX fallback support ────────────────────────────────────────────────────
async function loadXLSX(): Promise<any> {
  if ((window as any).__XLSX__) return (window as any).__XLSX__
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    script.onload = () => { (window as any).__XLSX__ = (window as any).XLSX; resolve((window as any).XLSX) }
    script.onerror = reject
    document.head.appendChild(script)
  })
}

// Column mapping for Client_Revenue sheet (shared with backend googleSheets.ts COL_MAP).
// Each value is a list of accepted header strings (first match wins).
// client_name_mapped (Column R) is the canonical short name matching Forecast;
// client_name_finance (Column D) is the long legal name kept as fallback only.
const COL_MAP: Record<string, string[]> = {
  month: ['Month'],
  invoice_date: ['Invoice Date'],
  invoice_no: ['Invoice No.'],
  client_name_mapped: ['Client Name (For Ops use)'],
  client_name_finance: ['Client Name'],
  sales_person: ['Sales Person'],
  service_department: ['Service Department'],
  service_category: ['Service Categories'],
  type: ['Type'],
  classification: ['Classification'],
  services_detail: ['Services in detail'],
  sales_amount: ['Sales Amount for Services (Exc VAT)', 'Sales Amount for Services'],
  third_party: ['Third Party'],
  advertising_budget: ['Advertising Budget'],
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return 'just now'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

export default function FinanceImport() {
  const qc = useQueryClient()
  const [defaultCurrency, setDefaultCurrency] = useState('AED')
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [showFallback, setShowFallback] = useState(false)

  // Integration status: whether service account JSON is in env, when we last synced
  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ['finance-sync-status'],
    queryFn: () => financeApi.syncStatus().then((r: any) => r),
    staleTime: 15_000,
  })
  const configured: boolean = statusData?.configured || false
  const serviceAccountEmail: string | null = statusData?.serviceAccountEmail || null
  const envSheetId: string | null = statusData?.envSheetId || null
  const activeSheetId: string | null = statusData?.activeSheetId || null
  const activeSheetUrl: string | null = statusData?.activeSheetUrl || null
  const financeState = statusData?.financeState as
    | { spreadsheetId?: string; sheetTitle?: string; sheetUrl?: string; lastSyncAt?: string; lastError?: string | null }
    | null

  // Sheet URL config: editable
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)

  // Load clients for unmatched-mapping dropdown
  const { data: clientsData } = useQuery({
    queryKey: ['clients'],
    queryFn: () => usersApi.clients().then((r: any) => r.data),
    staleTime: 60_000,
  })
  const clients: any[] = clientsData || []

  // Already-unmatched (from previous imports)
  const { data: unmatchedData, refetch: refetchUnmatched } = useQuery({
    queryKey: ['finance-unmatched'],
    queryFn: () => financeApi.unmatched().then((r: any) => r.data),
    staleTime: 10_000,
  })
  const persistedUnmatched: { name: string; count: number }[] = unmatchedData || []

  async function handleSync() {
    setSyncing(true)
    try {
      const res: ImportResult = await financeApi.syncGoogleSheet({ defaultCurrency })
      setResult(res)
      showToast.success(`Synced: ${res.inserted} new, ${res.alreadyExisted} unchanged`)
      refetchStatus()
      refetchUnmatched()
      // Invalidate any profitability reports so they re-fetch with fresh data
      qc.invalidateQueries({ queryKey: ['client-profitability'] })
    } catch (e: any) {
      showToast.error('Sync failed: ' + (e?.message || 'unknown'))
    } finally {
      setSyncing(false)
    }
  }

  async function handleSaveUrl() {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    setSavingUrl(true)
    try {
      const res: any = await financeApi.setSheetUrl(trimmed)
      showToast.success(`Sheet URL saved (ID: ${res.spreadsheetId.slice(0, 12)}...)`)
      setEditingUrl(false)
      setUrlInput('')
      setResult(null) // Clear stale sync result from previous sheet
      refetchStatus()
    } catch (e: any) {
      showToast.error('Save failed: ' + (e?.message || 'unknown'))
    } finally {
      setSavingUrl(false)
    }
  }

  function startEditUrl() {
    setUrlInput(activeSheetUrl || '')
    setEditingUrl(true)
  }

  async function mapUnmatched(rawName: string, clientId: string) {
    if (!clientId) return
    try {
      const res: any = await financeApi.mapClient(rawName, clientId)
      showToast.success(`Mapped ${res.updated} rows to client`)
      refetchUnmatched()
      if (result) {
        setResult({ ...result, unmatched: result.unmatched.filter(u => u.name !== rawName) })
      }
    } catch (e: any) {
      showToast.error('Map failed: ' + (e?.message || 'unknown'))
    }
  }

  const [autoCreating, setAutoCreating] = useState(false)

  // ── Software Costs sync state ──
  const [swSyncing, setSwSyncing] = useState(false)
  const [swResult, setSwResult] = useState<{
    totalRows: number
    inserted: number
    alreadyExisted: number
    unmatchedDepartments: { name: string; count: number }[]
    lastSyncAt?: string
  } | null>(null)

  async function handleSyncSoftwareCosts() {
    setSwSyncing(true)
    try {
      const res: any = await financeApi.syncSoftwareCosts()
      setSwResult(res)
      showToast.success(`Software costs: ${res.inserted} new, ${res.alreadyExisted} unchanged`)
      qc.invalidateQueries({ queryKey: ['cost-of-effort'] })
    } catch (e: any) {
      showToast.error('Sync failed: ' + (e?.message || 'unknown'))
    } finally {
      setSwSyncing(false)
    }
  }

  async function handleAutoCreate() {
    const totalUnmatched = result?.unmatched?.length ?? persistedUnmatched.length
    if (!totalUnmatched) return
    const confirmed = window.confirm(
      `Create ${totalUnmatched} new clients from the unmatched names and link all their invoices?\n\n` +
      `This is safe to undo — you can merge duplicates later from the Clients tab. Re-running is a no-op.`
    )
    if (!confirmed) return
    setAutoCreating(true)
    try {
      const res: any = await financeApi.autoCreateClients()
      showToast.success(`Created ${res.created} clients, linked ${res.invoicesLinked} invoices`)
      refetchUnmatched()
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client-profitability'] })
      if (result) setResult({ ...result, unmatched: [] })
    } catch (e: any) {
      showToast.error('Auto-create failed: ' + (e?.message || 'unknown'))
    } finally {
      setAutoCreating(false)
    }
  }

  return (
    <div>
      <div className="mb-4">
        <div className="text-lg font-semibold text-primary">Finance Sheet Sync</div>
        <div className="text-sm text-muted">
          Live sync from the NEXA Finance Google Sheet. Reads the <code className="text-accent">Client_Revenue</code> tab
          via a service account. The finance team keeps editing the sheet — NextTrack reads it in the background.
        </div>
      </div>

      {/* ── Integration status card ── */}
      <Card className="p-4 mb-3">
        {!configured ? (
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-status-amber flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-primary mb-1">Not configured</div>
              <div className="text-sm text-muted">
                Set <code className="text-accent">GOOGLE_SHEETS_SERVICE_ACCOUNT_B64</code> in <code>.env.local</code> and
                restart the user service. See the plan in <code>~/.claude/plans/</code> for the one-time setup steps.
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start gap-3 mb-3">
              <CheckCircle size={18} className="text-accent flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-primary">Connected</div>
                <div className="text-xs text-muted mt-0.5">
                  Service account: <code className="text-secondary">{serviceAccountEmail}</code>
                  <span className="ml-1 text-muted">— share your sheet with this email as Viewer.</span>
                </div>
                {financeState?.lastSyncAt && (
                  <div className="text-xs text-muted mt-1">
                    Last synced: <span className="text-secondary">{timeAgo(financeState.lastSyncAt)}</span>
                  </div>
                )}
                {financeState?.lastError && (
                  <div className="text-xs text-status-rose mt-1">Last error: {financeState.lastError}</div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-muted">Currency:</span>
                <Select size="sm" value={defaultCurrency} onChange={e => setDefaultCurrency(e.target.value)} className="w-auto min-w-[80px]">
                  <option value="AED">AED</option>
                  <option value="USD">USD</option>
                  <option value="SAR">SAR</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </Select>
                <Button variant="primary" onClick={handleSync} disabled={syncing || !activeSheetId || editingUrl}>
                  {syncing ? <><Loader2 size={14} className="animate-spin" /> Syncing...</> : <><RefreshCw size={14} /> Sync Now</>}
                </Button>
              </div>
            </div>

            {/* ── Sheet URL config ── */}
            <div className="bg-surface border border-line-subtle rounded p-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Google Sheet</div>
                {!editingUrl && activeSheetId && (
                  <button
                    onClick={startEditUrl}
                    className="text-xs text-accent hover:underline cursor-pointer bg-transparent border-none flex items-center gap-1"
                  >
                    <Pencil size={11} /> Change
                  </button>
                )}
              </div>

              {!editingUrl ? (
                <div>
                  {activeSheetId ? (
                    <>
                      <div className="text-sm text-primary font-medium truncate">
                        {financeState?.sheetTitle || '(not synced yet)'}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <code className="text-xs text-muted truncate">{activeSheetId}</code>
                        {activeSheetUrl && (
                          <a href={activeSheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                            Open <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                      {!financeState?.spreadsheetId && envSheetId && (
                        <div className="text-[11px] text-muted mt-1.5 italic">
                          Using fallback from <code>.env.local</code>. Click Change to override.
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      <div className="text-sm text-status-amber mb-2">No sheet configured yet.</div>
                      <Button variant="primary" size="sm" onClick={startEditUrl}>
                        + Add Sheet URL
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Input
                    autoFocus
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                    className="text-sm font-mono"
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveUrl()
                      if (e.key === 'Escape') { setEditingUrl(false); setUrlInput('') }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button variant="primary" size="sm" onClick={handleSaveUrl} disabled={!urlInput.trim() || savingUrl}>
                      {savingUrl ? <><Loader2 size={12} className="animate-spin" /> Saving...</> : <><Save size={12} /> Save</>}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => { setEditingUrl(false); setUrlInput('') }}>
                      <X size={12} /> Cancel
                    </Button>
                    <span className="text-[11px] text-muted ml-1">
                      Paste any Google Sheets URL or just the sheet ID. Make sure the sheet is shared with the service account.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── Sync result ── */}
      {result && (
        <Card className="p-4 mb-3">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-accent" />
            <span className="font-semibold text-primary">Sync complete</span>
          </div>
          <div className="grid grid-cols-5 gap-3 mb-3">
            <Stat label="Total Rows" value={result.totalRows} />
            <Stat label="Inserted" value={result.inserted} tone="accent" />
            <Stat label="Already Existed" value={result.alreadyExisted} />
            <Stat label="Unmatched Clients" value={result.unmatched.length} tone={result.unmatched.length > 0 ? 'warn' : undefined} />
            <Stat label="Skipped" value={result.skippedNoAmount + result.skippedNoMonth + result.skippedNoClient} />
          </div>
          {(result.skippedNoAmount > 0 || result.skippedNoMonth > 0 || result.skippedNoClient > 0) && (
            <div className="text-xs text-muted">
              Skipped breakdown: {result.skippedNoAmount} without amount, {result.skippedNoMonth} without month, {result.skippedNoClient} without client name
            </div>
          )}
        </Card>
      )}

      {/* ── Software Costs sync ── */}
      {configured && activeSheetId && (
        <Card className="p-4 mb-3">
          <div className="flex items-start gap-3">
            <FileSpreadsheet size={18} className="text-accent flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-primary">Software / Subscription Costs</div>
              <div className="text-xs text-muted mt-0.5">
                Reads the <code className="text-accent">Software_Costs</code> tab from the same Finance Sheet. Unpivots monthly columns
                into per-month rows. Feeds the <b>Cost of Effort</b> report as workspace overhead.
              </div>
            </div>
            <Button variant="primary" onClick={handleSyncSoftwareCosts} disabled={swSyncing} className="flex-shrink-0">
              {swSyncing ? <><Loader2 size={14} className="animate-spin" /> Syncing...</> : <><RefreshCw size={14} /> Sync Software Costs</>}
            </Button>
          </div>
          {swResult && (
            <div className="mt-3 grid grid-cols-4 gap-3">
              <Stat label="Total Rows" value={swResult.totalRows} />
              <Stat label="Inserted" value={swResult.inserted} tone="accent" />
              <Stat label="Already Existed" value={swResult.alreadyExisted} />
              <Stat label="Unmatched Depts" value={swResult.unmatchedDepartments?.length || 0} tone={(swResult.unmatchedDepartments?.length || 0) > 0 ? 'warn' : undefined} />
            </div>
          )}
          {swResult?.unmatchedDepartments && swResult.unmatchedDepartments.length > 0 && (
            <div className="mt-3 text-xs text-muted">
              <b>Unmatched department names:</b>{' '}
              {swResult.unmatchedDepartments.map(d => `${d.name} (${d.count})`).join(', ')}
              <div className="text-[11px] mt-1 italic">
                These rows were still imported — just not linked to a workspace department. They'll show as their raw name in Cost of Effort.
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── Unmatched clients (from latest sync or persisted) ── */}
      {((result?.unmatched?.length ?? 0) > 0 || persistedUnmatched.length > 0) && (
        <Card className="p-4 mb-3">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-start gap-2 flex-1">
              <AlertCircle size={16} className="text-status-amber flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-primary">Unmatched client names</div>
                <div className="text-xs text-muted mt-0.5">
                  These invoice rows were imported but not linked to a client. Map them one-by-one below, or click
                  <b> Create all</b> to auto-create new clients for every unmatched name.
                </div>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAutoCreate}
              disabled={autoCreating}
              className="flex-shrink-0"
            >
              {autoCreating
                ? <><Loader2 size={14} className="animate-spin" /> Creating...</>
                : <>✨ Create all {result?.unmatched?.length ?? persistedUnmatched.length} clients</>}
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_60px_240px] gap-2 px-2 py-1 bg-surface border-b border-line-subtle text-[10px] font-bold uppercase tracking-wider text-muted">
            <div>Raw Name (from sheet)</div>
            <div className="text-right">Rows</div>
            <div>Map to Client</div>
          </div>
          {(result?.unmatched || persistedUnmatched).map(u => (
            <div key={u.name} className="grid grid-cols-[1fr_60px_240px] gap-2 px-2 py-1.5 items-center border-b border-line-subtle last:border-b-0">
              <div className="text-sm text-primary truncate" title={u.name}>{u.name}</div>
              <div className="text-sm text-secondary text-right tabular-nums">{u.count}</div>
              <Combobox
                size="sm"
                value={null}
                onChange={v => { if (v) mapUnmatched(u.name, v as string) }}
                options={clients.map((c: any) => ({ value: c.id as string, label: c.name }))}
                placeholder="Select client…"
                searchPlaceholder="Search clients…"
              />
            </div>
          ))}
          {!result?.unmatched?.length && persistedUnmatched.length === 0 && (
            <EmptyState title="All matched" description="Every imported invoice row is linked to a client." />
          )}
        </Card>
      )}

      {/* ── Fallback: manual xlsx upload (collapsed by default) ── */}
      <Card className="p-0 overflow-hidden">
        <button
          onClick={() => setShowFallback(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 bg-transparent border-none cursor-pointer text-left hover:bg-surface-hover"
        >
          <div className="flex items-center gap-2">
            {showFallback ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="text-sm font-semibold text-secondary">Manual upload (fallback)</span>
            <span className="text-xs text-muted">— use only if the live sync is unavailable</span>
          </div>
        </button>
        {showFallback && <XlsxFallbackSection defaultCurrency={defaultCurrency} onImported={() => { refetchUnmatched(); qc.invalidateQueries({ queryKey: ['client-profitability'] }) }} />}
      </Card>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'accent' | 'warn' }) {
  return (
    <div className="bg-surface border border-line-subtle rounded px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className={cn(
        'text-2xl font-bold tabular-nums',
        tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-status-amber' : 'text-primary',
      )}>{value.toLocaleString()}</div>
    </div>
  )
}

// ── XLSX fallback: parse a .xlsx client-side and post rows to the same backend pipeline
function XlsxFallbackSection({ defaultCurrency, onImported }: { defaultCurrency: string; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [parsed, setParsed] = useState<{ rows: any[]; sheetName: string } | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function handleFile(f: File) {
    setFile(f)
    setParsing(true)
    setParsed(null)
    setResult(null)
    try {
      const XLSX = await loadXLSX()
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const sheetName = wb.SheetNames.includes('Client_Revenue') ? 'Client_Revenue' : wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' })
      let headerRow = -1
      for (let i = 0; i < Math.min(raw.length, 10); i++) {
        if ((raw[i] || []).some((c: any) => typeof c === 'string' && c.trim() === 'Client Name')) {
          headerRow = i
          break
        }
      }
      if (headerRow < 0) {
        showToast.error('Could not find "Client Name" header row')
        setParsing(false)
        return
      }
      const headers: string[] = (raw[headerRow] || []).map((h: any) => String(h || '').trim())
      const colIdx: Record<string, number> = {}
      for (const [key, candidates] of Object.entries(COL_MAP)) {
        for (const label of candidates) {
          const idx = headers.indexOf(label)
          if (idx >= 0) { colIdx[key] = idx; break }
        }
      }
      const rows: any[] = []
      for (let i = headerRow + 1; i < raw.length; i++) {
        const r = raw[i] || []
        // Skip rows with no client name in either column R or column D
        if (!r[colIdx.client_name_mapped] && !r[colIdx.client_name_finance]) continue
        const obj: any = {}
        for (const [key, idx] of Object.entries(colIdx)) obj[key] = r[idx]
        rows.push(obj)
      }
      if (!rows.length) {
        showToast.error('No data rows found')
        setParsing(false)
        return
      }
      setParsed({ rows, sheetName })
    } catch (e: any) {
      showToast.error('Parse failed: ' + (e?.message || 'unknown'))
    } finally {
      setParsing(false)
    }
  }

  async function handleImport() {
    if (!parsed?.rows?.length) return
    setImporting(true)
    try {
      const res: ImportResult = await financeApi.importSheet({ rows: parsed.rows, defaultCurrency })
      setResult(res)
      showToast.success(`Imported ${res.inserted} new rows`)
      onImported()
    } catch (e: any) {
      showToast.error('Import failed: ' + (e?.message || 'unknown'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="p-4 border-t border-line-subtle">
      <div className="flex items-center gap-3">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={parsing}>
          {parsing ? <><Loader2 size={14} className="animate-spin" /> Parsing...</> : <><FileSpreadsheet size={14} /> Select .xlsx file</>}
        </Button>
        {file && (
          <div className="text-sm text-secondary">
            <span className="font-semibold text-primary">{file.name}</span>
            {parsed && <span className="text-muted ml-2">· {parsed.rows.length} rows</span>}
          </div>
        )}
      </div>
      {parsed && !result && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" onClick={handleImport} disabled={importing}>
            {importing ? <><Loader2 size={14} className="animate-spin" /> Importing...</> : <><Upload size={14} /> Import {parsed.rows.length} rows</>}
          </Button>
          <span className="text-xs text-muted">Safe to re-run — duplicates are skipped.</span>
        </div>
      )}
      {result && (
        <div className="mt-3 grid grid-cols-5 gap-2 text-xs">
          <Stat label="Total" value={result.totalRows} />
          <Stat label="Inserted" value={result.inserted} tone="accent" />
          <Stat label="Existed" value={result.alreadyExisted} />
          <Stat label="Unmatched" value={result.unmatched.length} tone={result.unmatched.length > 0 ? 'warn' : undefined} />
          <Stat label="Skipped" value={result.skippedNoAmount + result.skippedNoMonth + result.skippedNoClient} />
        </div>
      )}
    </div>
  )
}
