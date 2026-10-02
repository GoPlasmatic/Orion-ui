// @vitest-environment node
import { describe, expect, it } from "vitest"
import { buildHealthGrid, tileChars, TILE_MAX_W, TILE_MIN_W } from "@/lib/health-grid"
import { buildDomains } from "@/lib/domains"
import type { SystemNode } from "@/lib/system-graph"
import type { ChannelTraffic } from "@/hooks/use-metrics"

function node(name: string, over: Partial<SystemNode> = {}): SystemNode {
  return {
    id: name,
    channelId: `uuid-${name}`,
    name,
    description: null,
    status: "active",
    channelType: "sync",
    protocol: "rest",
    route: `/${name}`,
    methods: [],
    schedule: null,
    topic: null,
    tags: [],
    workflowId: name,
    workflowName: null,
    workflowShared: false,
    steps: 1,
    groups: 0,
    connectors: [],
    callers: [],
    callees: [],
    tier: 0,
    unresolved: false,
    ...over,
  }
}

function traffic(channel: string, ratePerMin: number, failed = 0): ChannelTraffic {
  const windowed = ratePerMin * 5
  return {
    channel,
    ratePerMin,
    windowed,
    ok: windowed - failed,
    failed,
    rejected: 0,
    duplicate: 0,
    errorPct: windowed > 0 ? (failed / windowed) * 100 : null,
    rejectedPct: windowed > 0 ? 0 : null,
    dominantIssue: null,
    byStatus: {},
    p95Ms: windowed > 0 ? 20 : null,
    total: windowed,
  }
}

const NAMES = [
  "soma-admin-runner-keys-list",
  "soma-admin-check",
  "soma-user-profile-get",
  "soma-user-a-very-long-channel-name-that-cannot-fit",
  "soma-clock-pair",
]

describe("buildHealthGrid", () => {
  const nodes = NAMES.map((n) => node(n))
  const domains = buildDomains(nodes)

  it("sections by domain, labels without the prefix and domain, sorted by name", () => {
    const sections = buildHealthGrid({
      nodes,
      domains,
      byChannel: new Map(),
      colorMetric: "health",
      sizeMetric: "rate",
    })
    expect(sections.map((s) => s.domain)).toEqual(["admin", "user", "clock"])
    expect(sections[0].tiles.map((t) => t.label)).toEqual(["check", "runner-keys-list"])
    // Idle: every tile at the floor, every level idle.
    expect(sections.flatMap((s) => s.tiles).every((t) => t.width === TILE_MIN_W && t.level === "idle")).toBe(true)
  })

  it("cuts a long name in the middle to the tile, never from the right", () => {
    const sections = buildHealthGrid({ nodes, domains, byChannel: new Map(), colorMetric: "health", sizeMetric: "rate" })
    const long = sections[1].tiles.find((t) => t.id.includes("very-long"))!
    expect(long.label.length).toBeLessThanOrEqual(tileChars(long.width))
    expect(long.label).toContain("…")
    expect(long.label.startsWith("a-very")).toBe(true)
    expect(long.label.endsWith("fit")).toBe(true)
  })

  it("sizes by rate on a square-root scale and colours by health", () => {
    const byChannel = new Map([
      ["soma-user-profile-get", traffic("soma-user-profile-get", 400)],
      ["soma-admin-check", traffic("soma-admin-check", 100, 100)],
    ])
    const sections = buildHealthGrid({ nodes, domains, byChannel, colorMetric: "health", sizeMetric: "rate" })
    const tiles = new Map(sections.flatMap((s) => s.tiles).map((t) => [t.id, t]))
    expect(tiles.get("soma-user-profile-get")!.width).toBe(TILE_MAX_W)
    // A quarter of the rate is half the extra width.
    expect(tiles.get("soma-admin-check")!.width).toBe(Math.round(TILE_MIN_W + (TILE_MAX_W - TILE_MIN_W) * 0.5))
    expect(tiles.get("soma-admin-check")!.level).toBe("critical")
    expect(tiles.get("soma-user-profile-get")!.level).toBe("healthy")
    // The section takes its worst member, and sums the rate.
    const admin = sections.find((s) => s.domain === "admin")!
    expect(admin.level).toBe("critical")
    expect(admin.load.rate).toBe(100)
  })

  it("scales to five hundred channels", () => {
    const many = Array.from({ length: 500 }, (_, i) => node(`soma-d${i % 7}-channel-${i}`))
    const sections = buildHealthGrid({
      nodes: many,
      domains: buildDomains(many),
      byChannel: new Map(),
      colorMetric: "health",
      sizeMetric: "rate",
    })
    expect(sections).toHaveLength(7)
    expect(sections.reduce((n, s) => n + s.tiles.length, 0)).toBe(500)
  })
})
