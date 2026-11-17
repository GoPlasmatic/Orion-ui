// @vitest-environment node
import { describe, it, expect } from "vitest"
import { firstRunSteps, isFirstRun } from "@/lib/onboarding"

describe("firstRunSteps", () => {
  it("starts with the CLI on an instance nothing was applied to", () => {
    const steps = firstRunSteps({ headRevision: 0, appliedRevision: 0, channels: 0, traces: 0 })
    expect(steps.map((s) => s.key)).toEqual(["compile", "apply", "converge", "request"])
    expect(steps.every((s) => !s.done)).toBe(true)
    expect(steps[1].command).toBe("orion-cli deployments apply -d dist/deployment")
  })

  it("waits for this node to serve the head before converge is done", () => {
    const building = firstRunSteps({ headRevision: 3, appliedRevision: 2, channels: 1, traces: 0 })
    expect(building.map((s) => s.done)).toEqual([true, true, false, false])
    expect(building[2].to).toBe("/deployments/3?tab=convergence")
    const served = firstRunSteps({ headRevision: 3, appliedRevision: 3, channels: 1, traces: 4 })
    expect(served.every((s) => s.done)).toBe(true)
  })

  it("is over once the head deploys a channel", () => {
    expect(isFirstRun({ headRevision: 0, channels: 0 })).toBe(true)
    expect(isFirstRun({ headRevision: 2, channels: 0 })).toBe(true)
    expect(isFirstRun({ headRevision: 2, channels: 1 })).toBe(false)
  })
})
