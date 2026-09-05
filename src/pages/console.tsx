import { useState } from "react"
import { Link, useLocation, useSearchParams } from "react-router"
import { dataApi, type ExtraHeaders } from "@/api/data"
import { useChannels } from "@/hooks/use-channels"
import { useTrace, useTraces } from "@/hooks/use-traces"
import { tracesApi } from "@/api/traces"
import { firstTaskPayload } from "@/lib/trace-payload"
import { toastError } from "@/lib/toast-error"
import { traceStatusBadgeClass } from "@/lib/status"
import type {
  AsyncSubmitResponse,
  Channel,
  ProcessResponse,
  ProcessTaskError,
  ProfileResult,
} from "@/api/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { JsonEditor } from "@/components/shared/json-editor"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/ui/callout"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { JsonViewer } from "@/components/shared/json-viewer"
import { formatDate, formatDuration, formatRelative } from "@/lib/utils"
import { Braces, ExternalLink, History, Plus, Send, X } from "lucide-react"

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

/**
 * Kept in this browser only. Both used to vanish on reload: the request
 * history, and the headers a guarded channel needs — which had nowhere to be
 * entered at all, so a channel with `auth` set could not be tested from here.
 */
const HISTORY_KEY = "orion-console-history"
const HEADERS_KEY = "orion-console-headers"
const HISTORY_MAX = 8

interface HeaderRow {
  key: string
  value: string
  enabled: boolean
}

interface HistoryEntry {
  channel: string
  payload: string
  sync: boolean
  method?: string
  path?: string
  status?: string
  traceId?: string
  /** Capability token from an async 202; required to poll that trace. */
  traceToken?: string
  at: string
  elapsedMs?: number
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or a full quota: the console still works, it just forgets.
  }
}

const loadHeaders = (channel: string): HeaderRow[] =>
  loadJson<Record<string, HeaderRow[]>>(HEADERS_KEY, {})[channel] ?? []

function saveHeaders(channel: string, rows: HeaderRow[]) {
  if (!channel) return
  const store = loadJson<Record<string, HeaderRow[]>>(HEADERS_KEY, {})
  if (rows.length === 0) delete store[channel]
  else store[channel] = rows
  saveJson(HEADERS_KEY, store)
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

/**
 * Polling an async trace needs the capability token handed out with the 202 —
 * an admin credential is the only alternative, and the console may not have one.
 *
 * The token travels in router state, not the URL: a URL is not a private
 * place — it reaches browser history, the `Referer` of whatever the page loads
 * next, and every chat window a link is pasted into. That is the reason the
 * server deprecated its own `?token=` query parameter in 1.6; the console's
 * link used to carry the token the same way.
 */
function traceLink(traceId: string, token?: string) {
  return {
    to: `/traces/${traceId}`,
    state: token ? { traceToken: token } : undefined,
  }
}

/**
 * Where an async submission got to. The trace is written before it runs, so
 * the first read is pending; the hook polls while it is pending or running
 * and stops once it settles, so the answer arrives here without leaving the
 * console. The token from the 202 is what authorises the read.
 */
function AsyncOutcome({ traceId, token }: { traceId: string; token?: string }) {
  const { data: trace, isLoading, error } = useTrace(traceId, token)
  if (error) {
    return (
      <p className="text-xs text-muted-foreground">
        The trace could not be read from here — open it to follow the run.
      </p>
    )
  }
  if (isLoading || !trace) {
    return <p className="text-xs text-muted-foreground">Waiting for the trace to be written…</p>
  }
  const settled = trace.status !== "pending" && trace.status !== "running"
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <Badge variant="outline" className={traceStatusBadgeClass(trace.status)}>
        {trace.status}
      </Badge>
      {!settled && <span className="text-xs text-muted-foreground">polling every 2 s</span>}
      {settled && trace.duration_ms != null && (
        <span className="text-xs text-muted-foreground">{formatDuration(trace.duration_ms)}</span>
      )}
      {trace.error && (
        <span className="min-w-0 truncate font-mono text-xs text-destructive" title={trace.error}>
          {trace.error}
        </span>
      )}
      {settled && !trace.error && (
        <span className="text-xs text-muted-foreground">
          settled {formatRelative(trace.completed_at ?? trace.created_at) ?? ""}
        </span>
      )}
    </div>
  )
}

/**
 * A 200 does not mean the workflow succeeded: a failed task still answers 200
 * with the failure in `errors`. Since 1.1 the code names the real failure
 * rather than a flat TASK_ERROR, so it is worth surfacing rather than leaving
 * buried in the raw JSON.
 */
function TaskErrors({
  errors,
  requestId,
}: {
  errors: ProcessTaskError[]
  requestId?: string | null
}) {
  return (
    <Callout variant="destructive">
      <p className="text-sm font-medium">
        {errors.length} task {errors.length === 1 ? "error" : "errors"}
      </p>
      <ul className="mt-1.5 space-y-1 text-xs">
        {errors.map((e, i) => (
          <li key={i}>
            <span className="font-mono font-medium">{e.code}</span>
            {e.task_id && <span className="font-mono opacity-70"> @{e.task_id}</span>}
            {" — "}
            {e.message}
          </li>
        ))}
      </ul>
      {requestId && (
        <p className="font-mono text-xs text-muted-foreground">request_id: {requestId}</p>
      )}
    </Callout>
  )
}

/**
 * `/console?channel=<name>` opens with that channel selected and its REST
 * route seeded — the channel page and the map inspector link here. A trace's
 * "re-send" hands the payload over in router state. The list has to be loaded
 * before the form can seed from it, so the page waits for it only when a
 * channel was asked for; a bare `/console` mounts at once.
 */
export function ConsolePage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const requested = params.get("channel") ?? ""
  // `?method=&path=` complete a REST deep link: a route named by another
  // page lands here ready to send.
  const requestedMethod = params.get("method") ?? undefined
  const requestedPath = params.get("path") ?? undefined
  const handed = (location.state as { payload?: unknown } | null)?.payload
  const initialPayload =
    handed !== undefined && handed !== null ? JSON.stringify(handed, null, 2) : undefined
  const { data: channels, isLoading } = useChannels({ limit: 200 })

  if (requested && isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Data Console" description="Send test requests to channels" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <ConsoleForm
      channels={channels?.data ?? []}
      initialChannel={requested}
      initialPayload={initialPayload}
      initialMethod={requestedMethod}
      initialPath={requestedPath}
      onChannelChange={(name) => setParams(name ? { channel: name } : {}, { replace: true })}
    />
  )
}

function ConsoleForm({
  channels,
  initialChannel,
  initialPayload,
  initialMethod,
  initialPath,
  onChannelChange: syncUrl,
}: {
  channels: Channel[]
  initialChannel: string
  initialPayload?: string
  initialMethod?: string
  initialPath?: string
  /** Keeps the URL in step so the selected channel survives a reload and a paste. */
  onChannelChange: (name: string) => void
}) {
  // A cron channel (1.6) registers no route and is not reachable at
  // `data/{name}` — running it here would execute the workflow outside its
  // ledger and outside its singleton lock, which is why the server refuses
  // it. Its manual path is "Trigger now" on the channel.
  const cronChannels = channels.filter((c) => c.protocol === "cron")
  const channelList = channels.filter((c) => c.protocol !== "cron")
  const initial = channelList.find((c) => c.name === initialChannel)

  // Seeded once, in the initializers — the same derivation `onChannelChange`
  // performs on a pick — rather than in an effect that syncs state after mount.
  const [channel, setChannel] = useState(initial?.name ?? "")
  const [payload, setPayload] = useState(initialPayload ?? (initial ? SAMPLE_PAYLOAD : "{\n  \n}"))
  const [sync, setSync] = useState(true)
  const [profile, setProfile] = useState(false)
  const [method, setMethod] = useState(() => {
    if (!isRestChannel(initial)) return "POST"
    const allowed = (initial.methods ?? []).map((m) => m.toUpperCase())
    const asked = initialMethod?.toUpperCase()
    if (asked && (allowed.length === 0 || allowed.includes(asked))) return asked
    return allowed[0] ?? "POST"
  })
  const [path, setPath] = useState(() =>
    isRestChannel(initial) ? (initialPath ?? initial.route_pattern ?? "") : "",
  )
  const [loadingTrace, setLoadingTrace] = useState(false)
  const [headers, setHeaders] = useState<HeaderRow[]>(() => loadHeaders(initial?.name ?? ""))
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProcessResponse | null>(null)
  // An async submission answers with a receipt, not a result — kept separately
  // so the sync response renderer never has to guess which shape it holds.
  const [receipt, setReceipt] = useState<AsyncSubmitResponse | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadJson<HistoryEntry[]>(HISTORY_KEY, []))

  const selected = channelList.find((c) => c.name === channel)
  const restMode = isRestChannel(selected)
  // The newest trace through the selected channel: its input is the payload
  // most worth re-sending. The list row is payload-free; the button fetches
  // the trace itself when asked.
  const { data: lastTraces } = useTraces(
    { channel: channel || undefined, limit: 1, sort_by: "created_at", sort_order: "desc" },
    { enabled: !!channel },
  )
  const lastTraceId = lastTraces?.data[0]?.id
  const bodyless = restMode && BODYLESS.has(method)

  const profileResult = result?._orion?.profile
  // A sync response correlates through the engine message id; an async one
  // hands back the trace id explicitly.
  const traceId = receipt?.trace_id ?? result?.id
  const traceToken = receipt?.trace_token
  const taskErrors = result?.errors ?? []

  // What a guarded channel expects, so the 401 is explained before it happens.
  const authMode = selected?.config.auth?.mode
  const authHeader = (selected?.config.auth?.header ?? (authMode === "jwt" ? (selected?.config.auth?.source?.header ?? "Authorization") : "Authorization")).toLowerCase()
  const hasAuthHeader = headers.some((h) => h.enabled && h.key.trim().toLowerCase() === authHeader)

  const updateHeaders = (rows: HeaderRow[]) => {
    setHeaders(rows)
    saveHeaders(channel, rows)
  }

  // Pre-fill a starter payload when a channel is picked and the editor is empty;
  // seed method/path from the channel's REST route when it has one; recall the
  // headers last used with it.
  const onChannelChange = (value: string) => {
    setChannel(value)
    syncUrl(value)
    setHeaders(loadHeaders(value))
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
    syncUrl(h.channel)
    setHeaders(loadHeaders(h.channel))
    setPayload(h.payload)
    setSync(h.sync)
    if (h.method) setMethod(h.method)
    if (h.path) setPath(h.path)
  }

  const fillFromLastTrace = async () => {
    if (!lastTraceId) return
    setLoadingTrace(true)
    try {
      const trace = await tracesApi.get(lastTraceId)
      const input = firstTaskPayload(trace)
      if (!input) {
        setError("The last trace kept no request payload — nothing to reuse")
        return
      }
      setPayload(JSON.stringify(input, null, 2))
      setError(null)
    } catch (e) {
      toastError("Could not read the last trace", e)
    } finally {
      setLoadingTrace(false)
    }
  }

  const formatPayload = () => {
    try {
      setPayload(JSON.stringify(JSON.parse(payload), null, 2))
      setError(null)
    } catch {
      setError("Payload is not valid JSON")
    }
  }

  const handleSend = async () => {
    setError(null)
    setResult(null)
    setReceipt(null)
    setElapsedMs(null)

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

    const extra: ExtraHeaders = {}
    for (const h of headers) if (h.enabled && h.key.trim()) extra[h.key.trim()] = h.value

    setLoading(true)
    const isAsync = !restMode && !sync
    const started = performance.now()
    try {
      let entryStatus: string | undefined
      let entryTraceId: string | undefined
      let entryTraceToken: string | undefined

      if (isAsync) {
        const ack = await dataApi.processAsync(channel, { data: data ?? {} }, extra)
        setReceipt(ack)
        entryStatus = "accepted"
        entryTraceId = ack.trace_id
        entryTraceToken = ack.trace_token
      } else {
        const res = restMode
          ? await dataApi.processRest(
              method,
              path,
              data !== undefined ? { data } : undefined,
              profile,
              extra
            )
          : await dataApi.processSync(channel, { data: data ?? {} }, profile, extra)
        setResult(res)
        entryStatus = res.status
        entryTraceId = res.id
      }
      const took = performance.now() - started
      setElapsedMs(took)

      setHistory((prev) => {
        const next = [
          {
            channel,
            payload,
            sync: restMode ? true : sync,
            method: restMode ? method : undefined,
            path: restMode ? path : undefined,
            status: entryStatus,
            traceId: entryTraceId,
            traceToken: entryTraceToken,
            at: new Date().toISOString(),
            elapsedMs: took,
          },
          ...prev,
        ].slice(0, HISTORY_MAX)
        saveJson(HISTORY_KEY, next)
        return next
      })
    } catch (e) {
      setElapsedMs(performance.now() - started)
      setError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setLoading(false)
    }
  }

  /** Mod-Enter inside the editor: send, unless a send is already in flight. */
  const sendFromEditor = () => {
    if (!loading) void handleSend()
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
              <Label>Channel</Label>
              <Select
                value={channel}
                onChange={(e) => onChannelChange(e.target.value)}
                aria-label="Channel"
              >
                <option value="">Select a channel...</option>
                {channelList.map((c) => (
                  <option key={c.channel_id} value={c.name}>
                    {c.name} ({c.channel_type}/{c.protocol}{c.status !== "active" ? ` · ${c.status}` : ""})
                  </option>
                ))}
              </Select>
            </div>

            {cronChannels.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {cronChannels.length} cron channel{cronChannels.length === 1 ? " is" : "s are"} not
                listed: a schedule is not reachable by name. Run one from its channel page or{" "}
                <Link to="/schedules" className="underline underline-offset-2">
                  Schedules
                </Link>
                .
              </p>
            )}

            {restMode && (
              <div className="flex gap-2">
                <div className="w-32">
                  <Label>Method</Label>
                  <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
                    {((selected?.methods?.length ?? 0) > 0
                      ? selected!.methods!.map((m) => m.toUpperCase())
                      : REST_METHODS
                    ).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </Select>
                </div>
                <div className="flex-1">
                  <Label>Path</Label>
                  <Input
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    className="font-mono"
                    placeholder={selected?.route_pattern ?? "/orders/42"}
                    aria-label="Path"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Route pattern: <code>{selected?.route_pattern}</code> — replace{" "}
                    {"{parameters}"} with concrete values.
                  </p>
                </div>
              </div>
            )}

            {/* Headers: the credential a guarded channel checks, an
                idempotency key for a dedup guard, a tenant header a key logic
                reads. Remembered per channel in this browser. */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <Label className="mb-0">Headers</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => updateHeaders([...headers, { key: "", value: "", enabled: true }])}
                >
                  <Plus /> Add header
                </Button>
              </div>
              {authMode && !hasAuthHeader && (
                <Callout variant="warning" icon={false} className="mb-2 px-3 py-2 text-xs">
                  This channel checks <span className="font-mono">{authMode}</span> auth on the{" "}
                  <span className="font-mono">{authHeader}</span> header. Without it the request
                  answers 401 and no workflow runs.
                </Callout>
              )}
              {headers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  None. Headers are remembered per channel in this browser only.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {headers.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Checkbox
                        checked={row.enabled}
                        onCheckedChange={(on) =>
                          updateHeaders(headers.map((h, j) => (j === i ? { ...h, enabled: on } : h)))
                        }
                        aria-label={`Send header ${row.key || i + 1}`}
                      />
                      <Input
                        value={row.key}
                        onChange={(e) =>
                          updateHeaders(headers.map((h, j) => (j === i ? { ...h, key: e.target.value } : h)))
                        }
                        placeholder="x-api-key"
                        className="w-44 font-mono text-xs"
                        aria-label={`Header ${i + 1} name`}
                      />
                      <Input
                        value={row.value}
                        onChange={(e) =>
                          updateHeaders(headers.map((h, j) => (j === i ? { ...h, value: e.target.value } : h)))
                        }
                        placeholder="value"
                        className="flex-1 font-mono text-xs"
                        aria-label={`Header ${i + 1} value`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => updateHeaders(headers.filter((_, j) => j !== i))}
                        aria-label={`Remove header ${row.key || i + 1}`}
                        className="text-muted-foreground"
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!bodyless && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label className="mb-0">JSON Payload</Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={formatPayload}
                      className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      <Braces className="h-3 w-3" /> Format
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayload(SAMPLE_PAYLOAD)}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Insert sample
                    </button>
                    <button
                      type="button"
                      onClick={() => void fillFromLastTrace()}
                      disabled={!lastTraceId || loadingTrace}
                      className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
                      title={
                        !channel
                          ? "Pick a channel first"
                          : !lastTraceId
                            ? "No trace has run through this channel yet"
                            : "The newest trace's request, as its first task saw it"
                      }
                    >
                      <History className="h-3 w-3" /> {loadingTrace ? "Loading…" : "Last trace's input"}
                    </button>
                  </div>
                </div>
                <JsonEditor
                  value={payload}
                  onChange={setPayload}
                  height="16rem"
                  aria-label="JSON payload"
                  onRun={sendFromEditor}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  <kbd className="rounded border bg-muted px-1 font-mono">⌘</kbd>{" "}
                  <kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> sends. A syntax
                  error is underlined as you type.
                </p>
              </div>
            )}

            <div className="flex items-center gap-4">
              {restMode ? (
                <Badge variant="outline">REST · Sync</Badge>
              ) : (
                <>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={sync} onCheckedChange={setSync} aria-label="Synchronous" />
                    Synchronous
                  </label>
                  <Badge variant="outline">{sync ? "Sync" : "Async"}</Badge>
                </>
              )}
              {(restMode || sync) && (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={profile} onCheckedChange={setProfile} aria-label="Profile" />
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
              <Callout variant="destructive">
                {error}
              </Callout>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  Response
                  {result?.status && (
                    <Badge variant="outline" className="font-mono text-xs">
                      {result.status}
                    </Badge>
                  )}
                  {receipt && (
                    <Badge variant="outline" className="font-mono text-xs">
                      202 accepted
                    </Badge>
                  )}
                  {elapsedMs != null && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {formatDuration(elapsedMs)} round trip
                    </span>
                  )}
                </span>
                {traceId && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={traceLink(traceId, traceToken).to} state={traceLink(traceId, traceToken).state}>
                      <ExternalLink className="h-3.5 w-3.5" /> Open as trace
                    </Link>
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {taskErrors.length > 0 && <TaskErrors errors={taskErrors} requestId={result?.request_id} />}
              {receipt ? (
                <div className="space-y-3">
                  <p className="text-sm">
                    Accepted for asynchronous processing. The result is not returned here — the
                    trace is followed below until it settles.
                  </p>
                  <AsyncOutcome traceId={receipt.trace_id} token={receipt.trace_token} />
                  <JsonViewer data={receipt} maxHeight="200px" />
                </div>
              ) : result ? (
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
                <CardTitle className="flex items-center justify-between text-sm">
                  Recent requests
                  <button
                    type="button"
                    onClick={() => {
                      setHistory([])
                      saveJson(HISTORY_KEY, [])
                    }}
                    className="text-xs font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Clear
                  </button>
                </CardTitle>
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
                      {h.elapsedMs != null && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDuration(h.elapsedMs)}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground" title={formatDate(h.at)}>
                        {formatRelative(h.at) ?? formatDate(h.at)}
                      </span>
                    </button>
                    {h.traceId && (
                      <Link
                        to={traceLink(h.traceId, h.traceToken).to}
                        state={traceLink(h.traceId, h.traceToken).state}
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
