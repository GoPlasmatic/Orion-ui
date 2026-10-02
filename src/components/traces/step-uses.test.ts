import { describe, expect, it } from "vitest"
import type { Task } from "@/api/types"
import { buildTimeline } from "@/lib/trace-timeline"
import { retrySafetyLabel, stepUses, vsP95, writesBefore } from "./step-uses"
import { CATALOGUE, TRACE, WORKFLOW } from "./__fixtures__/trace-64b46dde"

const t = (fn: string, input: Record<string, unknown> = {}): Task => ({ id: "x", name: "x", function: { name: fn, input } })

describe("stepUses", () => {
  it("names the operation and the connector", () => {
    expect(stepUses(t("cache_incr", { connector: "soma-cache" })).label).toBe("incr soma-cache")
    expect(stepUses(t("db_read", { connector: "soma-db" }))).toMatchObject({ kind: "connector", op: "read", resource: "soma-db" })
    expect(stepUses(t("http_call", { connector: "billing", method: "POST" })).label).toBe("post billing")
    expect(stepUses(t("db_write", {})).label).toBe("write (computed connector)")
  })

  it("names a channel, a model and a plugin", () => {
    expect(stepUses(t("channel_call", { channel: "internal-session-check" })).label).toBe("call internal-session-check")
    expect(stepUses(t("channel_call", { channel: { var: "x" } })).resource).toBeNull()
    expect(stepUses(t("model_infer", { model: "fraud" }))).toMatchObject({ kind: "model", resourceId: "fraud" })
    expect(stepUses(t("tb.pairing.pair"), CATALOGUE)).toMatchObject({
      kind: "plugin",
      label: "call tb.pairing v2",
      resourceId: "tb.pairing",
    })
  })

  it("reads a filter as a gate and everything else as in memory", () => {
    expect(stepUses(t("filter")).label).toBe("halts the run")
    expect(stepUses(t("map")).label).toBe("in memory")
    expect(stepUses(null).kind).toBe("unknown")
  })
})

describe("vsP95", () => {
  it("renders the multiple, severe from 10×", () => {
    expect(vsP95(8_115_055, 0.7)).toMatchObject({ text: "11,593×", severe: true })
    expect(vsP95(74_350, 229.6).text).toBe("0.3×")
    expect(vsP95(9, 0.5).text).toBe("<0.1×")
    expect(vsP95(9, null).text).toBe("—")
    expect(vsP95(9, 0).text).toBe("—")
  })
})

describe("writesBefore", () => {
  const tl = buildTimeline(TRACE, WORKFLOW)!

  it("lists the writes that completed before the failure", () => {
    const prior = writesBefore(tl, tl.failed!, CATALOGUE)
    expect(prior.map((w) => w.step.taskId)).toEqual(["insert"])
    expect(prior[0].uses.resource).toBe("soma-db")
    expect(prior[0].gapUs).toBe(98449 - (92171 + 5485))
    expect(retrySafetyLabel(prior[0].safety)).toBe("unsafe write")
  })

  it("says nothing without a catalogue", () => {
    expect(writesBefore(tl, tl.failed!, undefined)).toEqual([])
  })

  it("names the input that decides for depends_on", () => {
    const upsert = {
      ...WORKFLOW,
      tasks: WORKFLOW.tasks.map((s) =>
        (s as Task).id === "insert" ? { ...(s as Task), function: { name: "data_write", input: { connector: "soma-db", op: "upsert" } } } : s,
      ),
    }
    const catalogue = [...CATALOGUE, { ...CATALOGUE[1], name: "data_write", retry_safety: { kind: "depends_on", input: "op" } }]
    const tl2 = buildTimeline(TRACE, upsert)!
    const [w] = writesBefore(tl2, tl2.failed!, catalogue)
    expect(retrySafetyLabel(w.safety)).toBe("depends on op")
    expect(w.decidingValue).toBe("upsert")
  })
})
