'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { slackApi, emailApi, gdriveApi } from '@/lib/queries'
import { showToast } from '@/components/Toast'
import { Card, Button, Select } from '@/components/ui'
import { Loader2, CheckCircle, XCircle, ExternalLink, Hash, MessageSquare, Send } from 'lucide-react'
import { useSearchParams } from 'next/navigation'

// Brand-correct Gmail logo (4-color envelope) — replaces the previous
// gradient + Lucide <Mail> icon which read as generic.
function GmailLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 193" xmlns="http://www.w3.org/2000/svg">
      <path d="M58.182 192.05V93.14L27.507 65.077 0 49.504v125.091c0 9.658 7.825 17.455 17.455 17.455h40.727z" fill="#4285F4"/>
      <path d="M197.818 192.05h40.727c9.659 0 17.455-7.826 17.455-17.455V49.505l-31.156 17.837-27.027 25.798v98.91z" fill="#34A853"/>
      <path d="M58.182 93.14l-4.174-38.647 4.174-36.989L128 69.868l69.818-52.364 4.669 33.61-4.669 42.026L128 145.504z" fill="#EA4335"/>
      <path d="M197.818 17.504V93.14L256 49.504V26.231c0-21.585-24.64-33.89-41.89-20.945l-16.292 12.218z" fill="#FBBC04"/>
      <path d="M0 49.504l26.759 20.07L58.182 93.14V17.504L41.89 5.286C24.61-7.66 0 4.646 0 26.23v23.273z" fill="#C5221F"/>
    </svg>
  )
}

// Brand-correct 4-color Slack logo — replaces the prior single-color
// white-on-purple variant.
function SlackLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
      <path d="M99.4,151.2c0,7.5-6.2,13.7-13.7,13.7s-13.7-6.2-13.7-13.7s6.2-13.7,13.7-13.7h13.7V151.2z M106.3,151.2c0-7.5,6.2-13.7,13.7-13.7s13.7,6.2,13.7,13.7v34.3c0,7.5-6.2,13.7-13.7,13.7s-13.7-6.2-13.7-13.7V151.2z" fill="#E01E5A"/>
      <path d="M120,96.4c-7.5,0-13.7-6.2-13.7-13.7s6.2-13.7,13.7-13.7s13.7,6.2,13.7,13.7v13.7H120z M120,103.4c7.5,0,13.7,6.2,13.7,13.7s-6.2,13.7-13.7,13.7H85.6c-7.5,0-13.7-6.2-13.7-13.7s6.2-13.7,13.7-13.7H120z" fill="#36C5F0"/>
      <path d="M174.7,117.1c0-7.5,6.2-13.7,13.7-13.7s13.7,6.2,13.7,13.7s-6.2,13.7-13.7,13.7h-13.7V117.1z M167.8,117.1c0,7.5-6.2,13.7-13.7,13.7c-7.5,0-13.7-6.2-13.7-13.7V82.7c0-7.5,6.2-13.7,13.7-13.7c7.5,0,13.7,6.2,13.7,13.7V117.1z" fill="#2EB67D"/>
      <path d="M154.1,171.9c7.5,0,13.7,6.2,13.7,13.7s-6.2,13.7-13.7,13.7c-7.5,0-13.7-6.2-13.7-13.7v-13.7H154.1z M154.1,164.9c-7.5,0-13.7-6.2-13.7-13.7s6.2-13.7,13.7-13.7h34.3c7.5,0,13.7,6.2,13.7,13.7s-6.2,13.7-13.7,13.7H154.1z" fill="#ECB22E"/>
    </svg>
  )
}

// Brand-correct Google Drive 3-color triangular logo. Mirrors the
// official Drive icon (yellow / green / blue trapezoids).
function DriveLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  )
}

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

    const gdriveParam = searchParams.get('gdrive')
    if (gdriveParam === 'connected') {
      showToast.success('Google Drive connected — exports will land in your Drive.')
      qc.invalidateQueries({ queryKey: ['gdrive-status'] })
      window.history.replaceState({}, '', '/settings/integrations')
    } else if (gdriveParam === 'error') {
      const reason = searchParams.get('reason') || 'unknown'
      // access_denied = user clicked Cancel on Google's consent screen.
      // Show a softer message in that case so it doesn't read like a bug.
      const msg = reason === 'access_denied'
        ? 'Google Drive connection cancelled.'
        : `Google Drive connection failed: ${reason}`
      showToast.error(msg)
      window.history.replaceState({}, '', '/settings/integrations')
    }
  }, [searchParams, qc])

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
  const [testingDM, setTestingDM] = useState(false)

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

  async function handleTestDM() {
    setTestingDM(true)
    try {
      await slackApi.sendTestDM()
      showToast.success('Test DM sent — check your Slack messages.')
    } catch (e: any) {
      // The API returns a friendly NOT_IN_SLACK code when the user's email
      // isn't in the connected workspace. Surface that message verbatim.
      const apiMsg = e?.response?.data?.errors?.[0]?.message || e?.message || 'unknown'
      showToast.error('Failed: ' + apiMsg)
    } finally {
      setTestingDM(false)
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

  // ── Google Drive (per-user OAuth) ─────────────────────────────────────────
  const { data: gdriveStatus, isLoading: gdriveLoading } = useQuery({
    queryKey: ['gdrive-status'],
    queryFn:  () => gdriveApi.status(),
    staleTime: 10_000,
  })
  const gdriveConnected   = gdriveStatus?.connected || false
  const gdriveEmail       = gdriveStatus?.grantedEmail || ''

  const [gdriveConnecting, setGdriveConnecting] = useState(false)

  async function handleGdriveConnect() {
    setGdriveConnecting(true)
    try {
      const res: any = await gdriveApi.getAuthUrl()
      if (res?.url) {
        window.location.href = res.url
      } else {
        showToast.error('Could not get Google authorization URL.')
      }
    } catch (e: any) {
      const apiMsg = e?.response?.data?.errors?.[0]?.message || e?.message || 'unknown'
      showToast.error('Failed: ' + apiMsg)
    } finally {
      setGdriveConnecting(false)
    }
  }

  async function handleGdriveDisconnect() {
    if (!confirm('Disconnect Google Drive? Future exports will require reconnecting.')) return
    try {
      await gdriveApi.disconnect()
      showToast.success('Google Drive disconnected')
      qc.invalidateQueries({ queryKey: ['gdrive-status'] })
    } catch (e: any) {
      showToast.error('Failed: ' + (e?.message || 'unknown'))
    }
  }

  const [testingEmail, setTestingEmail] = useState(false)
  async function handleTestEmail() {
    setTestingEmail(true)
    try {
      const res: any = await emailApi.sendTestReminder()
      const sentTo  = res?.data?.sentTo || res?.sentTo
      const week    = res?.data?.weekLabel || res?.weekLabel
      showToast.success(`Test reminder sent${sentTo ? ` to ${sentTo}` : ''}${week ? ` for week of ${week}` : ''} — check your inbox.`)
    } catch (e: any) {
      const apiMsg = e?.response?.data?.errors?.[0]?.message || e?.message || 'unknown'
      showToast.error('Could not send test email: ' + apiMsg)
    } finally {
      setTestingEmail(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 w-full">
      <h2 className="text-lg font-semibold text-primary">Integrations</h2>

      {/* Email Card — reminders go out from a Momentum-owned sender via
          SendGrid (configured server-side). There's nothing for the
          end user to "connect" — they already receive mail at their
          own inbox — so this card just surfaces what's running and
          lets the admin preview the production template. */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center flex-shrink-0 border border-line-subtle">
            <GmailLogo size={26} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-primary">Email reminders</h3>
                <p className="text-sm text-muted mt-0.5">
                  Sent every Monday morning to anyone whose previous-week timesheet is missing.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-status-profit">
                <CheckCircle size={14} /> Active
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <Button
                variant="primary"
                size="sm"
                loading={testingEmail}
                onClick={handleTestEmail}
              >
                {testingEmail ? 'Sending…' : <><Send size={14} className="inline mr-1.5" />Send test reminder to me</>}
              </Button>
              <span className="text-xs text-muted">
                Previews the production email template using your account.
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Google Drive Card — per-user OAuth so each user's "Export to
          Sheets" lands in *their* Drive. The workspace's existing
          service-account export (used for the finance sync sheet) is
          unrelated to this connection. */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center flex-shrink-0 border border-line-subtle">
            <DriveLogo size={26} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-primary">Google Drive</h3>
                <p className="text-sm text-muted mt-0.5">
                  {gdriveConnected
                    ? `Connected as ${gdriveEmail || 'your Google account'}`
                    : 'Connect your Drive so exported reports land directly in your own Drive as Google Sheets.'}
                </p>
              </div>
              {gdriveConnected && (
                <div className="flex items-center gap-1.5 text-xs text-status-profit">
                  <CheckCircle size={14} /> Connected
                </div>
              )}
            </div>

            {gdriveLoading ? (
              <div className="mt-4 text-sm text-muted flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : !gdriveConnected ? (
              <div className="mt-4">
                <Button
                  variant="primary"
                  size="sm"
                  loading={gdriveConnecting}
                  onClick={handleGdriveConnect}
                >
                  {gdriveConnecting ? 'Connecting...' : 'Connect Google Drive'}
                </Button>
                <p className="text-xs text-muted mt-2">
                  Momentum will only see files it creates on your behalf — never your other Drive content.
                </p>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={handleGdriveDisconnect}>
                  <XCircle size={14} /> Disconnect
                </Button>
                <span className="text-xs text-muted">
                  Reports you export from now on will appear in your Drive.
                </span>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Slack Card */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          {/* Real 4-color Slack logo on a neutral white tile so the
              brand colors render correctly (replaces the previous
              white-on-purple monochrome variant). */}
          <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center flex-shrink-0 border border-line-subtle">
            <SlackLogo size={26} />
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
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={testingDM}
                    onClick={handleTestDM}
                    title="Sends a DM to your Slack account using the email on your Momentum profile."
                  >
                    <MessageSquare size={14} /> Send Test DM to me
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
