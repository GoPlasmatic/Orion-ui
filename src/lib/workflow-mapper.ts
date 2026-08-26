import type { Step, Task, Workflow } from "@/api/types"
import { isTaskGroup, groupMembers } from "@/lib/workflow-steps"
import type {
  Step as DataflowStep,
  Task as DataflowTask,
  Workflow as DataflowWorkflow,
} from "@goplasmatic/dataflow-ui"

/**
 * Maps the API's `Workflow` (keyed `workflow_id`) onto the visualizer's
 * (keyed `id`).
 *
 * The step tree is walked rather than passed through. Two reasons:
 *
 *  - Since Orion 1.2 an element may be a **task group**, so the array is a tree
 *    and a shallow cast would misdescribe it.
 *  - `FunctionConfig.input` is required in the visualizer's model (dataflow-rs
 *    reads `{name, input}` with no default, so a task omitting it fails to
 *    load) while the API type leaves it optional. A task that somehow arrives
 *    without one renders as taking no configuration instead of failing the
 *    build.
 */
function toVisualizerStep(step: Step): DataflowStep {
  if (isTaskGroup(step)) {
    return {
      id: step.id,
      name: step.name,
      description: step.description,
      condition: step.condition,
      terminal: step.terminal,
      tasks: groupMembers(step).map(toVisualizerStep),
    }
  }
  const task: Task = step
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    condition: task.condition,
    function: {
      name: task.function?.name ?? "",
      input: task.function?.input ?? {},
    },
    continue_on_error: task.continue_on_error,
    terminal: task.terminal,
  } satisfies DataflowTask
}

export function toVisualizerWorkflow(w: Workflow): DataflowWorkflow {
  return {
    id: w.workflow_id,
    name: w.name,
    description: w.description ?? undefined,
    priority: w.priority,
    condition: w.condition,
    tasks: (Array.isArray(w.tasks) ? w.tasks : []).map(toVisualizerStep),
    continue_on_error: w.continue_on_error,
  }
}

export function toVisualizerWorkflows(ws: Workflow[]): DataflowWorkflow[] {
  return ws.map(toVisualizerWorkflow)
}
