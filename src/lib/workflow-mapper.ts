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
 *  - Since 1.9.1 a workflow may carry a `loop` whose `setup` holds steps too,
 *    and a task a `for_each` fan-out; dataflow-ui draws both, so both are
 *    mapped through.
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
    // The visualizer wants a label; a task's `name` is optional.
    name: task.name ?? task.id,
    description: task.description,
    condition: task.condition,
    function: {
      name: task.function?.name ?? "",
      input: task.function?.input ?? {},
    },
    // dataflow-ui 4 draws the v4 step policies itself.
    on_failure: task.on_failure,
    on_rejection: task.on_rejection,
    terminal: task.terminal,
    for_each: task.for_each,
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
    // 2.0 spells 1.x's workflow-level `continue_on_error` as `on_failure: continue`.
    continue_on_error: w.on_failure === "continue" ? true : undefined,
    loop: w.loop
      ? {
          ...w.loop,
          setup: Array.isArray(w.loop.setup) ? w.loop.setup.map(toVisualizerStep) : undefined,
          // The visualizer's type requires `max`; an `over` loop is bounded by its array.
          max: w.loop.max as number,
        }
      : undefined,
  }
}

export function toVisualizerWorkflows(ws: Workflow[]): DataflowWorkflow[] {
  return ws.map(toVisualizerWorkflow)
}
