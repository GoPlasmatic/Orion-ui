/**
 * The System Map's layout, and the mistake it replaced: an entry channel that
 * makes no calls is still an entry channel, not a leftover.
 */
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { layoutSystemGraph, type LayoutEdge, type LayoutInput } from "@/lib/map-layout"

const node = (id: string, tier: number, over: Partial<LayoutInput> = {}): LayoutInput => ({
  id,
  width: 200,
  height: 40,
  tier,
  ...over,
})
const edge = (source: string, target: string): LayoutEdge => ({
  id: `${source}->${target}`,
  source,
  target,
})

function rect(nodes: LayoutInput[], positions: Map<string, { x: number; y: number }>, id: string) {
  const n = nodes.find((x) => x.id === id)!
  const p = positions.get(id)!
  return { left: p.x, right: p.x + n.width, top: p.y, bottom: p.y + n.height }
}

function expectNoOverlap(nodes: LayoutInput[], positions: Map<string, { x: number; y: number }>) {
  for (const a of nodes) {
    for (const b of nodes) {
      if (a.id >= b.id) continue
      const ra = rect(nodes, positions, a.id)
      const rb = rect(nodes, positions, b.id)
      const apart =
        ra.right <= rb.left || rb.right <= ra.left || ra.bottom <= rb.top || rb.bottom <= ra.top
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true)
    }
  }
}

describe("layoutSystemGraph", () => {
  it("returns nothing for nothing", () => {
    const out = layoutSystemGraph([], [])
    expect(out.positions.size).toBe(0)
    expect(out.lanes).toEqual([])
  })

  it("keeps a call-less entry channel in the entry lane, not a separate band", () => {
    // `achievers-list` is reached over its route and calls nothing. The old
    // layout parked it under the graph as "not reached by any call".
    const nodes = [node("auth-login", 0), node("achievers-list", 0), node("internal-session-check", 1)]
    const out = layoutSystemGraph(nodes, [edge("auth-login", "internal-session-check")])

    expect(out.lanes.map((l) => l.tier)).toEqual([0, 1])
    const entry = out.lanes[0]
    expect(entry.count).toBe(2)
    for (const id of ["auth-login", "achievers-list"]) {
      const r = rect(nodes, out.positions, id)
      expect(r.left).toBeGreaterThanOrEqual(entry.x)
      expect(r.right).toBeLessThanOrEqual(entry.x + entry.width)
    }
    // Too few to box: both are bare nodes in the same column.
    expect(out.clusters).toEqual([])
    expect(out.positions.get("achievers-list")!.x).toBe(out.positions.get("auth-login")!.x)
  })

  it("boxes entries that share a dependency set, with the call-less ones as a cluster too", () => {
    const callers = ["a", "b", "c", "d"].map((id) => node(id, 0))
    const loners = ["p", "q", "r"].map((id) => node(id, 0))
    const nodes = [...callers, ...loners, node("hub", 1)]
    const out = layoutSystemGraph(
      nodes,
      callers.map((c) => edge(c.id, "hub")),
    )
    expect(out.clusters).toHaveLength(2)
    const shared = out.clusters.find((c) => c.callees.length === 1)!
    const none = out.clusters.find((c) => c.callees.length === 0)!
    expect([...shared.members].sort()).toEqual(["a", "b", "c", "d"])
    expect(shared.callees).toEqual(["hub"])
    expect([...none.members].sort()).toEqual(["p", "q", "r"])
    // The call-less cluster sits below the callers, in the same lane.
    expect(none.y).toBeGreaterThan(shared.y + shared.height)
    const lane = out.lanes[0]
    for (const c of out.clusters) {
      expect(c.x).toBeGreaterThanOrEqual(lane.x)
      expect(c.x + c.width).toBeLessThanOrEqual(lane.x + lane.width)
      for (const id of c.members) {
        const r = rect(nodes, out.positions, id)
        expect(r.left).toBeGreaterThanOrEqual(c.x)
        expect(r.right).toBeLessThanOrEqual(c.x + c.width)
        expect(r.top).toBeGreaterThanOrEqual(c.y)
        expect(r.bottom).toBeLessThanOrEqual(c.y + c.height)
      }
    }
    expectNoOverlap(nodes, out.positions)
  })

  it("puts a hub downstream of its callers and vertically among them", () => {
    const callers = ["a", "b", "c", "d"].map((id) => node(id, 0))
    const nodes = [...callers, node("hub", 1)]
    const out = layoutSystemGraph(
      nodes,
      callers.map((c) => edge(c.id, "hub")),
    )
    const hub = rect(nodes, out.positions, "hub")
    for (const c of callers) expect(rect(nodes, out.positions, c.id).right).toBeLessThan(hub.left)
    // Four callers with one dependency set are a cluster; the hub sits beside it.
    const cluster = out.clusters[0]
    expect(hub.top).toBeGreaterThanOrEqual(cluster.y)
    expect(hub.bottom).toBeLessThanOrEqual(cluster.y + cluster.height)
  })

  it("orders a column so callers of the same hub are adjacent", () => {
    // Handed over interleaved: a and b call h1, c and d call h2.
    const nodes = [node("a", 0), node("c", 0), node("b", 0), node("d", 0), node("h1", 1), node("h2", 1)]
    const out = layoutSystemGraph(nodes, [
      edge("a", "h1"),
      edge("b", "h1"),
      edge("c", "h2"),
      edge("d", "h2"),
    ])
    const y = (id: string) => out.positions.get(id)!.y
    const order = ["a", "b", "c", "d"].sort((p, q) => y(p) - y(q))
    expect(order.slice(0, 2).sort()).toEqual(["a", "b"])
    expect(order.slice(2).sort()).toEqual(["c", "d"])
    expect(y("h1") < y("h2")).toBe(true)
  })

  it("compresses tiers a filter has hidden", () => {
    const nodes = [node("a", 0), node("z", 2)]
    const out = layoutSystemGraph(nodes, [edge("a", "z")])
    expect(out.lanes.map((l) => l.tier)).toEqual([0, 2])
    expect(out.lanes[1].x).toBeGreaterThan(out.lanes[0].x + out.lanes[0].width)
  })

  it("grids a system with no calls at all instead of stacking it", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => node(`c${i}`, 0))
    const out = layoutSystemGraph(nodes, [])
    expect(out.lanes).toHaveLength(1)
    expect(out.clusters).toHaveLength(1)
    const xs = new Set([...out.positions.values()].map((p) => p.x))
    expect(xs.size).toBe(4)
    expect(out.height).toBeLessThan(40 * 50)
    expectNoOverlap(nodes, out.positions)
  })

  it("never overlaps nodes, including mixed sizes and long edges", () => {
    const nodes = [
      ...Array.from({ length: 12 }, (_, i) =>
        node(`e${i}`, 0, i % 3 === 0 ? { width: 260, height: 76 } : {}),
      ),
      ...Array.from({ length: 6 }, (_, i) => node(`s${i}`, 0)),
      node("hub", 1, { width: 260, height: 76 }),
      node("mid", 1),
      node("leaf", 2),
      node("deep", 3),
    ]
    const edges = [
      ...Array.from({ length: 12 }, (_, i) => edge(`e${i}`, i % 4 === 0 ? "mid" : "hub")),
      edge("e1", "leaf"),
      edge("mid", "leaf"),
      edge("leaf", "deep"),
      edge("e2", "deep"),
    ]
    const out = layoutSystemGraph(nodes, edges)
    expectNoOverlap(nodes, out.positions)
    expect(out.positions.size).toBe(nodes.length)
    // Every node sits inside its lane and every lane spans the full height.
    for (const n of nodes) {
      const lane = out.lanes.find((l) => l.tier === n.tier)!
      const r = rect(nodes, out.positions, n.id)
      expect(r.left).toBeGreaterThanOrEqual(lane.x)
      expect(r.right).toBeLessThanOrEqual(lane.x + lane.width)
      expect(r.top).toBeGreaterThanOrEqual(lane.y)
      expect(r.bottom).toBeLessThanOrEqual(lane.y + lane.height)
    }
  })
})
