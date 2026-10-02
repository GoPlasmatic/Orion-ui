import { Link, useParams } from "react-router"
import { useCronOccurrence, useRetryOccurrence } from "@/hooks/use-cron"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DetailSkeleton } from "@/components/shared/detail-header"
import { ErrorState } from "@/components/shared/error-state"
import { Fact } from "@/components/shared/fact"
import { Breadcrumbs } from "@/components/shared/breadcrumbs"
import { RetrySafetyWarning } from "@/components/shared/retry-safety-warning"
import { CancelOccurrenceButton } from "@/components/admin/cancel-occurrence"
import { occurrenceStatusBadgeClass } from "@/lib/status"
import { isInFlight, isRetryable, occurrenceStatusLabel } from "@/lib/cron"
import { formatDate, formatDuration, serverSpan } from "@/lib/utils"
import { RotateCcw, ScrollText } from "lucide-react"

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
    return <DetailSkeleton />
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

  // Holding a claim (and a lease) — not `pending`, which has neither yet.
  const claimed = occ.status === "claimed" || occ.status === "running"
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
              Every slot of its <code className="font-mono">concurrency.key</code> was held by a
              running occurrence under <code className="font-mono">policy: "forbid"</code>. That is
              the policy working — a sustained rate of these means the schedule fires faster than
              the work takes, so the answer is more slots or a slower schedule, not a retry.
            </Callout>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Fact label="Scheduled for" mono={false}>{formatDate(occ.scheduled_for)}</Fact>
            <Fact label="Started" mono={false}>{occ.started_at ? formatDate(occ.started_at) : "—"}</Fact>
            <Fact label="Completed" mono={false}>{occ.completed_at ? formatDate(occ.completed_at) : "—"}</Fact>
            <Fact label="Duration" mono={false}>{duration == null ? "—" : formatDuration(duration)}</Fact>
            <Fact label="Lag" mono={false}>{lag == null ? "—" : formatDuration(Math.max(0, lag))}</Fact>
            <Fact label="Channel version" mono={false}>
              {occ.executing_version != null && occ.executing_version !== occ.channel_version
                ? `v${occ.channel_version} → ran v${occ.executing_version}`
                : `v${occ.channel_version}`}
            </Fact>
            <Fact label="Workflow" mono={false}>
              {occ.workflow_id ? (
                <Link to={`/workflows/${occ.workflow_id}`} className="font-mono text-xs text-primary hover:underline">
                  {occ.workflow_id}
                </Link>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Singleton key">{occ.singleton_key ?? "—"}</Fact>
            {occ.singleton_slot != null && (
              <Fact
                label="Slot"
                title="Which of the key's concurrency.slots this attempt holds, from 0. A run takes the lowest free one and holds it for the whole attempt; the workflow reads it at metadata.trigger.singleton_slot."
              >
                {occ.singleton_slot}
              </Fact>
            )}
            {(claimed || occ.claimed_by) && (
              <>
                <Fact label="Claimed by">{occ.claimed_by ?? "—"}</Fact>
                <Fact label="Lease until" mono={false}>
                  {occ.claimed_until ? formatDate(occ.claimed_until) : "—"}
                </Fact>
              </>
            )}
            {occ.fencing_token != null && (
              <Fact
                label="Fencing token"
                title="The acquisition generation this attempt holds its key under. Two occurrences of one key can share a token when they hold different slots, so it is the key-and-slot pair that names a hold."
              >
                {occ.fencing_token}
              </Fact>
            )}
            <Fact label="Created" mono={false}>{formatDate(occ.created_at)}</Fact>
            <Fact label="Updated" mono={false}>{formatDate(occ.updated_at)}</Fact>
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
                No trace: {isInFlight(occ.status) ? "not yet admitted" : "trace storage did not keep the row — the occurrence is kept either way"}.
              </span>
            )}
            <CancelOccurrenceButton occurrence={occ} size="sm" />
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
