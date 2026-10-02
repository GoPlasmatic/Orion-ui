import { useMemo, type ReactNode } from "react"
import { Link } from "react-router"
import type { Channel, TraceDetail } from "@/api/types"
import { useActiveWorkflow } from "@/hooks/use-workflows"
import { useWorkflowCost } from "@/hooks/use-ops-metrics"
import { useFunctions } from "@/hooks/use-functions"
import { useConnectors } from "@/hooks/use-connectors"
import { buildTimeline, executionTrace, notReached } from "@/lib/trace-timeline"
import { useUrlFilters } from "@/lib/use-url-filters"
import { REGISTRY_LIMIT } from "@/lib/use-pagination"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Callout } from "@/components/ui/callout"
import { TraceTimeline } from "./trace-timeline"
import { StepDetail } from "./step-detail"
import { stepUses } from "./step-uses"

const STEP_KEYS = ["step"] as const

/**
 * The trace page's step section: the timeline and the selected step, or —
 * when the run kept no steps — why not, read off the channel's tracing config.
 * The selection lives in `?step=<index>` so a link lands on the step.
 */
export function TraceSteps({ trace, channel }: { trace: TraceDetail; channel: Channel | undefined }) {
  const et = useMemo(() => executionTrace(trace), [trace])
  const workflowId =
    channel?.workflow_id ?? et?.steps.find((s) => typeof s.workflow_id === "string")?.workflow_id ?? null
  // The version that runs — the latest is the draft while one is open.
  const { workflow } = useActiveWorkflow(workflowId ?? "")
  const timeline = useMemo(() => buildTimeline(trace, workflow), [trace, workflow])
  const cost = useWorkflowCost(workflowId)
  const { data: catalogue } = useFunctions()
  const connectors = useConnectors({ limit: REGISTRY_LIMIT }, !!timeline)
  const { values, set } = useUrlFilters(STEP_KEYS)

  const uses = useMemo(
    () => (timeline ? timeline.steps.map((s) => stepUses(s.task, catalogue)) : []),
    [timeline, catalogue],
  )

  if (!timeline) return <NoStepData trace={trace} channel={channel} />

  const fromUrl = values.step === "" ? NaN : Number(values.step)
  const selectedIndex =
    Number.isInteger(fromUrl) && fromUrl >= 0 && fromUrl < timeline.steps.length
      ? fromUrl
      : (timeline.failed ?? timeline.dominant)?.index ?? null
  const selected = selectedIndex != null ? timeline.steps[selectedIndex] : null
  const selectedUses = selected ? uses[selected.index] : null
  const connectorId =
    selectedUses?.kind === "connector" && selectedUses.resource
      ? (connectors.data?.data.find((c) => c.name === selectedUses.resource)?.id ?? null)
      : null

  const loop = workflow?.loop
  const over = loop?.over as { var?: unknown } | undefined
  const loopBinding =
    loop?.as && over && typeof over === "object" && typeof over.var === "string" ? { as: loop.as, over: over.var } : null

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
          uses={uses}
          costs={cost.tasks.size ? cost.tasks : null}
          selected={selectedIndex}
          onSelect={(i) => set({ step: String(i) })}
          mode={trace.mode}
          loopBinding={loopBinding}
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

        {selected && selectedUses && (
          <StepDetail
            key={selected.index}
            step={selected}
            timeline={timeline}
            uses={selectedUses}
            costState={cost.state}
            cost={cost.tasks.get(selected.taskId)}
            catalogue={catalogue}
            trace={trace}
            workflowId={workflowId}
            connectorId={connectorId}
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The run kept no steps. Say why, from the channel's own `tracing` block, and
 * where to change it — an empty pipeline reads as "the workflow did nothing".
 */
function NoStepData({ trace, channel }: { trace: TraceDetail; channel: Channel | undefined }) {
  const tracing = channel?.config?.tracing
  const editTo = channel ? (channel.status === "draft" ? `/channels/${channel.channel_id}/edit` : `/channels/${channel.channel_id}`) : null
  const editLabel = channel?.status === "draft" ? "Edit the channel's tracing" : "Open the channel (a new version changes tracing)"

  let why: ReactNode
  if (trace.status === "pending" || trace.status === "running") {
    why = "The run has not finished. Steps are recorded when it settles."
  } else if (!channel) {
    why = trace.channel_id
      ? "The channel could not be loaded, so its tracing settings are unknown."
      : "This run arrived on no channel the console can read, so its tracing settings are unknown."
  } else if (!tracing?.task_details) {
    why = (
      <>
        <span className="font-medium">{channel.name}</span> does not keep step data:{" "}
        <code>tracing.task_details</code> is off. Turn it on to record every step's timing, writes and
        snapshot for future runs.
      </>
    )
  } else if (tracing.errors_only && trace.status !== "failed") {
    why = (
      <>
        <span className="font-medium">{channel.name}</span> keeps step data for failed runs only (
        <code>tracing.errors_only</code>), and this run did not fail. A slow run that succeeds keeps no steps.
      </>
    )
  } else if (trace.status === "failed") {
    why = "The run failed before its first step: refused at admission, by validation or before the workflow was chosen."
  } else {
    why = (
      <>
        <span className="font-medium">{channel.name}</span> records steps, but this run kept none — its
        workflow's condition or rollout gate may have skipped it, or the channel was changed after it ran.
      </>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where the time went</CardTitle>
      </CardHeader>
      <CardContent>
        <Callout variant="muted">
          <p>No step data for this run. {why}</p>
          {editTo && (!tracing?.task_details || (tracing.errors_only && trace.status !== "failed")) && (
            <p className="mt-2">
              <Link to={editTo}>{editLabel}</Link>
            </p>
          )}
        </Callout>
      </CardContent>
    </Card>
  )
}
