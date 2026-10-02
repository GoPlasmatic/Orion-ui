import { describe, expect, it } from "vitest"
import type { Task } from "@/api/types"
import { functionIndex, stepEffect } from "@/lib/function-effects"
import { buildTimeline } from "@/lib/trace-timeline"
import { effectLabel, overP95, retryLabel, vsP95, writesBefore } from "@/lib/trace-step-uses"
import { CATALOGUE, COSTS, TRACE, WORKFLOW } from "@/components/traces/__fixtures__/trace-64b46dde"

const index = functionIndex(CATALOGUE)
const t = (fn: string, input: Record<string, unknown> = {}): Task => ({ id: "x", name: "x", function: { name: fn, input } })
const label = (task: Task) => effectLabel(stepEffect(task, index))

describe("effectLabel", () => {
  it("names the operation and what it touches", () => {
    expect(label(t("cache_incr", { connector: "soma-cache" }))).toBe("incr soma-cache")
    expect(label(t("http_call", { connector: "billing", method: "POST" }))).toBe("post billing")
    expect(label(t("db_write", { connector: { var: "x" } }))).toBe("write (computed connector)")
    expect(label(t("channel_call", { channel: "internal-session-check" }))).toBe("call internal-session-check")
    expect(label(t("model_infer", { model: "fraud" }))).toBe("infer fraud")
    expect(label(t("tb.pairing.pair"))).toBe("call tb.pairing v2")
  })

  it("reads a filter as a gate and a compute step as in memory", () => {
    expect(label(t("filter"))).toBe("halts the run")
    expect(label(t("map"))).toBe("in memory")
    expect(effectLabel(null)).toBe("—")
  })
})

describe("vsP95", () => {
  it("renders the multiple, severe from 10×", () => {
    expect(vsP95(8_115_055, 0.7)).toMatchObject({ text: "11,600×", severe: true })
    expect(vsP95(74_350, 229.6)).toMatchObject({ text: "0.3×", severe: false })
    expect(vsP95(9, 0.5).text).toBe("<0.1×")
    expect(vsP95(9, null).text).toBe("—")
    expect(vsP95(9, 0).text).toBe("—")
  })
})

describe("overP95", () => {
  it("counts the steps that ran past their baseline", () => {
    const tl = buildTimeline(TRACE, WORKFLOW)!
    expect(overP95(tl.steps, (id) => COSTS.get(id)?.p95Ms)).toEqual({ judged: 11, over: 1 })
  })
})

describe("writesBefore", () => {
  const tl = buildTimeline(TRACE, WORKFLOW)!

  it("lists the writes that completed before the failure", () => {
    const prior = writesBefore(tl, tl.failed!, index)
    expect(prior.map((w) => w.step.taskId)).toEqual(["insert"])
    expect(prior[0].effect.resource?.name).toBe("soma-db")
    expect(prior[0].risk).toBe(true)
    expect(prior[0].gapUs).toBe(98449 - (92171 + 5485))
    expect(retryLabel(prior[0].effect)).toBe("unsafe to retry")
  })

  it("does not count an http_call GET as a write", () => {
    const get = {
      ...WORKFLOW,
      tasks: WORKFLOW.tasks.map((s) =>
        (s as Task).id === "insert"
          ? { ...(s as Task), function: { name: "http_call", input: { connector: "peer", method: "GET" } } }
          : s,
      ),
    }
    const t2 = buildTimeline(TRACE, get)!
    expect(writesBefore(t2, t2.failed!, index)).toEqual([])
  })

  it("keeps an idempotent write, not flagged as a risk", () => {
    const upsert = {
      ...WORKFLOW,
      tasks: WORKFLOW.tasks.map((s) =>
        (s as Task).id === "insert"
          ? { ...(s as Task), function: { name: "http_call", input: { connector: "peer", method: "PUT" } } }
          : s,
      ),
    }
    const t2 = buildTimeline(TRACE, upsert)!
    const [w] = writesBefore(t2, t2.failed!, index)
    expect(w.risk).toBe(false)
    expect(retryLabel(w.effect)).toBe("idempotent write")
  })

  it("names the deciding input when the client cannot resolve it", () => {
    const computed = {
      ...WORKFLOW,
      tasks: WORKFLOW.tasks.map((s) =>
        (s as Task).id === "insert"
          ? { ...(s as Task), function: { name: "db_write", input: { connector: "soma-db", sql: { var: "q" } } } }
          : s,
      ),
    }
    const t2 = buildTimeline(TRACE, computed)!
    const [w] = writesBefore(t2, t2.failed!, index)
    expect(retryLabel(w.effect)).toBe("depends on its input (sql)")
  })

  it("says nothing before the catalogue loads", () => {
    expect(writesBefore(tl, tl.failed!, functionIndex(undefined))).toEqual([])
  })
})
