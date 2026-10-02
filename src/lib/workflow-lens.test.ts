import { describe, expect, it } from "vitest"
import type { Workflow } from "@/api/types"
import { buildTimeline } from "@/lib/trace-timeline"
import {
  classifyOp,
  costInsights,
  costView,
  depsInsights,
  formatOps,
  formatRatio,
  insightText,
  lensSections,
  mergeServerResources,
  parseLens,
  resourceColumns,
  runInsights,
  runOverlay,
  sectionLabel,
  stepResource,
  taskRows,
  type LensTaskRow,
} from "@/lib/workflow-lens"
import { clockPair, clockPairCost, clockPairDeps, failedRun } from "@/lib/workflow-lens.fixture"

const pluginOf = new Map([["tb.pairing.pair", "tb.pairing"]])
const sections = lensSections(clockPair, pluginOf)
const rows = taskRows(sections)
const row = (id: string) => rows.find((r) => r.id === id) as LensTaskRow

describe("parseLens", () => {
  it("reads the four lenses and defaults anything else to structure", () => {
    expect(parseLens("deps")).toBe("deps")
    expect(parseLens("run")).toBe("run")
    expect(parseLens("")).toBe("structure")
    expect(parseLens("relationships")).toBe("structure")
    expect(parseLens(null)).toBe("structure")
  })
})

describe("classifyOp", () => {
  it("names what a function does to the resource it touches", () => {
    expect(classifyOp("db_read")).toBe("read")
    expect(classifyOp("mongo_aggregate")).toBe("read")
    expect(classifyOp("db_write")).toBe("write")
    expect(classifyOp("cache_delete")).toBe("write")
    expect(classifyOp("cache_incr")).toBe("incr")
    expect(classifyOp("http_call")).toBe("call")
    expect(classifyOp("channel_call")).toBe("call")
    expect(classifyOp("publish_kafka")).toBe("publish")
    expect(classifyOp("send_email")).toBe("send")
    expect(classifyOp("storage_presign")).toBe("presign")
    expect(classifyOp("model_infer")).toBe("infer")
  })

  it("reads a plugin function as a call, named or by its namespace", () => {
    expect(classifyOp("score", new Set(["score"]))).toBe("call")
    expect(classifyOp("tb.pairing.pair")).toBe("call")
  })

  it("leaves in-memory functions alone", () => {
    expect(classifyOp("map")).toBeNull()
    expect(classifyOp("filter")).toBeNull()
    expect(classifyOp("parse_json")).toBeNull()
    expect(classifyOp(undefined)).toBeNull()
  })
})

describe("stepResource", () => {
  it("finds connectors, plugins, models and call targets", () => {
    expect(row("demand").resource).toEqual({ kind: "connector", name: "soma-db" })
    expect(row("pair").resource).toEqual({ kind: "plugin", name: "tb.pairing" })
    expect(row("bump_work.bump").resource).toEqual({ kind: "connector", name: "soma-cache" })
    expect(row("plan").resource).toBeNull()
    expect(
      stepResource({ id: "m", name: "m", function: { name: "model_infer", input: { model: "fraud.v3" } } }),
    ).toEqual({ kind: "model", name: "fraud.v3" })
    expect(
      stepResource({ id: "c", name: "c", function: { name: "channel_call", input: { channel: "internal-auth" } } }),
    ).toEqual({ kind: "channel", name: "internal-auth" })
    expect(
      stepResource({ id: "c", name: "c", function: { name: "channel_call", input: { channel: { var: "x" } } } }),
    ).toMatchObject({ kind: "channel", dynamic: true })
  })
})

describe("lensSections", () => {
  it("puts loop.setup first, then the body, in run order", () => {
    expect(sections.map((s) => s.phase)).toEqual(["setup", "body"])
    expect(sections[0].rows.map((r) => r.id)).toEqual(["pick", "picked", "demand", "boards", "trials", "pair", "plan"])
    expect(sections[1].rows.map((r) => r.id)).toEqual(["pairing", "insert", "held", "bump_work.bump"])
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it("marks gates, conditions and declared writes", () => {
    expect(row("picked").gate).toBe(true)
    expect(row("held").gate).toBe(true)
    expect(row("bump_work.bump").conditional).toBe(true)
    expect(row("pick").writes).toEqual(["temp_data.pick"])
    expect(row("plan").writes).toEqual(["temp_data.plan"])
  })

  it("labels the loop sections by what the body iterates", () => {
    expect(sectionLabel("setup", clockPair.loop)).toEqual({ title: "loop.setup", detail: "once per run" })
    expect(sectionLabel("body", clockPair.loop)).toEqual({ title: "loop body", detail: "per element of temp_data.plan" })
  })

  it("keeps task-group nesting and terminal / halt markers in a plain workflow", () => {
    const wf: Pick<Workflow, "tasks" | "loop"> = {
      tasks: [
        {
          id: "guard",
          name: "Answer early",
          condition: { "==": [1, 1] },
          terminal: true,
          tasks: [{ id: "reply", name: "Reply", function: { name: "map", input: {} }, halt_on: "failure" }],
        },
        { id: "write", name: "Write", function: { name: "db_write", input: { connector: "db" } }, terminal: true },
      ],
    }
    const [main] = lensSections(wf)
    expect(main.phase).toBe("main")
    expect(main.rows.map((r) => [r.kind, r.id, r.depth])).toEqual([
      ["group", "guard", 0],
      ["task", "reply", 1],
      ["task", "write", 0],
    ])
    expect(main.rows[0]).toMatchObject({ conditional: true, terminal: true })
    expect((main.rows[1] as LensTaskRow).haltOnFailure).toBe(true)
    expect((main.rows[2] as LensTaskRow).terminal).toBe(true)
  })
})

describe("resourceColumns", () => {
  const columns = resourceColumns(sections)

  it("has one column per resource with its op counts", () => {
    expect(columns.map((c) => c.key)).toEqual(["connector:soma-db", "plugin:tb.pairing", "connector:soma-cache"])
    expect(formatOps(columns[0].ops)).toBe("3 read · 1 write")
    expect(formatOps(columns[1].ops)).toBe("1 call")
    expect(formatOps(columns[2].ops)).toBe("1 incr")
    expect(columns[0].steps).toEqual(["pick", "demand", "trials", "insert"])
  })

  it("adds what only the server's walk found", () => {
    const merged = mergeServerResources(columns, {
      ...clockPairDeps,
      connectors: [...clockPairDeps.connectors, { connector: "soma-search", function: "http_call" }],
    })
    expect(merged.map((c) => c.key)).toContain("connector:soma-search")
    expect(merged.find((c) => c.key === "connector:soma-search")?.steps).toEqual([])
    expect(merged).toHaveLength(4)
  })
})

describe("cost", () => {
  const view = costView(sections, clockPairCost)

  it("weights each step by how often it runs per workflow run", () => {
    const demand = view.cells.get("demand")!
    expect(demand.sharePct).toBeCloseTo(68.3, 1)
    const insert = view.cells.get("insert")!
    expect(insert.perRunMs).toBeCloseTo(18.69 * (185 / 235), 5)
    expect(view.dominant).toBe("demand")
    expect(view.iterations).toBe(185)
    expect(view.overheadPct).toBeCloseTo(3.5, 1)
  })

  it("reads out the dominant step, the write and the engine's overhead", () => {
    const text = costInsights(sections, view).map(insightText)
    expect(text[0]).toBe(
      "demand is 68% of a typical run (88.4 ms of 129 ms). Its p95 is 230 ms, against 306 ms for the whole run.",
    )
    expect(text[1]).toBe(
      "insert, the only write, costs 14.7 ms per run on average: 18.7 ms per iteration × 0.79 iterations per run.",
    )
    expect(text[2]).toContain("Engine overhead is 4.55 ms (3.5%)")
    expect(text[2]).toContain("The 3 filters cost nothing measurable.")
    expect(costInsights(sections, view)[0].tone).toBe("warn")
  })

  it("says nothing before the workflow has run", () => {
    const empty = costView(sections, { runs: 0, meanMs: null, p95Ms: null, tasks: new Map(), overheadMs: null })
    expect(empty.dominant).toBeNull()
    expect(costInsights(sections, empty)).toEqual([])
  })
})

describe("dependency read-outs", () => {
  it("names the retry caveat, the single-user plugin and the most shared connector", () => {
    const text = depsInsights({
      sections,
      columns: resourceColumns(sections),
      workflowId: "soma-clock-pair-run",
      workflowName: "Clock: pair",
      pluginUsers: new Map([["tb.pairing", ["soma-clock-pair-run"]]]),
      pluginVersions: new Map([["tb.pairing", 2]]),
      connectorUsers: new Map([
        ["soma-db", 145],
        ["soma-cache", 32],
      ]),
      cost: costView(sections, clockPairCost),
    }).map(insightText)
    expect(text[0]).toBe(
      "soma-cache is used once, by the last step, bump_work.bump, after insert has written to soma-db. When soma-cache fails, that write has already happened, and a retry has to tolerate making it again.",
    )
    expect(text[1]).toBe(
      "tb.pairing v2 serves only this workflow. Archiving it affects nothing else, and a failed plugin load quarantines only Clock: pair.",
    )
    expect(text[2]).toBe(
      "soma-db is shared by 145 channels; this workflow makes 3 reads and 1 write to it. A slow soma-db shows up first in demand, its heaviest step here.",
    )
  })

  it("says who else a shared plugin reaches", () => {
    const [plugin] = depsInsights({
      sections: lensSections({ tasks: [clockPair.loop!.setup![5]] }, pluginOf),
      columns: resourceColumns(lensSections({ tasks: [clockPair.loop!.setup![5]] }, pluginOf)),
      workflowId: "soma-clock-pair-run",
      workflowName: "Clock: pair",
      pluginUsers: new Map([["tb.pairing", ["soma-clock-pair-run", "other-a", "other-b"]]]),
    }).map(insightText)
    expect(plugin).toContain("is also called by 2 other active workflows")
  })
})

describe("last run", () => {
  const timeline = buildTimeline(failedRun, clockPair)!
  const overlay = runOverlay(sections, timeline)

  it("lays the trace over the rows", () => {
    expect(overlay.get("demand")).toMatchObject({ status: "ok", durationUs: 74350, changes: ["temp_data.demand"] })
    expect(overlay.get("bump_work.bump")).toMatchObject({ status: "failed", durationUs: 8115055 })
    expect(overlay.get("held")?.changes).toEqual([])
  })

  it("marks the tasks a failure left unreached", () => {
    const short = { ...failedRun, task_trace_json: { steps: (failedRun.task_trace_json as { steps: unknown[] }).steps.slice(0, 9) }, error: "FUNCTION_ERROR: Task insert error: boom" }
    const tl = buildTimeline(short, clockPair)!
    const ov = runOverlay(sections, tl)
    expect(ov.get("insert")?.status).toBe("failed")
    expect(ov.get("held")?.status).toBe("not-reached")
    expect(ov.get("bump_work.bump")?.status).toBe("not-reached")
    const text = runInsights(sections, ov, tl, null, short.error).map(insightText)
    expect(text[1]).toContain("2 steps after it were not reached.")
  })

  it("reads out the healthy steps against p95 and the failing one", () => {
    const text = runInsights(sections, overlay, timeline, costView(sections, clockPairCost), failedRun.error).map(insightText)
    expect(text[0]).toBe("10 steps ran in 92.9 ms, each inside its p95.")
    expect(text[1]).toBe(
      "The run then spent 8.12 s in bump_work.bump, about 11,600× its p95, before it failed: Function execution error: Redis INCRBY failed for key 'gen:work'",
    )
  })

  it("rounds ratios to what can be compared", () => {
    expect(formatRatio(0.05)).toBe("<0.1×")
    expect(formatRatio(2.34)).toBe("2.3×")
    expect(formatRatio(11592.9)).toBe("11,600×")
  })
})
