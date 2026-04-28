'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/lib/queries'
import { Card, Button, Badge, Skeleton } from '@/components/ui'
import { formatDistanceToNow } from 'date-fns'

type EntityResult = { pulled: number; changed: number; upserted: number; errors: number }
type EntityStatus = { lastSyncAt?: string; lastResult?: EntityResult; lastError?: string | null }

function EntityRow({ name, status }: { name: string; status: EntityStatus | null }) {
  const r = status?.lastResult
  const err = status?.lastError
  return (
    <div className="grid grid-cols-[180px_1fr_1fr_100px] items-center py-2 border-b border-line-subtle last:border-0">
      <div className="font-medium text-primary capitalize">{name.replace('_', ' ')}</div>
      <div className="text-sm text-secondary">
        {status?.lastSyncAt ? `synced ${formatDistanceToNow(new Date(status.lastSyncAt), { addSuffix: true })}` : 'never synced'}
      </div>
      <div className="text-xs text-muted font-mono">
        {r ? `${r.pulled} pulled · ${r.changed} changed · ${r.upserted} upserted${r.errors ? ` · ${r.errors} errors` : ''}` : '—'}
      </div>
      <div>
        {err ? <Badge variant="danger">error</Badge>
          : r?.errors ? <Badge variant="warning">partial</Badge>
          : r ? <Badge variant="success">ok</Badge>
          : <Badge variant="default">pending</Badge>}
      </div>
    </div>
  )
}

export default function ForecastSync() {
  const qc = useQueryClient()
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  const { data: status, isLoading } = useQuery({
    queryKey: ['forecast-sync-status'],
    queryFn: () => usersApi.syncStatus().then((r: any) => r.data),
    refetchInterval: 10_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['forecast-sync-status'] })

  const runNow     = useMutation({ mutationFn: () => usersApi.syncRunNow(),     onSettled: invalidate })
  const pause      = useMutation({ mutationFn: () => usersApi.syncPause(),      onSettled: invalidate })
  const resume     = useMutation({ mutationFn: () => usersApi.syncResume(),     onSettled: invalidate })
  const disconnect = useMutation({
    mutationFn: () => usersApi.syncDisconnect(),
    onSettled: () => { invalidate(); setConfirmingDisconnect(false) },
  })

  const entities = status?.entities || {}
  const hasKey = !!status?.hasKey
  const paused = !!status?.paused
  const enabled = !!status?.enabled
  const inProgress = !!status?.inProgress || runNow.isPending

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-primary">Live Forecast.it Sync</h2>
          </div>
          <div className="flex items-center gap-2">
            {paused ? (
              <Button onClick={() => resume.mutate()} disabled={resume.isPending} variant="primary">
                {resume.isPending ? 'Resuming…' : 'Resume sync'}
              </Button>
            ) : (
              <>
                <Button onClick={() => runNow.mutate()} disabled={!enabled || inProgress} variant="primary">
                  {inProgress ? 'Syncing…' : 'Sync Now'}
                </Button>
                <Button onClick={() => pause.mutate()} disabled={!hasKey || pause.isPending} variant="secondary">
                  {pause.isPending ? 'Pausing…' : 'Pause sync'}
                </Button>
              </>
            )}
            <Button onClick={() => setConfirmingDisconnect(true)} disabled={!hasKey || disconnect.isPending} variant="danger">
              Disconnect
            </Button>
          </div>
        </div>

        {paused && (
          <div className="text-sm text-status-amber bg-status-amber-dim rounded px-3 py-2 mb-3">
            Sync is paused. The scheduler will skip this workspace until you resume. Last-run history is preserved.
          </div>
        )}

        {!hasKey && (
          <div className="text-sm text-status-rose bg-status-rose-dim rounded px-3 py-2 mb-3">
            No Forecast.it API key is configured. Set <code className="font-mono">FORECAST_API_KEY</code> in <code className="font-mono">.env.local</code> and restart user-service, or contact engineering to provision a per-workspace key.
          </div>
        )}

        {runNow.error && (
          <div className="text-sm text-status-rose bg-status-rose-dim rounded px-3 py-2 mb-3">
            {(runNow.error as any)?.message || 'Sync failed'}
          </div>
        )}

        <div className="border-t border-line-subtle pt-2">
          {isLoading && (
            <div className="space-y-3 py-3">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="grid grid-cols-[180px_1fr_1fr_100px] items-center gap-3 py-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-36" />
                  <Skeleton className="h-3 w-52" />
                  <Skeleton className="h-5 w-14 rounded" />
                </div>
              ))}
            </div>
          )}
          {!isLoading && (
            <>
              <EntityRow name="persons"      status={entities.persons      || null} />
              <EntityRow name="clients"      status={entities.clients      || null} />
              <EntityRow name="projects"     status={entities.projects     || null} />
              <EntityRow name="time_entries" status={entities.time_entries || null} />
            </>
          )}
        </div>
      </Card>

      {confirmingDisconnect && (
        <Card className="p-5 border border-status-rose">
          <h3 className="text-sm font-semibold text-primary mb-1">Disconnect Forecast.it?</h3>
          <p className="text-sm text-secondary mb-3">
            This disables the 5-min scheduler and clears the stored sync cursor. Existing data in Momentum stays put — only the live pull stops. Use this when the Forecast.it subscription has ended. You can reconnect later by restoring the API key and pressing Resume.
          </p>
          <div className="flex items-center gap-2">
            <Button onClick={() => disconnect.mutate()} disabled={disconnect.isPending} variant="danger">
              {disconnect.isPending ? 'Disconnecting…' : 'Yes, disconnect'}
            </Button>
            <Button onClick={() => setConfirmingDisconnect(false)} variant="secondary">Cancel</Button>
          </div>
        </Card>
      )}

      <Card className="p-5 bg-surface-overlay">
        <h3 className="text-sm font-semibold text-primary mb-2">What syncs automatically</h3>
        <ul className="text-sm text-secondary space-y-1 list-disc ml-5">
          <li><strong>Persons, clients, projects</strong>: full pull every 5 min, but only changed rows (by <code>updated_at</code>) are written back. So a normal cycle is fast.</li>
          <li><strong>Time entries</strong>: Forecast.it supports server-side <code>updated_after</code> on this endpoint, so each cycle fetches only entries changed since the last sync.</li>
          <li>Tasks, phases, departments, roles, and rate cards are <strong>not</strong> synced by this job yet. Use "Import Forecast" for a full one-time catch-up.</li>
          <li>Sync is <strong>one-way</strong>: Forecast.it → Momentum. Edits made in Momentum are not pushed back.</li>
        </ul>
      </Card>
    </div>
  )
}
