/**
 * The dependencies lens, on a system shaped like QA: channels named
 * `soma-<domain>-<thing>`, no `channel_call` anywhere, and one database almost
 * everything writes to.
 */
// @vitest-environment node
import { describe, expect, it } from "vitest"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph } from "@/lib/system-graph"
import {
  buildDependencyGraph,
  callShare,
  connectorEdgeKey,
  CALLS_SHARE,
  dependantsByDomain,
  dependencyEdges,
  dependencyFocus,
  domainId,
  domainLoad,
  edgeLoad,
  hubId,
  hubLevel,
  layoutDependencies,
  parseHubId,
} from "@/lib/dependency-graph"
import { edgeKey, type ConnectorChannelTraffic } from "@/hooks/use-ops-metrics"
import type { ChannelTraffic } from "@/hooks/use-metrics"
import type { Channel, Connector, Workflow } from "@/api/types"

function channel(name: string, over: Partial<Channel> = {}): Channel {
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
    ...over,
  } as Channel
}

const db = (connector: string) => ({ id: `q-${connector}`, function: { name: "db_read", input: { connector } } })
const callTo = (target: string) => ({ id: `call-${target}`, function: { name: "channel_call", input: { channel: target } } })
const infer = (model: string) => ({ id: `infer-${model}`, function: { name: "model_infer", input: { model } } })
const pluginFn = (fn: string) => ({ id: `p-${fn}`, function: { name: fn, input: {} } })

function workflow(id: string, tasks: unknown[]): Workflow {
  return {
    workflow_id: id,
    name: id,
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

function connector(name: string, over: Partial<Connector> = {}): Connector {
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
    ...over,
  } as Connector
}

/** Domain → [thing, connectors…] */
const SPEC: Record<string, [string, ...string[]][]> = {
  user: [
    ["profile-get", "soma-db"],
    ["profile-put", "soma-db", "soma-cache"],
    ["session-check", "soma-db", "soma-cache"],
    ["avatar-upload", "soma-db", "soma-blobs"],
    ["prefs-get", "soma-db"],
    ["prefs-put", "soma-db"],
    ["feed-list", "soma-db", "soma-cache"],
  ],
  admin: [
    ["runner-keys-list", "soma-db"],
    ["runner-keys-rotate", "soma-db"],
    ["audit-export", "soma-db"],
    ["repo-sync", "soma-db", "soma-github"],
  ],
  pub: [
    ["posts-get", "soma-db", "soma-cache"],
    ["posts-search", "soma-db"],
  ],
  gate: [
    ["start", "soma-db-gate"],
    ["finish", "soma-db-gate"],
  ],
  clock: [["pair"]],
}

function qa() {
  const channels: Channel[] = []
  const workflows: Workflow[] = []
  for (const [domain, rows] of Object.entries(SPEC)) {
    for (const [thing, ...conns] of rows) {
      const name = `soma-${domain}-${thing}`
      channels.push(channel(name))
      const tasks: unknown[] = conns.map(db)
      if (name === "soma-clock-pair") tasks.push(infer("ranker"), pluginFn("pair_score"))
      workflows.push(workflow(name, tasks))
    }
  }
  const connectors = [
    connector("soma-db"),
    connector("soma-cache", { connector_type: "cache" }),
    connector("soma-db-gate"),
    connector("soma-blobs", { connector_type: "storage" }),
    connector("soma-github", { connector_type: "http", enabled: false }),
    connector("soma-unused", { connector_type: "http" }),
  ]
  const index = buildIndex(channels, workflows, connectors)
  return { index, graph: buildSystemGraph(index) }
}

const plugins = new Map([["pair_score", "pairing"]])

describe("buildDependencyGraph", () => {
  it("groups channels into domains by the segment after the shared prefix", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index)
    expect(dg.domainIndex.prefix).toBe("soma-")
    expect(dg.domains.map((d) => d.name)).toEqual(["user", "admin", "gate", "pub", "clock"])
    expect(dg.domains[0].id).toBe("domain:user")
    expect(dg.domainOf.get("soma-admin-repo-sync")).toBe("domain:admin")
  })

  it("makes every connector a hub, the shared one first, an unused one idle", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index)
    const db = dg.hubById.get("connector:soma-db")!
    expect(dg.hubs[0]).toBe(db)
    expect(db.dependants).toHaveLength(13)
    expect(db.type).toBe("db")
    expect(dg.hubById.get("connector:soma-cache")!.type).toBe("cache")

    const unused = dg.hubById.get("connector:soma-unused")!
    expect(unused.dependants).toEqual([])
    expect(dg.hubs[dg.hubs.length - 1]).toBe(unused)

    const github = dg.hubById.get("connector:soma-github")!
    expect(github.enabled).toBe(false)
    expect(github.known).toBe(true)
    expect(github.dependants).toEqual(["soma-admin-repo-sync"])
  })

  it("leaves unused connectors out when asked", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index, { includeUnused: false })
    expect(dg.hubById.has("connector:soma-unused")).toBe(false)
  })

  it("adds models by literal id and plugins through the catalogue", () => {
    const { graph, index } = qa()
    const without = buildDependencyGraph(graph, index)
    expect(without.hubById.has("plugin:pairing")).toBe(false)
    const dg = buildDependencyGraph(graph, index, { pluginOfFunction: plugins })
    expect(dg.refsOf.get("soma-clock-pair")).toEqual(["model:ranker", "plugin:pairing"])
    expect(dg.hubById.get("model:ranker")!.kind).toBe("model")
  })

  it("folds in a measured pair a static walk cannot see", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index, {
      measured: [
        ["soma-pub-posts-search", "soma-blobs"],
        ["not-in-view", "soma-db"],
      ],
    })
    expect(dg.refsOf.get("soma-pub-posts-search")).toContain("connector:soma-blobs")
    expect(dg.hubById.get("connector:soma-db")!.dependants).not.toContain("not-in-view")
  })

  it("keeps only what the filters keep", () => {
    const { graph, index } = qa()
    const visible = new Set(["soma-gate-start", "soma-gate-finish"])
    const dg = buildDependencyGraph(graph, index, { visible, includeUnused: false })
    expect(dg.domains.map((d) => d.name)).toEqual(["gate"])
    expect(dg.hubs.map((h) => h.id)).toEqual(["connector:soma-db-gate"])
  })

  it("groups by tag when asked", () => {
    const channels = [
      channel("a", { tags: ["billing"] }),
      channel("b", { tags: ["billing"] }),
      channel("c", { tags: [] }),
    ]
    const index = buildIndex(channels, [], [])
    const dg = buildDependencyGraph(buildSystemGraph(index), index, { mode: { by: "tag", tags: ["billing"] } })
    expect(dg.domains.map((d) => [d.name, d.members.length])).toEqual([
      ["billing", 2],
      ["other", 1],
    ])
  })
})

describe("dependencyEdges", () => {
  it("aggregates a collapsed domain into one edge per hub", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index)
    const edges = dependencyEdges(dg, () => false)
    const userDb = edges.find((e) => e.source === "domain:user" && e.target === "connector:soma-db")!
    expect(userDb.channels).toHaveLength(7)
    expect(edges.filter((e) => e.source === "domain:user").map((e) => e.target).sort()).toEqual([
      "connector:soma-blobs",
      "connector:soma-cache",
      "connector:soma-db",
    ])
    // No edge to a hub nothing uses.
    expect(edges.some((e) => e.target === "connector:soma-unused")).toBe(false)
  })

  it("draws one edge per channel inside an open domain", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index)
    const edges = dependencyEdges(dg, (id) => id === domainId("pub"))
    const pub = edges.filter((e) => e.channels.every((c) => c.startsWith("soma-pub-")))
    expect(pub.map((e) => e.id).sort()).toEqual([
      "soma-pub-posts-get=>connector:soma-cache",
      "soma-pub-posts-get=>connector:soma-db",
      "soma-pub-posts-search=>connector:soma-db",
    ])
  })
})

describe("edgeLoad", () => {
  it("keys edges the way the connector reader does", () => {
    expect(connectorEdgeKey("a-b", "c")).toBe(edgeKey("a-b", "c"))
  })

  const byEdge = new Map<string, ConnectorChannelTraffic>([
    [edgeKey("soma-user-profile-get", "soma-db"), { channel: "soma-user-profile-get", total: 900, windowed: 100, errors: 0 }],
    [edgeKey("soma-user-profile-put", "soma-db"), { channel: "soma-user-profile-put", total: 400, windowed: 50, errors: 10 }],
  ])

  it("sums the window across the channels an edge stands for", () => {
    const l = edgeLoad(["soma-user-profile-get", "soma-user-profile-put", "soma-user-prefs-get"], { kind: "connector", name: "soma-db" }, byEdge)
    expect(l).toEqual({ calls: 150, errors: 10, errorPct: (10 / 150) * 100, measured: true, windowed: true })
  })

  it("reads as a static reference with nothing measured", () => {
    const l = edgeLoad(["soma-user-prefs-get"], { kind: "connector", name: "soma-db" }, byEdge)
    expect(l.measured).toBe(false)
    expect(l.errorPct).toBeNull()
  })

  it("falls back to the cumulative count before a second sample, without an error share", () => {
    const warming = new Map([[edgeKey("a", "c"), { channel: "a", total: 7, windowed: null, errors: null }]])
    const l = edgeLoad(["a"], { kind: "connector", name: "c" }, warming)
    expect(l).toMatchObject({ calls: 7, measured: true, windowed: false, errorPct: null })
  })

  it("never meters a plugin or model edge", () => {
    expect(edgeLoad(["soma-user-profile-get"], { kind: "model", name: "soma-db" }, byEdge).measured).toBe(false)
  })
})

describe("focus and aggregation", () => {
  it("lights every dependant of a hub and the domains holding them", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index)
    const focus = dependencyFocus(dg, hubId("connector", "soma-cache"))
    expect([...focus].filter((id) => id.startsWith("soma-")).sort()).toEqual([
      "soma-pub-posts-get",
      "soma-user-feed-list",
      "soma-user-profile-put",
      "soma-user-session-check",
    ])
    expect(focus.has("domain:user")).toBe(true)
    expect(focus.has("domain:pub")).toBe(true)
    expect(focus.has("domain:admin")).toBe(false)
  })

  it("lights a channel's own domain and hubs", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index)
    const focus = dependencyFocus(dg, "soma-admin-repo-sync")
    expect([...focus].sort()).toEqual([
      "connector:soma-db",
      "connector:soma-github",
      "domain:admin",
      "soma-admin-repo-sync",
    ])
  })

  it("lists dependants by domain, biggest first", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index)
    const groups = dependantsByDomain(dg, dg.hubById.get("connector:soma-db")!)
    expect(groups.map((g) => [g.domain, g.channels.length])).toEqual([
      ["user", 7],
      ["admin", 4],
      ["pub", 2],
    ])
  })

  it("sums a domain's traffic and keeps the slowest p95 as a bound", () => {
    const t = (channel: string, over: Partial<ChannelTraffic>): ChannelTraffic => ({
      channel,
      ratePerMin: 0,
      windowed: 0,
      ok: 0,
      failed: 0,
      rejected: 0,
      duplicate: 0,
      errorPct: null,
      rejectedPct: null,
      dominantIssue: null,
      byStatus: {},
      p95Ms: null,
      total: 0,
      ...over,
    })
    const byChannel = new Map([
      ["a", t("a", { ratePerMin: 30, windowed: 150, ok: 140, failed: 10, p95Ms: 40 })],
      ["b", t("b", { ratePerMin: 10, windowed: 50, ok: 50, failed: 0, p95Ms: 300 })],
      ["c", t("c", {})],
    ])
    expect(domainLoad(["a", "b", "c", "missing"], byChannel)).toEqual({
      rate: 40,
      windowed: 200,
      ok: 190,
      failed: 10,
      errorPct: 5,
      worstP95Ms: 300,
      active: 2,
    })
  })

  it("colours a hub by its error share, and a failed load as critical", () => {
    const hub = { known: true, enabled: true }
    expect(hubLevel("health", hub, undefined)).toBe("idle")
    expect(hubLevel("health", hub, { windowed: 100, total: 100, errorPct: 0.2, p95Ms: 5 })).toBe("healthy")
    expect(hubLevel("health", hub, { windowed: 100, total: 100, errorPct: 12, p95Ms: 5 })).toBe("critical")
    expect(hubLevel("health", hub, undefined, true)).toBe("critical")
    expect(hubLevel("lifecycle", { known: true, enabled: false }, undefined)).toBe("idle")
  })
})

describe("layoutDependencies", () => {
  const sizes = {
    domain: { width: 260, height: 80 },
    channel: { width: 220, height: 44 },
    hub: { width: 250, height: 80 },
  }

  it("puts domains left, hubs right, without overlap", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index)
    const out = layoutDependencies(dg, () => false, sizes)
    expect(out.domains).toHaveLength(5)
    const hubXs = dg.hubs.map((h) => out.positions.get(h.id)!.x)
    expect(new Set(hubXs).size).toBe(1)
    expect(hubXs[0]).toBeGreaterThan(Math.max(...out.domains.map((d) => d.x + d.width)))
    const ys = dg.hubs.map((h) => out.positions.get(h.id)!.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(sizes.hub.height)
    // The hub nothing uses goes last.
    expect(out.positions.get("connector:soma-unused")!.y).toBe(ys[ys.length - 1])
  })

  it("places an open domain's channels inside its frame", () => {
    const { graph, index } = qa()
    const dg = buildDependencyGraph(graph, index)
    const out = layoutDependencies(dg, (id) => id === "domain:user", sizes)
    const frame = out.domains.find((d) => d.id === "domain:user")!
    expect(frame.expanded).toBe(true)
    for (const m of dg.domains[0].members) {
      const p = out.positions.get(m)!
      expect(p.x).toBeGreaterThanOrEqual(frame.x)
      expect(p.x + sizes.channel.width).toBeLessThanOrEqual(frame.x + frame.width)
      expect(p.y).toBeGreaterThanOrEqual(frame.y)
      expect(p.y + sizes.channel.height).toBeLessThanOrEqual(frame.y + frame.height)
    }
    // Collapsed domains place no channels.
    expect(out.positions.has("soma-admin-audit-export")).toBe(false)
  })

  it("returns an empty layout for an empty graph", () => {
    const index = buildIndex([], [], [])
    const dg = buildDependencyGraph(buildSystemGraph(index), index)
    const out = layoutDependencies(dg, () => true, sizes)
    expect(out.domains).toEqual([])
    expect(out.positions.size).toBe(0)
  })
})

describe("lens choice", () => {
  it("picks dependencies on a system without calls", () => {
    expect(callShare(qa().graph)).toBe(0)
  })

  it("picks calls once calls are a meaningful share", () => {
    const channels = ["a", "b", "c", "d"].map((n) => channel(n))
    const index = buildIndex(channels, [workflow("a", [callTo("b")]), workflow("b", []), workflow("c", []), workflow("d", [])], [])
    expect(callShare(buildSystemGraph(index))).toBeGreaterThanOrEqual(CALLS_SHARE)
  })
})

describe("parseHubId", () => {
  it("tells a hub from a channel name", () => {
    expect(parseHubId("connector:soma-db")).toEqual({ kind: "connector", name: "soma-db" })
    expect(parseHubId("soma-admin-check")).toBeNull()
    expect(parseHubId("domain:user")).toBeNull()
    expect(parseHubId(null)).toBeNull()
  })
})
