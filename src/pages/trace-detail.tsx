import { useState } from "react"
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { useTrace } from "@/hooks/use-traces"
import { useChannel } from "@/hooks/use-channels"
import type { ExecutionStep } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { JsonViewer } from "@/components/shared/json-viewer"
import { ErrorState } from "@/components/shared/error-state"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { formatDate, formatDuration, cn } from "@/lib/utils"
import { traceStatusBadgeClass, stepResultBadgeClass, stepResultDotClass } from "@/lib/status"
import { extractSteps, firstTaskPayload } from "@/lib/trace-payload"
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

function TaskStep({
  step,
  index,
  isLast,
  share,
}: {
  step: ExecutionStep
  index: number
  isLast: boolean
  /** This step's duration as a share of the longest step, for the bar. */
  share: number | null
}) {
  const [open, setOpen] = useState(false)
  const result = typeof step.result === "string" ? step.result.toLowerCase() : undefined
  const label = step.task_name || step.task_id || step.function || `Task ${index + 1}`
  const snapshotData = step.message?.context?.data
  const hasError = step.error !== undefined && step.error !== null

  return (
    <li className="relative pl-8">
      {!isLast && <span className="absolute bottom-0 left-[0.4375rem] top-3 w-px bg-border" />}
      <span
        className={cn(
          "absolute left-0 top-[0.6rem] h-3.5 w-3.5 rounded-full ring-4 ring-background",
          stepResultDotClass(result),
        )}
      />
      <div className="mb-2 overflow-hidden rounded-md border">
        {/* The slow step is visible without expanding anything: a bar scaled
            to the longest step in the run. */}
        {share != null && (
          <div className="h-1 w-full bg-muted" aria-hidden>
            <div
              className={cn("h-1", result === "error" ? "bg-destructive" : "bg-chart-1")}
              style={{ width: `${Math.max(2, share * 100)}%` }}
            />
          </div>
        )}
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <span className="font-medium">{label}</span>
          {step.function && (
            <span className="font-mono text-xs text-muted-foreground">{step.function}</span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {step.duration_ms !== undefined && (
              <span className="text-xs text-muted-foreground">{formatDuration(step.duration_ms)}</span>
            )}
            {result && (
              <Badge variant="outline" className={stepResultBadgeClass(result)}>
                {result}
              </Badge>
            )}
          </span>
        </button>
        {open && (
          <div className="space-y-3 border-t px-3 py-3">
            {step.input !== undefined && <JsonViewer data={step.input} label="Input" maxHeight="14rem" />}
            {step.output !== undefined && <JsonViewer data={step.output} label="Output" maxHeight="14rem" />}
            {snapshotData !== undefined && (
              <JsonViewer data={snapshotData} label="Data after task" maxHeight="14rem" />
            )}
            {step.input === undefined &&
              step.output === undefined &&
              snapshotData === undefined &&
              step.message && <JsonViewer data={step.message} label="Message snapshot" maxHeight="14rem" />}
            {hasError && <JsonViewer data={step.error} label="Error" maxHeight="10rem" />}
          </div>
        )}
      </div>
    </li>
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
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/traces"><ChevronLeft className="mr-2 h-4 w-4" /> Back to Traces</Link>
        </Button>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    )
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
  const taskSteps = extractSteps(trace.task_trace_json)
  const { scalars, nested } = splitOutput(result?.data)
  const longestStep = Math.max(0, ...taskSteps.map((s) => s.duration_ms ?? 0))
  const position = siblings.indexOf(trace.id)
  const prevId = position > 0 ? siblings[position - 1] : null
  const nextId = position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : null
  // The request as the first task saw it — the closest thing to the original
  // input the trace keeps. Re-sending it is how a failure gets reproduced.
  const firstPayload = firstTaskPayload(trace)
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
            <span className="text-sm text-muted-foreground">{formatDuration(trace.duration_ms)}</span>
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
            {channel?.workflow_id && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/workflows/${channel.workflow_id}`} title="The workflow this channel runs">
                  <GitBranch className="h-3.5 w-3.5" /> Workflow {channel.workflow_id}
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

      {/* Execution pipeline */}
      {taskSteps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Execution pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative">
              {taskSteps.map((step, i) => (
                <TaskStep
                  key={i}
                  step={step}
                  index={i}
                  isLast={i === taskSteps.length - 1}
                  share={longestStep > 0 && step.duration_ms != null ? step.duration_ms / longestStep : null}
                />
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

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
