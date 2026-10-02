import { useState } from "react"
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { useTrace } from "@/hooks/use-traces"
import { useChannel } from "@/hooks/use-channels"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { DetailSkeleton } from "@/components/shared/detail-header"
import { JsonViewer } from "@/components/shared/json-viewer"
import { ErrorState } from "@/components/shared/error-state"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { formatDate, formatDuration, serverSpan, cn } from "@/lib/utils"
import { buildTimeline } from "@/lib/trace-timeline"
import type { TraceDetail } from "@/api/types"
import { traceStatusBadgeClass } from "@/lib/status"
import { firstTaskPayload } from "@/lib/trace-payload"
import { traceWorkflowId } from "@/lib/trace-timeline"
import { TraceSteps } from "@/components/traces/trace-steps"
import { copyText } from "@/lib/clipboard"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  Search,
  Send,
} from "lucide-react"

const humanize = (key: string) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

type Scalar = string | number | boolean | null

// Split the workflow output into prominent scalar "verdict" fields and nested
// objects shown below. Internal keys (leading underscore) are hidden from the
// verdict but remain in the raw JSON. Generic — no domain-specific field names.
function splitOutput(data: Record<string, unknown> | undefined) {
  const scalars: [string, Scalar][] = []
  const nested: [string, unknown][] = []
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith("_")) continue
      if (v === null || typeof v !== "object") scalars.push([k, v as Scalar])
      else nested.push([k, v])
    }
  }
  return { scalars, nested }
}

function VerdictTile({ label, value }: { label: string; value: Scalar }) {
  const text = value === null ? "null" : String(value)
  const wide = text.length > 28
  return (
    <div className={cn("rounded-md border bg-muted/30 px-3 py-2", wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-xs text-muted-foreground">{humanize(label)}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{text}</dd>
    </div>
  )
}

export function TraceDetailPage() {
  const { id } = useParams<{ id: string }>()
  // The console hands the async submission's capability token over in router
  // state, so a follow-the-trace link works without an admin credential and
  // the token stays out of the URL. `?token=` is still read for a link minted
  // before 1.6; the server itself sends the token as the `x-trace-token`
  // header either way.
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const routeState = location.state as { traceToken?: string; siblings?: string[] } | null
  const stateToken = routeState?.traceToken
  // The list hands over the ids on the page it was showing, so the detail can
  // step through them; there is no time-range API to find a neighbour by.
  const siblings = routeState?.siblings ?? []
  const { data: trace, isLoading, error, refetch } = useTrace(
    id ?? "",
    stateToken ?? searchParams.get("token") ?? undefined
  )
  // The trace names its channel; the channel names the workflow that ran.
  const { data: channel } = useChannel(trace?.channel_id ?? "")
  const [showRaw, setShowRaw] = useState(false)

  if (isLoading) {
    return <DetailSkeleton />
  }

  if (error || !trace) {
    return (
      <ErrorState
        title={`Failed to load trace${id ? ` ${id}` : ""}`}
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/traces", label: "Back to Traces" }}
      />
    )
  }

  const result = trace.message
  const resultErrors = result?.errors
  const { scalars, nested } = splitOutput(result?.data)
  const position = siblings.indexOf(trace.id)
  const prevId = position > 0 ? siblings[position - 1] : null
  const nextId = position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : null
  // The request as the first task saw it — the closest thing to the original
  // input the trace keeps. Re-sending it is how a failure gets reproduced.
  const firstPayload = firstTaskPayload(trace)
  // The workflow the run's own steps name; the channel may have been re-pointed since.
  const workflowId = traceWorkflowId(trace, channel)
  const canResend = !!trace.channel && trace.mode !== "cron" && firstPayload !== null
  const copyId = () => void copyText(trace.id, "Trace id")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Breadcrumbs
          items={[
            { label: "Traces", to: "/traces" },
            ...(trace.channel ? [{ label: trace.channel, to: `/traces?channel=${encodeURIComponent(trace.channel)}` }] : []),
            { label: trace.id.slice(0, 8) },
          ]}
        />
        {siblings.length > 1 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button
              variant="outline"
              size="sm"
              disabled={!prevId}
              onClick={() => prevId && navigate(`/traces/${prevId}`, { state: routeState })}
              aria-label="Newer trace"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Newer
            </Button>
            <span className="px-1 tabular-nums">
              {position + 1} of {siblings.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!nextId}
              onClick={() => nextId && navigate(`/traces/${nextId}`, { state: routeState })}
              aria-label="Older trace"
            >
              Older <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Verdict header — leads with the outcome */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>Trace outcome</CardTitle>
            <Badge variant="outline" className={traceStatusBadgeClass(trace.status)}>
              {trace.status}
            </Badge>
            <Badge variant="outline">{trace.mode}</Badge>
            {trace.channel && (
              trace.channel_id ? (
                <Link to={`/channels/${trace.channel_id}`} className="text-sm font-medium hover:underline">
                  {trace.channel}
                </Link>
              ) : (
                <span className="text-sm font-medium">{trace.channel}</span>
              )
            )}
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatDuration(runDurationMs(trace))}
            </span>
            <span className="ml-auto flex items-center gap-1 font-mono text-xs text-muted-foreground">
              {trace.id}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={copyId}
                aria-label="Copy trace id"
                title="Copy trace id"
                className="text-muted-foreground"
              >
                <Copy />
              </Button>
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {trace.mode === "cron" && trace.channel_id && (
            <p className="text-xs text-muted-foreground">
              A scheduled run. The occurrence it belongs to — what was due, which attempt this was,
              and the lease — is in the{" "}
              <Link to={`/schedules?channel_id=${encodeURIComponent(trace.channel_id)}`} className="underline underline-offset-2">
                occurrence ledger
              </Link>
              .
            </p>
          )}
          {trace.mode === "kafka" && (
            <p className="text-xs text-muted-foreground">
              A consumed Kafka record. It arrived on no route, so there is no channel id, and its
              payload is already the workflow input.
            </p>
          )}
          {trace.error && (
            <pre className="whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {trace.error}
            </pre>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {workflowId && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/workflows/${encodeURIComponent(workflowId)}`} title="The workflow this run executed">
                  <GitBranch className="h-3.5 w-3.5" /> Workflow {workflowId}
                </Link>
              </Button>
            )}
            {trace.status === "failed" && trace.channel && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/traces?channel=${encodeURIComponent(trace.channel)}&status=failed`}>
                  <Search className="h-3.5 w-3.5" /> Similar failures
                </Link>
              </Button>
            )}
            {canResend && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate(`/console?channel=${encodeURIComponent(trace.channel as string)}`, {
                    state: { payload: firstPayload },
                  })
                }
                title="Open the console with this run's request payload, as the first task saw it"
              >
                <Send className="h-3.5 w-3.5" /> Re-send in console
              </Button>
            )}
          </div>

          {scalars.length > 0 && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {scalars.map(([k, v]) => (
                <VerdictTile key={k} label={k} value={v} />
              ))}
            </dl>
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Meta label="Created" value={formatDate(trace.created_at)} />
            {trace.started_at && <Meta label="Started" value={formatDate(trace.started_at)} />}
            {trace.completed_at && <Meta label="Completed" value={formatDate(trace.completed_at)} />}
          </div>
        </CardContent>
      </Card>

      {/* Where the time went — or why this run kept no steps */}
      <TraceSteps trace={trace} channel={channel} />

      {/* Nested output objects */}
      {nested.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Output detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {nested.map(([k, v]) => (
              <JsonViewer key={k} data={v} label={humanize(k)} maxHeight="16rem" collapsible />
            ))}
          </CardContent>
        </Card>
      )}

      {Array.isArray(resultErrors) && resultErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Workflow errors</CardTitle>
          </CardHeader>
          <CardContent>
            <JsonViewer data={resultErrors} maxHeight="15rem" />
          </CardContent>
        </Card>
      )}

      {/* Raw payloads, collapsed */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Raw data
        </Button>
        {showRaw && (
          <div className="mt-3 space-y-3">
            {result?.data !== undefined && <JsonViewer data={result.data} label="Workflow output" maxHeight="20rem" />}
            {trace.task_trace_json !== undefined && (
              <JsonViewer data={trace.task_trace_json} label="Task trace (raw)" maxHeight="20rem" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  )
}

/**
 * How long the run took. The row's `duration_ms` (or its two instants) is the
 * answer — except on a sync trace, which 1.12 stamps at persist time, so the
 * row reads well under a millisecond for a run whose steps took 800 ms. When
 * the steps say the run was longer, the steps win.
 */
function runDurationMs(trace: TraceDetail): number | null {
  const row = trace.duration_ms ?? serverSpan(trace.started_at, trace.completed_at)
  const steps = buildTimeline(trace)
  const fromSteps = steps ? steps.totalUs / 1000 : null
  if (fromSteps == null) return row
  return row == null ? fromSteps : Math.max(row, fromSteps)
}
