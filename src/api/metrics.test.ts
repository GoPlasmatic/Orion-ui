import { describe, it, expect } from "vitest"
import {
  parsePrometheus,
  counterTotal,
  sumByLabel,
  labelValues,
  histogramQuantile,
  histogramMean,
} from "@/api/metrics"

/**
 * A scrape in the exact shape Orion serves it.
 *
 * Transcribed from the server's own rendered-output assertions
 * (`crates/orion-server/src/metrics.rs`) and the metrics reference table. Two
 * properties matter and both have been got wrong before:
 *
 *  1. **Every name carries the `orion_` prefix.** The whole set was renamed in
 *     1.0. A hook querying the pre-1.0 spelling silently reads zero — no error,
 *     no empty state, just KPIs that render "—" forever.
 *  2. **`*_seconds` families are histograms, not summaries.** `metrics.rs` sets
 *     explicit `LATENCY_BUCKETS` on the `_seconds` suffix so quantiles are not
 *     pre-computed per replica. There is no `quantile` label to read; latency
 *     comes from `_bucket`/`_sum`/`_count`.
 *
 * This fixture exists so a future edit that reintroduces either mistake fails
 * here rather than on someone's dashboard.
 */
const SCRAPE = `
# HELP orion_messages_total Messages processed
# TYPE orion_messages_total counter
orion_messages_total{channel="orders",status="ok"} 90
orion_messages_total{channel="orders",status="error"} 8
orion_messages_total{channel="orders",status="timeout"} 2
orion_messages_total{channel="orders",status="duplicate"} 5
orion_messages_total{channel="payments",status="ok"} 40
# HELP orion_message_duration_seconds Message processing latency
# TYPE orion_message_duration_seconds histogram
orion_message_duration_seconds_bucket{channel="orders",le="0.005"} 20
orion_message_duration_seconds_bucket{channel="orders",le="0.01"} 60
orion_message_duration_seconds_bucket{channel="orders",le="0.025"} 90
orion_message_duration_seconds_bucket{channel="orders",le="0.05"} 100
orion_message_duration_seconds_bucket{channel="orders",le="+Inf"} 100
orion_message_duration_seconds_sum{channel="orders"} 1.5
orion_message_duration_seconds_count{channel="orders"} 100
# TYPE orion_workflow_duration_seconds histogram
orion_workflow_duration_seconds_bucket{workflow="process-orders",le="0.01"} 10
orion_workflow_duration_seconds_bucket{workflow="process-orders",le="0.025"} 40
orion_workflow_duration_seconds_bucket{workflow="process-orders",le="+Inf"} 40
orion_workflow_duration_seconds_sum{workflow="process-orders"} 0.8
orion_workflow_duration_seconds_count{workflow="process-orders"} 40
# TYPE orion_task_duration_seconds histogram
orion_task_duration_seconds_sum{workflow="process-orders",task="fetch",function="http_call"} 0.5
orion_task_duration_seconds_count{workflow="process-orders",task="fetch",function="http_call"} 40
orion_task_duration_seconds_sum{workflow="process-orders",task="store",function="db_write"} 0.1
orion_task_duration_seconds_count{workflow="process-orders",task="store",function="db_write"} 40
`

const snap = parsePrometheus(SCRAPE, 1000)

describe("parsePrometheus", () => {
  it("skips comments and keeps names verbatim", () => {
    expect(snap.lines.some((l) => l.name.startsWith("#"))).toBe(false)
    expect(snap.lines.some((l) => l.name === "orion_messages_total")).toBe(true)
  })

  it("does not strip the orion_ prefix", () => {
    // The prefix is part of the name on the wire. A consumer must query it.
    expect(counterTotal(snap, "messages_total")).toBe(0)
    expect(counterTotal(snap, "orion_messages_total")).toBe(145)
  })

  it("parses +Inf bucket bounds", () => {
    const inf = snap.lines.find(
      (l) => l.name === "orion_message_duration_seconds_bucket" && l.labels.le === "+Inf",
    )
    expect(inf?.value).toBe(100)
  })
})

describe("counterTotal / sumByLabel / labelValues", () => {
  it("filters by label", () => {
    expect(counterTotal(snap, "orion_messages_total", { channel: "orders", status: "ok" })).toBe(90)
  })

  it("groups by label", () => {
    const byChannel = sumByLabel(snap, "orion_messages_total", "channel")
    expect(byChannel.get("orders")).toBe(105)
    expect(byChannel.get("payments")).toBe(40)
  })

  it("enumerates distinct label values", () => {
    expect(labelValues(snap, "orion_workflow_duration_seconds_count", "workflow")).toEqual([
      "process-orders",
    ])
    expect(
      labelValues(snap, "orion_task_duration_seconds_count", "task", {
        workflow: "process-orders",
      }),
    ).toEqual(["fetch", "store"])
  })
})

describe("histogramQuantile", () => {
  it("interpolates within the bucket the rank falls in", () => {
    // p95 of 100 observations → rank 95, which lands in the (0.025, 0.05]
    // bucket spanning cumulative counts 90..100.
    // 0.025 + (95-90)/(100-90) * (0.05-0.025) = 0.0375
    const v = histogramQuantile(snap, "orion_message_duration_seconds", 0.95, {
      channel: "orders",
    })
    expect(v).toBeCloseTo(0.0375, 6)
  })

  it("reads the median from the correct bucket", () => {
    // rank 50 lands in (0.005, 0.01], counts 20..60.
    // 0.005 + (50-20)/(60-20) * (0.01-0.005) = 0.00875
    const v = histogramQuantile(snap, "orion_message_duration_seconds", 0.5, { channel: "orders" })
    expect(v).toBeCloseTo(0.00875, 6)
  })

  it("returns null for an absent family rather than zero", () => {
    // A silently-zero latency reads as "instant", which is worse than "unknown".
    expect(histogramQuantile(snap, "message_duration_seconds", 0.95)).toBeNull()
    expect(histogramQuantile(snap, "orion_message_duration_seconds", 0.95, { channel: "nope" }))
      .toBeNull()
  })

  it("finds no summary quantile label, because there is none", () => {
    expect(snap.lines.some((l) => l.labels.quantile !== undefined)).toBe(false)
  })
})

describe("histogramMean", () => {
  it("uses the cumulative mean with no prior sample", () => {
    // 1.5s over 100 observations.
    expect(histogramMean(null, snap, "orion_message_duration_seconds")).toBeCloseTo(0.015, 6)
  })

  it("uses the windowed delta when a prior sample exists", () => {
    const prev = parsePrometheus(
      `orion_message_duration_seconds_sum{channel="orders"} 1.0
orion_message_duration_seconds_count{channel="orders"} 50`,
      0,
    )
    // Δsum 0.5 over Δcount 50 → 10ms in the window, not the 15ms lifetime mean.
    expect(histogramMean(prev, snap, "orion_message_duration_seconds")).toBeCloseTo(0.01, 6)
  })
})

describe("workflow vs task duration (Orion 1.2)", () => {
  it("yields engine overhead by subtraction", () => {
    const runs = counterTotal(snap, "orion_workflow_duration_seconds_count", {
      workflow: "process-orders",
    })
    const wfSum = counterTotal(snap, "orion_workflow_duration_seconds_sum", {
      workflow: "process-orders",
    })
    const taskSum = counterTotal(snap, "orion_task_duration_seconds_sum", {
      workflow: "process-orders",
    })
    expect(runs).toBe(40)
    expect(wfSum).toBeCloseTo(0.8, 6)
    // The task sum aggregates every task row for the workflow: 0.5 + 0.1.
    expect(taskSum).toBeCloseTo(0.6, 6)
    // 20ms per run, of which 15ms is task bodies → 5ms of engine overhead.
    expect(((wfSum - taskSum) / runs) * 1000).toBeCloseTo(5, 6)
  })
})
