import { describe, expect, it } from "vitest"
import type { Workflow } from "@/api/types"
import { buildTimeline } from "@/lib/trace-timeline"
import { functionIndex } from "@/lib/function-effects"
import {
  costInsights,
  costView,
  depsInsights,
  effectTone,
  formatOps,
  insightText,
  lensSections,
  mergeServerResources,
  parseLens,
  resourceColumns,
  runInsights,
  runOverlay,
  sectionLabel,
  taskRows,
  type LensTaskRow,
} from "@/lib/workflow-lens"
import { clockPair, clockPairCatalogue, clockPairCost, clockPairDeps, failedRun } from "@/lib/workflow-lens.fixture"

const index = functionIndex(clockPairCatalogue)
const sections = lensSections(clockPair, index)
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

describe("step effects on the rows", () => {
  it("reads what each step touches from the catalogue", () => {
    expect(row("demand").effect).toMatchObject({ op: "read", resource: { kind: "connector", name: "soma-db" }, retry: "read" })
    expect(row("insert").effect).toMatchObject({ op: "write", retry: "unsafe_write" })
    expect(row("pair").effect.resource).toMatchObject({ kind: "plugin", name: "tb.pairing", version: 2 })
    expect(row("bump_work.bump").effect).toMatchObject({ op: "incr", resource: { kind: "connector", name: "soma-cache" } })
    expect(row("plan").effect.resource).toBeNull()
    expect(row("picked").effect.gate).toBe(true)
  })

  it("colours a chip by what a retry repeats", () => {
    expect(effectTone(row("demand").effect)).toBe("read")
    expect(effectTone(row("insert").effect)).toBe("write")
    expect(effectTone(row("bump_work.bump").effect)).toBe("write")
    expect(effectTone(row("pair").effect)).toBe("neutral")
    expect(effectTone(row("held").effect)).toBe("gate")
  })

  it("does not recognise a plugin before the catalogue loads", () => {
    const bare = taskRows(lensSections(clockPair))
    expect(bare.find((r) => r.id === "pair")?.effect.resource).toBeNull()
    // …but still reads a connector read as a read.
    expect(effectTone(bare.find((r) => r.id === "demand")!.effect)).toBe("read")
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
    expect(row("picked").effect.gate).toBe(true)
    expect(row("held").effect.gate).toBe(true)
    expect(row("bump_work.bump").conditional).toBe(true)
    expect(row("pick").writes).toEqual(["temp_data.pick"])
    expect(row("plan").writes).toEqual(["temp_data.plan"])
  })

  it("labels the loop sections by what the body iterates", () => {
    expect(sectionLabel("setup", clockPair)).toEqual({ title: "loop.setup", detail: "once per run" })
    expect(sectionLabel("body", clockPair)).toEqual({ title: "loop body", detail: "per element of temp_data.plan, as it" })
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
    const merged = mergeServerResources(
      columns,
      { ...clockPairDeps, connectors: [...clockPairDeps.connectors, { connector: "soma-search", function: "http_call" }] },
      index,
    )
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
      "demand is 68% of a typical run (88ms of 129ms). Its p95 is 230ms, against 306ms for the whole run.",
    )
    expect(text[1]).toBe(
      "insert, the costliest of 2 writes, costs 15ms per run on average: 19ms per iteration × 0.79 iterations per run.",
    )
    expect(text[2]).toContain("Engine overhead is 4.5ms (3.5%)")
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
      sections: lensSections({ tasks: [clockPair.loop!.setup![5]] }, index),
      columns: resourceColumns(lensSections({ tasks: [clockPair.loop!.setup![5]] }, index)),
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
      "The run then spent 8.12 s in bump_work.bump, about 11,600× its p95, before it failed: Redis INCRBY failed for key 'gen:work'",
    )
  })

})
