import { useState } from "react"
import { dataApi } from "@/api/data"
import { useChannels } from "@/hooks/use-channels"
import type { ProcessResponse, ProfileResult } from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { JsonViewer } from "@/components/shared/json-viewer"
import { Send } from "lucide-react"

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "--"
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`
}

function ProfilePanel({ profile }: { profile: ProfileResult }) {
  const total = profile.request_total_ms ?? profile.totals_ms
  const byFunction = Object.entries(profile.by_function ?? {})
  const byConnector = Object.entries(profile.by_connector ?? {})

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          Request Profile
          <span className="text-xs font-normal text-muted-foreground">total {fmtMs(total)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {profile.phases && profile.phases.length > 0 && (
          <div className="space-y-1.5">
            {profile.phases.map((p) => (
              <div key={p.name}>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{p.name}</span>
                  <span>{fmtMs(p.ms)} ({p.pct.toFixed(1)}%)</span>
                </div>
                <div className="mt-0.5 h-1.5 w-full rounded bg-muted">
                  <div
                    className="h-1.5 rounded bg-primary"
                    style={{ width: `${Math.min(100, p.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {byFunction.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">By Function</h4>
            <div className="space-y-1">
              {byFunction.map(([name, agg]) => (
                <div key={name} className="flex justify-between text-xs">
                  <span className="font-mono">{name}</span>
                  <span>{agg.count}× · {fmtMs(agg.total_ms)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {byConnector.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">By Connector</h4>
            <div className="space-y-1">
              {byConnector.map(([name, agg]) => (
                <div key={name} className="flex justify-between text-xs">
                  <span className="font-mono">{name}</span>
                  <span>{agg.count}× · {fmtMs(agg.total_ms)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ConsolePage() {
  const [channel, setChannel] = useState("")
  const [payload, setPayload] = useState('{\n  \n}')
  const [sync, setSync] = useState(true)
  const [profile, setProfile] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProcessResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: channels } = useChannels({ limit: 200 })
  const channelList = channels?.data ?? []

  const profileResult = result?._orion?.profile

  const handleSend = async () => {
    setError(null)
    setResult(null)

    if (!channel.trim()) {
      setError("Channel name is required")
      return
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(payload)
    } catch {
      setError("Invalid JSON payload")
      return
    }

    setLoading(true)
    try {
      const res = sync
        ? await dataApi.processSync(channel, { data }, profile)
        : await dataApi.processAsync(channel, { data })
      setResult(res as ProcessResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Data Console" description="Send test requests to channels" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Channel</label>
              <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">Select a channel...</option>
                {channelList.map((c) => (
                  <option key={c.channel_id} value={c.name}>
                    {c.name} ({c.channel_type}/{c.protocol}{c.status !== "active" ? ` · ${c.status}` : ""})
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">JSON Payload</label>
              <Textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={12}
                className="font-mono text-sm"
                placeholder='{ "key": "value" }'
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sync}
                  onChange={(e) => setSync(e.target.checked)}
                  className="rounded"
                />
                Synchronous
              </label>
              <Badge variant="outline">{sync ? "Sync" : "Async"}</Badge>
              {sync && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={profile}
                    onChange={(e) => setProfile(e.target.checked)}
                    className="rounded"
                  />
                  Profile
                </label>
              )}
            </div>

            <Button onClick={handleSend} disabled={loading} className="w-full">
              <Send className="h-4 w-4" />
              {loading ? "Sending..." : "Send"}
            </Button>

            {profile && (
              <p className="text-xs text-muted-foreground">
                Profiling requires <code>tracing.debug_profile_enabled</code> on the server.
              </p>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Response</CardTitle>
            </CardHeader>
            <CardContent>
              {result ? (
                <JsonViewer data={result} maxHeight="500px" />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Send a request to see the response here.
                </p>
              )}
            </CardContent>
          </Card>

          {profileResult && <ProfilePanel profile={profileResult} />}
        </div>
      </div>
    </div>
  )
}
