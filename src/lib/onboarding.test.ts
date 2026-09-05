// @vitest-environment node
import { describe, it, expect } from "vitest"
import { firstRunSteps, isFirstRun } from "@/lib/onboarding"

describe("firstRunSteps", () => {
  it("marks nothing done on an empty instance", () => {
    const steps = firstRunSteps({ workflows: 0, activeWorkflows: 0, channels: 0, activeChannels: 0, traces: 0 })
    expect(steps).toHaveLength(5)
    expect(steps.every((s) => !s.done)).toBe(true)
    expect(steps[0].to).toBe("/workflows/new")
  })

  it("ticks steps in the order the smoke flow completes them", () => {
    const steps = firstRunSteps({ workflows: 1, activeWorkflows: 1, channels: 1, activeChannels: 0, traces: 0 })
    expect(steps.map((s) => s.done)).toEqual([true, true, true, false, false])
  })

  it("is over once a channel is live", () => {
    expect(isFirstRun({ activeChannels: 0 })).toBe(true)
    expect(isFirstRun({ activeChannels: 3 })).toBe(false)
  })
})
