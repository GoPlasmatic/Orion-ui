import { describe, expect, it } from "vitest"
import type { TraceDetail, Workflow } from "@/api/types"
import {
  buildTimeline,
  failingTaskId,
  formatMicros,
  notReached,
  parseInstantUs,
} from "@/lib/trace-timeline"

// Trace 64b46dde on QA (soma-clock-pair, 2 Oct 2026): a Redis outage at boot,
// as Orion 2 stores it (a dataflow-rs 4 replay trace). Durations are real.
const T0 = "2026-10-02T05:41:15.836289"
const step = (task_id: string, dur: number, extra: Record<string, unknown> = {}) => ({
  workflow_id: "soma-clock-pair-run",
  task_id,
  result: "executed",
  elapsed_us: dur,
  changes: [],
  ...extra,
})

const TRACE: Pick<TraceDetail, "status" | "error" | "started_at" | "completed_at" | "task_trace_json"> = {
  status: "failed",
  error: "FUNCTION_ERROR: Task bump_work.bump error: Function execution error: Redis INCRBY failed for key 'gen:work'",
  started_at: T0,
  completed_at: "2026-10-02T05:41:24.198158",
  task_trace_json: {
    initial: { data: { qty: 3 }, metadata: {}, temp_data: { s: {} } },
    truncated: true,
    steps: [
      step("pick", 1502, { changes: [{ path: "temp_data.pick", new_value: "s-1" }] }),
      step("picked", 9),
      step("demand", 74350),
      step("boards", 10),
      step("trials", 5716),
      step("pair", 4969),
      step("plan", 414),
      step("pairing", 396, { loop_counter: 0 }),
      step("insert", 5485, { loop_counter: 0, changes: [{ path: "temp_data.s.inserted", new_value: 1 }] }),
      step("held", 8, { loop_counter: 0, changes: [{ path: "temp_data.held", new_value: true }] }),
      step("bump_work.bump", 8115055, { loop_counter: 0, result: "failed" }),
    ],
  },
}

const task = (id: string, fn: string) => ({ id, name: id, function: { name: fn, input: {} } })
const WORKFLOW: Pick<Workflow, "tasks" | "loop"> = {
  loop: {
    over: { var: "temp_data.plan" },
    as: "it",
    setup: ["pick", "picked", "demand", "boards", "trials", "pair", "plan"].map((id) => task(id, "map")),
  },
  tasks: [task("pairing", "map"), task("insert", "db_write"), task("held", "filter"), task("bump_work.bump", "cache_incr"), task("after", "log")],
}

describe("parseInstantUs", () => {
  it("keeps microseconds from both spellings", () => {
    expect(parseInstantUs("2026-10-02T05:41:15.836289")! % 1e6).toBe(836289)
    expect(parseInstantUs("2026-10-02T05:41:15.837885170Z")! % 1e6).toBe(837885)
    expect(parseInstantUs("nope")).toBeNull()
  })
})

describe("failingTaskId", () => {
  it("reads the task an error names", () => {
    expect(failingTaskId(TRACE.error)).toBe("bump_work.bump")
    expect(failingTaskId("TIMEOUT_ERROR: deadline")).toBeNull()
  })
})

describe("buildTimeline", () => {
  const tl = buildTimeline(TRACE, WORKFLOW)!

  it("attributes the failure to the step the error names, not just the last one", () => {
    expect(tl.failed?.taskId).toBe("bump_work.bump")
    expect(tl.steps.filter((s) => s.outcome === "failed")).toHaveLength(1)
    expect(tl.steps.find((s) => s.taskId === "insert")?.outcome).toBe("ok")
  })

  it("lays the steps end to end and measures settle", () => {
    const ran = 1502 + 9 + 74350 + 10 + 5716 + 4969 + 414 + 396 + 5485 + 8 + 8115055
    expect(tl.admissionUs).toBe(0)
    expect(tl.engineStartUs).toBe(0)
    expect(tl.engineEndUs).toBe(ran)
    expect(tl.settleUs).toBe(8361869 - ran)
    // A v4 step carries no start instant, so the hand-offs are not measurable.
    expect(tl.gaps).toBe(0)
    expect(tl.gapUs).toBe(0)
  })

  it("groups setup and each iteration", () => {
    expect(tl.groups.map((g) => g.label)).toEqual(["loop.setup", "iteration 0"])
    expect(tl.groups[0].steps).toHaveLength(7)
    expect(tl.groups[1].endUs).toBe(tl.engineEndUs)
  })

  it("finds the dominant step and notes the dropped snapshot", () => {
    expect(tl.dominant?.taskId).toBe("bump_work.bump")
    expect(tl.truncated).toBe(true)
    expect(tl.failed?.hasSnapshot).toBe(false)
  })

  it("infers setup without the workflow from where loop_counter starts", () => {
    const bare = buildTimeline(TRACE)!
    expect(bare.groups.map((g) => g.label)).toEqual(["loop.setup", "iteration 0"])
  })

  it("lists the tasks the run never reached", () => {
    expect(notReached(tl, WORKFLOW).map((t) => t.id)).toEqual(["after"])
  })

  it("blames the last executed step when the error names none", () => {
    const t = buildTimeline({ ...TRACE, error: "TIMEOUT_ERROR: timed out after 5000ms" })!
    expect(t.failed?.taskId).toBe("bump_work.bump")
  })

  it("is null without step data", () => {
    expect(buildTimeline({ ...TRACE, task_trace_json: undefined })).toBeNull()
  })
})

describe("formatMicros", () => {
  it("reads in the unit that fits", () => {
    expect(formatMicros(9)).toBe("9 µs")
    expect(formatMicros(1502)).toBe("1.50 ms")
    expect(formatMicros(74350)).toBe("74.3 ms")
    expect(formatMicros(8115055)).toBe("8.12 s")
  })
})

describe("trace helpers", () => {
  it("prefers the workflow the trace's steps name over the channel's current one", async () => {
    const { traceWorkflowId, stepDataGap, hasSteps } = await import("@/lib/trace-timeline")
    expect(traceWorkflowId(TRACE, { workflow_id: "repointed" })).toBe("soma-clock-pair-run")
    expect(traceWorkflowId({ task_trace_json: undefined }, { workflow_id: "w" })).toBe("w")
    expect(hasSteps(TRACE)).toBe(true)
    expect(stepDataGap({ status: "completed" }, { config: { tracing: { task_details: true, errors_only: true } } })).toBe("errors_only")
    expect(stepDataGap({ status: "completed" }, { config: {} })).toBe("details_off")
    expect(stepDataGap({ status: "running" }, null)).toBe("unsettled")
  })

  it("reads the loop binding through the ?? fallback", async () => {
    const { loopBinding } = await import("@/lib/workflow-steps")
    expect(loopBinding({ loop: { as: "it", over: { "??": [{ var: "temp_data.plan" }, []] } } })).toEqual({ as: "it", over: "temp_data.plan" })
    expect(loopBinding({ loop: { max: 3 } })).toBeNull()
  })
})
