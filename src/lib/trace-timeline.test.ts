import { describe, expect, it } from "vitest"
import type { TraceDetail, Workflow } from "@/api/types"
import {
  buildTimeline,
  failingTaskId,
  formatMicros,
  notReached,
  parseInstantUs,
} from "@/lib/trace-timeline"

// Trace 64b46dde on QA (soma-clock-pair, 2 Oct 2026): a Redis outage at boot.
// Offsets and durations are the real ones; snapshots are elided.
const T0 = "2026-10-02T05:41:15.836289"
const at = (offsetUs: number) => {
  const base = parseInstantUs(T0)! + offsetUs
  const sec = Math.floor(base / 1e6)
  const frac = String(base % 1e6).padStart(6, "0")
  return `${new Date(sec * 1000).toISOString().slice(0, 19)}.${frac}000Z`
}
const step = (task_id: string, start: number, dur: number, extra: Record<string, unknown> = {}) => ({
  workflow_id: "soma-clock-pair-run",
  task_id,
  result: "executed",
  started_at: at(start),
  duration_us: dur,
  message: {},
  ...extra,
})

const TRACE: Pick<TraceDetail, "status" | "error" | "started_at" | "completed_at" | "task_trace_json"> = {
  status: "failed",
  error: "FUNCTION_ERROR: Task bump_work.bump error: Function execution error: Redis INCRBY failed for key 'gen:work'",
  started_at: T0,
  completed_at: "2026-10-02T05:41:24.198158",
  task_trace_json: {
    truncated: true,
    steps: [
      step("pick", 1596, 1502, { changes: [{ path: "temp_data.pick" }] }),
      step("picked", 3146, 9),
      step("demand", 3197, 74350),
      step("boards", 78425, 10),
      step("trials", 78759, 5716),
      step("pair", 85063, 4969),
      step("plan", 90513, 414),
      step("pairing", 91426, 396, { loop_counter: 0 }),
      step("insert", 92171, 5485, { loop_counter: 0 }),
      step("held", 98116, 8, { loop_counter: 0 }),
      step("bump_work.bump", 98449, 8115055, { loop_counter: 0, message: undefined }),
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

  it("measures admission, engine gaps and settle", () => {
    expect(tl.admissionUs).toBe(1596)
    expect(tl.engineEndUs).toBe(98449 + 8115055)
    expect(tl.settleUs).toBe(8361869 - (98449 + 8115055))
    expect(tl.gaps).toBe(10)
    expect(Math.round(tl.gapUs / 100) * 100).toBe(4000)
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

describe("a sync trace stamped at persist time", () => {
  it("measures from the first step when the row's start comes after it", () => {
    // Sync rows on 1.12: started_at == completed_at, both after the steps ran.
    const persisted = "2026-10-02T05:41:24.300000"
    const t = buildTimeline({ ...TRACE, status: "completed", error: undefined, started_at: persisted, completed_at: persisted })!
    expect(t.steps[0].startUs).toBe(0)
    expect(t.steps.every((s) => (s.startUs ?? 0) >= 0)).toBe(true)
    expect(t.totalUs).toBeGreaterThanOrEqual(t.engineEndUs)
    expect(t.admissionUs).toBe(0)
  })
})
