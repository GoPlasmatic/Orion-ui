import { useState } from "react"
import { Link, useParams } from "react-router"
import { useTrace } from "@/hooks/use-traces"
import type { ExecutionStep } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { JsonViewer } from "@/components/shared/json-viewer"
import { formatDate, formatDuration, cn } from "@/lib/utils"
import { traceStatusBadgeClass, stepResultBadgeClass, stepResultDotClass } from "@/lib/status"
import { ArrowLeft, ChevronDown, ChevronRight, AlertCircle } from "lucide-react"

/** Normalise the parsed task_trace_json into a list of execution steps. */
function extractSteps(raw: unknown): ExecutionStep[] {
  if (Array.isArray(raw)) return raw as ExecutionStep[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { steps?: unknown }).steps)) {
    return (raw as { steps: ExecutionStep[] }).steps
  }
  return []
}

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

function TaskStep({ step, index, isLast }: { step: ExecutionStep; index: number; isLast: boolean }) {
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
      <div className="mb-2 rounded-md border">
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
  const { data: trace, isLoading, error } = useTrace(id ?? "")
  const [showRaw, setShowRaw] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/traces"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Traces</Link>
        </Button>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    )
  }

  if (error || !trace) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/traces"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Traces</Link>
        </Button>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Failed to load trace{id ? ` ${id}` : ""}.</p>
        </div>
      </div>
    )
  }

  const result = trace.message
  const resultErrors = result?.errors
  const taskSteps = extractSteps(trace.task_trace_json)
  const { scalars, nested } = splitOutput(result?.data)

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/traces"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Traces</Link>
      </Button>

      {/* Verdict header — leads with the outcome */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>Trace outcome</CardTitle>
            <Badge variant="outline" className={traceStatusBadgeClass(trace.status)}>
              {trace.status}
            </Badge>
            <Badge variant="outline">{trace.mode}</Badge>
            <span className="text-sm text-muted-foreground">{formatDuration(trace.duration_ms)}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{trace.id}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {trace.error && (
            <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {trace.error}
            </pre>
          )}

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
                <TaskStep key={i} step={step} index={i} isLast={i === taskSteps.length - 1} />
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
