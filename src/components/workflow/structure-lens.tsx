import { useEffect, useMemo, useRef } from "react"
import { WorkflowVisualizer } from "@goplasmatic/dataflow-ui"
import type { Workflow } from "@/api/types"
import { toVisualizerWorkflow } from "@/lib/workflow-mapper"

/**
 * The explorer row for the workflow itself: the root "Workflows" node's first
 * child. Matched by position, not by label, so a task that happens to share
 * the workflow's name cannot be picked instead. The mapper sets no folder
 * `path`, so no folder node comes before it.
 */
const WORKFLOW_ROW = ".df-tree-view > .df-tree-node > .df-tree-children > .df-tree-node > .df-tree-node-content"

/**
 * The dataflow-ui visualizer, opened on the whole pipeline — `loop.setup`,
 * the body and any `for_each` included since dataflow-ui 3.15.
 *
 * Stopgap: `WorkflowVisualizer` keeps its selection internal and starts on
 * `{type: "none"}` — an empty pane reading "Select an item from the explorer"
 * — with no prop for an initial selection
 * (https://github.com/GoPlasmatic/dataflow-rs/issues/70 asks for one). Its
 * explorer row for the workflow selects `{type: "workflow"}`, which draws the
 * flow diagram, so on mount that row is clicked. If a later release changes
 * the tree's markup this finds nothing and the visualizer opens as it always
 * did. Replace with `initialSelection` once upstream ships it.
 */
export function StructureLens({ workflow }: { workflow: Workflow }) {
  const ref = useRef<HTMLDivElement>(null)
  const workflows = useMemo(() => [toVisualizerWorkflow(workflow)], [workflow])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(WORKFLOW_ROW)?.click()
  }, [workflows])

  return (
    <div ref={ref} className="h-[calc(100dvh-19rem)] min-h-[520px] overflow-hidden rounded-lg border">
      <WorkflowVisualizer workflows={workflows} />
    </div>
  )
}
