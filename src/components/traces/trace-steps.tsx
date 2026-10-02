import { useMemo } from "react"
import { Link } from "react-router"
import type { Channel, TraceDetail } from "@/api/types"
import { useActiveWorkflow } from "@/hooks/use-workflows"
import { useWorkflowCost } from "@/hooks/use-ops-metrics"
import { useFunctionIndex } from "@/hooks/use-functions"
import { useConnectors } from "@/hooks/use-connectors"
import { stepEffect } from "@/lib/function-effects"
import { buildTimeline, notReached, stepDataGap, traceWorkflowId, type StepDataGap } from "@/lib/trace-timeline"
import { loopBinding } from "@/lib/workflow-steps"
import { useUrlFilters } from "@/lib/use-url-filters"
import { REGISTRY_LIMIT } from "@/lib/use-pagination"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Callout } from "@/components/ui/callout"
import { TraceTimeline } from "./trace-timeline"
import { StepDetail } from "./step-detail"

const STEP_KEYS = ["step"] as const

/**
 * The trace page's step section: the timeline and the selected step, or —
 * when the run kept no steps — why not, read off the channel's tracing config.
 * The selection lives in `?step=<index>` so a link lands on the step.
 */
export function TraceSteps({ trace, channel }: { trace: TraceDetail; channel: Channel | undefined }) {
  // The workflow the run's own steps name — the channel may have been
  // re-pointed since — at its active version, since a trace records none.
  const workflowId = traceWorkflowId(trace, channel)
  const { workflow } = useActiveWorkflow(workflowId ?? "")
  const timeline = useMemo(() => buildTimeline(trace, workflow), [trace, workflow])
  const cost = useWorkflowCost(workflowId)
  const index = useFunctionIndex()
  const connectors = useConnectors({ limit: REGISTRY_LIMIT }, !!timeline)
  const { values, set } = useUrlFilters(STEP_KEYS)

  const effects = useMemo(
    () => (timeline ? timeline.steps.map((s) => (s.task ? stepEffect(s.task, index) : null)) : []),
    [timeline, index],
  )

  if (!timeline) return <NoStepData trace={trace} channel={channel} />

  const fromUrl = values.step === "" ? NaN : Number(values.step)
  const selectedIndex =
    Number.isInteger(fromUrl) && fromUrl >= 0 && fromUrl < timeline.steps.length
      ? fromUrl
      : (timeline.failed ?? timeline.dominant)?.index ?? null
  const selected = selectedIndex != null ? timeline.steps[selectedIndex] : null
  const selectedEffect = selected ? (effects[selected.index] ?? null) : null
  const connectorName = selectedEffect?.resource?.kind === "connector" ? selectedEffect.resource.name : null
  const connectorId = connectorName
    ? (connectors.data?.data.find((c) => c.name === connectorName)?.id ?? null)
    : null

  const firstDropped = timeline.truncated ? timeline.steps.find((s) => s.outcome !== "skipped" && !s.hasSnapshot) : undefined
  const missed = trace.status === "failed" || trace.status === "completed" ? notReached(timeline, workflow) : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where the time went</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <TraceTimeline
          key={trace.id}
          timeline={timeline}
          effects={effects}
          costs={cost.tasks.size ? cost.tasks : null}
          selected={selectedIndex}
          onSelect={(i) => set({ step: String(i) })}
          mode={trace.mode}
          loopBinding={loopBinding(workflow)}
        />

        {timeline.truncated && (
          <Callout variant="muted">
            {firstDropped
              ? `Snapshots from step ${firstDropped.index + 1} (${firstDropped.taskId}) on were dropped`
              : "Some snapshots were dropped"}{" "}
            once the trace reached the server's snapshot size limit (<code>max_result_size_bytes</code>). Timings are complete.
          </Callout>
        )}

        {missed.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Not reached: {missed.map((t) => t.id).join(", ")}.
          </p>
        )}

        {selected && (
          <StepDetail
            key={selected.index}
            step={selected}
            timeline={timeline}
            effect={selectedEffect}
            costState={cost.state}
            cost={cost.tasks.get(selected.taskId)}
            index={index}
            trace={trace}
            workflowId={workflowId}
            connectorId={connectorId}
          />
        )}
      </CardContent>
    </Card>
  )
}

/** Why a run kept no steps, worded for the reader; `stepDataGap` decides which. */
function gapText(gap: StepDataGap, trace: TraceDetail, channelName: string | undefined) {
  const name = <span className="font-medium">{channelName}</span>
  switch (gap) {
    case "unsettled":
      return "The run has not finished. Steps are recorded when it settles."
    case "no_channel":
      return trace.channel_id
        ? "The channel could not be loaded, so its tracing settings are unknown."
        : "This run arrived on no channel the console can read, so its tracing settings are unknown."
    case "details_off":
      return (
        <>
          {name} does not keep step data: <code>tracing.task_details</code> is off. Turn it on to record every
          step's timing, writes and snapshot for future runs.
        </>
      )
    case "errors_only":
      return (
        <>
          {name} keeps step data for failed runs only (<code>tracing.errors_only</code>), and this run did not
          fail. A slow run that succeeds keeps no steps.
        </>
      )
    case "failed_unrecorded":
      return "The run failed and kept no steps: either before its first step (refused at admission or by validation), or the error ended it before the engine recorded them. The error above names what failed."
    case "ran_nothing":
      return (
        <>
          {name} records steps, but this run kept none — its workflow's condition or rollout gate may have
          skipped it, or the channel was changed after it ran.
        </>
      )
  }
}

/**
 * The run kept no steps. Say why, from the channel's own `tracing` block, and
 * where to change it — an empty pipeline reads as "the workflow did nothing".
 */
function NoStepData({ trace, channel }: { trace: TraceDetail; channel: Channel | undefined }) {
  const gap = stepDataGap(trace, channel)
  const draft = channel?.status === "draft"
  const showEdit = !!channel && (gap === "details_off" || gap === "errors_only")
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where the time went</CardTitle>
      </CardHeader>
      <CardContent>
        <Callout variant="muted">
          <p>No step data for this run. {gapText(gap, trace, channel?.name)}</p>
          {showEdit && (
            <p className="mt-2">
              <Link to={draft ? `/channels/${channel.channel_id}/edit` : `/channels/${channel.channel_id}`}>
                {draft ? "Edit the channel's tracing" : "Open the channel (a new version changes tracing)"}
              </Link>
            </p>
          )}
        </Callout>
      </CardContent>
    </Card>
  )
}
