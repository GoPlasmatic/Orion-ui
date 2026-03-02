import { useState } from "react"
import { Link, useParams } from "react-router"
import { useTrace } from "@/hooks/use-traces"
import type { AuditTrailEntry } from "@/api/types"
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

function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
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
  const { data: trace, isLoading, error } = useTrace(id ?? "")
  const [payloadOpen, setPayloadOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)

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

  if (error || !trace) {
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

  const message = trace.message

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild>
        <Link to="/invocations"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Invocations</Link>
      </Button>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Invocation</h1>
        <Badge
          variant={statusVariant[trace.status] ?? "outline"}
          className={statusColor[trace.status] ?? ""}
        >
          {trace.status}
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

      {/* Audit Trail */}
      {message?.audit_trail && message.audit_trail.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Audit Trail</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {message.audit_trail.map((entry, i) => (
                <AuditStep key={i} entry={entry} index={i} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Errors from message */}
      {message?.errors && message.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-auto max-h-60">
              {JSON.stringify(message.errors, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Payload */}
      {message?.payload && (
        <Card>
          <CardHeader>
            <button
              onClick={() => setPayloadOpen(!payloadOpen)}
              className="flex items-center gap-2 w-full text-left"
            >
              {payloadOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle>Payload</CardTitle>
            </button>
          </CardHeader>
          {payloadOpen && (
            <CardContent>
              <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-auto max-h-96">
                {JSON.stringify(message.payload, null, 2)}
              </pre>
            </CardContent>
          )}
        </Card>
      )}

      {/* Context */}
      {message?.context && (
        <Card>
          <CardHeader>
            <button
              onClick={() => setContextOpen(!contextOpen)}
              className="flex items-center gap-2 w-full text-left"
            >
              {contextOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle>Context</CardTitle>
            </button>
          </CardHeader>
          {contextOpen && (
            <CardContent>
              <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-auto max-h-96">
                {JSON.stringify(message.context, null, 2)}
              </pre>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
