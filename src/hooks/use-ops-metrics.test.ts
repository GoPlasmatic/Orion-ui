import { describe, expect, it } from "vitest"
import { deltaSnapshot, family, parsePrometheus } from "@/api/metrics"
import { workflowCost } from "@/hooks/use-ops-metrics"

const WF = "soma-clock-pair-run"
// `insert` ran as db_write in v1 and as data_write in v2: two series, one task.
const EXPO = `
orion_workflow_duration_seconds_count{workflow="${WF}"} 10
orion_workflow_duration_seconds_sum{workflow="${WF}"} 1.0
orion_task_duration_seconds_count{workflow="${WF}",task="insert",function="db_write"} 4
orion_task_duration_seconds_sum{workflow="${WF}",task="insert",function="db_write"} 0.4
orion_task_duration_seconds_bucket{workflow="${WF}",task="insert",function="db_write",le="0.1"} 4
orion_task_duration_seconds_bucket{workflow="${WF}",task="insert",function="db_write",le="+Inf"} 4
orion_task_duration_seconds_count{workflow="${WF}",task="insert",function="data_write"} 6
orion_task_duration_seconds_sum{workflow="${WF}",task="insert",function="data_write"} 0.06
orion_task_duration_seconds_bucket{workflow="${WF}",task="insert",function="data_write",le="0.1"} 6
orion_task_duration_seconds_bucket{workflow="${WF}",task="insert",function="data_write",le="+Inf"} 6
orion_task_duration_seconds_count{workflow="other",task="insert",function="db_write"} 99
`

describe("workflowCost", () => {
  it("counts a task once across the function labels it ran under", () => {
    const cost = workflowCost(parsePrometheus(EXPO, 1), WF, "live")
    const insert = cost.tasks.get("insert")!
    expect(insert.runs).toBe(10)
    expect(insert.meanMs).toBeCloseTo(46, 5) // (0.4 + 0.06) / 10 s
    expect(insert.function).toBe("data_write")
    expect(cost.meanMs).toBeCloseTo(100, 5)
    expect(cost.overheadMs).toBeCloseTo(54, 5)
  })

  it("returns the same object while nothing moved", () => {
    const a = workflowCost(parsePrometheus(EXPO, 2), WF, "live")
    const b = workflowCost(parsePrometheus(EXPO, 3), WF, "live")
    expect(b).toBe(a)
  })
})

describe("family index and delta", () => {
  it("groups lines by family", () => {
    const snap = parsePrometheus(EXPO, 1)
    expect(family(snap, "orion_task_duration_seconds_count")).toHaveLength(3)
    expect(family(snap, "nope")).toHaveLength(0)
  })

  it("subtracts by series and memoises the pair", () => {
    const base = parsePrometheus(EXPO, 1)
    const cur = parsePrometheus(EXPO.replace(`{workflow="${WF}"} 10`, `{workflow="${WF}"} 13`), 2)
    const d = deltaSnapshot(base, cur)
    expect(family(d, "orion_workflow_duration_seconds_count")[0].value).toBe(3)
    expect(deltaSnapshot(base, cur)).toBe(d)
  })
})
