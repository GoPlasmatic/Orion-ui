import { useState } from "react"
import { Link } from "react-router"
import { dataApi } from "@/api/data"
import { useChannels } from "@/hooks/use-channels"
import type { Channel, ProcessResponse, ProfileResult } from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/shared/page-header"
import { JsonViewer } from "@/components/shared/json-viewer"
import { formatDate } from "@/lib/utils"
import { ExternalLink, Send } from "lucide-react"

const SAMPLE_PAYLOAD = '{\n  "example": "value"\n}'
const isBlankPayload = (p: string) => {
  const compact = p.replace(/\s/g, "")
  return compact === "" || compact === "{}"
}

const REST_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]
// Verbs sent without a request body (fetch forbids GET/HEAD bodies).
const BODYLESS = new Set(["GET", "HEAD"])

/** REST-routed channels (route_pattern + rest/http) are invoked by method+path. */
const isRestChannel = (c: Channel | undefined): c is Channel =>
  !!c?.route_pattern && (c.protocol === "rest" || c.protocol === "http")

interface HistoryEntry {
  channel: string
  payload: string
  sync: boolean
  method?: string
  path?: string
  status?: string
  traceId?: string
  at: string
}

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
  const [method, setMethod] = useState("POST")
  const [path, setPath] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProcessResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  const { data: channels } = useChannels({ limit: 200 })
  const channelList = channels?.data ?? []

  const selected = channelList.find((c) => c.name === channel)
  const restMode = isRestChannel(selected)
  const bodyless = restMode && BODYLESS.has(method)

  const profileResult = result?._orion?.profile
  const traceId = result?.id

  // Pre-fill a starter payload when a channel is picked and the editor is empty;
  // seed method/path from the channel's REST route when it has one.
  const onChannelChange = (value: string) => {
    setChannel(value)
    if (value && isBlankPayload(payload)) setPayload(SAMPLE_PAYLOAD)
    const next = channelList.find((c) => c.name === value)
    if (isRestChannel(next)) {
      setPath(next.route_pattern ?? "")
      const allowed = (next.methods ?? []).map((m) => m.toUpperCase())
      setMethod(allowed.length > 0 ? allowed[0] : "POST")
      setSync(true)
    }
  }

  const restore = (h: HistoryEntry) => {
    setChannel(h.channel)
    setPayload(h.payload)
    setSync(h.sync)
    if (h.method) setMethod(h.method)
    if (h.path) setPath(h.path)
  }

  const handleSend = async () => {
    setError(null)
    setResult(null)

    if (!channel.trim()) {
      setError("Channel name is required")
      return
    }

    if (restMode && /[{}]/.test(path)) {
      setError("Replace the {parameters} in the path with concrete values")
      return
    }

    let data: Record<string, unknown> | undefined
    if (restMode && bodyless) {
      data = undefined
    } else {
      try {
        data = JSON.parse(payload)
      } catch {
        setError("Invalid JSON payload")
        return
      }
    }

    setLoading(true)
    try {
      const res = restMode
        ? await dataApi.processRest(method, path, data !== undefined ? { data } : undefined, profile)
        : sync
          ? await dataApi.processSync(channel, { data: data ?? {} }, profile)
          : await dataApi.processAsync(channel, { data: data ?? {} })
      const typed = res as ProcessResponse
      setResult(typed)
      setHistory((prev) =>
        [
          {
            channel,
            payload,
            sync: restMode ? true : sync,
            method: restMode ? method : undefined,
            path: restMode ? path : undefined,
            status: typed.status,
            traceId: typed.id,
            at: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 8)
      )
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
              <Select value={channel} onChange={(e) => onChannelChange(e.target.value)}>
                <option value="">Select a channel...</option>
                {channelList.map((c) => (
                  <option key={c.channel_id} value={c.name}>
                    {c.name} ({c.channel_type}/{c.protocol}{c.status !== "active" ? ` · ${c.status}` : ""})
                  </option>
                ))}
              </Select>
            </div>

            {restMode && (
              <div className="flex gap-2">
                <div className="w-32">
                  <label className="mb-1 block text-sm font-medium">Method</label>
                  <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                    {((selected?.methods?.length ?? 0) > 0
                      ? selected!.methods!.map((m) => m.toUpperCase())
                      : REST_METHODS
                    ).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </Select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-sm font-medium">Path</label>
                  <Input
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    className="font-mono"
                    placeholder={selected?.route_pattern ?? "/orders/42"}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Route pattern: <code>{selected?.route_pattern}</code> — replace{" "}
                    {"{parameters}"} with concrete values.
                  </p>
                </div>
              </div>
            )}

            {!bodyless && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm font-medium">JSON Payload</label>
                  <button
                    type="button"
                    onClick={() => setPayload(SAMPLE_PAYLOAD)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Insert sample
                  </button>
                </div>
                <Textarea
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                  placeholder='{ "key": "value" }'
                />
              </div>
            )}

            <div className="flex items-center gap-4">
              {restMode ? (
                <Badge variant="outline">REST · Sync</Badge>
              ) : (
                <>
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
                </>
              )}
              {(restMode || sync) && (
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
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Response
                {traceId && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/traces/${traceId}`}>
                      <ExternalLink className="h-3.5 w-3.5" /> Open as trace
                    </Link>
                  </Button>
                )}
              </CardTitle>
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

          {history.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Recent requests</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {history.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <button
                      type="button"
                      onClick={() => restore(h)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {h.method ?? (h.sync ? "Sync" : "Async")}
                      </Badge>
                      <span className="truncate font-medium">{h.path ?? h.channel}</span>
                      {h.status && (
                        <span className="shrink-0 text-xs text-muted-foreground">{h.status}</span>
                      )}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatDate(h.at)}
                      </span>
                    </button>
                    {h.traceId && (
                      <Link
                        to={`/traces/${h.traceId}`}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Open trace"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
