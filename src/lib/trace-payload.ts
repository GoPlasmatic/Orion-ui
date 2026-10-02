import { executionTrace } from "@/lib/trace-timeline"

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
  const payload = executionTrace(trace as { task_trace_json?: unknown })?.steps[0]?.message?.payload
  if (payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  return payload as Record<string, unknown>
}
