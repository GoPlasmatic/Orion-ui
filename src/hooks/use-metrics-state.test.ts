import { describe, expect, it } from "vitest"
import { metricsState } from "@/hooks/use-metrics"

describe("metricsState", () => {
  it("reads a slow first scrape as loading, not off", () => {
    expect(metricsState({ available: false, hasRate: false }, true, false, null)).toBe("loading")
  })
  it("reads one sample as warming and two as live", () => {
    expect(metricsState({ available: true, hasRate: false }, false, false, null)).toBe("warming")
    expect(metricsState({ available: true, hasRate: true }, false, false, null)).toBe("live")
  })
  it("tells a disabled exporter from an unreachable one", () => {
    expect(metricsState({ available: false, hasRate: false }, false, true, 404)).toBe("off")
    expect(metricsState({ available: false, hasRate: false }, false, true, 502)).toBe("error")
    expect(metricsState({ available: false, hasRate: false }, false, false, null)).toBe("off")
  })
  it("keeps showing a held sample through a failed refetch", () => {
    expect(metricsState({ available: true, hasRate: true }, false, true, 502)).toBe("live")
  })
})
