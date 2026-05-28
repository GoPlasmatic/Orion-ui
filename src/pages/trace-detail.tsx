import { useState } from "react"
import { Link, useParams } from "react-router"
import { useTrace } from "@/hooks/use-traces"
import type { ExecutionStep } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { JsonViewer } from "@/components/shared/json-viewer"
import { formatDate } from "@/lib/utils"
import { ArrowLeft, ChevronDown, ChevronRight, AlertCircle } from "lucide-react"

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  running: "outline",
  pending: "secondary",
  failed: "destructive",
}

const statusColor: Record<string, string> = {
  completed: "bg-emerald-500",
  running: "",
  pending: "",
  failed: "",
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "--"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

const stepResultClass: Record<string, string> = {
  executed: "border-emerald-200 text-emerald-700",
  skipped: "border-muted-foreground/30 text-muted-foreground",
  error: "border-red-200 text-red-700",
}

/** Normalise the parsed task_trace_json into a list of execution steps. */
function extractSteps(raw: unknown): ExecutionStep[] {
  if (Array.isArray(raw)) return raw as ExecutionStep[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { steps?: unknown }).steps)) {
    return (raw as { steps: ExecutionStep[] }).steps
  }
  return []
}

function TaskStep({ step, index }: { step: ExecutionStep; index: number }) {
  const [open, setOpen] = useState(false)
  const result = typeof step.result === "string" ? step.result.toLowerCase() : undefined
  const label = step.task_name || step.task_id || step.function || `Task ${index + 1}`
  const snapshotData = step.message?.context?.data
  const hasError = step.error !== undefined && step.error !== null

  return (
    <div className="rounded-md border">
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
            <Badge variant="outline" className={stepResultClass[result] ?? ""}>
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
          {step.input === undefined && step.output === undefined && snapshotData === undefined && step.message && (
            <JsonViewer data={step.message} label="Message snapshot" maxHeight="14rem" />
          )}
          {hasError && <JsonViewer data={step.error} label="Error" maxHeight="10rem" />}
        </div>
      )}
    </div>
  )
}

export function TraceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: trace, isLoading, error } = useTrace(id ?? "")

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

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/traces"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Traces</Link>
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Trace</h1>
        <Badge
          variant={statusVariant[trace.status] ?? "outline"}
          className={statusColor[trace.status] ?? ""}
        >
          {trace.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">ID</dt>
              <dd className="font-mono text-xs mt-0.5">{trace.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Mode</dt>
              <dd className="mt-0.5"><Badge variant="outline">{trace.mode}</Badge></dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="mt-0.5">{formatDuration(trace.duration_ms)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-0.5">{formatDate(trace.created_at)}</dd>
            </div>
            {trace.started_at && (
              <div>
                <dt className="text-muted-foreground">Started</dt>
                <dd className="mt-0.5">{formatDate(trace.started_at)}</dd>
              </div>
            )}
            {trace.completed_at && (
              <div>
                <dt className="text-muted-foreground">Completed</dt>
                <dd className="mt-0.5">{formatDate(trace.completed_at)}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {trace.error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm">{trace.error}</pre>
          </CardContent>
        </Card>
      )}

      {taskSteps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Task Execution Trace</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {taskSteps.map((step, i) => (
                <TaskStep key={i} step={step} index={i} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {Array.isArray(resultErrors) && resultErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Workflow Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <JsonViewer data={resultErrors} maxHeight="15rem" />
          </CardContent>
        </Card>
      )}

      {result?.data !== undefined && (
        <JsonViewer data={result.data} label="Output" />
      )}

      {trace.task_trace_json !== undefined && taskSteps.length === 0 && (
        <JsonViewer data={trace.task_trace_json} label="Task Trace (raw)" maxHeight="20rem" />
      )}
    </div>
  )
}
