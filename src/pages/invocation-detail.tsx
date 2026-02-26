import { useState, useMemo } from "react"
import { Link, useParams } from "react-router"
import { useJob } from "@/hooks/use-jobs"
import type { JobResult, AuditTrailEntry } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
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

function parseResult(json: string | null): JobResult | null {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "—"
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function AuditStep({ entry, index }: { entry: AuditTrailEntry; index: number }) {
  const [open, setOpen] = useState(false)
  const hasChanges = entry.changes && entry.changes.length > 0

  return (
    <div className="relative pl-8 pb-6 last:pb-0">
      {/* Timeline line */}
      <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
      {/* Timeline dot */}
      <div className="absolute left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-primary bg-background" />

      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">Step {index + 1}</span>
          <Badge variant="outline" className="text-xs">{entry.task_id}</Badge>
          <Badge variant="secondary" className="text-xs">status: {entry.status}</Badge>
          {entry.timestamp && (
            <span className="text-xs text-muted-foreground">{formatDate(entry.timestamp)}</span>
          )}
        </div>

        {entry.workflow_id && (
          <p className="text-xs text-muted-foreground">workflow: {entry.workflow_id}</p>
        )}

        {hasChanges && (
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {entry.changes.length} change{entry.changes.length !== 1 ? "s" : ""}
          </button>
        )}

        {open && hasChanges && (
          <div className="mt-2 space-y-1">
            {entry.changes.map((change, ci) => (
              <div key={ci} className="rounded bg-muted p-2 text-xs font-mono">
                <span className="text-muted-foreground">{change.path}</span>
                <div className="flex gap-4 mt-1">
                  <span className="text-red-500">- {JSON.stringify(change.old_value)}</span>
                  <span className="text-emerald-500">+ {JSON.stringify(change.new_value)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function InvocationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: job, isLoading, error } = useJob(id ?? "")
  const [rawOpen, setRawOpen] = useState(false)

  const result = useMemo(() => (job ? parseResult(job.result_json) : null), [job])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/invocations"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Invocations</Link>
        </Button>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/invocations"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Invocations</Link>
        </Button>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Failed to load invocation{id ? ` ${id}` : ""}.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/invocations"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Invocations</Link>
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Invocation</h1>
        <Badge
          variant={statusVariant[job.status] ?? "outline"}
          className={statusColor[job.status] ?? ""}
        >
          {job.status}
        </Badge>
      </div>

      {/* Metadata Card */}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">ID</dt>
              <dd className="font-mono text-xs mt-0.5">{job.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Channel</dt>
              <dd className="mt-0.5">{job.channel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Connector</dt>
              <dd className="font-mono text-xs mt-0.5">{job.connector_id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Records Processed</dt>
              <dd className="mt-0.5">{job.records_processed}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-0.5">{formatDate(job.created_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="mt-0.5">{formatDuration(job.started_at, job.completed_at)}</dd>
            </div>
            {job.started_at && (
              <div>
                <dt className="text-muted-foreground">Started</dt>
                <dd className="mt-0.5">{formatDate(job.started_at)}</dd>
              </div>
            )}
            {job.completed_at && (
              <div>
                <dt className="text-muted-foreground">Completed</dt>
                <dd className="mt-0.5">{formatDate(job.completed_at)}</dd>
              </div>
            )}
          </dl>

          {job.error_message && (
            <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{job.error_message}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit Trail */}
      {result?.audit_trail && result.audit_trail.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Audit Trail</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {result.audit_trail.map((entry, i) => (
                <AuditStep key={i} entry={entry} index={i} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Errors from result */}
      {result?.errors && result.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-auto max-h-60">
              {JSON.stringify(result.errors, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Raw JSON */}
      {job.result_json && (
        <Card>
          <CardHeader>
            <button
              onClick={() => setRawOpen(!rawOpen)}
              className="flex items-center gap-2 w-full text-left"
            >
              {rawOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle>Raw JSON</CardTitle>
            </button>
          </CardHeader>
          {rawOpen && (
            <CardContent>
              <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-auto max-h-96">
                {JSON.stringify(JSON.parse(job.result_json), null, 2)}
              </pre>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
