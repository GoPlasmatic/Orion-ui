import type { Workflow } from "@/api/types"
import { Callout } from "@/components/ui/callout"
import { Skeleton } from "@/components/ui/skeleton"
import { LensInsights } from "@/components/workflow/lens-insights"
import { Dash, LensTable, ShareBar, type LensColumn } from "@/components/workflow/lens-table"
import type { MetricsState } from "@/hooks/use-metrics"
import { METRICS_STATE_TEXT } from "@/lib/metrics-state"
import type { StepPhase } from "@/lib/trace-timeline"
import { formatMs } from "@/lib/traffic-encoding"
import { plural } from "@/lib/utils"
import { costInsights, type CostView, type LensSection } from "@/lib/workflow-lens"

/** Below this many runs a mean is still settling, and the page says so. */
const FEW_RUNS = 20

/**
 * Where a steady-state run's time goes, from
 * `orion_task_duration_seconds{workflow,task}` and
 * `orion_workflow_duration_seconds{workflow}` since the server started. Each
 * step's mean is weighted by how often it runs per run, so a loop body's
 * share reflects its iterations. The view is computed once by the lens host.
 */
export function CostLens({
  workflow,
  sections,
  state,
  cost,
}: {
  workflow: Workflow
  sections: LensSection[]
  state: MetricsState
  /** The measured view, or null when there is nothing measured to show. */
  cost: CostView | null
}) {
  if (state === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <p className="text-sm text-muted-foreground">{METRICS_STATE_TEXT.loading.sentence}</p>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const columns: LensColumn[] = [
    {
      key: "share",
      head: "Share of a run",
      headClassName: "min-w-40",
      cell: (row) => {
        const c = cost?.cells.get(row.id)
        return c?.sharePct != null ? <ShareBar pct={c.sharePct} tone={cost?.dominant === row.id ? "hot" : "normal"} /> : <Dash />
      },
    },
    { key: "mean", head: "mean", numeric: true, cell: (row) => figure(cost?.cells.get(row.id)?.meanMs) },
    { key: "p95", head: "p95", numeric: true, cell: (row) => figure(cost?.cells.get(row.id)?.p95Ms) },
    {
      key: "runs",
      head: "runs",
      numeric: true,
      cell: (row) => {
        const n = cost?.cells.get(row.id)?.runs ?? 0
        return n > 0 ? n.toLocaleString("en") : <Dash />
      },
    },
  ]

  const sectionNote = (phase: StepPhase) => {
    if (!cost) return ""
    if (phase === "body" && cost.iterations != null) {
      return ` · ${plural(cost.iterations, "iteration")} (${(cost.iterations / cost.runs).toFixed(2)} per run)`
    }
    return phase === "setup" ? ` · ${plural(cost.runs, "run")} since the server started` : ""
  }

  return (
    <div className="space-y-4">
      {(state === "off" || state === "error") && (
        <Callout variant={state === "off" ? "muted" : "warning"}>
          {METRICS_STATE_TEXT[state].sentence} There is no per-step cost to show, so the steps are listed without figures.
        </Callout>
      )}
      {state !== "off" && state !== "error" && !cost && (
        <Callout variant="muted">
          No run of this workflow has been recorded since the server started
          {workflow.status !== "active" ? " — it is not active" : ""}. Its cost appears here after the first run.
        </Callout>
      )}

      {cost && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">mean run </span>
            <span className="font-mono tabular-nums">{formatMs(cost.meanMs)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">p95 </span>
            <span className="font-mono tabular-nums">{formatMs(cost.p95Ms)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">runs since the server started </span>
            <span className="font-mono tabular-nums">{cost.runs.toLocaleString("en")}</span>
          </span>
          {cost.runs < FEW_RUNS && (
            <span className="text-warning">only {plural(cost.runs, "run")} so far — the figures are still settling</span>
          )}
        </div>
      )}

      <LensTable
        workflow={workflow}
        sections={sections}
        columns={columns}
        caption="Where a run's time goes"
        sectionNote={sectionNote}
        rowTone={(row) => (cost?.dominant === row.id ? "hot" : undefined)}
        footer={
          cost && cost.overheadMs != null
            ? [
                {
                  key: "overhead",
                  label: "engine overhead",
                  detail: "conditions, loop bookkeeping, audit",
                  cells: { share: <ShareBar pct={cost.overheadPct} tone="overhead" />, mean: formatMs(cost.overheadMs) },
                },
              ]
            : []
        }
      />

      {cost && <LensInsights insights={costInsights(sections, cost)} label="Cost read-outs" />}
    </div>
  )
}

const figure = (ms: number | null | undefined) => (ms != null ? formatMs(ms) : <Dash />)
