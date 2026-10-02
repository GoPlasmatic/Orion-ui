import type { FunctionSchema, Step } from "@/api/types"
import { flattenSteps } from "@/lib/workflow-steps"
import { functionIndex, isRetryRisk, stepEffect } from "@/lib/function-effects"

/** A task whose function a second run may not repeat safely. */
export interface RetryRisk {
  task: string
  function: string
  kind: "unsafe_write" | "depends_on"
  /** For `depends_on`: the input that decides (`method` for http_call, `op` for data_write). */
  input?: string
}

/**
 * The tasks a retry could run twice with a second effect — the second email,
 * the second inserted row. A requeue from the trace DLQ and a retry of a cron
 * occurrence both re-run the workflow from the start, and the catalogue's
 * `retry_safety` (1.6) is what says which functions mind. `unsafe_write` is
 * named outright; `depends_on` is named with the input that decides, because
 * an upsert repeats safely and an insert does not, and only the task knows
 * which it is — so a literal input is read (`lib/function-effects.ts`): an
 * `http_call` GET or a `data_write` upsert is not a risk, a POST or an insert
 * is, and a computed one is named with the input to check. `pure`, `read` and
 * `idempotent_write` are not risks.
 */
export function retryRisks(
  steps: Step[] | null | undefined,
  catalogue: FunctionSchema[] | undefined,
): RetryRisk[] {
  if (!catalogue) return []
  const index = functionIndex(catalogue)
  const out: RetryRisk[] = []
  for (const task of flattenSteps(steps)) {
    const name = task.function?.name
    if (!name) continue
    const effect = stepEffect(task, index)
    if (!isRetryRisk(effect) || !index.has(name)) continue
    const label = task.name || task.id
    if (effect.retry === "unsafe_write") out.push({ task: label, function: name, kind: "unsafe_write" })
    else out.push({ task: label, function: name, kind: "depends_on", input: effect.decidedBy })
  }
  return out
}
