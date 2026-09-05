import { Link, useParams } from "react-router"
import { useCronOccurrence, useRetryOccurrence } from "@/hooks/use-cron"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/shared/error-state"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { RetrySafetyWarning } from "@/components/shared/retry-safety-warning"
import { occurrenceStatusBadgeClass } from "@/lib/status"
import { isRetryable, occurrenceStatusLabel } from "@/lib/cron"
import { formatDate, formatDuration, serverSpan } from "@/lib/utils"
import { RotateCcw, ScrollText } from "lucide-react"

function Meta({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-0.5 font-mono text-xs" : "mt-0.5"}>{value}</dd>
    </div>
  )
}


/**
 * One occurrence in full — the diagnostic detail the ledger's list leaves out:
 * the failure reason, the trace to read the run in, the executing version and
 * the lease bookkeeping that answers "which node has it, and until when?".
 */
export function OccurrenceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: occ, isLoading, error, refetch } = useCronOccurrence(id ?? "")
  const retry = useRetryOccurrence()

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-60 w-full" />
      </div>
    )
  }

  if (error || !occ) {
    return (
      <ErrorState
        title={`Failed to load occurrence${id ? ` ${id}` : ""}`}
        error={error}
        onRetry={() => refetch()}
        backTo={{ to: "/schedules", label: "Back to Schedules" }}
      />
    )
  }

  const inFlight = occ.status === "claimed" || occ.status === "running"
  const lag = serverSpan(occ.scheduled_for, occ.started_at)
  const duration = serverSpan(occ.started_at, occ.completed_at)

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Schedules", to: "/schedules" },
          { label: occ.channel_name, to: `/schedules?channel_id=${encodeURIComponent(occ.channel_id)}` },
          { label: `Occurrence ${occ.id.slice(0, 8)}` },
        ]}
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>
              <Link to={`/channels/${occ.channel_id}`} className="hover:underline">
                {occ.channel_name}
              </Link>
            </CardTitle>
            <Badge variant="outline" className={occurrenceStatusBadgeClass(occ.status)} title={occurrenceStatusLabel(occ.status)}>
              {occ.status}
            </Badge>
            <Badge variant={occ.trigger === "manual" ? "info" : "outline"}>{occ.trigger}</Badge>
            <span className="text-sm text-muted-foreground">attempt {occ.attempt}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{occ.id}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {occ.error_message && (
            <pre className="whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {occ.error_message}
            </pre>
          )}
          {occ.status === "skipped_misfire" && (
            <Callout variant="warning">
              Its time passed while no healthy scheduler could start it. One row summarises the run
              of missed instants under the channel's misfire policy; the count and range are in the
              message above.
            </Callout>
          )}
          {occ.status === "skipped_singleton" && (
            <Callout variant="warning">
              Its <code className="font-mono">concurrency.key</code> was held by a running
              occurrence under <code className="font-mono">policy: "forbid"</code>. That is the
              policy working — a sustained rate of these means the schedule fires faster than the
              work takes.
            </Callout>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Meta label="Scheduled for" value={formatDate(occ.scheduled_for)} />
            <Meta label="Started" value={occ.started_at ? formatDate(occ.started_at) : "—"} />
            <Meta label="Completed" value={occ.completed_at ? formatDate(occ.completed_at) : "—"} />
            <Meta label="Duration" value={duration == null ? "—" : formatDuration(duration)} />
            <Meta
              label="Lag"
              value={lag == null ? "—" : formatDuration(Math.max(0, lag))}
            />
            <Meta
              label="Channel version"
              value={
                occ.executing_version != null && occ.executing_version !== occ.channel_version
                  ? `v${occ.channel_version} → ran v${occ.executing_version}`
                  : `v${occ.channel_version}`
              }
            />
            <Meta
              label="Workflow"
              value={
                occ.workflow_id ? (
                  <Link to={`/workflows/${occ.workflow_id}`} className="font-mono text-xs text-primary hover:underline">
                    {occ.workflow_id}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Meta label="Singleton key" value={occ.singleton_key ?? "—"} mono />
            {(inFlight || occ.claimed_by) && (
              <>
                <Meta label="Claimed by" value={occ.claimed_by ?? "—"} mono />
                <Meta label="Lease until" value={occ.claimed_until ? formatDate(occ.claimed_until) : "—"} />
              </>
            )}
            {occ.fencing_token != null && (
              <Meta label="Fencing token" value={String(occ.fencing_token)} mono />
            )}
            <Meta label="Created" value={formatDate(occ.created_at)} />
            <Meta label="Updated" value={formatDate(occ.updated_at)} />
          </dl>

          <p className="text-xs text-muted-foreground">
            <code className="font-mono">scheduled_for</code> is what the work is <em>for</em> and
            never changes across attempts; <code className="font-mono">started_at</code> is when
            this attempt happened. A workflow reads both at{" "}
            <code className="font-mono">metadata.trigger</code>.
          </p>

          {isRetryable(occ.status) && (
            <RetrySafetyWarning workflowId={occ.workflow_id} action="Retrying this occurrence" />
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {occ.trace_id ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/traces/${occ.trace_id}`}>
                  <ScrollText className="h-3.5 w-3.5" /> Open trace
                </Link>
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                No trace: {inFlight || occ.status === "pending" ? "not yet admitted" : "trace storage did not keep the row — the occurrence is kept either way"}.
              </span>
            )}
            {isRetryable(occ.status) && (
              <Button
                size="sm"
                disabled={retry.isPending}
                onClick={() => retry.mutate(occ.id)}
                title="Another attempt at this occurrence — same id, same scheduled_for"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {retry.isPending ? "Queuing..." : "Retry"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
