'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { slackApi } from '@/lib/queries'
import { showToast } from '@/components/Toast'
import { Card, Button, Select } from '@/components/ui'
import { Loader2, CheckCircle, XCircle, ExternalLink, Hash, MessageSquare } from 'lucide-react'
import { useSearchParams } from 'next/navigation'

export default function IntegrationsPage() {
  const qc = useQueryClient()
  const searchParams = useSearchParams()

  // Show toast from callback redirect
  useEffect(() => {
    const slackParam = searchParams.get('slack')
    if (slackParam === 'connected') {
      showToast.success('Slack connected successfully!')
      window.history.replaceState({}, '', '/settings/integrations')
    } else if (slackParam === 'error') {
      const reason = searchParams.get('reason') || 'unknown'
      showToast.error(`Slack connection failed: ${reason}`)
      window.history.replaceState({}, '', '/settings/integrations')
    }
  }, [searchParams])

  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['slack-status'],
    queryFn: () => slackApi.status(),
    staleTime: 10_000,
  })

  // Separate probe — returns `{ configured: true|false }` based on whether the
  // server has real SLACK_CLIENT_ID/SECRET (not the "REPLACE_WITH_*" template
  // placeholder). When false, the Connect button is disabled with instructions
  // so users don't bounce to a broken Slack OAuth screen.
  const { data: configData } = useQuery({
    queryKey: ['slack-configured'],
    queryFn: () => slackApi.configured(),
    staleTime: 60_000,
  })
  const slackConfigured: boolean = configData?.configured ?? true

  const connected = statusData?.connected || false
  const teamName = statusData?.teamName || ''
  const channelName = statusData?.channelName || ''
  const channelId = statusData?.channelId || ''

  // Channel picker
  const [showChannels, setShowChannels] = useState(false)
  const { data: channelsData, isLoading: channelsLoading } = useQuery({
    queryKey: ['slack-channels'],
    queryFn: () => slackApi.channels().then((r: any) => r.data),
    enabled: connected && showChannels,
    staleTime: 30_000,
  })
  const channels: any[] = channelsData || []

  const [connecting, setConnecting] = useState(false)
  const [testing, setTesting] = useState(false)

  async function handleConnect() {
    setConnecting(true)
    try {
      const res: any = await slackApi.getAuthUrl()
      if (res?.url) {
        window.location.href = res.url
      } else {
        showToast.error('Could not get Slack authorization URL.')
      }
    } catch (e: any) {
      showToast.error('Failed: ' + (e?.message || 'unknown'))
    } finally {
      setConnecting(false)
    }
  }

  async function handleSetChannel(chId: string) {
    const ch = channels.find((c: any) => c.id === chId)
    if (!ch) return
    try {
      await slackApi.setChannel(ch.id, ch.name)
      showToast.success(`Channel set to #${ch.name}`)
      qc.invalidateQueries({ queryKey: ['slack-status'] })
    } catch (e: any) {
      showToast.error('Failed: ' + (e?.message || 'unknown'))
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      await slackApi.sendTest()
      showToast.success('Test message sent to Slack!')
    } catch (e: any) {
      showToast.error('Failed: ' + (e?.message || 'unknown'))
    } finally {
      setTesting(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Slack? Notifications will stop going to Slack.')) return
    try {
      await slackApi.disconnect()
      showToast.success('Slack disconnected')
      qc.invalidateQueries({ queryKey: ['slack-status'] })
    } catch (e: any) {
      showToast.error('Failed: ' + (e?.message || 'unknown'))
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-[720px]">
      <h2 className="text-lg font-semibold text-primary">Integrations</h2>

      {/* Slack Card */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          {/* Slack Logo */}
          <div className="w-12 h-12 rounded-lg bg-[#4A154B] flex items-center justify-center flex-shrink-0">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#fff"/>
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-primary">Slack</h3>
                <p className="text-sm text-muted mt-0.5">
                  {connected
                    ? `Connected to ${teamName}`
                    : 'Send budget alerts, timesheet reminders, and digests to a Slack channel.'
                  }
                </p>
              </div>
              {connected && (
                <div className="flex items-center gap-1.5 text-xs text-status-profit">
                  <CheckCircle size={14} /> Connected
                </div>
              )}
            </div>

            {statusLoading ? (
              <div className="mt-4 text-sm text-muted flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : !connected ? (
              <div className="mt-4">
                {slackConfigured ? (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={connecting}
                    onClick={handleConnect}
                  >
                    {connecting ? 'Connecting...' : 'Connect Slack'}
                  </Button>
                ) : (
                  <div className="rounded-md border border-status-amber/30 bg-status-amber/10 text-status-amber px-3 py-2 text-xs">
                    <div className="font-semibold text-sm mb-1">Slack is not configured on this server</div>
                    <div className="text-secondary leading-relaxed">
                      Set <code className="text-accent">SLACK_CLIENT_ID</code> and <code className="text-accent">SLACK_CLIENT_SECRET</code> in the server env,
                      then restart the auth service.
                      Create an app at{' '}
                      <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="underline text-accent">api.slack.com/apps</a>.
                    </div>
                    <Button variant="secondary" size="sm" className="mt-2" disabled>
                      Connect Slack (unavailable)
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {/* Channel selection */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-sm text-secondary">
                    <Hash size={14} className="text-muted" />
                    {channelName ? (
                      <span className="font-medium">{channelName}</span>
                    ) : (
                      <span className="text-muted italic">No channel selected</span>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setShowChannels(s => !s)}>
                    {channelName ? 'Change' : 'Select Channel'}
                  </Button>
                </div>

                {showChannels && (
                  <div className="bg-surface border border-line-subtle rounded-md p-3">
                    {channelsLoading ? (
                      <div className="text-sm text-muted flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" /> Loading channels...
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {channels.map((ch: any) => (
                          <button
                            key={ch.id}
                            onClick={() => { handleSetChannel(ch.id); setShowChannels(false) }}
                            className={`w-full text-left px-2.5 py-1.5 rounded text-sm cursor-pointer transition-colors hover:bg-surface-hover ${ch.id === channelId ? 'bg-accent-dim text-accent font-medium' : 'text-secondary'}`}
                          >
                            <Hash size={12} className="inline mr-1 opacity-50" />{ch.name}
                          </button>
                        ))}
                        {channels.length === 0 && (
                          <p className="text-sm text-muted">No channels found. Make sure the bot is invited to at least one channel.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={testing}
                    disabled={!channelId}
                    onClick={handleTest}
                  >
                    <MessageSquare size={14} /> Send Test
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleDisconnect}>
                    <XCircle size={14} /> Disconnect
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
