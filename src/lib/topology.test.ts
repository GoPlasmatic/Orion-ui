/**
 * The per-entity neighbourhood builders behind the detail pages' relationship
 * graphs.
 *
 * The case worth pinning: `channel_call` names its target, while `channel_id` on
 * a real server is a UUID. Resolving the target against the id map meant every
 * call rendered as a dashed "missing" node and the walk stopped one hop in, so a
 * channel that called others showed neither the callee nor anything past it.
 */
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { buildIndex, buildChannelTopology, buildWorkflowNeighborhood } from "@/lib/topology"
import type { Channel, Workflow } from "@/api/types"

function channel(name: string): Channel {
  return {
    channel_id: `uuid-${name}`,
    name,
    description: null,
    channel_type: "sync",
    protocol: "rest",
    route_pattern: `/${name}`,
    methods: ["POST"],
    topic: null,
    consumer_group: null,
    transport_config: {},
    workflow_id: name,
    config: {},
    status: "active",
    version: 1,
    priority: 0,
    tags: [],
    content_hash: "sha256:x",
    created_at: "",
    updated_at: "",
  } as Channel
}

function workflow(id: string, tasks: unknown[]): Workflow {
  return {
    workflow_id: id,
    name: `WF ${id}`,
    description: null,
    priority: 0,
    condition: null,
    tasks,
    status: "active",
    version: 1,
    tags: [],
    content_hash: "sha256:y",
    created_at: "",
    updated_at: "",
  } as unknown as Workflow
}

const call = (target: string) => ({
  id: `call-${target}`,
  function: { name: "channel_call", input: { channel: target } },
})

// a -> b -> c, each channel running the like-named workflow
const index = buildIndex(
  [channel("a"), channel("b"), channel("c")],
  [workflow("a", [call("b")]), workflow("b", [call("c")]), workflow("c", [])],
  [],
)

describe("buildChannelTopology", () => {
  it("resolves a call target by name and keeps walking past it", () => {
    const model = buildChannelTopology("uuid-a", index)
    const ids = model.nodes.map((n) => n.id).sort()

    expect(ids).toContain("channel:uuid-b")
    expect(ids).toContain("channel:uuid-c")
    expect(model.nodes.every((n) => !n.unresolved)).toBe(true)
  })

  it("emits call edges whose endpoints match real node ids", () => {
    const model = buildChannelTopology("uuid-a", index)
    const nodeIds = new Set(model.nodes.map((n) => n.id))
    // A dangling edge is silently dropped by React Flow, so an edge naming a
    // node that was never added is invisible rather than loud.
    for (const edge of model.edges) {
      expect(nodeIds.has(edge.source)).toBe(true)
      expect(nodeIds.has(edge.target)).toBe(true)
    }
  })

  it("still marks a genuinely unknown target as missing", () => {
    const orphaned = buildIndex([channel("a")], [workflow("a", [call("ghost")])], [])
    const model = buildChannelTopology("uuid-a", orphaned)
    const ghost = model.nodes.find((n) => n.label === "ghost")
    expect(ghost?.unresolved).toBe(true)
  })
})

describe("buildWorkflowNeighborhood", () => {
  it("resolves its call targets by name too", () => {
    const model = buildWorkflowNeighborhood("a", index)
    const callee = model.nodes.find((n) => n.id === "channel:uuid-b")
    expect(callee).toBeDefined()
    expect(callee?.unresolved).toBeUndefined()
    expect(callee?.label).toBe("b")
  })
})
