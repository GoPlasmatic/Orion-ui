import { useMemo } from "react"
import { Link } from "react-router"
import type { Channel, TraceDetail, Workflow } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { LensInsights } from "@/components/workflow/lens-insights"
import { Dash, LensTable, RunStatusLabel, type LensColumn } from "@/components/workflow/lens-table"
import { useNewestTraceWithSteps, useTrace } from "@/hooks/use-traces"
import { entityRoute } from "@/lib/audit-routes"
import { traceStatusBadgeClass } from "@/lib/status"
import { buildTimeline, formatMicros, stepDataGap, traceWorkflowId, type StepDataGap } from "@/lib/trace-timeline"
import { formatDate, formatWhen } from "@/lib/utils"
import { runInsights, runOverlay, type CostView, type LensSection } from "@/lib/workflow-lens"

/** Why there is no run to lay over the steps, worded for this page. */
const GAP_TEXT: Record<StepDataGap, string> = {
  unsettled: "The run has not finished yet, so it has no steps to show.",
  no_channel: "Its channel does not run this workflow now, so why it kept no steps cannot be read from here.",
  details_off: "The channel does not record step data: tracing.task_details is off.",
  errors_only: "The channel keeps step data for failed runs only (errors_only), and none failed recently.",
  failed_unrecorded: "The run failed and kept no steps — before its first step, or its error ended the run unrecorded.",
  ran_nothing: "The run executed no step — a condition or the rollout gate skipped it.",
}

export function RunLens({
  workflow,
  runsOn,
  sections,
  cost,
  traceId,
  onClearTrace,
}: {
  workflow: Workflow
  runsOn: Channel[]
  sections: LensSection[]
  /** Per-step baselines for "against its p95"; null before the first run. */
  cost: CostView | null
  traceId: string
  onClearTrace: () => void
}) {
  const pinned = useTrace(traceId)
  const newest = useNewestTraceWithSteps(runsOn, !traceId)

  const trace = traceId ? (pinned.data ?? null) : newest.trace
  const loading = traceId ? pinned.isLoading : newest.loading
  const timeline = useMemo(() => (trace ? buildTimeline(trace, workflow) : null), [trace, workflow])
  const overlay = useMemo(() => (timeline ? runOverlay(sections, timeline) : null), [sections, timeline])

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

  const channelOf = (t: TraceDetail) => runsOn.find((c) => c.channel_id === t.channel_id || c.name === t.channel)

  if (!trace || !timeline || !overlay) {
    // A pinned trace says why it has no steps itself; with none pinned, the
    // channels' tracing config is the reason.
    let gap: StepDataGap | null
    if (trace) gap = stepDataGap(trace, channelOf(trace))
    else if (runsOn.length === 0) gap = "no_channel"
    else if (!newest.anyRecording) gap = "details_off"
    else gap = runsOn.some((c) => c.config?.tracing?.task_details && c.config.tracing.errors_only) ? "errors_only" : null
    return <NoStepData runsOn={runsOn} trace={trace} gap={gap} onClearTrace={traceId ? onClearTrace : undefined} />
  }

  const ranWorkflow = traceWorkflowId(trace, channelOf(trace))
  const foreign = ranWorkflow != null && ranWorkflow !== workflow.workflow_id
  const insights = runInsights(sections, overlay, timeline, cost, trace.error)

  const columns: LensColumn[] = [
    { key: "status", head: "This run", cell: (row) => <RunStatusLabel status={overlay.get(row.id)?.status ?? "not-reached"} /> },
    {
      key: "took",
      head: "took",
      numeric: true,
      cell: (row) => {
        const c = overlay.get(row.id)
        if (c?.durationUs == null) return <Dash />
        return (
          <>
            {formatMicros(c.durationUs)}
            {c.executions > 1 && <span className="text-muted-foreground"> · {c.executions}×</span>}
          </>
        )
      },
    },
    {
      key: "wrote",
      head: "Wrote",
      cell: (row) => {
        const paths = overlay.get(row.id)?.changes ?? []
        return paths.length ? <span className="font-mono text-xs text-muted-foreground">{paths.join(", ")}</span> : <Dash />
      },
    },
  ]

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
          This trace ran {ranWorkflow}, not this workflow. Steps it does not mention read as not reached.
        </Callout>
      )}
      {timeline.truncated && (
        <Callout variant="muted">
          The trace hit its snapshot limit: later steps keep their timings but not what they wrote.
        </Callout>
      )}

      <LensTable
        workflow={workflow}
        sections={sections}
        columns={columns}
        caption={`Trace ${trace.id.slice(0, 8)} over the steps`}
        rowTone={(row) => (overlay.get(row.id)?.status === "failed" ? "bad" : undefined)}
      />

      <LensInsights insights={insights} label="Last run read-outs" />
    </div>
  )
}

function NoStepData({
  runsOn,
  trace,
  gap,
  onClearTrace,
}: {
  runsOn: Channel[]
  trace: TraceDetail | null
  gap: StepDataGap | null
  onClearTrace?: () => void
}) {
  const ch = runsOn[0]
  const route = ch ? entityRoute("channel", ch.channel_id) : null
  // With no channel the opening sentence already says it all.
  const reason = !trace && !ch ? "" : gap ? GAP_TEXT[gap] : "None of its recent runs kept step data."
  return (
    <Callout variant="muted">
      <div className="space-y-2">
        <p>
          {trace ? (
            <>
              Trace <code className="font-mono">{trace.id.slice(0, 8)}</code> kept no step data.
            </>
          ) : ch ? (
            <>
              No recent trace through{" "}
              {route ? (
                <Link to={route} className="font-mono">
                  {ch.name}
                </Link>
              ) : (
                ch.name
              )}{" "}
              carries step data, so there is no run to lay over the steps.
            </>
          ) : (
            "No channel runs this workflow, so there is no run to show."
          )}{" "}
          {reason}
        </p>
        {ch && (gap === "details_off" || gap === "errors_only") && (
          <p className="text-xs">
            Turn on <code className="font-mono">task_details</code> in the channel&apos;s tracing settings to see where a
            run&apos;s time goes; with <code className="font-mono">errors_only</code> a slow run that succeeded keeps no
            steps.
          </p>
        )}
        {onClearTrace && (
          <Button size="xs" variant="outline" onClick={onClearTrace}>
            Look for the newest run with step data
          </Button>
        )}
      </div>
    </Callout>
  )
}
