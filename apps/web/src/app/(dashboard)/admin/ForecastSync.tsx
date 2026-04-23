'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/lib/queries'
import { Card, Button, Badge } from '@/components/ui'
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
  const { data: status, isLoading } = useQuery({
    queryKey: ['forecast-sync-status'],
    queryFn: () => usersApi.syncStatus().then((r: any) => r.data),
    refetchInterval: 10_000,  // refresh every 10s so user sees progress
  })

  const runNow = useMutation({
    mutationFn: () => usersApi.syncRunNow(),
    onSettled: () => qc.invalidateQueries({ queryKey: ['forecast-sync-status'] }),
  })

  const entities = status?.entities || {}
  const enabled = !!status?.enabled
  const inProgress = !!status?.inProgress || runNow.isPending

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-primary">Live Forecast.it Sync</h2>
            <p className="text-sm text-secondary mt-1">
              Pulls changes from Forecast.it every 5 minutes. Safe to run alongside normal editing.
            </p>
          </div>
          <Button onClick={() => runNow.mutate()} disabled={!enabled || inProgress} variant="primary">
            {inProgress ? 'Syncing…' : 'Sync Now'}
          </Button>
        </div>

        {!enabled && (
          <div className="text-sm text-status-rose bg-status-rose-dim rounded px-3 py-2 mb-3">
            FORECAST_API_KEY is not configured. Set it in <code className="font-mono">.env.local</code> and restart user-service.
          </div>
        )}

        {runNow.error && (
          <div className="text-sm text-status-rose bg-status-rose-dim rounded px-3 py-2 mb-3">
            {(runNow.error as any)?.message || 'Sync failed'}
          </div>
        )}

        <div className="border-t border-line-subtle pt-2">
          {isLoading && <div className="text-sm text-muted py-4">Loading status…</div>}
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

      <Card className="p-5 bg-surface-overlay">
        <h3 className="text-sm font-semibold text-primary mb-2">What syncs automatically</h3>
        <ul className="text-sm text-secondary space-y-1 list-disc ml-5">
          <li><strong>Persons, clients, projects</strong>: full pull every 5 min, but only changed rows (by <code>updated_at</code>) are written back. So a normal cycle is fast.</li>
          <li><strong>Time entries</strong>: Forecast.it supports server-side <code>updated_after</code> on this endpoint, so each cycle fetches only entries changed since the last sync.</li>
          <li>Tasks, phases, departments, roles, and rate cards are <strong>not</strong> synced by this job yet. Use "Import Forecast" for a full one-time catch-up.</li>
          <li>Sync is <strong>one-way</strong>: Forecast.it → NextTrack. Edits made in NextTrack are not pushed back.</li>
        </ul>
      </Card>
    </div>
  )
}
