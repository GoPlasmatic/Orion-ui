import type { Workflow } from "@/api/types"
import type { Workflow as DataflowWorkflow } from "@goplasmatic/dataflow-ui"

export function toVisualizerWorkflow(w: Workflow): DataflowWorkflow {
  return {
    id: w.workflow_id,
    name: w.name,
    description: w.description ?? undefined,
    priority: w.priority,
    condition: w.condition,
    tasks: w.tasks,
    continue_on_error: w.continue_on_error,
  }
}

export function toVisualizerWorkflows(ws: Workflow[]): DataflowWorkflow[] {
  return ws.map(toVisualizerWorkflow)
}
