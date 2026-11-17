// @vitest-environment node
import { describe, expect, it } from "vitest"
import { legendFor, levelFor, parseColorMetric } from "@/lib/traffic-encoding"
import type { SystemNode } from "@/lib/system-graph"

const node = (over: Partial<SystemNode> = {}) => ({ id: "orders", unresolved: false, ...over }) as SystemNode

describe("the serving colour", () => {
  it("reads this node's verdict: quarantined, a load issue, or serving", () => {
    expect(levelFor("serving", node(), undefined)).toBe("healthy")
    expect(levelFor("serving", node(), undefined, [{ kind: "breaker" }])).toBe("warning")
    expect(levelFor("serving", node(), undefined, [{ kind: "connector" }, { kind: "quarantined" }])).toBe("critical")
    // Named by a channel_call, deployed nowhere.
    expect(levelFor("serving", node({ unresolved: true }), undefined)).toBe("critical")
    expect(legendFor("serving").map((e) => e.level)).toEqual(["healthy", "warning", "critical", "idle"])
  })

  it("reads 1.x's lifecycle link as serving, and anything unknown as health", () => {
    expect(parseColorMetric("lifecycle")).toBe("serving")
    expect(parseColorMetric("latency")).toBe("latency")
    expect(parseColorMetric("bogus")).toBe("health")
    expect(parseColorMetric("")).toBe("health")
  })
})
