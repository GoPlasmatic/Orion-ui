import { useMemo } from "react"
import type { Workflow } from "@/api/types"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { LensInsights } from "@/components/workflow/lens-insights"
import { LensTable } from "@/components/workflow/lens-table"
import { useWorkflowCost } from "@/hooks/use-ops-metrics"
import { costInsights, costView, formatMs, type LensSection } from "@/lib/workflow-lens"

/** Below this many runs a mean is still settling, and the page says so. */
const FEW_RUNS = 20

/**
 * Where a steady-state run's time goes, from
 * `orion_task_duration_seconds{workflow,task}` and
 * `orion_workflow_duration_seconds{workflow}` since the server started. Each
 * step's mean is weighted by how often it runs per run, so a loop body's
 * share reflects its iterations.
 */
export function CostLens({ workflow, sections }: { workflow: Workflow; sections: LensSection[] }) {
  const cost = useWorkflowCost(workflow.workflow_id)
  const view = useMemo(() => costView(sections, cost), [sections, cost])
  const hasRuns = cost.state === "live" && cost.runs > 0

  if (cost.state === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading metrics…</p>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {cost.state === "off" && (
        <Callout variant="muted">
          Metrics are off on this server, so there is no per-step cost to show. The steps are listed without figures.
        </Callout>
      )}
      {cost.state === "error" && (
        <Callout variant="warning">
          The metrics endpoint did not answer, so there is no per-step cost to show right now.
        </Callout>
      )}
      {cost.state === "live" && cost.runs === 0 && (
        <Callout variant="muted">
          No run of this workflow has been recorded since the server started{workflow.status !== "active" ? " — it is not active" : ""}. Its cost
          appears here after the first run.
        </Callout>
      )}

      {hasRuns && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">mean run </span>
            <span className="font-mono tabular-nums">{formatMs(view.meanMs)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">p95 </span>
            <span className="font-mono tabular-nums">{formatMs(view.p95Ms)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">runs since the server started </span>
            <span className="font-mono tabular-nums">{view.runs.toLocaleString("en")}</span>
          </span>
          {view.runs < FEW_RUNS && (
            <span className="text-warning">only {view.runs} so far — the figures are still settling</span>
          )}
        </div>
      )}

      <LensTable
        lens="cost"
        sections={sections}
        loop={workflow.loop}
        cost={hasRuns ? view : null}
        caption="Where a run's time goes"
      />

      {hasRuns && <LensInsights insights={costInsights(sections, view)} label="Cost read-outs" />}
    </div>
  )
}
