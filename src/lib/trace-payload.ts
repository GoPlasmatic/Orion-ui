import type { ExecutionStep } from "@/api/types"

/** Normalise the parsed `task_trace_json` into a list of execution steps. */
export function extractSteps(raw: unknown): ExecutionStep[] {
  if (Array.isArray(raw)) return raw as ExecutionStep[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { steps?: unknown }).steps)) {
    return (raw as { steps: ExecutionStep[] }).steps
  }
  return []
}

/**
 * The request as the first task saw it — the closest thing to the original
 * input a trace keeps, since the read does not carry the raw request. What
 * "re-send in the console" and "use the last trace's input" hand over. Null
 * when the trace has no steps or the first step's payload is not an object.
 * Takes the single-trace read; a list row is payload-free and always answers
 * null.
 */
export function firstTaskPayload(
  trace: { task_trace_json?: unknown } | undefined | null,
): Record<string, unknown> | null {
  if (!trace) return null
  const payload = extractSteps(trace.task_trace_json)[0]?.message?.payload
  if (payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  return payload as Record<string, unknown>
}
