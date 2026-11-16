import { useMemo } from "react"
import { WorkflowVisualizer } from "@goplasmatic/dataflow-ui"
import type { Workflow } from "@/api/types"
import { toVisualizerWorkflow } from "@/lib/workflow-mapper"

/**
 * The dataflow-ui visualizer, opened on the whole pipeline — `loop.setup`,
 * the body and any `for_each` included — with the workflow itself selected,
 * so the flow diagram is drawn on mount rather than an empty pane.
 */
export function StructureLens({ workflow }: { workflow: Workflow }) {
  const workflows = useMemo(() => [toVisualizerWorkflow(workflow)], [workflow])

  return (
    <div className="h-[calc(100dvh-19rem)] min-h-[520px] overflow-hidden rounded-lg border">
      <WorkflowVisualizer workflows={workflows} initialSelection="first-workflow" />
    </div>
  )
}
