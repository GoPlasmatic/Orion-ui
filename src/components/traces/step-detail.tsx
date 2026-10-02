import { useState } from "react"
import { Link } from "react-router"
import { ExternalLink, GitBranch, Search } from "lucide-react"
import type { TaskCost } from "@/hooks/use-ops-metrics"
import type { MetricsState } from "@/hooks/use-metrics"
import type { FunctionIndex, StepEffect } from "@/lib/function-effects"
import { metricsShort } from "@/lib/metrics-state"
import type { Timeline, TimelineStep } from "@/lib/trace-timeline"
import { formatMicros } from "@/lib/trace-timeline"
import { effectLabel, resourceLabel, retryLabel, writesBefore, type PriorWrite } from "@/lib/trace-step-uses"
import { formatMs } from "@/lib/traffic-encoding"
import { plural } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Fact } from "@/components/shared/fact"
import { JsonViewer } from "@/components/shared/json-viewer"

export interface StepDetailProps {
  step: TimelineStep
  timeline: Timeline
  effect: StepEffect | null
  /** The metrics feed's state, and this task's baseline when it has one. */
  costState: MetricsState
  cost: TaskCost | undefined
  /** The function catalogue, indexed once by the page. */
  index: FunctionIndex
  trace: { id: string; error?: string | null; channel?: string | null }
  workflowId: string | null
  /** The connector's id when `effect` names one the registry knows. */
  connectorId: string | null
}

function normalText(state: MetricsState, cost: TaskCost | undefined): string {
  if (cost && cost.runs > 0) return `mean ${formatMs(cost.meanMs)} · p95 ${formatMs(cost.p95Ms)}`
  if (state === "loading" || state === "off" || state === "error") return metricsShort(state)
  return "no runs recorded since the server started"
}

/** `(db_write → soma-db) · unsafe to retry · finished 793 µs earlier · wrote temp_data.s.inserted` */
function priorLine(w: PriorWrite): string {
  const r = w.effect.resource
  const parts = [`(${w.effect.fn}${r ? ` → ${resourceLabel(r)}` : ""})`, retryLabel(w.effect)]
  if (w.gapUs != null) parts.push(`finished ${formatMicros(w.gapUs)} earlier`)
  if (w.step.changes.length > 0) parts.push(`wrote ${w.step.changes.map((c) => c.path).join(", ")}`)
  return parts.join(" · ")
}

function resourceLink(effect: StepEffect | null, connectorId: string | null): string | null {
  const r = effect?.resource
  if (!r?.name) return null
  if (r.kind === "connector") return connectorId ? `/connectors/${encodeURIComponent(connectorId)}` : null
  if (r.kind === "plugin") return `/plugins/${encodeURIComponent(r.name)}`
  if (r.kind === "model") return `/models/${encodeURIComponent(r.name)}`
  return null
}

export function StepDetail({
  step,
  timeline,
  effect,
  costState,
  cost,
  index,
  trace,
  workflowId,
  connectorId,
}: StepDetailProps) {
  const [showValues, setShowValues] = useState(false)
  const failed = step.outcome === "failed"
  const skipped = step.outcome === "skipped"
  const recorded = Array.isArray(step.raw.changes)
  const hasValues = step.changes.some((c) => c.new_value !== undefined)
  const prior = failed ? writesBefore(timeline, step, index) : []
  const snapshot = step.raw.message
  const snapshotData = snapshot?.context?.data
  const link = resourceLink(effect, connectorId)
  const sameStep = trace.channel
    ? `/traces?channel=${encodeURIComponent(trace.channel)}${failed ? "&status=failed" : ""}`
    : null

  return (
    <section className="grid gap-3 rounded-lg border bg-card p-4" aria-live="polite" aria-label={`Step ${step.taskId}`}>
      <h3 className="flex flex-wrap items-baseline gap-2 text-[15px] font-semibold">
        <span className="font-mono">{step.taskId}</span>
        {step.task?.name && step.task.name !== step.taskId && (
          <small className="text-[13px] font-normal text-muted-foreground">{step.task.name}</small>
        )}
        <Badge variant={failed ? "destructive" : skipped ? "outline" : "success"}>
          {failed ? "failed" : skipped ? "skipped" : "ok"}
        </Badge>
        {step.iteration != null && <Badge variant="outline">iteration {step.iteration}</Badge>}
        {step.element != null && <Badge variant="outline">element {step.element}</Badge>}
      </h3>

      {failed && trace.error && (
        <Callout variant="destructive">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{trace.error}</pre>
        </Callout>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Fact label="Function">{effect?.fn || "not in the loaded workflow"}</Fact>
        <Fact label="Uses">{effectLabel(effect)}</Fact>
        <Fact label="Started">{step.startUs != null ? `+${formatMicros(step.startUs)}` : "—"}</Fact>
        <Fact label="Took">{skipped ? "skipped" : formatMicros(step.durationUs)}</Fact>
        <Fact
          label={
            cost && cost.runs > 0
              ? `Normal (${plural(cost.runs, step.phase === "body" ? "iteration" : "run")})`
              : "Normal"
          }
        >
          {normalText(costState, cost)}
        </Fact>
        <Fact label="Snapshot">
          {skipped ? "none (skipped)" : step.hasSnapshot ? "kept" : timeline.truncated ? "dropped · trace truncated" : "none"}
        </Fact>
        <Fact label="Wrote" wide>
          {!recorded ? (
            "not recorded"
          ) : step.changes.length === 0 ? (
            "nothing"
          ) : (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {step.changes.map((c, i) => (
                <code key={`${c.path}-${i}`}>{c.path}</code>
              ))}
              {hasValues && (
                <button
                  type="button"
                  className="font-sans text-xs text-primary underline underline-offset-2"
                  aria-expanded={showValues}
                  onClick={() => setShowValues((v) => !v)}
                >
                  {showValues ? "Hide values" : "Show values"}
                </button>
              )}
            </span>
          )}
        </Fact>
      </dl>

      {showValues && hasValues && (
        <div className="grid gap-2">
          {step.changes.map((c, i) =>
            c.new_value === undefined ? null : (
              <JsonViewer key={`${c.path}-${i}`} data={c.new_value} label={c.path} maxHeight="12rem" />
            ),
          )}
        </div>
      )}

      {prior.length > 0 && (
        <Callout variant="warning">
          <p className="font-medium">Before this step</p>
          <p className="mt-0.5 text-xs">Writes that completed before the failure; retrying runs them again.</p>
          <ul className="mt-2 grid gap-1 text-xs">
            {prior.map((w) => (
              <li key={w.step.index}>
                <code className="font-medium">{w.step.taskId}</code> {priorLine(w)}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {snapshot !== undefined && (
        <JsonViewer
          data={snapshotData !== undefined ? snapshotData : snapshot}
          label={snapshotData !== undefined ? "Data after this step" : "Message after this step"}
          maxHeight="16rem"
        />
      )}

      <div className="flex flex-wrap gap-2">
        {workflowId && (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/workflows/${encodeURIComponent(workflowId)}?lens=run&trace=${encodeURIComponent(trace.id)}`}>
              <GitBranch className="h-3.5 w-3.5" /> Show on workflow
            </Link>
          </Button>
        )}
        {sameStep && (
          <Button variant="outline" size="sm" asChild>
            <Link to={sameStep}>
              <Search className="h-3.5 w-3.5" /> Same step, other traces
            </Link>
          </Button>
        )}
        {link && effect?.resource && (
          <Button variant="outline" size="sm" asChild>
            <Link to={link}>
              <ExternalLink className="h-3.5 w-3.5" /> Open {resourceLabel(effect.resource)}
            </Link>
          </Button>
        )}
      </div>
    </section>
  )
}
