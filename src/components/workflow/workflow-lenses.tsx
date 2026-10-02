import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import type { Channel, Workflow } from "@/api/types"
import { Button } from "@/components/ui/button"
import { CostLens } from "@/components/workflow/cost-lens"
import { DepsLens } from "@/components/workflow/deps-lens"
import { RunLens } from "@/components/workflow/run-lens"
import { StructureLens } from "@/components/workflow/structure-lens"
import { useWorkflowDependencies } from "@/hooks/use-workflows"
import { readStorage, writeStorage } from "@/lib/storage"
import { useUrlFilters } from "@/lib/use-url-filters"
import { cn } from "@/lib/utils"
import { LENSES, LENS_LABELS, lensSections, parseLens, type Lens } from "@/lib/workflow-lens"

/** Whether the diagram area is folded away — a laptop screen preference, per browser. */
const DIAGRAM_KEY = "orion-workflow-diagram"
const URL_KEYS = ["lens", "trace"] as const

const HINT: Record<Lens, string> = {
  structure: "The pipeline as the engine reads it",
  deps: "What each step touches outside the message",
  cost: "Where a steady-state run's time goes",
  run: "One trace laid over the steps",
}

/**
 * The workflow page's diagram area: one step tree, four lenses. The lens and
 * a pinned trace live in the URL (`?lens=deps|cost|run`, `?trace=<id>`), so
 * the trace page can link straight to a run laid over its workflow.
 */
export function WorkflowLenses({ workflow, runsOn }: { workflow: Workflow; runsOn: Channel[] }) {
  const { values, set } = useUrlFilters(URL_KEYS)
  const lens = parseLens(values.lens)
  const [hidden, setHidden] = useState(() => readStorage(DIAGRAM_KEY) === "hidden")

  // The server's walk names the plugin behind each function; the rows need it
  // to place a plugin call in its column. Shared by every lens.
  const deps = useWorkflowDependencies(workflow.workflow_id)
  const pluginOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of deps.data?.plugins ?? []) for (const fn of p.functions) m.set(fn, p.id)
    return m
  }, [deps.data])
  const sections = useMemo(() => lensSections(workflow, pluginOf), [workflow, pluginOf])
  // Active channels first: the one whose traces and schedule the lenses read.
  const channels = useMemo(
    () => [...runsOn].sort((a, b) => Number(b.status === "active") - Number(a.status === "active")),
    [runsOn],
  )

  const toggle = () => {
    const next = !hidden
    setHidden(next)
    writeStorage(DIAGRAM_KEY, next ? "hidden" : "shown")
  }

  return (
    <section className="space-y-3" aria-label="Workflow diagram">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Lens" className="inline-flex rounded-md border bg-muted/40 p-0.5">
            {LENSES.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lens === l}
                onClick={() => {
                  set({ lens: l === "structure" ? "" : l })
                  if (hidden) toggle()
                }}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  lens === l ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {LENS_LABELS[l]}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{hidden ? "Diagram hidden" : HINT[lens]}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={!hidden}>
          {hidden ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          {hidden ? "Show diagram" : "Hide diagram"}
        </Button>
      </div>

      {!hidden && (
        <div>
          {lens === "structure" && <StructureLens workflow={workflow} />}
          {lens === "deps" && (
            <DepsLens workflow={workflow} runsOn={channels} sections={sections} deps={deps.data} depsError={deps.error} />
          )}
          {lens === "cost" && <CostLens workflow={workflow} sections={sections} />}
          {lens === "run" && (
            <RunLens
              workflow={workflow}
              runsOn={channels}
              sections={sections}
              traceId={values.trace}
              onClearTrace={() => set({ trace: "" })}
            />
          )}
        </div>
      )}
    </section>
  )
}
