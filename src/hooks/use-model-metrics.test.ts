/**
 * `useModelMetrics` reads the `orion_model_*` families, and the names and
 * label sets are the kind of thing a docs table gets subtly wrong. The fixture
 * is **verbatim `/metrics` output from a live Orion 1.8.0 node** that admitted
 * the shipped `c4-tiny` graph, served 13 successful inferences and 7 that
 * failed in the adapter — so this pins the reduction against the real wire
 * format rather than against the reference table.
 */
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  parsePrometheus,
  counterTotal,
  sumByLabel,
  labelValues,
  histogramQuantile,
  histogramMean,
} from "@/api/metrics"

const snap = parsePrometheus(
  readFileSync(resolve(__dirname, "__fixtures__/model-metrics.txt"), "utf8"),
)
const MODEL = "example.c4-tiny"
const filter = { model: MODEL }

describe("orion_model_* as a live 1.8.0 node emits it", () => {
  it("counts inferences and errors off the same family", () => {
    expect(counterTotal(snap, "orion_model_inferences_total", filter)).toBe(20)
    expect(
      counterTotal(snap, "orion_model_inferences_total", { ...filter, outcome: "error" }),
    ).toBe(7)
    expect(counterTotal(snap, "orion_model_inferences_total", { ...filter, outcome: "ok" })).toBe(
      13,
    )
  })

  it("splits failures by the host's own category label", () => {
    const byCategory = sumByLabel(snap, "orion_model_failures_total", "category", filter)
    expect(byCategory.get("adapter")).toBe(7)
    // An adapter refusal is a caller/manifest problem, never a retryable one —
    // `timeout` is the only category that is.
    expect(byCategory.get("timeout") ?? 0).toBe(0)
  })

  it("splits loads by source, so a cold load paid by a request is visible", () => {
    const bySource = sumByLabel(snap, "orion_model_loads_total", "source", filter)
    expect(bySource.get("admission")).toBe(1)
    expect(bySource.get("preload")).toBe(1)
    // Nothing was loaded on demand: the preload warmed it before any request.
    expect(bySource.get("demand") ?? 0).toBe(0)
  })

  it("reads latency from the histogram, since there is no quantile label", () => {
    const p95 = histogramQuantile(snap, "orion_model_inference_duration_seconds", 0.95, filter)
    expect(p95).not.toBeNull()
    expect(p95!).toBeGreaterThan(0)
    const mean = histogramMean(null, snap, "orion_model_inference_duration_seconds", filter)
    // 0.00296.../20 — the sum and count are both labelled, so the filter must reach them.
    expect(mean!).toBeCloseTo(0.0029640419999999996 / 20, 10)
  })

  it("reads the permit wait separately from the graph's own cost", () => {
    // Counted only for inferences that reached the permit: 13, not 20.
    expect(counterTotal(snap, "orion_model_queue_seconds_count", filter)).toBe(13)
  })

  it("names the runtimes the node actually served it on", () => {
    expect(labelValues(snap, "orion_model_inferences_total", "runtime", filter)).toEqual(["tract"])
  })

  it("keeps node-wide gauges unlabelled by model", () => {
    expect(counterTotal(snap, "orion_model_cache_bytes")).toBe(6171)
  })

  it("does not attribute another model's series to this one", () => {
    expect(counterTotal(snap, "orion_model_inferences_total", { model: "other.model" })).toBe(0)
  })
})
