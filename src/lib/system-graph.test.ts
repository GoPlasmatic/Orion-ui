/**
 * The System Map's model, and the two things about it that are easy to get
 * quietly wrong: which identifier a `channel_call` is resolved by, and what a
 * channel's load is when the exporter cannot see it.
 */
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph, neighbourhood } from "@/lib/system-graph"
import { deriveLoad } from "@/lib/traffic-encoding"
import type { Channel, Connector, Workflow } from "@/api/types"
import type { ChannelTraffic } from "@/hooks/use-metrics"

function channel(name: string, over: Partial<Channel> = {}): Channel {
  return {
    // A UUID, deliberately unlike the name: that difference is the bug this
    // model exists to avoid re-introducing.
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
    tags: ["sias"],
    content_hash: "sha256:x",
    created_at: "",
    updated_at: "",
    ...over,
  } as Channel
}

function workflow(id: string, tasks: unknown[], name = `WF ${id}`): Workflow {
  return {
    workflow_id: id,
    name,
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
const mongo = (connector: string) => ({
  id: `read-${connector}`,
  function: { name: "mongo_read", input: { connector } },
})

function connector(name: string): Connector {
  return {
    id: `conn-${name}`,
    name,
    connector_type: "db",
    config: {},
    config_json: "{}",
    enabled: true,
    tags: [],
    content_hash: "sha256:z",
    created_at: "",
    updated_at: "",
  } as Connector
}

function graphOf(channels: Channel[], workflows: Workflow[], connectors: Connector[] = []) {
  return buildSystemGraph(buildIndex(channels, workflows, connectors))
}

describe("buildSystemGraph", () => {
  it("resolves channel_call targets by name, not by channel_id", () => {
    // The regression: channel_id is a UUID and channel_call names a channel, so
    // resolving the target against the id map misses every time — the callee
    // renders as "missing" and the walk stops there.
    const graph = graphOf(
      [channel("auth-login"), channel("internal-session-check")],
      [
        workflow("auth-login", [call("internal-session-check")]),
        workflow("internal-session-check", []),
      ],
    )

    expect(graph.edges).toEqual([
      { id: "auth-login->internal-session-check", source: "auth-login", target: "internal-session-check" },
    ])
    const callee = graph.byId.get("internal-session-check")!
    expect(callee.unresolved).toBe(false)
    expect(callee.callers).toEqual(["auth-login"])
    expect(graph.byId.get("auth-login")!.callees).toEqual(["internal-session-check"])
  })

  it("keeps the routing UUID separate from the graph key", () => {
    const graph = graphOf([channel("auth-login")], [workflow("auth-login", [])])
    const node = graph.byId.get("auth-login")!
    expect(node.id).toBe("auth-login")
    expect(node.channelId).toBe("uuid-auth-login")
  })

  it("marks a call target that is not registered", () => {
    const graph = graphOf([channel("a")], [workflow("a", [call("ghost")])])
    expect(graph.byId.get("ghost")!.unresolved).toBe(true)
    expect(graph.byId.get("ghost")!.callers).toEqual(["a"])
  })

  it("descends task groups when collecting calls and connectors", () => {
    // A call inside a guard clause is still a call; iterating `tasks` directly
    // would miss it.
    const grouped = workflow("a", [
      { id: "guard", condition: { "==": [1, 1] }, tasks: [call("b"), mongo("sias-mongo")] },
    ])
    const graph = graphOf(
      [channel("a"), channel("b")],
      [grouped, workflow("b", [])],
      [connector("sias-mongo")],
    )
    expect(graph.byId.get("a")!.callees).toEqual(["b"])
    expect(graph.byId.get("a")!.connectors).toEqual(["sias-mongo"])
  })

  it("tiers by longest path so hubs sit downstream of every caller", () => {
    const graph = graphOf(
      [channel("entry"), channel("mid"), channel("leaf")],
      [
        workflow("entry", [call("mid"), call("leaf")]),
        workflow("mid", [call("leaf")]),
        workflow("leaf", []),
      ],
    )
    expect(graph.byId.get("entry")!.tier).toBe(0)
    expect(graph.byId.get("mid")!.tier).toBe(1)
    // Reachable in one hop from entry, but the longest path is two.
    expect(graph.byId.get("leaf")!.tier).toBe(2)
  })

  it("terminates on a cycle instead of spinning", () => {
    const graph = graphOf(
      [channel("a"), channel("b")],
      [workflow("a", [call("b")]), workflow("b", [call("a")])],
    )
    expect(graph.nodes).toHaveLength(2)
    expect(graph.maxTier).toBeGreaterThanOrEqual(0)
  })

  it("drops a self-call, which adds nothing to read", () => {
    const graph = graphOf([channel("a")], [workflow("a", [call("a")])])
    expect(graph.edges).toHaveLength(0)
  })

  it("reports connector fan-in rather than making connectors nodes", () => {
    const graph = graphOf(
      [channel("a"), channel("b")],
      [workflow("a", [mongo("sias-mongo")]), workflow("b", [mongo("sias-mongo")])],
      [connector("sias-mongo")],
    )
    expect(graph.nodes.map((n) => n.id)).toEqual(["a", "b"])
    expect(graph.connectors).toEqual([
      { name: "sias-mongo", users: ["a", "b"], enabled: true, known: true, refId: "conn-sias-mongo" },
    ])
  })

  it("flags a workflow shared by more than one channel", () => {
    const graph = graphOf(
      [channel("a", { workflow_id: "shared" }), channel("b", { workflow_id: "shared" }), channel("c")],
      [workflow("shared", []), workflow("c", [])],
    )
    expect(graph.byId.get("a")!.workflowShared).toBe(true)
    expect(graph.byId.get("c")!.workflowShared).toBe(false)
  })

  it("walks both directions for the blast radius", () => {
    const graph = graphOf(
      [channel("caller"), channel("hub"), channel("downstream")],
      [
        workflow("caller", [call("hub")]),
        workflow("hub", [call("downstream")]),
        workflow("downstream", []),
      ],
    )
    // From the hub: upstream and downstream both, which a forward-only walk
    // could never report.
    expect([...neighbourhood(graph, "hub")].sort()).toEqual(["caller", "downstream", "hub"])
  })
})

function traffic(channelName: string, ratePerMin: number): ChannelTraffic {
  return {
    channel: channelName,
    ratePerMin,
    windowed: ratePerMin,
    ok: ratePerMin,
    failed: 0,
    rejected: 0,
    duplicate: 0,
    errorPct: 0,
    rejectedPct: 0,
    dominantIssue: null,
    p95Ms: 5,
    total: ratePerMin,
  }
}

describe("deriveLoad", () => {
  it("inherits load for a channel the exporter never sees", () => {
    // internal-* channels are dispatched inside the engine, so
    // orion_messages_total carries no series for them at all.
    const graph = graphOf(
      [channel("a"), channel("b"), channel("internal")],
      [
        workflow("a", [call("internal")]),
        workflow("b", [call("internal")]),
        workflow("internal", []),
      ],
    )
    const load = deriveLoad(
      graph,
      new Map([
        ["a", traffic("a", 60)],
        ["b", traffic("b", 40)],
      ]),
    )

    expect(load.get("a")).toMatchObject({ metered: true, own: 60, effective: 60 })
    expect(load.get("internal")).toMatchObject({ metered: false, derived: 100, effective: 100 })
  })

  it("propagates through a chain of unmetered channels", () => {
    const graph = graphOf(
      [channel("edge"), channel("mid"), channel("leaf")],
      [workflow("edge", [call("mid")]), workflow("mid", [call("leaf")]), workflow("leaf", [])],
    )
    const load = deriveLoad(graph, new Map([["edge", traffic("edge", 25)]]))
    expect(load.get("mid")!.effective).toBe(25)
    expect(load.get("leaf")!.effective).toBe(25)
  })

  it("leaves load null when no caller has any traffic", () => {
    const graph = graphOf(
      [channel("a"), channel("internal")],
      [workflow("a", [call("internal")]), workflow("internal", [])],
    )
    const load = deriveLoad(graph, new Map())
    expect(load.get("internal")).toMatchObject({ metered: false, derived: null, effective: null })
  })

  it("prefers a measured rate over an inherited one", () => {
    const graph = graphOf(
      [channel("a"), channel("both")],
      [workflow("a", [call("both")]), workflow("both", [])],
    )
    const load = deriveLoad(
      graph,
      new Map([
        ["a", traffic("a", 90)],
        ["both", traffic("both", 5)],
      ]),
    )
    expect(load.get("both")).toMatchObject({ metered: true, own: 5, effective: 5, derived: null })
  })
})
