import { useMemo } from "react"
import { Link } from "react-router"
import { useQueries } from "@tanstack/react-query"
import { tracesApi } from "@/api/traces"
import type { Channel, Trace, TraceDetail, Workflow } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { LensInsights } from "@/components/workflow/lens-insights"
import { LensTable } from "@/components/workflow/lens-table"
import { useTrace } from "@/hooks/use-traces"
import { useWorkflowCost } from "@/hooks/use-ops-metrics"
import { traceStatusBadgeClass } from "@/lib/status"
import { buildTimeline, executionTrace, formatMicros } from "@/lib/trace-timeline"
import { formatDate, formatWhen, serverTime } from "@/lib/utils"
import { costView, runInsights, runOverlay, type LensSection } from "@/lib/workflow-lens"

/** How many channels, and how many of each one's newest traces, to look through. */
const MAX_CHANNELS = 3
const PER_LIST = 3
const MAX_CANDIDATES = 5

const hasSteps = (t: TraceDetail | undefined) => (executionTrace(t)?.steps.length ?? 0) > 0

/**
 * The newest trace with step data through the channels running this workflow
 * — failed runs first, since a channel with `errors_only` keeps steps for
 * nothing else. Looks at a few rows per channel and reads each one's detail
 * (the list is payload-free) until one carries `task_trace_json` steps.
 */
function useNewestTraceWithSteps(channels: Channel[], enabled: boolean) {
  const names = channels.slice(0, MAX_CHANNELS).map((c) => c.name)
  const lists = useQueries({
    queries: names.flatMap((channel) =>
      [{ channel, status: "failed", limit: PER_LIST }, { channel, limit: PER_LIST }].map((params) => ({
        queryKey: ["traces", params],
        queryFn: () => tracesApi.list(params),
        enabled,
      })),
    ),
  })
  const listsLoading = lists.some((q) => q.isLoading)

  const newestFirst = (a: Trace, b: Trace) => (serverTime(b.created_at) ?? 0) - (serverTime(a.created_at) ?? 0)
  const all = lists.flatMap((q) => q.data?.data ?? [])
  const candidates: string[] = []
  for (const t of [
    ...all.filter((t) => t.status === "failed").sort(newestFirst),
    ...all.filter((t) => t.status !== "failed").sort(newestFirst),
  ]) {
    if (!candidates.includes(t.id)) candidates.push(t.id)
  }
  candidates.splice(MAX_CANDIDATES)

  const details = useQueries({
    queries: candidates.map((id) => ({
      queryKey: ["traces", id],
      queryFn: () => tracesApi.get(id),
      enabled,
    })),
  })

  // The first candidate, in order, whose detail has steps; loading while an
  // earlier one is still in flight, so the pick does not jump.
  let picked: TraceDetail | null = null
  let loading = listsLoading
  for (const q of details) {
    if (q.isLoading) {
      loading = true
      break
    }
    if (hasSteps(q.data)) {
      picked = q.data!
      break
    }
  }
  return { trace: picked, loading: enabled && loading && !picked, looked: candidates.length }
}

export function RunLens({
  workflow,
  runsOn,
  sections,
  traceId,
  onClearTrace,
}: {
  workflow: Workflow
  runsOn: Channel[]
  sections: LensSection[]
  traceId: string
  onClearTrace: () => void
}) {
  const pinned = useTrace(traceId)
  const newest = useNewestTraceWithSteps(runsOn, !traceId)
  const cost = useWorkflowCost(workflow.workflow_id)

  const trace = traceId ? (pinned.data ?? null) : newest.trace
  const loading = traceId ? pinned.isLoading : newest.loading
  const timeline = useMemo(() => (trace ? buildTimeline(trace, workflow) : null), [trace, workflow])
  const overlay = useMemo(() => (timeline ? runOverlay(sections, timeline) : null), [sections, timeline])
  const view = useMemo(() => (cost.runs > 0 ? costView(sections, cost) : null), [sections, cost])

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <p className="text-sm text-muted-foreground">Looking for a run with step data…</p>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (traceId && pinned.error) {
    return (
      <Callout variant="destructive">
        <div className="space-y-2">
          <p>
            Trace <code className="font-mono">{traceId.slice(0, 8)}</code> could not be loaded
            {pinned.error instanceof Error ? `: ${pinned.error.message}` : "."}
          </p>
          <Button size="xs" variant="outline" onClick={onClearTrace}>
            Use the newest run instead
          </Button>
        </div>
      </Callout>
    )
  }

  if (!trace || !timeline || !overlay) {
    return <NoStepData runsOn={runsOn} trace={trace} pinned={!!traceId} onClearTrace={onClearTrace} />
  }

  const foreign = trace.channel && runsOn.length > 0 && !runsOn.some((c) => c.name === trace.channel)
  const insights = runInsights(sections, overlay, timeline, view, trace.error)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <Link to={`/traces/${trace.id}`} className="font-mono font-medium underline-offset-2 hover:underline">
          Trace {trace.id.slice(0, 8)}
        </Link>
        <Badge variant="outline" className={traceStatusBadgeClass(trace.status)}>
          {trace.status}
        </Badge>
        <span className="text-muted-foreground">
          {trace.mode}
          {trace.channel ? ` · ${trace.channel}` : ""}
        </span>
        <span className="text-muted-foreground" title={formatDate(trace.created_at)}>
          {formatWhen(trace.created_at)}
        </span>
        <span className="font-mono tabular-nums">{formatMicros(timeline.totalUs)} total</span>
        <span className="text-xs text-muted-foreground">
          {traceId ? "from the link" : trace.status === "failed" ? "newest failed run with step data" : "newest run with step data"}
        </span>
        {traceId && (
          <Button size="xs" variant="ghost" onClick={onClearTrace}>
            Show the newest instead
          </Button>
        )}
      </div>

      {foreign && (
        <Callout variant="warning">
          This trace ran through {trace.channel}, which does not run this workflow now. Steps it does not mention read
          as not reached.
        </Callout>
      )}
      {timeline.truncated && (
        <Callout variant="muted">
          The trace hit its snapshot limit: later steps keep their timings but not what they wrote.
        </Callout>
      )}

      <LensTable lens="run" sections={sections} loop={workflow.loop} overlay={overlay} caption={`Trace ${trace.id.slice(0, 8)} over the steps`} />

      <LensInsights insights={insights} label="Last run read-outs" />
    </div>
  )
}

function NoStepData({
  runsOn,
  trace,
  pinned,
  onClearTrace,
}: {
  runsOn: Channel[]
  trace: TraceDetail | null
  pinned: boolean
  onClearTrace: () => void
}) {
  if (pinned) {
    return (
      <Callout variant="muted">
        <div className="space-y-2">
          <p>
            Trace <code className="font-mono">{trace?.id.slice(0, 8)}</code> kept no step data — its channel does not
            record <code className="font-mono">tracing.task_details</code>, or kept them for failed runs only.
          </p>
          <Button size="xs" variant="outline" onClick={onClearTrace}>
            Look for the newest run with step data
          </Button>
        </div>
      </Callout>
    )
  }
  if (runsOn.length === 0) {
    return <Callout variant="muted">No channel runs this workflow, so there is no run to show.</Callout>
  }
  const ch = runsOn[0]
  const tracing = ch.config?.tracing
  const reason = !tracing?.task_details
    ? "It does not record step data: tracing.task_details is off."
    : tracing.errors_only
      ? "It keeps step data for failed runs only (errors_only), and none of its recent runs failed."
      : "None of its recent runs kept step data."
  return (
    <Callout variant="muted">
      <div className="space-y-1.5">
        <p>
          No recent trace through{" "}
          <Link to={`/channels/${ch.channel_id}`} className="font-mono">
            {ch.name}
          </Link>{" "}
          carries step data, so there is no run to lay over the steps. {reason}
        </p>
        <p className="text-xs">
          Turn on <code className="font-mono">task_details</code> in the channel&apos;s tracing settings to see where a
          run&apos;s time goes; with <code className="font-mono">errors_only</code> a slow run that succeeded keeps no
          steps.
        </p>
      </div>
    </Callout>
  )
}
