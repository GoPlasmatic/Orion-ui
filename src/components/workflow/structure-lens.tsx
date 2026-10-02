import { useEffect, useMemo, useRef } from "react"
import { WorkflowVisualizer } from "@goplasmatic/dataflow-ui"
import type { Workflow } from "@/api/types"
import { Callout } from "@/components/ui/callout"
import { toVisualizerWorkflow } from "@/lib/workflow-mapper"
import { countLeafSteps } from "@/lib/workflow-steps"

/**
 * The dataflow-ui visualizer, opened on the whole pipeline.
 *
 * `WorkflowVisualizer` (dataflow-ui 3.13) keeps its selection internal and
 * starts on `{type: "none"}` — an empty pane reading "Select an item from the
 * explorer" — with no prop for an initial selection. Its explorer row for the
 * workflow selects `{type: "workflow"}`, which draws the flow diagram, so on
 * mount that row is clicked. If a later release renames the classes this
 * finds nothing and the visualizer opens as it always did.
 */
export function StructureLens({ workflow }: { workflow: Workflow }) {
  const ref = useRef<HTMLDivElement>(null)
  const workflows = useMemo(() => [toVisualizerWorkflow(workflow)], [workflow])

  useEffect(() => {
    const rows = ref.current?.querySelectorAll<HTMLElement>(".df-tree-view .df-tree-node-content") ?? []
    // Document order: the root folder, then the workflow, then its tasks — so
    // the first row labelled with the workflow's name is the workflow itself.
    const row = Array.from(rows).find((r) => r.querySelector(".df-tree-label")?.textContent === workflow.name)
    row?.click()
  }, [workflows, workflow.name])

  const setup = workflow.loop && Array.isArray(workflow.loop.setup) ? countLeafSteps(workflow.loop.setup) : 0

  return (
    <div className="space-y-2">
      {setup > 0 && (
        <Callout variant="muted" className="py-2 text-xs">
          This diagram draws the loop body. The {setup} <code className="font-mono">loop.setup</code>{" "}
          {setup === 1 ? "step that runs" : "steps that run"} once before it {setup === 1 ? "is" : "are"} listed in the
          Dependencies, Cost and Last run lenses.
        </Callout>
      )}
      <div ref={ref} className="h-[calc(100dvh-19rem)] min-h-[520px] overflow-hidden rounded-lg border">
        <WorkflowVisualizer workflows={workflows} />
      </div>
    </div>
  )
}
