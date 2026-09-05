import type { FunctionSchema, Step } from "@/api/types"
import { flattenSteps } from "@/lib/workflow-steps"

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
 * which it is. `pure`, `read` and `idempotent_write` are not risks.
 */
export function retryRisks(
  steps: Step[] | null | undefined,
  catalogue: FunctionSchema[] | undefined,
): RetryRisk[] {
  if (!catalogue) return []
  const byName = new Map<string, FunctionSchema>()
  for (const fn of catalogue) {
    byName.set(fn.name, fn)
    for (const alias of fn.aliases ?? []) byName.set(alias, fn)
  }
  const out: RetryRisk[] = []
  for (const task of flattenSteps(steps)) {
    const name = task.function?.name
    if (!name) continue
    const safety = byName.get(name)?.retry_safety
    if (!safety) continue
    const label = task.name || task.id
    if (safety.kind === "unsafe_write") {
      out.push({ task: label, function: name, kind: "unsafe_write" })
    } else if (safety.kind === "depends_on") {
      out.push({ task: label, function: name, kind: "depends_on", input: safety.input })
    }
  }
  return out
}
