import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import { ExternalLink, GitBranch, Search } from "lucide-react"
import type { FunctionSchema } from "@/api/types"
import type { TaskCost } from "@/hooks/use-ops-metrics"
import type { MetricsState } from "@/hooks/use-metrics"
import type { Timeline, TimelineStep } from "@/lib/trace-timeline"
import { formatMicros } from "@/lib/trace-timeline"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { JsonViewer } from "@/components/shared/json-viewer"
import { retrySafetyLabel, writesBefore, type PriorWrite, type StepUses } from "./step-uses"

export interface StepDetailProps {
  step: TimelineStep
  timeline: Timeline
  uses: StepUses
  /** The metrics feed's state, and this task's baseline when it has one. */
  costState: MetricsState
  cost: TaskCost | undefined
  catalogue: FunctionSchema[] | undefined
  trace: { id: string; error?: string | null; channel?: string | null }
  workflowId: string | null
  /** The connector's id when `uses` names one the registry knows. */
  connectorId: string | null
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-mono text-[13px]">{children}</dd>
    </div>
  )
}

const msOf = (ms: number | null | undefined) => (ms == null ? "—" : formatMicros(ms * 1000))

function normalText(state: MetricsState, cost: TaskCost | undefined): string {
  if (cost && cost.runs > 0) return `mean ${msOf(cost.meanMs)} · p95 ${msOf(cost.p95Ms)}`
  if (state === "loading") return "loading metrics"
  if (state === "off") return "metrics off"
  if (state === "error") return "metrics unavailable"
  return "no runs recorded since the server started"
}

/** `(db_write → soma-db) · unsafe write · finished 793 µs earlier · wrote temp_data.s.inserted` */
function priorLine(w: PriorWrite): string {
  const parts = [
    `(${w.function}${w.uses.resource ? ` → ${w.uses.resource}` : ""})`,
    `${retrySafetyLabel(w.safety)}${w.decidingValue != null ? ` (${w.decidingValue})` : ""}`,
  ]
  if (w.gapUs != null) parts.push(`finished ${formatMicros(w.gapUs)} earlier`)
  if (w.step.changes.length > 0) parts.push(`wrote ${w.step.changes.map((c) => c.path).join(", ")}`)
  return parts.join(" · ")
}

export function StepDetail({
  step,
  timeline,
  uses,
  costState,
  cost,
  catalogue,
  trace,
  workflowId,
  connectorId,
}: StepDetailProps) {
  const [showValues, setShowValues] = useState(false)
  const failed = step.outcome === "failed"
  const skipped = step.outcome === "skipped"
  const fn = step.task?.function?.name ?? null
  const recorded = Array.isArray(step.raw.changes)
  const hasValues = step.changes.some((c) => c.new_value !== undefined)
  const prior = failed ? writesBefore(timeline, step, catalogue) : []
  const snapshot = step.raw.message
  const snapshotData = snapshot?.context?.data
  const runsNoun = step.phase === "body" ? "iterations" : "runs"

  const resourceLink =
    uses.kind === "connector" && connectorId
      ? `/connectors/${encodeURIComponent(connectorId)}`
      : uses.kind === "plugin" && uses.resourceId
        ? `/plugins/${encodeURIComponent(uses.resourceId)}`
        : uses.kind === "model" && uses.resourceId
          ? `/models/${encodeURIComponent(uses.resourceId)}`
          : null

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
        <Fact label="Function">{fn ?? "not in the loaded workflow"}</Fact>
        <Fact label="Uses">{uses.label}</Fact>
        <Fact label="Started">{step.startUs != null ? `+${formatMicros(step.startUs)}` : "—"}</Fact>
        <Fact label="Took">{skipped ? "skipped" : formatMicros(step.durationUs)}</Fact>
        <Fact label={cost && cost.runs > 0 ? `Normal (${cost.runs.toLocaleString("en")} ${runsNoun})` : "Normal"}>
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
        {resourceLink && (
          <Button variant="outline" size="sm" asChild>
            <Link to={resourceLink}>
              <ExternalLink className="h-3.5 w-3.5" /> Open {uses.resource}
            </Link>
          </Button>
        )}
      </div>
    </section>
  )
}
