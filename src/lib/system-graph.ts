import { countGroups, countLeafSteps } from "@/lib/workflow-steps"
import {
  channelCallTargets,
  channelConnectorRefs,
  workflowConnectorRefs,
  type EntityIndex,
} from "@/lib/topology"
import type { ChannelProtocol, ChannelType, EntityStatus } from "@/api/types"

/**
 * The whole system as one graph, rather than one rooted walk per channel.
 *
 * The System Map's old model was `buildChannelTopology` — a BFS from a single
 * channel, the same builder the detail pages embed. On this shape of system that
 * produced 62 near-identical 3-to-5-node diagrams behind a dropdown, and could
 * never show the one fact that matters most: which channels are *hubs*. A graph
 * built forward from a root cannot report fan-in.
 *
 * So this builds the graph once, globally, and every view is a projection of it.
 *
 * Two modelling decisions worth stating:
 *
 * 1. **A channel and the workflow it runs are one node.** The workflow is not a
 *    separate hop the traffic takes — it *is* what the channel does. It gets its
 *    own node only when more than one channel runs it, which is the case where
 *    the sharing is the interesting part. The workflow's human title survives as
 *    the node's subtitle either way.
 * 2. **Connectors are not nodes.** A connector used by 51 of 62 workflows drawn
 *    as a node in every neighbourhood is wallpaper: it adds an edge everywhere
 *    and distinguishes nothing. They travel on the node that references them and
 *    render as a rail, where fan-in is legible at a glance.
 *
 * Node identity is the channel **name**, because that is what `channel_call`
 * targets and what `orion_messages_total{channel}` is labelled with. `channel_id`
 * is a UUID and joins to neither.
 */

export interface SystemNode {
  /** Channel name — the join key for calls and for metrics. */
  id: string
  /** UUID, for routing to /channels/:id. */
  channelId: string
  name: string
  description: string | null
  status: EntityStatus
  channelType: ChannelType
  protocol: ChannelProtocol
  route: string | null
  methods: string[]
  tags: string[]
  /** Slug id of the workflow this channel runs. */
  workflowId: string | null
  /** The workflow's human title, e.g. "Auth - login". */
  workflowName: string | null
  /** True when more than one channel runs this workflow. */
  workflowShared: boolean
  /** Leaf task count, descending task groups. */
  steps: number
  groups: number
  /** Connector names referenced by the channel config or the workflow's tasks. */
  connectors: string[]
  /** Channels that call this one. */
  callers: string[]
  /** Channels this one calls. */
  callees: string[]
  /** Longest path from an entry channel. 0 = nothing calls it. */
  tier: number
  /** Named by a `channel_call` but absent from the registry. */
  unresolved: boolean
}

export interface SystemEdge {
  id: string
  source: string
  target: string
}

export interface ConnectorUse {
  name: string
  /** Channel names whose config or workflow references it. */
  users: string[]
  enabled: boolean
  /** Resolves to a connector in the registry. */
  known: boolean
  /** Routing id — the UUID when known, else the name. */
  refId: string
}

export interface SystemGraph {
  nodes: SystemNode[]
  edges: SystemEdge[]
  byId: Map<string, SystemNode>
  connectors: ConnectorUse[]
  /** Every distinct tag across the channels, sorted by frequency. */
  tags: { tag: string; count: number }[]
  maxTier: number
}

function placeholder(name: string): SystemNode {
  return {
    id: name,
    channelId: name,
    name,
    description: null,
    status: "draft",
    channelType: "sync",
    protocol: "rest",
    route: null,
    methods: [],
    tags: [],
    workflowId: null,
    workflowName: null,
    workflowShared: false,
    steps: 0,
    groups: 0,
    connectors: [],
    callers: [],
    callees: [],
    tier: 0,
    unresolved: true,
  }
}

/**
 * Longest path from an entry channel, so hubs sit downstream of everything that
 * calls them rather than beside it.
 *
 * Kahn's algorithm, because the call graph is a DAG in practice but nothing in
 * the engine forbids a cycle: anything still holding in-edges when the queue
 * drains is in one, and gets parked one tier past the acyclic part instead of
 * spinning.
 */
function assignTiers(nodes: SystemNode[], byId: Map<string, SystemNode>): number {
  const indegree = new Map<string, number>()
  for (const n of nodes) indegree.set(n.id, n.callers.length)

  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  const settled = new Set<string>()

  while (queue.length) {
    const id = queue.shift()!
    if (settled.has(id)) continue
    settled.add(id)
    const node = byId.get(id)
    if (!node) continue
    for (const callee of node.callees) {
      const target = byId.get(callee)
      if (!target) continue
      target.tier = Math.max(target.tier, node.tier + 1)
      const left = (indegree.get(callee) ?? 0) - 1
      indegree.set(callee, left)
      if (left <= 0) queue.push(callee)
    }
  }

  let maxTier = 0
  for (const n of nodes) maxTier = Math.max(maxTier, n.tier)
  // Cycle members never drained; park them past the acyclic part.
  for (const n of nodes) if (!settled.has(n.id)) n.tier = maxTier + 1
  for (const n of nodes) maxTier = Math.max(maxTier, n.tier)
  return maxTier
}

export function buildSystemGraph(idx: EntityIndex): SystemGraph {
  const byId = new Map<string, SystemNode>()

  // How many channels run each workflow — decides whether the workflow is worth
  // its own identity or folds into the channel.
  const channelsPerWorkflow = new Map<string, number>()
  for (const channel of idx.channelsById.values()) {
    if (!channel.workflow_id) continue
    channelsPerWorkflow.set(channel.workflow_id, (channelsPerWorkflow.get(channel.workflow_id) ?? 0) + 1)
  }

  const connectorUsers = new Map<string, Set<string>>()
  const noteConnector = (name: string, channelName: string) => {
    const set = connectorUsers.get(name) ?? new Set<string>()
    set.add(channelName)
    connectorUsers.set(name, set)
  }

  for (const channel of idx.channelsById.values()) {
    const workflow = channel.workflow_id ? idx.workflowsById.get(channel.workflow_id) : undefined

    const connectors = new Set<string>(channelConnectorRefs(channel))
    if (workflow) for (const name of workflowConnectorRefs(workflow)) connectors.add(name)
    for (const name of connectors) noteConnector(name, channel.name)

    byId.set(channel.name, {
      id: channel.name,
      channelId: channel.channel_id,
      name: channel.name,
      description: channel.description,
      status: channel.status,
      channelType: channel.channel_type,
      protocol: channel.protocol,
      route: channel.route_pattern,
      methods: channel.methods ?? [],
      tags: channel.tags ?? [],
      workflowId: channel.workflow_id,
      workflowName: workflow?.name ?? null,
      workflowShared: (channelsPerWorkflow.get(channel.workflow_id ?? "") ?? 0) > 1,
      steps: workflow ? countLeafSteps(workflow.tasks) : 0,
      groups: workflow ? countGroups(workflow.tasks) : 0,
      connectors: [...connectors].sort(),
      callers: [],
      callees: [],
      tier: 0,
      unresolved: false,
    })
  }

  // Edges. A call is authored on the workflow but belongs, on this map, to the
  // channel that runs it: that is the thing with a name, a route and a metrics
  // label.
  const edges = new Map<string, SystemEdge>()
  for (const channel of idx.channelsById.values()) {
    const workflow = channel.workflow_id ? idx.workflowsById.get(channel.workflow_id) : undefined
    if (!workflow) continue
    for (const target of channelCallTargets(workflow)) {
      if (target === channel.name) continue // self-call adds nothing to read
      if (!byId.has(target)) byId.set(target, placeholder(target))
      const id = `${channel.name}->${target}`
      if (edges.has(id)) continue
      edges.set(id, { id, source: channel.name, target })
      byId.get(channel.name)!.callees.push(target)
      byId.get(target)!.callers.push(channel.name)
    }
  }

  const nodes = [...byId.values()]
  for (const n of nodes) {
    n.callers.sort()
    n.callees.sort()
  }
  const maxTier = assignTiers(nodes, byId)

  const connectors: ConnectorUse[] = [...connectorUsers.entries()]
    .map(([name, users]) => {
      const registered = idx.connectorsByName.get(name)
      return {
        name,
        users: [...users].sort(),
        enabled: registered?.enabled ?? false,
        known: !!registered,
        refId: registered?.id ?? name,
      }
    })
    .sort((a, b) => b.users.length - a.users.length || a.name.localeCompare(b.name))

  const tagCounts = new Map<string, number>()
  for (const n of nodes) for (const t of n.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  const tags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))

  nodes.sort((a, b) => a.name.localeCompare(b.name))
  return { nodes, edges: [...edges.values()], byId, connectors, tags, maxTier }
}

/**
 * Everything reachable from a node in either direction, as a flat id set.
 * Powers focus mode: the blast radius of a change, not just what it calls.
 */
export function neighbourhood(graph: SystemGraph, rootId: string, hops = Infinity): Set<string> {
  const seen = new Set<string>([rootId])
  let frontier = [rootId]
  for (let hop = 0; hop < hops && frontier.length; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      const node = graph.byId.get(id)
      if (!node) continue
      for (const other of [...node.callers, ...node.callees]) {
        if (seen.has(other)) continue
        seen.add(other)
        next.push(other)
      }
    }
    frontier = next
  }
  return seen
}
