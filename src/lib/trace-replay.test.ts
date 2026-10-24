import { describe, expect, it } from "vitest"
import type { TraceDetail } from "@/api/types"
import { buildTimeline, executionTrace } from "@/lib/trace-timeline"
import { firstTaskPayload } from "@/lib/trace-payload"
import { TRACE_V4 as TRACE } from "@/components/traces/__fixtures__/trace-v4"

const ROW: Pick<TraceDetail, "status" | "error" | "started_at" | "completed_at" | "task_trace_json"> = {
  status: "failed",
  error: "FUNCTION_ERROR: Task lookup error: dry-run: no stub",
  started_at: "2026-10-24T13:26:11.434998",
  completed_at: "2026-10-24T13:26:11.435998",
  task_trace_json: TRACE,
}

describe("a dataflow-rs 4 trace", () => {
  it("replays each step's changes into the snapshot after it", () => {
    const et = executionTrace(ROW)!
    expect(et.steps.map((s) => s.task_id)).toEqual(["shape", "never", "lookup", "shape", "never", "lookup"])
    const first = et.steps[0]
    expect(first.message?.context?.data).toEqual({ qty: 3, order: { total: 30 } })
    // The engine's counter write before it is applied, though not listed.
    expect(first.message?.context?.temp_data).toEqual({ i: 0, seen: 0 })
    expect(et.steps[3].message?.context?.temp_data).toEqual({ i: 1, seen: 1 })
    expect(first.duration_us).toBe(92)
  })

  it("rebuilds the context after each mapping of a map", () => {
    const contexts = executionTrace(ROW)!.steps[0].mapping_contexts as Array<Record<string, unknown>>
    expect(contexts).toHaveLength(2)
    expect(contexts[0].data).toEqual({ qty: 3, order: { total: 30 } })
    expect(contexts[0].temp_data).toEqual({ i: 0 })
    expect(contexts[1].temp_data).toEqual({ i: 0, seen: 0 })
  })

  it("offers no snapshot for a skip", () => {
    const et = executionTrace(ROW)!
    expect(et.steps[1].message).toBeUndefined()
    expect(et.steps[1].result).toBe("skipped")
  })

  it("lays the steps end to end and takes the failure the engine marked", () => {
    const timeline = buildTimeline(ROW)!
    const ran = timeline.steps.filter((s) => s.outcome !== "skipped")
    expect(ran.map((s) => [s.taskId, s.startUs, s.durationUs])).toEqual([
      ["shape", 0, 92],
      ["shape", 92, 6],
      ["lookup", 98, 44],
    ])
    expect(timeline.failed?.taskId).toBe("lookup")
    expect(timeline.failed?.iteration).toBe(1)
    expect(timeline.looped).toBe(true)
  })

  it("hands the run's starting data back as its payload", () => {
    expect(firstTaskPayload(ROW)).toEqual({ qty: 3 })
  })
})
