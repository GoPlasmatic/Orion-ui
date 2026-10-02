import { describe, expect, it } from "vitest"
import { buildTimeline } from "@/lib/trace-timeline"
import { buildAxis, formatTick, niceCeil, niceFloor, splitAdvice } from "./timeline-axis"
import { TRACE, WORKFLOW } from "./__fixtures__/trace-64b46dde"

const tl = buildTimeline(TRACE, WORKFLOW)!

describe("round values", () => {
  it("rounds a break up and down to a readable value", () => {
    expect(niceCeil(98449)).toBe(100_000)
    expect(niceCeil(101_000)).toBe(150_000)
    expect(niceFloor(8_213_504)).toBe(8_000_000)
    expect(niceCeil(0)).toBe(0)
  })

  it("labels a tick without trailing zeros", () => {
    expect(formatTick(0)).toBe("0")
    expect(formatTick(250)).toBe("250 µs")
    expect(formatTick(25_000)).toBe("25 ms")
    expect(formatTick(2_500_000)).toBe("2.5 s")
  })
})

describe("splitAdvice", () => {
  it("prefers split when one step is more than 20× the rest of the run", () => {
    expect(splitAdvice(tl)).toEqual({ available: true, preferred: true })
  })

  it("keeps linear when no step dominates", () => {
    const even = buildTimeline(
      { ...TRACE, status: "completed", error: undefined, completed_at: "2026-10-02T05:41:15.937000", task_trace_json: {
        steps: (TRACE.task_trace_json as { steps: Record<string, unknown>[] }).steps.slice(0, 7),
      } },
      WORKFLOW,
    )!
    expect(splitAdvice(even).preferred).toBe(false)
  })
})

describe("buildAxis", () => {
  it("is linear end to end in linear mode", () => {
    const axis = buildAxis(tl, "linear")
    expect(axis.x(0)).toBe(0)
    expect(axis.x(tl.totalUs)).toBe(100)
    expect(axis.x(tl.totalUs / 2)).toBeCloseTo(50)
    expect(axis.breaks).toHaveLength(0)
    expect(axis.ticks.map((t) => t.label)).toEqual(["0", "2 s", "4 s", "6 s", "8.36 s"])
  })

  it("spreads the first 100 ms over 60 % in split mode, then jumps the break", () => {
    const axis = buildAxis(tl, "split")
    expect(axis.mode).toBe("split")
    expect(axis.x(50_000)).toBeCloseTo(30)
    expect(axis.x(100_000)).toBeCloseTo(60)
    expect(axis.x(100_001)).toBeGreaterThanOrEqual(63)
    expect(axis.x(tl.totalUs)).toBe(100)
    expect(axis.breaks).toEqual([{ startPct: 60, endPct: 63 }])
    const labels = axis.ticks.map((t) => t.label)
    expect(labels.slice(0, 5)).toEqual(["0", "25 ms", "50 ms", "75 ms", "100 ms"])
    expect(labels[labels.length - 1]).toBe("8.36 s")
  })

  it("is monotonic, so bars never overlap out of order", () => {
    const axis = buildAxis(tl, "split")
    let prev = -1
    for (let us = 0; us <= tl.totalUs; us += 7919) {
      const p = axis.x(us)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
  })

  it("zooms both sides when steps follow the dominant one", () => {
    const steps = (TRACE.task_trace_json as { steps: Record<string, unknown>[] }).steps
    // Move the hang to `demand`, so seven steps run after it.
    const slow = steps.map((s) => ({ ...s }))
    const shift = 5_000_000
    slow[2].duration_us = 74350 + shift
    const slowStart = Date.parse(String(slow[2].started_at))
    for (let i = 3; i < slow.length; i++) {
      const t = Date.parse(String(slow[i].started_at)) - slowStart
      const iso = new Date(slowStart + t + shift / 1000).toISOString()
      slow[i].started_at = iso
    }
    slow[10].duration_us = 10_000
    const t = buildTimeline(
      { ...TRACE, completed_at: "2026-10-02T05:41:21.200000", task_trace_json: { steps: slow } },
      WORKFLOW,
    )!
    expect(t.dominant?.taskId).toBe("demand")
    const axis = buildAxis(t, "split")
    expect(axis.segments).toHaveLength(3)
    expect(axis.segments[0].zoomed && axis.segments[2].zoomed).toBe(true)
    expect(axis.breaks).toHaveLength(2)
  })
})
